import { describe, it, expect } from 'vitest'
import { rollSingleCardFromPack, openSeedPack } from './packDropManager'

describe('packDropManager - Actualización de probabilidades y exclusión de Jalapeño', () => {
  it('Jalapeño jamás se entrega en ningún tipo de sobre (básico, épico, legendario)', () => {
    const packs = ['basic', 'epic', 'legendary'] as const
    for (const packId of packs) {
      for (let i = 0; i < 300; i++) {
        const card = rollSingleCardFromPack(packId, [])
        expect(card.plantId).not.toBe('jalapeno')
      }
    }
  })

  it('Sobre Básico entrega 3 cartas y nunca entrega Épica ni Legendaria', () => {
    for (let i = 0; i < 200; i++) {
      const drop = rollSingleCardFromPack('basic', [])
      expect(['COMÚN', 'POCO COMÚN', 'RARA']).toContain(drop.rarityLabel)
      expect(drop.rarityLabel).not.toBe('ÉPICA')
      expect(drop.rarityLabel).not.toBe('LEGENDARIA')
    }

    const pack = openSeedPack('basic', [])
    expect(pack).toHaveLength(3)
  })

  it('Sobre Legendario entrega 4 cartas y nunca entrega Común', () => {
    for (let i = 0; i < 200; i++) {
      const drop = rollSingleCardFromPack('legendary', [])
      expect(drop.rarityLabel).not.toBe('COMÚN')
    }

    const pack = openSeedPack('legendary', [])
    expect(pack).toHaveLength(4)
  })

  it('Sobre Místico entrega 4 cartas', () => {
    const pack = openSeedPack('epic', [])
    expect(pack).toHaveLength(4)
  })
})
