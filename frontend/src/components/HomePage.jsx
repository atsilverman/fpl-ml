import { useState, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useOutletContext } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useGameweekData } from '../hooks/useGameweekData'
import { useManagerData } from '../hooks/useManagerData'
import { useTotalManagers, getGwRankPercentileLabel } from '../hooks/useTotalManagers'
import { useManagerHistory } from '../hooks/useManagerHistory'
import { useTeamValueHistory } from '../hooks/useTeamValueHistory'
import { useLeagueTeamValueHistory } from '../hooks/useLeagueTeamValueHistory'
import { useChipUsage } from '../hooks/useChipUsage'
import { useLiveGameweekStatus } from '../hooks/useLiveGameweekStatus'
import { useManagerLiveStatus } from '../hooks/useManagerLiveStatus'
import { usePlayerOwnedPerformance } from '../hooks/usePlayerOwnedPerformance'
import { useCurrentGameweekPlayers } from '../hooks/useCurrentGameweekPlayers'
import { useFPLFixturesForMatchState } from '../hooks/useFPLFixturesForMatchState'
import { useFixturesWithTeams } from '../hooks/useFixturesWithTeams'
import { useGameweekTop10ByStat } from '../hooks/useGameweekTop10ByStat'
import { usePlayerImpact } from '../hooks/usePlayerImpact'
import { useTransferImpacts } from '../hooks/useTransferImpacts'
import { useLeagueTopTransfers } from '../hooks/useLeagueTopTransfers'
import { useLeagueChipUsage } from '../hooks/useLeagueChipUsage'
import { useMiniLeagueStandings } from '../hooks/useMiniLeagueStandings'
import { useLeagueTop10History } from '../hooks/useLeagueTop10History'
import { useLeagueCaptainPicks } from '../hooks/useLeagueCaptainPicks'
import { useLeagueManagerLiveStatus } from '../hooks/useLeagueManagerLiveStatus'
import { useRefreshState } from '../hooks/useRefreshState'
import { useConfiguration } from '../contexts/ConfigurationContext'
import { RefreshCcw } from 'lucide-react'
import { useBentoOrder } from '../contexts/BentoOrderContext'
import { supabase } from '../lib/supabase'
import BentoCard from './BentoCard'
import PlayerDetailModal from './PlayerDetailModal'
import PlayerBreakdownPopup from './PlayerBreakdownPopup'
import './MiniLeaguePage.css'
import PriceChangesBentoHome from './PriceChangesBentoHome'
import { formatNumber, formatNumberWithTwoDecimals, formatPrice } from '../utils/formatNumbers'
import './HomePage.css'

