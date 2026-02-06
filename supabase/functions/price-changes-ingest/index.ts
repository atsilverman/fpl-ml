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
  // Strip markdown code fence if present (e.g. ```json ... ```)
  const stripped = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim()
  const jsonMatch = stripped.match(/\{[\s\S]*\}/)
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
  console.log("[price-changes-ingest] Request:", req.method)
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
  console.log("[price-changes-ingest] Body text length:", rawText.length)
  if (!rawText) {
    return new Response(
      JSON.stringify({ error: "Missing or empty text" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
    )
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  if (!supabaseUrl || !supabaseServiceKey) {
    console.error("[price-changes-ingest] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
    return new Response(
      JSON.stringify({ error: "Server misconfiguration: Supabase env not set" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    )
  }

  const openaiKey = Deno.env.get("OPENAI_API_KEY")
  if (!openaiKey) {
    return new Response(
      JSON.stringify({ error: "Server misconfiguration: OPENAI_API_KEY not set" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    )
  }

  const systemPrompt = `You are a parser for FPL (Fantasy Premier League) price change predictions. Given raw text from a screenshot (often OCR), extract two lists based on WHERE each player appears in the source.

CRITICAL - Use the source layout to classify rises vs falls:
- The screenshot source (e.g. LiveFPL) has two distinct sections: one for predicted RISES and one for predicted FALLS.
- Typical headings: "Predicted Rises tonight", "Risers", "Rise", or similar → those players go in "rises".
- Typical headings: "Predicted Falls tonight", "Fallers", "Fall", or similar → those players go in "falls".
- Put each player in "rises" ONLY if they appear under the rises section/heading in the text; put them in "falls" ONLY if they appear under the falls section/heading. Do not guess from name or price—use position in the text.

Return ONLY a single JSON object with no markdown or explanation, in this exact shape:
{"rises":[{"player_name":"Salah","team_short_name":"LIV","price":"£6.5"}],"falls":[{"player_name":"Haaland","team_short_name":"MCI","price":"£14.2"}]}

Rules:
- player_name: use the name as shown (e.g. Salah, Haaland, Son, Chalobah, Enzo).
- team_short_name: use the 3-letter club code if visible (e.g. LIV, MCI, ARS); if unknown use null.
- price: if the text shows a price next to the player (e.g. £6.5, 6.5, 14.2), include it as a string with or without the pound sign (e.g. "£6.5" or "6.5"); if no price is visible for that player, omit the field or use null.
- If the text has no clear rise/fall sections, return {"rises":[],"falls":[]}.
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
    console.error("[price-changes-ingest] LLM or parse error:", e)
    return new Response(
      JSON.stringify({ error: "Failed to structure text", details: String(e) }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    )
  }

  console.log("[price-changes-ingest] Parsed rises:", structured.rises.length, "falls:", structured.falls.length)
  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  const payload = {
    rises: structured.rises ?? [],
    falls: structured.falls ?? [],
    raw_text: rawText.slice(0, 10000) || null,
  }

  let row: { id?: string } | null = null
  let insertError: { code?: string; message: string; details?: unknown } | null = null
  try {
    const result = await supabase
      .from("price_change_predictions")
      .insert(payload)
      .select("id")
      .single()
    row = result.data
    insertError = result.error
  } catch (e) {
    console.error("[price-changes-ingest] Insert threw:", e)
    return new Response(
      JSON.stringify({
        error: "Failed to save predictions",
        details: e instanceof Error ? e.message : String(e),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    )
  }

  if (insertError) {
    console.error("[price-changes-ingest] Supabase insert error:", insertError.code, insertError.message, insertError.details)
    return new Response(
      JSON.stringify({
        error: "Failed to save predictions",
        details: insertError.message,
        code: insertError.code,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    )
  }

  console.log("[price-changes-ingest] Inserted id:", row?.id)
  return new Response(
    JSON.stringify({ id: row?.id ?? null }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
  )
})
