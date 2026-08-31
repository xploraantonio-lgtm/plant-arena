import React, { useEffect, useState } from 'react'
import { SeasonManager, type SeasonStatus } from '../../utils/seasonManager'
import { soundManager } from '../../utils/audioManager'
import './BetaPhaseModal.css'

export interface BetaPhaseModalProps {
  isOpen: boolean
  onClose: () => void
  onPlayNow?: () => void
}

export const BetaPhaseModal: React.FC<BetaPhaseModalProps> = ({
  isOpen,
  onClose,
  onPlayNow,
}) => {
  const [seasonStatus, setSeasonStatus] = useState<SeasonStatus>(() =>
    SeasonManager.getSeasonStatus()
  )

  useEffect(() => {
    if (!isOpen) return

    // Sincronizar y actualizar el cronómetro cada segundo mientras la ventana esté visible
    setSeasonStatus(SeasonManager.getSeasonStatus())
    const timerInterval = setInterval(() => {
      setSeasonStatus(SeasonManager.getSeasonStatus())
    }, 1000)

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        soundManager.playSound('click', 0.5)
        localStorage.setItem('plant_arena_beta_phase_seen_v1', 'true')
        onClose()
      } else if (e.key === 'Enter') {
        soundManager.playSound('victory', 0.8)
        localStorage.setItem('plant_arena_beta_phase_seen_v1', 'true')
        onClose()
        if (onPlayNow) onPlayNow()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      clearInterval(timerInterval)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, onClose, onPlayNow])

  if (!isOpen) return null

  const handleStartPlaying = () => {
    soundManager.playSound('victory', 0.8)
    localStorage.setItem('plant_arena_beta_phase_seen_v1', 'true')
    onClose()
    if (onPlayNow) onPlayNow()
  }

  const handleDismiss = () => {
    soundManager.playSound('click', 0.5)
    localStorage.setItem('plant_arena_beta_phase_seen_v1', 'true')
    onClose()
  }

  return (
    <div
      className="beta-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="beta-modal-title"
      onClick={handleDismiss}
    >
      <div className="beta-modal-card" onClick={(e) => e.stopPropagation()}>
        {/* Botón cerrar */}
        <button
          type="button"
          className="beta-modal-close-btn"
          onClick={handleDismiss}
          aria-label="Cerrar modal"
          title="Cerrar"
        >
          ✕
        </button>

        {/* Encabezado y Badge superior */}
        <div className="beta-modal-top-section">
          <div className="beta-modal-top-badge">
            <span className="beta-modal-top-badge-dot" />
            <span>⭐ FASE BETA OFICIAL ⭐</span>
          </div>

          <div className="beta-modal-hero-icon">
            <span className="beta-modal-trophy">🏆</span>
            <span className="beta-modal-sparkles">✨</span>
          </div>

          <div className="beta-modal-header">
            <h2 id="beta-modal-title" className="beta-modal-title">
              ¡BIENVENIDO A LA FASE BETA!
            </h2>
            <p className="beta-modal-season-name">
              🔥 TEMPORADA 1: <strong>REBELIÓN BOTÁNICA</strong>
            </p>
          </div>
        </div>

        {/* Banner de Contador de Temporada */}
        <div className="beta-modal-timer-card">
          <div className="beta-modal-timer-left">
            <span className="beta-modal-timer-icon">⏳</span>
            <div className="beta-modal-timer-info">
              <div className="beta-modal-timer-label">DURACIÓN DE LA TEMPORADA</div>
              <div className="beta-modal-timer-sub">Cronómetro oficial: 45 Días</div>
            </div>
          </div>
          <div className="beta-modal-timer-countdown">
            {seasonStatus.formattedCountdown}
          </div>
        </div>

        {/* Lista de Novedades y Reglas de la Beta */}
        <div className="beta-modal-features">
          <div className="beta-modal-feature-item">
            <div className="beta-modal-feature-icon">👑</div>
            <div className="beta-modal-feature-content">
              <strong>Ranking ELO Reiniciado (1,000 Copas)</strong>
              <span>Todos los jugadores comienzan desde la misma base para una competencia 100% justa.</span>
            </div>
          </div>

          <div className="beta-modal-feature-item">
            <div className="beta-modal-feature-icon">🎁</div>
            <div className="beta-modal-feature-content">
              <strong>Sobres PvP & Desbloqueo en el Jardín</strong>
              <span>Gana cofres en Ranked, canjea códigos de creadores y desbloquéalos a tu ritmo.</span>
            </div>
          </div>

          <div className="beta-modal-feature-item">
            <div className="beta-modal-feature-icon">🛡️</div>
            <div className="beta-modal-feature-content">
              <strong>Clanes, Coliseo y Premios Oficiales</strong>
              <span>Forma alianzas, acumula victorias de guerra y escala a las Arenas Legendarias.</span>
            </div>
          </div>
        </div>

        {/* Acciones */}
        <div className="beta-modal-actions">
          <button
            type="button"
            className="beta-modal-btn-play"
            onClick={handleStartPlaying}
          >
            <span className="beta-modal-btn-icon">⚔️</span>
            <span>¡EMPEZAR A JUGAR AHORA!</span>
          </button>
        </div>
      </div>
    </div>
  )
}

export default BetaPhaseModal
