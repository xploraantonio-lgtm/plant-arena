// ─────────────────────────────────────────────────────────────────────────────
// HISTORIAL AUTORITATIVO DE ACCIONES DE P1 — RANKED ASÍNCRONO V1 (FAIL CLOSED)
//
// Módulo puro para validar, insertar, deduplicar y descartar acciones de P1 en
// partidas asíncronas de Ranked. Compartido al 100% entre useGameEngine y la
// suite de tests.
//
// PRINCIPIOS FAIL CLOSED:
// 1. seq obligatorio y entero no negativo.
// 2. issuedTick obligatorio y entero no negativo.
// 3. kind estrictamente 'plant' | 'dig' | 'collect'.
// 4. COLLECT requiere targetId no vacío.
// 5. PLANT requiere plantId, slot (0..3), lane (0..2), col (0..3).
// 6. DIG requiere lane (0..2), col (0..3).
// 7. Mismo seq + misma acción = idempotencia segura.
// 8. Mismo seq + contenido diferente = SEQ_CONFLICT.
// 9. Rollback sólo por seq exacto; sin seq no adivina por coordenadas.
// ─────────────────────────────────────────────────────────────────────────────

import type { PlantId, PlantStatKey } from '../types/game.ts'
import { PLANT_CONFIGS, P1_COLUMNS, P2_COLUMNS, DECK_SIZE } from '../utils/gameConstants.ts'
import { MARGEN_DE_RED_TICS } from './pvp.ts'

export type InconsistenciaHistorialP1 =
  | 'MISSING_SEQ'
  | 'INVALID_SEQ'
  | 'MISSING_ISSUED_TICK'
  | 'INVALID_ISSUED_TICK'
  | 'MISSING_TICK'
  | 'INVALID_TICK'
  | 'INVALID_TICK_RELATION'
  | 'INVALID_KIND'
  | 'MISSING_TARGET_ID'
  | 'INVALID_PLANT_DATA'
  | 'INVALID_DIG_DATA'
  | 'SEQ_CONFLICT'
  | 'UNKNOWN_PENDING_ACTION'
  | 'INVALID_P1_ACTIONS_CONTAINER'
  | 'INVALID_P1_DECK'
  | 'INVALID_ASYNC_INTENTS_CONTAINER'
  | 'INVALID_ASYNC_INTENT_DATA'
  | 'TIMELINE_INCONSISTENT'

export interface AccionP1RankedEstricta {
  seq: number
  tick: number
  issuedTick: number
  kind: 'plant' | 'dig' | 'collect'
  plantId?: PlantId
  lane?: number
  col?: number
  slot?: number
  targetId?: string
  statRolls?: PlantStatKey[]
  level?: number
}

// Tipo de compatibilidad para código existente
export type AccionP1Simulacion = AccionP1RankedEstricta

export const ESTADISTICAS_VALIDAS = new Set<PlantStatKey>([
  'hp',
  'damage',
  'attackSpeed',
  'moveSpeed',
  'cooldown',
])

export function esPlantId(x: string | null | undefined): x is PlantId {
  return !!x && Object.prototype.hasOwnProperty.call(PLANT_CONFIGS, x)
}

/**
 * Valida estrictamente una acción individual de P1 para Ranked Asíncrono.
 *
 * NO infiere seq desde id.
 * NO infiere issuedTick desde tick ni viceversa.
 * NO realiza clamps silenciosos de coordenadas.
 * NO filtra silenciosamente estadísticas inválidas ni coacciona levels.
 */
