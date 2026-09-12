import { useState, useEffect, useMemo } from 'react'
import type { PlantId } from '../../types/game'
import type { CodeRoundPrizeTier } from '../../types/database.types'
import { PLANT_CONFIGS } from '../../utils/gameConstants'
import { soundManager } from '../../utils/audioManager'
import { lotteryService } from '../../services/lotteryService'
import './LotteryModal.css'

interface LotteryModalProps {
  isOpen: boolean
  onClose: () => void
  userTokens: number
  userGold?: number
  isAdmin?: boolean
  onOpenAdmin?: () => void
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
  type: 'token' | 'gold' | 'pack' | 'plant' | 'item' | 'none'
  valueUsd?: number
  goldAmount?: number
  packId?: string
  packQty?: number
  plantId?: string
  plantQty?: number
  itemId?: string
  itemQty?: number
  rarity: 'common' | 'rare' | 'epic' | 'legendary' | 'jackpot'
}

export const PAID_SPIN_COST_GEMS = 10

const DEFAULT_WHEEL_SECTORS: WheelSector[] = [
  {
    id: 'jackpot_500',
    label: '500 Gemas 💎',
    icon: '💎',
    color: '#7c3aed',
    textColor: '#ffffff',
    type: 'token',
    valueUsd: 500.0,
    rarity: 'jackpot',
  },
  {
    id: 'item_water',
    label: '2x Agua 💧',
    icon: '💧',
    color: '#0284c7',
    textColor: '#ffffff',
    type: 'item',
    itemId: 'water',
    itemQty: 2,
    rarity: 'common',
  },
  {
    id: 'pack_basic',
    label: 'Sobre Básico',
    icon: '👑',
    color: '#eab308',
    textColor: '#ffffff',
    type: 'pack',
    packId: 'basic',
    packQty: 1,
    rarity: 'jackpot',
  },
  {
    id: 'item_fertilizer',
    label: 'Fertilizante',
    icon: '🌿',
    color: '#16a34a',
    textColor: '#ffffff',
    type: 'item',
    itemId: 'fertilizer',
    itemQty: 1,
    rarity: 'common',
  },
  {
    id: 'jackpot_10',
    label: '10 Gemas 💎',
    icon: '💎',
    color: '#06b6d4',
    textColor: '#ffffff',
    type: 'token',
    valueUsd: 10.0,
    rarity: 'epic',
  },
  {
    id: 'item_shovel',
    label: 'Frag. Pala',
    icon: '🪏',
    color: '#d97706',
    textColor: '#ffffff',
    type: 'item',
    itemId: 'shovel_fragment',
    itemQty: 1,
    rarity: 'rare',
  },
  {
    id: 'plant_wallnut',
    label: 'Wall-nut 🥜',
    icon: '🥜',
    color: '#854d0e',
    textColor: '#ffffff',
    type: 'plant',
    plantId: 'wallnut',
    plantQty: 1,
    rarity: 'rare',
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
  prizesConfig?: CodeRoundPrizeTier[]
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
  slotResults?: ('exact' | 'wrong' | 'miss')[]
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
  isAdmin,
  onOpenAdmin,
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
  const [sectors, setSectors] = useState<WheelSector[]>(DEFAULT_WHEEL_SECTORS)
  const [showPrizeModal, setShowPrizeModal] = useState(false)
  const [showConfirmPaidModal, setShowConfirmPaidModal] = useState(false)
  const [showConfirmCodeBuyModal, setShowConfirmCodeBuyModal] = useState(false)

  // Saldo visual reactivo e instantáneo para reflejar descuentos en tiempo real
  const [currentGems, setCurrentGems] = useState(userTokens)
  useEffect(() => {
    setCurrentGems(userTokens)
  }, [userTokens])

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
      lotteryService.secretCodeState(),
      lotteryService.secretCodeLeaderboard(),
    ])
    if (st) {
      const newRound = (st.round as CodeRound) ?? null
      setCodeRound((prevRound) => {
        if (newRound?.id !== prevRound?.id) {
          setSelectedSequence(Array(SECRET_CODE_LENGTH).fill(null))
          setCodeWonPrize(false)
        } else if (newRound?.status === 'open' && prevRound?.status !== 'open') {
          setSelectedSequence(Array(SECRET_CODE_LENGTH).fill(null))
          setCodeWonPrize(false)
        }
        return newRound
      })
      setCodeAttemptsLeft(st.attemptsLeft ?? 0)
      setCodeFreeUsed(st.freeUsed ?? 0)
      setCodeExtra(st.extraAttempts ?? 0)
      setCodeHistory((st.attempts as ServerAttempt[]) ?? [])
      setCodeMyPayout(st.myPayout ?? null)
    }
    setCodeBoard(board as BoardEntry[])
  }

  // Recompensas dinámicas calculadas según la configuración del creador/admin en Supabase
  const configuredTiers: CodeRoundPrizeTier[] = useMemo(() => {
    let raw = codeRound?.prizesConfig || (codeRound as any)?.prizes_config
    if (typeof raw === 'string') {
      try {
        raw = JSON.parse(raw)
      } catch (_) {}
    }
    if (raw && Array.isArray(raw) && raw.length > 0) {
      return raw.map((t: any, i: number) => ({
        place: Number(t.place) || (i + 1),
        amount: Number(t.amount) || 0,
        currency: t.currency === 'gold' ? 'gold' : 'gems',
      }))
    }
    // Si la ronda no tiene prizesConfig guardado, usamos ÚNICAMENTE los premios reales configurados
    const pool = codeRound?.prizes?.[0] ?? codeRound?.prizePool ?? 50
    const list: CodeRoundPrizeTier[] = [{ place: 1, amount: pool, currency: 'gems' }]
    if (codeRound?.prizes?.[1] && codeRound.prizes[1] > 0) {
      list.push({ place: 2, amount: codeRound.prizes[1], currency: 'gold' })
    }
    if (codeRound?.prizes?.[2] && codeRound.prizes[2] > 0) {
      list.push({ place: 3, amount: codeRound.prizes[2], currency: 'gold' })
    }
    return list
  }, [codeRound])

  const top1Tier = configuredTiers.find((t) => t.place === 1) || configuredTiers[0]
  const top1Amount = top1Tier?.amount ?? (codeRound?.prizePool ?? 50)
  const top1Currency = top1Tier?.currency ?? 'gems'
  const top1CurrencyLabel = top1Currency === 'gems' ? 'Gemas 💎' : 'Oro 💰'
  const top1PrizeBadge = `${top1Amount} ${top1Currency === 'gems' ? '💎' : '💰'}`

  // Calcula el premio correspondiente y su reparto equitativo entre jugadores empatados en el mismo puesto
  const boardWithDividedPrizes = useMemo(() => {
    if (!codeBoard || codeBoard.length === 0) return []

    // Contar cuántos jugadores hay empatados en cada puesto
    const placeCounts = new Map<number, number>()
    for (const e of codeBoard) {
      const p = e.place || 1
      placeCounts.set(p, (placeCounts.get(p) || 0) + 1)
    }

    return codeBoard.map((e) => {
      const place = e.place || 1
      const tiedCount = placeCounts.get(place) || 1

      const configuredPrize = configuredTiers.find((p) => p.place === place)
      let totalPrize = 0
      let currency: 'gems' | 'gold' = 'gold'

      if (configuredPrize) {
        totalPrize = configuredPrize.amount
        currency = configuredPrize.currency
      } else {
        totalPrize = 0
        currency = 'gold'
      }

      // Su parte individual dividida equitativamente entre los empatados
      const myShare = tiedCount > 0 && totalPrize > 0
        ? Number((totalPrize / tiedCount).toFixed(2))
        : totalPrize

      return {
        ...e,
        tiedCount,
        totalPrize,
        myShare,
        currency,
      }
    })
  }, [codeBoard, configuredTiers])

  // Carga y sincroniza los sectores reales de la ruleta desde Supabase
  const loadWheelSectors = async () => {
    try {
      const dbSectors = await lotteryService.getLotterySectors()
      if (!dbSectors || dbSectors.length === 0) return

      const standardOrder = [
        'jackpot_500',
        'item_water',
        'pack_basic',
        'item_fertilizer',
        'jackpot_10',
        'item_shovel',
        'plant_wallnut',
        'none_1',
      ]

      const mapped: WheelSector[] = dbSectors.map((row) => {
        const tpl = DEFAULT_WHEEL_SECTORS.find((s) => s.id === row.sector_id)
        if (tpl) {
          return {
            ...tpl,
            label: row.label || tpl.label,
            valueUsd: row.reward_type === 'gems' ? (Number(row.gems_amount) || tpl.valueUsd) : undefined,
            goldAmount: row.reward_type === 'gold' ? (Number(row.gold_amount) || tpl.goldAmount) : undefined,
            packId: row.pack_id || tpl.packId,
            packQty: row.pack_qty ?? tpl.packQty,
            plantId: row.plant_id || tpl.plantId,
            plantQty: row.plant_qty ?? tpl.plantQty,
            itemId: (row as any).item_id || tpl.itemId,
            itemQty: (row as any).item_qty ?? tpl.itemQty,
          }
        }
        return {
          id: row.sector_id,
          label: row.label || row.sector_id,
          icon: row.reward_type === 'gems' ? '💎' : row.reward_type === 'gold' ? '💰' : row.reward_type === 'pack' ? '👑' : row.reward_type === 'plant' ? '🥜' : row.reward_type === 'item' ? ((row as any).item_id === 'water' ? '💧' : (row as any).item_id === 'fertilizer' ? '🌿' : '🪏') : '💨',
          color: row.reward_type === 'gems' && Number(row.gems_amount) >= 500 ? '#7c3aed' : row.reward_type === 'gems' ? '#06b6d4' : row.reward_type === 'gold' ? '#f59e0b' : row.reward_type === 'pack' ? '#eab308' : row.reward_type === 'plant' ? '#854d0e' : row.reward_type === 'item' ? ((row as any).item_id === 'water' ? '#0284c7' : (row as any).item_id === 'fertilizer' ? '#16a34a' : '#d97706') : '#475569',
          textColor: '#ffffff',
          type: row.reward_type === 'gems' ? 'token' : row.reward_type === 'gold' ? 'gold' : row.reward_type === 'pack' ? 'pack' : row.reward_type === 'plant' ? 'plant' : row.reward_type === 'item' ? 'item' : 'none',
          valueUsd: row.gems_amount ? Number(row.gems_amount) : undefined,
          goldAmount: row.gold_amount ? Number(row.gold_amount) : undefined,
          packId: row.pack_id ?? undefined,
          packQty: row.pack_qty ?? undefined,
          plantId: row.plant_id ?? undefined,
          plantQty: row.plant_qty ?? undefined,
          itemId: (row as any).item_id ?? undefined,
          itemQty: (row as any).item_qty ?? undefined,
          rarity: row.reward_type === 'gems' && Number(row.gems_amount) >= 500 ? 'jackpot' : row.reward_type === 'pack' ? 'jackpot' : row.reward_type === 'gems' ? 'epic' : row.reward_type === 'plant' || row.reward_type === 'gold' || row.reward_type === 'item' ? 'rare' : 'common',
        }
      })

      mapped.sort((a, b) => {
        const idxA = standardOrder.indexOf(a.id)
        const idxB = standardOrder.indexOf(b.id)
        if (idxA !== -1 && idxB !== -1) return idxA - idxB
        if (idxA !== -1) return -1
        if (idxB !== -1) return 1
        return a.id.localeCompare(b.id)
      })

      setSectors(mapped)
    } catch (e) {
      console.warn('[LotteryModal] error al sincronizar sectores de ruleta:', e)
    }
  }

  // Se recarga al abrir el modal y al entrar en la pestaña del código, para que
  // la clasificación refleje los intentos de los demás y la ruleta los premios actuales.
  useEffect(() => {
    if (!isOpen) return
    LEGACY_CODE_KEYS.forEach((k) => localStorage.removeItem(k))
    setCodeWonPrize(false)
    void loadCodeData()
    void loadWheelSectors()
  }, [isOpen, activeTab])

  // Sondeo de sincronización automática en la pestaña del código secreto cada 4s
  useEffect(() => {
    if (!isOpen || activeTab !== 'code') return
    const interval = setInterval(() => {
      void loadCodeData()
    }, 4000)
    return () => clearInterval(interval)
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
      alert(`Ya has usado tu tiro gratis diario. Puedes girar nuevamente por ${PAID_SPIN_COST_GEMS} Gemas 💎.`)
      return
    }
    if (!isFree && currentGems < PAID_SPIN_COST_GEMS) {
      alert(`Gemas insuficientes (${PAID_SPIN_COST_GEMS} Gemas 💎 requeridas para un tiro adicional).`)
      return
    }

    setIsSpinning(true)
    soundManager.playSound('click', 0.6)

    const res = await lotteryService.spinLottery(!isFree)

    if (!res.success || !res.sectorId) {
      setIsSpinning(false)
      alert(res.error || 'No se pudo girar la ruleta.')
      return
    }

    // Reflejo visual inmediato del descuento de gemas
    if (!isFree) {
      setCurrentGems((prev) => Math.max(0, prev - PAID_SPIN_COST_GEMS))
      void onRewardsChanged?.()
    }

    if (isFree) {
      // Sólo para el contador visual de las 24 h. La cuenta real la lleva
      // user_lottery.last_free_spin en el servidor.
      setLastFreeSpinTime(Date.now())
      localStorage.setItem(STORAGE_KEYS.LAST_FREE_SPIN, String(Date.now()))
    }

    const targetIndex = sectors.findIndex((s) => s.id === res.sectorId)
    if (targetIndex === -1) {
      // El servidor devolvió un sector que la rueda no dibuja: no se puede
      // animar, pero el premio ya está entregado, así que se refresca y se avisa.
      console.error('[Lottery] sector desconocido en la rueda:', res.sectorId)
      setIsSpinning(false)
      await onRewardsChanged?.()
      alert(`¡Premio recibido: ${res.label ?? res.sectorId}!`)
      return
    }

    const sectorToWin = sectors[targetIndex]
    const sectorAngle = 360 / sectors.length
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

      // Si el premio fue en gemas, acreditar inmediatamente en saldo visual
      if (sectorToWin.type === 'token' && sectorToWin.valueUsd) {
        setCurrentGems((prev) => prev + (sectorToWin.valueUsd ?? 0))
      }

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
    if (!roundIsOpen) {
      soundManager.playSound('defeat', 0.2)
      setCodeBannerNotice('⏸️ La ronda anterior finalizó. Espera un momento mientras inicia la siguiente ronda.')
      setTimeout(() => setCodeBannerNotice(null), 3500)
      return
    }
    if (codeWonPrize) {
      setCodeWonPrize(false)
    }
    if (selectedSequence.includes(plantId)) {
      setCodeBannerNotice('⚠️ Esta planta ya está incluida en la secuencia actual.')
      setTimeout(() => setCodeBannerNotice(null), 2000)
      return
    }
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
    if (!roundIsOpen) return
    if (codeWonPrize) setCodeWonPrize(false)
    soundManager.playSound('click', 0.3)
    const next = [...selectedSequence]
    next[index] = null
    setSelectedSequence(next)
  }

  const handleClearAllSlots = () => {
    if (!roundIsOpen) return
    if (codeWonPrize) setCodeWonPrize(false)
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
    const res = await lotteryService.buySecretCodeAttempts()
    setCodeBusy(false)

    if (!res.success) {
      setCodeBannerNotice(`⚠️ ${res.error || 'No se pudieron comprar intentos.'}`)
      setTimeout(() => setCodeBannerNotice(null), 4000)
      return
    }

    // Reflejo visual inmediato del descuento de gemas
    setCurrentGems((prev) => Math.max(0, prev - (res.spent ?? 5)))
    void onRewardsChanged?.()

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
    const res = await lotteryService.guessSecretCode(selectedSequence as string[])
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
      const missCount = Math.max(0, SECRET_CODE_LENGTH - (res.exactCount || 0) - (res.wrongPosCount || 0))
      setCodeBannerNotice(
        `🔍 Pistas Mastermind: 🟢 ${res.exactCount || 0} exactas · 🟡 ${res.wrongPosCount || 0} en otra posición · 🔴 ${missCount} descartadas`
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
              <strong>{currentGems} Gemas</strong>
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
            {`🔐 CÓDIGO SECRETO (¡BOTE ${top1PrizeBadge}!)`}
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
                    {sectors.map((sec, idx) => {
                      const angle = (360 / sectors.length) * idx
                      const halfAngle = (180 / sectors.length) * (Math.PI / 180)
                      const dx = 50 * Math.tan(halfAngle)
                      const x1 = Math.max(0, 50 - dx)
                      const x2 = Math.min(100, 50 + dx)
                      const clipPath = sectors.length === 8 ? undefined : `polygon(50% 50%, ${x1.toFixed(2)}% 0%, ${x2.toFixed(2)}% 0%)`
                      return (
                        <div
                          key={sec.id}
                          className={`lottery-wheel-slice lottery-slice--${sec.rarity}`}
                          style={{
                            transform: `rotate(${angle}deg)`,
                            background: sec.color,
                            ...(clipPath ? { clipPath } : {}),
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
                    title={canFreeSpin ? 'Girar tiro gratis' : `Tiro gratis usado. Haz clic en "⚡ GIRAR POR ${PAID_SPIN_COST_GEMS} GEMAS 💎"`}
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
                    Tienes <strong>1 Tiro Gratis cada 24 horas</strong> garantizado. También puedes adquirir giros extra por tan solo <strong>{PAID_SPIN_COST_GEMS} Gemas 💎</strong>.
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
                    disabled={isSpinning || currentGems < PAID_SPIN_COST_GEMS}
                    onClick={() => {
                      soundManager.playSound('click', 0.4)
                      setShowConfirmPaidModal(true)
                    }}
                  >
                    <span>⚡ GIRAR POR {PAID_SPIN_COST_GEMS} GEMAS 💎</span>
                  </button>
                </div>

                {/* PRIZES HIGHLIGHT LIST */}
                <div className="lottery-prizes-preview-box">
                  <span className="lottery-prizes-title">🎁 PREMIOS EN ESTE SORTEO:</span>
                  <div className="lottery-prizes-tags-grid">
                    <div className="lottery-prize-tag lottery-prize-tag--jackpot">
                      💎 500 Gemas (MEGA JACKPOT)
                    </div>
                    <div className="lottery-prize-tag lottery-prize-tag--jackpot">
                      👑 Sobre Básico
                    </div>
                    <div className="lottery-prize-tag lottery-prize-tag--legendary">
                      💎 10 Gemas (Giro Extra)
                    </div>
                    <div className="lottery-prize-tag lottery-prize-tag--gold">
                      🥜 Carta Wall-nut
                    </div>
                    <div className="lottery-prize-tag lottery-prize-tag--gold">
                      🪏 Fragmento de Pala
                    </div>
                    <div className="lottery-prize-tag lottery-prize-tag--gold">
                      🌿 Fertilizante de Cultivo
                    </div>
                    <div className="lottery-prize-tag lottery-prize-tag--gold">
                      💧 2x Agua para Parcelas
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

            {/* SUB-TABS: JUEGA | HISTORIAL | RANKING | ADMIN */}
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
              {isAdmin && (
                <button
                  type="button"
                  className="lottery-code-subtab-btn"
                  style={{
                    marginLeft: 'auto',
                    background: 'rgba(234, 179, 8, 0.15)',
                    color: '#facc15',
                    border: '1px solid #eab308',
                    fontWeight: 800,
                  }}
                  onClick={() => {
                    soundManager.playSound('click', 0.3)
                    onClose()
                    onOpenAdmin?.()
                  }}
                  title="Configurar Bote, Coste e Iniciar Nuevo Acertijo desde Panel de Administrador"
                >
                  🛡️ ADMINISTRAR
                </button>
              )}
            </div>

            {/* SUBTAB 1: JUEGA */}
            {codeSubTab === 'play' && (
              !roundIsOpen ? (
                /* BANNER Y PANTALLA DE CÓDIGO DESCIFRADO / RONDA FINALIZADA */
                <div className="lottery-code-solved-container">
                  <div className="lottery-code-solved-banner">
                    <div className="lottery-code-solved-badge">🏆 ¡CÓDIGO DESCIFRADO!</div>
                    <h3>Espera la siguiente ronda...</h3>
                    <p>
                      {codeRound?.winnerId
                        ? `¡Un jugador descifró la secuencia secreta de la Ronda #${codeRound.roundNumber} y se ha repartido el bote!`
                        : `La Ronda #${codeRound?.roundNumber ?? ''} ha concluido y las recompensas han sido acreditadas.`}
                    </p>

                    <div className="lottery-code-solved-details">
                      <div className="lottery-code-detail-item">
                        <span className="lottery-code-detail-label">Ronda</span>
                        <span className="lottery-code-detail-value">#{codeRound?.roundNumber ?? '—'}</span>
                      </div>
                      <div className="lottery-code-detail-item">
                        <span className="lottery-code-detail-label">Bote 1er Puesto</span>
                        <span className="lottery-code-detail-value lottery-code-detail-value--gold">
                          {top1Amount} {top1CurrencyLabel}
                        </span>
                      </div>
                      <div className="lottery-code-detail-item">
                        <span className="lottery-code-detail-label">Estado</span>
                        <span className="lottery-code-detail-value lottery-code-detail-value--green">
                          ✅ Repartido
                        </span>
                      </div>
                    </div>

                    {/* Resumen dinámico de premios configurados */}
                    {configuredTiers.length > 0 && (
                      <div style={{ margin: '12px 0', padding: '8px 12px', background: 'rgba(0,0,0,0.35)', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.08)' }}>
                        <div style={{ fontSize: '11px', fontWeight: 700, color: '#facc15', marginBottom: '6px' }}>
                          🏆 Premios acreditados de la ronda:
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', justifyContent: 'center' }}>
                          {configuredTiers.map((t) => (
                            <span
                              key={t.place}
                              style={{
                                fontSize: '11px',
                                padding: '2px 8px',
                                borderRadius: '4px',
                                background: t.place === 1 ? 'rgba(250, 204, 21, 0.2)' : 'rgba(255,255,255,0.05)',
                                border: t.place === 1 ? '1px solid #eab308' : '1px solid rgba(255,255,255,0.1)',
                              }}
                            >
                              #{t.place}: <strong style={{ color: t.currency === 'gems' ? '#38bdf8' : '#f59e0b' }}>{t.amount} {t.currency === 'gems' ? '💎' : '💰'}</strong>
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="lottery-code-solved-notice">
                      📢 El Administrador abrirá una nueva ronda de 5 plantas próximamente. Puedes consultar el ranking final o tu historial mientras tanto.
                    </div>

                    <div className="lottery-code-solved-actions">
                      <button
                        type="button"
                        className="lottery-code-check-btn"
                        onClick={() => setCodeSubTab('ranking')}
                      >
                        🏆 Ver Clasificación y Ganadores
                      </button>
                      <button
                        type="button"
                        className="lottery-code-clear-btn"
                        onClick={() => setCodeSubTab('history')}
                      >
                        📜 Ver Mi Historial
                      </button>
                      {isAdmin && (
                        <button
                          type="button"
                          className="lottery-code-subtab-btn"
                          style={{
                            background: 'rgba(234, 179, 8, 0.2)',
                            color: '#facc15',
                            border: '1.5px solid #eab308',
                            fontWeight: 800,
                            padding: '6px 14px',
                            borderRadius: '6px',
                            cursor: 'pointer',
                          }}
                          onClick={() => {
                            soundManager.playSound('click', 0.3)
                            onClose()
                            onOpenAdmin?.()
                          }}
                        >
                          🛡️ Iniciar Nueva Ronda (Panel Admin)
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
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
                        const isAlreadySelected = selectedSequence.includes(plantId)
                        return (
                          <button
                            key={plantId}
                            type="button"
                            className={`lottery-mini-plant-card ${isAlreadySelected ? 'lottery-mini-plant-card--in-use' : ''}`}
                            disabled={isAlreadySelected}
                            onClick={() => handleSelectPlantForSlot(plantId)}
                            title={
                              isAlreadySelected
                                ? `${conf.name} (Ya añadida a la combinación)`
                                : conf.name
                            }
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
                        {`🔐 RONDA #${codeRound?.roundNumber ?? ''} · BOTE ${top1PrizeBadge}`}
                      </div>
                      <h3>¡ADIVINA LA SECUENCIA DE {SECRET_CODE_LENGTH} PLANTAS!</h3>
                      <p>
                        {codeRound?.freeAttempts ?? 3} intentos gratis por ronda (Reintentos: <strong>5 💎</strong>). Pistas globales <strong>Mastermind (Ciego)</strong>:{' '}
                        <span style={{ color: '#4ade80' }}>🟢 Exactas</span> = posición correcta,{' '}
                        <span style={{ color: '#facc15' }}>🟡 Desubicadas</span> = en otra casilla,{' '}
                        <span style={{ color: '#f87171' }}>🔴 Descartadas</span> = no están en el código.{' '}
                        <em>¡Las pistas no revelan la casilla exacta, deberás deducirlo!</em>{' '}
                        ¡El primero en descifrar las {SECRET_CODE_LENGTH} se lleva{' '}
                        <strong>
                          {top1Amount} {top1CurrencyLabel}
                        </strong>!
                      </p>

                      {/* Tiras dinámicas de premios con estilo gaming */}
                      {configuredTiers.length > 0 && (
                        <div style={{
                          marginTop: '10px',
                          display: 'flex',
                          flexWrap: 'wrap',
                          gap: '6px',
                          alignItems: 'center',
                          padding: '8px 12px',
                          background: 'rgba(15, 23, 42, 0.75)',
                          borderRadius: '8px',
                          border: '1px solid rgba(56, 189, 248, 0.25)',
                          boxShadow: 'inset 0 0 12px rgba(56, 189, 248, 0.05)',
                        }}>
                          <span style={{ fontSize: '11px', fontWeight: 900, color: '#facc15', letterSpacing: '0.5px' }}>
                            🎮 BOTÍN EN JUEGO:
                          </span>
                          {configuredTiers.map((t) => (
                            <span
                              key={t.place}
                              style={{
                                fontSize: '11px',
                                padding: '3px 8px',
                                borderRadius: '5px',
                                background: t.place === 1
                                  ? 'linear-gradient(135deg, rgba(234, 179, 8, 0.3) 0%, rgba(245, 158, 11, 0.15) 100%)'
                                  : t.place === 2
                                  ? 'rgba(148, 163, 184, 0.15)'
                                  : t.place === 3
                                  ? 'rgba(217, 119, 6, 0.15)'
                                  : 'rgba(0, 0, 0, 0.45)',
                                border: t.place === 1
                                  ? '1px solid #eab308'
                                  : t.place === 2
                                  ? '1px solid #94a3b8'
                                  : t.place === 3
                                  ? '1px solid #d97706'
                                  : '1px solid rgba(255, 255, 255, 0.12)',
                                fontWeight: 800,
                                fontVariantNumeric: 'tabular-nums',
                                boxShadow: t.place === 1 ? '0 0 8px rgba(234, 179, 8, 0.3)' : undefined,
                              }}
                            >
                              <span style={{ color: t.place === 1 ? '#facc15' : t.place === 2 ? '#e2e8f0' : t.place === 3 ? '#fb923c' : '#94a3b8', marginRight: '3px' }}>
                                {t.place === 1 ? '🥇' : t.place === 2 ? '🥈' : t.place === 3 ? '🥉' : `#${t.place}`}
                              </span>
                              <strong style={{ color: t.currency === 'gems' ? '#38bdf8' : '#facc15' }}>
                                {t.amount} {t.currency === 'gems' ? '💎' : '💰'}
                              </strong>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* 5 ACTIVE SLOTS */}
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
                        disabled={currentGems < 5.0}
                        title="Pagar 5 Gemas 💎 por 1 intento adicional"
                      >
                        ⚡ +1 INTENTO (5 💎 Gemas)
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

                    {/* ÚLTIMO INTENTO REALIZADO (PREVIEW MASTERMIND CIEGO) */}
                    {codeHistory.length > 0 && (() => {
                      const lastAtt = codeHistory[0]
                      const missCount = Math.max(0, (lastAtt.sequence?.length || SECRET_CODE_LENGTH) - lastAtt.exactCount - lastAtt.wrongPosCount)
                      return (
                        <div className="lottery-code-last-attempt-card">
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span style={{ fontSize: '9px', fontWeight: 800, color: '#fbbf24' }}>Último Intento:</span>
                            <div className="lottery-history-cards">
                              {lastAtt.sequence.map((pId, pIdx) => {
                                const pConf = PLANT_CONFIGS[pId as PlantId]
                                const pIcon = pConf ? pConf.packetActive || pConf.icon : ''
                                return (
                                  <div key={pIdx} className="lottery-hist-mini-card" title={pConf?.name || `Planta #${pIdx + 1}`}>
                                    <img src={pIcon} alt={pConf?.name} />
                                  </div>
                                )
                              })}
                            </div>
                            <div className="lottery-history-badges">
                              <span className="lottery-count-badge lottery-count-badge--exact" title={`${lastAtt.exactCount} plantas en posición exacta`}>
                                🟢 {lastAtt.exactCount} {lastAtt.exactCount === 1 ? 'Exacta' : 'Exactas'}
                              </span>
                              <span className="lottery-count-badge lottery-count-badge--wrong" title={`${lastAtt.wrongPosCount} plantas en otra casilla`}>
                                🟡 {lastAtt.wrongPosCount} {lastAtt.wrongPosCount === 1 ? 'Desubicada' : 'Desubicadas'}
                              </span>
                              <span className="lottery-count-badge lottery-count-badge--miss" title={`${missCount} plantas descartadas`}>
                                🔴 {missCount} {missCount === 1 ? 'Descartada' : 'Descartadas'}
                              </span>
                            </div>
                            <strong className="lottery-history-pct" style={{ fontSize: '11px', marginLeft: 'auto' }}>
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
              )
            )}

            {/* SUBTAB 2: HISTORIAL */}
            {codeSubTab === 'history' && (
              <div className="lottery-code-full-pane">
                <div className="lottery-code-history-box" style={{ flex: 1 }}>
                  <div className="lottery-history-header">
                    <h5>📜 HISTORIAL Y PISTAS GLOBALES (MASTERMIND CIEGO):</h5>
                    <div className="lottery-pins-legend">
                      <span className="pin-tag pin-tag--exact">🟢 Posición Exacta</span>
                      <span className="pin-tag pin-tag--wrong">🟡 En otra Casilla</span>
                      <span className="pin-tag pin-tag--miss">🔴 Descartada</span>
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
                      codeHistory.map((att, idx) => {
                        const missCount = Math.max(0, (att.sequence?.length || SECRET_CODE_LENGTH) - att.exactCount - att.wrongPosCount)
                        return (
                          <div key={att.id} className="lottery-history-row">
                            <span className="lottery-history-num">#{codeHistory.length - idx}</span>
                            <div className="lottery-history-cards">
                              {att.sequence.map((pId, pIdx) => {
                                const pConf = PLANT_CONFIGS[pId as PlantId]
                                const pIcon = pConf ? pConf.packetActive || pConf.icon : ''
                                return (
                                  <div key={pIdx} className="lottery-hist-mini-card" title={pConf?.name || `Planta #${pIdx + 1}`}>
                                    <img src={pIcon} alt={pConf?.name} />
                                  </div>
                                )
                              })}
                            </div>

                            <div className="lottery-history-badges">
                              <span className="lottery-count-badge lottery-count-badge--exact" title={`${att.exactCount} plantas en posición exacta`}>
                                🟢 {att.exactCount} {att.exactCount === 1 ? 'Exacta' : 'Exactas'}
                              </span>
                              <span className="lottery-count-badge lottery-count-badge--wrong" title={`${att.wrongPosCount} plantas en el código pero en otra casilla`}>
                                🟡 {att.wrongPosCount} {att.wrongPosCount === 1 ? 'Desubicada' : 'Desubicadas'}
                              </span>
                              <span className="lottery-count-badge lottery-count-badge--miss" title={`${missCount} plantas descartadas`}>
                                🔴 {missCount} {missCount === 1 ? 'Descartada' : 'Descartadas'}
                              </span>
                            </div>

                            <strong
                              className="lottery-history-pct"
                              style={{ marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' }}
                              title="Acercamiento acumulado"
                            >
                              {Number(att.pct).toFixed(1)}%
                            </strong>
                          </div>
                        )
                      })
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
                    <div className="lottery-pins-legend" style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
                      {configuredTiers.slice(0, 3).map((p) => (
                        <span
                          key={p.place}
                          className="pin-tag pin-tag--exact"
                          style={{
                            border: p.place === 1 ? '1px solid #facc15' : undefined,
                            background: p.place === 1 ? 'rgba(250, 204, 21, 0.2)' : undefined,
                          }}
                        >
                          {p.place === 1 ? '🥇' : p.place === 2 ? '🥈' : '🥉'} {p.amount} {p.currency === 'gold' ? '💰' : '💎'}
                        </span>
                      ))}
                      {configuredTiers.length > 3 && (
                        <span className="pin-tag pin-tag--wrong">
                          Top 4-{configuredTiers.length}: Recompensas
                        </span>
                      )}
                      <span style={{ fontSize: '9.5px', color: '#94a3b8', fontWeight: 600 }}>
                        (🤝 Los empates dividen el premio)
                      </span>
                    </div>
                  </div>

                  <div className="lottery-history-list" style={{ minHeight: '260px', maxHeight: '380px' }}>
                    {boardWithDividedPrizes.length === 0 ? (
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
                      boardWithDividedPrizes.map((e) => {
                        const isTied = e.tiedCount > 1
                        return (
                          <div
                            key={e.userId}
                            className="lottery-history-row"
                            style={{
                              ...(e.isMe ? { outline: '1px solid #6366f1', background: 'rgba(99, 102, 241, 0.2)' } : {}),
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              padding: '5px 8px',
                            }}
                          >
                            {/* Puesto: si hay empate, cada jugador ocupa su propia fila (uno debajo del otro) con el mismo puesto */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: '3px', minWidth: isTied ? 36 : 20 }}>
                              <span className="lottery-history-num" style={{ width: 'auto' }}>
                                {e.place === 1 ? '🥇' : e.place === 2 ? '🥈' : e.place === 3 ? '🥉' : `#${e.place}`}
                              </span>
                              {isTied && (
                                <span
                                  style={{
                                    fontSize: '8px',
                                    fontWeight: 800,
                                    color: '#facc15',
                                    background: 'rgba(250, 204, 21, 0.15)',
                                    border: '1px solid rgba(250, 204, 21, 0.3)',
                                    padding: '1px 3px',
                                    borderRadius: '3px',
                                    lineHeight: 1,
                                  }}
                                  title={`Empate en puesto #${e.place} (${e.tiedCount} jugadores)`}
                                >
                                  empate
                                </span>
                              )}
                            </div>

                            {/* Nombre del jugador */}
                            <span style={{ flex: 1, fontWeight: e.isMe ? 800 : 500, color: e.isMe ? '#a5b4fc' : '#ffffff', marginLeft: 6 }}>
                              {e.username}{e.isMe ? ' (tú)' : ''}
                            </span>

                            {/* Intentos realizados */}
                            <span
                              style={{ fontVariantNumeric: 'tabular-nums', opacity: 0.75, marginRight: 10 }}
                              title="Intentos realizados"
                            >
                              {e.attempts} int.
                            </span>

                            {/* Porcentaje de acierto */}
                            <strong style={{ fontVariantNumeric: 'tabular-nums', minWidth: 48, textAlign: 'right' }}>
                              {Number(e.bestPct).toFixed(1)}%
                            </strong>

                            {/* Premio: su parte individual asignada */}
                            {e.myShare > 0 && (
                              <span
                                style={{
                                  marginLeft: 10,
                                  fontVariantNumeric: 'tabular-nums',
                                  color: e.currency === 'gems' ? '#38bdf8' : '#f59e0b',
                                  fontWeight: 800,
                                  minWidth: 54,
                                  textAlign: 'right',
                                }}
                                title={
                                  isTied
                                    ? `Su parte: +${e.myShare} ${e.currency === 'gems' ? 'Gemas' : 'Oro'} (premio base de ${e.totalPrize} dividido entre ${e.tiedCount} jugadores)`
                                    : `Premio Top #${e.place} (+${e.myShare} ${e.currency === 'gems' ? 'Gemas' : 'Oro'})`
                                }
                              >
                                +{e.myShare} {e.currency === 'gold' ? '💰' : '💎'}
                              </span>
                            )}
                          </div>
                        )
                      })
                    )}
                  </div>

                  {codeMyPayout && (
                    <div className="lottery-code-alert-banner" style={{ marginTop: 10 }}>
                      🏅 Cobraste {codeMyPayout.gems > 0 ? `${codeMyPayout.gems} 💎 ` : ''}{(codeMyPayout as any).gold > 0 ? `+${(codeMyPayout as any).gold} 💰 Oro ` : ''}por el puesto #{codeMyPayout.place}
                      {codeMyPayout.tiedWith > 1 && ` (empate entre ${codeMyPayout.tiedWith})`}.
                    </div>
                  )}

                  <div
                    style={{
                      marginTop: 12,
                      padding: '12px 14px',
                      background: 'rgba(15, 23, 42, 0.75)',
                      borderRadius: '8px',
                      border: '1px solid rgba(56, 189, 248, 0.25)',
                      boxShadow: 'inset 0 0 14px rgba(56, 189, 248, 0.05)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px', flexWrap: 'wrap', gap: '4px' }}>
                      <span style={{ fontSize: '11.5px', fontWeight: 900, color: '#facc15', letterSpacing: '0.5px' }}>
                        🎮 TABLA OFICIAL DE RECOMPENSAS (RONDA #{codeRound?.roundNumber ?? ''}):
                      </span>
                      <span style={{ fontSize: '10.5px', color: '#38bdf8', fontWeight: 700 }}>
                        {configuredTiers.length} puestos premiados
                      </span>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px' }}>
                      {configuredTiers.map((t) => (
                        <span
                          key={t.place}
                          style={{
                            fontSize: '11px',
                            padding: '3px 8px',
                            borderRadius: '5px',
                            background: t.place === 1
                              ? 'linear-gradient(135deg, rgba(234, 179, 8, 0.3) 0%, rgba(245, 158, 11, 0.15) 100%)'
                              : t.place === 2
                              ? 'rgba(148, 163, 184, 0.15)'
                              : t.place === 3
                              ? 'rgba(217, 119, 6, 0.15)'
                              : 'rgba(0, 0, 0, 0.45)',
                            border: t.place === 1
                              ? '1px solid #eab308'
                              : t.place === 2
                              ? '1px solid #94a3b8'
                              : t.place === 3
                              ? '1px solid #d97706'
                              : '1px solid rgba(255, 255, 255, 0.12)',
                            fontWeight: 800,
                            fontVariantNumeric: 'tabular-nums',
                            boxShadow: t.place === 1 ? '0 0 8px rgba(234, 179, 8, 0.3)' : undefined,
                          }}
                        >
                          <span style={{ color: t.place === 1 ? '#facc15' : t.place === 2 ? '#e2e8f0' : t.place === 3 ? '#fb923c' : '#94a3b8', marginRight: '4px' }}>
                            {t.place === 1 ? '🥇 #1' : t.place === 2 ? '🥈 #2' : t.place === 3 ? '🥉 #3' : `#${t.place}`}
                          </span>
                          <strong style={{ color: t.currency === 'gems' ? '#38bdf8' : '#facc15' }}>
                            {t.amount} {t.currency === 'gems' ? '💎 Gemas' : '💰 Oro'}
                          </strong>
                        </span>
                      ))}
                    </div>
                    <p style={{ fontSize: 11, opacity: 0.85, margin: 0, lineHeight: 1.5 }}>
                      El primer lugar que descifre el 100% se lleva{' '}
                      <strong style={{ color: top1Currency === 'gems' ? '#38bdf8' : '#f59e0b' }}>
                        {top1Amount} {top1CurrencyLabel}
                      </strong>.
                      {configuredTiers.length > 1 ? (
                        <>
                          {' '}Los puestos del 2 al {configuredTiers[configuredTiers.length - 1].place} reciben sus respectivas recompensas configuradas por el administrador al cerrarse la ronda.
                        </>
                      ) : (
                        ' Solo el puesto #1 recibe premio en esta ronda.'
                      )}
                    </p>
                  </div>
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
                  ? `¡No te desanimes! Vuelve mañana para tu tiro gratis diario o gira por ${PAID_SPIN_COST_GEMS} Gemas 💎.`
                  : winningSector.type === 'token'
                  ? `¡Se han acreditado ${winningSector.valueUsd?.toFixed(0)} Gemas 💎 a tu cuenta!`
                  : winningSector.type === 'gold'
                  ? `¡Has ganado ${winningSector.goldAmount?.toLocaleString()} Monedas de Oro!`
                  : winningSector.type === 'pack'
                  ? `¡Se ha añadido ${winningSector.packQty}x ${winningSector.label} a tus sobres pendientes!`
                  : winningSector.type === 'plant'
                  ? `¡Has recibido ${winningSector.plantQty ?? 1}x carta Wall-nut 🥜 para tu mazo o jardín!`
                  : winningSector.type === 'item'
                  ? `¡Se ha añadido ${winningSector.label} a tu inventario de cultivo en el jardín!`
                  : `¡Recompensa acreditada con éxito!`}
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
              <div className="lottery-prize-icon">{top1Currency === 'gems' ? '💎' : '💰'}</div>
              <h3 className="lottery-prize-name" style={{ color: '#4ade80' }}>
                +{top1Amount} {top1Currency === 'gems' ? 'GEMAS 💎' : 'ORO 💰'}
              </h3>
              <p className="lottery-prize-desc">
                ¡Increíble deducción! Has acertado las {SECRET_CODE_LENGTH} plantas en la posición exacta y ganado el <strong>Gran Premio de {top1Amount} {top1CurrencyLabel}</strong>.
              </p>
              <button
                type="button"
                className="lottery-prize-claim-btn"
                onClick={() => {
                  soundManager.playSound('click', 0.4)
                  setCodeWonPrize(false)
                }}
              >
                ¡RECLAMAR {top1Amount} {top1CurrencyLabel}!
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
                ¿Deseas pagar <strong>{PAID_SPIN_COST_GEMS} Gemas 💎</strong> de tu saldo para girar la Ruleta de la Suerte y probar tu suerte?
              </p>
              <div className="lottery-confirm-balance">
                Saldo actual: <strong>{currentGems} Gemas 💎</strong>
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
                  SÍ, GIRAR ({PAID_SPIN_COST_GEMS} 💎)
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
                ¿Deseas pagar <strong>5 Gemas 💎</strong> para adquirir <strong>1 INTENTO ADICIONAL</strong> y descifrar la secuencia para ganar el <strong>Gran Premio de {top1Amount} {top1CurrencyLabel}</strong>?
              </p>
              <div className="lottery-confirm-balance">
                Saldo actual: <strong>{currentGems} Gemas 💎</strong> (Recibes: +1 Intento)
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
                  disabled={currentGems < 5.0}
                >
                  SÍ, COMPRAR 1 INTENTO (5 💎)
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
