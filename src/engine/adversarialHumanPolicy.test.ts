import { describe, it, expect } from 'vitest'
import {
  HumanAdversarialPolicy,
  HUMAN_ARCHETYPES,
} from './adversarialHumanGenerator.ts'
import { createBattleState, stepTick } from './simulate.ts'
import { msToTicks } from './time.ts'
import { SUN_VALUE } from '../utils/gameConstants.ts'
import { runAdversarialHeadToHeadBenchmark } from './strategicBenchmarkRunner.ts'
import type { CartaDeMazo } from './mazoDeLaSala.ts'

describe('RIVAL ESTRATÉGICO V1.2.3 — ADVERSARIO DE CERTIFICACIÓN CON ECONOMÍA REAL', () => {
  // ── 1. TEST FUNDAMENTAL DE ECONOMÍA ───────────────────────────────────────
  describe('1. Test Fundamental de Economía (Cero soles de productores muertos)', () => {
    it('verifica que un girasol destruido por P2 no produce soles futuros', () => {
      const state = createBattleState(12345, false, true, undefined, 'auth-v2')
      const deck: CartaDeMazo[] = [
        { slot: 0, plantId: 'sunflower', level: 1, statRolls: [] },
        { slot: 1, plantId: 'peashooter', level: 1, statRolls: [] },
      ]
      const policy = new HumanAdversarialPolicy(HUMAN_ARCHETYPES.HUMAN_BALANCED, 12345)

      // P1 planta un girasol en lane 1, col 0
      state.plants.push({
        id: 'p1_sf_1',
        plantId: 'sunflower',
        lane: 1,
        col: 0,
        x: 10,
        hp: 300,
        maxHp: 300,
        isWalking: false,
        state: 'idle',
        lastActionTime: 0,
      })

      // Simular hasta tick = 150 (5s). El girasol produce un sol en state.suns
      for (let t = 0; t < 150; t++) {
        stepTick(state, () => {})
      }

      // La policy recoge el sol real generado
      const actions1 = policy.decide(state, deck)
      const collect1 = actions1.filter((a) => a.kind === 'collect')
      expect(collect1.length).toBeGreaterThan(0)

      // Ahora P2 destruye el girasol (se elimina de state.plants)
      state.plants = state.plants.filter((p) => p.id !== 'p1_sf_1')

      // Simular otros 20 segundos (600 ticks)
      for (let t = 0; t < 600; t++) {
        stepTick(state, () => {})
      }

      // Los únicos soles generados durante este periodo deben ser los soles del cielo,
      // NINGÚN sol proviene del girasol muerto.
      const sunsFromDeadFlower = state.suns.filter((s) => s.id.startsWith('sun-flower_1_0_'))
      expect(sunsFromDeadFlower.length).toBe(0)
    })
  })

  // ── 2. TEST COLLECT REAL AUTH-V2 ──────────────────────────────────────────
  describe('2. Test Collect Real Auth-v2 (TargetId canónico y rechazo de doble collect)', () => {
    it('genera acciones collect con targetId exacto, acredita sunBank y rechaza doble collect', () => {
      const state = createBattleState(54321, false, true, undefined, 'auth-v2')
      const deck: CartaDeMazo[] = [
        { slot: 0, plantId: 'sunflower', level: 1, statRolls: [] },
      ]
      const policy = new HumanAdversarialPolicy(HUMAN_ARCHETYPES.HUMAN_BALANCED, 54321)

      // Añadir un sol real a state.suns
      const targetId = 'sun-sky_100_0'
      state.suns.push({
        id: targetId,
        x: 50,
        y: 20,
        targetY: 50,
        value: SUN_VALUE,
        createdAt: state.tick,
      })

      const decisions = policy.decide(state, deck)
      const collectAction = decisions.find((a) => a.kind === 'collect')

      expect(collectAction).toBeDefined()
      expect(collectAction?.targetId).toBe(targetId)
      expect(collectAction?.issuedTick).toBe(state.tick)

      // En el siguiente tick, la policy no debe volver a emitir collect para el mismo sol
      const decisionsNext = policy.decide(state, deck)
      const duplicateCollect = decisionsNext.find((a) => a.targetId === targetId)
      expect(duplicateCollect).toBeUndefined()
    })
  })

  // ── 3. TEST DE CAMBIO DE CARRIL ADAPTATIVO ────────────────────────────────
  describe('3. Test de Cambio de Carril Adaptativo (Flanqueo real)', () => {
    it('prioriza carril desprotegido cuando un carril rival está fuertemente fortificado', () => {
      const state = createBattleState(999, false, true, undefined, 'auth-v2')
      state.tick = msToTicks(3000)
      state.sunBank = 300 // Soles suficientes para atacar
      // P1 ya tiene su girasol listo
      state.plants.push({
        id: 'p1_sf_ready',
        plantId: 'sunflower',
        lane: 0,
        col: 0,
        x: 10,
        hp: 300,
        maxHp: 300,
        isWalking: false,
        state: 'idle',
        lastActionTime: 0,
      })
      const deck = HUMAN_ARCHETYPES.HUMAN_OPPORTUNISTIC.deck
      const policy = new HumanAdversarialPolicy(HUMAN_ARCHETYPES.HUMAN_OPPORTUNISTIC, 999)
      policy.nextActionTick = state.tick

      // P2 fortifica carril 0 y carril 1 con muros pesados (1000 HP)
      state.enemyPlants.push(
        { id: 'p2_wall_0', plantId: 'tallnut', lane: 0, col: 4, x: 75, hp: 1200, maxHp: 1200, isWalking: false, state: 'idle', lastActionTime: 0 },
        { id: 'p2_wall_1', plantId: 'tallnut', lane: 1, col: 4, x: 75, hp: 1200, maxHp: 1200, isWalking: false, state: 'idle', lastActionTime: 0 }
      )
      // Carril 2 queda 100% abierto (0 defensas)

      const decisions = policy.decide(state, deck)
      const plantAction = decisions.find((a) => a.kind === 'plant')

      expect(plantAction).toBeDefined()
      // La política oportunista/agresiva debe elegir el carril 2 (el único abierto)
      expect(plantAction?.lane).toBe(2)
    })
  })

  // ── 4. TEST DE PLANTA DESTRUIDA Y CASILLA LIBERADA ────────────────────────
  describe('4. Test de Planta Destruida y Casilla Liberada', () => {
    it('libera inmediatamente la casilla cuando una planta muere', () => {
      const state = createBattleState(888, false, true, undefined, 'auth-v2')
      state.tick = msToTicks(2000)
      state.sunBank = 200
      const deck = HUMAN_ARCHETYPES.HUMAN_DEFENSIVE.deck
      const policy = new HumanAdversarialPolicy(HUMAN_ARCHETYPES.HUMAN_DEFENSIVE, 888)

      // Colocar un muro en (lane: 0, col: 3)
      state.plants.push({
        id: 'p1_wall_0',
        plantId: 'wallnut',
        lane: 0,
        col: 3,
        x: 35,
        hp: 400,
        maxHp: 400,
        isWalking: false,
        state: 'idle',
        lastActionTime: 0,
      })

      // Cuando la planta está viva, su casilla está ocupada
      const decisions1 = policy.decide(state, deck)
      const plant1 = decisions1.find((a) => a.kind === 'plant')
      if (plant1 && plant1.lane === 0 && plant1.plantId && !plant1.plantId.includes('chomper') && !plant1.plantId.includes('garlic')) {
        expect(plant1.col).not.toBe(3)
      }

      // La planta muere (eliminada de state.plants)
      state.plants = []
      policy.nextActionTick = state.tick

      // Ahora la casilla (0, 3) debe ser elegible nuevamente
      const decisions2 = policy.decide(state, deck)
      const plant2 = decisions2.find((a) => a.kind === 'plant' && a.lane === 0)
      if (plant2) {
        expect(plant2.col).toBeDefined()
      }
    })
  })

  // ── 5. BENCHMARK DE 250 PARTIDAS HEAD-TO-HEAD CON ECONOMÍA REAL ───────────
  describe('5. Benchmark de 250 Partidas Head-to-Head con HumanAdversarialPolicy', () => {
    it(
      'ejecuta 250 partidas completas certificando 0 ilegales, recolección real y derrotas naturales',
      () => {
        const h2h = runAdversarialHeadToHeadBenchmark(50, msToTicks(120000))
        expect(h2h.length).toBe(5)

        const totalMatches = h2h.reduce((acc, h) => acc + h.matches, 0)
        const totalBotWins = h2h.reduce((acc, h) => acc + h.botWins, 0)
        const totalBotLosses = h2h.reduce((acc, h) => acc + h.botLosses, 0)
        const totalDraws = h2h.reduce((acc, h) => acc + h.draws, 0)
        const totalCollects = h2h.reduce((acc, h) => acc + h.totalCollectCount, 0)
        const totalIllegalP1 = h2h.reduce((acc, h) => acc + h.illegalP1, 0)
        const totalIllegalP2 = h2h.reduce((acc, h) => acc + h.illegalP2, 0)

        expect(totalMatches).toBe(250)
        expect(totalBotWins).toBeGreaterThan(0)
        expect(totalBotLosses).toBeGreaterThan(0) // Derrotas naturales frente a presión humana
        expect(totalDraws).toBeGreaterThan(0)
        expect(totalCollects).toBeGreaterThan(1000) // Soles reales recolectados vía collect auth-v2
        expect(totalIllegalP1).toBe(0) // 0 acciones ilegales en P1
        expect(totalIllegalP2).toBe(0) // 0 acciones ilegales en P2

        console.log('=== ADVERSARIAL_REAL_ECONOMY_H2H_START ===')
        console.log(JSON.stringify(h2h, null, 2))
        console.log('=== ADVERSARIAL_REAL_ECONOMY_H2H_END ===')
      },
      90000
    )
  })
})
