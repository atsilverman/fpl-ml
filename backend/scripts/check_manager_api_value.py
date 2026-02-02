#!/usr/bin/env python3
"""
Fetch manager 344182 from FPL API and print team value fields (entry + history).

Shows what the API returns for last_deadline_value/bank (entry) and value/bank (history)
so we can debug why team value isn't updating in the DB.

Usage:
    python3 backend/scripts/check_manager_api_value.py [MANAGER_ID]
    Default MANAGER_ID=344182. No backend deps; uses httpx only.
"""

import sys
import httpx

FPL_BASE = "https://fantasy.premierleague.com/api"


def main():
    manager_id = int(sys.argv[1]) if len(sys.argv) > 1 else 344182
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        "Accept": "application/json",
    }

    print(f"Manager ID: {manager_id}\n")

    with httpx.Client(base_url=FPL_BASE, headers=headers, timeout=30.0) as client:
        # 1) Entry endpoint (last_deadline_value / last_deadline_bank)
        r = client.get(f"/entry/{manager_id}/")
        r.raise_for_status()
        entry = r.json()
        print("=== GET /entry/{}/ ===".format(manager_id))
        print("last_deadline_value:", entry.get("last_deadline_value"))
        print("last_deadline_bank:", entry.get("last_deadline_bank"))
        print("current_event:", entry.get("current_event"))
        if entry.get("last_deadline_value") is not None:
            print("  -> team value (display):", entry["last_deadline_value"] / 10)
        if entry.get("last_deadline_bank") is not None:
            print("  -> bank (display):", entry["last_deadline_bank"] / 10)
        print()

        # 2) History endpoint (value / bank per gameweek)
        r2 = client.get(f"/entry/{manager_id}/history/")
        r2.raise_for_status()
        history = r2.json()
        current = history.get("current") or []
        print("=== GET /entry/{}/history/ (current array, last 3 GWs) ===".format(manager_id))
        for h in current[-3:]:
            gw = h.get("event")
            v = h.get("value")
            b = h.get("bank")
            disp = (v / 10) if v is not None else "N/A"
            print(f"  GW{gw}: value={v}, bank={b}  -> team value display: {disp}")
        print()

        if current:
            last_gw = current[-1]
            gw_num = last_gw.get("event")
            print(f"Latest GW in history: {gw_num}")
            print(f"  value: {last_gw.get('value')}, bank: {last_gw.get('bank')}")
        print()

        print("Entry keys:", list(entry.keys()))
        if current:
            print("History current[0] keys:", list(current[0].keys()))


if __name__ == "__main__":
    main()