export default function HomePage() {
  const { config, openConfigModal } = useConfiguration()
  const { cardOrder, openCustomizeModal, isCardVisible, cardVisibility } = useBentoOrder()
  const { openDebugModal } = useOutletContext()
  
  // State declarations (must be before hooks that use them)
  const [chartFilter, setChartFilter] = useState('last12') // 'all', 'last12', 'last6'
  const [showChartComparison, setShowChartComparison] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const [isPerformanceExpanded, setIsPerformanceExpanded] = useState(false)
  const [isPlayerPerformanceExpanded, setIsPlayerPerformanceExpanded] = useState(false)
  const [playerPerformanceChartFilter, setPlayerPerformanceChartFilter] = useState('last12') // 'all', 'last12', 'last6'
  const [playerChartExcludeHaaland, setPlayerChartExcludeHaaland] = useState(false)
  const [teamValueChartFilter, setTeamValueChartFilter] = useState('last12') // 'all', 'last12', 'last6'
  const [showTeamValueComparison, setShowTeamValueComparison] = useState(false)
  const [isTeamValueExpanded, setIsTeamValueExpanded] = useState(false)
  const [isGwPointsExpanded, setIsGwPointsExpanded] = useState(false)
  const [isTransfersExpanded, setIsTransfersExpanded] = useState(false)
  const [isChipsExpanded, setIsChipsExpanded] = useState(false)
  const [showTop10Lines, setShowTop10Lines] = useState(false)
  const [selectedPlayerId, setSelectedPlayerId] = useState(null)
  const [selectedPlayerName, setSelectedPlayerName] = useState('')
  const [breakdownPlayer, setBreakdownPlayer] = useState(null)
  
  // Hooks that depend on state
  const { gameweek, gwFinished, loading: gwLoading } = useGameweekData()
  const { managerData, loading: managerLoading } = useManagerData()
  const { totalManagers } = useTotalManagers()
  const { historyData, loading: historyLoading } = useManagerHistory()
  const { historyData: teamValueHistoryData, loading: teamValueHistoryLoading } = useTeamValueHistory()
  const { leagueData: leagueTeamValueData, loading: leagueTeamValueLoading } = useLeagueTeamValueHistory()
  const { chipUsage, loading: chipLoading } = useChipUsage()
  const { hasLiveGames } = useLiveGameweekStatus(gameweek)
  const { inPlay: managerInPlay } = useManagerLiveStatus(config?.managerId ?? null, gameweek)
  const hasManagerPlayerInPlay = hasLiveGames && (managerInPlay ?? 0) > 0
  const { playerData, pointsByGameweek: playerPointsByGameweek, loading: playerPerformanceLoading } = usePlayerOwnedPerformance(playerPerformanceChartFilter, 'total_points')
  const { data: currentGameweekPlayers, fixtures: currentGameweekFixtures, isLoading: currentGameweekPlayersLoading } = useCurrentGameweekPlayers()
  const { fixtures: fplFixturesForMatchState } = useFPLFixturesForMatchState(gameweek ?? null, isGwPointsExpanded)
  const { fixtures: fixturesFromMatches } = useFixturesWithTeams(gameweek ?? null)
  const { top10ByStat, isLoading: top10ByStatLoading } = useGameweekTop10ByStat()
  const { impactByPlayerId, loading: impactLoading } = usePlayerImpact()
  const { transfers: transferImpacts, loading: transferImpactsLoading } = useTransferImpacts(gameweek)

  // Fetch league name and league top transfers (for expanded Transfers card)
  const LEAGUE_ID = config?.leagueId || import.meta.env.VITE_LEAGUE_ID || null
  const { transfersOut: leagueTopTransfersOut, transfersIn: leagueTopTransfersIn, loading: leagueTopTransfersLoading } = useLeagueTopTransfers(LEAGUE_ID, gameweek)
  const { leagueChipData, loading: leagueChipsLoading } = useLeagueChipUsage(gameweek)
  const { standings: leagueStandings, loading: leagueStandingsLoading } = useMiniLeagueStandings(gameweek)
  const leagueManagerCount = leagueStandings?.length ?? 0
  const leagueManagerIds = useMemo(() => (leagueStandings ?? []).map((s) => s.manager_id), [leagueStandings])
  const { top10History, loading: leagueTop10HistoryLoading } = useLeagueTop10History(gameweek ?? undefined)
  const { leagueCaptainData, loading: leagueCaptainLoading } = useLeagueCaptainPicks(gameweek)
  const { liveStatusByManager } = useLeagueManagerLiveStatus(LEAGUE_ID, gameweek)
  const hasAnyLeagueManagerPlayerInPlay = hasLiveGames && Object.values(liveStatusByManager ?? {}).some((s) => (s?.in_play ?? 0) > 0)
  const { state: refreshState, stateLabel: refreshStateLabel } = useRefreshState()

  const { data: nextGameweek } = useQuery({
    queryKey: ['gameweek', 'next'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('gameweeks')
        .select('id, name, deadline_time')
        .eq('is_next', true)
        .single()
      if (error) return null
      return data
    },
    staleTime: 5 * 60 * 1000,
  })

  const nextDeadlineGwLabel = useMemo(() => {
    if (!nextGameweek) return ''
    const name = nextGameweek.name?.trim()
    if (name) return name
    if (nextGameweek.id != null) return `Gameweek ${nextGameweek.id}`
    return ''
  }, [nextGameweek?.name, nextGameweek?.id])

  const nextDeadlineLocal = useMemo(() => {
    const iso = nextGameweek?.deadline_time
    if (!iso) return null
    try {
      const d = new Date(iso.replace('Z', '+00:00'))
      return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    } catch {
      return null
    }
  }, [nextGameweek?.deadline_time])

  // Game updating banner: FPL Updating (waiting on flip) or GW Setup (our batch running before first kickoff)
  const showGameUpdatingBanner = refreshState === 'fpl_updating' || refreshState === 'gw_setup'

  // GW total from starting XI (same source as expanded table: contributedPoints with auto-subs, minus transfer cost)
  const gwPointsFromPlayers = useMemo(() => {
    if (!currentGameweekPlayers?.length) return null
    const starters = currentGameweekPlayers.filter((p) => p.position >= 1 && p.position <= 11)
    let total = starters.reduce((sum, p) => sum + (p.contributedPoints ?? 0), 0)
    const subbedOutRows = currentGameweekPlayers.filter((p) => p.was_auto_subbed_out)
    const subbedInRows = currentGameweekPlayers.filter((p) => p.was_auto_subbed_in)
    if (subbedOutRows.length && subbedInRows.length) {
      total = total - subbedOutRows.reduce((s, p) => s + (p.contributedPoints ?? 0), 0) + subbedInRows.reduce((s, p) => s + (p.contributedPoints ?? 0), 0)
    }
    const transferCost = managerData?.transferCost ?? 0
    return total - transferCost
  }, [currentGameweekPlayers, managerData?.transferCost])

  // Total points in sync with GW points: previous GW total + this GW from players (same data source)
  const totalPointsFromPlayers = useMemo(() => {
    if (gwPointsFromPlayers == null) return null
    const prevTotal = managerData?.previousGameweekTotalPoints ?? 0
    return prevTotal + gwPointsFromPlayers
  }, [gwPointsFromPlayers, managerData?.previousGameweekTotalPoints])

  const { data: leagueData } = useQuery({
    queryKey: ['league', LEAGUE_ID],
    queryFn: async () => {
      if (!LEAGUE_ID) return null
      const { data, error } = await supabase
        .from('mini_leagues')
        .select('league_name')
        .eq('league_id', LEAGUE_ID)
        .single()
      if (error) return null
      return data
    },
    enabled: !!LEAGUE_ID,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes (league names don't change often)
  })
  // Detect mobile viewport
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth <= 768)
    }
    
    checkMobile()
    window.addEventListener('resize', checkMobile)
    
    return () => {
      window.removeEventListener('resize', checkMobile)
    }
  }, [])

  // Reorder cards for mobile: league-rank before chips
  const displayCardOrder = useMemo(() => {
    if (!isMobile) return cardOrder
    
    const chipsIndex = cardOrder.indexOf('chips')
    const leagueRankIndex = cardOrder.indexOf('league-rank')
    
    if (chipsIndex === -1 || leagueRankIndex === -1) return cardOrder
    
    // If league-rank comes after chips, swap their positions
    if (leagueRankIndex > chipsIndex) {
      const reordered = [...cardOrder]
      reordered[chipsIndex] = 'league-rank'
      reordered[leagueRankIndex] = 'chips'
      return reordered
    }
    
    return cardOrder
  }, [cardOrder, isMobile])

  // Only show cards that are turned on in Customize
  const visibleCardOrder = useMemo(
    () => displayCardOrder.filter((id) => isCardVisible(id)),
    [displayCardOrder, cardVisibility]
  )

  /* Sequential delay per card so bentos trickle in left-to-right, top-to-bottom */
  const bentoAnimationDelays = useMemo(() => {
    const staggerMs = 90
    return Object.fromEntries(
      visibleCardOrder.map((id, index) => [id, index * staggerMs])
    )
  }, [visibleCardOrder])

  const loading = gwLoading || managerLoading || historyLoading || chipLoading || playerPerformanceLoading || teamValueHistoryLoading || leagueTeamValueLoading || leagueTop10HistoryLoading || currentGameweekPlayersLoading || top10ByStatLoading || impactLoading || transferImpactsLoading

  const cards = [
    {
      id: 'overall-rank',
      label: 'Overall Rank',
      value: formatNumber(managerData?.overallRank),
      change: managerData?.overallRankChange || 0,
      size: '1x1'
    },
    {
      id: 'gw-rank',
      label: 'GW Rank',
      value: showGameUpdatingBanner ? '—' : formatNumberWithTwoDecimals(managerData?.gameweekRank),
      subtext: showGameUpdatingBanner
        ? undefined
        : getGwRankPercentileLabel(managerData?.gameweekRank ?? null, totalManagers ?? null),
      size: '1x1'
    },
    {
      id: 'total-points',
      label: 'Total Points',
      value: totalPointsFromPlayers != null
        ? totalPointsFromPlayers.toLocaleString('en-GB')
        : managerData?.totalPoints != null
          ? managerData.totalPoints.toLocaleString('en-GB')
          : '—',
      size: '1x1'
    },
    {
      id: 'gw-points',
      label: 'GW Points',
      value: showGameUpdatingBanner
        ? '—'
        : gwPointsFromPlayers != null
          ? formatNumber(gwPointsFromPlayers)
          : formatNumber(managerData?.gameweekPoints),
      subtext: `Gameweek ${gameweek}`,
      size: '1x1'
    },
    {
      id: 'team-value',
      label: 'Team Value',
      value: formatPrice(managerData?.teamValue),
      subtext: managerData?.teamValue && managerData?.bankValue
        ? (() => {
            const teamValueNum = parseFloat(managerData.teamValue)
            const bankValueNum = parseFloat(managerData.bankValue)
            const playerValueNum = teamValueNum - bankValueNum
            return `${formatPrice(playerValueNum)} + ${formatPrice(bankValueNum)} bank`
          })()
        : undefined,
      size: '1x1'
    },
    {
      id: 'chips',
      label: 'Chips',
      size: '1x1',
      isChips: true
    },
    {
      id: 'transfers',
      label: 'Transfers',
      value: showGameUpdatingBanner
        ? '—'
        : managerData != null
          ? (managerData.activeChip === 'wildcard' || managerData.activeChip === 'freehit')
            ? '—'
            : `${managerData.transfersMade} of ${managerData.freeTransfersAvailable}`
          : undefined,
      size: '1x1',
      isTransfers: true
    },
    {
      id: 'league-rank',
      label: 'League Rank',
      value: managerData?.leagueRank != null 
        ? formatNumber(managerData.leagueRank)
        : '—',
      change: managerData?.leagueRank != null ? (managerData?.leagueRankChange || 0) : undefined,
      size: '1x1'
    },
    {
      id: 'captain',
      label: 'Captains',
      size: '1x1'
    },
    {
      id: 'price-changes',
      label: 'Price Changes',
      size: '2x2'
    },
    {
      id: 'settings',
      label: 'Settings',
      size: '2x1',
      isSettings: true
    }
  ]

  const getCardClassName = (id) => {
    const card = cards.find(c => c.id === id)
    if (!card) return ''
    
    // Transform overall-rank to 3-wide × 3 rows when expanded (desktop)
    if (id === 'overall-rank' && isPerformanceExpanded) {
      return 'bento-card-chart-large bento-card-overall-rank-expanded'
    }
    
    // Transform team-value to 2x3 when expanded
    if (id === 'team-value' && isTeamValueExpanded) {
      return 'bento-card-chart-large'
    }
    
    // Transform total-points to 2x3 when expanded
    if (id === 'total-points' && isPlayerPerformanceExpanded) {
      return 'bento-card-chart-large'
    }
    
    // GW points card 2x4 when expanded, 1x1 when collapsed
    if (id === 'gw-points' && isGwPointsExpanded) {
      return 'bento-card-chart-2x4'
    }
    
    // Transfers card: 2x1 when there's something to show (transfers, wildcard/free hit, or list from picks diff); else 1x1 (no expand)
    if (id === 'transfers') {
      const hasTransfers = (managerData?.transfersMade ?? 0) > 0
      const usedWildcardOrFreeHit = managerData?.activeChip === 'wildcard' || managerData?.activeChip === 'freehit'
      const hasTransferList = (transferImpacts?.length ?? 0) > 0
      return (hasTransfers || usedWildcardOrFreeHit || hasTransferList) ? 'bento-card-large' : 'bento-card'
    }

    // Chips card 2x3 when expanded
    if (id === 'chips' && isChipsExpanded) {
      return 'bento-card-chart-large'
    }

    // Price Changes: always 2x2, no expand
    if (id === 'price-changes') {
      return 'bento-card-2x2'
    }

    if (card.size === '2x3') return 'bento-card-chart-large'
    if (card.size === '2x1') return 'bento-card-large'
    if (id === 'chips') return 'bento-card-chips'
    return 'bento-card'
  }

  const handleConfigureClick = () => {
    openCustomizeModal()
  }

  const handleChartFilterChange = (newFilter) => {
    setChartFilter(newFilter)
  }

  const handleExpandClick = () => {
    setChartFilter('all') // Default to "All" when expanding
    setIsPerformanceExpanded(true)
  }

  const handleCollapseClick = () => {
    setIsPerformanceExpanded(false)
  }

  const handlePlayerPerformanceExpand = () => {
    setPlayerPerformanceChartFilter('all') // Default to "All" when expanding
    setIsPlayerPerformanceExpanded(true)
  }

  const handlePlayerPerformanceCollapse = () => {
    setIsPlayerPerformanceExpanded(false)
  }

  const handlePlayerPerformanceChartFilterChange = (newFilter) => {
    setPlayerPerformanceChartFilter(newFilter)
  }

  const handleTeamValueExpandClick = () => {
    setTeamValueChartFilter('all') // Default to "All" when expanding
    setIsTeamValueExpanded(true)
  }

  const handleTeamValueCollapseClick = () => {
    setIsTeamValueExpanded(false)
  }

  const handleTeamValueChartFilterChange = (newFilter) => {
    setTeamValueChartFilter(newFilter)
  }

  const handleGwPointsExpandClick = () => {
    setIsGwPointsExpanded(true)
  }

  const handleGwPointsCollapseClick = () => {
    setIsGwPointsExpanded(false)
  }

  const handleTransfersExpandClick = () => {
    setIsTransfersExpanded(true)
  }

  const handleTransfersCollapseClick = () => {
    setIsTransfersExpanded(false)
  }

  const handleChipsExpandClick = () => {
    setIsChipsExpanded(true)
  }

  const handleChipsCollapseClick = () => {
    setIsChipsExpanded(false)
  }

  return (
    <div className="home-page">
      {showGameUpdatingBanner && (
        <div className="home-page-deadline-banner" aria-live="polite">
          <RefreshCcw className="home-page-deadline-banner-icon" size={18} />
          <span>Leagues and Managers Updating</span>
        </div>
      )}
      {!showGameUpdatingBanner && nextDeadlineLocal && (
        <p className="home-page-next-deadline">
          Next deadline: {nextDeadlineGwLabel && `${nextDeadlineGwLabel} `}{nextDeadlineLocal}
        </p>
      )}
      <div className="bento-grid">
        {visibleCardOrder.map((cardId, index) => {
          const card = cards.find(c => c.id === cardId)
          if (!card) return null

          if (cardId === 'price-changes') {
            return (
              <PriceChangesBentoHome
                key="price-changes"
                className={getCardClassName(cardId)}
                style={{ '--animation-delay': `${bentoAnimationDelays[cardId] ?? 0}ms` }}
              />
            )
          }

          // Transform overall-rank card when expanded
          const isOverallRankExpanded = cardId === 'overall-rank' && isPerformanceExpanded
          const showChartInOverallRank = isOverallRankExpanded
          const showValueInOverallRank = !isOverallRankExpanded

          // Transform team-value card when expanded
          const isTeamValueExpandedCard = cardId === 'team-value' && isTeamValueExpanded
          const showChartInTeamValue = isTeamValueExpandedCard
          const showValueInTeamValue = !isTeamValueExpandedCard

          // Transform total-points card when expanded
          const isTotalPointsExpanded = cardId === 'total-points' && isPlayerPerformanceExpanded
          const showValueInTotalPoints = !isTotalPointsExpanded

          // Transform gw-points card when expanded
          const isGwPointsExpandedCard = cardId === 'gw-points' && isGwPointsExpanded
          const showValueInGwPoints = !isGwPointsExpandedCard

          // Determine if this card should show value or chart
          let showValue = card.value
          let showChange = card.change
          let showChart = false
          let chartDataToUse = null
          let chartComparisonDataToUse = null
          let chartFilterToUse = 'all'
          let showChartComparisonToUse = false
          let onChartFilterChangeToUse = null
          let playerChartDataToUse = null
          let playerChartFilterToUse = 'all'
          let playerChartStatKeyToUse = 'total_points'
          let onPlayerChartFilterChangeToUse = null
          let onPlayerChartStatChangeToUse = null
          let playerChartExcludeHaalandToUse = undefined
          let onPlayerChartExcludeHaalandChangeToUse = undefined
          let playerChartHideFilterControlsToUse = false
          let currentGameweekPlayersDataToUse = null
          let gameweekFixturesFromPlayersToUse = null
          let gameweekFixturesFromFPLToUse = null
          let gameweekFixturesFromMatchesToUse = null
          let showTop10LinesToUse = false
          let top10LinesDataToUse = null
          let onShowTop10ChangeToUse = null

          if (cardId === 'overall-rank') {
            showValue = showValueInOverallRank ? card.value : undefined
            showChange = showValueInOverallRank ? card.change : undefined
            showChart = showChartInOverallRank
            chartDataToUse = showChartInOverallRank ? historyData : null
            chartFilterToUse = chartFilter
            showChartComparisonToUse = showChartComparison
            onChartFilterChangeToUse = showChartInOverallRank ? handleChartFilterChange : null
            showTop10LinesToUse = showChartInOverallRank ? showTop10Lines : false
            top10LinesDataToUse = showChartInOverallRank ? top10History : null
            onShowTop10ChangeToUse = showChartInOverallRank ? () => setShowTop10Lines((prev) => !prev) : null
          } else if (cardId === 'team-value') {
            showValue = showValueInTeamValue ? card.value : undefined
            showChange = showValueInTeamValue ? card.change : undefined
            showChart = showChartInTeamValue
            chartDataToUse = showChartInTeamValue ? teamValueHistoryData : null
            chartComparisonDataToUse = showChartInTeamValue && showTeamValueComparison ? leagueTeamValueData : null
            chartFilterToUse = teamValueChartFilter
            showChartComparisonToUse = showTeamValueComparison
            onChartFilterChangeToUse = showChartInTeamValue ? handleTeamValueChartFilterChange : null
          } else if (cardId === 'total-points') {
            showValue = showValueInTotalPoints ? card.value : undefined
            showChange = showValueInTotalPoints ? card.change : undefined
            playerChartDataToUse = isTotalPointsExpanded ? (playerData || []) : null
            playerChartFilterToUse = isTotalPointsExpanded ? playerPerformanceChartFilter : 'all'
            playerChartStatKeyToUse = 'total_points'
            onPlayerChartFilterChangeToUse = isTotalPointsExpanded ? handlePlayerPerformanceChartFilterChange : null
            onPlayerChartStatChangeToUse = null
            playerChartExcludeHaalandToUse = cardId === 'total-points' ? playerChartExcludeHaaland : undefined
            onPlayerChartExcludeHaalandChangeToUse = cardId === 'total-points' ? setPlayerChartExcludeHaaland : undefined
            playerChartHideFilterControlsToUse = cardId === 'total-points'
          } else if (cardId === 'gw-points') {
            showValue = card.value
            showChange = showValueInGwPoints ? card.change : undefined
            currentGameweekPlayersDataToUse = (currentGameweekPlayers || [])
            gameweekFixturesFromPlayersToUse = currentGameweekFixtures?.length ? currentGameweekFixtures : null
            gameweekFixturesFromFPLToUse = fplFixturesForMatchState?.length ? fplFixturesForMatchState : null
            gameweekFixturesFromMatchesToUse = fixturesFromMatches ?? []
          } else if (cardId === 'transfers' && isTransfersExpanded) {
            showValue = undefined
            showChange = undefined
          } else {
            showChart = card.isChart || false
            chartDataToUse = card.isChart ? historyData : null
          }
          
          // Update label for total-points when expanded (no suffix)
          let labelToUse = card.label
          if (cardId === 'total-points') {
            if (isTotalPointsExpanded) {
              labelToUse = 'TOTAL POINTS'
            }
          }
          
          // Update label for gw-points when expanded
          if (cardId === 'gw-points') {
            if (isGwPointsExpandedCard) {
              labelToUse = 'GW POINTS'
            }
          }

          // Update label for transfers when expanded (suffix is subtle)
          if (cardId === 'transfers' && isTransfersExpanded) {
            labelToUse = (
              <>
                TRANSFERS <span className="bento-card-label-suffix">| ML Top Transfers</span>
              </>
            )
          }

          return (
            <BentoCard
              key={cardId}
              id={cardId}
              label={labelToUse}
              value={showValue}
              subtext={card.subtext}
              change={showChange}
              loading={loading}
              className={getCardClassName(cardId)}
              isChart={showChart}
              isChips={card.isChips}
              isSettings={card.isSettings}
              isStale={
                (cardId === 'overall-rank' || cardId === 'gw-rank') &&
                (hasLiveGames ||
                  (cardId === 'overall-rank' &&
                    (managerData?.overallRankChange ?? 0) === 0 &&
                    !gwFinished))
              }
              isLiveUpdating={
                (hasManagerPlayerInPlay && (cardId === 'gw-points' || cardId === 'total-points')) ||
                (cardId === 'league-rank' && (hasManagerPlayerInPlay || hasAnyLeagueManagerPlayerInPlay))
              }
              isProvisionalOnly={refreshState === 'bonus_pending'}
              isExpanded={isOverallRankExpanded || isTeamValueExpandedCard || isTotalPointsExpanded || isGwPointsExpandedCard || (cardId === 'chips' && isChipsExpanded)}
              animateEntrance={!loading}
              style={{ '--animation-delay': `${bentoAnimationDelays[cardId] ?? 0}ms` }}
              onConfigureClick={card.isSettings ? handleConfigureClick : undefined}
              onDebugClick={card.isSettings ? openDebugModal : undefined}
              onExpandClick={
                cardId === 'overall-rank' ? handleExpandClick :
                cardId === 'team-value' ? handleTeamValueExpandClick :
                cardId === 'total-points' ? handlePlayerPerformanceExpand :
                cardId === 'gw-points' ? handleGwPointsExpandClick :
                cardId === 'chips' ? handleChipsExpandClick :
                undefined
              }
              onCollapseClick={
                cardId === 'overall-rank' ? handleCollapseClick :
                cardId === 'team-value' ? handleTeamValueCollapseClick :
                cardId === 'total-points' ? handlePlayerPerformanceCollapse :
                cardId === 'gw-points' ? handleGwPointsCollapseClick :
                cardId === 'chips' ? handleChipsCollapseClick :
                undefined
              }
              gameweek={cardId === 'chips' || cardId === 'transfers' ? gameweek : undefined}
              leagueChipData={cardId === 'chips' ? leagueChipData : undefined}
              leagueChipsLoading={cardId === 'chips' ? leagueChipsLoading : undefined}
              chartData={chartDataToUse}
              chartComparisonData={chartComparisonDataToUse}
              chartFilter={chartFilterToUse}
              showChartComparison={showChartComparisonToUse}
              onChartFilterChange={onChartFilterChangeToUse}
              showTop10Lines={showTop10LinesToUse}
              top10LinesData={top10LinesDataToUse}
              onShowTop10Change={onShowTop10ChangeToUse}
              chipUsage={card.isChips ? chipUsage : null}
              isTransfers={card.isTransfers ?? false}
              transfersSummary={card.isTransfers ? {
                used: managerData?.transfersMade ?? 0,
                available: managerData?.freeTransfersAvailable ?? 0,
                transfers: transferImpacts ?? [],
                activeChip: managerData?.activeChip ?? null,
              } : null}
              leagueTopTransfersOut={cardId === 'transfers' ? leagueTopTransfersOut : undefined}
              leagueTopTransfersIn={cardId === 'transfers' ? leagueTopTransfersIn : undefined}
              leagueTopTransfersLoading={cardId === 'transfers' ? leagueTopTransfersLoading : undefined}
              transfersGameweek={cardId === 'transfers' ? gameweek : undefined}
              playerChartData={playerChartDataToUse}
              playerChartFilter={playerChartFilterToUse}
              playerChartStatKey={playerChartStatKeyToUse}
              onPlayerChartFilterChange={onPlayerChartFilterChangeToUse}
              onPlayerChartStatChange={onPlayerChartStatChangeToUse}
              playerChartExcludeHaaland={playerChartExcludeHaalandToUse}
              onPlayerChartExcludeHaalandChange={onPlayerChartExcludeHaalandChangeToUse}
              playerChartHideFilterControls={playerChartHideFilterControlsToUse}
              playerPointsByGameweek={cardId === 'total-points' ? playerPointsByGameweek : undefined}
              currentGameweekPlayersData={currentGameweekPlayersDataToUse}
              gameweekFixturesFromPlayers={cardId === 'gw-points' ? gameweekFixturesFromPlayersToUse : undefined}
              gameweekFixturesFromFPL={cardId === 'gw-points' ? gameweekFixturesFromFPLToUse : undefined}
              gameweekFixturesFromMatches={cardId === 'gw-points' ? gameweekFixturesFromMatchesToUse : undefined}
              top10ByStat={cardId === 'gw-points' ? top10ByStat : undefined}
              showTop10Fill={cardId !== 'gw-points' || isGwPointsExpandedCard}
              impactByPlayerId={cardId === 'gw-points' ? impactByPlayerId : undefined}
              onPlayerRowClick={
                cardId === 'gw-points'
                  ? (player) => {
                      const id = player.effective_player_id ?? player.player_id
                      if (id != null) {
                        setBreakdownPlayer({
                          playerId: Number(id),
                          playerName: player.player_name ?? '',
                          position: player.position,
                        })
                      }
                    }
                  : undefined
              }
              leagueStandings={cardId === 'league-rank' ? leagueStandings : undefined}
              leagueStandingsLoading={cardId === 'league-rank' ? leagueStandingsLoading : undefined}
              currentManagerId={cardId === 'overall-rank' || cardId === 'league-rank' || cardId === 'captain' || cardId === 'chips' ? (config?.managerId ?? null) : undefined}
              currentManagerGwPoints={cardId === 'league-rank' ? (gwPointsFromPlayers != null ? gwPointsFromPlayers : (managerData?.gameweekPoints ?? 0)) : undefined}
              currentManagerTotalPoints={cardId === 'league-rank' ? (totalPointsFromPlayers != null ? totalPointsFromPlayers : (managerData?.totalPoints ?? 0)) : undefined}
              captainName={cardId === 'captain' && !showGameUpdatingBanner ? (currentGameweekPlayers?.find(p => p.is_captain)?.player_name ?? null) : undefined}
              viceCaptainName={cardId === 'captain' && !showGameUpdatingBanner ? (currentGameweekPlayers?.find(p => p.is_vice_captain)?.player_name ?? null) : undefined}
              captainDnp={cardId === 'captain' && !showGameUpdatingBanner ? (() => {
                const captainRows = (currentGameweekPlayers ?? []).filter(p => p.is_captain)
                if (!captainRows.length) return false
                const anyFinished = captainRows.some(r => r.match_finished || r.match_finished_provisional)
                const totalMinutes = captainRows.reduce((s, r) => s + (r.minutes ?? 0), 0)
                return !!(anyFinished && totalMinutes === 0)
              })() : undefined}
              viceCaptainDnp={cardId === 'captain' && !showGameUpdatingBanner ? (() => {
                const viceRows = (currentGameweekPlayers ?? []).filter(p => p.is_vice_captain)
                if (!viceRows.length) return false
                const anyFinished = viceRows.some(r => r.match_finished || r.match_finished_provisional)
                const totalMinutes = viceRows.reduce((s, r) => s + (r.minutes ?? 0), 0)
                return !!(anyFinished && totalMinutes === 0)
              })() : undefined}
              leagueCaptainData={cardId === 'captain' && !showGameUpdatingBanner ? leagueCaptainData : undefined}
              leagueCaptainLoading={cardId === 'captain' ? leagueCaptainLoading : undefined}
            />
          )
        })}
      </div>
      {breakdownPlayer != null && typeof document !== 'undefined' && createPortal(
        <PlayerBreakdownPopup
          playerId={breakdownPlayer.playerId}
          playerName={breakdownPlayer.playerName}
          position={breakdownPlayer.position}
          gameweek={gameweek}
          onShowFullDetail={() => {
            setSelectedPlayerId(breakdownPlayer.playerId)
            setSelectedPlayerName(breakdownPlayer.playerName ?? '')
            setBreakdownPlayer(null)
          }}
          onClose={() => setBreakdownPlayer(null)}
        />,
        document.body
      )}
      {selectedPlayerId != null && (
        <PlayerDetailModal
          playerId={selectedPlayerId}
          playerName={selectedPlayerName}
          gameweek={gameweek}
          leagueManagerCount={leagueManagerCount}
          leagueManagerIds={leagueManagerIds}
          onClose={() => {
            setSelectedPlayerId(null)
            setSelectedPlayerName('')
          }}
        />
      )}
    </div>
  )
}
