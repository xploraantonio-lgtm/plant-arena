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
  enemyProducersCount: number
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
  isSaturated: boolean // >= 2 tanques o > 700 HP en defensores del carril
  isVulnerable: boolean // 0 defensores y camino despejado hacia base enemiga
  flankPriority: number // 0..100 prioridad de flanqueo calculada
}

export type StrategicMode =
  | 'ECONOMY'
  | 'ATTACK'
  | 'DEFEND'
  | 'EMERGENCY_DEFEND'
  | 'PRESSURE'
  | 'RECOVER'

export type BotPersonalityState = 'CAUTIOUS' | 'BALANCED' | 'AGGRESSIVE' | 'DESPERATE'

export type OpeningArchetype = 'ECO_FIRST' | 'TEMPO_LANE' | 'EARLY_RUSH'

export interface AdaptiveLaneMemory {
  humanPlantsByLane: [number, number, number]
  humanAttackersByLane: [number, number, number]
  humanProducersByLane: [number, number, number]
  attackHeatmap: [number, number, number]
  presenceHeatmap: [number, number, number]
  preferredAttackLane: number
  neglectedLane: number
  lastObservedTick: number
}

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
  totalEnemyProducers: number
  mode: StrategicMode
  personalityState: BotPersonalityState
  isStalemate?: boolean
  stalemateLane?: number | null
  laneMemory?: AdaptiveLaneMemory
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

export type StrategicDifficulty = 'normal' | 'hard' | 'elite'

export interface DifficultyConfig {
  reactionMultiplier: number
  badPlayMargin: number
  irregularity: number
  evalDepthSharpness: number
}

export const DIFFICULTY_CONFIGS: Record<StrategicDifficulty, DifficultyConfig> = {
  normal: {
    reactionMultiplier: 1.25, // Mayor delay humano (~625-875ms)
    badPlayMargin: 0.18,      // Mayor tolerancia a alternativas viables
    irregularity: 0.45,       // Mayor dispersión
    evalDepthSharpness: 0.9,
  },
  hard: {
    reactionMultiplier: 1.0,  // Reacción competitiva (~500-600ms)
    badPlayMargin: 0.06,      // Margen de error humano reducido
    irregularity: 0.30,       // Alta consistencia
    evalDepthSharpness: 1.0,
  },
  elite: {
    reactionMultiplier: 0.70, // Reacción rápida de élite (~350-450ms)
    badPlayMargin: 0.02,      // Selección óptima casi pura
    irregularity: 0.15,       // Disciplina máxima
    evalDepthSharpness: 1.15,
  },
}

export interface StrategicProfile {
  style: StrategicStyle
  difficulty?: StrategicDifficulty
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
  basePersonality?: BotPersonalityState
}

export const STRATEGIC_PROFILES: Record<StrategicStyle, StrategicProfile> = {
  balanced: {
    style: 'balanced',
    aggression: 0.6,
    defense: 0.6,
    economy: 0.6,
    opportunism: 0.6,
    reactionMs: 600,
    baseReserveSun: 50,
    irregularity: 0.4,
    badPlayMargin: 0.08,
    targetProducers: 2,
    maxProducers: 3,
    basePersonality: 'BALANCED',
  },
  aggressive: {
    style: 'aggressive',
    aggression: 0.95,
    defense: 0.30,
    economy: 0.30,
    opportunism: 0.85,
    reactionMs: 500,
    baseReserveSun: 25,
    irregularity: 0.35,
    badPlayMargin: 0.05,
    targetProducers: 1,
    maxProducers: 2,
    basePersonality: 'AGGRESSIVE',
  },
  defensive: {
    style: 'defensive',
    aggression: 0.25,
    defense: 0.95,
    economy: 0.70,
    opportunism: 0.30,
    reactionMs: 600,
    baseReserveSun: 75,
    irregularity: 0.4,
    badPlayMargin: 0.05,
    targetProducers: 3,
    maxProducers: 4,
    basePersonality: 'CAUTIOUS',
  },
  economic: {
    style: 'economic',
    aggression: 0.30,
    defense: 0.50,
    economy: 0.98,
    opportunism: 0.35,
    reactionMs: 700,
    baseReserveSun: 50,
    irregularity: 0.45,
    badPlayMargin: 0.08,
    targetProducers: 4,
    maxProducers: 6,
    basePersonality: 'BALANCED',
  },
  opportunistic: {
    style: 'opportunistic',
    aggression: 0.80,
    defense: 0.40,
    economy: 0.45,
    opportunism: 0.98,
    reactionMs: 550,
    baseReserveSun: 35,
    irregularity: 0.4,
    badPlayMargin: 0.06,
    targetProducers: 2,
    maxProducers: 3,
    basePersonality: 'AGGRESSIVE',
  },
}

export function obtenerPerfilEstrategico(
  style: StrategicStyle = 'balanced',
  difficulty: StrategicDifficulty = 'hard'
): StrategicProfile {
  const base = STRATEGIC_PROFILES[style] ?? STRATEGIC_PROFILES.balanced
  const diff = DIFFICULTY_CONFIGS[difficulty] ?? DIFFICULTY_CONFIGS.hard

  return {
    ...base,
    difficulty,
    reactionMs: Math.round(base.reactionMs * diff.reactionMultiplier),
    badPlayMargin: diff.badPlayMargin,
    irregularity: diff.irregularity,
  }
}

/**
 * Escala un perfil estratégico según el rango ELO del jugador (V3.2).
 * 700 - 1200: badPlayMargin = 0.20
 * 1200 - 1600: badPlayMargin = 0.12 (escalado continuo 0.20 -> 0.05)
 * 1600+: badPlayMargin = 0.05
 */
export function escalarPerfilPorElo(
  baseProfile: StrategicProfile,
  playerElo: number = 1200
): StrategicProfile {
  const clampedElo = Math.max(700, Math.min(2000, playerElo))

  let badPlayMargin: number
  if (clampedElo <= 1200) {
    badPlayMargin = 0.20
  } else if (clampedElo <= 1600) {
    const ratio = (clampedElo - 1200) / 400
    badPlayMargin = Math.round((0.20 - ratio * (0.20 - 0.05)) * 1000) / 1000
  } else {
    badPlayMargin = 0.05
  }

  const eloRatio = (clampedElo - 700) / 1300 // 0.0 (700) -> 1.0 (2000)
  const reactionMultiplier = Math.max(0.65, Math.round((1.30 - eloRatio * 0.60) * 100) / 100)
  const irregularity = Math.max(0.15, Math.round((0.45 - eloRatio * 0.30) * 100) / 100)

  return {
    ...baseProfile,
    reactionMs: Math.round(baseProfile.reactionMs * reactionMultiplier),
    badPlayMargin,
    irregularity,
  }
}

export type WaitReason =
  | 'WAIT_RESERVE'
  | 'WAIT_NO_SUN'
  | 'WAIT_COOLDOWN'
  | 'WAIT_NO_POSITION'
  | 'WAIT_LOW_UTILITY'
  | 'WAIT_REACTION'

