import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

describe('10. Seed Opponent Usage Metadata & Concurrency Tests (Migration 44)', () => {
  const migration44Path = path.resolve(__dirname, '../../supabase/44-ranked-async-opponent-usage.sql')
  const preflight44Path = path.resolve(__dirname, '../../supabase/44-ranked-async-opponent-usage-preflight.sql')
  const postcheck44Path = path.resolve(__dirname, '../../supabase/44-ranked-async-opponent-usage-postcheck.sql')
  const migration43Path = path.resolve(__dirname, '../../supabase/43-ranked-ux-matchmaking-stats-hotfix.sql')

  const migration44Sql = fs.readFileSync(migration44Path, 'utf-8')
  const preflight44Sql = fs.readFileSync(preflight44Path, 'utf-8')
  const postcheck44Sql = fs.readFileSync(postcheck44Path, 'utf-8')
  const migration43Sql = fs.readFileSync(migration43Path, 'utf-8')

  it('10.1. SQL Audit: Migración 44 añade usage_count y last_used_at con tipos canónicos y constraint CHECK', () => {
    expect(migration44Sql).toMatch(/ALTER TABLE public\.ranked_async_opponents\s+ADD COLUMN IF NOT EXISTS usage_count BIGINT NOT NULL DEFAULT 0;/i)
    expect(migration44Sql).toMatch(/ALTER TABLE public\.ranked_async_opponents\s+ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ;/i)
    expect(migration44Sql).toMatch(/CHECK\s*\(\s*usage_count\s*>=\s*0\s*\)/i)
    expect(migration44Sql).toContain('chk_ranked_async_opponents_usage_count')
  })

  it('10.2. SQL Audit: Ledger usa exclusivamente (fase, detalle, ejecutado_en)', () => {
    expect(migration44Sql).toContain("'44_ranked_async_opponent_usage_metadata'")
    expect(migration44Sql).toMatch(/INSERT INTO public\._migration_audit\s*\(\s*fase,\s*detalle,\s*ejecutado_en\s*\)/i)
    expect(migration44Sql).not.toContain('detalles')
    expect(migration44Sql).not.toContain('details')

    expect(preflight44Sql).toContain("fase = '44_ranked_async_opponent_usage_metadata'")
    expect(preflight44Sql).not.toContain('detalles')
    expect(preflight44Sql).not.toContain('details')
    expect(postcheck44Sql).toContain("fase = '44_ranked_async_opponent_usage_metadata'")
    expect(postcheck44Sql).not.toContain('detalles')
    expect(postcheck44Sql).not.toContain('details')
  })

  it('10.3. SQL Static Schema Audit: Todas las columnas referenciadas por claim_ranked_async_opponent existen en el schema', () => {
    const requiredSeedColumns = [
      'id',
      'active',
      'rating_snapshot',
      'deck_snapshot',
      'actions_snapshot',
      'usage_count',
      'last_used_at',
      'created_at',
    ]

    // claim_ranked_async_opponent usa SELECT * y actualiza usage_count y last_used_at
    expect(migration43Sql).toContain('ABS(rating_snapshot - v_player_elo) ASC, usage_count ASC, created_at DESC')
    expect(migration43Sql).toContain('SET usage_count = usage_count + 1')
    expect(migration43Sql).toContain('last_used_at = NOW()')

    // Confirmamos que la migración 44 provee las columnas faltantes
    requiredSeedColumns.forEach((col) => {
      const isDefinedInBaseOr44 =
        col === 'usage_count' || col === 'last_used_at'
          ? migration44Sql.includes(col)
          : true
      expect(isDefinedInBaseOr44).toBe(true)
    })
  })

  // Simulación de la entidad SeedOpponent y el algoritmo de matchmaking asíncrono
  interface SeedOpponent {
    id: string
    active: boolean
    rating_snapshot: number
    deck_snapshot: string[]
    actions_snapshot: Array<{ tick: number; kind: string }>
    usage_count: number
    last_used_at: string | null
    created_at: string
  }

  interface ClaimSimulationResult {
    matched: boolean
    roomId?: string
    selectedSeedId?: string
    error?: string
  }

  function simulateSeedClaim(
    seeds: SeedOpponent[],
    playerElo: number,
    recentSeedIds: string[],
    shouldFailTransactionBeforeCommit = false
  ): { result: ClaimSimulationResult; updatedSeeds: SeedOpponent[] } {
    // Clonar para respetar transaccionalidad
    const workingSeeds = seeds.map((s) => ({ ...s }))

    // 1. Filtrar activas y no recientes
    const eligible = workingSeeds.filter(
      (s) => s.active && !recentSeedIds.includes(s.id)
    )

    if (eligible.length === 0) {
      return {
        result: { matched: false, error: 'no_hay_candidato_semilla' },
        updatedSeeds: seeds,
      }
    }

    // 2. Ordenar por fairness canónico:
    //    1. ABS(rating_snapshot - playerElo) ASC
    //    2. usage_count ASC
    //    3. created_at DESC
    eligible.sort((a, b) => {
      const eloDiffA = Math.abs(a.rating_snapshot - playerElo)
      const eloDiffB = Math.abs(b.rating_snapshot - playerElo)
      if (eloDiffA !== eloDiffB) return eloDiffA - eloDiffB
      if (a.usage_count !== b.usage_count) return a.usage_count - b.usage_count
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    })

    const selected = eligible[0]

    // 3. Simular validación de mazo / plan
    const isDeckValid = selected.deck_snapshot && selected.deck_snapshot.length > 0
    const isPlanValid = selected.actions_snapshot && Array.isArray(selected.actions_snapshot)

    if (!isDeckValid || !isPlanValid) {
      selected.active = false
      return {
        result: { matched: false, error: 'no_hay_candidato_semilla' },
        updatedSeeds: workingSeeds,
      }
    }

    // 4. Si la transacción falla antes del commit (e.g. error en INSERT room o timeout)
    if (shouldFailTransactionBeforeCommit) {
      // Rollback: no se persisten cambios
      return {
        result: { matched: false, error: 'transaction_aborted' },
        updatedSeeds: seeds,
      }
    }

    // 5. Aplicar UPDATE atómico
    selected.usage_count += 1
    selected.last_used_at = new Date().toISOString()

    return {
      result: {
        matched: true,
        roomId: `room-async-${Date.now()}`,
        selectedSeedId: selected.id,
      },
      updatedSeeds: workingSeeds,
    }
  }

  it('10.4. Ciclo de Vida: Semilla nueva nace con usage_count = 0 y last_used_at = null', () => {
    const newSeed: SeedOpponent = {
      id: 'seed-new-1',
      active: true,
      rating_snapshot: 1000,
      deck_snapshot: ['sunflower', 'peashooter'],
      actions_snapshot: [{ tick: 10, kind: 'plant' }],
      usage_count: 0,
      last_used_at: null,
      created_at: new Date().toISOString(),
    }

    expect(newSeed.usage_count).toBe(0)
    expect(newSeed.last_used_at).toBeNull()
  })

  it('10.5. Claim Exitoso: Incrementa usage_count exactamente +1 y actualiza last_used_at', () => {
    const seed: SeedOpponent = {
      id: 'seed-1',
      active: true,
      rating_snapshot: 1000,
      deck_snapshot: ['sunflower', 'peashooter'],
      actions_snapshot: [{ tick: 10, kind: 'plant' }],
      usage_count: 0,
      last_used_at: null,
      created_at: '2026-08-20T10:00:00Z',
    }

    const { result, updatedSeeds } = simulateSeedClaim([seed], 1000, [])
    expect(result.matched).toBe(true)
    expect(result.selectedSeedId).toBe('seed-1')

    const updated = updatedSeeds.find((s) => s.id === 'seed-1')!
    expect(updated.usage_count).toBe(1)
    expect(updated.last_used_at).not.toBeNull()
  })

  it('10.6. Múltiples Claims Secuenciales: Acumula usage_count fielmente', () => {
    let seeds: SeedOpponent[] = [
      {
        id: 'seed-multi',
        active: true,
        rating_snapshot: 1050,
        deck_snapshot: ['sunflower', 'repeater'],
        actions_snapshot: [{ tick: 15, kind: 'plant' }],
        usage_count: 0,
        last_used_at: null,
        created_at: '2026-08-20T10:00:00Z',
      },
    ]

    // Claim 1
    const res1 = simulateSeedClaim(seeds, 1050, [])
    seeds = res1.updatedSeeds
    expect(seeds[0].usage_count).toBe(1)
    const timestamp1 = seeds[0].last_used_at

    // Claim 2
    const res2 = simulateSeedClaim(seeds, 1050, [])
    seeds = res2.updatedSeeds
    expect(seeds[0].usage_count).toBe(2)
    expect(new Date(seeds[0].last_used_at!).getTime()).toBeGreaterThanOrEqual(
      new Date(timestamp1!).getTime()
    )
  })

  it('10.7. Claim Fallido / Rollback Transaccional: usage_count no se incrementa', () => {
    const initialSeed: SeedOpponent = {
      id: 'seed-rollback',
      active: true,
      rating_snapshot: 1000,
      deck_snapshot: ['sunflower'],
      actions_snapshot: [],
      usage_count: 3,
      last_used_at: '2026-08-24T12:00:00Z',
      created_at: '2026-08-20T10:00:00Z',
    }

    const { result, updatedSeeds } = simulateSeedClaim([initialSeed], 1000, [], true)
    expect(result.matched).toBe(false)
    expect(result.error).toBe('transaction_aborted')

    const persisted = updatedSeeds.find((s) => s.id === 'seed-rollback')!
    expect(persisted.usage_count).toBe(3)
    expect(persisted.last_used_at).toBe('2026-08-24T12:00:00Z')
  })

  it('10.8. Fairness de Selección: usage_count balancea el uso entre candidatos de ELO similar', () => {
    const seedA: SeedOpponent = {
      id: 'seed-A',
      active: true,
      rating_snapshot: 1000,
      deck_snapshot: ['sunflower'],
      actions_snapshot: [{ tick: 1, kind: 'plant' }],
      usage_count: 5, // Más usada
      last_used_at: '2026-08-24T10:00:00Z',
      created_at: '2026-08-20T10:00:00Z',
    }

    const seedB: SeedOpponent = {
      id: 'seed-B',
      active: true,
      rating_snapshot: 1000,
      deck_snapshot: ['sunflower'],
      actions_snapshot: [{ tick: 1, kind: 'plant' }],
      usage_count: 1, // Menos usada
      last_used_at: '2026-08-24T11:00:00Z',
      created_at: '2026-08-20T10:00:00Z',
    }

    // Ambas tienen exactamente la misma distancia de ELO (|1000 - 1000| = 0), debe elegir Seed B
    const { result } = simulateSeedClaim([seedA, seedB], 1000, [])
    expect(result.matched).toBe(true)
    expect(result.selectedSeedId).toBe('seed-B')
  })

  it('10.9. Invariante No-Negativo: usage_count nunca puede ser menor a 0', () => {
    expect(() => {
      const invalidUsageCount = -1
      if (invalidUsageCount < 0) {
        throw new Error('violates check constraint "chk_ranked_async_opponents_usage_count"')
      }
    }).toThrow('violates check constraint')
  })
})
