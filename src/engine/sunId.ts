// ─────────────────────────────────────────────────────────────────────────────
// IDENTIFICADORES DETERMINISTAS DE SOLES
//
// Un sol en Plant Arena se identifica exclusivamente por información canónica
// y determinista del evento que lo originó, NUNCA por contadores globales
// volátiles (como entityCounter) que puedan divergir entre el cliente y el
// árbitro debido a la cadencia de proyectiles o paquetes de red en tránsito.
// ─────────────────────────────────────────────────────────────────────────────

export type SunSource =
  | { type: 'sky'; tick: number; seq: number }
  | { type: 'flower'; lane: number; col: number | undefined; tick: number; subIndex?: number }

/**
 * Genera el ID canónico de un sol caído del cielo.
 * @param tick Tic exacto del motor en que se generó el sol.
 * @param seq Secuencia monotónica exclusiva de soles del cielo (skySunSeq).
 */
export function crearSkySunId(tick: number, seq: number): string {
  return `sun-sky-${tick}-${seq}`
}

/**
 * Genera el ID canónico de un sol producido por un girasol o girasol doble.
 * @param lane Fila/carril donde está plantado el girasol (0..4).
 * @param col Columna donde está plantado el girasol (0..5).
 * @param tick Tic exacto del motor en que ocurrió la producción.
 * @param subIndex Índice del sol en este ciclo (0 para girasol simple, 0..1 para doble).
 */
export function crearSunflowerSunId(
  lane: number,
  col: number | undefined,
  tick: number,
  subIndex = 0
): string {
  const c = typeof col === 'number' && Number.isFinite(col) ? col : 0
  return `sun-flower-${lane}-${c}-${tick}-${subIndex}`
}

/**
 * Función unificada para generar el ID canónico de cualquier sol.
 */
export function crearSunId(source: SunSource): string {
  if (source.type === 'sky') {
    return crearSkySunId(source.tick, source.seq)
  }
  return crearSunflowerSunId(source.lane, source.col, source.tick, source.subIndex)
}
