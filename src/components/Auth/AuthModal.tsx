import { useState } from 'react'
import { soundManager } from '../../utils/audioManager'
import './AuthModal.css'

interface AuthModalProps {
  isOpen: boolean
  onClose: () => void
  onSignInGoogle?: () => Promise<{ success: boolean; error?: string }>
  onSignInEmail: (identifier: string, pass: string) => Promise<{ success: boolean; error?: string }>
  onSignUpEmail: (email: string, pass: string, username: string) => Promise<{ success: boolean; error?: string }>
  onVerifySignupOtp?: (email: string, token: string, pass?: string, username?: string) => Promise<{ success: boolean; error?: string }>
  onSuccessRedirect?: () => void
}

export default function AuthModal({
  isOpen,
  onClose,
  onSignInGoogle,
  onSignInEmail,
  onSignUpEmail,
  onVerifySignupOtp,
  onSuccessRedirect,
}: AuthModalProps) {
  const [tab, setTab] = useState<'login' | 'register'>('login')

  // Login Form States
  const [loginIdentifier, setLoginIdentifier] = useState('')
  const [loginPassword, setLoginPassword] = useState('')

  // Register Form States
  const [regUsername, setRegUsername] = useState('')
  const [regEmail, setRegEmail] = useState('')
  const [regPassword, setRegPassword] = useState('')
  const [otpCode, setOtpCode] = useState('')
  const [isOtpSent, setIsOtpSent] = useState(false)

  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
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
    setSuccessMsg(null)

    if (!loginIdentifier.trim() || !loginPassword) {
      setErrorMsg('Por favor ingresa tu usuario/correo y contraseña.')
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

  // Handle Register Step 1: Submit data and request 6-digit OTP code
  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg(null)
    setSuccessMsg(null)

    if (!regUsername.trim() || !regEmail.trim() || !regPassword) {
      setErrorMsg('Por favor completa todos los campos.')
      return
    }

    if (!regEmail.includes('@')) {
      setErrorMsg('Por favor ingresa un correo electrónico válido.')
      return
    }

    if (regPassword.length < 6) {
      setErrorMsg('La contraseña debe tener al menos 6 caracteres.')
      return
    }

    setLoading(true)
    const res = await onSignUpEmail(regEmail.trim(), regPassword, regUsername.trim())
    setLoading(false)

    if (res.success) {
      soundManager.playSound('click', 0.6)
      setIsOtpSent(true)
      setSuccessMsg(`✉️ Hemos enviado un código de 6 dígitos a ${regEmail.trim()}.`)
    } else {
      soundManager.playSound('error', 0.5)
      setErrorMsg(res.error || 'Error al iniciar registro. Verifica los datos.')
    }
  }

  // Handle Register Step 2: Verify 6-digit OTP code and create permanent account
  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg(null)

    if (!otpCode || otpCode.trim().length < 6) {
      setErrorMsg('Ingresa el código de 6 dígitos completo.')
      return
    }

    if (!onVerifySignupOtp) return
    setLoading(true)
    const res = await onVerifySignupOtp(regEmail.trim(), otpCode.trim(), regPassword, regUsername.trim())
    setLoading(false)

    if (res.success) {
      soundManager.playSound('victory', 0.9)
      alert('¡Cuenta creada y verificada con éxito! Ya puedes jugar y entrar con tu contraseña.')
      onClose()
      if (onSuccessRedirect) onSuccessRedirect()
    } else {
      soundManager.playSound('error', 0.5)
      setErrorMsg(res.error || 'Código incorrecto o expirado.')
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
              <h2>PLANT ARENA</h2>
              <p className="auth-header__subtitle">
                {tab === 'login'
                  ? 'Inicia sesión con tu usuario y contraseña'
                  : 'Crea tu cuenta y valida tu correo'}
              </p>
            </div>
          </div>
          <button type="button" className="auth-close-btn" onClick={onClose}>
            ✕
          </button>
        </div>

        {/* TABS: LOGIN / REGISTER */}
        <div className="auth-tabs">
          <button
            type="button"
            className={`auth-tab ${tab === 'login' ? 'auth-tab--active' : ''}`}
            onClick={() => {
              setTab('login')
              setErrorMsg(null)
              setSuccessMsg(null)
            }}
          >
            Iniciar Sesión
          </button>
          <button
            type="button"
            className={`auth-tab ${tab === 'register' ? 'auth-tab--active' : ''}`}
            onClick={() => {
              setTab('register')
              setErrorMsg(null)
              setSuccessMsg(null)
            }}
          >
            Registrarse
          </button>
        </div>

        {errorMsg && <div className="auth-error-box">{errorMsg}</div>}
        {successMsg && <div className="auth-success-box">{successMsg}</div>}

        {/* GOOGLE SIGN IN BUTTON */}
        {onSignInGoogle && !isOtpSent && (
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
              <span>{tab === 'login' ? 'o con tu cuenta' : 'o registro con correo'}</span>
            </div>
          </div>
        )}

        {/* TAB 1: LOGIN (INICIAR SESIÓN CON USUARIO/CORREO Y CONTRASEÑA) */}
        {tab === 'login' && (
          <form className="auth-form" onSubmit={handleLogin}>
            <div className="auth-input-group">
              <label>Correo o Usuario:</label>
              <input
                type="text"
                placeholder="ej: jugador@plantarena.com o TuUsuario"
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
        )}

        {/* TAB 2: REGISTER (CREAR CUENTA + VALIDAR CORREO CON CÓDIGO) */}
        {tab === 'register' && (
          <div className="auth-register-flow">
            {!isOtpSent ? (
              /* PASO 1: FORMULARIO DE REGISTRO */
              <form className="auth-form" onSubmit={handleRegisterSubmit}>
                <div className="auth-input-group">
                  <label>Usuario:</label>
                  <input
                    type="text"
                    placeholder="ej: AgroMaster99"
                    value={regUsername}
                    onChange={(e) => setRegUsername(e.target.value)}
                    required
                    autoFocus
                  />
                </div>

                <div className="auth-input-group">
                  <label>Correo Electrónico:</label>
                  <input
                    type="email"
                    placeholder="ej: tu_correo@gmail.com"
                    value={regEmail}
                    onChange={(e) => setRegEmail(e.target.value)}
                    required
                  />
                </div>

                <div className="auth-input-group">
                  <label>Contraseña:</label>
                  <input
                    type="password"
                    placeholder="Mínimo 6 caracteres"
                    value={regPassword}
                    onChange={(e) => setRegPassword(e.target.value)}
                    required
                  />
                </div>

                <div className="auth-terms-hint">
                  🔒 Te enviaremos un código de 6 dígitos para verificar que tu correo es real.
                </div>

                <button type="submit" className="auth-submit-btn" disabled={loading}>
                  {loading ? 'ENVIANDO...' : 'ENVIAR CÓDIGO DE VERIFICACIÓN ✉️'}
                </button>
              </form>
            ) : (
              /* PASO 2: INGRESAR CÓDIGO DE 6 DÍGITOS */
              <form className="auth-form" onSubmit={handleVerifyOtp}>
                <div className="auth-otp-notice">
                  <span>Código de 6 dígitos enviado a:</span>
                  <strong>{regEmail}</strong>
                </div>

                <div className="auth-input-group">
                  <label>Código de Verificación:</label>
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
                  {loading ? 'VALIDANDO...' : 'VALIDAR CÓDIGO Y CREAR CUENTA ➔'}
                </button>

                <button
                  type="button"
                  className="auth-resend-btn"
                  onClick={() => {
                    setIsOtpSent(false)
                    setOtpCode('')
                    setErrorMsg(null)
                    setSuccessMsg(null)
                  }}
                >
                  ← Cambiar correo o datos
                </button>
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
