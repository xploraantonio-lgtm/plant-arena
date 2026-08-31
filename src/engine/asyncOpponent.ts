// ─────────────────────────────────────────────────────────────────────────────
// MOTOR DEL RIVAL SEMILLA (ASYNC OPPONENT) — RANKED V1
//
// Código PURO y determinista para ejecutar intenciones históricas de un rival
// asíncrono. No lee el reloj de pared, no usa Math.random, no accede al DOM ni
// a Supabase.
//
// Se ejecuta idénticamente en:
//   · Navegador (useGameEngine / Battlefield)
//   · Edge Function (verify-match)
//   · Tests unitarios (asyncOpponent.test.ts)
// ─────────────────────────────────────────────────────────────────────────────

import {
  createBattleState,
  stepTick,
  type GameState,
  type EngineVersion,
} from './simulate.ts'
import { leerMazo, type CartaDeMazo } from './mazoDeLaSala.ts'
import { msToTicks } from './time.ts'
import {
  SOL_DEL_CIELO_MS,
  GIRASOL_MS,
  GIRASOL_DOBLE_MS,
  SOLES_POR_CICLO_GIRASOL,
  SOLES_POR_CICLO_GIRASOL_DOBLE,
  TOPE_DE_PARTIDA_MS,
} from './balance.ts'
import { MARGEN_DE_RED_TICS } from './pvp.ts'
import type { PlantId, PlantStatKey } from '../types/game.ts'
import {
  PLANT_CONFIGS,
  TOTAL_COLUMNS,
  P1_COLUMNS,
  SUN_VALUE,
  INITIAL_SUN,
  getScaledPlantConfig,
} from '../utils/gameConstants.ts'

import {
  decidirAccionEstrategica,
  crearEstadoMentalEstrategico,
  obtenerPerfilEstrategico,
  escalarPerfilPorElo,
  type StrategicStyle,
  type StrategicDifficulty,
  type StrategicProfile,
  type StrategicMentalState,
  type StrategicTelemetryEntry,
} from './strategicAsyncBot.ts'

export type {
  StrategicStyle,
  StrategicDifficulty,
  StrategicProfile,
  StrategicMentalState,
  StrategicTelemetryEntry,
}

export { escalarPerfilPorElo }

export const TOPE_DE_SEGURIDAD_ASYNC = msToTicks(TOPE_DE_PARTIDA_MS) + 600
export const RETRY_INTERVAL_TICKS = 6
export const MAX_RETRY_WINDOW_TICKS = 90
export const P2_SKY_SUN_DELAY_TICKS = msToTicks(1500)

const ESTADISTICAS_VALIDAS = new Set<PlantStatKey>([
  'hp',
  'damage',
  'attackSpeed',
  'moveSpeed',
  'cooldown',
])

function esPlantId(x: string | null | undefined): x is PlantId {
  return !!x && Object.prototype.hasOwnProperty.call(PLANT_CONFIGS, x)
}

function rollsValidos(brutos: string[] | null | undefined): PlantStatKey[] {
  return (brutos ?? []).filter((r): r is PlantStatKey =>
    ESTADISTICAS_VALIDAS.has(r as PlantStatKey)
  )
}

export interface AsyncOpponentIntent {
  seq?: number
  tick?: number
  issuedTick: number
  kind: 'plant' | 'dig'
  plantId?: PlantId | null
  slot?: number | null
  lane?: number | null
  col?: number | null
}

export interface AsyncDecision {
  kind: 'plant' | 'dig' | 'wait'
  plantId?: PlantId
  slot?: number
  lane?: number
  col?: number
  utility?: number
  reason?: string
}

export interface AsyncOpponentPolicy {
  readonly mode: 'replay' | 'strategic'
  decide(
    state: GameState,
    controller: AsyncOpponentController
  ): AsyncDecision | null
}

export class ReplayPolicy implements AsyncOpponentPolicy {
  readonly mode = 'replay' as const

  decide(state: GameState, controller: AsyncOpponentController): AsyncDecision | null {
    if (
      controller.nextIntentIndex < controller.intents.length &&
      controller.intents[controller.nextIntentIndex].issuedTick <= state.tick
    ) {
      const intent = controller.intents[controller.nextIntentIndex]
      controller.nextIntentIndex += 1
      return {
        kind: intent.kind,
        plantId: intent.plantId ?? undefined,
        slot: intent.slot ?? undefined,
        lane: intent.lane ?? undefined,
        col: intent.col ?? undefined,
      }
    }
    return null
  }
}

export class StrategicPolicy implements AsyncOpponentPolicy {
  readonly mode = 'strategic' as const

  decide(state: GameState, controller: AsyncOpponentController): AsyncDecision | null {
    if (!controller.strategicState) return null

    const { decision, telemetryEntry } = decidirAccionEstrategica(
      state,
      controller.deck,
      controller.slotCooldowns,
      controller.sunBank,
      controller.strategicState
    )

    if (telemetryEntry) {
      if (!controller.telemetry) controller.telemetry = []
      controller.telemetry.push(telemetryEntry)
      if (controller.telemetry.length > 100) {
        controller.telemetry.shift()
      }
    }

    if (!decision) return null

    return {
      kind: decision.kind,
      plantId: decision.plantId,
      slot: decision.slot,
      lane: decision.lane,
      col: decision.col,
      utility: decision.utility,
      reason: decision.reason,
    }
  }
}

export interface AsyncOpponentController {
  deck: CartaDeMazo[]
  intents: AsyncOpponentIntent[]
  nextIntentIndex: number
  slotCooldowns: Record<number, number>
  pendingRetry: {
    intent: AsyncOpponentIntent
    carta: CartaDeMazo
    attempts: number
    nextRetryTick: number
    expireTick: number
  } | null
  sunBank: number
  lastSkySunTick: number
  stats: {
    intentionsTotal: number
    intentionsExecuted: number
    intentionsDropped: number
  }
  policy?: AsyncOpponentPolicy
  strategicState?: StrategicMentalState | null
  telemetry?: StrategicTelemetryEntry[]
}

/**
 * Parsea y normaliza intenciones históricas asegurando orden estricto por issuedTick (LEGACY / NO RANKED).
 */
