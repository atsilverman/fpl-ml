/**
 * FPL free-transfer banking (2024/25+): up to 5 unused free transfers roll over; +1 each gameweek.
 * Wildcard / Free Hit reset the bank to 1 for the following gameweek.
 *
 * @see FPL_API_COMPLETE_REFERENCE.md — event_transfers_cost reflects banked FTs
 */

export const MAX_FPL_FREE_TRANSFER_BANK = 5

function isWildcardOrFreeHitChip(activeChip) {
  if (activeChip == null || activeChip === '') return false
  const c = String(activeChip).toLowerCase()
  return c === 'wildcard' || c === 'freehit'
}

/** When active_chip is missing but many zero-cost transfers, treat as WC/FH. */
function inferWildcardOrFreeHitFromStats(transfersMade, transferCost, activeChip) {
  if (transferCost !== 0 || transfersMade <= 2) return false
  if (isWildcardOrFreeHitChip(activeChip)) return false
  return true
}

/**
 * Free transfers available at the *start* of `targetGameweek` (before any moves that GW).
 *
 * @param {number} targetGameweek
 * @param {Array<{ gameweek: number, transfers_made?: number, transfer_cost?: number, active_chip?: string | null }>} priorRows
 *        Rows for gameweeks 1 .. targetGameweek - 1 only.
 */
export function freeTransfersAtStartOfGameweek(targetGameweek, priorRows) {
  if (targetGameweek <= 1) return 1

  const byGw = new Map()
  for (const r of priorRows) {
    const gw = Number(r.gameweek)
    if (!Number.isFinite(gw) || gw < 1 || gw >= targetGameweek) continue
    byGw.set(gw, r)
  }

  let bank = 1
  for (let g = 1; g < targetGameweek; g++) {
    const r = byGw.get(g)
    if (!r) {
      bank = Math.min(MAX_FPL_FREE_TRANSFER_BANK, bank + 1)
      continue
    }
    const T = r.transfers_made ?? 0
    const C = r.transfer_cost ?? 0
    const chip = r.active_chip
    if (isWildcardOrFreeHitChip(chip) || inferWildcardOrFreeHitFromStats(T, C, chip)) {
      bank = 1
      continue
    }
    const hits = Math.floor(C / 4)
    const freeUsed = Math.max(0, T - hits)
    const unused = Math.max(0, bank - freeUsed)
    bank = Math.min(MAX_FPL_FREE_TRANSFER_BANK, unused + 1)
  }
  return bank
}

/**
 * How many of this gameweek's transfers counted against the free-transfer allowance
 * (excludes hits — each hit is transfer_cost / 4).
 */
export function freeTransfersUsedThisGameweek(transfersMade, transferCost) {
  const hits = Math.floor((transferCost ?? 0) / 4)
  return Math.max(0, (transfersMade ?? 0) - hits)
}

export function remainingFreeTransfersAfterMoves(freeAtStart, transfersMade, transferCost) {
  const used = freeTransfersUsedThisGameweek(transfersMade, transferCost)
  return Math.max(0, (freeAtStart ?? 0) - used)
}
