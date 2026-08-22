// ─────────────────────────────────────────────────────────────────────────────
// CAPTURA Y DESCARTE PRODUCTIVO DE ACCIONES DE P1 (FAIL CLOSED)
//
// Lógica pura compartida entre useGameEngine y la suite de pruebas unitarias.
// Garantiza atomicidad estricta, fail-closed sin efectos secundarios y bloqueo
// de operaciones cuando la partida está en estado inconsistente.
// ─────────────────────────────────────────────────────────────────────────────

import type { PlantId, PlantStatKey, SunEntity } from '../types/game.ts'
import { getScaledPlantConfig } from '../utils/gameConstants.ts'
import { msToTicks } from './time.ts'
import type { GameState } from './simulate.ts'
import type { AccionRegistrada } from './reconstruir.ts'
import {
  registrarAccionP1AsyncDetallado,
  descartarAccionP1AsyncDetallado,
  type AccionP1RankedEstricta,
  type InconsistenciaHistorialP1,
} from './asyncP1History.ts'

export interface ParametrosCapturaCollectP1 {
  isAsyncMatch: boolean
  sunId: string
  issuedTick?: number
  seq?: number
  state: GameState
  historial: AccionP1RankedEstricta[]
  inconsistenciaActual?: InconsistenciaHistorialP1 | null
}

export type ResultadoCapturaCollectP1 =
  | { ok: true; duplicated?: boolean; sunValue?: number }
  | { ok: false; reason: InconsistenciaHistorialP1; seq?: number; issuedTick?: number; details?: string }

/**
 * Ejecuta la captura autoritativa de COLLECT para P1.
 */
export function ejecutarCapturaCollectP1(
  params: ParametrosCapturaCollectP1
): ResultadoCapturaCollectP1 {
  const { isAsyncMatch, sunId, issuedTick, seq, state, historial, inconsistenciaActual } = params

  if (isAsyncMatch) {
    if (inconsistenciaActual) {
      return {
        ok: false,
        reason: inconsistenciaActual,
        details: 'Partida en estado inconsistente: acciones autoritativas bloqueadas',
      }
    }

    if (issuedTick === undefined || issuedTick === null) {
      return {
        ok: false,
        reason: 'MISSING_ISSUED_TICK',
        seq,
        details: 'issuedTick es obligatorio para COLLECT en Ranked Async',
      }
    }
    if (typeof issuedTick !== 'number' || !Number.isInteger(issuedTick) || issuedTick < 0) {
      return {
        ok: false,
        reason: 'INVALID_ISSUED_TICK',
        seq,
        issuedTick,
        details: `issuedTick inválido para COLLECT: ${String(issuedTick)}`,
      }
    }
    if (seq === undefined || seq === null) {
      return {
        ok: false,
        reason: 'MISSING_SEQ',
        issuedTick,
        details: 'seq es obligatorio para COLLECT en Ranked Async',
      }
    }
    if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 0) {
      return {
        ok: false,
        reason: 'INVALID_SEQ',
        seq,
        issuedTick,
        details: `seq inválido para COLLECT: ${String(seq)}`,
      }
    }

    const reg = registrarAccionP1AsyncDetallado(historial, {
      seq,
      tick: issuedTick,
      issuedTick,
      kind: 'collect',
      targetId: sunId,
    })

    if (!reg.ok) {
      return reg
    }

    if (reg.duplicated) {
      return { ok: true, duplicated: true }
    }
  }

  const sol = state.suns.find((s: SunEntity) => s.id === sunId)
  if (!sol) {
    return { ok: true }
  }

  state.suns = state.suns.filter((s: SunEntity) => s.id !== sunId)
  state.sunBank += sol.value
  state.stats.sunsCollected += 1
  state.stats.score += 50

  return { ok: true, sunValue: sol.value }
}

export interface ParametrosCapturaPlantP1 {
  isAsyncMatch: boolean
  card: PlantId
  slotIdx: number | null
  lane: number
  col: number
  rolls?: PlantStatKey[]
  cardLevel?: number
  state: GameState
  seq?: number
  enTic: number
  historial: AccionP1RankedEstricta[]
  inconsistenciaActual?: InconsistenciaHistorialP1 | null
}

export type ResultadoCapturaPlantP1 =
  | { ok: true; enTic: number; seq?: number; duplicated?: boolean }
  | { ok: false; reason: InconsistenciaHistorialP1; seq?: number; issuedTick?: number; details?: string }

/**
 * Ejecuta la captura autoritativa de PLANT para P1 con validación previa estricta.
 */
