import { useState, useEffect } from 'react'
import type { PlantId } from '../../types/game'
import { PLANT_CONFIGS } from '../../utils/gameConstants'
import { soundManager } from '../../utils/audioManager'
import { SupabaseService } from '../../services/supabaseService'
import './LotteryModal.css'

interface LotteryModalProps {
  isOpen: boolean
  onClose: () => void
  userTokens: number
  userGold?: number
  // Las recompensas ya no se conceden desde el cliente: las entrega el
  // servidor y onRewardsChanged sólo las trae a pantalla.
  /** Recarga saldo e inventario desde el servidor tras un premio. El premio ya
   *  está entregado en la base: esto sólo lo trae a la pantalla. */
  onRewardsChanged?: () => Promise<void> | void
}

interface WheelSector {
  id: string
  label: string
  icon: string
  color: string
  textColor: string
  type: 'token' | 'gold' | 'pack' | 'plant' | 'none'
  valueUsd?: number
  goldAmount?: number
  packId?: 'basic' | 'epic' | 'legendary'
  packQty?: number
  plantId?: PlantId
  plantQty?: number
  rarity: 'common' | 'rare' | 'epic' | 'legendary' | 'jackpot'
}

const WHEEL_SECTORS: WheelSector[] = [
  {
    id: 'jackpot_5',
    label: '5 Gemas 💎',
    icon: '👑',
    color: '#eab308',
    textColor: '#ffffff',
    type: 'token',
    valueUsd: 5.0,
    rarity: 'jackpot',
  },
  {
    id: 'none_1',
    label: 'Sigue Intentando',
    icon: '💨',
    color: '#475569',
    textColor: '#ffffff',
    type: 'none',
    rarity: 'common',
  },
  {
    id: 'gold_500',
    label: '500 Oro',
    icon: '🪙',
    color: '#f59e0b',
    textColor: '#ffffff',
    type: 'gold',
    goldAmount: 500,
    rarity: 'rare',
  },
  {
    id: 'none_2',
    label: 'Sigue Intentando',
    icon: '💨',
    color: '#334155',
    textColor: '#ffffff',
    type: 'none',
    rarity: 'common',
  },
  {
    id: 'pack_basic',
    label: 'Sobre Básico',
    icon: '📦',
    color: '#3b82f6',
    textColor: '#ffffff',
    type: 'pack',
    packId: 'basic',
    packQty: 1,
    rarity: 'common',
  },
  {
    id: 'gold_200',
    label: '200 Oro',
    icon: '🪙',
    color: '#10b981',
    textColor: '#ffffff',
    type: 'gold',
    goldAmount: 200,
    rarity: 'common',
  },
  {
    id: 'none_3',
    label: 'Sigue Intentando',
    icon: '💨',
    color: '#64748b',
    textColor: '#ffffff',
    type: 'none',
    rarity: 'common',
  },
  {
    id: 'gold_50',
    label: '50 Oro',
    icon: '🪙',
    color: '#8b5cf6',
    textColor: '#ffffff',
    type: 'gold',
    goldAmount: 50,
    rarity: 'common',
  },
]

const ALL_PLANTS_LIST: PlantId[] = Object.keys(PLANT_CONFIGS) as PlantId[]

const STORAGE_KEYS = {
  // Sólo queda esta, y para el contador visual de las 24 h: la cuenta real la
  // lleva user_lottery.last_free_spin en el servidor.
  LAST_FREE_SPIN: 'plant_arena_lottery_last_free_spin',
}

/**
 * Claves obsoletas del minijuego. La primera guardaba EL CÓDIGO SECRETO en el
 * navegador del jugador, así que hay que borrarla activamente de los navegadores
 * que ya la tengan: dejarla ahí no sirve para nada y expone el código de la
 * última ronda local.
 */
const LEGACY_CODE_KEYS = [
  'plant_arena_lottery_secret_code',
  'plant_arena_lottery_code_attempts',
  'plant_arena_lottery_code_last_free_reset',
  'plant_arena_lottery_code_free_used',
  'plant_arena_lottery_code_extra_attempts',
]

export const SECRET_CODE_LENGTH = 5

/** Ronda tal como la devuelve secret_code_state(). Sin el secreto, que no sale
 *  de Postgres. */
interface CodeRound {
  id: string
  roundNumber: number
  status: 'open' | 'finished' | 'cancelled'
  freeAttempts: number
  prizePool: number
  prizes: number[]
  winnerId: string | null
  codeVersion?: number
  plantCount?: number
  createdAt: string
  finishedAt: string | null
}

/** Un intento propio, con su secuencia: es del jugador, puede verla. */
interface ServerAttempt {
  id: string
  sequence: string[]
  exactCount: number
  wrongPosCount: number
  pct: number
  wasFree: boolean
  createdAt: string
}

/** Una fila de la clasificación. Nótese que NO hay secuencia: sólo el %. Es lo
 *  que permite competir sin que se copien las jugadas. */
interface BoardEntry {
  userId: string
  username: string
  avatarId: string
  bestPct: number
  attempts: number
  place: number
  isMe: boolean
}

// generateRandomSecretCode() se eliminó: era el origen del agujero. El navegador
// generaba el código y lo guardaba en localStorage, así que el jugador leía la
// respuesta. Ahora lo genera el servidor al abrir la ronda.

