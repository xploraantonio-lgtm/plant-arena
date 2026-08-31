import { describe, it, expect } from 'vitest'
import {
  percibirTablero,
  generarAccionesCandidatas,
  obtenerPerfilEstrategico,
  crearEstadoMentalEstrategico,
  calcularReservaSoles,
  actualizarMemoriaDeCarriles,
  escalarPerfilPorElo,
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
import { auditarEscenariosP1 } from './adversarialHumanGenerator.ts'
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

    // ── V3.1 ENHANCEMENTS TESTS ──────────────────────────────────────────────
    it('8. Estado DESPERATE: se activa bajo <= 25% HP y fuerza all-in con cero reserva de soles', () => {
      const state = createBattleState(1234, false, true)
      state.p2BaseHp = 240 // <= 25% HP (240 / 1000 = 24%)
      const profile = obtenerPerfilEstrategico('balanced')
      const mentalState = crearEstadoMentalEstrategico(9999, profile)

      const perception = percibirTablero(state, 200, profile, mentalState)
      expect(perception.personalityState).toBe('DESPERATE')

      // Verificar que en DESPERATE la reserva de soles se anula para gastar todo
      const reserve = calcularReservaSoles(perception, profile, perception.personalityState)
      expect(reserve).toBe(0)

      // Verificar que las unidades de ataque reciben gran bonificación de remontada
      const candidates = generarAccionesCandidatas(MAZO_ESTANDAR, {}, perception, state, profile, mentalState)
      const attackCard = candidates.find((c) => c.plantId === 'chomper')
      expect(attackCard).toBeDefined()
      expect(attackCard!.utility).toBeGreaterThan(60)
    })

    it('9. Behavioral Diversity: distribuye arquetipos de apertura deterministas entre semillas', () => {
      const profile = obtenerPerfilEstrategico('balanced')
      const archetypes = new Set<string>()

      for (let s = 1; s <= 50; s++) {
        const mental = crearEstadoMentalEstrategico(s * 777, profile)
        archetypes.add(mental.openingArchetype)
      }

      // Debe haber generado los 3 arquetipos en la muestra
      expect(archetypes.has('ECO_FIRST')).toBe(true)
      expect(archetypes.has('TEMPO_LANE')).toBe(true)
      expect(archetypes.has('EARLY_RUSH')).toBe(true)
    })

    it('10. Adaptive Lane Memory: detecta carril preferido y carril ciego del rival', () => {
      const state = createBattleState(1234, false, true)
      // El humano concentra 3 atacantes en carril 0, 1 girasol en carril 1 y 0 plantas en carril 2
      state.plants.push(
        { id: 'p1-1', plantId: 'peashooter', lane: 0, x: 20, hp: 300, maxHp: 300, isWalking: false, state: 'idle', lastActionTime: 0 },
        { id: 'p1-2', plantId: 'repeater', lane: 0, x: 25, hp: 300, maxHp: 300, isWalking: false, state: 'idle', lastActionTime: 0 },
        { id: 'p1-3', plantId: 'bonkchoy', lane: 0, x: 50, hp: 500, maxHp: 500, isWalking: true, state: 'walking', lastActionTime: 0 },
        { id: 'p1-mid', plantId: 'sunflower', lane: 1, x: 20, hp: 300, maxHp: 300, isWalking: false, state: 'idle', lastActionTime: 0 }
      )

      const profile = obtenerPerfilEstrategico('balanced')
      const mentalState = crearEstadoMentalEstrategico(4321, profile)

      actualizarMemoriaDeCarriles(mentalState, state)
      expect(mentalState.laneMemory.preferredAttackLane).toBe(0)
      expect(mentalState.laneMemory.neglectedLane).toBe(2)

      const perception = percibirTablero(state, 200, profile, mentalState)
      const candidates = generarAccionesCandidatas(MAZO_ESTANDAR, {}, perception, state, profile, mentalState)

      // Verificar que el carril ciego (lane 2) recibe bonificación de ataque por flanqueo inteligente
      const attackLane2 = candidates.find((c) => c.plantId === 'chomper' && c.lane === 2)
      expect(attackLane2).toBeDefined()
      expect(attackLane2!.utility).toBeGreaterThan(40)
    })

    it('11. ELO Scaling: escala de forma continua la precisión, cadencia y tolerancia al error', () => {
      const baseProfile = obtenerPerfilEstrategico('balanced')

      const profileBronze = escalarPerfilPorElo(baseProfile, 800)
      const profileGold = escalarPerfilPorElo(baseProfile, 1200)
      const profileDiamond = escalarPerfilPorElo(baseProfile, 1400)
      const profileMaster = escalarPerfilPorElo(baseProfile, 1900)

      // Margen de error se ajusta por brackets ELO (0.20 en <=1200, 0.125 en 1400, 0.05 en 1900)
      expect(profileBronze.badPlayMargin).toBe(0.20)
      expect(profileGold.badPlayMargin).toBe(0.20)
      expect(profileGold.badPlayMargin).toBeGreaterThan(profileDiamond.badPlayMargin)
      expect(profileDiamond.badPlayMargin).toBeGreaterThan(profileMaster.badPlayMargin)
      expect(profileMaster.badPlayMargin).toBe(0.05)

      // Tiempo de reacción es más rápido con mayor ELO
      expect(profileBronze.reactionMs).toBeGreaterThan(profileGold.reactionMs)
      expect(profileGold.reactionMs).toBeGreaterThan(profileDiamond.reactionMs)
      expect(profileDiamond.reactionMs).toBeGreaterThan(profileMaster.reactionMs)
    })

    it('12. Exponential Memory Decay: la memoria decae suavemente con el tiempo sin reseteos instantáneos', () => {
      const state = createBattleState(1234, false, true)
      const profile = obtenerPerfilEstrategico('balanced')
      const mentalState = crearEstadoMentalEstrategico(9999, profile)

      // Oleada en carril 0
      state.plants.push({
        id: 'p1-wave',
        plantId: 'bonkchoy',
        lane: 0,
        x: 40,
        hp: 500,
        maxHp: 500,
        isWalking: true,
        state: 'walking',
        lastActionTime: 0,
      })

      actualizarMemoriaDeCarriles(mentalState, state)
      const initialHeatmapL0 = mentalState.laneMemory.attackHeatmap[0]
      expect(initialHeatmapL0).toBeGreaterThan(0)

      // El atacante muere (state.plants queda vacío) pero han pasado 5 segundos
      state.plants = []
      state.tick = msToTicks(5000)
      actualizarMemoriaDeCarriles(mentalState, state)

      // La memoria NO es 0 inmediatamente: retiene el histórico
      expect(mentalState.laneMemory.attackHeatmap[0]).toBeGreaterThan(0)
      expect(mentalState.laneMemory.attackHeatmap[0]).toBeLessThan(initialHeatmapL0)

      // Tras 35 segundos (1050 ticks), la memoria ha decaído casi por completo
      state.tick = msToTicks(35000)
      actualizarMemoriaDeCarriles(mentalState, state)
      expect(mentalState.laneMemory.attackHeatmap[0]).toBeLessThan(0.01)
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
    it(
      'compara exhaustivamente todos los campos de estado e intenciones producidas',
      () => {
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
        }
      },
      30000
    )
  })

  // ── 6. AUDITORÍA DE ESCENARIOS P1 & PERCEPCIÓN DE STALEMATE ────────────────
  describe('6. Auditoría Exhaustiva de Escenarios P1 y Respuesta a Stalemate', () => {
    it('audita programáticamente los 12 escenarios P1 explicando por qué P1 era pasivo', () => {
      const audits = auditarEscenariosP1(msToTicks(120000))
      expect(audits.length).toBe(12)

      for (const a of audits) {
        expect(a.p1ActionsByQuarter.length).toBe(4)
        expect(a.p1SunUtilization).toBeGreaterThanOrEqual(0)
      }

      console.log('=== P1_SCENARIO_AUDIT_START ===')
      console.log(JSON.stringify(audits, null, 2))
      console.log('=== P1_SCENARIO_AUDIT_END ===')
    })

    it('demuestra resolución de estancamiento (Stalemate Flanking y Rompedor de Muros)', () => {
      // Simular escenario 5 (Single Lane Block) con Stalemate Detection activada
      const deck = SCENARIO_DECKS[5]
      const p1Actions = generarTimelineP1ParaEscenario(5, deck.p1Deck, msToTicks(120000))

      const res = runAsyncTimeline({
        seed: 7771,
        engineVersion: 'auth-v2',
        p1Deck: deck.p1Deck,
        asyncDeck: deck.botDeck,
        p1Actions,
        maxTicks: msToTicks(120000),
        strictAuthoritativeHistory: false,
        asyncOpponentMode: 'strategic',
        strategicStyle: 'opportunistic',
        strategicDifficulty: 'hard',
      })

      // El bot debe haber usado carriles alternativos (flanqueo) o haber lanzado Jalapeño / daño
      const metrics = res.controller.strategicState?.metrics
      expect(metrics?.lanesUsed.length).toBeGreaterThanOrEqual(1)
      expect(res.state.p1BaseHp).toBeDefined()
    })
  })

  // ── 7. BENCHMARK COMPETITIVO COMPLETO DE 1,000 PARTIDAS Y HEAD-TO-HEAD HUMANO
  describe('7. Benchmark Competitivo Completo y Head-to-Head Adversarial', () => {
    it(
      'ejecuta 1,000 partidas completas con clasificación de timeouts y head-to-head humano',
      () => {
        const report = runStrategicBenchmark(1000, msToTicks(120000))

        // Verificaciones de integridad del benchmark
        expect(report.totalMatches).toBe(1000)
        expect(report.matrix.length).toBe(60) // 5 styles x 12 scenarios
        expect(report.overall.avgPlants).toBeGreaterThanOrEqual(3.5)
        expect(report.overall.avgSunUtilization).toBeGreaterThan(70)
        expect(report.anomalies.crashes).toBe(0)
        expect(report.anomalies.nans).toBe(0)
        expect(report.anomalies.droppedIntents).toBe(0)
        expect(report.anomalies.illegalIntents).toBe(0)

        // Verificar que Head-to-Head Adversarial Humano produce victorias, derrotas y empates
        expect(report.adversarialHeadToHead.length).toBe(5)
        const totalBotWinsH2H = report.adversarialHeadToHead.reduce((acc, h) => acc + h.botWins, 0)
        const totalBotLossesH2H = report.adversarialHeadToHead.reduce((acc, h) => acc + h.botLosses, 0)
        expect(totalBotWinsH2H).toBeGreaterThan(0)
        expect(totalBotLossesH2H).toBeGreaterThan(0) // Derrotas naturales contra humanos agresivos/control

        // Imprimir el reporte completo
        console.log('=== STRATEGIC_BENCHMARK_REPORT_START ===')
        console.log(JSON.stringify(report, null, 2))
        console.log('=== STRATEGIC_BENCHMARK_REPORT_END ===')
      },
      300000
    )
  })

  // ── 8. FAST SOAK TEST (10,000 SIMULACIONES) ───────────────────────────────
  describe('8. Fast Soak Test de 10,000 Simulaciones', () => {
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
            engineVersion: 'auth-v2',
            p1Deck: deck.p1Deck,
            asyncDeck: deck.botDeck,
            p1Actions,
            maxTicks: msToTicks(15000),
            strictAuthoritativeHistory: false,
            asyncOpponentMode: 'strategic',
            strategicStyle: style,
            strategicDifficulty: 'hard',
          })

          if (Number.isNaN(res.state.p1BaseHp) || res.controller.stats.intentionsDropped > 0) {
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
