import React, { useState } from 'react'
import './UpdateModal.css'

export interface UpdateModalProps {
  isOpen: boolean
  isBattle?: boolean
  countdownSeconds?: number | null
  onReload: () => void
}

export const UpdateModal: React.FC<UpdateModalProps> = ({
  isOpen,
  isBattle = false,
  countdownSeconds = null,
  onReload,
}) => {
  const [isReloading, setIsReloading] = useState(false)

  if (!isOpen) return null

  const handleReloadClick = () => {
    setIsReloading(true)
    onReload()
  }

  // Si está en plena batalla, mostrar un banner superior discreto para no interrumpir la jugada
  if (isBattle) {
    return (
      <div className="update-battle-banner" role="status" aria-live="polite">
        <span className="update-battle-banner__icon">🔄</span>
        <span className="update-battle-banner__text">
          <strong>¡Actualización disponible!</strong> Se recargará al terminar la partida.
        </span>
        <button
          type="button"
          className="update-battle-banner__btn"
          onClick={handleReloadClick}
          disabled={isReloading}
        >
          {isReloading ? 'Recargando...' : 'Recargar'}
        </button>
      </div>
    )
  }

  // Fuera de batalla (menú, landing, colecciones, etc.): Ventana emergente (Modal Popup)
  return (
    <div
      className="update-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="update-modal-title"
    >
      <div className="update-modal-card">
        {/* Icono animado */}
        <div className="update-icon-wrapper">
          <span className="update-icon-spin">🔄</span>
        </div>

        {/* Badge de estado */}
        <div className="update-badge">
          <span className="update-badge-dot" />
          <span>Nueva Versión Disponible</span>
        </div>

        {/* Encabezado y texto */}
        <div className="update-header-info">
          <h2 id="update-modal-title" className="update-title">
            ¡Actualización del Juego!
          </h2>
          <p className="update-description">
            Hemos publicado una nueva versión de <strong>Plant Arena</strong> con mejoras y novedades.
            Por favor, <strong>recarga el juego</strong> para continuar disfrutando de la mejor experiencia.
          </p>
        </div>

        {/* Detalles informativos */}
        <div className="update-notes-box">
          <div className="update-notes-item">
            <span>🌱</span>
            <span>Nuevos ajustes de cartas, balances y mejoras visuales.</span>
          </div>
          <div className="update-notes-item">
            <span>⚔️</span>
            <span>Sincronización necesaria para evitar errores en partidas PvP.</span>
          </div>
        </div>

        {/* Botón principal de recarga */}
        <button
          type="button"
          className="update-btn-reload"
          onClick={handleReloadClick}
          disabled={isReloading}
        >
          <span>🔄</span>
          <span>{isReloading ? 'Recargando juego...' : 'Recargar Juego Ahora'}</span>
        </button>

        {/* Indicador de cuenta atrás si está disponible */}
        {countdownSeconds !== null && countdownSeconds > 0 && !isReloading && (
          <span className="update-countdown-text">
            Recargando automáticamente en {countdownSeconds}s...
          </span>
        )}
      </div>
    </div>
  )
}

export default UpdateModal
