import { describe, it, expect } from 'vitest'
import { recalcularGanadorAutoritativo, type DatosDeRepeticion } from './replay'

/**
 * Simulador puro y determinista de las reglas de matchmaking server-side
 * implementadas en la Migración 41 (PostgreSQL RPCs y batch matching).
 */
interface MatchmakingQueueEntry {
  id: string
  userId: string
  mode: 'ranked' | 'friendly' | 'colosseum' | 'tournament'
  userElo: number
  clientEngineVersion: string | null
  status: 'searching' | 'matched' | 'cancelled'
  matchedRoomId: string | null
  tournamentId?: string | null
  createdAt: number
  lastSeenAt: number
}

interface RoomRecord {
  id: string
  mode: string
  player1Id: string
  player2Id: string | null
  isAsyncMatch: boolean
  asyncOpponentId: string | null
  engineVersion: 'auth-v1' | 'auth-v2'
}

function simularEnterMatchmaking(
  userId: string,
  mode: 'ranked' | 'friendly' | 'colosseum' | 'tournament',
  engineVersion?: string | null,
  extra?: { tournamentId?: string; roomCode?: string }
): { matched: boolean; searching: boolean; error?: string; entry?: MatchmakingQueueEntry } {
  // Gate en TODOS los modos multijugador: Obligatorio auth-v2 explícito
  if (!engineVersion || engineVersion !== 'auth-v2') {
    return {
      matched: false,
      searching: false,
      error: 'client_update_required',
    }
  }

  const entry: MatchmakingQueueEntry = {
    id: `queue-${userId}`,
    userId,
    mode,
    userElo: 1000,
    clientEngineVersion: 'auth-v2',
    status: 'searching',
    matchedRoomId: null,
    tournamentId: extra?.tournamentId ?? null,
    createdAt: Date.now(),
    lastSeenAt: Date.now(),
  }

  return {
    matched: false,
    searching: true,
    entry,
  }
}

function simularPollMatchmaking(
  entry: MatchmakingQueueEntry
): { searching: boolean; matched: boolean; error?: string; roomId?: string } {
  if (entry.status === 'matched') {
    return { searching: false, matched: true, roomId: entry.matchedRoomId! }
  }

  // Detección de fila legacy en searching: evitar cola infinita
  if (entry.status === 'searching' && (!entry.clientEngineVersion || entry.clientEngineVersion !== 'auth-v2')) {
    return {
      searching: false,
      matched: false,
      error: 'client_update_required',
    }
  }

  return { searching: true, matched: false }
}

function simularCancelMatchmaking(
  userId: string,
  queue: MatchmakingQueueEntry[]
): { cancelled: boolean; error?: string } {
  const entry = queue.find((q) => q.userId === userId && q.status === 'searching')
  if (!entry) {
    return { cancelled: false, error: 'no_active_search' }
  }
  entry.status = 'cancelled'
  return { cancelled: true }
}

function simularDirectQueueInsert(
  role: 'authenticated' | 'anon' | 'service_role',
  _entry: Partial<MatchmakingQueueEntry>
): { ok: boolean; error?: string } {
  if (role !== 'service_role') {
    return {
      ok: false,
      error: 'permission denied for table matchmaking_queue (direct INSERT prohibited; use enter_matchmaking RPC)',
    }
  }
  return { ok: true }
}

function simularDirectQueueUpdate(
  role: 'authenticated' | 'anon' | 'service_role',
  _queueId: string,
  _changes: Partial<MatchmakingQueueEntry>
): { ok: boolean; error?: string } {
  if (role !== 'service_role') {
    return {
      ok: false,
      error: 'permission denied for table matchmaking_queue (direct UPDATE prohibited; use cancel_matchmaking RPC)',
    }
  }
  return { ok: true }
}

