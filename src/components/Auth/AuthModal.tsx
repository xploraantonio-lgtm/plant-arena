import { useState } from 'react'
import { soundManager } from '../../utils/audioManager'
import './AuthModal.css'

interface AuthModalProps {
  isOpen: boolean
  onClose: () => void
  userEmail?: string | null
  needsPasswordSetup?: boolean
  onSignInGoogle?: () => Promise<{ success: boolean; error?: string }>
  onSignInEmail: (identifier: string, pass: string) => Promise<{ success: boolean; error?: string }>
  onSetUserPassword?: (newPassword: string) => Promise<{ success: boolean; error?: string }>
  onSuccessRedirect?: () => void
}

export default function AuthModal({
  isOpen,
  onClose,
  userEmail,
  needsPasswordSetup = false,
  onSignInGoogle,
  onSignInEmail,
  onSetUserPassword,
  onSuccessRedirect,
}: AuthModalProps) {
  // Login Form States
  const [loginIdentifier, setLoginIdentifier] = useState('')
  const [loginPassword, setLoginPassword] = useState('')

  // Set Password States (When Google OAuth validates for the first time)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordRegisteredSuccess, setPasswordRegisteredSuccess] = useState(false)

  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  if (!isOpen) return null

  // Google OAuth Login
  const handleGoogleLogin = async () => {
    if (!onSignInGoogle) return
    setErrorMsg(null)
    setLoading(true)
    const res = await onSignInGoogle()
    setLoading(false)
    if (!res.success) {
      setErrorMsg(res.error || 'Error al conectar con Google')
    }
  }

  // Handle Login with Email/Username + Password
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg(null)

    if (!loginIdentifier.trim() || !loginPassword) {
      setErrorMsg('Por favor ingresa tu usuario o correo y tu contraseña.')
      return
    }

    setLoading(true)
    const res = await onSignInEmail(loginIdentifier.trim(), loginPassword)
    setLoading(false)

    if (res.success) {
      soundManager.playSound('victory', 0.9)
      onClose()
      if (onSuccessRedirect) onSuccessRedirect()
    } else {
      soundManager.playSound('error', 0.5)
      setErrorMsg(res.error || 'Usuario o contraseña incorrectos.')
    }
  }

  // Handle Set Password (for Google User)
  const handleSavePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg(null)

    if (newPassword.length < 6) {
      setErrorMsg('La contraseña debe tener al menos 6 caracteres.')
      return
    }

    if (newPassword !== confirmPassword) {
      setErrorMsg('Las contraseñas no coinciden. Por favor verifícalas.')
      return
    }

    if (!onSetUserPassword) return
    setLoading(true)
    const res = await onSetUserPassword(newPassword)
    setLoading(false)

    if (res.success) {
      soundManager.playSound('victory', 0.9)
      setPasswordRegisteredSuccess(true)
    } else {
      soundManager.playSound('error', 0.5)
      setErrorMsg(res.error || 'Error al registrar la contraseña.')
    }
  }

  const handleFinishPasswordSetup = () => {
    setPasswordRegisteredSuccess(false)
    onClose()
    if (onSuccessRedirect) onSuccessRedirect()
  }

  return (
    <div className="auth-backdrop" onClick={onClose}>
      <div className="auth-card" onClick={(e) => e.stopPropagation()}>
        {/* HEADER */}
        <div className="auth-header">
          <div className="auth-header__title-row">
            <span className="auth-header__icon">🌱</span>
            <div>
              <h2>{needsPasswordSetup ? 'REGISTRAR CONTRASEÑA' : 'INICIAR SESIÓN'}</h2>
              <p className="auth-header__subtitle">
                {needsPasswordSetup
                  ? 'Crea una contraseña para ingresar con tu correo o Google'
                  : 'Ingresa a Plant Arena para guardar tu progreso'}
              </p>
            </div>
          </div>
          <button type="button" className="auth-close-btn" onClick={onClose}>
            ✕
          </button>
        </div>

        {errorMsg && <div className="auth-error-box">{errorMsg}</div>}

        {/* VIEW 1: SUCCESS CONFIRMATION AFTER PASSWORD SET */}
        {passwordRegisteredSuccess ? (
          <div className="auth-success-dialog">
            <div className="auth-success-dialog__icon">🎉</div>
            <h3 className="auth-success-dialog__title">¡CONTRASEÑA REGISTRADA CON ÉXITO!</h3>
            <p className="auth-success-dialog__desc">
              Tu contraseña ha sido guardada de forma segura. Ahora podrás entrar en cualquier momento usando <strong>Google</strong> o tu <strong>correo y contraseña</strong>.
            </p>
            <button type="button" className="auth-submit-btn" onClick={handleFinishPasswordSetup}>
              ⚔️ ENTRAR A LA ARENA ➔
            </button>
          </div>
        ) : needsPasswordSetup ? (
          /* VIEW 2: SET PASSWORD FORM FOR GOOGLE USER */
          <form className="auth-form" onSubmit={handleSavePassword}>
            <div className="auth-otp-notice">
              <span>Cuenta vinculada:</span>
              <strong>{userEmail || 'Tu cuenta de Google'}</strong>
            </div>

            <div className="auth-terms-hint">
              🔑 <strong>Registra una contraseña:</strong> Con ella podrás iniciar sesión directamente con tu correo o seguir usando Google con 1 clic.
            </div>

            <div className="auth-input-group">
              <label>Nueva Contraseña:</label>
              <input
                type="password"
                placeholder="Mínimo 6 caracteres"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                autoFocus
              />
            </div>

            <div className="auth-input-group">
              <label>Confirmar Contraseña:</label>
              <input
                type="password"
                placeholder="Repite la contraseña"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
              />
            </div>

            <button type="submit" className="auth-submit-btn" disabled={loading}>
              {loading ? 'GUARDANDO...' : 'GUARDAR CONTRASEÑA Y ENTRAR AL JUEGO ➔'}
            </button>
          </form>
        ) : (
          /* VIEW 3: STANDARD LOGIN MODAL */
          <div className="auth-standard-login">
            {/* GOOGLE SIGN IN BUTTON */}
            {onSignInGoogle && (
              <div className="auth-oauth-section">
                <button
                  type="button"
                  className="auth-google-btn"
                  onClick={handleGoogleLogin}
                  disabled={loading}
                >
                  <svg className="auth-google-icon" viewBox="0 0 24 24">
                    <path
                      fill="#4285F4"
                      d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 10.04 0 12s.45 3.82 1.25 5.42l4.03-3.15z"
                    />
                    <path
                      fill="#EA4335"
                      d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"
                    />
                  </svg>
                  <span>Continuar con Google</span>
                </button>

                <div className="auth-divider">
                  <span>o con correo y contraseña</span>
                </div>
              </div>
            )}

            {/* EMAIL / USERNAME & PASSWORD FORM */}
            <form className="auth-form" onSubmit={handleLogin}>
              <div className="auth-input-group">
                <label>Correo o Usuario:</label>
                <input
                  type="text"
                  placeholder="ej: jugador@gmail.com o tu_usuario"
                  value={loginIdentifier}
                  onChange={(e) => setLoginIdentifier(e.target.value)}
                  required
                  autoFocus
                />
              </div>

              <div className="auth-input-group">
                <label>Contraseña:</label>
                <input
                  type="password"
                  placeholder="••••••••"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  required
                />
              </div>

              <button type="submit" className="auth-submit-btn" disabled={loading}>
                {loading ? 'INGRESANDO...' : 'INICIAR SESIÓN ➔'}
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  )
}
