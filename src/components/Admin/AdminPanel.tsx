import { useState, useEffect } from 'react'
import { supabase, isSupabaseConfigured } from '../../lib/supabaseClient'
import { soundManager } from '../../utils/audioManager'
import { SupabaseService } from '../../services/supabaseService'
import type { Database } from '../../types/database.types'
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
  const [activeTab, setActiveTab] = useState<'tournaments' | 'seasons' | 'players' | 'rewards' | 'code'>('tournaments')

  // ── Minijuego del código secreto ──────────────────────────────────────────
  // El secreto lo genera el servidor y no vuelve en ninguna respuesta, así que
  // el panel muestra la ronda pero nunca la solución: quien la abre también
  // puede jugar sin ventaja.
  const [codeRounds, setCodeRounds] = useState<CodeRoundRow[]>([])
  const [codeBoard, setCodeBoard] = useState<CodeBoardEntry[]>([])
  const [codePrizePool, setCodePrizePool] = useState(20)
  const [codePrize1, setCodePrize1] = useState(10)
  const [codePrize2, setCodePrize2] = useState(6)
  const [codePrize3, setCodePrize3] = useState(4)
  const [codeFreeAttempts, setCodeFreeAttempts] = useState(3)
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
  const [top1EloReward, setTop1EloReward] = useState(100)
  const [top2EloReward, setTop2EloReward] = useState(50)
  const [top3EloReward, setTop3EloReward] = useState(25)
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
  //
  // Se piden columnas explícitas y NO select('*'): la columna `secret` tiene el
  // SELECT revocado, así que un '*' devolvería 401. Es intencional — el panel no
  // debe poder ver la solución.
  const CODE_ROUND_COLUMNS =
    'id, round_number, status, free_attempts, prize_pool_gems, prize_1st, prize_2nd, prize_3rd, winner_id, created_at, finished_at'

  const loadCodeRounds = async () => {
    const { data, error } = await (supabase.from('secret_code_rounds') as any)
      .select(CODE_ROUND_COLUMNS)
      .order('round_number', { ascending: false })
      .limit(15)

    if (error) {
      console.error('[AdminPanel] rondas del código:', error.message)
      return
    }
    const rows = (data || []) as CodeRoundRow[]
    setCodeRounds(rows)

    // Clasificación de la ronda más reciente
    const board = await SupabaseService.secretCodeLeaderboard()
    setCodeBoard(
      board.map((b) => ({
        userId: b.userId,
        username: b.username,
        bestPct: b.bestPct,
        attempts: b.attempts,
        place: b.place,
      }))
    )
  }

  const handleOpenCodeRound = async () => {
    if (codePrize1 + codePrize2 + codePrize3 > codePrizePool) {
      showNotice(
        `⚠️ Los premios (${codePrize1} + ${codePrize2} + ${codePrize3} = ${codePrize1 + codePrize2 + codePrize3}) superan el bote de ${codePrizePool}.`
      )
      return
    }
    setIsLoading(true)
    const res = await SupabaseService.adminOpenSecretCodeRound({
      prizePool: codePrizePool,
      prize1st: codePrize1,
      prize2nd: codePrize2,
      prize3rd: codePrize3,
      freeAttempts: codeFreeAttempts,
    })
    setIsLoading(false)

    if (!res.success) {
      showNotice(`⚠️ ${res.error || 'No se pudo abrir la ronda.'}`)
      return
    }
    soundManager.playSound('victory', 0.8)
    showNotice(`🔐 Ronda #${res.roundNumber} abierta. El código lo generó el servidor: nadie lo conoce.`)
    await loadCodeRounds()
  }

  const handleCloseCodeRound = async (settle: boolean) => {
    setIsLoading(true)
    const res = await SupabaseService.adminCloseSecretCodeRound(settle)
    setIsLoading(false)

    if (!res.success) {
      showNotice(`⚠️ ${res.error || 'No se pudo cerrar la ronda.'}`)
      return
    }
    showNotice(
      settle
        ? `✅ Ronda #${res.roundNumber} cerrada y bote repartido.`
        : `🚫 Ronda #${res.roundNumber} cancelada sin reparto.`
    )
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
        SupabaseService.adminGetLotterySectors(),
        SupabaseService.adminGetShopPacks(),
        SupabaseService.adminGetBattlePassLevels(),
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
      prev.map((s) => (s.sector_id === sectorId ? { ...s, [field]: value } : s))
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
      weight: Number(s.weight),
      isActive: Boolean(s.is_active),
      gemsAmount: s.reward_type === 'gems' ? Number(s.gems_amount) || 0 : null,
      goldAmount: s.reward_type === 'gold' ? Number(s.gold_amount) || 0 : null,
      packQty: s.reward_type === 'pack' ? Number(s.pack_qty) || 1 : null,
      plantQty: s.reward_type === 'plant' ? Number(s.plant_qty) || 1 : null,
    }))

    const res = await SupabaseService.adminSaveLotterySectors(payload)
    setIsLoading(false)

    if (res.success) {
      soundManager.playSound('victory', 0.8)
      showNotice('✅ Ruleta de premios guardada en Supabase (pesos verificados: 100%).')
      const updated = await SupabaseService.adminGetLotterySectors()
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
    const res = await SupabaseService.adminSetPackPrice(packId, price)
    setIsLoading(false)

    if (res.success) {
      soundManager.playSound('victory', 0.8)
      showNotice(`✅ Precio de sobre "${packId}" actualizado a ${price} 💎 en la tienda.`)
      const updated = await SupabaseService.adminGetShopPacks()
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
    const res = await SupabaseService.adminSaveBattlePassLevels(bpLevels)
    setIsLoading(false)

    if (res.success) {
      soundManager.playSound('victory', 0.8)
      showNotice(`✅ ${bpLevels.length} niveles del Pase de Batalla guardados en Supabase.`)
      const updated = await SupabaseService.adminGetBattlePassLevels()
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
            onClick={() => setActiveTab('code')}
          >
            🔐 Código Secreto ({codeRounds.filter((r) => r.status === 'open').length > 0 ? 'ronda activa' : 'sin ronda'})
          </button>
        </div>

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
                        <label>Bote:</label>
                        <strong>{activa.prize_pool_gems} 💎</strong>
                      </div>
                      <div className="admin-form-group">
                        <label>Premios (1.º / 2.º / 3.º):</label>
                        <strong>
                          {activa.prize_1st} / {activa.prize_2nd} / {activa.prize_3rd} 💎
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

                      <p style={{ fontSize: 12, opacity: 0.8, lineHeight: 1.5 }}>
                        La ronda se cierra sola cuando alguien acierte los 4 (100%).
                        Ciérrala a mano sólo si quieres repartir antes de que nadie
                        lo consiga, o cancelarla.
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
                            onChange={(e) => setCodePrizePool(Number(e.target.value))}
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
                      </div>

                      <div className="admin-form-row">
                        <div className="admin-form-group">
                          <label>1.º puesto:</label>
                          <input
                            type="number" min={0} step="0.01" value={codePrize1}
                            onChange={(e) => setCodePrize1(Number(e.target.value))}
                          />
                        </div>
                        <div className="admin-form-group">
                          <label>2.º puesto:</label>
                          <input
                            type="number" min={0} step="0.01" value={codePrize2}
                            onChange={(e) => setCodePrize2(Number(e.target.value))}
                          />
                        </div>
                        <div className="admin-form-group">
                          <label>3.º puesto:</label>
                          <input
                            type="number" min={0} step="0.01" value={codePrize3}
                            onChange={(e) => setCodePrize3(Number(e.target.value))}
                          />
                        </div>
                      </div>

                      <p style={{ fontSize: 12, opacity: 0.8, lineHeight: 1.5 }}>
                        Suma de premios: <strong>{codePrize1 + codePrize2 + codePrize3} 💎</strong> de{' '}
                        {codePrizePool} 💎.
                        {codePrize1 + codePrize2 + codePrize3 > codePrizePool && (
                          <span style={{ color: '#f87171' }}> ⚠️ Se pasa del bote.</span>
                        )}
                        <br />
                        En caso de empate, el importe del puesto se divide entre los
                        empatados: 2.º entre dos → {(codePrize2 / 2).toFixed(2)} 💎 cada uno.
                      </p>

                      <button
                        type="button"
                        className="admin-tab-btn admin-tab-btn--active"
                        disabled={isLoading}
                        onClick={handleOpenCodeRound}
                      >
                        🔐 Abrir ronda y generar código
                      </button>
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
                        </tr>
                      </thead>
                      <tbody>
                        {codeBoard.map((e) => (
                          <tr key={e.userId}>
                            <td>{e.place}</td>
                            <td>{e.username}</td>
                            <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                              {Number(e.bestPct).toFixed(1)}%
                            </td>
                            <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                              {e.attempts}
                            </td>
                          </tr>
                        ))}
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
                  <span>Oro 🪙</span>
                  <span>Acción</span>
                </div>
                {players
                  .filter((p) => p.username.toLowerCase().includes(searchQuery.toLowerCase()))
                  .map((p) => (
                    <div key={p.id} className="admin-table-row">
                      <span><strong>{p.username}</strong></span>
                      <span>{p.elo_rating} 🏆</span>
                      <span style={{ color: '#c084fc' }}>{p.gems_balance} 💎</span>
                      <span style={{ color: '#fbbf24' }}>{p.gold_balance} 🪙</span>
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
                      <label>Sumar/Restar Oro 🪙:</label>
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
                        <strong>{sec.label || sec.sector_id}</strong>
                        <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>{sec.sector_id}</div>
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
                            placeholder="Oro 🪙"
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
