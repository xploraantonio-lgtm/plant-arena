import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

/**
 * Emulación exacta de la lógica de recompensas en PL/pgSQL de claim_pack_slot (Migración 73).
 */
export function simulatePvpPackDrop(rollSeed: { plantChance: number; isPlantRoll: number; nonPlantRoll: number }) {
  if (rollSeed.isPlantRoll < rollSeed.plantChance) {
    return { type: 'plant' as const, quantity: 1 }
  }

  const nonplant = rollSeed.nonPlantRoll * 0.88

  if (nonplant < 0.34) {
    return { type: 'item' as const, itemId: 'water', quantity: 1 }
  } else if (nonplant < 0.58) {
    return { type: 'item' as const, itemId: 'fertilizer', quantity: 1 }
  } else if (nonplant < 0.72) {
    return { type: 'gold' as const, quantity: 15 }
  } else if (nonplant < 0.78) {
    return { type: 'gold' as const, quantity: 30 }
  } else if (nonplant < 0.82) {
    return { type: 'item' as const, itemId: 'water', quantity: 2 }
  } else if (nonplant < 0.85) {
    return { type: 'item' as const, itemId: 'fertilizer', quantity: 2 }
  } else {
    return { type: 'gold' as const, quantity: 50 }
  }
}

describe('MIGRACIÓN 73 — Reducción de oro en premios de packs PvP a 15, 30 y 50 máximo', () => {
  const migrationPath = path.resolve(
    __dirname,
    '../../supabase/migrations/73-pvp-pack-gold-rewards-reduction.sql'
  )

  it('1. El archivo de migración 73 existe y es legible', () => {
    expect(fs.existsSync(migrationPath)).toBe(true)
  })

  it('2. Contiene la definición de claim_pack_slot con SECURITY DEFINER', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8')
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.claim_pack_slot(p_slot_index INTEGER)')
    expect(sql).toContain('SECURITY DEFINER')
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.claim_pack_slot(INTEGER) TO authenticated')
  })

  it('3. Contiene los nuevos escalones de oro: 15, 30 y 50 máximo', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8')

    // Verifica que existan los nuevos incrementos de oro
    expect(sql).toContain('v_gold := v_gold + 15;')
    expect(sql).toContain("jsonb_build_object('type','gold','quantity',15)")

    expect(sql).toContain('v_gold := v_gold + 30;')
    expect(sql).toContain("jsonb_build_object('type','gold','quantity',30)")

    expect(sql).toContain('v_gold := v_gold + 50;')
    expect(sql).toContain("jsonb_build_object('type','gold','quantity',50)")

    // Verifica que los valores anteriores mayores a 50 (100 y 200) hayan sido eliminados
    expect(sql).not.toContain('v_gold := v_gold + 100;')
    expect(sql).not.toContain('v_gold := v_gold + 200;')
    expect(sql).not.toContain("'quantity',100")
    expect(sql).not.toContain("'quantity',200")
  })

  it('4. Simulación lógica: Los drops de oro son estrictamente 15, 30 o 50, y el máximo es 50', () => {
    const goldDropTiers = new Set<number>()

    // Simulamos diferentes valores aleatorios
    for (let p = 0; p < 1000; p++) {
      const nonPlantRoll = p / 1000
      const drop = simulatePvpPackDrop({
        plantChance: 0, // forzar caída no planta
        isPlantRoll: 1,
        nonPlantRoll,
      })

      if (drop.type === 'gold') {
        expect(drop.quantity).toBeLessThanOrEqual(50)
        expect([15, 30, 50]).toContain(drop.quantity)
        goldDropTiers.add(drop.quantity)
      }
    }

    // Comprobar que los 3 niveles de oro (15, 30 y 50) son alcanzables
    expect(goldDropTiers.has(15)).toBe(true)
    expect(goldDropTiers.has(30)).toBe(true)
    expect(goldDropTiers.has(50)).toBe(true)
    expect(Math.max(...goldDropTiers)).toBe(50)
  })
})
