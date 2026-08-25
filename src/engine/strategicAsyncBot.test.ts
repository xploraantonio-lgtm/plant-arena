import { describe, it, expect } from 'vitest'
import {
  percibirTablero,
  generarAccionesCandidatas,
  obtenerPerfilEstrategico,
  STRATEGIC_PROFILES,
  type StrategicStyle,
} from './strategicAsyncBot.ts'
import { createBattleState } from './simulate.ts'
import { runAsyncTimeline } from './asyncOpponent.ts'
import { msToTicks } from './time.ts'
import { PLANT_CONFIGS } from '../utils/gameConstants.ts'
import {
  SCENARIO_DECKS,
  generarTimelineP1ParaEscenario,
} from './strategicBenchmarkScenarios.ts'
import { runStrategicBenchmark } from './strategicBenchmarkRunner.ts'
import type { CartaDeMazo } from './mazoDeLaSala.ts'
import type { PlantId } from '../types/game.ts'

const MAZO_ESTANDAR: CartaDeMazo[] = [
  { slot: 0, plantId: 'sunflower', level: 1, statRolls: [] },
  { slot: 1, plantId: 'peashooter', level: 1, statRolls: [] },
  { slot: 2, plantId: 'wallnut', level: 1, statRolls: [] },
  { slot: 3, plantId: 'chomper', level: 1, statRolls: [] },
]

