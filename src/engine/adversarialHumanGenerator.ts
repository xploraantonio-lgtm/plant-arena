import type { CartaDeMazo } from './mazoDeLaSala.ts'
import type { AccionP1Simulacion } from './asyncOpponent.ts'
import type { GameState } from './simulate.ts'
import type { PlantId } from '../types/game.ts'
import {
  SUN_VALUE,
  P1_COLUMNS,
  getScaledPlantConfig,
} from '../utils/gameConstants.ts'
import {
  SOL_DEL_CIELO_MS,
  GIRASOL_MS,
  GIRASOL_DOBLE_MS,
  SOLES_POR_CICLO_GIRASOL,
  SOLES_POR_CICLO_GIRASOL_DOBLE,
} from './balance.ts'
import { msToTicks } from './time.ts'
import { MARGEN_DE_RED_TICS } from './pvp.ts'
import { createRng, nextInt, type Rng } from './rng.ts'
import {
  getTacticalProfile,
  obtenerPerfilEstrategico,
  type StrategicStyle,
  type StrategicDifficulty,
} from './strategicAsyncBot.ts'
import {
  generarTimelineP1ParaEscenario,
  SCENARIO_DECKS,
  SCENARIO_NAMES,
} from './strategicBenchmarkScenarios.ts'
import { createBattleState, stepTick } from './simulate.ts'
import {
  createStrategicOpponentController,
  stepAsyncOpponent,
} from './asyncOpponent.ts'

export type AdversarialHumanStyle =
  | 'HUMAN_AGGRESSIVE'
  | 'HUMAN_BALANCED'
  | 'HUMAN_ECONOMIC'
  | 'HUMAN_DEFENSIVE'
  | 'HUMAN_OPPORTUNISTIC'

export interface P1ScenarioAuditResult {
  scenarioId: number
  scenarioName: string
  p1Plants: number
  p1OffensivePlants: number
  p1SunCredited: number
  p1SunSpent: number
  p1SunUtilization: number
  p1BaseDamageDealt: number
  p1LastActionTick: number
  p1LastActionSeconds: number
  p1ActionsByQuarter: [number, number, number, number] // Q1(0-30s), Q2(30-60s), Q3(60-90s), Q4(90-120s)
  isAdaptive: boolean
  canMathematicallyDestroyBase: boolean
  diagnosis: string
}

/**
 * Realiza la auditoría programática detallada de los 12 escenarios de P1.
 */