export function normalizarIntencionesLegacy(rawActions: unknown): AsyncOpponentIntent[] {
  if (!Array.isArray(rawActions)) return []

  const resultado: AsyncOpponentIntent[] = []

  for (const a of rawActions) {
    if (!a || typeof a !== 'object') continue
    const kind = a.kind
    if (kind !== 'plant' && kind !== 'dig') continue

    const tick = typeof a.tick === 'number' ? a.tick : 0
    let issuedTick = typeof a.issuedTick === 'number' ? a.issuedTick : (typeof a.issued_tick === 'number' ? a.issued_tick : null)
    if (issuedTick === null || !Number.isFinite(issuedTick)) {
      issuedTick = Math.max(0, tick - MARGEN_DE_RED_TICS)
    }

    const plantId = (typeof a.plantId === 'string' ? a.plantId : (typeof a.plant_id === 'string' ? a.plant_id : null)) as PlantId | null
    const slot = typeof a.slot === 'number' ? a.slot : null
    const lane = typeof a.lane === 'number' ? a.lane : null
    const col = typeof a.col === 'number' ? a.col : null
    const seq = typeof a.seq === 'number' ? a.seq : undefined

    resultado.push({
      seq,
      tick,
      issuedTick,
      kind,
      plantId,
      slot,
      lane,
      col,
    })
  }

  return resultado.sort((a, b) => {
    if (a.issuedTick !== b.issuedTick) return a.issuedTick - b.issuedTick
    const sa = a.seq ?? 0
    const sb = b.seq ?? 0
    return sa - sb
  })
}

// Alias de compatibilidad hacia el legacy
export const normalizarIntenciones = normalizarIntencionesLegacy

/**
 * Crea un nuevo controlador para el Rival Semilla a partir de datos ya validados estrictamente.
 * RUTA PRODUCTIVA ESTRICTA PARA RANKED ASÍNCRONO.
 */
export function createAsyncOpponentControllerFromValidated(
  deck: CartaDeMazo[],
  intents: AsyncOpponentIntentRankedEstricta[]
): AsyncOpponentController {
  return {
    deck,
    intents,
    nextIntentIndex: 0,
    slotCooldowns: {},
    pendingRetry: null,
    sunBank: INITIAL_SUN,
    // El primer sol cae a ~2.5s igual que el jugador
    lastSkySunTick: -msToTicks(3500),
    stats: {
      intentionsTotal: intents.length,
      intentionsExecuted: 0,
      intentionsDropped: 0,
    },
    policy: new ReplayPolicy(),
  }
}

/**
 * Crea un nuevo controlador para el Rival Semilla a partir de snapshots inmutables (LEGACY).
 */
export function createAsyncOpponentController(
  deckSnapshot: unknown,
  actionsSnapshot: unknown
): AsyncOpponentController {
  const deck = leerMazo(deckSnapshot) ?? []
  const intents = normalizarIntencionesLegacy(actionsSnapshot)

  return {
    deck,
    intents,
    nextIntentIndex: 0,
    slotCooldowns: {},
    pendingRetry: null,
    sunBank: INITIAL_SUN,
    // El primer sol cae a ~2.5s igual que el jugador
    lastSkySunTick: -msToTicks(3500),
    stats: {
      intentionsTotal: intents.length,
      intentionsExecuted: 0,
      intentionsDropped: 0,
    },
    policy: new ReplayPolicy(),
  }
}

export interface CreateStrategicOpponentOptions {
  style?: StrategicStyle
  difficulty?: StrategicDifficulty
  profile?: StrategicProfile
  roomSeed?: number
  botSeed?: number
  playerElo?: number
}

/**
 * Crea un nuevo controlador para el Rival Estratégico V1 (Utility AI Determinista).
 */
export function createStrategicOpponentController(
  deck: CartaDeMazo[],
  options: CreateStrategicOpponentOptions = {}
): AsyncOpponentController {
  const style = options.style ?? 'balanced'
  const difficulty = options.difficulty ?? 'hard'
  let profile = options.profile ?? obtenerPerfilEstrategico(style, difficulty)
  if (options.playerElo !== undefined) {
    profile = escalarPerfilPorElo(profile, options.playerElo)
  }
  const seed = (options.roomSeed ?? 12345) + (options.botSeed ?? 777)
  const strategicState = crearEstadoMentalEstrategico(seed, profile)
  const policy = new StrategicPolicy()

  return {
    deck,
    intents: [],
    nextIntentIndex: 0,
    slotCooldowns: {},
    pendingRetry: null,
    sunBank: INITIAL_SUN,
    lastSkySunTick: -msToTicks(3500),
    stats: {
      intentionsTotal: 0,
      intentionsExecuted: 0,
      intentionsDropped: 0,
    },
    policy,
    strategicState,
    telemetry: [],
  }
}

/**
 * Resuelve una carta dentro del mazo snapshot del Rival Semilla.
 */
export function resolverCartaRival(
  mazo: CartaDeMazo[],
  plantId: string | null | undefined,
  slot: number | null | undefined
): CartaDeMazo | null {
  if (!esPlantId(plantId)) return null
  if (mazo.length === 0) return null

  let encontrada: CartaDeMazo | undefined
  if (slot !== null && slot !== undefined) {
    encontrada = mazo.find((c) => c.slot === slot)
    if (!encontrada && mazo[slot] && (mazo[slot].slot === null || mazo[slot].slot === undefined)) {
      encontrada = mazo[slot]
    }
  } else {
    encontrada = mazo.find((c) => c.plantId === plantId)
  }

  if (!encontrada) return null
  if (encontrada.plantId !== plantId) return null

  const statRolls = rollsValidos(encontrada.statRolls)
  const level = statRolls.length > 0 ? statRolls.length : Math.max(0, encontrada.level ?? 0)

  return {
    plantId,
    slot: slot ?? encontrada.slot ?? null,
    statRolls,
    level,
  }
}

/**
 * Genera columnas candidatas deterministas dentro del rango propio 0..5, ordenadas
 * por distancia a la columna original.
 */
export function columnasCandidatasPorDistancia(colOriginal: number): number[] {
  const base = Math.max(0, Math.min(P1_COLUMNS - 1, colOriginal))
  const todas: number[] = []
  for (let c = 0; c < P1_COLUMNS; c++) {
    todas.push(c)
  }

  return todas.sort((a, b) => {
    const distA = Math.abs(a - base)
    const distB = Math.abs(b - base)
    if (distA !== distB) return distA - distB
    return a - b
  })
}

/**
 * Comprueba si una casilla (en coordenadas locales de P2) está ocupada por una planta estática de P2.
 */
export function casillaOcupadaP2(state: GameState, lane: number, colLocal: number): boolean {
  const colEnElCampo = TOTAL_COLUMNS - 1 - colLocal
  return state.enemyPlants.some(
    (e) => e.lane === lane && e.col === colEnElCampo && !e.isWalking
  )
}

