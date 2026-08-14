import { useState } from 'react'
import background from '../../assets/images/background.png'
import { soundManager } from '../../utils/audioManager'
import { ARENAS, getArenaForElo } from '../../utils/arenaManager'
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
  onBack: () => void
  onAddElo?: (delta: number) => void
}

export default function Ranking({ userElo, onBack, onAddElo }: RankingProps) {
  const [activeTab, setActiveTab] = useState<'arenas' | 'leaderboard'>('arenas')
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

  // Mocked Global Leaderboard Data with real collection plant sprites
  const leaderboardData: LeaderboardUser[] = [
    {
      rank: 1,
      username: 'Satoshi_Nakamoto',
      clan: '👑 [SOLAR_LEGENDS]',
      elo: 4850,
      wins: 182,
      losses: 18,
      winRate: '91%',
      arenaName: 'Olimpo de Leyendas',
      bestPlantName: 'Bonk Choy',
      bestPlantImg: '/game-assets/greenfoot/bonkchoy1.png',
    },
    {
      rank: 2,
      username: 'Plant_God_Web3',
      clan: '⚡ [CYBER_PLANTS]',
      elo: 4210,
      wins: 148,
      losses: 24,
      winRate: '86%',
      arenaName: 'Olimpo de Leyendas',
      bestPlantName: 'Melon-pult',
      bestPlantImg: '/game-assets/images/Plants/melon_pult.png',
    },
    {
      rank: 3,
      username: 'DragonMaster',
      clan: '🛡️ [ANTIGRAVITY_GUILD]',
      elo: userElo,
      wins: 58,
      losses: 12,
      winRate: '83%',
      arenaName: currentArena.name,
      bestPlantName: 'Jalapeño',
      bestPlantImg: '/game-assets/plants/jalapeno_hd.png',
      isCurrentUser: true,
    },
    {
      rank: 4,
      username: 'Jalapeno_Sniper',
      clan: '🔥 [FIRE_SNIPERS]',
      elo: 3680,
      wins: 95,
      losses: 30,
      winRate: '76%',
      arenaName: 'Coliseo Galáctico',
      bestPlantName: 'Jalapeño',
      bestPlantImg: '/game-assets/plants/jalapeno_hd.png',
    },
    {
      rank: 5,
      username: 'Iceberg_King',
      clan: '❄️ [FROST_GUILD]',
      elo: 2920,
      wins: 72,
      losses: 28,
      winRate: '72%',
      arenaName: 'Rascacielos Cyberpunk',
      bestPlantName: 'Iceberg Lettuce',
      bestPlantImg: '/game-assets/plants/iceberglettuce_hd.png',
    },
    {
      rank: 6,
      username: 'Aloe_Healer_PvP',
      clan: '💚 [HEALER_SQUAD]',
      elo: 2840,
      wins: 68,
      losses: 26,
      winRate: '72%',
      arenaName: 'Rascacielos Cyberpunk',
      bestPlantName: 'Aloe Vera',
      bestPlantImg: '/game-assets/plants/aloe_hd.png',
    },
    {
      rank: 7,
      username: 'Sunflower_Queen',
      clan: '☀️ [SUN_LORDS]',
      elo: 1810,
      wins: 42,
      losses: 25,
      winRate: '62%',
      arenaName: 'Desierto Nocturno',
      bestPlantName: 'Sunflower',
      bestPlantImg: '/game-assets/greenfoot/transparentsunflower.png',
    },
    {
      rank: 8,
      username: 'BonkChoy_Pro',
      clan: '🥊 [MELEE_KINGS]',
      elo: 1480,
      wins: 35,
      losses: 22,
      winRate: '61%',
      arenaName: 'Jardín Clásico',
      bestPlantName: 'Bonk Choy',
      bestPlantImg: '/game-assets/greenfoot/bonkchoy1.png',
    },
    {
      rank: 9,
      username: 'Threepeater_God',
      clan: '🌿 [TRIPLE_SHOT]',
      elo: 1250,
      wins: 28,
      losses: 20,
      winRate: '58%',
      arenaName: 'Jardín Clásico',
      bestPlantName: 'Threepeater',
      bestPlantImg: '/game-assets/greenfoot/threepeater1.png',
    },
  ].sort((a, b) => b.elo - a.elo).map((item, idx) => ({ ...item, rank: idx + 1 }))

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
                      ) : userElo >= previewArena.minElo ? (
                        <span className="arena-badge arena-badge--unlocked">✨ ARENA DESBLOQUEADA</span>
                      ) : (
                        <span className="arena-badge arena-badge--locked">🔒 REQUIERE {previewArena.minElo} 🏆 COPAS</span>
                      )}
                      <span className="arena-hero-range">
                        🏆 {previewArena.minElo} - {previewArena.maxElo >= 9000 ? '∞' : previewArena.maxElo} Copas
                      </span>
                    </div>

                    <div className="arena-hero-body">
                      <h2 className="arena-hero-title">{previewArena.name}</h2>
                      <p className="arena-hero-tagline">{previewArena.tagline}</p>
                    </div>

                    {/* TROPHY PROGRESSION BAR */}
                    <div className="arena-hero-progress-box">
                      <div className="arena-hero-progress-info">
                        <span>PROGRESO AL SIGUIENTE NIVEL DE LIGA:</span>
                        <strong>
                          🏆 {userElo} / {nextArena ? `${nextArena.minElo} COPAS` : 'MÁXIMO ALCANZADO'}
                        </strong>
                      </div>
                      <div className="arena-hero-progress-bar">
                        <div
                          className="arena-hero-progress-fill"
                          style={{ width: `${eloProgressPct}%` }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* RIGHT SIDE: ARENA TIMELINE ROAD NODES (1 -> 5) */}
              <div className="arena-timeline-box">
                <h3 className="arena-timeline-title">📍 MAPA DE PROGRESIÓN (TOCAR PARA INSPECCIONAR)</h3>
                <div className="arena-timeline-list">
                  {ARENAS.map((arena) => {
                    const isCurrent = arena.id === currentArena.id
                    const isSelected = arena.id === previewArenaId
                    const isUnlocked = userElo >= arena.minElo

                    return (
                      <div
                        key={arena.id}
                        className={`timeline-node ${isCurrent ? 'timeline-node--current' : isUnlocked ? 'timeline-node--unlocked' : 'timeline-node--locked'} ${isSelected ? 'timeline-node--selected' : ''}`}
                        onClick={() => {
                          soundManager.playSound('click', 0.5)
                          setPreviewArenaId(arena.id)
                        }}
                      >
                        <div className="timeline-node__num">
                          {isCurrent ? '📍' : isUnlocked ? '✨' : '🔒'} {arena.id}
                        </div>
                        <div className="timeline-node__info">
                          <span className="timeline-node__name">{arena.name}</span>
                          <span className="timeline-node__elo">🏆 {arena.minElo} Copas</span>
                        </div>
                        {isCurrent && <span className="timeline-node__badge">ACTIVA</span>}
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
                    <span className="podium-name">
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
                          <strong>{usr.username}</strong>
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
      </div>
    </div>
  )
}
