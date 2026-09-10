import { useState, useEffect } from 'react'
import type { ColosseumBetAmount, ColosseumLeaderboardEntry } from '../../types/game'
import { soundManager } from '../../utils/audioManager'
import { colosseumService } from '../../services/colosseumService'
import './ColosseumModal.css'

interface ColosseumModalProps {
  isOpen: boolean
  onClose: () => void
  userTokens: number
  userElo: number
  colosseumTickets: number
  currentStreak: number
  maxStreak: number
  onStartColosseumMatch: (betGems: ColosseumBetAmount, usedTicket: boolean) => void
  onOpenShop?: () => void
}

export default function ColosseumModal({
  isOpen,
  onClose,
  userTokens,
  userElo,
  colosseumTickets,
  currentStreak,
  maxStreak,
  onStartColosseumMatch,
}: ColosseumModalProps) {
  const [activeTab, setActiveTab] = useState<'rooms' | 'leaderboard'>('rooms')
  const [realLeaderboard, setRealLeaderboard] = useState<ColosseumLeaderboardEntry[]>([])

  useEffect(() => {
    if (!isOpen) return
    let mounted = true
    colosseumService.getColosseumLeaderboard(50).then((profiles) => {
      if (!mounted) return
      const mapped: ColosseumLeaderboardEntry[] = profiles.map((p, idx) => ({
        rank: idx + 1,
        username: p.username,
        avatarPlant: (p.avatar_id as any) || 'peashooter',
        maxStreak: p.colosseum_max_streak,
        prizeGems: idx === 0 ? 2000 : idx === 1 ? 1000 : idx === 2 ? 500 : 0,
      }))
      setRealLeaderboard(mapped)
    })
    return () => {
      mounted = false
    }
  }, [isOpen])

  if (!isOpen) return null

  const handleEnterRoom = (bet: ColosseumBetAmount, useTicket: boolean) => {
    if (useTicket) {
      if (colosseumTickets <= 0) {
        alert('No tienes Tickets de Coliseo disponibles.')
        return
      }
    } else {
      if (userTokens < bet) {
        alert(`Gemas insuficientes. Necesitas ${bet} Gemas 💎 para entrar a esta sala.`)
        return
      }
    }

    soundManager.playSound('click', 0.5)
    onClose()
    onStartColosseumMatch(bet, useTicket)
  }

  return (
    <div className="colosseum-backdrop" onClick={onClose}>
      <div className="colosseum-modal-card" onClick={(e) => e.stopPropagation()}>
        {/* HEADER */}
        <div className="colosseum-header">
          <div className="colosseum-header__title-box">
            <span className="colosseum-header__icon">🏛️</span>
            <div>
              <h2 className="colosseum-header__title">COLISEO DE CAMPEONES</h2>
              <p className="colosseum-header__subtitle">
                Duelos PvP de alto nivel por Gemas 💎 y Tabla de Racha Consecutiva
              </p>
            </div>
          </div>

          <div className="colosseum-header__stats">
            <div className="colosseum-badge colosseum-badge--gems" title="Gemas Disponibles">
              <span>💎</span>
              <strong>{userTokens}</strong>
            </div>
            <div className="colosseum-badge colosseum-badge--tickets" title="Tickets de Coliseo (Valen 50 💎)">
              <span>🎟️</span>
              <strong>{colosseumTickets}</strong>
            </div>
            <div className="colosseum-badge colosseum-badge--elo" title="Copas ELO">
              <span>🏆</span>
              <strong>{userElo}</strong>
            </div>
            <button type="button" className="colosseum-close-btn" onClick={onClose}>
              ✕
            </button>
          </div>
        </div>

        {/* STREAK HERO BANNER */}
        <div className="colosseum-streak-banner">
          <div className="colosseum-streak-item colosseum-streak-item--current">
            <span className="colosseum-streak-icon">🔥</span>
            <div>
              <span className="colosseum-streak-label">RACHA ACTUAL</span>
              <strong className="colosseum-streak-value">{currentStreak} Victorias</strong>
            </div>
          </div>

          <div className="colosseum-streak-divider" />

          <div className="colosseum-streak-item colosseum-streak-item--record">
            <span className="colosseum-streak-icon">👑</span>
            <div>
              <span className="colosseum-streak-label">RÉCORD MÁXIMO DE TEMPORADA</span>
              <strong className="colosseum-streak-value">{maxStreak} Victorias</strong>
            </div>
          </div>

          <div className="colosseum-streak-note">
            ℹ️ Si pierdes, tu racha actual se reinicia pero tu <strong>Récord Máximo</strong> se mantiene para el Ranking.
          </div>
        </div>

        {/* TABS BAR */}
        <div className="colosseum-tabs">
          <button
            type="button"
            className={`colosseum-tab-btn ${activeTab === 'rooms' ? 'colosseum-tab-btn--active' : ''}`}
            onClick={() => {
              soundManager.playSound('click', 0.4)
              setActiveTab('rooms')
            }}
          >
            ⚔️ SALAS DE DUELO
          </button>
          <button
            type="button"
            className={`colosseum-tab-btn ${activeTab === 'leaderboard' ? 'colosseum-tab-btn--active' : ''}`}
            onClick={() => {
              soundManager.playSound('click', 0.4)
              setActiveTab('leaderboard')
            }}
          >
            🏆 TOP RACHAS & PREMIOS
          </button>
        </div>

        {/* TAB 1: SALAS DE DUELO */}
        {activeTab === 'rooms' && (
          <div className="colosseum-rooms-grid">
            {/* SALA 1: BRONCE (50 GEMAS / 1 TICKET) */}
            <div className="colosseum-room-card">
              <div className="colosseum-room-header">
                <span className="colosseum-room-badge colosseum-room-badge--bronze">BRONCE</span>
                <span className="colosseum-room-entry">Entrada: 50 💎</span>
              </div>

              <div className="colosseum-room-body">
                <div className="colosseum-room-pot-box">
                  <span className="colosseum-pot-label">Pozo Total en Juego:</span>
                  <span className="colosseum-pot-value">100 Gemas 💎</span>
                </div>

                <div className="colosseum-room-payout-box">
                  <div className="colosseum-payout-row">
                    <span>🏆 Premio Ganador:</span>
                    <strong style={{ color: '#4ade80' }}>+80 Gemas 💎</strong>
                  </div>
                  <div className="colosseum-payout-row">
                    <span>🛡️ Rake Proyecto:</span>
                    <small>20 Gemas (20%)</small>
                  </div>
                </div>

                <div className="colosseum-room-actions">
                  {colosseumTickets > 0 && (
                    <button
                      type="button"
                      className="colosseum-action-btn colosseum-action-btn--ticket"
                      onClick={() => handleEnterRoom(50, true)}
                    >
                      <span>🎟️ ENTRAR CON TICKET</span>
                      <small>Tienes {colosseumTickets} {colosseumTickets === 1 ? 'ticket' : 'tickets'}</small>
                    </button>
                  )}

                  <button
                    type="button"
                    className="colosseum-action-btn colosseum-action-btn--gem"
                    onClick={() => handleEnterRoom(50, false)}
                    disabled={userTokens < 50}
                  >
                    <span>⚔️ JUGAR POR 50 GEMAS</span>
                  </button>
                </div>
              </div>
            </div>

            {/* SALA 2: PLATA (100 GEMAS) */}
            <div className="colosseum-room-card">
              <div className="colosseum-room-header">
                <span className="colosseum-room-badge colosseum-room-badge--silver">PLATA</span>
                <span className="colosseum-room-entry">Entrada: 100 💎</span>
              </div>

              <div className="colosseum-room-body">
                <div className="colosseum-room-pot-box">
                  <span className="colosseum-pot-label">Pozo Total en Juego:</span>
                  <span className="colosseum-pot-value">200 Gemas 💎</span>
                </div>

                <div className="colosseum-room-payout-box">
                  <div className="colosseum-payout-row">
                    <span>🏆 Premio Ganador:</span>
                    <strong style={{ color: '#4ade80' }}>+160 Gemas 💎</strong>
                  </div>
                  <div className="colosseum-payout-row">
                    <span>🛡️ Rake Proyecto:</span>
                    <small>40 Gemas (20%)</small>
                  </div>
                </div>

                <div className="colosseum-room-actions">
                  <button
                    type="button"
                    className="colosseum-action-btn colosseum-action-btn--gem"
                    onClick={() => handleEnterRoom(100, false)}
                    disabled={userTokens < 100}
                  >
                    <span>⚔️ JUGAR POR 100 GEMAS</span>
                  </button>
                </div>
              </div>
            </div>

            {/* SALA 3: ORO (200 GEMAS MÁXIMO) */}
            <div className="colosseum-room-card colosseum-room-card--gold">
              <div className="colosseum-room-header">
                <span className="colosseum-room-badge colosseum-room-badge--gold">ORO (MÁXIMO)</span>
                <span className="colosseum-room-entry">Entrada: 200 💎</span>
              </div>

              <div className="colosseum-room-body">
                <div className="colosseum-room-pot-box">
                  <span className="colosseum-pot-label">Pozo Total en Juego:</span>
                  <span className="colosseum-pot-value">400 Gemas 💎</span>
                </div>

                <div className="colosseum-room-payout-box">
                  <div className="colosseum-payout-row">
                    <span>🏆 Premio Ganador:</span>
                    <strong style={{ color: '#fbbf24' }}>+320 Gemas 💎</strong>
                  </div>
                  <div className="colosseum-payout-row">
                    <span>🛡️ Rake Proyecto:</span>
                    <small>80 Gemas (20%)</small>
                  </div>
                </div>

                <div className="colosseum-room-actions">
                  <button
                    type="button"
                    className="colosseum-action-btn colosseum-action-btn--gold"
                    onClick={() => handleEnterRoom(200, false)}
                    disabled={userTokens < 200}
                  >
                    <span>👑 JUGAR POR 200 GEMAS</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: RANKING DE RACHAS */}
        {activeTab === 'leaderboard' && (
          <div className="colosseum-leaderboard-pane">
            <div className="colosseum-lb-promo">
              <div className="colosseum-lb-promo__header">
                <span className="colosseum-lb-promo__tag">🎁 PREMIOS DE TEMPORADA POR RACHA</span>
                <span className="colosseum-lb-promo__req">Mínimo 50 Participantes (48/50 activos)</span>
              </div>
              <div className="colosseum-prizes-cards-row">
                <div className="colosseum-prize-card colosseum-prize-card--1">
                  <span className="colosseum-prize-rank">🥇 TOP 1</span>
                  <strong className="colosseum-prize-amount">2000 Gemas 💎</strong>
                </div>
                <div className="colosseum-prize-card colosseum-prize-card--2">
                  <span className="colosseum-prize-rank">🥈 TOP 2</span>
                  <strong className="colosseum-prize-amount">1000 Gemas 💎</strong>
                </div>
                <div className="colosseum-prize-card colosseum-prize-card--3">
                  <span className="colosseum-prize-rank">🥉 TOP 3</span>
                  <strong className="colosseum-prize-amount">500 Gemas 💎</strong>
                </div>
              </div>
            </div>

            <div className="colosseum-lb-table-wrapper">
              <table className="colosseum-lb-table">
                <thead>
                  <tr>
                    <th>Puesto</th>
                    <th>Jugador</th>
                    <th>Racha Máxima</th>
                    <th>Premio Estimado</th>
                  </tr>
                </thead>
                <tbody>
                  {realLeaderboard.length === 0 ? (
                    <tr>
                      <td colSpan={4} style={{ textAlign: 'center', padding: '24px', color: '#94a3b8' }}>
                        🌱 Aún no hay rachas registradas esta temporada. ¡Sé el primer campeón en la cima!
                      </td>
                    </tr>
                  ) : (
                    realLeaderboard.map((row) => (
                      <tr key={row.rank} className={row.rank <= 3 ? `colosseum-lb-row--top${row.rank}` : ''}>
                        <td>
                          <span className="colosseum-lb-rank-badge">
                            {row.rank === 1 ? '🥇' : row.rank === 2 ? '🥈' : row.rank === 3 ? '🥉' : `#${row.rank}`}
                          </span>
                        </td>
                        <td>
                          <span className="colosseum-lb-user">
                            <strong>{row.username}</strong>
                          </span>
                        </td>
                        <td>
                          <span className="colosseum-lb-streak">🔥 {row.maxStreak} seguidas</span>
                        </td>
                        <td>
                          {row.prizeGems > 0 ? (
                            <span className="colosseum-lb-prize">+{row.prizeGems} 💎</span>
                          ) : (
                            <span style={{ color: '#94a3b8' }}>-</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                  {/* Fila del usuario */}
                  <tr className="colosseum-lb-row--user">
                    <td>
                      <span className="colosseum-lb-rank-badge">👤 TÚ</span>
                    </td>
                    <td>
                      <span className="colosseum-lb-user">
                        <strong>Tú ({userElo} 🏆)</strong>
                      </span>
                    </td>
                    <td>
                      <span className="colosseum-lb-streak" style={{ color: '#fbbf24' }}>
                        🔥 {maxStreak} seguidas
                      </span>
                    </td>
                    <td>
                      <span style={{ color: maxStreak >= 7 ? '#4ade80' : '#94a3b8' }}>
                        {maxStreak >= 12 ? '+2000 💎' : maxStreak >= 9 ? '+1000 💎' : maxStreak >= 7 ? '+500 💎' : '¡Sube tu racha!'}
                      </span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* FOOTER INFO */}
        <div className="colosseum-footer">
          <div className="colosseum-footer-ticket-hint">
            💡 <strong>¿Cómo conseguir Tickets de Coliseo?</strong> Aparecen al azar en sobres PvP/Tienda y recibes <strong>+1 Ticket y +1 Giro de Ruleta</strong> por cada 100 Gemas aportadas a tu Clan.
          </div>
        </div>
      </div>
    </div>
  )
}
