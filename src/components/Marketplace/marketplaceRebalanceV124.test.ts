import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import {
  getPlantRarityAndMinPrice,
  getFarmingItemMinPrice,
  FARMING_ITEM_MIN_PRICES,
} from '../../utils/marketplaceManager'
import { calculateMarketplaceSplit } from '../../utils/marketplaceAccess'
import type { PlantId } from '../../types/game'

describe('Marketplace Rebalance V124 - New Rules & Batch Selling', () => {
  it('1. Cualquier carta de planta tiene un precio mínimo plano de 100 gemas', () => {
    const plantsToTest: PlantId[] = [
      'sunflower',      // Común
      'peashooter',     // Común
      'garlic',         // Poco Común
      'bonkchoy',       // Poco Común
      'twinsunflower',  // Rara
      'jalapeno',       // Rara
      'aloe',           // Épica
      'tallnut',        // Épica
      'iceberglettuce', // Legendaria
      'threepeater',    // Legendaria
    ]

    plantsToTest.forEach((plantId) => {
      const info = getPlantRarityAndMinPrice(plantId)
      expect(info.minPrice).toBe(100)
    })
  })

  it('2. Todos los ítems de cultivo tienen un precio mínimo de 10 gemas', () => {
    const items = ['water', 'fertilizer', 'shovel_fragment', 'pesticide', 'scarecrow_fragment', 'shovel', 'scarecrow'] as const

    items.forEach((itemId) => {
      expect(FARMING_ITEM_MIN_PRICES[itemId]).toBe(10)
      expect(getFarmingItemMinPrice(itemId)).toBe(10)
    })
  })

  it('3. Cálculo autoritativo de split: 90% neto vendedor y 10% comisión del juego', () => {
    // Caso 1: Lote de 10 aguas por 150 gemas
    const split150 = calculateMarketplaceSplit(150, 10)
    expect(split150.precio).toBe(150)
    expect(split150.comision).toBe(15)
    expect(split150.neto).toBe(135)
    expect(split150.comisionPct).toBe(10)
    expect(split150.vendedorPct).toBe(90)

    // Caso 2: Planta por precio mínimo de 100 gemas
    const split100 = calculateMarketplaceSplit(100, 10)
    expect(split100.precio).toBe(100)
    expect(split100.comision).toBe(10)
    expect(split100.neto).toBe(90)

    // Caso 3: Lote mínimo de 10 gemas
    const split10 = calculateMarketplaceSplit(10, 10)
    expect(split10.precio).toBe(10)
    expect(split10.comision).toBe(1)
    expect(split10.neto).toBe(9)
  })

  it('4. Auditoría estática de la Migración 124 en Supabase', () => {
    const migrationPath = join(process.cwd(), 'supabase', 'migrations', '124-marketplace-rebalance-batch-selling-and-safeties.sql')
    expect(existsSync(migrationPath)).toBe(true)

    const sql = readFileSync(migrationPath, 'utf8')

    // Verificación de cancelación limpia
    expect(sql).toContain("status = 'cancelled'")
    expect(sql).toContain("Se cancelaron y reembolsaron % ofertas activas")

    // Verificación de mínimos en backend
    expect(sql).toContain('p_price_gems < 100')
    expect(sql).toContain('p_price_gems < 10')

    // Verificación de Enfoque B: No permitir venta si la planta está equipada en el mazo
    expect(sql).toContain('Esta planta está en tu mazo de batalla. Desequípala tú mismo en Mi Jardín antes de ponerla en venta.')
    expect(sql).toContain('p_quantity')

    // Verificación de saldo retirable anti-lavado
    expect(sql).toContain('v_buyer_withdrawable')
    expect(sql).toContain('plantarena.is_withdrawal')

    // Verificación de buy_energy_pack
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.buy_energy_pack')
    expect(sql).toContain('energy_3')
    expect(sql).toContain('energy_5')
    expect(sql).toContain('energy_12')
  })
})
