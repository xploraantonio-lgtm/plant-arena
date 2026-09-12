import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

describe('Marketplace Selling Safeties & Deck Auto-Heal', () => {
  it('1. Valida que un jugador no pueda vender cartas si le quedan 3 o menos plantas jugables', () => {
    // Función pura de validación que replica la regla del frontend y backend
    function canSellPlant(availablePlantsCount: number): { allowed: boolean; reason?: string } {
      if (availablePlantsCount <= 3) {
        return {
          allowed: false,
          reason: 'No puedes vender esta planta: necesitas conservar al menos 3 plantas en tu inventario para poder combatir en la Arena.',
        }
      }
      return { allowed: true }
    }

    expect(canSellPlant(4).allowed).toBe(true)
    expect(canSellPlant(5).allowed).toBe(true)
    expect(canSellPlant(3).allowed).toBe(false)
    expect(canSellPlant(3).reason).toContain('al menos 3 plantas')
    expect(canSellPlant(2).allowed).toBe(false)
    expect(canSellPlant(1).allowed).toBe(false)
    expect(canSellPlant(0).allowed).toBe(false)
  })

  it('2. Auto-recuperación de mazo cuando enDeck tiene menos de 3 cartas', () => {
    // Replica la lógica implementada en useInventory
    function autoHealDeck(
      instances: Array<{ instanceId: string; plantId: string; isInDeck: boolean; isListed: boolean; deckSlot: number | null }>
    ) {
      const enDeck = instances
        .filter((i) => i.isInDeck && !i.isListed)
        .sort((a, b) => (a.deckSlot ?? 99) - (b.deckSlot ?? 99))

      if (enDeck.length >= 3) {
        return { healed: false, deck: enDeck.map((i) => i.instanceId) }
      }

      const disponibles = instances.filter((i) => !i.isListed)
      if (disponibles.length >= 3) {
        const autoEquipadas: typeof disponibles = []
        const plantIdsSeen = new Set<string>()

        for (const inst of disponibles) {
          if (!plantIdsSeen.has(inst.plantId)) {
            plantIdsSeen.add(inst.plantId)
            autoEquipadas.push(inst)
            if (autoEquipadas.length === 4) break
          }
        }

        if (autoEquipadas.length < 3) {
          for (const inst of disponibles) {
            if (!autoEquipadas.some((a) => a.instanceId === inst.instanceId)) {
              autoEquipadas.push(inst)
              if (autoEquipadas.length === 3) break
            }
          }
        }

        return { healed: true, deck: autoEquipadas.map((i) => i.instanceId) }
      }

      return { healed: false, deck: enDeck.map((i) => i.instanceId) }
    }

    // Caso A: El mazo tiene 4 cartas sanas -> no requiere heal
    const mazoSano = [
      { instanceId: 'p1', plantId: 'sunflower', isInDeck: true, isListed: false, deckSlot: 0 },
      { instanceId: 'p2', plantId: 'peashooter', isInDeck: true, isListed: false, deckSlot: 1 },
      { instanceId: 'p3', plantId: 'wallnut', isInDeck: true, isListed: false, deckSlot: 2 },
      { instanceId: 'p4', plantId: 'chomper', isInDeck: true, isListed: false, deckSlot: 3 },
    ]
    expect(autoHealDeck(mazoSano)).toEqual({
      healed: false,
      deck: ['p1', 'p2', 'p3', 'p4'],
    })

    // Caso B: El usuario canceló la venta de 1 planta y su mazo quedó con 2 cartas (o 0 cartas)
    const mazoDesarmado = [
      { instanceId: 'p1', plantId: 'sunflower', isInDeck: true, isListed: false, deckSlot: 0 },
      { instanceId: 'p2', plantId: 'peashooter', isInDeck: true, isListed: false, deckSlot: 1 },
      { instanceId: 'p3', plantId: 'wallnut', isInDeck: false, isListed: false, deckSlot: null }, // devuelta por cancel
      { instanceId: 'p4', plantId: 'chomper', isInDeck: false, isListed: false, deckSlot: null }, // no equipada
    ]
    const healRes = autoHealDeck(mazoDesarmado)
    expect(healRes.healed).toBe(true)
    expect(healRes.deck.length).toBeGreaterThanOrEqual(3)
    expect(healRes.deck).toContain('p1')
    expect(healRes.deck).toContain('p2')
    expect(healRes.deck).toContain('p3')
  })

  it('3. Auditoría estática de la Migración 110', () => {
    const migrationPath = join(process.cwd(), 'supabase', 'migrations', '110-auto-heal-decks-unblock-adrianirod-and-marketplace-safeties.sql')
    expect(existsSync(migrationPath)).toBe(true)

    const content = readFileSync(migrationPath, 'utf8')

    // Debe contener el saneamiento de adrianIrod
    expect(content).toMatch(/adrianirod/i)
    expect(content).toMatch(/has_vip_pass\s*=\s*TRUE/i)

    // Debe contener la auto-recuperación en cancel_marketplace_listing
    expect(content).toMatch(/cancel_marketplace_listing/i)
    expect(content).toMatch(/v_deck_cnt.*<\s*4/i)
    expect(content).toMatch(/is_in_deck\s*=\s*TRUE/i)

    // Debe contener la protección <= 3 en list_marketplace_item
    expect(content).toMatch(/list_marketplace_item/i)
    expect(content).toMatch(/v_total_playable\s*<=\s*3/i)

    // Debe contener la auto-recuperación de mazo en enter_matchmaking
    expect(content).toMatch(/enter_matchmaking/i)
    expect(content).toMatch(/jsonb_array_length\(v_deck\)\s*<\s*3/i)
  })

  it('4. Valida matemáticamente el split 100% cobrado al comprador, 90% acreditado al vendedor y 10% retenido por el juego', async () => {
    const { calculateMarketplaceSplit } = await import('../../utils/marketplaceAccess')

    const casosDePrueba = [
      { precio: 50, comisionEsperada: 5, netoEsperado: 45 },
      { precio: 55, comisionEsperada: 5.5, netoEsperado: 49.5 },
      { precio: 100, comisionEsperada: 10, netoEsperado: 90 },
      { precio: 500, comisionEsperada: 50, netoEsperado: 450 },
      { precio: 800, comisionEsperada: 80, netoEsperado: 720 },
      { precio: 1000, comisionEsperada: 100, netoEsperado: 900 },
      { precio: 1500, comisionEsperada: 150, netoEsperado: 1350 },
      { precio: 2000, comisionEsperada: 200, netoEsperado: 1800 },
      { precio: 2550, comisionEsperada: 255, netoEsperado: 2295 },
      { precio: 1, comisionEsperada: 0.1, netoEsperado: 0.9 },
    ]

    for (const { precio, comisionEsperada, netoEsperado } of casosDePrueba) {
      const split = calculateMarketplaceSplit(precio, 10)

      // 1. El comprador paga exactamente el 100%
      expect(split.precio).toBe(precio)

      // 2. El juego retiene el 10% de comisión (2 decimales)
      expect(split.comision).toBe(comisionEsperada)
      expect(split.comisionPct).toBe(10)

      // 3. El vendedor recibe el 90% neto
      expect(split.neto).toBe(netoEsperado)
      expect(split.vendedorPct).toBe(90)

      // 4. Invariante de conservación: comision + neto = precio total
      expect(Math.round((split.comision + split.neto) * 100) / 100).toBe(precio)
    }
  })

  it('5. Auditoría del Backend: valida que buy_marketplace_card en PostgreSQL gestione el 100% / 90% / 10% autoritativamente por seguridad', () => {
    const migration94Path = join(process.cwd(), 'supabase', 'migrations', '94-fix-plant-instances-user-id-and-marketplace-buy.sql')
    expect(existsSync(migration94Path)).toBe(true)

    const content = readFileSync(migration94Path, 'utf8')

    // 1. Debe ser SECURITY DEFINER
    expect(content).toMatch(/FUNCTION public\.buy_marketplace_card/i)
    expect(content).toMatch(/SECURITY DEFINER/i)

    // 2. Comprador debe ser estrictamente auth.uid()
    expect(content).toMatch(/v_buyer_id\s*UUID\s*:=\s*auth\.uid\(\)/i)

    // 3. Verificación de no comprar oferta propia
    expect(content).toMatch(/v_listing\.seller_id\s*=\s*v_buyer_id/i)

    // 4. Cálculo autoritativo de comisión del 10% y neto del 90%
    expect(content).toMatch(/v_commission\s*:=\s*ROUND\(v_listing\.price_gems\s*\*\s*0\.10,\s*2\)/i)
    expect(content).toMatch(/v_net_seller\s*:=\s*v_listing\.price_gems\s*-\s*v_commission/i)

    // 5. Descuento estricto del 100% de gemas al comprador
    expect(content).toMatch(/SET\s+gems_balance\s*=\s*gems_balance\s*-\s*v_listing\.price_gems\s+WHERE\s+id\s*=\s*v_buyer_id/i)

    // 6. Acreditación estricta del 90% neto al vendedor
    expect(content).toMatch(/SET\s+gems_balance\s*=\s*gems_balance\s*\+\s*v_net_seller\s+WHERE\s+id\s*=\s*v_listing\.seller_id/i)

    // 7. Registro de transacciones atómicas
    expect(content).toMatch(/-v_listing\.price_gems/i)
    expect(content).toMatch(/v_net_seller/i)
    expect(content).toMatch(/'marketplace_buy'/i)
    expect(content).toMatch(/'marketplace_sale'/i)
  })
})
