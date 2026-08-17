import { useState, useEffect } from 'react'
import type { PlantId } from '../../types/game'
import { PLANT_CONFIGS } from '../../utils/gameConstants'
import { soundManager } from '../../utils/audioManager'
import './LotteryModal.css'

interface LotteryModalProps {
  isOpen: boolean
  onClose: () => void
  userTokens: number
  userGold?: number
  onDeductTokens: (amountUsd: number) => boolean
  onAddTokens: (amountUsd: number) => void
  onAddGold?: (amount: number) => void
  onAddPacks?: (packId: 'basic' | 'epic' | 'legendary', qty: number) => void
  onReceivePlant?: (plantId: PlantId, qty: number) => void
}

interface WheelSector {
  id: string
  label: string
  icon: string
  color: string
  textColor: string
  type: 'token' | 'gold' | 'pack' | 'plant'
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
    id: 'jackpot_20',
    label: '20 Gemas 💎',
    icon: '👑',
    color: '#eab308',
    textColor: '#ffffff',
    type: 'token',
    valueUsd: 20.0,
    rarity: 'jackpot',
  },
  {
    id: 'pack_legendary',
    label: 'Sobre Dorado',
    icon: '📦',
    color: '#f59e0b',
    textColor: '#ffffff',
    type: 'pack',
    packId: 'legendary',
    packQty: 1,
    rarity: 'legendary',
  },
  {
    id: 'gold_5000',
    label: '5,000 Oro',
    icon: '🪙',
    color: '#3b82f6',
    textColor: '#ffffff',
    type: 'gold',
    goldAmount: 5000,
    rarity: 'rare',
  },
  {
    id: 'usd_1',
    label: '1 Gema 💎',
    icon: '💎',
    color: '#10b981',
    textColor: '#ffffff',
    type: 'token',
    valueUsd: 1.0,
    rarity: 'common',
  },
  {
    id: 'plant_repeater',
    label: '3x Repetidor',
    icon: '🌱',
    color: '#8b5cf6',
    textColor: '#ffffff',
    type: 'plant',
    plantId: 'repeater',
    plantQty: 3,
    rarity: 'epic',
  },
  {
    id: 'pack_epic',
    label: 'Sobre Épico',
    icon: '📦',
    color: '#a855f7',
    textColor: '#ffffff',
    type: 'pack',
    packId: 'epic',
    packQty: 1,
    rarity: 'epic',
  },
  {
    id: 'gold_2500',
    label: '2,500 Oro',
    icon: '🪙',
    color: '#06b6d4',
    textColor: '#ffffff',
    type: 'gold',
    goldAmount: 2500,
    rarity: 'common',
  },
  {
    id: 'usd_5',
    label: '5 Gemas 💎',
    icon: '💎',
    color: '#22c55e',
    textColor: '#ffffff',
    type: 'token',
    valueUsd: 5.0,
    rarity: 'legendary',
  },
  {
    id: 'plant_twinsunflower',
    label: '3x Girasol 2x',
    icon: '🌻',
    color: '#ec4899',
    textColor: '#ffffff',
    type: 'plant',
    plantId: 'twinsunflower',
    plantQty: 3,
    rarity: 'epic',
  },
  {
    id: 'pack_basic_2',
    label: '2x Sobre Básico',
    icon: '📦',
    color: '#14b8a6',
    textColor: '#ffffff',
    type: 'pack',
    packId: 'basic',
    packQty: 2,
    rarity: 'common',
  },
]

const ALL_PLANTS_LIST: PlantId[] = Object.keys(PLANT_CONFIGS) as PlantId[]

const STORAGE_KEYS = {
  LAST_FREE_SPIN: 'plant_arena_lottery_last_free_spin',
  CODE_SECRET: 'plant_arena_lottery_secret_code',
  CODE_ATTEMPTS_HISTORY: 'plant_arena_lottery_code_attempts',
  CODE_LAST_FREE_RESET: 'plant_arena_lottery_code_last_free_reset',
  CODE_FREE_USED_COUNT: 'plant_arena_lottery_code_free_used',
  CODE_EXTRA_ATTEMPTS: 'plant_arena_lottery_code_extra_attempts',
}

