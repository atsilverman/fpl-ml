// Debug: verify manager attributes (overall_rank, gameweek_rank, total_points, etc.)
// against the official FPL API using a fixed manager (default 344182).
// Returns DB value, API value, and match (true/false) per attribute.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const FPL_BASE = "https://fantasy.premierleague.com/api"
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

const DEFAULT_MANAGER_ID = 344182

interface AttributeRow {
  name: string
  db: string | number | null
  api: string | number | null
  match: boolean
}

function compare(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a == null && b == null) return true
  if (a == null || b == null) return false
  return String(a) === String(b)
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS, status: 200 })
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { headers: { ...CORS_HEADERS, "Content-Type": "application/json" }, status: 405 }
    )
  }

  let managerId = DEFAULT_MANAGER_ID
  try {
    const body = await req.json().catch(() => ({})) as { manager_id?: number }
    if (body?.manager_id != null) managerId = Number(body.manager_id)
  } catch {
    // use default
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  // 1) Current gameweek from DB
  const { data: gwRow, error: gwError } = await supabase
    .from("gameweeks")
    .select("id")
    .eq("is_current", true)
    .limit(1)
    .single()

  if (gwError || !gwRow) {
    return new Response(
      JSON.stringify({
        error: "No current gameweek in DB",
        manager_id: managerId,
        attributes: [],
      }),
      { headers: { ...CORS_HEADERS, "Content-Type": "application/json" }, status: 200 }
    )
  }

  const gameweek = gwRow.id as number

  // 2) FPL API: entry history and picks
  const headers = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    "Accept": "application/json",
    "Referer": "https://fantasy.premierleague.com/",
  }

  let history: { current?: Array<Record<string, unknown>> } = {}
  let picksData: { entry_history?: Record<string, unknown> } = {}

  try {
    const historyRes = await fetch(`${FPL_BASE}/entry/${managerId}/history/`, { headers })
    if (!historyRes.ok) {
      return new Response(
        JSON.stringify({
          error: `FPL history API failed: ${historyRes.status}`,
          manager_id: managerId,
          gameweek,
          attributes: [],
        }),
        { headers: { ...CORS_HEADERS, "Content-Type": "application/json" }, status: 200 }
      )
    }
    history = (await historyRes.json()) as { current?: Array<Record<string, unknown>> }
  } catch (e) {
    return new Response(
      JSON.stringify({
        error: `FPL history request failed: ${String(e)}`,
        manager_id: managerId,
        gameweek,
        attributes: [],
      }),
      { headers: { ...CORS_HEADERS, "Content-Type": "application/json" }, status: 200 }
    )
  }

  try {
    const picksRes = await fetch(
      `${FPL_BASE}/entry/${managerId}/event/${gameweek}/picks/`,
      { headers }
    )
    if (picksRes.ok) {
      picksData = (await picksRes.json()) as { entry_history?: Record<string, unknown> }
    }
  } catch {
    // picks optional for comparison; we can still compare history fields
  }

  const currentList = history.current ?? []
  const gwHistory = currentList.find((h) => h.event === gameweek) as Record<string, unknown> | undefined
  const entryHistory = picksData.entry_history ?? {}

  const apiOverallRank = gwHistory?.overall_rank as number | null | undefined
  const apiTotalPoints = gwHistory?.total_points as number | null | undefined
  const apiGameweekPoints = gwHistory?.points as number | null | undefined
  const apiGameweekRank = entryHistory?.rank as number | null | undefined
  const apiTeamValueTenths = gwHistory?.value as number | null | undefined

  // 3) DB: manager_gameweek_history for this manager + gameweek
  const { data: dbRows, error: dbError } = await supabase
    .from("manager_gameweek_history")
    .select("overall_rank, gameweek_rank, total_points, gameweek_points, team_value_tenths")
    .eq("manager_id", managerId)
    .eq("gameweek", gameweek)
    .limit(1)

  const dbRow = dbError ? null : dbRows?.[0] ?? null
  const dbOverallRank = dbRow?.overall_rank ?? null
  const dbGameweekRank = dbRow?.gameweek_rank ?? null
  const dbTotalPoints = dbRow?.total_points ?? null
  const dbGameweekPoints = dbRow?.gameweek_points ?? null
  const dbTeamValueTenths = dbRow?.team_value_tenths ?? null

  // 4) Build attribute rows
  const attributes: AttributeRow[] = [
    {
      name: "overall_rank",
      db: dbOverallRank,
      api: apiOverallRank ?? null,
      match: compare(dbOverallRank, apiOverallRank),
    },
    {
      name: "gameweek_rank",
      db: dbGameweekRank,
      api: apiGameweekRank ?? null,
      match: compare(dbGameweekRank, apiGameweekRank),
    },
    {
      name: "total_points",
      db: dbTotalPoints,
      api: apiTotalPoints ?? null,
      match: compare(dbTotalPoints, apiTotalPoints),
    },
    {
      name: "gameweek_points",
      db: dbGameweekPoints,
      api: apiGameweekPoints ?? null,
      match: compare(dbGameweekPoints, apiGameweekPoints),
    },
    {
      name: "team_value_tenths",
      db: dbTeamValueTenths,
      api: apiTeamValueTenths ?? null,
      match: compare(dbTeamValueTenths, apiTeamValueTenths),
    },
  ]

  return new Response(
    JSON.stringify({
      manager_id: managerId,
      gameweek,
      attributes,
    }),
    { headers: { ...CORS_HEADERS, "Content-Type": "application/json" }, status: 200 }
  )
})
