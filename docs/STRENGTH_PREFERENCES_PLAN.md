# Team strength & user preferences – implementation plan

## Summary

- **System strengths:** All FPL team strength fields are stored in `teams` and kept in sync from bootstrap-static.
- **User overrides:** Per-user, per-team strength (1–5) is stored in `user_configurations.team_strength_overrides` (JSONB). When logged in (e.g. Google), overrides are saved to Supabase; "Reset to FPL defaults" clears overrides.
- **Schedule:** Schedule cells use effective strength (override if set, else `teams.strength`) for difficulty coloring.

## Migrations

1. **035_add_teams_strength.sql** – `teams.strength` (1–5).
2. **036_add_teams_strength_detailed.sql** – `strength_overall_home/away`, `strength_attack_home/away`, `strength_defence_home/away` on `teams`.
3. **037_add_team_strength_overrides.sql** – `user_configurations.team_strength_overrides` (JSONB). Format: `{ "team_id": 1–5, ... }`. NULL or `{}` = use API defaults.

Run these in Supabase SQL Editor if not applied via your migration flow.

## Backfill

- **Backend refresh:** Gameweeks refresh now upserts all team strength fields from bootstrap.
- **One-off:** `python scripts/backfill_team_strength.py` to backfill/update teams (including strength and detailed fields).

## Frontend

- **ConfigurationContext:** Loads and saves `team_strength_overrides`; exposes `saveTeamStrengthOverrides(overrides)` and `resetTeamStrengthOverrides()`.
- **Schedule:** `ScheduleSubpage` passes `config?.teamStrengthOverrides` to `OpponentCell`; effective strength = override ?? API strength (clamped 1–5).
- **Configuration modal:** Step 3 "Team strength (difficulty)" – sliders 1–5 per team, "Reset to FPL defaults", persisted when logged in.

## Resolver

Effective strength for a team:

- If user has overrides and `overrides[team_id]` is set → use it (clamped 1–5).
- Else → use `teams.strength` (API default).

Reset to system defaults = set `team_strength_overrides` to `null` (or `{}`).
