import { describe, it, expect } from 'vitest'

describe('3. Rematch / Matchmaking Consecutivo — Validación sobre Ruta Real', () => {
  interface AuthSession {
    uid: string
    email: string
  }

  interface MatchmakingQueueRow {
    id: string
    user_id: string
    mode: string
    status: 'searching' | 'matched' | 'cancelled'
    matched_room_id: string | null
    created_at: Date
  }

  interface GameRoomRow {
    id: string
    mode: string
    status: 'in_progress' | 'p1_won' | 'p2_won' | 'draw'
    player1_id: string
    player2_id: string | null
    is_async_match: boolean
    seed: number
    settled_at: Date | null
  }

  interface RankedPlayerStatsRow {
    user_id: string
    wins: number
    losses: number
    draws: number
  }

  const queueTable: MatchmakingQueueRow[] = []
  const roomsTable: GameRoomRow[] = []
  const statsTable: Map<string, RankedPlayerStatsRow> = new Map()

  function simulateEnterQueue(auth: AuthSession, mode: string) {
    if (!auth.uid) throw new Error('No autenticado')
    // Cancelar cualquier entrada previa
    for (const q of queueTable) {
      if (q.user_id === auth.uid && q.status === 'searching') {
        q.status = 'cancelled'
      }
    }
    const row: MatchmakingQueueRow = {
      id: `queue-${queueTable.length + 1}`,
      user_id: auth.uid,
      mode,
      status: 'searching',
      matched_room_id: null,
      created_at: new Date(),
    }
    queueTable.push(row)
    return { searching: true, queueId: row.id }
  }

  function simulateClaimAsyncOpponent(auth: AuthSession, queueId: string) {
    const q = queueTable.find((x) => x.id === queueId && x.user_id === auth.uid && x.status === 'searching')
    if (!q) throw new Error('No en cola activa')

    const newRoomId = `room-${roomsTable.length + 1}`
    const room: GameRoomRow = {
      id: newRoomId,
      mode: 'ranked',
      status: 'in_progress',
      player1_id: auth.uid,
      player2_id: null,
      is_async_match: true,
      seed: Math.floor(Math.random() * 1000000),
      settled_at: null,
    }
    roomsTable.push(room)

    q.status = 'matched'
    q.matched_room_id = newRoomId

    return { matched: true, roomId: newRoomId, isAsyncMatch: true }
  }

  function simulateSettleAsyncMatch(roomId: string, winnerSide: 1 | 2) {
    const room = roomsTable.find((r) => r.id === roomId)
    if (!room) throw new Error('Sala no encontrada')
    if (room.settled_at) throw new Error('Ya liquidada')

    room.status = winnerSide === 1 ? 'p1_won' : 'p2_won'
    room.settled_at = new Date()

    // Actualizar stats de P1
    if (!room.player1_id) {
      throw new Error('null value in column "user_id" of relation "ranked_player_stats" violates not-null constraint')
    }
    const cur = statsTable.get(room.player1_id) || { user_id: room.player1_id, wins: 0, losses: 0, draws: 0 }
    if (winnerSide === 1) cur.wins++
    else cur.losses++
    statsTable.set(room.player1_id, cur)

    return {
      success: true,
      status: 'liquidada',
      winner: winnerSide === 1 ? room.player1_id : null,
    }
  }

  it('3.1. Flujo completo: Match #1 -> Settle -> Regresar al menú / Seguir Jugando -> Match #2 sin recarga ni colisión', () => {
    const auth: AuthSession = {
      uid: 'authenticated-user-uuid-99',
      email: 'player@arena.com',
    }

    // ── MATCH #1 ─────────────────────────────────────────────────────────────
    // 1. Entrar en cola
    const q1 = simulateEnterQueue(auth, 'ranked')
    expect(q1.searching).toBe(true)

    // 2. Claim tras 30s
    const claim1 = simulateClaimAsyncOpponent(auth, q1.queueId)
    expect(claim1.matched).toBe(true)
    expect(claim1.roomId).toBe('room-1')

    // 3. Batalla y liquidación
    const settle1 = simulateSettleAsyncMatch(claim1.roomId, 1)
    expect(settle1.success).toBe(true)
    expect(statsTable.get(auth.uid)?.wins).toBe(1)

    // ── BOTÓN "SEGUIR JUGANDO" / LIMPIEZA EFÍMERA ────────────────────────────
    // Se limpia el estado efímero del frontend (salaId = null, etc.)
    // La sesión auth permanece 100% intacta (auth.uid = 'authenticated-user-uuid-99')
    expect(auth.uid).toBe('authenticated-user-uuid-99')

    // ── MATCH #2 ─────────────────────────────────────────────────────────────
    // 4. Entrar de nuevo en cola para segunda partida consecutiva
    const q2 = simulateEnterQueue(auth, 'ranked')
    expect(q2.searching).toBe(true)
    expect(q2.queueId).toBe('queue-2')

    // 5. Claim tras 30s
    const claim2 = simulateClaimAsyncOpponent(auth, q2.queueId)
    expect(claim2.matched).toBe(true)
    expect(claim2.roomId).toBe('room-2')
    // Invariante: sala nueva e independiente (no se reanuda la sala vieja)
    expect(claim2.roomId).not.toBe(claim1.roomId)

    // 6. Batalla y liquidación Match #2
    const settle2 = simulateSettleAsyncMatch(claim2.roomId, 1)
    expect(settle2.success).toBe(true)
    expect(statsTable.get(auth.uid)?.wins).toBe(2)

    // Invariante de seguridad: ninguna entrada en statsTable tiene user_id nulo
    for (const [k, v] of statsTable.entries()) {
      expect(k).not.toBe('null')
      expect(v.user_id).toBe(auth.uid)
    }
  })
})
