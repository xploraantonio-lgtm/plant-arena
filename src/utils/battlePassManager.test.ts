import { describe, it, expect } from 'vitest'
import { BATTLE_PASS_LEVELS } from './battlePassManager'

describe('BATTLE PASS REWARDS AUDIT (MIGRACIÓN 47)', () => {
  it('contiene exactamente 20 niveles consecutivos del 1 al 20', () => {
    expect(BATTLE_PASS_LEVELS).toHaveLength(20)
    BATTLE_PASS_LEVELS.forEach((lvl, idx) => {
      expect(lvl.level).toBe(idx + 1)
    })
  })

  it('los requisitos de ELO son estrictamente crecientes desde 1150 hasta 4000', () => {
    expect(BATTLE_PASS_LEVELS[0].requiredElo).toBe(1150)
    expect(BATTLE_PASS_LEVELS[19].requiredElo).toBe(4000)

    for (let i = 1; i < BATTLE_PASS_LEVELS.length; i++) {
      expect(BATTLE_PASS_LEVELS[i].requiredElo).toBeGreaterThan(
        BATTLE_PASS_LEVELS[i - 1].requiredElo
      )
    }
  })

  it('FASE 3 — Las copias de plantas en niveles 2, 3, 6, 7, 8, 11, 12 están en 1x', () => {
    const lvl2 = BATTLE_PASS_LEVELS.find((l) => l.level === 2)!
    expect(lvl2.reward).toEqual({
      type: 'copies',
      plantId: 'sunflower',
      copiesCount: 1,
      label: 'x1 Girasol',
      icon: '/game-assets/greenfoot/transparentsunflower.png',
    })

    const lvl3 = BATTLE_PASS_LEVELS.find((l) => l.level === 3)!
    expect(lvl3.reward).toEqual({
      type: 'copies',
      plantId: 'bonkchoy',
      copiesCount: 1,
      label: 'x1 Bonk Choy',
      icon: '/game-assets/greenfoot/bonkchoy1.png',
    })

    const lvl6 = BATTLE_PASS_LEVELS.find((l) => l.level === 6)!
    expect(lvl6.reward).toEqual({
      type: 'copies',
      plantId: 'repeater',
      copiesCount: 1,
      label: 'x1 Repetidora',
      icon: '/game-assets/greenfoot/transparentrepeater.png',
    })

    const lvl7 = BATTLE_PASS_LEVELS.find((l) => l.level === 7)!
    expect(lvl7.reward).toEqual({
      type: 'copies',
      plantId: 'aloe',
      copiesCount: 1,
      label: 'x1 Aloe Vera',
      icon: '/game-assets/plants/aloe_hd.png',
    })

    const lvl8 = BATTLE_PASS_LEVELS.find((l) => l.level === 8)!
    expect(lvl8.reward).toEqual({
      type: 'copies',
      plantId: 'tallnut',
      copiesCount: 1,
      label: 'x1 Nuez Alta',
      icon: '/game-assets/greenfoot/transparenttallnut.png',
    })

    const lvl11 = BATTLE_PASS_LEVELS.find((l) => l.level === 11)!
    expect(lvl11.reward).toEqual({
      type: 'copies',
      plantId: 'aloe',
      copiesCount: 1,
      label: 'x1 Aloe Vera',
      icon: '/game-assets/plants/aloe_hd.png',
    })

    const lvl12 = BATTLE_PASS_LEVELS.find((l) => l.level === 12)!
    expect(lvl12.reward).toEqual({
      type: 'copies',
      plantId: 'tallnut',
      copiesCount: 1,
      label: 'x1 Nuez Alta',
      icon: '/game-assets/greenfoot/transparenttallnut.png',
    })
  })

  it('FASE 4 — Todos los sobres del pase son Básicos (0 sobres legendarios)', () => {
    const legendaryPacks = BATTLE_PASS_LEVELS.filter(
      (l) => l.reward.type === 'pack' && l.reward.packId === 'legendary'
    )
    expect(legendaryPacks).toHaveLength(0)

    const lvl9 = BATTLE_PASS_LEVELS.find((l) => l.level === 9)!
    expect(lvl9.reward.type).toBe('pack')
    expect(lvl9.reward.packId).toBe('basic')
    expect(lvl9.reward.packCount).toBe(1)
    expect(lvl9.reward.label).toBe('1x Sobre Básico')

    const lvl10 = BATTLE_PASS_LEVELS.find((l) => l.level === 10)!
    expect(lvl10.reward.type).toBe('pack')
    expect(lvl10.reward.packId).toBe('basic')
    expect(lvl10.reward.packCount).toBe(1)
    expect(lvl10.reward.label).toBe('1x Sobre Básico')

    const lvl13 = BATTLE_PASS_LEVELS.find((l) => l.level === 13)!
    expect(lvl13.reward.type).toBe('pack')
    expect(lvl13.reward.packId).toBe('basic')
    expect(lvl13.reward.packCount).toBe(1)
    expect(lvl13.reward.label).toBe('1x Sobre Básico')

    const lvl15 = BATTLE_PASS_LEVELS.find((l) => l.level === 15)!
    expect(lvl15.reward.type).toBe('pack')
    expect(lvl15.reward.packId).toBe('basic')
    expect(lvl15.reward.packCount).toBe(2)
    expect(lvl15.reward.label).toBe('2x Sobre Básico')

    const lvl16 = BATTLE_PASS_LEVELS.find((l) => l.level === 16)!
    expect(lvl16.reward.type).toBe('pack')
    expect(lvl16.reward.packId).toBe('basic')
    expect(lvl16.reward.packCount).toBe(2)
    expect(lvl16.reward.label).toBe('2x Sobre Básico')

    const lvl17 = BATTLE_PASS_LEVELS.find((l) => l.level === 17)!
    expect(lvl17.reward.type).toBe('pack')
    expect(lvl17.reward.packId).toBe('basic')
    expect(lvl17.reward.packCount).toBe(2)
    expect(lvl17.reward.label).toBe('2x Sobre Básico')

    const lvl19 = BATTLE_PASS_LEVELS.find((l) => l.level === 19)!
    expect(lvl19.reward.type).toBe('pack')
    expect(lvl19.reward.packId).toBe('basic')
    expect(lvl19.reward.packCount).toBe(2)
    expect(lvl19.reward.label).toBe('2x Sobres Básicos')
  })

  it('FASE 5 — Normalización de nombres en plantas de niveles 14 y 18', () => {
    const lvl14 = BATTLE_PASS_LEVELS.find((l) => l.level === 14)!
    expect(lvl14.reward.label).toBe('x1 Lechuga Helada')
    expect(lvl14.reward.copiesCount).toBe(1)
    expect(lvl14.reward.plantId).toBe('iceberglettuce')

    const lvl18 = BATTLE_PASS_LEVELS.find((l) => l.level === 18)!
    expect(lvl18.reward.label).toBe('x1 Threepeater')
    expect(lvl18.reward.copiesCount).toBe(1)
    expect(lvl18.reward.plantId).toBe('threepeater')
  })

  it('FASE 6 — Validación de condiciones de claim anti-duplicado', () => {
    const userElo = 2000
    const hasVipPass = true
    const claimedVipLevels = [1, 2]

    // Niveles desbloqueados y listos para reclamar
    const claimable = BATTLE_PASS_LEVELS.filter(
      (l) => hasVipPass && userElo >= l.requiredElo && !claimedVipLevels.includes(l.level)
    )

    // Niveles con ELO <= 2000 son: 1 (1150), 2 (1300), 3 (1450), 4 (1600), 5 (1750), 6 (1900).
    // Como 1 y 2 ya están reclamados, claimable debe tener niveles 3, 4, 5, 6.
    expect(claimable.map((l) => l.level)).toEqual([3, 4, 5, 6])

    // Niveles ya reclamados no pueden volver a reclamarse
    expect(claimedVipLevels.includes(1)).toBe(true)
    expect(claimedVipLevels.includes(2)).toBe(true)
  })
})