export function validarAccionP1RankedEstricta(
  raw: unknown
):
  | { ok: true; accion: AccionP1RankedEstricta }
  | { ok: false; reason: InconsistenciaHistorialP1; seq?: number; issuedTick?: number; details?: string } {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, reason: 'INVALID_KIND', details: 'Acción no es un objeto' }
  }

  const a = raw as Record<string, unknown>

  const rawIssuedTick =
    typeof a.issuedTick === 'number' && Number.isInteger(a.issuedTick) && a.issuedTick >= 0
      ? a.issuedTick
      : undefined

  // 1. Validación de seq (obligatorio, entero >= 0)
  if (a.seq === undefined || a.seq === null) {
    return {
      ok: false,
      reason: 'MISSING_SEQ',
      issuedTick: rawIssuedTick,
      details: 'seq es obligatorio en Ranked Async',
    }
  }
  if (typeof a.seq !== 'number' || !Number.isInteger(a.seq) || a.seq < 0) {
    return {
      ok: false,
      reason: 'INVALID_SEQ',
      issuedTick: rawIssuedTick,
      details: `seq debe ser un entero no negativo, recibido: ${String(a.seq)}`,
    }
  }
  const seq = a.seq

  // 2. Validación de issuedTick (obligatorio, entero >= 0)
  if (a.issuedTick === undefined || a.issuedTick === null) {
    return { ok: false, reason: 'MISSING_ISSUED_TICK', seq, details: 'issuedTick es obligatorio en Ranked Async' }
  }
  if (typeof a.issuedTick !== 'number' || !Number.isInteger(a.issuedTick) || a.issuedTick < 0) {
    return {
      ok: false,
      reason: 'INVALID_ISSUED_TICK',
      seq,
      details: `issuedTick debe ser un entero no negativo, recibido: ${String(a.issuedTick)}`,
    }
  }
  const issuedTick = a.issuedTick

  // 3. Validación de tick (obligatorio, entero >= 0, sin fallback)
  if (a.tick === undefined || a.tick === null) {
    return { ok: false, reason: 'MISSING_TICK', seq, issuedTick, details: 'tick es obligatorio en Ranked Async' }
  }
  if (typeof a.tick !== 'number' || !Number.isInteger(a.tick) || a.tick < 0) {
    return {
      ok: false,
      reason: 'INVALID_TICK',
      seq,
      issuedTick,
      details: `tick debe ser un entero no negativo, recibido: ${String(a.tick)}`,
    }
  }
  const tick = a.tick

  // 4. Validación de kind (estrictamente 'plant' | 'dig' | 'collect')
  if (a.kind !== 'plant' && a.kind !== 'dig' && a.kind !== 'collect') {
    return {
      ok: false,
      reason: 'INVALID_KIND',
      seq,
      issuedTick,
      details: `kind debe ser plant, dig o collect, recibido: ${String(a.kind)}`,
    }
  }
  const kind = a.kind

  // 5. Validación de relación temporal fija del protocolo
  if (kind === 'collect') {
    if (tick !== issuedTick) {
      return {
        ok: false,
        reason: 'INVALID_TICK_RELATION',
        seq,
        issuedTick,
        details: `Para collect tick (${tick}) debe ser igual a issuedTick (${issuedTick})`,
      }
    }
  } else {
    // plant y dig
    if (tick !== issuedTick + MARGEN_DE_RED_TICS) {
      return {
        ok: false,
        reason: 'INVALID_TICK_RELATION',
        seq,
        issuedTick,
        details: `Para ${kind} tick (${tick}) debe ser issuedTick (${issuedTick}) + ${MARGEN_DE_RED_TICS}`,
      }
    }
  }

  // 6. Validación por kind
  if (kind === 'collect') {
    if (typeof a.targetId !== 'string' || a.targetId.trim().length === 0) {
      return {
        ok: false,
        reason: 'MISSING_TARGET_ID',
        seq,
        issuedTick,
        details: 'targetId es obligatorio y no vacío para collect',
      }
    }
    return {
      ok: true,
      accion: {
        seq,
        tick,
        issuedTick,
        kind: 'collect',
        targetId: a.targetId.trim(),
      },
    }
  }

  if (kind === 'dig') {
    if (
      typeof a.lane !== 'number' ||
      !Number.isInteger(a.lane) ||
      a.lane < 0 ||
      a.lane > 2 ||
      typeof a.col !== 'number' ||
      !Number.isInteger(a.col) ||
      a.col < 0 ||
      a.col >= P1_COLUMNS
    ) {
      return {
        ok: false,
        reason: 'INVALID_DIG_DATA',
        seq,
        issuedTick,
        details: `Coordenadas de dig inválidas: lane=${String(a.lane)}, col=${String(a.col)}`,
      }
    }
    return {
      ok: true,
      accion: {
        seq,
        tick,
        issuedTick,
        kind: 'dig',
        lane: a.lane,
        col: a.col,
      },
    }
  }

  if (kind === 'plant') {
    const plantId = typeof a.plantId === 'string' ? a.plantId : null
    if (!esPlantId(plantId)) {
      return {
        ok: false,
        reason: 'INVALID_PLANT_DATA',
        seq,
        issuedTick,
        details: `plantId desconocido o ausente: ${String(plantId)}`,
      }
    }
    if (typeof a.slot !== 'number' || !Number.isInteger(a.slot) || a.slot < 0 || a.slot >= DECK_SIZE) {
      return {
        ok: false,
        reason: 'INVALID_PLANT_DATA',
        seq,
        issuedTick,
        details: `slot debe ser un entero 0..${DECK_SIZE - 1}, recibido: ${String(a.slot)}`,
      }
    }
    if (typeof a.lane !== 'number' || !Number.isInteger(a.lane) || a.lane < 0 || a.lane > 2) {
      return {
        ok: false,
        reason: 'INVALID_PLANT_DATA',
        seq,
        issuedTick,
        details: `lane debe ser un entero 0..2, recibido: ${String(a.lane)}`,
      }
    }
    if (typeof a.col !== 'number' || !Number.isInteger(a.col) || a.col < 0 || a.col >= P1_COLUMNS) {
      return {
        ok: false,
        reason: 'INVALID_PLANT_DATA',
        seq,
        issuedTick,
        details: `col debe ser un entero 0..${P1_COLUMNS - 1}, recibido: ${String(a.col)}`,
      }
    }

    // Validación estricta de statRolls (sin filtrado silencioso de datos corruptos)
    let statRolls: PlantStatKey[] | undefined = undefined
    if (a.statRolls !== undefined && a.statRolls !== null) {
      if (!Array.isArray(a.statRolls)) {
        return {
          ok: false,
          reason: 'INVALID_PLANT_DATA',
          seq,
          issuedTick,
          details: 'statRolls debe ser un array',
        }
      }
      for (const r of a.statRolls) {
        if (typeof r !== 'string' || !ESTADISTICAS_VALIDAS.has(r as PlantStatKey)) {
          return {
            ok: false,
            reason: 'INVALID_PLANT_DATA',
            seq,
            issuedTick,
            details: `statRolls contiene valor inválido: ${String(r)}`,
          }
        }
      }
      if (a.statRolls.length > 0) {
        statRolls = a.statRolls as PlantStatKey[]
      }
    }

    // Validación estricta de level (sin coerción silenciosa)
    let level: number | undefined = undefined
    if (a.level !== undefined && a.level !== null) {
      if (typeof a.level !== 'number' || !Number.isInteger(a.level) || a.level < 0) {
        return {
          ok: false,
          reason: 'INVALID_PLANT_DATA',
          seq,
          issuedTick,
          details: `level debe ser un entero no negativo, recibido: ${String(a.level)}`,
        }
      }
      if (a.level > 0) {
        level = a.level
      }
    }

    return {
      ok: true,
      accion: {
        seq,
        tick,
        issuedTick,
        kind: 'plant',
        plantId,
        slot: a.slot,
        lane: a.lane,
        col: a.col,
        statRolls,
        level,
      },
    }
  }

  return { ok: false, reason: 'INVALID_KIND', seq, issuedTick }
}

