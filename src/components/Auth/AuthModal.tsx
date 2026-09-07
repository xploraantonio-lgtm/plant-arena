import { useEffect, useState } from 'react'
import { soundManager } from '../../utils/audioManager'
import { supabase } from '../../lib/supabaseClient'
import { urlDeVuelta } from '../../utils/direccionPublica'
import './AuthModal.css'

interface AuthModalProps {
  isOpen: boolean
  onClose: () => void
  userEmail?: string | null
  initialUsername?: string | null
  needsPasswordSetup?: boolean
  onSignInGoogle?: () => Promise<{ success: boolean; error?: string }>
  onSignInEmail: (identifier: string, pass: string) => Promise<{ success: boolean; error?: string }>
  onSetUserPassword?: (newPassword: string, newUsername?: string) => Promise<{ success: boolean; error?: string }>
  onSuccessRedirect?: () => void
}

type AuthView = 'login' | 'forgot' | 'reset'

function recoveryStateFromUrl(): { forceOpen: boolean; view: AuthView; error?: string } {
  if (typeof window === 'undefined') return { forceOpen: false, view: 'login' }

  const hash = window.location.hash.toLowerCase()
  const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash)
  const isRecovery = params.get('type') === 'recovery' || hash.includes('type=recovery')
  const otpExpired = params.get('error_code') === 'otp_expired' || hash.includes('otp_expired')

  if (otpExpired) {
    return {
      forceOpen: true,
      view: 'forgot',
      error: 'El enlace de recuperación expiró o ya fue utilizado. Solicita uno nuevo.',
    }
  }

  if (isRecovery) return { forceOpen: true, view: 'reset' }
  return { forceOpen: false, view: 'login' }
}