export function ejecutarCapturaPlantP1(
  params: ParametrosCapturaPlantP1
): ResultadoCapturaPlantP1 {
  const {
    isAsyncMatch,
    card,
    slotIdx,
    lane,
    col,
    rolls,
    cardLevel,
    state,
    seq,
    enTic,
    historial,
    inconsistenciaActual,
  } = params

  if (isAsyncMatch) {
    if (inconsistenciaActual) {
      return {
        ok: false,
        reason: inconsistenciaActual,
        details: 'Partida en estado inconsistente: acciones autoritativas bloqueadas',
      }
    }

    const reg = registrarAccionP1AsyncDetallado(historial, {
      seq,
      tick: enTic,
      issuedTick: state.tick,
      kind: 'plant',
      plantId: card,
      lane,
      col,
      slot: slotIdx,
      statRolls: rolls,
      level: cardLevel,
    })

    if (!reg.ok) {
      return reg
    }

    if (reg.duplicated) {
      return { ok: true, enTic, seq, duplicated: true }
    }
  }

  const config = getScaledPlantConfig(card, rolls)
  if (!config) {
    return { ok: false, reason: 'INVALID_PLANT_DATA', details: 'Configuración no encontrada para la planta' }
  }

  state.pending.push({
    atTick: enTic,
    kind: 'own_plant',
    plantId: card,
    lane,
    col,
    statRolls: rolls,
    level: cardLevel,
  })

  state.sunBank -= config.cost
  if (slotIdx !== null) {
    state.slotCooldowns[slotIdx] = state.tick + msToTicks(config.cooldownMs)
  } else {
    state.cooldowns[card] = state.tick + msToTicks(config.cooldownMs)
  }
  state.stats.plantsPlaced += 1
  state.selectedCard = null
  state.selectedSlotIndex = null

  return { ok: true, enTic, seq }
}

export interface ParametrosCapturaDigP1 {
  isAsyncMatch: boolean
  casilla: { lane: number; col: number }
  state: GameState
  seq?: number
  enTic: number
  historial: AccionP1RankedEstricta[]
  inconsistenciaActual?: InconsistenciaHistorialP1 | null
}

export type ResultadoCapturaDigP1 =
  | { ok: true; casilla: { lane: number; col: number }; tick: number; seq?: number; duplicated?: boolean }
  | { ok: false; reason: InconsistenciaHistorialP1; seq?: number; issuedTick?: number; details?: string }

/**
 * Ejecuta la captura autoritativa de DIG para P1 con validación previa estricta.
 */
export function ejecutarCapturaDigP1(
  params: ParametrosCapturaDigP1
): ResultadoCapturaDigP1 {
  const { isAsyncMatch, casilla, state, seq, enTic, historial, inconsistenciaActual } = params

  if (isAsyncMatch) {
    if (inconsistenciaActual) {
      return {
        ok: false,
        reason: inconsistenciaActual,
        details: 'Partida en estado inconsistente: acciones autoritativas bloqueadas',
      }
    }

    const reg = registrarAccionP1AsyncDetallado(historial, {
      seq,
      tick: enTic,
      issuedTick: state.tick,
      kind: 'dig',
      lane: casilla.lane,
      col: casilla.col,
    })

    if (!reg.ok) {
      return reg
    }

    if (reg.duplicated) {
      return { ok: true, casilla, tick: enTic, seq, duplicated: true }
    }
  }

  state.pending.push({
    atTick: enTic,
    kind: 'own_dig',
    lane: casilla.lane,
    col: casilla.col,
  })

  return { ok: true, casilla, tick: enTic, seq }
}

export interface ParametrosDescarteAccionP1 {
  isAsyncMatch: boolean
  tick: number
  lane: number
  col: number | null
  seq?: number
  historial: AccionP1RankedEstricta[]
  registro: AccionRegistrada[]
  costeDeMisJugadas: Map<string, { coste: number; carta: PlantId; slot: number | null }>
  state: GameState
}

export type ResultadoDescarteP1 =
  | {
      ok: true
      eliminado: boolean
      nuevoHistorial: AccionP1RankedEstricta[]
      nuevoRegistro: AccionRegistrada[]
    }
  | { ok: false; reason: InconsistenciaHistorialP1; details?: string }

/**
 * Ejecuta el descarte / rollback de una jugada propia con atomicidad total.
 * Si falla la validación en Ranked Async, ningún registro ni estado local es modificado.
 */
export function ejecutarDescarteAccionP1(
  params: ParametrosDescarteAccionP1
): ResultadoDescarteP1 {
  const { isAsyncMatch, tick, lane, col, seq, historial, registro, costeDeMisJugadas, state } = params

  let nuevoHistorial = historial
  let eliminadoAsync = false

  if (isAsyncMatch) {
    // 1. VALIDACIÓN ATÓMICA ASYNC PRIMERO: si falta o es inválido seq, NADA se altera
    const resDescarte = descartarAccionP1AsyncDetallado(historial, seq)
    if (!resDescarte.ok) {
      return {
        ok: false,
        reason: resDescarte.reason,
        details: resDescarte.details,
      }
    }
    nuevoHistorial = resDescarte.historial
    eliminadoAsync = resDescarte.eliminado
  }

  // 2. Si no es async o el descarte async fue exitoso:
  const antesRegistro = registro.length
  const nuevoRegistro = registro.filter(
    (a) => !(a.mia && a.tick === tick && a.lane === lane && (a.col ?? null) === col)
  )

  const huboCambio =
    (isAsyncMatch && eliminadoAsync) || (!isAsyncMatch && nuevoRegistro.length < antesRegistro)

  if (!huboCambio) {
    return { ok: true, eliminado: false, nuevoHistorial, nuevoRegistro }
  }

  // Devolver soles y restaurar enfriamiento
  const clave = `${tick}:${lane}:${col}`
  const cobrado = costeDeMisJugadas.get(clave)
  if (cobrado) {
    state.sunBank += cobrado.coste
    if (cobrado.slot !== null) state.slotCooldowns[cobrado.slot] = 0
    else state.cooldowns[cobrado.carta] = 0
    if (state.stats.plantsPlaced > 0) state.stats.plantsPlaced -= 1
    costeDeMisJugadas.delete(clave)
  }

  return { ok: true, eliminado: true, nuevoHistorial, nuevoRegistro }
}