/**
 * Comprueba si dos acciones con la misma secuencia son idénticas campo por campo.
 */
export function sonAccionesIdenticas(a: AccionP1RankedEstricta, b: AccionP1RankedEstricta): boolean {
  if (a.seq !== b.seq || a.kind !== b.kind || a.issuedTick !== b.issuedTick || a.tick !== b.tick) return false
  if (a.kind === 'collect') {
    return a.targetId === b.targetId
  }
  if (a.kind === 'dig') {
    return a.lane === b.lane && a.col === b.col
  }
  if (a.kind === 'plant') {
    return (
      a.plantId === b.plantId &&
      a.slot === b.slot &&
      a.lane === b.lane &&
      a.col === b.col &&
      (a.level ?? 0) === (b.level ?? 0) &&
      JSON.stringify(a.statRolls ?? []) === JSON.stringify(b.statRolls ?? [])
    )
  }
  return false
}

export type ResultadoRegistroAccionP1 =
  | { ok: true; duplicated?: boolean }
  | { ok: false; reason: InconsistenciaHistorialP1; seq?: number; issuedTick?: number; details?: string }

/**
 * Registra una acción en el historial autoritativo de P1 con validación estricta y resultado detallado.
 */
export function registrarAccionP1AsyncDetallado(
  historial: AccionP1RankedEstricta[],
  accionRaw: unknown
): ResultadoRegistroAccionP1 {
  const val = validarAccionP1RankedEstricta(accionRaw)
  if (!val.ok) {
    return val
  }

  const accion = val.accion
  const existente = historial.find((a) => a.seq === accion.seq)

  if (existente) {
    if (sonAccionesIdenticas(existente, accion)) {
      // Idempotente: misma seq, misma acción -> se acepta sin duplicar
      return { ok: true, duplicated: true }
    }
    // Conflicto de secuencia: misma seq con contenido diferente
    return {
      ok: false,
      reason: 'SEQ_CONFLICT',
      seq: accion.seq,
      issuedTick: accion.issuedTick,
      details: `Conflicto de secuencia: seq ${accion.seq} ya registrado con acción distinta (${existente.kind} vs ${accion.kind})`,
    }
  }

  historial.push(accion)
  return { ok: true }
}

