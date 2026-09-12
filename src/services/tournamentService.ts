import { supabase, isSupabaseConfigured } from '../lib/supabaseClient'
import type {
  PlantId,
  TournamentModel,
  TournamentDetailsResponse,
  CreateTournamentInput,
} from '../types/game'

const memoryTournaments: Map<string, TournamentModel> = new Map()
const memoryParticipants: Map<string, any> = new Map()

export const tournamentService = {
  /**
   * Obtiene la lista de torneos disponibles, activos y finalizados.
   */
  async listTournaments(): Promise<TournamentModel[]> {
    if (!isSupabaseConfigured()) {
      return this._getLocalTournaments()
    }

    try {
      const { data, error } = await (supabase.rpc as any)('get_tournaments_list')
      if (!error && Array.isArray(data)) {
        return data as TournamentModel[]
      }
      if (error) {
        console.warn('tournamentService.listTournaments RPC error:', error.message)
      }
    } catch (err: any) {
      console.warn('tournamentService.listTournaments catch:', err)
    }

    return this._getSupabaseTournamentsDirect()
  },

  /**
   * Obtiene el detalle completo del torneo, la tabla de clasificación y mi participación.
   */
  async getTournamentDetails(tournamentId: string): Promise<TournamentDetailsResponse | null> {
    if (!isSupabaseConfigured()) {
      return this._getLocalTournamentDetails(tournamentId)
    }

    try {
      const { data, error } = await (supabase.rpc as any)('get_tournament_details', {
        p_tournament_id: tournamentId,
      })

      if (!error && data && typeof data === 'object' && (data as any).success !== false) {
        return data as TournamentDetailsResponse
      }

      if (error) {
        console.warn('tournamentService.getTournamentDetails RPC error:', error.message)
      }
    } catch (err: any) {
      console.warn('tournamentService.getTournamentDetails catch:', err)
    }

    // Fallback autoritativo directo a tablas de Supabase (garantiza todos los participantes reales 185+)
    return this._getSupabaseTournamentDetailsDirect(tournamentId)
  },

  /**
   * Crea un nuevo torneo con pozo de gemas, hora programada y entrada libre.
   */
  async createTournament(input: CreateTournamentInput): Promise<{
    success: boolean
    tournament_id?: string
    error?: string
  }> {
    if (!isSupabaseConfigured()) {
      return this._createLocalTournament(input)
    }

    try {
      const { data, error } = await (supabase.rpc as any)('create_tournament', {
        p_title: input.title,
        p_description: input.description || 'Torneo oficial abierto de Plant Arena.',
        p_prize_pool_gems: input.prize_pool_gems ?? 0,
        p_start_time: input.start_time || new Date().toISOString(),
        p_duration_minutes: input.duration_minutes ?? 60,
        p_prize_distribution: input.prize_distribution || { top1: 50, top2: 30, top3: 20 },
        p_entry_fee_gems: input.entry_fee_gems ?? 0,
      })

      if (error) {
        console.warn('create_tournament remote fallback:', error.message)
        return this._createLocalTournament(input)
      }

      return {
        success: Boolean(data?.success),
        tournament_id: data?.tournament_id,
      }
    } catch {
      return this._createLocalTournament(input)
    }
  },

  /**
   * Inscribe al usuario en el torneo de forma gratuita con su mazo inicial.
   */
  async registerParticipant(
    tournamentId: string,
    deck?: PlantId[]
  ): Promise<{ success: boolean; participant_id?: string; error?: string }> {
    if (!isSupabaseConfigured()) {
      return this._registerLocalParticipant(tournamentId, deck)
    }

    try {
      const { data, error } = await (supabase.rpc as any)('register_tournament_participant', {
        p_tournament_id: tournamentId,
        p_deck: deck || ['sunflower', 'peashooter', 'wallnut', 'chomper', 'repeater'],
      })

      if (error) {
        console.warn('register_tournament_participant remote fallback:', error.message)
        return this._registerLocalParticipant(tournamentId, deck)
      }

      return {
        success: Boolean(data?.success),
        participant_id: data?.participant_id,
      }
    } catch {
      return this._registerLocalParticipant(tournamentId, deck)
    }
  },

  /**
   * Actualiza el mazo de torneo (5 plantas de las 15 totalmente desbloqueadas).
   */
  async updateTournamentDeck(
    tournamentId: string,
    deck: PlantId[]
  ): Promise<{ success: boolean; error?: string }> {
    if (deck.length < 5 || deck.length > 6) {
      return { success: false, error: 'El mazo de torneo debe contener entre 5 y 6 plantas.' }
    }

    if (!isSupabaseConfigured()) {
      return this._updateLocalTournamentDeck(tournamentId, deck)
    }

    try {
      const { data, error } = await (supabase.rpc as any)('update_tournament_deck', {
        p_tournament_id: tournamentId,
        p_deck: deck,
      })

      if (error) {
        console.warn('update_tournament_deck remote fallback:', error.message)
        return this._updateLocalTournamentDeck(tournamentId, deck)
      }

      return { success: Boolean(data?.success) }
    } catch {
      return this._updateLocalTournamentDeck(tournamentId, deck)
    }
  },

  /**
   * Reporta el resultado del combate de torneo (Regla autoritativa de 3 derrotas).
   */
  async submitMatchResult(
    tournamentId: string,
    isVictory: boolean,
    opponentName: string = 'Rival de Torneo'
  ): Promise<{
    success: boolean
    wins?: number
    losses?: number
    max_losses?: number
    is_eliminated?: boolean
    error?: string
  }> {
    if (!isSupabaseConfigured()) {
      return this._submitLocalMatchResult(tournamentId, isVictory, opponentName)
    }

    try {
      const { data, error } = await (supabase.rpc as any)('submit_tournament_match_result', {
        p_tournament_id: tournamentId,
        p_result: isVictory ? 'victory' : 'defeat',
        p_opponent_name: opponentName,
      })

      if (error) {
        if (error.message.includes('PLAYER_ALREADY_ELIMINATED')) {
          return { success: false, error: 'PLAYER_ALREADY_ELIMINATED' }
        }
        console.warn('submit_tournament_match_result remote fallback:', error.message)
        return this._submitLocalMatchResult(tournamentId, isVictory, opponentName)
      }

      return {
        success: Boolean(data?.success),
        wins: data?.wins,
        losses: data?.losses,
        max_losses: data?.max_losses ?? 3,
        is_eliminated: Boolean(data?.is_eliminated),
      }
    } catch {
      return this._submitLocalMatchResult(tournamentId, isVictory, opponentName)
    }

  },

  /**
   * Reentrada al torneo: 200 gemas por 2 vidas adicionales (losses pasa a 1, eliminando el estado eliminado).
   */
  async reenterTournament(tournamentId: string): Promise<{
    success: boolean
    lives?: number
    losses?: number
    error?: string
  }> {
    if (!isSupabaseConfigured()) {
      return this._reenterLocalTournament(tournamentId)
    }

    try {
      const { data, error } = await (supabase.rpc as any)('reenter_tournament', {
        p_tournament_id: tournamentId,
      })

      if (error) {
        if (error.message.includes('INSUFFICIENT_GEMS')) {
          return { success: false, error: 'No tienes suficientes Gemas (200 💎 requeridas).' }
        }
        console.warn('reenter_tournament remote fallback:', error.message)
        return this._reenterLocalTournament(tournamentId)
      }

      return {
        success: Boolean(data?.success),
        lives: data?.lives ?? 2,
        losses: data?.losses ?? 1,
      }
    } catch {
      return this._reenterLocalTournament(tournamentId)
    }
  },

  /**
   * Liquida el torneo y reparte las gemas a los ganadores (Top 1, 2, 3).
   */
  async finalizeTournament(tournamentId: string): Promise<{
    success: boolean
    payouts?: any[]
    error?: string
  }> {
    if (!isSupabaseConfigured()) {
      return { success: true, payouts: [] }
    }

    try {
      const { data, error } = await (supabase.rpc as any)(
        'finalize_tournament_and_distribute_prizes',
        {
          p_tournament_id: tournamentId,
        }
      )

      if (error) {
        return { success: false, error: error.message }
      }

      return {
        success: Boolean(data?.success),
        payouts: data?.payouts || [],
      }
    } catch (err: any) {
      return { success: false, error: err?.message || 'Error al liquidar premios del torneo' }
    }
  },

  /**
   * Consulta autoritativa directa a la tabla tournaments en Supabase si el RPC presenta demoras.
   */
  async _getSupabaseTournamentsDirect(): Promise<TournamentModel[]> {
    try {
      const { data: tourneys, error: tErr } = await (supabase as any)
        .from('tournaments')
        .select('*')
        .order('start_time', { ascending: false })

      if (tErr || !Array.isArray(tourneys) || tourneys.length === 0) {
        return this._getLocalTournaments()
      }

      const tourneyIds = tourneys.map((t: any) => t.id)
      const { data: participants } = await (supabase as any)
        .from('tournament_participants')
        .select('tournament_id, is_eliminated')
        .in('tournament_id', tourneyIds)

      const countMap = new Map<string, { total: number; active: number }>()
      if (Array.isArray(participants)) {
        participants.forEach((p: any) => {
          const cur = countMap.get(p.tournament_id) || { total: 0, active: 0 }
          cur.total += 1
          if (!p.is_eliminated) cur.active += 1
          countMap.set(p.tournament_id, cur)
        })
      }

      return tourneys.map((t: any) => ({
        ...t,
        participants_count: countMap.get(t.id)?.total || 0,
        active_participants_count: countMap.get(t.id)?.active || 0,
      }))
    } catch {
      return this._getLocalTournaments()
    }
  },

  /**
   * Consulta autoritativa directa a tournament_participants en Supabase.
   * Garantiza cargar el 100% de los participantes reales (185+) registrados.
   */
  async _getSupabaseTournamentDetailsDirect(tournamentId: string): Promise<TournamentDetailsResponse | null> {
    try {
      const { data: tourney, error: tErr } = await (supabase as any)
        .from('tournaments')
        .select('*')
        .eq('id', tournamentId)
        .maybeSingle()

      if (tErr || !tourney) {
        console.warn('tournamentService: Torneo no encontrado en Supabase:', tErr?.message)
        return this._getLocalTournamentDetails(tournamentId)
      }

      // Obtener todos los participantes del torneo ordenados por victorias y derrotas
      const { data: participants, error: pErr } = await (supabase as any)
        .from('tournament_participants')
        .select('*')
        .eq('tournament_id', tournamentId)
        .order('wins', { ascending: false })
        .order('losses', { ascending: true })
        .order('created_at', { ascending: true })

      if (pErr) {
        console.warn('tournamentService: Error al leer tournament_participants:', pErr.message)
      }

      const list = Array.isArray(participants) ? participants : []

      // Obtener el ID del usuario autenticado si existe
      let currentUserId: string | null = null
      try {
        const { data: sessionData } = await supabase.auth.getSession()
        currentUserId = sessionData?.session?.user?.id || null
      } catch {
        // Ignorar
      }

      const leaderboard = list.map((tp: any, index: number) => ({
        rank: tp.final_rank ?? (index + 1),
        user_id: tp.user_id,
        username: tp.username || 'Gladiador',
        wins: Number(tp.wins || 0),
        losses: Number(tp.losses || 0),
        is_eliminated: Boolean(tp.is_eliminated),
        is_me: Boolean(currentUserId && tp.user_id === currentUserId),
        prize_awarded_gems: Number(tp.prize_awarded_gems || 0),
      }))

      const myPart = list.find((tp: any) => currentUserId && tp.user_id === currentUserId)

      return {
        tournament: {
          ...tourney,
          participants_count: list.length,
          active_participants_count: list.filter((p: any) => !p.is_eliminated).length,
        },
        leaderboard,
        my_participation: myPart
          ? {
              registered: true,
              deck: Array.isArray(myPart.deck) ? myPart.deck : undefined,
              wins: myPart.wins || 0,
              losses: myPart.losses || 0,
              is_eliminated: Boolean(myPart.is_eliminated),
              prize_awarded_gems: Number(myPart.prize_awarded_gems || 0),
            }
          : {
              registered: false,
            },
      }
    } catch (err: any) {
      console.warn('tournamentService._getSupabaseTournamentDetailsDirect falló:', err)
      return this._getLocalTournamentDetails(tournamentId)
    }
  },

  // ───────────────────────────────────────────────────────────────────────────
  // MÉTODOS LOCALES / OFFLINE (FALLBACK PARA DESARROLLO SIN CONEXIÓN)
  // ───────────────────────────────────────────────────────────────────────────

  _getLocalTournaments(): TournamentModel[] {
    if (memoryTournaments.size === 0) {
      const now = Date.now()
      const defaultList: TournamentModel[] = [
        {
          id: 'tourney_official_1',
          title: '🏆 Gran Copa Botánica (Entrada Libre)',
          description: 'Torneo abierto oficial. Todos contra todos con eliminación a las 3 derrotas. ¡15 cartas desbloqueadas para todos!',
          creator_name: 'Plant Arena Oficial',
          prize_pool_gems: 50.0,
          prize_distribution: { top1: 50, top2: 30, top3: 20 },
          status: 'live',
          entry_fee_gems: 0,
          start_time: new Date(now - 10 * 60 * 1000).toISOString(),
          end_time: new Date(now + 50 * 60 * 1000).toISOString(),
          duration_minutes: 60,
          max_losses: 3,
          prizes_distributed: false,
          participants_count: 14,
          active_participants_count: 12,
        },
        {
          id: 'tourney_scheduled_1',
          title: '💎 Copa Diamante de Medianoche',
          description: 'Torneo programado con 100 Gemas en premios. Prepara tu mazo con anticipación.',
          creator_name: 'Organización Arena',
          prize_pool_gems: 100.0,
          prize_distribution: { top1: 50, top2: 30, top3: 20 },
          status: 'scheduled',
          entry_fee_gems: 0,
          start_time: new Date(now + 15 * 60 * 1000).toISOString(),
          end_time: new Date(now + 75 * 60 * 1000).toISOString(),
          duration_minutes: 60,
          max_losses: 3,
          prizes_distributed: false,
          participants_count: 8,
          active_participants_count: 8,
        },
      ]
      defaultList.forEach((t) => memoryTournaments.set(t.id, t))
    }

    return Array.from(memoryTournaments.values())
  },

  _getLocalTournamentDetails(tournamentId: string): TournamentDetailsResponse | null {
    this._getLocalTournaments()
    let tourn = memoryTournaments.get(tournamentId) || Array.from(memoryTournaments.values()).find((t) => t.id === tournamentId)
    if (!tourn) {
      tourn = {
        id: tournamentId,
        title: 'Torneo ' + tournamentId,
        creator_name: 'Organizador',
        prize_pool_gems: 50,
        status: 'live',
        entry_fee_gems: 0,
        start_time: new Date().toISOString(),
        end_time: new Date(Date.now() + 3600000).toISOString(),
        duration_minutes: 60,
        max_losses: 3,
        prizes_distributed: false,
      }
      memoryTournaments.set(tournamentId, tourn)
    }

    let myPart = memoryParticipants.get(tournamentId)
    if (!myPart) {
      myPart = {
        registered: false,
        deck: ['sunflower', 'peashooter', 'wallnut', 'chomper', 'repeater'],
        wins: 0,
        losses: 0,
        is_eliminated: false,
        prize_awarded_gems: 0,
      }
    }

    const leaderboard = [
      {
        rank: 1,
        user_id: 'local_user',
        username: 'Tú',
        wins: myPart.wins || 0,
        losses: myPart.losses || 0,
        is_eliminated: myPart.is_eliminated || false,
        is_me: true,
        prize_awarded_gems: 0,
      },
      {
        rank: 2,
        user_id: 'bot_2',
        username: 'ClorofilaMaster',
        wins: Math.max(0, (myPart.wins || 0) - 1),
        losses: 1,
        is_eliminated: false,
        is_me: false,
        prize_awarded_gems: 0,
      },
      {
        rank: 3,
        user_id: 'bot_3',
        username: 'PeaBlaster_99',
        wins: 1,
        losses: 2,
        is_eliminated: false,
        is_me: false,
        prize_awarded_gems: 0,
      },
      {
        rank: 4,
        user_id: 'bot_4',
        username: 'ZombieCrusher',
        wins: 0,
        losses: 3,
        is_eliminated: true,
        is_me: false,
        prize_awarded_gems: 0,
      },
    ].sort((a, b) => {
      if (b.wins !== a.wins) return b.wins - a.wins
      return a.losses - b.losses
    }).map((entry, idx) => ({ ...entry, rank: idx + 1 }))

    return {
      tournament: tourn,
      leaderboard,
      my_participation: myPart,
    }
  },

  _createLocalTournament(input: CreateTournamentInput) {
    this._getLocalTournaments()
    const now = Date.now()
    const startTime = input.start_time ? new Date(input.start_time).getTime() : now
    const duration = input.duration_minutes || 60
    const endTime = startTime + duration * 60 * 1000

    let status: 'scheduled' | 'live' | 'ended' = 'scheduled'
    if (now >= startTime && now < endTime) status = 'live'
    else if (now >= endTime) status = 'ended'

    const newTourn: TournamentModel = {
      id: `local_tourney_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      title: input.title.trim(),
      description: input.description || 'Torneo creado en Plant Arena.',
      creator_name: 'Organizador Local',
      prize_pool_gems: input.prize_pool_gems || 0,
      prize_distribution: input.prize_distribution || { top1: 50, top2: 30, top3: 20 },
      status,
      entry_fee_gems: input.entry_fee_gems || 0,
      start_time: new Date(startTime).toISOString(),
      end_time: new Date(endTime).toISOString(),
      duration_minutes: duration,
      max_losses: 3,
      prizes_distributed: false,
      participants_count: 1,
      active_participants_count: 1,
    }

    memoryTournaments.set(newTourn.id, newTourn)
    return { success: true, tournament_id: newTourn.id }
  },

  _registerLocalParticipant(tournamentId: string, deck?: PlantId[]) {
    const part = {
      registered: true,
      deck: deck || ['sunflower', 'peashooter', 'wallnut', 'chomper', 'repeater'],
      wins: 0,
      losses: 0,
      is_eliminated: false,
      prize_awarded_gems: 0,
    }
    memoryParticipants.set(tournamentId, part)
    return { success: true, participant_id: `part_${Date.now()}` }
  },

  _updateLocalTournamentDeck(tournamentId: string, deck: PlantId[]) {
    let part = memoryParticipants.get(tournamentId)
    if (!part) {
      part = {
        registered: true,
        wins: 0,
        losses: 0,
        is_eliminated: false,
        prize_awarded_gems: 0,
      }
    }
    part.deck = deck
    memoryParticipants.set(tournamentId, part)
    return { success: true }
  },

  _submitLocalMatchResult(tournamentId: string, isVictory: boolean, _opponentName: string) {
    let part = memoryParticipants.get(tournamentId)
    if (!part) {
      part = {
        registered: true,
        deck: ['sunflower', 'peashooter', 'wallnut', 'chomper', 'repeater'],
        wins: 0,
        losses: 0,
        is_eliminated: false,
        prize_awarded_gems: 0,
      }
    }

    if (part.is_eliminated || part.losses >= 3) {
      return { success: false, error: 'PLAYER_ALREADY_ELIMINATED' }
    }

    if (isVictory) {
      part.wins = (part.wins || 0) + 1
    } else {
      part.losses = (part.losses || 0) + 1
      if (part.losses >= 3) {
        part.is_eliminated = true
      }
    }

    memoryParticipants.set(tournamentId, part)

    return {
      success: true,
      wins: part.wins,
      losses: part.losses,
      max_losses: 3,
      is_eliminated: part.is_eliminated,
    }
  },

  _reenterLocalTournament(tournamentId: string) {
    const part = memoryParticipants.get(tournamentId)
    if (!part) {
      return { success: false, error: 'No estás registrado en este torneo' }
    }
    part.is_eliminated = false
    part.losses = 1 // 2 vidas restantes (3 - 2 = 1 derrota)
    memoryParticipants.set(tournamentId, part)

    return { success: true, lives: 2, losses: 1 }
  },
}
