# FPL API Update Timing Reference

This document tracks how long it takes for various FPL API attributes to update after games finish.

## Gameweek 23 (Jan 26, 2026)

### Timeline (PST)

| Event | Time (PST) | Time (UTC) | Duration from Game Finish |
|-------|------------|------------|---------------------------|
| **Last Game Finished** | ~2:00 PM | ~22:00 | - |
| **Fixtures Marked Finished** | ~3:00 PM | ~23:00 | ~1 hour |
| **Auto-Subs Activated** | 5:27 PM | 01:27 (Jan 27) | ~3 hours 27 minutes |
| **Data Checked = True** | ~7:58 AM (Jan 27) | ~15:58 (Jan 27) | ~18 hours (already True when monitoring started) |
| **Next GW Deadline Reached** | TBD | TBD | TBD |
| **Next GW Data Fully Updated** | TBD | TBD | TBD |

### Key Observations

- **Fixtures → Finished**: ~1 hour after last game ends
- **Fixtures → Finished Provisional**: Same time as finished (all fixtures marked together)
- **Auto-Subs**: ~3.5 hours after game finish (~2.5 hours after fixtures marked finished)
  - Auto-subs appear **before** `data_checked` becomes `True`
  - This suggests auto-subs are processed earlier in FPL's pipeline
- **Data Checked**: Monitoring attempted on Jan 27, 2026 at 7:58 AM PST, but `data_checked` was already `True` when monitoring started
  - Need to retry monitoring next week, starting **before** games finish to catch the transition from `False` → `True`
- **Next GW Data Update**: TBD (how long after next gameweek deadline before all new data is available)
  - Monitor for when new gameweek becomes `is_current = True`
  - Track when new fixtures, player prices, etc. are fully updated

### Duration Summary

- Game finish → Fixtures finished: **~1 hour**
- Game finish → Auto-subs: **~3 hours 27 minutes**
- Fixtures finished → Auto-subs: **~2 hours 27 minutes**
- Game finish → Data checked: **TBD** (monitoring started too late - was already True)
- Next GW deadline → All new data available: **TBD** (how long after deadline before all new GW data is fully updated)

---

## Future Gameweeks

_Add timing data for additional gameweeks below to build a reference database._

---

## Notes

- All times are in PST (Pacific Standard Time, UTC-8)
- Times are approximate based on monitoring intervals
- Auto-subs timing is specific to manager 344182 (Palmer → Kroupi substitution)
- **Monitoring Best Practice**: Start monitoring **before** games finish to catch all transitions. For Gameweek 23, monitoring started on Jan 27 at 7:58 AM PST but `data_checked` was already `True`, so we didn't capture the transition timing. **Will retry next week.**
- **HTTP Response Headers**: The monitoring script now captures HTTP response headers (`Last-Modified`, `ETag`, `Cache-Control`, `Date`) to check if FPL API provides metadata about when data was last updated. This could potentially help track update timing without continuous monitoring. **Note**: Need to verify if FPL API actually provides these headers - will check during next monitoring session.
- **Next GW Data Update**: After the deadline for the next gameweek passes, monitor how long it takes for:
  - New gameweek to become `is_current = True`
  - New fixtures to be available
  - Player prices to update
  - All new gameweek data to be fully populated
  - Typically takes 5-15 minutes after deadline
