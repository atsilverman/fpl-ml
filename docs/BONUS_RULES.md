# Bonus points (BPS) rules per match

## Official FPL rules

- **Per fixture:** Exactly **three** players in a match receive bonus points: **3**, **2**, and **1** (for 1st, 2nd, 3rd by BPS).
- **Order:** Determined by **Bonus Points System (BPS)** only. Higher BPS = better rank. Official FPL does not use goals/assists/clean sheets to break ties when BPS is equal—equal BPS is a tie, resolved by the distribution rules below.

## Tie handling (FPL)

- **Tie for 1st:** 1st and 2nd get **3** each, 3rd gets **1** (no 2pt).
- **Tie for 2nd:** 1st gets **3**, 2nd and 3rd get **2** each (no 1pt).
- **Tie for 3rd:** 1st gets **3**, 2nd gets **2**, 3rd and 4th get **1** each.

## Before official data (provisional)

Until FPL confirms bonus (~1h after full-time), we derive **provisional bonus** from BPS rank in that fixture:

- **Backend:** `backend/src/refresh/players.py` → `_calculate_provisional_bonus()` uses **BPS only** for ranking (per official FPL: no goals/assists/clean_sheets tiebreaker). Sorts by BPS desc, then id for deterministic order; groups by same BPS; assigns 3/2/1 with official tie rules (tie 1st → 3+3+1, tie 2nd → 3+2+2, tie 3rd → 3+2+1+1). Stored in `player_gameweek_stats.provisional_bonus`.
- **Frontend (bonus subpage):** We **never** show more than **3** players in the BPS chart. We take the **top 3 by BPS** (with same tiebreakers: BPS desc → goals → assists → clean sheets → name). Displayed bonus in the chart is **always by rank**: 1st = 3+, 2nd = 2+, 3rd = 1+, so the UI never shows a player with lower BPS receiving more bonus than a player above them.

## Display rules (this app)

1. **Who is shown:** Only the **top 3 by BPS** in the fixture (one list for the whole match, not per team).
2. **What we show:** Bonus badges (3+, 2+, 1+) are assigned **by BPS rank** in the chart (1st = 3, 2nd = 2, 3rd = 1). We do not display API/backend bonus values when they would contradict that order (e.g. a player with lower BPS showing 3+ while a player with higher BPS shows 2+).

This keeps the bonus subpage logical and consistent with FPL rules.
