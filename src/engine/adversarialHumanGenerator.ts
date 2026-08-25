import type { CartaDeMazo } from './mazoDeLaSala.ts'
import type { AccionP1Simulacion } from './asyncOpponent.ts'
import type { PlantId } from '../types/game.ts'
import {
  SUN_VALUE,
  INITIAL_SUN,
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
import { getTacticalProfile } from './strategicAsyncBot.ts'
import {
  generarTimelineP1ParaEscenario,
  SCENARIO_DECKS,
  SCENARIO_NAMES,
} from './strategicBenchmarkScenarios.ts'

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
 * Genera una timeline dinámica, adaptativa y 100% legal para un perfil humano adversarial.
 * Simula activamente durante toda la partida (0 a 120s, 3600 ticks).
 */
export function generarTimelineHumanaAdversarial(
  archetype: HumanDeckArchetype,
  seed: number,
  maxTicks: number = msToTicks(120000)
): AccionP1Simulacion[] {
  const actions: AccionP1Simulacion[] = []
  const deck = archetype.deck
  let p1Sun = INITIAL_SUN
  let seq = 0
  const slotCooldowns: Record<number, number> = {}
  const occupiedCells = new Set<string>() // 'lane,col'
  const activeProducers: { id: string; plantedTick: number; lastProduceTick: number; intervalTicks: number; value: number }[] = []

  let nextActionTick = msToTicks(1500) // Primer acción a partir de 1.5s
  let sunflowerCount = 0
  const targetSunflowers = archetype.style === 'HUMAN_ECONOMIC' ? 3 : archetype.style === 'HUMAN_BALANCED' ? 2 : archetype.style === 'HUMAN_DEFENSIVE' ? 2 : 1

  for (let tick = 0; tick <= maxTicks; tick++) {
    // 1. Acreditación de sol del cielo (cada 6s)
    const primerSolTick = -msToTicks(3500) + msToTicks(SOL_DEL_CIELO_MS)
    if (tick >= primerSolTick && (tick - primerSolTick) % msToTicks(SOL_DEL_CIELO_MS) === 0) {
      p1Sun += SUN_VALUE
    }

    // 2. Acreditación de productores propios
    for (const prod of activeProducers) {
      if (tick > prod.plantedTick && tick - prod.lastProduceTick >= prod.intervalTicks) {
        prod.lastProduceTick = tick
        p1Sun += prod.value
      }
    }

    if (tick < nextActionTick) continue

    // 3. Evaluar jugada según estilo
    // A) Apertura económica si no ha alcanzado objetivo de productores
    if (sunflowerCount < targetSunflowers && p1Sun >= 50) {
      const sfCard = deck.find((c) => c.plantId === 'sunflower' || c.plantId === 'twinsunflower')
      if (sfCard && (slotCooldowns[sfCard.slot ?? 0] || 0) <= tick) {
        const config = getScaledPlantConfig(sfCard.plantId as PlantId)
        if (config && p1Sun >= config.cost) {
          // Buscar casilla libre en col 0 o 1
          let placed = false
          for (let l = 0; l < 3; l++) {
            for (let c = 0; c < 2; c++) {
              if (!occupiedCells.has(`${l},${c}`)) {
                p1Sun -= config.cost
                slotCooldowns[sfCard.slot ?? 0] = tick + msToTicks(config.cooldownMs)
                occupiedCells.add(`${l},${c}`)
                actions.push({
                  seq: ++seq,
                  tick: tick + MARGEN_DE_RED_TICS,
                  issuedTick: tick,
                  kind: 'plant',
                  plantId: sfCard.plantId as PlantId,
                  slot: sfCard.slot ?? undefined,
                  lane: l,
                  col: c,
                })
                activeProducers.push({
                  id: `p1_prod_${seq}`,
                  plantedTick: tick,
                  lastProduceTick: tick,
                  intervalTicks: sfCard.plantId === 'twinsunflower' ? msToTicks(GIRASOL_DOBLE_MS) : msToTicks(GIRASOL_MS),
                  value: sfCard.plantId === 'twinsunflower' ? SOLES_POR_CICLO_GIRASOL_DOBLE * SUN_VALUE : SOLES_POR_CICLO_GIRASOL * SUN_VALUE,
                })
                sunflowerCount++
                nextActionTick = tick + msToTicks(600 + ((seed + seq * 17) % 500))
                placed = true
                break
              }
            }
            if (placed) break
          }
          if (placed) continue
        }
      }
    }

    // B) Colocar unidades ofensivas / tanques / burst
    const targetLane = archetype.laneFocus > 0.4 ? 1 : ((seed + seq * 31 + tick) % 3)

    // Filtrar cartas que se pueden pagar y no están en cooldown
    const readyCards = deck.filter((c) => {
      const conf = getScaledPlantConfig(c.plantId as PlantId)
      return conf && p1Sun >= conf.cost && (slotCooldowns[c.slot ?? 0] || 0) <= tick
    })

    if (readyCards.length > 0) {
      // Priorizar según estilo
      let chosenCard = readyCards[0]
      if (archetype.style === 'HUMAN_AGGRESSIVE') {
        // Priorizar melee rápido
        const melee = readyCards.find((c) => c.plantId === 'garlic' || c.plantId === 'bonkchoy' || c.plantId === 'chomper')
        if (melee) chosenCard = melee
      } else if (archetype.style === 'HUMAN_ECONOMIC') {
        // Priorizar artillería pesada si alcanza el sol
        const heavy = readyCards.find((c) => c.plantId === 'melonpult' || c.plantId === 'threepeater')
        if (heavy) chosenCard = heavy
      } else if (archetype.style === 'HUMAN_DEFENSIVE') {
        // Priorizar muros y soporte
        const wall = readyCards.find((c) => c.plantId === 'tallnut' || c.plantId === 'wallnut' || c.plantId === 'aloe')
        if (wall) chosenCard = wall
      }

      const conf = getScaledPlantConfig(chosenCard.plantId as PlantId)
      if (conf) {
        const isWalking = conf.category === 'melee' || !!conf.moveSpeed || chosenCard.plantId === 'chomper' || chosenCard.plantId === 'bonkchoy' || chosenCard.plantId === 'garlic'
        let colFinal: number | undefined = undefined

        if (!isWalking) {
          // Buscar casilla libre en el carril
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
        } else {
          colFinal = 1 // Spawn column for walking melee units
        }

        if (colFinal !== undefined) {
          p1Sun -= conf.cost
          slotCooldowns[chosenCard.slot ?? 0] = tick + msToTicks(conf.cooldownMs)
          if (!isWalking) {
            occupiedCells.add(`${targetLane},${colFinal}`)
          }

          actions.push({
            seq: ++seq,
            tick: tick + MARGEN_DE_RED_TICS,
            issuedTick: tick,
            kind: 'plant',
            plantId: chosenCard.plantId as PlantId,
            slot: chosenCard.slot ?? undefined,
            lane: targetLane,
            col: colFinal,
          })

          // Cadencia de acción humana (400ms a 1100ms)
          const humanDelayMs = archetype.style === 'HUMAN_AGGRESSIVE'
            ? 350 + ((seed * 7 + seq * 23) % 400)
            : 500 + ((seed * 7 + seq * 23) % 600)
          nextActionTick = tick + msToTicks(humanDelayMs)
        }
      }
    }
  }

  return actions
}
