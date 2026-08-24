import { createClient } from 'npm:@supabase/supabase-js@2'
import {
  recalcularGanadorAutoritativo,
  type DatosDeRepeticion,
  type JugadaGrabada,
} from '../../../src/engine/replay.ts'
import {
  simulateAsyncMatch,
} from '../../../src/engine/asyncOpponent.ts'
import {
  validarMazoAsyncRanked,
  normalizarAccionesDbParaSimulacion,
} from '../../../src/engine/asyncP1History.ts'
import { TICK_MS } from '../../../src/engine/time.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// Tras el tic final esperamos ~2 s antes de congelar el registro para dejar que
// terminen de llegar INSERT ya iniciados por los dos clientes.
const GRACE_TICKS = Math.ceil(2000 / TICK_MS)
// Una invocación normal puede esperar aquí sin obligar al navegador a reintentar.
const MAX_INLINE_WAIT_MS = 3000

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

function dormir(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function ticServidor(inicioIso: string): number {
  const inicio = new Date(inicioIso).getTime()
  if (!Number.isFinite(inicio)) return 0
  return Math.max(0, Math.floor((Date.now() - inicio) / TICK_MS))
}

type RoomRow = {
  id: string
  mode: string
  seed: number
  status: string
  settled_at: string | null
  created_at: string
  started_at: string | null
  engine_version: string
  verification_status: string
  verification_note: string | null

  player1_id: string
  player2_id: string | null

  p1_deck: unknown
  p2_deck: unknown

  server_winner_id: string | null

  p1_reported_winner: string | null
  p2_reported_winner: string | null

  is_async_match?: boolean
  async_opponent_id?: string | null
  async_display_name?: string | null
  async_avatar_id?: string | null
  async_rating_snapshot?: number | null
  async_deck_snapshot?: unknown
}

type ActionRow = {
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
}

function aDatos(room: RoomRow, rows: ActionRow[]): DatosDeRepeticion {
  const jugadas: JugadaGrabada[] = rows.map((a) => ({
    id: Number(a.id),
    seq: a.seq,
    de: a.user_id === room.player1_id ? 1 : 2,
    tick: a.tick,
    issuedTick: a.issued_tick,
    kind: a.kind,
    plantId: a.plant_id,
    lane: a.lane,
    col: a.col,
    slot: a.slot,
    targetId: a.target_id,
  }))

  return {
    roomId: room.id,
    mode: room.mode,
    seed: room.seed,
    engineVersion: room.engine_version,
    jugadaEn: room.started_at ?? room.created_at,
    jugador1: { nombre: null, avatar: null, mazo: room.p1_deck },
    jugador2: { nombre: null, avatar: null, mazo: room.p2_deck },
    ganador: null,
    yoSoy: null,
    jugadas,
  }
}

function payloadAuditoria(
  resultado: ReturnType<typeof recalcularGanadorAutoritativo>,
  engineVersion = 'auth-v2'
) {
  return {
    engineVersion,
    winnerSide: resultado.ganador,
    ticks: resultado.tics,
    reason: resultado.motivo,
    consistent: resultado.consistente,
    bases: {
      p1: resultado.baseP1,
      p2: resultado.baseP2,
      p1SeenFromP2: resultado.baseP1VistaP2,
      p2SeenFromP2: resultado.baseP2VistaP2,
    },
    illegalActions: resultado.ilegales.slice(0, 50),
    illegalCount: resultado.ilegales.length,
  }
}

function consensoReportado(
  room: RoomRow
): {
  completo: boolean
  coinciden: boolean
  winnerId: string | null
} {
  const p1 = room.p1_reported_winner
  const p2 = room.p2_reported_winner

  if (!p1 || !p2) {
    return {
      completo: false,
      coinciden: false,
      winnerId: null,
    }
  }

  if (p1 !== p2) {
    return {
      completo: true,
      coinciden: false,
      winnerId: null,
    }
  }

  if (p1 !== room.player1_id && p1 !== room.player2_id) {
    return {
      completo: true,
      coinciden: false,
      winnerId: null,
    }
  }

  return {
    completo: true,
    coinciden: true,
    winnerId: p1,
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405)

  let adminForCatch: ReturnType<typeof createClient> | null = null
  let lockedRoomId: string | null = null

  try {
    const url = Deno.env.get('SUPABASE_URL')
    const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!url || !serviceRole) {
      console.error('Faltan SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY')
      return json({ ok: false, error: 'server_misconfigured' }, 500)
    }

    const admin = createClient(url, serviceRole, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    adminForCatch = admin

    const authHeader = req.headers.get('Authorization') ?? ''
    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    if (!token) return json({ ok: false, error: 'unauthorized' }, 401)

    const internalWorker = token === serviceRole
    let uid: string | null = null

    if (!internalWorker) {
      const { data: authData, error: authError } = await admin.auth.getUser(token)
      if (authError || !authData.user) {
        return json({ ok: false, error: 'unauthorized' }, 401)
      }
      uid = authData.user.id
    }

    let body: { roomId?: string }
    try {
      body = await req.json()
    } catch {
      return json({ ok: false, error: 'invalid_json' }, 400)
    }
    const roomId = body.roomId?.trim()
    if (!roomId) return json({ ok: false, error: 'roomId_required' }, 400)

    const cargarSala = async (): Promise<RoomRow> => {
      const { data, error } = await admin
        .from('game_rooms')
        .select(
          [
            'id',
            'mode',
            'seed',
            'status',
            'settled_at',
            'created_at',
            'started_at',
            'engine_version',
            'verification_status',
            'verification_note',
            'player1_id',
            'player2_id',
            'p1_deck',
            'p2_deck',
            'server_winner_id',
            'p1_reported_winner',
            'p2_reported_winner',
            'is_async_match',
            'async_opponent_id',
            'async_display_name',
            'async_avatar_id',
            'async_rating_snapshot',
            'async_deck_snapshot',
          ].join(','),
        )
        .eq('id', roomId)
        .single()
      if (error || !data) throw new Error(`room_read_failed:${error?.message ?? 'not_found'}`)
      return data as RoomRow
    }

    const cargarAcciones = async (): Promise<ActionRow[]> => {
      const { data, error } = await admin
        .from('match_actions')
        .select('id,user_id,seq,tick,issued_tick,kind,plant_id,lane,col,slot,target_id')
        .eq('room_id', roomId)
        .order('issued_tick', { ascending: true, nullsFirst: false })
        .order('id', { ascending: true })
      if (error) throw new Error(`actions_read_failed:${error.message}`)
      return (data ?? []) as ActionRow[]
    }

    let room = await cargarSala()
    const esAsync = Boolean(room.is_async_match)

    if (!internalWorker) {
      if (esAsync) {
        if (uid !== room.player1_id) return json({ ok: false, error: 'forbidden' }, 403)
      } else {
        if (uid !== room.player1_id && uid !== room.player2_id) {
          return json({ ok: false, error: 'forbidden' }, 403)
        }
      }
    }

    if (room.engine_version !== 'auth-v1' && room.engine_version !== 'auth-v2') {
      return json({ ok: false, error: 'legacy_room_not_verifiable' }, 409)
    }

    if (room.settled_at) {
      const winnerSide = esAsync
        ? (room.status === 'p1_won' ? 1 : room.status === 'p2_won' ? 2 : null)
        : (room.server_winner_id === room.player1_id ? 1 : (room.player2_id && room.server_winner_id === room.player2_id ? 2 : null))

      return json({
        ok: true,
        status: 'settled',
        winnerId: room.server_winner_id,
        winnerSide,
        roomStatus: room.status,
        verificationStatus: room.verification_status,
        isAsyncMatch: esAsync,
      })
    }

    if (room.verification_status === 'failed') {
      return json({
        ok: false,
        status: 'failed',
        reviewRequired: true,
        note: room.verification_note,
        isAsyncMatch: esAsync,
      })
    }

    // =========================================================================
    // CASO 1: PARTIDA ASÍNCRONA (RIVAL SEMILLA RANKED)
    // =========================================================================
    if (esAsync) {
      // 1. Validaciones estructurales previas de la sala
      if (room.player1_id === null || room.player2_id !== null) {
        const auditStructural = {
          engineVersion: room.engine_version,
          isAsyncMatch: true,
          winnerSide: null,
          reason: 'invalid_async_room_structure',
          error: 'player1_id required and player2_id must be null for async matches',
        }
        await admin.rpc('mark_match_verification_failed', {
          p_room_id: roomId,
          p_note: 'invalid_async_room_structure',
          p_details: auditStructural,
        })
        lockedRoomId = null
        return json({ ok: false, status: 'failed', reviewRequired: true, isAsyncMatch: true })
      }

      // 2. Cargar plan privado de acciones del Rival Semilla desde tabla server-only
      const { data: planData, error: planError } = await admin
        .from('ranked_async_room_plans')
        .select('actions_snapshot, protocol_version, async_opponent_id')
        .eq('room_id', roomId)
        .single()

      if (planError || !planData || !planData.actions_snapshot || !Array.isArray(planData.actions_snapshot)) {
        const auditPlanMissing = {
          engineVersion: 'auth-v1',
          isAsyncMatch: true,
          winnerSide: null,
          reason: 'async_plan_missing',
          error: planError?.message ?? 'plan_not_found',
        }
        await admin.rpc('mark_match_verification_failed', {
          p_room_id: roomId,
          p_note: 'async_plan_missing',
          p_details: auditPlanMissing,
        })
        lockedRoomId = null
        return json({
          ok: false,
          status: 'failed',
          reviewRequired: true,
          reason: 'async_plan_missing',
          isAsyncMatch: true,
        })
      }

      if (planData.protocol_version !== 'ranked-async-v1') {
        const auditProtocolMismatch = {
          engineVersion: 'auth-v1',
          isAsyncMatch: true,
          winnerSide: null,
          reason: 'PROTOCOL_VERSION_MISMATCH',
          error: `protocol_version '${String(planData.protocol_version)}' no coincide con 'ranked-async-v1'`,
        }
        await admin.rpc('mark_match_verification_failed', {
          p_room_id: roomId,
          p_note: 'PROTOCOL_VERSION_MISMATCH',
          p_details: auditProtocolMismatch,
        })
        lockedRoomId = null
        return json({
          ok: false,
          status: 'failed',
          reviewRequired: true,
          reason: 'PROTOCOL_VERSION_MISMATCH',
          isAsyncMatch: true,
        })
      }

      if (planData.async_opponent_id !== room.async_opponent_id) {
        const auditSnapshotMismatch = {
          engineVersion: room.engine_version,
          isAsyncMatch: true,
          winnerSide: null,
          reason: 'ASYNC_SNAPSHOT_MISMATCH',
          error: 'async_opponent_id en room no coincide con el plan privado',
        }
        await admin.rpc('mark_match_verification_failed', {
          p_room_id: roomId,
          p_note: 'ASYNC_SNAPSHOT_MISMATCH',
          p_details: auditSnapshotMismatch,
        })
        lockedRoomId = null
        return json({
          ok: false,
          status: 'failed',
          reviewRequired: true,
          reason: 'ASYNC_SNAPSHOT_MISMATCH',
          isAsyncMatch: true,
        })
      }

      // 3. Validar formalmente los mazos snapshot de P1 y P2
      const p1DeckVal = validarMazoAsyncRanked(room.p1_deck)
      const p2DeckVal = validarMazoAsyncRanked(room.async_deck_snapshot)
      if (!p1DeckVal.ok || !p2DeckVal.ok) {
        const auditDeckInvalid = {
          engineVersion: room.engine_version,
          isAsyncMatch: true,
          winnerSide: null,
          reason: !p1DeckVal.ok ? p1DeckVal.reason : p2DeckVal.reason,
          error: !p1DeckVal.ok ? p1DeckVal.details : p2DeckVal.details,
        }
        await admin.rpc('mark_match_verification_failed', {
          p_room_id: roomId,
          p_note: 'invalid_deck_snapshot',
          p_details: auditDeckInvalid,
        })
        lockedRoomId = null
        return json({
          ok: false,
          status: 'failed',
          reviewRequired: true,
          reason: 'invalid_deck_snapshot',
          isAsyncMatch: true,
        })
      }

      const asyncActionsSnapshot = planData.actions_snapshot

      let acciones = await cargarAcciones()
      const inicio = room.started_at ?? room.created_at
      let serverTick = ticServidor(inicio)

      let resAsync = simulateAsyncMatch(
        room.seed,
        room.p1_deck,
        room.async_deck_snapshot,
        normalizarAccionesDbParaSimulacion(acciones),
        asyncActionsSnapshot,
        undefined,
        room.engine_version === 'auth-v1' ? 'auth-v1' : 'auth-v2'
      )

      const ticDecisionAsync = resAsync.p1Ilegal ? 0 : resAsync.tics
      const faltaMsAsync = Math.max(0, (ticDecisionAsync + GRACE_TICKS - serverTick) * TICK_MS)

      if (faltaMsAsync > MAX_INLINE_WAIT_MS && !resAsync.p1Ilegal) {
        return json({
          ok: true,
          status: 'pending',
          retryAfterMs: Math.min(faltaMsAsync, 5000),
          serverTick,
          decisionTick: ticDecisionAsync,
        })
      }

      if (faltaMsAsync > 0 && !resAsync.p1Ilegal) {
        await dormir(faltaMsAsync)
      }

      // Congelar sala
      const { data: inicioVerificacion, error: beginError } = await admin.rpc(
        'begin_match_verification',
        { p_room_id: roomId },
      )
      if (beginError) throw new Error(`begin_verification_failed:${beginError.message}`)

      if (inicioVerificacion?.alreadySettled) {
        room = await cargarSala()
        const settledWinnerSide = room.status === 'p1_won' ? 1 : (room.status === 'p2_won' ? 2 : null)
        return json({
          ok: true,
          status: 'settled',
          winnerId: room.server_winner_id,
          winnerSide: settledWinnerSide,
          roomStatus: room.status,
          verificationStatus: room.verification_status,
          isAsyncMatch: true,
        })
      }
      if (inicioVerificacion?.locked) {
        return json({ ok: false, status: 'failed', reviewRequired: true, isAsyncMatch: true })
      }
      if (inicioVerificacion?.busy) {
        return json({
          ok: true,
          status: 'pending',
          busy: true,
          retryAfterMs: 1000,
          isAsyncMatch: true,
        })
      }
      lockedRoomId = roomId

      room = await cargarSala()
      acciones = await cargarAcciones()
      resAsync = simulateAsyncMatch(
        room.seed,
        room.p1_deck,
        room.async_deck_snapshot,
        normalizarAccionesDbParaSimulacion(acciones),
        asyncActionsSnapshot,
        undefined,
        room.engine_version === 'auth-v1' ? 'auth-v1' : 'auth-v2'
      )
      serverTick = ticServidor(room.started_at ?? room.created_at)

      const segundoTicDecisionAsync = resAsync.p1Ilegal ? 0 : resAsync.tics
      if (!resAsync.p1Ilegal && serverTick < segundoTicDecisionAsync) {
        await admin.rpc('release_match_verification', {
          p_room_id: roomId,
          p_note: 'late_action_extended_match',
        })
        lockedRoomId = null
        return json({
          ok: true,
          status: 'pending',
          retryAfterMs: Math.min((segundoTicDecisionAsync - serverTick) * TICK_MS, 5000),
          serverTick,
          decisionTick: segundoTicDecisionAsync,
          isAsyncMatch: true,
        })
      }

      // Si el motor determinista no produjo ganador (ej. engine_divergence o no_result sin forfeit),
      // NUNCA liquidar ni quitar ELO: marcar como failed para revisión manual.
      if (resAsync.ganador !== 1 && resAsync.ganador !== 2) {
        const auditAsyncFailed = {
          engineVersion: room.engine_version,
          isAsyncMatch: true,
          winnerSide: null,
          ticks: resAsync.tics,
          reason: resAsync.motivo ?? 'async_no_result',
          p1Illegal: resAsync.p1Ilegal,
          bases: {
            p1: resAsync.baseP1,
            p2: resAsync.baseP2,
          },
          telemetry: {
            intentionsTotal: resAsync.telemetria.intentionsTotal,
            intentionsExecuted: resAsync.telemetria.intentionsExecuted,
            intentionsDropped: resAsync.telemetria.intentionsDropped,
          },
        }

        const { error: failError } = await admin.rpc('mark_match_verification_failed', {
          p_room_id: roomId,
          p_note: resAsync.motivo ?? 'async_no_result',
          p_payload: auditAsyncFailed,
        })
        if (failError) throw new Error(`mark_failed_failed:${failError.message}`)
        lockedRoomId = null

        return json({
          ok: false,
          status: 'failed',
          reviewRequired: true,
          reason: resAsync.motivo ?? 'async_no_result',
          isAsyncMatch: true,
        })
      }

      const winnerSide: 1 | 2 = resAsync.ganador
      const auditAsync = {
        engineVersion: room.engine_version,
        isAsyncMatch: true,
        winnerSide,
        ticks: resAsync.tics,
        reason: resAsync.motivo,
        p1Illegal: resAsync.p1Ilegal,
        bases: {
          p1: resAsync.baseP1,
          p2: resAsync.baseP2,
        },
        telemetry: {
          intentionsTotal: resAsync.telemetria.intentionsTotal,
          intentionsExecuted: resAsync.telemetria.intentionsExecuted,
          intentionsDropped: resAsync.telemetria.intentionsDropped,
        },
      }

      const { data: settleData, error: settleError } = await admin.rpc(
        'settle_verified_async_ranked_match',
        {
          p_room_id: roomId,
          p_winner_side: winnerSide,
          p_payload: auditAsync,
        }
      )
      if (settleError) throw new Error(`settle_async_failed:${settleError.message}`)

      lockedRoomId = null
      return json({
        ok: true,
        status: 'verified',
        winnerSide,
        winnerId: winnerSide === 1 ? room.player1_id : null,
        reason: resAsync.motivo,
        settlement: settleData,
        isAsyncMatch: true,
      })
    }

    // =========================================================================
    // CASO 2: PARTIDA HUMANO VS HUMANO
    // =========================================================================

    // ── PASADA 1: NO BLOQUEA ────────────────────────────────────────────────
    let acciones = await cargarAcciones()
    let resultado = recalcularGanadorAutoritativo(aDatos(room, acciones))
    const inicio = room.started_at ?? room.created_at
    let serverTick = ticServidor(inicio)

    const primerIlegal = resultado.ilegales.length
      ? Math.min(...resultado.ilegales.map((x) => x.issuedTick))
      : null
    const ticDecision =
      resultado.motivo === 'forfeit_p1' || resultado.motivo === 'forfeit_p2'
        ? (primerIlegal ?? resultado.tics)
        : resultado.tics

    const faltaMs = Math.max(0, (ticDecision + GRACE_TICKS - serverTick) * TICK_MS)
    if (faltaMs > MAX_INLINE_WAIT_MS) {
      return json({
        ok: true,
        status: 'pending',
        retryAfterMs: Math.min(faltaMs, 5000),
        serverTick,
        decisionTick: ticDecision,
      })
    }
    if (faltaMs > 0) await dormir(faltaMs)

    const candidatoAConsensoAntesDelLock =
      (room.mode === 'ranked' || room.mode === 'friendly') &&
      resultado.ganador === null &&
      !(resultado.motivo === 'true_draw' && resultado.consistente) &&
      resultado.ilegales.length === 0

    if (candidatoAConsensoAntesDelLock) {
      room = await cargarSala()
      const consensoPrevio = consensoReportado(room)
      if (!consensoPrevio.completo) {
        return json({
          ok: true,
          status: 'pending',
          retryAfterMs: 1000,
          reason: 'waiting_for_second_client_report',
        })
      }
    }

    // ── CONGELAR ────────────────────────────────────────────────────────────
    const { data: inicioVerificacion, error: beginError } = await admin.rpc(
      'begin_match_verification',
      { p_room_id: roomId },
    )
    if (beginError) throw new Error(`begin_verification_failed:${beginError.message}`)

    if (inicioVerificacion?.alreadySettled) {
      room = await cargarSala()
      return json({
        ok: true,
        status: 'settled',
        winnerId: room.server_winner_id,
        roomStatus: room.status,
        verificationStatus: room.verification_status,
      })
    }
    if (inicioVerificacion?.locked) {
      return json({ ok: false, status: 'failed', reviewRequired: true })
    }
    if (inicioVerificacion?.busy) {
      return json({
        ok: true,
        status: 'pending',
        busy: true,
        retryAfterMs: 1000,
      })
    }
    lockedRoomId = roomId

    room = await cargarSala()
    acciones = await cargarAcciones()
    resultado = recalcularGanadorAutoritativo(aDatos(room, acciones))
    serverTick = ticServidor(room.started_at ?? room.created_at)

    const segundoPrimerIlegal = resultado.ilegales.length
      ? Math.min(...resultado.ilegales.map((x) => x.issuedTick))
      : null
    const segundoTicDecision =
      resultado.motivo === 'forfeit_p1' || resultado.motivo === 'forfeit_p2'
        ? (segundoPrimerIlegal ?? resultado.tics)
        : resultado.tics

    if (serverTick < segundoTicDecision) {
      await admin.rpc('release_match_verification', {
        p_room_id: roomId,
        p_note: 'late_action_extended_match',
      })
      lockedRoomId = null
      return json({
        ok: true,
        status: 'pending',
        retryAfterMs: Math.min((segundoTicDecision - serverTick) * TICK_MS, 5000),
        serverTick,
        decisionTick: segundoTicDecision,
      })
    }

    const audit = payloadAuditoria(resultado, room.engine_version)

    if (resultado.ganador === 1 || resultado.ganador === 2) {
      const winnerId = resultado.ganador === 1 ? room.player1_id : room.player2_id
      const payloadAuthoritative = {
        ...audit,
        resolutionSource: 'authoritative_replay',
      }
      const { data, error } = await admin.rpc('settle_verified_match', {
        p_room_id: roomId,
        p_winner_id: winnerId,
        p_payload: payloadAuthoritative,
      })
      if (error) throw new Error(`settle_failed:${error.message}`)

      // Captura automática de Rival Semilla si es una partida Ranked humana verificada
      if (room.mode === 'ranked') {
        try {
          await admin.rpc('capture_ranked_async_opponents_from_room', { p_room_id: roomId })
        } catch (captureErr) {
          console.warn('capture_ranked_async_opponents_from_room fallo:', captureErr)
        }
      }

      lockedRoomId = null
      return json({
        ok: true,
        status: 'verified',
        winnerId,
        winnerSide: resultado.ganador,
        reason: resultado.motivo,
        settlement: data,
      })
    }

    if (resultado.motivo === 'true_draw' && resultado.consistente) {
      const payloadDraw = {
        ...audit,
        resolutionSource: 'authoritative_replay',
      }
      const { data, error } = await admin.rpc('settle_verified_draw', {
        p_room_id: roomId,
        p_payload: payloadDraw,
      })
      if (error) throw new Error(`draw_settle_failed:${error.message}`)
      lockedRoomId = null
      return json({ ok: true, status: 'verified_draw', settlement: data })
    }

    // Fallback de consenso para Ranked / Friendly humanos
    const permiteConsenso =
      room.mode === 'ranked' ||
      room.mode === 'friendly'

    const consenso = consensoReportado(room)

    if (
      permiteConsenso &&
      resultado.ilegales.length === 0
    ) {
      if (!consenso.completo) {
        throw new Error('client_reports_missing_after_verification_lock')
      }

      if (
        consenso.coinciden &&
        consenso.winnerId
      ) {
        const payloadConsenso = {
          ...audit,
          resolutionSource: 'ranked_client_consensus',
          authoritativeReplayReason: resultado.motivo,
          clientReports: {
            p1: room.p1_reported_winner,
            p2: room.p2_reported_winner,
            agreed: true,
          },
        }

        const { data, error } = await admin.rpc(
          'settle_verified_match',
          {
            p_room_id: roomId,
            p_winner_id: consenso.winnerId,
            p_payload: payloadConsenso,
          }
        )

        if (error) {
          throw new Error(`consensus_settle_failed:${error.message}`)
        }

        // NOTA DE SEGURIDAD V1: Las partidas resueltas por consenso de clientes
        // NUNCA son capturadas como semillas de Rivales Semilla (criterio positivo).

        lockedRoomId = null

        return json({
          ok: true,
          status: 'verified',
          winnerId: consenso.winnerId,
          reason: 'ranked_client_consensus',
          settlement: data,
        })
      }
    }

    // Fail closed
    const { error: failError } = await admin.rpc('mark_match_verification_failed', {
      p_room_id: roomId,
      p_note: resultado.motivo,
      p_payload: audit,
    })
    if (failError) throw new Error(`mark_failed_failed:${failError.message}`)
    lockedRoomId = null

    return json({
      ok: false,
      status: 'failed',
      reviewRequired: true,
      reason: resultado.motivo,
    })
  } catch (error) {
    console.error(error)

    if (adminForCatch && lockedRoomId) {
      try {
        await adminForCatch.rpc('mark_match_verification_failed', {
          p_room_id: lockedRoomId,
          p_note: 'edge_internal_error',
          p_payload: {
            engineVersion: 'auth-v1',
            error: error instanceof Error ? error.message.slice(0, 500) : 'unknown_error',
          },
        })
      } catch (secondaryError) {
        console.error('No se pudo marcar la sala como failed:', secondaryError)
      }
    }

    return json({ ok: false, error: 'verification_internal_error' }, 500)
  }
})
