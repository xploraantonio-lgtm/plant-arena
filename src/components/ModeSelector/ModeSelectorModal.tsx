import { soundManager } from '../../utils/audioManager'
import './ModeSelectorModal.css'

interface ModeSelectorModalProps {
  isOpen: boolean
  onClose: () => void
  userElo: number
  userTokens: number
  colosseumTickets: number
  onSelectRanked: () => void
  onSelectColosseum: () => void
  onSelectTournament?: () => void
  onSelectFriendly?: () => void
}

export default function ModeSelectorModal({
  isOpen,
  onClose,
  userElo,
  userTokens,
  colosseumTickets,
  onSelectRanked,
  onSelectColosseum,
  onSelectTournament,
}: ModeSelectorModalProps) {
  if (!isOpen) return null

  const isColosseumUnlocked = userElo >= 1601
  const eloNeeded = Math.max(0, 1601 - userElo)

  const handleOpenTournament = () => {
    soundManager.playSound('click', 0.4)
    onClose()
    if (onSelectTournament) {
      onSelectTournament()
    }
  }

  return (
    <div className="mode-selector-backdrop" onClick={onClose}>
      <div className="mode-selector-card" onClick={(e) => e.stopPropagation()}>
        {/* HEADER */}
        <div className="mode-selector-header">
          <div className="mode-selector-title-box">
            <span className="mode-selector-icon">⚔️</span>
            <div>
              <h2 className="mode-selector-title">SELECCIONA MODO DE JUEGO</h2>
              <p className="mode-selector-subtitle">
                Tu Rango Actual: <strong>{userElo} 🏆</strong> | Saldo: <strong>{userTokens} 💎</strong> | Tickets: <strong>{colosseumTickets} 🎟️</strong>
              </p>
            </div>
          </div>
          <button type="button" className="mode-selector-close-btn" onClick={onClose}>
            ✕
          </button>
        </div>

        {/* 4 GAME MODES GRID */}
        <div className="mode-selector-grid-4">
          {/* 1. MODO RANKED */}
          <div
            className="mode-card mode-card--ranked"
            onClick={() => {
              soundManager.playSound('click', 0.5)
              onClose()
              onSelectRanked()
            }}
          >
            <div className="mode-card__badge mode-card__badge--free">GRATIS</div>
            <div className="mode-card__icon">🏆</div>
            <h3 className="mode-card__name">RANKED GLOBAL</h3>
            <p className="mode-card__desc">
              Escala en el ranking mundial por copas de ELO, desbloquea nuevas arenas y gana sobres de batalla en tus 4 slots.
            </p>
            <div className="mode-card__perks">
              <span>✅ 100% Gratuito e Ilimitado</span>
              <span>✅ Suma copas para el Ranking ELO</span>
              <span>✅ Gana sobres de batalla</span>
            </div>
            <button type="button" className="mode-card__action-btn mode-card__action-btn--ranked">
              ⚔️ JUGAR RANKED
            </button>
          </div>

          {/* 2. MODO AMISTOSO (BLOQUEADO TEMPORALMENTE) */}
          <div
            className="mode-card mode-card--friendly mode-card--locked"
            style={{ opacity: 0.8, cursor: 'not-allowed' }}
            onClick={() => {
              soundManager.playSound('click', 0.3)
            }}
          >
            <div className="mode-card__badge mode-card__badge--locked">🔒 EN AJUSTES</div>
            <div className="mode-card__icon">🔒</div>
            <h3 className="mode-card__name">DUELO AMISTOSO</h3>
            <p className="mode-card__desc">
              Reta a un amigo mediante código de sala privada para probar mazos sin arriesgar copas.
            </p>
            <div className="mode-card__perks">
              <span style={{ color: '#fbbf24' }}>⚙️ Modo temporalmente en ajuste</span>
              <span>🔒 Salas privadas con código PIN</span>
              <span>🛡️ Sin alteración de copas</span>
            </div>
            <button
              type="button"
              className="mode-card__action-btn mode-card__action-btn--disabled"
              disabled
            >
              🔒 PRÓXIMAMENTE
            </button>
          </div>

          {/* 3. MODO TORNEO */}
          <div className="mode-card mode-card--tournament" onClick={handleOpenTournament}>
            <div className="mode-card__badge mode-card__badge--dev">EVENTOS DEV</div>
            <div className="mode-card__icon">🎪</div>
            <h3 className="mode-card__name">TORNEOS OFICIALES</h3>
            <p className="mode-card__desc">
              Copas relámpago y torneos especiales creados y patrocinados por los desarrolladores con premios comunitarios.
            </p>
            <div className="mode-card__perks">
              <span>✅ Torneos de Fin de Semana</span>
              <span>✅ Brackets eliminatorios</span>
              <span>✅ Pozos de la comunidad</span>
            </div>
            <button type="button" className="mode-card__action-btn mode-card__action-btn--tournament">
              🎪 VER TORNEOS
            </button>
          </div>

          {/* 4. EL COLISEO (1601+ COPAS) */}
          <div
            className={`mode-card mode-card--colosseum ${!isColosseumUnlocked ? 'mode-card--locked' : ''}`}
            onClick={() => {
              if (isColosseumUnlocked) {
                soundManager.playSound('click', 0.5)
                onClose()
                onSelectColosseum()
              } else {
                soundManager.playSound('click', 0.3)
              }
            }}
          >
            <div
              className={`mode-card__badge ${
                isColosseumUnlocked ? 'mode-card__badge--comp' : 'mode-card__badge--locked'
              }`}
            >
              {isColosseumUnlocked ? '💎 COMPETITIVO' : '🔒 1,601 🏆'}
            </div>
            <div className="mode-card__icon">{isColosseumUnlocked ? '🏛️' : '🔒'}</div>
            <h3 className="mode-card__name">EL COLISEO</h3>
            <p className="mode-card__desc">
              Duelos PvP de alto nivel por Gemas 💎 y Tickets. El ganador se lleva el 80% del pozo y escala el Top de Rachas.
            </p>
            <div className="mode-card__perks">
              {isColosseumUnlocked ? (
                <>
                  <span>💎 Salas de 0.5, 1.0 y 2.0 Gemas</span>
                  <span>🎟️ Válido con Tickets de Coliseo ({colosseumTickets})</span>
                  <span>🔥 Top 1: 20 💎 | Top 2: 10 💎 | Top 3: 5 💎</span>
                </>
              ) : (
                <>
                  <span style={{ color: '#f87171' }}>🔒 Bloqueado: Requiere 1,601 🏆</span>
                  <span style={{ color: '#fbbf24' }}>Te faltan {eloNeeded} copas de ELO</span>
                  <span>Juega Ranked para desbloquearlo</span>
                </>
              )}
            </div>
            <button
              type="button"
              className={`mode-card__action-btn ${
                isColosseumUnlocked ? 'mode-card__action-btn--colosseum' : 'mode-card__action-btn--disabled'
              }`}
              disabled={!isColosseumUnlocked}
            >
              {isColosseumUnlocked ? '🏛️ ENTRAR AL COLISEO' : `🔒 BLOQUEADO (${eloNeeded} 🏆)`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
