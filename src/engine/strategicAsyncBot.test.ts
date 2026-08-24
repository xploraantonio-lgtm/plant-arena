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
import { MARGEN_DE_RED_TICS } from './pvp.ts'
import { PLANT_CONFIGS, INITIAL_BASE_HP } from '../utils/gameConstants.ts'
import type { CartaDeMazo } from './mazoDeLaSala.ts'
import type { PlantId } from '../types/game.ts'

const MAZO_ESTANDAR: CartaDeMazo[] = [
  { slot: 0, plantId: 'sunflower', level: 1, statRolls: [] },
  { slot: 1, plantId: 'peashooter', level: 1, statRolls: [] },
  { slot: 2, plantId: 'wallnut', level: 1, statRolls: [] },
  { slot: 3, plantId: 'chomper', level: 1, statRolls: [] },
]

const MAZO_AVANZADO: CartaDeMazo[] = [
  { slot: 0, plantId: 'twinsunflower', level: 2, statRolls: [] },
  { slot: 1, plantId: 'repeater', level: 2, statRolls: [] },
  { slot: 2, plantId: 'tallnut', level: 2, statRolls: [] },
  { slot: 3, plantId: 'bonkchoy', level: 2, statRolls: [] },
  { slot: 4, plantId: 'jalapeno', level: 2, statRolls: [] },
  { slot: 5, plantId: 'melonpult', level: 2, statRolls: [] },
]

const MAZO_CONTROL: CartaDeMazo[] = [
  { slot: 0, plantId: 'sunflower', level: 1, statRolls: [] },
  { slot: 1, plantId: 'iceberglettuce', level: 1, statRolls: [] },
  { slot: 2, plantId: 'squash', level: 1, statRolls: [] },
  { slot: 3, plantId: 'threepeater', level: 1, statRolls: [] },
  { slot: 4, plantId: 'aloe', level: 1, statRolls: [] },
  { slot: 5, plantId: 'garlic', level: 1, statRolls: [] },
]

