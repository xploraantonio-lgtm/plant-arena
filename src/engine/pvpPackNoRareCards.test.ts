import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import {
  PVP_ALLOWED_COMMON_PLANTS,
  PVP_ALLOWED_UNCOMMON_PLANTS,
  PVP_ALLOWED_PLANTS,
  FORBIDDEN_PVP_PLANTS,
  isAllowedPvpPlant,
  type PvpRewardDrop,
} from '../utils/pvpRewardManager'
import type { PlantId } from '../types/game'

/**
 * Emula la función PL/pgSQL claim_pack_slot de la Migración 77.
 */
function simulateClaimPackSlotDrop(rollPlant: number, rollRarity: number, rollIndex: number): {
  plantId?: PlantId
  rarity?: 'common' | 'uncommon'
  isPlant: boolean
} {
  const isPlant = rollPlant < 0.75 // probabilidad máxima (sobre de 6h)
  if (!isPlant) {
    return { isPlant: false }
  }

  let pool: PlantId[]
  let rarity: 'common' | 'uncommon'
  if (rollRarity < 0.70) {
    pool = [...PVP_ALLOWED_COMMON_PLANTS]
    rarity = 'common'
  } else {
    pool = [...PVP_ALLOWED_UNCOMMON_PLANTS]
    rarity = 'uncommon'
  }

  const plantId = pool[Math.floor(rollIndex * pool.length)]

  // Guarda idéntica al SQL
  if (FORBIDDEN_PVP_PLANTS.includes(plantId)) {
    throw new Error(`ILLEGAL_PVP_PACK_PLANT: ${plantId}`)
  }

  return { isPlant: true, plantId, rarity }
}