/**
 * Avanza la economía y las decisiones del Rival Semilla exactamente un tic.
 * Debe ejecutarse antes de stepTick(state) para sincronizar en el mismo tic.
 */
export function stepAsyncOpponent(
  controller: AsyncOpponentController,
  state: GameState
): void {
  // ── 1. SINCRONIZAR RECOMPENSAS EXTERNAS ─────────────────────────────────────
  // Preserva recompensas ganadas por P2 durante el motor común (ej. matar plantas de P1).
  controller.sunBank = state.p2SunBank

  // ── 2. ECONOMÍA DETERMINISTA DE P2 ─────────────────────────────────────────
  // A) Soles del cielo: misma cadencia periódica que el jugador con delay fijo documentado.
  if (state.tick - controller.lastSkySunTick >= msToTicks(SOL_DEL_CIELO_MS)) {
    controller.lastSkySunTick = state.tick
  }

  // Acreditación de sol del cielo pendiente (cada 6s a partir de 2.5s iniciales + 1.5s delay = 4s)
  const primerSolP2Tick = -msToTicks(3500) + msToTicks(SOL_DEL_CIELO_MS) + P2_SKY_SUN_DELAY_TICKS
  if (state.tick >= primerSolP2Tick && (state.tick - primerSolP2Tick) % msToTicks(SOL_DEL_CIELO_MS) === 0) {
    controller.sunBank += SUN_VALUE
    state.p2SunBank = controller.sunBank
    if (controller.strategicState) {
      controller.strategicState.metrics.totalSunCredited += SUN_VALUE
    }
  }

  // B) Girasoles de P2: acreditan soles deterministas tras su ciclo
  for (const p of state.enemyPlants) {
    if (p.plantId === 'sunflower' || p.plantId === 'twinsunflower') {
      const esDoble = p.plantId === 'twinsunflower'
      const cada = esDoble ? GIRASOL_DOBLE_MS : GIRASOL_MS
      if (state.tick > 0 && state.tick - p.lastActionTime >= msToTicks(cada)) {
        p.lastActionTime = state.tick
        const valor = (esDoble ? SOLES_POR_CICLO_GIRASOL_DOBLE : SOLES_POR_CICLO_GIRASOL) * SUN_VALUE
        controller.sunBank += valor
        state.p2SunBank = controller.sunBank
        if (controller.strategicState) {
          controller.strategicState.metrics.totalSunCredited += valor
        }
      }
    }
  }

  // Mantener state.p2SunBank sincronizado
  state.p2SunBank = controller.sunBank

  // ── 3. INTENTO DE REINTENTO PENDIENTE ──────────────────────────────────────
  if (controller.pendingRetry) {
    const { intent, carta, expireTick, nextRetryTick } = controller.pendingRetry

    if (state.tick >= expireTick) {
      // Expiró la ventana de retry -> descartar
      controller.stats.intentionsDropped += 1
      controller.pendingRetry = null
    } else if (state.tick >= nextRetryTick) {
      const ejecutada = intentarEjecutarPlant(controller, state, intent, carta)
      if (ejecutada) {
        controller.stats.intentionsExecuted += 1
        controller.pendingRetry = null
      } else {
        controller.pendingRetry.attempts += 1
        controller.pendingRetry.nextRetryTick = state.tick + RETRY_INTERVAL_TICKS
      }
    }
  }

  // ── 4. PROCESAR DECISIONES DE LA POLÍTICA O INTENCIONES DIRECTAS ──────────
  if (controller.policy) {
    if (controller.policy.mode === 'replay') {
      while (true) {
        const decision = controller.policy.decide(state, controller)
        if (!decision) break
        ejecutarDecisionAsync(controller, state, decision)
      }
    } else {
      const decision = controller.policy.decide(state, controller)
      if (decision) {
        ejecutarDecisionAsync(controller, state, decision)
      }
    }
  } else {
    while(
      controller.nextIntentIndex < controller.intents.length &&
      controller.intents[controller.nextIntentIndex].issuedTick <= state.tick
    ) {
      const intent = controller.intents[controller.nextIntentIndex]
      controller.nextIntentIndex += 1
      ejecutarIntentDirecto(controller, state, intent)
    }
  }
}

function ejecutarDecisionAsync(
  controller: AsyncOpponentController,
  state: GameState,
  decision: AsyncDecision
): void {
  if (decision.kind === 'wait') {
    return
  }

  if (decision.kind === 'dig') {
    if (
      decision.lane !== null &&
      decision.lane !== undefined &&
      decision.col !== null &&
      decision.col !== undefined &&
      Number.isInteger(decision.lane) &&
      Number.isInteger(decision.col)
    ) {
      const lane = decision.lane
      const col = decision.col
      if (casillaOcupadaP2(state, lane, col)) {
        state.pending.push({
          atTick: state.tick + MARGEN_DE_RED_TICS,
          kind: 'rival_dig',
          lane,
          col,
        })
        controller.stats.intentionsExecuted += 1
      } else {
        controller.stats.intentionsDropped += 1
      }
    } else {
      controller.stats.intentionsDropped += 1
    }
    return
  }

  if (decision.kind === 'plant') {
    if (
      !decision.plantId ||
      decision.lane === null ||
      decision.lane === undefined ||
      !Number.isInteger(decision.lane) ||
      decision.lane < 0 ||
      decision.lane > 2
    ) {
      controller.stats.intentionsDropped += 1
      return
    }

    const carta = resolverCartaRival(controller.deck, decision.plantId, decision.slot)
    if (!carta) {
      controller.stats.intentionsDropped += 1
      return
    }

    const intent: AsyncOpponentIntent = {
      issuedTick: state.tick,
      kind: 'plant',
      plantId: decision.plantId,
      slot: decision.slot,
      lane: decision.lane,
      col: decision.col,
    }

    const ejecutada = intentarEjecutarPlant(controller, state, intent, carta)
    if (ejecutada) {
      controller.stats.intentionsExecuted += 1
    } else {
      controller.pendingRetry = {
        intent,
        carta,
        attempts: 1,
        nextRetryTick: state.tick + RETRY_INTERVAL_TICKS,
        expireTick: state.tick + MAX_RETRY_WINDOW_TICKS,
      }
    }
  }
}