export interface CandidateAction {
  kind: 'plant' | 'dig' | 'wait'
  plantId?: PlantId
  slot?: number
  lane?: number
  col?: number
  utility: number
  waitReason?: WaitReason
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
  personalityState: BotPersonalityState
  chosenAction: CandidateAction
  score: number
  waitReason?: WaitReason
  topCandidates: Array<{
    kind: string
    plantId?: PlantId
    lane?: number
    col?: number
    utility: number
    waitReason?: WaitReason
  }>
  laneThreats: [number, number, number]
  laneOpportunities: [number, number, number]
  sunBank: number
}

export interface StrategicMentalMetrics {
  decisionCycles: number
  actionsExecuted: number
  waitChosen: number
  waitReasons: Record<WaitReason, number>
  reactionBlockedTicks: number
  stalemateEvents: number
  stalemateBreaksTriggered: number
  flankAttacksExecuted: number
  personalityTransitions: number
  idleWatchdogTriggers: number
  tacticalMistakes: number
  totalEvaluatedUtility: number
  totalChosenUtility: number
  noLegalCandidates: number
  insufficientSunCycles: number
  cooldownBlockedCycles: number
  ticksAbove2xReserve: number
  ticksAbove3xReserve: number
  maxTicksWithoutDecision: number
  maxTicksWithoutAction: number
  totalTicksBetweenActions: number
  actionIntervalCount: number
  peakSunBank: number
  totalSunSpent: number
  totalSunCredited: number
  actionsByQuarter: [number, number, number, number]
  offensivePlantsPlaced: number
  defensivePlantsPlaced: number
  economyPlantsPlaced: number
  lanesUsed: number[]
  firstAttackTick?: number
  firstBaseDamageTick?: number
  enemyPlantsKilled: number
  baseDamageDealt: number
  personalityTimeInState: Record<BotPersonalityState, number>
  openingArchetypeChosen: OpeningArchetype
  laneMemoryAnticipations: number
  neglectedLaneAttacks: number
}

export interface StrategicMentalState {
  rng: Rng
  profile: StrategicProfile
  personalityState: BotPersonalityState
  openingArchetype: OpeningArchetype
  laneMemory: AdaptiveLaneMemory
  personalityTransitions: number
  lastLookTick: number
  lastDecisionTick: number
  lastActionTick: number
  nextDecisionTick: number
  consecutiveWaits: number
  lastPerception: StrategicPerception | null
  damageProgressWindow: { tick: number; enemyBaseHp: number }[]
  lastSnapshot: {
    sunBank: number
    enemyPlantsCount: number
    ownPlantsCount: number
    maxThreatLane: number
    ownHp: number
    enemyHp: number
  }
  metrics: StrategicMentalMetrics
}

