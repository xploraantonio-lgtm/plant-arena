/**
 * GENERADOR DE NÚMEROS ALEATORIOS CON SEMILLA
 *
 * Sustituye a Math.random() dentro de la simulación. El motor tenía 20 llamadas
 * a Math.random() en la lógica de juego, así que dos ejecuciones con la misma
 * entrada daban partidas distintas. Eso impide que el servidor recalcule una
 * partida para comprobar quién ganó, y que una repetición reproduzca lo que pasó.
 *
 * Algoritmo: mulberry32. Se elige porque es diminuto, rápido, y su estado es un
 * solo entero de 32 bits — así el generador entero cabe en el estado de la
 * partida y se puede guardar, restaurar y comparar.
 *
 * DECISIÓN DE DISEÑO: el estado es explícito, no una clausura.
 *   Un `function makeRng(seed) { let s = seed; return () => ... }` sería más
 *   corto, pero su estado quedaría escondido dentro de la clausura. Aquí el
 *   estado es un campo público, y eso permite tres cosas que hacen falta:
 *     · meter el generador dentro del estado de la partida,
 *     · comparar dos simulaciones campo a campo para detectar divergencias,
 *     · reanudar una repetición desde la mitad.
 */

export interface Rng {
  /** Estado interno. Público a propósito: forma parte del estado de la partida. */
  s: number
}

/** Crea un generador a partir de una semilla entera (la de game_rooms.seed). */
export function createRng(seed: number): Rng {
  // >>> 0 fuerza a entero de 32 bits sin signo. Sin esto, una semilla negativa o
  // fraccionaria daría secuencias distintas según cómo llegara el número.
  return { s: seed >>> 0 }
}

/** Copia independiente. Útil para explorar sin alterar la secuencia real. */
export function cloneRng(rng: Rng): Rng {
  return { s: rng.s }
}

/**
 * Siguiente número en [0, 1). Equivalente a Math.random(), pero reproducible.
 * Avanza el estado: dos llamadas seguidas dan valores distintos, y la misma
 * semilla da siempre la misma secuencia.
 */
export function nextFloat(rng: Rng): number {
  rng.s = (rng.s + 0x6d2b79f5) >>> 0
  let t = rng.s
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

/** Entero en [0, max). Sustituye a Math.floor(Math.random() * max). */
export function nextInt(rng: Rng, max: number): number {
  if (max <= 0) return 0
  return Math.floor(nextFloat(rng) * max)
}

/** Entero en [min, max], ambos incluidos. */
export function nextRange(rng: Rng, min: number, max: number): number {
  if (max <= min) return min
  return min + nextInt(rng, max - min + 1)
}

/** ¿Ocurre un suceso de probabilidad p? Sustituye a Math.random() < p. */
export function chance(rng: Rng, p: number): boolean {
  return nextFloat(rng) < p
}

/** Elemento al azar de un array. Devuelve undefined si está vacío. */
export function pick<T>(rng: Rng, arr: readonly T[]): T | undefined {
  if (arr.length === 0) return undefined
  return arr[nextInt(rng, arr.length)]
}

/**
 * Identificador único para una entidad, derivado del tic y de un contador.
 *
 * El motor generaba los ids con `plant-${Date.now()}-${Math.random()}`, que es
 * distinto en cada ejecución. Al comparar dos simulaciones para detectar
 * divergencias, esos ids darían falsos positivos en todas las entidades.
 *
 * Este los hace deterministas: mismo tic y mismo contador, mismo id.
 */
export function entityId(prefix: string, tick: number, counter: number): string {
  return `${prefix}-${tick}-${counter}`
}