function ejecutarIntentDirecto(
  controller: AsyncOpponentController,
  state: GameState,
  intent: AsyncOpponentIntent
): void {
  if (intent.kind === 'dig') {
    if (
      intent.lane !== null &&
      intent.lane !== undefined &&
      intent.col !== null &&
      intent.col !== undefined &&
      Number.isInteger(intent.lane) &&
      Number.isInteger(intent.col)
    ) {
      const lane = intent.lane
      const col = intent.col
      if (casillaOcupadaP2(state, lane, col)) {
        state.pending.push({
          atTick: state.tick + MARGEN_DE_RED_TICS,
          kind: 'rival_dig',
          lane,
          col,
        })
        controller.stats.intentionsExecuted += 1
      } else {
        controller.stats.intentionsDropped += 1
      }
    } else {
      controller.stats.intentionsDropped += 1
    }
    return
  }

  if (intent.kind === 'plant') {
    if (
      !intent.plantId ||
      intent.lane === null ||
      intent.lane === undefined ||
      !Number.isInteger(intent.lane) ||
      intent.lane < 0 ||
      intent.lane > 2
    ) {
      controller.stats.intentionsDropped += 1
      return
    }

    const carta = resolverCartaRival(controller.deck, intent.plantId, intent.slot)
    if (!carta) {
      controller.stats.intentionsDropped += 1
      return
    }

    const ejecutada = intentarEjecutarPlant(controller, state, intent, carta)
    if (ejecutada) {
      controller.stats.intentionsExecuted += 1
    } else {
      controller.pendingRetry = {
        intent,
        carta,
        attempts: 1,
        nextRetryTick: state.tick + RETRY_INTERVAL_TICKS,
        expireTick: intent.issuedTick + MAX_RETRY_WINDOW_TICKS,
      }
    }
  }
}

function intentarEjecutarPlant(
  controller: AsyncOpponentController,
  state: GameState,
  intent: AsyncOpponentIntent,
  carta: CartaDeMazo
): boolean {
  const plantId = carta.plantId as PlantId
  const statRolls = rollsValidos(carta.statRolls)
  const config = getScaledPlantConfig(plantId, statRolls)
  if (!config) return false

  // 1. Comprobar soles
  if (controller.sunBank < config.cost) {
    return false
  }

  // 2. Comprobar cooldown de slot
  const slot = carta.slot ?? 0
  if ((controller.slotCooldowns[slot] || 0) > state.tick) {
    return false
  }

  // 3. Comprobar casilla
  const camina = config.category === 'melee' || !!config.moveSpeed || plantId === 'chomper'
  let targetCol = intent.col ?? 0

  if (!camina) {
    const colBase = intent.col ?? 0
    const candidatas = columnasCandidatasPorDistancia(colBase)
    const libre = candidatas.find((c) => !casillaOcupadaP2(state, intent.lane!, c))
    if (libre === undefined) {
      // Todas las columnas del carril están ocupadas
      return false
    }
    targetCol = libre
  }

  // Todo legal: ejecutar colocación
  controller.sunBank -= config.cost
  state.p2SunBank = controller.sunBank
  controller.slotCooldowns[slot] = state.tick + msToTicks(config.cooldownMs)

  if (controller.strategicState) {
    controller.strategicState.metrics.totalSunSpent += config.cost
  }

  state.pending.push({
    atTick: state.tick + MARGEN_DE_RED_TICS,
    kind: 'rival_plant',
    plantId,
    lane: intent.lane!,
    col: camina ? undefined : targetCol,
    statRolls,
    level: statRolls.length > 0 ? statRolls.length : (carta.level ?? 0),
  })

  return true
}

import {
  validarYNormalizarAccionesP1Ranked,
  validarYNormalizarIntencionesAsyncRanked,
  validarMazoAsyncRanked,
  type InconsistenciaHistorialP1,
  type AccionP1RankedEstricta,
  type AccionP1Simulacion,
  type AsyncOpponentIntentRankedEstricta,
} from './asyncP1History.ts'

export type {
  InconsistenciaHistorialP1,
  AccionP1RankedEstricta,
  AccionP1Simulacion,
  AsyncOpponentIntentRankedEstricta,
}

export interface ResultadoSimulacionAsync {
  ok: boolean
  ganador: 1 | 2 | null
  tics: number
  baseP1: number
  baseP2: number
  p1Ilegal: boolean
  motivo: 'simulation' | 'forfeit_p1' | 'no_result'
  reason?: InconsistenciaHistorialP1
  inconsistencySeq?: number
  inconsistencyTick?: number
  details?: string
  telemetria: {
    intentionsTotal: number
    intentionsExecuted: number
    intentionsDropped: number
  }
}

/**
 * Infiere issuedTick para formatos legacy / tests antiguos sin issuedTick explícito.
 * PROHIBIDO EN RANKED ASÍNCRONO ESTRICTO (los validadores estrictos fallan ante campos ausentes).
 */
export function issuedTickP1Legacy(a: AccionP1Simulacion): number {
  if (typeof a.issuedTick === 'number' && Number.isFinite(a.issuedTick) && a.issuedTick >= 0) {
    return a.issuedTick
  }
  if (a.kind === 'collect') return Math.max(0, a.tick)
  return Math.max(0, a.tick - MARGEN_DE_RED_TICS)
}

export const issuedTickP1 = issuedTickP1Legacy

import type {
  ResultadoValidacionHistorialP1,
  ResultadoDescarteAccionP1,
} from './asyncP1History.ts'

export type {
  ResultadoValidacionHistorialP1,
  ResultadoDescarteAccionP1,
}

/**
 * Normaliza y valida acciones de P1 para Ranked Asíncrono de forma estricta.
 * Devuelve el resultado discriminado { ok: true, acciones } o { ok: false, reason, ... }.
 */
export function normalizarAccionesP1(rawActions: unknown): ResultadoValidacionHistorialP1 {
  return validarYNormalizarAccionesP1Ranked(rawActions)
}

/**
 * Normalizador permisivo legacy para formatos antiguos fuera de Ranked Async.
 */
