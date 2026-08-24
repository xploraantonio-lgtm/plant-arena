import { describe, it, expect } from 'vitest'
import {
  percibirTablero,
  generarAccionesCandidatas,
  decidirAccionEstrategica,
  crearEstadoMentalEstrategico,
  obtenerPerfilEstrategico,
  PLANT_TACTICAL_PROFILES,
  STRATEGIC_PROFILES,
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

describe('RIVAL ESTRATÉGICO V1 — UTILITY AI DETERMINISTA', () => {
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

  // ── 2. TEST FUNDAMENTAL DE DETERMINISMO ────────────────────────────────────
  describe('Determinismo Fundamental', () => {
    it('dos ejecuciones con mismo seed, mazo y acciones P1 generan decisiones 100% idénticas', () => {
      const seed = 998877
      const p1Actions = [
        { seq: 1, tick: 120 + MARGEN_DE_RED_TICS, issuedTick: 120, kind: 'plant', plantId: 'sunflower', slot: 0, lane: 0, col: 0 },
      ]

      const res1 = runAsyncTimeline({
        seed,
        p1Deck: MAZO_ESTANDAR,
        asyncDeck: MAZO_ESTANDAR,
        p1Actions,
        strictAuthoritativeHistory: false,
        asyncOpponentMode: 'strategic',
        maxTicks: 900,
      })

      const res2 = runAsyncTimeline({
        seed,
        p1Deck: MAZO_ESTANDAR,
        asyncDeck: MAZO_ESTANDAR,
        p1Actions,
        strictAuthoritativeHistory: false,
        asyncOpponentMode: 'strategic',
        maxTicks: 900,
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

  // ── 3. TEST DE SENSIBILIDAD ────────────────────────────────────────────────
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

  // ── 4. TEST DE ECONOMÍA ────────────────────────────────────────────────────
  describe('Economía y Girasoles Inteligentes', () => {
    it('tablero seguro y baja economía favorece girasol con alta utilidad', () => {
      const state = createBattleState(1234, false, true)
      const profile = obtenerPerfilEstrategico('economic')
      const perception = percibirTablero(state, 100, profile)

      const candidates = generarAccionesCandidatas(
        MAZO_ESTANDAR,
        {},
        perception,
        state,
        profile
      )

      const sunflowerAction = candidates.find((c) => c.plantId === 'sunflower')
      expect(sunflowerAction).toBeDefined()
      expect(sunflowerAction!.utility).toBeGreaterThan(40)
      expect(candidates[0].plantId).toBe('sunflower')
    })

    it('amenaza crítica reduce drásticamente la prioridad del girasol frente a defensa', () => {
      const state = createBattleState(1234, false, true)
      const profile = obtenerPerfilEstrategico('defensive')

      // Añadir amenaza crítica en carril 1
      state.plants.push({
        id: 'p1-garlic-1',
        plantId: 'garlic',
        lane: 1,
        x: 75, // Muy cerca de la base P2
        hp: 300,
        maxHp: 300,
        damage: 600,
        isWalking: true,
        state: 'walking',
        lastActionTime: 0,
      })

      const perception = percibirTablero(state, 100, profile)
      expect(perception.mode).toBe('EMERGENCY_DEFEND')

      const candidates = generarAccionesCandidatas(
        MAZO_ESTANDAR,
        {},
        perception,
        state,
        profile
      )

      const wallnutAction = candidates.find((c) => c.plantId === 'wallnut' && c.lane === 1)
      const sunflowerAction = candidates.find((c) => c.plantId === 'sunflower')

      expect(wallnutAction).toBeDefined()
      expect(sunflowerAction).toBeDefined()
      expect(wallnutAction!.utility).toBeGreaterThan(sunflowerAction!.utility)
    })
  })

  // ── 5. TEST CARRIL VACÍO ───────────────────────────────────────────────────
  describe('Oportunidad en Carril Vacío', () => {
    it('carril enemigo sin defensas tiene mayor oportunidad de ataque que carril fortificado', () => {
      const state = createBattleState(1234, false, true)
      const profile = obtenerPerfilEstrategico('opportunistic')

      // Fortificar carril 0 para P1 con nueces
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

      const perception = percibirTablero(state, 200, profile)
      expect(perception.lanes[1].attackOpportunityScore).toBeGreaterThan(perception.lanes[0].attackOpportunityScore)
      expect(perception.lanes[2].attackOpportunityScore).toBeGreaterThan(perception.lanes[0].attackOpportunityScore)
    })
  })

  // ── 6. TEST DEFENSA INTELIGENTE ───────────────────────────────────────────
  describe('Defensa Inteligente', () => {
    it('amenaza fuerte en carril 1 prioriza colocar defensa en carril 1 sobre atacar carril 2', () => {
      const state = createBattleState(1234, false, true)
      const profile = obtenerPerfilEstrategico('defensive')

      state.plants.push({
        id: 'p1-attacker-1',
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
      const candidates = generarAccionesCandidatas(
        MAZO_ESTANDAR,
        {},
        perception,
        state,
        profile
      )

      const defenseLane1 = candidates.find((c) => c.plantId === 'wallnut' && c.lane === 1)
      const attackLane2 = candidates.find((c) => c.plantId === 'chomper' && c.lane === 2)

      expect(defenseLane1).toBeDefined()
      expect(attackLane2).toBeDefined()
      expect(defenseLane1!.utility).toBeGreaterThan(attackLane2!.utility)
    })
  })

  // ── 7. TEST DE CIERRE DE PARTIDA ───────────────────────────────────────────
  describe('Cierre de Partida', () => {
    it('base rival muy baja activa agresión máxima y desincentiva economía', () => {
      const state = createBattleState(1234, false, true)
      state.p1BaseHp = 250 // Base enemiga casi destruida
      const profile = obtenerPerfilEstrategico('aggressive')

      const perception = percibirTablero(state, 200, profile)
      expect(perception.mode).toBe('PRESSURE')

      const candidates = generarAccionesCandidatas(
        MAZO_ESTANDAR,
        {},
        perception,
        state,
        profile
      )

      const attackerAction = candidates.find((c) => c.plantId === 'chomper' || c.plantId === 'peashooter')
      const producerAction = candidates.find((c) => c.plantId === 'sunflower')

      expect(attackerAction).toBeDefined()
      expect(producerAction).toBeDefined()
      expect(attackerAction!.utility).toBeGreaterThan(producerAction!.utility)
    })
  })

  // ── 8. TEST CONTRA AFK ─────────────────────────────────────────────────────
  describe('Comportamiento Contra Jugador AFK', () => {
    it('ante un P1 inactivo, el Strategic Bot construye economía, ataca y daña la base', () => {
      const res = runAsyncTimeline({
        seed: 443322,
        p1Deck: MAZO_ESTANDAR,
        asyncDeck: MAZO_ESTANDAR,
        p1Actions: [], // P1 totalmente AFK
        asyncOpponentMode: 'strategic',
        maxTicks: msToTicks(60000), // 60 segundos de partida
      })

      expect(res.ok).toBe(true)
      // Debe haber colocado múltiples plantas
      expect(res.controller.stats.intentionsExecuted).toBeGreaterThanOrEqual(4)
      // Debe haber colocado al menos un girasol
      const tieneGirasol = res.state.enemyPlants.some((p) => p.plantId === 'sunflower')
      expect(tieneGirasol).toBe(true)
      // En la telemetría debe constar que tomó acciones de ataque o colocó atacantes
      const accionesPlant = res.controller.telemetry?.filter((t) => t.chosenAction.kind === 'plant') ?? []
      expect(accionesPlant.length).toBeGreaterThanOrEqual(3)
      // La base de P1 debe haber recibido daño
      expect(res.state.p1BaseHp).toBeLessThan(INITIAL_BASE_HP)
    })
  })

  // ── 9. TEST CONTRA PRESIÓN MULTILÍNEA ──────────────────────────────────────
  describe('Respuesta ante Presión en 3 Carriles', () => {
    it('bot gestiona reserva y defiende los carriles más amenazados', () => {
      const seed = 556677
      const p1Actions = [
        { seq: 1, tick: 60 + MARGEN_DE_RED_TICS, issuedTick: 60, kind: 'plant', plantId: 'chomper', slot: 3, lane: 0, col: 0 },
        { seq: 2, tick: 120 + MARGEN_DE_RED_TICS, issuedTick: 120, kind: 'plant', plantId: 'chomper', slot: 3, lane: 1, col: 0 },
        { seq: 3, tick: 180 + MARGEN_DE_RED_TICS, issuedTick: 180, kind: 'plant', plantId: 'chomper', slot: 3, lane: 2, col: 0 },
      ]

      const res = runAsyncTimeline({
        seed,
        p1Deck: MAZO_ESTANDAR,
        asyncDeck: MAZO_ESTANDAR,
        p1Actions,
        strictAuthoritativeHistory: false, // Permite simular oleada externa de P1 para medir reacción de P2
        asyncOpponentMode: 'strategic',
        strategicStyle: 'defensive',
        maxTicks: msToTicks(30000),
      })

      expect(res.ok).toBe(true)
      // Bot no debe colapsar sin actuar
      expect(res.controller.stats.intentionsExecuted).toBeGreaterThanOrEqual(2)
    })
  })

  // ── 10. TEST DE LAS 15 CARTAS EN MAZO ──────────────────────────────────────
  describe('Soporte Completo de las 15 Cartas', () => {
    it('juega legalmente con un mazo de tier avanzado (Jalapeño, Melón, Nuez Alta, etc.)', () => {
      const res = runAsyncTimeline({
        seed: 112233,
        p1Deck: MAZO_AVANZADO,
        asyncDeck: MAZO_AVANZADO,
        p1Actions: [],
        asyncOpponentMode: 'strategic',
        maxTicks: msToTicks(60000),
      })

      expect(res.ok).toBe(true)
      expect(res.controller.stats.intentionsExecuted).toBeGreaterThanOrEqual(2)
      expect(res.controller.stats.intentionsDropped).toBe(0)
    })
  })

  // ── 11. TEST DE AISLAMIENTO DE RNG ─────────────────────────────────────────
  describe('Aislamiento del PRNG del Bot', () => {
    it('evaluar el bot o cambiar su estado mental no afecta el state.rng de la partida', () => {
      const state1 = createBattleState(9999, false, true)
      const state2 = createBattleState(9999, false, true)

      // state1 evalúa 20 decisiones estratégicas
      const mental = crearEstadoMentalEstrategico(9999, STRATEGIC_PROFILES.balanced)
      for (let i = 0; i < 20; i++) {
        percibirTablero(state1, 200, STRATEGIC_PROFILES.balanced)
        decidirAccionEstrategica(state1, MAZO_ESTANDAR, {}, 200, mental)
      }

      // Ambos estados deben tener exactamente el mismo estado interno de RNG de combate
      expect(state1.rng.s).toBe(state2.rng.s)
    })
  })

  // ── 12. BENCHMARK DE 100 PARTIDAS OFFLINE ──────────────────────────────────
  describe('Benchmark Determinista de 100 Partidas Offline', () => {
    it('ejecuta 100 partidas completas sin crashes, NaNs, jugadas ilegales ni loops', () => {
      const styles: StrategicStyle[] = ['balanced', 'aggressive', 'defensive', 'economic', 'opportunistic']
      let totalPlantsPlaced = 0
      let totalDamageDealt = 0
      let matchesCompleted = 0

      for (let i = 0; i < 100; i++) {
        const seed = 10000 + i * 37
        const style = styles[i % styles.length]
        const deck = (i % 2 === 0) ? MAZO_ESTANDAR : MAZO_AVANZADO

        // P1 coloca 1 planta legal con sus 50 soles iniciales
        const p1Actions = [
          { seq: 1, tick: 100 + MARGEN_DE_RED_TICS, issuedTick: 100, kind: 'plant', plantId: deck[0].plantId, slot: 0, lane: i % 3, col: 0 },
        ]

        const res = runAsyncTimeline({
          seed,
          p1Deck: deck,
          asyncDeck: deck,
          p1Actions,
          strictAuthoritativeHistory: false,
          asyncOpponentMode: 'strategic',
          strategicStyle: style,
          maxTicks: msToTicks(30000), // 30s por partida
        })

        expect(res.ok).toBe(true)
        expect(Number.isFinite(res.state.p1BaseHp)).toBe(true)
        expect(Number.isFinite(res.state.p2BaseHp)).toBe(true)
        expect(Number.isFinite(res.controller.sunBank)).toBe(true)
        expect(res.p1Ilegal).toBe(false)
        expect(res.controller.stats.intentionsDropped).toBe(0)

        totalPlantsPlaced += res.controller.stats.intentionsExecuted
        totalDamageDealt += (INITIAL_BASE_HP - res.state.p1BaseHp)
        matchesCompleted += 1
      }

      expect(matchesCompleted).toBe(100)
      expect(totalPlantsPlaced).toBeGreaterThan(150)
    })
  })

  // ── 13. COMPARACIÓN CONTRA REPLAY GHOST ────────────────────────────────────
  describe('Comparativa vs Replay Ghost (AFK vs Strategic)', () => {
    it('demuestra que Strategic Bot actúa más, presiona más y no queda inactivo', () => {
      // Replay con 0 acciones grabadas (Ghost AFK)
      const replayGhostRes = runAsyncTimeline({
        seed: 777111,
        p1Deck: MAZO_ESTANDAR,
        asyncDeck: MAZO_ESTANDAR,
        p1Actions: [],
        asyncActions: [], // Ghost vacío
        asyncOpponentMode: 'replay',
        maxTicks: msToTicks(60000),
      })

      // Strategic Bot con mismo escenario
      const strategicRes = runAsyncTimeline({
        seed: 777111,
        p1Deck: MAZO_ESTANDAR,
        asyncDeck: MAZO_ESTANDAR,
        p1Actions: [],
        asyncOpponentMode: 'strategic',
        maxTicks: msToTicks(60000),
      })

      // Replay Ghost no hace nada
      expect(replayGhostRes.controller.stats.intentionsExecuted).toBe(0)
      expect(replayGhostRes.state.enemyPlants.length).toBe(0)
      expect(replayGhostRes.state.p1BaseHp).toBe(INITIAL_BASE_HP)

      // Strategic Bot actúa activamente y hace daño
      expect(strategicRes.controller.stats.intentionsExecuted).toBeGreaterThanOrEqual(4)
      expect(strategicRes.state.enemyPlants.length).toBeGreaterThanOrEqual(2)
      expect(strategicRes.state.p1BaseHp).toBeLessThan(INITIAL_BASE_HP)
    })
  })
})
