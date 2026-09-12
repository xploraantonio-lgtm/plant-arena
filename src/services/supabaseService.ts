import { supabase, isSupabaseConfigured } from '../lib/supabaseClient'
export { isSupabaseConfigured }
import type { Database, CodeRoundPrizeTier } from '../types/database.types'
export type { CodeRoundPrizeTier }
import { type FreePackSlot, type PlayerRewardPack, normalizePackSlots } from '../utils/freePackManager'
import type { DatosDeRepeticion } from '../engine/replay'
import { parseLeaderboardRow, type ParsedLeaderboardRow } from '../utils/leaderboardParser'
import { validateMatchClock } from '../utils/matchClock'
import type { EngineVersion } from '../types/game'
import type { FarmingInventory, PvpRewardDrop } from '../utils/pvpRewardManager'
import { FLASH_OFFER_PRICE_GEMS } from '../utils/gameConstants'

type ProfileRow = Database['public']['Tables']['profiles']['Row']
type ProfileUpdate = Database['public']['Tables']['profiles']['Update']
type PlantInstanceRow = Database['public']['Tables']['plant_instances']['Row']
type PlantInstanceInsert = Database['public']['Tables']['plant_instances']['Insert']
type ClanRow = Database['public']['Tables']['clans']['Row']
type TournamentRow = Database['public']['Tables']['tournaments']['Row']
type SeasonRow = Database['public']['Tables']['seasons']['Row']
type MarketplaceRow = Database['public']['Tables']['marketplace_listings']['Row']

/** Sólo los campos que el jugador puede escribir de su propio perfil. El
 *  servidor revoca el resto a nivel de columna, así que pasar `gems_balance`
 *  aquí fallaría en silencio: mejor que no compile. */
/**
 * El panel de referidos tal como lo devuelve my_referrals().
 *
 * Se escribe aquí y no en types/database.types.ts porque ese fichero lo genera
 * Supabase y una RPC que devuelve JSONB llega sin tipo ninguno: sin esto, la
 * pantalla accedería a campos que nadie comprueba.
 */
export interface MisReferidos {
  codigo: string | null
  /**
   * Si se puede escribir un código de referido ahora mismo.
   *
   * Lo decide el servidor con la MISMA función que usa referral_bind para
   * aceptar. Si la pantalla lo decidiera por su cuenta, acabaría ofreciendo el
   * cuadro cuando ya no vale — o escondiéndolo cuando sí.
   */
  puedoUsarCodigo: boolean
  /** Por qué no se puede, cuando no se puede. Para poder explicarlo. */
  motivoNoPuedo: string | null
  /** Quién te invitó, si ya tienes referidor. */
  miReferidor: string | null
  /** Días que quedan para poder usar un código. */
  diasParaUsarCodigo: number
  amigos: Array<{
    nombre: string | null
    avatar: string | null
    copas: number
    valido: boolean
    oroCobrado: boolean
    desde: string
  }>
  total: number
  validos: number
  validosTemporada?: number
  copasNecesarias: number
  /** Oro que se puede cobrar ahora mismo (100 por cada amigo que llegó a 1100 copas). */
  oroPorCobrar: number
  amigosSinCobrar: number
  oroPorAmigo: number
  /** Gemas acumuladas por el 5% de comisión en depósitos de referidos listas para retirar. */
  gemasDepositoPorCobrar: number
  metaSobre: { objetivo: number; alcanzada: boolean; cobrada: boolean }
  metaGemas: {
    objetivo: number
    gemas: number
    alcanzada: boolean
    cobrada: boolean
    cupo?: number
    quedan?: number
  }
  temporada: { terminaEn: string; empezoEn: string; segundos: number }
  miPuesto: number | null
  totalGlobal?: number
  metaActual?: number | null
  metaSiguiente?: number | null
  premios: Array<{ puesto: number; gemas: number; oro: number; sobres: number; packType?: string; p2pPct?: number }>
  ranking: Array<{ puesto: number; nombre: string | null; avatar: string | null; validos: number }>
}

export type EditableProfileFields = Pick<ProfileUpdate, 'username' | 'avatar_id' | 'country'>
export type LeaderboardRow = Database['public']['Views']['leaderboard']['Row']

/** Las llamadas a Supabase no lanzan excepción: devuelven `{ error }`. Cuando
 *  eso se descarta, un permiso denegado o una política que rechaza es
 *  indistinguible de "no hay datos". Todo error pasa por aquí. */
/** Columnas de profiles que puede leer cualquiera, incluido un visitante sin
 *  sesión. El servidor revoca a `anon` el SELECT del resto (saldos, código de
 *  referido), así que un `select('*')` desde la landing devuelve 401. Los
 *  rankings piden sólo esto, y de paso dejan de exponer el saldo ajeno. */
const PUBLIC_PROFILE_COLUMNS =
  'id, username, avatar_id, country, elo_rating, colosseum_current_streak, colosseum_max_streak, created_at'

const LEADERBOARD_COLUMNS =
  'id, username, avatar_id, country, elo_rating, ranked_wins, ranked_losses, ranked_draws, ranked_games, ranked_win_rate, rank_position, colosseum_current_streak, colosseum_max_streak, created_at'

function logError(op: string, error: unknown): void {
  const e = error as { message?: string; code?: string; details?: string } | null
  console.error(
    `[SupabaseService] ${op} falló:`,
    e?.message ?? error,
    e?.code ? `(code ${e.code})` : '',
    e?.details ?? ''
  )
}

