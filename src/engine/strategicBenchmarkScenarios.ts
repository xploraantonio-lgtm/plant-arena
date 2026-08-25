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
import type { CartaDeMazo } from './mazoDeLaSala.ts'
import type { AccionP1Simulacion } from './asyncOpponent.ts'
import type { PlantId } from '../types/game.ts'

export interface ScenarioDefinition {
  id: number
  name: string
  description: string
  p1Deck: CartaDeMazo[]
  botDeck: CartaDeMazo[]
}

export const SCENARIO_DECKS: Record<number, { p1Deck: CartaDeMazo[]; botDeck: CartaDeMazo[] }> = {
  0: {
    // 0: AFK
    p1Deck: [
      { slot: 0, plantId: 'sunflower', level: 1, statRolls: [] },
      { slot: 1, plantId: 'peashooter', level: 1, statRolls: [] },
      { slot: 2, plantId: 'wallnut', level: 1, statRolls: [] },
      { slot: 3, plantId: 'chomper', level: 1, statRolls: [] },
    ],
    botDeck: [
      { slot: 0, plantId: 'sunflower', level: 1, statRolls: [] },
      { slot: 1, plantId: 'peashooter', level: 1, statRolls: [] },
      { slot: 2, plantId: 'wallnut', level: 1, statRolls: [] },
      { slot: 3, plantId: 'chomper', level: 1, statRolls: [] },
      { slot: 4, plantId: 'squash', level: 1, statRolls: [] },
      { slot: 5, plantId: 'threepeater', level: 1, statRolls: [] },
    ],
  },
  1: {
    // 1: Early Rush
    p1Deck: [
      { slot: 0, plantId: 'garlic', level: 1, statRolls: [] },
      { slot: 1, plantId: 'chomper', level: 1, statRolls: [] },
      { slot: 2, plantId: 'peashooter', level: 1, statRolls: [] },
      { slot: 3, plantId: 'bonkchoy', level: 1, statRolls: [] },
    ],
    botDeck: [
      { slot: 0, plantId: 'sunflower', level: 1, statRolls: [] },
      { slot: 1, plantId: 'iceberglettuce', level: 1, statRolls: [] },
      { slot: 2, plantId: 'garlic', level: 1, statRolls: [] },
      { slot: 3, plantId: 'wallnut', level: 1, statRolls: [] },
      { slot: 4, plantId: 'peashooter', level: 1, statRolls: [] },
      { slot: 5, plantId: 'chomper', level: 1, statRolls: [] },
    ],
  },
  2: {
    // 2: Economy / Late Game
    p1Deck: [
      { slot: 0, plantId: 'sunflower', level: 1, statRolls: [] },
      { slot: 1, plantId: 'twinsunflower', level: 2, statRolls: [] },
      { slot: 2, plantId: 'repeater', level: 2, statRolls: [] },
      { slot: 3, plantId: 'melonpult', level: 2, statRolls: [] },
    ],
    botDeck: [
      { slot: 0, plantId: 'sunflower', level: 1, statRolls: [] },
      { slot: 1, plantId: 'twinsunflower', level: 2, statRolls: [] },
      { slot: 2, plantId: 'melonpult', level: 2, statRolls: [] },
      { slot: 3, plantId: 'tallnut', level: 2, statRolls: [] },
      { slot: 4, plantId: 'repeater', level: 2, statRolls: [] },
      { slot: 5, plantId: 'jalapeno', level: 2, statRolls: [] },
    ],
  },
  3: {
    // 3: Heavy Defense
    p1Deck: [
      { slot: 0, plantId: 'wallnut', level: 1, statRolls: [] },
      { slot: 1, plantId: 'tallnut', level: 2, statRolls: [] },
      { slot: 2, plantId: 'peashooter', level: 1, statRolls: [] },
      { slot: 3, plantId: 'repeater', level: 2, statRolls: [] },
    ],
    botDeck: [
      { slot: 0, plantId: 'sunflower', level: 1, statRolls: [] },
      { slot: 1, plantId: 'wallnut', level: 1, statRolls: [] },
      { slot: 2, plantId: 'tallnut', level: 2, statRolls: [] },
      { slot: 3, plantId: 'aloe', level: 2, statRolls: [] },
      { slot: 4, plantId: 'repeater', level: 2, statRolls: [] },
      { slot: 5, plantId: 'peashooter', level: 1, statRolls: [] },
    ],
  },
  4: {
    // 4: Multi-Lane Pressure
    p1Deck: [
      { slot: 0, plantId: 'sunflower', level: 1, statRolls: [] },
      { slot: 1, plantId: 'peashooter', level: 1, statRolls: [] },
      { slot: 2, plantId: 'bonkchoy', level: 2, statRolls: [] },
      { slot: 3, plantId: 'chomper', level: 1, statRolls: [] },
    ],
    botDeck: [
      { slot: 0, plantId: 'sunflower', level: 1, statRolls: [] },
      { slot: 1, plantId: 'peashooter', level: 1, statRolls: [] },
      { slot: 2, plantId: 'threepeater', level: 2, statRolls: [] },
      { slot: 3, plantId: 'bonkchoy', level: 2, statRolls: [] },
      { slot: 4, plantId: 'wallnut', level: 1, statRolls: [] },
      { slot: 5, plantId: 'chomper', level: 1, statRolls: [] },
    ],
  },
  5: {
    // 5: Single-Lane Pressure
    p1Deck: [
      { slot: 0, plantId: 'wallnut', level: 1, statRolls: [] },
      { slot: 1, plantId: 'peashooter', level: 1, statRolls: [] },
      { slot: 2, plantId: 'repeater', level: 2, statRolls: [] },
      { slot: 3, plantId: 'chomper', level: 1, statRolls: [] },
    ],
    botDeck: [
      { slot: 0, plantId: 'sunflower', level: 1, statRolls: [] },
      { slot: 1, plantId: 'wallnut', level: 1, statRolls: [] },
      { slot: 2, plantId: 'repeater', level: 2, statRolls: [] },
      { slot: 3, plantId: 'bonkchoy', level: 2, statRolls: [] },
      { slot: 4, plantId: 'jalapeno', level: 2, statRolls: [] },
      { slot: 5, plantId: 'squash', level: 1, statRolls: [] },
    ],
  },
  6: {
    // 6: Sudden Lane Pivot
    p1Deck: [
      { slot: 0, plantId: 'peashooter', level: 1, statRolls: [] },
      { slot: 1, plantId: 'chomper', level: 1, statRolls: [] },
      { slot: 2, plantId: 'garlic', level: 1, statRolls: [] },
      { slot: 3, plantId: 'wallnut', level: 1, statRolls: [] },
    ],
    botDeck: [
      { slot: 0, plantId: 'sunflower', level: 1, statRolls: [] },
      { slot: 1, plantId: 'garlic', level: 1, statRolls: [] },
      { slot: 2, plantId: 'peashooter', level: 1, statRolls: [] },
      { slot: 3, plantId: 'chomper', level: 1, statRolls: [] },
      { slot: 4, plantId: 'iceberglettuce', level: 1, statRolls: [] },
      { slot: 5, plantId: 'wallnut', level: 1, statRolls: [] },
    ],
  },
  7: {
    // 7: Overdefensive Opponent
    p1Deck: [
      { slot: 0, plantId: 'wallnut', level: 1, statRolls: [] },
      { slot: 1, plantId: 'tallnut', level: 2, statRolls: [] },
      { slot: 2, plantId: 'iceberglettuce', level: 1, statRolls: [] },
      { slot: 3, plantId: 'sunflower', level: 1, statRolls: [] },
    ],
    botDeck: [
      { slot: 0, plantId: 'sunflower', level: 1, statRolls: [] },
      { slot: 1, plantId: 'chomper', level: 1, statRolls: [] },
      { slot: 2, plantId: 'bonkchoy', level: 2, statRolls: [] },
      { slot: 3, plantId: 'repeater', level: 2, statRolls: [] },
      { slot: 4, plantId: 'threepeater', level: 2, statRolls: [] },
      { slot: 5, plantId: 'jalapeno', level: 2, statRolls: [] },
    ],
  },
  8: {
    // 8: Hyper-Economic Opponent
    p1Deck: [
      { slot: 0, plantId: 'sunflower', level: 1, statRolls: [] },
      { slot: 1, plantId: 'twinsunflower', level: 2, statRolls: [] },
      { slot: 2, plantId: 'sunflower', level: 2, statRolls: [] },
      { slot: 3, plantId: 'peashooter', level: 1, statRolls: [] },
    ],
    botDeck: [
      { slot: 0, plantId: 'sunflower', level: 1, statRolls: [] },
      { slot: 1, plantId: 'garlic', level: 1, statRolls: [] },
      { slot: 2, plantId: 'chomper', level: 1, statRolls: [] },
      { slot: 3, plantId: 'bonkchoy', level: 2, statRolls: [] },
      { slot: 4, plantId: 'peashooter', level: 1, statRolls: [] },
      { slot: 5, plantId: 'wallnut', level: 1, statRolls: [] },
    ],
  },
  9: {
    // 9: Cheap Rush Deck
    p1Deck: [
      { slot: 0, plantId: 'garlic', level: 1, statRolls: [] },
      { slot: 1, plantId: 'iceberglettuce', level: 1, statRolls: [] },
      { slot: 2, plantId: 'chomper', level: 1, statRolls: [] },
      { slot: 3, plantId: 'peashooter', level: 1, statRolls: [] },
      { slot: 4, plantId: 'sunflower', level: 1, statRolls: [] },
    ],
    botDeck: [
      { slot: 0, plantId: 'sunflower', level: 1, statRolls: [] },
      { slot: 1, plantId: 'garlic', level: 1, statRolls: [] },
      { slot: 2, plantId: 'iceberglettuce', level: 1, statRolls: [] },
      { slot: 3, plantId: 'chomper', level: 1, statRolls: [] },
      { slot: 4, plantId: 'peashooter', level: 1, statRolls: [] },
      { slot: 5, plantId: 'wallnut', level: 1, statRolls: [] },
    ],
  },
  10: {
    // 10: Expensive Control Deck
    p1Deck: [
      { slot: 0, plantId: 'twinsunflower', level: 2, statRolls: [] },
      { slot: 1, plantId: 'tallnut', level: 2, statRolls: [] },
      { slot: 2, plantId: 'melonpult', level: 2, statRolls: [] },
      { slot: 3, plantId: 'threepeater', level: 2, statRolls: [] },
      { slot: 4, plantId: 'jalapeno', level: 2, statRolls: [] },
      { slot: 5, plantId: 'aloe', level: 2, statRolls: [] },
    ],
    botDeck: [
      { slot: 0, plantId: 'twinsunflower', level: 2, statRolls: [] },
      { slot: 1, plantId: 'tallnut', level: 2, statRolls: [] },
      { slot: 2, plantId: 'melonpult', level: 2, statRolls: [] },
      { slot: 3, plantId: 'threepeater', level: 2, statRolls: [] },
      { slot: 4, plantId: 'jalapeno', level: 2, statRolls: [] },
      { slot: 5, plantId: 'aloe', level: 2, statRolls: [] },
    ],
  },
  11: {
    // 11: Advanced-Tier Mixed Strategy
    p1Deck: [
      { slot: 0, plantId: 'twinsunflower', level: 2, statRolls: [] },
      { slot: 1, plantId: 'repeater', level: 2, statRolls: [] },
      { slot: 2, plantId: 'tallnut', level: 2, statRolls: [] },
      { slot: 3, plantId: 'bonkchoy', level: 2, statRolls: [] },
      { slot: 4, plantId: 'jalapeno', level: 2, statRolls: [] },
      { slot: 5, plantId: 'melonpult', level: 2, statRolls: [] },
    ],
    botDeck: [
      { slot: 0, plantId: 'twinsunflower', level: 2, statRolls: [] },
      { slot: 1, plantId: 'repeater', level: 2, statRolls: [] },
      { slot: 2, plantId: 'tallnut', level: 2, statRolls: [] },
      { slot: 3, plantId: 'bonkchoy', level: 2, statRolls: [] },
      { slot: 4, plantId: 'jalapeno', level: 2, statRolls: [] },
      { slot: 5, plantId: 'melonpult', level: 2, statRolls: [] },
    ],
  },
}

