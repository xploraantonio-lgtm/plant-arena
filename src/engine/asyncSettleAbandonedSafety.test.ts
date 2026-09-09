import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

describe('Migration 68: Async Rooms Settlement & Matchmaking Abandonment Safety', () => {
  const migration68Path = path.resolve(
    __dirname,
    '../../supabase/migrations/68-fix-async-rooms-settle-if-abandoned.sql'
  )
  const migration68Sql = fs.readFileSync(migration68Path, 'utf-8')

  it('1. SQL Audit: _settle_if_abandoned handles is_async_match explicitly without invoking _settle_room', () => {
    // 1. Must handle is_async_match
    expect(migration68Sql).toContain('COALESCE(v_sala.is_async_match, FALSE) = TRUE')

    // 2. Must check only v_p1 for presence in async rooms
    expect(migration68Sql).toContain('IF v_p1 >= v_limite THEN')

    // 3. Must mark abandoned directly without calling _settle_room
    expect(migration68Sql).toContain("status = 'abandoned'")
    expect(migration68Sql).toContain('settled_at = NOW()')
    expect(migration68Sql).toContain("verification_note = 'abandoned_by_player'")
  })

  it('2. SQL Audit: enter_matchmaking contains defensive exception isolation during room sweep', () => {
    expect(migration68Sql).toContain('BEGIN')
    expect(migration68Sql).toContain('PERFORM public._settle_if_abandoned(v_room);')
    expect(migration68Sql).toContain('EXCEPTION WHEN OTHERS THEN')
  })

  it('3. SQL Audit: immediate cleanup of orphaned async rooms is present', () => {
    expect(migration68Sql).toContain('UPDATE public.game_rooms')
    expect(migration68Sql).toContain('WHERE is_async_match = TRUE')
    expect(migration68Sql).toContain("status = 'playing'")
    expect(migration68Sql).toContain('settled_at IS NULL')
  })

  interface RoomMock {
    id: string
    is_async_match: boolean
    player1_id: string
    player2_id: string | null
    status: string
    settled_at: Date | null
    verification_status: string
    verification_note?: string
  }

  function simulateSettleRoom(room: RoomMock, winnerId: string | null) {
    if (room.is_async_match) {
      throw new Error(
        'ASYNC_SETTLEMENT_REQUIRED: Las salas asíncronas deben liquidarse mediante settle_verified_async_ranked_match'
      )
    }
    room.status = winnerId === room.player1_id ? 'p1_won' : 'p2_won'
    room.settled_at = new Date()
    return { success: true }
  }

  function simulateSettleIfAbandoned(
    room: RoomMock,
    p1LastSeenDiffSecs: number,
    p2LastSeenDiffSecs: number,
    abandonTimeoutSecs = 120
  ): boolean {
    if (room.status !== 'playing' || room.settled_at !== null) return false

    const p1Active = p1LastSeenDiffSecs < abandonTimeoutSecs
    const p2Active = p2LastSeenDiffSecs < abandonTimeoutSecs

    // Regla Migración 68 para salas asíncronas
    if (room.is_async_match) {
      if (p1Active) {
        return false // P1 sigue jugando o estuvo presente recientemente
      }
      // P1 inactivo por >= plazo: abandonada
      room.status = 'abandoned'
      room.settled_at = new Date()
      room.verification_status = 'failed'
      room.verification_note = 'abandoned_by_player'
      return true
    }

    // Salas humanas
    if (p1Active && p2Active) return false

    if (p1Active || p2Active) {
      const presente = p1Active ? room.player1_id : room.player2_id!
      simulateSettleRoom(room, presente)
      return true
    }

    room.status = 'abandoned'
    room.settled_at = new Date()
    return true
  }

  it('4. Simulación: sala asíncrona con P1 activo nunca invoca _settle_room y permanece activa', () => {
    const asyncRoom: RoomMock = {
      id: 'room-async-active',
      is_async_match: true,
      player1_id: 'user-1',
      player2_id: null,
      status: 'playing',
      settled_at: null,
      verification_status: 'pending',
    }

    // P1 estuvo activo hace 10 segundos, P2 es bot (hace 200 segundos)
    expect(() => simulateSettleIfAbandoned(asyncRoom, 10, 200)).not.toThrow()
    const result = simulateSettleIfAbandoned(asyncRoom, 10, 200)

    expect(result).toBe(false)
    expect(asyncRoom.status).toBe('playing')
    expect(asyncRoom.settled_at).toBeNull()
  })

  it('5. Simulación: sala asíncrona abandonada por P1 (>120s) se marca como abandoned sin lanzar ASYNC_SETTLEMENT_REQUIRED', () => {
    const asyncRoom: RoomMock = {
      id: 'room-async-stale',
      is_async_match: true,
      player1_id: 'user-1',
      player2_id: null,
      status: 'playing',
      settled_at: null,
      verification_status: 'pending',
    }

    // P1 ausente por 150 segundos (> 120s)
    expect(() => simulateSettleIfAbandoned(asyncRoom, 150, 300)).not.toThrow()
    expect(asyncRoom.status).toBe('abandoned')
    expect(asyncRoom.settled_at).not.toBeNull()
    expect(asyncRoom.verification_status).toBe('failed')
    expect(asyncRoom.verification_note).toBe('abandoned_by_player')
  })

  it('6. Simulación: barrido de enter_matchmaking no falla si hay salas asíncronas cerradas o activas', () => {
    const rooms: RoomMock[] = [
      {
        id: 'room-1',
        is_async_match: true,
        player1_id: 'user-1',
        player2_id: null,
        status: 'playing',
        settled_at: null,
        verification_status: 'pending',
      },
      {
        id: 'room-2',
        is_async_match: false,
        player1_id: 'user-1',
        player2_id: 'user-2',
        status: 'playing',
        settled_at: null,
        verification_status: 'pending',
      },
    ]

    // Simular barrido con salas de más de 120s
    expect(() => {
      for (const room of rooms) {
        simulateSettleIfAbandoned(room, 200, 200)
      }
    }).not.toThrow()

    expect(rooms[0].status).toBe('abandoned')
    expect(rooms[1].status).toBe('abandoned')
  })
})
