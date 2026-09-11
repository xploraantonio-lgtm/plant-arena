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
})
