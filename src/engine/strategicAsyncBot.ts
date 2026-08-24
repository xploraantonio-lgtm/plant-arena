// ─────────────────────────────────────────────────────────────────────────────
// RIVAL ESTRATÉGICO V1 — UTILITY AI DETERMINISTA (ASYNC OPPONENT)
//
// Módulo PURO y determinista para toma de decisiones tácticas en tiempo real.
// Evalúa el estado del tablero (economía, defensa, ataque, carriles, HP de bases,
// proximidad de amenazas y sinergias) para generar acciones óptimas.
//
// REGLAS ESTRICTAS:
//   · Sin React, sin DOM, sin Supabase.
//   · Sin Date.now(), sin performance.now(), sin Math.random().
//   · Sin API externa ni modelos probabilísticos no reproducibles.
//   · PRNG 100% determinista y aislado del flujo de combate (state.rng).
//   · Fail-closed y completamente serializable para replay y verify-match.
// ─────────────────────────────────────────────────────────────────────────────

import { createRng, nextFloat, chance, type Rng } from './rng.ts'
import { msToTicks } from './time.ts'
import type { GameState } from './simulate.ts'
import type { CartaDeMazo } from './mazoDeLaSala.ts'
import type { PlantId, PlantStatKey } from '../types/game.ts'
import {
  TOTAL_COLUMNS,
  P1_COLUMNS,
  INITIAL_BASE_HP,
  BASE_LEFT_END_X,
  BASE_RIGHT_START_X,
  getScaledPlantConfig,
} from '../utils/gameConstants.ts'

const ESTADISTICAS_VALIDAS = new Set<PlantStatKey>([
  'hp',
  'damage',
  'attackSpeed',
  'moveSpeed',
  'cooldown',
])