export const SCENARIO_NAMES: Record<number, string> = {
  0: 'AFK Opponent',
  1: 'Early Rush Attack',
  2: 'Economy into Late Game',
  3: 'Heavy Defense Wall',
  4: 'Multi-Lane Pressure',
  5: 'Single-Lane Concentration',
  6: 'Sudden Lane Pivot',
  7: 'Overdefensive Opponent',
  8: 'Hyper-Economic Opponent',
  9: 'Cheap Rush Deck',
  10: 'Expensive Control Deck',
  11: 'Advanced Mixed Tier',
}

interface SimulatedProducer {
  plantId: PlantId
  lane: number
  col: number
  plantedTick: number
  lastProduceTick: number
  intervalTicks: number
  value: number
}

/**
 * Generador DETERMINISTA y 100% LEGAL de secuencias de acciones de P1 según escenario.
 * Respeta rigurosamente: economía (soles del cielo + girasoles), cooldowns de cartas y casillas ocupadas.
 */
export function generarTimelineP1ParaEscenario(
  scenarioId: number,
  deck: CartaDeMazo[],
  maxTicks: number = msToTicks(120000)
): AccionP1Simulacion[] {
  if (scenarioId === 0 || deck.length === 0) {
    return [] // AFK
  }

  const actions: AccionP1Simulacion[] = []
  let seq = 0
  let p1Sun = 0 // Inicialmente 0 soles
  const slotCooldowns: Record<number, number> = {}
  const occupiedCells = new Set<string>() // 'lane,col'
  const activeProducers: SimulatedProducer[] = []

  // Plan de colocación objetivo según escenario
  interface PlannedStep {
    plantId: PlantId
    lane: number
    col?: number
    minTick?: number
  }

  const plannedSteps: PlannedStep[] = []

  switch (scenarioId) {
    case 1: // Early Rush: Garlic (50), Chomper (150), Bonkchoy (175), Peashooter (100)
      plannedSteps.push(
        { plantId: 'garlic', lane: 0, minTick: msToTicks(4000) },
        { plantId: 'chomper', lane: 1, minTick: msToTicks(12000) },
        { plantId: 'bonkchoy', lane: 0, minTick: msToTicks(20000) },
        { plantId: 'peashooter', lane: 1, col: 0, minTick: msToTicks(28000) },
        { plantId: 'garlic', lane: 2, minTick: msToTicks(36000) },
        { plantId: 'chomper', lane: 0, minTick: msToTicks(45000) }
      )
      break

    case 2: // Economy / Late: Sunflowers first, then Repeater / Melonpult
      plannedSteps.push(
        { plantId: 'sunflower', lane: 0, col: 0, minTick: msToTicks(4000) },
        { plantId: 'twinsunflower', lane: 1, col: 0, minTick: msToTicks(14000) },
        { plantId: 'sunflower', lane: 2, col: 0, minTick: msToTicks(24000) },
        { plantId: 'repeater', lane: 1, col: 1, minTick: msToTicks(36000) },
        { plantId: 'melonpult', lane: 0, col: 1, minTick: msToTicks(50000) },
        { plantId: 'melonpult', lane: 2, col: 1, minTick: msToTicks(68000) }
      )
      break

    case 3: // Heavy Defense: Wallnuts/Tallnuts in front, Peashooters behind
      plannedSteps.push(
        { plantId: 'wallnut', lane: 1, col: 3, minTick: msToTicks(4000) },
        { plantId: 'peashooter', lane: 1, col: 0, minTick: msToTicks(14000) },
        { plantId: 'tallnut', lane: 0, col: 3, minTick: msToTicks(22000) },
        { plantId: 'peashooter', lane: 0, col: 0, minTick: msToTicks(32000) },
        { plantId: 'tallnut', lane: 2, col: 3, minTick: msToTicks(44000) },
        { plantId: 'repeater', lane: 1, col: 1, minTick: msToTicks(58000) }
      )
      break

    case 4: // Multi-Lane Pressure: Spread attackers across 0, 1, 2
      plannedSteps.push(
        { plantId: 'sunflower', lane: 0, col: 0, minTick: msToTicks(4000) },
        { plantId: 'peashooter', lane: 0, col: 1, minTick: msToTicks(12000) },
        { plantId: 'chomper', lane: 1, minTick: msToTicks(22000) },
        { plantId: 'bonkchoy', lane: 2, minTick: msToTicks(34000) },
        { plantId: 'peashooter', lane: 2, col: 1, minTick: msToTicks(46000) },
        { plantId: 'chomper', lane: 0, minTick: msToTicks(58000) }
      )
      break

    case 5: // Single-Lane Concentration: Focus everything on lane 1
      plannedSteps.push(
        { plantId: 'wallnut', lane: 1, col: 3, minTick: msToTicks(4000) },
        { plantId: 'peashooter', lane: 1, col: 0, minTick: msToTicks(12000) },
        { plantId: 'repeater', lane: 1, col: 1, minTick: msToTicks(26000) },
        { plantId: 'chomper', lane: 1, minTick: msToTicks(40000) },
        { plantId: 'chomper', lane: 1, minTick: msToTicks(54000) }
      )
      break

    case 6: // Sudden Lane Pivot: Start on lane 0, pivot to lane 2
      plannedSteps.push(
        { plantId: 'peashooter', lane: 0, col: 1, minTick: msToTicks(10000) },
        { plantId: 'chomper', lane: 0, minTick: msToTicks(20000) },
        { plantId: 'garlic', lane: 2, minTick: msToTicks(30000) },
        { plantId: 'chomper', lane: 2, minTick: msToTicks(40000) },
        { plantId: 'peashooter', lane: 2, col: 1, minTick: msToTicks(52000) },
        { plantId: 'chomper', lane: 2, minTick: msToTicks(65000) }
      )
      break

    case 7: // Overdefensive Opponent: 4 walls, 1 sunflower, no real ranged damage
      plannedSteps.push(
        { plantId: 'sunflower', lane: 0, col: 0, minTick: msToTicks(4000) },
        { plantId: 'wallnut', lane: 1, col: 3, minTick: msToTicks(12000) },
        { plantId: 'tallnut', lane: 0, col: 3, minTick: msToTicks(22000) },
        { plantId: 'tallnut', lane: 2, col: 3, minTick: msToTicks(34000) },
        { plantId: 'wallnut', lane: 0, col: 2, minTick: msToTicks(46000) },
        { plantId: 'iceberglettuce', lane: 1, col: 2, minTick: msToTicks(50000) }
      )
      break

    case 8: // Hyper-Economic Opponent: 4 Sunflowers across lanes, 0 defense
      plannedSteps.push(
        { plantId: 'sunflower', lane: 0, col: 0, minTick: msToTicks(4000) },
        { plantId: 'twinsunflower', lane: 1, col: 0, minTick: msToTicks(12000) },
        { plantId: 'sunflower', lane: 2, col: 0, minTick: msToTicks(22000) },
        { plantId: 'sunflower', lane: 0, col: 1, minTick: msToTicks(32000) },
        { plantId: 'peashooter', lane: 1, col: 1, minTick: msToTicks(50000) }
      )
      break

    case 9: // Cheap Rush Deck: Low cost units
      plannedSteps.push(
        { plantId: 'iceberglettuce', lane: 0, col: 2, minTick: msToTicks(1000) },
        { plantId: 'garlic', lane: 0, minTick: msToTicks(4000) },
        { plantId: 'sunflower', lane: 1, col: 0, minTick: msToTicks(10000) },
        { plantId: 'peashooter', lane: 1, col: 1, minTick: msToTicks(18000) },
        { plantId: 'garlic', lane: 2, minTick: msToTicks(26000) },
        { plantId: 'chomper', lane: 0, minTick: msToTicks(36000) },
        { plantId: 'chomper', lane: 1, minTick: msToTicks(48000) }
      )
      break

    case 10: // Expensive Control Deck
      plannedSteps.push(
        { plantId: 'twinsunflower', lane: 0, col: 0, minTick: msToTicks(10000) },
        { plantId: 'tallnut', lane: 1, col: 3, minTick: msToTicks(24000) },
        { plantId: 'threepeater', lane: 1, col: 0, minTick: msToTicks(42000) },
        { plantId: 'jalapeno', lane: 1, col: 1, minTick: msToTicks(58000) },
        { plantId: 'melonpult', lane: 0, col: 1, minTick: msToTicks(75000) }
      )
      break

    case 11: // Advanced-Tier Mixed Strategy
      plannedSteps.push(
        { plantId: 'twinsunflower', lane: 0, col: 0, minTick: msToTicks(10000) },
        { plantId: 'tallnut', lane: 1, col: 3, minTick: msToTicks(22000) },
        { plantId: 'repeater', lane: 1, col: 0, minTick: msToTicks(36000) },
        { plantId: 'bonkchoy', lane: 2, minTick: msToTicks(50000) },
        { plantId: 'melonpult', lane: 0, col: 1, minTick: msToTicks(68000) },
        { plantId: 'jalapeno', lane: 2, col: 1, minTick: msToTicks(82000) }
      )
      break

    default:
      break
  }

  let stepIndex = 0

  // Bucle de simulación tick a tick
  for (let tick = 0; tick <= maxTicks; tick++) {
    // 1. Acreditación de sol del cielo (cada 6s a partir de 2.5s iniciales)
    const primerSolTick = -msToTicks(3500) + msToTicks(SOL_DEL_CIELO_MS)
    if (tick >= primerSolTick && (tick - primerSolTick) % msToTicks(SOL_DEL_CIELO_MS) === 0) {
      p1Sun += SUN_VALUE
    }

    // 2. Acreditación de productores propios de P1
    for (const prod of activeProducers) {
      if (tick > prod.plantedTick && tick - prod.lastProduceTick >= prod.intervalTicks) {
        prod.lastProduceTick = tick
        p1Sun += prod.value
      }
    }

    // 3. Ejecutar siguiente paso planeado si se cumplen condiciones
    if (stepIndex < plannedSteps.length) {
      const step = plannedSteps[stepIndex]
      const minTick = step.minTick ?? 0

      if (tick >= minTick) {
        const cartaSlot = deck.findIndex((c) => c.plantId === step.plantId)
        if (cartaSlot >= 0) {
          const carta = deck[cartaSlot]
          const slot = carta.slot ?? cartaSlot
          const config = getScaledPlantConfig(step.plantId)

          if (config && p1Sun >= config.cost && (slotCooldowns[slot] || 0) <= tick) {
            const camina = config.category === 'melee' || !!config.moveSpeed || step.plantId === 'chomper'
            let colFinal = step.col

            if (!camina) {
              if (colFinal === undefined) colFinal = 0
              // Buscar casilla libre en el carril
              let encontrada = false
              for (let c = colFinal; c < P1_COLUMNS; c++) {
                if (!occupiedCells.has(`${step.lane},${c}`)) {
                  colFinal = c
                  encontrada = true
                  break
                }
              }
              if (!encontrada) {
                for (let c = 0; c < P1_COLUMNS; c++) {
                  if (!occupiedCells.has(`${step.lane},${c}`)) {
                    colFinal = c
                    encontrada = true
                    break
                  }
                }
              }
              if (!encontrada) {
                // No hay casilla libre en este carril, saltar paso
                stepIndex++
                continue
              }
            }

            // Ejecutar colocación legal
            p1Sun -= config.cost
            slotCooldowns[slot] = tick + msToTicks(config.cooldownMs)
            if (!camina && colFinal !== undefined) {
              occupiedCells.add(`${step.lane},${colFinal}`)
            }

            actions.push({
              seq: ++seq,
              tick: tick + MARGEN_DE_RED_TICS,
              issuedTick: tick,
              kind: 'plant',
              plantId: step.plantId,
              slot,
              lane: step.lane,
              col: camina ? undefined : colFinal,
            })

            // Si es productor, registrar para generación periódica
            if (step.plantId === 'sunflower' || step.plantId === 'twinsunflower') {
              const esDoble = step.plantId === 'twinsunflower'
              activeProducers.push({
                plantId: step.plantId,
                lane: step.lane,
                col: colFinal ?? 0,
                plantedTick: tick,
                lastProduceTick: tick,
                intervalTicks: msToTicks(esDoble ? GIRASOL_DOBLE_MS : GIRASOL_MS),
                value: (esDoble ? SOLES_POR_CICLO_GIRASOL_DOBLE : SOLES_POR_CICLO_GIRASOL) * SUN_VALUE,
              })
            }

            stepIndex++
          }
        } else {
          // Carta no existe en mazo, avanzar
          stepIndex++
        }
      }
    }
  }

  return actions
}
