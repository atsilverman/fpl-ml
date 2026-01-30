import { useState, useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useGameweekData } from '../hooks/useGameweekData'
import { useManagerData } from '../hooks/useManagerData'
import { useManagerHistory } from '../hooks/useManagerHistory'
import { useTeamValueHistory } from '../hooks/useTeamValueHistory'
import { useLeagueTeamValueHistory } from '../hooks/useLeagueTeamValueHistory'
import { useChipUsage } from '../hooks/useChipUsage'
import { useLiveGameweekStatus } from '../hooks/useLiveGameweekStatus'
import { usePlayerOwnedPerformance } from '../hooks/usePlayerOwnedPerformance'
import { useCurrentGameweekPlayers } from '../hooks/useCurrentGameweekPlayers'
import { useGameweekTop10ByStat } from '../hooks/useGameweekTop10ByStat'
import { useTransferImpacts } from '../hooks/useTransferImpacts'
import { useLeagueTopTransfers } from '../hooks/useLeagueTopTransfers'
import { useLeagueChipUsage } from '../hooks/useLeagueChipUsage'
import { useMiniLeagueStandings } from '../hooks/useMiniLeagueStandings'
import { useLeagueCaptainPicks } from '../hooks/useLeagueCaptainPicks'
import { useConfiguration } from '../contexts/ConfigurationContext'
import { supabase } from '../lib/supabase'
import BentoCard from './BentoCard'
import ConfigurationModal from './ConfigurationModal'
import { formatNumber, formatNumberWithTwoDecimals, formatPrice } from '../utils/formatNumbers'
import './HomePage.css'