export function normalizarAccionesP1Legacy(rawActions: unknown): AccionP1Simulacion[] {
  if (!Array.isArray(rawActions)) return []
  const res: AccionP1Simulacion[] = []

  for (const a of rawActions) {
    if (!a || typeof a !== 'object') continue
    const kind = a.kind
    if (kind !== 'plant' && kind !== 'dig' && kind !== 'collect') continue
    const tick = typeof a.tick === 'number' ? a.tick : 0
    let issuedTick = typeof a.issuedTick === 'number' ? a.issuedTick : (typeof a.issued_tick === 'number' ? a.issued_tick : null)
    if (issuedTick === null || !Number.isFinite(issuedTick)) {
      issuedTick = kind === 'collect' ? Math.max(0, tick) : Math.max(0, tick - MARGEN_DE_RED_TICS)
    }
    const plantId = (typeof a.plantId === 'string' ? a.plantId : (typeof a.plant_id === 'string' ? a.plant_id : (typeof a.plant === 'string' ? a.plant : null))) as PlantId | null
    const lane = typeof a.lane === 'number' ? a.lane : undefined
    const col = typeof a.col === 'number' ? a.col : undefined
    const slot = typeof a.slot === 'number' ? a.slot : undefined
    const targetId = typeof a.targetId === 'string' ? a.targetId : (typeof a.target_id === 'string' ? a.target_id : undefined)
    const seq = typeof a.seq === 'number' ? a.seq : (typeof a.id === 'number' ? a.id : 0)
    const statRolls = Array.isArray(a.statRolls) ? rollsValidos(a.statRolls) : undefined
    const level = typeof a.level === 'number' ? a.level : undefined

    res.push({
      seq,
      tick,
      issuedTick,
      kind,
      plantId: plantId ?? undefined,
      lane,
      col,
      slot,
      targetId,
      statRolls,
      level,
    })
  }

  return res.sort((a, b) => {
    if (a.issuedTick !== b.issuedTick) return a.issuedTick - b.issuedTick
    return a.seq - b.seq
  })
}

export interface RunAsyncTimelineOptions {
  seed: number
  p1Deck: unknown
  asyncDeck: unknown
  p1Actions: AccionP1Simulacion[] | any[]
  asyncActions?: unknown
  asyncOpponentMode?: 'replay' | 'strategic'
  strategicStyle?: StrategicStyle
  strategicDifficulty?: StrategicDifficulty
  strategicProfile?: StrategicProfile
  botSeed?: number
  playerElo?: number
  untilTick?: number
  maxTicks?: number
  validateP1?: boolean
  strictAuthoritativeHistory?: boolean
  stopOnGameOver?: boolean
  engineVersion?: EngineVersion
}

export interface RunAsyncTimelineResult {
  ok: boolean
  reason?: InconsistenciaHistorialP1
  inconsistencySeq?: number
  inconsistencyTick?: number
  details?: string
  state: GameState
  controller: AsyncOpponentController
  p1Ilegal: boolean
  motivo: 'simulation' | 'forfeit_p1' | 'no_result'
  winner: 1 | 2 | null
}

/**
 * Runner ÚNICO, PURO y DETERMINISTA para partidas asíncronas de Ranked.
 * Compartido al 100% entre simulateAsyncMatch() (Edge Function) y reconstruirPartidaAsync() (Cliente).
 */
