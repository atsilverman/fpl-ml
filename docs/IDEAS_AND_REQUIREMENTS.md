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
- **Chat UI:** New route/page (e.g. `/insights` or under Research) with message list, input, optional suggested prompts (e.g. “Who should I consider bringing in for [Player X]?”).
- **Backend API** (Supabase Edge Function or small service):
  - **Access rule:** Only use the authenticated user’s configured league and manager from `user_configurations`. Reject (403) if the request asks for any other league/manager. Never interact with non-configured leagues.
  - Build **context:** user’s squad (`manager_picks`), current gameweek, last N (e.g. 6) gameweeks of stats from `player_gameweek_stats` (goals, assists, xG, xGI, points, minutes).
  - For “who should I bring in?”: list **unowned** players, aggregate last-6 form, sort in memory by e.g. G + xGI; optionally filter by position (replace like-for-like).
  - **Differentials:** Define “managers around you” via `mv_mini_league_standings` (e.g. rank ±5). For each candidate, compute league ownership and rival ownership from `manager_picks`. Surface both “strong form” and “differential” (low ownership among rivals) in suggestions.
  - Send context + user message to an LLM (e.g. OpenAI); return or stream reply. **API key stored server-side only.**

### Data used
- `user_configurations`, `manager_picks`, `mv_mini_league_standings`, `player_gameweek_stats`, `players`, `teams`, `gameweeks`. No new tables required for v1; optional view/function for “last 6 GW form” later.

### Implementation notes (for later)
- Frontend: new page + component; use `useConfiguration()` for `managerId` / `leagueId`; `fetch()` to backend with JWT; display assistant replies in thread.
- Backend: authenticate user → load `user_configurations` → validate request league/manager match → build context (squad, unowned, last-6 stats, rival band, ownership counts) → rank candidates (form + differential) → build prompt → call LLM → return/stream.
- Optional: “For which player?” dropdown from current squad; conversation history for multi-turn; streamed response for ChatGPT-like feel.

### Status
- [ ] Not started. Do not implement until we are ready.