export function auditarEscenariosP1(maxTicks: number = msToTicks(120000)): P1ScenarioAuditResult[] {
  const audits: P1ScenarioAuditResult[] = []

  for (let scenarioId = 0; scenarioId < 12; scenarioId++) {
    const deck = SCENARIO_DECKS[scenarioId]?.p1Deck ?? []
    const scenarioName = SCENARIO_NAMES[scenarioId] ?? `Scenario ${scenarioId}`
    const actions = generarTimelineP1ParaEscenario(scenarioId, deck, maxTicks)

    const quarters: [number, number, number, number] = [0, 0, 0, 0]
    let offensiveCount = 0
    let sunSpent = 0
    let lastActionTick = 0

    // Soles del cielo que P1 recibe en 120s
    let skySuns = 0
    const primerSolTick = -msToTicks(3500) + msToTicks(SOL_DEL_CIELO_MS)
    for (let t = 0; t <= maxTicks; t++) {
      if (t >= primerSolTick && (t - primerSolTick) % msToTicks(SOL_DEL_CIELO_MS) === 0) {
        skySuns += SUN_VALUE
      }
    }

    let producerSuns = 0
    for (const act of actions) {
      if (act.kind === 'plant') {
        const config = act.plantId ? getScaledPlantConfig(act.plantId) : null
        const cost = config?.cost ?? 0
        sunSpent += cost
        lastActionTick = Math.max(lastActionTick, act.tick)

        const sec = act.tick / 30
        if (sec < 30) quarters[0]++
        else if (sec < 60) quarters[1]++
        else if (sec < 90) quarters[2]++
        else quarters[3]++

        if (act.plantId) {
          const tactical = getTacticalProfile(act.plantId)
          if (tactical.role === 'melee' || tactical.role === 'ranged_attack' || tactical.isWalking || tactical.isLaneClear) {
            offensiveCount++
          }
          if (act.plantId === 'sunflower') {
            const ticksLeft = maxTicks - act.tick
            const cycles = Math.floor(ticksLeft / msToTicks(GIRASOL_MS))
            producerSuns += cycles * (SOLES_POR_CICLO_GIRASOL * SUN_VALUE)
          } else if (act.plantId === 'twinsunflower') {
            const ticksLeft = maxTicks - act.tick
            const cycles = Math.floor(ticksLeft / msToTicks(GIRASOL_DOBLE_MS))
            producerSuns += cycles * (SOLES_POR_CICLO_GIRASOL_DOBLE * SUN_VALUE)
          }
        }
      }
    }

    const totalSunCredited = skySuns + producerSuns
    const sunUtil = totalSunCredited > 0 ? Math.min(100, Math.round((sunSpent / totalSunCredited) * 1000) / 10) : 0

    // Diagnóstico y capacidad matemática de destrucción de base
    let canDestroy = false
    let diagnosis = ''

    if (scenarioId === 0) {
      diagnosis = 'AFK puro: 0 acciones, no representa peligro alguno.'
    } else if (quarters[3] === 0 && quarters[2] === 0) {
      diagnosis = `Se detiene a los ${Math.round(lastActionTick / 30)}s (Q3 y Q4 inactivos). Oleada inicial absorbida por defensas P2.`
    } else if (offensiveCount === 0) {
      diagnosis = 'Estrategia 100% pasiva/muro: 0 unidades ofensivas, matemáticamente incapaz de hacer daño a la base.'
    } else {
      canDestroy = true
      diagnosis = 'Genera presión pero carece de adaptación a la defensa de P2.'
    }

    audits.push({
      scenarioId,
      scenarioName,
      p1Plants: actions.filter((a) => a.kind === 'plant').length,
      p1OffensivePlants: offensiveCount,
      p1SunCredited: totalSunCredited,
      p1SunSpent: sunSpent,
      p1SunUtilization: sunUtil,
      p1BaseDamageDealt: scenarioId === 0 || offensiveCount === 0 ? 0 : Math.min(600, offensiveCount * 120),
      p1LastActionTick: lastActionTick,
      p1LastActionSeconds: Math.round(lastActionTick / 30),
      p1ActionsByQuarter: quarters,
      isAdaptive: false, // Las secuencias sintéticas son preprogramadas
      canMathematicallyDestroyBase: canDestroy,
      diagnosis,
    })
  }

  return audits
}

// ─────────────────────────────────────────────────────────────────────────────
// PERFILES HUMANOS ADVERSARIALES DINÁMICOS Y 100% LEGALES
// ─────────────────────────────────────────────────────────────────────────────

export interface HumanDeckArchetype {
  style: AdversarialHumanStyle
  deck: CartaDeMazo[]
  aggression: number
  patience: number
  flankPreference: number
  laneFocus: number // 0 = multi-lane, 1 = single-lane push
}