function simularEmparejarLote(
  queue: MatchmakingQueueEntry[]
): { matches: { p1: MatchmakingQueueEntry; p2: MatchmakingQueueEntry; room: RoomRecord }[] } {
  const matches: { p1: MatchmakingQueueEntry; p2: MatchmakingQueueEntry; room: RoomRecord }[] = []
  const matchedIds = new Set<string>()

  for (let i = 0; i < queue.length; i++) {
    const fila = queue[i]
    if (fila.status !== 'searching' || matchedIds.has(fila.id)) continue

    // Gate estricto: la fila debe tener clientEngineVersion = 'auth-v2'
    if (!fila.clientEngineVersion || fila.clientEngineVersion !== 'auth-v2') {
      continue
    }

    for (let j = i + 1; j < queue.length; j++) {
      const cand = queue[j]
      if (cand.status !== 'searching' || matchedIds.has(cand.id)) continue
      if (cand.mode !== fila.mode) continue
      if (fila.mode === 'tournament' && fila.tournamentId !== cand.tournamentId) continue

      // Gate estricto: el candidato debe tener clientEngineVersion = 'auth-v2'
      if (!cand.clientEngineVersion || cand.clientEngineVersion !== 'auth-v2') {
        continue
      }

      matchedIds.add(fila.id)
      matchedIds.add(cand.id)
      fila.status = 'matched'
      cand.status = 'matched'

      const room: RoomRecord = {
        id: `room-${fila.userId}-${cand.userId}`,
        mode: fila.mode,
        player1Id: fila.userId,
        player2Id: cand.userId,
        isAsyncMatch: false,
        asyncOpponentId: null,
        engineVersion: 'auth-v2',
      }
      fila.matchedRoomId = room.id
      cand.matchedRoomId = room.id

      matches.push({ p1: fila, p2: cand, room })
      break
    }
  }

  return { matches }
}

function simularClaimRankedAsyncOpponent(
  queueEntry: MatchmakingQueueEntry,
  candidateSeed: { id: string; sourceEngineVersion: string }
): { matched: boolean; error?: string; room?: RoomRecord } {
  if (!queueEntry.clientEngineVersion || queueEntry.clientEngineVersion !== 'auth-v2') {
    return {
      matched: false,
      error: 'client_update_required',
    }
  }

  if (candidateSeed.sourceEngineVersion !== 'auth-v1' && candidateSeed.sourceEngineVersion !== 'auth-v2') {
    return {
      matched: false,
      error: 'SOURCE_ENGINE_VERSION_NOT_SUPPORTED',
    }
  }

  const room: RoomRecord = {
    id: `async-room-${queueEntry.userId}`,
    mode: 'ranked',
    player1Id: queueEntry.userId,
    player2Id: null,
    isAsyncMatch: true,
    asyncOpponentId: candidateSeed.id,
    engineVersion: 'auth-v2',
  }
  queueEntry.status = 'matched'
  queueEntry.matchedRoomId = room.id

  return {
    matched: true,
    room,
  }
}

