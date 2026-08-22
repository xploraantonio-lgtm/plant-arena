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
}

/**
 * Parsea y normaliza intenciones históricas asegurando orden estricto por issuedTick.
 */
export function normalizarIntenciones(rawActions: unknown): AsyncOpponentIntent[] {
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

/**
 * Crea un nuevo controlador para el Rival Semilla a partir de snapshots inmutables.
 */
export function createAsyncOpponentController(
  deckSnapshot: unknown,
  actionsSnapshot: unknown
): AsyncOpponentController {
  const deck = leerMazo(deckSnapshot) ?? []
  const intents = normalizarIntenciones(actionsSnapshot)

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
  // ── 1. ECONOMÍA DETERMINISTA DE P2 ─────────────────────────────────────────
  // A) Soles del cielo: misma cadencia periódica que el jugador con delay fijo documentado.
  if (state.tick - controller.lastSkySunTick >= msToTicks(SOL_DEL_CIELO_MS)) {
    controller.lastSkySunTick = state.tick
  }

  // Acreditación de sol del cielo pendiente (cada 6s a partir de 2.5s iniciales + 1.5s delay = 4s)
  const primerSolP2Tick = -msToTicks(3500) + msToTicks(SOL_DEL_CIELO_MS) + P2_SKY_SUN_DELAY_TICKS
  if (state.tick >= primerSolP2Tick && (state.tick - primerSolP2Tick) % msToTicks(SOL_DEL_CIELO_MS) === 0) {
    controller.sunBank += SUN_VALUE
    state.p2SunBank = controller.sunBank
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
      }
    }
  }

  // Mantener state.p2SunBank sincronizado
  state.p2SunBank = controller.sunBank

  // ── 2. INTENTO DE REINTENTO PENDIENTE ──────────────────────────────────────
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

  // ── 3. PROCESAR NUEVAS INTENCIONES DEL TICK ────────────────────────────────
  while (
    controller.nextIntentIndex < controller.intents.length &&
    controller.intents[controller.nextIntentIndex].issuedTick <= state.tick
  ) {
    const intent = controller.intents[controller.nextIntentIndex]
    controller.nextIntentIndex += 1

    if (intent.kind === 'dig') {
      // Excavación: comprobar si existe planta estática propia en (lane, col)
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
      continue
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
        continue
      }

      const carta = resolverCartaRival(controller.deck, intent.plantId, intent.slot)
      if (!carta) {
        // Carta no existe en mazo snapshot -> descarte inmediato
        controller.stats.intentionsDropped += 1
        continue
      }

      const ejecutada = intentarEjecutarPlant(controller, state, intent, carta)
      if (ejecutada) {
        controller.stats.intentionsExecuted += 1
      } else {
        // Iniciar retry determinista si no hay otro retry activo o reemplazarlo
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

export interface AccionP1Simulacion {
  id?: number
  seq?: number
  tick: number
  issuedTick?: number | null
  kind: string
  plantId?: string | null
  lane?: number | null
  col?: number | null
  slot?: number | null
  targetId?: string | null
}

export interface ResultadoSimulacionAsync {
  ganador: 1 | 2 | null
  tics: number
  baseP1: number
  baseP2: number
  p1Ilegal: boolean
  motivo: 'simulation' | 'forfeit_p1' | 'no_result'
  telemetria: {
    intentionsTotal: number
    intentionsExecuted: number
    intentionsDropped: number
  }
}

function issuedTickP1(a: AccionP1Simulacion): number {
  if (Number.isInteger(a.issuedTick) && (a.issuedTick as number) >= 0) return a.issuedTick as number
  if (a.kind === 'collect') return Math.max(0, a.tick)
  return Math.max(0, a.tick - MARGEN_DE_RED_TICS)
}

/**
 * Simulación autoritativa para partidas asíncronas de Ranked.
 * Valida al jugador real P1 y ejecuta al Rival Semilla determinista P2.
 */
export function simulateAsyncMatch(
  seed: number,
  p1DeckRaw: unknown,
  asyncDeckRaw: unknown,
  p1Actions: AccionP1Simulacion[],
  asyncActionsRaw: unknown,
  maxTicks = TOPE_DE_SEGURIDAD_ASYNC
): ResultadoSimulacionAsync {
  const state = createBattleState(seed, false, true)
  const p1Deck = leerMazo(p1DeckRaw) ?? []
  const controller = createAsyncOpponentController(asyncDeckRaw, asyncActionsRaw)

  const ordenadasP1 = [...p1Actions].sort((a, b) => {
    const ia = issuedTickP1(a)
    const ib = issuedTickP1(b)
    if (ia !== ib) return ia - ib
    const sa = a.seq ?? Number.MAX_SAFE_INTEGER
    const sb = b.seq ?? Number.MAX_SAFE_INTEGER
    return sa - sb
  })

  let p1Index = 0
  let p1Ilegal = false
  let pasos = 0

  while (state.status === 'playing' && pasos < maxTicks) {
    // 1. Validar y aplicar intenciones de P1 en state.tick
    while (p1Index < ordenadasP1.length && issuedTickP1(ordenadasP1[p1Index]) === state.tick) {
      const j = ordenadasP1[p1Index]
      p1Index += 1

      if (j.kind === 'collect') {
        if (!j.targetId) {
          p1Ilegal = true
          break
        }
        const sol = state.suns.find((s) => s.id === j.targetId)
        if (!sol) {
          p1Ilegal = true
          break
        }
        state.suns = state.suns.filter((s) => s.id !== sol.id)
        state.sunBank += sol.value
        state.stats.sunsCollected += 1
        state.stats.score += 50
        continue
      }

      if (j.kind === 'dig') {
        if (!Number.isInteger(j.lane) || j.lane! < 0 || j.lane! > 2 || !Number.isInteger(j.col) || j.col! < 0 || j.col! >= P1_COLUMNS) {
          p1Ilegal = true
          break
        }
        const victima = state.plants.find((p) => p.lane === j.lane && p.col === j.col && !p.isWalking)
        if (!victima) {
          p1Ilegal = true
          break
        }
        state.pending.push({
          atTick: Math.max(1, j.tick),
          kind: 'own_dig',
          lane: j.lane!,
          col: j.col!,
        })
        continue
      }

      if (j.kind === 'plant') {
        if (!esPlantId(j.plantId) || !Number.isInteger(j.lane) || j.lane! < 0 || j.lane! > 2 || !Number.isInteger(j.col) || j.col! < 0 || j.col! >= P1_COLUMNS) {
          p1Ilegal = true
          break
        }
        const cartaP1 = resolverCartaRival(p1Deck, j.plantId, j.slot)
        if (!cartaP1) {
          p1Ilegal = true
          break
        }
        const slot = cartaP1.slot ?? (j.slot ?? 0)
        const plantId = cartaP1.plantId as PlantId
        const statRolls = rollsValidos(cartaP1.statRolls)
        const config = getScaledPlantConfig(plantId, statRolls)
        if (!config || state.sunBank < config.cost) {
          p1Ilegal = true
          break
        }
        if ((state.slotCooldowns[slot] || 0) > state.tick) {
          p1Ilegal = true
          break
        }
        const camina = config.category === 'melee' || !!config.moveSpeed || plantId === 'chomper'
        if (!camina) {
          const ocupada = state.plants.some((p) => p.lane === j.lane && p.col === j.col && !p.isWalking)
          if (ocupada) {
            p1Ilegal = true
            break
          }
        }

        state.sunBank -= config.cost
        state.slotCooldowns[slot] = state.tick + msToTicks(config.cooldownMs)
        state.stats.plantsPlaced += 1

        state.pending.push({
          atTick: Math.max(1, j.tick),
          kind: 'own_plant',
          plantId,
          lane: j.lane!,
          col: j.col ?? undefined,
          statRolls,
          level: statRolls.length > 0 ? statRolls.length : (cartaP1.level ?? 0),
        })
        continue
      }

      p1Ilegal = true
      break
    }

    if (p1Ilegal) {
      break
    }

    // 2. Procesar intenciones del Rival Semilla (P2)
    stepAsyncOpponent(controller, state)

    // 3. Avanzar simulación un tic
    stepTick(state, () => {})
    pasos += 1
  }

  if (p1Ilegal) {
    return {
      ganador: 2,
      tics: state.tick,
      baseP1: state.p1BaseHp,
      baseP2: state.p2BaseHp,
      p1Ilegal: true,
      motivo: 'forfeit_p1',
      telemetria: controller.stats,
    }
  }

  const ganador: 1 | 2 | null =
    state.status === 'victory' ? 1 : state.status === 'defeat' ? 2 : null

  return {
    ganador,
    tics: state.tick,
    baseP1: state.p1BaseHp,
    baseP2: state.p2BaseHp,
    p1Ilegal: false,
    motivo: ganador !== null ? 'simulation' : 'no_result',
    telemetria: controller.stats,
  }
}