export function crearEstadoMentalEstrategico(
  seed: number,
  profile: StrategicProfile
): StrategicMentalState {
  // PRNG aislado para el bot, nunca usa ni altera state.rng
  const botRng = createRng((seed ^ 0x5a5a5a5a) >>> 0)
  const initialPersonality: BotPersonalityState = profile.basePersonality ?? 'BALANCED'

  // Selección determinista de arquetipo de apertura según seed y perfil (Behavioral Diversity V3.1)
  const roll = nextFloat(botRng)
  let openingArchetype: OpeningArchetype
  if (profile.style === 'aggressive') {
    openingArchetype = roll < 0.60 ? 'EARLY_RUSH' : roll < 0.85 ? 'TEMPO_LANE' : 'ECO_FIRST'
  } else if (profile.style === 'defensive') {
    openingArchetype = roll < 0.60 ? 'TEMPO_LANE' : roll < 0.85 ? 'ECO_FIRST' : 'EARLY_RUSH'
  } else if (profile.style === 'economic') {
    openingArchetype = roll < 0.70 ? 'ECO_FIRST' : roll < 0.90 ? 'TEMPO_LANE' : 'EARLY_RUSH'
  } else {
    openingArchetype = roll < 0.40 ? 'ECO_FIRST' : roll < 0.75 ? 'TEMPO_LANE' : 'EARLY_RUSH'
  }

  const initialLaneMemory: AdaptiveLaneMemory = {
    humanPlantsByLane: [0, 0, 0],
    humanAttackersByLane: [0, 0, 0],
    humanProducersByLane: [0, 0, 0],
    attackHeatmap: [0, 0, 0],
    presenceHeatmap: [0, 0, 0],
    preferredAttackLane: 0,
    neglectedLane: 1,
    lastObservedTick: 0,
  }

  return {
    rng: botRng,
    profile,
    personalityState: initialPersonality,
    openingArchetype,
    laneMemory: initialLaneMemory,
    personalityTransitions: 0,
    lastLookTick: -9999,
    lastDecisionTick: -9999,
    lastActionTick: 0,
    nextDecisionTick: 0,
    consecutiveWaits: 0,
    lastPerception: null,
    damageProgressWindow: [],
    lastSnapshot: {
      sunBank: 0,
      enemyPlantsCount: 0,
      ownPlantsCount: 0,
      maxThreatLane: 0,
      ownHp: INITIAL_BASE_HP,
      enemyHp: INITIAL_BASE_HP,
    },
    metrics: {
      decisionCycles: 0,
      actionsExecuted: 0,
      waitChosen: 0,
      waitReasons: {
        WAIT_RESERVE: 0,
        WAIT_NO_SUN: 0,
        WAIT_COOLDOWN: 0,
        WAIT_NO_POSITION: 0,
        WAIT_LOW_UTILITY: 0,
        WAIT_REACTION: 0,
      },
      reactionBlockedTicks: 0,
      stalemateEvents: 0,
      stalemateBreaksTriggered: 0,
      flankAttacksExecuted: 0,
      personalityTransitions: 0,
      idleWatchdogTriggers: 0,
      tacticalMistakes: 0,
      totalEvaluatedUtility: 0,
      totalChosenUtility: 0,
      noLegalCandidates: 0,
      insufficientSunCycles: 0,
      cooldownBlockedCycles: 0,
      ticksAbove2xReserve: 0,
      ticksAbove3xReserve: 0,
      maxTicksWithoutDecision: 0,
      maxTicksWithoutAction: 0,
      totalTicksBetweenActions: 0,
      actionIntervalCount: 0,
      peakSunBank: 0,
      totalSunSpent: 0,
      totalSunCredited: 0,
      actionsByQuarter: [0, 0, 0, 0],
      offensivePlantsPlaced: 0,
      defensivePlantsPlaced: 0,
      economyPlantsPlaced: 0,
      lanesUsed: [],
      enemyPlantsKilled: 0,
      baseDamageDealt: 0,
      personalityTimeInState: {
        CAUTIOUS: 0,
        BALANCED: 0,
        AGGRESSIVE: 0,
        DESPERATE: 0,
      },
      openingArchetypeChosen: openingArchetype,
      laneMemoryAnticipations: 0,
      neglectedLaneAttacks: 0,
    },
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
  let enemyProducersCount = 0
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
    if (t.isProducer) {
      enemyProducersCount += 1
    }
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

  // 6. Inteligencia de Carril: Saturación y Vulnerabilidad
  const isSaturated = (enemyDefendersCount >= 2 && enemyHpTotal > 500) || (ownDefendersCount >= 2) || (ownHpTotal >= 700 && enemyHpTotal >= 700)
  const isVulnerable = enemyDefendersCount === 0 && enemyHpTotal <= 150

  // 7. Prioridad de Flanqueo: Mayor cuando el carril está despejado o el enemigo no lo defiende
  let flankPriority = 0
  if (isVulnerable) {
    flankPriority = Math.min(100, Math.round(50 + attackOpportunityScore * 0.5))
  } else if (!isSaturated && enemyDefendersCount <= 1) {
    flankPriority = Math.min(100, Math.round(30 + attackOpportunityScore * 0.35))
  }

  return {
    lane,
    enemyPressure,
    ownPressure,
    enemyAttackersCount,
    enemyDefendersCount,
    enemyProducersCount,
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
    isSaturated,
    isVulnerable,
    flankPriority,
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
 * Actualiza la memoria adaptativa de carriles con Decaimiento Exponencial Temporal (V3.2).
 * Usa lambda = 0.985/tick (~vida media efectiva de 20-30 segundos).
 */
export function actualizarMemoriaDeCarriles(
  mentalState: StrategicMentalState,
  state: GameState
): void {
  const memory = mentalState.laneMemory
  const plantsByLane: [number, number, number] = [0, 0, 0]
  const attackersByLane: [number, number, number] = [0, 0, 0]
  const producersByLane: [number, number, number] = [0, 0, 0]

  for (const p of state.plants) {
    if (p.lane >= 0 && p.lane <= 2) {
      plantsByLane[p.lane] += 1
      const t = getTacticalProfile(p.plantId as PlantId)
      if (t.isWalking || t.role === 'ranged_attack') {
        attackersByLane[p.lane] += 1
      }
      if (t.isProducer) {
        producersByLane[p.lane] += 1
      }
    }
  }

  memory.humanPlantsByLane = plantsByLane
  memory.humanAttackersByLane = attackersByLane
  memory.humanProducersByLane = producersByLane

  // Decaimiento exponencial temporal (lambda = 0.985/tick)
  const elapsed = Math.max(0, state.tick - memory.lastObservedTick)
  const decayFactor = Math.pow(0.985, Math.min(300, elapsed))

  let maxAtkScore = -1
  let prefLane = 0
  let minPresenceScore = Infinity
  let negLane = 0

  for (let l = 0; l < 3; l++) {
    // Acumulación exponencial: retiene memoria durante 20-30s y decae suavemente
    memory.attackHeatmap[l] = memory.attackHeatmap[l] * decayFactor + attackersByLane[l] * 0.15
    memory.presenceHeatmap[l] = memory.presenceHeatmap[l] * decayFactor + plantsByLane[l] * 0.10

    if (memory.attackHeatmap[l] > maxAtkScore) {
      maxAtkScore = memory.attackHeatmap[l]
      prefLane = l
    }
    if (memory.presenceHeatmap[l] < minPresenceScore) {
      minPresenceScore = memory.presenceHeatmap[l]
      negLane = l
    }
  }

  memory.preferredAttackLane = prefLane
  memory.neglectedLane = negLane
  memory.lastObservedTick = state.tick
}

/**
 * Máquina de Transición Dinámica de Personalidad (Personality Engine V3.1 con DESPERATE).
 */
export function actualizarPersonalidadDinamica(
  mentalState: StrategicMentalState,
  perception: Omit<StrategicPerception, 'personalityState'>,
  state: GameState
): BotPersonalityState {
  const current = mentalState.personalityState ?? 'BALANCED'
  const ownHpRatio = state.p2BaseHp / INITIAL_BASE_HP
  const enemyHpRatio = state.p1BaseHp / INITIAL_BASE_HP
  const maxThreat = perception.maxThreat
  const sunBank = perception.sunBank
  const isLateGame = state.tick > msToTicks(70000)
  const isStalemate = perception.isStalemate || false

  let nextState: BotPersonalityState = current

  // Condición 0: DESPERATE (Base propia en estado crítico <= 25% HP - Forzar Remontada / Base Race)
  if (ownHpRatio <= 0.25 || state.p2BaseHp <= 250) {
    nextState = 'DESPERATE'
  }
  // Condición 1: CAUTIOUS (Amenaza severa o vida crítica bajo asedio)
  else if (maxThreat >= 55 || (ownHpRatio < 0.35 && maxThreat >= 35)) {
    nextState = 'CAUTIOUS'
  }
  // Condición 2: AGGRESSIVE (Ventaja económica, flanqueo libre, base enemiga vulnerable o Anti-Stalemate)
  else if (
    isStalemate ||
    enemyHpRatio <= 0.45 ||
    (sunBank >= 150 && perception.totalOwnProducers >= 2) ||
    (perception.maxOpportunity >= 60 && maxThreat < 35) ||
    (isLateGame && enemyHpRatio <= ownHpRatio)
  ) {
    nextState = 'AGGRESSIVE'
  }
  // Condición 3: BALANCED (Tablero bajo control, ritmo estándar)
  else if (maxThreat < 45 && ownHpRatio >= 0.40) {
    nextState = 'BALANCED'
  }

  if (nextState !== current) {
    mentalState.personalityTransitions += 1
    mentalState.personalityState = nextState
  }

  return nextState
}

/**
 * Evaluación de Agresión Adaptativa (Adaptive Aggression V3.1 con Lane Memory y Comeback).
 */
export function evaluarAgresionAdaptativa(params: {
  plantId: PlantId
  tactical: PlantTacticalProfile
  laneEval: LaneEvaluation
  perception: StrategicPerception
  personalityState: BotPersonalityState
  profile: StrategicProfile
  laneMemory?: AdaptiveLaneMemory
}): { bonus: number; reason?: string } {
  const { plantId, tactical, laneEval, perception, personalityState, profile, laneMemory } = params
  let bonus = 0
  let reason: string | undefined = undefined

  const isOffensive =
    tactical.role === 'melee' ||
    tactical.role === 'ranged_attack' ||
    tactical.isWalking ||
    tactical.isLaneClear

  if (isOffensive) {
    // 0. Modo DESPERATE: Comeback all-in masivo en el carril más vulnerable
    if (personalityState === 'DESPERATE') {
      const desperateBonus = laneEval.isVulnerable ? 80 : 50
      bonus += desperateBonus
      reason = 'Ofensiva desesperada de remontada'
    }

    // 1. Ventaja económica: convertir exceso de sol en presencia ofensiva
    if (perception.sunBank >= 150 || perception.totalOwnProducers > perception.totalEnemyProducers) {
      const ecoBonus = Math.min(35, 15 + (perception.sunBank / 250) * 20)
      bonus += ecoBonus * (0.8 + profile.aggression * 0.4)
      reason = 'Presión por ventaja económica'
    }

    // 2. Detección de carril vulnerable / desprotegido
    if (laneEval.isVulnerable) {
      const vulnBonus = 40 * (0.8 + profile.opportunism * 0.5)
      bonus += vulnBonus
      reason = `Ataque a carril vulnerable ${laneEval.lane}`
    }

    // 3. Flanqueo activo cuando otro carril está taponado
    if (laneEval.flankPriority > 45) {
      const flankBonus = Math.min(45, laneEval.flankPriority * 0.6)
      bonus += flankBonus * (0.8 + profile.opportunism * 0.4)
      reason = `Flanqueo táctico en carril ${laneEval.lane}`
    }

    // 4. Explotación de carril descuidado por el rival (Adaptive Lane Memory V3.1)
    if (laneMemory && laneEval.lane === laneMemory.neglectedLane && laneMemory.humanPlantsByLane[laneEval.lane] === 0) {
      bonus += 35 * (0.8 + profile.opportunism * 0.4)
      reason = `Ataque a carril ciego del rival ${laneEval.lane}`
    }

    // 5. Jugador expuesto (vida de base enemiga reducida)
    if (perception.enemyBaseHp <= INITIAL_BASE_HP * 0.55) {
      bonus += 35 * (0.8 + profile.aggression * 0.4)
      reason = 'Presión de remate a base enemiga'
    }

    // 6. Personalidad AGGRESSIVE
    if (personalityState === 'AGGRESSIVE') {
      bonus += 25
    }

    // 7. Jalapeño destructor de masas enemigas
    if (plantId === 'jalapeno' && (laneEval.enemyAttackersCount >= 2 || laneEval.enemyHpTotal >= 500)) {
      bonus += 40
    }
  }

  return { bonus: Math.round(bonus), reason }
}

/**
 * Genera el snapshot completo de percepción del tablero.
 */
export function percibirTablero(
  state: GameState,
  sunBank: number,
  profile: StrategicProfile,
  mentalState?: StrategicMentalState
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
  let totalEnemyProducers = 0

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
    totalEnemyProducers += lanes[l].enemyProducersCount
  }

  // Clasificación del Modo Estratégico Global Centralizado
  let mode: StrategicMode
  const ownHpRatio = state.p2BaseHp / INITIAL_BASE_HP
  const enemyHpRatio = state.p1BaseHp / INITIAL_BASE_HP

  if (maxThreat >= 75 || (ownHpRatio < 0.35 && maxThreat >= 45)) {
    mode = 'EMERGENCY_DEFEND'
  } else if (maxThreat >= 50) {
    mode = 'DEFEND'
  } else if (enemyHpRatio <= 0.45 || (maxOpportunity >= 60 && totalOwnProducers >= 1 && maxThreat < 40)) {
    mode = 'PRESSURE'
  } else if (totalOwnProducers < profile.targetProducers && maxThreat < 35 && state.tick < msToTicks(75000)) {
    mode = 'ECONOMY'
  } else if (maxOpportunity >= 40 && maxThreat < 40) {
    mode = 'ATTACK'
  } else {
    mode = 'RECOVER'
  }

  const rawPerception = {
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
    totalEnemyProducers,
    mode,
    laneMemory: mentalState?.laneMemory,
  }

  let personalityState: BotPersonalityState = profile.basePersonality ?? 'BALANCED'
  if (mentalState) {
    personalityState = actualizarPersonalidadDinamica(mentalState, rawPerception, state)
  }

  return {
    ...rawPerception,
    personalityState,
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
 * Calcula la reserva de soles dinámica según fase de partida, modo y personalidad.
 */
export function calcularReservaSoles(
  perception: StrategicPerception,
  profile: StrategicProfile,
  personalityState: BotPersonalityState = 'BALANCED'
): number {
  if (
    perception.mode === 'EMERGENCY_DEFEND' ||
    personalityState === 'AGGRESSIVE' ||
    personalityState === 'DESPERATE' ||
    perception.isStalemate
  ) {
    return 0 // Agresión total, desesperación o supervivencia: cero reserva retenida
  }

  if (personalityState === 'CAUTIOUS') {
    return Math.min(75, profile.baseReserveSun + 20)
  }

  // Early game (< 40 seg): reserva baja para arrancar economía
  if (perception.tick < msToTicks(40000)) {
    return Math.min(25, profile.baseReserveSun)
  }

  // Late game (> 75s) / Pressure / Attack: cero reserva para no empatar por tiempo
  if (
    perception.tick > msToTicks(75000) ||
    perception.mode === 'PRESSURE' ||
    perception.mode === 'ATTACK'
  ) {
    return 0
  }

  return profile.baseReserveSun
}

/**
 * Genera todas las acciones candidatas y calcula su Utility Score (V3 con Anti-Stalemate y Shovel táctico).
 */
export function generarAccionesCandidatas(
  deck: CartaDeMazo[],
  slotCooldowns: Record<number, number>,
  perception: StrategicPerception,
  state: GameState,
  profile: StrategicProfile,
  mentalState?: StrategicMentalState
): CandidateAction[] {
  const candidates: CandidateAction[] = []
  const personality = perception.personalityState ?? 'BALANCED'
  const reserveSun = calcularReservaSoles(perception, profile, personality)

  // ── A) ANÁLISIS DE CARTAS DISPONIBLES Y RAZÓN DE WAIT ───────────────────
  let minCardCost = 999
  let affordableCount = 0
  let readyAffordableCount = 0
  let hasValidPlacement = false

  for (let slotIndex = 0; slotIndex < deck.length; slotIndex++) {
    const carta = deck[slotIndex]
    const plantId = carta.plantId as PlantId
    const statRolls = rollsValidos(carta.statRolls)
    const config = getScaledPlantConfig(plantId, statRolls)
    if (!config) continue

    if (config.cost < minCardCost) minCardCost = config.cost
    const slot = carta.slot ?? slotIndex
    const enCooldown = (slotCooldowns[slot] || 0) > state.tick
    const puedePagar = perception.sunBank >= config.cost

    if (puedePagar) {
      affordableCount += 1
      if (!enCooldown) {
        readyAffordableCount += 1
        const tactical = getTacticalProfile(plantId)
        if (tactical.isWalking) {
          hasValidPlacement = true
        } else {
          for (let lane = 0; lane < 3; lane++) {
            for (let c = 0; c < P1_COLUMNS; c++) {
              if (esCasillaLibreP2(state, lane, c)) {
                hasValidPlacement = true
                break
              }
            }
            if (hasValidPlacement) break
          }
        }
      }
    }
  }

  // ── ANTI-STALEMATE WATCHDOG: Forzar acción si lleva > 5s ocioso con sol disponible ──
  const idleTicks = mentalState && mentalState.lastActionTick > 0 ? state.tick - mentalState.lastActionTick : 0
  const isIdleWatchdogTriggered = idleTicks >= msToTicks(5000) && perception.sunBank >= 50 && readyAffordableCount > 0

  if (isIdleWatchdogTriggered && mentalState) {
    mentalState.metrics.idleWatchdogTriggers += 1
  }

  // Determinar razón explícita y utility dinámica de WAIT
  let waitReason: WaitReason
  let waitUtility = 5 // Base baja para no competir con jugadas válidas

  if (perception.sunBank < minCardCost) {
    waitReason = 'WAIT_NO_SUN'
    waitUtility = 5
  } else if (affordableCount > 0 && readyAffordableCount === 0) {
    waitReason = 'WAIT_COOLDOWN'
    waitUtility = 8
  } else if (readyAffordableCount > 0 && !hasValidPlacement) {
    waitReason = 'WAIT_NO_POSITION'
    waitUtility = 5
  } else if (perception.sunBank < reserveSun && perception.mode !== 'EMERGENCY_DEFEND' && !isIdleWatchdogTriggered) {
    waitReason = 'WAIT_RESERVE'
    waitUtility = 10
  } else {
    // Ahorro táctico hacia carta pesada de late game si el tablero es seguro y hay economía
    const heavyCard = deck.find((c) => c.plantId === 'melonpult' || c.plantId === 'threepeater')
    if (heavyCard && perception.totalOwnProducers >= 1 && perception.maxThreat < 25 && perception.sunBank < 300 && !isIdleWatchdogTriggered) {
      waitReason = 'WAIT_RESERVE'
      waitUtility = 50 * Math.max(0.5, profile.economy)
    } else {
      waitReason = 'WAIT_LOW_UTILITY'
      waitUtility = isIdleWatchdogTriggered ? 0 : 4
    }
  }

  // ── DIVERSIFICACIÓN DE APERTURA: Retención legal de sol en primeros 3.5s (V3.2) ──
  // Si el arquetipo es TEMPO_LANE o EARLY_RUSH y tenemos 50 soles, permitimos retener
  // el sol para que caiga el primer sol celeste (2.5s) y abrir con Peashooter / Melee
  if (state.tick < msToTicks(3500) && perception.sunBank <= 50 && !isIdleWatchdogTriggered) {
    if (mentalState?.openingArchetype === 'TEMPO_LANE' || mentalState?.openingArchetype === 'EARLY_RUSH') {
      waitReason = 'WAIT_RESERVE'
      waitUtility = 55 // Supera a Sunflower al inicio para permitir abrir con unidad ofensiva/tempo
    }
  }

  // Penalización severa a WAIT si se acumulan soles sin gastar o si el watchdog está activo
  if ((perception.sunBank >= 2 * Math.max(25, reserveSun) && readyAffordableCount > 0 && hasValidPlacement && waitReason !== 'WAIT_RESERVE') || isIdleWatchdogTriggered) {
    const exceso = perception.sunBank - reserveSun
    waitUtility = Math.max(0, waitUtility - Math.min(30, exceso * 0.2 + (isIdleWatchdogTriggered ? 20 : 0)))
  }

  candidates.push({
    kind: 'wait',
    utility: Math.max(0, waitUtility),
    waitReason,
    reason: `Espera: ${waitReason}`,
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

    if (!puedePagar || enCooldown) {
      continue
    }

    const tactical = getTacticalProfile(plantId)

    // Evaluar en cada uno de los 3 carriles
    for (let lane = 0; lane < 3; lane++) {
      const laneEval = perception.lanes[lane]

      if (tactical.isWalking) {
        // Plantas atacantes que caminan
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
          personality,
          openingArchetype: mentalState?.openingArchetype,
          laneMemory: mentalState?.laneMemory,
          tick: state.tick,
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
        // Plantas estáticas: probar casillas legales en el rango preferido + jitter orgánico
        const [minCol, maxCol] = tactical.preferredCols
        const colsProbadas = new Set<number>()

        // 1. Columnas preferidas
        for (let c = minCol; c <= maxCol; c++) {
          if (c < P1_COLUMNS && esCasillaLibreP2(state, lane, c)) {
            colsProbadas.add(c)
          }
        }

        // 2. Columna contigua con jitter orgánico humano (col ± 1)
        if (colsProbadas.size === 0) {
          for (let c = 0; c < P1_COLUMNS; c++) {
            if (esCasillaLibreP2(state, lane, c)) {
              colsProbadas.add(c)
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
            personality,
            openingArchetype: mentalState?.openingArchetype,
            laneMemory: mentalState?.laneMemory,
            tick: state.tick,
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

  // ── C) CANDIDATOS: SHOVEL / DIG TÁCTICO (Anti-Stalemate y Reciclaje) ────────
  // Si estamos en estancamiento o late game y las casillas delanteras están llenas de girasoles o muros sin uso
  if ((perception.isStalemate || state.tick > msToTicks(85000)) && perception.sunBank >= 100) {
    for (const p of state.enemyPlants) {
      if (!p.isWalking && (p.plantId === 'sunflower' || p.plantId === 'twinsunflower')) {
        const colLocal = TOTAL_COLUMNS - 1 - (p.col ?? 0)
        // Solo excavar si el bot tiene cartas ofensivas listas para colocar y necesita espacio
        const hasOffensiveCard = deck.some((c) => {
          const prof = getTacticalProfile(c.plantId as PlantId)
          const cost = getScaledPlantConfig(c.plantId as PlantId)?.cost ?? 999
          return (prof.role === 'ranged_attack' || prof.role === 'melee') && perception.sunBank >= cost
        })

        if (hasOffensiveCard) {
          candidates.push({
            kind: 'dig',
            lane: p.lane,
            col: colLocal,
            utility: 60,
            reason: `Excavación táctica de productor en carril ${p.lane} para liberar ataque`,
          })
        }
      }
    }
  }

  return candidates.sort((a, b) => b.utility - a.utility)
}

/**
 * Fórmula pura de Utility para una planta en un carril y columna dados (V3.1).
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
  personality?: BotPersonalityState
  openingArchetype?: OpeningArchetype
  laneMemory?: AdaptiveLaneMemory
  tick?: number
}): { total: number; breakdown: CandidateAction['breakdown']; reason: string } {
  const {
    plantId,
    tactical,
    configCost,
    lane,
    col,
    laneEval,
    perception,
    profile,
    reserveSun,
    personality = 'BALANCED',
    openingArchetype,
    laneMemory = perception.laneMemory,
    tick = perception.tick,
  } = params

  let defenseScore = 0
  let attackScore = 0
  let economyScore = 0
  let synergyScore = 0
  let costRiskPenalty = 0
  let overinvestmentPenalty = 0
  let reason = ''

  // ── 1. DEFENSA ─────────────────────────────────────────────────────────────
  if (tactical.isTank || tactical.isTrap || tactical.isLaneClear || tactical.isFreezer || tactical.isHealer) {
    if (tactical.isLaneClear) {
      // Jalapeño: explosión de carril
      defenseScore = (laneEval.enemyAttackersCount * 32 + laneEval.threatScore * 0.75) * profile.defense
      if (laneEval.enemyAttackersCount >= 2 || laneEval.threatScore >= 55) {
        defenseScore += 40
      }
    } else if (tactical.isFreezer) {
      // Lechuga helada: coste 0, excelente para congelar en emergencia o frenar avance
      if (laneEval.threatScore <= 5 && laneEval.enemyAttackersCount === 0) {
        defenseScore = 5
      } else {
        defenseScore = (35 + laneEval.threatScore * 0.6) * profile.defense
        if (laneEval.threatScore > 10) defenseScore += 20
      }
    } else if (tactical.isTrap) {
      // Papa mina
      defenseScore = (30 + laneEval.threatScore * 0.6) * profile.defense
    } else if (tactical.isHealer) {
      // Aloe
      defenseScore = (15 + (laneEval.threatScore > 15 ? 25 : 0)) * profile.defense
    } else if (tactical.isTank) {
      // Nuez / Nuez alta
      defenseScore = (35 + laneEval.threatScore * 0.85) * profile.defense
      if (laneEval.ownDefendersCount === 0 && laneEval.threatScore > 20) {
        defenseScore += 30 // Bono urgente por ser primer muro
      }
    }

    // Anticipación adaptativa por memoria de carril (Adaptive Lane Memory V3.1)
    if (laneMemory && lane === laneMemory.preferredAttackLane && laneMemory.humanAttackersByLane[lane] >= 1) {
      defenseScore += 20 * profile.defense
    }

    if (perception.mode === 'EMERGENCY_DEFEND' && laneEval.threatScore === perception.maxThreat) {
      defenseScore *= 1.4
    }

    // Rompedor de estancamiento (Jalapeño): destruir muros densos en carril bloqueado
    if (tactical.isLaneClear && perception.isStalemate && (lane === perception.stalemateLane || laneEval.enemyHpTotal > 400)) {
      defenseScore += 70 * profile.aggression
    }

    // Penalización a colocar más tanques en carril saturado
    if (tactical.isTank && laneEval.isSaturated) {
      overinvestmentPenalty += 60
    }
  }

  // ── 2. ATAQUE & OFENSIVA ───────────────────────────────────────────────────
  if (tactical.isWalking || tactical.role === 'ranged_attack') {
    let baseAtk = tactical.isWalking ? 45 : 38
    if (plantId === 'melonpult') baseAtk = 95
    else if (plantId === 'threepeater') baseAtk = 82
    else if (plantId === 'repeater') baseAtk = 58

    attackScore = (baseAtk + laneEval.attackOpportunityScore * 0.7 + (100 - laneEval.threatScore) * 0.2) * profile.aggression

    // Bono si es Threepeater en carril central
    if (plantId === 'threepeater' && lane === 1) {
      attackScore += 25 * profile.opportunism
    }

    // Bono si es Melonpult ante enemigos acumulados
    if (plantId === 'melonpult' && (laneEval.enemyAttackersCount >= 1 || perception.sunBank >= 275)) {
      attackScore += 35 * profile.aggression
    }

    // Stalemate Flanking: si el carril principal está estancado, buscar flanqueo en carriles abiertos
    if (perception.isStalemate && laneEval.isVulnerable) {
      attackScore += 65 * profile.opportunism
    }

    // Bono si es caminante melee
    if (tactical.isWalking) {
      attackScore += 18 * profile.aggression
    }

    // Bono si el carril enemigo está desprotegido (Flanqueo inteligente)
    if (laneEval.isVulnerable) {
      attackScore += 35 * profile.opportunism
      if (perception.totalEnemyProducers >= 2) {
        attackScore += 25 * profile.opportunism
      }
    }

    // Bono de remate de base enemiga si está muy debilitada
    if (perception.enemyBaseHp <= 300) {
      attackScore += 50 * profile.aggression
    }

    // Bono en modo PRESSURE / ATTACK
    if (perception.mode === 'PRESSURE') {
      attackScore += 35 * profile.aggression
    } else if (perception.mode === 'ATTACK') {
      attackScore += 20 * profile.aggression
    }

    // Evaluación de Agresión Adaptativa (V3.1)
    const adaptive = evaluarAgresionAdaptativa({
      plantId,
      tactical,
      laneEval,
      perception,
      personalityState: personality,
      profile,
      laneMemory,
    })
    attackScore += adaptive.bonus

    // Penalización leve si el carril propio está a punto de colapsar
    if (laneEval.threatScore >= 80 && personality !== 'DESPERATE') {
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
      economyScore = -25 // Superó límite de productores
    }

    // En emergencia, gran amenaza, remate final o DESPERATE, plantar girasoles pierde prioridad
    if (
      perception.mode === 'EMERGENCY_DEFEND' ||
      perception.maxThreat >= 65 ||
      perception.enemyBaseHp <= 300 ||
      personality === 'DESPERATE'
    ) {
      economyScore -= 75
    } else if (personality === 'AGGRESSIVE' && perception.totalOwnProducers >= profile.targetProducers) {
      economyScore -= 30
    } else if (laneEval.threatScore >= 45) {
      economyScore -= 30
    }

    // En apertura (< 3.5s): si el arquetipo es TEMPO_LANE o EARLY_RUSH, despriorizar girasol inicial para retener sol y abrir con ofensiva/tempo
    if (tick < msToTicks(3500) && openingArchetype && openingArchetype !== 'ECO_FIRST') {
      economyScore -= 65
    }

    // Con más de 70 segundos de partida, dejar de producir girasoles
    if (perception.tick > msToTicks(70000)) {
      economyScore -= 45
    }
  }

  // ── 4. APERTURA Y DIVERSIDAD DE COMPORTAMIENTO (Early Game < 25s) ──────────
  if (tick < msToTicks(25000) && openingArchetype) {
    if (openingArchetype === 'TEMPO_LANE' && (tactical.isTank || tactical.isTrap || tactical.role === 'ranged_attack')) {
      synergyScore += 25
    } else if (openingArchetype === 'EARLY_RUSH' && tactical.isWalking) {
      attackScore += 35
    } else if (openingArchetype === 'ECO_FIRST' && tactical.isProducer) {
      economyScore += 25
    }
  }

  // ── 5. SINERGIAS POSICIONALES ──────────────────────────────────────────────
  if (col !== undefined) {
    if (tactical.isProducer) {
      if (col <= 1) synergyScore += 15
      else synergyScore -= (col * 10)
    } else if (tactical.isTank) {
      if (col >= 3) synergyScore += 20
      else synergyScore -= 15
    } else if (tactical.role === 'ranged_attack') {
      if (col >= 1 && col <= 3) synergyScore += 12
      if (laneEval.ownDefendersCount > 0) synergyScore += 15
    }
  }

  // Sinergia de soporte (Aloe)
  if (tactical.isHealer) {
    if (laneEval.ownDefendersCount > 0 && laneEval.threatScore > 20) {
      synergyScore += 20
    } else {
      synergyScore -= 10
    }
  }

  // ── 6. PENALIZACIÓN DE COSTE & RIESGO ───────────────────────────────────────
  const sunAfterCost = perception.sunBank - configCost
  if (sunAfterCost < 0) {
    costRiskPenalty += 999 // Ilegal
  } else if (sunAfterCost < reserveSun && perception.mode !== 'EMERGENCY_DEFEND' && personality !== 'DESPERATE') {
    const factor = (plantId === 'melonpult' || plantId === 'threepeater') ? 2.0 : 6
    costRiskPenalty += ((reserveSun - sunAfterCost) / 25) * factor
  }

  // ── 7. SOBREINVERSIÓN POR CARRIL ───────────────────────────────────────────
  if (tactical.isTank && laneEval.ownDefendersCount >= 1 && laneEval.threatScore < 25) {
    overinvestmentPenalty += 35
  } else if (tactical.isTank && laneEval.ownDefendersCount >= 2) {
    overinvestmentPenalty += 50
  }
  if (tactical.isProducer && laneEval.ownProducersCount >= 2) {
    overinvestmentPenalty += 30
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

  const total = Math.max(1, Math.round(rawTotal))

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
 * Selecciona una acción de entre las candidatas (Top-K ponderado estocástico determinista).
 */
export function seleccionarAccionDeterminista(
  candidates: CandidateAction[],
  profile: StrategicProfile,
  rng: Rng
): CandidateAction {
  if (candidates.length === 0) {
    return { kind: 'wait', utility: 0, waitReason: 'WAIT_LOW_UTILITY', reason: 'Sin candidatos' }
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
 * Función principal que decide la siguiente acción del Strategic Bot en el tick actual (Rival Semilla V3).
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
  const metrics = mentalState.metrics

  // Actualizar métricas continuas
  const reserveSun = profile.baseReserveSun
  if (sunBank >= 3 * reserveSun) metrics.ticksAbove3xReserve += 1
  else if (sunBank >= 2 * reserveSun) metrics.ticksAbove2xReserve += 1
  if (sunBank > metrics.peakSunBank) metrics.peakSunBank = sunBank

  // Registrar tiempo en estado de personalidad
  if (metrics.personalityTimeInState) {
    metrics.personalityTimeInState[mentalState.personalityState] = (metrics.personalityTimeInState[mentalState.personalityState] || 0) + 1
  }

  // Actualizar Memoria Adaptativa de Carriles del Rival (V3.1)
  actualizarMemoriaDeCarriles(mentalState, state)

  const perception = percibirTablero(state, sunBank, profile, mentalState)

  // ── Detección de Estancamiento Táctico (Window de 12 segundos = 360 ticks) ────
  const windowTicks = msToTicks(12000)
  mentalState.damageProgressWindow.push({ tick, enemyBaseHp: state.p1BaseHp })
  mentalState.damageProgressWindow = mentalState.damageProgressWindow.filter((w) => tick - w.tick <= windowTicks)

  let isStalemate = false
  let stalemateLane: number | null = null

  if (tick > msToTicks(20000) && mentalState.damageProgressWindow.length >= 6) {
    const oldest = mentalState.damageProgressWindow[0]
    const hpDiff = oldest.enemyBaseHp - state.p1BaseHp

    // Si durante 12s no disminuye la vida de la base enemiga y hay presencia en campo:
    if (hpDiff <= 0 && state.enemyPlants.length >= 2) {
      for (let l = 0; l < 3; l++) {
        if (perception.lanes[l].enemyDefendersCount > 0 && perception.lanes[l].enemyHpTotal >= 350) {
          isStalemate = true
          stalemateLane = l
          break
        }
      }
    }
  }

  if (isStalemate) {
    perception.isStalemate = true
    perception.stalemateLane = stalemateLane
    metrics.stalemateEvents += 1
    metrics.stalemateBreaksTriggered += 1
  }

  mentalState.lastPerception = perception

  // Detección de Eventos Deterministas Relevantes para Reevaluación Rápida con Delay Cognitivo Humano (V3.2)
  const minReactionTicks = Math.max(8, msToTicks(Math.max(250, profile.reactionMs * 0.60))) // Mínimo 250ms (~8 ticks)
  let eventTrigger = false
  const prev = mentalState.lastSnapshot

  if (prev) {
    const hadAffordable = deck.some((c) => (getScaledPlantConfig(c.plantId as PlantId)?.cost ?? 999) <= prev.sunBank)
    const nowAffordable = deck.some((c) => (getScaledPlantConfig(c.plantId as PlantId)?.cost ?? 999) <= sunBank)
    if (!hadAffordable && nowAffordable) eventTrigger = true
    if (state.plants.length > prev.enemyPlantsCount) eventTrigger = true
    if (state.plants.length < prev.enemyPlantsCount || state.enemyPlants.length < prev.ownPlantsCount) eventTrigger = true
    if (state.p2BaseHp < prev.ownHp) eventTrigger = true
    if (perception.maxThreatLane !== prev.maxThreatLane && perception.maxThreat > 30) eventTrigger = true
  }

  mentalState.lastSnapshot = {
    sunBank,
    enemyPlantsCount: state.plants.length,
    ownPlantsCount: state.enemyPlants.length,
    maxThreatLane: perception.maxThreatLane,
    ownHp: state.p2BaseHp,
    enemyHp: state.p1BaseHp,
  }

  const isTimeForNormalDecision = tick >= mentalState.nextDecisionTick
  const isEventDrivenDecision = eventTrigger && tick >= mentalState.lastDecisionTick + minReactionTicks

  if (!isTimeForNormalDecision && !isEventDrivenDecision) {
    metrics.reactionBlockedTicks += 1
    return { decision: null, perception }
  }

  metrics.decisionCycles += 1
  const ticksSinceLastDecision = mentalState.lastDecisionTick > 0 ? tick - mentalState.lastDecisionTick : 0
  if (ticksSinceLastDecision > metrics.maxTicksWithoutDecision) {
    metrics.maxTicksWithoutDecision = ticksSinceLastDecision
  }

  // Generar candidatos
  const candidates = generarAccionesCandidatas(
    deck,
    slotCooldowns,
    perception,
    state,
    profile,
    mentalState
  )

  const chosen = seleccionarAccionDeterminista(candidates, profile, mentalState.rng)

  // Medir calidad de decisión y errores tácticos
  const bestUtility = candidates.length > 0 ? candidates[0].utility : 0
  const chosenUtility = chosen.utility
  metrics.totalEvaluatedUtility += bestUtility
  metrics.totalChosenUtility += chosenUtility
  if (bestUtility > 10 && chosenUtility < bestUtility * 0.8) {
    metrics.tacticalMistakes += 1
  }

  // Programar siguiente momento de decisión con pacing orgánico humano (Poisson / Log-Normal)
  const u1 = Math.max(0.0001, nextFloat(mentalState.rng))
  const u2 = Math.max(0.0001, nextFloat(mentalState.rng))
  const normalJitter = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2)
  const humanPacingFactor = Math.max(0.55, Math.min(1.8, Math.exp(normalJitter * 0.22 * profile.irregularity)))

  let waitMs = profile.reactionMs * humanPacingFactor
  if (chance(mentalState.rng, 0.10)) {
    waitMs *= 1.4 // Duda humana ocasional
  }

  let nextTick = tick + Math.max(minReactionTicks, msToTicks(waitMs))

  // Si la mejor acción fue bloqueada por cooldown, programar revisión justo al terminar el cooldown
  let earliestRelevantCooldown = Infinity
  for (const c of deck) {
    const cost = getScaledPlantConfig(c.plantId as PlantId)?.cost ?? 999
    if (sunBank >= cost) {
      const slot = c.slot ?? 0
      const cd = slotCooldowns[slot] || 0
      if (cd > tick && cd < earliestRelevantCooldown) {
        earliestRelevantCooldown = cd
      }
    }
  }
  if (earliestRelevantCooldown !== Infinity && earliestRelevantCooldown + minReactionTicks < nextTick) {
    nextTick = earliestRelevantCooldown + minReactionTicks
  }

  mentalState.nextDecisionTick = nextTick
  mentalState.lastDecisionTick = tick

  // Actualizar métricas según la acción elegida
  if (chosen.kind === 'wait') {
    metrics.waitChosen += 1
    const r = chosen.waitReason ?? 'WAIT_LOW_UTILITY'
    metrics.waitReasons[r] = (metrics.waitReasons[r] || 0) + 1
    if (r === 'WAIT_NO_SUN') metrics.insufficientSunCycles += 1
    if (r === 'WAIT_COOLDOWN') metrics.cooldownBlockedCycles += 1
    mentalState.consecutiveWaits += 1
  } else {
    metrics.actionsExecuted += 1
    mentalState.consecutiveWaits = 0

    if (mentalState.lastActionTick > 0) {
      const interval = tick - mentalState.lastActionTick
      if (interval > metrics.maxTicksWithoutAction) metrics.maxTicksWithoutAction = interval
      metrics.totalTicksBetweenActions += interval
      metrics.actionIntervalCount += 1
    }
    mentalState.lastActionTick = tick

    const quarter = Math.min(3, Math.floor((tick / msToTicks(120000)) * 4))
    metrics.actionsByQuarter[quarter] += 1

    if (chosen.lane !== undefined && !metrics.lanesUsed.includes(chosen.lane)) {
      metrics.lanesUsed.push(chosen.lane)
    }

    if (chosen.plantId) {
      const tactical = getTacticalProfile(chosen.plantId)
      if (tactical.isProducer) metrics.economyPlantsPlaced += 1
      else if (tactical.isTank || tactical.isTrap || tactical.isFreezer) {
        metrics.defensivePlantsPlaced += 1
        if (chosen.lane !== undefined && chosen.lane === mentalState.laneMemory.preferredAttackLane) {
          metrics.laneMemoryAnticipations += 1
        }
      } else if (tactical.isWalking || tactical.role === 'ranged_attack' || tactical.isLaneClear) {
        metrics.offensivePlantsPlaced += 1
        if (metrics.firstAttackTick === undefined) metrics.firstAttackTick = tick
        if (chosen.lane !== undefined && perception.lanes[chosen.lane].isVulnerable) {
          metrics.flankAttacksExecuted += 1
        }
        if (chosen.lane !== undefined && chosen.lane === mentalState.laneMemory.neglectedLane) {
          metrics.neglectedLaneAttacks += 1
        }
      }
    }
  }

  const telemetryEntry: StrategicTelemetryEntry = {
    tick,
    mode: perception.mode,
    personalityState: perception.personalityState,
    chosenAction: chosen,
    score: chosen.utility,
    waitReason: chosen.waitReason,
    topCandidates: candidates.slice(0, 4).map((c) => ({
      kind: c.kind,
      plantId: c.plantId,
      lane: c.lane,
      col: c.col,
      utility: c.utility,
      waitReason: c.waitReason,
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

/**
 * Calcula el Human Similarity Score (HSS) a partir de la telemetría de la partida.
 */
export function calcularHumanSimilarityScore(
  metrics: StrategicMentalMetrics,
  totalTicks: number
): number {
  const durationMinutes = Math.max(0.5, totalTicks / (30 * 60))
  const apm = metrics.actionsExecuted / durationMinutes

  // 1. Cadencia APM (rango humano óptimo 10 - 24 APM)
  const apmScore = apm >= 8 && apm <= 28 ? Math.min(100, Math.round((1 - Math.abs(apm - 16) / 22) * 100)) : 65

  // 2. Diversidad de carriles (1..3)
  const laneDiversity = Math.min(100, Math.round((metrics.lanesUsed.length / 3) * 100))

  // 3. Tasa de errores controlados
  const mistakeRate = metrics.actionsExecuted > 0 ? metrics.tacticalMistakes / metrics.actionsExecuted : 0
  const mistakeScore = mistakeRate <= 0.20 ? Math.min(100, Math.round((1 - mistakeRate) * 100)) : 75

  // 4. Variabilidad de intervalos
  const avgInterval = metrics.actionIntervalCount > 0 ? metrics.totalTicksBetweenActions / metrics.actionIntervalCount : 30
  const intervalScore = avgInterval >= 15 && avgInterval <= 120 ? 95 : 75

  const hss = Math.round(0.35 * apmScore + 0.25 * laneDiversity + 0.25 * mistakeScore + 0.15 * intervalScore)
  return Math.max(0, Math.min(100, hss))
}

/**
 * Calcula el Seed Skill Score (SSS) formal.
 */
export function calcularSeedSkillScore(
  metrics: StrategicMentalMetrics,
  isWin: boolean,
  isDraw: boolean
): number {
  const sunUtil = metrics.totalSunCredited > 0 ? Math.min(1.0, metrics.totalSunSpent / metrics.totalSunCredited) : 0.8
  const threatResp = 1.0 - Math.min(1.0, metrics.reactionBlockedTicks / 3000)
  const laneDiv = metrics.lanesUsed.length / 3.0
  const resultScore = isWin ? 1.0 : isDraw ? 0.4 : 0.0

  const sss = Math.round((30 * sunUtil + 25 * threatResp + 25 * laneDiv + 20 * resultScore) * 10) / 10
  return Math.max(0, Math.min(100, sss))
}


