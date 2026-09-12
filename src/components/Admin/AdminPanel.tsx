import { useState, useEffect } from 'react'
import { supabase, isSupabaseConfigured } from '../../lib/supabaseClient'
import { soundManager } from '../../utils/audioManager'
import { adminService } from '../../services/adminService'
import type { Database, CodeRoundPrizeTier } from '../../types/database.types'
import './AdminPanel.css'

type TournamentRow = Database['public']['Tables']['tournaments']['Row']
type SeasonRow = Database['public']['Tables']['seasons']['Row']
type ProfileRow = Database['public']['Tables']['profiles']['Row']
type LotterySectorRow = Database['public']['Tables']['lottery_sectors']['Row']
type ShopPackRow = Database['public']['Tables']['shop_packs']['Row']
type BattlePassLevelRow = Database['public']['Tables']['battle_pass_levels']['Row']

/** Ronda del código secreto tal como la ve el panel: sin la columna `secret`,
 *  que tiene el SELECT revocado en la base. */
interface CodeRoundRow {
  id: string
  round_number: number
  status: 'open' | 'finished' | 'cancelled'
  free_attempts: number
  prize_pool_gems: number
  prize_1st: number
  prize_2nd: number
  prize_3rd: number
  prizes_config?: CodeRoundPrizeTier[]
  winner_id: string | null
  created_at: string
  finished_at: string | null
}

interface CodeBoardEntry {
  userId: string
  username: string
  bestPct: number
  attempts: number
  place: number
}

interface AdminPanelProps {
  isOpen: boolean
  onClose: () => void
}

