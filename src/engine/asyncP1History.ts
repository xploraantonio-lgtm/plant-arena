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
import { PLANT_CONFIGS, P1_COLUMNS } from '../utils/gameConstants.ts'

export type InconsistenciaHistorialP1 =
  | 'MISSING_SEQ'
  | 'INVALID_SEQ'
  | 'MISSING_ISSUED_TICK'
  | 'INVALID_ISSUED_TICK'
  | 'INVALID_KIND'
  | 'MISSING_TARGET_ID'
  | 'INVALID_PLANT_DATA'
  | 'INVALID_DIG_DATA'
  | 'SEQ_CONFLICT'
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

function rollsValidos(brutos: unknown): PlantStatKey[] {
  if (!Array.isArray(brutos)) return []
  return brutos.filter((r): r is PlantStatKey =>
    typeof r === 'string' && ESTADISTICAS_VALIDAS.has(r as PlantStatKey)
  )
}

/**
 * Valida estrictamente una acción individual de P1 para Ranked Asíncrono.
 *
 * NO infiere seq desde id.
 * NO infiere issuedTick desde tick.
 * NO realiza clamps silenciosos de coordenadas.
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

  // 1. Validación de seq (obligatorio, entero >= 0)
  if (a.seq === undefined || a.seq === null) {
    return { ok: false, reason: 'MISSING_SEQ', details: 'seq es obligatorio en Ranked Async' }
  }
  if (typeof a.seq !== 'number' || !Number.isInteger(a.seq) || a.seq < 0) {
    return { ok: false, reason: 'INVALID_SEQ', details: `seq debe ser un entero no negativo, recibido: ${String(a.seq)}` }
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
  const tick = typeof a.tick === 'number' && Number.isInteger(a.tick) && a.tick >= 0 ? a.tick : issuedTick

  // 3. Validación de kind (estrictamente 'plant' | 'dig' | 'collect')
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

  // 4. Validación por kind
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
    if (typeof a.slot !== 'number' || !Number.isInteger(a.slot) || a.slot < 0 || a.slot > 5) {
      return {
        ok: false,
        reason: 'INVALID_PLANT_DATA',
        seq,
        issuedTick,
        details: `slot debe ser un entero 0..5, recibido: ${String(a.slot)}`,
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

    const statRolls = rollsValidos(a.statRolls)
    const level = typeof a.level === 'number' && Number.isInteger(a.level) && a.level >= 0 ? a.level : 0

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
        statRolls: statRolls.length > 0 ? statRolls : undefined,
        level: level > 0 ? level : undefined,
      },
    }
  }

  return { ok: false, reason: 'INVALID_KIND', seq, issuedTick }
}

/**
 * Comprueba si dos acciones con la misma secuencia son idénticas campo por campo.
 */
export function sonAccionesIdenticas(a: AccionP1RankedEstricta, b: AccionP1RankedEstricta): boolean {
  if (a.seq !== b.seq || a.kind !== b.kind || a.issuedTick !== b.issuedTick) return false
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

/**
 * Descarta una acción del historial autoritativo de P1 exclusivamente por `seq`.
 * En Ranked Async nuevo no se adivina por coordenadas ni por tick.
 */
export function descartarAccionP1Async(
  historial: AccionP1RankedEstricta[],
  seq?: number
): AccionP1RankedEstricta[] {
  if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 0) {
    // Si no hay seq válido, fail closed: no se descarta nada por adivinación
    return historial
  }

  return historial.filter((a) => a.seq !== seq)
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
  if (!Array.isArray(rawActions)) return { ok: true, acciones: [] }

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