function rollsValidos(brutos: string[] | null | undefined): PlantStatKey[] {
  return (brutos ?? []).filter((r): r is PlantStatKey =>
    ESTADISTICAS_VALIDAS.has(r as PlantStatKey)
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. CLASIFICACIÓN DE LAS 15 CARTAS
// ─────────────────────────────────────────────────────────────────────────────

export type PlantRole =
  | 'economy'
  | 'ranged_attack'
  | 'defense'
  | 'melee'
  | 'burst'
  | 'utility'
  | 'special'

export interface PlantTacticalProfile {
  id: PlantId
  role: PlantRole
  isProducer: boolean
  isWalking: boolean
  isTank: boolean
  isInstant: boolean
  isLaneClear: boolean
  isFreezer: boolean
  isHealer: boolean
  isTrap: boolean
  preferredCols: [number, number] // [minColLocal, maxColLocal] (0 = más cerca de base P2, 5 = frente)
  baseWeight: number
}

export const PLANT_TACTICAL_PROFILES: Record<PlantId, PlantTacticalProfile> = {
  sunflower: {
    id: 'sunflower',
    role: 'economy',
    isProducer: true,
    isWalking: false,
    isTank: false,
    isInstant: false,
    isLaneClear: false,
    isFreezer: false,
    isHealer: false,
    isTrap: false,
    preferredCols: [0, 1],
    baseWeight: 1.0,
  },
  twinsunflower: {
    id: 'twinsunflower',
    role: 'economy',
    isProducer: true,
    isWalking: false,
    isTank: false,
    isInstant: false,
    isLaneClear: false,
    isFreezer: false,
    isHealer: false,
    isTrap: false,
    preferredCols: [0, 1],
    baseWeight: 1.1,
  },
  peashooter: {
    id: 'peashooter',
    role: 'ranged_attack',
    isProducer: false,
    isWalking: false,
    isTank: false,
    isInstant: false,
    isLaneClear: false,
    isFreezer: false,
    isHealer: false,
    isTrap: false,
    preferredCols: [1, 3],
    baseWeight: 1.0,
  },
  repeater: {
    id: 'repeater',
    role: 'ranged_attack',
    isProducer: false,
    isWalking: false,
    isTank: false,
    isInstant: false,
    isLaneClear: false,
    isFreezer: false,
    isHealer: false,
    isTrap: false,
    preferredCols: [1, 3],
    baseWeight: 1.15,
  },
  threepeater: {
    id: 'threepeater',
    role: 'ranged_attack',
    isProducer: false,
    isWalking: false,
    isTank: false,
    isInstant: false,
    isLaneClear: false,
    isFreezer: false,
    isHealer: false,
    isTrap: false,
    preferredCols: [1, 2],
    baseWeight: 1.2,
  },
  melonpult: {
    id: 'melonpult',
    role: 'ranged_attack',
    isProducer: false,
    isWalking: false,
    isTank: false,
    isInstant: false,
    isLaneClear: false,
    isFreezer: false,
    isHealer: false,
    isTrap: false,
    preferredCols: [0, 2],
    baseWeight: 1.25,
  },
  wallnut: {
    id: 'wallnut',
    role: 'defense',
    isProducer: false,
    isWalking: false,
    isTank: true,
    isInstant: false,
    isLaneClear: false,
    isFreezer: false,
    isHealer: false,
    isTrap: false,
    preferredCols: [3, 5],
    baseWeight: 1.0,
  },
  tallnut: {
    id: 'tallnut',
    role: 'defense',
    isProducer: false,
    isWalking: false,
    isTank: true,
    isInstant: false,
    isLaneClear: false,
    isFreezer: false,
    isHealer: false,
    isTrap: false,
    preferredCols: [3, 5],
    baseWeight: 1.15,
  },
  squash: {
    id: 'squash', // Potato mine
    role: 'defense',
    isProducer: false,
    isWalking: false,
    isTank: false,
    isInstant: false,
    isLaneClear: false,
    isFreezer: false,
    isHealer: false,
    isTrap: true,
    preferredCols: [2, 4],
    baseWeight: 1.05,
  },
  jalapeno: {
    id: 'jalapeno',
    role: 'burst',
    isProducer: false,
    isWalking: false,
    isTank: false,
    isInstant: true,
    isLaneClear: true,
    isFreezer: false,
    isHealer: false,
    isTrap: false,
    preferredCols: [0, 5],
    baseWeight: 1.2,
  },
  iceberglettuce: {
    id: 'iceberglettuce',
    role: 'utility',
    isProducer: false,
    isWalking: false,
    isTank: false,
    isInstant: true,
    isLaneClear: false,
    isFreezer: true,
    isHealer: false,
    isTrap: false,
    preferredCols: [0, 5],
    baseWeight: 1.1,
  },
  aloe: {
    id: 'aloe',
    role: 'utility',
    isProducer: false,
    isWalking: false,
    isTank: false,
    isInstant: false,
    isLaneClear: false,
    isFreezer: false,
    isHealer: true,
    isTrap: false,
    preferredCols: [1, 3],
    baseWeight: 1.05,
  },
  chomper: {
    id: 'chomper', // Cactus atacante que camina
    role: 'melee',
    isProducer: false,
    isWalking: true,
    isTank: false,
    isInstant: false,
    isLaneClear: false,
    isFreezer: false,
    isHealer: false,
    isTrap: false,
    preferredCols: [0, 0],
    baseWeight: 1.0,
  },
  bonkchoy: {
    id: 'bonkchoy',
    role: 'melee',
    isProducer: false,
    isWalking: true,
    isTank: false,
    isInstant: false,
    isLaneClear: false,
    isFreezer: false,
    isHealer: false,
    isTrap: false,
    preferredCols: [0, 0],
    baseWeight: 1.1,
  },
  garlic: {
    id: 'garlic', // Squash aplastador
    role: 'melee',
    isProducer: false,
    isWalking: true,
    isTank: false,
    isInstant: false,
    isLaneClear: false,
    isFreezer: false,
    isHealer: false,
    isTrap: false,
    preferredCols: [0, 0],
    baseWeight: 1.15,
  },
}

export function getTacticalProfile(plantId: PlantId): PlantTacticalProfile {
  return PLANT_TACTICAL_PROFILES[plantId] ?? {
    id: plantId,
    role: 'special',
    isProducer: false,
    isWalking: false,
    isTank: false,
    isInstant: false,
    isLaneClear: false,
    isFreezer: false,
    isHealer: false,
    isTrap: false,
    preferredCols: [1, 3],
    baseWeight: 1.0,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. PERCEPCIÓN DEL TABLERO
// ─────────────────────────────────────────────────────────────────────────────

export interface LaneEvaluation {
  lane: number
  enemyPressure: number
  ownPressure: number
  enemyAttackersCount: number
  enemyDefendersCount: number
  ownAttackersCount: number
  ownDefendersCount: number
  ownProducersCount: number
  availableSpace: number // Casillas estáticas vacías para P2 (0..5)
  proximityEnemyToBase: number // 0..1 (1 = en la puerta de P2)
  proximityOwnToEnemyBase: number // 0..1 (1 = en la puerta de P1)
  enemyDpsPotential: number
  ownDpsPotential: number
  enemyHpTotal: number
  ownHpTotal: number
  threatScore: number // 0..100
  attackOpportunityScore: number // 0..100
}

export type StrategicMode =
  | 'ECONOMY'
  | 'ATTACK'
  | 'DEFEND'
  | 'EMERGENCY_DEFEND'
  | 'PRESSURE'
  | 'RECOVER'

export interface StrategicPerception {
  tick: number
  sunBank: number
  ownBaseHp: number
  enemyBaseHp: number
  lanes: [LaneEvaluation, LaneEvaluation, LaneEvaluation]
  maxThreatLane: number
  maxThreat: number
  maxOpportunityLane: number
  maxOpportunity: number
  totalOwnProducers: number
  mode: StrategicMode
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. ESTILOS Y PERFILES ESTRATÉGICOS
// ─────────────────────────────────────────────────────────────────────────────

export type StrategicStyle =
  | 'balanced'
  | 'aggressive'
  | 'defensive'
  | 'economic'
  | 'opportunistic'

export interface StrategicProfile {
  style: StrategicStyle
  aggression: number // 0..1
  defense: number // 0..1
  economy: number // 0..1
  opportunism: number // 0..1
  reactionMs: number // Tiempo de reacción en ms
  baseReserveSun: number // Soles mínimos a reservar
  irregularity: number // Variación de cadencia
  badPlayMargin: number // Margen para selección estocástica no perfecta
  targetProducers: number // Número deseado de girasoles
  maxProducers: number // Límite estricto de girasoles
}

export const STRATEGIC_PROFILES: Record<StrategicStyle, StrategicProfile> = {
  balanced: {
    style: 'balanced',
    aggression: 0.55,
    defense: 0.6,
    economy: 0.55,
    opportunism: 0.55,
    reactionMs: 600,
    baseReserveSun: 50,
    irregularity: 0.4,
    badPlayMargin: 0.08,
    targetProducers: 2,
    maxProducers: 3,
  },
  aggressive: {
    style: 'aggressive',
    aggression: 0.9,
    defense: 0.35,
    economy: 0.35,
    opportunism: 0.8,
    reactionMs: 500,
    baseReserveSun: 25,
    irregularity: 0.35,
    badPlayMargin: 0.05,
    targetProducers: 1,
    maxProducers: 2,
  },
  defensive: {
    style: 'defensive',
    aggression: 0.3,
    defense: 0.9,
    economy: 0.65,
    opportunism: 0.35,
    reactionMs: 600,
    baseReserveSun: 75,
    irregularity: 0.4,
    badPlayMargin: 0.05,
    targetProducers: 3,
    maxProducers: 4,
  },
  economic: {
    style: 'economic',
    aggression: 0.35,
    defense: 0.55,
    economy: 0.95,
    opportunism: 0.4,
    reactionMs: 700,
    baseReserveSun: 50,
    irregularity: 0.45,
    badPlayMargin: 0.08,
    targetProducers: 3,
    maxProducers: 5,
  },
  opportunistic: {
    style: 'opportunistic',
    aggression: 0.75,
    defense: 0.45,
    economy: 0.45,
    opportunism: 0.95,
    reactionMs: 550,
    baseReserveSun: 35,
    irregularity: 0.4,
    badPlayMargin: 0.06,
    targetProducers: 2,
    maxProducers: 3,
  },
}

export function obtenerPerfilEstrategico(style: StrategicStyle = 'balanced'): StrategicProfile {
  return STRATEGIC_PROFILES[style] ?? STRATEGIC_PROFILES.balanced
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. ESTADO MENTAL SERIALIZABLE DEL BOT
// ─────────────────────────────────────────────────────────────────────────────

export interface CandidateAction {
  kind: 'plant' | 'dig' | 'wait'
  plantId?: PlantId
  slot?: number
  lane?: number
  col?: number
  utility: number
  breakdown?: {
    defense: number
    attack: number
    economy: number
    synergy: number
    costRiskPenalty: number
    overinvestmentPenalty: number
  }
  reason?: string
}

export interface StrategicTelemetryEntry {
  tick: number
  mode: StrategicMode
  chosenAction: CandidateAction
  score: number
  topCandidates: Array<{
    kind: string
    plantId?: PlantId
    lane?: number
    col?: number
    utility: number
  }>
  laneThreats: [number, number, number]
  laneOpportunities: [number, number, number]
  sunBank: number
}

export interface StrategicMentalState {
  rng: Rng
  profile: StrategicProfile
  lastLookTick: number
  lastDecisionTick: number
  nextDecisionTick: number
  consecutiveWaits: number
  lastPerception: StrategicPerception | null
}

export function crearEstadoMentalEstrategico(
  seed: number,
  profile: StrategicProfile
): StrategicMentalState {
  // PRNG aislado para el bot, nunca usa ni altera state.rng
  const botRng = createRng((seed ^ 0x5a5a5a5a) >>> 0)
  return {
    rng: botRng,
    profile,
    lastLookTick: -9999,
    lastDecisionTick: -9999,
    nextDecisionTick: 0,
    consecutiveWaits: 0,
    lastPerception: null,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. CÁLCULO DE PERCEPCIÓN Y EVALUACIÓN DE CARRILES
// ─────────────────────────────────────────────────────────────────────────────

const FIELD_TOTAL_WIDTH = BASE_RIGHT_START_X - BASE_LEFT_END_X // 70%

/**
 * Evalúa las métricas puras y el score de amenaza/oportunidad de un carril específico.
 */
export function evaluarCarril(
  state: GameState,
  lane: number,
  sunBank: number,
  profile: StrategicProfile
): LaneEvaluation {
  let enemyAttackersCount = 0
  let enemyDefendersCount = 0
  let ownAttackersCount = 0
  let ownDefendersCount = 0
  let ownProducersCount = 0
  let enemyDpsPotential = 0
  let ownDpsPotential = 0
  let enemyHpTotal = 0
  let ownHpTotal = 0
  let minEnemyDistToBase = 1.0 // 1.0 = lejos (en base P1), 0.0 = encima de la base P2
  let minOwnDistToEnemyBase = 1.0 // 1.0 = lejos (en base P2), 0.0 = encima de la base P1

  // 1. Analizar plantas enemigas (P1 = state.plants)
  for (const p of state.plants) {
    if (p.lane !== lane) continue
    enemyHpTotal += p.hp

    const t = getTacticalProfile(p.plantId)
    if (t.isTank || p.hp > 800) {
      enemyDefendersCount += 1
    }

    if (t.isWalking || p.isWalking) {
      enemyAttackersCount += 1
      // Distancia hacia la base derecha P2 (BASE_RIGHT_START_X = 85%)
      const dist = Math.max(0, (BASE_RIGHT_START_X - p.x) / FIELD_TOTAL_WIDTH)
      if (dist < minEnemyDistToBase) {
        minEnemyDistToBase = dist
      }
      const dps = p.damage && p.attackSpeedMs ? (p.damage / (p.attackSpeedMs / 1000)) : (p.damage || 20)
      enemyDpsPotential += dps
    } else if (t.role === 'ranged_attack') {
      enemyAttackersCount += 1
      const dps = p.damage && p.attackSpeedMs ? (p.damage / (p.attackSpeedMs / 1000)) : 20
      enemyDpsPotential += dps
    }
  }

  // 2. Analizar plantas propias (P2 = state.enemyPlants)
  const occupiedLocalCols = new Set<number>()
  for (const p of state.enemyPlants) {
    if (p.lane !== lane) continue
    ownHpTotal += p.hp

    const plantId = (p.plantId ?? 'peashooter') as PlantId
    const t = getTacticalProfile(plantId)

    if (t.isProducer) {
      ownProducersCount += 1
    }
    if (t.isTank || p.hp > 800) {
      ownDefendersCount += 1
    }

    if (p.col !== undefined) {
      // p.col está en coordenadas absolutas del campo (0..11).
      // Columna local P2 = TOTAL_COLUMNS - 1 - p.col
      const colLocal = TOTAL_COLUMNS - 1 - p.col
      if (colLocal >= 0 && colLocal < P1_COLUMNS) {
        occupiedLocalCols.add(colLocal)
      }
    }

    if (t.isWalking || p.isWalking) {
      ownAttackersCount += 1
      // Distancia hacia la base izquierda P1 (BASE_LEFT_END_X = 15%)
      const dist = Math.max(0, (p.x - BASE_LEFT_END_X) / FIELD_TOTAL_WIDTH)
      if (dist < minOwnDistToEnemyBase) {
        minOwnDistToEnemyBase = dist
      }
      const dps = p.damage && p.attackSpeedMs ? (p.damage / (p.attackSpeedMs / 1000)) : (p.damage || 20)
      ownDpsPotential += dps
    } else if (t.role === 'ranged_attack') {
      ownAttackersCount += 1
      const dps = p.damage && p.attackSpeedMs ? (p.damage / (p.attackSpeedMs / 1000)) : 20
      ownDpsPotential += dps
    }
  }

  const availableSpace = Math.max(0, P1_COLUMNS - occupiedLocalCols.size)
  const proximityEnemyToBase = enemyAttackersCount > 0 ? Math.max(0, 1 - minEnemyDistToBase) : 0
  const proximityOwnToEnemyBase = ownAttackersCount > 0 ? Math.max(0, 1 - minOwnDistToEnemyBase) : 0

  // 3. Presión
  const enemyPressure = Math.min(100, enemyAttackersCount * 25 + enemyDpsPotential * 0.8 + proximityEnemyToBase * 40)
  const ownPressure = Math.min(100, ownAttackersCount * 25 + ownDpsPotential * 0.8 + proximityOwnToEnemyBase * 40)

  // 4. Score de Amenaza (0..100)
  const threatScore = evaluarAmenazaCarril({
    enemyAttackersCount,
    enemyDpsPotential,
    proximityEnemyToBase,
    ownDefendersCount,
    ownHpTotal,
    ownDpsPotential,
    ownBaseHp: state.p2BaseHp,
  })

  // 5. Score de Oportunidad de Ataque (0..100)
  const attackOpportunityScore = evaluarOportunidadAtaque({
    enemyDefendersCount,
    enemyHpTotal,
    ownPressure,
    enemyBaseHp: state.p1BaseHp,
    sunBank,
    threatScore,
    availableSpace,
    profile,
  })

  return {
    lane,
    enemyPressure,
    ownPressure,
    enemyAttackersCount,
    enemyDefendersCount,
    ownAttackersCount,
    ownDefendersCount,
    ownProducersCount,
    availableSpace,
    proximityEnemyToBase,
    proximityOwnToEnemyBase,
    enemyDpsPotential,
    ownDpsPotential,
    enemyHpTotal,
    ownHpTotal,
    threatScore,
    attackOpportunityScore,
  }
}

/**
 * Fórmula pura de Amenaza por Carril.
 * threat = (atacantes * peso + DPS * peso + cercanía * peso + dañoBase) - (defensaPropia + DPSdefensivo)
 */
export function evaluarAmenazaCarril(params: {
  enemyAttackersCount: number
  enemyDpsPotential: number
  proximityEnemyToBase: number
  ownDefendersCount: number
  ownHpTotal: number
  ownDpsPotential: number
  ownBaseHp: number
}): number {
  const {
    enemyAttackersCount,
    enemyDpsPotential,
    proximityEnemyToBase,
    ownDefendersCount,
    ownHpTotal,
    ownDpsPotential,
    ownBaseHp,
  } = params

  if (enemyAttackersCount === 0 && enemyDpsPotential === 0) {
    return 0
  }

  const baseHpDeficit = Math.max(0, 1 - ownBaseHp / INITIAL_BASE_HP)
  const rawThreat =
    enemyAttackersCount * 22 +
    enemyDpsPotential * 0.7 +
    proximityEnemyToBase * 45 +
    baseHpDeficit * 20

  const ownMitigation =
    ownDefendersCount * 18 +
    (ownHpTotal > 0 ? Math.min(30, ownHpTotal / 50) : 0) +
    ownDpsPotential * 0.45

  const score = Math.max(0, Math.min(100, Math.round(rawThreat - ownMitigation)))
  return score
}

/**
 * Fórmula pura de Oportunidad de Ataque por Carril.
 */
export function evaluarOportunidadAtaque(params: {
  enemyDefendersCount: number
  enemyHpTotal: number
  ownPressure: number
  enemyBaseHp: number
  sunBank: number
  threatScore: number
  availableSpace: number
  profile: StrategicProfile
}): number {
  const {
    enemyDefendersCount,
    enemyHpTotal,
    ownPressure,
    enemyBaseHp,
    sunBank,
    threatScore,
    availableSpace,
    profile,
  } = params

  // Si no hay espacio para nada y no es atacante melee, oportunidad baja
  const spaceScore = availableSpace > 0 ? 20 : 5
  const enemyDefensePenalty = enemyDefendersCount * 20 + Math.min(30, enemyHpTotal / 60)
  const enemyBaseWeakness = Math.max(0, 1 - enemyBaseHp / INITIAL_BASE_HP) * 35
  const economySurplus = Math.min(30, (sunBank / 200) * 30)
  const threatPenalty = threatScore * 0.35

  const baseOpportunity =
    spaceScore +
    (40 - enemyDefensePenalty) +
    ownPressure * 0.3 +
    enemyBaseWeakness +
    economySurplus -
    threatPenalty

  const scaled = baseOpportunity * (0.6 + profile.opportunism * 0.8)
  return Math.max(0, Math.min(100, Math.round(scaled)))
}

/**
 * Genera el snapshot completo de percepción del tablero.
 */
export function percibirTablero(
  state: GameState,
  sunBank: number,
  profile: StrategicProfile
): StrategicPerception {
  const lane0 = evaluarCarril(state, 0, sunBank, profile)
  const lane1 = evaluarCarril(state, 1, sunBank, profile)
  const lane2 = evaluarCarril(state, 2, sunBank, profile)
  const lanes: [LaneEvaluation, LaneEvaluation, LaneEvaluation] = [lane0, lane1, lane2]

  let maxThreat = -1
  let maxThreatLane = 0
  let maxOpportunity = -1
  let maxOpportunityLane = 0
  let totalOwnProducers = 0

  for (let l = 0; l < 3; l++) {
    if (lanes[l].threatScore > maxThreat) {
      maxThreat = lanes[l].threatScore
      maxThreatLane = l
    }
    if (lanes[l].attackOpportunityScore > maxOpportunity) {
      maxOpportunity = lanes[l].attackOpportunityScore
      maxOpportunityLane = l
    }
    totalOwnProducers += lanes[l].ownProducersCount
  }

  // Clasificación del Modo Estratégico Global Centralizado
  let mode: StrategicMode
  const ownHpRatio = state.p2BaseHp / INITIAL_BASE_HP
  const enemyHpRatio = state.p1BaseHp / INITIAL_BASE_HP

  if (maxThreat >= 75 || (ownHpRatio < 0.35 && maxThreat >= 45)) {
    mode = 'EMERGENCY_DEFEND'
  } else if (maxThreat >= 50) {
    mode = 'DEFEND'
  } else if (enemyHpRatio <= 0.35 || (maxOpportunity >= 65 && sunBank >= 125)) {
    mode = 'PRESSURE'
  } else if (totalOwnProducers < profile.targetProducers && maxThreat < 35 && state.tick < msToTicks(75000)) {
    mode = 'ECONOMY'
  } else if (maxOpportunity >= 45 && maxThreat < 40) {
    mode = 'ATTACK'
  } else {
    mode = 'RECOVER'
  }

  return {
    tick: state.tick,
    sunBank,
    ownBaseHp: state.p2BaseHp,
    enemyBaseHp: state.p1BaseHp,
    lanes,
    maxThreatLane,
    maxThreat,
    maxOpportunityLane,
    maxOpportunity,
    totalOwnProducers,
    mode,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. GENERACIÓN DE ACCIONES CANDIDATAS Y UTILITY SCORING
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Comprueba si una casilla local de P2 (lane, colLocal) está libre.
 */
function esCasillaLibreP2(state: GameState, lane: number, colLocal: number): boolean {
  const colCampo = TOTAL_COLUMNS - 1 - colLocal
  return !state.enemyPlants.some(
    (e) => e.lane === lane && e.col === colCampo && !e.isWalking
  )
}

/**
 * Calcula la reserva de soles dinámica según fase de partida y modo.
 */
export function calcularReservaSoles(
  perception: StrategicPerception,
  profile: StrategicProfile
): number {
  if (perception.mode === 'EMERGENCY_DEFEND') {
    return 0 // Gastar todo para sobrevivir
  }

  // Early game (< 40 seg): reserva baja para arrancar economía
  if (perception.tick < msToTicks(40000)) {
    return Math.min(25, profile.baseReserveSun)
  }

  // Mid game: reserva normal del perfil
  if (perception.tick < msToTicks(90000)) {
    return profile.baseReserveSun
  }

  // Late game / Pressure: agresión máxima, sol para empujar
  if (perception.mode === 'PRESSURE' || perception.mode === 'ATTACK') {
    return Math.max(0, profile.baseReserveSun - 25)
  }

  return profile.baseReserveSun
}

/**
 * Genera todas las acciones candidatas y calcula su Utility Score.
 */
export function generarAccionesCandidatas(
  deck: CartaDeMazo[],
  slotCooldowns: Record<number, number>,
  perception: StrategicPerception,
  state: GameState,
  profile: StrategicProfile
): CandidateAction[] {
  const candidates: CandidateAction[] = []
  const reserveSun = calcularReservaSoles(perception, profile)

  // ── A) CANDIDATO: WAIT ───────────────────────────────────────────────────
  // Esperar tiene valor intrínseco si no tenemos suficiente sol, o si conviene
  // ahorrar para una carta clave de mayor impacto.
  let waitUtility = 15
  if (perception.sunBank < reserveSun) {
    waitUtility += 25
  }
  if (perception.mode === 'RECOVER' || perception.mode === 'ECONOMY') {
    waitUtility += 10
  }
  if (perception.mode === 'EMERGENCY_DEFEND') {
    waitUtility -= 30 // Prohibido esperar ocioso en emergencia si hay cartas
  }
  candidates.push({
    kind: 'wait',
    utility: Math.max(0, waitUtility),
    reason: 'Ahorro / espera estratégica',
  })

  // ── B) CANDIDATOS: PLANT PARA CADA CARTA DEL MAZO ────────────────────────
  for (let slotIndex = 0; slotIndex < deck.length; slotIndex++) {
    const carta = deck[slotIndex]
    const plantId = carta.plantId as PlantId
    const statRolls = rollsValidos(carta.statRolls)
    const config = getScaledPlantConfig(plantId, statRolls)
    if (!config) continue

    const slot = carta.slot ?? slotIndex
    const cooldownHasta = slotCooldowns[slot] || 0
    const enCooldown = cooldownHasta > state.tick
    const puedePagar = perception.sunBank >= config.cost

    // Si no se puede pagar o está en cooldown, no es candidato legal inmediato
    if (!puedePagar || enCooldown) {
      continue
    }

    const tactical = getTacticalProfile(plantId)

    // Evaluar en cada uno de los 3 carriles
    for (let lane = 0; lane < 3; lane++) {
      const laneEval = perception.lanes[lane]

      if (tactical.isWalking) {
        // Plantas atacantes que caminan: no usan columna estática
        const utility = calcularUtilidadPlanta({
          plantId,
          tactical,
          configCost: config.cost,
          lane,
          col: undefined,
          laneEval,
          perception,
          profile,
          reserveSun,
        })

        candidates.push({
          kind: 'plant',
          plantId,
          slot,
          lane,
          col: undefined,
          utility: utility.total,
          breakdown: utility.breakdown,
          reason: utility.reason,
        })
      } else {
        // Plantas estáticas: buscar casillas legales en el rango preferido
        const [minCol, maxCol] = tactical.preferredCols
        const colsProbadas: number[] = []

        // Primero probar en el rango preferido
        for (let c = minCol; c <= maxCol; c++) {
          if (c < P1_COLUMNS && esCasillaLibreP2(state, lane, c)) {
            colsProbadas.push(c)
          }
        }

        // Si todas las preferidas están ocupadas, buscar cualquier columna libre del carril
        if (colsProbadas.length === 0) {
          for (let c = 0; c < P1_COLUMNS; c++) {
            if (esCasillaLibreP2(state, lane, c)) {
              colsProbadas.push(c)
            }
          }
        }

        for (const col of colsProbadas) {
          const utility = calcularUtilidadPlanta({
            plantId,
            tactical,
            configCost: config.cost,
            lane,
            col,
            laneEval,
            perception,
            profile,
            reserveSun,
          })

          candidates.push({
            kind: 'plant',
            plantId,
            slot,
            lane,
            col,
            utility: utility.total,
            breakdown: utility.breakdown,
            reason: utility.reason,
          })
        }
      }
    }
  }

  return candidates.sort((a, b) => b.utility - a.utility)
}

/**
 * Fórmula pura de Utility para una planta en un carril y columna dados.
 */
export function calcularUtilidadPlanta(params: {
  plantId: PlantId
  tactical: PlantTacticalProfile
  configCost: number
  lane: number
  col?: number
  laneEval: LaneEvaluation
  perception: StrategicPerception
  profile: StrategicProfile
  reserveSun: number
}): { total: number; breakdown: CandidateAction['breakdown']; reason: string } {
  const {
    tactical,
    configCost,
    lane,
    col,
    laneEval,
    perception,
    profile,
    reserveSun,
  } = params

  let defenseScore = 0
  let attackScore = 0
  let economyScore = 0
  let synergyScore = 0
  let costRiskPenalty = 0
  let overinvestmentPenalty = 0
  let reason = ''

  // ── 1. DEFENSA ─────────────────────────────────────────────────────────────
  if (tactical.isTank || tactical.isTrap || tactical.isLaneClear || tactical.isFreezer) {
    if (tactical.isLaneClear) {
      // Jalapeño: explosión de carril. Gran valor si hay muchos atacantes o amenaza crítica
      defenseScore = (laneEval.enemyAttackersCount * 30 + laneEval.threatScore * 0.7) * profile.defense
      if (laneEval.enemyAttackersCount >= 2 || laneEval.threatScore >= 60) {
        defenseScore += 35
      }
    } else if (tactical.isFreezer) {
      // Lechuga helada: coste 0, excelente para congelar en emergencia
      defenseScore = (25 + laneEval.threatScore * 0.5) * profile.defense
    } else if (tactical.isTrap) {
      // Papa mina: útil si hay atacantes caminando hacia nosotros con anticipación
      defenseScore = (30 + laneEval.threatScore * 0.6) * profile.defense
    } else if (tactical.isTank) {
      // Nuez / Nuez alta: tanque defensivo
      defenseScore = (35 + laneEval.threatScore * 0.85) * profile.defense
      if (laneEval.ownDefendersCount === 0 && laneEval.threatScore > 20) {
        defenseScore += 25 // Bono urgente por ser primer muro
      }
    }

    if (perception.mode === 'EMERGENCY_DEFEND' && laneEval.threatScore === perception.maxThreat) {
      defenseScore *= 1.4
    }
  }

  // ── 2. ATAQUE & OFENSIVA ───────────────────────────────────────────────────
  if (tactical.isWalking || tactical.role === 'ranged_attack') {
    const baseAtk = tactical.isWalking ? 40 : 35

    attackScore = (baseAtk + laneEval.attackOpportunityScore * 0.65 + (100 - laneEval.threatScore) * 0.2) * profile.aggression

    // Bono si el carril enemigo está vacío
    if (laneEval.enemyDefendersCount === 0 && laneEval.enemyAttackersCount === 0) {
      attackScore += 20 * profile.opportunism
    }

    // Bono en modo PRESSURE / ATTACK
    if (perception.mode === 'PRESSURE') {
      attackScore += 30 * profile.aggression
    } else if (perception.mode === 'ATTACK') {
      attackScore += 15 * profile.aggression
    }

    // Penalización leve si el carril propio está a punto de colapsar
    if (laneEval.threatScore >= 80) {
      attackScore -= 20
    }
  }

  // ── 3. ECONOMÍA (GIRASOLES / PRODUCTORES) ──────────────────────────────────
  if (tactical.isProducer) {
    const deficitProducers = profile.targetProducers - perception.totalOwnProducers

    if (deficitProducers > 0) {
      economyScore = (deficitProducers * 35 + 25) * profile.economy
    } else if (perception.totalOwnProducers < profile.maxProducers) {
      economyScore = 15 * profile.economy
    } else {
      economyScore = -20 // Superó límite de productores
    }

    // En emergencia o gran amenaza, plantar girasoles pierde prioridad drásticamente
    if (perception.mode === 'EMERGENCY_DEFEND' || perception.maxThreat >= 70) {
      economyScore -= 60
    } else if (laneEval.threatScore >= 45) {
      economyScore -= 30
    }

    // Late game reduce valor de girasoles
    if (perception.tick > msToTicks(90000)) {
      economyScore -= 25
    }
  }

  // ── 4. SINERGIAS POSICIONALES ──────────────────────────────────────────────
  if (col !== undefined) {
    if (tactical.isProducer) {
      // Girasoles atrás (col 0 o 1)
      if (col <= 1) synergyScore += 15
      else synergyScore -= (col * 10)
    } else if (tactical.isTank) {
      // Muros adelante (col 3, 4 o 5)
      if (col >= 3) synergyScore += 20
      else synergyScore -= 15
    } else if (tactical.role === 'ranged_attack') {
      // Atacantes en medio (col 1..3)
      if (col >= 1 && col <= 3) synergyScore += 12
      // Bono si hay un tanque delante en el mismo carril
      if (laneEval.ownDefendersCount > 0) synergyScore += 15
    }
  }

  // Sinergia de soporte (Aloe)
  if (tactical.isHealer) {
    if (laneEval.ownDefendersCount > 0 && laneEval.ownHpTotal > 500) {
      synergyScore += 30
    } else {
      synergyScore -= 10
    }
  }

  // ── 5. PENALIZACIÓN DE COSTE & RIESGO ───────────────────────────────────────
  const sunAfterCost = perception.sunBank - configCost
  if (sunAfterCost < 0) {
    costRiskPenalty += 999 // Ilegal
  } else if (sunAfterCost < reserveSun && perception.mode !== 'EMERGENCY_DEFEND') {
    // Gastar por debajo de la reserva tiene penalización proporcional
    costRiskPenalty += ((reserveSun - sunAfterCost) / 25) * 8
  }

  // ── 6. SOBREINVERSIÓN POR CARRIL ───────────────────────────────────────────
  if (tactical.isTank && laneEval.ownDefendersCount >= 2) {
    overinvestmentPenalty += 40 // No poner 3 nueces en el mismo carril
  }
  if (tactical.isProducer && laneEval.ownProducersCount >= 2) {
    overinvestmentPenalty += 25 // No saturar un carril de girasoles
  }

  // ── TOTAL ──────────────────────────────────────────────────────────────────
  const baseUtility = tactical.baseWeight * 10
  const rawTotal =
    baseUtility +
    defenseScore +
    attackScore +
    economyScore +
    synergyScore -
    costRiskPenalty -
    overinvestmentPenalty

  const total = Math.max(0, Math.round(rawTotal))

  if (defenseScore > attackScore && defenseScore > economyScore) {
    reason = `Defensa en carril ${lane} (amenaza ${laneEval.threatScore})`
  } else if (attackScore > economyScore) {
    reason = `Ataque en carril ${lane} (oportunidad ${laneEval.attackOpportunityScore})`
  } else if (economyScore > 0) {
    reason = `Desarrollo económico (productores: ${perception.totalOwnProducers}/${profile.targetProducers})`
  } else {
    reason = `Jugada táctica en carril ${lane}`
  }

  return {
    total,
    breakdown: {
      defense: Math.round(defenseScore),
      attack: Math.round(attackScore),
      economy: Math.round(economyScore),
      synergy: Math.round(synergyScore),
      costRiskPenalty: Math.round(costRiskPenalty),
      overinvestmentPenalty: Math.round(overinvestmentPenalty),
    },
    reason,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. SELECCIÓN ESTOCÁSTICA DETERMINISTA Y DECISIÓN FINAL
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Selecciona una acción de entre las candidatas.
 * Aplica una selección ponderada competitiva (Top-K dentro del margen de error humano)
 * utilizando el PRNG determinista propio del bot sin alterar state.rng.
 */
export function seleccionarAccionDeterminista(
  candidates: CandidateAction[],
  profile: StrategicProfile,
  rng: Rng
): CandidateAction {
  if (candidates.length === 0) {
    return { kind: 'wait', utility: 0, reason: 'Sin candidatos' }
  }

  const bestScore = candidates[0].utility
  if (bestScore <= 0 || profile.badPlayMargin <= 0 || candidates.length === 1) {
    return candidates[0]
  }

  // Filtrar candidatos competitivos dentro del margen
  const minAcceptableScore = bestScore * (1 - profile.badPlayMargin)
  const topCandidates = candidates.filter((c) => c.utility >= minAcceptableScore)

  if (topCandidates.length === 1) {
    return topCandidates[0]
  }

  // Selección ponderada por utility ^ 2
  let totalWeight = 0
  for (const c of topCandidates) {
    totalWeight += Math.pow(c.utility, 2)
  }

  let roll = nextFloat(rng) * totalWeight
  for (const c of topCandidates) {
    const weight = Math.pow(c.utility, 2)
    if (roll <= weight) {
      return c
    }
    roll -= weight
  }

  return topCandidates[0]
}

/**
 * Función principal que decide la siguiente acción del Strategic Bot en el tick actual.
 * Devuelve la decisión seleccionada o null si no le toca decidir todavía (cadencia humana).
 */
export function decidirAccionEstrategica(
  state: GameState,
  deck: CartaDeMazo[],
  slotCooldowns: Record<number, number>,
  sunBank: number,
  mentalState: StrategicMentalState
): {
  decision: CandidateAction | null
  perception: StrategicPerception
  telemetryEntry?: StrategicTelemetryEntry
} {
  const profile = mentalState.profile
  const tick = state.tick

  // Cadencia humana: evaluar sólo si se cumplió el tiempo de decisión
  const perception = percibirTablero(state, sunBank, profile)
  mentalState.lastPerception = perception

  if (tick < mentalState.nextDecisionTick) {
    return { decision: null, perception }
  }

  // Generar candidatos
  const candidates = generarAccionesCandidatas(
    deck,
    slotCooldowns,
    perception,
    state,
    profile
  )

  const chosen = seleccionarAccionDeterminista(candidates, profile, mentalState.rng)

  // Programar siguiente momento de decisión con irregularidad humana
  const factor = 1 - profile.irregularity / 2 + nextFloat(mentalState.rng) * profile.irregularity * 1.5
  let waitMs = profile.reactionMs * factor
  if (chance(mentalState.rng, 0.15)) {
    waitMs *= 1.8 // Duda humana ocasional
  }
  mentalState.nextDecisionTick = tick + msToTicks(waitMs)
  mentalState.lastDecisionTick = tick

  if (chosen.kind === 'wait') {
    mentalState.consecutiveWaits += 1
  } else {
    mentalState.consecutiveWaits = 0
  }

  const telemetryEntry: StrategicTelemetryEntry = {
    tick,
    mode: perception.mode,
    chosenAction: chosen,
    score: chosen.utility,
    topCandidates: candidates.slice(0, 4).map((c) => ({
      kind: c.kind,
      plantId: c.plantId,
      lane: c.lane,
      col: c.col,
      utility: c.utility,
    })),
    laneThreats: [perception.lanes[0].threatScore, perception.lanes[1].threatScore, perception.lanes[2].threatScore],
    laneOpportunities: [
      perception.lanes[0].attackOpportunityScore,
      perception.lanes[1].attackOpportunityScore,
      perception.lanes[2].attackOpportunityScore,
    ],
    sunBank,
  }

  return {
    decision: chosen,
    perception,
    telemetryEntry,
  }
}
