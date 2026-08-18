import { useState } from 'react'
import { soundManager } from '../../utils/audioManager'
import './AuthModal.css'

interface AuthModalProps {
  isOpen: boolean
  onClose: () => void
  onSignInGoogle?: () => Promise<{ success: boolean; error?: string }>
  onSendEmailOtp?: (email: string) => Promise<{ success: boolean; error?: string }>
  onVerifyEmailOtp?: (email: string, token: string, username?: string) => Promise<{ success: boolean; error?: string }>
  onSignInEmail?: (email: string, pass: string) => Promise<{ success: boolean; error?: string }>
  onSignUpEmail?: (email: string, pass: string, username: string) => Promise<{ success: boolean; error?: string }>
  onAdminLogin: (pass: string) => boolean
  onOpenAdminPanel: () => void
  onSuccessRedirect?: () => void
}

export default function AuthModal({
  isOpen,
  onClose,
  onSignInGoogle,
  onSendEmailOtp,
  onVerifyEmailOtp,
  onAdminLogin,
  onOpenAdminPanel,
  onSuccessRedirect,
}: AuthModalProps) {
  const [tab, setTab] = useState<'otp' | 'admin'>('otp')
  const [email, setEmail] = useState('')
  const [username, setUsername] = useState('')
  const [otpCode, setOtpCode] = useState('')
  const [otpSent, setOtpSent] = useState(false)
  const [adminPass, setAdminPass] = useState('')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  if (!isOpen) return null

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

  // STEP 1: SEND OTP CODE TO EMAIL
  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg(null)
    setSuccessMsg(null)
    if (!email || !email.includes('@')) {
      setErrorMsg('Por favor ingresa un correo electrónico válido.')
      return
    }

    if (!onSendEmailOtp) return
    setLoading(true)
    const res = await onSendEmailOtp(email)
    setLoading(false)

    if (res.success) {
      soundManager.playSound('click', 0.6)
      setOtpSent(true)
      setSuccessMsg(`✉️ ¡Código de 6 dígitos enviado a ${email}! Revisa tu bandeja de entrada o spam.`)
    } else {
      soundManager.playSound('error', 0.5)
      setErrorMsg(res.error || 'Error al enviar código al correo.')
    }
  }

  // STEP 2: VERIFY OTP CODE AND LOG IN
  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg(null)
    if (!otpCode || otpCode.trim().length < 6) {
      setErrorMsg('Ingresa el código de 6 dígitos completo.')
      return
    }

    if (!onVerifyEmailOtp) return
    setLoading(true)
    const res = await onVerifyEmailOtp(email, otpCode, username)
    setLoading(false)

    if (res.success) {
      soundManager.playSound('victory', 0.9)
      onClose()
      if (onSuccessRedirect) onSuccessRedirect()
    } else {
      soundManager.playSound('error', 0.5)
      setErrorMsg(res.error || 'Código incorrecto o expirado.')
    }
  }

  const handleAdminAuth = (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg(null)
    const ok = onAdminLogin(adminPass)
    if (ok) {
      soundManager.playSound('victory', 0.9)
      onClose()
      onOpenAdminPanel()
    } else {
      soundManager.playSound('error', 0.5)
      setErrorMsg('Contraseña de Administrador incorrecta.')
    }
  }

  return (
    <div className="auth-backdrop" onClick={onClose}>
      <div className="auth-card" onClick={(e) => e.stopPropagation()}>
        {/* HEADER */}
        <div className="auth-header">
          <div className="auth-header__title-row">
            <span className="auth-header__icon">🌱</span>
            <div>
              <h2>ACCESO SEGURO A PLANT ARENA</h2>
              <p className="auth-header__subtitle">
                {tab === 'admin'
                  ? 'Panel de control exclusivo de desarrollador'
                  : 'Inicia sesión con Google o código de verificación por correo'}
              </p>
            </div>
          </div>
          <button type="button" className="auth-close-btn" onClick={onClose}>
            ✕
          </button>
        </div>

        {/* TABS */}
        <div className="auth-tabs">
          <button
            type="button"
            className={`auth-tab ${tab === 'otp' ? 'auth-tab--active' : ''}`}
            onClick={() => {
              setTab('otp')
              setErrorMsg(null)
            }}
          >
            🎮 Jugador (Google / Correo)
          </button>
          <button
            type="button"
            className={`auth-tab auth-tab--admin ${tab === 'admin' ? 'auth-tab--active' : ''}`}
            onClick={() => {
              setTab('admin')
              setErrorMsg(null)
            }}
          >
            🛡️ Administrador
          </button>
        </div>

        {errorMsg && <div className="auth-error-box">{errorMsg}</div>}
        {successMsg && <div className="auth-success-box">{successMsg}</div>}

        {/* PLAYER FLOW (GOOGLE & EMAIL OTP) */}
        {tab === 'otp' && (
          <div className="auth-player-flow">
            {/* GOOGLE OAUTH */}
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
                  <span>o código a tu correo</span>
                </div>
              </div>
            )}

            {/* EMAIL OTP STEP 1 */}
            {!otpSent ? (
              <form className="auth-form" onSubmit={handleSendCode}>
                <div className="auth-input-group">
                  <label>Nombre de Usuario (IGN):</label>
                  <input
                    type="text"
                    placeholder="ej: PlantaMaster"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                  />
                </div>

                <div className="auth-input-group">
                  <label>Correo Electrónico:</label>
                  <input
                    type="email"
                    placeholder="ej: jugador@plantarena.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoFocus
                  />
                </div>

                <div className="auth-terms-hint">
                  🔒 <strong>Sin contraseñas difíciles:</strong> Te enviaremos un código seguro de 6 dígitos a tu correo para entrar directamente.
                </div>

                <button type="submit" className="auth-submit-btn" disabled={loading}>
                  {loading ? 'ENVIANDO CÓDIGO...' : 'ENVIAR CÓDIGO DE VERIFICACIÓN ✉️'}
                </button>
              </form>
            ) : (
              /* EMAIL OTP STEP 2 */
              <form className="auth-form" onSubmit={handleVerifyCode}>
                <div className="auth-otp-notice">
                  <span>Introduce el código de 6 dígitos enviado a:</span>
                  <strong>{email}</strong>
                </div>

                <div className="auth-input-group">
                  <label>Código de Verificación (6 dígitos):</label>
                  <input
                    type="text"
                    placeholder="123456"
                    value={otpCode}
                    maxLength={6}
                    onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                    className="auth-otp-input"
                    required
                    autoFocus
                  />
                </div>

                <button type="submit" className="auth-submit-btn" disabled={loading}>
                  {loading ? 'VALIDANDO...' : 'VALIDAR CÓDIGO Y ENTRAR AL JUEGO ➔'}
                </button>

                <button
                  type="button"
                  className="auth-resend-btn"
                  onClick={() => {
                    setOtpSent(false)
                    setOtpCode('')
                    setErrorMsg(null)
                    setSuccessMsg(null)
                  }}
                >
                  ← Cambiar correo o reenviar código
                </button>
              </form>
            )}
          </div>
        )}

        {/* ADMIN FORM */}
        {tab === 'admin' && (
          <form className="auth-form" onSubmit={handleAdminAuth}>
            <div className="auth-admin-badge">
              <span>🛡️ Acceso Exclusivo Desarrollador / Administrador</span>
            </div>
            <div className="auth-input-group">
              <label>Clave Maestra de Administrador:</label>
              <input
                type="password"
                placeholder="Ingresa clave de administrador"
                value={adminPass}
                onChange={(e) => setAdminPass(e.target.value)}
                required
                autoFocus
              />
            </div>
            <button type="submit" className="auth-submit-btn auth-submit-btn--admin">
              ABRIR PANEL DE CONTROL
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