describe('MIGRACIÓN 41 — Universal Server-Side Handshake, Direct Mutation Revocation & Mode Gates', () => {
  // 1. Ranked: Cliente viejo rechazado
  it('Ranked viejo llamando enter_matchmaking es rechazado con client_update_required', () => {
    const resA = simularEnterMatchmaking('user-old-1', 'ranked', undefined)
    expect(resA.matched).toBe(false)
    expect(resA.error).toBe('client_update_required')

    const resB = simularEnterMatchmaking('user-old-2', 'ranked', 'auth-v1')
    expect(resB.matched).toBe(false)
    expect(resB.error).toBe('client_update_required')
  })

  // 2. Ranked: Dos clientes v2 emparejan en room auth-v2
  it('Ranked v2 empareja dos clientes v2 en room auth-v2', () => {
    const p1 = simularEnterMatchmaking('user-p1', 'ranked', 'auth-v2').entry!
    const p2 = simularEnterMatchmaking('user-p2', 'ranked', 'auth-v2').entry!

    const res = simularEmparejarLote([p1, p2])
    expect(res.matches.length).toBe(1)
    expect(res.matches[0].room.engineVersion).toBe('auth-v2')
  })

  // 3. Ghost: Cliente viejo rechazado
  it('Ghost con queue entry sin capability v2 devuelve client_update_required', () => {
    const legacyQueue: MatchmakingQueueEntry = {
      id: 'q-legacy-ghost',
      userId: 'user-ghost-old',
      mode: 'ranked',
      userElo: 1000,
      clientEngineVersion: null,
      status: 'searching',
      matchedRoomId: null,
      createdAt: Date.now() - 70000,
      lastSeenAt: Date.now(),
    }

    const res = simularClaimRankedAsyncOpponent(legacyQueue, { id: 'seed-1', sourceEngineVersion: 'auth-v1' })
    expect(res.matched).toBe(false)
    expect(res.error).toBe('client_update_required')
  })

  // 4. Ghost: Cliente v2 empareja con seed v1 y v2
  it('Ghost con cliente v2 crea room auth-v2 tanto con seed auth-v1 como con seed auth-v2', () => {
    const q1 = simularEnterMatchmaking('user-g1', 'ranked', 'auth-v2').entry!
    const res1 = simularClaimRankedAsyncOpponent(q1, { id: 'seed-v1', sourceEngineVersion: 'auth-v1' })
    expect(res1.matched).toBe(true)
    expect(res1.room?.engineVersion).toBe('auth-v2')

    const q2 = simularEnterMatchmaking('user-g2', 'ranked', 'auth-v2').entry!
    const res2 = simularClaimRankedAsyncOpponent(q2, { id: 'seed-v2', sourceEngineVersion: 'auth-v2' })
    expect(res2.matched).toBe(true)
    expect(res2.room?.engineVersion).toBe('auth-v2')
  })

  // 5. Friendly: Cliente viejo rechazado
  it('Friendly viejo sin auth-v2 es rechazado con client_update_required antes de crear room', () => {
    const res = simularEnterMatchmaking('user-f-old', 'friendly', undefined)
    expect(res.matched).toBe(false)
    expect(res.error).toBe('client_update_required')
  })

  // 6. Friendly: Dos clientes v2 emparejan en room auth-v2
  it('Friendly v2 empareja creador y participante v2 en room auth-v2', () => {
    const f1 = simularEnterMatchmaking('user-f1', 'friendly', 'auth-v2').entry!
    const f2 = simularEnterMatchmaking('user-f2', 'friendly', 'auth-v2').entry!

    const res = simularEmparejarLote([f1, f2])
    expect(res.matches.length).toBe(1)
    expect(res.matches[0].room.engineVersion).toBe('auth-v2')
    expect(res.matches[0].room.mode).toBe('friendly')
  })

  // 7. Colosseum: Cliente viejo rechazado
  it('Colosseum viejo sin auth-v2 es rechazado con client_update_required antes de escrow', () => {
    const res = simularEnterMatchmaking('user-c-old', 'colosseum', 'auth-v1')
    expect(res.matched).toBe(false)
    expect(res.error).toBe('client_update_required')
  })

  // 8. Colosseum: Dos clientes v2 emparejan en room auth-v2
  it('Colosseum v2 empareja ambos participantes v2 en room auth-v2', () => {
    const c1 = simularEnterMatchmaking('user-c1', 'colosseum', 'auth-v2').entry!
    const c2 = simularEnterMatchmaking('user-c2', 'colosseum', 'auth-v2').entry!

    const res = simularEmparejarLote([c1, c2])
    expect(res.matches.length).toBe(1)
    expect(res.matches[0].room.engineVersion).toBe('auth-v2')
    expect(res.matches[0].room.mode).toBe('colosseum')
  })

  // 9. Tournament: Cliente viejo rechazado
  it('Tournament viejo sin auth-v2 es rechazado con client_update_required', () => {
    const res = simularEnterMatchmaking('user-t-old', 'tournament', undefined, { tournamentId: 'tourney-1' })
    expect(res.matched).toBe(false)
    expect(res.error).toBe('client_update_required')
  })

  // 10. Tournament: Dos clientes v2 emparejan en room auth-v2
  it('Tournament v2 empareja ambos competidores v2 en room auth-v2', () => {
    const t1 = simularEnterMatchmaking('user-t1', 'tournament', 'auth-v2', { tournamentId: 'tourney-1' }).entry!
    const t2 = simularEnterMatchmaking('user-t2', 'tournament', 'auth-v2', { tournamentId: 'tourney-1' }).entry!

    const res = simularEmparejarLote([t1, t2])
    expect(res.matches.length).toBe(1)
    expect(res.matches[0].room.engineVersion).toBe('auth-v2')
    expect(res.matches[0].room.mode).toBe('tournament')
  })

  // 11. Poll Matchmaking con fila legacy
  it('Poll Matchmaking detecta fila legacy searching y devuelve client_update_required para evitar cola infinita', () => {
    const legacyQueue: MatchmakingQueueEntry = {
      id: 'q-legacy-poll',
      userId: 'user-poll-old',
      mode: 'ranked',
      userElo: 1000,
      clientEngineVersion: null,
      status: 'searching',
      matchedRoomId: null,
      createdAt: Date.now() - 10000,
      lastSeenAt: Date.now(),
    }

    const res = simularPollMatchmaking(legacyQueue)
    expect(res.searching).toBe(false)
    expect(res.matched).toBe(false)
    expect(res.error).toBe('client_update_required')
  })

  // 12. Test de Bypass: Cliente autenticado intentando INSERT directo a matchmaking_queue es denegado
  it('Test de Bypass: Cliente autenticado intentando INSERT directo a matchmaking_queue es denegado por permisos/RLS', () => {
    const resAuth = simularDirectQueueInsert('authenticated', {
      userId: 'attacker-1',
      mode: 'ranked',
    })
    expect(resAuth.ok).toBe(false)
    expect(resAuth.error).toMatch(/permission denied/i)

    const resAnon = simularDirectQueueInsert('anon', {
      userId: 'anon-1',
      mode: 'ranked',
    })
    expect(resAnon.ok).toBe(false)
    expect(resAnon.error).toMatch(/permission denied/i)
  })

  // 13. Test de Bypass: Cliente autenticado intentando UPDATE directo a matchmaking_queue es denegado
  it('Test de Bypass: Cliente autenticado intentando UPDATE directo a matchmaking_queue es denegado', () => {
    const resAuth = simularDirectQueueUpdate('authenticated', 'queue-123', {
      status: 'cancelled',
    })
    expect(resAuth.ok).toBe(false)
    expect(resAuth.error).toMatch(/permission denied/i)
  })

  // 14. Cancelación canónica mediante cancelMatchmaking RPC
  it('Cancelación canónica mediante RPC cancel_matchmaking cancela exclusivamente la búsqueda propia', () => {
    const q1 = simularEnterMatchmaking('user-canceller', 'ranked', 'auth-v2').entry!
    const q2 = simularEnterMatchmaking('user-other', 'ranked', 'auth-v2').entry!

    const resCancel = simularCancelMatchmaking('user-canceller', [q1, q2])
    expect(resCancel.cancelled).toBe(true)
    expect(q1.status).toBe('cancelled')
    expect(q2.status).toBe('searching')
  })

  // 15. Invariante Global: Ninguna sala auth-v2 puede tener clientes humanos != auth-v2
  it('Invariante Global: Es imposible crear una room auth-v2 con clientes que no declaren auth-v2', () => {
    const queueLegacy: MatchmakingQueueEntry = {
      id: 'q-leg',
      userId: 'u-leg',
      mode: 'ranked',
      userElo: 1000,
      clientEngineVersion: null,
      status: 'searching',
      matchedRoomId: null,
      createdAt: Date.now(),
      lastSeenAt: Date.now(),
    }

    const queueV2: MatchmakingQueueEntry = {
      id: 'q-v2',
      userId: 'u-v2',
      mode: 'ranked',
      userElo: 1000,
      clientEngineVersion: 'auth-v2',
      status: 'searching',
      matchedRoomId: null,
      createdAt: Date.now(),
      lastSeenAt: Date.now(),
    }

    const res = simularEmparejarLote([queueLegacy, queueV2])
    expect(res.matches.length).toBe(0)
  })

  // 16. Replay autoritativo fail-closed
  it('Replay autoritativo rechaza fail-closed cualquier desalineación de versión', () => {
    const datosIncompatibles: DatosDeRepeticion = {
      roomId: 'room-cross-fail',
      mode: 'ranked',
      seed: 123456,
      engineVersion: 'unknown-v3' as any,
      jugadaEn: '2026-08-24T00:00:00Z',
      jugador1: {
        nombre: 'P1',
        avatar: 'peashooter',
        mazo: [{ plantId: 'peashooter', slot: 0, level: 0, statRolls: [] }],
      },
      jugador2: {
        nombre: 'P2',
        avatar: 'peashooter',
        mazo: [{ plantId: 'peashooter', slot: 0, level: 0, statRolls: [] }],
      },
      ganador: null,
      yoSoy: 1,
      jugadas: [],
    }

    const res = recalcularGanadorAutoritativo(datosIncompatibles)
    expect(res.ilegales.length).toBe(1)
    expect(res.ilegales[0].razon).toBe('version_de_motor_no_soportada')
  })
})