/**
 * Registra una acción en el historial autoritativo de P1 para partidas Ranked asíncronas.
 * Devuelve true si fue agregada o si era un duplicado idempotente, false si falló la validación o hubo conflicto.
 */
export function registrarAccionP1Async(
  historial: AccionP1RankedEstricta[],
  accionRaw: unknown
): boolean {
  const res = registrarAccionP1AsyncDetallado(historial, accionRaw)
  // Devuelve true solo si se insertó con éxito una acción nueva
  if (!res.ok) return false
  if (res.duplicated) return false // Devuelve false si era duplicado para coincidir con la semántica de "no se añadió nuevo elemento"
  return true
}

export type ResultadoDescarteAccionP1 =
  | { ok: true; eliminado: boolean; historial: AccionP1RankedEstricta[] }
  | { ok: false; reason: InconsistenciaHistorialP1; details?: string; historial: AccionP1RankedEstricta[] }

/**
 * Descarta una acción del historial autoritativo de P1 con resultado detallado.
 * En Ranked Async nuevo no se adivina por coordenadas ni por tick.
 */
export function descartarAccionP1AsyncDetallado(
  historial: AccionP1RankedEstricta[],
  seq?: number
): ResultadoDescarteAccionP1 {
  if (seq === undefined || seq === null) {
    return {
      ok: false,
      reason: 'MISSING_SEQ',
      details: 'seq es obligatorio para descartar acción en Ranked Async',
      historial,
    }
  }
  if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 0) {
    return {
      ok: false,
      reason: 'INVALID_SEQ',
      details: `seq inválido para descarte: ${String(seq)}`,
      historial,
    }
  }

  const antes = historial.length
  const filtrado = historial.filter((a) => a.seq !== seq)
  return {
    ok: true,
    eliminado: filtrado.length < antes,
    historial: filtrado,
  }
}

/**
 * Descarta una acción del historial autoritativo de P1 exclusivamente por `seq`.
 * En Ranked Async nuevo no se adivina por coordenadas ni por tick.
 */
export function descartarAccionP1Async(
  historial: AccionP1RankedEstricta[],
  seq?: number
): AccionP1RankedEstricta[] {
  const res = descartarAccionP1AsyncDetallado(historial, seq)
  return res.historial
}

export type ResultadoValidacionHistorialP1 =
  | { ok: true; acciones: AccionP1RankedEstricta[] }
  | { ok: false; reason: InconsistenciaHistorialP1; seq?: number; issuedTick?: number; details?: string }

/**
 * Valida y normaliza un lote completo de acciones de P1 para Ranked Async.
 * Ordena estrictamente por issuedTick ASC, seq ASC.
 */