interface CodeAttemptRecord {
  id: string
  sequence: PlantId[]
  exactCount: number
  wrongPosCount: number
  incorrectCount: number
  timestamp: number
}

function generateRandomSecretCode(): PlantId[] {
  const shuffled = [...ALL_PLANTS_LIST].sort(() => 0.5 - Math.random())
  return shuffled.slice(0, 4)
}

export default function LotteryModal({
  isOpen,
  onClose,
  userTokens,
  onDeductTokens,
  onAddTokens,
  onAddGold,
  onAddPacks,
  onReceivePlant,
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

  // --- TAB 2: CODE (ADIVINA LA SECUENCIA) STATE ---
  const [secretCode, setSecretCode] = useState<PlantId[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.CODE_SECRET)
      if (saved) {
        const parsed = JSON.parse(saved)
        if (Array.isArray(parsed) && parsed.length === 4) return parsed
      }
    } catch {}
    const fresh = generateRandomSecretCode()
    localStorage.setItem(STORAGE_KEYS.CODE_SECRET, JSON.stringify(fresh))
    return fresh
  })

  const [selectedSequence, setSelectedSequence] = useState<(PlantId | null)[]>([null, null, null, null])
  const [attemptsHistory, setAttemptsHistory] = useState<CodeAttemptRecord[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.CODE_ATTEMPTS_HISTORY)
      if (saved) return JSON.parse(saved)
    } catch {}
    return []
  })

  const [freeAttemptsUsedToday, setFreeAttemptsUsedToday] = useState<number>(() => {
    const lastReset = parseInt(localStorage.getItem(STORAGE_KEYS.CODE_LAST_FREE_RESET) || '0', 10)
    const isToday = Date.now() - lastReset < 86400000
    if (!isToday) {
      localStorage.setItem(STORAGE_KEYS.CODE_LAST_FREE_RESET, Date.now().toString())
      localStorage.setItem(STORAGE_KEYS.CODE_FREE_USED_COUNT, '0')
      return 0
    }
    return parseInt(localStorage.getItem(STORAGE_KEYS.CODE_FREE_USED_COUNT) || '0', 10)
  })

  const [extraAttempts, setExtraAttempts] = useState<number>(() => {
    return parseInt(localStorage.getItem(STORAGE_KEYS.CODE_EXTRA_ATTEMPTS) || '0', 10)
  })

  const [codeWonPrize, setCodeWonPrize] = useState(false)
  const [codeBannerNotice, setCodeBannerNotice] = useState<string | null>(null)

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

  // Total code attempts remaining
  const freeAttemptsLeft = Math.max(0, 2 - freeAttemptsUsedToday)
  const totalAttemptsAvailable = freeAttemptsLeft + extraAttempts

  if (!isOpen) return null

  // ===================== WHEEL ACTIONS =====================
  const handleSpinWheel = (isFree: boolean) => {
    if (isSpinning) return

    if (isFree) {
      if (!canFreeSpin) {
        alert('Ya has usado tu tiro gratis diario. Puedes girar nuevamente por 1 Gema 💎.')
        return
      }
      const now = Date.now()
      setLastFreeSpinTime(now)
      localStorage.setItem(STORAGE_KEYS.LAST_FREE_SPIN, now.toString())
    } else {
      if (userTokens < 1.0) {
        alert('Gemas insuficientes (1 Gema 💎 requerida para un tiro adicional).')
        return
      }
      const deducted = onDeductTokens(1.0)
      if (!deducted) return
    }

    setIsSpinning(true)
    soundManager.playSound('click', 0.6)

    // Select random winning sector with weighted odds
    const totalSectors = WHEEL_SECTORS.length
    const sectorAngle = 360 / totalSectors

    // Weighted random selection
    const rand = Math.random() * 100
    let targetIndex = 0
    if (rand < 2) {
      targetIndex = 0 // 20 Gemas (2%)
    } else if (rand < 6) {
      targetIndex = 7 // 5 Gemas (4%)
    } else if (rand < 12) {
      targetIndex = 1 // Sobre Legendario (6%)
    } else if (rand < 22) {
      targetIndex = 4 // 3x Repetidor (10%)
    } else if (rand < 34) {
      targetIndex = 8 // 3x Girasol Doble (12%)
    } else if (rand < 48) {
      targetIndex = 5 // Sobre Épico (14%)
    } else if (rand < 65) {
      targetIndex = 2 // 5,000 Oro (17%)
    } else if (rand < 80) {
      targetIndex = 3 // 1 Gema (15%)
    } else if (rand < 90) {
      targetIndex = 6 // 2,500 Oro (10%)
    } else {
      targetIndex = 9 // 2x Sobre Básico (10%)
    }

    const sectorToWin = WHEEL_SECTORS[targetIndex]

    // Calculate rotation: multiple full spins + offset to land pointer dead center on selected sector
    const extraSpins = 6 * 360 // 6 full rotations
    const targetSectorCenter = targetIndex * sectorAngle
    const finalDegree = wheelRotation + extraSpins + (360 - (wheelRotation % 360)) + (360 - targetSectorCenter)

    setWheelRotation(finalDegree)

    // Spin duration 4.5 seconds
    setTimeout(() => {
      setIsSpinning(false)
      setWinningSector(sectorToWin)
      setShowPrizeModal(true)
      soundManager.playSound('victory', 0.9)

      // Award prize
      if (sectorToWin.type === 'token' && sectorToWin.valueUsd) {
        onAddTokens(sectorToWin.valueUsd)
      } else if (sectorToWin.type === 'gold' && sectorToWin.goldAmount) {
        if (onAddGold) onAddGold(sectorToWin.goldAmount)
      } else if (sectorToWin.type === 'pack' && sectorToWin.packId && sectorToWin.packQty) {
        if (onAddPacks) onAddPacks(sectorToWin.packId, sectorToWin.packQty)
      } else if (sectorToWin.type === 'plant' && sectorToWin.plantId && sectorToWin.plantQty) {
        if (onReceivePlant) onReceivePlant(sectorToWin.plantId, sectorToWin.plantQty)
      }
    }, 4600)
  }

  // ===================== CODE (SECUENCIA) ACTIONS =====================
  const handleSelectPlantForSlot = (plantId: PlantId) => {
    if (isSpinning) return
    soundManager.playSound('click', 0.3)
    const firstEmptyIndex = selectedSequence.findIndex((s) => s === null)
    if (firstEmptyIndex !== -1) {
      const next = [...selectedSequence]
      next[firstEmptyIndex] = plantId
      setSelectedSequence(next)
    } else {
      // Replace last slot
      const next = [...selectedSequence]
      next[3] = plantId
      setSelectedSequence(next)
    }
  }

  const handleClearSlot = (index: number) => {
    soundManager.playSound('click', 0.3)
    const next = [...selectedSequence]
    next[index] = null
    setSelectedSequence(next)
  }

  const handleClearAllSlots = () => {
    soundManager.playSound('click', 0.3)
    setSelectedSequence([null, null, null, null])
  }

  const handleBuyCodeAttempts = () => {
    if (userTokens < 1.0) {
      alert('Gemas insuficientes. Necesitas 1 Gema 💎 para comprar 2 intentos.')
      return
    }
    const deducted = onDeductTokens(1.0)
    if (!deducted) return

    const newTotal = extraAttempts + 2
    setExtraAttempts(newTotal)
    localStorage.setItem(STORAGE_KEYS.CODE_EXTRA_ATTEMPTS, newTotal.toString())
    soundManager.playSound('plantation', 0.8)
    setCodeBannerNotice('¡Has comprado 2 Intentos Extra por 1 Gema 💎! 🎯')
    setTimeout(() => setCodeBannerNotice(null), 3000)
  }

  const handleCheckCode = () => {
    // Verify 4 slots filled
    if (selectedSequence.some((p) => p === null)) {
      alert('Debes seleccionar 4 plantas para completar la secuencia.')
      return
    }

    // Verify attempts
    if (totalAttemptsAvailable <= 0) {
      handleBuyCodeAttempts()
      return
    }

    // Deduct attempt
    if (freeAttemptsLeft > 0) {
      const newFreeUsed = freeAttemptsUsedToday + 1
      setFreeAttemptsUsedToday(newFreeUsed)
      localStorage.setItem(STORAGE_KEYS.CODE_FREE_USED_COUNT, newFreeUsed.toString())
    } else {
      const newExtra = extraAttempts - 1
      setExtraAttempts(newExtra)
      localStorage.setItem(STORAGE_KEYS.CODE_EXTRA_ATTEMPTS, newExtra.toString())
    }

    const currentGuess = selectedSequence as PlantId[]

    // Evaluate guess (Mastermind logic)
    let exactCount = 0
    let wrongPosCount = 0
    const secretCopy = [...secretCode]
    const guessCopy = [...currentGuess]

    // 1st pass: exact matches
    for (let i = 0; i < 4; i++) {
      if (guessCopy[i] === secretCopy[i]) {
        exactCount++
        secretCopy[i] = null as any
        guessCopy[i] = null as any
      }
    }

    // 2nd pass: wrong position matches
    for (let i = 0; i < 4; i++) {
      if (guessCopy[i] !== null) {
        const foundIndex = secretCopy.findIndex((s) => s === guessCopy[i])
        if (foundIndex !== -1) {
          wrongPosCount++
          secretCopy[foundIndex] = null as any
        }
      }
    }

    const incorrectCount = 4 - (exactCount + wrongPosCount)

    const newRecord: CodeAttemptRecord = {
      id: `${Date.now()}_${Math.random()}`,
      sequence: currentGuess,
      exactCount,
      wrongPosCount,
      incorrectCount,
      timestamp: Date.now(),
    }

    const updatedHistory = [newRecord, ...attemptsHistory]
    setAttemptsHistory(updatedHistory)
    localStorage.setItem(STORAGE_KEYS.CODE_ATTEMPTS_HISTORY, JSON.stringify(updatedHistory))

    // Check Win (4 exact matches!)
    if (exactCount === 4) {
      soundManager.playSound('victory', 1.0)
      setCodeWonPrize(true)
      onAddTokens(20.0)

      // Reset with fresh secret code for next round
      setTimeout(() => {
        const fresh = generateRandomSecretCode()
        setSecretCode(fresh)
        localStorage.setItem(STORAGE_KEYS.CODE_SECRET, JSON.stringify(fresh))
        setAttemptsHistory([])
        localStorage.removeItem(STORAGE_KEYS.CODE_ATTEMPTS_HISTORY)
        setSelectedSequence([null, null, null, null])
      }, 4000)
    } else {
      soundManager.playSound('defeat', 0.4)
    }
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
            🔐 CÓDIGO SECRETO (¡GANA 20 💎!)
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
                      👑 20 Gemas 💎 (Jackpot)
                    </div>
                    <div className="lottery-prize-tag lottery-prize-tag--legendary">
                      📦 Sobre Legendario (5 Plantas)
                    </div>
                    <div className="lottery-prize-tag lottery-prize-tag--usd">
                      💎 5 Gemas & 1 Gema
                    </div>
                    <div className="lottery-prize-tag lottery-prize-tag--epic">
                      📦 Sobre Épico & Plantas x3
                    </div>
                    <div className="lottery-prize-tag lottery-prize-tag--gold">
                      🪙 Hasta 5,000 Oro
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

            <div className="lottery-code-layout-grid">
              {/* LEFT: PLANT PICKER (COMPACT WITHOUT SCROLL) */}
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

              {/* RIGHT: SEQUENCE SLOTS & GUESS HISTORY */}
              <div className="lottery-code-game-pane">
                {/* PROMO HERO BANNER */}
                <div className="lottery-code-promo-banner">
                  <div className="lottery-promo-badge">🔥 CONVIERTE 1 GEMA EN 20 GEMAS 💎</div>
                  <h3>¡ADIVINA LA SECUENCIA DE 4 PLANTAS!</h3>
                  <p>
                    2 intentos gratis diarios. Si descifras las 4 plantas en orden exacto, <strong>¡GANAS 20 GEMAS 💎!</strong>
                  </p>
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
                      {totalAttemptsAvailable} ({freeAttemptsLeft} gratis + {extraAttempts} extra)
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

                {/* ATTEMPTS HISTORY TABLE & FEEDBACK PINS */}
                <div className="lottery-code-history-box">
                  <div className="lottery-history-header">
                    <h5>📜 HISTORIAL DE INTENTOS Y PISTAS:</h5>
                    <div className="lottery-pins-legend">
                      <span className="pin-tag pin-tag--exact">🟢 Posición Exacta</span>
                      <span className="pin-tag pin-tag--wrong">🟡 Posición Errónea</span>
                      <span className="pin-tag pin-tag--miss">🔴 No Está</span>
                    </div>
                  </div>

                  <div className="lottery-history-list">
                    {attemptsHistory.length === 0 ? (
                      <div className="lottery-history-empty">
                        <span>Aún no has realizado intentos. ¡Elige 4 plantas y pon a prueba tu deducción!</span>
                      </div>
                    ) : (
                      attemptsHistory.map((att, idx) => (
                        <div key={att.id} className="lottery-history-row">
                          <span className="lottery-history-num">#{attemptsHistory.length - idx}</span>
                          <div className="lottery-history-cards">
                            {att.sequence.map((pId, pIdx) => {
                              const pConf = PLANT_CONFIGS[pId]
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
                            {Array.from({ length: att.incorrectCount }).map((_, i) => (
                              <span key={`inc_${i}`} className="lottery-pin lottery-pin--miss" title="Planta no está en la clave">
                                🔴
                              </span>
                            ))}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ===================== PRIZE POPUP MODAL (WHEEL) ===================== */}
        {showPrizeModal && winningSector && (
          <div className="lottery-prize-overlay" onClick={() => setShowPrizeModal(false)}>
            <div className="lottery-prize-box" onClick={(e) => e.stopPropagation()}>
              <div className="lottery-prize-confetti">🎉 🎊 ✨</div>
              <div className="lottery-prize-badge">¡FELICITACIONES!</div>
              <div className="lottery-prize-icon">{winningSector.icon}</div>
              <h3 className="lottery-prize-name">{winningSector.label}</h3>
              <p className="lottery-prize-desc">
                {winningSector.type === 'token'
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
                RECLAMAR RECOMPENSA
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
                +20 GEMAS 💎
              </h3>
              <p className="lottery-prize-desc">
                ¡Increíble deducción! Has acertado las 4 plantas en la posición exacta y ganado el <strong>Gran Premio de 20 Gemas 💎</strong>.
              </p>
              <button
                type="button"
                className="lottery-prize-claim-btn"
                onClick={() => {
                  soundManager.playSound('click', 0.4)
                  setCodeWonPrize(false)
                }}
              >
                ¡RECLAMAR 20 GEMAS 💎!
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
                ¿Deseas pagar <strong>1 Gema 💎</strong> para adquirir <strong>2 INTENTOS ADICIONALES</strong> y descifrar la secuencia para ganar las <strong>20 Gemas 💎</strong>?
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
