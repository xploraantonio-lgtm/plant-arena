/**
 * EL TIEMPO DE LA SIMULACIÓN SE MIDE EN TICS
 *
 * El motor mezclaba dos relojes de pared dentro de la lógica de juego:
 * performance.now() en el bucle y Date.now() en los enfriamientos, 46 lecturas
 * en total. Un enfriamiento guardado como `Date.now() + 7500` no se puede
 * reproducir: depende de cuándo se jugó.
 *
 * A partir de aquí el único reloj es `state.tick`, un contador entero que sólo
 * avanza dentro de la simulación. Un enfriamiento de 7,5 s son 227 tics, y eso
 * es reproducible en cualquier máquina y en cualquier momento.
 */

/**
 * Duración de un tic. Se mantiene en 33 ms porque es el sub-paso que ya usaba el
 * motor (`stepDt = 0.033`), así que la física y los equilibrios de daño no
 * cambian: sólo deja de haber pasos parciales.
 *
 * 33 ms ≈ 30,3 tics por segundo.
 */
export const TICK_MS = 33

/** Segundos que representa un tic. Equivale al viejo `stepDt`. */
export const TICK_SECONDS = TICK_MS / 1000

/** Tics por segundo, para las conversiones más legibles. */
export const TICKS_PER_SECOND = 1000 / TICK_MS

/**
 * Límite de tics que se pueden ejecutar de golpe.
 *
 * Si la pestaña estuvo en segundo plano un minuto, el acumulador tendría 1.800
 * tics pendientes y ejecutarlos todos congelaría la interfaz. El motor ya tenía
 * este tope con `Math.min(dt, 5.0)`; aquí son los mismos 5 segundos.
 *
 * OJO: al descartar tics, la partida deja de ser reproducible. Por eso una
 * repetición o una verificación NUNCA usa este tope: ejecuta todos los tics
 * seguidos, sin depender de fotogramas.
 */
export const MAX_TICKS_PER_FRAME = Math.ceil(5000 / TICK_MS)

/**
 * Milisegundos a tics, redondeando hacia arriba.
 *
 * Hacia arriba y no al más cercano a propósito: un enfriamiento nunca debe
 * quedar más corto de lo que dice la carta. Con 7.500 ms salen 228 tics
 * (7.524 ms reales), 24 ms de más en lugar de 9 de menos.
 */
export function msToTicks(ms: number): number {
  return Math.ceil(ms / TICK_MS)
}

/** Tics a milisegundos. Para mostrar cuentas atrás en la interfaz. */
export function ticksToMs(ticks: number): number {
  return ticks * TICK_MS
}

/** Segundos a tics. Azúcar sobre msToTicks para las constantes del juego. */
export function secondsToTicks(seconds: number): number {
  return msToTicks(seconds * 1000)
}

/**
 * ¿Ha vencido ya un plazo?
 *
 * Sustituye al patrón `Date.now() > state.cooldowns[card]`. El plazo se guarda
 * como el tic en el que expira, así que la comparación es entre enteros.
 */
export function isReady(currentTick: number, readyAtTick: number): boolean {
  return currentTick >= readyAtTick
}

/** Tics que faltan para un plazo. Nunca negativo. */
export function ticksRemaining(currentTick: number, readyAtTick: number): number {
  return Math.max(0, readyAtTick - currentTick)
}

/**
 * Texto de cuenta atrás para la interfaz, a partir de tics.
 * Sólo presentación: no forma parte de la simulación.
 */
export function formatTicksAsSeconds(ticks: number): string {
  const s = ticksToMs(ticks) / 1000
  return s >= 10 ? `${Math.ceil(s)}s` : `${s.toFixed(1)}s`
}
