import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import background from '../../assets/images/background.png'
import { soundManager } from '../../utils/audioManager'
import { ARENAS, getArenaForElo } from '../../utils/arenaManager'
import { SupabaseService } from '../../services/supabaseService'
import { isCurrentLeaderboardUser } from '../../utils/leaderboardParser'
import { getPlayerAvatarUrl } from '../../utils/userManager'
import { PLANT_CONFIGS } from '../../utils/gameConstants'
import type { PlantId } from '../../types/game'
import { getMostPlantedPlant } from '../../utils/plantUsageTracker'
import { supabase } from '../../lib/supabaseClient'
import './Ranking.css'

import type { Database } from '../../types/database.types'

interface LeaderboardUser {
  id: string
  rank: number
  username: string
  avatar: string
  clan: string
  elo: number
  wins: number
  losses: number
  draws: number
  totalGames: number
  winRate: string
  rawWinRate: number
  arenaId: number
  arenaName: string
  bestPlantId: PlantId
  bestPlantName: string
  bestPlantImg: string
  isCurrentUser?: boolean
}

interface RankingProps {
  userElo: number
  userProfile?: Database['public']['Tables']['profiles']['Row'] | null
  hasVipPass?: boolean
  onBack: () => void
}

interface ReferralLeaderboardUser {
  rank: number
  username: string
  referredCount: number
  tierBadge: string
  avatar: string
  isCurrentUser?: boolean
}

function getBestPlantForUser(
  userId: string,
  isCurrentUser: boolean,
  userPlantsMap?: Map<string, string>,
  avatarId?: string | null
): { plantId: PlantId; name: string; img: string } {
  // 1. Si es el usuario actual: usar estrictamente la planta que MÁS ha colocado en el campo de batalla
  if (isCurrentUser) {
    const { plantId } = getMostPlantedPlant()
    const cfg = PLANT_CONFIGS[plantId] || PLANT_CONFIGS.peashooter
    return {
      plantId: cfg.id,
      name: cfg.name,
      img: cfg.sprite || cfg.icon,
    }
  }

  // 2. Si viene planta real desde plant_instances en el mapa
  if (userPlantsMap && userPlantsMap.has(userId)) {
    const pId = userPlantsMap.get(userId) as PlantId
    if (pId && pId in PLANT_CONFIGS) {
      const cfg = PLANT_CONFIGS[pId]
      return {
        plantId: cfg.id,
        name: cfg.name,
        img: cfg.sprite || cfg.icon,
      }
    }
  }

  // 3. Planta real del perfil del jugador (avatar_id canónico de Supabase)
  if (avatarId && avatarId in PLANT_CONFIGS) {
    const cfg = PLANT_CONFIGS[avatarId as PlantId]
    return {
      plantId: cfg.id,
      name: cfg.name,
      img: cfg.sprite || cfg.icon,
    }
  }

  // 4. Planta base canónica con la que inicia todo jugador en Arena 1 (Peashooter)
  const defaultCfg = PLANT_CONFIGS.peashooter
  return {
    plantId: defaultCfg.id,
    name: defaultCfg.name,
    img: defaultCfg.sprite || defaultCfg.icon,
  }
}

function generatePageNumbers(current: number, total: number): (number | string)[] {
  if (total <= 5) {
    return Array.from({ length: total }, (_, i) => i + 1)
  }
  const pages: (number | string)[] = []
  if (current <= 3) {
    pages.push(1, 2, 3, 4, '...', total)
  } else if (current >= total - 2) {
    pages.push(1, '...', total - 3, total - 2, total - 1, total)
  } else {
    pages.push(1, '...', current - 1, current, current + 1, '...', total)
  }
  return pages
}