export function runAsyncTimeline(options: RunAsyncTimelineOptions): RunAsyncTimelineResult {
  const {
    seed,
    p1Deck,
    asyncDeck,
    p1Actions,
    asyncActions,
    asyncOpponentMode = 'replay',
    strategicStyle,
    strategicDifficulty,
    strategicProfile,
    botSeed,
    playerElo,
    untilTick,
    maxTicks = TOPE_DE_SEGURIDAD_ASYNC,
    validateP1 = false,
    strictAuthoritativeHistory = true,
    stopOnGameOver = true,
    engineVersion = 'auth-v2',
  } = options

  const isStrategicMode = asyncOpponentMode === 'strategic'

  let mazoP1: CartaDeMazo[] = []
  let mazoP2: CartaDeMazo[] = []
  let intencionesP2: AsyncOpponentIntentRankedEstricta[] = []
  let ordenadasP1: AccionP1RankedEstricta[] = []
  let state: GameState
  let controller: AsyncOpponentController

  if (strictAuthoritativeHistory) {
    // 1. Validar mazo P1 (obligatorio, no vacío, cartas válidas)
    if (!Array.isArray(p1Deck) || p1Deck.length === 0) {
      return {
        ok: false,
        reason: 'INVALID_P1_DECK',
        details: 'El mazo de P1 es obligatorio y no puede estar vacío en Ranked Async',
        state: createBattleState(seed, false, true, undefined, engineVersion),
        controller: createAsyncOpponentControllerFromValidated([], []),
        p1Ilegal: true,
        motivo: 'no_result',
        winner: null,
      }
    }
    const leidoP1 = leerMazo(p1Deck)
    if (!leidoP1 || leidoP1.length === 0) {
      return {
        ok: false,
        reason: 'INVALID_P1_DECK',
        details: 'El mazo de P1 no contiene cartas válidas',
        state: createBattleState(seed, false, true, undefined, engineVersion),
        controller: createAsyncOpponentControllerFromValidated([], []),
        p1Ilegal: true,
        motivo: 'no_result',
        winner: null,
      }
    }
    mazoP1 = leidoP1

    // 2. Validar mazo P2 (asyncDeck: obligatorio, array no vacío, cartas válidas)
    const valDeckP2 = validarMazoAsyncRanked(asyncDeck)
    if (!valDeckP2.ok) {
      return {
        ok: false,
        reason: valDeckP2.reason,
        details: valDeckP2.details,
        state: createBattleState(seed, false, true, undefined, engineVersion),
        controller: createAsyncOpponentControllerFromValidated([], []),
        p1Ilegal: false,
        motivo: 'no_result',
        winner: null,
      }
    }
    mazoP2 = valDeckP2.deck

    // 3. Validar plan P2 (sólo obligatorio en modo replay)
    if (!isStrategicMode) {
      const valIntents = validarYNormalizarIntencionesAsyncRanked(asyncActions)
      if (!valIntents.ok) {
        return {
          ok: false,
          reason: valIntents.reason,
          inconsistencySeq: valIntents.seq,
          inconsistencyTick: valIntents.issuedTick,
          details: valIntents.details,
          state: createBattleState(seed, false, true, undefined, engineVersion),
          controller: createAsyncOpponentControllerFromValidated(mazoP2, []),
          p1Ilegal: false,
          motivo: 'no_result',
          winner: null,
        }
      }
      intencionesP2 = valIntents.intenciones
    }

    // 4. Validar acciones P1 (p1Actions: obligatorio array, sin campos faltantes, sin fallbacks)
    const validacionP1 = validarYNormalizarAccionesP1Ranked(p1Actions)
    if (!validacionP1.ok) {
      return {
        ok: false,
        reason: validacionP1.reason,
        inconsistencySeq: validacionP1.seq,
        inconsistencyTick: validacionP1.issuedTick,
        details: validacionP1.details,
        state: createBattleState(seed, false, true, undefined, engineVersion),
        controller: isStrategicMode
          ? createStrategicOpponentController(mazoP2, {
              style: strategicStyle,
              difficulty: strategicDifficulty,
              profile: strategicProfile,
              roomSeed: seed,
              botSeed,
              playerElo,
            })
          : createAsyncOpponentControllerFromValidated(mazoP2, intencionesP2),
        p1Ilegal: true,
        motivo: 'no_result',
        winner: null,
      }
    }
    ordenadasP1 = validacionP1.acciones

    // 5. Inicialización estricta de State y Controller únicamente tras validar todo
    state = createBattleState(seed, false, true, undefined, engineVersion)
    controller = isStrategicMode
      ? createStrategicOpponentController(mazoP2, {
          style: strategicStyle,
          difficulty: strategicDifficulty,
          profile: strategicProfile,
          roomSeed: seed,
          botSeed,
          playerElo,
        })
      : createAsyncOpponentControllerFromValidated(mazoP2, intencionesP2)
  } else {
    // RUTA PERMISIVA LEGACY (solo para compatibilidad fuera de Ranked)
    state = createBattleState(seed, false, true, undefined, engineVersion)
    mazoP1 = leerMazo(p1Deck) ?? []
    mazoP2 = leerMazo(asyncDeck) ?? []
    if (isStrategicMode) {
      controller = createStrategicOpponentController(mazoP2, {
        style: strategicStyle,
        difficulty: strategicDifficulty,
        profile: strategicProfile,
        roomSeed: seed,
        botSeed,
        playerElo,
      })
    } else {
      intencionesP2 = normalizarIntencionesLegacy(asyncActions) as AsyncOpponentIntentRankedEstricta[]
      controller = createAsyncOpponentController(mazoP2, intencionesP2)
    }
    ordenadasP1 = normalizarAccionesP1Legacy(p1Actions) as AccionP1RankedEstricta[]
  }

  let p1Index = 0
  let p1Ilegal = false
  let inconsistencyReason: InconsistenciaHistorialP1 | undefined
  let inconsistencySeq: number | undefined
  let inconsistencyTick: number | undefined
  let inconsistencyDetails: string | undefined

  const limitTick = untilTick !== undefined ? untilTick : maxTicks

  while (state.tick < limitTick && (!stopOnGameOver || state.status === 'playing')) {
    // 1. Validar y aplicar acciones de P1 en state.tick
    while (p1Index < ordenadasP1.length && ordenadasP1[p1Index].issuedTick === state.tick) {
      const j = ordenadasP1[p1Index]
      p1Index += 1

      if (j.kind === 'collect') {
        if (!j.targetId) {
          if (strictAuthoritativeHistory) {
            inconsistencyReason = 'MISSING_TARGET_ID'
            inconsistencySeq = j.seq
            inconsistencyTick = j.issuedTick
            break
          }
          if (validateP1) {
            p1Ilegal = true
            break
          }
          continue
        }
        const sol = state.suns.find((s) => s.id === j.targetId)
        if (!sol) {
          if (strictAuthoritativeHistory) {
            inconsistencyReason = 'TIMELINE_INCONSISTENT'
            inconsistencySeq = j.seq
            inconsistencyTick = j.issuedTick
            inconsistencyDetails = `Sol con id ${j.targetId} no existe en tick ${state.tick}`
            break
          }
          if (validateP1) {
            p1Ilegal = true
            break
          }
          continue
        }
        state.suns = state.suns.filter((s) => s.id !== sol.id)
        state.sunBank += sol.value
        state.stats.sunsCollected += 1
        state.stats.score += 50
        continue
      }

      if (j.kind === 'dig') {
        if (
          !Number.isInteger(j.lane) ||
          j.lane === undefined ||
          j.lane < 0 ||
          j.lane > 2 ||
          !Number.isInteger(j.col) ||
          j.col === undefined ||
          j.col < 0 ||
          j.col >= P1_COLUMNS
        ) {
          if (strictAuthoritativeHistory) {
            inconsistencyReason = 'INVALID_DIG_DATA'
            inconsistencySeq = j.seq
            inconsistencyTick = j.issuedTick
            break
          }
          if (validateP1) {
            p1Ilegal = true
            break
          }
          continue
        }
        const victima = state.plants.find(
          (p) => p.lane === j.lane && p.col === j.col && !p.isWalking
        )
        if (!victima) {
          if (strictAuthoritativeHistory) {
            inconsistencyReason = 'TIMELINE_INCONSISTENT'
            inconsistencySeq = j.seq
            inconsistencyTick = j.issuedTick
            inconsistencyDetails = `No hay planta para excavar en lane=${j.lane}, col=${j.col}`
            break
          }
          if (validateP1) {
            p1Ilegal = true
            break
          }
          continue
        }
        state.pending.push({
          atTick: Math.max(1, j.tick ?? (state.tick + MARGEN_DE_RED_TICS)),
          kind: 'own_dig',
          lane: j.lane,
          col: j.col,
        })
        continue
      }

      if (j.kind === 'plant') {
        const plantId = j.plantId as PlantId | undefined
        if (
          !esPlantId(plantId) ||
          j.lane === undefined ||
          !Number.isInteger(j.lane) ||
          j.lane < 0 ||
          j.lane > 2 ||
          j.col === undefined ||
          !Number.isInteger(j.col) ||
          j.col < 0 ||
          j.col >= P1_COLUMNS
        ) {
          if (strictAuthoritativeHistory) {
            inconsistencyReason = 'INVALID_PLANT_DATA'
            inconsistencySeq = j.seq
            inconsistencyTick = j.issuedTick
            break
          }
          if (validateP1) {
            p1Ilegal = true
            break
          }
          continue
        }

        const cartaP1 = resolverCartaRival(mazoP1, plantId, j.slot)
        if (!cartaP1) {
          if (strictAuthoritativeHistory) {
            inconsistencyReason = 'TIMELINE_INCONSISTENT'
            inconsistencySeq = j.seq
            inconsistencyTick = j.issuedTick
            inconsistencyDetails = `Carta ${j.plantId} no encontrada en el mazo de P1 (slot ${j.slot})`
            break
          }
          if (validateP1) {
            p1Ilegal = true
            break
          }
          continue
        }

        const slot = cartaP1.slot ?? (j.slot ?? 0)
        const plantIdValido = cartaP1.plantId as PlantId
        const statRolls = rollsValidos(cartaP1.statRolls ?? j.statRolls)
        const config = getScaledPlantConfig(plantIdValido, statRolls)
        if (!config || state.sunBank < config.cost) {
          if (strictAuthoritativeHistory) {
            inconsistencyReason = 'TIMELINE_INCONSISTENT'
            inconsistencySeq = j.seq
            inconsistencyTick = j.issuedTick
            inconsistencyDetails = `Soles insuficientes para plantar ${j.plantId} (coste ${config?.cost}, banco ${state.sunBank})`
            break
          }
          if (validateP1) {
            p1Ilegal = true
            break
          }
          continue
        }
        if ((state.slotCooldowns[slot] || 0) > state.tick) {
          if (strictAuthoritativeHistory) {
            inconsistencyReason = 'TIMELINE_INCONSISTENT'
            inconsistencySeq = j.seq
            inconsistencyTick = j.issuedTick
            inconsistencyDetails = `Slot ${slot} en enfriamiento hasta ${state.slotCooldowns[slot]} (tick ${state.tick})`
            break
          }
          if (validateP1) {
            p1Ilegal = true
            break
          }
          continue
        }

        const camina = config.category === 'melee' || !!config.moveSpeed || plantIdValido === 'chomper'
        if (!camina) {
          const ocupada = state.plants.some(
            (p) => p.lane === j.lane && p.col === j.col && !p.isWalking
          )
          if (ocupada) {
            if (strictAuthoritativeHistory) {
              inconsistencyReason = 'TIMELINE_INCONSISTENT'
              inconsistencySeq = j.seq
              inconsistencyTick = j.issuedTick
              inconsistencyDetails = `Casilla lane=${j.lane}, col=${j.col} ocupada por otra planta`
              break
            }
            if (validateP1) {
              p1Ilegal = true
              break
            }
            continue
          }
        }

        state.sunBank -= config.cost
        state.slotCooldowns[slot] = state.tick + msToTicks(config.cooldownMs)
        state.stats.plantsPlaced += 1

        state.pending.push({
          atTick: Math.max(1, j.tick ?? (state.tick + MARGEN_DE_RED_TICS)),
          kind: 'own_plant',
          plantId: plantIdValido,
          lane: j.lane,
          col: camina ? undefined : j.col,
          statRolls,
          level: statRolls.length > 0 ? statRolls.length : (cartaP1.level ?? j.level ?? 0),
        })
        continue
      }

      if (strictAuthoritativeHistory) {
        inconsistencyReason = 'INVALID_KIND'
        inconsistencySeq = j.seq
        inconsistencyTick = j.issuedTick
        break
      }
      if (validateP1) {
        p1Ilegal = true
        break
      }
    }

    if (inconsistencyReason || p1Ilegal) {
      break
    }

    // 2. Procesar intenciones del Rival Semilla (P2)
    stepAsyncOpponent(controller, state)

    // 3. Avanzar simulación un tic
    stepTick(state, () => {})
  }

  if (inconsistencyReason) {
    return {
      ok: false,
      reason: inconsistencyReason,
      inconsistencySeq,
      inconsistencyTick,
      details: inconsistencyDetails,
      state,
      controller,
      p1Ilegal: true,
      motivo: 'no_result',
      winner: null,
    }
  }

  let winner: 1 | 2 | null = null
  let motivo: 'simulation' | 'forfeit_p1' | 'no_result' = 'no_result'

  if (p1Ilegal) {
    winner = 2
    motivo = 'forfeit_p1'
  } else if (state.status === 'victory') {
    winner = 1
    motivo = 'simulation'
  } else if (state.status === 'defeat') {
    winner = 2
    motivo = 'simulation'
  } else {
    motivo = 'no_result'
  }

  return {
    ok: true,
    state,
    controller,
    p1Ilegal,
    motivo,
    winner,
  }
}