export default function LotteryModal({
  isOpen,
  onClose,
  userTokens,
  onRewardsChanged,
}: LotteryModalProps) {
  const [activeTab, setActiveTab] = useState<'wheel' | 'code'>('wheel')

  // --- TAB 1: WHEEL STATE ---
  const [isSpinning, setIsSpinning] = useState(false)
  const [wheelRotation, setWheelRotation] = useState(0)
  const [lastFreeSpinTime, setLastFreeSpinTime] = useState<number>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.LAST_FREE_SPIN)
    return saved ? parseInt(saved, 10) : 0
  })
  const [timeUntilFreeSpin, setTimeUntilFreeSpin] = useState<string>('')
  const [winningSector, setWinningSector] = useState<WheelSector | null>(null)
  const [showPrizeModal, setShowPrizeModal] = useState(false)
  const [showConfirmPaidModal, setShowConfirmPaidModal] = useState(false)
  const [showConfirmCodeBuyModal, setShowConfirmCodeBuyModal] = useState(false)

  // ── TAB 2: CÓDIGO SECRETO — TODO DESDE EL SERVIDOR ────────────────────────
  //
  // El estado local anterior guardaba el propio código secreto en localStorage
  // (generateRandomSecretCode + STORAGE_KEYS.CODE_SECRET). El jugador tenía la
  // respuesta a la vista y podía cobrar 20 gemas a la primera, ilimitadamente.
  //
  // Ahora nada de esto vive en el navegador: la ronda, los intentos disponibles,
  // el historial y la clasificación vienen de secret_code_state() y
  // secret_code_leaderboard(). El secreto no sale de Postgres en ningún caso.
  const [codeRound, setCodeRound] = useState<CodeRound | null>(null)
  const [codeAttemptsLeft, setCodeAttemptsLeft] = useState(0)
  const [codeFreeUsed, setCodeFreeUsed] = useState(0)
  const [codeExtra, setCodeExtra] = useState(0)
  const [codeHistory, setCodeHistory] = useState<ServerAttempt[]>([])
  const [codeBoard, setCodeBoard] = useState<BoardEntry[]>([])
  const [codeMyPayout, setCodeMyPayout] = useState<{ place: number; gems: number; tiedWith: number } | null>(null)
  const [codeBusy, setCodeBusy] = useState(false)

  const [selectedSequence, setSelectedSequence] = useState<(PlantId | null)[]>(
    () => Array(SECRET_CODE_LENGTH).fill(null)
  )
  const [codeWonPrize, setCodeWonPrize] = useState(false)
  const [codeBannerNotice, setCodeBannerNotice] = useState<string | null>(null)
  const [codeSubTab, setCodeSubTab] = useState<'play' | 'history' | 'ranking'>('play')

  // Free spin countdown timer
  useEffect(() => {
    const checkFreeSpinTimer = () => {
      const diff = Date.now() - lastFreeSpinTime
      const cooldown = 86400000 // 24h
      if (diff >= cooldown) {
        setTimeUntilFreeSpin('')
      } else {
        const remaining = cooldown - diff
        const hours = Math.floor(remaining / 3600000)
        const mins = Math.floor((remaining % 3600000) / 60000)
        const secs = Math.floor((remaining % 60000) / 1000)
        setTimeUntilFreeSpin(
          `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
        )
      }
    }

    checkFreeSpinTimer()
    const interval = setInterval(checkFreeSpinTimer, 1000)
    return () => clearInterval(interval)
  }, [lastFreeSpinTime])

  const canFreeSpin = !timeUntilFreeSpin

  // Intentos restantes: los calcula el servidor, aquí sólo se muestran.
  const freeAttemptsLeft = Math.max(0, (codeRound?.freeAttempts ?? 0) - codeFreeUsed)
  const totalAttemptsAvailable = codeAttemptsLeft
  const roundIsOpen = codeRound?.status === 'open'

  // Carga el estado de la ronda y la clasificación.
  const loadCodeData = async () => {
    const [st, board] = await Promise.all([
      SupabaseService.secretCodeState(),
      SupabaseService.secretCodeLeaderboard(),
    ])
    if (st) {
      setCodeRound((st.round as CodeRound) ?? null)
      setCodeAttemptsLeft(st.attemptsLeft ?? 0)
      setCodeFreeUsed(st.freeUsed ?? 0)
      setCodeExtra(st.extraAttempts ?? 0)
      setCodeHistory((st.attempts as ServerAttempt[]) ?? [])
      setCodeMyPayout(st.myPayout ?? null)
    }
    setCodeBoard(board as BoardEntry[])
  }

  // Se recarga al abrir el modal y al entrar en la pestaña del código, para que
  // la clasificación refleje los intentos de los demás.
  useEffect(() => {
    if (!isOpen) return
    LEGACY_CODE_KEYS.forEach((k) => localStorage.removeItem(k))
    void loadCodeData()
  }, [isOpen, activeTab])

  if (!isOpen) return null

  // ===================== WHEEL ACTIONS =====================
  /**
   * Gira la ruleta.
   *
   * ANTES: el navegador sorteaba el sector con Math.random() y luego se
   * acreditaba el premio llamando a onAddTokens(). Uno de los sectores son 20
   * gemas, o sea 20 USD en tu interfaz: el cliente decidía si ganaba el premio
   * mayor, y bastaba llamar a la función sin tocar la ruleta. El tiro gratis
   * diario también era una fecha en localStorage, reiniciable borrando la clave.
   *
   * AHORA: se pide el tiro al servidor, que cobra la gema o comprueba las 24 h,
   * sortea con los pesos de lottery_sectors y entrega el premio. La animación
   * sólo MUESTRA el resultado que ya decidió Postgres: gira hasta el sector que
   * vino en la respuesta.
   */
  const handleSpinWheel = async (isFree: boolean) => {
    if (isSpinning) return

    // Avisos locales sólo para no gastar una llamada en vano. Los que cuentan
    // son los del servidor.
    if (isFree && !canFreeSpin) {
      alert('Ya has usado tu tiro gratis diario. Puedes girar nuevamente por 1 Gema 💎.')
      return
    }
    if (!isFree && userTokens < 1.0) {
      alert('Gemas insuficientes (1 Gema 💎 requerida para un tiro adicional).')
      return
    }

    setIsSpinning(true)
    soundManager.playSound('click', 0.6)

    const res = await SupabaseService.spinLottery(!isFree)

    if (!res.success || !res.sectorId) {
      setIsSpinning(false)
      alert(res.error || 'No se pudo girar la ruleta.')
      return
    }

    if (isFree) {
      // Sólo para el contador visual de las 24 h. La cuenta real la lleva
      // user_lottery.last_free_spin en el servidor.
      setLastFreeSpinTime(Date.now())
      localStorage.setItem(STORAGE_KEYS.LAST_FREE_SPIN, String(Date.now()))
    }

    const targetIndex = WHEEL_SECTORS.findIndex((s) => s.id === res.sectorId)
    if (targetIndex === -1) {
      // El servidor devolvió un sector que la rueda no dibuja: no se puede
      // animar, pero el premio ya está entregado, así que se refresca y se avisa.
      console.error('[Lottery] sector desconocido en la rueda:', res.sectorId)
      setIsSpinning(false)
      await onRewardsChanged?.()
      alert(`¡Premio recibido: ${res.label ?? res.sectorId}!`)
      return
    }

    const sectorToWin = WHEEL_SECTORS[targetIndex]
    const sectorAngle = 360 / WHEEL_SECTORS.length
    const extraSpins = 6 * 360
    const targetSectorCenter = targetIndex * sectorAngle
    const finalDegree =
      wheelRotation + extraSpins + (360 - (wheelRotation % 360)) + (360 - targetSectorCenter)

    setWheelRotation(finalDegree)

    // 4,6 s de animación. El premio ya está en la base: esto es sólo el espectáculo.
    setTimeout(() => {
      setIsSpinning(false)
      setWinningSector(sectorToWin)
      setShowPrizeModal(true)
      if (sectorToWin.type === 'none') {
        soundManager.playSound('click', 0.8)
      } else {
        soundManager.playSound('victory', 0.9)
      }
      // Traer saldo e inventario reales.
      void onRewardsChanged?.()
    }, 4600)
  }

  // ===================== CODE (SECUENCIA) ACTIONS =====================
  const handleSelectPlantForSlot = (plantId: PlantId) => {
    if (isSpinning || !roundIsOpen || codeWonPrize) return
    soundManager.playSound('click', 0.3)
    const firstEmptyIndex = selectedSequence.findIndex((s) => s === null)
    if (firstEmptyIndex !== -1) {
      const next = [...selectedSequence]
      next[firstEmptyIndex] = plantId
      setSelectedSequence(next)
    } else {
      // Replace last slot
      const next = [...selectedSequence]
      next[SECRET_CODE_LENGTH - 1] = plantId
      setSelectedSequence(next)
    }
  }

  const handleClearSlot = (index: number) => {
    if (!roundIsOpen || codeWonPrize) return
    soundManager.playSound('click', 0.3)
    const next = [...selectedSequence]
    next[index] = null
    setSelectedSequence(next)
  }

  const handleClearAllSlots = () => {
    if (!roundIsOpen || codeWonPrize) return
    soundManager.playSound('click', 0.3)
    setSelectedSequence(Array(SECRET_CODE_LENGTH).fill(null))
  }

  /**
   * Compra 2 intentos por 1 gema. El precio está en shop_config y el cobro es
   * atómico en el servidor: antes descontaba gemas en el navegador que el
   * servidor no sabía que se habían gastado, y el siguiente refresco las
   * devolvía.
   */
  const handleBuyCodeAttempts = async () => {
    if (codeBusy || !roundIsOpen) return
    setCodeBusy(true)
    const res = await SupabaseService.buySecretCodeAttempts()
    setCodeBusy(false)

    if (!res.success) {
      setCodeBannerNotice(`⚠️ ${res.error || 'No se pudieron comprar intentos.'}`)
      setTimeout(() => setCodeBannerNotice(null), 4000)
      return
    }

    soundManager.playSound('plantation', 0.8)
    setCodeBannerNotice(`¡+${res.attemptsAdded} intentos por ${res.spent} 💎! 🎯`)
    setTimeout(() => setCodeBannerNotice(null), 3000)

    await loadCodeData()
    await onRewardsChanged?.()
  }

  /**
   * Prueba la secuencia.
   *
   * La comparación la hace guess_secret_code() en Postgres contra el secreto de
   * la ronda, descuenta un intento y, si son los 5 exactos, cierra la ronda y
   * reparte el bote en la misma transacción. Aquí sólo se muestra el resultado.
   */
  const handleCheckCode = async () => {
    if (codeBusy) return

    if (selectedSequence.some((p) => p === null)) {
      setCodeBannerNotice(`⚠️ Elige ${SECRET_CODE_LENGTH} plantas para completar la secuencia.`)
      setTimeout(() => setCodeBannerNotice(null), 3000)
      return
    }

    if (!roundIsOpen) {
      setCodeBannerNotice('⚠️ Ronda cerrada: ¡El código ya ha sido descifrado! Espera la próxima ronda.')
      setTimeout(() => setCodeBannerNotice(null), 4000)
      return
    }

    if (totalAttemptsAvailable <= 0) {
      setShowConfirmCodeBuyModal(true)
      return
    }

    setCodeBusy(true)
    const res = await SupabaseService.guessSecretCode(selectedSequence as string[])
    setCodeBusy(false)

    if (!res.success) {
      setCodeBannerNotice(`⚠️ ${res.error || 'No se pudo comprobar el código.'}`)
      setTimeout(() => setCodeBannerNotice(null), 4000)
      await loadCodeData()
      return
    }

    if (res.solved) {
      soundManager.playSound('victory', 1.0)
      setCodeWonPrize(true)
      setCodeBannerNotice('🏆 ¡Código descifrado! La ronda se ha cerrado y el premio está repartido.')
    } else {
      soundManager.playSound('defeat', 0.4)
      setCodeBannerNotice(
        `${res.pct}% de acercamiento · ${res.exactCount} exactas, ${res.wrongPosCount} en otra posición`
      )
      setTimeout(() => setCodeBannerNotice(null), 5000)
    }

    setSelectedSequence(Array(SECRET_CODE_LENGTH).fill(null))
    await loadCodeData()
    await onRewardsChanged?.()
  }

  return (
    <div className="lottery-backdrop" onClick={onClose}>
      <div className="lottery-modal-container" onClick={(e) => e.stopPropagation()}>
        {/* MODAL HEADER */}
        <div className="lottery-header">
          <div className="lottery-header__title-box">
            <span className="lottery-header__icon">🎰</span>
            <div>
              <h2 className="lottery-header__title">RULETA & CÓDIGO BOTÁNICO</h2>
              <p className="lottery-header__subtitle">
                Gira la Ruleta de la Suerte y Descifra el Código Secreto para ganar Gemas 💎 y grandes recompensas
              </p>
            </div>
          </div>

          <div className="lottery-header__right">
            <div className="lottery-user-balance">
              <span>💎 Saldo:</span>
              <strong>{userTokens} Gemas</strong>
            </div>
            <button type="button" className="lottery-close-btn" onClick={onClose}>
              ✕
            </button>
          </div>
        </div>

        {/* TOP NAVIGATION TABS */}
        <div className="lottery-tabs-bar">
          <button
            type="button"
            className={`lottery-tab-btn ${activeTab === 'wheel' ? 'lottery-tab-btn--active' : ''}`}
            onClick={() => {
              soundManager.playSound('click', 0.4)
              setActiveTab('wheel')
            }}
          >
            🎡 RULETA DE LA SUERTE
          </button>
          <button
            type="button"
            className={`lottery-tab-btn ${activeTab === 'code' ? 'lottery-tab-btn--active' : ''}`}
            onClick={() => {
              soundManager.playSound('click', 0.4)
              setActiveTab('code')
            }}
          >
            🔐 CÓDIGO SECRETO (¡GANA 10 💎!)
          </button>
        </div>

        {/* ===================== TAB 1: WHEEL ===================== */}
        {activeTab === 'wheel' && (
          <div className="lottery-wheel-tab-pane">
            <div className="lottery-wheel-content-grid">
              {/* LEFT: 3D LUCKY WHEEL */}
              <div className="lottery-wheel-visual-col">
                <div className="lottery-wheel-wrapper">
                  {/* Wheel Pointer */}
                  <div className="lottery-wheel-pointer">▼</div>

                  {/* Rotating Wheel Container */}
                  <div
                    className="lottery-wheel-disk"
                    style={{
                      transform: `rotate(${wheelRotation}deg)`,
                      transition: isSpinning ? 'transform 4.5s cubic-bezier(0.15, 0.9, 0.2, 1)' : 'none',
                    }}
                  >
                    {WHEEL_SECTORS.map((sec, idx) => {
                      const angle = (360 / WHEEL_SECTORS.length) * idx
                      return (
                        <div
                          key={sec.id}
                          className={`lottery-wheel-slice lottery-slice--${sec.rarity}`}
                          style={{
                            transform: `rotate(${angle}deg)`,
                            background: sec.color,
                          }}
                        >
                          <div className="lottery-slice-content">
                            <span className="lottery-slice-icon">{sec.icon}</span>
                            <span className="lottery-slice-label">{sec.label}</span>
                          </div>
                        </div>
                      )
                    })}
                  </div>

                  {/* Wheel Center Button */}
                  <button
                    type="button"
                    className={`lottery-wheel-center-hub ${isSpinning ? 'lottery-hub--spinning' : ''} ${!canFreeSpin ? 'lottery-hub--locked' : ''}`}
                    disabled={isSpinning || !canFreeSpin}
                    onClick={() => handleSpinWheel(true)}
                    title={canFreeSpin ? 'Girar tiro gratis' : 'Tiro gratis usado. Haz clic en "⚡ GIRAR POR 1 GEMA 💎"'}
                  >
                    <span>{isSpinning ? '🌀' : 'GIRAR'}</span>
                  </button>
                </div>
              </div>

              {/* RIGHT: WHEEL INFO & ACTION BUTTONS */}
              <div className="lottery-wheel-info-col">
                <div className="lottery-wheel-hero-card">
                  <div className="lottery-wheel-hero-badge">⭐ RULETA DE LA SUERTE</div>
                  <h3>¡PRUEBA TU SUERTE CADA DÍA!</h3>
                  <p>
                    Tienes <strong>1 Tiro Gratis cada 24 horas</strong> garantizado. También puedes adquirir giros extra por tan solo <strong>1 Gema 💎</strong>.
                  </p>
                </div>

                <div className="lottery-spin-action-box">
                  {canFreeSpin ? (
                    <button
                      type="button"
                      className="lottery-spin-btn lottery-spin-btn--free"
                      disabled={isSpinning}
                      onClick={() => handleSpinWheel(true)}
                    >
                      <span className="lottery-btn-sparkle">✨</span>
                      <span>🎉 GIRAR GRATIS (1 TIRO HOY)</span>
                    </button>
                  ) : (
                    <div className="lottery-free-cooldown-box">
                      <span className="lottery-cooldown-icon">⏳</span>
                      <div className="lottery-cooldown-text">
                        <strong>TIRO GRATIS USADO</strong>
                        <small>Próximo giro gratis en: {timeUntilFreeSpin}</small>
                      </div>
                    </div>
                  )}

                  <button
                    type="button"
                    className="lottery-spin-btn lottery-spin-btn--paid"
                    disabled={isSpinning || userTokens < 1.0}
                    onClick={() => {
                      soundManager.playSound('click', 0.4)
                      setShowConfirmPaidModal(true)
                    }}
                  >
                    <span>⚡ GIRAR POR 1 GEMA 💎</span>
                  </button>
                </div>

                {/* PRIZES HIGHLIGHT LIST */}
                <div className="lottery-prizes-preview-box">
                  <span className="lottery-prizes-title">🎁 PREMIOS EN ESTE SORTEO:</span>
                  <div className="lottery-prizes-tags-grid">
                    <div className="lottery-prize-tag lottery-prize-tag--jackpot">
                      👑 5 Gemas 💎 (Jackpot)
                    </div>
                    <div className="lottery-prize-tag lottery-prize-tag--legendary">
                      📦 Sobre Básico
                    </div>
                    <div className="lottery-prize-tag lottery-prize-tag--gold">
                      🪙 500, 200 y 50 Oro
                    </div>
                    <div className="lottery-prize-tag lottery-prize-tag--epic">
                      💨 Sigue Intentando
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ===================== TAB 2: CODE (PLANT SEQUENCE) ===================== */}
        {activeTab === 'code' && (
          <div className="lottery-code-tab-pane">
            {codeBannerNotice && (
              <div className="lottery-code-alert-banner">{codeBannerNotice}</div>
            )}

            {/* SUB-TABS: JUEGA | HISTORIAL | RANKING */}
            <div className="lottery-code-subtabs">
              <button
                type="button"
                className={`lottery-code-subtab-btn ${codeSubTab === 'play' ? 'lottery-code-subtab-btn--active' : ''}`}
                onClick={() => {
                  soundManager.playSound('click', 0.3)
                  setCodeSubTab('play')
                }}
              >
                🎮 JUEGA
              </button>
              <button
                type="button"
                className={`lottery-code-subtab-btn ${codeSubTab === 'history' ? 'lottery-code-subtab-btn--active' : ''}`}
                onClick={() => {
                  soundManager.playSound('click', 0.3)
                  setCodeSubTab('history')
                }}
              >
                📜 HISTORIAL ({codeHistory.length})
              </button>
              <button
                type="button"
                className={`lottery-code-subtab-btn ${codeSubTab === 'ranking' ? 'lottery-code-subtab-btn--active' : ''}`}
                onClick={() => {
                  soundManager.playSound('click', 0.3)
                  setCodeSubTab('ranking')
                }}
              >
                🏆 RANKING ({codeBoard.length})
              </button>
            </div>

            {/* SUBTAB 1: JUEGA */}
            {codeSubTab === 'play' && (
              <div className="lottery-code-layout-grid">
                {/* LEFT: PLANT PICKER */}
                <div className="lottery-code-picker-pane">
                  <div className="lottery-code-pane-header">
                    <h4>🌱 SELECCIONA TUS PLANTAS</h4>
                    <small>Haz clic para añadir a la combinación</small>
                  </div>

                  <div className="lottery-plants-compact-grid">
                    {ALL_PLANTS_LIST.map((plantId) => {
                      const conf = PLANT_CONFIGS[plantId]
                      const iconSrc = conf?.packetActive || conf?.icon
                      return (
                        <button
                          key={plantId}
                          type="button"
                          className="lottery-mini-plant-card"
                          disabled={!roundIsOpen || codeWonPrize}
                          onClick={() => handleSelectPlantForSlot(plantId)}
                          title={conf.name}
                        >
                          <img src={iconSrc} alt={conf.name} className="lottery-mini-plant-img" />
                          <span className="lottery-mini-plant-name">{conf.name}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* RIGHT: SEQUENCE SLOTS & CONTROLS */}
                <div className="lottery-code-game-pane">
                  {/* PROMO HERO BANNER */}
                  <div className="lottery-code-promo-banner">
                    <div className="lottery-promo-badge">
                      {roundIsOpen
                        ? `🔐 RONDA #${codeRound?.roundNumber} · BOTE ${codeRound?.prizePool ?? 10} 💎`
                        : codeRound
                          ? `⏸️ RONDA #${codeRound.roundNumber} FINALIZADA`
                          : '⏸️ SIN RONDA ACTIVA'}
                    </div>
                    <h3>¡ADIVINA LA SECUENCIA DE {SECRET_CODE_LENGTH} PLANTAS!</h3>
                    {roundIsOpen ? (
                      <p>
                        {codeRound?.freeAttempts ?? 3} intentos gratis por ronda. El primero que
                        acierte las {SECRET_CODE_LENGTH} en orden <strong>cierra la ronda</strong> y se lleva{' '}
                        <strong>{codeRound?.prizes?.[0] ?? 10} 💎</strong>.
                      </p>
                    ) : (
                      <p>
                        {codeRound?.winnerId
                          ? '🏆 ¡El código ya ha sido descifrado y la ronda está cerrada! Vuelve cuando se abra la siguiente.'
                          : 'No hay ninguna ronda abierta ahora mismo. Vuelve cuando se abra la siguiente.'}
                      </p>
                    )}
                  </div>

                  {/* 4 ACTIVE SLOTS */}
                  <div className="lottery-code-slots-row">
                    {selectedSequence.map((plantId, idx) => {
                      const conf = plantId ? PLANT_CONFIGS[plantId] : null
                      const iconSrc = conf ? conf.packetActive || conf.icon : null

                      return (
                        <div
                          key={idx}
                          className={`lottery-code-slot ${plantId ? 'lottery-code-slot--filled' : ''}`}
                          onClick={() => plantId && handleClearSlot(idx)}
                          title={plantId ? `Quitar ${conf?.name}` : `Slot #${idx + 1} vacío`}
                        >
                          <span className="lottery-slot-num">{idx + 1}</span>
                          {iconSrc ? (
                            <div className="lottery-slot-filled-content">
                              <img src={iconSrc} alt={conf?.name} className="lottery-slot-img" />
                              <span className="lottery-slot-plant-name">{conf?.name}</span>
                              <span className="lottery-slot-remove-badge">✕</span>
                            </div>
                          ) : (
                            <span className="lottery-slot-empty-icon">❓</span>
                          )}
                        </div>
                      )
                    })}
                  </div>

                  {/* ACTIONS & ATTEMPTS STATUS */}
                  <div className="lottery-code-controls-row">
                    <button
                      type="button"
                      className="lottery-code-clear-btn"
                      onClick={handleClearAllSlots}
                      disabled={selectedSequence.every((s) => s === null)}
                    >
                      🧹 LIMPIAR
                    </button>

                    <div className="lottery-attempts-indicator">
                      <span>Intentos:</span>
                      <strong>
                        {totalAttemptsAvailable} ({freeAttemptsLeft} gratis + {codeExtra} extra)
                      </strong>
                    </div>

                    <button
                      type="button"
                      className="lottery-code-buy-btn"
                      onClick={() => {
                        soundManager.playSound('click', 0.4)
                        setShowConfirmCodeBuyModal(true)
                      }}
                      disabled={userTokens < 1.0}
                      title="Pagar 1 Gema 💎 por 2 intentos adicionales"
                    >
                      ⚡ +2 INTENTOS (1 💎 Gema)
                    </button>

                    <button
                      type="button"
                      className="lottery-code-check-btn"
                      onClick={() => {
                        if (totalAttemptsAvailable <= 0) {
                          setShowConfirmCodeBuyModal(true)
                          return
                        }
                        handleCheckCode()
                      }}
                      disabled={selectedSequence.some((s) => s === null)}
                    >
                      🔮 VERIFICAR CÓDIGO
                    </button>
                  </div>

                  {/* ÚLTIMO INTENTO REALIZADO (PREVIEW) */}
                  {codeHistory.length > 0 && (() => {
                    const lastAtt = codeHistory[0]
                    return (
                      <div className="lottery-code-last-attempt-card">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ fontSize: '9px', fontWeight: 800, color: '#fbbf24' }}>Último Intento:</span>
                          <div className="lottery-history-cards">
                            {lastAtt.sequence.map((pId, pIdx) => {
                              const pConf = PLANT_CONFIGS[pId as PlantId]
                              const pIcon = pConf ? pConf.packetActive || pConf.icon : ''
                              return (
                                <div key={pIdx} className="lottery-hist-mini-card" title={pConf?.name}>
                                  <img src={pIcon} alt={pConf?.name} />
                                </div>
                              )
                            })}
                          </div>
                          <div className="lottery-history-pins">
                            {Array.from({ length: lastAtt.exactCount }).map((_, i) => (
                              <span key={`ex_${i}`} className="lottery-pin lottery-pin--exact" title="Posición exacta">🟢</span>
                            ))}
                            {Array.from({ length: lastAtt.wrongPosCount }).map((_, i) => (
                              <span key={`wp_${i}`} className="lottery-pin lottery-pin--wrong" title="Posición errónea">🟡</span>
                            ))}
                            {Array.from({ length: Math.max(0, (lastAtt.sequence?.length || SECRET_CODE_LENGTH) - lastAtt.exactCount - lastAtt.wrongPosCount) }).map((_, i) => (
                              <span key={`inc_${i}`} className="lottery-pin lottery-pin--miss" title="No está">🔴</span>
                            ))}
                          </div>
                          <strong className="lottery-history-pct" style={{ fontSize: '11px' }}>
                            {Number(lastAtt.pct).toFixed(1)}%
                          </strong>
                        </div>
                        <button
                          type="button"
                          className="lottery-view-all-btn"
                          onClick={() => setCodeSubTab('history')}
                        >
                          📜 Ver Historial ({codeHistory.length}) ➔
                        </button>
                      </div>
                    )
                  })()}
                </div>
              </div>
            )}

            {/* SUBTAB 2: HISTORIAL */}
            {codeSubTab === 'history' && (
              <div className="lottery-code-full-pane">
                <div className="lottery-code-history-box" style={{ flex: 1 }}>
                  <div className="lottery-history-header">
                    <h5>📜 HISTORIAL COMPLETO DE INTENTOS Y PISTAS:</h5>
                    <div className="lottery-pins-legend">
                      <span className="pin-tag pin-tag--exact">🟢 Posición Exacta</span>
                      <span className="pin-tag pin-tag--wrong">🟡 Posición Errónea</span>
                      <span className="pin-tag pin-tag--miss">🔴 No Está</span>
                    </div>
                  </div>

                  <div className="lottery-history-list" style={{ minHeight: '260px', maxHeight: '380px' }}>
                    {codeHistory.length === 0 ? (
                      <div className="lottery-history-empty">
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'center' }}>
                          <span>Aún no has realizado intentos en esta ronda. ¡Elige {SECRET_CODE_LENGTH} plantas y pon a prueba tu deducción!</span>
                          <button
                            type="button"
                            className="lottery-code-check-btn"
                            style={{ fontSize: '11px', padding: '6px 14px' }}
                            onClick={() => setCodeSubTab('play')}
                          >
                            🎮 ¡Probar Primera Combinación!
                          </button>
                        </div>
                      </div>
                    ) : (
                      codeHistory.map((att, idx) => (
                        <div key={att.id} className="lottery-history-row">
                          <span className="lottery-history-num">#{codeHistory.length - idx}</span>
                          <div className="lottery-history-cards">
                            {att.sequence.map((pId, pIdx) => {
                              const pConf = PLANT_CONFIGS[pId as PlantId]
                              const pIcon = pConf ? pConf.packetActive || pConf.icon : ''
                              return (
                                <div key={pIdx} className="lottery-hist-mini-card" title={pConf?.name}>
                                  <img src={pIcon} alt={pConf?.name} />
                                </div>
                              )
                            })}
                          </div>

                          <div className="lottery-history-pins">
                            {Array.from({ length: att.exactCount }).map((_, i) => (
                              <span key={`ex_${i}`} className="lottery-pin lottery-pin--exact" title="Planta y posición correcta">
                                🟢
                              </span>
                            ))}
                            {Array.from({ length: att.wrongPosCount }).map((_, i) => (
                              <span key={`wp_${i}`} className="lottery-pin lottery-pin--wrong" title="Planta correcta, posición errónea">
                                🟡
                              </span>
                            ))}
                            {Array.from({ length: Math.max(0, (att.sequence?.length || SECRET_CODE_LENGTH) - att.exactCount - att.wrongPosCount) }).map((_, i) => (
                              <span key={`inc_${i}`} className="lottery-pin lottery-pin--miss" title="Planta no está en la clave">
                                🔴
                              </span>
                            ))}
                          </div>

                          <strong
                            className="lottery-history-pct"
                            style={{ marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' }}
                            title="Acercamiento: cada acierto exacto vale el doble que una planta en posición errónea"
                          >
                            {Number(att.pct).toFixed(1)}%
                          </strong>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* SUBTAB 3: RANKING */}
            {codeSubTab === 'ranking' && (
              <div className="lottery-code-full-pane">
                <div className="lottery-code-history-box" style={{ flex: 1 }}>
                  <div className="lottery-history-header">
                    <h5>🏆 CLASIFICACIÓN DE LA RONDA:</h5>
                    <div className="lottery-pins-legend">
                      <span className="pin-tag pin-tag--exact">
                        Bote {codeRound?.prizePool ?? 20} 💎 · {(codeRound?.prizes?.[0] ?? 10)} / {(codeRound?.prizes?.[1] ?? 6)} / {(codeRound?.prizes?.[2] ?? 4)}
                      </span>
                    </div>
                  </div>

                  <div className="lottery-history-list" style={{ minHeight: '260px', maxHeight: '380px' }}>
                    {codeBoard.length === 0 ? (
                      <div className="lottery-history-empty">
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'center' }}>
                          <span>Nadie ha probado todavía en esta ronda. ¡Sé el primero en jugar!</span>
                          <button
                            type="button"
                            className="lottery-code-check-btn"
                            style={{ fontSize: '11px', padding: '6px 14px' }}
                            onClick={() => setCodeSubTab('play')}
                          >
                            🎮 ¡Comenzar a Jugar!
                          </button>
                        </div>
                      </div>
                    ) : (
                      codeBoard.map((e) => {
                        const premio =
                          e.place <= 3 ? (codeRound?.prizes?.[e.place - 1] ?? 0) : 0
                        const empatados = codeBoard.filter((o) => o.bestPct === e.bestPct).length
                        return (
                          <div
                            key={e.userId}
                            className="lottery-history-row"
                            style={e.isMe ? { outline: '1px solid #6366f1', background: 'rgba(99, 102, 241, 0.2)' } : undefined}
                          >
                            <span className="lottery-history-num">
                              {e.place === 1 ? '🥇' : e.place === 2 ? '🥈' : e.place === 3 ? '🥉' : `#${e.place}`}
                            </span>
                            <span style={{ flex: 1, fontWeight: e.isMe ? 800 : 500, color: e.isMe ? '#a5b4fc' : '#ffffff' }}>
                              {e.username}{e.isMe ? ' (tú)' : ''}
                            </span>
                            <span
                              style={{ fontVariantNumeric: 'tabular-nums', opacity: 0.75, marginRight: 10 }}
                              title="Intentos realizados"
                            >
                              {e.attempts} int.
                            </span>
                            <strong style={{ fontVariantNumeric: 'tabular-nums', minWidth: 60, textAlign: 'right' }}>
                              {Number(e.bestPct).toFixed(1)}%
                            </strong>
                            {premio > 0 && (
                              <span
                                style={{ marginLeft: 10, fontVariantNumeric: 'tabular-nums', color: '#fbbf24', fontWeight: 800 }}
                                title={empatados > 1 ? `Empate entre ${empatados}: el premio del puesto se divide` : 'Premio de este puesto'}
                              >
                                {(premio / empatados).toFixed(2)} 💎
                                {empatados > 1 && <em style={{ opacity: 0.7 }}> (÷{empatados})</em>}
                              </span>
                            )}
                          </div>
                        )
                      })
                    )}
                  </div>

                  {codeMyPayout && (
                    <div className="lottery-code-alert-banner" style={{ marginTop: 10 }}>
                      🏅 Cobraste {codeMyPayout.gems} 💎 por el puesto {codeMyPayout.place}
                      {codeMyPayout.tiedWith > 1 && ` (empate entre ${codeMyPayout.tiedWith})`}.
                    </div>
                  )}

                  <p style={{ fontSize: 11, opacity: 0.7, marginTop: 10, lineHeight: 1.5 }}>
                    Sólo se publica el porcentaje de cada jugador, nunca las plantas que
                    probó. Si dos empatan, el premio de ese puesto se divide entre ellos.
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ===================== PRIZE POPUP MODAL (WHEEL) ===================== */}
        {showPrizeModal && winningSector && (
          <div className="lottery-prize-overlay" onClick={() => setShowPrizeModal(false)}>
            <div className="lottery-prize-box" onClick={(e) => e.stopPropagation()}>
              <div className="lottery-prize-confetti">
                {winningSector.type === 'none' ? '💨 🍀 ✨' : '🎉 🎊 ✨'}
              </div>
              <div
                className="lottery-prize-badge"
                style={winningSector.type === 'none' ? { background: '#64748b', color: '#ffffff' } : undefined}
              >
                {winningSector.type === 'none' ? '¡SIGUE INTENTANDO!' : '¡FELICITACIONES!'}
              </div>
              <div className="lottery-prize-icon">{winningSector.icon}</div>
              <h3 className="lottery-prize-name">{winningSector.label}</h3>
              <p className="lottery-prize-desc">
                {winningSector.type === 'none'
                  ? '¡No te desanimes! Vuelve mañana para tu tiro gratis diario o gira por 1 Gema 💎.'
                  : winningSector.type === 'token'
                  ? `¡Se han acreditado ${winningSector.valueUsd?.toFixed(0)} Gemas 💎 a tu cuenta!`
                  : winningSector.type === 'gold'
                  ? `¡Has ganado ${winningSector.goldAmount?.toLocaleString()} Monedas de Oro!`
                  : winningSector.type === 'pack'
                  ? `¡Se ha añadido ${winningSector.packQty}x ${winningSector.label} a tus sobres pendientes!`
                  : `¡Has recibido ${winningSector.plantQty}x copias de planta para tu jardín!`}
              </p>
              <button
                type="button"
                className="lottery-prize-claim-btn"
                onClick={() => {
                  soundManager.playSound('click', 0.4)
                  setShowPrizeModal(false)
                }}
              >
                {winningSector.type === 'none' ? 'ENTENDIDO' : 'RECLAMAR RECOMPENSA'}
              </button>
            </div>
          </div>
        )}

        {/* ===================== JACKPOT POPUP (CODE WIN) ===================== */}
        {codeWonPrize && (
          <div className="lottery-prize-overlay" onClick={() => setCodeWonPrize(false)}>
            <div className="lottery-prize-box lottery-prize-box--jackpot" onClick={(e) => e.stopPropagation()}>
              <div className="lottery-prize-confetti">👑 💎 💰 🎊</div>
              <div className="lottery-prize-badge" style={{ background: '#eab308', color: '#000' }}>
                ¡CÓDIGO BOTÁNICO DESCIFRADO!
              </div>
              <div className="lottery-prize-icon">💎</div>
              <h3 className="lottery-prize-name" style={{ color: '#4ade80' }}>
                +10 GEMAS 💎
              </h3>
              <p className="lottery-prize-desc">
                ¡Increíble deducción! Has acertado las {SECRET_CODE_LENGTH} plantas en la posición exacta y ganado el <strong>Gran Premio de 10 Gemas 💎</strong>.
              </p>
              <button
                type="button"
                className="lottery-prize-claim-btn"
                onClick={() => {
                  soundManager.playSound('click', 0.4)
                  setCodeWonPrize(false)
                }}
              >
                ¡RECLAMAR 10 GEMAS 💎!
              </button>
            </div>
          </div>
        )}
        {/* ===================== CONFIRM PAID SPIN POPUP ===================== */}
        {showConfirmPaidModal && (
          <div className="lottery-prize-overlay" onClick={() => setShowConfirmPaidModal(false)}>
            <div className="lottery-confirm-box" onClick={(e) => e.stopPropagation()}>
              <div className="lottery-confirm-icon">⚡</div>
              <h3>CONFIRMAR GIRO DE RULETA</h3>
              <p>
                ¿Deseas pagar <strong>1 Gema 💎</strong> de tu saldo para girar la Ruleta de la Suerte y probar tu suerte?
              </p>
              <div className="lottery-confirm-balance">
                Saldo actual: <strong>{userTokens} Gemas 💎</strong>
              </div>
              <div className="lottery-confirm-actions">
                <button
                  type="button"
                  className="lottery-confirm-cancel-btn"
                  onClick={() => setShowConfirmPaidModal(false)}
                >
                  CANCELAR
                </button>
                <button
                  type="button"
                  className="lottery-confirm-accept-btn"
                  onClick={() => {
                    setShowConfirmPaidModal(false)
                    handleSpinWheel(false)
                  }}
                >
                  SÍ, GIRAR (1 💎)
                </button>
              </div>
            </div>
          </div>
        )}
        {/* ===================== CONFIRM CODE ATTEMPTS POPUP ===================== */}
        {showConfirmCodeBuyModal && (
          <div className="lottery-prize-overlay" onClick={() => setShowConfirmCodeBuyModal(false)}>
            <div className="lottery-confirm-box" onClick={(e) => e.stopPropagation()}>
              <div className="lottery-confirm-icon">🎯</div>
              <h3>COMPRAR INTENTOS DE CÓDIGO</h3>
              <p>
                ¿Deseas pagar <strong>1 Gema 💎</strong> para adquirir <strong>2 INTENTOS ADICIONALES</strong> y descifrar la secuencia para ganar las <strong>10 Gemas 💎</strong>?
              </p>
              <div className="lottery-confirm-balance">
                Saldo actual: <strong>{userTokens} Gemas 💎</strong> (Recibes: +2 Intentos)
              </div>
              <div className="lottery-confirm-actions">
                <button
                  type="button"
                  className="lottery-confirm-cancel-btn"
                  onClick={() => setShowConfirmCodeBuyModal(false)}
                >
                  CANCELAR
                </button>
                <button
                  type="button"
                  className="lottery-confirm-accept-btn"
                  onClick={() => {
                    setShowConfirmCodeBuyModal(false)
                    handleBuyCodeAttempts()
                  }}
                >
                  SÍ, COMPRAR 2 INTENTOS (1 💎)
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
