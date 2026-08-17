import { useState } from 'react'
import type { ColosseumBetAmount, ColosseumLeaderboardEntry } from '../../types/game'
import { soundManager } from '../../utils/audioManager'
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

const MOCK_LEADERBOARD: ColosseumLeaderboardEntry[] = [
  { rank: 1, username: 'PlantMaster99', avatarPlant: 'repeater', maxStreak: 12, prizeGems: 20 },
  { rank: 2, username: 'CactusKing', avatarPlant: 'bonkchoy', maxStreak: 9, prizeGems: 10 },
  { rank: 3, username: 'PeaShooterPro', avatarPlant: 'threepeater', maxStreak: 7, prizeGems: 5 },
  { rank: 4, username: 'SolarPower', avatarPlant: 'twinsunflower', maxStreak: 6, prizeGems: 0 },
  { rank: 5, username: 'ViperSpike', avatarPlant: 'squash', maxStreak: 5, prizeGems: 0 },
  { rank: 6, username: 'IceQueen', avatarPlant: 'iceberglettuce', maxStreak: 5, prizeGems: 0 },
  { rank: 7, username: 'FlameStriker', avatarPlant: 'jalapeno', maxStreak: 4, prizeGems: 0 },
  { rank: 8, username: 'MelonLord', avatarPlant: 'melonpult', maxStreak: 4, prizeGems: 0 },
]

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
            <div className="colosseum-badge colosseum-badge--tickets" title="Tickets de Coliseo (Valen 0.5 💎)">
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
            {/* SALA 1: BRONCE (0.5 GEMAS / 1 TICKET) */}
            <div className="colosseum-room-card">
              <div className="colosseum-room-header">
                <span className="colosseum-room-badge colosseum-room-badge--bronze">BRONCE</span>
                <span className="colosseum-room-entry">Entrada: 0.5 💎</span>
              </div>

              <div className="colosseum-room-body">
                <div className="colosseum-room-pot-box">
                  <span className="colosseum-pot-label">Pozo Total en Juego:</span>
                  <span className="colosseum-pot-value">1.0 Gema 💎</span>
                </div>

                <div className="colosseum-room-payout-box">
                  <div className="colosseum-payout-row">
                    <span>🏆 Premio Ganador:</span>
                    <strong style={{ color: '#4ade80' }}>+0.8 Gemas 💎</strong>
                  </div>
                  <div className="colosseum-payout-row">
                    <span>🛡️ Rake Proyecto:</span>
                    <small>0.2 Gemas (20%)</small>
                  </div>
                </div>

                <div className="colosseum-room-actions">
                  {colosseumTickets > 0 && (
                    <button
                      type="button"
                      className="colosseum-action-btn colosseum-action-btn--ticket"
                      onClick={() => handleEnterRoom(0.5, true)}
                    >
                      <span>🎟️ ENTRAR CON TICKET</span>
                      <small>Tienes {colosseumTickets} {colosseumTickets === 1 ? 'ticket' : 'tickets'}</small>
                    </button>
                  )}

                  <button
                    type="button"
                    className="colosseum-action-btn colosseum-action-btn--gem"
                    onClick={() => handleEnterRoom(0.5, false)}
                    disabled={userTokens < 0.5}
                  >
                    <span>⚔️ JUGAR POR 0.5 GEMAS</span>
                  </button>
                </div>
              </div>
            </div>

            {/* SALA 2: PLATA (1.0 GEMA) */}
            <div className="colosseum-room-card">
              <div className="colosseum-room-header">
                <span className="colosseum-room-badge colosseum-room-badge--silver">PLATA</span>
                <span className="colosseum-room-entry">Entrada: 1.0 💎</span>
              </div>

              <div className="colosseum-room-body">
                <div className="colosseum-room-pot-box">
                  <span className="colosseum-pot-label">Pozo Total en Juego:</span>
                  <span className="colosseum-pot-value">2.0 Gemas 💎</span>
                </div>

                <div className="colosseum-room-payout-box">
                  <div className="colosseum-payout-row">
                    <span>🏆 Premio Ganador:</span>
                    <strong style={{ color: '#4ade80' }}>+1.6 Gemas 💎</strong>
                  </div>
                  <div className="colosseum-payout-row">
                    <span>🛡️ Rake Proyecto:</span>
                    <small>0.4 Gemas (20%)</small>
                  </div>
                </div>

                <div className="colosseum-room-actions">
                  <button
                    type="button"
                    className="colosseum-action-btn colosseum-action-btn--gem"
                    onClick={() => handleEnterRoom(1.0, false)}
                    disabled={userTokens < 1.0}
                  >
                    <span>⚔️ JUGAR POR 1.0 GEMA</span>
                  </button>
                </div>
              </div>
            </div>

            {/* SALA 3: ORO (2.0 GEMAS MÁXIMO) */}
            <div className="colosseum-room-card colosseum-room-card--gold">
              <div className="colosseum-room-header">
                <span className="colosseum-room-badge colosseum-room-badge--gold">ORO (MÁXIMO)</span>
                <span className="colosseum-room-entry">Entrada: 2.0 💎</span>
              </div>

              <div className="colosseum-room-body">
                <div className="colosseum-room-pot-box">
                  <span className="colosseum-pot-label">Pozo Total en Juego:</span>
                  <span className="colosseum-pot-value">4.0 Gemas 💎</span>
                </div>

                <div className="colosseum-room-payout-box">
                  <div className="colosseum-payout-row">
                    <span>🏆 Premio Ganador:</span>
                    <strong style={{ color: '#fbbf24' }}>+3.2 Gemas 💎</strong>
                  </div>
                  <div className="colosseum-payout-row">
                    <span>🛡️ Rake Proyecto:</span>
                    <small>0.8 Gemas (20%)</small>
                  </div>
                </div>

                <div className="colosseum-room-actions">
                  <button
                    type="button"
                    className="colosseum-action-btn colosseum-action-btn--gold"
                    onClick={() => handleEnterRoom(2.0, false)}
                    disabled={userTokens < 2.0}
                  >
                    <span>👑 JUGAR POR 2.0 GEMAS</span>
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
                  <strong className="colosseum-prize-amount">20 Gemas 💎</strong>
                </div>
                <div className="colosseum-prize-card colosseum-prize-card--2">
                  <span className="colosseum-prize-rank">🥈 TOP 2</span>
                  <strong className="colosseum-prize-amount">10 Gemas 💎</strong>
                </div>
                <div className="colosseum-prize-card colosseum-prize-card--3">
                  <span className="colosseum-prize-rank">🥉 TOP 3</span>
                  <strong className="colosseum-prize-amount">5 Gemas 💎</strong>
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
                  {MOCK_LEADERBOARD.map((row) => (
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
                  ))}
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
                        {maxStreak >= 12 ? '+20 💎' : maxStreak >= 9 ? '+10 💎' : maxStreak >= 7 ? '+5 💎' : '¡Sube tu racha!'}
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
            💡 <strong>¿Cómo conseguir Tickets de Coliseo?</strong> Aparecen al azar en sobres PvP/Tienda y recibes <strong>+1 Ticket y +1 Giro de Ruleta</strong> por cada Gema aportada a tu Clan.
          </div>
        </div>
      </div>
    </div>
  )
}