export default function AdminPanel({ isOpen, onClose }: AdminPanelProps) {
  const [activeTab, setActiveTab] = useState<'tournaments' | 'seasons' | 'players' | 'rewards' | 'code' | 'referidos' | 'partidas'>('tournaments')

  /**
   * ¿SE SEPARARON LAS DOS PANTALLAS?
   *
   * La pregunta que hay que poder contestar con datos antes de dejar jugar a todo
   * el mundo, y sobre todo antes de abrir el coliseo o las guerras de clan con
   * gemas de por medio.
   *
   * Cada cliente resume su tablero cada 10 segundos y lo manda; esto compara los
   * dos resúmenes del mismo tic. Si coinciden en todos, los dos jugaron
   * exactamente la misma partida. Antes esto sólo se podía consultar a mano con
   * SQL después de cada prueba, que es como se ha ido diagnosticando a ciegas.
   */
  const [divergencias, setDivergencias] = useState<any | null>(null)
  /**
   * Cuántas horas atrás mirar.
   *
   * Importa porque las huellas se guardan desde ANTES del arreglo: las partidas
   * viejas salen separadas y eso es el fallo que ya está corregido, no uno nuevo.
   * Con la ventana en las horas que lleve desplegado, el veredicto es del código
   * que está en la calle.
   */
  const [ventanaHoras, setVentanaHoras] = useState<number>(6)
  /**
   * El registro del comercio P2P y las temporadas de referidos.
   *
   * Sin esto no había forma de auditar la comisión: «cuánto se ha llevado el
   * proyecto» habría que reconstruirlo sumando transacciones sueltas, y el 3 %
   * que va a un jugador no se podría comprobar en absoluto.
   */
  const [p2pReport, setP2pReport] = useState<any | null>(null)

  // ── Minijuego del código secreto ──────────────────────────────────────────
  // El secreto lo genera el servidor y no vuelve en ninguna respuesta, así que
  // el panel muestra la ronda pero nunca la solución: quien la abre también
  // puede jugar sin ventaja.
  const [codeRounds, setCodeRounds] = useState<CodeRoundRow[]>([])
  const [codeBoard, setCodeBoard] = useState<CodeBoardEntry[]>([])
  const [codePrizePool, setCodePrizePool] = useState(50)
  const [codeFreeAttempts, setCodeFreeAttempts] = useState(3)
  const [codeAttemptCost, setCodeAttemptCost] = useState(5)

  const DEFAULT_CODE_PRIZE_TIERS: CodeRoundPrizeTier[] = [
    { place: 1, amount: 50, currency: 'gems' },
    { place: 2, amount: 100, currency: 'gold' },
    { place: 3, amount: 80, currency: 'gold' },
  ]
  const [codePrizeTiers, setCodePrizeTiers] = useState<CodeRoundPrizeTier[]>(DEFAULT_CODE_PRIZE_TIERS)

  const handleAddPrizeTier = () => {
    setCodePrizeTiers((prev) => [
      ...prev,
      { place: prev.length + 1, amount: 10, currency: 'gold' },
    ])
  }

  const handleRemovePrizeTier = (idx: number) => {
    setCodePrizeTiers((prev) => {
      const filtered = prev.filter((_, i) => i !== idx)
      return filtered.map((t, i) => ({ ...t, place: i + 1 }))
    })
  }

  const handleUpdatePrizeTier = (idx: number, field: 'amount' | 'currency', val: any) => {
    setCodePrizeTiers((prev) => {
      const copy = [...prev]
      copy[idx] = { ...copy[idx], [field]: val }
      if (field === 'amount' && copy[idx].place === 1 && copy[idx].currency === 'gems') {
        const numVal = Number(val) || 0
        setCodePrizePool(numVal)
      }
      return copy
    })
  }
  const [tournaments, setTournaments] = useState<TournamentRow[]>([])
  const [seasons, setSeasons] = useState<SeasonRow[]>([])
  const [players, setPlayers] = useState<ProfileRow[]>([])
  const [lotterySectors, setLotterySectors] = useState<LotterySectorRow[]>([])
  const [shopPacks, setShopPacks] = useState<ShopPackRow[]>([])
  const [packPrices, setPackPrices] = useState<Record<string, number>>({})
  const [bpLevels, setBpLevels] = useState<BattlePassLevelRow[]>([])
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const [statusNotice, setStatusNotice] = useState<string | null>(null)

  // Tournament Form state
  const [tourneyTitle, setTourneyTitle] = useState('')
  const [tourneyType, setTourneyType] = useState<'free_code' | 'paid'>('free_code')
  const [tourneyCode, setTourneyCode] = useState('ARENA2026')
  const [tourneyEntryGems, setTourneyEntryGems] = useState(0)
  const [tourneyDurationMins, setTourneyDurationMins] = useState(60)
  const [tourneyStartsInMins, setTourneyStartsInMins] = useState(5)

  // Season Form state
  const [seasonNumber, setSeasonNumber] = useState(1)
  const [seasonName, setSeasonName] = useState('Temporada 1: Cosecha de Gloria')
  const [seasonDurationDays, setSeasonDurationDays] = useState(30)
  const [top1EloReward, setTop1EloReward] = useState(4000)
  const [top2EloReward, setTop2EloReward] = useState(2500)
  const [top3EloReward, setTop3EloReward] = useState(1500)
  const [top1ColoReward, setTop1ColoReward] = useState(50)
  const [top2ColoReward, setTop2ColoReward] = useState(25)
  const [top3ColoReward, setTop3ColoReward] = useState(10)

  // Player search
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedPlayer, setSelectedPlayer] = useState<ProfileRow | null>(null)
  const [adjustGems, setAdjustGems] = useState(0)
  const [adjustGold, setAdjustGold] = useState(0)
  const [adjustElo, setAdjustElo] = useState(0)

  useEffect(() => {
    if (isOpen) {
      loadAllData()
    }
  }, [isOpen])

  const showNotice = (msg: string) => {
    setStatusNotice(msg)
    setTimeout(() => setStatusNotice(null), 3500)
  }

  // ── Rondas del código secreto ─────────────────────────────────────────────
  const loadCodeRounds = async () => {
    try {
      const rows = await adminService.adminGetSecretCodeRounds()
      setCodeRounds(rows as CodeRoundRow[])
      const openRound = (rows as CodeRoundRow[]).find((r) => r.status === 'open')
      if (openRound?.prizes_config && Array.isArray(openRound.prizes_config) && openRound.prizes_config.length > 0) {
        setCodePrizeTiers(openRound.prizes_config)
        const p1 = openRound.prizes_config.find((t) => t.place === 1)
        if (p1) {
          setCodePrizePool(p1.amount)
        }
      } else if (openRound?.prize_pool_gems) {
        setCodePrizePool(openRound.prize_pool_gems)
      }
      if (openRound?.free_attempts) {
        setCodeFreeAttempts(openRound.free_attempts)
      }
    } catch (err: any) {
      console.error('[AdminPanel] Error al cargar rondas de código:', err)
    }

    // Clasificación de la ronda más reciente
    try {
      const board = await adminService.secretCodeLeaderboard()
      setCodeBoard(
        board.map((b) => ({
          userId: b.userId,
          username: b.username,
          bestPct: b.bestPct,
          attempts: b.attempts,
          place: b.place,
        }))
      )
    } catch (_) {}
  }

  const handleOpenCodeRound = async () => {
    const top1 = codePrizeTiers.find((t) => t.place === 1)
    const top1Gems = top1?.currency === 'gems' ? top1.amount : codePrizePool
    const top1Label = top1 ? `${top1.amount} ${top1.currency === 'gems' ? '💎' : '💰'}` : `${codePrizePool} 💎`
    const top2 = codePrizeTiers.find((t) => t.place === 2)?.amount ?? 0
    const top3 = codePrizeTiers.find((t) => t.place === 3)?.amount ?? 0

    setIsLoading(true)
    const res = await adminService.adminOpenSecretCodeRound({
      prizePool: codePrizePool,
      prize1st: top1Gems,
      prize2nd: top2,
      prize3rd: top3,
      freeAttempts: codeFreeAttempts,
      prizesConfig: codePrizeTiers,
    })
    setIsLoading(false)

    if (!res.success) {
      alert(`⚠️ Error al abrir ronda: ${res.error || 'No se pudo abrir la ronda.'}`)
      showNotice(`⚠️ ${res.error || 'No se pudo abrir la ronda.'}`)
      return
    }
    soundManager.playSound('victory', 0.8)
    alert(`🎉 ¡Ronda #${res.roundNumber} abierta con éxito! (5 Slots · Top 1: ${top1Label} · ${codePrizeTiers.length} puestos configurados)`)
    showNotice(`🔐 Ronda #${res.roundNumber} abierta con éxito (Top 1: ${top1Label}).`)
    await loadCodeRounds()
  }

  const handleSaveActiveRoundPrizes = async () => {
    setIsLoading(true)
    const res = await adminService.adminUpdateActiveSecretCodePrizes({
      prizePool: codePrizePool,
      prizesConfig: codePrizeTiers,
    })
    setIsLoading(false)

    if (!res.success) {
      alert(`⚠️ Error al guardar premios: ${res.error || 'No se pudo guardar la configuración.'}`)
      showNotice(`⚠️ ${res.error || 'No se pudo guardar.'}`)
      return
    }

    soundManager.playSound('victory', 0.8)
    alert(`🎉 ¡Recompensas de la Ronda guardadas y actualizadas con éxito en Supabase! (${codePrizeTiers.length} puestos configurados)`)
    showNotice(`✅ Recompensas actualizadas en Supabase (${codePrizeTiers.length} puestos).`)
    await loadCodeRounds()
  }

  const handleCloseCodeRound = async (settle: boolean) => {
    setIsLoading(true)
    const res = await adminService.adminCloseSecretCodeRound(settle)
    setIsLoading(false)

    if (!res.success) {
      alert(`⚠️ Error al cerrar ronda: ${res.error || 'No se pudo cerrar la ronda.'}`)
      showNotice(`⚠️ ${res.error || 'No se pudo cerrar la ronda.'}`)
      return
    }
    const msg = settle
      ? `✅ Ronda #${res.roundNumber} cerrada y bote repartido.`
      : `🚫 Ronda #${res.roundNumber} cancelada sin reparto.`
    alert(msg)
    showNotice(msg)
    await loadCodeRounds()
  }

  const handleRestartCodeRound = async (settlePrevious: boolean) => {
    const top1 = codePrizeTiers.find((t) => t.place === 1)
    const top1Gems = top1?.currency === 'gems' ? top1.amount : codePrizePool
    const top1Label = top1 ? `${top1.amount} ${top1.currency === 'gems' ? '💎' : '💰'}` : `${codePrizePool} 💎`
    const top2 = codePrizeTiers.find((t) => t.place === 2)?.amount ?? 0
    const top3 = codePrizeTiers.find((t) => t.place === 3)?.amount ?? 0

    setIsLoading(true)
    const res = await adminService.adminRestartSecretCodeRound({
      prizePool: codePrizePool,
      prize1st: top1Gems,
      prize2nd: top2,
      prize3rd: top3,
      freeAttempts: codeFreeAttempts,
      attemptCost: codeAttemptCost,
      settlePrevious,
      prizesConfig: codePrizeTiers,
    })
    setIsLoading(false)

    if (!res.success) {
      alert(`⚠️ Error al reiniciar ronda: ${res.error || 'No se pudo reiniciar la ronda.'}`)
      showNotice(`⚠️ ${res.error || 'No se pudo reiniciar la ronda.'}`)
      return
    }
    soundManager.playSound('victory', 0.8)
    alert(`🚀 ¡Nuevo Acertijo #${res.roundNumber} iniciado con éxito! (5 Slots · Top 1: ${top1Label} · ${codePrizeTiers.length} puestos)`)
    showNotice(`🚀 Nuevo Acertijo #${res.roundNumber} iniciado (5 slots · Top 1: ${top1Label}).`)
    await loadCodeRounds()
  }

  const loadAllData = async () => {
    if (!isSupabaseConfigured()) {
      showNotice('⚠️ Supabase no está conectado todavía. Usando modo de prueba local.')
      return
    }
    setIsLoading(true)
    try {
      const [tRes, sRes, pRes, lData, spData, bpData] = await Promise.all([
        supabase.from('tournaments').select('*').order('created_at', { ascending: false }),
        supabase.from('seasons').select('*').order('created_at', { ascending: false }),
        supabase.from('profiles').select('*').order('created_at', { ascending: false }).limit(30),
        adminService.adminGetLotterySectors(),
        adminService.adminGetShopPacks(),
        adminService.adminGetBattlePassLevels(),
      ])

      if (tRes.data) setTournaments(tRes.data)
      if (sRes.data) {
        setSeasons(sRes.data)
        if (sRes.data.length > 0) {
          const cur = sRes.data[0]
          setSeasonNumber(cur.season_number)
          setSeasonName(cur.name)
          setTop1EloReward(cur.top1_elo_reward)
          setTop2EloReward(cur.top2_elo_reward)
          setTop3EloReward(cur.top3_elo_reward)
          setTop1ColoReward(cur.top1_colosseum_reward)
          setTop2ColoReward(cur.top2_colosseum_reward)
          setTop3ColoReward(cur.top3_colosseum_reward)
        }
      }
      if (pRes.data) setPlayers(pRes.data)
      if (lData) setLotterySectors(lData)
      if (spData) {
        setShopPacks(spData)
        const prices: Record<string, number> = {}
        for (const p of spData) {
          prices[p.pack_id] = Number(p.price_gems)
        }
        setPackPrices(prices)
      }
      if (bpData) setBpLevels(bpData)

      await loadCodeRounds()
    } catch (e) {
      console.error(e)
    } finally {
      setIsLoading(false)
    }
  }

  // ── Constantes para configuración de premios ─────────────────────────────
  const AVAILABLE_PLANTS = [
    { id: 'sunflower', name: 'Girasol 🌻' },
    { id: 'bonkchoy', name: 'Bonk Choy 🥊' },
    { id: 'twinsunflower', name: 'Girasol Doble 🌻🌻' },
    { id: 'jalapeno', name: 'Jalapeño 🌶️' },
    { id: 'repeater', name: 'Repetidora 🌱' },
    { id: 'aloe', name: 'Aloe Vera 🌵' },
    { id: 'tallnut', name: 'Nuez Alta 🥥' },
    { id: 'cactus', name: 'Cactus Espinoso 🌵' },
    { id: 'rose', name: 'Rosa Hechicera 🌹' },
    { id: 'carnivorous', name: 'Planta Carnívora 🌺' },
    { id: 'mushroom', name: 'Hongo Místico 🍄' },
  ]

  const AVAILABLE_PACKS = [
    { id: 'basic', name: 'Sobre Básico 📦' },
    { id: 'rare', name: 'Sobre Raro 💠' },
    { id: 'epic', name: 'Sobre Épico 🟣' },
    { id: 'legendary', name: 'Sobre Legendario / Dorado 👑' },
  ]

  // ── Handlers de Premios & Ruleta (SQL 09) ──────────────────────────────────
  const handleLotteryFieldChange = (sectorId: string, field: keyof LotterySectorRow, value: any) => {
    setLotterySectors((prev) =>
      prev.map((s) => {
        if (s.sector_id !== sectorId) return s
        const updated = { ...s, [field]: value }

        // Si se modifica la cantidad de gemas u oro, actualizar automáticamente el label si sigue el formato estándar
        if (field === 'gems_amount' && (s.label?.includes('Gemas') || !s.label)) {
          updated.label = `${value} Gemas 💎`
        } else if (field === 'gold_amount' && (s.label?.includes('Oro') || !s.label)) {
          updated.label = `${value} Oro`
        }

        return updated
      })
    )
  }

  const handleAddTryAgainSector = () => {
    if (lotterySectors.some((s) => s.sector_id === 'try_again')) {
      showNotice('ℹ️ El sector "Sigue Intentando" ya existe en la lista.')
      return
    }
    const newSector: LotterySectorRow = {
      sector_id: 'try_again',
      label: 'Sigue Intentando 💨',
      reward_type: 'none' as any,
      weight: 5.0,
      is_active: true,
      gems_amount: null,
      gold_amount: null,
      pack_id: null,
      pack_qty: null,
      plant_id: null,
      plant_qty: null,
    }
    setLotterySectors((prev) => [...prev, newSector])
  }

  const handleSaveLotterySectors = async () => {
    const totalActiveWeight = Number(
      lotterySectors
        .filter((s) => s.is_active)
        .reduce((sum, s) => sum + (Number(s.weight) || 0), 0)
        .toFixed(2)
    )

    if (Math.abs(totalActiveWeight - 100) > 0.001) {
      alert(`⚠️ Los pesos de los sectores activos suman ${totalActiveWeight}%, y deben sumar exactamente 100%.`)
      return
    }

    setIsLoading(true)
    const payload = lotterySectors.map((s) => ({
      sectorId: s.sector_id,
      label: s.label,
      weight: Number(s.weight),
      isActive: Boolean(s.is_active),
      gemsAmount: s.reward_type === 'gems' ? Number(s.gems_amount) || 0 : null,
      goldAmount: s.reward_type === 'gold' ? Number(s.gold_amount) || 0 : null,
      packQty: s.reward_type === 'pack' ? Number(s.pack_qty) || 1 : null,
      plantQty: s.reward_type === 'plant' ? Number(s.plant_qty) || 1 : null,
      itemId: s.reward_type === 'item' ? ((s as any).item_id || null) : null,
      itemQty: s.reward_type === 'item' ? (Number((s as any).item_qty) || 1) : null,
    }))

    const res = await adminService.adminSaveLotterySectors(payload)
    setIsLoading(false)

    if (res.success) {
      soundManager.playSound('victory', 0.8)
      showNotice('✅ Ruleta de premios guardada en Supabase (pesos verificados: 100%).')
      const updated = await adminService.adminGetLotterySectors()
      if (updated) setLotterySectors(updated)
    } else {
      alert(`Error al guardar la ruleta: ${res.error || 'Error desconocido'}`)
    }
  }

  const handleSavePackPrice = async (packId: string) => {
    const price = packPrices[packId]
    if (!price || price <= 0) {
      alert('El precio debe ser un número mayor a 0.')
      return
    }
    setIsLoading(true)
    const res = await adminService.adminSetPackPrice(packId, price)
    setIsLoading(false)

    if (res.success) {
      soundManager.playSound('victory', 0.8)
      showNotice(`✅ Precio de sobre "${packId}" actualizado a ${price} 💎 en la tienda.`)
      const updated = await adminService.adminGetShopPacks()
      if (updated) setShopPacks(updated)
    } else {
      alert(`Error al cambiar precio: ${res.error || 'Error desconocido'}`)
    }
  }

  // ── Handlers de Pase de Batalla (battle_pass_levels) ───────────────────────
  const handleBpFieldChange = (level: number, field: keyof BattlePassLevelRow, value: any) => {
    setBpLevels((prev) =>
      prev.map((lvl) => {
        if (lvl.level !== level) return lvl
        const updated = { ...lvl, [field]: value }
        // Auto-generate label if relevant
        if (field === 'reward_type') {
          if (value === 'pack') {
            updated.pack_id = updated.pack_id || 'basic'
            updated.pack_count = updated.pack_count || 1
            updated.plant_id = null
            updated.copies_count = null
            updated.label = `Sobre ${updated.pack_id} x${updated.pack_count}`
          } else if (value === 'copies' || value === 'plant') {
            updated.plant_id = updated.plant_id || 'sunflower'
            updated.copies_count = updated.copies_count || 3
            updated.pack_id = null
            updated.pack_count = null
            updated.label = `x${updated.copies_count} ${updated.plant_id}`
          } else if (value === 'badge') {
            updated.pack_id = null
            updated.pack_count = null
            updated.plant_id = null
            updated.copies_count = null
            updated.label = `Insignia Arena ${updated.arena_name}`
          }
        }
        return updated
      })
    )
  }

  const handleSaveBattlePass = async () => {
    if (bpLevels.length === 0) return
    setIsLoading(true)
    const res = await adminService.adminSaveBattlePassLevels(bpLevels)
    setIsLoading(false)

    if (res.success) {
      soundManager.playSound('victory', 0.8)
      showNotice(`✅ ${bpLevels.length} niveles del Pase de Batalla guardados en Supabase.`)
      const updated = await adminService.adminGetBattlePassLevels()
      if (updated) setBpLevels(updated)
    } else {
      alert(`Error al guardar pase de batalla: ${res.error || 'Error desconocido'}`)
    }
  }

  // CREATE TOURNAMENT IN SUPABASE
  const handleCreateTournament = async () => {
    if (!tourneyTitle.trim()) {
      alert('Ingresa un título para el torneo')
      return
    }
    const startsAt = new Date(Date.now() + tourneyStartsInMins * 60 * 1000).toISOString()
    const endsAt = new Date(Date.now() + (tourneyStartsInMins + tourneyDurationMins) * 60 * 1000).toISOString()

    const newTourney: Database['public']['Tables']['tournaments']['Insert'] = {
      title: tourneyTitle,
      type: tourneyType,
      access_code: tourneyType === 'free_code' ? tourneyCode.toUpperCase() : null,
      entry_cost_gems: tourneyType === 'paid' ? tourneyEntryGems : 0,
      duration_minutes: tourneyDurationMins,
      starts_at: startsAt,
      ends_at: endsAt,
      status: 'scheduled',
    }

    if (isSupabaseConfigured()) {
      setIsLoading(true)
      const { error } = await (supabase.from('tournaments') as any).insert(newTourney)
      if (error) {
        alert('Error al crear torneo: ' + error.message)
      } else {
        soundManager.playSound('victory', 0.8)
        showNotice('✅ ¡Torneo publicado exitosamente en Supabase!')
        setTourneyTitle('')
        loadAllData()
      }
      setIsLoading(false)
    } else {
      showNotice('✅ Torneo guardado en memoria local.')
    }
  }

  // UPDATE TOURNAMENT STATUS (LIVE / FINISHED)
  const handleUpdateTournamentStatus = async (id: string, newStatus: 'scheduled' | 'live' | 'finished') => {
    if (!isSupabaseConfigured()) return
    setIsLoading(true)
    const { error } = await (supabase.from('tournaments') as any)
      .update({ status: newStatus })
      .eq('id', id)
    if (!error) {
      showNotice(`✅ Estado del torneo actualizado a: ${newStatus.toUpperCase()}`)
      loadAllData()
    }
    setIsLoading(false)
  }

  // SAVE OR CREATE SEASON IN SUPABASE
  const handleSaveSeason = async () => {
    const startsAt = new Date().toISOString()
    const endsAt = new Date(Date.now() + seasonDurationDays * 24 * 60 * 60 * 1000).toISOString()

    const seasonData: Database['public']['Tables']['seasons']['Insert'] = {
      season_number: seasonNumber,
      name: seasonName,
      starts_at: startsAt,
      ends_at: endsAt,
      status: 'active',
      top1_elo_reward: top1EloReward,
      top2_elo_reward: top2EloReward,
      top3_elo_reward: top3EloReward,
      top1_colosseum_reward: top1ColoReward,
      top2_colosseum_reward: top2ColoReward,
      top3_colosseum_reward: top3ColoReward,
      is_current: true,
    }

    if (isSupabaseConfigured()) {
      setIsLoading(true)
      const { error } = await (supabase.from('seasons') as any).insert(seasonData)
      if (error) {
        alert('Error al guardar temporada: ' + error.message)
      } else {
        soundManager.playSound('victory', 0.8)
        showNotice('✅ ¡Temporada y Premios actualizados en Supabase!')
        loadAllData()
      }
      setIsLoading(false)
    } else {
      showNotice('✅ Temporada guardada en memoria local.')
    }
  }

  // SETTLE SEASON REWARDS (OFFICIAL $100 USD / 10,000 GEMS)
  const handleSettleSeason = async () => {
    if (!confirm('¿Estás seguro de finalizar la temporada actual y acreditar los $100 USD (10,000 gemas) + sobres al Top 20 del Ranking ELO?')) return
    if (!isSupabaseConfigured()) return
    setIsLoading(true)
    try {
      const { data, error } = await (supabase.rpc as any)('settle_season_rewards', {})
      if (error) {
        alert('Error al liquidar temporada: ' + error.message)
      } else {
        soundManager.playSound('victory', 0.9)
        const summary = (data as any)?.summary || 'Premios acreditados al Top 20 exitosamente.'
        showNotice('🏆 ' + summary)
        alert('✅ ¡Temporada liquidada con éxito!\n' + JSON.stringify(data, null, 2))
        loadAllData()
      }
    } catch (e: any) {
      alert('Excepción al liquidar temporada: ' + e.message)
    } finally {
      setIsLoading(false)
    }
  }

  // SAVE PLAYER ADJUSTMENTS
  const handleSavePlayerChanges = async () => {
    if (!selectedPlayer || !isSupabaseConfigured()) return
    setIsLoading(true)
    const updates: Database['public']['Tables']['profiles']['Update'] = {
      gems_balance: Number((selectedPlayer.gems_balance + adjustGems).toFixed(2)),
      gold_balance: selectedPlayer.gold_balance + adjustGold,
      elo_rating: Math.max(0, selectedPlayer.elo_rating + adjustElo),
    }

    const { error } = await (supabase.from('profiles') as any)
      .update(updates)
      .eq('id', selectedPlayer.id)

    if (!error) {
      soundManager.playSound('victory', 0.8)
      showNotice(`✅ Saldo actualizado para ${selectedPlayer.username}`)
      setAdjustGems(0)
      setAdjustGold(0)
      setAdjustElo(0)
      setSelectedPlayer(null)
      loadAllData()
    }
    setIsLoading(false)
  }

  if (!isOpen) return null

  return (
    <div className="admin-backdrop" onClick={onClose}>
      <div className="admin-modal-card" onClick={(e) => e.stopPropagation()}>
        {/* HEADER */}
        <div className="admin-header">
          <div className="admin-header__title-box">
            <span className="admin-header__icon">🛡️</span>
            <div>
              <h2 className="admin-header__title">PANEL DE ADMINISTRACIÓN CENTRAL</h2>
              <p className="admin-header__subtitle">
                Gestión en tiempo real de Torneos, Fechas, Premios de Temporada y Economía
              </p>
            </div>
          </div>

          <div className="admin-header__actions">
            <span className={`admin-status-badge ${isSupabaseConfigured() ? 'admin-status-badge--online' : 'admin-status-badge--offline'}`}>
              {isSupabaseConfigured() ? '🟢 Supabase Conectado' : '🟡 Modo Local (Sin .env)'}
            </span>
            <button type="button" className="admin-close-btn" onClick={onClose}>
              ✕
            </button>
          </div>
        </div>

        {/* STATUS NOTICE */}
        {statusNotice && <div className="admin-alert-banner">{statusNotice}</div>}

        {/* NAVIGATION TABS */}
        <div className="admin-tabs">
          <button
            type="button"
            className={`admin-tab-btn ${activeTab === 'tournaments' ? 'admin-tab-btn--active' : ''}`}
            onClick={() => setActiveTab('tournaments')}
          >
            🎪 Torneos Oficiales ({tournaments.length})
          </button>
          <button
            type="button"
            className={`admin-tab-btn ${activeTab === 'seasons' ? 'admin-tab-btn--active' : ''}`}
            onClick={() => setActiveTab('seasons')}
          >
            🏆 Temporadas y Premios ({seasons.length})
          </button>
          <button
            type="button"
            className={`admin-tab-btn ${activeTab === 'players' ? 'admin-tab-btn--active' : ''}`}
            onClick={() => setActiveTab('players')}
          >
            👥 Jugadores y Economía
          </button>
          <button
            type="button"
            className={`admin-tab-btn ${activeTab === 'rewards' ? 'admin-tab-btn--active' : ''}`}
            onClick={() => setActiveTab('rewards')}
          >
            🎁 Premios & Ruleta ({lotterySectors.length})
          </button>
          <button
            type="button"
            className={`admin-tab-btn ${activeTab === 'code' ? 'admin-tab-btn--active' : ''}`}
            onClick={() => {
              setActiveTab('code')
              loadCodeRounds()
            }}
          >
            🔐 Código Secreto ({codeRounds.filter((r) => r.status === 'open').length > 0 ? '🟢 ronda activa' : 'sin ronda'})
          </button>
          <button
            type="button"
            className={`admin-tab-btn ${activeTab === 'referidos' ? 'admin-tab-btn--active' : ''}`}
            onClick={() => {
              setActiveTab('referidos')
              void adminService.adminP2pReport(50).then(setP2pReport)
            }}
          >
            🔗 Referidos y Mercado
          </button>
          <button
            type="button"
            className={`admin-tab-btn ${activeTab === 'partidas' ? 'admin-tab-btn--active' : ''}`}
            onClick={() => {
              setActiveTab('partidas')
              void adminService.adminDivergencias(60).then(setDivergencias)
            }}
          >
            🔬 ¿Partidas iguales?
          </button>
        </div>

        {/* TAB 6: REFERIDOS Y EL REPARTO DEL MERCADO */}
        {activeTab === 'referidos' && (
          <div className="admin-content-section">
            <h3>🔗 Comisión del mercado P2P</h3>

            {!p2pReport ? (
              <p className="admin-card-desc">Cargando el registro…</p>
            ) : (
              <>
                {/* El reparto nace apagado y se enciende cuando una temporada
                    llega a la meta de 300 y asigna esos puestos. Decirlo aquí
                    evita el «¿por qué el top 1 no cobra nada?». */}
                <p className="admin-card-desc">
                  Comisión <strong>{p2pReport.porcentajes?.comision ?? 10} %</strong> de cada
                  venta. Reparto al ranking de referidos:{' '}
                  <strong>{p2pReport.repartoActivo ? 'ENCENDIDO' : 'apagado'}</strong>
                  {' '}— 1.º {p2pReport.porcentajes?.top1 ?? 3} % y 2.º{' '}
                  {p2pReport.porcentajes?.top2 ?? 1} % del precio. Se enciende al
                  cerrarse una temporada que alcance la meta de 300 referidos.
                </p>

                <div className="admin-p2p-cifras">
                  <div className="admin-p2p-cifra">
                    <span className="admin-p2p-cifra__num">{p2pReport.totales?.ventas ?? 0}</span>
                    <span className="admin-p2p-cifra__lbl">Ventas</span>
                  </div>
                  <div className="admin-p2p-cifra">
                    <span className="admin-p2p-cifra__num">{p2pReport.totales?.volumen ?? 0} 💎</span>
                    <span className="admin-p2p-cifra__lbl">Volumen</span>
                  </div>
                  <div className="admin-p2p-cifra">
                    <span className="admin-p2p-cifra__num">{p2pReport.totales?.alProyecto ?? 0} 💎</span>
                    <span className="admin-p2p-cifra__lbl">Al proyecto</span>
                  </div>
                  <div className="admin-p2p-cifra">
                    <span className="admin-p2p-cifra__num">
                      {(Number(p2pReport.totales?.aTop1 ?? 0) + Number(p2pReport.totales?.aTop2 ?? 0)).toFixed(2)} 💎
                    </span>
                    <span className="admin-p2p-cifra__lbl">Repartido al ranking</span>
                  </div>
                </div>

                <h3>📋 Últimas ventas</h3>
                <div className="admin-p2p-tabla-wrap">
                  <table className="admin-p2p-tabla">
                    <thead>
                      <tr>
                        <th>Fecha</th><th>Vendedor</th><th>Comprador</th>
                        <th>Precio</th><th>Comisión</th>
                        <th>1.º</th><th>2.º</th><th>Proyecto</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(p2pReport.ventas ?? []).length === 0 ? (
                        <tr><td colSpan={8}>Todavía no hay ventas registradas.</td></tr>
                      ) : (
                        (p2pReport.ventas ?? []).map((v: any, i: number) => (
                          <tr key={i}>
                            <td>{new Date(v.fecha).toLocaleString()}</td>
                            <td>{v.vendedor ?? '—'}</td>
                            <td>{v.comprador ?? '—'}</td>
                            <td>{v.precio}</td>
                            <td>{v.comision}</td>
                            <td>{v.top1 ? `${v.top1}: ${v.top1Gemas}` : '—'}</td>
                            <td>{v.top2 ? `${v.top2}: ${v.top2Gemas}` : '—'}</td>
                            <td>{v.proyecto}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                <h3>🏆 Temporadas de referidos</h3>
                <div className="admin-p2p-tabla-wrap">
                  <table className="admin-p2p-tabla">
                    <thead>
                      <tr>
                        <th>Empezó</th><th>Termina</th><th>Estado</th>
                        <th>Válidos</th><th>Meta</th><th>1.º del P2P</th><th>2.º del P2P</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(p2pReport.temporadas ?? []).map((t: any, i: number) => (
                        <tr key={i}>
                          <td>{new Date(t.empezo).toLocaleDateString()}</td>
                          <td>{new Date(t.termina).toLocaleString()}</td>
                          <td>{t.estado === 'open' ? '🟢 abierta' : 'cerrada'}</td>
                          <td>{t.validos ?? '—'}</td>
                          <td>{t.meta ?? '—'}</td>
                          <td>{t.top1 ?? '—'}</td>
                          <td>{t.top2 ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Cerrar a mano usa exactamente el mismo código que el contador,
                    así que lo que se prueba es lo que va a pasar de verdad. */}
                <button
                  type="button"
                  className="admin-action-btn--red"
                  onClick={async () => {
                    const r = await adminService.adminCloseReferralSeason()
                    setStatusNotice(
                      r?.cerrada
                        ? `Temporada cerrada: ${r.total} referidos válidos, meta ${r.meta ?? 'ninguna'}, ${r.premiados ?? 0} premiados.`
                        : 'No había temporada que cerrar.'
                    )
                    void adminService.adminP2pReport(50).then(setP2pReport)
                  }}
                >
                  ⏭️ Cerrar la temporada YA y repartir premios
                </button>
              </>
            )}
          </div>
        )}

        {/* TAB 7: ¿LAS DOS PANTALLAS VEN LA MISMA PARTIDA?
            ───────────────────────────────────────────────────────────────────
            Es el detector de divergencias, a la vista. Hasta ahora los datos
            estaban en la base y había que consultarlos a mano con SQL después de
            cada prueba: así se ha ido diagnosticando a ciegas durante días.

            Lo que se lee es el veredicto grande. Verde significa que se puede
            dejar jugar a todo el mundo, y rojo que hay una partida concreta que
            mirar — con su tic y sus dos resúmenes. */}
        {activeTab === 'partidas' && (() => {
          const todas: any[] = divergencias?.partidas ?? []
          const desde = Date.now() - ventanaHoras * 3600_000
          const enVentana = todas.filter((p) => new Date(p.jugadaEn).getTime() >= desde)
          const conDatos = enVentana.filter((p) => Number(p.comparados) > 0)
          const separadas = enVentana.filter((p) => p.primerTicDistinto !== null)

          return (
            <div className="admin-content-section">
              <div className="admin-alert-banner">
                🔬 Cada pantalla resume su tablero cada 10 segundos y lo manda.
                Esto compara los dos resúmenes del MISMO tic: si coinciden en
                todos, los dos jugaron exactamente la misma partida.
                <br />
                ⚠️ Las partidas jugadas <strong>antes</strong> del arreglo salen
                separadas — ése es el fallo ya corregido, no uno nuevo. Pon la
                ventana en las horas que lleve desplegada la versión nueva.
              </div>

              <div className="admin-form-group">
                <label>Mirar sólo las últimas</label>
                <select
                  value={ventanaHoras}
                  onChange={(e) => setVentanaHoras(Number(e.target.value))}
                >
                  <option value={1}>1 hora</option>
                  <option value={6}>6 horas</option>
                  <option value={24}>24 horas</option>
                  <option value={24 * 30}>todas</option>
                </select>
                <button
                  type="button"
                  className="admin-action-btn--green"
                  onClick={() => { void adminService.adminDivergencias(60).then(setDivergencias) }}
                >
                  🔄 Actualizar
                </button>
              </div>

              {divergencias === null ? (
                <p className="admin-card-desc">Cargando…</p>
              ) : (
                <>
                  {/* EL VEREDICTO. Con cero partidas comparables no dice nada, y
                      eso hay que decirlo en lugar de dar un verde falso. */}
                  <div
                    className="admin-alert-banner"
                    style={{
                      borderColor: conDatos.length === 0 ? '#fbbf24' : separadas.length === 0 ? '#52e061' : '#ff4d4d',
                      fontSize: '1.05rem',
                    }}
                  >
                    {conDatos.length === 0
                      ? `⚠️ Todavía no hay ninguna partida con datos que comparar en las últimas ${ventanaHoras} h. Que jueguen dos, y al menos 10 segundos.`
                      : separadas.length === 0
                      ? `✅ ${conDatos.length} partida(s) comparada(s) y NINGUNA se separó. Se puede dejar jugar.`
                      : `❌ ${separadas.length} de ${conDatos.length} se separaron. Mira la tabla: la columna del tic dice dónde.`}
                  </div>

                  <div className="admin-p2p-cifras">
                    <div className="admin-p2p-cifra">
                      <span className="admin-p2p-cifra__num">{conDatos.length}</span>
                      <span className="admin-p2p-cifra__lbl">Comparables</span>
                    </div>
                    <div className="admin-p2p-cifra">
                      <span className="admin-p2p-cifra__num">{conDatos.length - separadas.length}</span>
                      <span className="admin-p2p-cifra__lbl">Iguales</span>
                    </div>
                    <div className="admin-p2p-cifra">
                      <span className="admin-p2p-cifra__num">{separadas.length}</span>
                      <span className="admin-p2p-cifra__lbl">Separadas</span>
                    </div>
                    <div className="admin-p2p-cifra">
                      <span className="admin-p2p-cifra__num">{enVentana.length - conDatos.length}</span>
                      <span className="admin-p2p-cifra__lbl">Sin datos</span>
                    </div>
                  </div>

                  <h3>📋 Partidas</h3>
                  <div className="admin-p2p-tabla-wrap">
                    <table className="admin-p2p-tabla">
                      <thead>
                        <tr>
                          <th>Cuándo</th><th>Modo</th><th>Jugadores</th>
                          <th>Tics comparados</th><th>Se separó en</th><th>Veredicto</th>
                        </tr>
                      </thead>
                      <tbody>
                        {enVentana.length === 0 ? (
                          <tr><td colSpan={6}>Ninguna partida en esta ventana.</td></tr>
                        ) : (
                          enVentana.map((p) => {
                            const sinDatos = Number(p.comparados) === 0
                            const rota = p.primerTicDistinto !== null
                            return (
                              <tr key={p.roomId}>
                                <td>{new Date(p.jugadaEn).toLocaleString()}</td>
                                <td>{p.mode}</td>
                                <td>{p.jugadores}</td>
                                <td>{p.comparados}</td>
                                {/* El tic y el segundo: 30 tics son un segundo. */}
                                <td>
                                  {rota
                                    ? `tic ${p.primerTicDistinto} (seg. ${Math.round(Number(p.primerTicDistinto) / 30)})`
                                    : '—'}
                                </td>
                                <td>
                                  {sinDatos ? '⚠️ sin datos' : rota ? '❌ se separaron' : '✅ iguales'}
                                </td>
                              </tr>
                            )
                          })
                        )}
                      </tbody>
                    </table>
                  </div>

                  <p className="admin-card-desc">
                    «Sin datos» no es un fallo: es que no hubo ningún tic con
                    resumen de los dos — alguien se fue antes de los 10 primeros
                    segundos, o jugó con una versión distinta. Para ver QUÉ cambió
                    en una partida separada está{' '}
                    <code>supabase/herramientas/comprobar-divergencias.sql</code>,
                    consulta 3.
                  </p>
                </>
              )}
            </div>
          )
        })()}

        {/* TAB 4: CÓDIGO SECRETO POR RONDAS */}
        {activeTab === 'code' && (() => {
          const activa = codeRounds.find((r) => r.status === 'open') || null
          return (
            <div className="admin-content-section">
              <div className="admin-alert-banner">
                🔐 El código lo genera el servidor al abrir la ronda y no se
                devuelve en ninguna respuesta — tampoco a este panel. Puedes jugar
                sin ventaja sobre los demás.
              </div>

              <div className="admin-grid-2col">
                {/* ABRIR / CERRAR RONDA */}
                <div className="admin-card">
                  <h3>{activa ? `🟢 Ronda #${activa.round_number} en curso` : '➕ Abrir nueva ronda'}</h3>

                  {activa ? (
                    <>
                      <div className="admin-form-group">
                        <label>Bote Top 1:</label>
                        <strong>
                          {activa.prizes_config?.[0]
                            ? `${activa.prizes_config[0].amount} ${activa.prizes_config[0].currency === 'gold' ? '💰 Oro' : '💎 Gemas'}`
                            : `${activa.prize_pool_gems} 💎`}
                        </strong>
                      </div>
                      <div className="admin-form-group">
                        <label>Intentos gratis por jugador:</label>
                        <strong>{activa.free_attempts}</strong>
                      </div>
                      <div className="admin-form-group">
                        <label>Abierta desde:</label>
                        <strong>{new Date(activa.created_at).toLocaleString()}</strong>
                      </div>

                      {/* EDITOR DE PREMIOS EN TIEMPO REAL DE LA RONDA ACTIVA */}
                      <div style={{ margin: '12px 0', padding: '12px', background: 'rgba(15, 23, 42, 0.65)', borderRadius: '8px', border: '1px solid rgba(56, 189, 248, 0.35)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap', gap: '8px' }}>
                          <div>
                            <h4 style={{ margin: 0, fontSize: '13px', color: '#facc15' }}>
                              🎮 Premios Oficiales de la Ronda Activa (Editables en Vivo)
                            </h4>
                            <small style={{ opacity: 0.8, fontSize: '11px' }}>
                              Ajusta los premios de esta ronda y pulsa Guardar para aplicar en Supabase al instante:
                            </small>
                          </div>
                          <button
                            type="button"
                            onClick={handleAddPrizeTier}
                            style={{
                              padding: '4px 10px',
                              fontSize: '11px',
                              background: '#059669',
                              color: '#fff',
                              border: 'none',
                              borderRadius: '4px',
                              cursor: 'pointer',
                              fontWeight: 700,
                            }}
                          >
                            ➕ Añadir Puesto
                          </button>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: '6px', marginBottom: '10px' }}>
                          {codePrizeTiers.map((tier, idx) => (
                            <div
                              key={tier.place}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px',
                                background: 'rgba(255,255,255,0.04)',
                                padding: '5px 8px',
                                borderRadius: '5px',
                                border: tier.place === 1 ? '1px solid rgba(250, 204, 21, 0.4)' : '1px solid rgba(255,255,255,0.06)',
                              }}
                            >
                              <span
                                style={{
                                  fontWeight: 800,
                                  fontSize: '12px',
                                  minWidth: '34px',
                                  color: tier.place === 1 ? '#facc15' : tier.place === 2 ? '#cbd5e1' : tier.place === 3 ? '#d97706' : '#94a3b8',
                                }}
                              >
                                #{tier.place}
                              </span>
                              <input
                                type="number"
                                min={0}
                                style={{
                                  width: '65px',
                                  padding: '3px 6px',
                                  background: '#0f172a',
                                  border: '1px solid #334155',
                                  borderRadius: '4px',
                                  color: '#fff',
                                  fontSize: '12px',
                                }}
                                value={tier.amount}
                                onChange={(e) => handleUpdatePrizeTier(idx, 'amount', Number(e.target.value))}
                              />
                              <select
                                style={{
                                  padding: '3px 6px',
                                  background: '#0f172a',
                                  border: '1px solid #334155',
                                  borderRadius: '4px',
                                  color: '#fff',
                                  fontSize: '12px',
                                }}
                                value={tier.currency}
                                onChange={(e) => handleUpdatePrizeTier(idx, 'currency', e.target.value as 'gems' | 'gold')}
                              >
                                <option value="gems">💎 Gemas</option>
                                <option value="gold">💰 Oro</option>
                              </select>
                              {codePrizeTiers.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => handleRemovePrizeTier(idx)}
                                  style={{
                                    background: 'none',
                                    border: 'none',
                                    color: '#ef4444',
                                    cursor: 'pointer',
                                    fontSize: '12px',
                                    padding: '0 2px',
                                  }}
                                  title="Eliminar puesto"
                                >
                                  ❌
                                </button>
                              )}
                            </div>
                          ))}
                        </div>

                        <button
                          type="button"
                          className="admin-tab-btn admin-tab-btn--active"
                          style={{
                            width: '100%',
                            background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                            fontWeight: 800,
                            padding: '8px 14px',
                          }}
                          disabled={isLoading}
                          onClick={handleSaveActiveRoundPrizes}
                        >
                          {isLoading ? '⏳ Guardando...' : `💾 Guardar Cambios en Ronda #${activa.round_number} (${codePrizeTiers.length} puestos)`}
                        </button>
                      </div>

                      <p style={{ fontSize: 12, opacity: 0.8, lineHeight: 1.5 }}>
                        La ronda se cierra sola cuando alguien acierte los 5 (100%).
                        Ciérrala a mano si quieres repartir antes de que nadie lo
                        consiga, o reinicia para iniciar un nuevo acertijo inmediatamente.
                      </p>

                      <div className="admin-form-row">
                        <button
                          type="button"
                          className="admin-tab-btn"
                          disabled={isLoading}
                          onClick={() => handleCloseCodeRound(true)}
                        >
                          💰 Cerrar y repartir el bote
                        </button>
                        <button
                          type="button"
                          className="admin-tab-btn"
                          disabled={isLoading}
                          onClick={() => handleCloseCodeRound(false)}
                        >
                          🚫 Cancelar sin repartir
                        </button>
                      </div>

                      {/* INICIAR NUEVA TEMPORADA / LIMPIAR ANTERIOR */}
                      <div
                        style={{
                          marginTop: '16px',
                          padding: '12px',
                          background: 'rgba(14, 165, 233, 0.1)',
                          border: '1px dashed #0284c7',
                          borderRadius: '8px',
                        }}
                      >
                        <h4 style={{ margin: '0 0 6px 0', color: '#38bdf8', fontSize: '13px' }}>
                          🚀 Iniciar Nueva Temporada / Acertijo (5 Slots)
                        </h4>
                        <p style={{ fontSize: '11px', opacity: 0.85, margin: '0 0 8px 0' }}>
                          Cierra la ronda anterior y comienza de inmediato un nuevo acertijo secreto de 5 plantas:
                        </p>
                        <div className="admin-form-row">
                          <div className="admin-form-group">
                            <label>Bote nuevo (💎):</label>
                            <input
                              type="number"
                              min={1}
                              value={codePrizePool}
                              onChange={(e) => {
                                const v = Number(e.target.value)
                                setCodePrizePool(v)
                                handleUpdatePrizeTier(0, 'amount', v)
                              }}
                            />
                          </div>
                          <div className="admin-form-group">
                            <label>Coste por intento (💎):</label>
                            <input
                              type="number"
                              min={1}
                              value={codeAttemptCost}
                              onChange={(e) => setCodeAttemptCost(Number(e.target.value))}
                            />
                          </div>
                          <div className="admin-form-group">
                            <label>Slots:</label>
                            <input type="text" value="5 Plantas" disabled />
                          </div>
                        </div>

                        {/* CONFIGURACIÓN DE PREMIOS EDITABLE EN REINICIO */}
                        <div
                          style={{
                            marginTop: '10px',
                            marginBottom: '10px',
                            padding: '10px',
                            background: 'rgba(0,0,0,0.3)',
                            borderRadius: '6px',
                            border: '1px solid rgba(255,255,255,0.08)',
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                            <strong style={{ fontSize: '12px', color: '#facc15' }}>
                              🏆 Premios por Puesto (Top 1 al {codePrizeTiers.length}):
                            </strong>
                            <button
                              type="button"
                              onClick={handleAddPrizeTier}
                              style={{
                                padding: '3px 8px',
                                fontSize: '11px',
                                background: '#059669',
                                color: '#fff',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                fontWeight: 700,
                              }}
                            >
                              ➕ Añadir Puesto
                            </button>
                          </div>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: '6px' }}>
                            {codePrizeTiers.map((tier, idx) => (
                              <div
                                key={tier.place}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '6px',
                                  background: 'rgba(255,255,255,0.04)',
                                  padding: '5px 8px',
                                  borderRadius: '5px',
                                  border: '1px solid rgba(255,255,255,0.06)',
                                }}
                              >
                                <span
                                  style={{
                                    fontWeight: 800,
                                    fontSize: '12px',
                                    minWidth: '34px',
                                    color:
                                      tier.place === 1 ? '#facc15' : tier.place === 2 ? '#cbd5e1' : tier.place === 3 ? '#d97706' : '#94a3b8',
                                  }}
                                >
                                  #{tier.place}
                                </span>
                                <input
                                  type="number"
                                  min={0}
                                  style={{
                                    width: '65px',
                                    padding: '3px 6px',
                                    background: '#0f172a',
                                    border: '1px solid #334155',
                                    borderRadius: '4px',
                                    color: '#fff',
                                    fontSize: '12px',
                                  }}
                                  value={tier.amount}
                                  onChange={(e) => handleUpdatePrizeTier(idx, 'amount', Number(e.target.value))}
                                />
                                <select
                                  style={{
                                    padding: '3px 6px',
                                    background: '#0f172a',
                                    border: '1px solid #334155',
                                    borderRadius: '4px',
                                    color: '#fff',
                                    fontSize: '12px',
                                  }}
                                  value={tier.currency}
                                  onChange={(e) => handleUpdatePrizeTier(idx, 'currency', e.target.value as 'gems' | 'gold')}
                                >
                                  <option value="gems">💎 Gemas</option>
                                  <option value="gold">💰 Oro</option>
                                </select>
                                {codePrizeTiers.length > 1 && (
                                  <button
                                    type="button"
                                    onClick={() => handleRemovePrizeTier(idx)}
                                    style={{
                                      background: 'none',
                                      border: 'none',
                                      color: '#ef4444',
                                      cursor: 'pointer',
                                      fontSize: '12px',
                                      padding: '0 2px',
                                    }}
                                    title="Eliminar puesto"
                                  >
                                    ❌
                                  </button>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className="admin-form-row" style={{ marginTop: '8px' }}>
                          <button
                            type="button"
                            className="admin-tab-btn admin-tab-btn--active"
                            style={{ background: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)', flex: 1 }}
                            disabled={isLoading}
                            onClick={() => handleRestartCodeRound(true)}
                          >
                            🏆 Repartir actual e Iniciar Nuevo (5 Slots · Top 1: {codePrizeTiers.find((t) => t.place === 1)?.amount ?? codePrizePool} {codePrizeTiers.find((t) => t.place === 1)?.currency === 'gold' ? '💰' : '💎'})
                          </button>
                          <button
                            type="button"
                            className="admin-tab-btn"
                            style={{ background: '#334155' }}
                            disabled={isLoading}
                            onClick={() => handleRestartCodeRound(false)}
                          >
                            🧹 Limpiar sin repartir
                          </button>
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="admin-form-row">
                        <div className="admin-form-group">
                          <label>Bote total (gemas):</label>
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            value={codePrizePool}
                            onChange={(e) => {
                              const v = Number(e.target.value)
                              setCodePrizePool(v)
                              handleUpdatePrizeTier(0, 'amount', v)
                            }}
                          />
                        </div>
                        <div className="admin-form-group">
                          <label>Coste por intento extra (💎):</label>
                          <input
                            type="number"
                            min={1}
                            value={codeAttemptCost}
                            onChange={(e) => setCodeAttemptCost(Number(e.target.value))}
                          />
                        </div>
                        <div className="admin-form-group">
                          <label>Intentos gratis:</label>
                          <input
                            type="number"
                            min={0}
                            value={codeFreeAttempts}
                            onChange={(e) => setCodeFreeAttempts(Number(e.target.value))}
                          />
                        </div>
                        <div className="admin-form-group">
                          <label>Slots:</label>
                          <input type="text" value="5 Plantas" disabled />
                        </div>
                      </div>

                      {/* CONFIGURACIÓN DE PREMIOS EDITABLE EN APERTURA */}
                      <div
                        style={{
                          marginTop: '12px',
                          marginBottom: '12px',
                          padding: '12px',
                          background: 'rgba(0,0,0,0.3)',
                          borderRadius: '8px',
                          border: '1px solid rgba(255,255,255,0.1)',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap', gap: '8px' }}>
                          <div>
                            <h4 style={{ margin: 0, fontSize: '13px', color: '#facc15' }}>
                              🏆 Configuración Dinámica de Premios por Puesto
                            </h4>
                            <small style={{ opacity: 0.8, fontSize: '11px' }}>
                              Define la cantidad y moneda (💎 Gemas o 💰 Oro) para cada puesto de la ronda:
                            </small>
                          </div>
                          <button
                            type="button"
                            onClick={handleAddPrizeTier}
                            style={{
                              padding: '4px 10px',
                              fontSize: '11px',
                              background: '#059669',
                              color: '#fff',
                              border: 'none',
                              borderRadius: '4px',
                              cursor: 'pointer',
                              fontWeight: 700,
                            }}
                          >
                            ➕ Añadir Puesto
                          </button>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: '6px' }}>
                          {codePrizeTiers.map((tier, idx) => (
                            <div
                              key={tier.place}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px',
                                background: 'rgba(255,255,255,0.04)',
                                padding: '5px 8px',
                                borderRadius: '5px',
                                border: '1px solid rgba(255,255,255,0.06)',
                              }}
                            >
                              <span
                                style={{
                                  fontWeight: 800,
                                  fontSize: '12px',
                                  minWidth: '34px',
                                  color:
                                    tier.place === 1 ? '#facc15' : tier.place === 2 ? '#cbd5e1' : tier.place === 3 ? '#d97706' : '#94a3b8',
                                }}
                              >
                                #{tier.place}
                              </span>
                              <input
                                type="number"
                                min={0}
                                style={{
                                  width: '65px',
                                  padding: '3px 6px',
                                  background: '#0f172a',
                                  border: '1px solid #334155',
                                  borderRadius: '4px',
                                  color: '#fff',
                                  fontSize: '12px',
                                }}
                                value={tier.amount}
                                onChange={(e) => handleUpdatePrizeTier(idx, 'amount', Number(e.target.value))}
                              />
                              <select
                                style={{
                                  padding: '3px 6px',
                                  background: '#0f172a',
                                  border: '1px solid #334155',
                                  borderRadius: '4px',
                                  color: '#fff',
                                  fontSize: '12px',
                                }}
                                value={tier.currency}
                                onChange={(e) => handleUpdatePrizeTier(idx, 'currency', e.target.value as 'gems' | 'gold')}
                              >
                                <option value="gems">💎 Gemas</option>
                                <option value="gold">💰 Oro</option>
                              </select>
                              {codePrizeTiers.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => handleRemovePrizeTier(idx)}
                                  style={{
                                    background: 'none',
                                    border: 'none',
                                    color: '#ef4444',
                                    cursor: 'pointer',
                                    fontSize: '12px',
                                    padding: '0 2px',
                                  }}
                                  title="Eliminar puesto"
                                >
                                  ❌
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>

                      <p style={{ fontSize: 12, opacity: 0.8, lineHeight: 1.5 }}>
                        Puestos configurados: <strong>{codePrizeTiers.length} lugares</strong>. Coste por intento extra:{' '}
                        <strong>{codeAttemptCost} 💎</strong>. Longitud: <strong>5 slots</strong>.
                      </p>

                      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          className="admin-tab-btn admin-tab-btn--active"
                          style={{ flex: 1, minWidth: '220px' }}
                          disabled={isLoading}
                          onClick={handleOpenCodeRound}
                        >
                          {isLoading ? '⏳ Procesando...' : `🔐 Abrir ronda (5 slots · Top 1: ${codePrizeTiers.find((t) => t.place === 1)?.amount ?? codePrizePool} ${codePrizeTiers.find((t) => t.place === 1)?.currency === 'gold' ? '💰' : '💎'})`}
                        </button>
                        <button
                          type="button"
                          className="admin-tab-btn"
                          style={{ background: '#0284c7' }}
                          disabled={isLoading}
                          onClick={() => handleRestartCodeRound(false)}
                          title="Si hay una ronda anterior bloqueada, la cancela e inicia una nueva limpia de 5 slots"
                        >
                          🧹 Forzar Inicio Limpio (5 Slots)
                        </button>
                      </div>
                    </>
                  )}
                </div>

                {/* CLASIFICACIÓN */}
                <div className="admin-card">
                  <h3>📊 Clasificación de la ronda actual</h3>
                  {codeBoard.length === 0 ? (
                    <p style={{ opacity: 0.7 }}>Todavía no hay intentos en esta ronda.</p>
                  ) : (
                    <table style={{ width: '100%', fontSize: 13 }}>
                      <thead>
                        <tr style={{ textAlign: 'left', opacity: 0.7 }}>
                          <th>#</th>
                          <th>Jugador</th>
                          <th style={{ textAlign: 'right' }}>Mejor %</th>
                          <th style={{ textAlign: 'right' }}>Intentos</th>
                          <th style={{ textAlign: 'right' }}>Premio</th>
                        </tr>
                      </thead>
                      <tbody>
                        {codeBoard.map((e) => {
                          const configuredPrize = (activa?.prizes_config ?? codePrizeTiers)?.find((p) => p.place === e.place)
                          return (
                            <tr key={e.userId}>
                              <td>{e.place === 1 ? '🥇 1' : e.place === 2 ? '🥈 2' : e.place === 3 ? '🥉 3' : e.place}</td>
                              <td>{e.username}</td>
                              <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                                {Number(e.bestPct).toFixed(1)}%
                              </td>
                              <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                                {e.attempts}
                              </td>
                              <td
                                style={{
                                  textAlign: 'right',
                                  fontWeight: 800,
                                  color: configuredPrize?.currency === 'gems' ? '#38bdf8' : '#f59e0b',
                                }}
                              >
                                {configuredPrize ? `${configuredPrize.amount} ${configuredPrize.currency === 'gems' ? '💎' : '💰'}` : '—'}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  )}
                  <p style={{ fontSize: 12, opacity: 0.8, marginTop: 12 }}>
                    Las secuencias que probó cada jugador no se muestran aquí ni en
                    ningún sitio: sólo su porcentaje. Es lo que permite competir sin
                    que se copien las jugadas.
                  </p>
                </div>
              </div>

              {/* HISTORIAL DE RONDAS */}
              <div className="admin-card" style={{ marginTop: 16 }}>
                <h3>🗂️ Rondas anteriores</h3>
                {codeRounds.length === 0 ? (
                  <p style={{ opacity: 0.7 }}>No hay rondas todavía.</p>
                ) : (
                  <table style={{ width: '100%', fontSize: 13 }}>
                    <thead>
                      <tr style={{ textAlign: 'left', opacity: 0.7 }}>
                        <th>Ronda</th>
                        <th>Estado</th>
                        <th style={{ textAlign: 'right' }}>Bote</th>
                        <th>Abierta</th>
                        <th>Cerrada</th>
                      </tr>
                    </thead>
                    <tbody>
                      {codeRounds.map((r) => (
                        <tr key={r.id}>
                          <td>#{r.round_number}</td>
                          <td>
                            {r.status === 'open' ? '🟢 abierta'
                              : r.status === 'finished' ? '✅ repartida'
                              : '🚫 cancelada'}
                          </td>
                          <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                            {r.prize_pool_gems} 💎
                          </td>
                          <td>{new Date(r.created_at).toLocaleDateString()}</td>
                          <td>{r.finished_at ? new Date(r.finished_at).toLocaleDateString() : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )
        })()}

        {/* TAB 1: TOURNAMENTS */}
        {activeTab === 'tournaments' && (
          <div className="admin-content-section">
            <div className="admin-grid-2col">
              {/* CREATE FORM */}
              <div className="admin-card">
                <h3>➕ Crear Nuevo Torneo</h3>
                <div className="admin-form-group">
                  <label>Título del Torneo:</label>
                  <input
                    type="text"
                    placeholder="ej: Copa Verano 2026"
                    value={tourneyTitle}
                    onChange={(e) => setTourneyTitle(e.target.value)}
                  />
                </div>

                <div className="admin-form-row">
                  <div className="admin-form-group">
                    <label>Tipo de Entrada:</label>
                    <select
                      value={tourneyType}
                      onChange={(e) => setTourneyType(e.target.value as any)}
                    >
                      <option value="free_code">Gratis (Con Código)</option>
                      <option value="paid">De Pago (Gemas 💎)</option>
                    </select>
                  </div>

                  {tourneyType === 'free_code' ? (
                    <div className="admin-form-group">
                      <label>Código de Acceso:</label>
                      <input
                        type="text"
                        value={tourneyCode}
                        onChange={(e) => setTourneyCode(e.target.value.toUpperCase())}
                      />
                    </div>
                  ) : (
                    <div className="admin-form-group">
                      <label>Costo de Entrada (Gemas):</label>
                      <input
                        type="number"
                        min="0.5"
                        step="0.5"
                        value={tourneyEntryGems}
                        onChange={(e) => setTourneyEntryGems(Number(e.target.value))}
                      />
                    </div>
                  )}
                </div>

                <div className="admin-form-row">
                  <div className="admin-form-group">
                    <label>Inicia en (Minutos):</label>
                    <input
                      type="number"
                      min="1"
                      value={tourneyStartsInMins}
                      onChange={(e) => setTourneyStartsInMins(Number(e.target.value))}
                    />
                  </div>

                  <div className="admin-form-group">
                    <label>Duración (Minutos):</label>
                    <input
                      type="number"
                      min="10"
                      value={tourneyDurationMins}
                      onChange={(e) => setTourneyDurationMins(Number(e.target.value))}
                    />
                  </div>
                </div>

                <button
                  type="button"
                  className="admin-submit-btn"
                  onClick={handleCreateTournament}
                  disabled={isLoading}
                >
                  🚀 PUBLICAR TORNEO EN SUPABASE
                </button>
              </div>

              {/* LIST OF ACTIVE TOURNAMENTS */}
              <div className="admin-card">
                <h3>📋 Torneos en Base de Datos</h3>
                <div className="admin-tourney-list">
                  {tournaments.length === 0 ? (
                    <p className="admin-empty-text">No hay torneos registrados en Supabase.</p>
                  ) : (
                    tournaments.map((t) => (
                      <div key={t.id} className="admin-tourney-item">
                        <div className="admin-tourney-item__info">
                          <strong>{t.title}</strong>
                          <small>
                            Tipo: {t.type === 'free_code' ? `Código: ${t.access_code}` : `${t.entry_cost_gems} Gemas`} | Estado: <span className={`status-${t.status}`}>{t.status.toUpperCase()}</span>
                          </small>
                        </div>
                        <div className="admin-tourney-item__actions">
                          {t.status === 'scheduled' && (
                            <button
                              type="button"
                              className="admin-action-btn--green"
                              onClick={() => handleUpdateTournamentStatus(t.id, 'live')}
                            >
                              🔴 Forzar En Vivo
                            </button>
                          )}
                          {t.status === 'live' && (
                            <button
                              type="button"
                              className="admin-action-btn--red"
                              onClick={() => handleUpdateTournamentStatus(t.id, 'finished')}
                            >
                              🏁 Finalizar
                            </button>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: SEASONS & PRIZES */}
        {activeTab === 'seasons' && (
          <div className="admin-content-section">
            <div className="admin-card">
              <h3>🏆 Configuración de Temporada y Premios Oficiales</h3>
              <p className="admin-card-desc">
                Define las fechas de apertura/cierre y las recompensas oficiales que se mostrarán en la tabla de clasificación.
              </p>

              <div className="admin-form-row">
                <div className="admin-form-group">
                  <label>Número de Temporada:</label>
                  <input
                    type="number"
                    min="1"
                    value={seasonNumber}
                    onChange={(e) => setSeasonNumber(Number(e.target.value))}
                  />
                </div>
                <div className="admin-form-group" style={{ flex: 2 }}>
                  <label>Nombre de la Temporada:</label>
                  <input
                    type="text"
                    value={seasonName}
                    onChange={(e) => setSeasonName(e.target.value)}
                  />
                </div>
                <div className="admin-form-group">
                  <label>Duración (Días):</label>
                  <input
                    type="number"
                    min="1"
                    value={seasonDurationDays}
                    onChange={(e) => setSeasonDurationDays(Number(e.target.value))}
                  />
                </div>
              </div>

              <div className="admin-rewards-grid">
                <div className="admin-reward-box">
                  <h4>🎖️ Premios del Ranking ELO (Copas)</h4>
                  <div className="admin-reward-row">
                    <span>🥇 Top 1 ELO:</span>
                    <input
                      type="number"
                      value={top1EloReward}
                      onChange={(e) => setTop1EloReward(Number(e.target.value))}
                    />
                    <strong>Gemas 💎</strong>
                  </div>
                  <div className="admin-reward-row">
                    <span>🥈 Top 2 ELO:</span>
                    <input
                      type="number"
                      value={top2EloReward}
                      onChange={(e) => setTop2EloReward(Number(e.target.value))}
                    />
                    <strong>Gemas 💎</strong>
                  </div>
                  <div className="admin-reward-row">
                    <span>🥉 Top 3 ELO:</span>
                    <input
                      type="number"
                      value={top3EloReward}
                      onChange={(e) => setTop3EloReward(Number(e.target.value))}
                    />
                    <strong>Gemas 💎</strong>
                  </div>
                </div>

                <div className="admin-reward-box">
                  <h4>🏛️ Premios del Coliseo (Racha Máxima)</h4>
                  <div className="admin-reward-row">
                    <span>🥇 Top 1 Coliseo:</span>
                    <input
                      type="number"
                      value={top1ColoReward}
                      onChange={(e) => setTop1ColoReward(Number(e.target.value))}
                    />
                    <strong>Gemas 💎</strong>
                  </div>
                  <div className="admin-reward-row">
                    <span>🥈 Top 2 Coliseo:</span>
                    <input
                      type="number"
                      value={top2ColoReward}
                      onChange={(e) => setTop2ColoReward(Number(e.target.value))}
                    />
                    <strong>Gemas 💎</strong>
                  </div>
                  <div className="admin-reward-row">
                    <span>🥉 Top 3 Coliseo:</span>
                    <input
                      type="number"
                      value={top3ColoReward}
                      onChange={(e) => setTop3ColoReward(Number(e.target.value))}
                    />
                    <strong>Gemas 💎</strong>
                  </div>
                </div>
              </div>

              <button
                type="button"
                className="admin-submit-btn"
                onClick={handleSaveSeason}
                disabled={isLoading}
                style={{ marginTop: 16 }}
              >
                💾 GUARDAR TEMPORADA Y PREMIOS EN SUPABASE
              </button>

              <div style={{ marginTop: 24, padding: 14, background: 'rgba(239, 68, 68, 0.12)', border: '1.5px solid rgba(239, 68, 68, 0.4)', borderRadius: 8 }}>
                <h4 style={{ margin: '0 0 8px 0', color: '#f87171', fontSize: '13px' }}>
                  🏆 Zona de Cierre y Acreditación de Premios Oficiales ($100 USD / 10,000 💎)
                </h4>
                <p style={{ fontSize: 11.5, margin: '0 0 12px 0', opacity: 0.9, lineHeight: 1.4 }}>
                  Acredita de forma autoritativa el 100% del pozo de 10,000 Gemas ($100 USD) + sobres a los ganadores del Ranking ELO: Top 1 (4k 💎 + Pack Legendario), Top 2 (2.5k 💎 + Pack Épico), Top 3 (1.5k 💎 + 2 Packs Comunes), Top 4 (1.2k 💎 + 2k Oro), Top 5 (800 💎 + 1k Oro), y oro a Top 6-20.
                </p>
                <button
                  type="button"
                  className="admin-submit-btn"
                  onClick={handleSettleSeason}
                  disabled={isLoading}
                  style={{ background: 'linear-gradient(135deg, #dc2626 0%, #b91c1c 100%)', color: '#fff', fontWeight: 800 }}
                >
                  {isLoading ? '⏳ Procesando...' : '👑 FINALIZAR TEMPORADA Y ACREDITAR RECOMPENSAS'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: PLAYERS & ECONOMY */}
        {activeTab === 'players' && (
          <div className="admin-content-section">
            <div className="admin-card">
              <h3>👥 Gestión de Jugadores y Saldo</h3>
              <div className="admin-search-row">
                <input
                  type="text"
                  placeholder="Buscar jugador por username..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>

              <div className="admin-players-table">
                <div className="admin-table-row admin-table-row--head">
                  <span>Username</span>
                  <span>Copas ELO</span>
                  <span>Gemas 💎</span>
                  <span>Oro 💰</span>
                  <span>Acción</span>
                </div>
                {players
                  .filter((p) => p.username.toLowerCase().includes(searchQuery.toLowerCase()))
                  .map((p) => (
                    <div key={p.id} className="admin-table-row">
                      <span><strong>{p.username}</strong></span>
                      <span>{p.elo_rating} 🏆</span>
                      <span style={{ color: '#c084fc' }}>{p.gems_balance} 💎</span>
                      <span style={{ color: '#fbbf24' }}>{p.gold_balance} 💰</span>
                      <span>
                        <button
                          type="button"
                          className="admin-edit-player-btn"
                          onClick={() => setSelectedPlayer(p)}
                        >
                          Ajustar Saldo
                        </button>
                      </span>
                    </div>
                  ))}
              </div>

              {selectedPlayer && (
                <div className="admin-adjust-box">
                  <h4>Ajustar saldo para: <strong>{selectedPlayer.username}</strong></h4>
                  <div className="admin-adjust-grid">
                    <div className="admin-form-group">
                      <label>Sumar/Restar Gemas 💎:</label>
                      <input
                        type="number"
                        value={adjustGems}
                        onChange={(e) => setAdjustGems(Number(e.target.value))}
                      />
                    </div>
                    <div className="admin-form-group">
                      <label>Sumar/Restar Oro 💰:</label>
                      <input
                        type="number"
                        value={adjustGold}
                        onChange={(e) => setAdjustGold(Number(e.target.value))}
                      />
                    </div>
                    <div className="admin-form-group">
                      <label>Sumar/Restar Copas ELO:</label>
                      <input
                        type="number"
                        value={adjustElo}
                        onChange={(e) => setAdjustElo(Number(e.target.value))}
                      />
                    </div>
                  </div>
                  <div className="admin-adjust-actions">
                    <button
                      type="button"
                      className="admin-cancel-btn"
                      onClick={() => setSelectedPlayer(null)}
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      className="admin-submit-btn"
                      onClick={handleSavePlayerChanges}
                    >
                      Guardar Cambios en Supabase
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB: PREMIOS, RULETA Y TIENDA (SQL 09) */}
        {activeTab === 'rewards' && (() => {
          const totalWeight = Number(
            lotterySectors
              .filter((s) => s.is_active)
              .reduce((sum, s) => sum + (Number(s.weight) || 0), 0)
              .toFixed(2)
          )
          const isWeight100 = Math.abs(totalWeight - 100) < 0.001

          return (
            <div className="admin-content-section">
              {/* RULETA DE PREMIOS */}
              <div className="admin-card">
                <h3>🎡 Ruleta de Premios (`lottery_sectors`)</h3>
                <p className="admin-card-desc">
                  Configura los premios y probabilidades de la ruleta diaria. El servidor valida mediante un disparador (trigger) que la suma de pesos de los sectores activos sea <strong>exactamente 100%</strong>.
                </p>

                <div className="admin-lottery-summary">
                  <div>
                    Sectores activos: <strong>{lotterySectors.filter((s) => s.is_active).length} / {lotterySectors.length}</strong>
                  </div>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <button
                      type="button"
                      className="admin-add-sector-btn"
                      onClick={handleAddTryAgainSector}
                    >
                      ➕ Añadir Sector "Sigue Intentando"
                    </button>
                    <div className={`admin-weight-badge ${isWeight100 ? 'admin-weight-badge--ok' : 'admin-weight-badge--warn'}`}>
                      {isWeight100 ? `✅ Suma de pesos: ${totalWeight}% (Correcto)` : `⚠️ Suma de pesos: ${totalWeight}% (Debe sumar 100%)`}
                    </div>
                  </div>
                </div>

                <div className="admin-lottery-table">
                  <div className="admin-lottery-row admin-lottery-row--head">
                    <span>Sector / Nombre</span>
                    <span>Tipo</span>
                    <span>Cantidad / Premio</span>
                    <span>Peso (%)</span>
                    <span>Activo</span>
                  </div>
                  {lotterySectors.map((sec) => (
                    <div key={sec.sector_id} className="admin-lottery-row">
                      <div>
                        <input
                          type="text"
                          value={sec.label || ''}
                          onChange={(e) => handleLotteryFieldChange(sec.sector_id, 'label', e.target.value)}
                          placeholder="Nombre / Etiqueta"
                          style={{
                            fontWeight: 700,
                            fontSize: '0.82rem',
                            color: '#e2e8f0',
                            background: '#0f172a',
                            border: '1px solid #334155',
                            borderRadius: '4px',
                            padding: '4px 6px',
                            width: '100%',
                            boxSizing: 'border-box',
                          }}
                        />
                        <div style={{ fontSize: '0.70rem', color: '#94a3b8', marginTop: '2px' }}>{sec.sector_id}</div>
                      </div>
                      <div>
                        <span style={{ textTransform: 'uppercase', fontWeight: 700, fontSize: '0.75rem', color: '#c7d2fe' }}>
                          {sec.reward_type === 'none' ? 'SIN PREMIO' : sec.reward_type}
                        </span>
                      </div>
                      <div>
                        {sec.reward_type === 'none' && (
                          <span style={{ fontSize: '0.78rem', color: '#94a3b8' }}>Sigue Intentando 💨</span>
                        )}
                        {sec.reward_type === 'gems' && (
                          <input
                            type="number"
                            min="1"
                            value={sec.gems_amount ?? 0}
                            onChange={(e) => handleLotteryFieldChange(sec.sector_id, 'gems_amount', Number(e.target.value))}
                            placeholder="Gemas 💎"
                          />
                        )}
                        {sec.reward_type === 'gold' && (
                          <input
                            type="number"
                            min="1"
                            value={sec.gold_amount ?? 0}
                            onChange={(e) => handleLotteryFieldChange(sec.sector_id, 'gold_amount', Number(e.target.value))}
                            placeholder="Oro 💰"
                          />
                        )}
                        {sec.reward_type === 'pack' && (
                          <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                            <span style={{ fontSize: '0.75rem', color: '#e2e8f0' }}>{sec.pack_id || 'Sobre'}</span>
                            <input
                              type="number"
                              min="1"
                              style={{ width: '60px' }}
                              value={sec.pack_qty ?? 1}
                              onChange={(e) => handleLotteryFieldChange(sec.sector_id, 'pack_qty', Number(e.target.value))}
                            />
                          </div>
                        )}
                        {sec.reward_type === 'plant' && (
                          <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                            <span style={{ fontSize: '0.75rem', color: '#e2e8f0' }}>{sec.plant_id || 'Planta'}</span>
                            <input
                              type="number"
                              min="1"
                              style={{ width: '60px' }}
                              value={sec.plant_qty ?? 1}
                              onChange={(e) => handleLotteryFieldChange(sec.sector_id, 'plant_qty', Number(e.target.value))}
                            />
                          </div>
                        )}
                      </div>
                      <div>
                        <input
                          type="number"
                          step="0.1"
                          min="0.1"
                          max="100"
                          value={sec.weight}
                          onChange={(e) => handleLotteryFieldChange(sec.sector_id, 'weight', Number(e.target.value))}
                        />
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          checked={Boolean(sec.is_active)}
                          onChange={(e) => handleLotteryFieldChange(sec.sector_id, 'is_active', e.target.checked)}
                        />
                      </div>
                    </div>
                  ))}
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '8px' }}>
                  <button
                    type="button"
                    className="admin-submit-btn"
                    onClick={handleSaveLotterySectors}
                    disabled={!isWeight100 || isLoading}
                  >
                    💾 Guardar Ruleta en Supabase
                  </button>
                </div>
              </div>

              {/* PRECIOS DE SOBRES DE LA TIENDA */}
              <div className="admin-card">
                <h3>🛍️ Precios de Sobres en la Tienda (`shop_packs`)</h3>
                <p className="admin-card-desc">
                  Los cambios de precio actualizan inmediatamente el cobro en el servidor y el catálogo visual de la tienda.
                </p>

                <div className="admin-packs-grid">
                  {shopPacks.map((pack) => (
                    <div key={pack.pack_id} className="admin-pack-card">
                      <h4>📦 {pack.name || pack.pack_id}</h4>
                      <div className="admin-pack-card__detail">
                        Cartas: <strong>{pack.card_count}</strong> | ID: <code>{pack.pack_id}</code>
                      </div>
                      <div className="admin-pack-card__price-row">
                        <label style={{ fontSize: '0.8rem', color: '#cbd5e1' }}>Gemas 💎:</label>
                        <input
                          type="number"
                          min="1"
                          value={packPrices[pack.pack_id] ?? pack.price_gems}
                          onChange={(e) =>
                            setPackPrices((prev) => ({
                              ...prev,
                              [pack.pack_id]: Number(e.target.value),
                            }))
                          }
                        />
                      </div>
                      <button
                        type="button"
                        className="admin-edit-player-btn"
                        style={{ marginTop: '4px' }}
                        onClick={() => handleSavePackPrice(pack.pack_id)}
                      >
                        💾 Guardar Precio
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* PASE DE BATALLA EDITABLE */}
              {bpLevels.length > 0 && (
                <div className="admin-card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                    <div>
                      <h3>🎖️ Editor de Niveles del Pase de Batalla (`battle_pass_levels`)</h3>
                      <p className="admin-card-desc">
                        Edita las copas ELO requeridas, tipos de recompensa (Sobres, Plantas, Cartas o Insignias) y cantidades para cada nivel.
                      </p>
                    </div>
                    <button
                      type="button"
                      className="admin-submit-btn"
                      onClick={handleSaveBattlePass}
                      disabled={isLoading}
                    >
                      💾 Guardar Pase en Supabase
                    </button>
                  </div>

                  <div className="admin-bp-edit-table">
                    <div className="admin-bp-edit-row admin-bp-edit-row--head">
                      <span>Nivel</span>
                      <span>Copas ELO</span>
                      <span>Nombre Arena</span>
                      <span>Configurar Recompensa</span>
                      <span>Texto Descriptivo</span>
                    </div>
                    {bpLevels.map((lvl) => (
                      <div key={lvl.level} className="admin-bp-edit-row">
                        <div>
                          <strong>Nivel {lvl.level}</strong>
                        </div>
                        <div>
                          <input
                            type="number"
                            className="admin-bp-input"
                            value={lvl.required_elo}
                            onChange={(e) => handleBpFieldChange(lvl.level, 'required_elo', Number(e.target.value))}
                            placeholder="Copas ELO"
                          />
                        </div>
                        <div>
                          <input
                            type="text"
                            className="admin-bp-input"
                            value={lvl.arena_name}
                            onChange={(e) => handleBpFieldChange(lvl.level, 'arena_name', e.target.value)}
                            placeholder="Arena"
                          />
                        </div>
                        <div className="admin-bp-reward-group">
                          <select
                            className="admin-bp-select"
                            value={lvl.reward_type}
                            onChange={(e) => handleBpFieldChange(lvl.level, 'reward_type', e.target.value as any)}
                          >
                            <option value="pack">📦 Sobre</option>
                            <option value="copies">🌱 Copias Planta</option>
                            <option value="plant">🌿 Nueva Planta</option>
                            <option value="badge">🎖️ Insignia</option>
                          </select>

                          {lvl.reward_type === 'pack' && (
                            <>
                              <select
                                className="admin-bp-select"
                                value={lvl.pack_id || 'basic'}
                                onChange={(e) => handleBpFieldChange(lvl.level, 'pack_id', e.target.value)}
                              >
                                {AVAILABLE_PACKS.map((pk) => (
                                  <option key={pk.id} value={pk.id}>
                                    {pk.name}
                                  </option>
                                ))}
                              </select>
                              <input
                                type="number"
                                min="1"
                                className="admin-bp-input"
                                style={{ width: '55px' }}
                                value={lvl.pack_count || 1}
                                onChange={(e) => handleBpFieldChange(lvl.level, 'pack_count', Number(e.target.value))}
                              />
                            </>
                          )}

                          {(lvl.reward_type === 'copies' || lvl.reward_type === 'plant') && (
                            <>
                              <select
                                className="admin-bp-select"
                                value={lvl.plant_id || 'sunflower'}
                                onChange={(e) => handleBpFieldChange(lvl.level, 'plant_id', e.target.value)}
                              >
                                {AVAILABLE_PLANTS.map((pl) => (
                                  <option key={pl.id} value={pl.id}>
                                    {pl.name}
                                  </option>
                                ))}
                              </select>
                              <input
                                type="number"
                                min="1"
                                className="admin-bp-input"
                                style={{ width: '55px' }}
                                value={lvl.copies_count || 1}
                                onChange={(e) => handleBpFieldChange(lvl.level, 'copies_count', Number(e.target.value))}
                              />
                            </>
                          )}
                        </div>
                        <div>
                          <input
                            type="text"
                            className="admin-bp-input"
                            value={lvl.label || ''}
                            onChange={(e) => handleBpFieldChange(lvl.level, 'label', e.target.value)}
                            placeholder="Etiqueta / Nombre"
                          />
                        </div>
                      </div>
                    ))}
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '10px' }}>
                    <button
                      type="button"
                      className="admin-submit-btn"
                      onClick={handleSaveBattlePass}
                      disabled={isLoading}
                    >
                      💾 Guardar Todos los Niveles del Pase en Supabase
                    </button>
                  </div>
                </div>
              )}
            </div>
          )
        })()}
      </div>
    </div>
  )
}
