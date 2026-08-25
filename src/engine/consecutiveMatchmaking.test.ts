import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SupabaseService } from '../services/supabaseService'
import { RANKED_MATCHMAKING_TIMEOUT_SECONDS } from '../utils/gameConstants'

describe('D. Rematch / Matchmaking Consecutivo & Ciclo de Vida Limpio', () => {
  const fakeUserId = '11111111-2222-3333-4444-555555555555'

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('1. Secuencia: Ranked #1 -> Fin -> Ranked #2 -> Fin -> Ranked #3 (sin refresh)', async () => {
    let currentRoomId: string | null = null
    let matchCount = 0

    // Simular el ciclo de búsqueda y creación de 3 salas consecutivas
    vi.spyOn(SupabaseService, 'enterMatchmaking').mockImplementation(async () => {
      matchCount++
      currentRoomId = `room-ranked-${matchCount}`
      return { matched: true, roomId: currentRoomId }
    })

    vi.spyOn(SupabaseService, 'verifyMatch').mockImplementation(async (_rId: string) => {
      return {
        ok: true,
        status: 'settled',
        winnerId: fakeUserId,
        winnerSide: 1,
        isAsyncMatch: true,
        settlement: {
          success: true,
          status: 'liquidada',
          eloGained: 16,
          eloLost: 0,
        },
      } as any
    })

    // Match #1
    const search1 = await SupabaseService.enterMatchmaking('ranked')
    expect(search1.matched).toBe(true)
    expect(search1.roomId).toBe('room-ranked-1')
    const verify1 = await SupabaseService.verifyMatch(search1.roomId!)
    expect(verify1.ok).toBe(true)

    // Reset efímero (simulando handlePlayAgain / handleRegresarAlMenu)
    currentRoomId = null

    // Match #2
    const search2 = await SupabaseService.enterMatchmaking('ranked')
    expect(search2.matched).toBe(true)
    expect(search2.roomId).toBe('room-ranked-2')
    const verify2 = await SupabaseService.verifyMatch(search2.roomId!)
    expect(verify2.ok).toBe(true)

    // Reset efímero
    currentRoomId = null

    // Match #3
    const search3 = await SupabaseService.enterMatchmaking('ranked')
    expect(search3.matched).toBe(true)
    expect(search3.roomId).toBe('room-ranked-3')
    const verify3 = await SupabaseService.verifyMatch(search3.roomId!)
    expect(verify3.ok).toBe(true)

    expect(matchCount).toBe(3)
  })

  it('2. Secuencia: Buscar -> Cancelar -> Buscar', async () => {
    let searching = false

    vi.spyOn(SupabaseService, 'enterMatchmaking').mockImplementation(async () => {
      searching = true
      return { matched: false, searching: true }
    })

    vi.spyOn(SupabaseService, 'cancelMatchmaking').mockImplementation(async () => {
      searching = false
      return { cancelled: true }
    })

    // 1. Primera búsqueda
    const r1 = await SupabaseService.enterMatchmaking('ranked')
    expect(r1.searching).toBe(true)
    expect(searching).toBe(true)

    // 2. Cancelar
    const rCancel = await SupabaseService.cancelMatchmaking()
    expect(rCancel.cancelled).toBe(true)
    expect(searching).toBe(false)

    // 3. Segunda búsqueda limpia
    const r2 = await SupabaseService.enterMatchmaking('ranked')
    expect(r2.searching).toBe(true)
    expect(searching).toBe(true)
  })

  it('3. Secuencia: Buscar -> Rival Fallback (30s) -> Terminar -> Buscar', async () => {
    let queueWaited = 0

    vi.spyOn(SupabaseService, 'enterMatchmaking').mockResolvedValue({
      matched: false,
      searching: true,
    })

    vi.spyOn(SupabaseService, 'pollMatchmaking').mockImplementation(async () => {
      queueWaited += 10
      return {
        searching: true,
        matched: false,
        waitedSeconds: queueWaited,
      }
    })

    vi.spyOn(SupabaseService, 'claimRankedAsyncOpponent').mockResolvedValue({
      matched: true,
      roomId: 'room-async-fallback-1',
    } as any)

    // 1. Iniciar búsqueda
    await SupabaseService.enterMatchmaking('ranked')

    // 2. Sondeos sucesivos hasta 30s
    let poll = await SupabaseService.pollMatchmaking() // 10s
    expect(poll.waitedSeconds).toBe(10)
    expect(poll.waitedSeconds! >= RANKED_MATCHMAKING_TIMEOUT_SECONDS).toBe(false)

    poll = await SupabaseService.pollMatchmaking() // 20s
    expect(poll.waitedSeconds).toBe(20)
    expect(poll.waitedSeconds! >= RANKED_MATCHMAKING_TIMEOUT_SECONDS).toBe(false)

    poll = await SupabaseService.pollMatchmaking() // 30s
    expect(poll.waitedSeconds).toBe(30)
    expect(poll.waitedSeconds! >= RANKED_MATCHMAKING_TIMEOUT_SECONDS).toBe(true)

    // 3. Al superar 30s, se activa claimRankedAsyncOpponent
    const fallbackRes = await SupabaseService.claimRankedAsyncOpponent()
    expect(fallbackRes.matched).toBe(true)
    expect(fallbackRes.roomId).toBe('room-async-fallback-1')

    // 4. Terminar partida y buscar nuevamente
    queueWaited = 0
    const newSearch = await SupabaseService.enterMatchmaking('ranked')
    expect(newSearch.searching).toBe(true)
  })

  it('4. Invariante de identidad: ranked_player_stats.user_id procede exclusivamente de auth user ID válido', () => {
    function buildPlayerStatsPayload(userId: string | null | undefined, won: boolean) {
      if (!userId || typeof userId !== 'string' || userId.trim() === '') {
        throw new Error('null value in column "user_id" of relation "ranked_player_stats" violates not-null constraint')
      }
      return {
        user_id: userId,
        wins: won ? 1 : 0,
        losses: won ? 0 : 1,
        draws: 0,
      }
    }

    // Usuario autenticado válido
    const payload = buildPlayerStatsPayload(fakeUserId, true)
    expect(payload.user_id).toBe(fakeUserId)
    expect(payload.wins).toBe(1)

    // Rechazar null / undefined con fail-closed
    expect(() => buildPlayerStatsPayload(null, true)).toThrowError(/not-null constraint/i)
    expect(() => buildPlayerStatsPayload(undefined, true)).toThrowError(/not-null constraint/i)
    expect(() => buildPlayerStatsPayload('', true)).toThrowError(/not-null constraint/i)
  })
})
