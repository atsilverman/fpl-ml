# FPL Defensive Contribution (DEFCON) – Official Thresholds

Defcon is achieved when a player’s **defensive contribution** (DEF) in a gameweek meets or exceeds the **position-specific threshold**. When achieved, we show a green-border badge on the DEF value in the GW points table.

## Official rules (2025/26)

Source: **Premier League** – [What's new in 2025/26 Fantasy: Defensive contributions](https://www.premierleague.com/en/news/4361991/whats-new-in-202526-fantasy-defensive-contributions)

| Position   | FPL `element_type` | Threshold | Notes |
|-----------|---------------------|-----------|--------|
| Goalkeeper | 1                   | **N/A**  | Goalkeepers cannot earn defensive contribution points. We use threshold 999 so the “defcon achieved” badge is never shown for GKs. |
| Defender   | 2                   | **10**   | 10 defensive contributions (CBIT: clearances, blocks, interceptions, tackles) in a match to earn 2 FPL points. |
| Midfielder | 3                   | **12**   | 12 defensive contributions (CBIRT: CBIT + ball recoveries) in a match to earn 2 FPL points. |
| Forward    | 4                   | **12**   | 12 defensive contributions (CBIRT) in a match to earn 2 FPL points. |

- **Defenders**: Count **CBIT** only (clearances, blocks, interceptions, tackles).
- **Midfielders & Forwards**: Count **CBIRT** (CBIT + ball recoveries). Recoveries are actions where the player wins possession and initiates a controlled pass or counter-attack.

Points are capped at **2 FPL points per match** for reaching the threshold, regardless of how many contributions above the threshold.

## Where these values live

- **Database**: `defcon_points_thresholds` (position, points_threshold).  
  Updated to official values in migration `018_defcon_official_thresholds.sql`; `016` seeds the same for new installs.
- **UI**: “Defcon achieved” is true when `defensive_contribution >= points_threshold` for that player’s position; the green border is shown only on the **DEF** column value.

## Example

- **Anderson** (midfielder): DEF 14 in a gameweek → 14 ≥ 12 → **defcon achieved** → green border on 14 in the DEF column.
- **Gabriel** (defender): DEF 6 → 6 &lt; 10 → **not achieved** → no defcon border.
- **O’Reilly** (defender): DEF 9 → 9 &lt; 10 → **not achieved** → no defcon border.