export function validarYNormalizarAccionesP1Ranked(
  rawActions: unknown
): ResultadoValidacionHistorialP1 {
  if (!Array.isArray(rawActions)) {
    return {
      ok: false,
      reason: 'INVALID_P1_ACTIONS_CONTAINER',
      details: `rawActions debe ser un array, recibido: ${typeof rawActions}`,
    }
  }

  const validadas: AccionP1RankedEstricta[] = []
  const seqMap = new Map<number, AccionP1RankedEstricta>()

  for (const raw of rawActions) {
    const val = validarAccionP1RankedEstricta(raw)
    if (!val.ok) {
      return val
    }

    const accion = val.accion
    const existente = seqMap.get(accion.seq)
    if (existente) {
      if (sonAccionesIdenticas(existente, accion)) {
        continue // duplicado idempotente
      }
      return {
        ok: false,
        reason: 'SEQ_CONFLICT',
        seq: accion.seq,
        issuedTick: accion.issuedTick,
        details: `Conflicto en lote: seq ${accion.seq} duplicado con contenido distinto`,
      }
    }

    seqMap.set(accion.seq, accion)
    validadas.push(accion)
  }

  validadas.sort((a, b) => {
    if (a.issuedTick !== b.issuedTick) return a.issuedTick - b.issuedTick
    return a.seq - b.seq
  })

  return { ok: true, acciones: validadas }
}

// ─────────────────────────────────────────────────────────────────────────────
// VALIDACIÓN ESTRICTA DE INTENCIONES DE P2 / RIVAL SEMILLA
// ─────────────────────────────────────────────────────────────────────────────

export interface AsyncOpponentIntentRankedEstricta {
  seq: number
  tick: number
  issuedTick: number
  kind: 'plant' | 'dig'
  plantId?: PlantId
  slot?: number
  lane: number
  col?: number
}

export function validarIntencionAsyncRankedEstricta(
  raw: unknown
):
  | { ok: true; intencion: AsyncOpponentIntentRankedEstricta }
  | { ok: false; reason: InconsistenciaHistorialP1; seq?: number; issuedTick?: number; details?: string } {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, reason: 'INVALID_ASYNC_INTENT_DATA', details: 'Intención P2 no es un objeto' }
  }

  const a = raw as Record<string, unknown>

  const rawIssuedTick =
    typeof a.issuedTick === 'number' && Number.isInteger(a.issuedTick) && a.issuedTick >= 0
      ? a.issuedTick
      : (typeof a.issued_tick === 'number' && Number.isInteger(a.issued_tick) && a.issued_tick >= 0 ? a.issued_tick : undefined)

  // 1. seq
  if (a.seq === undefined || a.seq === null) {
    return { ok: false, reason: 'MISSING_SEQ', issuedTick: rawIssuedTick, details: 'seq es obligatorio en intención P2' }
  }
  if (typeof a.seq !== 'number' || !Number.isInteger(a.seq) || a.seq < 0) {
    return { ok: false, reason: 'INVALID_SEQ', issuedTick: rawIssuedTick, details: `seq P2 inválido: ${String(a.seq)}` }
  }
  const seq = a.seq

  // 2. issuedTick
  if (rawIssuedTick === undefined) {
    return { ok: false, reason: 'MISSING_ISSUED_TICK', seq, details: 'issuedTick es obligatorio en intención P2' }
  }
  const issuedTick = rawIssuedTick

  // 3. tick
  if (a.tick === undefined || a.tick === null) {
    return { ok: false, reason: 'MISSING_TICK', seq, issuedTick, details: 'tick es obligatorio en intención P2' }
  }
  if (typeof a.tick !== 'number' || !Number.isInteger(a.tick) || a.tick < 0) {
    return { ok: false, reason: 'INVALID_TICK', seq, issuedTick, details: `tick P2 inválido: ${String(a.tick)}` }
  }
  const tick = a.tick

  // 4. kind
  if (a.kind !== 'plant' && a.kind !== 'dig') {
    return { ok: false, reason: 'INVALID_KIND', seq, issuedTick, details: `kind P2 debe ser plant o dig, recibido: ${String(a.kind)}` }
  }
  const kind = a.kind

  // 5. Relación temporal
  if (tick !== issuedTick + MARGEN_DE_RED_TICS && tick !== issuedTick) {
    return {
      ok: false,
      reason: 'INVALID_TICK_RELATION',
      seq,
      issuedTick,
      details: `tick P2 (${tick}) debe ser issuedTick (${issuedTick}) + ${MARGEN_DE_RED_TICS} o ${issuedTick}`,
    }
  }

  // 6. Coordenadas y datos específicos
  if (typeof a.lane !== 'number' || !Number.isInteger(a.lane) || a.lane < 0 || a.lane > 2) {
    return { ok: false, reason: 'INVALID_ASYNC_INTENT_DATA', seq, issuedTick, details: `lane P2 inválido: ${String(a.lane)}` }
  }

  if (kind === 'dig') {
    if (typeof a.col !== 'number' || !Number.isInteger(a.col) || a.col < 0 || a.col >= P2_COLUMNS) {
      return { ok: false, reason: 'INVALID_DIG_DATA', seq, issuedTick, details: `col de dig P2 inválida: ${String(a.col)}` }
    }
    return {
      ok: true,
      intencion: {
        seq,
        tick,
        issuedTick,
        kind: 'dig',
        lane: a.lane,
        col: a.col,
      },
    }
  }

  // plant
  const plantId = (typeof a.plantId === 'string' ? a.plantId : (typeof a.plant_id === 'string' ? a.plant_id : null)) as PlantId | null
  if (!esPlantId(plantId)) {
    return { ok: false, reason: 'INVALID_PLANT_DATA', seq, issuedTick, details: `plantId P2 inválido: ${String(plantId)}` }
  }

  let slot: number | undefined = undefined
  if (a.slot !== undefined && a.slot !== null) {
    if (typeof a.slot !== 'number' || !Number.isInteger(a.slot) || a.slot < 0 || a.slot >= DECK_SIZE) {
      return { ok: false, reason: 'INVALID_PLANT_DATA', seq, issuedTick, details: `slot P2 inválido: ${String(a.slot)}` }
    }
    slot = a.slot
  }

  let col: number | undefined = undefined
  if (a.col !== undefined && a.col !== null) {
    if (typeof a.col !== 'number' || !Number.isInteger(a.col) || a.col < 0 || a.col >= P2_COLUMNS) {
      return { ok: false, reason: 'INVALID_PLANT_DATA', seq, issuedTick, details: `col P2 inválida: ${String(a.col)}` }
    }
    col = a.col
  }

  return {
    ok: true,
    intencion: {
      seq,
      tick,
      issuedTick,
      kind: 'plant',
      plantId,
      slot,
      lane: a.lane,
      col,
    },
  }
}

