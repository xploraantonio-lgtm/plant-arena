import { useState, useEffect } from 'react'
import background from '../../assets/images/background.png'
import { soundManager } from '../../utils/audioManager'
import { ARENAS, getArenaForElo } from '../../utils/arenaManager'
import { SupabaseService } from '../../services/supabaseService'
import { UserManager } from '../../utils/userManager'
import './Ranking.css'

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
  hasVipPass?: boolean
  onBack: () => void
  onAddElo?: (delta: number) => void
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

export default function Ranking({ userElo, hasVipPass = false, onBack, onAddElo }: RankingProps) {
  const [activeTab, setActiveTab] = useState<'arenas' | 'leaderboard' | 'referrals'>('arenas')
  const [isMuted, setIsMuted] = useState<boolean>(soundManager.isMuted())
  const [copiedLink, setCopiedLink] = useState(false)

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

  useEffect(() => {
    let mounted = true
    SupabaseService.getGlobalLeaderboard(50).then((profiles) => {
      if (!mounted) return
      const mapped: LeaderboardUser[] = profiles.map((p, idx) => {
        const arena = getArenaForElo(p.elo_rating)
        return {
          rank: idx + 1,
          username: p.username,
          clan: '-',
          elo: p.elo_rating,
          wins: 0,
          losses: 0,
          winRate: '100%',
          arenaName: arena.name,
          bestPlantName: 'Sunflower',
          bestPlantImg: '/game-assets/greenfoot/transparentsunflower.png',
        }
      })
      setRealLeaderboard(mapped)
    })

    return () => {
      mounted = false
    }
  }, [])

  const leaderboardData = realLeaderboard
  const filteredReferralLeaderboard: ReferralLeaderboardUser[] = []

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
          {onAddElo && (
            <button
              className="ranking-back-btn"
              type="button"
              style={{ background: 'linear-gradient(180deg, #ca8a04 0%, #a16207 100%)', borderColor: '#fef08a', padding: '4px 8px', fontSize: '10px' }}
              onClick={() => {
                onAddElo(100)
                soundManager.playSound('plantation', 0.8)
              }}
              title="Sumar +100 Copas de prueba para subir de Arena"
            >
              +100 🏆 TEST
            </button>
          )}
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
          🗺️ CAMINO DE ARENAS (ARENA ROAD)
        </button>
        <button
          type="button"
          className={`ranking-nav-tab ${activeTab === 'leaderboard' ? 'ranking-nav-tab--active' : ''}`}
          onClick={() => {
            soundManager.playSound('click', 0.5)
            setActiveTab('leaderboard')
          }}
        >
          🏆 CLASIFICACIÓN GLOBAL (LEADERBOARD)
        </button>
        <button
          type="button"
          className={`ranking-nav-tab ${activeTab === 'referrals' ? 'ranking-nav-tab--active' : ''}`}
          onClick={() => {
            soundManager.playSound('click', 0.5)
            setActiveTab('referrals')
          }}
        >
          👥 RANKING DE REFERIDOS ($ USD)
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
              {/* TOP 3 PODIUM */}
              <div className="leaderboard-podium">
                {/* 2nd Place */}
                {leaderboardData[1] && (
                  <div className="podium-card podium-card--silver">
                    <span className="podium-rank">🥈 #2</span>
                    <span className="podium-name">{leaderboardData[1].username}</span>
                    <span className="podium-clan">{leaderboardData[1].clan}</span>
                    <span className="podium-elo">🏆 {leaderboardData[1].elo} Copas</span>
                    <div className="podium-best-plant">
                      <img src={leaderboardData[1].bestPlantImg} alt="" className="podium-plant-img" />
                      <span>{leaderboardData[1].bestPlantName}</span>
                    </div>
                  </div>
                )}

                {/* 1st Place */}
                {leaderboardData[0] && (
                  <div className="podium-card podium-card--gold">
                    <span className="podium-crown">👑</span>
                    <span className="podium-rank">🥇 #1 CAMPEÓN</span>
                    <span className="podium-name">{leaderboardData[0].username}</span>
                    <span className="podium-clan">{leaderboardData[0].clan}</span>
                    <span className="podium-elo">🏆 {leaderboardData[0].elo} Copas</span>
                    <div className="podium-best-plant">
                      <img src={leaderboardData[0].bestPlantImg} alt="" className="podium-plant-img" />
                      <span>{leaderboardData[0].bestPlantName}</span>
                    </div>
                  </div>
                )}

                {/* 3rd Place */}
                {leaderboardData[2] && (
                  <div className={`podium-card podium-card--bronze ${leaderboardData[2].isCurrentUser ? 'podium-card--user' : ''}`}>
                    <span className="podium-rank">🥉 #3</span>
                    <span className={`podium-name ${leaderboardData[2].isCurrentUser && hasVipPass ? 'vip-gold-text' : ''}`}>
                      {leaderboardData[2].isCurrentUser && hasVipPass && '👑 '}
                      {leaderboardData[2].username} {leaderboardData[2].isCurrentUser && '(TÚ)'}
                    </span>
                    <span className="podium-clan">{leaderboardData[2].clan}</span>
                    <span className="podium-elo">🏆 {leaderboardData[2].elo} Copas</span>
                    <div className="podium-best-plant">
                      <img src={leaderboardData[2].bestPlantImg} alt="" className="podium-plant-img" />
                      <span>{leaderboardData[2].bestPlantName}</span>
                    </div>
                  </div>
                )}
              </div>

              {/* RANKS 4+ LEADERBOARD TABLE */}
              <div className="leaderboard-table-wrap">
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
                    {leaderboardData.slice(3).map((usr) => (
                      <tr key={usr.rank} className={usr.isCurrentUser ? 'row--user' : ''}>
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
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: REFERRAL LEADERBOARD */}
        {activeTab === 'referrals' && (
          <div className="ranking-tab-pane">
            <div className="referral-ranking-layout">
              {/* TOP SUMMARY BANNER */}
              <div className="referral-summary-banner">
                <div className="referral-summary-left">
                  <span className="referral-summary-tag">💰 PROGRAMA DE AFILIADOS & REFERIDOS</span>
                  <h3 className="referral-summary-title">Gana $1.00 USD por cada amigo que alcance 1000 Copas</h3>
                  <p className="referral-summary-sub">
                    Comparte tu enlace de invitación único y escala en la clasificación para obtener insignias exclusivas.
                  </p>
                </div>
                <div className="referral-summary-actions">
                  <button
                    type="button"
                    className="referral-copy-btn"
                    onClick={() => {
                      soundManager.playSound('click', 0.5)
                      navigator.clipboard?.writeText(window.location.origin + '/?ref=' + (UserManager.getProfile().referralCode || 'ARENA'))
                      setCopiedLink(true)
                      setTimeout(() => setCopiedLink(false), 2000)
                    }}
                  >
                    {copiedLink ? '✅ ¡ENLACE COPIADO!' : '📋 COPIAR MI ENLACE'}
                  </button>
                </div>
              </div>

              {/* REFERRAL LEADERBOARD TABLE */}
              <div className="leaderboard-table-wrap referral-table-wrap">
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
                    {filteredReferralLeaderboard.map((usr) => (
                      <tr key={usr.rank} className={usr.isCurrentUser ? 'row--user' : ''}>
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
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
