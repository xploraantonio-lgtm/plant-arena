import React, { useState, useRef } from 'react'
import {
  UserManager,
  PRESET_AVATARS,
  compressImage,
  type PlayerProfile,
  type UserTransaction,
} from '../../utils/userManager'
import { soundManager } from '../../utils/audioManager'
import { supabase, isSupabaseConfigured } from '../../lib/supabaseClient'
import './ProfileModal.css'

interface ProfileModalProps {
  isOpen: boolean
  userElo: number
  userTokens: number
  hasVipPass: boolean
  onClose: () => void
  onAddTokens?: (amountUsd: number) => void
  onDeductTokens?: (amountUsd: number) => boolean
}

type ProfileTab = 'profile' | 'deposit' | 'withdraw' | 'referrals' | 'history'

export default function ProfileModal({
  isOpen,
  userElo,
  userTokens,
  hasVipPass,
  onClose,
  onAddTokens,
  onDeductTokens,
}: ProfileModalProps) {
  const [profile, setProfile] = useState<PlayerProfile>(() => UserManager.getProfile())
  const [activeTab, setActiveTab] = useState<ProfileTab>('profile')
  const [showAvatarPicker, setShowAvatarPicker] = useState(false)
  const [isEditingNick, setIsEditingNick] = useState(false)
  const [nickInput, setNickInput] = useState(profile.name)
  const [isCompressing, setIsCompressing] = useState(false)
  const [copiedLink, setCopiedLink] = useState(false)

  // Deposit state
  const [depositAmount, setDepositAmount] = useState<number>(10)
  const [depositMethod, setDepositMethod] = useState<'card' | 'crypto' | 'paypal'>('card')

  // Withdraw state
  const [withdrawAmount, setWithdrawAmount] = useState<number>(5)
  const [withdrawAddress, setWithdrawAddress] = useState('')
  const [withdrawMethod, setWithdrawMethod] = useState<'crypto' | 'worldapp' | 'paypal'>('crypto')

  // Status feedback
  const [feedbackMsg, setFeedbackMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)

  if (!isOpen) return null

  const showFeedback = (text: string, type: 'success' | 'error' = 'success') => {
    setFeedbackMsg({ text, type })
    setTimeout(() => setFeedbackMsg(null), 3500)
  }

  // Handle Nick Change
  const handleSaveNick = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!nickInput.trim()) return
    const updated = UserManager.updateName(nickInput)
    setProfile(updated)
    setIsEditingNick(false)
    soundManager.playSound('click', 0.5)
    showFeedback('¡Nick actualizado correctamente!')

    if (isSupabaseConfigured()) {
      const { data: { session } } = await supabase.auth.getSession()
      if (session?.user) {
        await (supabase.from('profiles') as any).update({ username: nickInput.trim() }).eq('id', session.user.id)
      }
    }
  }

  // Handle Preset Avatar Select
  const handleSelectPresetAvatar = async (iconUrl: string) => {
    const updated = UserManager.updateAvatar(iconUrl, false)
    setProfile(updated)
    soundManager.playSound('click', 0.5)
    showFeedback('¡Foto de perfil actualizada!')

    if (isSupabaseConfigured()) {
      const { data: { session } } = await supabase.auth.getSession()
      if (session?.user) {
        const found = PRESET_AVATARS.find((a) => a.icon === iconUrl)
        if (found) {
          await (supabase.from('profiles') as any).update({ avatar_id: found.id }).eq('id', session.user.id)
        }
      }
    }
  }

  // Handle Custom File Upload with Compression
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    try {
      setIsCompressing(true)
      // Compresses to max 128x128 JPEG at 75% quality (~10-15KB)
      const compressedDataUrl = await compressImage(file, 128, 0.75)
      const updated = UserManager.updateAvatar(compressedDataUrl, true)
      setProfile(updated)
      soundManager.playSound('victory', 0.8)
      showFeedback('¡Foto subida y optimizada con éxito!')
    } catch (err) {
      showFeedback('Error al procesar la imagen.', 'error')
    } finally {
      setIsCompressing(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  // Handle Deposit
  const handleDepositSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (depositAmount <= 0) return
    if (onAddTokens) {
      onAddTokens(depositAmount)
    }
    UserManager.addTransaction({
      type: 'deposit',
      amountUsd: depositAmount,
      description: `Recarga de Saldo (${depositMethod.toUpperCase()})`,
      status: 'completed',
    })
    soundManager.playSound('victory', 1)
    showFeedback(`¡Depósito exitoso de +$${depositAmount.toFixed(2)} USD!`)
  }

  // Handle Withdraw
  const handleWithdrawSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (withdrawAmount < 10) {
      showFeedback('Mínimo de retiro: 10 Gemas 💎 ($10.00 USD).', 'error')
      return
    }
    if (withdrawAmount > userTokens) {
      showFeedback('Saldo insuficiente para retirar.', 'error')
      return
    }
    if (!withdrawAddress.trim()) {
      showFeedback('Ingresa tu dirección de billetera o cuenta.', 'error')
      return
    }

    if (onDeductTokens) {
      const ok = onDeductTokens(withdrawAmount)
      if (!ok) {
        showFeedback('Error al procesar retiro.', 'error')
        return
      }
    }

    UserManager.addTransaction({
      type: 'withdraw',
      amountUsd: withdrawAmount,
      description: `Retiro a ${withdrawMethod.toUpperCase()} (${withdrawAddress.slice(0, 8)}...)`,
      status: 'completed',
    })
    soundManager.playSound('plantation', 1)
    showFeedback(`¡Solicitud de retiro de $${withdrawAmount.toFixed(2)} USD procesada!`)
    setWithdrawAddress('')
  }

  // Copy Referral Link
  const handleCopyRefLink = () => {
    const refUrl = `${window.location.origin}/?ref=${profile.name}`
    navigator.clipboard.writeText(refUrl)
    setCopiedLink(true)
    soundManager.playSound('click', 0.6)
    setTimeout(() => setCopiedLink(false), 2500)
  }

  const transactions: UserTransaction[] = UserManager.getTransactions()

  return (
    <div className="profile-modal-backdrop" onClick={onClose}>
      <div className="profile-modal-box" onClick={(e) => e.stopPropagation()}>
        {/* MODAL HEADER */}
        <div className="profile-modal-header">
          <div className="profile-header-user">
            <div className="profile-avatar-wrap">
              <img
                src={profile.avatar}
                alt={profile.name}
                className="profile-avatar-img"
                onError={(e) => {
                  e.currentTarget.src = '/game-assets/greenfoot/peashooterpacket1.png'
                }}
              />
              <button
                type="button"
                className="profile-avatar-edit-badge"
                title="Cambiar Foto de Perfil"
                onClick={() => fileInputRef.current?.click()}
              >
                📷
              </button>
            </div>

            <div className="profile-header-meta">
              {isEditingNick ? (
                <form onSubmit={handleSaveNick} className="profile-nick-form">
                  <input
                    type="text"
                    value={nickInput}
                    onChange={(e) => setNickInput(e.target.value)}
                    maxLength={16}
                    autoFocus
                  />
                  <button type="submit" className="profile-nick-save-btn">✓</button>
                  <button
                    type="button"
                    className="profile-nick-cancel-btn"
                    onClick={() => {
                      setNickInput(profile.name)
                      setIsEditingNick(false)
                    }}
                  >
                    ✕
                  </button>
                </form>
              ) : (
                <div className="profile-nick-row">
                  <h3 className={`profile-nick-title ${hasVipPass ? 'profile-nick-title--vip-gold' : ''}`}>
                    {hasVipPass && <span className="nick-vip-crown">👑 </span>}
                    {profile.name}
                  </h3>
                  <button
                    type="button"
                    className="profile-nick-edit-btn"
                    onClick={() => setIsEditingNick(true)}
                    title="Editar Nick"
                  >
                    ✏️
                  </button>
                </div>
              )}

              <div className="profile-badges-row">
                <span className="profile-badge profile-badge--elo">🏆 {userElo} Copas</span>
                {hasVipPass ? (
                  <span className="profile-badge profile-badge--vip">👑 PASE VIP</span>
                ) : (
                  <span className="profile-badge profile-badge--free">🌱 JUGADOR</span>
                )}
                <span className="profile-badge profile-badge--date">📅 Miembro desde {profile.joinedDate}</span>
              </div>
            </div>
          </div>

          <button type="button" className="profile-close-btn" onClick={onClose}>
            ✕
          </button>
        </div>

        {/* HIDDEN FILE INPUT FOR CUSTOM AVATAR */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={handleFileUpload}
        />

        {/* FEEDBACK TOAST */}
        {feedbackMsg && (
          <div className={`profile-toast profile-toast--${feedbackMsg.type}`}>
            {feedbackMsg.text}
          </div>
        )}

        {/* MODAL TABS */}
        <div className="profile-nav-tabs">
          <button
            type="button"
            className={`profile-tab-btn ${activeTab === 'profile' ? 'profile-tab-btn--active' : ''}`}
            onClick={() => setActiveTab('profile')}
          >
            👤 PERFIL
          </button>
          <button
            type="button"
            className={`profile-tab-btn ${activeTab === 'deposit' ? 'profile-tab-btn--active' : ''}`}
            onClick={() => setActiveTab('deposit')}
          >
            💰 DEPOSITAR
          </button>
          <button
            type="button"
            className={`profile-tab-btn ${activeTab === 'withdraw' ? 'profile-tab-btn--active' : ''}`}
            onClick={() => setActiveTab('withdraw')}
          >
            💸 RETIRAR
          </button>
          <button
            type="button"
            className={`profile-tab-btn ${activeTab === 'referrals' ? 'profile-tab-btn--active' : ''}`}
            onClick={() => setActiveTab('referrals')}
          >
            👥 REFERIDOS
          </button>
          <button
            type="button"
            className={`profile-tab-btn ${activeTab === 'history' ? 'profile-tab-btn--active' : ''}`}
            onClick={() => setActiveTab('history')}
          >
            📊 HISTORIAL
          </button>
        </div>

        {/* TAB 1: PERFIL & STATS */}
        {activeTab === 'profile' && (
          <div className="profile-tab-body">
            {/* Account Combat Stats (Top Focus) */}
            <div className="profile-section-title">
              <span>⚔️ ESTADÍSTICAS COMPETITIVAS</span>
              <small>Rendimiento en la Arena, balance de saldo y progreso de la cuenta.</small>
            </div>

            <div className="profile-stats-grid">
              <div className="profile-stat-box">
                <span className="profile-stat-val">{userElo} 🏆</span>
                <span className="profile-stat-lbl">Copas ELO Actuales</span>
              </div>
              <div className="profile-stat-box">
                <span className="profile-stat-val" style={{ color: '#4ade80' }}>💎 {userTokens} Gemas</span>
                <span className="profile-stat-lbl">Saldo Disponible</span>
              </div>
              <div className="profile-stat-box">
                <span className="profile-stat-val">15 / 15</span>
                <span className="profile-stat-lbl">Plantas Desbloqueadas</span>
              </div>
              <div className="profile-stat-box">
                <span className="profile-stat-val" style={{ color: '#38bdf8' }}>{profile.totalReferred} Amigos</span>
                <span className="profile-stat-lbl">Referidos Activos</span>
              </div>
            </div>

            {/* Collapsible Avatar Picker Section */}
            <div className="profile-collapsible-card">
              <button
                type="button"
                className="profile-toggle-avatar-btn"
                onClick={() => {
                  soundManager.playSound('click', 0.4)
                  setShowAvatarPicker((prev) => !prev)
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '15px' }}>🖼️</span>
                  <span style={{ fontWeight: 900, fontSize: '11.5px', color: '#ffd23f' }}>
                    ELEGIR / CAMBIAR FOTO DE PERFIL
                  </span>
                </div>
                <span className="profile-toggle-badge">
                  {showAvatarPicker ? '▲ OCULTAR' : '▼ DESPLEGAR'}
                </span>
              </button>

              {showAvatarPicker && (
                <div className="profile-avatar-picker-content">
                  {/* Custom Upload Button */}
                  <div className="profile-upload-bar">
                    <button
                      type="button"
                      className="profile-upload-btn"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isCompressing}
                    >
                      {isCompressing ? '⏳ Subiendo y optimizando...' : '📤 SUBIR MI FOTO PERSONALIZADA'}
                    </button>
                  </div>

                  {/* Preset Avatars Grid */}
                  <div className="profile-avatar-grid">
                    {PRESET_AVATARS.map((av) => {
                      const isSelected = profile.avatar === av.icon && !profile.isCustomAvatar
                      return (
                        <button
                          key={av.id}
                          type="button"
                          className={`profile-avatar-card ${isSelected ? 'profile-avatar-card--active' : ''}`}
                          onClick={() => handleSelectPresetAvatar(av.icon)}
                        >
                          <img
                            src={av.icon}
                            alt={av.name}
                            onError={(e) => {
                              e.currentTarget.src = '/game-assets/greenfoot/peashooterpacket1.png'
                            }}
                          />
                          <span>{av.name}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 2: DEPOSITAR */}
        {activeTab === 'deposit' && (
          <form onSubmit={handleDepositSubmit} className="profile-tab-body">
            <div className="profile-section-title">
              <span>💳 RECARGAR SALDO ($USD)</span>
              <small>Añade fondos a tu cuenta para participar en Guerras de Clanes, Torneos y Comercio.</small>
            </div>

            {/* Quick Amounts */}
            <div className="profile-quick-amounts">
              {[5, 10, 20, 50, 100].map((amt) => (
                <button
                  key={amt}
                  type="button"
                  className={`profile-quick-btn ${depositAmount === amt ? 'profile-quick-btn--active' : ''}`}
                  onClick={() => setDepositAmount(amt)}
                >
                  ${amt} USD
                </button>
              ))}
            </div>

            <div className="profile-form-row">
              <label>Monto a Depositar:</label>
              <div className="profile-input-wrap">
                <span>$</span>
                <input
                  type="number"
                  min={1}
                  max={500}
                  step={1}
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(Number(e.target.value))}
                  required
                />
                <span>USD</span>
              </div>
            </div>

            <div className="profile-form-row">
              <label>Método de Pago:</label>
              <div className="profile-method-picker">
                <button
                  type="button"
                  className={`profile-method-btn ${depositMethod === 'card' ? 'profile-method-btn--active' : ''}`}
                  onClick={() => setDepositMethod('card')}
                >
                  💳 Tarjeta Débito / Crédito
                </button>
                <button
                  type="button"
                  className={`profile-method-btn ${depositMethod === 'crypto' ? 'profile-method-btn--active' : ''}`}
                  onClick={() => setDepositMethod('crypto')}
                >
                  ⚡ Cripto (USDT / Web3 Wallet)
                </button>
                <button
                  type="button"
                  className={`profile-method-btn ${depositMethod === 'paypal' ? 'profile-method-btn--active' : ''}`}
                  onClick={() => setDepositMethod('paypal')}
                >
                  🅿️ PayPal / Saldo Digital
                </button>
              </div>
            </div>

            <button type="submit" className="profile-submit-action-btn">
              💰 CONFIRMAR DEPÓSITO DE ${depositAmount.toFixed(2)} USD
            </button>
          </form>
        )}

        {/* TAB 3: RETIRAR */}
        {activeTab === 'withdraw' && (
          <form onSubmit={handleWithdrawSubmit} className="profile-tab-body">
            <div className="profile-section-title">
              <span>💎 RETIRAR GEMAS A DINERO REAL</span>
              <small>Mínimo de retiro: 10 Gemas 💎 ($10.00 USD). Retira tus ganancias obtenidas en el Coliseo, Guerras de Clanes y Comercio P2P.</small>
            </div>

            <div className="profile-balance-banner">
              <span>Gemas Disponibles para Retirar:</span>
              <strong>💎 {userTokens} Gemas</strong>
            </div>

            <div className="profile-form-row">
              <label>Gemas a Retirar (Mín. 10 💎):</label>
              <div className="profile-input-wrap">
                <span>💎</span>
                <input
                  type="number"
                  min={10}
                  max={userTokens}
                  step={1}
                  value={withdrawAmount}
                  onChange={(e) => setWithdrawAmount(Number(e.target.value))}
                  required
                />
                <span>Gemas</span>
              </div>
            </div>

            <div className="profile-form-row">
              <label>Método de Retiro:</label>
              <div className="profile-method-picker">
                <button
                  type="button"
                  className={`profile-method-btn ${withdrawMethod === 'crypto' ? 'profile-method-btn--active' : ''}`}
                  onClick={() => setWithdrawMethod('crypto')}
                >
                  ⚡ USDT (TRC20 / Optimism)
                </button>
                <button
                  type="button"
                  className={`profile-method-btn ${withdrawMethod === 'worldapp' ? 'profile-method-btn--active' : ''}`}
                  onClick={() => setWithdrawMethod('worldapp')}
                >
                  🌐 World App Wallet
                </button>
                <button
                  type="button"
                  className={`profile-method-btn ${withdrawMethod === 'paypal' ? 'profile-method-btn--active' : ''}`}
                  onClick={() => setWithdrawMethod('paypal')}
                >
                  🅿️ PayPal
                </button>
              </div>
            </div>

            <div className="profile-form-row">
              <label>Dirección de Destino / Billetera:</label>
              <input
                type="text"
                placeholder={withdrawMethod === 'paypal' ? 'tu-email@paypal.com' : '0x... o dirección de billetera'}
                value={withdrawAddress}
                onChange={(e) => setWithdrawAddress(e.target.value)}
                className="profile-text-input"
                required
              />
            </div>

            <button type="submit" className="profile-submit-action-btn profile-submit-action-btn--withdraw">
              💸 SOLICITAR RETIRO DE ${withdrawAmount.toFixed(2)} USD
            </button>
          </form>
        )}

        {/* TAB 4: REFERIDOS */}
        {activeTab === 'referrals' && (
          <div className="profile-tab-body">
            <div className="profile-section-title">
              <span>👥 PROGRAMA DE REFERIDOS PLANT ARENA</span>
              <small>Invita a tus amigos y gana $1.00 USD por cada amigo que alcance 500 copas ELO.</small>
            </div>

            {/* Referral Link Copy Bar */}
            <div className="profile-ref-link-card">
              <div className="profile-ref-link-info">
                <span className="profile-ref-lbl">TU ENLACE DE INVITACIÓN:</span>
                <span className="profile-ref-url">
                  {window.location.origin}/?ref={profile.name}
                </span>
              </div>
              <button
                type="button"
                className="profile-ref-copy-btn"
                onClick={handleCopyRefLink}
              >
                {copiedLink ? '✓ COPIADO' : '📋 COPIAR'}
              </button>
            </div>

            {/* Referral Stats Summary */}
            <div className="profile-stats-grid" style={{ margin: '14px 0' }}>
              <div className="profile-stat-box">
                <span className="profile-stat-val" style={{ color: '#38bdf8' }}>{profile.totalReferred}</span>
                <span className="profile-stat-lbl">Amigos Invitados</span>
              </div>
              <div className="profile-stat-box">
                <span className="profile-stat-val" style={{ color: '#4ade80' }}>
                  ${profile.totalReferralBonusUsd.toFixed(2)} USD
                </span>
                <span className="profile-stat-lbl">Bonos Ganados</span>
              </div>
              <div className="profile-stat-box">
                <span className="profile-stat-val" style={{ color: '#fbbf24' }}>{profile.referralCode}</span>
                <span className="profile-stat-lbl">Código de Creador</span>
              </div>
            </div>

            {/* Rules */}
            <div className="profile-ref-rules">
              <h4>¿Cómo funciona?</h4>
              <ul>
                <li>📤 <strong>1. Comparte tu enlace:</strong> Envía tu link a tus amigos de Discord, Telegram o WhatsApp.</li>
                <li>⚔️ <strong>2. Ellos juegan:</strong> Cuando tu amigo se registra y alcanza 500 copas ELO en la Arena...</li>
                <li>💎 <strong>3. Recompensa Automática:</strong> Recibes <strong>+$1.00 USD</strong> directo a tu saldo y un Sobre Básico verde.</li>
              </ul>
            </div>
          </div>
        )}

        {/* TAB 5: HISTORIAL */}
        {activeTab === 'history' && (
          <div className="profile-tab-body">
            <div className="profile-section-title">
              <span>📊 HISTORIAL DE TRANSACCIONES</span>
              <small>Registro de depósitos, retiros, compras y bonos de guerras de clan.</small>
            </div>

            <div className="profile-tx-list">
              {transactions.length === 0 ? (
                <div className="profile-empty-state">No hay movimientos recientes.</div>
              ) : (
                transactions.map((tx) => {
                  const isPositive = tx.type === 'deposit' || tx.type === 'reward'
                  return (
                    <div key={tx.id} className="profile-tx-row">
                      <div className="profile-tx-left">
                        <span className="profile-tx-icon">
                          {tx.type === 'deposit' && '💳'}
                          {tx.type === 'withdraw' && '💸'}
                          {tx.type === 'reward' && '🏆'}
                          {tx.type === 'purchase' && '🛒'}
                        </span>
                        <div>
                          <span className="profile-tx-desc">{tx.description}</span>
                          <span className="profile-tx-date">
                            {new Date(tx.timestamp).toLocaleDateString()} {new Date(tx.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                      </div>
                      <div className="profile-tx-right">
                        <span className={`profile-tx-amount ${isPositive ? 'profile-tx-amount--pos' : 'profile-tx-amount--neg'}`}>
                          {isPositive ? '+' : '-'}${tx.amountUsd.toFixed(2)} USD
                        </span>
                        <span className="profile-tx-status">✓ {tx.status}</span>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