export const SupabaseService = {
  // ---------------------------------------------------------------------------
  // PROFILE & BALANCES
  // ---------------------------------------------------------------------------
  async getProfile(userId: string): Promise<ProfileRow | null> {
    if (!isSupabaseConfigured()) return null
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle()
      if (error) {
        console.warn('[SupabaseService] getProfile error:', error.message)
        return null
      }
      return data as ProfileRow | null
    } catch (e) {
      console.warn('[SupabaseService] getProfile exception:', e)
      return null
    }
  },

  /**
   * Actualiza el perfil propio. Sólo cosmética: el servidor revoca UPDATE en
   * todas las demás columnas, incluidas gems_balance, gold_balance, elo_rating
   * e is_admin. El ELO lo calcula el servidor al resolver la partida.
   */
  async updateProfile(userId: string, updates: EditableProfileFields): Promise<boolean> {
    if (!isSupabaseConfigured()) return false
    try {
      const { error } = await (supabase.from('profiles') as any)
        .update(updates)
        .eq('id', userId)
      if (error) {
        logError('updateProfile', error)
        return false
      }
      return true
    } catch (e) {
      logError('updateProfile', e)
      return false
    }
  },

  /**
   * Saldo propio, leído por RPC. El cliente ya no puede escribirlo, así que
   * ésta es la única forma de saber el valor autoritativo tras una compra,
   * una apuesta o una venta.
   */
  async myBalance(): Promise<{
    gems_balance: number
    locked_gems_balance?: number
    withdrawable_gems?: number
    gold_balance: number
    colosseum_tickets: number
    elo_rating: number
    has_vip_pass: boolean
    claimed_vip_levels: number[]
    colosseum_current_streak: number
    colosseum_max_streak: number
    energy_current?: number
    energy_last_reset_utc?: string
  } | null> {
    if (!isSupabaseConfigured()) return null
    try {
      const { data, error } = await (supabase.rpc as any)('my_balance')
      if (error) {
        logError('myBalance', error)
        // Fallback de resiliencia directa si la RPC falla temporalmente
        try {
          const { data: userData } = await supabase.auth.getUser()
          if (userData?.user) {
            const { data: prof } = await (supabase.from as any)('profiles')
              .select('gems_balance, locked_gems_balance, gold_balance, colosseum_tickets, elo_rating, has_vip_pass, claimed_vip_levels, colosseum_current_streak, colosseum_max_streak, energy_current, energy_last_reset_utc')
              .eq('id', userData.user.id)
              .single()
            if (prof) {
              const totalGems = Number(prof.gems_balance ?? 0)
              const lockedGems = Math.min(totalGems, Number(prof.locked_gems_balance ?? 0))
              return {
                gems_balance: totalGems,
                locked_gems_balance: lockedGems,
                withdrawable_gems: Math.max(0, totalGems - lockedGems),
                gold_balance: Number(prof.gold_balance ?? 0),
                colosseum_tickets: Number(prof.colosseum_tickets ?? 0),
                elo_rating: Number(prof.elo_rating ?? 1000),
                has_vip_pass: Boolean(prof.has_vip_pass),
                claimed_vip_levels: Array.isArray(prof.claimed_vip_levels) ? prof.claimed_vip_levels : [],
                colosseum_current_streak: Number(prof.colosseum_current_streak ?? 0),
                colosseum_max_streak: Number(prof.colosseum_max_streak ?? 0),
                energy_current: prof.energy_current ?? (prof.has_vip_pass ? 25 : 20),
                energy_last_reset_utc: prof.energy_last_reset_utc,
              }
            }
          }
        } catch {}
        return null
      }
      if (data) {
        const total = Number(data.gems_balance ?? 0)
        const locked = Math.min(total, Number(data.locked_gems_balance ?? 0))
        return {
          ...data,
          gems_balance: total,
          locked_gems_balance: locked,
          withdrawable_gems: Number(data.withdrawable_gems ?? Math.max(0, total - locked)),
        }
      }
      return data
    } catch (e) {
      logError('myBalance', e)
      return null
    }
  },

  async getPlayerEnergy(): Promise<{
    energyCurrent: number
    maxEnergy: number
    hasVip: boolean
    userElo: number
    isUnlimited: boolean
    secondsUntilReset: number
  } | null> {
    if (!isSupabaseConfigured()) return null
    try {
      const { data, error } = await (supabase.rpc as any)('get_player_energy')
      if (error) {
        logError('getPlayerEnergy', error)
        return null
      }
      return data
    } catch (e) {
      logError('getPlayerEnergy', e)
      return null
    }
  },


  async saveActiveDeck(
    instanceIds: string[]
  ): Promise<{ success: boolean; cards?: number; error?: string }> {
    if (!isSupabaseConfigured()) {
      return {
        success: false,
        error: 'Supabase no configurado',
      }
    }

    try {
      const { data, error } = await (supabase.rpc as any)(
        'save_active_deck',
        {
          p_instance_ids: instanceIds,
        }
      )

      if (error) {
        logError('saveActiveDeck', error)
        return {
          success: false,
          error: error.message,
        }
      }

      return {
        success: Boolean(data?.success),
        cards:
          typeof data?.cards === 'number'
            ? data.cards
            : undefined,
      }
    } catch (e: any) {
      logError('saveActiveDeck', e)

      return {
        success: false,
        error: e?.message ?? 'No se pudo guardar el mazo',
      }
    }
  },

  // ---------------------------------------------------------------------------
  // GLOBAL RANKING & LEADERBOARDS (REAL DATA)
  // ---------------------------------------------------------------------------
  async getGlobalLeaderboard(limit?: number): Promise<ParsedLeaderboardRow[]> {
    if (!isSupabaseConfigured()) {
      throw new Error('Supabase no está configurado')
    }
    try {
      // De la VISTA leaderboard con orden determinista rank_position y estadísticas W/L autoritativas
      let query = supabase
        .from('leaderboard')
        .select(LEADERBOARD_COLUMNS)
        .order('rank_position', { ascending: true })

      if (typeof limit === 'number' && limit > 0) {
        query = query.limit(limit)
      }

      const { data, error } = await query
      if (error) {
        logError('getGlobalLeaderboard', error)
        throw new Error(error.message || 'Error al obtener la tabla de clasificación')
      }
      if (!Array.isArray(data)) {
        throw new Error('Respuesta de clasificación inválida: no es un array')
      }
      // Validar cada fila estrictamente con parseLeaderboardRow (frontera única)
      return data.map((row) => parseLeaderboardRow(row))
    } catch (e: any) {
      logError('getGlobalLeaderboard', e)
      throw e
    }
  },

  async getUserRank(userId?: string): Promise<number | null> {
    if (!isSupabaseConfigured()) {
      throw new Error('Supabase no está configurado')
    }
    if (!userId) return null
    try {
      const { data, error } = await supabase
        .from('leaderboard')
        .select('rank_position')
        .eq('id', userId)
        .maybeSingle()

      if (error) {
        logError('getUserRank', error)
        throw new Error(error.message || 'Error al consultar la posición de ranking')
      }

      if (!data || data.rank_position === null || data.rank_position === undefined) {
        return null
      }

      const rank = typeof data.rank_position === 'number' ? data.rank_position : Number(data.rank_position)
      if (!Number.isInteger(rank) || rank <= 0) {
        throw new Error(`rank_position inválido en el servidor: ${data.rank_position}`)
      }

      return rank
    } catch (e: any) {
      logError('getUserRank', e)
      throw e
    }
  },

  async getColosseumLeaderboard(limit: number = 50): Promise<ProfileRow[]> {
    if (!isSupabaseConfigured()) return []
    try {
      const { data, error } = await supabase
        .from('leaderboard')
        .select(PUBLIC_PROFILE_COLUMNS)
        .gt('colosseum_max_streak', 0)
        .order('colosseum_max_streak', { ascending: false })
        .limit(limit)
      if (error) {
        logError('getColosseumLeaderboard', error)
        return []
      }
      return (data || []) as unknown as ProfileRow[]
    } catch (e) {
      logError('getColosseumLeaderboard', e)
      return []
    }
  },

  // ---------------------------------------------------------------------------
  // SEASONS & OFFICIAL REWARDS (REAL DATA)
  // ---------------------------------------------------------------------------
  async getActiveSeason(): Promise<SeasonRow | null> {
    if (!isSupabaseConfigured()) return null
    try {
      const { data } = await supabase
        .from('seasons')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      return data as SeasonRow | null
    } catch {
      return null
    }
  },

  // ---------------------------------------------------------------------------
  // PLANT INVENTORY & FUSIONS
  // ---------------------------------------------------------------------------
  async getUserPlants(userId: string): Promise<PlantInstanceRow[]> {
    if (!isSupabaseConfigured()) return []
    try {
      const { data, error } = await supabase
        .from('plant_instances')
        .select('*')
        .eq('owner_id', userId)
      if (error) return []
      return (data || []) as PlantInstanceRow[]
    } catch {
      return []
    }
  },

  /**
   * PENDIENTE DE FASE 2 — este método ya no puede funcionar, y es correcto que
   * no funcione.
   *
   * El cliente tenía INSERT sobre todas las columnas de plant_instances, así
   * que un jugador podía acuñarse cartas 'legendary' de 5 estrellas con
   * power_mult 99 y luego venderlas por gemas. Ese permiso está revocado.
   *
   * Las cartas deben nacer en el servidor: una RPC por origen (abrir sobre,
   * comprar en la tienda, fusionar) que cobre el coste y sortee la rareza con
   * el random de Postgres. Hasta que existan, esto devuelve null y lo avisa
   * en consola en lugar de fallar en silencio.
   */
  async insertPlantInstance(plant: PlantInstanceInsert): Promise<PlantInstanceRow | null> {
    console.warn(
      '[SupabaseService] insertPlantInstance está deshabilitado a propósito: ' +
      'las cartas deben crearse en el servidor. Pendiente de la fase 2.',
      plant
    )
    return null
  },

  // ---------------------------------------------------------------------------
  // COLOSSEUM MATCH RESOLUTION (RPC)
  // ---------------------------------------------------------------------------
  /**
   * Retiene la apuesta del coliseo, con gemas o con ticket.
   *
   * El ticket antes se descontaba sólo en el navegador con useColosseumTicket(),
   * así que el servidor no se enteraba y al recargar volvía: se jugaba gratis.
   * Ahora el servidor descuenta lo que corresponda y anota con qué se pagó, para
   * poder devolver exactamente lo mismo si no aparece rival.
   */
  async placeColosseumWager(
    betGems: number,
    useTicket: boolean
  ): Promise<{
    success: boolean
    escrowId?: string
    paidWith?: 'gems' | 'ticket'
    expiresIn?: number
    error?: string
  }> {
    if (!isSupabaseConfigured()) return { success: false, error: 'Supabase no configurado' }
    try {
      const { data, error } = await (supabase.rpc as any)('place_colosseum_wager', {
        p_bet: betGems,
        p_use_ticket: useTicket,
      })
      if (error) {
        logError('placeColosseumWager', error)
        return { success: false, error: error.message }
      }
      return {
        success: true,
        escrowId: data?.escrowId,
        paidWith: data?.paidWith,
        expiresIn: data?.expiresIn,
      }
    } catch (e: any) {
      logError('placeColosseumWager', e)
      return { success: false, error: e?.message }
    }
  },

  /**
   * Devuelve la apuesta retenida si no llegó a haber partida.
   *
   * Hay que llamarla al cancelar la búsqueda y al vencer el plazo de cuatro
   * minutos. Sin esto, las gemas se quedaban cobradas para siempre: el jugador
   * pagaba por una partida que nunca ocurrió.
   *
   * Sólo devuelve retenciones sin sala asignada. Si ya hay partida, el importe
   * está en juego y lo liquida la resolución.
   */
  async refundColosseumWager(): Promise<{
    refunded: boolean
    paidWith?: 'gems' | 'ticket'
    amount?: number
    reason?: string
  }> {
    if (!isSupabaseConfigured()) return { refunded: false, reason: 'sin_supabase' }
    try {
      const { data, error } = await (supabase.rpc as any)('refund_colosseum_wager')
      if (error) {
        logError('refundColosseumWager', error)
        return { refunded: false, reason: error.message }
      }
      return data
    } catch (e: any) {
      logError('refundColosseumWager', e)
      return { refunded: false, reason: e?.message }
    }
  },

  // ---------------------------------------------------------------------------
  // EMPAREJAMIENTO
  //
  // El cliente no manda mazo, ni semilla, ni ELO: los pone el servidor. Lo único
  // que dice es el modo y, en coliseo, cuánto apuesta y si paga con ticket.
  //
  // El flujo es: enterMatchmaking una vez, luego pollMatchmaking cada pocos
  // segundos hasta que devuelva matched. El sondeo hace de latido: si se deja de
  // llamar, el barrido del servidor saca al jugador de la cola y le devuelve la
  // entrada del coliseo.
  // ---------------------------------------------------------------------------

  /**
   * Entra a buscar partida. Devuelve `matched` en el mismo momento si ya había
   * alguien esperando.
   *
   * En coliseo cobra la entrada ANTES de encolar, para que haya una retención
   * concreta que devolver si no aparece rival. Si no hay saldo, lanza y no se
   * encola nada.
   */
  async enterMatchmaking(
    mode: 'ranked' | 'friendly' | 'colosseum' | 'tournament',
    opts: { betGems?: number; useTicket?: boolean; roomCode?: string } = {}
  ): Promise<{
    matched: boolean
    roomId?: string
    searching?: boolean
    resumed?: boolean
    message?: string
    error?: string
  }> {
    if (!isSupabaseConfigured()) return { matched: false, error: 'sin_supabase' }
    try {
      const { data, error } = await (supabase.rpc as any)('enter_matchmaking', {
        p_mode: mode,
        p_bet: opts.betGems ?? 0,
        p_use_ticket: opts.useTicket ?? false,
        p_room_code: opts.roomCode ?? null,
        p_engine_version: 'auth-v2',
      })
      if (error) {
        logError('enterMatchmaking', error)
        return { matched: false, error: error.message }
      }
      return data
    } catch (e: any) {
      logError('enterMatchmaking', e)
      return { matched: false, error: e?.message }
    }
  },

  /**
   * Sondea el estado de la búsqueda. Llamar cada 2-3 segundos.
   *
   * Hace tres cosas de golpe: refresca el latido, intenta emparejar, y en coliseo
   * comprueba el plazo. Si el plazo vence devuelve `timedOut` y ya ha devuelto la
   * entrada — el cliente no tiene que pedir la devolución por su cuenta.
   *
   * En Ranked, tras 60 s el cliente reclama un Rival Semilla (rival asíncrono).
   */
  async pollMatchmaking(): Promise<{
    matched: boolean
    roomId?: string
    searching?: boolean
    waitedSeconds?: number
    mode?: string
    timeoutSeconds?: number | null
    timedOut?: boolean
    refund?: unknown
    message?: string
    error?: string
  }> {
    if (!isSupabaseConfigured()) return { matched: false, error: 'sin_supabase' }
    try {
      const { data, error } = await (supabase.rpc as any)('poll_matchmaking')
      if (error) {
        logError('pollMatchmaking', error)
        return { matched: false, error: error.message }
      }
      return data
    } catch (e: any) {
      logError('pollMatchmaking', e)
      return { matched: false, error: e?.message }
    }
  },

  /**
   * Reclama un Rival Semilla (Async Opponent) cuando se han esperado >= 60 s en Ranked.
   * El servidor garantiza prioridad humana antes de seleccionar una Semilla.
   */
  async claimRankedAsyncOpponent(): Promise<{
    matched: boolean
    roomId?: string
    isAsyncMatch?: boolean
    error?: string
  }> {
    if (!isSupabaseConfigured()) return { matched: false, error: 'sin_supabase' }
    try {
      const { data, error } = await (supabase.rpc as any)('claim_ranked_async_opponent')
      if (error) {
        logError('claimRankedAsyncOpponent', error)
        return { matched: false, error: error.message }
      }
      return data ?? { matched: false }
    } catch (e: any) {
      logError('claimRankedAsyncOpponent', e)
      return { matched: false, error: e?.message }
    }
  },

  /**
   * Deja de buscar. En coliseo devuelve lo cobrado — gemas si se pagó con gemas,
   * un ticket si se pagó con ticket.
   */
  async cancelMatchmaking(): Promise<{ cancelled: boolean; refund?: unknown; reason?: string }> {
    if (!isSupabaseConfigured()) return { cancelled: false, reason: 'sin_supabase' }
    try {
      const { data, error } = await (supabase.rpc as any)('cancel_matchmaking')
      if (error) {
        logError('cancelMatchmaking', error)
        return { cancelled: false, reason: error.message }
      }
      return data
    } catch (e: any) {
      logError('cancelMatchmaking', e)
      return { cancelled: false, reason: e?.message }
    }
  },

  // ---------------------------------------------------------------------------
  // EL REGISTRO DE ACCIONES
  //
  // Lo que convierte dos navegadores jugando en paralelo en una partida de
  // verdad. Cada acción va con el TIC futuro en que debe ocurrir; los dos
  // clientes la aplican en ese mismo tic y las dos simulaciones convergen.
  //
  // El cliente no puede escribir en la tabla: todo pasa por submit_match_action,
  // que comprueba que la carta está en TU mazo (el que guardó el servidor, no el
  // que diga el navegador), que el tic no está en el pasado, y que la partida no
  // está liquidada.
  // ---------------------------------------------------------------------------

  /**
   * Registra una acción propia.
   *
   * `seq` es tu número de orden en esta partida, empezando en 1. Sirve para que un
   * reintento de red no duplique la acción: el servidor la ignora si ya la tiene.
   */
  async submitMatchAction(
    roomId: string,
    accion: {
      seq: number
      tick: number
      issuedTick: number
      kind: 'plant' | 'dig' | 'collect'
      plantId?: string | null
      lane?: number | null
      col?: number | null
      slot?: number | null
      targetId?: string | null
    }
  ): Promise<{ ok?: boolean; duplicate?: boolean; serverTick?: number; error?: string }> {
    if (!isSupabaseConfigured()) return { error: 'sin_supabase' }

    const payload = {
      p_room_id: roomId,
      p_seq: accion.seq,
      p_tick: accion.tick,
      p_kind: accion.kind,
      p_plant: accion.plantId ?? null,
      p_lane: accion.lane ?? null,
      p_col: accion.col ?? null,
      p_slot: accion.slot ?? null,
      p_issued_tick: accion.issuedTick,
      p_target_id: accion.targetId ?? null,
    }

    // La RPC es idempotente por (room,user,seq), así que el MISMO payload puede
    // reintentarse si la respuesta se perdió sin duplicar la jugada.
    let ultimoError: any = null
    for (let intento = 0; intento < 3; intento += 1) {
      try {
        const { data, error } = await (supabase.rpc as any)('submit_match_action', payload)
        if (!error) return data
        ultimoError = error

        // P0001 normalmente es RAISE EXCEPTION de nuestras validaciones: repetirlo
        // no lo va a convertir en una jugada válida.
        if (error.code === 'P0001') break
      } catch (e) {
        ultimoError = e
      }

      if (intento < 2) {
        await new Promise((resolve) => setTimeout(resolve, 180 * (intento + 1)))
      }
    }

    logError('submitMatchAction', ultimoError)
    return { error: ultimoError?.message ?? 'No se pudo registrar la acción' }
  },

  /**
   * Todas las acciones de la partida a partir de un identificador.
   *
   * El camino normal es Realtime, que las entrega al instante. Esto es la red de
   * seguridad: al reconectar, o si se perdió un mensaje, se recupera lo que falte.
   * Sin esto, una acción perdida dejaría las dos partidas divergentes para siempre.
   */
  async matchActionsSince(
    roomId: string,
    desdeId: number = 0
  ): Promise<Array<{
    id: number
    userId: string
    seq: number
    tick: number
    issuedTick: number
    kind: string
    plantId: string | null
    lane: number | null
    col: number | null
    slot: number | null
    targetId: string | null
  }>> {
    if (!isSupabaseConfigured()) return []
    try {
      const { data, error } = await (supabase.rpc as any)('match_actions_since_v2', {
        p_room_id: roomId,
        p_desde_id: desdeId,
      })
      if (error) {
        logError('matchActionsSince', error)
        return []
      }
      return data ?? []
    } catch (e) {
      logError('matchActionsSince', e)
      return []
    }
  },

  /**
   * Escucha las acciones nuevas de una partida.
   *
   * Devuelve la función para dejar de escuchar. HAY QUE LLAMARLA al salir de la
   * batalla: un canal abierto sigue consumiendo conexión de Realtime, y son
   * limitadas.
   */
  subscribeToMatchActions(
    roomId: string,
    alRecibir: (accion: {
      id: number
      user_id: string
      seq: number
      tick: number
      issued_tick: number | null
      kind: string
      plant_id: string | null
      lane: number | null
      col: number | null
      slot: number | null
      target_id: string | null
    }) => void,
    /**
     * El estado de la suscripción: SUBSCRIBED, CHANNEL_ERROR, TIMED_OUT…
     *
     * Es el dato que distingue los tres casos posibles cuando el rival no ve tu
     * planta: que no se esté enviando, que el canal esté caído, o que estéis en
     * salas distintas. Sin esto hay que adivinar.
     */
    alCambiarEstado?: (estado: string) => void
  ): () => void {
    if (!isSupabaseConfigured()) return () => {}
    const canal = supabase
      .channel(`match_${roomId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'match_actions',
          filter: `room_id=eq.${roomId}`,
        },
        (payload: any) => alRecibir(payload.new)
      )
      .subscribe((estado: string) => alCambiarEstado?.(estado))

    return () => {
      void supabase.removeChannel(canal)
    }
  },

  /**
 * Los datos de la sala CON los nombres de los dos jugadores.
 *
 * Sustituye a getGameRoom para la batalla: hace falta el nick de cada uno para
 * poder poner "Xplora" y "Leonel" encima de cada árbol en lugar de
 * "ÁRBOL MADRE (P1)".
 *
 * Va por RPC y no por un select con join para devolver exactamente lo que hace
 * falta del perfil ajeno —nombre, avatar y ELO— y nada más.
 */
  async gameRoomInfo(roomId: string): Promise<{
    id: string
    mode: string
    seed: number
    status: string
    colosseumBet: number
    p1Deck: unknown
    p2Deck: unknown
    player1: { id: string; username: string | null; avatarId: string | null; elo: number | null }
    player2: { id: string; username: string | null; avatarId: string | null; elo: number | null }
    iAm: 'p1' | 'p2'
    isAsyncMatch?: boolean
    asyncActionsSnapshot?: unknown
    asyncDeckSnapshot?: unknown
    engineVersion?: EngineVersion | null
  } | null> {
    if (!isSupabaseConfigured()) return null
    try {
      const { data, error } = await (supabase.rpc as any)('game_room_info', {
        p_room_id: roomId,
      })
      if (error) {
        logError('gameRoomInfo', error)
        return null
      }
      return data
    } catch (e) {
      logError('gameRoomInfo', e)
      return null
    }
  },

  /**
   * Arranca (o consulta) el reloj común de la partida.
   *
   * El primero de los dos que entra al campo lo fija; el segundo recibe el mismo
   * valor. Eso es lo que hace que los dos vayan por el mismo tic aunque uno haya
   * tardado más en cargar: el que llega tarde simula de golpe los tics que se
   * perdió.
   *
   * Devuelve además `serverNow` para poder corregir la diferencia entre el reloj
   * del navegador y el del servidor. Los relojes de dos ordenadores nunca
   * coinciden exactamente, y sin esa corrección un desfase de un segundo volvería
   * a desalinear la partida — que es el fallo que esto viene a arreglar.
   */
  async startMatchClock(roomId: string): Promise<{
    /** El instante de Date.now() del navegador que corresponde al tic 0. */
    ancoraMs: number
    currentTick: number
  }> {
    if (!isSupabaseConfigured()) {
      throw new Error('Supabase no está configurado')
    }
    if (!roomId) {
      throw new Error('roomId es requerido para sincronizar el reloj de partida')
    }
    try {
      // Se mide alrededor de la llamada para estimar el viaje de ida y vuelta.
      const antes = Date.now()
      const { data, error } = await (supabase.rpc as any)('start_match_clock', {
        p_room_id: roomId,
      })
      const despues = Date.now()

      if (error) {
        logError('startMatchClock', error)
        throw new Error(error.message || 'Error al iniciar reloj de partida')
      }

      return validateMatchClock(data, antes, despues)
    } catch (e: any) {
      logError('startMatchClock', e)
      throw e
    }
  },

  /**
   * ¿Terminó la partida, y quién ganó?
   *
   * Red de seguridad de subscribeToRoomEnd: si el mensaje de Realtime se perdió,
   * el cliente pregunta y se entera igual. Sin esto, un mensaje perdido dejaría a
   * un jugador peleando contra un campo vacío para siempre.
   */
  async roomResult(roomId: string): Promise<{
    ended: boolean
    status?: string
    winner?: string | null
    winnerSide?: 1 | 2 | null
    iWon?: boolean
    noWinner?: boolean
    verificationStatus?: string
    verificationNote?: string | null
    authoritative?: boolean
    isAsyncMatch?: boolean
  } | null> {
    if (!isSupabaseConfigured()) return null
    try {
      const { data, error } = await (supabase.rpc as any)('room_result', {
        p_room_id: roomId,
      })
      if (error) {
        logError('roomResult', error)
        return null
      }
      return data
    } catch (e) {
      logError('roomResult', e)
      return null
    }
  },

  /**
   * Escucha el final de la partida.
   *
   * Cuando el rival se rinde o pierde, el servidor liquida la sala y esto lo
   * entrega al instante, para que tu partida termine también en lugar de seguir
   * contra un campo vacío.
   *
   * Devuelve la función para dejar de escuchar; hay que llamarla al salir.
   */
  subscribeToRoomEnd(roomId: string, alTerminar: () => void): () => void {
    if (!isSupabaseConfigured()) return () => {}
    const canal = supabase
      .channel(`room_end_${roomId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'game_rooms',
          filter: `id=eq.${roomId}`,
        },
        (payload: any) => {
          // Sólo interesa la liquidación. La sala se actualiza también al guardar
          // un reporte, y eso no termina nada todavía.
          if (payload.new?.settled_at) alTerminar()
        }
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(canal)
    }
  },

  // ---------------------------------------------------------------------------
  // REPETICIONES
  //
  // Una repetición no es un vídeo: es la partida vuelta a ejecutar con la misma
  // semilla y las mismas jugadas. Así que no se descarga un fichero grande — se
  // piden unas decenas de filas y el motor hace el resto.
  // ---------------------------------------------------------------------------

  /**
   * Manda la huella del tablero.
   *
   * Es un detector, no un árbitro: el servidor compara las dos huellas del mismo
   * tic y si no coinciden se sabe EN QUÉ TIC se separaron las dos pantallas. Antes
   * sólo llegaba el aviso de "tu rival dijo otra cosa" al final, cuando ya no se
   * puede averiguar nada.
   *
   * Si falla, se calla: perder una huella no debe estropear una partida.
   */
  async submitMatchCheckpoint(roomId: string, tick: number, huella: string): Promise<void> {
    if (!isSupabaseConfigured()) return
    try {
      await (supabase.rpc as any)('submit_match_checkpoint', {
        p_room_id: roomId,
        p_tick: tick,
        p_huella: huella,
      })
    } catch {
      // A propósito en silencio.
    }
  },

  /** ¿Se separaron las dos pantallas en esta partida, y dónde? */
  async matchDivergence(roomId: string): Promise<{
    comparados: number
    divergio: boolean
    primerTic: number | null
    huellaP1: string | null
    huellaP2: string | null
  } | null> {
    if (!isSupabaseConfigured()) return null
    try {
      const { data, error } = await (supabase.rpc as any)('match_divergence', {
        p_room_id: roomId,
      })
      if (error) {
        logError('matchDivergence', error)
        return null
      }
      return data
    } catch (e) {
      logError('matchDivergence', e)
      return null
    }
  },

  /** El resumen de divergencias para el panel. Sólo admin. */
  async adminDivergencias(limite = 50): Promise<any | null> {
    if (!isSupabaseConfigured()) return null
    try {
      const { data, error } = await (supabase.rpc as any)('admin_divergencias', {
        p_limite: limite,
      })
      if (error) {
        logError('adminDivergencias', error)
        return null
      }
      return data
    } catch (e) {
      logError('adminDivergencias', e)
      return null
    }
  },

  /** Mis partidas terminadas, de la más reciente a la más antigua. */
  async myMatches(limite = 20): Promise<Array<{
    roomId: string
    mode: string
    jugadaEn: string
    duracionSegundos: number
    rival: string | null
    rivalAvatar: string | null
    /** Desde MI punto de vista. Null si no hubo ganador (disputa o abandono). */
    gane: boolean | null
    estado: string
    jugadas: number
    shareToken: string | null
  }>> {
    if (!isSupabaseConfigured()) return []
    try {
      const { data, error } = await (supabase.rpc as any)('my_matches', { p_limite: limite })
      if (error) {
        logError('myMatches', error)
        return []
      }
      return data ?? []
    } catch (e) {
      logError('myMatches', e)
      return []
    }
  },

  /**
   * Una repetición entera: semilla, mazos y todas las jugadas con su tic.
   *
   * Con el código de compartir la puede pedir cualquiera, incluso sin cuenta: es
   * lo que atiende los enlaces. Con el identificador de la sala, sólo quien jugó.
   */
  async matchReplay(opciones: { roomId?: string; token?: string }): Promise<DatosDeRepeticion | null> {
    if (!isSupabaseConfigured()) return null
    try {
      const { data, error } = await (supabase.rpc as any)('match_replay', {
        p_room_id: opciones.roomId ?? null,
        p_token: opciones.token ?? null,
      })
      if (error) {
        logError('matchReplay', error)
        return null
      }
      return data
    } catch (e) {
      logError('matchReplay', e)
      return null
    }
  },

  /**
   * Pide el enlace para compartir una partida.
   *
   * Devuelve el mismo si ya lo tenía, para que un enlace ya enviado no deje de
   * funcionar por volver a pulsar el botón.
   */
  async shareMatch(roomId: string): Promise<{ token?: string; yaExistia?: boolean; error?: string }> {
    if (!isSupabaseConfigured()) return { error: 'sin_supabase' }
    try {
      const { data, error } = await (supabase.rpc as any)('share_match', { p_room_id: roomId })
      if (error) {
        logError('shareMatch', error)
        return { error: error.message }
      }
      return data
    } catch (e: any) {
      logError('shareMatch', e)
      return { error: e?.message }
    }
  },

  /** Revoca el enlace: deja de funcionar para todo el mundo. */
  async unshareMatch(roomId: string): Promise<boolean> {
    if (!isSupabaseConfigured()) return false
    try {
      const { error } = await (supabase.rpc as any)('unshare_match', { p_room_id: roomId })
      if (error) {
        logError('unshareMatch', error)
        return false
      }
      return true
    } catch (e) {
      logError('unshareMatch', e)
      return false
    }
  },

  /**
   * Rendirse en una partida real.
   *
   * No necesita que el rival confirme nada: lo dice quien pierde. El servidor
   * declara ganador al otro y liquida por el mismo camino que una partida normal.
   *
   * Antes rendirse no hacía NADA en el servidor: el cliente restaba 8 puntos en su
   * propio estado, que no se guarda, así que al recargar volvía el ELO de antes y
   * el rival se quedaba esperando un reporte que no llegaba nunca.
   */
  async surrenderMatch(roomId: string): Promise<{
    success?: boolean
    status?: string
    winner?: string
    eloLost?: number
    error?: string
  }> {
    if (!isSupabaseConfigured()) return { error: 'sin_supabase' }
    try {
      const { data, error } = await (supabase.rpc as any)('surrender_match', {
        p_room_id: roomId,
      })
      if (error) {
        logError('surrenderMatch', error)
        return { error: error.message }
      }
      return data
    } catch (e: any) {
      logError('surrenderMatch', e)
      return { error: e?.message }
    }
  },

  /**
   * Los datos de la sala: la semilla y los dos mazos.
   *
   * La semilla es lo que hace que los dos jugadores simulen exactamente la misma
   * partida — se le pasa a startGame(seed). RLS sólo deja leer las salas propias.
   */
  async getGameRoom(roomId: string): Promise<{
    id: string
    mode: string
    player1_id: string
    player2_id: string | null
    seed: number
    p1_deck: unknown
    p2_deck: unknown
    colosseum_bet: number
    status: string
    settled_at?: string | null
    server_winner_id?: string | null
    p1_reported_winner?: string | null
    p2_reported_winner?: string | null
    verification_status?: string | null
    verification_payload?: any
    verification_note?: string | null
    engine_version?: string | null
    is_async_match?: boolean
    async_opponent_id?: string | null
    async_display_name?: string | null
    async_avatar_id?: string | null
    async_rating_snapshot?: number | null
    async_deck_snapshot?: unknown
  } | null> {
    if (!isSupabaseConfigured()) return null
    try {
      const { data, error } = await supabase
        .from('game_rooms')
        .select('id, mode, player1_id, player2_id, seed, p1_deck, p2_deck, colosseum_bet, status, settled_at, server_winner_id, p1_reported_winner, p2_reported_winner, verification_status, verification_payload, verification_note, engine_version, is_async_match, async_opponent_id, async_display_name, async_avatar_id, async_rating_snapshot, async_deck_snapshot')
        .eq('id', roomId)
        .single()
      if (error) {
        logError('getGameRoom', error)
        return null
      }
      return data as any
    } catch (e) {
      logError('getGameRoom', e)
      return null
    }
  },

  /**
   * Pide al servidor las intenciones del Rival Semilla hasta la ventana autorizada.
   */
  async pollRankedAsyncIntents(
    roomId: string,
    afterSeq = 0
  ): Promise<{
    ok: boolean
    serverTick?: number
    maxRevealedTick?: number
    intents?: any[]
    error?: string
  } | null> {
    if (!isSupabaseConfigured()) return null
    try {
      const { data, error } = await (supabase.rpc as any)('poll_ranked_async_intents', {
        p_room_id: roomId,
        p_after_seq: afterSeq,
      })
      if (error) {
        logError('pollRankedAsyncIntents', error)
        return null
      }
      return data
    } catch (e) {
      logError('pollRankedAsyncIntents', e)
      return null
    }
  },

  /**
   * Reporta quién ganó la partida. Sustituye a resolveColosseumMatch, que
   * dejaba al cliente declarar el ganador y cobrar.
   *
   * El pago sólo ocurre cuando AMBOS jugadores reportan el mismo ganador:
   *   status 'esperando_al_rival'   → tu reporte quedó registrado
   *   status 'resultado_en_disputa' → no coinciden, no se paga a nadie
   *   status 'liquidada'            → pagado, `payout` trae el importe
   *   status 'ya_liquidada'         → sala ya resuelta, trae datos de ELO
   */
  async reportMatchResult(
    roomId: string,
    winnerId: string
  ): Promise<{
    success: boolean
    status?: string
    payout?: number
    eloGained?: number
    eloLost?: number
    eloAfter?: number
    winner?: string
    elo?: any
    error?: string
  }> {
    if (!isSupabaseConfigured()) return { success: false, error: 'Supabase no configurado' }
    try {
      const { data, error } = await (supabase.rpc as any)('report_match_result', {
        p_room_id: roomId,
        p_winner_id: winnerId,
      })
      if (error) {
        logError('reportMatchResult', error)
        return { success: false, error: error.message }
      }
      return data as any
    } catch (e: any) {
      logError('reportMatchResult', e)
      return { success: false, error: e?.message }
    }
  },

  /**
   * Pide al árbitro servidor reconstruir la partida o confirmar la liquidación autoritativa.
   * El navegador NO manda ganador: sólo roomId.
   */
  async verifyMatch(roomId: string): Promise<{
    ok: boolean
    status?: 'pending' | 'verified' | 'verified_draw' | 'settled' | 'failed'
    winnerId?: string | null
    winnerSide?: 1 | 2 | null
    isAsyncMatch?: boolean
    reason?: string
    retryAfterMs?: number
    reviewRequired?: boolean
    settlement?: {
      success?: boolean
      status?: string
      eloGained?: number
      eloLost?: number
      payout?: number
      eloDelta?: number
      eloBefore?: number
      eloAfter?: number
      opponentElo?: number
      rawElo?: any
      [k: string]: unknown
    }
    error?: string
  }> {
    if (!isSupabaseConfigured()) return { ok: false, error: 'sin_supabase' }

    // Helper interno para resolver desde el estado de la base de datos si ya liquidó
    const checkDbSettled = async (): Promise<{
      ok: boolean
      status: 'verified_draw' | 'settled'
      winnerId: string | null
      winnerSide: 1 | 2 | null
      isAsyncMatch: boolean
      settlement: {
        success: boolean
        status: string
        rawElo: any
      }
    } | null> => {
      try {
        const room = await this.getGameRoom(roomId)
        if (room?.settled_at) {
          const isDraw = room.status === 'draw'
          const isP1Winner = room.status === 'p1_won'
          const isP2Winner = room.status === 'p2_won'
          const winnerSide: 1 | 2 | null = isP1Winner ? 1 : isP2Winner ? 2 : null
          const eloAudit = room.verification_payload?.elo

          return {
            ok: true,
            status: isDraw ? 'verified_draw' : 'settled',
            winnerId: room.server_winner_id || (winnerSide === 1 ? room.player1_id : (room.player2_id || null)),
            winnerSide,
            isAsyncMatch: Boolean(room.is_async_match),
            settlement: {
              success: true,
              status: isDraw ? 'empate' : 'liquidada',
              rawElo: eloAudit,
            },
          }
        }
      } catch {
        // silencioso
      }
      return null
    }

    // En PvP humano, el rival puede tardar varios segundos en terminar y reportar.
    // Reintentamos hasta 25 veces (~30-35s) y cotejamos contra la DB ante cualquier respuesta.
    for (let intento = 0; intento < 25; intento += 1) {
      try {
        const { data, error } = await supabase.functions.invoke('verify-match', {
          body: { roomId },
        })

        if (!error && data) {
          if (data.status !== 'pending') {
            // Si verify-match responde 'settled' pero sin settlement completo de ELO,
            // enriquecerlo desde game_rooms si ya tiene settled_at
            if (data.status === 'settled' && (!data.settlement || !(data.settlement as any).rawElo)) {
              const dbResolved = await checkDbSettled()
              if (dbResolved) {
                return {
                  ...data,
                  ...dbResolved,
                  settlement: {
                    ...(data.settlement || {}),
                    ...(dbResolved.settlement || {}),
                  },
                }
              }
            }
            return data
          }
        }

        // Si la función responde pending o falló, verificar si ya liquidó en DB
        const dbResolved = await checkDbSettled()
        if (dbResolved) {
          return dbResolved
        }

        const espera = Math.max(500, Math.min(Number(data?.retryAfterMs) || 1200, 3000))
        await new Promise((resolve) => setTimeout(resolve, espera))
      } catch (e: any) {
        logError('verifyMatch', e)
        const dbResolved = await checkDbSettled()
        if (dbResolved) return dbResolved

        if (intento >= 24) {
          return { ok: false, error: e?.message ?? 'verify-match falló' }
        }
        await new Promise((resolve) => setTimeout(resolve, 1000))
      }
    }

    // Comprobación final directa en DB
    const finalDbResolved = await checkDbSettled()
    if (finalDbResolved) return finalDbResolved

    return { ok: true, status: 'pending' }
  },

  // ---------------------------------------------------------------------------
  // MARKETPLACE P2P BUY, LIST & CANCEL (RPC)
  // ---------------------------------------------------------------------------
  async getMarketplaceListings(): Promise<MarketplaceRow[]> {
    if (!isSupabaseConfigured()) return []
    try {
      const { data } = await supabase
        .from('marketplace_listings')
        .select('*')
        .eq('status', 'active')
        .order('created_at', { ascending: false })
      return (data || []) as MarketplaceRow[]
    } catch {
      return []
    }
  },

  /** El vendedor es siempre quien llama. Antes se podía publicar la carta de
   *  otro jugador al precio que se quisiera. */
  async listMarketplaceCard(plantInstanceId: string, priceGems: number): Promise<{ success: boolean; listing_id?: string; error?: string }> {
    if (!isSupabaseConfigured()) return { success: false, error: 'Supabase no configurado' }
    try {
      const { data, error } = await (supabase.rpc as any)('list_marketplace_card', {
        p_plant_instance_id: plantInstanceId,
        p_price_gems: priceGems,
      })
      if (error) {
        logError('listMarketplaceCard', error)
        return { success: false, error: error.message }
      }
      return data as { success: boolean; listing_id?: string }
    } catch (e: any) {
      logError('listMarketplaceCard', e)
      return { success: false, error: e?.message }
    }
  },

  /** Publica tanto plantas como ítems de farming en el marketplace autoritativo */
  async listMarketplaceItem(
    itemType: 'plant' | 'farming',
    targetId: string,
    priceGems: number,
    quantity = 1
  ): Promise<{ success: boolean; listing_id?: string; error?: string }> {
    if (!isSupabaseConfigured()) return { success: false, error: 'Supabase no configurado' }
    try {
      const { data, error } = await (supabase.rpc as any)('list_marketplace_item', {
        p_item_type: itemType,
        p_target_id: targetId,
        p_price_gems: priceGems,
        p_quantity: quantity,
      })
      if (error) {
        if (itemType === 'plant') {
          return await this.listMarketplaceCard(targetId, priceGems)
        }
        logError('listMarketplaceItem', error)
        return { success: false, error: error.message }
      }
      return data as { success: boolean; listing_id?: string }
    } catch (e: any) {
      if (itemType === 'plant') {
        return await this.listMarketplaceCard(targetId, priceGems)
      }
      logError('listMarketplaceItem', e)
      return { success: false, error: e?.message }
    }
  },

  async cancelMarketplaceListing(listingId: string): Promise<{ success: boolean; error?: string }> {
    if (!isSupabaseConfigured()) return { success: false, error: 'Supabase no configurado' }
    try {
      const { error } = await (supabase.rpc as any)('cancel_marketplace_listing', {
        p_listing_id: listingId,
      })
      if (error) {
        logError('cancelMarketplaceListing', error)
        return { success: false, error: error.message }
      }
      return { success: true }
    } catch (e: any) {
      logError('cancelMarketplaceListing', e)
      return { success: false, error: e?.message }
    }
  },

  /**
   * Las ofertas activas con lo que hace falta para pintarlas.
   *
   * getMarketplaceListings devuelve las filas crudas, sin la carta ni el nick del
   * vendedor, así que la pantalla no podía usarlas: por eso seguía leyendo de
   * localStorage. Esta trae todo junto y sin identificadores de usuario.
   */
  async marketplaceBoard(limite = 60): Promise<{
    comisionPct: number
    ofertas: Array<{
      id: string
      itemType?: 'plant' | 'farming'
      itemId?: string
      quantity?: number
      plantId?: any
      nivel: number
      statRolls: any[]
      precio: number
      vendedor: string | null
      esMia: boolean
      desde: string
    }>
  } | null> {
    if (!isSupabaseConfigured()) return null
    try {
      const { data, error } = await (supabase.rpc as any)('marketplace_board', {
        p_limite: limite,
      })
      if (error) {
        logError('marketplaceBoard', error)
        return null
      }
      return data
    } catch (e) {
      logError('marketplaceBoard', e)
      return null
    }
  },

  /** El comprador es siempre quien llama. Antes se podía forzar a otro jugador
   *  a comprar y así vaciarle el saldo. */
  async buyMarketplaceCard(listingId: string): Promise<{ success: boolean; price_gems?: number; error?: string }> {
    if (!isSupabaseConfigured()) return { success: false, error: 'Supabase no configurado' }
    try {
      const { data, error } = await (supabase.rpc as any)('buy_marketplace_card', {
        p_listing_id: listingId,
      })
      if (error) {
        logError('buyMarketplaceCard', error)
        return { success: false, error: error.message }
      }
      return data as { success: boolean; price_gems?: number }
    } catch (e: any) {
      logError('buyMarketplaceCard', e)
      return { success: false, error: e?.message }
    }
  },

  /** Consulta autoritativa en backend sobre si el usuario tiene acceso al mercado (Pase PvP o 1350 copas) */
  async checkMarketplaceAccess(): Promise<{
    hasAccess: boolean
    hasVipPass?: boolean
    copas?: number
    copasRequired?: number
    unlockedBy?: 'vip_pass' | 'copas' | 'none'
    error?: string
  }> {
    if (!isSupabaseConfigured()) return { hasAccess: false, error: 'Supabase no configurado' }
    try {
      const { data, error } = await (supabase.rpc as any)('check_marketplace_access')
      if (error) {
        logError('checkMarketplaceAccess', error)
        return { hasAccess: false, error: error.message }
      }
      return data as {
        hasAccess: boolean
        hasVipPass?: boolean
        copas?: number
        copasRequired?: number
        unlockedBy?: 'vip_pass' | 'copas' | 'none'
      }
    } catch (e: any) {
      logError('checkMarketplaceAccess', e)
      return { hasAccess: false, error: e?.message }
    }
  },

  // ---------------------------------------------------------------------------
  // CLAN TREASURY DEPOSIT (RPC) & CLANS
  // ---------------------------------------------------------------------------
  /** El clan se deduce de la pertenencia del jugador en el servidor, y las
   *  gemas salen de su propio saldo. Antes se podía donar el saldo de otro. */
  async depositToClanVault(amountGems: number): Promise<{ success: boolean; tickets_awarded?: number; clan_id?: string; error?: string }> {
    if (!isSupabaseConfigured()) return { success: false, error: 'Supabase no configurado' }
    try {
      const { data, error } = await (supabase.rpc as any)('deposit_to_clan_vault', {
        p_amount: amountGems,
      })
      if (error) {
        logError('depositToClanVault', error)
        return { success: false, error: error.message }
      }
      return data as { success: boolean; tickets_awarded?: number; clan_id?: string }
    } catch (e: any) {
      logError('depositToClanVault', e)
      return { success: false, error: e?.message }
    }
  },

  async getAllClans(): Promise<ClanRow[]> {
    if (!isSupabaseConfigured()) return []
    try {
      const { data } = await supabase.from('clans').select('*').order('created_at', { ascending: false })
      return (data || []) as ClanRow[]
    } catch {
      return []
    }
  },

  async createClan(name: string, tag: string, badge?: string, description?: string): Promise<{ success: boolean; clan_id?: string; error?: string }> {
    if (!isSupabaseConfigured()) return { success: false, error: 'Supabase no configurado' }
    try {
      const { data, error } = await (supabase.rpc as any)('create_clan', {
        p_name: name,
        p_tag: tag,
        p_badge: badge || '👑',
        p_description: description || 'Clan competitivo de Plant Arena.',
      })
      if (error) {
        logError('createClan', error)
        return { success: false, error: error.message }
      }
      return data as { success: boolean; clan_id?: string }
    } catch (e: any) {
      logError('createClan', e)
      return { success: false, error: e?.message }
    }
  },

  async joinClan(clanId: string): Promise<{ success: boolean; clan_id?: string; error?: string }> {
    if (!isSupabaseConfigured()) return { success: false, error: 'Supabase no configurado' }
    const isUuid = !!clanId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clanId)
    if (!isUuid) {
      return { success: false, error: 'ID de clan inválido' }
    }
    try {
      const { data, error } = await (supabase.rpc as any)('join_clan', {
        p_clan_id: clanId,
      })
      if (error) {
        logError('joinClan', error)
        return { success: false, error: error.message }
      }
      return data as { success: boolean; clan_id?: string }
    } catch (e: any) {
      logError('joinClan', e)
      return { success: false, error: e?.message }
    }
  },

  async leaveClan(clanId: string): Promise<{ success: boolean; error?: string }> {
    if (!isSupabaseConfigured()) return { success: false, error: 'Supabase no configurado' }
    // Si no es un UUID válido (ej. un clan fantasma local antiguo tipo "clan-1788870332951"),
    // no se envía a Postgres y se retorna success para que el cliente limpie su estado sin error.
    const isUuid = !!clanId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clanId)
    if (!isUuid) {
      return { success: true }
    }
    try {
      const { data, error } = await (supabase.rpc as any)('leave_clan', {
        p_clan_id: clanId,
      })
      if (error) {
        logError('leaveClan', error)
        return { success: false, error: error.message }
      }
      return data as { success: boolean }
    } catch (e: any) {
      logError('leaveClan', e)
      return { success: false, error: e?.message }
    }
  },

  async repairClanBase(): Promise<{ success: boolean; error?: string }> {
    if (!isSupabaseConfigured()) return { success: false, error: 'Supabase no configurado' }
    try {
      const { data, error } = await (supabase.rpc as any)('repair_clan_base')
      if (error) {
        logError('repairClanBase', error)
        return { success: false, error: error.message }
      }
      return data as { success: boolean }
    } catch (e: any) {
      logError('repairClanBase', e)
      return { success: false, error: e?.message }
    }
  },

  async claimSeasonClanEarnings(): Promise<{ success: boolean; share?: number; new_vault?: number; error?: string; message?: string }> {
    if (!isSupabaseConfigured()) return { success: false, error: 'Supabase no configurado' }
    try {
      const { data, error } = await (supabase.rpc as any)('claim_season_clan_earnings')
      if (error) {
        logError('claimSeasonClanEarnings', error)
        return { success: false, error: error.message }
      }
      return data as { success: boolean; share?: number; new_vault?: number; error?: string; message?: string }
    } catch (e: any) {
      logError('claimSeasonClanEarnings', e)
      return { success: false, error: e?.message }
    }
  },

  async updateClanRewardShares(
    clanId: string,
    shares: { user_id: string; percentage: number }[]
  ): Promise<{ success: boolean; total_percentage?: number; members_updated?: number; error?: string; message?: string }> {
    if (!isSupabaseConfigured()) return { success: false, error: 'Supabase no configurado' }
    try {
      const { data, error } = await (supabase.rpc as any)('update_clan_reward_shares', {
        p_clan_id: clanId,
        p_shares: shares,
      })
      if (error) {
        logError('updateClanRewardShares', error)
        return { success: false, error: error.message }
      }
      return data as { success: boolean; total_percentage?: number; members_updated?: number; error?: string; message?: string }
    } catch (e: any) {
      logError('updateClanRewardShares', e)
      return { success: false, error: e?.message }
    }
  },

  async requestClanPlantDonation(plantId: string): Promise<{ success: boolean; donation_id?: string; error?: string }> {
    if (!isSupabaseConfigured()) return { success: false, error: 'Supabase no configurado' }
    try {
      const { data, error } = await (supabase.rpc as any)('request_clan_plant_donation', {
        p_plant_id: plantId,
      })
      if (error) {
        logError('requestClanPlantDonation', error)
        return { success: false, error: error.message }
      }
      return data as { success: boolean; donation_id?: string }
    } catch (e: any) {
      logError('requestClanPlantDonation', e)
      return { success: false, error: e?.message }
    }
  },

  async donateClanPlantCopy(donationId: string): Promise<{ success: boolean; plant_id?: string; error?: string }> {
    if (!isSupabaseConfigured()) return { success: false, error: 'Supabase no configurado' }
    try {
      const { data, error } = await (supabase.rpc as any)('donate_clan_plant_copy', {
        p_donation_id: donationId,
      })
      if (error) {
        logError('donateClanPlantCopy', error)
        return { success: false, error: error.message }
      }
      return data as { success: boolean; plant_id?: string }
    } catch (e: any) {
      logError('donateClanPlantCopy', e)
      return { success: false, error: e?.message }
    }
  },

  async updateClanSettings(
    clanId: string,
    settings: any
  ): Promise<{ success: boolean; error?: string; message?: string; settings?: any }> {
    if (!isSupabaseConfigured()) return { success: false, error: 'Supabase no configurado' }
    try {
      const { data, error } = await (supabase.rpc as any)('update_clan_settings', {
        p_clan_id: clanId,
        p_settings: settings,
      })
      if (error) {
        logError('updateClanSettings', error)
        return { success: false, error: error.message }
      }
      return data as { success: boolean; error?: string; message?: string; settings?: any }
    } catch (e: any) {
      logError('updateClanSettings', e)
      return { success: false, error: e?.message }
    }
  },

  async requestJoinClan(
    clanId: string
  ): Promise<{ success: boolean; joined?: boolean; clan_id?: string; request_id?: string; error?: string; message?: string }> {
    if (!isSupabaseConfigured()) return { success: false, error: 'Supabase no configurado' }
    const isUuid = !!clanId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clanId)
    if (!isUuid) {
      return { success: false, error: 'ID de clan inválido' }
    }
    try {
      const { data, error } = await (supabase.rpc as any)('request_join_clan', {
        p_clan_id: clanId,
      })
      if (error) {
        logError('requestJoinClan', error)
        return { success: false, error: error.message }
      }
      return data as { success: boolean; joined?: boolean; clan_id?: string; request_id?: string; error?: string; message?: string }
    } catch (e: any) {
      logError('requestJoinClan', e)
      return { success: false, error: e?.message }
    }
  },

  async respondClanJoinRequest(
    requestId: string,
    accept: boolean
  ): Promise<{ success: boolean; accepted?: boolean; error?: string; message?: string }> {
    if (!isSupabaseConfigured()) return { success: false, error: 'Supabase no configurado' }
    try {
      const { data, error } = await (supabase.rpc as any)('respond_clan_join_request', {
        p_request_id: requestId,
        p_accept: accept,
      })
      if (error) {
        logError('respondClanJoinRequest', error)
        return { success: false, error: error.message }
      }
      return data as { success: boolean; accepted?: boolean; error?: string; message?: string }
    } catch (e: any) {
      logError('respondClanJoinRequest', e)
      return { success: false, error: e?.message }
    }
  },

  async sendClanInvitation(
    clanId: string,
    targetUsername: string
  ): Promise<{ success: boolean; invitation_id?: string; target_username?: string; error?: string; message?: string }> {
    if (!isSupabaseConfigured()) return { success: false, error: 'Supabase no configurado' }
    try {
      const { data, error } = await (supabase.rpc as any)('send_clan_invitation', {
        p_clan_id: clanId,
        p_target_username: targetUsername.trim(),
      })
      if (error) {
        logError('sendClanInvitation', error)
        return { success: false, error: error.message, message: error.message }
      }
      return data as { success: boolean; invitation_id?: string; target_username?: string; error?: string; message?: string }
    } catch (e: any) {
      logError('sendClanInvitation', e)
      return { success: false, error: e?.message, message: e?.message }
    }
  },

  async respondClanInvitation(
    invitationId: string,
    accept: boolean
  ): Promise<{ success: boolean; status?: string; clan_id?: string; clan_name?: string; error?: string; message?: string }> {
    if (!isSupabaseConfigured()) return { success: false, error: 'Supabase no configurado' }
    try {
      const { data, error } = await (supabase.rpc as any)('respond_clan_invitation', {
        p_invitation_id: invitationId,
        p_accept: accept,
      })
      if (error) {
        logError('respondClanInvitation', error)
        return { success: false, error: error.message, message: error.message }
      }
      return data as { success: boolean; status?: string; clan_id?: string; clan_name?: string; error?: string; message?: string }
    } catch (e: any) {
      logError('respondClanInvitation', e)
      return { success: false, error: e?.message, message: e?.message }
    }
  },

  async getMyClanInvitations(): Promise<Array<{
    id: string
    clanId: string
    clanName: string
    clanTag: string
    clanBadge: string
    clanDescription: string
    leaderName: string
    createdAt: string
  }>> {
    if (!isSupabaseConfigured()) return []
    try {
      const { data, error } = await (supabase.rpc as any)('get_my_clan_invitations')
      if (error) {
        logError('getMyClanInvitations', error)
        return []
      }
      return (data || []) as Array<{
        id: string
        clanId: string
        clanName: string
        clanTag: string
        clanBadge: string
        clanDescription: string
        leaderName: string
        createdAt: string
      }>
    } catch (e: any) {
      logError('getMyClanInvitations', e)
      return []
    }
  },

  async getClansList(): Promise<any[]> {
    if (!isSupabaseConfigured()) return []
    try {
      const { data, error } = await (supabase.rpc as any)('get_clans_list')
      if (error) {
        logError('getClansList', error)
        return []
      }
      return Array.isArray(data) ? data : []
    } catch (e: any) {
      logError('getClansList', e)
      return []
    }
  },

  async getMyClanDetails(): Promise<{ clan?: any; members?: any[]; donations?: any[]; deposits?: any[]; requests?: any[] } | null> {
    if (!isSupabaseConfigured()) return null
    try {
      const { data, error } = await (supabase.rpc as any)('get_my_clan_details')
      if (error) {
        logError('getMyClanDetails', error)
        return null
      }
      return data
    } catch (e: any) {
      logError('getMyClanDetails', e)
      return null
    }
  },

  // ---------------------------------------------------------------------------
  // TOURNAMENTS
  // ---------------------------------------------------------------------------
  async getActiveTournaments(): Promise<TournamentRow[]> {
    if (!isSupabaseConfigured()) return []
    try {
      const { data } = await supabase.from('tournaments').select('*').order('starts_at', { ascending: true })
      return (data || []) as TournamentRow[]
    } catch {
      return []
    }
  },

  // ---------------------------------------------------------------------------
  // REALTIME MATCHMAKING LISTENER (READ-ONLY)
  // ---------------------------------------------------------------------------

  listenForMatch(queueId: string, onMatched: (roomId: string) => void): () => void {
    if (!isSupabaseConfigured()) return () => {}

    const channel = supabase
      .channel(`queue_${queueId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'matchmaking_queue',
          filter: `id=eq.${queueId}`,
        },
        (payload) => {
          const updated = payload.new as Database['public']['Tables']['matchmaking_queue']['Row']
          if (updated.status === 'matched' && updated.matched_room_id) {
            onMatched(updated.matched_room_id)
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  },

  // ---------------------------------------------------------------------------
  // ---------------------------------------------------------------------------
  // INVENTARIO Y TIENDA EN SERVIDOR (fase 2)
  //
  // Todo lo que crea cartas o mueve saldo pasa por aquí. El cliente no vuelve a
  // sortear rarezas ni a decidir precios: manda la intención y el servidor
  // cobra, sortea y devuelve el resultado.
  // ---------------------------------------------------------------------------

  /**
   * Precios de los sobres desde la tabla shop_packs, para que la tienda muestre
   * exactamente lo que se va a cobrar. La interfaz los tenía escritos a mano y
   * uno ya había divergido.
   */
  async getShopPackPrices(): Promise<Partial<Record<string, number>> | null> {
    if (!isSupabaseConfigured()) return null
    try {
      const { data, error } = await supabase
        .from('shop_packs')
        .select('pack_id, price_gems')
        .eq('is_active', true)
      if (error) {
        logError('getShopPackPrices', error)
        return null
      }
      const out: Record<string, number> = {}
      for (const row of (data || []) as any[]) {
        out[row.pack_id] = Number(row.price_gems)
      }
      return out
    } catch (e) {
      logError('getShopPackPrices', e)
      return null
    }
  },

  /**
   * ¿Tiene esta cuenta contraseña propia, y qué nick tiene?
   *
   * Sustituye a la marca 'plant_arena_pwd_set_<id>' de localStorage, que era
   * por navegador: el modal de "registra tu nick y contraseña" reaparecía al
   * cambiar de navegador aunque la contraseña ya estuviera puesta. Esto lo
   * consulta en auth.users, que es donde vive la respuesta de verdad.
   */
  async myAuthStatus(): Promise<{ hasPassword: boolean; username: string | null } | null> {
    if (!isSupabaseConfigured()) return null
    try {
      const { data, error } = await (supabase.rpc as any)('my_auth_status')
      if (error) {
        logError('myAuthStatus', error)
        return null
      }
      return data
    } catch (e) {
      logError('myAuthStatus', e)
      return null
    }
  },

  // ---------------------------------------------------------------------------
  // MINIJUEGO DEL CÓDIGO SECRETO, POR RONDAS
  //
  // El secreto vive en secret_code_rounds.secret, cuya columna tiene el SELECT
  // revocado para anon y authenticated: no hay ninguna llamada, aquí ni en otro
  // sitio, capaz de traerlo. Antes se generaba en el navegador y se guardaba en
  // localStorage, así que el jugador leía la respuesta y cobraba 20 gemas.
  // ---------------------------------------------------------------------------

  /** Mi estado en la ronda actual: intentos restantes y mi historial. */
  async secretCodeState(): Promise<{
    round: {
      id: string
      roundNumber: number
      status: 'open' | 'finished' | 'cancelled'
      freeAttempts: number
      prizePool: number
      prizes: number[]
      prizesConfig?: CodeRoundPrizeTier[]
      winnerId: string | null
      createdAt: string
      finishedAt: string | null
    } | null
    freeUsed?: number
    extraAttempts?: number
    attemptsLeft?: number
    attempts?: {
      id: string
      sequence: string[]
      exactCount: number
      wrongPosCount: number
      slotResults?: ('exact' | 'wrong' | 'miss')[]
      pct: number
      wasFree: boolean
      createdAt: string
    }[]
    myPayout?: { place: number; gems: number; tiedWith: number } | null
  } | null> {
    if (!isSupabaseConfigured()) return null
    try {
      const { data, error } = await (supabase.rpc as any)('secret_code_state')
      if (error) {
        logError('secretCodeState', error)
        return null
      }
      return data
    } catch (e) {
      logError('secretCodeState', e)
      return null
    }
  },

  /** Clasificación pública. Devuelve el % de cada jugador, nunca sus secuencias. */
  async secretCodeLeaderboard(roundId?: string): Promise<{
    userId: string
    username: string
    avatarId: string
    bestPct: number
    attempts: number
    lastAttempt: string
    place: number
    isMe: boolean
  }[]> {
    if (!isSupabaseConfigured()) return []
    try {
      const { data, error } = await (supabase.rpc as any)('secret_code_leaderboard', {
        p_round_id: roundId ?? null,
      })
      if (error) {
        logError('secretCodeLeaderboard', error)
        return []
      }
      return data || []
    } catch (e) {
      logError('secretCodeLeaderboard', e)
      return []
    }
  },

  /**
   * Prueba una secuencia. El servidor la compara contra el secreto, descuenta un
   * intento y, si es 100%, cierra la ronda y reparte el bote en la misma
   * transacción.
   */
  async guessSecretCode(sequence: string[]): Promise<{
    success: boolean
    exactCount?: number
    wrongPosCount?: number
    pct?: number
    slotResults?: ('exact' | 'wrong' | 'miss')[]
    wasFree?: boolean
    solved?: boolean
    roundFinished?: boolean
    payouts?: any
    error?: string
  }> {
    if (!isSupabaseConfigured()) return { success: false, error: 'Supabase no configurado' }
    try {
      const { data, error } = await (supabase.rpc as any)('guess_secret_code', {
        p_sequence: sequence,
      })
      if (error) {
        logError('guessSecretCode', error)
        return { success: false, error: error.message }
      }
      return data
    } catch (e: any) {
      logError('guessSecretCode', e)
      return { success: false, error: e?.message }
    }
  },

  async buySecretCodeAttempts(): Promise<{
    success: boolean
    attemptsAdded?: number
    spent?: number
    error?: string
  }> {
    if (!isSupabaseConfigured()) return { success: false, error: 'Supabase no configurado' }
    try {
      const { data, error } = await (supabase.rpc as any)('buy_secret_code_attempts')
      if (error) {
        logError('buySecretCodeAttempts', error)
        return { success: false, error: error.message }
      }
      return data
    } catch (e: any) {
      logError('buySecretCodeAttempts', e)
      return { success: false, error: e?.message }
    }
  },

  /** Obtiene las rondas de código secreto de forma autoritativa para el panel de administración */
  async adminGetSecretCodeRounds(): Promise<any[]> {
    if (!isSupabaseConfigured()) return []
    try {
      // 1. Intentar RPC SECURITY DEFINER
      const { data: rpcData, error: rpcError } = await (supabase.rpc as any)('admin_get_secret_code_rounds', { p_limit: 15 })
      if (!rpcError && Array.isArray(rpcData) && rpcData.length > 0) {
        return rpcData
      }
    } catch (_) {}

    // 2. Fallback: select directo a la tabla secret_code_rounds
    try {
      const { data, error } = await (supabase.from('secret_code_rounds') as any)
        .select('id, round_number, status, free_attempts, prize_pool_gems, prize_1st, prize_2nd, prize_3rd, prizes_config, winner_id, created_at, finished_at')
        .order('round_number', { ascending: false })
        .limit(15)

      if (!error && Array.isArray(data) && data.length > 0) {
        return data
      }
    } catch (_) {}

    // 3. Fallback adicional: consultar secret_code_state() para al menos saber la ronda activa
    try {
      const state = await this.secretCodeState()
      if (state?.round) {
        return [{
          id: state.round.id,
          round_number: state.round.roundNumber,
          status: state.round.status,
          free_attempts: state.round.freeAttempts,
          prize_pool_gems: state.round.prizePool,
          prize_1st: state.round.prizes?.[0] ?? state.round.prizePool,
          prize_2nd: state.round.prizes?.[1] ?? 0,
          prize_3rd: state.round.prizes?.[2] ?? 0,
          prizes_config: state.round.prizesConfig,
          winner_id: state.round.winnerId,
          created_at: state.round.createdAt,
          finished_at: state.round.finishedAt,
        }]
      }
    } catch (_) {}

    return []
  },

  /** Abre una ronda con configuración de premios flexible y autoritativa */
  async adminOpenSecretCodeRound(opts?: {
    prizePool?: number
    prize1st?: number
    prize2nd?: number
    prize3rd?: number
    freeAttempts?: number
    prizesConfig?: CodeRoundPrizeTier[]
  }): Promise<{
    success: boolean
    roundId?: string
    roundNumber?: number
    error?: string
  }> {
    if (!isSupabaseConfigured()) return { success: false, error: 'Supabase no configurado' }

    // Asegurar sesión válida antes de ejecutar RPC
    try {
      const { data: s } = await supabase.auth.getSession()
      if (!s?.session) {
        await supabase.auth.refreshSession().catch(() => null)
      }
    } catch (_) {}

    const payload = {
      prizePool: opts?.prizePool ?? 50,
      prize1st: opts?.prize1st ?? (opts?.prizesConfig?.[0]?.amount ?? 50),
      prize2nd: opts?.prize2nd ?? (opts?.prizesConfig?.[1]?.amount ?? 0),
      prize3rd: opts?.prize3rd ?? (opts?.prizesConfig?.[2]?.amount ?? 0),
      freeAttempts: opts?.freeAttempts ?? 3,
      prizesConfig: opts?.prizesConfig ?? [],
    }

    let lastError: any = null

    // 1. PostgREST con p_payload Y propiedades al mismo nivel
    try {
      const { data, error } = await (supabase.rpc as any)('admin_open_secret_code_round', {
        p_payload: payload,
        ...payload,
      })
      if (!error && data) {
        if (data.success === false) {
          return data
        }
        if (data.success || (typeof data === 'object' && 'roundId' in data)) {
          const targetId = (data as any)?.roundId
          if (targetId && opts?.prizesConfig && opts.prizesConfig.length > 0) {
            await (supabase.from('secret_code_rounds') as any)
              .update({ prizes_config: opts.prizesConfig, prize_pool_gems: payload.prizePool })
              .eq('id', targetId)
              .catch(() => null)
          }
          return { success: true, ...data }
        }
      }
      if (error) lastError = error
    } catch (e: any) {
      lastError = e
    }

    // 2. PostgREST Single JSON Parameter con payload directo
    try {
      const { data, error } = await (supabase.rpc as any)('admin_open_secret_code_round', payload)
      if (!error && data) {
        if (data.success === false) {
          return data
        }
        if (data.success || (typeof data === 'object' && 'roundId' in data)) {
          return { success: true, ...data }
        }
      }
      if (error) lastError = error
    } catch (e: any) {
      lastError = e
    }

    // 3. Parámetros directos con prefijo p_
    try {
      const { data, error } = await (supabase.rpc as any)('admin_open_secret_code_round', {
        p_prize_pool: payload.prizePool,
        p_prize_1st: payload.prize1st,
        p_prize_2nd: payload.prize2nd,
        p_prize_3rd: payload.prize3rd,
        p_free_attempts: payload.freeAttempts,
      })
      if (!error && (data?.success || (data && typeof data === 'object' && 'roundId' in data))) {
        return { success: true, ...data }
      }
      if (error) lastError = error
    } catch (e: any) {
      lastError = e
    }

    // 4. Parámetros planos sin prefijo
    try {
      const { data, error } = await (supabase.rpc as any)('admin_open_secret_code_round', {
        prize_pool: payload.prizePool,
        prize_1st: payload.prize1st,
        prize_2nd: payload.prize2nd,
        prize_3rd: payload.prize3rd,
        free_attempts: payload.freeAttempts,
      })
      if (!error && (data?.success || (data && typeof data === 'object' && 'roundId' in data))) {
        return { success: true, ...data }
      }
      if (error) lastError = error
    } catch (e: any) {
      lastError = e
    }

    // 5. Fallback sin parámetros
    try {
      const { data, error } = await (supabase.rpc as any)('admin_open_secret_code_round')
      if (!error && (data?.success || (data && typeof data === 'object' && 'roundId' in data))) {
        return { success: true, ...data }
      }
      if (error) lastError = error
    } catch (e: any) {
      lastError = e
    }

    // 6. Fallback de inserción directa si el usuario tiene rol admin y permisos en tabla
    try {
      const { data: activeRound } = await (supabase.from('secret_code_rounds') as any)
        .select('id, round_number')
        .eq('status', 'open')
        .maybeSingle()

      if (activeRound?.id) {
        return { success: false, error: 'Ya hay una ronda activa. Ciérrala antes de abrir una nueva.' }
      }

      const { data: maxRound } = await (supabase.from('secret_code_rounds') as any)
        .select('round_number')
        .order('round_number', { ascending: false })
        .limit(1)
      const nextNum = ((maxRound?.[0]?.round_number as number) || 0) + 1

      const plantList = [
        'sunflower', 'peashooter', 'repeater', 'wallnut', 'melonpult',
        'chomper', 'bonkchoy', 'garlic', 'squash', 'twinsunflower',
        'threepeater', 'tallnut', 'jalapeno', 'iceberglettuce', 'aloe'
      ]
      const secretSeq = Array.from({ length: 5 }, () => plantList[Math.floor(Math.random() * plantList.length)])

      const newRoundId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : undefined
      const insertPayload: any = {
        round_number: nextNum,
        status: 'open',
        secret: secretSeq,
        free_attempts: payload.freeAttempts,
        prize_pool_gems: payload.prizePool,
        prize_1st: payload.prize1st,
        prize_2nd: payload.prize2nd,
        prize_3rd: payload.prize3rd,
        prizes_config: payload.prizesConfig,
        code_version: 2,
      }
      if (newRoundId) {
        insertPayload.id = newRoundId
      }

      const { data: insertData, error: insertError } = await (supabase.from('secret_code_rounds') as any)
        .insert(insertPayload)
        .select('id, round_number')
        .single()

      if (!insertError && insertData?.id) {
        return {
          success: true,
          roundId: insertData.id,
          roundNumber: insertData.round_number,
        }
      }
      if (insertError) {
        lastError = insertError
      }
    } catch (e: any) {
      if (e) lastError = e
    }

    const errStr = lastError?.message || lastError?.error_description || (typeof lastError === 'string' ? lastError : 'Error al conectar con Supabase. Asegúrate de ejecutar la migración 72 en el editor SQL de Supabase.')
    logError('adminOpenSecretCodeRound', errStr)
    return { success: false, error: errStr }
  },

  /** Reinicia el acertijo: cierra la ronda anterior e inicia inmediatamente una nueva con 5 slots */
  async adminRestartSecretCodeRound(opts?: {
    prizePool?: number
    prize1st?: number
    prize2nd?: number
    prize3rd?: number
    freeAttempts?: number
    attemptCost?: number
    prizesConfig?: CodeRoundPrizeTier[]
    settlePrevious?: boolean
  }): Promise<{
    success: boolean
    roundId?: string
    roundNumber?: number
    error?: string
  }> {
    if (!isSupabaseConfigured()) return { success: false, error: 'Supabase no configurado' }

    try {
      const { data: s } = await supabase.auth.getSession()
      if (!s?.session) {
        await supabase.auth.refreshSession().catch(() => null)
      }
    } catch (_) {}

    const payload = {
      prizePool: opts?.prizePool ?? 50,
      prize1st: opts?.prize1st ?? (opts?.prizesConfig?.[0]?.amount ?? 50),
      prize2nd: opts?.prize2nd ?? (opts?.prizesConfig?.[1]?.amount ?? 0),
      prize3rd: opts?.prize3rd ?? (opts?.prizesConfig?.[2]?.amount ?? 0),
      freeAttempts: opts?.freeAttempts ?? 3,
      attemptCost: opts?.attemptCost ?? 5,
      prizesConfig: opts?.prizesConfig ?? [],
      settlePrevious: opts?.settlePrevious ?? true,
    }

    let lastError: any = null

    // 1. Intentar RPC con p_payload (JSONB) Y propiedades directas
    try {
      const { data, error } = await (supabase.rpc as any)('admin_restart_secret_code_round', {
        p_payload: payload,
        ...payload,
      })
      if (!error && data) {
        if (data.success === false) {
          return data
        }
        if (data.success || (typeof data === 'object' && 'roundId' in data)) {
          const targetId = (data as any)?.roundId
          if (targetId && opts?.prizesConfig && opts.prizesConfig.length > 0) {
            await (supabase.from('secret_code_rounds') as any)
              .update({ prizes_config: opts.prizesConfig, prize_pool_gems: payload.prizePool })
              .eq('id', targetId)
              .catch(() => null)
          }
          return { success: true, ...data }
        }
      }
      if (error) lastError = error
    } catch (e: any) {
      lastError = e
    }

    // 2. PostgREST Single JSON Parameter con payload directo
    try {
      const { data, error } = await (supabase.rpc as any)('admin_restart_secret_code_round', payload)
      if (!error && data) {
        if (data.success === false) {
          return data
        }
        if (data.success || (typeof data === 'object' && 'roundId' in data)) {
          const targetId = (data as any)?.roundId
          if (targetId && opts?.prizesConfig && opts.prizesConfig.length > 0) {
            await (supabase.from('secret_code_rounds') as any)
              .update({ prizes_config: opts.prizesConfig, prize_pool_gems: payload.prizePool })
              .eq('id', targetId)
              .catch(() => null)
          }
          return { success: true, ...data }
        }
      }
      if (error) lastError = error
    } catch (e: any) {
      lastError = e
    }

    // 3. Parámetros directos planos
    try {
      const { data, error } = await (supabase.rpc as any)('admin_restart_secret_code_round', {
        p_prize_pool: payload.prizePool,
        p_prize_1st: payload.prize1st,
        p_prize_2nd: payload.prize2nd,
        p_prize_3rd: payload.prize3rd,
        p_free_attempts: payload.freeAttempts,
        p_attempt_cost: payload.attemptCost,
        p_settle_previous: payload.settlePrevious,
      })
      if (!error && (data?.success || (data && typeof data === 'object' && 'roundId' in data))) {
        return { success: true, ...data }
      }
      if (error) lastError = error
    } catch (e: any) {
      lastError = e
    }

    // 4. Fallback compuesto: cerrar anterior y abrir nueva
    try {
      if (opts?.settlePrevious !== false) {
        await this.adminCloseSecretCodeRound(true)
      } else {
        await this.adminCloseSecretCodeRound(false)
      }

      const openRes = await this.adminOpenSecretCodeRound(opts)
      if (openRes.success) {
        return openRes
      }
      lastError = openRes.error || lastError
    } catch (e: any) {
      lastError = e
    }

    const errStr = lastError?.message || lastError?.error_description || (typeof lastError === 'string' ? lastError : 'Error al reiniciar ronda')
    logError('adminRestartSecretCodeRound', errStr)
    return { success: false, error: errStr }
  },

  /** Guarda / actualiza las recompensas de la ronda activa directamente en Supabase */
  async adminUpdateActiveSecretCodePrizes(opts: {
    prizePool?: number
    prizesConfig: CodeRoundPrizeTier[]
  }): Promise<{ success: boolean; error?: string }> {
    if (!isSupabaseConfigured()) return { success: false, error: 'Supabase no configurado' }

    const top1 = opts.prizesConfig.find((t) => t.place === 1)
    const top2 = opts.prizesConfig.find((t) => t.place === 2)
    const top3 = opts.prizesConfig.find((t) => t.place === 3)
    const prize1st = top1?.currency === 'gems' ? top1.amount : (opts.prizePool ?? 50)
    const prizePool = opts.prizePool ?? (top1?.currency === 'gems' ? top1.amount : 50)

    const payload = {
      prizePool,
      prize1st,
      prize2nd: top2?.amount ?? 0,
      prize3rd: top3?.amount ?? 0,
      prizesConfig: opts.prizesConfig,
    }

    // 1. Intentar RPC oficial
    try {
      const { data, error } = await (supabase.rpc as any)('admin_update_secret_code_prizes', {
        p_payload: payload,
        ...payload,
      })
      if (!error && (data?.success === true || (data && typeof data === 'object' && 'roundId' in data))) {
        return { success: true }
      }
    } catch (_) {}

    // 2. Fallback de actualización directa en la tabla de Supabase
    try {
      const { data: openRounds, error: findErr } = await (supabase.from('secret_code_rounds') as any)
        .select('id')
        .eq('status', 'open')
        .order('round_number', { ascending: false })
        .limit(1)

      if (openRounds && openRounds.length > 0) {
        const roundId = openRounds[0].id
        const { error: updErr } = await (supabase.from('secret_code_rounds') as any)
          .update({
            prizes_config: opts.prizesConfig,
            prize_pool_gems: prizePool,
            prize_1st: prize1st,
            prize_2nd: top2?.amount ?? 0,
            prize_3rd: top3?.amount ?? 0,
          })
          .eq('id', roundId)

        if (!updErr) return { success: true }
        return { success: false, error: updErr.message }
      }
      if (findErr) return { success: false, error: findErr.message }
    } catch (e: any) {
      return { success: false, error: e.message }
    }

    return { success: false, error: 'No se encontró ninguna ronda abierta para actualizar.' }
  },

  /** Cierra la ronda abierta. `settle` reparte el bote; sin él, se cancela. */
  async adminCloseSecretCodeRound(settle: boolean): Promise<{
    success: boolean
    roundNumber?: number
    settled?: boolean
    payouts?: any
    error?: string
  }> {
    if (!isSupabaseConfigured()) return { success: false, error: 'Supabase no configurado' }
    let lastError: any = null

    try {
      const { data, error } = await (supabase.rpc as any)('admin_close_secret_code_round', {
        p_settle: settle,
      })
      if (!error && (data?.success || data?.roundNumber)) {
        return { success: true, ...data }
      }
      if (error) lastError = error
    } catch (e: any) {
      lastError = e
    }

    try {
      const { data, error } = await (supabase.rpc as any)('admin_close_secret_code_round', {
        settle,
      })
      if (!error && (data?.success || data?.roundNumber)) {
        return { success: true, ...data }
      }
      if (error) lastError = error
    } catch (e: any) {
      lastError = e
    }

    try {
      const { data, error } = await (supabase.rpc as any)('admin_close_secret_code_round')
      if (!error && (data?.success || data?.roundNumber)) {
        return { success: true, ...data }
      }
      if (error) lastError = error
    } catch (e: any) {
      lastError = e
    }

    const errStr = lastError?.message || 'Error al cerrar ronda'
    logError('adminCloseSecretCodeRound', errStr)
    return { success: false, error: errStr }
  },

  /** Lista completa de sectores de la ruleta para administración */
  async adminGetLotterySectors(): Promise<Database['public']['Tables']['lottery_sectors']['Row'][] | null> {
    if (!isSupabaseConfigured()) return null
    try {
      const { data, error } = await supabase
        .from('lottery_sectors')
        .select('*')
        .order('weight', { ascending: false })
      if (error) {
        logError('adminGetLotterySectors', error)
        return null
      }
      return data as Database['public']['Tables']['lottery_sectors']['Row'][]
    } catch (e) {
      logError('adminGetLotterySectors', e)
      return null
    }
  },

  /** Obtiene los sectores activos de la ruleta para mostrarlos dinámicamente en el juego */
  async getLotterySectors(): Promise<Database['public']['Tables']['lottery_sectors']['Row'][] | null> {
    if (!isSupabaseConfigured()) return null
    try {
      const { data, error } = await supabase
        .from('lottery_sectors')
        .select('*')
        .eq('is_active', true)
        .order('weight', { ascending: false })
      if (error) {
        logError('getLotterySectors', error)
        return null
      }
      return data as Database['public']['Tables']['lottery_sectors']['Row'][]
    } catch (e) {
      logError('getLotterySectors', e)
      return null
    }
  },

  /** Guarda todos los sectores de la ruleta y valida que los pesos sumen 100 */
  async adminSaveLotterySectors(sectors: Array<{
    sectorId: string
    label?: string | null
    weight: number
    isActive: boolean
    gemsAmount?: number | null
    goldAmount?: number | null
    packQty?: number | null
    plantQty?: number | null
    itemId?: string | null
    itemQty?: number | null
  }>): Promise<{ success: boolean; error?: string; sectors?: number; weightTotal?: number }> {
    if (!isSupabaseConfigured()) return { success: false, error: 'Supabase no configurado' }
    try {
      const { data, error } = await (supabase.rpc as any)('admin_save_lottery_sectors', {
        p_sectors: sectors,
      })
      if (error) {
        logError('adminSaveLotterySectors', error)
        return { success: false, error: error.message }
      }

      // Sincronizar etiquetas directamente en lottery_sectors para reflejar cambios inmediatamente
      for (const s of sectors) {
        if (s.label) {
          const { error: labelErr } = await supabase
            .from('lottery_sectors')
            .update({ label: s.label })
            .eq('sector_id', s.sectorId)
          if (labelErr) {
            logError('adminSaveLotterySectors_labelUpdate', labelErr)
          }
        }
      }

      return data || { success: true }
    } catch (e: any) {
      logError('adminSaveLotterySectors', e)
      return { success: false, error: e?.message }
    }
  },

  /** Lista de sobres de la tienda */
  async adminGetShopPacks(): Promise<Database['public']['Tables']['shop_packs']['Row'][] | null> {
    if (!isSupabaseConfigured()) return null
    try {
      const { data, error } = await supabase
        .from('shop_packs')
        .select('*')
        .order('price_gems', { ascending: true })
      if (error) {
        logError('adminGetShopPacks', error)
        return null
      }
      return data as Database['public']['Tables']['shop_packs']['Row'][]
    } catch (e) {
      logError('adminGetShopPacks', e)
      return null
    }
  },

  /** Cambia el precio en gemas de un sobre */
  async adminSetPackPrice(packId: string, price: number): Promise<{ success: boolean; error?: string }> {
    if (!isSupabaseConfigured()) return { success: false, error: 'Supabase no configurado' }
    try {
      const { data, error } = await (supabase.rpc as any)('admin_set_pack_price', {
        p_pack_id: packId,
        p_price: price,
      })
      if (error) {
        logError('adminSetPackPrice', error)
        return { success: false, error: error.message }
      }
      return data || { success: true }
    } catch (e: any) {
      logError('adminSetPackPrice', e)
      return { success: false, error: e?.message }
    }
  },

  /** Niveles del Pase de Batalla */
  async adminGetBattlePassLevels(): Promise<Database['public']['Tables']['battle_pass_levels']['Row'][] | null> {
    if (!isSupabaseConfigured()) return null
    try {
      const { data, error } = await supabase
        .from('battle_pass_levels')
        .select('*')
        .order('level', { ascending: true })
      if (error) {
        logError('adminGetBattlePassLevels', error)
        return null
      }
      return data as Database['public']['Tables']['battle_pass_levels']['Row'][]
    } catch (e) {
      logError('adminGetBattlePassLevels', e)
      return null
    }
  },

  /** Guarda los niveles del Pase de Batalla */
  async adminSaveBattlePassLevels(levels: Database['public']['Tables']['battle_pass_levels']['Row'][]): Promise<{ success: boolean; error?: string }> {
    if (!isSupabaseConfigured()) return { success: false, error: 'Supabase no configurado' }
    try {
      const { error } = await (supabase.from('battle_pass_levels') as any).upsert(levels, {
        onConflict: 'level',
      })
      if (error) {
        logError('adminSaveBattlePassLevels', error)
        return { success: false, error: error.message }
      }
      return { success: true }
    } catch (e: any) {
      logError('adminSaveBattlePassLevels', e)
      return { success: false, error: e?.message }
    }
  },

  // ---------------------------------------------------------------------------
  // RECOMPENSAS (fase 2c)
  // ---------------------------------------------------------------------------

  /**
   * Gira la ruleta. El servidor cobra la gema (o comprueba las 24 h del tiro
   * gratis), sortea con los pesos de lottery_sectors y entrega el premio.
   * Devuelve qué sector salió para que la animación lo muestre.
   */
  async spinLottery(paid: boolean): Promise<{
    success: boolean
    sectorId?: string
    label?: string
    granted?: any
    error?: string
  }> {
    if (!isSupabaseConfigured()) return { success: false, error: 'Supabase no configurado' }
    try {
      const { data, error } = await (supabase.rpc as any)('spin_lottery', { p_paid: paid })
      if (error) {
        logError('spinLottery', error)
        return { success: false, error: error.message }
      }
      return data
    } catch (e: any) {
      logError('spinLottery', e)
      return { success: false, error: e?.message }
    }
  },

  /** Reclama un nivel del pase. El servidor exige pase VIP y ELO suficiente. */
  async claimBattlePassLevel(level: number): Promise<{
    success: boolean
    level?: number
    label?: string
    granted?: any
    error?: string
  }> {
    if (!isSupabaseConfigured()) return { success: false, error: 'Supabase no configurado' }
    try {
      const { data, error } = await (supabase.rpc as any)('claim_battle_pass_level', {
        p_level: level,
      })
      if (error) {
        logError('claimBattlePassLevel', error)
        return { success: false, error: error.message }
      }
      return data
    } catch (e: any) {
      logError('claimBattlePassLevel', e)
      return { success: false, error: e?.message }
    }
  },

  async claimAllBattlePassLevels(): Promise<{ success: boolean; claimed?: any[]; error?: string }> {
    if (!isSupabaseConfigured()) return { success: false, error: 'Supabase no configurado' }
    try {
      const { data, error } = await (supabase.rpc as any)('claim_all_battle_pass_levels')
      if (error) {
        logError('claimAllBattlePassLevels', error)
        return { success: false, error: error.message }
      }
      return data
    } catch (e: any) {
      logError('claimAllBattlePassLevels', e)
      return { success: false, error: e?.message }
    }
  },

  /**
   * Pide el cofre de victoria.
   *
   * LÍMITE CONOCIDO: la partida se juega en el navegador, así que el servidor no
   * puede comprobar que se ganó. Lo acotan el tope de 4 huecos, las 2–12 h de
   * espera por cofre, y un cofre como máximo cada 2 minutos. Queda cerrado del
   * todo cuando el servidor resuelva las partidas.
   */
  async awardVictoryChest(): Promise<{
    awarded: boolean
    slotId?: number
    durationHours?: number
    arenaLevel?: number
    reason?: string
  }> {
    if (!isSupabaseConfigured()) return { awarded: false, reason: 'sin_supabase' }
    try {
      const { data, error } = await (supabase.rpc as any)('award_victory_chest')
      if (error) {
        logError('awardVictoryChest', error)
        return { awarded: false, reason: error.message }
      }
      return data
    } catch (e: any) {
      logError('awardVictoryChest', e)
      return { awarded: false, reason: e?.message }
    }
  },

  /** Inventario completo: instancias, copias, desbloqueadas y sobres. */
  async myInventory(): Promise<{
    instances: {
      instanceId: string
      plantId: string
      level: number
      statRolls: string[]
      isBase: boolean
      isInDeck: boolean
      deckSlot: number | null
      isListed: boolean
      obtainedAt: number
    }[]
    copies: Record<string, number>
    unlocked: string[]
    packs: { rowId: string; packId: string; source: string; obtainedAt: number }[]
  } | null> {
    if (!isSupabaseConfigured()) return null
    try {
      const { data, error } = await (supabase.rpc as any)('my_inventory')
      if (error) {
        logError('myInventory', error)
        return null
      }
      return data
    } catch (e) {
      logError('myInventory', e)
      return null
    }
  },

  /** Compra sobres. El precio y el tope de cantidad los pone el servidor. */
  async buyPacks(packId: string, qty: number = 1): Promise<{
    success: boolean
    packIds?: string[]
    spent?: number
    error?: string
  }> {
    if (!isSupabaseConfigured()) return { success: false, error: 'Supabase no configurado' }
    try {
      const { data, error } = await (supabase.rpc as any)('buy_packs', {
        p_pack_id: packId,
        p_qty: qty,
      })
      if (error) {
        logError('buyPacks', error)
        return { success: false, error: error.message }
      }
      return data
    } catch (e: any) {
      logError('buyPacks', e)
      return { success: false, error: e?.message }
    }
  },

  /** Compra oro. El cliente manda sólo el id del paquete: la cantidad y el
   *  precio salen de la base, no del navegador. */
  async buyGold(packageId: string): Promise<{
    success: boolean
    goldAdded?: number
    spent?: number
    error?: string
  }> {
    if (!isSupabaseConfigured()) return { success: false, error: 'Supabase no configurado' }
    try {
      const { data, error } = await (supabase.rpc as any)('buy_gold', {
        p_package_id: packageId,
      })
      if (error) {
        logError('buyGold', error)
        return { success: false, error: error.message }
      }
      return data
    } catch (e: any) {
      logError('buyGold', e)
      return { success: false, error: e?.message }
    }
  },

  async buyVipPass(): Promise<{
    success: boolean
    spent?: number
    energyAdded?: number
    energyCurrent?: number
    error?: string
  }> {
    if (!isSupabaseConfigured()) return { success: false, error: 'Supabase no configurado' }
    try {
      const { data, error } = await (supabase.rpc as any)('buy_vip_pass')
      if (error) {
        logError('buyVipPass', error)
        return { success: false, error: error.message }
      }
      return data
    } catch (e: any) {
      logError('buyVipPass', e)
      return { success: false, error: e?.message }
    }
  },

  buyEnergyPackLocal(packId: string): {
    success: boolean
    packId?: string
    energyAdded?: number
    energyCurrent?: number
    spentGems?: number
    newGemsBalance?: number
    error?: string
  } {
    let costGems = 0
    let addEnergy = 0

    if (packId === 'energy_3') {
      costGems = 200
      addEnergy = 3
    } else if (packId === 'energy_5') {
      costGems = 300
      addEnergy = 5
    } else if (packId === 'energy_12') {
      costGems = 600
      addEnergy = 12
    } else {
      return { success: false, error: 'Paquete de energía inválido' }
    }

    try {
      const currentTokens = parseFloat(localStorage.getItem('plant_arena_user_tokens') || '0')
      if (currentTokens < costGems) {
        return {
          success: false,
          error: `Gemas insuficientes. Tienes ${currentTokens} 💎 y requieres ${costGems} 💎`,
        }
      }

      const currentEnergy = parseInt(localStorage.getItem('plant_arena_player_energy') || '20', 10)
      const newEnergy = currentEnergy + addEnergy
      const newBalance = Math.max(0, currentTokens - costGems)

      localStorage.setItem('plant_arena_user_tokens', String(newBalance))
      localStorage.setItem('plant_arena_player_energy', String(newEnergy))

      return {
        success: true,
        packId,
        energyAdded: addEnergy,
        energyCurrent: newEnergy,
        spentGems: costGems,
        newGemsBalance: newBalance,
      }
    } catch (e: any) {
      return { success: false, error: e?.message || 'Error en compra local' }
    }
  },

  async buyEnergyPack(packId: string): Promise<{
    success: boolean
    packId?: string
    energyAdded?: number
    energyCurrent?: number
    spentGems?: number
    newGemsBalance?: number
    error?: string
  }> {
    if (!isSupabaseConfigured()) {
      return this.buyEnergyPackLocal(packId)
    }
    try {
      const { data, error } = await (supabase.rpc as any)('buy_energy_pack', {
        p_pack_id: packId,
      })
      if (error) {
        if (
          error.code === 'PGRST202' ||
          error.message?.includes('buy_energy_pack') ||
          error.message?.includes('schema cache') ||
          error.code === '42501' ||
          error.message?.includes('No autenticado')
        ) {
          return this.buyEnergyPackLocal(packId)
        }
        logError('buyEnergyPack', error)
        return { success: false, error: error.message }
      }
      return data
    } catch (e: any) {
      logError('buyEnergyPack', e)
      return this.buyEnergyPackLocal(packId)
    }
  },


  /**
   * Consulta el estado de una oferta flash en el servidor (o fallback local).
   */
  async getFlashOfferStatus(offerId: string = 'flash_jalapeno_30'): Promise<{
    success: boolean
    offerId: string
    title: string
    description?: string
    plantId: string
    priceGems: number
    maxPurchasesPerUser: number
    userBought: number
    remainingPurchases: number
    isActive: boolean
    isSoldOut: boolean
    error?: string
  }> {
    const DEFAULT_OFFER = {
      success: true,
      offerId,
      title: 'Oferta Flash: Jalapeño Explosivo',
      description: `¡Consigue hasta 3 unidades de Jalapeño por ${FLASH_OFFER_PRICE_GEMS.toLocaleString()} gemas cada una!`,
      plantId: 'jalapeno',
      priceGems: FLASH_OFFER_PRICE_GEMS,
      maxPurchasesPerUser: 3,
      userBought: 0,
      remainingPurchases: 3,
      isActive: true,
      isSoldOut: false,
    }

    if (!isSupabaseConfigured()) {
      try {
        const savedCount = parseInt(localStorage.getItem(`plant_arena_flash_${offerId}_bought`) || '0', 10)
        const userBought = Number.isFinite(savedCount) ? Math.max(0, savedCount) : 0
        const remainingPurchases = Math.max(0, DEFAULT_OFFER.maxPurchasesPerUser - userBought)
        return {
          ...DEFAULT_OFFER,
          userBought,
          remainingPurchases,
          isSoldOut: remainingPurchases <= 0,
        }
      } catch {
        return DEFAULT_OFFER
      }
    }

    try {
      const { data, error } = await (supabase.rpc as any)('get_flash_offer_status', {
        p_offer_id: offerId,
      })
      if (error) {
        // Fallback local si la función RPC aún no está migrada en la base
        const savedCount = parseInt(localStorage.getItem(`plant_arena_flash_${offerId}_bought`) || '0', 10)
        const userBought = Number.isFinite(savedCount) ? Math.max(0, savedCount) : 0
        const remainingPurchases = Math.max(0, DEFAULT_OFFER.maxPurchasesPerUser - userBought)
        return {
          ...DEFAULT_OFFER,
          userBought,
          remainingPurchases,
          isSoldOut: remainingPurchases <= 0,
        }
      }
      return data || DEFAULT_OFFER
    } catch (e: any) {
      logError('getFlashOfferStatus', e)
      return DEFAULT_OFFER
    }
  },

  /**
   * Garantizador local de compra de oferta flash para entornos sin conexión o con migración pendiente.
   */
  buyFlashOfferLocal(offerId: string = 'flash_jalapeno_30', qty: number = 1): {
    success: boolean
    offerId?: string
    plantId?: string
    quantity?: number
    priceGems?: number
    totalGemsSpent?: number
    userTotalBought?: number
    remainingPurchases?: number
    error?: string
  } {
    try {
      const key = `plant_arena_flash_${offerId}_bought`
      const savedCount = parseInt(localStorage.getItem(key) || '0', 10)
      const currentBought = Number.isFinite(savedCount) ? Math.max(0, savedCount) : 0
      if (currentBought + qty > 3) {
        return {
          success: false,
          error: `Límite alcanzado: máximo 3 compras por usuario (llevas ${currentBought}, intentas ${qty})`,
        }
      }

      const priceGems = FLASH_OFFER_PRICE_GEMS
      const totalGems = priceGems * qty
      const curTokens = parseFloat(localStorage.getItem('plant_arena_user_tokens') || '0')
      if (curTokens < totalGems) {
        return {
          success: false,
          error: `Gemas insuficientes: necesitas ${totalGems} y tienes ${curTokens}`,
        }
      }

      // Deducción local
      const nextTokens = Math.max(0, Number((curTokens - totalGems).toFixed(2)))
      localStorage.setItem('plant_arena_user_tokens', String(nextTokens))

      // Entrega de Jalapeño
      const copiesKey = 'plant_arena_plant_copies'
      let copiesObj: Record<string, number> = {}
      try {
        copiesObj = JSON.parse(localStorage.getItem(copiesKey) || '{}')
      } catch {}
      const prevCopies = copiesObj['jalapeno'] || 0
      copiesObj['jalapeno'] = prevCopies + qty
      localStorage.setItem(copiesKey, JSON.stringify(copiesObj))

      const unlockedKey = 'plant_arena_unlocked_plants'
      let unlockedArr: string[] = []
      try {
        unlockedArr = JSON.parse(localStorage.getItem(unlockedKey) || '[]')
      } catch {}
      if (!unlockedArr.includes('jalapeno')) {
        unlockedArr.push('jalapeno')
        localStorage.setItem(unlockedKey, JSON.stringify(unlockedArr))
      }

      const nextBought = currentBought + qty
      localStorage.setItem(key, String(nextBought))

      return {
        success: true,
        offerId,
        plantId: 'jalapeno',
        quantity: qty,
        priceGems,
        totalGemsSpent: totalGems,
        userTotalBought: nextBought,
        remainingPurchases: Math.max(0, 3 - nextBought),
      }
    } catch (err: any) {
      return { success: false, error: err?.message || 'Error local al comprar' }
    }
  },

  /**
   * Ejecuta la compra de una oferta flash con garantía autoritativa de backend.
   */
  async buyFlashOffer(offerId: string = 'flash_jalapeno_30', qty: number = 1): Promise<{
    success: boolean
    offerId?: string
    plantId?: string
    quantity?: number
    priceGems?: number
    totalGemsSpent?: number
    userTotalBought?: number
    remainingPurchases?: number
    error?: string
  }> {
    if (qty <= 0) return { success: false, error: 'Cantidad inválida' }

    if (!isSupabaseConfigured()) {
      return this.buyFlashOfferLocal(offerId, qty)
    }

    try {
      const { data, error } = await (supabase.rpc as any)('buy_flash_offer', {
        p_offer_id: offerId,
        p_qty: qty,
      })

      if (error) {
        if (
          error.code === 'PGRST202' ||
          error.message?.includes('buy_flash_offer') ||
          error.message?.includes('schema cache')
        ) {
          console.warn('[SupabaseService] buy_flash_offer aún no migrada en Supabase remoto, aplicando garantizador local')
          return this.buyFlashOfferLocal(offerId, qty)
        }
        logError('buyFlashOffer', error)
        return { success: false, error: error.message }
      }

      if (data?.success) {
        try {
          localStorage.setItem(`plant_arena_flash_${offerId}_bought`, String(data.userTotalBought ?? 3))
        } catch {}
      }

      return data
    } catch (e: any) {
      logError('buyFlashOffer', e)
      return { success: false, error: e?.message || 'Error al conectar con el servidor' }
    }
  },

  /** Abre un sobre. El sorteo de rareza lo hace Postgres con su random(), así
   *  que no se puede repetir hasta obtener la carta deseada. */
  async openPack(packRowId: string): Promise<{
    success: boolean
    packId?: string
    drops?: { plantId: string; rarity: string; isNew: boolean }[]
    colosseumTicket?: boolean
    error?: string
  }> {
    if (!isSupabaseConfigured()) return { success: false, error: 'Supabase no configurado' }
    try {
      const { data, error } = await (supabase.rpc as any)('open_pack', {
        p_pack_row_id: packRowId,
      })
      if (error) {
        logError('openPack', error)
        return { success: false, error: error.message }
      }
      return data
    } catch (e: any) {
      logError('openPack', e)
      return { success: false, error: e?.message }
    }
  },

  /** Inventario farming autoritativo. Los consumibles nunca se leen de localStorage. */
  async myFarmingInventory(): Promise<FarmingInventory | null> {
    if (!isSupabaseConfigured()) return null
    try {
      const { data, error } = await (supabase.rpc as any)('my_farming_inventory')
      if (error) {
        // Compatibilidad durante despliegue: una base que aún no tenga la migración
        // simplemente mostrará ceros hasta que se aplique el SQL.
        return null
      }
      return data as FarmingInventory
    } catch {
      return null
    }
  },

  /** Reclama un cofre PvP listo. El servidor genera y persiste los 3 drops. */
  async claimPackSlot(slotIndex: number): Promise<{
    success: boolean
    drops?: PvpRewardDrop[]
    farmingItems?: FarmingInventory
    goldBalance?: number
    alreadyOpened?: boolean
    // Fallback temporal para una base que todavía exponga claim_pack_slot v1.
    plantId?: string
    rarity?: string
    isNew?: boolean
    gold?: number
    error?: string
  }> {
    if (!isSupabaseConfigured()) return { success: false, error: 'Supabase no configurado' }
    try {
      const { data, error } = await (supabase.rpc as any)('claim_pack_slot', {
        p_slot_index: slotIndex,
      })
      if (error) {
        logError('claimPackSlot', error)
        return { success: false, error: error.message }
      }
      return data
    } catch (e: any) {
      logError('claimPackSlot', e)
      return { success: false, error: e?.message }
    }
  },

  /** Abre un cofre al instante pagando oro. El coste lo calcula el servidor con
   *  su propio reloj, no con el del navegador. */
  async instantUnlockPackSlot(slotIndex: number): Promise<{
    success: boolean
    goldSpent?: number
    error?: string
  }> {
    if (!isSupabaseConfigured()) return { success: false, error: 'Supabase no configurado' }
    try {
      const { data, error } = await (supabase.rpc as any)('instant_unlock_pack_slot', {
        p_slot_index: slotIndex,
      })
      if (error) {
        logError('instantUnlockPackSlot', error)
        return { success: false, error: error.message }
      }
      return data
    } catch (e: any) {
      logError('instantUnlockPackSlot', e)
      return { success: false, error: e?.message }
    }
  },

  /** Fusiona: 5 copias + 1000 oro → +1 nivel + una stat elegible al azar. La stat la
   *  sortea el servidor entre las que admite esa planta concreta. */
  async fusePlant(instanceId: string): Promise<{
    success: boolean
    plantId?: string
    previousLevel?: number
    newLevel?: number
    rolledStat?: string
    copiesSpent?: number
    copiesRemaining?: number
    copiesLeft?: number
    goldSpent?: number
    goldBalance?: number
    error?: string
  }> {
    if (!isSupabaseConfigured()) return { success: false, error: 'Supabase no configurado' }
    try {
      const { data, error } = await (supabase.rpc as any)('fuse_plant', {
        p_instance_id: instanceId,
      })
      if (error) {
        logError('fusePlant', error)
        return { success: false, error: error.message }
      }
      return data
    } catch (e: any) {
      logError('fusePlant', e)
      return { success: false, error: e?.message }
    }
  },

  // ---------------------------------------------------------------------------
  // PACK SLOTS (CHESTS) PERSISTENCE
  // ---------------------------------------------------------------------------
  async getUserPackSlots(userId: string): Promise<FreePackSlot[] | null> {
    if (!isSupabaseConfigured()) return null
    try {
      const { data, error } = await supabase
        .from('pack_slots')
        .select('*')
        .eq('user_id', userId)
        .order('slot_index', { ascending: true })
      if (error) return null
      const parsedSlots: FreePackSlot[] = (data || []).map((row: any) => ({
        slotId: Number(row.slot_index),
        status: row.status as FreePackSlot['status'],
        durationHours: Number(row.duration_hours || 1) as FreePackSlot['durationHours'],
        arenaLevel: Number(row.arena_level || 1),
        unlockStartedAt: row.unlock_started_at ? new Date(row.unlock_started_at).getTime() : undefined,
      }))
      return normalizePackSlots(parsedSlots)
    } catch {
      return null
    }
  },

  /**
   * Sincroniza los cofres a través de la RPC que valida el temporizador.
   *
   * El upsert directo se eliminó: pack_slots es de sólo lectura para el
   * cliente porque permitía poner un cofre en 'ready' al instante, o mandar
   * duration_hours = 0. Ahora el servidor impone la duración según el índice,
   * estampa unlock_started_at con su propio reloj, y sólo concede 'ready' si
   * el tiempo transcurrió de verdad.
   *
   * Devuelve los slots autoritativos: adóptalos en lugar del estado local.
   * `rejected` trae los cofres que se intentaron abrir antes de hora.
   */
  async syncPackSlots(slots: FreePackSlot[]): Promise<{
    slots: FreePackSlot[] | null
    rejected: { slotId: number; motivo: string }[]
  }> {
    if (!isSupabaseConfigured()) return { slots: null, rejected: [] }
    try {
      const payload = slots.map((s) => ({
        slotId: s.slotId,
        status: s.status,
        arenaLevel: s.arenaLevel,
      }))
      const { data, error } = await (supabase.rpc as any)('sync_pack_slots', {
        p_slots: payload,
      })
      if (error) {
        logError('syncPackSlots', error)
        return { slots: null, rejected: [] }
      }
      const authoritative: FreePackSlot[] = (data?.slots || []).map((row: any) => ({
        slotId: Number(row.slotId),
        status: row.status as FreePackSlot['status'],
        durationHours: Number(row.durationHours) as FreePackSlot['durationHours'],
        arenaLevel: Number(row.arenaLevel || 1),
        unlockStartedAt: row.unlockStartedAt ? Number(row.unlockStartedAt) : undefined,
      }))
      return { slots: normalizePackSlots(authoritative), rejected: data?.rechazados || [] }
    } catch (e) {
      logError('syncPackSlots', e)
      return { slots: null, rejected: [] }
    }
  },  // ---------------------------------------------------------------------------
  // REFERIDOS
  //
  // Antes de la migración 27 esto no existía: el enlace era «/?ref=<nombre>» y
  // nadie leía ese parámetro, así que un jugador podía repartirlo a cien
  // personas sin que pasara nada. Ahora el enganche, la cuenta y los premios los
  // lleva el servidor; el navegador sólo pinta y pulsa.
  // ---------------------------------------------------------------------------

  /**
   * Engancha al jugador que acaba de entrar con un enlace de invitación.
   *
   * Se llama UNA vez por sesión nueva, en cuanto hay sesión. Devuelve el motivo
   * cuando no se pudo, para poder decírselo en pantalla en lugar de fallar en
   * silencio (que es lo que hacía el botón de compartir de la 25).
   */
  async referralBind(code: string): Promise<{ ok: boolean; motivo?: string }> {
    if (!isSupabaseConfigured()) return { ok: false, motivo: 'sin_supabase' }
    try {
      const { data, error } = await (supabase.rpc as any)('referral_bind', { p_code: code })
      if (error) {
        logError('referralBind', error)
        return { ok: false, motivo: error.message }
      }
      return data ?? { ok: false }
    } catch (e: any) {
      logError('referralBind', e)
      return { ok: false, motivo: e?.message }
    }
  },

  /** Todo el panel de referidos en una llamada. */
  async myReferrals(): Promise<MisReferidos | null> {
    if (!isSupabaseConfigured()) return null
    try {
      const { data, error } = await (supabase.rpc as any)('my_referrals')
      if (error) {
        logError('myReferrals', error)
        return null
      }
      return data
    } catch (e) {
      logError('myReferrals', e)
      return null
    }
  },

  /** Cobra las 100 monedas por cada amigo que ya llegó a las copas. */
  async claimReferralGold(): Promise<{ ok: boolean; oro?: number; amigos?: number; motivo?: string }> {
    if (!isSupabaseConfigured()) return { ok: false, motivo: 'sin_supabase' }
    try {
      const { data, error } = await (supabase.rpc as any)('claim_referral_gold')
      if (error) {
        logError('claimReferralGold', error)
        return { ok: false, motivo: error.message }
      }
      return data ?? { ok: false }
    } catch (e: any) {
      logError('claimReferralGold', e)
      return { ok: false, motivo: e?.message }
    }
  },

  /** Retira las gemas acumuladas por el 5% de comisión en depósitos de referidos */
  async claimReferralDepositGems(): Promise<{ ok: boolean; gemas?: number; depositos_reclamados?: number; motivo?: string }> {
    if (!isSupabaseConfigured()) return { ok: false, motivo: 'sin_supabase' }
    try {
      const { data, error } = await (supabase.rpc as any)('claim_referral_deposit_gems')
      if (error) {
        logError('claimReferralDepositGems', error)
        return { ok: false, motivo: error.message }
      }
      return data ?? { ok: false }
    } catch (e: any) {
      logError('claimReferralDepositGems', e)
      return { ok: false, motivo: e?.message }
    }
  },

  /** Cobra una de las metas de la temporada activa (10 amigos: sobre_10, 35 amigos: gemas_35) */
  async claimReferralReward(kind: 'sobre_10' | 'gemas_35' | 'gemas_25'): Promise<{
    ok: boolean
    gemas?: number
    sobres?: number
    pack_id?: string
    motivo?: string
    tienes?: number
    necesitas?: number
  }> {
    if (!isSupabaseConfigured()) return { ok: false, motivo: 'sin_supabase' }
    try {
      const dbKind = kind === 'gemas_25' ? 'gemas_35' : kind
      const { data, error } = await (supabase.rpc as any)('claim_referral_season_milestone', {
        p_kind: dbKind,
      })
      if (error) {
        // Fallback por compatibilidad si la función vieja seguía llamándose claim_referral_reward
        const fallback = await (supabase.rpc as any)('claim_referral_reward', { p_kind: dbKind })
        if (fallback.error) {
          logError('claimReferralReward', fallback.error)
          return { ok: false, motivo: fallback.error.message }
        }
        return fallback.data ?? { ok: false }
      }
      return data ?? { ok: false }
    } catch (e: any) {
      logError('claimReferralReward', e)
      return { ok: false, motivo: e?.message }
    }
  },

  /** El registro del comercio P2P y las temporadas. Sólo admin. */
  async adminP2pReport(limite = 50): Promise<any | null> {
    if (!isSupabaseConfigured()) return null
    try {
      const { data, error } = await (supabase.rpc as any)('admin_p2p_report', {
        p_limite: limite,
      })
      if (error) {
        logError('adminP2pReport', error)
        return null
      }
      return data
    } catch (e) {
      logError('adminP2pReport', e)
      return null
    }
  },

  /** Cierra la temporada ya, sin esperar los 15 días. Sólo admin. */
  async adminCloseReferralSeason(): Promise<{ cerrada: boolean; total?: number; meta?: number; premiados?: number } | null> {
    if (!isSupabaseConfigured()) return null
    try {
      const { data, error } = await (supabase.rpc as any)('admin_close_referral_season')
      if (error) {
        logError('adminCloseReferralSeason', error)
        return null
      }
      return data
    } catch (e) {
      logError('adminCloseReferralSeason', e)
      return null
    }
  },

  // ── DEPÓSITOS Y RETIROS USDT BEP20 (BNB SMART CHAIN) ─────────────────────────

  /** Registra la wallet personal/self-custody del usuario para depósitos automáticos */
  async registerDepositWallet(walletAddress: string): Promise<{ success: boolean; wallet?: any; error?: string; message?: string }> {
    if (!isSupabaseConfigured()) return { success: false, error: 'NO_SUPABASE' }
    try {
      const { data, error } = await (supabase.rpc as any)('register_deposit_wallet', {
        p_wallet_address: walletAddress,
      })
      if (error) {
        logError('registerDepositWallet', error)
        return { success: false, error: error.code || 'RPC_ERROR', message: error.message }
      }
      return data ?? { success: false }
    } catch (e: any) {
      logError('registerDepositWallet', e)
      return { success: false, error: 'EXCEPTION', message: e?.message }
    }
  },

  /** Obtiene la información de depósito: wallet oficial del juego, contrato USDT y wallet registrada */
  async getDepositInfo(): Promise<{
    success: boolean
    registeredWallet?: { id: string; address: string; normalized: string; status: string; createdAt: string } | null
    treasuryWallet?: string
    tokenContract?: string
    network?: string
    rate?: string
    error?: string
  }> {
    if (!isSupabaseConfigured()) return { success: false, error: 'NO_SUPABASE' }
    try {
      const { data, error } = await (supabase.rpc as any)('get_deposit_info')
      if (error) {
        logError('getDepositInfo', error)
        return { success: false, error: error.message }
      }
      return data ?? { success: false }
    } catch (e: any) {
      logError('getDepositInfo', e)
      return { success: false, error: e?.message }
    }
  },

  /** Gasta gemas consumiendo prioritariamente el saldo no retirable (bonos) y completando con el saldo retirable */
  async spendUserGems(amountGems: number): Promise<{
    success: boolean
    total_paid?: number
    paid_from_locked?: number
    paid_from_withdrawable?: number
    new_total_gems?: number
    new_locked_gems?: number
    new_withdrawable_gems?: number
    error?: string
    message?: string
  }> {
    if (!isSupabaseConfigured()) return { success: false, error: 'NO_SUPABASE' }
    try {
      const { data, error } = await (supabase.rpc as any)('spend_user_gems', {
        p_amount: amountGems,
      })
      if (error) {
        logError('spendUserGems', error)
        return { success: false, error: error.code || 'RPC_ERROR', message: error.message }
      }
      return data ?? { success: false }
    } catch (e: any) {
      logError('spendUserGems', e)
      return { success: false, error: 'EXCEPTION', message: e?.message }
    }
  },

  /** Solicita un retiro con cálculo server-authoritative de comisión del 5% e idempotencia */
  async requestWithdrawal(
    amountGems: number,
    destinationWallet: string,
    idempotencyKey: string
  ): Promise<{
    success: boolean
    alreadyProcessed?: boolean
    withdrawal?: {
      id: string
      requestedGems?: number
      amountGems?: number
      feeGems: number
      netGems: number
      netAmountUsdt: number
      destinationWallet: string
      status: string
      remainingBalance?: number
    }
    error?: string
    message?: string
  }> {
    if (!isSupabaseConfigured()) return { success: false, error: 'NO_SUPABASE', message: 'Servidor no configurado' }
    try {
      const { data, error } = await (supabase.rpc as any)('request_withdrawal', {
        p_amount_gems: amountGems,
        p_destination_wallet: destinationWallet,
        p_idempotency_key: idempotencyKey,
      })
      if (error) {
        logError('requestWithdrawal', error)
        return { success: false, error: error.code || 'RPC_ERROR', message: error.message }
      }
      return data ?? { success: false }
    } catch (e: any) {
      logError('requestWithdrawal', e)
      return { success: false, error: 'EXCEPTION', message: e?.message }
    }
  },

  /** Obtiene el historial de depósitos y retiros del usuario */
  async getFinancialHistory(): Promise<{
    success: boolean
    deposits: Array<{
      id: string
      tx_hash: string
      amount_usdt: number
      amount_gems: number
      sender_address: string
      status: string
      created_at: string
      credited_at?: string
    }>
    withdrawals: Array<{
      id: string
      amount_gems: number
      fee_gems: number
      net_gems: number
      net_amount_usdt: number
      destination_wallet: string
      status: string
      tx_hash?: string
      created_at: string
      completed_at?: string
      failure_reason?: string
    }>
    error?: string
  }> {
    if (!isSupabaseConfigured()) return { success: false, deposits: [], withdrawals: [], error: 'NO_SUPABASE' }
    try {
      const { data, error } = await (supabase.rpc as any)('get_financial_history')
      if (error) {
        logError('getFinancialHistory', error)
        return { success: false, deposits: [], withdrawals: [], error: error.message }
      }
      return data ?? { success: false, deposits: [], withdrawals: [] }
    } catch (e: any) {
      logError('getFinancialHistory', e)
      return { success: false, deposits: [], withdrawals: [], error: e?.message }
    }
  },

  /** Dispara la verificación de nuevos depósitos en blockchain (opcionalmente por txHash) */
  async triggerDepositCheck(txHash?: string): Promise<{ success: boolean; transfersFound?: number; processed?: any[]; error?: string }> {
    if (!isSupabaseConfigured()) return { success: false }
    try {
      const { data, error } = await supabase.functions.invoke('crypto-deposit-detector', {
        method: 'POST',
        body: txHash ? { txHash } : {},
      })
      if (error) {
        return { success: false, error: error.message }
      }
      return data ?? { success: true }
    } catch (e: any) {
      return { success: false, error: e?.message }
    }
  },

  /** Dispara el procesador y firmador automático de retiros en blockchain */
  async triggerWithdrawalProcessor(): Promise<{ success: boolean; processedCount?: number; results?: any[]; error?: string; message?: string }> {
    if (!isSupabaseConfigured()) return { success: false }
    try {
      const { data, error } = await supabase.functions.invoke('crypto-withdraw-processor', {
        method: 'POST',
      })
      if (error) {
        return { success: false, error: error.message }
      }
      return data ?? { success: true }
    } catch (e: any) {
      return { success: false, error: e?.message }
    }
  },

  // ---------------------------------------------------------------------------
  // CÓDIGOS DE RECOMPENSA STREAMER & SOBRES PvP DE RECOMPENSA (JARDÍN)
  // ---------------------------------------------------------------------------
  /**
   * Canjea un código promocional de streamer.
   * PostgreSQL valida la existencia, el estado activo, la expiración, el límite
   * de usos y la unicidad por usuario. Genera un sobre PvP pendiente en el jardín.
   */
  async claimRewardCode(code: string): Promise<{
    success: boolean
    packId?: string
    status?: 'pending'
    arenaLevel?: number
    rewardType?: 'gold' | 'plant' | 'pvp_pack' | 'bundle' | 'probabilistic'
    packType?: string
    goldAmount?: number
    plantId?: string
    rarity?: string
    isNew?: boolean
    message?: string
    error?: string
    errorCode?: 'CODE_NOT_FOUND' | 'CODE_DISABLED' | 'CODE_EXPIRED' | 'CODE_LIMIT_REACHED' | 'CODE_ALREADY_CLAIMED' | 'NOT_AUTHENTICATED' | 'UNKNOWN'
  }> {
    if (!isSupabaseConfigured()) {
      return { success: false, error: 'Supabase no está configurado', errorCode: 'UNKNOWN' }
    }
    const cleanCode = code.trim().toUpperCase()
    if (!cleanCode) {
      return { success: false, error: 'Código inválido', errorCode: 'CODE_NOT_FOUND' }
    }
    try {
      const { data, error } = await (supabase.rpc as any)('claim_reward_code', {
        p_code: cleanCode,
      })
      if (error) {
        logError('claimRewardCode', error)
        const msg = error.message || ''
        let errorCode: 'CODE_NOT_FOUND' | 'CODE_DISABLED' | 'CODE_EXPIRED' | 'CODE_LIMIT_REACHED' | 'CODE_ALREADY_CLAIMED' | 'NOT_AUTHENTICATED' | 'UNKNOWN' = 'UNKNOWN'

        if (msg.includes('CODE_NOT_FOUND')) {
          errorCode = 'CODE_NOT_FOUND'
        } else if (msg.includes('CODE_DISABLED')) {
          errorCode = 'CODE_DISABLED'
        } else if (msg.includes('CODE_EXPIRED')) {
          errorCode = 'CODE_EXPIRED'
        } else if (msg.includes('CODE_LIMIT_REACHED')) {
          errorCode = 'CODE_LIMIT_REACHED'
        } else if (msg.includes('CODE_ALREADY_CLAIMED') || msg.includes('uq_reward_code_user_claim')) {
          errorCode = 'CODE_ALREADY_CLAIMED'
        } else if (msg.includes('NOT_AUTHENTICATED') || msg.includes('No autenticado')) {
          errorCode = 'NOT_AUTHENTICATED'
        }

        return { success: false, error: msg, errorCode }
      }
      return {
        success: Boolean(data?.success),
        packId: data?.packId,
        status: data?.status,
        arenaLevel: data?.arenaLevel,
        rewardType: data?.rewardType,
        goldAmount: data?.goldAmount,
        plantId: data?.plantId,
        rarity: data?.rarity,
        isNew: data?.isNew,
        message: data?.message,
      }
    } catch (e: any) {
      logError('claimRewardCode', e)
      return { success: false, error: e?.message || 'Error de conexión', errorCode: 'UNKNOWN' }
    }
  },

  /** Obtiene la lista de sobres PvP de recompensa activos en el jardín. */
  async getMyRewardPacks(): Promise<PlayerRewardPack[]> {
    if (!isSupabaseConfigured()) return []
    try {
      const { data, error } = await (supabase.rpc as any)('get_my_reward_packs')
      if (error || !data) {
        logError('getMyRewardPacks', error)
        return []
      }
      return (data as any[]).map((row) => ({
        id: String(row.id),
        status: row.status,
        durationHours: row.durationHours ? Number(row.durationHours) : undefined,
        arenaLevel: Number(row.arenaLevel || 1),
        unlockStartedAt: row.unlockStartedAt ? Number(row.unlockStartedAt) : undefined,
        createdAt: Number(row.createdAt || 0),
      }))
    } catch (e) {
      logError('getMyRewardPacks', e)
      return []
    }
  },

  /** Inicia el desbloqueo de un sobre PvP de recompensa en el jardín. */
  async startUnlockRewardPack(packId: string): Promise<{
    success: boolean
    status?: string
    durationHours?: number
    unlockStartedAt?: number
    error?: string
  }> {
    if (!isSupabaseConfigured()) return { success: false, error: 'Supabase no configurado' }
    try {
      const { data, error } = await (supabase.rpc as any)('start_unlock_reward_pack', {
        p_pack_id: packId,
      })
      if (error) {
        logError('startUnlockRewardPack', error)
        return { success: false, error: error.message }
      }
      return data ?? { success: true }
    } catch (e: any) {
      logError('startUnlockRewardPack', e)
      return { success: false, error: e?.message }
    }
  },

  /** Acelera un sobre PvP de recompensa pagando oro calculado por el servidor. */
  async instantUnlockRewardPack(packId: string): Promise<{
    success: boolean
    goldSpent?: number
    goldBalance?: number
    error?: string
  }> {
    if (!isSupabaseConfigured()) return { success: false, error: 'Supabase no configurado' }
    try {
      const { data, error } = await (supabase.rpc as any)('instant_unlock_reward_pack', {
        p_pack_id: packId,
      })
      if (error) {
        logError('instantUnlockRewardPack', error)
        return { success: false, error: error.message }
      }
      return data ?? { success: true }
    } catch (e: any) {
      logError('instantUnlockRewardPack', e)
      return { success: false, error: e?.message }
    }
  },

  /** Reclama y abre un sobre PvP de recompensa listo. Entrega carta + oro. */
  async claimRewardPack(packId: string): Promise<{
    success: boolean
    plantId?: string
    rarity?: string
    isNew?: boolean
    goldReward?: number
    error?: string
  }> {
    if (!isSupabaseConfigured()) return { success: false, error: 'Supabase no configurado' }
    try {
      const { data, error } = await (supabase.rpc as any)('claim_reward_pack', {
        p_pack_id: packId,
      })
      if (error) {
        logError('claimRewardPack', error)
        return { success: false, error: error.message }
      }
      return data ?? { success: true }
    } catch (e: any) {
      logError('claimRewardPack', e)
      return { success: false, error: e?.message }
    }
  },

  /**
   * Obtiene el feed global de transacciones y actividad económica:
   * Ventas de mercado P2P (quién compró a quién), retiros validados (>= $10),
   * compras de sobres/oro en tienda y premios.
   */
  async getGlobalTransactions(limite = 60): Promise<GlobalTransactionItem[]> {
    if (!isSupabaseConfigured()) return []
    try {
      const { data, error } = await (supabase.rpc as any)('get_global_transactions', {
        p_limit: limite,
      })
      if (!error && Array.isArray(data) && data.length > 0) {
        return data as GlobalTransactionItem[]
      }
      if (error) {
        logError('getGlobalTransactions:rpc_fallback', error)
      }
    } catch (e) {
      logError('getGlobalTransactions:exception', e)
    }

    // Fallback resiliente: consultar directamente marketplace_listings cerrados
    try {
      const { data: soldListings } = await supabase
        .from('marketplace_listings')
        .select('id, price_gems, closed_at, buyer_id, seller_id, plant_instance_id')
        .eq('status', 'sold')
        .not('closed_at', 'is', null)
        .order('closed_at', { ascending: false })
        .limit(limite)

      if (!soldListings || soldListings.length === 0) return []

      const userIds = Array.from(
        new Set(
          soldListings
            .flatMap((l: any) => [l.buyer_id, l.seller_id])
            .filter(Boolean)
        )
      )
      const instanceIds = Array.from(
        new Set(
          soldListings
            .map((l: any) => l.plant_instance_id)
            .filter(Boolean)
        )
      )

      const [profilesRes, plantsRes] = await Promise.all([
        userIds.length > 0
          ? supabase.from('profiles').select('id, username').in('id', userIds)
          : Promise.resolve({ data: [] as any[] }),
        instanceIds.length > 0
          ? supabase.from('plant_instances').select('id, plant_id, level, rarity').in('id', instanceIds)
          : Promise.resolve({ data: [] as any[] }),
      ])

      const profilesMap = new Map((profilesRes.data || []).map((p: any) => [p.id, p.username]))
      const plantsMap = new Map((plantsRes.data || []).map((pi: any) => [pi.id, pi]))

      return soldListings.map((l: any) => {
        const buyerName = profilesMap.get(l.buyer_id) || 'Jugador'
        const sellerName = profilesMap.get(l.seller_id) || 'Vendedor'
        const plant = plantsMap.get(l.plant_instance_id)
        return {
          id: l.id,
          type: 'marketplace_sale' as const,
          createdAt: l.closed_at,
          userName: buyerName,
          targetUserName: sellerName,
          title: 'Compra en Mercado P2P',
          description: `${buyerName} compró a ${sellerName}`,
          itemId: plant?.plant_id || null,
          itemLevel: plant?.level || 0,
          itemRarity: plant?.rarity || 'common',
          amountGems: Number(l.price_gems || 0),
          amountUsd: null,
          status: 'completed',
        }
      })
    } catch (err) {
      logError('getGlobalTransactions:fallback_error', err)
      return []
    }
  },

  // ---------------------------------------------------------------------------
  // ÁRBOL MADRE (MOTHER TREE) UPGRADES & FEEDING
  // ---------------------------------------------------------------------------
  async getMotherTreeState(): Promise<{
    success: boolean
    treeLevel: number
    treeXp: number
    nextLevelXp: number
    hpBonus: number
    error?: string
  }> {
    if (!isSupabaseConfigured()) {
      try {
        const raw = localStorage.getItem('plant_arena_mother_tree')
        if (raw) return JSON.parse(raw)
      } catch {}
      return { success: true, treeLevel: 0, treeXp: 0, nextLevelXp: 100, hpBonus: 0 }
    }

    try {
      const { data, error } = await (supabase.rpc as any)('get_tree_state')
      if (!error && data?.success) {
        try {
          localStorage.setItem('plant_arena_mother_tree', JSON.stringify(data))
        } catch {}
        return data
      }
    } catch (_) {}

    try {
      const { data: userData } = await supabase.auth.getUser()
      if (userData?.user?.id) {
        const { data: prof } = await supabase
          .from('profiles')
          .select('tree_level, tree_xp')
          .eq('id', userData.user.id)
          .maybeSingle()
        if (prof) {
          const lvl = Number((prof as any).tree_level) || 0
          const xp = Number((prof as any).tree_xp) || 0
          const req = [500, 1200, 1800, 2500, 3000, 0][lvl] ?? 500
          const res = {
            success: true,
            treeLevel: lvl,
            treeXp: xp,
            nextLevelXp: req,
            hpBonus: lvl * 50,
          }
          try {
            localStorage.setItem('plant_arena_mother_tree', JSON.stringify(res))
          } catch {}
          return res
        }
      }
    } catch (_) {}

    try {
      const raw = localStorage.getItem('plant_arena_mother_tree')
      if (raw) return JSON.parse(raw)
    } catch {}

    return { success: true, treeLevel: 0, treeXp: 0, nextLevelXp: 500, hpBonus: 0 }
  },

  async feedMotherTree(
    resource: 'water' | 'fertilizer' | 'gold' | 'gems',
    amount: number
  ): Promise<{
    success: boolean
    treeLevel?: number
    treeXp?: number
    nextLevelXp?: number
    hpBonus?: number
    xpGained?: number
    leveledUp?: boolean
    goldBalance?: number
    gemsBalance?: number
    farmingInventory?: any
    error?: string
  }> {
    if (!isSupabaseConfigured()) {
      return { success: false, error: 'Supabase no configurado' }
    }

    try {
      const { data, error } = await (supabase.rpc as any)('nutrir_arbol', {
        p_resource: resource,
        p_amount: amount,
      })

      if (error) {
        logError('feedMotherTree', error)
        return { success: false, error: error.message }
      }

      if (data?.success) {
        try {
          localStorage.setItem('plant_arena_mother_tree', JSON.stringify(data))
        } catch {}
      }

      return data
    } catch (e: any) {
      logError('feedMotherTree', e)
      return { success: false, error: e?.message || 'Error al alimentar el Árbol Madre' }
    }
  },
}

export interface GlobalTransactionItem {
  id: string
  type: 'marketplace_sale' | 'withdrawal' | 'shop_pack' | 'shop_gold' | 'lottery_win' | 'reward_code' | 'tournament_reward' | string
  createdAt: string
  userName: string
  targetUserName?: string | null
  title: string
  description: string
  itemId?: string | null
  itemLevel?: number | null
  itemRarity?: string | null
  amountGems?: number | null
  amountUsd?: number | null
  status: string
}

export const supabaseService = SupabaseService