export default function AuthModal({
  isOpen,
  onClose,
  userEmail,
  initialUsername,
  needsPasswordSetup = false,
  onSignInGoogle,
  onSignInEmail,
  onSetUserPassword,
  onSuccessRedirect,
}: AuthModalProps) {
  const initialRecovery = recoveryStateFromUrl()

  // Login Form States
  const [loginIdentifier, setLoginIdentifier] = useState('')
  const [loginPassword, setLoginPassword] = useState('')

  // Password recovery states
  const [authView, setAuthView] = useState<AuthView>(initialRecovery.view)
  const [forceOpen, setForceOpen] = useState(initialRecovery.forceOpen)
  const [recoveryEmail, setRecoveryEmail] = useState('')
  const [recoveryPassword, setRecoveryPassword] = useState('')
  const [recoveryPasswordConfirm, setRecoveryPasswordConfirm] = useState('')
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  // Set Password & Custom Nick States (When Google OAuth validates for the first time)
  const [customUsername, setCustomUsername] = useState(() => {
    if (initialUsername && initialUsername !== 'Guerrero') return initialUsername
    if (userEmail) return userEmail.split('@')[0].replace(/[^a-zA-Z0-9_\s-]/g, '').slice(0, 16)
    return ''
  })
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordRegisteredSuccess, setPasswordRegisteredSuccess] = useState(false)

  const [errorMsg, setErrorMsg] = useState<string | null>(initialRecovery.error || null)
  const [loading, setLoading] = useState(false)

  // Supabase emits PASSWORD_RECOVERY after validating a recovery link. Listening
  // here lets the reset form open even when the normal login modal was closed.
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setForceOpen(true)
        setAuthView('reset')
        setErrorMsg(null)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  const closeRecoveryAware = () => {
    setForceOpen(false)
    setAuthView('login')
    setErrorMsg(null)
    setSuccessMsg(null)
    if (typeof window !== 'undefined' && window.location.hash) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search)
    }
    onClose()
  }

  if (!isOpen && !forceOpen) return null

  // Google OAuth Login
  const handleGoogleLogin = async () => {
    if (!onSignInGoogle) return
    setErrorMsg(null)
    setSuccessMsg(null)
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
      setErrorMsg('Por favor ingresa tu usuario o correo y tu contraseña.')
      return
    }

    setLoading(true)
    const res = await onSignInEmail(loginIdentifier.trim(), loginPassword)
    setLoading(false)

    if (res.success) {
      soundManager.playSound('victory', 0.9)
      closeRecoveryAware()
      if (onSuccessRedirect) onSuccessRedirect()
    } else {
      soundManager.playSound('error', 0.5)
      setErrorMsg(res.error || 'Usuario o contraseña incorrectos.')
    }
  }

  const handleRequestPasswordReset = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg(null)
    setSuccessMsg(null)

    const email = recoveryEmail.trim().toLowerCase()
    if (!email || !email.includes('@')) {
      setErrorMsg('Ingresa el correo asociado a tu cuenta.')
      return
    }

    setLoading(true)
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: urlDeVuelta(),
    })
    setLoading(false)

    if (error) {
      soundManager.playSound('error', 0.5)
      setErrorMsg(error.message || 'No se pudo enviar el correo de recuperación.')
      return
    }

    // Mensaje deliberadamente genérico para no revelar qué correos tienen cuenta.
    setSuccessMsg('Si ese correo está registrado, recibirás un enlace para crear una nueva contraseña. Revisa también spam.')
  }

  const handleCompletePasswordReset = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg(null)
    setSuccessMsg(null)

    if (recoveryPassword.length < 6) {
      setErrorMsg('La contraseña debe tener al menos 6 caracteres.')
      return
    }
    if (recoveryPassword !== recoveryPasswordConfirm) {
      setErrorMsg('Las contraseñas no coinciden.')
      return
    }

    setLoading(true)
    const { error } = await supabase.auth.updateUser({ password: recoveryPassword })
    if (error) {
      setLoading(false)
      soundManager.playSound('error', 0.5)
      setErrorMsg(error.message || 'No se pudo actualizar la contraseña.')
      return
    }

    await supabase.auth.signOut()
    setLoading(false)
    setRecoveryPassword('')
    setRecoveryPasswordConfirm('')
    setAuthView('login')
    setForceOpen(true)
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', window.location.pathname + window.location.search)
    }
    soundManager.playSound('victory', 0.9)
    setSuccessMsg('Contraseña actualizada. Ya puedes iniciar sesión con tu nueva contraseña.')
  }

  // Handle Set Password & Username (for Google/New User)
  const handleSavePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg(null)

    const trimmedNick = customUsername.trim()
    if (!trimmedNick || trimmedNick.length < 3) {
      setErrorMsg('Por favor elige un Nick para tu jugador (mínimo 3 caracteres).')
      return
    }

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
    const res = await onSetUserPassword(newPassword, trimmedNick)
    setLoading(false)

    if (res.success) {
      soundManager.playSound('victory', 0.9)
      setPasswordRegisteredSuccess(true)
    } else {
      soundManager.playSound('error', 0.5)
      setErrorMsg(res.error || 'Error al registrar la contraseña y el Nick.')
    }
  }

  const handleFinishPasswordSetup = () => {
    setPasswordRegisteredSuccess(false)
    closeRecoveryAware()
    if (onSuccessRedirect) onSuccessRedirect()
  }

  const recoveryMode = authView === 'forgot' || authView === 'reset'
  const headerTitle = authView === 'forgot'
    ? 'RECUPERAR CONTRASEÑA'
    : authView === 'reset'
      ? 'CREAR NUEVA CONTRASEÑA'
      : needsPasswordSetup
        ? 'REGISTRA TU NICK Y CONTRASEÑA'
        : 'INICIAR SESIÓN'

  const headerSubtitle = authView === 'forgot'
    ? 'Te enviaremos un enlace seguro al correo de tu cuenta'
    : authView === 'reset'
      ? 'Elige una nueva contraseña para volver a Plant Arena'
      : needsPasswordSetup
        ? 'Elige tu nombre público y crea tu contraseña para ingresar con correo o Google'
        : 'Ingresa a Plant Arena para guardar tu progreso'

  return (
    <div className="auth-backdrop" onClick={closeRecoveryAware}>
      <div className="auth-card" onClick={(e) => e.stopPropagation()}>
        <div className="auth-header">
          <div className="auth-header__title-row">
            <span className="auth-header__icon">{recoveryMode ? '🔐' : '🌱'}</span>
            <div>
              <h2>{headerTitle}</h2>
              <p className="auth-header__subtitle">{headerSubtitle}</p>
            </div>
          </div>
          <button type="button" className="auth-close-btn" onClick={closeRecoveryAware}>✕</button>
        </div>

        {errorMsg && <div className="auth-error-box">{errorMsg}</div>}
        {successMsg && <div className="auth-success-box">{successMsg}</div>}

        {authView === 'forgot' ? (
          <form className="auth-form" onSubmit={handleRequestPasswordReset}>
            <div className="auth-input-group">
              <label>📧 Correo de tu cuenta:</label>
              <input
                type="email"
                placeholder="tu-correo@ejemplo.com"
                value={recoveryEmail}
                onChange={(e) => setRecoveryEmail(e.target.value)}
                autoComplete="email"
                autoFocus
                required
              />
              <span className="auth-input-hint">Por seguridad, la recuperación se realiza por correo y no por Nick.</span>
            </div>
            <button type="submit" className="auth-submit-btn" disabled={loading}>
              {loading ? 'ENVIANDO...' : 'ENVIAR ENLACE DE RECUPERACIÓN'}
            </button>
            <button type="button" className="auth-link-btn" onClick={() => { setAuthView('login'); setErrorMsg(null); setSuccessMsg(null) }}>
              ← Volver a iniciar sesión
            </button>
          </form>
        ) : authView === 'reset' ? (
          <form className="auth-form" onSubmit={handleCompletePasswordReset}>
            <div className="auth-input-group">
              <label>🔑 Nueva contraseña:</label>
              <input
                type="password"
                placeholder="Mínimo 6 caracteres"
                value={recoveryPassword}
                onChange={(e) => setRecoveryPassword(e.target.value)}
                autoComplete="new-password"
                autoFocus
                required
              />
            </div>
            <div className="auth-input-group">
              <label>🔁 Repite la nueva contraseña:</label>
              <input
                type="password"
                placeholder="Repite la contraseña"
                value={recoveryPasswordConfirm}
                onChange={(e) => setRecoveryPasswordConfirm(e.target.value)}
                autoComplete="new-password"
                required
              />
            </div>
            <button type="submit" className="auth-submit-btn" disabled={loading}>
              {loading ? 'ACTUALIZANDO...' : 'GUARDAR NUEVA CONTRASEÑA'}
            </button>
          </form>
        ) : passwordRegisteredSuccess ? (
          <div className="auth-success-dialog">
            <div className="auth-success-dialog__icon">🎉</div>
            <h3 className="auth-success-dialog__title">¡PERFIL REGISTRADO CON ÉXITO!</h3>
            <p className="auth-success-dialog__desc">
              Bienvenido a la arena, <strong>{customUsername || 'Guerrero'}</strong>. Tu Nick y tu contraseña han sido guardados de forma segura. Ahora podrás entrar usando <strong>Google</strong> o tu <strong>correo/usuario y contraseña</strong>.
            </p>
            <button type="button" className="auth-submit-btn" onClick={handleFinishPasswordSetup}>
              ⚔️ ENTRAR A LA ARENA ➔
            </button>
          </div>
        ) : needsPasswordSetup ? (
          <form className="auth-form" onSubmit={handleSavePassword}>
            <div className="auth-otp-notice">
              <span>Cuenta vinculada:</span>
              <strong>{userEmail || 'Tu cuenta de Google'}</strong>
            </div>

            <div className="auth-input-group">
              <label>🏷️ Elige tu Nick / Nombre de Jugador:</label>
              <input
                type="text"
                placeholder="Ej: DragonSlayer, PlantKing..."
                value={customUsername}
                onChange={(e) => setCustomUsername(e.target.value.replace(/[^a-zA-Z0-9_\s-]/g, '').slice(0, 16))}
                required
                maxLength={16}
                autoFocus
              />
              <span className="auth-input-hint">Este será tu nombre oficial en rankings, batallas PvP y clanes.</span>
            </div>

            <div className="auth-input-group">
              <label>🔑 Crea tu Contraseña:</label>
              <input type="password" placeholder="Mínimo 6 caracteres" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required />
            </div>

            <div className="auth-input-group">
              <label>🔁 Confirma tu Contraseña:</label>
              <input type="password" placeholder="Repite la contraseña" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required />
            </div>

            <button type="submit" className="auth-submit-btn" disabled={loading}>
              {loading ? 'GUARDANDO...' : 'GUARDAR'}
            </button>
          </form>
        ) : (
          <div className="auth-standard-login">
            {onSignInGoogle && (
              <div className="auth-oauth-section">
                <button type="button" className="auth-google-btn" onClick={handleGoogleLogin} disabled={loading}>
                  <svg className="auth-google-icon" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z" />
                    <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24z" />
                    <path fill="#FBBC05" d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 10.04 0 12s.45 3.82 1.25 5.42l4.03-3.15z" />
                    <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z" />
                  </svg>
                  <span>Continuar con Google</span>
                </button>

                <div className="auth-divider"><span>o con correo y contraseña</span></div>
              </div>
            )}

            <form className="auth-form" onSubmit={handleLogin}>
              <div className="auth-input-group">
                <label>Correo o Usuario:</label>
                <input type="text" placeholder="ej: jugador@gmail.com o tu_usuario" value={loginIdentifier} onChange={(e) => setLoginIdentifier(e.target.value)} required autoFocus />
              </div>

              <div className="auth-input-group">
                <label>Contraseña:</label>
                <input type="password" placeholder="••••••••" value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} required />
                <button
                  type="button"
                  className="auth-link-btn auth-link-btn--forgot"
                  onClick={() => {
                    setRecoveryEmail(loginIdentifier.includes('@') ? loginIdentifier : '')
                    setAuthView('forgot')
                    setErrorMsg(null)
                    setSuccessMsg(null)
                  }}
                >
                  ¿Olvidaste tu contraseña?
                </button>
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
