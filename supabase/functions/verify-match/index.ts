import { createClient } from 'npm:@supabase/supabase-js@2'
import {
  recalcularGanadorAutoritativo,
  type DatosDeRepeticion,
  type JugadaGrabada,
} from '../../../src/engine/replay.ts'
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
  player2_id: string
  p1_deck: unknown
  p2_deck: unknown
  server_winner_id: string | null
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

function payloadAuditoria(resultado: ReturnType<typeof recalcularGanadorAutoritativo>) {
  return {
    engineVersion: 'auth-v1',
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

    // Este cliente jamás sale al navegador. service_role puede leer el registro y
    // llamar las RPC de liquidación que están revocadas para authenticated.
    const admin = createClient(url, serviceRole, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    adminForCatch = admin

    const authHeader = req.headers.get('Authorization') ?? ''
    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    if (!token) return json({ ok: false, error: 'unauthorized' }, 401)

    const { data: authData, error: authError } = await admin.auth.getUser(token)
    if (authError || !authData.user) {
      return json({ ok: false, error: 'unauthorized' }, 401)
    }
    const uid = authData.user.id

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
          'id,mode,seed,status,settled_at,created_at,started_at,engine_version,verification_status,verification_note,player1_id,player2_id,p1_deck,p2_deck,server_winner_id',
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
    if (uid !== room.player1_id && uid !== room.player2_id) {
      return json({ ok: false, error: 'forbidden' }, 403)
    }

    if (room.engine_version !== 'auth-v1') {
      return json({ ok: false, error: 'legacy_room_not_verifiable' }, 409)
    }

    if (room.settled_at) {
      return json({
        ok: true,
        status: 'settled',
        winnerId: room.server_winner_id,
        roomStatus: room.status,
        verificationStatus: room.verification_status,
      })
    }

    if (room.verification_status === 'failed') {
      return json({
        ok: false,
        status: 'failed',
        reviewRequired: true,
        note: room.verification_note,
      })
    }

    // ── PASADA 1: NO BLOQUEA ────────────────────────────────────────────────
    // Evita que alguien invoque esta función al segundo 5 y congele la partida.
    let acciones = await cargarAcciones()
    let resultado = recalcularGanadorAutoritativo(aDatos(room, acciones))
    const inicio = room.started_at ?? room.created_at
    let serverTick = ticServidor(inicio)

    // Para una acción ilegal unilateral el resultado es un forfeit. Puede cerrarse
    // en cuanto el servidor ya alcanzó esa intención, sin simular 5:30 completos.
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
    lockedRoomId = roomId

    // Desde begin_match_verification, submit_match_action rechaza nuevas jugadas.
    // Volvemos a leer para incluir cualquier INSERT que terminara justo antes del lock.
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

    // Una acción llegada durante la gracia pudo salvar una base y extender la
    // batalla. En ese caso abrimos la sala otra vez, nunca decidimos por un futuro
    // que todavía no ocurrió.
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

    const audit = payloadAuditoria(resultado)

    if (resultado.ganador === 1 || resultado.ganador === 2) {
      const winnerId = resultado.ganador === 1 ? room.player1_id : room.player2_id
      const { data, error } = await admin.rpc('settle_verified_match', {
        p_room_id: roomId,
        p_winner_id: winnerId,
        p_payload: audit,
      })
      if (error) throw new Error(`settle_failed:${error.message}`)
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
      const { data, error } = await admin.rpc('settle_verified_draw', {
        p_room_id: roomId,
        p_payload: audit,
      })
      if (error) throw new Error(`draw_settle_failed:${error.message}`)
      lockedRoomId = null
      return json({ ok: true, status: 'verified_draw', settlement: data })
    }

    // Fail closed. Aquí NO hay refund, NO hay ELO y NO hay payout.
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

    // Si ocurrió un fallo DESPUÉS de congelar la sala, no la dejamos atrapada en
    // `verifying` ni reabrimos acciones. Marcamos revisión manual y conservamos
    // cualquier escrow retenido: fail closed.
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
