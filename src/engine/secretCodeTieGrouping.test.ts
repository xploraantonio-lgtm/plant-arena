import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

interface BoardEntry {
  userId: string
  username: string
  avatarId: string
  bestPct: number
  attempts: number
  place: number
  isMe: boolean
}

/**
 * Emula la agrupación de usuarios por posición y la división equitativa de premios
 * implementada en LotteryModal.tsx.
 */
export function groupLeaderboardEntries(
  board: BoardEntry[],
  prizePool = 50,
  prizesConfig?: { place: number; amount: number; currency: 'gems' | 'gold' }[]
) {
  const topGoldPrizes: Record<number, number> = {
    2: 100,
    3: 80,
    4: 60,
    5: 50,
    6: 40,
    7: 30,
    8: 25,
    9: 20,
    10: 15,
  }

  const map = new Map<number, BoardEntry[]>()
  for (const entry of board) {
    const p = entry.place || 1
    if (!map.has(p)) {
      map.set(p, [])
    }
    map.get(p)!.push(entry)
  }

  return Array.from(map.entries())
    .map(([place, players]) => {
      const configuredPrize = prizesConfig?.find((p) => p.place === place)
      let totalPrize = 0
      let currency: 'gems' | 'gold' = 'gold'

      if (configuredPrize) {
        totalPrize = configuredPrize.amount
        currency = configuredPrize.currency
      } else if (place === 1) {
        totalPrize = prizePool
        currency = 'gems'
      } else {
        totalPrize = topGoldPrizes[place] || 0
        currency = 'gold'
      }

      const tiedCount = players.length
      const splitPrize = tiedCount > 0 && totalPrize > 0
        ? Number((totalPrize / tiedCount).toFixed(2))
        : totalPrize

      return {
        place,
        bestPct: players[0]?.bestPct ?? 0,
        players,
        tiedCount,
        hasMe: players.some((p) => p.isMe),
        totalPrize,
        splitPrize,
        currency,
      }
    })
    .sort((a, b) => a.place - b.place)
}

describe('CÓDIGO SECRETO — Agrupación de empates en un solo puesto y división de premio', () => {
  it('1. Dos usuarios en Top 1 (100%) se agrupan en un solo puesto y reciben 25 gemas cada uno', () => {
    const board: BoardEntry[] = [
      { userId: 'u1', username: 'Jugador1', avatarId: '1', bestPct: 100, attempts: 2, place: 1, isMe: false },
      { userId: 'u2', username: 'Jugador2', avatarId: '2', bestPct: 100, attempts: 3, place: 1, isMe: true },
    ]

    const grouped = groupLeaderboardEntries(board, 50)
    expect(grouped.length).toBe(1)
    expect(grouped[0].place).toBe(1)
    expect(grouped[0].tiedCount).toBe(2)
    expect(grouped[0].players.map((p) => p.username)).toEqual(['Jugador1', 'Jugador2'])
    expect(grouped[0].hasMe).toBe(true)
    expect(grouped[0].totalPrize).toBe(50)
    expect(grouped[0].splitPrize).toBe(25) // 50 / 2 = 25 cada uno
    expect(grouped[0].currency).toBe('gems')
  })

  it('2. Tres usuarios empatados en Top 2 (80%) se agrupan en puesto 2 con 100 oro dividido', () => {
    const board: BoardEntry[] = [
      { userId: 'u1', username: 'Ganador', avatarId: '1', bestPct: 100, attempts: 1, place: 1, isMe: false },
      { userId: 'u2', username: 'TiedA', avatarId: '2', bestPct: 80, attempts: 2, place: 2, isMe: false },
      { userId: 'u3', username: 'TiedB', avatarId: '3', bestPct: 80, attempts: 4, place: 2, isMe: false },
      { userId: 'u4', username: 'TiedC', avatarId: '4', bestPct: 80, attempts: 5, place: 2, isMe: false },
    ]

    const grouped = groupLeaderboardEntries(board, 50)
    expect(grouped.length).toBe(2)

    // Top 1: 1 jugador con 50 gemas
    expect(grouped[0].place).toBe(1)
    expect(grouped[0].tiedCount).toBe(1)
    expect(grouped[0].splitPrize).toBe(50)
    expect(grouped[0].currency).toBe('gems')

    // Top 2: 3 jugadores agrupados en puesto 2 con 100 / 3 = 33.33 oro
    expect(grouped[1].place).toBe(2)
    expect(grouped[1].tiedCount).toBe(3)
    expect(grouped[1].players.length).toBe(3)
    expect(grouped[1].totalPrize).toBe(100)
    expect(grouped[1].splitPrize).toBe(33.33)
    expect(grouped[1].currency).toBe('gold')
  })

  it('3. Un solo ganador en Top 1 recibe el 100% del bote (50 gemas)', () => {
    const board: BoardEntry[] = [
      { userId: 'u1', username: 'SoloWinner', avatarId: '1', bestPct: 100, attempts: 1, place: 1, isMe: true },
    ]

    const grouped = groupLeaderboardEntries(board, 50)
    expect(grouped.length).toBe(1)
    expect(grouped[0].tiedCount).toBe(1)
    expect(grouped[0].splitPrize).toBe(50)
  })

  it('4. El archivo de migración 74 existe y redefine _settle_secret_code_round con DENSE_RANK y división de empates', () => {
    const migrationPath = path.resolve(
      __dirname,
      '../../supabase/migrations/74-secret-code-tie-grouping-and-split-payouts.sql'
    )
    expect(fs.existsSync(migrationPath)).toBe(true)

    const sql = fs.readFileSync(migrationPath, 'utf8')
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public._settle_secret_code_round(p_round_id UUID)')
    expect(sql).toContain('DENSE_RANK() OVER (ORDER BY best_pct DESC) AS puesto')
    expect(sql).toContain('TRUNC(v_tier_amt / v_grupo.empatados, 2)')
    expect(sql).toContain('tied_with')
  })
})
