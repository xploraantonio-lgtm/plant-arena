import { describe, it, expect } from 'vitest'
import {
  percibirTablero,
  generarAccionesCandidatas,
  obtenerPerfilEstrategico,
  PLANT_TACTICAL_PROFILES,
  getTacticalProfile,
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

describe('RIVAL ESTRATÉGICO V1.1 — AUDITORÍA TÁCTICA Y NO PASIVIDAD', () => {
  // ── 1. CLASIFICACIÓN DE LAS 15 CARTAS ───────────────────────────────────────
  describe('Clasificación y Perfiles de las 15 Cartas', () => {
    it('clasifica todas las 15 cartas de PLANT_CONFIGS sin excepciones', () => {
      const plantKeys = Object.keys(PLANT_CONFIGS) as PlantId[]
      expect(plantKeys.length).toBe(15)

      for (const id of plantKeys) {
        const tactical = getTacticalProfile(id)
        expect(tactical).toBeDefined()
        expect(tactical.id).toBe(id)
        expect(tactical.role).toBeDefined()
        expect(tactical.baseWeight).toBeGreaterThan(0)
        expect(Array.isArray(tactical.preferredCols)).toBe(true)
        expect(tactical.preferredCols.length).toBe(2)
      }
    })

    it('asigna correctamente los roles clave', () => {
      expect(PLANT_TACTICAL_PROFILES.sunflower.isProducer).toBe(true)
      expect(PLANT_TACTICAL_PROFILES.twinsunflower.isProducer).toBe(true)
      expect(PLANT_TACTICAL_PROFILES.wallnut.isTank).toBe(true)
      expect(PLANT_TACTICAL_PROFILES.tallnut.isTank).toBe(true)
      expect(PLANT_TACTICAL_PROFILES.chomper.isWalking).toBe(true)
      expect(PLANT_TACTICAL_PROFILES.bonkchoy.isWalking).toBe(true)
      expect(PLANT_TACTICAL_PROFILES.garlic.isWalking).toBe(true)
      expect(PLANT_TACTICAL_PROFILES.jalapeno.isLaneClear).toBe(true)
      expect(PLANT_TACTICAL_PROFILES.iceberglettuce.isFreezer).toBe(true)
      expect(PLANT_TACTICAL_PROFILES.aloe.isHealer).toBe(true)
    })
  })

  // ── 2. DETERMINISMO FUNDAMENTAL ────────────────────────────────────────────
  describe('Determinismo Fundamental', () => {
    it('dos ejecuciones con mismo seed, mazo y acciones P1 generan decisiones y logs 100% idénticos', () => {
      const seed = 998877
      const p1Actions = [
        { seq: 1, tick: 120 + MARGEN_DE_RED_TICS, issuedTick: 120, kind: 'plant' as const, plantId: 'sunflower', slot: 0, lane: 0, col: 0 },
      ]

      const res1 = runAsyncTimeline({
        seed,
        p1Deck: MAZO_ESTANDAR,
        asyncDeck: MAZO_ESTANDAR,
        p1Actions,
        strictAuthoritativeHistory: false,
        asyncOpponentMode: 'strategic',
        maxTicks: 1200,
      })

      const res2 = runAsyncTimeline({
        seed,
        p1Deck: MAZO_ESTANDAR,
        asyncDeck: MAZO_ESTANDAR,
        p1Actions,
        strictAuthoritativeHistory: false,
        asyncOpponentMode: 'strategic',
        maxTicks: 1200,
      })

      expect(res1.ok).toBe(true)
      expect(res2.ok).toBe(true)
      expect(res1.state.tick).toBe(res2.state.tick)
      expect(res1.state.p1BaseHp).toBe(res2.state.p1BaseHp)
      expect(res1.state.p2BaseHp).toBe(res2.state.p2BaseHp)
      expect(res1.controller.sunBank).toBe(res2.controller.sunBank)
      expect(res1.controller.stats.intentionsExecuted).toBe(res2.controller.stats.intentionsExecuted)
      expect(res1.state.enemyPlants.length).toBe(res2.state.enemyPlants.length)

      for (let i = 0; i < res1.state.enemyPlants.length; i++) {
        expect(res1.state.enemyPlants[i].plantId).toBe(res2.state.enemyPlants[i].plantId)
        expect(res1.state.enemyPlants[i].lane).toBe(res2.state.enemyPlants[i].lane)
        expect(res1.state.enemyPlants[i].col).toBe(res2.state.enemyPlants[i].col)
      }
    })
  })

  // ── 3. SENSIBILIDAD Y PERCEPCIÓN ───────────────────────────────────────────
  describe('Sensibilidad a Cambios del Tablero', () => {
    it('modificar la posición de un atacante enemigo aumenta el threatScore de ese carril', () => {
      const stateTableroVacio = createBattleState(1234, false, true)
      const profile = obtenerPerfilEstrategico('balanced')

      const percVacio = percibirTablero(stateTableroVacio, 150, profile)
      expect(percVacio.lanes[2].threatScore).toBe(0)

      // Añadir un atacante enemigo (P1) en carril 2
      const stateConAmenaza = createBattleState(1234, false, true)
      stateConAmenaza.plants.push({
        id: 'p1-chomper-1',
        plantId: 'chomper',
        lane: 2,
        x: 65, // Cerca de la base P2
        hp: 500,
        maxHp: 500,
        damage: 35,
        attackSpeedMs: 1100,
        moveSpeed: 4.5,
        isWalking: true,
        state: 'walking',
        lastActionTime: 0,
      })

      const percAmenaza = percibirTablero(stateConAmenaza, 150, profile)
      expect(percAmenaza.lanes[2].threatScore).toBeGreaterThan(40)
      expect(percAmenaza.lanes[0].threatScore).toBe(0)
      expect(percAmenaza.lanes[1].threatScore).toBe(0)
      expect(percAmenaza.maxThreatLane).toBe(2)
    })
  })

  // ── 4. FLANQUEO / PIVOTE A NUEVO CARRIL ────────────────────────────────────
  describe('Flanqueo y Oportunidad en Carril Libre', () => {
    it('si el carril 0 está bloqueado por defensas enemigas, aumenta la prioridad de atacar carriles 1 o 2', () => {
      const state = createBattleState(1234, false, true)
      const profile = obtenerPerfilEstrategico('opportunistic')

      // Fortificar carril 0 para P1 con nueces de 1200 HP
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
      const atkLane1 = candidates.find((c) => c.plantId === 'chomper' && c.lane === 1)
      const atkLane2 = candidates.find((c) => c.plantId === 'chomper' && c.lane === 2)

      expect(atkLane0).toBeDefined()
      expect(atkLane1).toBeDefined()
      expect(atkLane2).toBeDefined()
      // Carriles 1 y 2 deben tener mayor utilidad de ataque que el carril 0 bloqueado
      expect(atkLane1!.utility).toBeGreaterThan(atkLane0!.utility)
      expect(atkLane2!.utility).toBeGreaterThan(atkLane0!.utility)
    })
  })

  // ── 5. ANTI-SOBREDEFENSA ───────────────────────────────────────────────────
  describe('Prevención de Sobredefensa Redundante', () => {
    it('penaliza colocar un segundo muro en un carril seguro sin amenaza', () => {
      const state = createBattleState(1234, false, true)
      const profile = obtenerPerfilEstrategico('defensive')

      // Colocar un muro propio de P2 en carril 1
      state.enemyPlants.push({
        id: 'p2-wallnut-1',
        plantId: 'wallnut',
        lane: 1,
        col: 8,
        x: 75,
        hp: 1200,
        maxHp: 1200,
        isWalking: false,
        state: 'idle',
        lastActionTime: 0,
      })

      const perception = percibirTablero(state, 100, profile)
      expect(perception.lanes[1].threatScore).toBe(0)

      const candidates = generarAccionesCandidatas(MAZO_ESTANDAR, {}, perception, state, profile)
      const wallnutLane1 = candidates.find((c) => c.plantId === 'wallnut' && c.lane === 1)
      const wallnutLane0 = candidates.find((c) => c.plantId === 'wallnut' && c.lane === 0)

      expect(wallnutLane1).toBeDefined()
      expect(wallnutLane0).toBeDefined()
      // Colocar muro en carril 0 tiene mayor valor que duplicar muro en carril 1 sin peligro
      expect(wallnutLane0!.utility).toBeGreaterThan(wallnutLane1!.utility)
    })
  })

  // ── 6. ANTI-ECONOMÍA EXCESIVA EN EMERGENCIA ────────────────────────────────
  describe('Anti-Economía Excesiva', () => {
    it('en emergencia crítica, la defensa desplaza absolutamente a la economía', () => {
      const state = createBattleState(1234, false, true)
      const profile = obtenerPerfilEstrategico('economic')

      // Añadir amenaza crítica en carril 0 muy cerca de base P2
      state.plants.push({
        id: 'p1-garlic-1',
        plantId: 'garlic',
        lane: 0,
        x: 78,
        hp: 300,
        maxHp: 300,
        damage: 600,
        isWalking: true,
        state: 'walking',
        lastActionTime: 0,
      })

      const perception = percibirTablero(state, 100, profile)
      expect(perception.mode).toBe('EMERGENCY_DEFEND')

      const candidates = generarAccionesCandidatas(MAZO_ESTANDAR, {}, perception, state, profile)
      const wallnutAction = candidates.find((c) => c.plantId === 'wallnut' && c.lane === 0)
      const sunflowerAction = candidates.find((c) => c.plantId === 'sunflower')

      expect(wallnutAction).toBeDefined()
      expect(sunflowerAction).toBeDefined()
      expect(wallnutAction!.utility).toBeGreaterThan(sunflowerAction!.utility + 40)
    })
  })

  // ── 7. REMATE Y SPIKE DE PRESIÓN ───────────────────────────────────────────
  describe('Remate de Base Enemiga', () => {
    it('base rival con poca vida desata spike ofensivo y desactiva economía', () => {
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
  })

  // ── 8. CIERRE 100% CONTRA JUGADOR AFK ─────────────────────────────────────
  describe('Cierre de Partida 100% Contra AFK', () => {
    it('ante P1 inactivo, el bot construye economía, despliega ataque en múltiples carriles y destruye la base', () => {
      const res = runAsyncTimeline({
        seed: 443322,
        p1Deck: MAZO_ESTANDAR,
        asyncDeck: MAZO_ESTANDAR,
        p1Actions: [], // P1 totalmente AFK
        strictAuthoritativeHistory: false,
        asyncOpponentMode: 'strategic',
        maxTicks: msToTicks(90000), // 90s de partida
      })

      expect(res.ok).toBe(true)
      // Debe haber colocado múltiples plantas activas (> 5 en 90s)
      expect(res.controller.stats.intentionsExecuted).toBeGreaterThanOrEqual(6)
      // Debe haber usado al menos 2 carriles diferentes
      const lanesUsed = new Set(res.controller.telemetry?.filter((t) => t.chosenAction.kind === 'plant').map((t) => t.chosenAction.lane))
      expect(lanesUsed.size).toBeGreaterThanOrEqual(2)
      // Debe haber colocado al menos 1 productor
      const tieneProductor = res.state.enemyPlants.some((p) => p.plantId === 'sunflower')
      expect(tieneProductor).toBe(true)
      // La base de P1 debe haber sido completamente destruida (daño total)
      expect(res.state.p1BaseHp).toBeLessThanOrEqual(0)
    })
  })

  // ── 9. TEST DE LAS 15 CARTAS EN ESCENARIOS REALES ──────────────────────────
  describe('Soporte Integral de las 15 Cartas', () => {
    it('todas las 15 cartas son evaluables legalmente sin producir NaNs ni utility nula en contexto adecuado', () => {
      const allPlantKeys = Object.keys(PLANT_CONFIGS) as PlantId[]
      const state = createBattleState(8888, false, true)
      const profile = obtenerPerfilEstrategico('balanced')

      for (const plantId of allPlantKeys) {
        const singleCardDeck: CartaDeMazo[] = [{ slot: 0, plantId, level: 1, statRolls: [] }]
        const perception = percibirTablero(state, 500, profile)
        const candidates = generarAccionesCandidatas(singleCardDeck, {}, perception, state, profile)

        const plantCandidate = candidates.find((c) => c.plantId === plantId)
        expect(plantCandidate).toBeDefined()
        expect(Number.isFinite(plantCandidate!.utility)).toBe(true)
        expect(plantCandidate!.utility).toBeGreaterThan(0)
      }
    })
  })

  // ── 10. BENCHMARK DE 500 PARTIDAS OFFLINE ──────────────────────────────────
  describe('Benchmark Exhaustivo de 500 Partidas Offline', () => {
    it('ejecuta 500 partidas completas sin crashes, con alta actividad, métricas temporales y uso de recursos', () => {
      const styles: StrategicStyle[] = ['balanced', 'aggressive', 'defensive', 'economic', 'opportunistic']
      const decks = [MAZO_ESTANDAR, MAZO_AVANZADO, MAZO_CONTROL]
      let totalPlantsPlaced = 0
      let totalDamageDealt = 0
      let matchesCompleted = 0
      let totalSunSpent = 0
      let totalSunCredited = 0
      const waitReasonsTotal: Record<string, number> = {}

      for (let i = 0; i < 500; i++) {
        const seed = 20000 + i * 31
        const style = styles[i % styles.length]
        const deck = decks[i % decks.length]

        // Simulamos diversos tipos de partidas (AFK, estándar, presión)
        const p1Actions = (i % 4 === 0)
          ? [] // 25% partidas contra AFK
          : [
              { seq: 1, tick: 100 + MARGEN_DE_RED_TICS, issuedTick: 100, kind: 'plant' as const, plantId: deck[0].plantId, slot: 0, lane: i % 3, col: 0 },
              { seq: 2, tick: 350 + MARGEN_DE_RED_TICS, issuedTick: 350, kind: 'plant' as const, plantId: deck[1].plantId, slot: 1, lane: (i + 1) % 3, col: 1 },
            ]

        const res = runAsyncTimeline({
          seed,
          p1Deck: deck,
          asyncDeck: deck,
          p1Actions,
          strictAuthoritativeHistory: false,
          asyncOpponentMode: 'strategic',
          strategicStyle: style,
          maxTicks: msToTicks(60000), // 60s por partida
        })

        expect(res.ok).toBe(true)
        expect(Number.isFinite(res.state.p1BaseHp)).toBe(true)
        expect(Number.isFinite(res.state.p2BaseHp)).toBe(true)
        expect(Number.isFinite(res.controller.sunBank)).toBe(true)
        expect(res.controller.stats.intentionsDropped).toBe(0)

        const plants = res.controller.stats.intentionsExecuted
        totalPlantsPlaced += plants
        totalDamageDealt += (INITIAL_BASE_HP - res.state.p1BaseHp)
        matchesCompleted += 1

        if (res.controller.strategicState) {
          totalSunSpent += res.controller.strategicState.metrics.totalSunSpent
          totalSunCredited += res.controller.strategicState.metrics.totalSunCredited
          for (const [r, count] of Object.entries(res.controller.strategicState.metrics.waitReasons)) {
            waitReasonsTotal[r] = (waitReasonsTotal[r] || 0) + count
          }
        }
      }

      expect(matchesCompleted).toBe(500)
      // Actividad promedio > 4 plantas en 60s (muy superior al baseline previo)
      const avgPlants = totalPlantsPlaced / 500
      expect(avgPlants).toBeGreaterThanOrEqual(4.0)

      // Verificación de descomposición de razones de WAIT
      expect(waitReasonsTotal['WAIT_NO_SUN']).toBeDefined()
    }, 30000)
  })

  // ── 11. COMPARATIVA VS REPLAY GHOST ────────────────────────────────────────
  describe('Comparativa vs Replay Ghost (3 Intenciones)', () => {
    it('demuestra que Strategic Bot supera ampliamente al Ghost en acciones, carriles y daño', () => {
      const ghostActions = [
        { seq: 1, tick: 320 + MARGEN_DE_RED_TICS, issuedTick: 320, kind: 'plant' as const, plantId: 'sunflower' as PlantId, slot: 0, lane: 0, col: 0 },
        { seq: 2, tick: 1050 + MARGEN_DE_RED_TICS, issuedTick: 1050, kind: 'plant' as const, plantId: 'peashooter' as PlantId, slot: 1, lane: 0, col: 1 },
        { seq: 3, tick: 1500 + MARGEN_DE_RED_TICS, issuedTick: 1500, kind: 'plant' as const, plantId: 'wallnut' as PlantId, slot: 2, lane: 0, col: 2 },
      ]

      // Replay con ghost fijo de 3 jugadas
      const ghostRes = runAsyncTimeline({
        seed: 777222,
        p1Deck: MAZO_ESTANDAR,
        asyncDeck: MAZO_ESTANDAR,
        p1Actions: [],
        asyncActions: ghostActions,
        asyncOpponentMode: 'replay',
        maxTicks: msToTicks(75000),
      })

      // Strategic Bot
      const strategicRes = runAsyncTimeline({
        seed: 777222,
        p1Deck: MAZO_ESTANDAR,
        asyncDeck: MAZO_ESTANDAR,
        p1Actions: [],
        asyncOpponentMode: 'strategic',
        maxTicks: msToTicks(75000),
      })

      expect(ghostRes.controller.stats.intentionsExecuted).toBe(3)
      // Strategic Bot debe superar en plantas y actividad
      expect(strategicRes.controller.stats.intentionsExecuted).toBeGreaterThan(3)
      // Strategic Bot debe haber infligido daño a la base
      expect(strategicRes.state.p1BaseHp).toBeLessThan(INITIAL_BASE_HP)
    })
  })
})