describe('MIGRACIÓN 77 & SEGURIDAD PVP — CERO CARTAS RARAS EN PACKS PVP (JALAPEÑO BLINDADO)', () => {
  const migrationPath = path.resolve(
    __dirname,
    '../../supabase/migrations/77-pvp-packs-strictly-no-rare-cards.sql'
  )

  it('1. El archivo de migración 77 existe y es legible', () => {
    expect(fs.existsSync(migrationPath)).toBe(true)
  })

  it('2. claim_pack_slot y claim_reward_pack definen SECURITY DEFINER y permisos revocados de anon', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8')
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.claim_pack_slot(p_slot_index INTEGER)')
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.claim_reward_pack(p_pack_id UUID)')
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.claim_pack_slot(INTEGER) FROM anon;')
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.claim_pack_slot(INTEGER) TO authenticated;')
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.claim_reward_pack(UUID) FROM anon;')
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.claim_reward_pack(UUID) TO authenticated;')
  })

  it('3. Ambos procedimientos PL/pgSQL contienen la guarda de seguridad ILLEGAL_PVP_PACK_PLANT', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8')
    expect(sql).toContain("IF v_plant_id IN ('jalapeno', 'twinsunflower', 'aloe', 'tallnut', 'iceberglettuce', 'threepeater') THEN")
    expect(sql).toContain("RAISE EXCEPTION 'ILLEGAL_PVP_PACK_PLANT: %', v_plant_id;")
    expect(sql).toContain("IF v_plant IN ('jalapeno', 'twinsunflower', 'aloe', 'tallnut', 'iceberglettuce', 'threepeater') THEN")
    expect(sql).toContain("RAISE EXCEPTION 'ILLEGAL_PVP_PACK_PLANT: %', v_plant;")
  })

  it('4. Las listas de cartas permitidas en el SQL solo incluyen Comunes (4) y Poco Comunes (5)', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8')
    // Comunes
    expect(sql).toContain("ARRAY['sunflower', 'peashooter', 'wallnut', 'chomper']")
    // Poco comunes
    expect(sql).toContain("ARRAY['garlic', 'bonkchoy', 'repeater', 'melonpult', 'squash']")
    // Ninguna tabla de rareza rara, épica o legendaria como pool
    expect(sql).not.toContain("ARRAY['twinsunflower', 'jalapeno']")
    expect(sql).not.toContain("ARRAY['aloe', 'tallnut']")
    expect(sql).not.toContain("ARRAY['iceberglettuce', 'threepeater']")
  })

  it('5. Validación estricta en TypeScript: isAllowedPvpPlant prohíbe Jalapeño y todas las raras/épicas/legendarias', () => {
    expect(isAllowedPvpPlant('jalapeno')).toBe(false)
    expect(isAllowedPvpPlant('twinsunflower')).toBe(false)
    expect(isAllowedPvpPlant('aloe')).toBe(false)
    expect(isAllowedPvpPlant('tallnut')).toBe(false)
    expect(isAllowedPvpPlant('iceberglettuce')).toBe(false)
    expect(isAllowedPvpPlant('threepeater')).toBe(false)

    // Las 9 plantas oficiales PvP deben ser permitidas
    expect(isAllowedPvpPlant('sunflower')).toBe(true)
    expect(isAllowedPvpPlant('peashooter')).toBe(true)
    expect(isAllowedPvpPlant('wallnut')).toBe(true)
    expect(isAllowedPvpPlant('chomper')).toBe(true)
    expect(isAllowedPvpPlant('garlic')).toBe(true)
    expect(isAllowedPvpPlant('bonkchoy')).toBe(true)
    expect(isAllowedPvpPlant('repeater')).toBe(true)
    expect(isAllowedPvpPlant('melonpult')).toBe(true)
    expect(isAllowedPvpPlant('squash')).toBe(true)
  })

  it('6. Simulación estadística de 10,000 tiradas: CERO Jalapeños y 100% de cartas en el pool permitido', () => {
    const rolledPlants = new Map<PlantId, number>()
    let rareCount = 0

    for (let i = 0; i < 10000; i++) {
      const rollPlant = Math.random()
      const rollRarity = Math.random()
      const rollIndex = Math.random()

      const res = simulateClaimPackSlotDrop(rollPlant, rollRarity, rollIndex)
      if (res.isPlant && res.plantId) {
        if (FORBIDDEN_PVP_PLANTS.includes(res.plantId)) {
          rareCount++
        }
        rolledPlants.set(res.plantId, (rolledPlants.get(res.plantId) || 0) + 1)
      }
    }

    expect(rareCount).toBe(0)
    expect(rolledPlants.has('jalapeno')).toBe(false)
    expect(rolledPlants.has('twinsunflower')).toBe(false)
    expect(rolledPlants.has('aloe')).toBe(false)
    expect(rolledPlants.has('tallnut')).toBe(false)
    expect(rolledPlants.has('iceberglettuce')).toBe(false)
    expect(rolledPlants.has('threepeater')).toBe(false)

    // Comprobar que todas las permitidas pueden salir
    PVP_ALLOWED_PLANTS.forEach((plantId) => {
      expect((rolledPlants.get(plantId) || 0)).toBeGreaterThan(0)
    })
  })

  it('7. Filtro de seguridad en cliente elimina cualquier drop ilegal recibido por error', () => {
    const mockServerResponseDrops: PvpRewardDrop[] = [
      { type: 'plant', plantId: 'peashooter', rarity: 'common', isNew: false, quantity: 1 },
      { type: 'plant', plantId: 'jalapeno' as any, rarity: 'uncommon' as any, isNew: true, quantity: 1 },
      { type: 'gold', quantity: 30 },
    ]

    const sanitizedDrops = mockServerResponseDrops.filter((d) => {
      if (d.type === 'plant') {
        return isAllowedPvpPlant(d.plantId)
      }
      return true
    })

    expect(sanitizedDrops.length).toBe(2)
    expect(sanitizedDrops.some((d) => d.type === 'plant' && d.plantId === 'jalapeno')).toBe(false)
    expect(sanitizedDrops.some((d) => d.type === 'plant' && d.plantId === 'peashooter')).toBe(true)
    expect(sanitizedDrops.some((d) => d.type === 'gold' && d.quantity === 30)).toBe(true)
  })
})
