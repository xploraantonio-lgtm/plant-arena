import { describe, it, expect } from 'vitest'
import { rollSingleCardFromPack, openSeedPack } from './packDropManager'

describe('packDropManager - Sistema de Ranura Destacada y Exclusión de Jalapeño', () => {
  it('Jalapeño jamás se entrega en ningún tipo de sobre (básico, épico, legendario)', () => {
    const packs = ['basic', 'epic', 'legendary'] as const
    for (const packId of packs) {
      for (let i = 0; i < 200; i++) {
        const card = rollSingleCardFromPack(packId, [], i % 2 === 0)
        expect(card.plantId).not.toBe('jalapeno')
      }
    }
  })

  it('Sobre Básico entrega 3 cartas, máximo 1 Rara y nunca Épica ni Legendaria', () => {
    for (let i = 0; i < 100; i++) {
      const pack = openSeedPack('basic', [])
      expect(pack).toHaveLength(3)

      const rares = pack.filter((c) => c.rarityLabel === 'RARA')
      const epics = pack.filter((c) => c.rarityLabel === 'ÉPICA')
      const legendaries = pack.filter((c) => c.rarityLabel === 'LEGENDARIA')

      expect(rares.length).toBeLessThanOrEqual(1)
      expect(epics).toHaveLength(0)
      expect(legendaries).toHaveLength(0)
    }
  })

  it('Sobre Legendario entrega 4 cartas, NUNCA más de 1 Legendaria y NUNCA Común', () => {
    let packsWithLegendary = 0
    const totalPacks = 500

    for (let i = 0; i < totalPacks; i++) {
      const pack = openSeedPack('legendary', [])
      expect(pack).toHaveLength(4)

      // Jamás debe salir Común en sobre legendario
      const commons = pack.filter((c) => c.rarityLabel === 'COMÚN')
      expect(commons).toHaveLength(0)

      // Jamás 2 o más legendarias en el mismo sobre
      const legendaries = pack.filter((c) => c.rarityLabel === 'LEGENDARIA')
      expect(legendaries.length).toBeLessThanOrEqual(1)

      if (legendaries.length === 1) {
        packsWithLegendary++
      }
    }

    // La tasa de sobres con Legendaria debe rondar el 10% (tolerancia estadística amplia para 500 muestras: 5% a 16%)
    const rate = packsWithLegendary / totalPacks
    expect(rate).toBeGreaterThanOrEqual(0.05)
    expect(rate).toBeLessThanOrEqual(0.16)
  })

  it('Sobre Místico entrega 4 cartas y máximo 1 Legendaria', () => {
    for (let i = 0; i < 100; i++) {
      const pack = openSeedPack('epic', [])
      expect(pack).toHaveLength(4)

      const legendaries = pack.filter((c) => c.rarityLabel === 'LEGENDARIA')
      expect(legendaries.length).toBeLessThanOrEqual(1)
    }
  })
})
