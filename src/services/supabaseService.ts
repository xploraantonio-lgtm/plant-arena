import { supabase, isSupabaseConfigured } from '../lib/supabaseClient'
import type { Database } from '../types/database.types'
import type { FreePackSlot } from '../utils/freePackManager'

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
export type EditableProfileFields = Pick<ProfileUpdate, 'username' | 'avatar_id' | 'country'>

/** Las llamadas a Supabase no lanzan excepción: devuelven `{ error }`. Cuando
 *  eso se descarta, un permiso denegado o una política que rechaza es
 *  indistinguible de "no hay datos". Todo error pasa por aquí. */
/** Columnas de profiles que puede leer cualquiera, incluido un visitante sin
 *  sesión. El servidor revoca a `anon` el SELECT del resto (saldos, código de
 *  referido), así que un `select('*')` desde la landing devuelve 401. Los
 *  rankings piden sólo esto, y de paso dejan de exponer el saldo ajeno. */
const PUBLIC_PROFILE_COLUMNS =
  'id, username, avatar_id, country, elo_rating, colosseum_current_streak, colosseum_max_streak, created_at'

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
    gold_balance: number
    colosseum_tickets: number
    elo_rating: number
    has_vip_pass: boolean
    claimed_vip_levels: number[]
    colosseum_current_streak: number
    colosseum_max_streak: number
  } | null> {
    if (!isSupabaseConfigured()) return null
    try {
      const { data, error } = await (supabase.rpc as any)('my_balance')
      if (error) {
        logError('myBalance', error)
        return null
      }
      return data
    } catch (e) {
      logError('myBalance', e)
      return null
    }
  },

  // ---------------------------------------------------------------------------
  // GLOBAL RANKING & LEADERBOARDS (REAL DATA)
  // ---------------------------------------------------------------------------
  async getGlobalLeaderboard(limit: number = 50): Promise<ProfileRow[]> {
    if (!isSupabaseConfigured()) return []
    try {
      // De la VISTA, no de la tabla: la vista ya deja fuera a las cuentas
      // marcadas como que no compiten (la del dueño, las de prueba). La regla vive
      // en el servidor a propósito: si la pusiera el cliente, bastaría con no
      // ponerla para volver a salir en la clasificación.
      const { data, error } = await supabase
        .from('leaderboard')
        .select(PUBLIC_PROFILE_COLUMNS)
        .order('elo_rating', { ascending: false })
        .limit(limit)
      if (error) {
        logError('getGlobalLeaderboard', error)
        return []
      }
      return (data || []) as unknown as ProfileRow[]
    } catch (e) {
      logError('getGlobalLeaderboard', e)
      return []
    }
  },

  async getUserRank(userElo: number): Promise<number> {
    if (!isSupabaseConfigured()) return 1
    try {
      // 'id' y no '*': con head:true PostgREST sigue resolviendo la lista de
      // columnas, y '*' incluye las que anon no puede leer.
      // Contra la vista, igual que la clasificación: si contara sobre la tabla,
      // el puesto incluiría a las cuentas excluidas y no cuadraría con la lista
      // que el jugador ve justo al lado.
      const { count, error } = await supabase
        .from('leaderboard')
        .select('id', { count: 'exact', head: true })
        .gt('elo_rating', userElo)
      if (error) {
        logError('getUserRank', error)
        return 1
      }
      return (count ?? 0) + 1
    } catch (e) {
      logError('getUserRank', e)
      return 1
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
   * `ghostAvailable` sólo se pone en ranked, y hoy no hace nada: marca el momento
   * en que tocaría ofrecer un fantasma, que llegará con las repeticiones.
   */
  async pollMatchmaking(): Promise<{
    matched: boolean
    roomId?: string
    searching?: boolean
    waitedSeconds?: number
    mode?: string
    timeoutSeconds?: number | null
    ghostAvailable?: boolean
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
      kind: 'plant' | 'dig'
      plantId?: string | null
      lane: number
      col?: number | null
    }
  ): Promise<{ ok?: boolean; serverTick?: number; error?: string }> {
    if (!isSupabaseConfigured()) return { error: 'sin_supabase' }
    try {
      const { data, error } = await (supabase.rpc as any)('submit_match_action', {
        p_room_id: roomId,
        p_seq: accion.seq,
        p_tick: accion.tick,
        p_kind: accion.kind,
        p_plant: accion.plantId ?? null,
        p_lane: accion.lane,
        p_col: accion.col ?? null,
      })
      if (error) {
        logError('submitMatchAction', error)
        return { error: error.message }
      }
      return data
    } catch (e: any) {
      logError('submitMatchAction', e)
      return { error: e?.message }
    }
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
    kind: string
    plantId: string | null
    lane: number
    col: number | null
  }>> {
    if (!isSupabaseConfigured()) return []
    try {
      const { data, error } = await (supabase.rpc as any)('match_actions_since', {
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
      kind: string
      plant_id: string | null
      lane: number
      col: number | null
    }) => void
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
      .subscribe()

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
    player2_id: string
    seed: number
    p1_deck: unknown
    p2_deck: unknown
    colosseum_bet: number
    status: string
  } | null> {
    if (!isSupabaseConfigured()) return null
    try {
      const { data, error } = await supabase
        .from('game_rooms')
        .select('id, mode, player1_id, player2_id, seed, p1_deck, p2_deck, colosseum_bet, status')
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
   * Reporta quién ganó la partida. Sustituye a resolveColosseumMatch, que
   * dejaba al cliente declarar el ganador y cobrar.
   *
   * El pago sólo ocurre cuando AMBOS jugadores reportan el mismo ganador:
   *   status 'esperando_al_rival'   → tu reporte quedó registrado
   *   status 'resultado_en_disputa' → no coinciden, no se paga a nadie
   *   status 'liquidada'            → pagado, `payout` trae el importe
   */
  async reportMatchResult(
    roomId: string,
    winnerId: string
  ): Promise<{ success: boolean; status?: string; payout?: number; error?: string }> {
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
      return data as { success: boolean; status?: string; payout?: number }
    } catch (e: any) {
      logError('reportMatchResult', e)
      return { success: false, error: e?.message }
    }
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
  // REALTIME MATCHMAKING
  // ---------------------------------------------------------------------------
  async enterMatchmakingQueue(
    userId: string,
    mode: 'ranked' | 'friendly' | 'colosseum' | 'tournament',
    userElo: number,
    extra?: { tournamentId?: string; colosseumBet?: number; roomCode?: string }
  ): Promise<string | null> {
    if (!isSupabaseConfigured()) return null
    try {
      const { data, error } = await (supabase.from('matchmaking_queue') as any)
        .insert({
          user_id: userId,
          mode,
          user_elo: userElo,
          tournament_id: extra?.tournamentId || null,
          colosseum_bet: extra?.colosseumBet || null,
          room_code: extra?.roomCode || null,
          status: 'searching',
        })
        .select('id')
        .maybeSingle()
      if (error || !data) return null
      return data.id as string
    } catch {
      return null
    }
  },

  async leaveMatchmakingQueue(queueId: string): Promise<boolean> {
    if (!isSupabaseConfigured()) return false
    try {
      const { error } = await (supabase.from('matchmaking_queue') as any)
        .update({ status: 'cancelled' })
        .eq('id', queueId)
      return !error
    } catch {
      return false
    }
  },

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

  /** Abre una ronda. Sólo administrador. El secreto lo genera el servidor y no
   *  se devuelve: ni quien la abre puede conocerlo. */
  async adminOpenSecretCodeRound(opts?: {
    prizePool?: number
    prize1st?: number
    prize2nd?: number
    prize3rd?: number
    freeAttempts?: number
  }): Promise<{
    success: boolean
    roundId?: string
    roundNumber?: number
    error?: string
  }> {
    if (!isSupabaseConfigured()) return { success: false, error: 'Supabase no configurado' }
    try {
      const { data, error } = await (supabase.rpc as any)('admin_open_secret_code_round', {
        p_prize_pool: opts?.prizePool ?? 20,
        p_prize_1st: opts?.prize1st ?? 10,
        p_prize_2nd: opts?.prize2nd ?? 6,
        p_prize_3rd: opts?.prize3rd ?? 4,
        p_free_attempts: opts?.freeAttempts ?? 3,
      })
      if (error) {
        logError('adminOpenSecretCodeRound', error)
        return { success: false, error: error.message }
      }
      return data
    } catch (e: any) {
      logError('adminOpenSecretCodeRound', e)
      return { success: false, error: e?.message }
    }
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
    try {
      const { data, error } = await (supabase.rpc as any)('admin_close_secret_code_round', {
        p_settle: settle,
      })
      if (error) {
        logError('adminCloseSecretCodeRound', error)
        return { success: false, error: error.message }
      }
      return data
    } catch (e: any) {
      logError('adminCloseSecretCodeRound', e)
      return { success: false, error: e?.message }
    }
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

  /** Guarda todos los sectores de la ruleta y valida que los pesos sumen 100 */
  async adminSaveLotterySectors(sectors: Array<{
    sectorId: string
    weight: number
    isActive: boolean
    gemsAmount?: number | null
    goldAmount?: number | null
    packQty?: number | null
    plantQty?: number | null
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

  async buyVipPass(): Promise<{ success: boolean; spent?: number; error?: string }> {
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

  /** Reclama un cofre listo. El servidor vuelve a comprobar el temporizador. */
  async claimPackSlot(slotIndex: number): Promise<{
    success: boolean
    plantId?: string
    rarity?: string
    isNew?: boolean
    /** Oro extra del cofre, según su duración (2h→10 … 12h→60). */
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

  /** Fusiona: 5 copias → +1 nivel + una stat elegible al azar. La stat la
   *  sortea el servidor entre las que admite esa planta concreta. */
  async fusePlant(instanceId: string): Promise<{
    success: boolean
    newLevel?: number
    rolledStat?: string
    copiesLeft?: number
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
      if (error || !data || data.length === 0) return null
      return data.map((row: any) => ({
        slotId: Number(row.slot_index),
        status: row.status as FreePackSlot['status'],
        durationHours: Number(row.duration_hours) as FreePackSlot['durationHours'],
        arenaLevel: Number(row.arena_level || 1),
        unlockStartedAt: row.unlock_started_at ? new Date(row.unlock_started_at).getTime() : undefined,
      }))
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
      return { slots: authoritative, rejected: data?.rechazados || [] }
    } catch (e) {
      logError('syncPackSlots', e)
      return { slots: null, rejected: [] }
    }
  },
}
