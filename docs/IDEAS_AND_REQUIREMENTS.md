# Ideas & requirements (backlog)

Tracking feature ideas and requirements. **Do not implement until we are ready to proceed.**

---

## Gameweek recap splash / announcement

### Goal
- Show a **gameweek recap** (top performers, stats, other info) to users.
- **Publish** a recap so it becomes the "current" one.
- **New users** (and optionally existing users) see it when they visit until they dismiss it.

### Requirements (to refine when we implement)
- **Splash/modal:** Full-screen or modal that blocks the app until the user explicitly closes it (no overlay click to close).
- **Optional "must read":** Close button only after scroll-to-bottom and/or a short delay.
- **Publish flow:** Backend stores "current published recap" (e.g. gameweek id; optional title/intro). When we're ready, we set that to the new GW (or new recap).
- **Who sees it:** Show when the user has not yet dismissed **this** recap (e.g. localStorage key like `lastSeenRecapGameweek` or `dismissedRecapId`). New users have no key → they see the current published recap once.
- **Recap content:** Reuse existing gameweek data: top performers (points, xG, xA, BPS, DEFCON), plus any other stats we already have for that GW. Optional: stored intro/title when publishing.
- **Placement:** Decide whether recap modal lives in `App.jsx` (every route) or `Dashboard.jsx` (main app only).

### Implementation notes (for later)
- Backend: table or config for "current recap" (e.g. `published_recap` with `gameweek_id`, optional `title`, `intro_text`, `published_at`); or "latest finished GW" as fallback with no explicit publish.
- Frontend: fetch current published recap → load that GW's data (existing hooks or variant that takes `gameweek`) → show modal; on dismiss, set localStorage so we don't show again until a new recap is published.
- Reuse existing modal pattern (e.g. `ConfigurationModal.css` / overlay + content + close button).

### Status
- [ ] Not started. Do not implement until we are ready.

---

## FPL chat / AI insights (ChatGPT-like)

### Goal
- A **chat-style page** where users ask FPL questions and get answers tailored to their **configured league and manager** (squad, rank, rivals).
- **Transfer suggestions** consider both **form** (e.g. G + xGI over last 6 gameweeks) and **differentials** (players not owned by managers around them in rank, or low league ownership).

### Requirements (to refine when we implement)
- **Chat UI:** New route/page (e.g. `/insights` or under Research) with message list, input, optional suggested prompts (e.g. "Who should I consider bringing in for [Player X]?").
- **Backend API** (Supabase Edge Function or small service):
  - **Access rule:** Only use the authenticated user's configured league and manager from `user_configurations`. Reject (403) if the request asks for any other league/manager. Never interact with non-configured leagues.
  - Build **context:** user's squad (`manager_picks`), current gameweek, last N (e.g. 6) gameweeks of stats from `player_gameweek_stats` (goals, assists, xG, xGI, points, minutes).
  - For "who should I bring in?": list **unowned** players, aggregate last-6 form, sort in memory by e.g. G + xGI; optionally filter by position (replace like-for-like).
  - **Differentials:** Define "managers around you" via `mv_mini_league_standings` (e.g. rank ±5). For each candidate, compute league ownership and rival ownership from `manager_picks`. Surface both "strong form" and "differential" (low ownership among rivals) in suggestions.
  - Send context + user message to an LLM (e.g. OpenAI); return or stream reply. **API key stored server-side only.**

### Data used
- `user_configurations`, `manager_picks`, `mv_mini_league_standings`, `player_gameweek_stats`, `players`, `teams`, `gameweeks`. No new tables required for v1; optional view/function for "last 6 GW form" later.

### Implementation notes (for later)
- Frontend: new page + component; use `useConfiguration()` for `managerId` / `leagueId`; `fetch()` to backend with JWT; display assistant replies in thread.
- Backend: authenticate user → load `user_configurations` → validate request league/manager match → build context (squad, unowned, last-6 stats, rival band, ownership counts) → rank candidates (form + differential) → build prompt → call LLM → return/stream.
- Optional: "For which player?" dropdown from current squad; conversation history for multi-turn; streamed response for ChatGPT-like feel.

### Status
- [ ] Not started. Do not implement until we are ready.

---

## Content creator league & research mode

### Goal
- Track a **content creator league** (e.g. the one used on [FPL Gameweek](https://www.fplgameweek.com/#/25/team/344182/league/special_10002)) so users can follow transfers, chips, and activity of FPL content creators.
- **Content creator mode:** Let users switch into a mode where they view the content creator league's activity and **add manager favorites** to their config to monitor.
- **Research bento subpage:** Show favorites' transfers, chips played, and related info in a dedicated Research subpage.

### Requirements (to refine when we implement)
- **League discovery:** Identify the league used on the reference page (e.g. `special_10002` may map to an FPL league ID). Optionally **mine manager IDs** from that page or similar sources to build/validate the league roster.
- **Content creator mode:** A toggle or mode (e.g. in config) that switches context from "my mini league" to "content creator league." When active, UI surfaces that league's standings and manager list.
- **Manager favorites:** Users can add content-creator managers as **favorites** (stored in config, e.g. `user_configurations` or a separate `favorite_managers` table). These are the managers we monitor for transfers/chips.
- **Research bento subpage:** New subpage under Research (or similar) showing for each favorite (or for the league): **transfers** (in/out, gameweek), **chips played** (when and which), and any other relevant activity we can derive from existing data.
- **Data source:** Use existing FPL/sync data where possible (manager picks, transfer history, chip usage). No dependency on scraping the reference site for live data once league ID and manager IDs are known.

### Data used
- Existing: `user_configurations`, manager/league sync data, `manager_picks`, transfer and chip tables (or FPL API equivalents).
- New/optional: config or table for "content creator league" ID; list of manager IDs for that league; `favorite_managers` (user id, manager id, maybe display name) for monitoring list.

### Implementation notes (for later)
- **League ID:** Inspect FPL Gameweek's network requests or page structure to find the real FPL league ID for `special_10002`, or maintain a curated list of content-creator league IDs and manager IDs we discover.
- **Mining manager IDs:** If we scrape or parse the reference page, do it in a one-off or admin flow to populate our "content creator league" roster; avoid ongoing scraping for live data.
- **Config:** Extend `user_configurations` or add a small table for "content creator mode" flag and list of favorite manager IDs. Research bento reads this list and aggregates transfers/chips for those managers from existing backend data.
- **Research bento:** Reuse existing bento/subpage patterns; new subpage that queries transfer history and chip usage for favorite managers (and optionally the whole content creator league).

### Status
- [ ] Not started. Do not implement until we are ready.
