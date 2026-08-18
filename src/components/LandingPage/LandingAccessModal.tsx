import { useState } from 'react'
import { soundManager } from '../../utils/audioManager'
import './LandingAccessModal.css'

interface LandingAccessModalProps {
  isOpen: boolean
  onClose: () => void
  isLoggedIn: boolean
  onOpenAuth: () => void
  onProceedToGame: () => void
}

const ACCESS_CODE_SECRET = 'arena$$**'

export default function LandingAccessModal({
  isOpen,
  onClose,
  isLoggedIn,
  onOpenAuth,
  onProceedToGame,
}: LandingAccessModalProps) {
  const [inputCode, setInputCode] = useState('')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  if (!isOpen) return null

  const handleContinue = (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg(null)

    if (inputCode.trim() === ACCESS_CODE_SECRET) {
      soundManager.playSound('victory', 0.9)
      onClose()

      if (isLoggedIn) {
        onProceedToGame()
      } else {
        // Not logged in -> open Login / Register modal
        onOpenAuth()
      }
    } else {
      soundManager.playSound('error', 0.5)
      setErrorMsg('⚠️ Código de acceso incorrecto. Por favor introduce el código válido.')
    }
  }

  return (
    <div className="landing-access-backdrop" onClick={onClose}>
      <div className="landing-access-card" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="landing-access-close-btn" onClick={onClose}>
          ✕
        </button>

        <div className="landing-access-icon-wrapper">
          <span className="landing-access-icon">🚀</span>
        </div>

        <h2 className="landing-access-title">
          ¡ESTAMOS CARGANDO LA BASE DE DATOS!
        </h2>

        <p className="landing-access-subtitle">
          Muy pronto podrás guardar tu progreso y competir por premios en tiempo real.
        </p>

        <div className="landing-access-status-badge">
          <span>🔒 ACCESO ANTICIPADO EXCLUSIVO</span>
        </div>

        <form className="landing-access-form" onSubmit={handleContinue}>
          <div className="landing-access-input-box">
            <input
              type="text"
              placeholder="Ingresa el código de acceso"
              value={inputCode}
              onChange={(e) => setInputCode(e.target.value)}
              autoFocus
              className="landing-access-input"
            />
          </div>

          {errorMsg && <div className="landing-access-error">{errorMsg}</div>}

          <button type="submit" className="landing-access-submit-btn">
            CONTINUAR ➔
          </button>
        </form>

        <p className="landing-access-footer-hint">
          {isLoggedIn
            ? '✅ Sesión activa detectada. Al validar el código entrarás directo al juego.'
            : '💡 Si no tienes cuenta o sesión abierta, te pedirá registrarte al validar el código.'}
        </p>
      </div>
    </div>
  )
}