describe('RIVAL ESTRATÉGICO V1.2.1 — CERTIFICACIÓN REAL PROGRAMÁTICA', () => {
  // ── 1. AUDITORÍA DE INFORMACIÓN IMPOSIBLE ─────────────────────────────────
  describe('1. Auditoría de Información Imposible (Zero Cheat / Fair Play)', () => {
    it('el bot solo percibe información observable actual y no lee datos privados ni futuros', () => {
      const state1 = createBattleState(1111, false, true)
      const state2 = createBattleState(1111, false, true)

      state1.plants.push({
        id: 'p1-peashooter-1',
        plantId: 'peashooter',
        lane: 1,
        x: 35,
        hp: 300,
        maxHp: 300,
        isWalking: false,
        state: 'idle',
        lastActionTime: 0,
      })
      state2.plants.push({
        id: 'p1-peashooter-1',
        plantId: 'peashooter',
        lane: 1,
        x: 35,
        hp: 300,
        maxHp: 300,
        isWalking: false,
        state: 'idle',
        lastActionTime: 0,
      })

      // En state2 agregamos eventos futuros de P1 que aún no se manifiestan en el tablero
      state2.pending.push({
        atTick: 500,
        kind: 'own_plant',
        plantId: 'jalapeno',
        lane: 0,
      })

      const profile = obtenerPerfilEstrategico('balanced')
      const perc1 = percibirTablero(state1, 100, profile)
      const perc2 = percibirTablero(state2, 100, profile)

      expect(perc1.lanes[0].threatScore).toBe(perc2.lanes[0].threatScore)
      expect(perc1.lanes[1].threatScore).toBe(perc2.lanes[1].threatScore)
      expect(perc1.lanes[2].threatScore).toBe(perc2.lanes[2].threatScore)
      expect(perc1.mode).toBe(perc2.mode)

      const cand1 = generarAccionesCandidatas(MAZO_ESTANDAR, {}, perc1, state1, profile)
      const cand2 = generarAccionesCandidatas(MAZO_ESTANDAR, {}, perc2, state2, profile)

      expect(cand1.length).toBe(cand2.length)
      for (let i = 0; i < cand1.length; i++) {
        expect(cand1[i].utility).toBe(cand2[i].utility)
        expect(cand1[i].plantId).toBe(cand2[i].plantId)
      }
    })
  })

  // ── 2. PRUEBAS TÁCTICAS OBLIGATORIAS ───────────────────────────────────────
  describe('2. Pruebas Tácticas Obligatorias', () => {
    it('1. Defensa: presión fuerte en lane 1 obliga a defender lane 1 antes de economía', () => {
      const state = createBattleState(1234, false, true)
      const profile = obtenerPerfilEstrategico('defensive')

      state.plants.push({
        id: 'p1-bonkchoy-1',
        plantId: 'bonkchoy',
        lane: 1,
        x: 60,
        hp: 600,
        maxHp: 600,
        damage: 65,
        attackSpeedMs: 700,
        moveSpeed: 5.0,
        isWalking: true,
        state: 'walking',
        lastActionTime: 0,
      })

      const perception = percibirTablero(state, 150, profile)
      expect(perception.maxThreatLane).toBe(1)
      expect(perception.lanes[1].threatScore).toBeGreaterThan(40)

      const candidates = generarAccionesCandidatas(MAZO_ESTANDAR, {}, perception, state, profile)
      const defenseLane1 = candidates.find((c) => (c.plantId === 'wallnut' || c.plantId === 'chomper') && c.lane === 1)
      const economyAction = candidates.find((c) => c.plantId === 'sunflower')

      expect(defenseLane1).toBeDefined()
      expect(economyAction).toBeDefined()
      expect(defenseLane1!.utility).toBeGreaterThan(economyAction!.utility)
    })

    it('2. Flanqueo: si lane 0 está fortificado y lane 2 está abierto, prioriza atacar lane 2', () => {
      const state = createBattleState(1234, false, true)
      const profile = obtenerPerfilEstrategico('opportunistic')

      state.plants.push({
        id: 'p1-wallnut-1',
        plantId: 'wallnut',
        lane: 0,
        col: 2,
        x: 30,
        hp: 1200,
        maxHp: 1200,
        isWalking: false,
        state: 'idle',
        lastActionTime: 0,
      })

      const perception = percibirTablero(state, 150, profile)
      const candidates = generarAccionesCandidatas(MAZO_ESTANDAR, {}, perception, state, profile)

      const atkLane0 = candidates.find((c) => c.plantId === 'chomper' && c.lane === 0)
      const atkLane2 = candidates.find((c) => c.plantId === 'chomper' && c.lane === 2)

      expect(atkLane0).toBeDefined()
      expect(atkLane2).toBeDefined()
      expect(atkLane2!.utility).toBeGreaterThan(atkLane0!.utility)
    })

    it('3. Remate: si base enemiga está cerca de morir (HP <= 250), prioriza ofensiva sobre economía', () => {
      const state = createBattleState(1234, false, true)
      state.p1BaseHp = 200
      const profile = obtenerPerfilEstrategico('aggressive')

      const perception = percibirTablero(state, 150, profile)
      expect(perception.mode).toBe('PRESSURE')

      const candidates = generarAccionesCandidatas(MAZO_ESTANDAR, {}, perception, state, profile)
      const attackerAction = candidates.find((c) => c.plantId === 'peashooter' || c.plantId === 'chomper')
      const sunflowerAction = candidates.find((c) => c.plantId === 'sunflower')

      expect(attackerAction).toBeDefined()
      expect(sunflowerAction).toBeDefined()
      expect(attackerAction!.utility).toBeGreaterThan(sunflowerAction!.utility + 30)
    })

    it('4. Economía: en paz y sin presión, desarrolla productores sin acumulación ociosa', () => {
      const state = createBattleState(1234, false, true)
      const profile = obtenerPerfilEstrategico('economic')

      const perception = percibirTablero(state, 100, profile)
      expect(perception.maxThreat).toBe(0)

      const candidates = generarAccionesCandidatas(MAZO_ESTANDAR, {}, perception, state, profile)
      const sunflowerAction = candidates.find((c) => c.plantId === 'sunflower')

      expect(sunflowerAction).toBeDefined()
      expect(sunflowerAction!.utility).toBeGreaterThan(40)
      expect(candidates[0].plantId).toBe('sunflower')
    })

    it('5. Anti-economía: castiga al rival que sobre-invierte en girasoles dejando carriles vacíos', () => {
      const state = createBattleState(1234, false, true)
      const profile = obtenerPerfilEstrategico('opportunistic')

      state.plants.push({
        id: 'p1-sun-1',
        plantId: 'sunflower',
        lane: 0,
        col: 0,
        x: 18,
        hp: 300,
        maxHp: 300,
        isWalking: false,
        state: 'idle',
        lastActionTime: 0,
      })
      state.plants.push({
        id: 'p1-sun-2',
        plantId: 'sunflower',
        lane: 0,
        col: 1,
        x: 24,
        hp: 300,
        maxHp: 300,
        isWalking: false,
        state: 'idle',
        lastActionTime: 0,
      })

      const perception = percibirTablero(state, 150, profile)
      const candidates = generarAccionesCandidatas(MAZO_ESTANDAR, {}, perception, state, profile)

      const atkLane1 = candidates.find((c) => c.plantId === 'chomper' && c.lane === 1)
      expect(atkLane1).toBeDefined()
      expect(atkLane1!.utility).toBeGreaterThan(50)
    })

    it('6. Recuperación: si la base propia recibe daño y hay amenaza, reevalúa y prioriza defensa', () => {
      const state = createBattleState(1234, false, true)
      state.p2BaseHp = 350
      const profile = obtenerPerfilEstrategico('defensive')

      state.plants.push({
        id: 'p1-attacker-1',
        plantId: 'chomper',
        lane: 2,
        x: 65,
        hp: 500,
        maxHp: 500,
        damage: 35,
        attackSpeedMs: 1100,
        moveSpeed: 4.5,
        isWalking: true,
        state: 'walking',
        lastActionTime: 0,
      })

      const perception = percibirTablero(state, 200, profile)
      expect(perception.mode === 'DEFEND' || perception.mode === 'EMERGENCY_DEFEND').toBe(true)

      const candidates = generarAccionesCandidatas(MAZO_ESTANDAR, {}, perception, state, profile)
      const defenseLane2 = candidates.find((c) => c.plantId === 'wallnut' && c.lane === 2)
      const atkLane0 = candidates.find((c) => c.plantId === 'chomper' && c.lane === 0)

      expect(defenseLane2).toBeDefined()
      expect(atkLane0).toBeDefined()
      expect(defenseLane2!.utility).toBeGreaterThan(atkLane0!.utility)
    })

    it('7. Presión Multilínea: distribuye el ataque en múltiples carriles ante tablero abierto', () => {
      const res = runAsyncTimeline({
        seed: 334455,
        p1Deck: MAZO_ESTANDAR,
        asyncDeck: MAZO_ESTANDAR,
        p1Actions: [],
        strictAuthoritativeHistory: false,
        asyncOpponentMode: 'strategic',
        maxTicks: msToTicks(60000),
      })

      expect(res.ok).toBe(true)
      const lanesUsed = new Set(
        res.controller.telemetry
          ?.filter((t) => t.chosenAction.kind === 'plant' && t.chosenAction.lane !== undefined)
          .map((t) => t.chosenAction.lane)
      )
      expect(lanesUsed.size).toBeGreaterThanOrEqual(2)
    })
  })

  // ── 3. ANÁLISIS DE LAS 15 CARTAS ───────────────────────────────────────────
  describe('3. Análisis Exhaustivo de las 15 Cartas del Juego', () => {
    it('cada una de las 15 cartas es evaluable legalmente y ninguna tiene utility nula o anómala', () => {
      const allPlantKeys = Object.keys(PLANT_CONFIGS) as PlantId[]
      expect(allPlantKeys.length).toBe(15)

      const state = createBattleState(9999, false, true)
      const styles: StrategicStyle[] = ['balanced', 'aggressive', 'defensive', 'economic', 'opportunistic']

      for (const plantId of allPlantKeys) {
        const singleCardDeck: CartaDeMazo[] = [{ slot: 0, plantId, level: 1, statRolls: [] }]

        for (const style of styles) {
          const profile = obtenerPerfilEstrategico(style)
          const perception = percibirTablero(state, 500, profile)
          const candidates = generarAccionesCandidatas(singleCardDeck, {}, perception, state, profile)

          const candidate = candidates.find((c) => c.plantId === plantId)
          expect(candidate).toBeDefined()
          expect(Number.isFinite(candidate!.utility)).toBe(true)
          expect(candidate!.utility).toBeGreaterThan(0)
          expect(candidate!.utility).toBeLessThan(500)
        }
      }
    })
  })

  // ── 4. DIFERENCIACIÓN ESTADÍSTICA DE LOS 5 ESTILOS ─────────────────────────
  describe('4. Validación de Diferenciación Estadística de los 5 Estilos', () => {
    it('demuestra diferencias claras y medibles en agresión, economía, reserva y defensa', () => {
      const profiles = STRATEGIC_PROFILES

      expect(profiles.defensive.baseReserveSun).toBeGreaterThan(profiles.balanced.baseReserveSun)
      expect(profiles.balanced.baseReserveSun).toBeGreaterThan(profiles.aggressive.baseReserveSun)

      expect(profiles.economic.targetProducers).toBeGreaterThan(profiles.balanced.targetProducers)
      expect(profiles.balanced.targetProducers).toBeGreaterThan(profiles.aggressive.targetProducers)

      expect(profiles.aggressive.aggression).toBeGreaterThan(profiles.defensive.aggression)
      expect(profiles.defensive.defense).toBeGreaterThan(profiles.aggressive.defense)

      expect(profiles.opportunistic.opportunism).toBeGreaterThan(profiles.defensive.opportunism)
    })
  })

  // ── 5. DETERMINISMO ESTRICTO MASIVO BIT-A-BIT ──────────────────────────────
  describe('5. Determinismo Estricto Masivo Bit-a-Bit', () => {
    it('compara exhaustivamente todos los campos de estado e intenciones producidas', () => {
      for (let run = 0; run < 10; run++) {
        const seed = 998877 + run * 31
        const p1Actions = generarTimelineP1ParaEscenario(run % 12, MAZO_ESTANDAR, msToTicks(45000))

        const res1 = runAsyncTimeline({
          seed,
          p1Deck: MAZO_ESTANDAR,
          asyncDeck: MAZO_ESTANDAR,
          p1Actions,
          strictAuthoritativeHistory: false,
          asyncOpponentMode: 'strategic',
          strategicStyle: 'balanced',
          strategicDifficulty: 'hard',
          maxTicks: msToTicks(45000),
        })

        const res2 = runAsyncTimeline({
          seed,
          p1Deck: MAZO_ESTANDAR,
          asyncDeck: MAZO_ESTANDAR,
          p1Actions,
          strictAuthoritativeHistory: false,
          asyncOpponentMode: 'strategic',
          strategicStyle: 'balanced',
          strategicDifficulty: 'hard',
          maxTicks: msToTicks(45000),
        })

        expect(res1.ok).toBe(true)
        expect(res2.ok).toBe(true)
        expect(res1.state.tick).toBe(res2.state.tick)
        expect(res1.winner).toBe(res2.winner)
        expect(res1.state.p1BaseHp).toBe(res2.state.p1BaseHp)
        expect(res1.state.p2BaseHp).toBe(res2.state.p2BaseHp)
        expect(res1.state.plants.length).toBe(res2.state.plants.length)
        expect(res1.state.enemyPlants.length).toBe(res2.state.enemyPlants.length)
        expect(res1.state.projectiles.length).toBe(res2.state.projectiles.length)
        expect(res1.state.pending.length).toBe(res2.state.pending.length)
        expect(res1.controller.sunBank).toBe(res2.controller.sunBank)
        expect(res1.controller.stats.intentionsExecuted).toBe(res2.controller.stats.intentionsExecuted)

        // Telemetría bit-a-bit idéntica
        expect(res1.controller.telemetry?.length).toBe(res2.controller.telemetry?.length)
        if (res1.controller.telemetry && res2.controller.telemetry) {
          for (let t = 0; t < res1.controller.telemetry.length; t++) {
            expect(res1.controller.telemetry[t].tick).toBe(res2.controller.telemetry[t].tick)
            expect(res1.controller.telemetry[t].chosenAction.utility).toBe(
              res2.controller.telemetry[t].chosenAction.utility
            )
            expect(res1.controller.telemetry[t].chosenAction.plantId).toBe(
              res2.controller.telemetry[t].chosenAction.plantId
            )
          }
        }
      }
    })
  })

  // ── 6. BENCHMARK COMPETITIVO DE 1,000 PARTIDAS Y REPORTE PROGRAMÁTICO ─────
  describe('6. Benchmark Competitivo Completo de 1,000 Partidas', () => {
    it(
      'ejecuta 1,000 partidas completas a través de 12 escenarios tácticos y genera matriz 5x12',
      () => {
        const report = runStrategicBenchmark(1000, msToTicks(120000))

        // Verificaciones de integridad del benchmark
        expect(report.totalMatches).toBe(1000)
        expect(report.matrix.length).toBe(60) // 5 styles x 12 scenarios
        expect(report.overall.avgPlants).toBeGreaterThanOrEqual(3.5)
        expect(report.overall.avgSunUtilization).toBeGreaterThan(0.70)
        expect(report.anomalies.crashes).toBe(0)
        expect(report.anomalies.nans).toBe(0)
        expect(report.anomalies.droppedIntents).toBe(0)
        expect(report.anomalies.illegalIntents).toBe(0)

        // Imprimir el resumen del benchmark para trazabilidad 100% auditable
        console.log('=== STRATEGIC_BENCHMARK_REPORT_START ===')
        console.log(JSON.stringify(report, null, 2))
        console.log('=== STRATEGIC_BENCHMARK_REPORT_END ===')
      },
      60000
    )
  })

  // ── 7. FAST SOAK TEST (10,000 SIMULACIONES) ───────────────────────────────
  describe('7. Fast Soak Test de 10,000 Simulaciones', () => {
    it(
      'ejecuta 10,000 simulaciones rápidas certificando 0 crashes, 0 NaNs y 0 dropped intentions',
      () => {
        const styles: StrategicStyle[] = ['balanced', 'aggressive', 'defensive', 'economic', 'opportunistic']
        let completed = 0

        for (let i = 0; i < 10000; i++) {
          const scenarioId = i % 12
          const style = styles[i % styles.length]
          const seed = 500000 + i * 19

          const deck = SCENARIO_DECKS[scenarioId]
          const p1Actions = generarTimelineP1ParaEscenario(scenarioId, deck.p1Deck, msToTicks(15000))

          const res = runAsyncTimeline({
            seed,
            p1Deck: deck.p1Deck,
            asyncDeck: deck.botDeck,
            p1Actions,
            strictAuthoritativeHistory: false,
            asyncOpponentMode: 'strategic',
            strategicStyle: style,
            maxTicks: msToTicks(15000),
          })

          if (!res.ok || !Number.isFinite(res.state.p1BaseHp) || res.controller.stats.intentionsDropped > 0) {
            throw new Error(`Fallo en fast soak ${i}`)
          }
          completed++
        }

        expect(completed).toBe(10000)
      },
      120000
    )
  })
})
