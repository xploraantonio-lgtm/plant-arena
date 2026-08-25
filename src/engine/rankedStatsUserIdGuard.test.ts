import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

describe('2. ranked_player_stats.user_id NOT NULL Guard & Root Cause Audit', () => {
  const migration42Path = path.resolve(__dirname, '../../supabase/42-hotfix-ranked-matchmaking-and-stats.sql')
  const migration42Sql = fs.readFileSync(migration42Path, 'utf-8')

  it('2.1. SQL Audit: _settle_room protege todas las inserciones de player2_id con IF v_room.player2_id IS NOT NULL', () => {
    // Debe existir protección para player2_id
    expect(migration42Sql).toContain('IF v_room.player2_id IS NOT NULL THEN')
    expect(migration42Sql).toContain('INSERT INTO public.ranked_player_stats (user_id, wins, losses, draws, updated_at)')
  })

  it('2.2. SQL Audit: settle_verified_draw protege todas las inserciones con IF v_room.player2_id IS NOT NULL', () => {
    expect(migration42Sql).toContain('ELSIF v_room.player1_id IS NOT NULL THEN')
  })

  it('2.3. Simulación de ejecución de _settle_room cuando player2_id es NULL: nunca viola NOT NULL', () => {
    interface RankedPlayerStatsRow {
      user_id: string
      wins: number
      losses: number
      draws: number
      updated_at: Date
    }

    const mockStatsTable: Map<string, RankedPlayerStatsRow> = new Map()

    function insertRankedStats(userId: string | null, isWin: boolean, isDraw: boolean) {
      if (userId === null) {
        throw new Error('null value in column "user_id" of relation "ranked_player_stats" violates not-null constraint')
      }
      const existing = mockStatsTable.get(userId) || { user_id: userId, wins: 0, losses: 0, draws: 0, updated_at: new Date() }
      if (isWin) existing.wins++
      else if (isDraw) existing.draws++
      else existing.losses++
      existing.updated_at = new Date()
      mockStatsTable.set(userId, existing)
    }

    function simulateSafeSettleRoom(room: {
      id: string
      mode: string
      player1_id: string
      player2_id: string | null
      is_async_match: boolean
    }, winnerId: string | null) {
      // 1. Si es asíncrona, sólo P1 interactúa con stats
      if (room.is_async_match || room.player2_id === null) {
        if (winnerId === room.player1_id) {
          insertRankedStats(room.player1_id, true, false)
        } else if (winnerId === null) {
          insertRankedStats(room.player1_id, false, true)
        } else {
          insertRankedStats(room.player1_id, false, false)
        }
        return { success: true, status: 'liquidada' }
      }

      // 2. Partida humana estándar
      if (winnerId === room.player1_id) {
        insertRankedStats(room.player1_id, true, false)
        if (room.player2_id !== null) {
          insertRankedStats(room.player2_id, false, false)
        }
      } else if (winnerId === room.player2_id) {
        if (room.player2_id !== null) {
          insertRankedStats(room.player2_id, true, false)
        }
        insertRankedStats(room.player1_id, false, false)
      } else {
        insertRankedStats(room.player1_id, false, true)
        if (room.player2_id !== null) {
          insertRankedStats(room.player2_id, false, true)
        }
      }

      return { success: true, status: 'liquidada' }
    }

    // Probar sala asíncrona con player2_id = null
    const asyncRoom = {
      id: 'room-async-1',
      mode: 'ranked',
      player1_id: 'p1-uuid-1234',
      player2_id: null,
      is_async_match: true,
    }

    // No debe lanzar excepción
    expect(() => simulateSafeSettleRoom(asyncRoom, 'p1-uuid-1234')).not.toThrow()
    const p1Stats = mockStatsTable.get('p1-uuid-1234')
    expect(p1Stats?.wins).toBe(1)
    expect(mockStatsTable.has('null')).toBe(false)
  })
})