/**
 * Simulación autoritativa para partidas asíncronas de Ranked.
 * Valida al jugador real P1 y ejecuta al Rival Semilla determinista P2.
 */
export function simulateAsyncMatch(
  seed: number,
  p1DeckRaw: unknown,
  asyncDeckRaw: unknown,
  p1Actions: AccionP1Simulacion[] | any[],
  asyncActionsRaw: unknown,
  maxTicks = TOPE_DE_SEGURIDAD_ASYNC,
  engineVersion: EngineVersion = 'auth-v2'
): ResultadoSimulacionAsync {
  const res = runAsyncTimeline({
    seed,
    p1Deck: p1DeckRaw,
    asyncDeck: asyncDeckRaw,
    p1Actions,
    asyncActions: asyncActionsRaw,
    maxTicks,
    validateP1: true,
    strictAuthoritativeHistory: true,
    stopOnGameOver: true,
    engineVersion,
  })

  return {
    ok: res.ok,
    ganador: res.winner,
    tics: res.state.tick,
    baseP1: res.state.p1BaseHp,
    baseP2: res.state.p2BaseHp,
    p1Ilegal: res.p1Ilegal,
    motivo: res.motivo,
    reason: res.reason,
    inconsistencySeq: res.inconsistencySeq,
    inconsistencyTick: res.inconsistencyTick,
    details: res.details,
    telemetria: res.controller.stats,
  }
}

export type ReconstruirPartidaAsyncResult = {
  ok: boolean
  reason?: InconsistenciaHistorialP1
  seq?: number
  issuedTick?: number
  details?: string
  estado: GameState
  controller: AsyncOpponentController
}

/**
 * Reconstruye la partida asíncrona desde el tic 0 hasta `hastaTick`.
 * Reproduce las acciones propias de P1 y avanza el AsyncOpponentController
 * de forma determinista para que el cliente quede sincronizado al 100% tras
 * descartar o corregir una jugada local.
 */
export function reconstruirPartidaAsync(
  seed: number,
  p1Deck: CartaDeMazo[] | null | undefined,
  asyncDeckSnapshot: CartaDeMazo[],
  asyncIntents: AsyncOpponentIntent[] | any[],
  p1Acciones: AccionP1Simulacion[] | any[],
  hastaTick: number,
  engineVersion: EngineVersion = 'auth-v2'
): ReconstruirPartidaAsyncResult {
  const res = runAsyncTimeline({
    seed,
    p1Deck,
    asyncDeck: asyncDeckSnapshot,
    p1Actions: p1Acciones,
    asyncActions: asyncIntents,
    untilTick: hastaTick,
    validateP1: false,
    strictAuthoritativeHistory: true,
    stopOnGameOver: true,
    engineVersion,
  })

  if (!res.ok) {
    return {
      ok: false,
      reason: res.reason,
      seq: res.inconsistencySeq,
      issuedTick: res.inconsistencyTick,
      details: res.details,
      estado: res.state,
      controller: res.controller,
    }
  }

  return { ok: true, estado: res.state, controller: res.controller }
}

