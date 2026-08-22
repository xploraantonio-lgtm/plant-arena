// ─────────────────────────────────────────────────────────────────────────────
// HISTORIAL AUTORITATIVO DE ACCIONES DE P1 — RANKED ASÍNCRONO V1
//
// Módulo puro para insertar, deduplicar y descartar acciones de P1 en partidas
// asíncronas de Ranked. Compartido al 100% entre useGameEngine y la suite de tests.
// ─────────────────────────────────────────────────────────────────────────────

import type { AccionP1Simulacion } from './asyncOpponent.ts'

/**
 * Registra una acción en el historial autoritativo de P1 para partidas Ranked asíncronas.
 *
 * Garantías:
 * 1. Si la acción tiene `seq` numérico, no permite registrar otra acción con el mismo `seq`
 *    (deduplicación estricta por identidad de secuencia).
 * 2. Si no tiene `seq`, realiza deduplicación por (kind + targetId/lane/col + issuedTick).
 * 3. Añade la acción al array `historial` y devuelve `true` si fue registrada, o `false`
 *    si fue ignorada por ser duplicada.
 */
export function registrarAccionP1Async(
  historial: AccionP1Simulacion[],
  accion: AccionP1Simulacion
): boolean {
  if (!accion || typeof accion !== 'object') return false

  // 1. Deduplicación por seq (identificador primario autoritativo)
  if (typeof accion.seq === 'number' && Number.isFinite(accion.seq)) {
    const yaExiste = historial.some((a) => a.seq === accion.seq)
    if (yaExiste) return false
  } else {
    // 2. Fallback de seguridad si no hay seq
    if (accion.kind === 'collect') {
      const yaExiste = historial.some(
        (a) =>
          a.kind === 'collect' &&
          a.targetId === accion.targetId &&
          a.issuedTick === accion.issuedTick
      )
      if (yaExiste) return false
    } else {
      const yaExiste = historial.some(
        (a) =>
          a.kind === accion.kind &&
          a.lane === accion.lane &&
          a.col === accion.col &&
          a.tick === accion.tick
      )
      if (yaExiste) return false
    }
  }

  historial.push(accion)
  return true
}

/**
 * Descarta una acción del historial autoritativo de P1 (ej. cuando el servidor rechaza una jugada).
 *
 * Prioriza filtrado por `seq` exacto. Si no se provee `seq`, utiliza el fallback de tick/lane/col.
 */
export function descartarAccionP1Async(
  historial: AccionP1Simulacion[],
  seq?: number,
  fallback?: { tick: number; lane: number; col: number | null }
): AccionP1Simulacion[] {
  if (typeof seq === 'number' && Number.isFinite(seq)) {
    return historial.filter((a) => a.seq !== seq)
  }

  if (fallback) {
    const { tick, lane, col } = fallback
    return historial.filter(
      (a) => !(a.tick === tick && a.lane === lane && (a.col ?? null) === col)
    )
  }

  return historial
}
