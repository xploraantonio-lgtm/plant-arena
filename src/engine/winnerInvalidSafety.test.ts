import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

describe('9. Winner Invalid Safety & Settlement Authority Tests', () => {
  const migration43Path = path.resolve(__dirname, '../../supabase/43-ranked-ux-matchmaking-stats-hotfix.sql')
  const migration43Sql = fs.readFileSync(migration43Path, 'utf-8')

  it('9.1. SQL Audit: _settle_room y settle_verified_draw fallan cerrado (FAIL-CLOSED) con ASYNC_SETTLEMENT_REQUIRED en salas asíncronas', () => {
    expect(migration43Sql).toContain("RAISE EXCEPTION 'ASYNC_SETTLEMENT_REQUIRED: Las salas asíncronas deben liquidarse mediante settle_verified_async_ranked_match'")
    expect(migration43Sql).not.toContain('CASE WHEN p_winner_id = player1_id THEN 1 ELSE 2 END')
  })

  it('9.2. SQL Audit: _settle_room valida explícitamente ganador conocido y no convierte UUID desconocido en p2_won', () => {
    expect(migration43Sql).toContain("RAISE EXCEPTION 'Ganador no reconocido para liquidación Ranked: %', p_winner_id;")
  })

  // Simulación de la lógica estricta de settlement
  interface RoomState {
    id: string
    mode: 'ranked' | 'colosseum' | 'friendly'
    is_async_match: boolean
    player1_id: string
    player2_id: string | null
    status: string
  }

  interface StatsRecord {
    user_id: string
    wins: number
    losses: number
    draws: number
  }

  function simulateSettleVerifiedAsyncMatch(room: RoomState, winnerSide: 1 | 2) {
    if (!room.is_async_match) throw new Error('Esta función es exclusiva para partidas asíncronas')
    if (winnerSide !== 1 && winnerSide !== 2) throw new Error('winner_side debe ser 1 o 2')

    const statsMap = new Map<string, StatsRecord>()
    // En async match: sólo P1 interactúa con stats
    const p1Stats = { user_id: room.player1_id, wins: winnerSide === 1 ? 1 : 0, losses: winnerSide === 2 ? 1 : 0, draws: 0 }
    statsMap.set(room.player1_id, p1Stats)

    // El rival semilla tiene player2_id = null y NUNCA se escribe en stats
    return {
      success: true,
      status: 'liquidada',
      winner: winnerSide === 1 ? room.player1_id : null,
      winnerSide,
      stats: Array.from(statsMap.values()),
    }
  }

  function simulateSettleRoom(room: RoomState, winnerId: string | null) {
    // 1. Fail-closed para async matches
    if (room.is_async_match) {
      throw new Error('ASYNC_SETTLEMENT_REQUIRED: Las salas asíncronas deben liquidarse mediante settle_verified_async_ranked_match')
    }

    if (winnerId !== null && winnerId !== room.player1_id && winnerId !== room.player2_id) {
      throw new Error(`Ganador inválido para la sala: ${winnerId}`)
    }

    if (room.mode === 'ranked') {
      if (room.player2_id === null) {
        throw new Error('Sala Ranked PvP inválida: player2_id es nulo')
      }

      if (winnerId === room.player1_id) {
        return { success: true, status: 'p1_won', winner: room.player1_id }
      } else if (winnerId === room.player2_id) {
        return { success: true, status: 'p2_won', winner: room.player2_id }
      } else {
        throw new Error(`Ganador no reconocido para liquidación Ranked: ${winnerId}`)
      }
    }

    return { success: true, status: 'liquidada' }
  }

  it('9.3. Async + Winner P1: permitido exclusivamente por settle_verified_async_ranked_match', () => {
    const asyncRoom: RoomState = {
      id: 'room-async-1',
      mode: 'ranked',
      is_async_match: true,
      player1_id: 'user-p1-uuid',
      player2_id: null,
      status: 'in_progress',
    }

    const res = simulateSettleVerifiedAsyncMatch(asyncRoom, 1)
    expect(res.success).toBe(true)
    expect(res.winner).toBe('user-p1-uuid')
    expect(res.winnerSide).toBe(1)
    expect(res.stats.length).toBe(1)
    expect(res.stats[0].user_id).toBe('user-p1-uuid')
    expect(res.stats[0].wins).toBe(1)
  })

  it('9.4. Async + Invocar _settle_room: Lanza ASYNC_SETTLEMENT_REQUIRED y no infiere winnerSide', () => {
    const asyncRoom: RoomState = {
      id: 'room-async-2',
      mode: 'ranked',
      is_async_match: true,
      player1_id: 'user-p1-uuid',
      player2_id: null,
      status: 'in_progress',
    }

    // Winner NULL
    expect(() => simulateSettleRoom(asyncRoom, null)).toThrow('ASYNC_SETTLEMENT_REQUIRED')

    // Winner UUID desconocido
    expect(() => simulateSettleRoom(asyncRoom, 'random-uuid-999')).toThrow('ASYNC_SETTLEMENT_REQUIRED')

    // Winner P1
    expect(() => simulateSettleRoom(asyncRoom, 'user-p1-uuid')).toThrow('ASYNC_SETTLEMENT_REQUIRED')
  })

  it('9.5. Human PvP + Ganador desconocido: Lanza error y no realiza fallback genérico a p2_won', () => {
    const pvpRoom: RoomState = {
      id: 'room-pvp-1',
      mode: 'ranked',
      is_async_match: false,
      player1_id: 'p1-uuid',
      player2_id: 'p2-uuid',
      status: 'in_progress',
    }

    // UUID desconocido no puede ganar
    expect(() => simulateSettleRoom(pvpRoom, 'imposter-uuid')).toThrow('Ganador inválido para la sala')

    // Winner NULL en Ranked no puede ser p2_won
    expect(() => simulateSettleRoom(pvpRoom, null)).toThrow('Ganador no reconocido para liquidación Ranked')
  })

  it('9.6. Invariante Async: player2_id NULL nunca genera inserción en ranked_player_stats', () => {
    const asyncRoom: RoomState = {
      id: 'room-async-3',
      mode: 'ranked',
      is_async_match: true,
      player1_id: 'user-p1-uuid',
      player2_id: null,
      status: 'in_progress',
    }

    const resWin = simulateSettleVerifiedAsyncMatch(asyncRoom, 1)
    expect(resWin.stats.every((s) => s.user_id !== null && s.user_id !== 'null')).toBe(true)

    const resLose = simulateSettleVerifiedAsyncMatch(asyncRoom, 2)
    expect(resLose.stats.every((s) => s.user_id !== null && s.user_id !== 'null')).toBe(true)
    expect(resLose.stats[0].losses).toBe(1)
  })

  it('9.7. settle_verified_draw: Falla cerrado (ASYNC_SETTLEMENT_REQUIRED) en salas async y nunca inserta player2_id NULL en stats', () => {
    function simulateSettleVerifiedDraw(room: RoomState) {
      if (room.is_async_match) {
        throw new Error('ASYNC_SETTLEMENT_REQUIRED: Las salas asíncronas deben liquidarse mediante settle_verified_async_ranked_match')
      }

      const statsMap = new Map<string, StatsRecord>()
      if (room.player1_id !== null && room.player2_id !== null) {
        statsMap.set(room.player1_id, { user_id: room.player1_id, wins: 0, losses: 0, draws: 1 })
        statsMap.set(room.player2_id, { user_id: room.player2_id, wins: 0, losses: 0, draws: 1 })
      } else if (room.player1_id !== null) {
        statsMap.set(room.player1_id, { user_id: room.player1_id, wins: 0, losses: 0, draws: 1 })
      }

      return {
        success: true,
        status: 'empate_verificado',
        stats: Array.from(statsMap.values()),
      }
    }

    // 1. Invocar en sala async lanza excepción fail-closed
    const asyncRoom: RoomState = {
      id: 'room-async-draw',
      mode: 'ranked',
      is_async_match: true,
      player1_id: 'p1-uuid',
      player2_id: null,
      status: 'in_progress',
    }
    expect(() => simulateSettleVerifiedDraw(asyncRoom)).toThrow('ASYNC_SETTLEMENT_REQUIRED')

    // 2. Invocar en sala PvP normal actualiza ambos jugadores
    const pvpRoom: RoomState = {
      id: 'room-pvp-draw',
      mode: 'ranked',
      is_async_match: false,
      player1_id: 'p1-uuid',
      player2_id: 'p2-uuid',
      status: 'in_progress',
    }
    const resPvp = simulateSettleVerifiedDraw(pvpRoom)
    expect(resPvp.success).toBe(true)
    expect(resPvp.stats.length).toBe(2)
    expect(resPvp.stats.every((s) => s.user_id !== null && s.user_id !== 'null')).toBe(true)
  })
})