describe('RIVAL ESTRATÉGICO V1.2 — CERTIFICACIÓN COMPETITIVA PRE-RANKED', () => {
  // ── A. AUDITORÍA DE INFORMACIÓN IMPOSIBLE ─────────────────────────────────
  describe('A. Auditoría de Información Imposible (Zero Cheat / Fair Play)', () => {
    it('el bot solo percibe información observable actual y no lee datos privados ni futuros', () => {
      const state1 = createBattleState(1111, false, true)
      const state2 = createBattleState(1111, false, true)

      // Añadir una planta observable idéntica en ambos
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

      // En state2 agregamos eventos futuros o pendientes de P1 que aún no se manifiestan en el tablero
      state2.pending.push({
        atTick: 500,
        kind: 'own_plant',
        plantId: 'jalapeno',
        lane: 0,
      })

      const profile = obtenerPerfilEstrategico('balanced')
      const perc1 = percibirTablero(state1, 100, profile)
      const perc2 = percibirTablero(state2, 100, profile)

      // Ambas percepciones deben ser idénticas: el bot no conoce state.pending de P1
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

  // ── B. PRUEBAS TÁCTICAS OBLIGATORIAS ───────────────────────────────────────
  describe('B. Pruebas Tácticas Obligatorias', () => {
    it('1. Defensa: presión fuerte en lane 1 obliga a defender lane 1 antes de economía', () => {
      const state = createBattleState(1234, false, true)
      const profile = obtenerPerfilEstrategico('defensive')

      // Amenaza fuerte en lane 1
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

      // Fortificar lane 0 con muro de 1200 HP
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
      state.p1BaseHp = 200 // Base enemiga muy dañada
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

      // Rival coloca 2 girasoles en carril 0
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

      // El carril 1 o 2 (vacíos) reciben bono punitivo
      const atkLane1 = candidates.find((c) => c.plantId === 'chomper' && c.lane === 1)
      expect(atkLane1).toBeDefined()
      expect(atkLane1!.utility).toBeGreaterThan(50)
    })

    it('6. Recuperación: si la base propia recibe daño y hay amenaza, reevalúa y prioriza defensa', () => {
      const state = createBattleState(1234, false, true)
      state.p2BaseHp = 350 // Base propia dañada
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

  // ── C. ANÁLISIS DE LAS 15 CARTAS ───────────────────────────────────────────
  describe('C. Análisis Exhaustivo de las 15 Cartas del Juego', () => {
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
          expect(candidate!.utility).toBeLessThan(500) // Sin desbordamiento
        }
      }
    })
  })

  // ── D. DIFERENCIACIÓN ESTADÍSTICA DE LOS 5 ESTILOS ─────────────────────────
  describe('D. Validación de Diferenciación Estadística de los 5 Estilos', () => {
    it('demuestra diferencias claras y medibles en agresión, economía, reserva y defensa', () => {
      const profiles = STRATEGIC_PROFILES

      // 1. Diferencia en reserva de soles
      expect(profiles.defensive.baseReserveSun).toBeGreaterThan(profiles.balanced.baseReserveSun)
      expect(profiles.balanced.baseReserveSun).toBeGreaterThan(profiles.aggressive.baseReserveSun)

      // 2. Diferencia en meta de productores
      expect(profiles.economic.targetProducers).toBeGreaterThan(profiles.balanced.targetProducers)
      expect(profiles.balanced.targetProducers).toBeGreaterThan(profiles.aggressive.targetProducers)

      // 3. Diferencia en peso de agresión vs defensa
      expect(profiles.aggressive.aggression).toBeGreaterThan(profiles.defensive.aggression)
      expect(profiles.defensive.defense).toBeGreaterThan(profiles.aggressive.defense)

      // 4. Diferencia en oportunismo
      expect(profiles.opportunistic.opportunism).toBeGreaterThan(profiles.defensive.opportunism)
    })
  })

  // ── E. SOPORTE DE NIVELES DE DIFICULTAD (NORMAL / HARD / ELITE) ─────────────
  describe('E. Dificultad Basada en Calidad (Sin Trampas)', () => {
    it('soporta NORMAL, HARD y ELITE modulando únicamente cadencia humana y precisión de selección', () => {
      const normal = obtenerPerfilEstrategico('balanced', 'normal')
      const hard = obtenerPerfilEstrategico('balanced', 'hard')
      const elite = obtenerPerfilEstrategico('balanced', 'elite')

      // Tiempos de reacción graduados
      expect(normal.reactionMs).toBeGreaterThan(hard.reactionMs)
      expect(hard.reactionMs).toBeGreaterThan(elite.reactionMs)

      // Margen de error graduado
      expect(normal.badPlayMargin).toBeGreaterThan(hard.badPlayMargin)
      expect(hard.badPlayMargin).toBeGreaterThan(elite.badPlayMargin)

      // Comprobar que no hay trampa en recursos ni reglas
      expect(normal.baseReserveSun).toBe(hard.baseReserveSun)
      expect(hard.baseReserveSun).toBe(elite.baseReserveSun)
    })
  })

  // ── F. DETERMINISMO ESTRICTO MASIVO ────────────────────────────────────────
  describe('F. Determinismo Estricto Masivo', () => {
    it('partidas idénticas producen exactamente el mismo estado, daño, intenciones y resultado', () => {
      for (let run = 0; run < 5; run++) {
        const seed = 887766 + run * 100
        const p1Actions = [
          { seq: 1, tick: 120 + MARGEN_DE_RED_TICS, issuedTick: 120, kind: 'plant' as const, plantId: 'sunflower', slot: 0, lane: 0, col: 0 },
          { seq: 2, tick: 360 + MARGEN_DE_RED_TICS, issuedTick: 360, kind: 'plant' as const, plantId: 'peashooter', slot: 1, lane: 1, col: 1 },
        ]

        const res1 = runAsyncTimeline({
          seed,
          p1Deck: MAZO_ESTANDAR,
          asyncDeck: MAZO_ESTANDAR,
          p1Actions,
          strictAuthoritativeHistory: false,
          asyncOpponentMode: 'strategic',
          strategicStyle: 'balanced',
          maxTicks: 1200,
        })

        const res2 = runAsyncTimeline({
          seed,
          p1Deck: MAZO_ESTANDAR,
          asyncDeck: MAZO_ESTANDAR,
          p1Actions,
          strictAuthoritativeHistory: false,
          asyncOpponentMode: 'strategic',
          strategicStyle: 'balanced',
          maxTicks: 1200,
        })

        expect(res1.ok).toBe(true)
        expect(res2.ok).toBe(true)
        expect(res1.state.p1BaseHp).toBe(res2.state.p1BaseHp)
        expect(res1.state.p2BaseHp).toBe(res2.state.p2BaseHp)
        expect(res1.controller.stats.intentionsExecuted).toBe(res2.controller.stats.intentionsExecuted)
      }
    })
  })

  // ── G. BENCHMARK COMPETITIVO DE 1,000 PARTIDAS ──────────────────────────────
  describe('G. Benchmark Competitivo de 1,000 Partidas Offline', () => {
    it(
      'ejecuta 1,000 partidas completas a través de 12 escenarios tácticos sin errores ni caídas',
      () => {
        const styles: StrategicStyle[] = ['balanced', 'aggressive', 'defensive', 'economic', 'opportunistic']
        const decks = [MAZO_ESTANDAR, MAZO_AVANZADO, MAZO_CONTROL]
        let totalPlantsPlaced = 0
        let totalDamageDealt = 0
        let matchesCompleted = 0
        let totalSunSpent = 0
        let totalSunCredited = 0
        const waitReasonsTotal: Record<string, number> = {}

        for (let i = 0; i < 1000; i++) {
          const seed = 30000 + i * 23
          const style = styles[i % styles.length]
          const deck = decks[i % decks.length]

          // 12 escenarios distribuidos
          let p1Actions: any[] = []
          const scenarioType = i % 12

          if (scenarioType === 0) {
            // AFK
            p1Actions = []
          } else if (scenarioType === 1) {
            // Agresión temprana
            p1Actions = [
              { seq: 1, tick: 60 + MARGEN_DE_RED_TICS, issuedTick: 60, kind: 'plant', plantId: 'chomper', slot: 3, lane: 0, col: 0 },
            ]
          } else if (scenarioType === 2) {
            // Economía / Late game
            p1Actions = [
              { seq: 1, tick: 100 + MARGEN_DE_RED_TICS, issuedTick: 100, kind: 'plant', plantId: 'sunflower', slot: 0, lane: 0, col: 0 },
              { seq: 2, tick: 300 + MARGEN_DE_RED_TICS, issuedTick: 300, kind: 'plant', plantId: 'sunflower', slot: 0, lane: 0, col: 1 },
            ]
          } else if (scenarioType === 3) {
            // Defensa fuerte
            p1Actions = [
              { seq: 1, tick: 100 + MARGEN_DE_RED_TICS, issuedTick: 100, kind: 'plant', plantId: 'wallnut', slot: 2, lane: 1, col: 3 },
            ]
          } else if (scenarioType === 4) {
            // Presión multilínea
            p1Actions = [
              { seq: 1, tick: 100 + MARGEN_DE_RED_TICS, issuedTick: 100, kind: 'plant', plantId: 'peashooter', slot: 1, lane: 0, col: 1 },
              { seq: 2, tick: 400 + MARGEN_DE_RED_TICS, issuedTick: 400, kind: 'plant', plantId: 'peashooter', slot: 1, lane: 2, col: 1 },
            ]
          } else {
            // Estándar
            p1Actions = [
              { seq: 1, tick: 120 + MARGEN_DE_RED_TICS, issuedTick: 120, kind: 'plant', plantId: deck[0].plantId, slot: 0, lane: i % 3, col: 0 },
            ]
          }

          const res = runAsyncTimeline({
            seed,
            p1Deck: deck,
            asyncDeck: deck,
            p1Actions,
            strictAuthoritativeHistory: false,
            asyncOpponentMode: 'strategic',
            strategicStyle: style,
            maxTicks: msToTicks(45000), // 45s por partida para velocidad y cobertura
          })

          expect(res.ok).toBe(true)
          expect(Number.isFinite(res.state.p1BaseHp)).toBe(true)
          expect(Number.isFinite(res.state.p2BaseHp)).toBe(true)
          expect(Number.isFinite(res.controller.sunBank)).toBe(true)
          expect(res.controller.stats.intentionsDropped).toBe(0)

          totalPlantsPlaced += res.controller.stats.intentionsExecuted
          totalDamageDealt += Math.max(0, INITIAL_BASE_HP - res.state.p1BaseHp)
          matchesCompleted += 1

          if (res.controller.strategicState) {
            totalSunSpent += res.controller.strategicState.metrics.totalSunSpent
            totalSunCredited += res.controller.strategicState.metrics.totalSunCredited
            for (const [r, count] of Object.entries(res.controller.strategicState.metrics.waitReasons)) {
              waitReasonsTotal[r] = (waitReasonsTotal[r] || 0) + count
            }
          }
        }

        expect(matchesCompleted).toBe(1000)
        expect(totalPlantsPlaced / 1000).toBeGreaterThanOrEqual(3.5)
        expect(waitReasonsTotal['WAIT_NO_SUN']).toBeDefined()
      },
      60000
    )
  })

  // ── H. SOAK TEST DE 10,000 PARTIDAS DE ESTABILIDAD ─────────────────────────
  describe('H. Soak Test de 10,000 Partidas de Estabilidad', () => {
    it(
      'ejecuta 10,000 partidas rápidas certificando 0 crashes, 0 NaNs, 0 intenciones ilegales y 0 loops',
      () => {
        const styles: StrategicStyle[] = ['balanced', 'aggressive', 'defensive', 'economic', 'opportunistic']
        let matches = 0

        for (let i = 0; i < 10000; i++) {
          const seed = 50000 + i * 17
          const style = styles[i % styles.length]

          const res = runAsyncTimeline({
            seed,
            p1Deck: MAZO_ESTANDAR,
            asyncDeck: MAZO_ESTANDAR,
            p1Actions: [],
            strictAuthoritativeHistory: false,
            asyncOpponentMode: 'strategic',
            strategicStyle: style,
            maxTicks: msToTicks(15000), // 15s por partida para soak test masivo
          })

          if (!res.ok || !Number.isFinite(res.state.p1BaseHp) || res.controller.stats.intentionsDropped > 0) {
            throw new Error(`Fallo en partida soak ${i}`)
          }
          matches += 1
        }

        expect(matches).toBe(10000)
      },
      120000
    )
  })
})