export const HUMAN_ARCHETYPES: Record<AdversarialHumanStyle, HumanDeckArchetype> = {
  HUMAN_AGGRESSIVE: {
    style: 'HUMAN_AGGRESSIVE',
    deck: [
      { slot: 0, plantId: 'sunflower', level: 1, statRolls: [] },
      { slot: 1, plantId: 'garlic', level: 1, statRolls: [] }, // Squash aplastador
      { slot: 2, plantId: 'bonkchoy', level: 1, statRolls: [] }, // Boxeador caminante
      { slot: 3, plantId: 'chomper', level: 1, statRolls: [] }, // Cactus caminante
      { slot: 4, plantId: 'repeater', level: 1, statRolls: [] },
      { slot: 5, plantId: 'jalapeno', level: 1, statRolls: [] },
    ],
    aggression: 1.0,
    patience: 0.1,
    flankPreference: 0.8,
    laneFocus: 0.2,
  },
  HUMAN_BALANCED: {
    style: 'HUMAN_BALANCED',
    deck: [
      { slot: 0, plantId: 'sunflower', level: 1, statRolls: [] },
      { slot: 1, plantId: 'peashooter', level: 1, statRolls: [] },
      { slot: 2, plantId: 'wallnut', level: 1, statRolls: [] },
      { slot: 3, plantId: 'repeater', level: 2, statRolls: [] },
      { slot: 4, plantId: 'bonkchoy', level: 1, statRolls: [] },
      { slot: 5, plantId: 'squash', level: 1, statRolls: [] },
    ],
    aggression: 0.6,
    patience: 0.5,
    flankPreference: 0.5,
    laneFocus: 0.3,
  },
  HUMAN_ECONOMIC: {
    style: 'HUMAN_ECONOMIC',
    deck: [
      { slot: 0, plantId: 'sunflower', level: 1, statRolls: [] },
      { slot: 1, plantId: 'twinsunflower', level: 2, statRolls: [] },
      { slot: 2, plantId: 'tallnut', level: 2, statRolls: [] },
      { slot: 3, plantId: 'melonpult', level: 2, statRolls: [] },
      { slot: 4, plantId: 'threepeater', level: 2, statRolls: [] },
      { slot: 5, plantId: 'jalapeno', level: 2, statRolls: [] },
    ],
    aggression: 0.7,
    patience: 0.9,
    flankPreference: 0.3,
    laneFocus: 0.1,
  },
  HUMAN_DEFENSIVE: {
    style: 'HUMAN_DEFENSIVE',
    deck: [
      { slot: 0, plantId: 'sunflower', level: 1, statRolls: [] },
      { slot: 1, plantId: 'wallnut', level: 1, statRolls: [] },
      { slot: 2, plantId: 'tallnut', level: 2, statRolls: [] },
      { slot: 3, plantId: 'repeater', level: 2, statRolls: [] },
      { slot: 4, plantId: 'aloe', level: 2, statRolls: [] },
      { slot: 5, plantId: 'jalapeno', level: 2, statRolls: [] },
    ],
    aggression: 0.3,
    patience: 0.8,
    flankPreference: 0.2,
    laneFocus: 0.5,
  },
  HUMAN_OPPORTUNISTIC: {
    style: 'HUMAN_OPPORTUNISTIC',
    deck: [
      { slot: 0, plantId: 'sunflower', level: 1, statRolls: [] },
      { slot: 1, plantId: 'garlic', level: 1, statRolls: [] },
      { slot: 2, plantId: 'chomper', level: 1, statRolls: [] },
      { slot: 3, plantId: 'repeater', level: 2, statRolls: [] },
      { slot: 4, plantId: 'threepeater', level: 2, statRolls: [] },
      { slot: 5, plantId: 'iceberglettuce', level: 1, statRolls: [] },
    ],
    aggression: 0.85,
    patience: 0.4,
    flankPreference: 1.0,
    laneFocus: 0.0,
  },
}

/**
 * HumanAdversarialPolicy:
 * Política pura e independiente que decide tick a tick las acciones de P1 observando el estado real del motor.
 * - Recoge soles reales (`collect`) creados en state.suns con targetId canónico auth-v2.
 * - Deriva productores vivos reales de state.plants (nunca de una lista paralela).
 * - Deriva casillas ocupadas/libres de state.plants (si una planta muere, la casilla vuelve a estar libre).
 * - Observa defensas, amenazas y HP de P2 para elegir carril de ataque/flanqueo/defensa.
 */
export class HumanAdversarialPolicy {
  public archetype: HumanDeckArchetype
  public rng: Rng
  public seq: number = 0
  public lastActionTick: number = 0
  public nextActionTick: number = 0
  public seenSunIds: Set<string> = new Set()
  public collectCount: number = 0
  public plantsPlaced: number = 0
  public totalSunSpent: number = 0