export default function Ranking({ userElo, userProfile, hasVipPass = false, onBack }: RankingProps) {
  const [activeTab, setActiveTab] = useState<'arenas' | 'leaderboard' | 'referrals'>('arenas')
  const [isMuted, setIsMuted] = useState<boolean>(soundManager.isMuted())

  const currentArena = getArenaForElo(userElo)
  const [previewArenaId, setPreviewArenaId] = useState<number>(currentArena.id)

  const previewArena = ARENAS.find((a) => a.id === previewArenaId) || currentArena
  const nextArena = ARENAS.find((a) => a.id === currentArena.id + 1)

  const eloProgressPct = nextArena
    ? Math.min(
        100,
        Math.max(
          0,
          ((userElo - currentArena.minElo) / (nextArena.minElo - currentArena.minElo)) * 100
        )
      )
    : 100

  const [realLeaderboard, setRealLeaderboard] = useState<LeaderboardUser[]>([])
  const [isLoadingLeaderboard, setIsLoadingLeaderboard] = useState<boolean>(true)
  const [leaderboardError, setLeaderboardError] = useState<string | null>(null)

  // Leaderboard pagination & search & filter states
  const [leaderboardSearch, setLeaderboardSearch] = useState<string>('')
  const [filterClan, setFilterClan] = useState<'all' | 'with_clan' | 'no_clan'>('all')
  const [filterArena, setFilterArena] = useState<number | 'all'>('all')
  const [sortField, setSortField] = useState<'copas' | 'winrate'>('copas')
  const [sortAsc, setSortAsc] = useState<boolean>(false)
  const [selectedInspectUser, setSelectedInspectUser] = useState<LeaderboardUser | null>(null)

  const [leaderboardPage, setLeaderboardPage] = useState<number>(1)
  const [leaderboardPageSize, setLeaderboardPageSize] = useState<number | 'all'>(20)
  const leaderboardTableRef = useRef<HTMLDivElement>(null)

  // Referral leaderboard state
  const [referralLeaderboard, setReferralLeaderboard] = useState<ReferralLeaderboardUser[]>([])
  const [isLoadingReferrals, setIsLoadingReferrals] = useState<boolean>(false)
  const [referralSearch, setReferralSearch] = useState<string>('')
  const [referralPage, setReferralPage] = useState<number>(1)
  const [referralPageSize, setReferralPageSize] = useState<number | 'all'>(20)
  const referralTableRef = useRef<HTMLDivElement>(null)

  const loadLeaderboard = useCallback(() => {
    const myId = userProfile?.id

    setIsLoadingLeaderboard(true)
    setLeaderboardError(null)

    SupabaseService.getGlobalLeaderboard()
      .then(async (profiles) => {
        const userPlantsMap = new Map<string, string>()
        try {
          const topUserIds = profiles.slice(0, 10).map((p) => p.id)
          if (topUserIds.length > 0) {
            const { data: instances } = await supabase
              .from('plant_instances')
              .select('owner_id, plant_id, level, is_in_deck')
              .in('owner_id', topUserIds)
              .order('level', { ascending: false })

            if (Array.isArray(instances)) {
              for (const inst of instances) {
                if (inst.owner_id && inst.plant_id && !userPlantsMap.has(inst.owner_id)) {
                  userPlantsMap.set(inst.owner_id, inst.plant_id)
                }
              }
            }
          }
        } catch {
          // Si no hay instancias externas visibles, se usa la planta configurada del perfil
        }

        const mapped: LeaderboardUser[] = profiles.map((p) => {
          const arena = getArenaForElo(p.elo_rating)
          const isMe = isCurrentLeaderboardUser(p.id, myId)
          const bestPlant = getBestPlantForUser(p.id, isMe, userPlantsMap, p.avatar_id)
          const avatarUrl = getPlayerAvatarUrl(p.avatar_id)

          return {
            id: p.id,
            rank: p.rank_position,
            username: p.username,
            avatar: avatarUrl,
            clan: bestPlant.name,
            elo: p.elo_rating,
            wins: p.ranked_wins,
            losses: p.ranked_losses,
            draws: p.ranked_draws,
            totalGames: p.ranked_games,
            winRate: p.ranked_win_rate,
            rawWinRate: p.raw_win_rate,
            arenaId: arena.id,
            arenaName: arena.name,
            bestPlantId: bestPlant.plantId,
            bestPlantName: bestPlant.name,
            bestPlantImg: bestPlant.img,
            isCurrentUser: isMe,
          }
        })
        setRealLeaderboard(mapped)
        setIsLoadingLeaderboard(false)
      })
      .catch((err) => {
        setLeaderboardError(err?.message || 'No se pudo cargar la clasificación global.')
        setIsLoadingLeaderboard(false)
      })
  }, [userProfile?.id])

  useEffect(() => {
    let mounted = true
    const myUsername = (userProfile?.username ?? '').trim().toLowerCase()

    loadLeaderboard()

    // Cargar ranking real de referidos
    setIsLoadingReferrals(true)
    SupabaseService.myReferrals().then((refData) => {
      if (!mounted) return
      setIsLoadingReferrals(false)
      if (refData?.ranking && refData.ranking.length > 0) {
        const mapped: ReferralLeaderboardUser[] = refData.ranking.map((r) => {
          const isMe = Boolean(
            myUsername &&
            r.nombre &&
            r.nombre.trim().toLowerCase() === myUsername
          )
          return {
            rank: r.puesto,
            username: r.nombre || 'Jugador',
            referredCount: r.validos,
            tierBadge: r.validos >= 25 ? '👑 Embajador VIP' : r.validos >= 10 ? '⭐ Influencer' : r.validos >= 5 ? '🥉 Promotor' : '🌱 Iniciado',
            avatar: getPlayerAvatarUrl(r.avatar),
            isCurrentUser: isMe,
          }
        })
        setReferralLeaderboard(mapped)
      }
    }).catch(() => {
      if (mounted) setIsLoadingReferrals(false)
    })

    return () => {
      mounted = false
    }
  }, [loadLeaderboard, userProfile?.username, userElo])

  const leaderboardData = realLeaderboard

  // Ranked Table Filtered and Paginated
  const filteredTableUsers = useMemo(() => {
    let list = [...leaderboardData]

    // 1. Filtro Arena
    if (filterArena !== 'all') {
      list = list.filter((u) => u.arenaId === filterArena)
    }

    // 2. Filtro Clan
    if (filterClan === 'with_clan') {
      list = list.filter((u) => u.clan && u.clan !== '-' && u.clan !== 'Sin Clan')
    } else if (filterClan === 'no_clan') {
      list = list.filter((u) => !u.clan || u.clan === '-' || u.clan === 'Sin Clan')
    }

    // 3. Búsqueda por texto
    const query = leaderboardSearch.trim().toLowerCase()
    if (query) {
      list = list.filter((u) => u.username.toLowerCase().includes(query))
    } else {
      // Sin búsqueda: podio se encarga de los primeros 3 a la izquierda, la tabla a la derecha muestra del #4 en adelante
      list = list.slice(3)
    }

    // 4. Ordenamiento
    list.sort((a, b) => {
      if (sortField === 'copas') {
        return sortAsc ? a.elo - b.elo : b.elo - a.elo
      } else {
        return sortAsc ? a.rawWinRate - b.rawWinRate : b.rawWinRate - a.rawWinRate
      }
    })

    return list
  }, [leaderboardData, filterArena, filterClan, leaderboardSearch, sortField, sortAsc])

  const totalLeaderboardCount = filteredTableUsers.length
  const leaderboardItemsPerPage = leaderboardPageSize === 'all' ? (totalLeaderboardCount || 1) : leaderboardPageSize
  const totalLeaderboardPages = Math.max(1, Math.ceil(totalLeaderboardCount / leaderboardItemsPerPage))
  const currentLeaderboardPage = Math.min(leaderboardPage, totalLeaderboardPages)

  const paginatedLeaderboardUsers = useMemo(() => {
    if (leaderboardPageSize === 'all') return filteredTableUsers
    const start = (currentLeaderboardPage - 1) * leaderboardItemsPerPage
    return filteredTableUsers.slice(start, start + leaderboardItemsPerPage)
  }, [filteredTableUsers, currentLeaderboardPage, leaderboardItemsPerPage, leaderboardPageSize])

  const leaderboardStartIdx = totalLeaderboardCount === 0 ? 0 : (currentLeaderboardPage - 1) * leaderboardItemsPerPage + 1
  const leaderboardEndIdx = leaderboardPageSize === 'all' ? totalLeaderboardCount : Math.min(currentLeaderboardPage * leaderboardItemsPerPage, totalLeaderboardCount)

  const handleLeaderboardPageChange = (newPage: number) => {
    soundManager.playSound('click', 0.3)
    setLeaderboardPage(newPage)
    leaderboardTableRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // Referral Leaderboard Filtered and Paginated
  const filteredReferralUsers = useMemo(() => {
    const query = referralSearch.trim().toLowerCase()
    if (!query) return referralLeaderboard
    return referralLeaderboard.filter((u) => u.username.toLowerCase().includes(query))
  }, [referralLeaderboard, referralSearch])

  const totalReferralCount = filteredReferralUsers.length
  const referralItemsPerPage = referralPageSize === 'all' ? (totalReferralCount || 1) : referralPageSize
  const totalReferralPages = Math.max(1, Math.ceil(totalReferralCount / referralItemsPerPage))
  const currentReferralPage = Math.min(referralPage, totalReferralPages)

  const paginatedReferralUsers = useMemo(() => {
    if (referralPageSize === 'all') return filteredReferralUsers
    const start = (currentReferralPage - 1) * referralItemsPerPage
    return filteredReferralUsers.slice(start, start + referralItemsPerPage)
  }, [filteredReferralUsers, currentReferralPage, referralItemsPerPage, referralPageSize])

  const referralStartIdx = totalReferralCount === 0 ? 0 : (currentReferralPage - 1) * referralItemsPerPage + 1
  const referralEndIdx = referralPageSize === 'all' ? totalReferralCount : Math.min(currentReferralPage * referralItemsPerPage, totalReferralCount)

  const handleReferralPageChange = (newPage: number) => {
    soundManager.playSound('click', 0.3)
    setReferralPage(newPage)
    referralTableRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <div className="ranking-screen" style={{ backgroundImage: `url(${background})` }}>
      {/* COMPACT TOP HEADER */}
      <div className="ranking-header">
        <button className="ranking-back-btn" type="button" onClick={onBack}>
          ⬅️ MENÚ
        </button>
        <div className="ranking-header__center">
          <h1 className="ranking-title">🏆 CAMINO DE ARENAS & CLASIFICACIÓN GLOBAL</h1>
          <span className="ranking-subtitle">
            Tu nivel de ELO determina tu Arena activa. ¡Compite desde PLAY para escalar de rango!
          </span>
        </div>
        <div className="ranking-header__right">
          <button
            className="ranking-mute-btn"
            type="button"
            onClick={() => {
              soundManager.toggleMute()
              setIsMuted(soundManager.isMuted())
            }}
          >
            {isMuted ? '🔇' : '🔊'}
          </button>
        </div>
      </div>

      {/* GAMING CATEGORY NAVIGATION TABS (ZERO SCROLL) */}
      <div className="ranking-nav-tabs">
        <button
          type="button"
          className={`ranking-nav-tab ${activeTab === 'arenas' ? 'ranking-nav-tab--active' : ''}`}
          onClick={() => {
            soundManager.playSound('click', 0.5)
            setActiveTab('arenas')
          }}
        >
          🗺️ Arenas
        </button>
        <button
          type="button"
          className={`ranking-nav-tab ${activeTab === 'leaderboard' ? 'ranking-nav-tab--active' : ''}`}
          onClick={() => {
            soundManager.playSound('click', 0.5)
            setActiveTab('leaderboard')
          }}
        >
          🏆 RANKED
        </button>
        <button
          type="button"
          className={`ranking-nav-tab ${activeTab === 'referrals' ? 'ranking-nav-tab--active' : ''}`}
          onClick={() => {
            soundManager.playSound('click', 0.5)
            setActiveTab('referrals')
          }}
        >
          👥 RANKING REFERIDOS
        </button>
      </div>

      {/* MAIN CONTENT PANE (ZERO SCROLL) */}
      <div className="ranking-content">
        {/* TAB 1: CAMINO DE ARENAS (HERO SHOWCASE + ROAD TIMELINE) */}
        {activeTab === 'arenas' && (
          <div className="ranking-tab-pane">
            <div className="arena-road-split">
              {/* LEFT SIDE: HERO ARENA SHOWCASE */}
              <div className="arena-hero-showcase">
                <div
                  className="arena-hero-card"
                  style={{ backgroundImage: `url(${previewArena.bgImage})` }}
                >
                  <div className="arena-hero-overlay">
                    <div className="arena-hero-header">
                      {previewArena.id === currentArena.id ? (
                        <span className="arena-badge arena-badge--current">📍 TU ARENA ACTIVA DE BATALLA</span>
                      ) : previewArena.id < currentArena.id ? (
                        <span className="arena-badge arena-badge--passed">✓ ARENA SUPERADA</span>
                      ) : (
                        <span className="arena-badge arena-badge--locked">🔒 ARENA BLOQUEADA</span>
                      )}
                      <span className="arena-badge-elo">{previewArena.minElo}+ 🏆</span>
                    </div>

                    <div className="arena-hero-body">
                      <h2 className="arena-hero-title">
                        {previewArena.id}. {previewArena.name}
                      </h2>
                      <p className="arena-hero-tagline">{previewArena.tagline}</p>

                      {/* CURRENT ARENA PROGRESS BAR */}
                      {previewArena.id === currentArena.id && (
                        <div className="arena-hero-progress-box">
                          <div className="arena-hero-progress-info">
                            <span>Progreso de Copas hacia {nextArena ? nextArena.name : 'Máximo'}</span>
                            <strong>
                              {userElo} / {nextArena ? nextArena.minElo : currentArena.minElo} 🏆
                            </strong>
                          </div>
                          <div className="arena-hero-progress-bar">
                            <div
                              className="arena-hero-progress-fill"
                              style={{ width: `${eloProgressPct}%` }}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* RIGHT SIDE: SCROLLABLE ARENA ROAD TIMELINE */}
              <div className="arena-timeline-box">
                <h3 className="arena-timeline-title">🛣️ MAPA DE ESCALADA (6 ARENAS)</h3>
                <div className="arena-timeline-list">
                  {ARENAS.map((arenaItem) => {
                    const isCurrent = arenaItem.id === currentArena.id
                    const isSelected = arenaItem.id === previewArenaId
                    const isPassed = arenaItem.id < currentArena.id
                    const isLocked = arenaItem.id > currentArena.id

                    return (
                      <div
                        key={arenaItem.id}
                        className={`arena-timeline-node ${
                          isSelected ? 'arena-timeline-node--selected' : ''
                        } ${isCurrent ? 'arena-timeline-node--current' : ''} ${
                          isPassed ? 'arena-timeline-node--passed' : ''
                        } ${isLocked ? 'arena-timeline-node--locked' : ''}`}
                        onClick={() => {
                          soundManager.playSound('click', 0.4)
                          setPreviewArenaId(arenaItem.id)
                        }}
                      >
                        <div
                          className="arena-node-thumb"
                          style={{ backgroundImage: `url(${arenaItem.bgImage})` }}
                        >
                          {isCurrent && <span className="arena-node-pin">📍</span>}
                          {isPassed && <span className="arena-node-badge-check">✓</span>}
                          {isLocked && <span className="arena-node-badge-lock">🔒</span>}
                        </div>

                        <div className="arena-node-info">
                          <div className="arena-node-top">
                            <span className="arena-node-num">ARENA {arenaItem.id}</span>
                            <span className="arena-node-req">{arenaItem.minElo} 🏆</span>
                          </div>
                          <strong className="arena-node-name">{arenaItem.name}</strong>
                          <small className="arena-node-desc">{arenaItem.tagline}</small>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: GLOBAL LEADERBOARD */}
        {activeTab === 'leaderboard' && (
          <div className="ranking-tab-pane">
            <div className="leaderboard-container">
              {isLoadingLeaderboard ? (
                <div className="leaderboard-loading-state">
                  <span>⏳ Cargando todos los usuarios registrados...</span>
                </div>
              ) : leaderboardError ? (
                <div className="leaderboard-error-state" style={{ textAlign: 'center', padding: '40px 16px' }}>
                  <p style={{ color: '#ff6b6b', fontWeight: 'bold', fontSize: '1.1rem', marginBottom: '16px' }}>
                    ⚠️ {leaderboardError}
                  </p>
                  <button
                    type="button"
                    className="game-button"
                    style={{ padding: '8px 24px', fontSize: '0.95rem' }}
                    onClick={() => {
                      soundManager.playSound('click', 0.3)
                      loadLeaderboard()
                    }}
                  >
                    🔄 Reintentar
                  </button>
                </div>
              ) : leaderboardData.length === 0 ? (
                <div className="leaderboard-empty-state">
                  <span>No hay usuarios registrados en la clasificación todavía.</span>
                </div>
              ) : (
                <div className="leaderboard-split-layout">
                  {/* LEFT COLUMN: PODIUM #1 TOP, #2 & #3 BOTTOM */}
                  <div className="leaderboard-podium-col">
                    {/* 1st Place Golden Card */}
                    {leaderboardData[0] ? (
                      <div
                        className={`podium-card-v2 podium-card-v2--gold ${leaderboardData[0].isCurrentUser ? 'podium-card-v2--user' : ''}`}
                        onClick={() => setSelectedInspectUser(leaderboardData[0])}
                        role="button"
                        tabIndex={0}
                        title="Clic para ver perfil"
                      >
                        <div className="podium-v2-top">
                          <span className="podium-v2-star">★</span>
                          <span className="podium-v2-rank-gold">#1</span>
                          <span className="podium-v2-star">★</span>
                        </div>

                        <div className="podium-v2-avatar-wrapper">
                          <svg className="podium-v2-laurel-svg" viewBox="0 0 160 120" fill="none" xmlns="http://www.w3.org/2000/svg">
                            {/* Branch left */}
                            <path d="M 32 96 C 18 68 22 38 46 14" stroke="#fbbf24" strokeWidth="2.5" strokeLinecap="round" />
                            <path d="M 24 84 C 14 81 12 71 20 70 C 26 70 27 78 24 84 Z" fill="#fbbf24" />
                            <path d="M 20 66 C 10 62 9 52 17 50 C 24 49 25 59 20 66 Z" fill="#f59e0b" />
                            <path d="M 22 46 C 14 39 16 29 24 30 C 30 31 29 41 22 46 Z" fill="#fbbf24" />
                            <path d="M 30 28 C 24 20 29 11 37 14 C 42 17 39 25 30 28 Z" fill="#fde047" />
                            <path d="M 42 14 C 39 6 46 0 52 4 C 57 8 52 15 42 14 Z" fill="#fbbf24" />
                            {/* Branch right */}
                            <path d="M 128 96 C 142 68 138 38 114 14" stroke="#fbbf24" strokeWidth="2.5" strokeLinecap="round" />
                            <path d="M 136 84 C 146 81 148 71 140 70 C 134 70 133 78 136 84 Z" fill="#fbbf24" />
                            <path d="M 140 66 C 150 62 151 52 143 50 C 136 49 135 59 140 66 Z" fill="#f59e0b" />
                            <path d="M 138 46 C 146 39 144 29 136 30 C 130 31 131 41 138 46 Z" fill="#fbbf24" />
                            <path d="M 130 28 C 136 20 131 11 123 14 C 118 17 121 25 130 28 Z" fill="#fde047" />
                            <path d="M 118 14 C 121 6 114 0 108 4 C 103 8 108 15 118 14 Z" fill="#fbbf24" />
                          </svg>
                          <img
                            src={leaderboardData[0].avatar}
                            alt={leaderboardData[0].username}
                            className="podium-v2-avatar-img podium-v2-avatar-img--gold"
                            onError={(e) => {
                              e.currentTarget.src = '/game-assets/greenfoot/peashooterpacket1.png'
                            }}
                          />
                        </div>

                        <div className={`podium-v2-username ${leaderboardData[0].isCurrentUser && hasVipPass ? 'vip-gold-text' : ''}`}>
                          {leaderboardData[0].isCurrentUser && hasVipPass && '👑 '}
                          {leaderboardData[0].username} {leaderboardData[0].isCurrentUser && '(TÚ)'}
                        </div>

                        <div className="podium-v2-plant-pill" title={`Planta más usada: ${leaderboardData[0].bestPlantName}`}>
                          <img
                            src={leaderboardData[0].bestPlantImg}
                            alt={leaderboardData[0].bestPlantName}
                            className="podium-v2-plant-icon"
                            onError={(e) => {
                              e.currentTarget.src = '/game-assets/greenfoot/transparentsunflower.png'
                            }}
                          />
                          <span>{leaderboardData[0].bestPlantName}</span>
                        </div>

                        <div className="podium-v2-stats-row">
                          <div className="podium-v2-cups">
                            <span className="podium-v2-cups-icon">🏆</span> {leaderboardData[0].elo} Copas
                          </div>
                          <div className="podium-v2-divider" />
                          <div className="podium-v2-winrate">
                            {leaderboardData[0].winRate} ({leaderboardData[0].wins}W / {leaderboardData[0].losses}L)
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="podium-card-v2 podium-card-v2--placeholder">
                        <span>Esperando aspirante #1...</span>
                      </div>
                    )}

                    {/* Bottom row: #2 Silver & #3 Bronze */}
                    <div className="podium-v2-bottom-grid">
                      {/* 2nd Place */}
                      {leaderboardData[1] ? (
                        <div
                          className={`podium-card-v2 podium-card-v2--silver ${leaderboardData[1].isCurrentUser ? 'podium-card-v2--user' : ''}`}
                          onClick={() => setSelectedInspectUser(leaderboardData[1])}
                          role="button"
                          tabIndex={0}
                          title="Clic para ver perfil"
                        >
                          <div className="podium-v2-sub-rank podium-v2-sub-rank--silver">
                            ★ #2
                          </div>
                          <div className="podium-v2-sub-avatar-wrap">
                            <img
                              src={leaderboardData[1].avatar}
                              alt={leaderboardData[1].username}
                              className="podium-v2-sub-avatar podium-v2-sub-avatar--silver"
                              onError={(e) => {
                                e.currentTarget.src = '/game-assets/greenfoot/peashooterpacket1.png'
                              }}
                            />
                          </div>
                          <div className={`podium-v2-sub-username ${leaderboardData[1].isCurrentUser && hasVipPass ? 'vip-gold-text' : ''}`}>
                            {leaderboardData[1].isCurrentUser && hasVipPass && '👑 '}
                            {leaderboardData[1].username}
                          </div>
                          <div className="podium-v2-plant-pill podium-v2-plant-pill--sm">
                            <img
                              src={leaderboardData[1].bestPlantImg}
                              alt={leaderboardData[1].bestPlantName}
                              className="podium-v2-plant-icon"
                              onError={(e) => {
                                e.currentTarget.src = '/game-assets/greenfoot/transparentsunflower.png'
                              }}
                            />
                            <span>{leaderboardData[1].bestPlantName}</span>
                          </div>
                          <div className="podium-v2-sub-stats">
                            <span className="podium-v2-sub-cups">🏆 {leaderboardData[1].elo} Copas</span>
                            <span className="podium-v2-sub-wr">{leaderboardData[1].winRate} ({leaderboardData[1].wins}W / {leaderboardData[1].losses}L)</span>
                          </div>
                        </div>
                      ) : (
                        <div className="podium-card-v2 podium-card-v2--placeholder">
                          <span>Esperando #2...</span>
                        </div>
                      )}

                      {/* 3rd Place */}
                      {leaderboardData[2] ? (
                        <div
                          className={`podium-card-v2 podium-card-v2--bronze ${leaderboardData[2].isCurrentUser ? 'podium-card-v2--user' : ''}`}
                          onClick={() => setSelectedInspectUser(leaderboardData[2])}
                          role="button"
                          tabIndex={0}
                          title="Clic para ver perfil"
                        >
                          <div className="podium-v2-sub-rank podium-v2-sub-rank--bronze">
                            🏆 #3
                          </div>
                          <div className="podium-v2-sub-avatar-wrap">
                            <img
                              src={leaderboardData[2].avatar}
                              alt={leaderboardData[2].username}
                              className="podium-v2-sub-avatar podium-v2-sub-avatar--bronze"
                              onError={(e) => {
                                e.currentTarget.src = '/game-assets/greenfoot/peashooterpacket1.png'
                              }}
                            />
                          </div>
                          <div className={`podium-v2-sub-username ${leaderboardData[2].isCurrentUser && hasVipPass ? 'vip-gold-text' : ''}`}>
                            {leaderboardData[2].isCurrentUser && hasVipPass && '👑 '}
                            {leaderboardData[2].username}
                          </div>
                          <div className="podium-v2-plant-pill podium-v2-plant-pill--sm">
                            <img
                              src={leaderboardData[2].bestPlantImg}
                              alt={leaderboardData[2].bestPlantName}
                              className="podium-v2-plant-icon"
                              onError={(e) => {
                                e.currentTarget.src = '/game-assets/greenfoot/transparentsunflower.png'
                              }}
                            />
                            <span>{leaderboardData[2].bestPlantName}</span>
                          </div>
                          <div className="podium-v2-sub-stats">
                            <span className="podium-v2-sub-cups">🏆 {leaderboardData[2].elo} Copas</span>
                            <span className="podium-v2-sub-wr">{leaderboardData[2].winRate} ({leaderboardData[2].wins}W / {leaderboardData[2].losses}L)</span>
                          </div>
                        </div>
                      ) : (
                        <div className="podium-card-v2 podium-card-v2--placeholder">
                          <span>Esperando #3...</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* RIGHT COLUMN: SEARCH, FILTERS & TABLE */}
                  <div className="leaderboard-table-col">
                    {/* Top Search Bar */}
                    <div className="lb-search-container">
                      <span className="lb-search-icon">🔍</span>
                      <input
                        type="text"
                        className="lb-search-input"
                        placeholder="Buscar jugador por nombre..."
                        value={leaderboardSearch}
                        onChange={(e) => {
                          setLeaderboardSearch(e.target.value)
                          setLeaderboardPage(1)
                        }}
                      />
                      {leaderboardSearch && (
                        <button
                          type="button"
                          className="lb-search-clear"
                          onClick={() => {
                            setLeaderboardSearch('')
                            setLeaderboardPage(1)
                          }}
                        >
                          ✕
                        </button>
                      )}
                    </div>

                    {/* Filter Pills Row */}
                    <div className="lb-filter-bar">
                      {/* Filter 1: Clan / Todos */}
                      <div className="lb-select-wrapper">
                        <select
                          className="lb-filter-select"
                          value={filterClan}
                          onChange={(e) => {
                            soundManager.playSound('click', 0.2)
                            setFilterClan(e.target.value as any)
                            setLeaderboardPage(1)
                          }}
                        >
                          <option value="all">👥 Todos</option>
                          <option value="with_clan">🛡️ Con Clan</option>
                          <option value="no_clan">🌱 Sin Clan</option>
                        </select>
                        <span className="lb-select-arrow">▼</span>
                      </div>

                      {/* Filter 2: Arena */}
                      <div className="lb-select-wrapper">
                        <select
                          className="lb-filter-select"
                          value={filterArena}
                          onChange={(e) => {
                            soundManager.playSound('click', 0.2)
                            setFilterArena(e.target.value === 'all' ? 'all' : Number(e.target.value))
                            setLeaderboardPage(1)
                          }}
                        >
                          <option value="all">🗺️ Arena (Todas)</option>
                          {ARENAS.map((a) => (
                            <option key={a.id} value={a.id}>
                              🗺️ Arena {a.id}
                            </option>
                          ))}
                        </select>
                        <span className="lb-select-arrow">▼</span>
                      </div>

                      {/* Filter 3: Copas Sort */}
                      <button
                        type="button"
                        className={`lb-filter-btn ${sortField === 'copas' ? 'lb-filter-btn--active' : ''}`}
                        onClick={() => {
                          soundManager.playSound('click', 0.2)
                          if (sortField === 'copas') {
                            setSortAsc(!sortAsc)
                          } else {
                            setSortField('copas')
                            setSortAsc(false)
                          }
                        }}
                      >
                        <span>🏆 Copas</span>
                        <span className="lb-filter-indicator">
                          {sortField === 'copas' ? (sortAsc ? '▲' : '▼') : '▼'}
                        </span>
                      </button>

                      {/* Filter 4: Win Rate Sort */}
                      <button
                        type="button"
                        className={`lb-filter-btn ${sortField === 'winrate' ? 'lb-filter-btn--active' : ''}`}
                        onClick={() => {
                          soundManager.playSound('click', 0.2)
                          if (sortField === 'winrate') {
                            setSortAsc(!sortAsc)
                          } else {
                            setSortField('winrate')
                            setSortAsc(false)
                          }
                        }}
                      >
                        <span>📊 Win Rate</span>
                        <span className="lb-filter-indicator">
                          {sortField === 'winrate' ? (sortAsc ? '▲' : '▼') : '▼'}
                        </span>
                      </button>
                    </div>

                    {/* Table Container */}
                    <div className="lb-table-wrap" ref={leaderboardTableRef}>
                      {paginatedLeaderboardUsers.length > 0 ? (
                        <table className="lb-table">
                          <thead>
                            <tr>
                              <th style={{ width: '45px', textAlign: 'center' }}>#</th>
                              <th>JUGADOR</th>
                              <th>CLAN</th>
                              <th>COPAS</th>
                              <th>WIN RATE</th>
                              <th style={{ width: '60px', textAlign: 'center' }}></th>
                            </tr>
                          </thead>
                          <tbody>
                            {paginatedLeaderboardUsers.map((usr) => (
                              <tr key={`${usr.rank}-${usr.username}`} className={usr.isCurrentUser ? 'lb-row--user' : ''}>
                                <td className="lb-col-rank">#{usr.rank}</td>
                                <td className="lb-col-player">
                                  <div className="lb-player-cell">
                                    <img
                                      src={usr.avatar}
                                      alt={usr.username}
                                      className="lb-avatar-circle"
                                      onError={(e) => {
                                        e.currentTarget.src = '/game-assets/greenfoot/peashooterpacket1.png'
                                      }}
                                    />
                                    <span className={`lb-player-name ${usr.isCurrentUser && hasVipPass ? 'vip-gold-text' : ''}`}>
                                      {usr.isCurrentUser && hasVipPass && '👑 '}
                                      {usr.username}
                                      {usr.isCurrentUser && <span className="user-self-badge">TÚ</span>}
                                    </span>
                                  </div>
                                </td>
                                <td className="lb-col-clan">
                                  <span className="lb-plant-badge-pill" title={`Planta más usada: ${usr.bestPlantName}`}>
                                    <img
                                      src={usr.bestPlantImg}
                                      alt={usr.bestPlantName}
                                      className="lb-plant-badge-img"
                                      onError={(e) => {
                                        e.currentTarget.src = '/game-assets/greenfoot/transparentsunflower.png'
                                      }}
                                    />
                                    <span>{usr.bestPlantName}</span>
                                  </span>
                                </td>
                                <td className="lb-col-copas">
                                  <span className="lb-copas-val">
                                    <span className="lb-trophy-icon">🏆</span> {usr.elo}
                                  </span>
                                </td>
                                <td className="lb-col-winrate">
                                  <div className="lb-winrate-wrap">
                                    <span className="lb-winrate-pct">{usr.winRate}</span>
                                    <span className="lb-winrate-games">({usr.wins}W / {usr.losses}L)</span>
                                  </div>
                                </td>
                                <td className="lb-col-action">
                                  <button
                                    type="button"
                                    className="lb-btn-ver"
                                    onClick={() => {
                                      soundManager.playSound('click', 0.4)
                                      setSelectedInspectUser(usr)
                                    }}
                                  >
                                    Ver
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : (
                        <div className="leaderboard-few-users-note">
                          {leaderboardSearch ? (
                            <span>🔎 No se encontraron jugadores que coincidan con "{leaderboardSearch}".</span>
                          ) : (
                            <span>⭐ Mostrando los 3 mejores en el podio. Sin más jugadores registrados.</span>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Pagination & Page Size Toolbar */}
                    <div className="lb-table-footer">
                      <div className="lb-page-size-picker">
                        <span className="lb-footer-label">Ver:</span>
                        {[10, 20, 50].map((size) => (
                          <button
                            key={size}
                            type="button"
                            className={`lb-size-btn ${leaderboardPageSize === size ? 'lb-size-btn--active' : ''}`}
                            onClick={() => {
                              soundManager.playSound('click', 0.2)
                              setLeaderboardPageSize(size)
                              setLeaderboardPage(1)
                            }}
                          >
                            {size}
                          </button>
                        ))}
                        <button
                          type="button"
                          className={`lb-size-btn ${leaderboardPageSize === 'all' ? 'lb-size-btn--active' : ''}`}
                          onClick={() => {
                            soundManager.playSound('click', 0.2)
                            setLeaderboardPageSize('all')
                            setLeaderboardPage(1)
                          }}
                        >
                          Todos ({totalLeaderboardCount})
                        </button>
                        <span className="pagination-info" style={{ fontSize: '10px', color: '#94a3b8', marginLeft: '6px' }}>
                          {totalLeaderboardCount === 0 ? '' : `(${leaderboardStartIdx} - ${leaderboardEndIdx})`}
                        </span>
                      </div>

                      {totalLeaderboardPages > 1 && (
                        <div className="pagination-controls">
                          <button
                            type="button"
                            className="pagination-btn pagination-btn--nav"
                            disabled={currentLeaderboardPage <= 1}
                            onClick={() => handleLeaderboardPageChange(1)}
                            title="Primera página"
                          >
                            ««
                          </button>
                          <button
                            type="button"
                            className="pagination-btn pagination-btn--nav"
                            disabled={currentLeaderboardPage <= 1}
                            onClick={() => handleLeaderboardPageChange(currentLeaderboardPage - 1)}
                            title="Página anterior"
                          >
                            ‹ Ant
                          </button>

                          <div className="pagination-pages">
                            {generatePageNumbers(currentLeaderboardPage, totalLeaderboardPages).map((p, idx) =>
                              p === '...' ? (
                                <span key={`dots-lb-${idx}`} className="pagination-dots">…</span>
                              ) : (
                                <button
                                  key={`page-lb-${p}`}
                                  type="button"
                                  className={`pagination-btn ${p === currentLeaderboardPage ? 'pagination-btn--active' : ''}`}
                                  onClick={() => handleLeaderboardPageChange(Number(p))}
                                >
                                  {p}
                                </button>
                              )
                            )}
                          </div>

                          <button
                            type="button"
                            className="pagination-btn pagination-btn--nav"
                            disabled={currentLeaderboardPage >= totalLeaderboardPages}
                            onClick={() => handleLeaderboardPageChange(currentLeaderboardPage + 1)}
                            title="Página siguiente"
                          >
                            Sig ›
                          </button>
                          <button
                            type="button"
                            className="pagination-btn pagination-btn--nav"
                            disabled={currentLeaderboardPage >= totalLeaderboardPages}
                            onClick={() => handleLeaderboardPageChange(totalLeaderboardPages)}
                            title="Última página"
                          >
                            »»
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 3: REFERRAL LEADERBOARD */}
        {activeTab === 'referrals' && (
          <div className="ranking-tab-pane">
            <div className="referral-ranking-layout">
              {/* TOOLBAR REFERIDOS */}
              <div className="leaderboard-toolbar">
                <div className="leaderboard-search-box">
                  <span className="leaderboard-search-icon">🔍</span>
                  <input
                    type="text"
                    className="leaderboard-search-input"
                    placeholder="Buscar en ranking de referidos..."
                    value={referralSearch}
                    onChange={(e) => {
                      setReferralSearch(e.target.value)
                      setReferralPage(1)
                    }}
                  />
                  {referralSearch && (
                    <button
                      type="button"
                      className="leaderboard-search-clear"
                      onClick={() => {
                        setReferralSearch('')
                        setReferralPage(1)
                      }}
                    >
                      ✕
                    </button>
                  )}
                </div>

                <div className="leaderboard-size-selector">
                  <span className="leaderboard-size-lbl">Ver:</span>
                  {[10, 20, 50].map((size) => (
                    <button
                      key={size}
                      type="button"
                      className={`leaderboard-size-btn ${referralPageSize === size ? 'leaderboard-size-btn--active' : ''}`}
                      onClick={() => {
                        soundManager.playSound('click', 0.2)
                        setReferralPageSize(size)
                        setReferralPage(1)
                      }}
                    >
                      {size}
                    </button>
                  ))}
                  <button
                    type="button"
                    className={`leaderboard-size-btn ${referralPageSize === 'all' ? 'leaderboard-size-btn--active' : ''}`}
                    onClick={() => {
                      soundManager.playSound('click', 0.2)
                      setReferralPageSize('all')
                      setReferralPage(1)
                    }}
                  >
                    Todos ({totalReferralCount})
                  </button>
                </div>
              </div>

              {/* REFERRAL LEADERBOARD TABLE */}
              <div className="leaderboard-table-wrap referral-table-wrap" ref={referralTableRef}>
                {isLoadingReferrals ? (
                  <div className="leaderboard-loading-state">
                    <span>⏳ Cargando clasificación de referidos...</span>
                  </div>
                ) : paginatedReferralUsers.length > 0 ? (
                  <table className="lb-table referral-lb-table">
                    <thead>
                      <tr>
                        <th style={{ width: '70px', textAlign: 'center' }}>POS</th>
                        <th style={{ textAlign: 'left' }}>JUGADOR</th>
                        <th style={{ width: '180px', textAlign: 'center' }}>AMIGOS ACTIVOS</th>
                        <th style={{ width: '200px', textAlign: 'right' }}>RANGO DE EMBAJADOR</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paginatedReferralUsers.map((usr) => (
                        <tr key={`${usr.rank}-${usr.username}`} className={usr.isCurrentUser ? 'lb-row--user' : ''}>
                          <td className="lb-col-rank" style={{ textAlign: 'center', fontWeight: 900 }}>
                            {usr.rank === 1 ? '🥇 #1' : usr.rank === 2 ? '🥈 #2' : usr.rank === 3 ? '🥉 #3' : `#${usr.rank}`}
                          </td>
                          <td className="lb-col-player">
                            <div className="lb-player-cell" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                              <img
                                src={getPlayerAvatarUrl(usr.avatar)}
                                alt={usr.username}
                                className="lb-avatar-circle"
                                onError={(e) => {
                                  e.currentTarget.src = '/game-assets/greenfoot/peashooterpacket1.png'
                                }}
                              />
                              <span className={`lb-player-name ${usr.isCurrentUser && hasVipPass ? 'vip-gold-text' : ''}`}>
                                {usr.isCurrentUser && hasVipPass && '👑 '}
                                {usr.username}
                                {usr.isCurrentUser && <span className="user-self-badge" style={{ marginLeft: '6px' }}>TÚ</span>}
                              </span>
                            </div>
                          </td>
                          <td style={{ textAlign: 'center', fontWeight: 900, color: '#38bdf8', fontSize: '12px' }}>
                            👥 {usr.referredCount} Amigos
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <span className="referral-tier-pill">{usr.tierBadge}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="leaderboard-few-users-note">
                    {referralSearch ? (
                      <span>🔎 No se encontraron referidores con "{referralSearch}".</span>
                    ) : (
                      <span>🌱 Aún no hay líderes de referidos registrados en esta temporada. ¡Sé el primero en invitar!</span>
                    )}
                  </div>
                )}
              </div>

              {/* BARRA DE PAGINACIÓN REFERIDOS */}
              <div className="leaderboard-pagination">
                <div className="pagination-info">
                  <span>
                    {totalReferralCount === 0
                      ? '0 referidores'
                      : `Mostrando ${referralStartIdx} - ${referralEndIdx} de ${totalReferralCount} referidores`}
                  </span>
                </div>

                {totalReferralPages > 1 && (
                  <div className="pagination-controls">
                    <button
                      type="button"
                      className="pagination-btn pagination-btn--nav"
                      disabled={currentReferralPage <= 1}
                      onClick={() => handleReferralPageChange(1)}
                      title="Primera página"
                    >
                      ««
                    </button>
                    <button
                      type="button"
                      className="pagination-btn pagination-btn--nav"
                      disabled={currentReferralPage <= 1}
                      onClick={() => handleReferralPageChange(currentReferralPage - 1)}
                      title="Página anterior"
                    >
                      ‹ Ant
                    </button>

                    <div className="pagination-pages">
                      {generatePageNumbers(currentReferralPage, totalReferralPages).map((p, idx) =>
                        p === '...' ? (
                          <span key={`dots-ref-${idx}`} className="pagination-dots">…</span>
                        ) : (
                          <button
                            key={`page-ref-${p}`}
                            type="button"
                            className={`pagination-btn ${p === currentReferralPage ? 'pagination-btn--active' : ''}`}
                            onClick={() => handleReferralPageChange(Number(p))}
                          >
                            {p}
                          </button>
                        )
                      )}
                    </div>

                    <button
                      type="button"
                      className="pagination-btn pagination-btn--nav"
                      disabled={currentReferralPage >= totalReferralPages}
                      onClick={() => handleReferralPageChange(currentReferralPage + 1)}
                      title="Página siguiente"
                    >
                      Sig ›
                    </button>
                    <button
                      type="button"
                      className="pagination-btn pagination-btn--nav"
                      disabled={currentReferralPage >= totalReferralPages}
                      onClick={() => handleReferralPageChange(totalReferralPages)}
                      title="Última página"
                    >
                      »»
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* INSPECTION MODAL */}
      {selectedInspectUser && (
        <div className="lb-modal-backdrop" onClick={() => setSelectedInspectUser(null)}>
          <div className="lb-inspect-modal" onClick={(e) => e.stopPropagation()}>
            <div className="lb-modal-header">
              <h3 className="lb-modal-title">🔍 PERFIL DE JUGADOR</h3>
              <button
                type="button"
                className="lb-modal-close"
                onClick={() => setSelectedInspectUser(null)}
              >
                ✕
              </button>
            </div>

            <div className="lb-modal-body">
              {/* User Hero Row */}
              <div className="lb-modal-user-bar">
                <div className="lb-modal-avatar-box">
                  <img
                    src={selectedInspectUser.avatar}
                    alt={selectedInspectUser.username}
                    className="lb-modal-avatar"
                    onError={(e) => {
                      e.currentTarget.src = '/game-assets/greenfoot/peashooterpacket1.png'
                    }}
                  />
                  <span className="lb-modal-rank-badge">#{selectedInspectUser.rank}</span>
                </div>
                <div className="lb-modal-user-info">
                  <h4 className="lb-modal-username">
                    {selectedInspectUser.username}
                    {selectedInspectUser.isCurrentUser && <span className="user-self-badge">TÚ</span>}
                  </h4>
                  <div className="lb-modal-badges">
                    <span className="lb-modal-arena-tag">📍 {selectedInspectUser.arenaName}</span>
                    <span className="lb-modal-clan-tag">🛡️ {selectedInspectUser.clan}</span>
                  </div>
                </div>
              </div>

              {/* Stats Grid */}
              <div className="lb-modal-stats-grid">
                <div className="lb-stat-card">
                  <span className="lb-stat-label">Copas ELO</span>
                  <strong className="lb-stat-value lb-stat-value--gold">
                    🏆 {selectedInspectUser.elo}
                  </strong>
                </div>
                <div className="lb-stat-card">
                  <span className="lb-stat-label">Win Rate</span>
                  <strong className="lb-stat-value lb-stat-value--green">
                    {selectedInspectUser.winRate}
                  </strong>
                </div>
                <div className="lb-stat-card">
                  <span className="lb-stat-label">Victorias</span>
                  <strong className="lb-stat-value">
                    ⚔️ {selectedInspectUser.wins} V
                  </strong>
                </div>
                <div className="lb-stat-card">
                  <span className="lb-stat-label">Récord de Combate</span>
                  <strong className="lb-stat-value lb-stat-value--sub">
                    {selectedInspectUser.wins}V / {selectedInspectUser.losses}D ({selectedInspectUser.totalGames} comb.)
                  </strong>
                </div>
              </div>

              {/* Signature Plant */}
              <div className="lb-modal-plant-section">
                <div className="lb-modal-section-title">🌿 PLANTA FIRMA EN CAMPO</div>
                <div className="lb-modal-plant-card">
                  <img
                    src={selectedInspectUser.bestPlantImg}
                    alt={selectedInspectUser.bestPlantName}
                    className="lb-modal-plant-img"
                    onError={(e) => {
                      e.currentTarget.src = '/game-assets/greenfoot/transparentsunflower.png'
                    }}
                  />
                  <div className="lb-modal-plant-details">
                    <div className="lb-modal-plant-name">{selectedInspectUser.bestPlantName}</div>
                    <div className="lb-modal-plant-cost">
                      ☀️ {PLANT_CONFIGS[selectedInspectUser.bestPlantId]?.cost ?? 100} Soles
                      <span className="lb-modal-plant-category">
                        {PLANT_CONFIGS[selectedInspectUser.bestPlantId]?.category ?? 'Combatiente'}
                      </span>
                    </div>
                    <p className="lb-modal-plant-desc">
                      {PLANT_CONFIGS[selectedInspectUser.bestPlantId]?.description ??
                        'Planta favorita desplegada con frecuencia en las arenas competitivas.'}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="lb-modal-footer">
              <button
                type="button"
                className="game-button lb-modal-btn"
                onClick={() => setSelectedInspectUser(null)}
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