export default function HomePage() {
  const { config, updateConfig } = useConfiguration()
  const [isConfigModalOpen, setIsConfigModalOpen] = useState(false)
  
  // State declarations (must be before hooks that use them)
  const [chartFilter, setChartFilter] = useState('last12') // 'all', 'last12', 'last6'
  const [showChartComparison, setShowChartComparison] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const [isPerformanceExpanded, setIsPerformanceExpanded] = useState(false)
  const [isPlayerPerformanceExpanded, setIsPlayerPerformanceExpanded] = useState(false)
  const [playerPerformanceChartFilter, setPlayerPerformanceChartFilter] = useState('last12') // 'all', 'last12', 'last6'
  const [teamValueChartFilter, setTeamValueChartFilter] = useState('last12') // 'all', 'last12', 'last6'
  const [showTeamValueComparison, setShowTeamValueComparison] = useState(false)
  const [isTeamValueExpanded, setIsTeamValueExpanded] = useState(false)
  const [isGwPointsExpanded, setIsGwPointsExpanded] = useState(false)
  const [isTransfersExpanded, setIsTransfersExpanded] = useState(false)
  const [isChipsExpanded, setIsChipsExpanded] = useState(false)
  const [isLeagueRankExpanded, setIsLeagueRankExpanded] = useState(false)
  const [isCaptainExpanded, setIsCaptainExpanded] = useState(false)
  
  // Hooks that depend on state
  const { gameweek, loading: gwLoading } = useGameweekData()
  const { managerData, loading: managerLoading } = useManagerData()
  const { historyData, loading: historyLoading } = useManagerHistory()
  const { historyData: teamValueHistoryData, loading: teamValueHistoryLoading } = useTeamValueHistory()
  const { leagueData: leagueTeamValueData, loading: leagueTeamValueLoading } = useLeagueTeamValueHistory()
  const { chipUsage, loading: chipLoading } = useChipUsage()
  const { hasLiveGames } = useLiveGameweekStatus(gameweek)
  const { playerData, loading: playerPerformanceLoading } = usePlayerOwnedPerformance(playerPerformanceChartFilter)
  const { data: currentGameweekPlayers, isLoading: currentGameweekPlayersLoading } = useCurrentGameweekPlayers()
  const { top10ByStat, isLoading: top10ByStatLoading } = useGameweekTop10ByStat()
  const { transfers: transferImpacts, loading: transferImpactsLoading } = useTransferImpacts(gameweek)

  // Fetch league name and league top transfers (for expanded Transfers card)
  const LEAGUE_ID = config?.leagueId || import.meta.env.VITE_LEAGUE_ID || null
  const { transfersOut: leagueTopTransfersOut, transfersIn: leagueTopTransfersIn, loading: leagueTopTransfersLoading } = useLeagueTopTransfers(LEAGUE_ID, gameweek)
  const { leagueChipData, loading: leagueChipsLoading } = useLeagueChipUsage(gameweek)
  const { standings: leagueStandings, loading: leagueStandingsLoading } = useMiniLeagueStandings(gameweek)
  const { leagueCaptainData, loading: leagueCaptainLoading } = useLeagueCaptainPicks(gameweek)
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
  const [cardOrder, setCardOrder] = useState(() => {
    const saved = localStorage.getItem('bento_card_order')
    return saved ? JSON.parse(saved) : [
      'overall-rank',
      'gw-points',
      'total-points',
      'gw-rank',
      'team-value',
      'chips',
      'transfers',
      'league-rank',
      'captain',
      'settings'
    ]
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

  const loading = gwLoading || managerLoading || historyLoading || chipLoading || playerPerformanceLoading || teamValueHistoryLoading || leagueTeamValueLoading || currentGameweekPlayersLoading || top10ByStatLoading || transferImpactsLoading

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
      value: formatNumberWithTwoDecimals(managerData?.gameweekRank),
      size: '1x1'
    },
    {
      id: 'total-points',
      label: 'Total Points',
      value: managerData?.totalPoints != null 
        ? managerData.totalPoints.toLocaleString('en-GB')
        : '—',
      size: '1x1'
    },
    {
      id: 'gw-points',
      label: 'GW Points',
      value: formatNumber(managerData?.gameweekPoints),
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
      size: '2x1',
      isChips: true
    },
    {
      id: 'transfers',
      label: 'Transfers',
      value: managerData != null
        ? `${managerData.transfersMade} of ${managerData.freeTransfersAvailable}`
        : undefined,
      size: '2x1',
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
      label: 'Captaincy',
      size: '1x1'
    },
    {
      id: 'settings',
      label: 'Settings',
      size: '1x1',
      isSettings: true
    }
  ]

  const getCardClassName = (id) => {
    const card = cards.find(c => c.id === id)
    if (!card) return ''
    
    // Transform overall-rank to 2x3 when expanded
    if (id === 'overall-rank' && isPerformanceExpanded) {
      return 'bento-card-chart-large'
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
    
    // Transfers card 2x3 when expanded
    if (id === 'transfers' && isTransfersExpanded) {
      return 'bento-card-chart-large'
    }

    // Chips card 2x3 when expanded
    if (id === 'chips' && isChipsExpanded) {
      return 'bento-card-chart-large'
    }

    // League rank card 2x3 when expanded
    if (id === 'league-rank' && isLeagueRankExpanded) {
      return 'bento-card-chart-large'
    }

    // Captain card 2x3 when expanded
    if (id === 'captain' && isCaptainExpanded) {
      return 'bento-card-chart-large'
    }
    
    if (card.size === '2x3') return 'bento-card-chart-large'
    if (card.size === '2x1') return card.isChips ? 'bento-card-chips' : 'bento-card-large'
    return 'bento-card'
  }

  const handleConfigureClick = () => {
    setIsConfigModalOpen(true)
  }

  const handleConfigSave = ({ leagueId, managerId }) => {
    updateConfig({
      leagueId: parseInt(leagueId),
      managerId: parseInt(managerId)
    })
    // Queries will be automatically invalidated and refetched by ConfigurationContext
    // No need to reload the page
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

  const handleLeagueRankExpandClick = () => {
    setIsLeagueRankExpanded(true)
  }

  const handleLeagueRankCollapseClick = () => {
    setIsLeagueRankExpanded(false)
  }

  const handleCaptainExpandClick = () => {
    setIsCaptainExpanded(true)
  }

  const handleCaptainCollapseClick = () => {
    setIsCaptainExpanded(false)
  }

  return (
    <div className="home-page">
      <div className="bento-grid">
        {displayCardOrder.map((cardId, index) => {
          const card = cards.find(c => c.id === cardId)
          if (!card) return null

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
          let onPlayerChartFilterChangeToUse = null
          let currentGameweekPlayersDataToUse = null

          if (cardId === 'overall-rank') {
            showValue = showValueInOverallRank ? card.value : undefined
            showChange = showValueInOverallRank ? card.change : undefined
            showChart = showChartInOverallRank
            chartDataToUse = showChartInOverallRank ? historyData : null
            chartFilterToUse = chartFilter
            showChartComparisonToUse = showChartComparison
            onChartFilterChangeToUse = showChartInOverallRank ? handleChartFilterChange : null
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
            onPlayerChartFilterChangeToUse = isTotalPointsExpanded ? handlePlayerPerformanceChartFilterChange : null
            if (isTotalPointsExpanded) {
              console.log('Total points expanded, playerChartData:', playerChartDataToUse, 'loading:', playerPerformanceLoading)
            }
          } else if (cardId === 'gw-points') {
            showValue = showValueInGwPoints ? card.value : undefined
            showChange = showValueInGwPoints ? card.change : undefined
            currentGameweekPlayersDataToUse = (currentGameweekPlayers || [])
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
                TRANSFERS <span className="bento-card-label-suffix">| League Top Transfers</span>
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
              isStale={hasLiveGames && (cardId === 'overall-rank' || cardId === 'gw-rank')}
              isExpanded={isOverallRankExpanded || isTeamValueExpandedCard || isTotalPointsExpanded || isGwPointsExpandedCard || (cardId === 'transfers' && isTransfersExpanded) || (cardId === 'chips' && isChipsExpanded) || (cardId === 'league-rank' && isLeagueRankExpanded) || (cardId === 'captain' && isCaptainExpanded)}
              style={{ '--animation-delay': `${index * 0.1}s` }}
              onConfigureClick={card.isSettings ? handleConfigureClick : undefined}
              onExpandClick={
                cardId === 'overall-rank' ? handleExpandClick :
                cardId === 'team-value' ? handleTeamValueExpandClick :
                cardId === 'total-points' ? handlePlayerPerformanceExpand :
                cardId === 'gw-points' ? handleGwPointsExpandClick :
                cardId === 'transfers' ? handleTransfersExpandClick :
                cardId === 'chips' ? handleChipsExpandClick :
                cardId === 'league-rank' ? handleLeagueRankExpandClick :
                cardId === 'captain' ? handleCaptainExpandClick :
                undefined
              }
              onCollapseClick={
                cardId === 'overall-rank' ? handleCollapseClick :
                cardId === 'team-value' ? handleTeamValueCollapseClick :
                cardId === 'total-points' ? handlePlayerPerformanceCollapse :
                cardId === 'gw-points' ? handleGwPointsCollapseClick :
                cardId === 'transfers' ? handleTransfersCollapseClick :
                cardId === 'chips' ? handleChipsCollapseClick :
                cardId === 'league-rank' ? handleLeagueRankCollapseClick :
                cardId === 'captain' ? handleCaptainCollapseClick :
                undefined
              }
              gameweek={cardId === 'chips' ? gameweek : undefined}
              leagueChipData={cardId === 'chips' ? leagueChipData : undefined}
              leagueChipsLoading={cardId === 'chips' ? leagueChipsLoading : undefined}
              chartData={chartDataToUse}
              chartComparisonData={chartComparisonDataToUse}
              chartFilter={chartFilterToUse}
              showChartComparison={showChartComparisonToUse}
              onChartFilterChange={onChartFilterChangeToUse}
              chipUsage={card.isChips ? chipUsage : null}
              isTransfers={card.isTransfers ?? false}
              transfersSummary={card.isTransfers ? {
                used: managerData?.transfersMade ?? 0,
                available: managerData?.freeTransfersAvailable ?? 0,
                transfers: transferImpacts ?? []
              } : null}
              leagueTopTransfersOut={cardId === 'transfers' ? leagueTopTransfersOut : undefined}
              leagueTopTransfersIn={cardId === 'transfers' ? leagueTopTransfersIn : undefined}
              leagueTopTransfersLoading={cardId === 'transfers' ? leagueTopTransfersLoading : undefined}
              transfersGameweek={cardId === 'transfers' ? gameweek : undefined}
              playerChartData={playerChartDataToUse}
              playerChartFilter={playerChartFilterToUse}
              onPlayerChartFilterChange={onPlayerChartFilterChangeToUse}
              currentGameweekPlayersData={currentGameweekPlayersDataToUse}
              top10ByStat={cardId === 'gw-points' ? top10ByStat : undefined}
              leagueStandings={cardId === 'league-rank' ? leagueStandings : undefined}
              leagueStandingsLoading={cardId === 'league-rank' ? leagueStandingsLoading : undefined}
              currentManagerId={cardId === 'league-rank' || cardId === 'captain' || cardId === 'chips' ? (config?.managerId ?? null) : undefined}
              captainName={cardId === 'captain' ? (currentGameweekPlayers?.find(p => p.is_captain)?.player_name ?? null) : undefined}
              viceCaptainName={cardId === 'captain' ? (currentGameweekPlayers?.find(p => p.is_vice_captain)?.player_name ?? null) : undefined}
              leagueCaptainData={cardId === 'captain' ? leagueCaptainData : undefined}
              leagueCaptainLoading={cardId === 'captain' ? leagueCaptainLoading : undefined}
            />
          )
        })}
      </div>
      
      <ConfigurationModal
        isOpen={isConfigModalOpen}
        onClose={() => setIsConfigModalOpen(false)}
        onSave={handleConfigSave}
      />
    </div>
  )
}