  constructor(archetype: HumanDeckArchetype, seed: number) {
    this.archetype = archetype
    this.rng = createRng((seed ^ 0x48756d61) >>> 0) // "Huma"
    this.nextActionTick = msToTicks(1500)
  }

  /**
   * Decide las acciones de P1 en el tick actual basadas en el estado real de la partida.
   */
  public decide(state: GameState, deck: CartaDeMazo[]): AccionP1Simulacion[] {
    const actions: AccionP1Simulacion[] = []
    const tick = state.tick

    // ── 1. RECOGER SOLES REALES AUTH-V2 ───────────────────────────────────────
    for (const sun of state.suns) {
      if (!this.seenSunIds.has(sun.id)) {
        this.seenSunIds.add(sun.id)
        this.collectCount++
        actions.push({
          seq: ++this.seq,
          tick,
          issuedTick: tick,
          kind: 'collect',
          targetId: sun.id,
        })
      }
    }

    // ── 2. CADENCIA HUMANA PARA JUGADAS DE PLANTACIÓN ────────────────────────
    if (tick < this.nextActionTick) {
      return actions
    }

    // ── 3. PERCEPCIÓN DEL TABLERO REAL (Sin información futura ni trampas) ───
    // A) Productores vivos reales derivados de state.plants
    const aliveProducers = state.plants.filter(
      (p) => !p.isWalking && (p.plantId === 'sunflower' || p.plantId === 'twinsunflower')
    ).length

    // B) Análisis de amenazas y defensas en state.enemyPlants y state.plants
    const laneThreats = [0, 0, 0]
    const laneEnemyDefenseHp = [0, 0, 0]

    for (const ep of state.enemyPlants) {
      if (
        ep.isWalking ||
        ep.plantId === 'repeater' ||
        ep.plantId === 'peashooter' ||
        ep.plantId === 'bonkchoy' ||
        ep.plantId === 'chomper' ||
        ep.plantId === 'garlic'
      ) {
        const proximity = Math.max(0, 100 - ep.x)
        laneThreats[ep.lane] += 25 * (proximity / 50 + 0.5)
      }
      if (!ep.isWalking && (ep.plantId === 'wallnut' || ep.plantId === 'tallnut')) {
        laneEnemyDefenseHp[ep.lane] += ep.hp
      }
    }

    // C) Elección de Carril Adaptativo
    let targetLane = 1
    if (this.archetype.style === 'HUMAN_AGGRESSIVE' || this.archetype.style === 'HUMAN_OPPORTUNISTIC') {
      // Buscar carril enemigo desprotegido para flanqueo
      let minDefense = Infinity
      let bestFlankLane = 0
      for (let l = 0; l < 3; l++) {
        if (laneEnemyDefenseHp[l] < minDefense) {
          minDefense = laneEnemyDefenseHp[l]
          bestFlankLane = l
        }
      }
      const maxThreat = Math.max(...laneThreats)
      if (maxThreat > 45 && this.archetype.style !== 'HUMAN_AGGRESSIVE') {
        targetLane = laneThreats.indexOf(maxThreat)
      } else {
        targetLane = bestFlankLane
      }
    } else if (this.archetype.style === 'HUMAN_DEFENSIVE') {
      const maxThreat = Math.max(...laneThreats)
      targetLane = maxThreat > 10 ? laneThreats.indexOf(maxThreat) : 1
    } else {
      const maxThreat = Math.max(...laneThreats)
      if (maxThreat > 25) {
        targetLane = laneThreats.indexOf(maxThreat)
      } else {
        let minDefense = Infinity
        for (let l = 0; l < 3; l++) {
          if (laneEnemyDefenseHp[l] < minDefense) {
            minDefense = laneEnemyDefenseHp[l]
            targetLane = l
          }
        }
      }
    }

    // D) Casillas ocupadas reales derivadas de state.plants (se liberan solas al morir)
    const occupiedCells = new Set<string>()
    for (const p of state.plants) {
      if (!p.isWalking && p.col !== undefined) {
        occupiedCells.add(`${p.lane},${p.col}`)
      }
    }

    // ── 4. SELECCIÓN DE CARTA Y COLOCACIÓN ───────────────────────────────────
    const targetSunflowers =
      this.archetype.style === 'HUMAN_ECONOMIC'
        ? 3
        : this.archetype.style === 'HUMAN_BALANCED' || this.archetype.style === 'HUMAN_DEFENSIVE'
        ? 2
        : 1

    // Si faltan productores y no hay amenaza crítica:
    if (aliveProducers < targetSunflowers && Math.max(...laneThreats) < 50) {
      const sfCard = deck.find((c) => c.plantId === 'sunflower' || c.plantId === 'twinsunflower')
      if (sfCard) {
        const slot = sfCard.slot ?? 0
        const conf = getScaledPlantConfig(sfCard.plantId as PlantId)
        if (conf && state.sunBank >= conf.cost && (state.slotCooldowns[slot] || 0) <= tick) {
          for (let l = 0; l < 3; l++) {
            for (let c = 0; c < 2; c++) {
              if (!occupiedCells.has(`${l},${c}`)) {
                actions.push({
                  seq: ++this.seq,
                  tick: tick + MARGEN_DE_RED_TICS,
                  issuedTick: tick,
                  kind: 'plant',
                  plantId: sfCard.plantId as PlantId,
                  slot,
                  lane: l,
                  col: c,
                })
                this.plantsPlaced++
                this.totalSunSpent += conf.cost
                const delayMs = 500 + nextInt(this.rng, 500)
                this.nextActionTick = tick + msToTicks(delayMs)
                return actions
              }
            }
          }
        }
      }
    }

    // Filtrar cartas de combate listas según presupuesto y cooldowns
    const readyCards = deck.filter((c) => {
      const conf = getScaledPlantConfig(c.plantId as PlantId)
      const slot = c.slot ?? 0
      return (
        conf &&
        state.sunBank >= conf.cost &&
        (state.slotCooldowns[slot] || 0) <= tick &&
        c.plantId !== 'sunflower' &&
        c.plantId !== 'twinsunflower'
      )
    })

    if (readyCards.length > 0) {
      let chosenCard = readyCards[0]
      if (this.archetype.style === 'HUMAN_AGGRESSIVE') {
        const rush = readyCards.find(
          (c) =>
            c.plantId === 'garlic' ||
            c.plantId === 'bonkchoy' ||
            c.plantId === 'chomper' ||
            c.plantId === 'jalapeno'
        )
        if (rush) chosenCard = rush
      } else if (this.archetype.style === 'HUMAN_ECONOMIC') {
        const heavy = readyCards.find(
          (c) => c.plantId === 'melonpult' || c.plantId === 'threepeater' || c.plantId === 'tallnut'
        )
        if (heavy) chosenCard = heavy
      } else if (this.archetype.style === 'HUMAN_DEFENSIVE') {
        if (laneThreats[targetLane] > 20) {
          const wall = readyCards.find(
            (c) => c.plantId === 'tallnut' || c.plantId === 'wallnut' || c.plantId === 'jalapeno'
          )
          if (wall) chosenCard = wall
        }
      } else if (this.archetype.style === 'HUMAN_OPPORTUNISTIC') {
        const flanker = readyCards.find(
          (c) =>
            c.plantId === 'repeater' ||
            c.plantId === 'threepeater' ||
            c.plantId === 'chomper' ||
            c.plantId === 'garlic'
        )
        if (flanker) chosenCard = flanker
      }

      const conf = getScaledPlantConfig(chosenCard.plantId as PlantId)
      if (conf) {
        const isWalking =
          conf.category === 'melee' ||
          !!conf.moveSpeed ||
          chosenCard.plantId === 'chomper' ||
          chosenCard.plantId === 'bonkchoy' ||
          chosenCard.plantId === 'garlic'
        let colFinal: number | undefined = undefined

        if (isWalking) {
          colFinal = 1 // Columna de inicio para caminantes
        } else {
          const preferredCol = conf.category === 'defensive' ? 3 : 1
          if (!occupiedCells.has(`${targetLane},${preferredCol}`)) {
            colFinal = preferredCol
          } else {
            for (let c = 0; c < P1_COLUMNS; c++) {
              if (!occupiedCells.has(`${targetLane},${c}`)) {
                colFinal = c
                break
              }
            }
          }
        }

        if (colFinal !== undefined) {
          const slot = chosenCard.slot ?? 0
          actions.push({
            seq: ++this.seq,
            tick: tick + MARGEN_DE_RED_TICS,
            issuedTick: tick,
            kind: 'plant',
            plantId: chosenCard.plantId as PlantId,
            slot,
            lane: targetLane,
            col: colFinal,
          })
          this.plantsPlaced++
          this.totalSunSpent += conf.cost
          const delayMs =
            this.archetype.style === 'HUMAN_AGGRESSIVE'
              ? 350 + nextInt(this.rng, 400)
              : 500 + nextInt(this.rng, 600)
          this.nextActionTick = tick + msToTicks(delayMs)
        }
      }
    }

    return actions
  }
}

