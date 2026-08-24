import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import background from '../../assets/images/background.png'
import { soundManager } from '../../utils/audioManager'
import { ARENAS, getArenaForElo } from '../../utils/arenaManager'
import { SupabaseService } from '../../services/supabaseService'
import { UserManager } from '../../utils/userManager'
import './Ranking.css'

import type { Database } from '../../types/database.types'

interface LeaderboardUser {
  rank: number
  username: string
  clan: string
  elo: number
  wins: number
  losses: number
  winRate: string
  arenaName: string
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
  clan: string
  referredCount: number
  earnedUsd: number
  tierBadge: string
  avatar: string
  isCurrentUser?: boolean
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
  const [userRank, setUserRank] = useState<number | null>(null)
  const [isLoadingLeaderboard, setIsLoadingLeaderboard] = useState<boolean>(true)
  const [leaderboardError, setLeaderboardError] = useState<string | null>(null)

  // Leaderboard pagination & search states
  const [leaderboardSearch, setLeaderboardSearch] = useState<string>('')
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
    const myUsername = (userProfile?.username || UserManager.getProfile().name || 'Guerrero').trim().toLowerCase()

    setIsLoadingLeaderboard(true)
    setLeaderboardError(null)

    SupabaseService.getGlobalLeaderboard()
      .then((profiles) => {
        const mapped: LeaderboardUser[] = profiles.map((p) => {
          const arena = getArenaForElo(p.elo_rating)
          const isMe = Boolean(
            (myId && p.id === myId) ||
            (p.username.trim().toLowerCase() === myUsername)
          )

          return {
            rank: p.rank_position,
            username: p.username,
            clan: '-',
            elo: p.elo_rating,
            wins: p.ranked_wins,
            losses: p.ranked_losses,
            winRate: p.ranked_win_rate,
            arenaName: arena.name,
            bestPlantName: 'Sunflower',
            bestPlantImg: '/game-assets/greenfoot/transparentsunflower.png',
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

    if (myId) {
      SupabaseService.getUserRank(myId)
        .then((r) => {
          setUserRank(r)
        })
        .catch(() => {
          setUserRank(null)
        })
    } else {
      setUserRank(null)
    }
  }, [userProfile?.id, userProfile?.username])

  useEffect(() => {
    let mounted = true
    const myUsername = (userProfile?.username || UserManager.getProfile().name || 'Guerrero').trim().toLowerCase()

    loadLeaderboard()

    // Cargar ranking real de referidos
    setIsLoadingReferrals(true)
    SupabaseService.myReferrals().then((refData) => {
      if (!mounted) return
      setIsLoadingReferrals(false)
      if (refData?.ranking && refData.ranking.length > 0) {
        const mapped: ReferralLeaderboardUser[] = refData.ranking.map((r) => {
          const isMe = Boolean(r.nombre && r.nombre.trim().toLowerCase() === myUsername)
          return {
            rank: r.puesto,
            username: r.nombre || 'Jugador',
            clan: '-',
            referredCount: r.validos,
            earnedUsd: r.validos * 1.0,
            tierBadge: r.validos >= 25 ? '👑 Embajador VIP' : r.validos >= 10 ? '⭐ Influencer' : r.validos >= 5 ? '🥉 Promotor' : '🌱 Iniciado',
            avatar: r.avatar || '/game-assets/greenfoot/transparentsunflower.png',
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
  }, [loadLeaderboard, userProfile, userElo])

  const leaderboardData = realLeaderboard

  // Ranked Table Filtered and Paginated
  const filteredTableUsers = useMemo(() => {
    const query = leaderboardSearch.trim().toLowerCase()
    if (!query) {
      // Sin búsqueda: podio se encarga de los primeros 3, tabla muestra los puestos 4 en adelante
      return leaderboardData.slice(3)
    }
    // Con búsqueda: busca entre todos los jugadores
    return leaderboardData.filter((u) => u.username.toLowerCase().includes(query))
  }, [leaderboardData, leaderboardSearch])

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
                <>
                  {/* TOP 3 PODIUM (solo visible cuando no hay búsqueda activa) */}
                  {!leaderboardSearch.trim() && (
                    <div className="leaderboard-podium">
                      {/* 2nd Place */}
                      {leaderboardData[1] ? (
                        <div className={`podium-card podium-card--silver ${leaderboardData[1].isCurrentUser ? 'podium-card--user' : ''}`}>
                          <span className="podium-rank">🥈 #2</span>
                          <span className={`podium-name ${leaderboardData[1].isCurrentUser && hasVipPass ? 'vip-gold-text' : ''}`}>
                            {leaderboardData[1].isCurrentUser && hasVipPass && '👑 '}
                            {leaderboardData[1].username} {leaderboardData[1].isCurrentUser && '(TÚ)'}
                          </span>
                          <span className="podium-clan">{leaderboardData[1].clan}</span>
                          <span className="podium-elo">🏆 {leaderboardData[1].elo} Copas</span>
                          <span className="podium-winrate" style={{ fontSize: '0.75rem', opacity: 0.85, marginTop: '2px' }}>
                            {leaderboardData[1].winRate} ({leaderboardData[1].wins}W / {leaderboardData[1].losses}L)
                          </span>
                          <div className="podium-best-plant">
                            <img src={leaderboardData[1].bestPlantImg} alt="" className="podium-plant-img" />
                            <span>{leaderboardData[1].bestPlantName}</span>
                          </div>
                        </div>
                      ) : (
                        <div className="podium-card podium-card--placeholder" />
                      )}

                      {/* 1st Place */}
                      {leaderboardData[0] && (
                        <div className={`podium-card podium-card--gold ${leaderboardData[0].isCurrentUser ? 'podium-card--user' : ''}`}>
                          <span className="podium-crown">👑</span>
                          <span className="podium-rank">🥇 #1 CAMPEÓN</span>
                          <span className={`podium-name ${leaderboardData[0].isCurrentUser && hasVipPass ? 'vip-gold-text' : ''}`}>
                            {leaderboardData[0].isCurrentUser && hasVipPass && '👑 '}
                            {leaderboardData[0].username} {leaderboardData[0].isCurrentUser && '(TÚ)'}
                          </span>
                          <span className="podium-clan">{leaderboardData[0].clan}</span>
                          <span className="podium-elo">🏆 {leaderboardData[0].elo} Copas</span>
                          <span className="podium-winrate" style={{ fontSize: '0.75rem', opacity: 0.85, marginTop: '2px' }}>
                            {leaderboardData[0].winRate} ({leaderboardData[0].wins}W / {leaderboardData[0].losses}L)
                          </span>
                          <div className="podium-best-plant">
                            <img src={leaderboardData[0].bestPlantImg} alt="" className="podium-plant-img" />
                            <span>{leaderboardData[0].bestPlantName}</span>
                          </div>
                        </div>
                      )}

                      {/* 3rd Place */}
                      {leaderboardData[2] ? (
                        <div className={`podium-card podium-card--bronze ${leaderboardData[2].isCurrentUser ? 'podium-card--user' : ''}`}>
                          <span className="podium-rank">🥉 #3</span>
                          <span className={`podium-name ${leaderboardData[2].isCurrentUser && hasVipPass ? 'vip-gold-text' : ''}`}>
                            {leaderboardData[2].isCurrentUser && hasVipPass && '👑 '}
                            {leaderboardData[2].username} {leaderboardData[2].isCurrentUser && '(TÚ)'}
                          </span>
                          <span className="podium-clan">{leaderboardData[2].clan}</span>
                          <span className="podium-elo">🏆 {leaderboardData[2].elo} Copas</span>
                          <span className="podium-winrate" style={{ fontSize: '0.75rem', opacity: 0.85, marginTop: '2px' }}>
                            {leaderboardData[2].winRate} ({leaderboardData[2].wins}W / {leaderboardData[2].losses}L)
                          </span>
                          <div className="podium-best-plant">
                            <img src={leaderboardData[2].bestPlantImg} alt="" className="podium-plant-img" />
                            <span>{leaderboardData[2].bestPlantName}</span>
                          </div>
                        </div>
                      ) : (
                        <div className="podium-card podium-card--placeholder" />
                      )}
                    </div>
                  )}

                  {/* TOOLBAR: BUSCADOR + SELECTOR DE ELEMENTOS */}
                  <div className="leaderboard-toolbar">
                    <div className="leaderboard-search-box">
                      <span className="leaderboard-search-icon">🔍</span>
                      <input
                        type="text"
                        className="leaderboard-search-input"
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
                          className="leaderboard-search-clear"
                          onClick={() => {
                            setLeaderboardSearch('')
                            setLeaderboardPage(1)
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
                          className={`leaderboard-size-btn ${leaderboardPageSize === size ? 'leaderboard-size-btn--active' : ''}`}
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
                        className={`leaderboard-size-btn ${leaderboardPageSize === 'all' ? 'leaderboard-size-btn--active' : ''}`}
                        onClick={() => {
                          soundManager.playSound('click', 0.2)
                          setLeaderboardPageSize('all')
                          setLeaderboardPage(1)
                        }}
                      >
                        Todos ({totalLeaderboardCount})
                      </button>
                    </div>
                  </div>

                  {/* RANKS 4+ LEADERBOARD TABLE (SCROLLABLE TABLE OF ALL USERS) */}
                  <div className="leaderboard-table-wrap" ref={leaderboardTableRef}>
                    {paginatedLeaderboardUsers.length > 0 ? (
                      <table className="leaderboard-table">
                        <thead>
                          <tr>
                            <th style={{ width: '50px' }}>POS</th>
                            <th>JUGADOR</th>
                            <th>CLAN</th>
                            <th>ARENA ACTUAL</th>
                            <th>PLANTA MÁS USADA</th>
                            <th style={{ textAlign: 'center' }}>COPAS ELO</th>
                            <th style={{ textAlign: 'right' }}>WIN RATE</th>
                          </tr>
                        </thead>
                        <tbody>
                          {paginatedLeaderboardUsers.map((usr) => (
                            <tr key={`${usr.rank}-${usr.username}`} className={usr.isCurrentUser ? 'row--user' : ''}>
                              <td className="col-rank">#{usr.rank}</td>
                              <td className="col-user">
                                <strong className={usr.isCurrentUser && hasVipPass ? 'vip-gold-text' : ''}>
                                  {usr.isCurrentUser && hasVipPass && '👑 '}
                                  {usr.username}
                                </strong>
                                {usr.isCurrentUser && <span className="user-self-badge">TÚ</span>}
                              </td>
                              <td className="col-clan">{usr.clan}</td>
                              <td className="col-arena">{usr.arenaName}</td>
                              <td className="col-bestplant">
                                <span className="bestplant-pill">
                                  <img src={usr.bestPlantImg} alt={usr.bestPlantName} className="bestplant-img" />
                                  <span>{usr.bestPlantName}</span>
                                </span>
                              </td>
                              <td className="col-elo" style={{ textAlign: 'center' }}>
                                🏆 {usr.elo}
                              </td>
                              <td className="col-winrate" style={{ textAlign: 'right' }}>
                                <span className="winrate-badge">{usr.winRate}</span>
                                <span className="winrate-sub">({usr.wins}W / {usr.losses}L)</span>
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
                          <span>⭐ Mostrando {leaderboardData.length} {leaderboardData.length === 1 ? 'jugador registrado' : 'jugadores registrados'} en el podio.</span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* BARRA DE PAGINACIÓN */}
                  <div className="leaderboard-pagination">
                    <div className="pagination-info">
                      <span>
                        {totalLeaderboardCount === 0
                          ? '0 jugadores'
                          : `Mostrando ${leaderboardStartIdx} - ${leaderboardEndIdx} de ${totalLeaderboardCount} jugadores`}
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

                  {/* STICKY BOTTOM USER POSITION (IF NOT IN TOP LIST) */}
                  {!leaderboardData.some((u) => u.isCurrentUser) && (
                    <div className="leaderboard-my-rank-banner">
                      <div className="my-rank-left">
                        <span className="my-rank-pos">
                          {userProfile?.exclude_from_ranking || userRank === null ? '—' : `#${userRank}`}
                        </span>
                        <div className="my-rank-user">
                          <strong className={hasVipPass ? 'vip-gold-text' : ''}>
                            {hasVipPass && '👑 '}
                            {userProfile?.username || UserManager.getProfile().name || 'Guerrero'}
                          </strong>
                          <span className="user-self-badge">TÚ</span>
                        </div>
                      </div>
                      <div className="my-rank-mid">
                        <span className="my-rank-arena">📍 {currentArena.name}</span>
                      </div>
                      <div className="my-rank-right">
                        <span className="my-rank-elo">🏆 {userElo} Copas</span>
                      </div>
                    </div>
                  )}
                </>
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
                  <table className="leaderboard-table">
                    <thead>
                      <tr>
                        <th style={{ width: '60px' }}>POS</th>
                        <th>JUGADOR</th>
                        <th>CLAN</th>
                        <th style={{ textAlign: 'center' }}>AMIGOS ACTIVOS</th>
                        <th style={{ textAlign: 'center' }}>GANANCIAS (USD)</th>
                        <th style={{ textAlign: 'right' }}>RANGO DE EMBAJADOR</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paginatedReferralUsers.map((usr) => (
                        <tr key={`${usr.rank}-${usr.username}`} className={usr.isCurrentUser ? 'row--user' : ''}>
                          <td className="col-rank">
                            {usr.rank === 1 ? '🥇 #1' : usr.rank === 2 ? '🥈 #2' : usr.rank === 3 ? '🥉 #3' : `#${usr.rank}`}
                          </td>
                          <td className="col-user">
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <img
                                src={usr.avatar}
                                alt=""
                                style={{ width: '24px', height: '24px', borderRadius: '50%', objectFit: 'cover' }}
                              />
                              <strong className={usr.isCurrentUser && hasVipPass ? 'vip-gold-text' : ''}>
                                {usr.isCurrentUser && hasVipPass && '👑 '}
                                {usr.username}
                              </strong>
                              {usr.isCurrentUser && <span className="user-self-badge">TÚ</span>}
                            </div>
                          </td>
                          <td className="col-clan">{usr.clan}</td>
                          <td style={{ textAlign: 'center', fontWeight: 900, color: '#38bdf8' }}>
                            👥 {usr.referredCount} Amigos
                          </td>
                          <td style={{ textAlign: 'center', fontWeight: 900, color: '#4ade80' }}>
                            ${usr.earnedUsd.toFixed(2)} USD
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
    </div>
  )
}
