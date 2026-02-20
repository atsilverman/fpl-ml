import { useState, useEffect, useMemo, useRef, useImperativeHandle, forwardRef } from 'react'
import { Info } from 'lucide-react'
import './ScheduleDifficultyCustomizer.css'

export const SCHEDULE_STAT_OPTIONS = [
  { id: 'strength', label: 'Overall', defaultKey: 'strength' },
  { id: 'attack', label: 'Attack', defaultKey: 'attackDefault' },
  { id: 'defence', label: 'Defence', defaultKey: 'defenceDefault' },
]

function shallowEqualKeys(a, b) {
  if (a == null && b == null) return true
  if (a == null || b == null) return false
  const ka = Object.keys(a).sort().join(',')
  const kb = Object.keys(b).sort().join(',')
  if (ka !== kb) return false
  for (const k of Object.keys(a)) {
    if (a[k] !== b[k]) return false
  }
  return true
}

const ScheduleDifficultyCustomizer = forwardRef(function ScheduleDifficultyCustomizer({
  teamIds,
  teamMap,
  savedOverridesByStat,
  onSave,
  onCancel,
  onResetStat,
  onDraftChange, // when set (wizard mode), called with (statId, overrides) when draft for that stat changes so parent can persist
  onHasChangesChange, // when set (embedded), called with (has: boolean) when draft differs from saved
  onHasOverridesChange, // when set (embedded), called with (has: boolean) when any stat has overrides (draft or saved) so parent can show Reset
  embedded = false,
  onlyStat = null, // when set ('strength'|'attack'|'defence'), show single stat only (wizard mode), no tabs, no Save in embedded
}, ref) {
  const [selectedStatId, setSelectedStatId] = useState(onlyStat || 'strength')
  const [baseline, setBaseline] = useState('fpl') // 'fpl' | 'calculated' (for Attack/Defence only)
  const [draftByStat, setDraftByStat] = useState(() => ({
    strength: { ...(savedOverridesByStat?.strength || {}) },
    attack: { ...(savedOverridesByStat?.attack || {}) },
    defence: { ...(savedOverridesByStat?.defence || {}) },
  }))

  useEffect(() => {
    setDraftByStat({
      strength: { ...(savedOverridesByStat?.strength || {}) },
      attack: { ...(savedOverridesByStat?.attack || {}) },
      defence: { ...(savedOverridesByStat?.defence || {}) },
    })
  }, [savedOverridesByStat?.strength, savedOverridesByStat?.attack, savedOverridesByStat?.defence])

  const effectiveStatId = onlyStat || selectedStatId
  useEffect(() => {
    if (onlyStat) setSelectedStatId(onlyStat)
  }, [onlyStat])

  const teams = useMemo(
    () => (teamIds || []).map((id) => ({ team_id: id, ...(teamMap || {})[id] })).filter((t) => t.team_id != null),
    [teamIds, teamMap]
  )

  const draft = draftByStat[effectiveStatId] || {}
  const opt = SCHEDULE_STAT_OPTIONS.find((o) => o.id === effectiveStatId)
  const baseKey = opt?.defaultKey ?? 'strength'
  const effectiveDefaultKey =
    effectiveStatId === 'attack' && baseline === 'calculated'
      ? 'calculatedAttackDefault'
      : effectiveStatId === 'defence' && baseline === 'calculated'
        ? 'calculatedDefenceDefault'
        : baseKey

  const getEffectiveValue = (teamId, apiValue) => {
    const v = draft[String(teamId)] ?? draft[teamId]
    return v != null ? Math.min(5, Math.max(1, Number(v))) : (apiValue != null ? Math.min(5, Math.max(1, apiValue)) : 3)
  }

  const handleChange = (teamId, value) => {
    const num = Math.min(5, Math.max(1, Number(value)))
    const apiValue = teamMap?.[teamId]?.[effectiveDefaultKey] ?? teamMap?.[teamId]?.strength
    const next = { ...draft }
    if (apiValue != null && num === Math.min(5, Math.max(1, apiValue))) {
      delete next[String(teamId)]
      delete next[teamId]
    } else {
      next[teamId] = num
    }
    const nextDraft = Object.keys(next).length ? next : {}
    setDraftByStat((prev) => {
      const nextState = { ...prev, [effectiveStatId]: nextDraft }
      onDraftChange?.(effectiveStatId, nextDraft)
      return nextState
    })
  }

  const baselineLabel = baseline === 'calculated' ? 'Calculated' : 'FPL'
  const handleResetCurrent = () => {
    onResetStat?.(effectiveStatId)
    setDraftByStat((prev) => {
      const nextState = { ...prev, [effectiveStatId]: {} }
      onDraftChange?.(effectiveStatId, {})
      return nextState
    })
  }

  const handleSave = () => {
    onSave?.({
      strength: draftByStat.strength,
      attack: draftByStat.attack,
      defence: draftByStat.defence,
    })
  }

  const hasUnsavedChanges = useMemo(() => {
    const saved = savedOverridesByStat || {}
    return (
      !shallowEqualKeys(draftByStat.strength, saved.strength ?? null) ||
      !shallowEqualKeys(draftByStat.attack, saved.attack ?? null) ||
      !shallowEqualKeys(draftByStat.defence, saved.defence ?? null)
    )
  }, [draftByStat.strength, draftByStat.attack, draftByStat.defence, savedOverridesByStat])

  const savedForCurrent = savedOverridesByStat?.[effectiveStatId] ?? {}
  const hasResetable = Object.keys(draft).length > 0 || Object.keys(savedForCurrent).length > 0

  const hasAnyOverrides = useMemo(() => {
    const s = savedOverridesByStat || {}
    const d = draftByStat || {}
    const has = (obj) => obj && Object.keys(obj).length > 0
    return has(d.strength) || has(d.attack) || has(d.defence) || has(s.strength) || has(s.attack) || has(s.defence)
  }, [draftByStat.strength, draftByStat.attack, draftByStat.defence, savedOverridesByStat?.strength, savedOverridesByStat?.attack, savedOverridesByStat?.defence])

  useEffect(() => {
    onHasOverridesChange?.(hasAnyOverrides)
  }, [hasAnyOverrides, onHasOverridesChange])

  const handleResetAll = () => {
    onResetStat?.('strength')
    onResetStat?.('attack')
    onResetStat?.('defence')
    setDraftByStat({
      strength: {},
      attack: {},
      defence: {},
    })
    onHasOverridesChange?.(false)
  }

  useImperativeHandle(ref, () => ({
    save: handleSave,
    resetAll: handleResetAll,
    hasUnsavedChanges: () => hasUnsavedChanges,
  }), [hasUnsavedChanges, draftByStat.strength, draftByStat.attack, draftByStat.defence])

  useEffect(() => {
    onHasChangesChange?.(hasUnsavedChanges)
  }, [hasUnsavedChanges, onHasChangesChange])

  const tabsAndList = (
    <>
      {!onlyStat && (
        <div className="schedule-customizer-stat-tabs">
          {SCHEDULE_STAT_OPTIONS.map((optItem) => (
            <button
              key={optItem.id}
              type="button"
              className={`schedule-customizer-stat-tab ${selectedStatId === optItem.id ? 'schedule-customizer-stat-tab--active' : ''}`}
              onClick={() => setSelectedStatId(optItem.id)}
              aria-pressed={selectedStatId === optItem.id}
            >
              {optItem.label}
            </button>
          ))}
        </div>
      )}
      <div className="schedule-customizer-body">
        <div className="schedule-customizer-description-row">
          <p className="schedule-customizer-description">
            1 = easiest, 5 = hardest.
          </p>
          {(effectiveStatId === 'attack' || effectiveStatId === 'defence') && (
            <div className="schedule-customizer-baseline">
              <span className="schedule-customizer-baseline-label">Baseline:</span>
              <button
                type="button"
                className={`schedule-customizer-baseline-btn ${baseline === 'fpl' ? 'schedule-customizer-baseline-btn--active' : ''}`}
                onClick={() => setBaseline('fpl')}
                aria-pressed={baseline === 'fpl'}
              >
                FPL
              </button>
              <button
                type="button"
                className={`schedule-customizer-baseline-btn ${baseline === 'calculated' ? 'schedule-customizer-baseline-btn--active' : ''}`}
                onClick={() => setBaseline('calculated')}
                aria-pressed={baseline === 'calculated'}
              >
                Calculated
              </button>
            </div>
          )}
          <button
            type="button"
            className="schedule-customizer-reset"
            onClick={handleResetCurrent}
            title={`Reset ${effectiveStatId === 'strength' ? 'overall' : effectiveStatId} to ${baselineLabel} defaults`}
            aria-label={`Reset ${effectiveStatId === 'strength' ? 'overall' : effectiveStatId} to ${baselineLabel} defaults`}
          >
            Reset
          </button>
        </div>
        <div className="schedule-customizer-list">
          {teams.map((team) => {
            const apiValue = team[effectiveDefaultKey] ?? team.strength
            const defaultNum = apiValue != null ? Math.min(5, Math.max(1, apiValue)) : 3
            const effective = getEffectiveValue(team.team_id, apiValue)
            /* 0–1 fraction so CSS can align ghost with native thumb range (thumb is inset by half-width) */
            const ghostFraction = (defaultNum - 1) / 4
            const shortName = team.short_name ?? ''
            return (
              <div key={team.team_id} className="schedule-customizer-row">
                {shortName ? (
                  <img
                    src={`/badges/${shortName}.svg`}
                    alt=""
                    className="schedule-customizer-badge"
                    title={team.team_name ?? shortName}
                    onError={(e) => { e.target.style.display = 'none' }}
                  />
                ) : (
                  <span className="schedule-customizer-badge schedule-customizer-badge-placeholder" aria-hidden />
                )}
                <div
                  className="schedule-customizer-slider-wrap"
                  style={{ '--ghost-pct': ghostFraction }}
                >
                  <span className="schedule-customizer-ghost-dot" aria-hidden />
                  <input
                    type="range"
                    min={1}
                    max={5}
                    value={effective}
                    onChange={(e) => handleChange(team.team_id, e.target.value)}
                    className={`schedule-customizer-slider schedule-customizer-slider--${effective}`}
                    aria-label={`${team.team_name ?? shortName ?? 'Team'} difficulty ${effective}`}
                  />
                </div>
                <span className={`schedule-customizer-value-pill schedule-customizer-value-pill--${effective}`}>
                  {effective}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </>
  )

  const [showLegendPopup, setShowLegendPopup] = useState(false)
  const legendPopupRef = useRef(null)
  const legendTriggerRef = useRef(null)

  useEffect(() => {
    if (!showLegendPopup) return
    const handleClickOutside = (e) => {
      if (
        legendPopupRef.current?.contains(e.target) ||
        legendTriggerRef.current?.contains(e.target)
      ) return
      setShowLegendPopup(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showLegendPopup])

  if (embedded) {
    return (
      <>
        <div className="customize-difficulty-toolbar">
          {!onlyStat && (
            <div className="schedule-customizer-stat-tabs">
              {SCHEDULE_STAT_OPTIONS.map((optItem) => (
                <button
                  key={optItem.id}
                  type="button"
                  className={`schedule-customizer-stat-tab ${selectedStatId === optItem.id ? 'schedule-customizer-stat-tab--active' : ''}`}
                  onClick={() => setSelectedStatId(optItem.id)}
                  aria-pressed={selectedStatId === optItem.id}
                >
                  {optItem.label}
                </button>
              ))}
            </div>
          )}
          <div className="customize-difficulty-toolbar-actions" ref={legendPopupRef}>
            <button
              type="button"
              ref={legendTriggerRef}
              className="schedule-legend-info-btn"
              onClick={() => setShowLegendPopup((v) => !v)}
              aria-label="Difficulty scale: 1 easiest, 5 hardest"
              aria-expanded={showLegendPopup}
              title="Difficulty scale"
            >
              <Info size={16} strokeWidth={2} />
            </button>
            {showLegendPopup && (
              <div className="schedule-legend-popover" role="dialog" aria-label="Difficulty scale">
                <div className="schedule-legend-inline schedule-legend-inline--popup" aria-hidden>
                  <div className="schedule-legend-inline-pills">
                    {[1, 2, 3, 4, 5].map((d) => (
                      <span key={d} className={`schedule-cell-difficulty-pill schedule-cell-difficulty-pill--${d} schedule-legend-inline-pill`}>
                        <span className="schedule-cell-abbr-display">{d}</span>
                      </span>
                    ))}
                  </div>
                  <span className="schedule-legend-inline-label">Difficulty: Easy → Hard</span>
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="customize-rows">
          {teams.map((team) => {
            const apiValue = team[effectiveDefaultKey] ?? team.strength
            const defaultNum = apiValue != null ? Math.min(5, Math.max(1, apiValue)) : 3
            const effective = getEffectiveValue(team.team_id, apiValue)
            /* 0–1 fraction so CSS can align ghost with native thumb range (thumb is inset by half-width) */
            const ghostFraction = (defaultNum - 1) / 4
            const shortName = team.short_name ?? ''
            return (
              <div key={team.team_id} className="customize-row customize-difficulty-row">
                {shortName ? (
                  <img
                    src={`/badges/${shortName}.svg`}
                    alt=""
                    className="customize-difficulty-badge"
                    title={team.team_name ?? shortName}
                    onError={(e) => { e.target.style.display = 'none' }}
                  />
                ) : (
                  <span className="customize-difficulty-badge customize-difficulty-badge-placeholder" aria-hidden />
                )}
                <div
                  className="customize-difficulty-slider-wrap"
                  style={{ '--ghost-pct': ghostFraction }}
                >
                  <span className="customize-difficulty-ghost-dot" aria-hidden />
                  <input
                    type="range"
                    min={1}
                    max={5}
                    value={effective}
                    onChange={(e) => handleChange(team.team_id, e.target.value)}
                    className={`customize-difficulty-slider customize-difficulty-slider--${effective}`}
                    aria-label={`${team.team_name ?? shortName ?? 'Team'} difficulty ${effective}`}
                  />
                </div>
                <span className={`customize-difficulty-pill customize-difficulty-pill--${effective}`}>
                  {effective}
                </span>
              </div>
            )
          })}
        </div>
        {/* Save is rendered in overlay footer when embedded (ScheduleSubpage) */}
      </>
    )
  }

  return (
    <div className="schedule-customizer-panel" onClick={(e) => e.stopPropagation()}>
      <div className="schedule-customizer-header">
        <h2 className="schedule-customizer-title">Customize difficulty</h2>
        <button type="button" className="schedule-customizer-close" onClick={onCancel} aria-label="Close">
          ×
        </button>
      </div>
      {tabsAndList}
      <div className="schedule-customizer-footer">
        <button type="button" className="schedule-customizer-btn schedule-customizer-btn--cancel" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="schedule-customizer-btn schedule-customizer-btn--save" onClick={handleSave}>
          Save
        </button>
      </div>
    </div>
  )
})

export default ScheduleDifficultyCustomizer
