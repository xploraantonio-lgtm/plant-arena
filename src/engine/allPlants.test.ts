import { describe, it, expect } from 'vitest'
import { PLANT_CONFIGS, getScaledPlantConfig } from '../utils/gameConstants'
import type { PlantId } from '../types/game'
import {
  createBattleState,
  stepTick,
  crearPlantaPropia,
  crearPlantaDelRival,
  type GameState,
} from './simulate'
import { msToTicks } from './time'

const ALL_PLANT_IDS: PlantId[] = [
  'sunflower',
  'peashooter',
  'repeater',
  'wallnut',
  'melonpult',
  'chomper',
  'bonkchoy',
  'garlic',
  'squash',
  'twinsunflower',
  'threepeater',
  'tallnut',
  'jalapeno',
  'iceberglettuce',
  'aloe',
]

const noopSonar = () => {}

function correr(estado: GameState, tics: number) {
  for (let i = 0; i < tics; i++) stepTick(estado, noopSonar)
}

describe('allPlants.test.ts - Catálogo completo de las 15 plantas y escalado', () => {
  it('contiene exactamente las 15 plantas en PLANT_CONFIGS', () => {
    const catalogKeys = Object.keys(PLANT_CONFIGS) as PlantId[]
    expect(catalogKeys.length).toBe(15)
    for (const id of ALL_PLANT_IDS) {
      expect(catalogKeys).toContain(id)
      expect(PLANT_CONFIGS[id]).toBeDefined()
    }
  })

  describe('getScaledPlantConfig() para todas las plantas', () => {
    ALL_PLANT_IDS.forEach((plantId) => {
      it(`genera configuración válida y escalada para "${plantId}"`, () => {
        const base = PLANT_CONFIGS[plantId]
        expect(base).toBeDefined()
        expect(base.id).toBe(plantId)
        expect(base.name.length).toBeGreaterThan(0)
        expect(base.maxHp).toBeGreaterThan(0)
        expect(base.cooldownMs).toBeGreaterThan(0)
        expect(base.cost).toBeGreaterThanOrEqual(0)

        // Test escalado de HP
        const scaledHp = getScaledPlantConfig(plantId, ['hp'])
        expect(scaledHp.maxHp).toBe(Math.round(base.maxHp * 1.15))
        if (base.maxHp > 1) {
          expect(scaledHp.maxHp).toBeGreaterThan(base.maxHp)
        }

        // Test escalado de Cooldown
        const scaledCd = getScaledPlantConfig(plantId, ['cooldown'])
        expect(scaledCd.cooldownMs).toBe(Math.round(base.cooldownMs * 0.85))
        expect(scaledCd.cooldownMs).toBeLessThan(base.cooldownMs)

        // Test escalado de Daño si aplica
        if (base.damage !== undefined && base.damage > 0) {
          const scaledDmg = getScaledPlantConfig(plantId, ['damage'])
          expect(scaledDmg.damage).toBeDefined()
          expect(scaledDmg.damage!).toBe(Math.round(base.damage * 1.15))
          expect(scaledDmg.damage!).toBeGreaterThan(base.damage)
        }

        // Test escalado de Velocidad de Ataque si aplica
        if (base.attackSpeedMs !== undefined) {
          const scaledSpeed = getScaledPlantConfig(plantId, ['attackSpeed'])
          expect(scaledSpeed.attackSpeedMs).toBeDefined()
          expect(scaledSpeed.attackSpeedMs!).toBe(Math.round(base.attackSpeedMs * 0.85))
          expect(scaledSpeed.attackSpeedMs!).toBeLessThan(base.attackSpeedMs)
        }

        // Test escalado de Velocidad de Movimiento si aplica
        if (base.moveSpeed !== undefined) {
          const scaledMove = getScaledPlantConfig(plantId, ['moveSpeed'])
          expect(scaledMove.moveSpeed).toBeDefined()
          expect(scaledMove.moveSpeed!).toBeGreaterThan(base.moveSpeed)
        }
      })
    })
  })

  describe('Pruebas especiales por planta', () => {
    describe('Jalapeño', () => {
      it('calcula exactamente 1150 de daño con 1 roll de daño (1000 * 1.15 = 1150)', () => {
        const base = getScaledPlantConfig('jalapeno', [])
        expect(base.damage).toBe(1000)

        const conRoll = getScaledPlantConfig('jalapeno', ['damage'])
        expect(conRoll.damage).toBe(1150)

        const conDosRolls = getScaledPlantConfig('jalapeno', ['damage', 'damage'])
        expect(conDosRolls.damage).toBe(1300) // 1000 * (1 + 0.15 + 0.15) = 1300
      })

      it('P1 aplica exactamente 1150 de daño a enemigos en su carril al usar statRolls ["damage"]', () => {
        const state: GameState = createBattleState(1234, false, true)
        const dummyEnemy = crearPlantaDelRival(state, 'tallnut', 1, 2, [], 0)
        dummyEnemy.hp = 1200
        dummyEnemy.maxHp = 1200
        state.enemyPlants = [dummyEnemy]

        state.pending.push({
          atTick: state.tick,
          kind: 'own_plant',
          plantId: 'jalapeno',
          lane: 1,
          col: 0,
          statRolls: ['damage'],
        })

        correr(state, 2)

        // Con 1150 de daño, la nuez de 1200 HP debe quedar en 50 HP (1200 - 1150 = 50)
        expect(dummyEnemy.hp).toBe(50)
      })

      it('P2 (Rival) aplica exactamente 1150 de daño a plantas de P1 al usar statRolls ["damage"]', () => {
        const state: GameState = createBattleState(5678, false, true)
        const dummyAlly = crearPlantaPropia(state, 'tallnut', 2, 2, [], 0)
        dummyAlly.hp = 1200
        dummyAlly.maxHp = 1200
        state.plants = [dummyAlly]

        state.pending.push({
          atTick: state.tick,
          kind: 'rival_plant',
          plantId: 'jalapeno',
          lane: 2,
          col: 0,
          statRolls: ['damage'],
          level: 0,
        })

        correr(state, 2)

        // Con 1150 de daño, la nuez aliada de 1200 HP debe quedar en 50 HP
        expect(dummyAlly.hp).toBe(50)
      })

      it('Jalapeño sin rolls aplica el daño base de 1000', () => {
        const state: GameState = createBattleState(9999, false, true)
        const dummyEnemy = crearPlantaDelRival(state, 'tallnut', 0, 2, [], 0)
        dummyEnemy.hp = 1200
        dummyEnemy.maxHp = 1200
        state.enemyPlants = [dummyEnemy]

        state.pending.push({
          atTick: state.tick,
          kind: 'own_plant',
          plantId: 'jalapeno',
          lane: 0,
          col: 0,
          statRolls: [],
        })

        correr(state, 2)
        expect(dummyEnemy.hp).toBe(200) // 1200 - 1000 = 200
      })
    })

    describe('Twin Sunflower', () => {
      it('está configurada como productora y escala con hp y cooldown', () => {
        const config = PLANT_CONFIGS.twinsunflower
        expect(config.category).toBe('producer')
        expect(config.cost).toBe(125)
        expect(config.maxHp).toBe(300)
        expect(config.cooldownMs).toBe(10000)

        const scaled = getScaledPlantConfig('twinsunflower', ['hp', 'cooldown'])
        expect(scaled.maxHp).toBe(345)
        expect(scaled.cooldownMs).toBe(8500)
      })
    })

    describe('Iceberg Lettuce (Lechuga Helada)', () => {
      it('está configurada como defensiva de coste 0', () => {
        const config = PLANT_CONFIGS.iceberglettuce
        expect(config.cost).toBe(0)
        expect(config.category).toBe('defensive')
        expect(config.cooldownMs).toBe(12000)
      })

      it('congela a los enemigos en el campo al plantarse', () => {
        const state: GameState = createBattleState(1111, false, true)
        const rival = crearPlantaDelRival(state, 'peashooter', 0, 4, [], 0)
        state.enemyPlants = [rival]

        state.pending.push({
          atTick: state.tick,
          kind: 'own_plant',
          plantId: 'iceberglettuce',
          lane: 0,
          col: 1,
          statRolls: [],
        })

        correr(state, 2)

        expect(rival.frozenUntil).toBeDefined()
        expect(rival.frozenUntil!).toBeGreaterThan(state.tick)
      })
    })

    describe('Aloe', () => {
      it('está configurada con rol curativo y velocidad de ataque', () => {
        const config = PLANT_CONFIGS.aloe
        expect(config.category).toBe('producer')
        expect(config.cost).toBe(100)
        expect(config.damage).toBe(60) // Cantidad de curación
        expect(config.attackSpeedMs).toBe(2500)
      })

      it('cura a una planta herida de su carril', () => {
        const state: GameState = createBattleState(2222, false, true)
        const ally = crearPlantaPropia(state, 'wallnut', 1, 0, [], 0)
        ally.hp = 200
        ally.maxHp = 850

        const aloe = crearPlantaPropia(state, 'aloe', 1, 1, [], 0)
        aloe.lastActionTime = state.tick - msToTicks(3000) // Lista para curar
        state.plants = [ally, aloe]

        stepTick(state, noopSonar)

        expect(ally.hp).toBe(260) // 200 + 60 = 260
        expect(ally.isHealingFx).toBe(true)
      })
    })

    describe('Repeater', () => {
      it('está configurada como atacante a distancia de doble disparo', () => {
        const config = PLANT_CONFIGS.repeater
        expect(config.category).toBe('ranged')
        expect(config.cost).toBe(200)
        expect(config.damage).toBe(25)

        const scaled = getScaledPlantConfig('repeater', ['damage', 'attackSpeed'])
        expect(scaled.damage).toBe(29) // 25 * 1.15 = 28.75 -> 29
        expect(scaled.attackSpeedMs).toBe(Math.round(config.attackSpeedMs! * 0.85))
      })
    })

    describe('Threepeater', () => {
      it('está configurada como atacante multilínea de 3 carriles', () => {
        const config = PLANT_CONFIGS.threepeater
        expect(config.category).toBe('ranged')
        expect(config.cost).toBe(325)
        expect(config.damage).toBe(75)
        expect(config.attackSpeedMs).toBe(1400)

        const scaled = getScaledPlantConfig('threepeater', ['damage', 'hp'])
        expect(scaled.damage).toBe(86)
        expect(scaled.maxHp).toBe(345)
      })
    })
  })
})
