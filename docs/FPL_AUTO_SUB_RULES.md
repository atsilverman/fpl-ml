# FPL Automatic Substitution Rules (Reference)

Official Fantasy Premier League auto-sub rules and how we apply them (including proactive display).

## When auto-subs occur

- A **starter** is considered to have **played** if they are on the pitch for **at least one minute** or receive a **yellow or red card** in that gameweek.
- If a starter **plays 0 minutes** (and is not carded on the bench), they are eligible to be auto-subbed.
- FPL processes auto-subs **at the end of the gameweek** (not live). Points are final only after the gameweek closes.

## Bench order and priority

- The manager sets **bench order** (positions 12, 13, 14, 15 in the API).
- **Position 12** = first substitute = highest priority, then 13, 14, 15.
- The game tries the **first** bench slot, then the second if the first can’t be used, and so on. Order is strict: we must use the **first eligible** player by bench order, not the first who has already played.

## Position and formation rules

### Goalkeeper

- **Only a goalkeeper** on the bench can replace a non-playing goalkeeper.
- No outfield-for-GK or GK-for-outfield substitution.

### Outfield (DEF / MID / FWD)

- A non-playing **outfield** player can be replaced by **any outfield** substitute (defender, midfielder, or forward), **provided** the resulting team still satisfies the **minimum formation**:
  - At least **1 goalkeeper**
  - At least **3 defenders**
  - At least **2 midfielders**
  - At least **1 forward**
- Same position is **not** required (e.g. a forward can replace a midfielder if the formation remains valid).
- If bringing on the first bench player would break formation (e.g. only 2 defenders), FPL skips to the next bench player that would keep the formation valid.

## Who can actually come on (for points)

- The substitute must have **played** in the gameweek (≥1 minute or a card) for their points to count.
- If the first bench player hasn’t played, FPL moves to the second, then the third, in bench order, respecting formation.
- So: **first eligible by bench order** is the “designated” sub; **first eligible who has played** is the “applied” sub (whose points count).

## Our implementation: designated vs applied

### Designated sub (for UI indicator)

- **First eligible** bench player by **bench order** (12 → 13 → 14 → 15):
  - GK only for GK; any outfield for any outfield (we do not currently enforce minimum DEF/MID/FWD formation in code; we only enforce GK vs outfield).
- We do **not** require the bench player to have played or their match to be finished.
- We show the “auto subbed on” indicator on this player **proactively** (e.g. J.Timber even if his match is still scheduled).

### Applied sub (for points)

- **First eligible** bench player by bench order who has **played** (match finished, minutes > 0).
- Used for points calculation and for “who actually came on” when the gameweek is final.
- If the designated sub’s match finishes and they **DNP**, we cascade: show the next eligible bench player who has played (e.g. Anderson, then Alderete).

### Display rule

- **Display sub** = designated sub, unless the designated sub’s match is finished and they have 0 minutes; then display sub = applied sub (cascade).
- So: indicator on first in line (e.g. Timber); if Timber DNP, move indicator to next who played (e.g. Anderson or Alderete).

## Processing order (starters)

- Starters are processed in **slot order** (position 1, 2, … 11).
- The **first** non-playing starter (lowest slot) gets the **first** eligible bench player (position 12, then 13, …).
- So if two starters don’t play, the one in the lower slot gets bench 12, the next gets bench 13, etc.

## References

- Premier League FPL help and rules.
- Fantasy Football Scout, FPL reports, FPL Fulcrum: bench order, formation minimums (1 GK, 3 DEF, 2 MID, 1 FWD), outfield-for-outfield allowed when formation is valid.