export type ResultadoValidacionIntencionesP2 =
  | { ok: true; intenciones: AsyncOpponentIntentRankedEstricta[] }
  | { ok: false; reason: InconsistenciaHistorialP1; seq?: number; issuedTick?: number; details?: string }

export function validarYNormalizarIntencionesAsyncRanked(
  rawIntents: unknown
): ResultadoValidacionIntencionesP2 {
  if (!Array.isArray(rawIntents)) {
    return {
      ok: false,
      reason: 'INVALID_ASYNC_INTENTS_CONTAINER',
      details: `rawIntents debe ser un array, recibido: ${typeof rawIntents}`,
    }
  }

  const validadas: AsyncOpponentIntentRankedEstricta[] = []
  const seqMap = new Map<number, AsyncOpponentIntentRankedEstricta>()

  for (const raw of rawIntents) {
    const val = validarIntencionAsyncRankedEstricta(raw)
    if (!val.ok) {
      return val
    }

    const intent = val.intencion
    const existente = seqMap.get(intent.seq)
    if (existente) {
      if (
        existente.seq === intent.seq &&
        existente.kind === intent.kind &&
        existente.issuedTick === intent.issuedTick &&
        existente.tick === intent.tick &&
        existente.lane === intent.lane &&
        existente.col === intent.col &&
        existente.plantId === intent.plantId &&
        existente.slot === intent.slot
      ) {
        continue // duplicado idempotente
      }
      return {
        ok: false,
        reason: 'SEQ_CONFLICT',
        seq: intent.seq,
        issuedTick: intent.issuedTick,
        details: `Conflicto en intenciones P2: seq ${intent.seq} duplicado con contenido distinto`,
      }
    }

    seqMap.set(intent.seq, intent)
    validadas.push(intent)
  }

  validadas.sort((a, b) => {
    if (a.issuedTick !== b.issuedTick) return a.issuedTick - b.issuedTick
    return a.seq - b.seq
  })

  return { ok: true, intenciones: validadas }
}
