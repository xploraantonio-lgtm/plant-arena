import React, { useState, useRef, useEffect } from 'react'
import {
  UserManager,
  PRESET_AVATARS,
  compressImage,
  type PlayerProfile,
} from '../../utils/userManager'
import { soundManager } from '../../utils/audioManager'
import { supabase, isSupabaseConfigured } from '../../lib/supabaseClient'
import { PLANT_CONFIGS } from '../../utils/gameConstants'
import type { PlantId } from '../../types/game'
import { accountService } from '../../services/accountService'
import PanelDeReferidos from '../Referidos/PanelDeReferidos'
import './ProfileModal.css'

interface ProfileModalProps {
  isOpen: boolean
  userElo: number
  userTokens: number
  hasVipPass: boolean
  unlockedPlants?: PlantId[]
  onClose: () => void
}

type ProfileTab = 'profile' | 'deposit' | 'withdraw' | 'referrals' | 'history'

export default function ProfileModal({
  isOpen,
  userElo,
  userTokens,
  hasVipPass,
  unlockedPlants,
  onClose,
}: ProfileModalProps) {
  const [profile, setProfile] = useState<PlayerProfile>(() => UserManager.getProfile())
  const [activeTab, setActiveTab] = useState<ProfileTab>('profile')
  const [showAvatarPicker, setShowAvatarPicker] = useState(false)
  const [isEditingNick, setIsEditingNick] = useState(false)
  const [nickInput, setNickInput] = useState(profile.name)
  const [isCompressing, setIsCompressing] = useState(false)

  // ── ESTADO DE DEPÓSITO BEP20 ───────────────────────────────────────────────
  const [depositInfo, setDepositInfo] = useState<{
    registeredWallet?: { id: string; address: string; normalized: string; status: string; createdAt: string } | null
    treasuryWallet?: string
    tokenContract?: string
    network?: string
    rate?: string
  }>({
    treasuryWallet: '0x721622D8cad39621C731eC286D1EA859365A51b8',
    tokenContract: '0x55d398326f99059fF775485246999027B3197955',
    network: 'BNB Smart Chain (BEP20)',
    rate: '1 USDT = 100 GEMAS',
  })
  const [personalWalletInput, setPersonalWalletInput] = useState('')
  const [isRegisteringWallet, setIsRegisteringWallet] = useState(false)
  const [isCheckingDeposits, setIsCheckingDeposits] = useState(false)
  const [copiedTreasury, setCopiedTreasury] = useState(false)
  const [isEditingRegisteredWallet, setIsEditingRegisteredWallet] = useState(false)
  const [manualTxHashInput, setManualTxHashInput] = useState('')
  const [showManualTxInput, setShowManualTxInput] = useState(false)

  // ── ESTADO DE RETIRO BEP20 (5% COMISIÓN) ──────────────────────────────────
  const [withdrawGems, setWithdrawGems] = useState<number>(1000)
  const [withdrawAddress, setWithdrawAddress] = useState('')
  const [isSubmittingWithdrawal, setIsSubmittingWithdrawal] = useState(false)
  const [showWithdrawConfirm, setShowWithdrawConfirm] = useState(false)

  // ── SALDOS FINANCIEROS DUALES (TOTAL, RETIRABLE Y BLOQUEADO/BONO) ────────
  const [financialBalances, setFinancialBalances] = useState<{
    totalGems: number
    lockedGems: number
    withdrawableGems: number
  }>({
    totalGems: userTokens,
    lockedGems: 0,
    withdrawableGems: userTokens,
  })

  // Sincronizar con userTokens recibido por prop si aún no cargó la RPC
  useEffect(() => {
    setFinancialBalances((prev) => ({
      ...prev,
      totalGems: prev.totalGems || userTokens,
      withdrawableGems: prev.withdrawableGems !== undefined ? prev.withdrawableGems : userTokens,
    }))
  }, [userTokens])

  // ── ESTADO DE HISTORIAL FINANCIERO ─────────────────────────────────────────
  const [financialHistory, setFinancialHistory] = useState<{
    deposits: any[]
    withdrawals: any[]
  }>({ deposits: [], withdrawals: [] })
  const [isLoadingHistory, setIsLoadingHistory] = useState(false)

  // ── ESTADO DE CÓDIGOS DE RECOMPENSA STREAMER ──────────────────────────────
  const [promoCodeInput, setPromoCodeInput] = useState('')
  const [isClaimingCode, setIsClaimingCode] = useState(false)
  const [codeFeedback, setCodeFeedback] = useState<{ text: string; type: 'success' | 'error' } | null>(null)

  // Status feedback toast
  const [feedbackMsg, setFeedbackMsg] = useState<{ text: string; type: 'success' | 'error' | 'warning' } | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)

  const showFeedback = (text: string, type: 'success' | 'error' | 'warning' = 'success') => {
    setFeedbackMsg({ text, type })
    setTimeout(() => setFeedbackMsg(null), 4500)
  }

  // Ref para trackear depósitos ya conocidos y no repetir toast
  const knownDepositIdsRef = useRef<Set<string>>(new Set())

  // Cargar datos de depósito e historial al abrir o cambiar de pestaña
  useEffect(() => {
    if (!isOpen) return
    let active = true

    const loadData = async () => {
      if (!isSupabaseConfigured()) return

      // 1. Cargar saldos financieros autoritativos (Total, Retirable y Bloqueado/Bono)
      try {
        const bal = await accountService.myBalance()
        if (active && bal) {
          const total = Number(bal.gems_balance ?? userTokens)
          const locked = Number(bal.locked_gems_balance ?? 0)
          const withdrawable = Number(bal.withdrawable_gems ?? Math.max(0, total - locked))
          setFinancialBalances({
            totalGems: total,
            lockedGems: locked,
            withdrawableGems: withdrawable,
          })
        }
      } catch {}

      // 2. Información de depósito
      const info = await accountService.getDepositInfo()
      if (active && info.success) {
        setDepositInfo({
          registeredWallet: info.registeredWallet,
          treasuryWallet: info.treasuryWallet,
          tokenContract: info.tokenContract,
          network: info.network,
          rate: info.rate,
        })
        if (info.registeredWallet?.address) {
          setPersonalWalletInput(info.registeredWallet.address)
        }
      }

      // 3. Historial financiero
      setIsLoadingHistory(true)
      const hist = await accountService.getFinancialHistory()
      if (active && hist.success) {
        setFinancialHistory({
          deposits: hist.deposits || [],
          withdrawals: hist.withdrawals || [],
        });
        (hist.deposits || []).forEach((d: any) => {
          if (d.status === 'credited') knownDepositIdsRef.current.add(d.id)
        })
      }
      if (active) setIsLoadingHistory(false)
    }

    void loadData()

    const handleRefresh = () => {
      if (active) void loadData()
    }
    window.addEventListener('refresh_user_balance', handleRefresh)
    window.addEventListener('player_profile_updated', handleRefresh)

    return () => {
      active = false
      window.removeEventListener('refresh_user_balance', handleRefresh)
      window.removeEventListener('player_profile_updated', handleRefresh)
    }
  }, [isOpen, activeTab, userTokens])

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
      const compressedDataUrl = await compressImage(file, 128, 0.75)
      const updated = UserManager.updateAvatar(compressedDataUrl, true)
      setProfile(updated)
      soundManager.playSound('victory', 0.8)
      showFeedback('¡Foto subida y optimizada con éxito!')
    } catch {
      showFeedback('Error al procesar la imagen.', 'error')
    } finally {
      setIsCompressing(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  // ── CANJEAR CÓDIGO DE RECOMPENSA STREAMER ─────────────────────────────────
  const handleClaimRewardCode = async (e: React.FormEvent) => {
    e.preventDefault()
    const clean = promoCodeInput.trim().toUpperCase()
    if (!clean) return

    try {
      setIsClaimingCode(true)
      setCodeFeedback(null)
      const res = await accountService.claimRewardCode(clean)

      if (res.success) {
        soundManager.playSound('victory', 0.9)
        setPromoCodeInput('')
        let msg = res.message || '🎉 ¡Recompensa recibida con éxito!'
        if (res.rewardType === 'bundle') {
          msg = res.message || `🎉 ¡Has recibido +${res.goldAmount?.toLocaleString() || ''} de Oro y 1 Sobre!`
        } else if (res.rewardType === 'gold' && !res.message) {
          msg = `💰 ¡Has recibido +${res.goldAmount?.toLocaleString() || ''} de Oro!`
        } else if (res.rewardType === 'gems' && !res.message) {
          msg = `💎 ¡Has recibido +${res.gemsAmount?.toLocaleString() || ''} Gemas!`
        } else if (res.rewardType === 'plant' && !res.message) {
          msg = `🌿 ¡Carta ${res.plantId || ''} añadida a tu inventario!`
        } else if (res.rewardType === 'pvp_pack') {
          msg = res.message || '🎉 ¡Sobre PvP añadido al jardín!'
        }
        setCodeFeedback({ text: msg, type: 'success' })
        showFeedback(msg, 'success')
        window.dispatchEvent(new Event('refresh_reward_packs'))
        window.dispatchEvent(new Event('refresh_pack_slots'))
        window.dispatchEvent(new Event('refresh_user_balance'))
        window.dispatchEvent(new Event('refresh_user_inventory'))
        window.dispatchEvent(new Event('player_profile_updated'))
      } else {
        soundManager.playSound('error', 0.5)
        let msg = 'Código no encontrado.'
        if (res.errorCode === 'NOT_AUTHENTICATED') {
          msg = 'Debes iniciar sesión para canjear códigos.'
        } else if (res.errorCode === 'CODE_ALREADY_CLAIMED' || res.errorCode === 'CODE_LIMIT_REACHED') {
          msg = 'Este código ya fue utilizado.'
        } else if (res.errorCode === 'CODE_NOT_FOUND') {
          msg = 'Código no encontrado.'
        } else if (res.errorCode === 'CODE_EXPIRED' || res.errorCode === 'CODE_DISABLED') {
          msg = 'Este código ha expirado o está desactivado.'
        } else if (res.error) {
          if (res.error.includes('CODE_ALREADY_CLAIMED') || res.error.includes('CODE_LIMIT_REACHED') || res.error.includes('uq_reward_code_user_claim')) {
            msg = 'Este código ya fue utilizado.'
          } else if (res.error.includes('NOT_AUTHENTICATED') || res.error.includes('No autenticado')) {
            msg = 'Debes iniciar sesión para canjear códigos.'
          } else if (res.error.includes('CODE_NOT_FOUND')) {
            msg = 'Código no encontrado.'
          } else {
            msg = res.error
          }
        }
        setCodeFeedback({ text: msg, type: 'error' })
        showFeedback(msg, 'error')
      }
    } catch {
      soundManager.playSound('error', 0.5)
      setCodeFeedback({ text: 'Error al conectar con el servidor.', type: 'error' })
      showFeedback('Error al conectar con el servidor.', 'error')
    } finally {
      setIsClaimingCode(false)
    }
  }

  // ── REGISTRAR WALLET PERSONAL DE DEPÓSITO ──────────────────────────────────
  const handleRegisterPersonalWallet = async (e: React.FormEvent) => {
    e.preventDefault()
    const address = personalWalletInput.trim()
    if (!address.match(/^0x[a-fA-F0-9]{40}$/)) {
      showFeedback('Dirección BEP20 inválida. Debe comenzar con 0x y tener 40 caracteres hexadecimales.', 'error')
      return
    }

    try {
      setIsRegisteringWallet(true)
      const res = await accountService.registerDepositWallet(address)
      if (res.success && res.wallet) {
        soundManager.playSound('victory', 0.7)
        setDepositInfo((prev) => ({
          ...prev,
          registeredWallet: res.wallet,
        }))
        setIsEditingRegisteredWallet(false)
        showFeedback('¡Wallet personal vinculada con éxito para depósitos automáticos!', 'success')
      } else {
        showFeedback(res.message || 'Error al vincular wallet.', 'error')
      }
    } catch (err: any) {
      showFeedback(err?.message || 'Fallo de conexión.', 'error')
    } finally {
      setIsRegisteringWallet(false)
    }
  }

  // ── COPIAR DIRECCIÓN OFICIAL DE TESORERÍA ─────────────────────────────────
  const handleCopyTreasury = () => {
    const addr = depositInfo.treasuryWallet || '0x721622D8cad39621C731eC286D1EA859365A51b8'
    if (navigator.clipboard) {
      navigator.clipboard.writeText(addr)
      setCopiedTreasury(true)
      soundManager.playSound('click', 0.5)
      setTimeout(() => setCopiedTreasury(false), 3000)
    }
  }

  // ── COMPROBAR DEPÓSITOS EN BLOCKCHAIN (CON DETECCIÓN Y NOTIFICACIÓN REALTIME) ─
  const handleCheckBlockchainDeposits = async (isAutoPoll = false, customTxHash?: string) => {
    try {
      if (!isAutoPoll) setIsCheckingDeposits(true)
      const res = await accountService.triggerDepositCheck(customTxHash)

      // Consultar historial actualizado
      const hist = await accountService.getFinancialHistory()
      if (hist.success) {
        setFinancialHistory({ deposits: hist.deposits, withdrawals: hist.withdrawals })

        // Detectar si hay algún depósito recién acreditado
        const newlyCredited = (hist.deposits || []).filter(
          (d: any) => d.status === 'credited' && !knownDepositIdsRef.current.has(d.id)
        )

        if (newlyCredited.length > 0) {
          // Registrar como conocidos
          newlyCredited.forEach((d: any) => knownDepositIdsRef.current.add(d.id))
          const totalNewGems = newlyCredited.reduce((acc: number, d: any) => acc + Number(d.amount_gems), 0)

          soundManager.playSound('victory', 0.9)
          showFeedback(`🎉 ¡DEPÓSITO RECIBIDO! +${totalNewGems.toFixed(2)} Gemas 💎 acreditadas a tu saldo en tiempo real.`, 'success')

          // Disparar sincronización global de saldo en toda la aplicación
          window.dispatchEvent(new Event('refresh_user_balance'))
          window.dispatchEvent(new Event('player_profile_updated'))
        } else if (!isAutoPoll) {
          soundManager.playSound('click', 0.5)
          showFeedback('✓ Escaneo completado: Tu saldo está actualizado (No hay nuevos depósitos pendientes).', 'success')
        }
      } else if (!isAutoPoll) {
        showFeedback(res.error || 'No se detectaron transferencias pendientes.', 'warning')
      }
    } catch {
      if (!isAutoPoll) showFeedback('Error al consultar blockchain.', 'error')
    } finally {
      if (!isAutoPoll) setIsCheckingDeposits(false)
    }
  }

  // ── AUTO-POLLING EN TIEMPO REAL CUANDO ESTÁ EN LA PESTAÑA DE DEPÓSITO ───────
  useEffect(() => {
    if (!isOpen || activeTab !== 'deposit') return

    // Ejecutar de inmediato al abrir la pestaña
    void handleCheckBlockchainDeposits(true)

    // Polling automático cada 6 segundos mientras mantenga abierta la pestaña Depositar
    const interval = setInterval(() => {
      void handleCheckBlockchainDeposits(true)
    }, 6000)

    return () => clearInterval(interval)
  }, [isOpen, activeTab])

  // ── CÁLCULO DE COMISIÓN DE RETIRO (5% SERVER-AUTHORITATIVE, 100 GEMAS = 1 USDT) ──
  const withdrawalFee = Number((withdrawGems * 0.05).toFixed(2))
  const netWithdrawalUsdt = Number(((withdrawGems * 0.95) / 100.0).toFixed(2))

  // ── PREPARAR RETIRO Y MOSTRAR CONFIRMACIÓN ─────────────────────────────────
  const currentTotalGems = financialBalances.totalGems || userTokens
  const currentWithdrawableGems = financialBalances.withdrawableGems !== undefined ? financialBalances.withdrawableGems : userTokens
  const currentLockedGems = financialBalances.lockedGems || 0

  const handleOpenWithdrawConfirm = (e: React.FormEvent) => {
    e.preventDefault()
    if (!withdrawGems || withdrawGems <= 0) {
      soundManager.playSound('error', 0.5)
      showFeedback('Por favor ingresa la cantidad de gemas a retirar.', 'error')
      return
    }
    if (withdrawGems < 1000.0) {
      soundManager.playSound('error', 0.5)
      showFeedback(
        `⚠️ El retiro mínimo permitido es de 1,000 Gemas (10.00 USDT). Ingresaste ${withdrawGems.toLocaleString()} 💎.`,
        'error'
      )
      return
    }
    if (withdrawGems > currentWithdrawableGems) {
      soundManager.playSound('error', 0.5)
      if (currentLockedGems > 0 && withdrawGems <= currentTotalGems) {
        showFeedback(
          `Solo tienes ${currentWithdrawableGems.toLocaleString()} gemas retirables. Tus ${currentLockedGems.toLocaleString()} 💎 restantes son saldo bloqueado (bonos y retención de depósito) utilizable en el juego.`,
          'error'
        )
      } else {
        showFeedback(`Saldo retirable insuficiente. Tienes ${currentWithdrawableGems.toLocaleString()} gemas retirables disponibles.`, 'error')
      }
      return
    }
    const cleanDest = withdrawAddress.trim()
    if (!cleanDest) {
      soundManager.playSound('error', 0.5)
      showFeedback('Por favor ingresa tu dirección de wallet BEP20 (0x...) de destino.', 'error')
      return
    }
    if (!cleanDest.match(/^0x[a-fA-F0-9]{40}$/)) {
      soundManager.playSound('error', 0.5)
      showFeedback('Dirección de destino BEP20 inválida. Debe comenzar con 0x y tener 42 caracteres.', 'error')
      return
    }

    setShowWithdrawConfirm(true)
    soundManager.playSound('click', 0.5)
  }

  // ── CONFIRMAR RETIRO DEFINITIVO (RPC IDEMPOTENTE + PROCESADOR BLOCKCHAIN) ──
  const handleExecuteWithdrawal = async () => {
    try {
      setIsSubmittingWithdrawal(true)
      const idempotencyKey = `wd-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
      const res = await accountService.requestWithdrawal(
        withdrawGems,
        withdrawAddress.trim(),
        idempotencyKey
      )

      if (res.success && res.withdrawal) {
        const withdrawalInfo = res.withdrawal
        setShowWithdrawConfirm(false)
        setWithdrawAddress('')

        // Sincronizar saldos en tiempo real
        window.dispatchEvent(new Event('refresh_user_balance'))
        window.dispatchEvent(new Event('player_profile_updated'))

        // Disparar inmediatamente el procesador de retiros on-chain
        showFeedback(`⏳ Solicitud de ${withdrawalInfo.netAmountUsdt} USDT registrada. Transmitiendo a BNB Smart Chain...`, 'success')
        
        try {
          const procRes = await accountService.triggerWithdrawalProcessor()
          const matchedItem = (procRes.results || []).find((r: any) => r.id === withdrawalInfo.id)

          if (matchedItem?.status === 'completed' && matchedItem.txHash) {
            soundManager.playSound('victory', 0.9)
            showFeedback(
              `🎉 ¡RETIRO COMPLETADO CON ÉXITO! Se enviaron ${matchedItem.netAmountUsdt} USDT a tu wallet. (TX: ${matchedItem.txHash.slice(0, 10)}...)`,
              'success'
            )
          } else if (matchedItem?.status === 'failed_and_refunded' || matchedItem?.error) {
            soundManager.playSound('error', 0.5)
            showFeedback(
              `⚠️ El retiro en blockchain falló (${matchedItem.error || 'Error de red'}). Tus gemas han sido reembolsadas intactas a tu cuenta.`,
              'error'
            )
          } else if (procRes.error) {
            showFeedback(`⚠️ Retiro registrado en espera de confirmación: ${procRes.message || procRes.error}`, 'warning')
          }
        } catch {
          // Si la edge function tarda, el retiro queda encolado de forma segura
          soundManager.playSound('click', 0.5)
          showFeedback(`✓ Solicitud de retiro encolada correctamente. Recibirás ${withdrawalInfo.netAmountUsdt} USDT al confirmar el bloque.`, 'success')
        }

        // Sincronizar nuevamente saldos e historial
        window.dispatchEvent(new Event('refresh_user_balance'))
        window.dispatchEvent(new Event('player_profile_updated'))
        const hist = await accountService.getFinancialHistory()
        if (hist.success) {
          setFinancialHistory({ deposits: hist.deposits, withdrawals: hist.withdrawals })
        }
      } else {
        showFeedback(res.message || 'Error al procesar retiro.', 'error')
      }
    } catch (err: any) {
      showFeedback(err?.message || 'Fallo de conexión.', 'error')
    } finally {
      setIsSubmittingWithdrawal(false)
    }
  }

  if (!isOpen) return null

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
                  e.currentTarget.src = '/game-assets/greenfoot/peashooterpacket1.webp'
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
                <span className="profile-badge profile-badge--gems">💎 {userTokens} Gemas</span>
                {hasVipPass ? (
                  <span className="profile-badge profile-badge--vip">👑 PASE VIP</span>
                ) : (
                  <span className="profile-badge profile-badge--free">🌱 JUGADOR</span>
                )}
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
                <span className="profile-stat-val">
                  {unlockedPlants ? unlockedPlants.length : 3} / {Object.keys(PLANT_CONFIGS).length}
                </span>
                <span className="profile-stat-lbl">Plantas Desbloqueadas</span>
              </div>
              <div className="profile-stat-box">
                <span className="profile-stat-val" style={{ color: '#38bdf8' }}>{profile.totalReferred} Amigos</span>
                <span className="profile-stat-lbl">Referidos Activos</span>
              </div>
            </div>

            {/* SECCIÓN: 🎁 CÓDIGOS DE RECOMPENSA */}
            <div className="profile-reward-code-card">
              <div className="profile-reward-code-header">
                <div className="profile-reward-code-title-row">
                  <span className="profile-reward-code-icon">🎁</span>
                  <span className="profile-reward-code-title">CÓDIGOS DE RECOMPENSA</span>
                </div>
                <span className="profile-reward-code-subtitle">
                  Canjea códigos promocionales de streamers para obtener sobres PvP en tu jardín.
                </span>
              </div>

              <form onSubmit={handleClaimRewardCode} className="profile-reward-code-form">
                <div className="profile-reward-code-input-group">
                  <input
                    type="text"
                    placeholder="Ingresar código"
                    value={promoCodeInput}
                    onChange={(e) => {
                      setPromoCodeInput(e.target.value.toUpperCase())
                      if (codeFeedback) setCodeFeedback(null)
                    }}
                    className="profile-reward-code-input"
                    maxLength={32}
                    disabled={isClaimingCode}
                    autoCapitalize="characters"
                    spellCheck={false}
                  />
                  <button
                    type="submit"
                    className="profile-reward-code-btn"
                    disabled={isClaimingCode || !promoCodeInput.trim()}
                  >
                    {isClaimingCode ? '⏳ RECLAMANDO...' : 'RECLAMAR'}
                  </button>
                </div>

                {codeFeedback && (
                  <div className={`profile-reward-code-feedback profile-reward-code-feedback--${codeFeedback.type}`}>
                    {codeFeedback.text}
                  </div>
                )}
              </form>
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
                              e.currentTarget.src = '/game-assets/greenfoot/peashooterpacket1.webp'
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

        {/* TAB 2: DEPOSITAR USDT BEP20 */}
        {activeTab === 'deposit' && (
          <div className="profile-tab-body">
            <div className="profile-section-title">
              <span>💰 DEPÓSITO AUTOMÁTICO DE USDT (BEP20)</span>
              <small>Conversión oficial: <strong>1 USDT = 100 Gemas 💎</strong> (BNB Smart Chain)</small>
            </div>

            {/* PASO 1: VINCULAR WALLET PERSONAL */}
            {(!depositInfo.registeredWallet || isEditingRegisteredWallet) ? (
              <form onSubmit={handleRegisterPersonalWallet} className="crypto-wallet-register-box">
                <div className="crypto-step-badge">1️⃣ PASO 1: REGISTRA TU WALLET PERSONAL (SELF-CUSTODY)</div>
                <p className="crypto-step-desc">
                  Para acreditar tus depósitos automáticamente, introduce la dirección pública de tu wallet personal
                  (<strong>MetaMask, Trust Wallet, Rabby, SafePal</strong>, etc.).
                </p>
                <div className="crypto-input-group">
                  <input
                    type="text"
                    placeholder="0x... (Tu dirección pública BEP20)"
                    value={personalWalletInput}
                    onChange={(e) => setPersonalWalletInput(e.target.value)}
                    className="crypto-wallet-input"
                    required
                  />
                  <button
                    type="submit"
                    className="crypto-register-btn"
                    disabled={isRegisteringWallet}
                  >
                    {isRegisteringWallet ? '⏳ Vinculando...' : '🔗 VINCULAR WALLET'}
                  </button>
                </div>
                {isEditingRegisteredWallet && (
                  <button
                    type="button"
                    className="crypto-cancel-link-btn"
                    onClick={() => setIsEditingRegisteredWallet(false)}
                  >
                    Cancelar y conservar wallet actual
                  </button>
                )}
              </form>
            ) : (
              <div className="crypto-registered-wallet-pill">
                <div className="crypto-registered-info">
                  <span className="crypto-registered-tag">✅ WALLET PERSONAL VINCULADA:</span>
                  <code className="crypto-registered-addr">{depositInfo.registeredWallet.address}</code>
                </div>
                <button
                  type="button"
                  className="crypto-change-wallet-btn"
                  onClick={() => setIsEditingRegisteredWallet(true)}
                  title="Cambiar Wallet Personal"
                >
                  ✏️ Cambiar
                </button>
              </div>
            )}

            {/* ADVERTENCIA MUY VISIBLE SOBRE BINANCE Y EXCHANGES */}
            <div className="crypto-exchange-warning-box">
              <div className="crypto-warning-icon">⚠️</div>
              <div className="crypto-warning-content">
                <strong>REGLA FUNDAMENTAL DE DEPÓSITOS:</strong>
                <p>
                  Los depósitos se acreditan automáticamente <strong>ÚNICAMENTE</strong> cuando el USDT se transfiere desde la wallet personal registrada en tu cuenta.
                </p>
                <div className="crypto-flow-pill">
                  <span>BINANCE / EXCHANGE</span>
                  <span>➔</span>
                  <span>TU WALLET PERSONAL</span>
                  <span>➔</span>
                  <strong>PLANT ARENA (GEMAS)</strong>
                </div>
                <small>❌ NO envíes directamente desde Binance u otro exchange a la wallet de Plant Arena.</small>
              </div>
            </div>

            {/* PASO 2: ENVIAR USDT A LA DIRECCIÓN OFICIAL DE PLANT ARENA */}
            <div className="crypto-treasury-card">
              <div className="crypto-step-badge">2️⃣ PASO 2: ENVÍA USDT (BEP20) A ESTA DIRECCIÓN</div>

              <div className="crypto-treasury-meta-row">
                <span className="crypto-network-badge">🟡 RED: BNB Smart Chain (BEP20)</span>
                <span className="crypto-token-badge">💵 TOKEN: USDT</span>
                <span className="crypto-rate-badge">💎 1 USDT = 100 GEMAS</span>
              </div>

              <div className="crypto-treasury-address-box">
                <span className="crypto-treasury-lbl">Dirección Oficial de Depósito de Plant Arena:</span>
                <div className="crypto-address-copy-row">
                  <code className="crypto-address-text">{depositInfo.treasuryWallet}</code>
                  <button
                    type="button"
                    className="crypto-copy-btn"
                    onClick={handleCopyTreasury}
                  >
                    {copiedTreasury ? '✓ ¡COPIADO!' : '📋 COPIAR'}
                  </button>
                </div>
              </div>

              <div className="crypto-detector-status-bar">
                <span className="crypto-detector-pulse">🟢 Cron Automático 24/7 Activo</span>
                <button
                  type="button"
                  className="crypto-refresh-blockchain-btn"
                  onClick={() => handleCheckBlockchainDeposits(false)}
                  disabled={isCheckingDeposits}
                >
                  {isCheckingDeposits ? '⏳ Escaneando...' : '🔄 Comprobar Blockchain Ahora'}
                </button>
              </div>

              {/* Opción rápida de verificación directa por Hash de transacción */}
              <div style={{ marginTop: '10px', textAlign: 'center' }}>
                {!showManualTxInput ? (
                  <button
                    type="button"
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#94a3b8',
                      fontSize: '11px',
                      cursor: 'pointer',
                      textDecoration: 'underline',
                    }}
                    onClick={() => setShowManualTxInput(true)}
                  >
                    ¿Ya enviaste y tienes el Hash de la transacción? Verificar por Hash
                  </button>
                ) : (
                  <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}>
                    <input
                      type="text"
                      placeholder="0x... (Hash de la transacción)"
                      value={manualTxHashInput}
                      onChange={(e) => setManualTxHashInput(e.target.value)}
                      style={{
                        flex: 1,
                        padding: '6px 10px',
                        background: 'rgba(0,0,0,0.4)',
                        border: '1px solid rgba(255,255,255,0.15)',
                        borderRadius: '6px',
                        color: '#fff',
                        fontSize: '11px',
                      }}
                    />
                    <button
                      type="button"
                      disabled={isCheckingDeposits || !manualTxHashInput.trim()}
                      onClick={() => {
                        handleCheckBlockchainDeposits(false, manualTxHashInput.trim())
                      }}
                      style={{
                        padding: '6px 12px',
                        background: '#3b82f6',
                        border: 'none',
                        borderRadius: '6px',
                        color: '#fff',
                        fontWeight: 'bold',
                        fontSize: '11px',
                        cursor: 'pointer',
                      }}
                    >
                      {isCheckingDeposits ? '⏳' : 'Verificar'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowManualTxInput(false)}
                      style={{
                        padding: '6px 8px',
                        background: 'rgba(255,255,255,0.1)',
                        border: 'none',
                        borderRadius: '6px',
                        color: '#ccc',
                        fontSize: '11px',
                        cursor: 'pointer',
                      }}
                    >
                      ✕
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: RETIRAR USDT BEP20 (5% COMISIÓN) */}
        {activeTab === 'withdraw' && (
          <form onSubmit={handleOpenWithdrawConfirm} noValidate className="profile-tab-body">
            <div className="profile-section-title">
              <span>💸 RETIRO DE FONDOS (GEMAS → USDT BEP20)</span>
              <small>Retira tus gemas a cualquier wallet BEP20 compatible con USDT. Comisión de red: <strong>5%</strong>.</small>
            </div>

            {/* DUAL BALANCE BREAKDOWN CARDS */}
            <div className="profile-dual-balance-grid">
              <div className="profile-balance-card profile-balance-card--total">
                <div className="profile-balance-card__icon">💎</div>
                <div className="profile-balance-card__info">
                  <span className="profile-balance-card__label">TOTAL DE GEMAS</span>
                  <strong className="profile-balance-card__value">{currentTotalGems.toLocaleString()} 💎</strong>
                  <small className="profile-balance-card__sub">Saldo total utilizable en todo el juego</small>
                </div>
              </div>

              <div className="profile-balance-card profile-balance-card--withdrawable">
                <div className="profile-balance-card__icon">💸</div>
                <div className="profile-balance-card__info">
                  <span className="profile-balance-card__label">SALDO RETIRABLE</span>
                  <strong className="profile-balance-card__value profile-balance-card__value--success">
                    {currentWithdrawableGems.toLocaleString()} 💎
                  </strong>
                  <small className="profile-balance-card__sub">Equivalente a ${(currentWithdrawableGems / 100).toFixed(2)} USDT</small>
                </div>
              </div>

              <div className="profile-balance-card profile-balance-card--locked">
                <div className="profile-balance-card__icon">🔒</div>
                <div className="profile-balance-card__info">
                  <span className="profile-balance-card__label">NO RETIRABLE / BONOS</span>
                  <strong className="profile-balance-card__value profile-balance-card__value--warning">
                    {currentLockedGems.toLocaleString()} 💎
                  </strong>
                  <small className="profile-balance-card__sub">Se gasta primero al jugar/comprar</small>
                </div>
              </div>
            </div>

            {/* AVISO TRANSPARENTE DEL SISTEMA DUAL */}
            <div className="profile-dual-balance-notice">
              <span className="profile-dual-balance-notice__badge">🛡️ REGLAS DE RETIRO Y BONOS</span>
              <p>
                <strong>50% de cada depósito</strong> + el <strong>100% de premios</strong> (Ruleta, Código Secreto, Clanes, Referidos y Mercado) van a tu <strong>Saldo Retirable</strong>. 
                Los bonos promocionales y la retención se gastan <strong>automáticamente primero</strong> al jugar partidas, comprar en tienda o participar en eventos.
              </p>
            </div>

            {/* Quick Amounts */}
            <div className="profile-quick-amounts">
              {[1000, 2500, 5000, 10000].map((amt) => (
                <button
                  key={amt}
                  type="button"
                  disabled={currentWithdrawableGems < amt}
                  className={`profile-quick-btn ${withdrawGems === amt ? 'profile-quick-btn--active' : ''}`}
                  onClick={() => setWithdrawGems(amt)}
                >
                  {amt.toLocaleString()} 💎
                </button>
              ))}
              <button
                type="button"
                className="profile-quick-btn profile-quick-btn--max"
                onClick={() => setWithdrawGems(Math.max(1000, currentWithdrawableGems))}
                disabled={currentWithdrawableGems < 1000}
              >
                MÁX RETIRABLE ({currentWithdrawableGems.toLocaleString()} 💎)
              </button>
            </div>

            <div className="profile-form-row">
              <label>Cantidad de Gemas a Retirar (Mínimo: 1,000.00 💎 • Máx Retirable: {currentWithdrawableGems.toLocaleString()} 💎):</label>
              <div className="profile-input-wrap">
                <span>💎</span>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={withdrawGems || ''}
                  onChange={(e) => setWithdrawGems(Math.max(0, Number(e.target.value)))}
                  className="profile-number-input"
                  placeholder="Ej: 1000"
                />
              </div>
              {withdrawGems > 0 && withdrawGems < 1000 && (
                <div className="profile-withdraw-hint-badge profile-withdraw-hint-badge--warning">
                  ⚠️ El retiro mínimo es de <strong>1,000 💎 (10.00 USDT)</strong>. Te faltan <strong>{(1000 - withdrawGems).toLocaleString()} 💎</strong>.
                </div>
              )}
              {withdrawGems > currentWithdrawableGems && (
                <div className="profile-withdraw-hint-badge profile-withdraw-hint-badge--error">
                  ⚠️ Supera tu saldo retirable disponible ({currentWithdrawableGems.toLocaleString()} 💎).
                </div>
              )}
              {withdrawGems >= 1000 && withdrawGems <= currentWithdrawableGems && (
                <div className="profile-withdraw-hint-badge profile-withdraw-hint-badge--success">
                  ✓ Monto válido para retiro: Recibirás aprox. <strong>{netWithdrawalUsdt.toFixed(2)} USDT</strong> netos.
                </div>
              )}
            </div>

            <div className="profile-form-row">
              <label>Wallet de Destino (Cualquier dirección BNB Smart Chain BEP20):</label>
              <input
                type="text"
                placeholder="0x... (Dirección BEP20 receptora)"
                value={withdrawAddress}
                onChange={(e) => setWithdrawAddress(e.target.value)}
                className="profile-text-input"
              />
            </div>

            {/* DESGLOSE DINÁMICO EN TIEMPO REAL */}
            <div className="crypto-settlement-breakdown-card">
              <div className="crypto-breakdown-header">
                <span>📋 RESUMEN DE LIQUIDACIÓN</span>
                <span className="crypto-net-pill">1 USDT = 100 GEMAS</span>
              </div>
              <div className="crypto-breakdown-row">
                <span>Monto Solicitado:</span>
                <strong>{withdrawGems.toLocaleString()} 💎</strong>
              </div>
              <div className="crypto-breakdown-row crypto-breakdown-row--fee">
                <span>Comisión de Retiro (5%):</span>
                <span style={{ color: '#f87171' }}>- {withdrawalFee.toLocaleString()} 💎</span>
              </div>
              <div className="crypto-breakdown-divider" />
              <div className="crypto-breakdown-row crypto-breakdown-row--net">
                <span>Recibirás en tu Wallet:</span>
                <strong style={{ color: '#4ade80', fontSize: '16px' }}>
                  {netWithdrawalUsdt.toFixed(2)} USDT
                </strong>
              </div>
              <div className="crypto-breakdown-row crypto-breakdown-row--meta">
                <small>Red: <strong>BNB Smart Chain (BEP20)</strong> • Token: <strong>USDT</strong> • Tasa: <strong>100 💎 = 1.00 USDT</strong></small>
              </div>
            </div>

            <button
              type="submit"
              className="profile-submit-action-btn profile-submit-action-btn--withdraw"
              disabled={isSubmittingWithdrawal}
            >
              {isSubmittingWithdrawal ? '⏳ PROCESANDO...' : `💸 SOLICITAR RETIRO DE ${netWithdrawalUsdt.toFixed(2)} USDT`}
            </button>
          </form>
        )}

        {/* TAB 4: REFERIDOS */}
        {activeTab === 'referrals' && (
          <div className="profile-tab-body">
            <PanelDeReferidos />
          </div>
        )}

        {/* TAB 5: HISTORIAL FINANCIERO */}
        {activeTab === 'history' && (
          <div className="profile-tab-body">
            <div className="profile-section-title">
              <span>📊 HISTORIAL FINANCIERO BLOCKCHAIN</span>
              <small>Registro de depósitos automáticos y retiros procesados en BNB Smart Chain.</small>
            </div>

            {isLoadingHistory ? (
              <div className="profile-loading-state">⏳ Cargando movimientos...</div>
            ) : (
              <div className="profile-tx-list">
                {financialHistory.deposits.length === 0 && financialHistory.withdrawals.length === 0 ? (
                  <div className="profile-empty-state">No hay movimientos financieros registrados.</div>
                ) : (
                  <>
                    {/* Retiros */}
                    {financialHistory.withdrawals.map((w: any) => (
                      <div key={w.id} className="profile-tx-row">
                        <div className="profile-tx-left">
                          <span className="profile-tx-icon">💸</span>
                          <div>
                            <span className="profile-tx-desc">
                              Retiro USDT ({w.amount_gems} 💎 ➔ {w.net_amount_usdt} USDT)
                            </span>
                            <span className="profile-tx-date">
                              Destino: {w.destination_wallet.slice(0, 8)}...{w.destination_wallet.slice(-6)}
                              {w.tx_hash && (
                                <> • <a href={`https://bscscan.com/tx/${w.tx_hash}`} target="_blank" rel="noreferrer" className="crypto-tx-link">
                                  TX: {w.tx_hash.slice(0, 8)}... ↗
                                </a></>
                              )}
                              • {new Date(w.created_at).toLocaleDateString()}
                              {w.status === 'failed' && w.failure_reason && (
                                <span style={{ color: '#f87171', display: 'block', fontSize: '10px' }}>
                                  Motivo: {w.failure_reason} (Saldo Reembolsado)
                                </span>
                              )}
                            </span>
                          </div>
                        </div>
                        <div className="profile-tx-right">
                          <span className="profile-tx-amount profile-tx-amount--neg">
                            -{w.amount_gems} 💎
                          </span>
                          <span className={`crypto-tx-badge crypto-tx-badge--${w.status}`}>
                            {w.status === 'requested' && '⏳ Solicitado'}
                            {w.status === 'processing' && '⚙️ Procesando'}
                            {w.status === 'broadcasted' && '📡 Transmitido'}
                            {w.status === 'completed' && '✓ Completado'}
                            {w.status === 'failed' && '❌ Fallido (Reembolsado)'}
                          </span>
                        </div>
                      </div>
                    ))}

                    {/* Depósitos */}
                    {financialHistory.deposits.map((d: any) => (
                      <div key={d.id} className="profile-tx-row">
                        <div className="profile-tx-left">
                          <span className="profile-tx-icon">💰</span>
                          <div>
                            <span className="profile-tx-desc">
                              Depósito USDT (+{d.amount_gems} 💎)
                            </span>
                            <span className="profile-tx-date">
                              TX: <a href={`https://bscscan.com/tx/${d.tx_hash}`} target="_blank" rel="noreferrer" className="crypto-tx-link">
                                {d.tx_hash.slice(0, 10)}... ↗
                              </a> • {new Date(d.created_at).toLocaleDateString()}
                            </span>
                          </div>
                        </div>
                        <div className="profile-tx-right">
                          <span className="profile-tx-amount profile-tx-amount--pos">
                            +{d.amount_gems} 💎
                          </span>
                          <span className="crypto-tx-badge crypto-tx-badge--completed">
                            ✓ {d.status}
                          </span>
                        </div>
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* MODAL DE CONFIRMACIÓN PREVIA AL RETIRO */}
      {showWithdrawConfirm && (
        <div className="withdraw-confirm-backdrop" onClick={() => setShowWithdrawConfirm(false)}>
          <div className="withdraw-confirm-card" onClick={(e) => e.stopPropagation()}>
            <div className="withdraw-confirm-icon">💸</div>
            <h3 className="withdraw-confirm-title">CONFIRMAR RETIRO DE FONDOS</h3>
            
            <div className="withdraw-confirm-details">
              <div className="withdraw-confirm-item">
                <span>Gemas a Descontar:</span>
                <strong>{withdrawGems.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} 💎</strong>
              </div>
              <div className="withdraw-confirm-item">
                <span>Comisión Plant Arena (5%):</span>
                <span style={{ color: '#f87171' }}>{withdrawalFee.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} 💎</span>
              </div>
              <div className="withdraw-confirm-item withdraw-confirm-item--net">
                <span>Neto a Recibir:</span>
                <strong style={{ color: '#4ade80' }}>{netWithdrawalUsdt.toFixed(2)} USDT</strong>
              </div>
              <div className="withdraw-confirm-item">
                <span>Red:</span>
                <span>BNB Smart Chain (BEP20)</span>
              </div>
              <div className="withdraw-confirm-item">
                <span>Wallet de Destino:</span>
                <code className="withdraw-confirm-dest">{withdrawAddress}</code>
              </div>
            </div>

            <div className="withdraw-confirm-actions">
              <button
                type="button"
                className="withdraw-confirm-cancel-btn"
                onClick={() => setShowWithdrawConfirm(false)}
                disabled={isSubmittingWithdrawal}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="withdraw-confirm-submit-btn"
                onClick={handleExecuteWithdrawal}
                disabled={isSubmittingWithdrawal}
              >
                {isSubmittingWithdrawal ? '⏳ Procesando...' : '✓ CONFIRMAR Y ENVIAR RETIRO'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