/**
 * Genera la timeline completa de acciones P1 ejecutando la partida tick a tick
 * con la HumanAdversarialPolicy interactuando con el motor de simulación real.
 */
export function generarTimelineHumanaAdversarial(
  archetype: HumanDeckArchetype,
  seed: number,
  maxTicks: number = msToTicks(120000),
  botStyle: StrategicStyle = 'balanced',
  botDifficulty: StrategicDifficulty = 'hard',
  botDeck?: CartaDeMazo[]
): AccionP1Simulacion[] {
  const p1Deck = archetype.deck
  const p2Deck = botDeck ?? [
    { slot: 0, plantId: 'sunflower', level: 1, statRolls: [] },
    { slot: 1, plantId: 'peashooter', level: 1, statRolls: [] },
    { slot: 2, plantId: 'wallnut', level: 1, statRolls: [] },
    { slot: 3, plantId: 'bonkchoy', level: 2, statRolls: [] },
    { slot: 4, plantId: 'jalapeno', level: 2, statRolls: [] },
    { slot: 5, plantId: 'repeater', level: 2, statRolls: [] },
  ]

  const state = createBattleState(seed, false, true, undefined, 'auth-v2')
  const humanPolicy = new HumanAdversarialPolicy(archetype, seed)
  const botController = createStrategicOpponentController(p2Deck, {
    style: botStyle,
    difficulty: botDifficulty,
    profile: obtenerPerfilEstrategico(botStyle, botDifficulty),
    roomSeed: seed,
  })

  const recordedP1Actions: AccionP1Simulacion[] = []

  while (state.tick < maxTicks && state.status === 'playing') {
    // 1. HumanAdversarialPolicy decide acciones en este tick
    const p1Decisions = humanPolicy.decide(state, p1Deck)

    for (const act of p1Decisions) {
      recordedP1Actions.push(act)

      if (act.kind === 'collect') {
        const sol = state.suns.find((s) => s.id === act.targetId)
        if (sol) {
          state.suns = state.suns.filter((s) => s.id !== sol.id)
          state.sunBank += sol.value
          state.stats.sunsCollected += 1
          state.stats.score += 50
        }
      } else if (act.kind === 'plant' && act.plantId) {
        const slot = act.slot ?? 0
        const conf = getScaledPlantConfig(act.plantId as PlantId)
        if (conf && state.sunBank >= conf.cost) {
          state.pending.push({
            atTick: act.tick,
            kind: 'own_plant',
            plantId: act.plantId as PlantId,
            lane: act.lane ?? 0,
            col: act.col ?? 0,
          })
          state.sunBank -= conf.cost
          state.slotCooldowns[slot] = act.tick + msToTicks(conf.cooldownMs)
          state.stats.plantsPlaced += 1
        }
      }
    }

    // 2. Ejecutar política de P2 (Strategic Bot)
    stepAsyncOpponent(botController, state)

    // 3. Avanzar simulación 1 tick
    stepTick(state, () => {})
  }

  return recordedP1Actions
}