export interface CondicionFreezeMotorAsync {
  isAsyncMatch: boolean
  rankedAsyncInconsistency: unknown | null
  reconciliationState: 'healthy' | 'reconciling_pending' | 'inconsistent'
}

/**
 * Determina de forma pura si el bucle competitivo de Ranked Async debe congelarse (Fail-Closed).
 */
export function debeCongelarMotorRankedAsync(cond: CondicionFreezeMotorAsync): boolean {
  if (!cond.isAsyncMatch) return false
  return (
    cond.rankedAsyncInconsistency !== null ||
    cond.reconciliationState === 'inconsistent' ||
    cond.reconciliationState === 'reconciling_pending'
  )
}

export interface ParametrosPasoSimulacionAsync extends CondicionFreezeMotorAsync {
  state: GameState
  controller: AsyncOpponentController | null
  reproducirSonido?: () => void
}

export type ResultadoPasoSimulacionAsync =
  | { frozen: true; tickAvanzado: false }
  | { frozen: false; tickAvanzado: true }

/**
 * Ejecuta un paso atómico de simulación respetando la política de freeze fail-closed.
 */
export function ejecutarPasoSimulacionAsync(
  params: ParametrosPasoSimulacionAsync
): ResultadoPasoSimulacionAsync {
  if (debeCongelarMotorRankedAsync(params)) {
    return { frozen: true, tickAvanzado: false }
  }

  if (params.controller) {
    stepAsyncOpponent(params.controller, params.state)
  }
  stepTick(params.state, params.reproducirSonido ?? ((_s: string) => {}))
  return { frozen: false, tickAvanzado: true }
}

export interface VerificacionServidorPayload {
  status?: 'verified' | 'settled' | 'verified_draw' | 'pending' | 'failed' | string
  winnerSide?: 1 | 2 | null
  winnerId?: string | null
  settlement?: {
    eloBefore?: number
    opponentElo?: number
    eloDelta?: number
    eloAfter?: number
    eloGained?: number
    eloLost?: number
    payout?: number
    [key: string]: unknown
  }
  error?: string
}

export interface ResultadoLiquidacionMatch {
  mostrarResultado: boolean
  resultadoFinal: 'victory' | 'defeat' | 'draw' | 'hold'
  statusServidor: 'liquidada' | 'empate_verificado' | 'verificacion_pendiente' | 'revision_servidor'
  eloBefore?: number
  opponentElo?: number
  eloDelta?: number
  eloAfter?: number
  eloGained?: number
  eloLost?: number
  payout: number
  error?: string
}

/**
 * Resuelve autoritativamente la liquidación de la partida a partir de la respuesta de verify-match.
 * Durante fallos, retenciones o verificaciones pendientes, el estado local no tiene autoridad
 * y JAMÁS se otorga victoria/derrota ni cambio de ELO local.
 */
export function resolverLiquidacionPartida(options: {
  isAsyncMatch: boolean
  soyP1: boolean
  currentUserId: string | null
  serverVerification: VerificacionServidorPayload
}): ResultadoLiquidacionMatch {
  const { isAsyncMatch, soyP1, currentUserId, serverVerification } = options
  const status = serverVerification.status

  if (status === 'verified' || status === 'settled') {
    const yoGaneServidor = isAsyncMatch
      ? serverVerification.winnerSide === 1
      : (serverVerification.winnerId === currentUserId || serverVerification.winnerSide === (soyP1 ? 1 : 2))
    const s = serverVerification.settlement ?? {}
    const eloDelta = typeof s.eloDelta === 'number' ? s.eloDelta : undefined
    const eloBefore = typeof s.eloBefore === 'number' ? s.eloBefore : undefined
    const eloAfter = typeof s.eloAfter === 'number' ? s.eloAfter : undefined
    const opponentElo = typeof s.opponentElo === 'number' ? s.opponentElo : undefined
    const eloGained = yoGaneServidor
      ? (typeof s.eloGained === 'number' && s.eloGained > 0 ? s.eloGained : (eloDelta !== undefined && eloDelta > 0 ? eloDelta : undefined))
      : undefined
    const eloLost = !yoGaneServidor
      ? (typeof s.eloLost === 'number' && s.eloLost > 0 ? s.eloLost : (eloDelta !== undefined && eloDelta < 0 ? Math.abs(eloDelta) : undefined))
      : undefined

    return {
      mostrarResultado: true,
      resultadoFinal: yoGaneServidor ? 'victory' : 'defeat',
      statusServidor: 'liquidada',
      eloBefore,
      opponentElo,
      eloDelta,
      eloAfter,
      eloGained,
      eloLost,
      payout: yoGaneServidor && typeof s.payout === 'number' ? s.payout : 0,
    }
  }

  if (status === 'verified_draw') {
    return {
      mostrarResultado: true,
      resultadoFinal: 'draw',
      statusServidor: 'empate_verificado',
      payout: 0,
    }
  }

  if (status === 'pending') {
    return {
      mostrarResultado: false,
      resultadoFinal: 'hold',
      statusServidor: 'verificacion_pendiente',
      payout: 0,
    }
  }

  // status === 'failed' u otros errores de verificación
  return {
    mostrarResultado: false,
    resultadoFinal: 'hold',
    statusServidor: 'revision_servidor',
    payout: 0,
    error: serverVerification.error ?? 'La verificación automática encontró una inconsistencia. No se liquidó la partida.',
  }
}

export {
  validarAccionP1RankedEstricta,
  validarYNormalizarAccionesP1Ranked,
  registrarAccionP1Async,
  registrarAccionP1AsyncDetallado,
  descartarAccionP1Async,
  descartarAccionP1AsyncDetallado,
  sonAccionesIdenticas,
  validarMazoAsyncRanked,
  validarIntencionAsyncRankedEstricta,
  validarYNormalizarIntencionesAsyncRanked,
  sonIntencionesP2Identicas,
  incorporarLoteIntencionesP2,
  type ParametrosIncorporarLoteP2,
  type ResultadoIncorporarLoteP2,
} from './asyncP1History.ts'

export {
  confirmarAccionP1ConSesion,
  rechazarAccionP1ConSesion,
  confirmarRecogidaSolConSesion,
} from './asyncP1Capture.ts'
