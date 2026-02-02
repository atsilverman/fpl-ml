// Price Changes Ingest Edge Function
// Accepts OCR text from iOS Shortcut, structures via LLM, inserts into price_change_predictions.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

interface PriceChangePlayer {
  player_name: string
  team_short_name: string | null
  price: string | null
}

interface StructuredPayload {
  rises: PriceChangePlayer[]
  falls: PriceChangePlayer[]
}

function parseJsonFromContent(content: string): StructuredPayload {
  const trimmed = content.trim()
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error("No JSON object in LLM response")
  const parsed = JSON.parse(jsonMatch[0]) as unknown
  if (!parsed || typeof parsed !== "object") throw new Error("Invalid JSON")
  const obj = parsed as Record<string, unknown>
  const rises = Array.isArray(obj.rises) ? obj.rises : []
  const falls = Array.isArray(obj.falls) ? obj.falls : []
  const normalize = (item: unknown): PriceChangePlayer => {
    if (item && typeof item === "object" && "player_name" in item) {
      const p = item as Record<string, unknown>
      const price = p.price != null && p.price !== "" ? String(p.price).trim() : null
      return {
        player_name: String(p.player_name ?? ""),
        team_short_name: p.team_short_name != null ? String(p.team_short_name) : null,
        price: price || null,
      }
    }
    return { player_name: "", team_short_name: null, price: null }
  }
  return {
    rises: rises.map(normalize).filter((r) => r.player_name),
    falls: falls.map(normalize).filter((r) => r.player_name),
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 405 }
    )
  }

  const secret = Deno.env.get("PRICE_CHANGES_INGEST_SECRET")
  const authHeader = req.headers.get("Authorization")
  const apiKey = req.headers.get("x-api-key")
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : apiKey ?? ""
  if (secret && secret.length > 0 && token !== secret) {
    return new Response(
      JSON.stringify({ error: "Unauthorized" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 401 }
    )
  }

  let body: { text?: string }
  try {
    body = (await req.json()) as { text?: string }
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid JSON body" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
    )
  }

  const rawText = typeof body.text === "string" ? body.text.trim() : ""
  if (!rawText) {
    return new Response(
      JSON.stringify({ error: "Missing or empty text" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
    )
  }

  const openaiKey = Deno.env.get("OPENAI_API_KEY")
  if (!openaiKey) {
    return new Response(
      JSON.stringify({ error: "Server misconfiguration: OPENAI_API_KEY not set" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    )
  }

  const systemPrompt = `You are a parser for FPL (Fantasy Premier League) price change predictions. Given raw text from a screenshot (often OCR), extract two lists:
1. Players predicted to RISE in price.
2. Players predicted to FALL in price.

Return ONLY a single JSON object with no markdown or explanation, in this exact shape:
{"rises":[{"player_name":"Salah","team_short_name":"LIV","price":"£6.5"}],"falls":[{"player_name":"Haaland","team_short_name":"MCI","price":"£14.2"}]}

Rules:
- player_name: use the name as shown (e.g. Salah, Haaland, Son).
- team_short_name: use the 3-letter club code if visible (e.g. LIV, MCI, ARS); if unknown use null.
- price: if the text shows a price next to the player (e.g. £6.5, 6.5, 14.2), include it as a string with or without the pound sign (e.g. "£6.5" or "6.5"); if no price is visible for that player, omit the field or use null.
- If the text has no clear rise/fall lists, return {"rises":[],"falls":[]}.
- Only include players you can clearly identify from the text.`

  let structured: StructuredPayload
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: rawText },
        ],
        temperature: 0.1,
      }),
    })
    if (!res.ok) {
      const errText = await res.text()
      console.error("OpenAI error:", res.status, errText)
      throw new Error(`LLM request failed: ${res.status}`)
    }
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
    const content = data.choices?.[0]?.message?.content ?? ""
    structured = parseJsonFromContent(content)
  } catch (e) {
    console.error("LLM or parse error:", e)
    return new Response(
      JSON.stringify({ error: "Failed to structure text", details: String(e) }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    )
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  const { data: row, error } = await supabase
    .from("price_change_predictions")
    .insert({
      rises: structured.rises,
      falls: structured.falls,
      raw_text: rawText.slice(0, 10000),
    })
    .select("id")
    .single()

  if (error) {
    console.error("Supabase insert error:", error)
    return new Response(
      JSON.stringify({ error: "Failed to save predictions", details: error.message }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    )
  }

  return new Response(
    JSON.stringify({ id: row?.id ?? null }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
  )
})
