// ─────────────────────────────────────────────────────────────────────────────
// EL BOT, CON MANOS HUMANAS
//
// El objetivo no es que el bot juegue MEJOR: es que no se note que es un bot. Un
// jugador perdona perder; lo que no perdona es sentir que enfrente hay una
// máquina.
//
// Lo que delataba al anterior, en orden de evidencia:
//
//   1. NUNCA FALLABA UN SOL. Recibía +25 automáticos cada 6 segundos mientras el
//      jugador tenía que pulsar cada uno. Eso es lo que se sentía como "captura
//      los soles antes de que yo pueda, no es normal".
//
//   2. ERA UN METRÓNOMO. Plantaba cada 2,2 segundos exactos, y ACELERABA con las
//      oleadas. Nadie juega a compás.
//
//   3. REACCIONABA EN EL MISMO TIC. Veía una amenaza y respondía al instante, sin
//      el medio segundo que tarda una persona en darse cuenta y mover el ratón.
//
// Aquí se corrigen las tres, y todo con el azar CON SEMILLA del estado: el bot
// sigue siendo reproducible, así que una repetición reproduce sus errores exactos
// y el servidor puede recalcular la partida.
//
// LA IDEA DE FONDO
//   Un bot difícil no es uno que juega perfecto y rápido: es uno que juega bien y
//   con la mano temblorosa. La torpeza no se simula haciéndole jugar mal, se
//   simula dándole los mismos límites que tiene una persona — ver tarde, fallar
//   clics, dudar.
// ─────────────────────────────────────────────────────────────────────────────
import { chance, nextFloat, nextInt, type Rng } from './rng'

/**
 * Lo bueno que es el bot, de 0 a 1.
 *
 * No cambia sus estadísticas —eso sería trampa y se nota— sino sus LÍMITES
 * humanos: cuánto tarda en ver, cuántos soles se le escapan y cada cuánto hace
 * una jugada mediocre.
 *
 * En ranked se saca del ELO del jugador, para que el relleno se parezca a alguien
 * de su nivel.
 */
export interface NivelDelBot {
  /** Cuánto tarda en reaccionar a una amenaza, en milisegundos. */
  reaccionMs: number
  /** Qué fracción de sus soles se le escapa sin recoger. */
  solesQueFalla: number
  /** Cuántas de sus jugadas son mediocres a propósito. */
  jugadasMalas: number
  /** Cuánto varía su ritmo: 0 es un metrónomo, 1 es muy irregular. */
  irregularidad: number
}

/** Cómo juega alguien de este ELO. */
export function nivelPorElo(elo: number): NivelDelBot {
  if (elo <= 1200) {
    // Alguien que acaba de empezar: mira poco, se le van muchos soles.
    return { reaccionMs: 1800, solesQueFalla: 0.30, jugadasMalas: 0.35, irregularidad: 0.9 }
  }
  if (elo <= 1800) {
    return { reaccionMs: 1200, solesQueFalla: 0.18, jugadasMalas: 0.22, irregularidad: 0.7 }
  }
  if (elo <= 2600) {
    return { reaccionMs: 800, solesQueFalla: 0.10, jugadasMalas: 0.12, irregularidad: 0.55 }
  }
  // Bueno, pero sigue siendo una persona: nunca cero.
  return { reaccionMs: 500, solesQueFalla: 0.05, jugadasMalas: 0.06, irregularidad: 0.4 }
}

export const NIVEL_POR_DEFECTO: NivelDelBot = nivelPorElo(1500)

/**
 * Lo que el bot lleva en la cabeza.
 *
 * Vive en el estado de la partida, como todo lo demás, para que se pueda guardar,
 * reanudar y recalcular. Un bot cuyo "estado mental" estuviera fuera del estado
 * rompería las repeticiones.
 */
export interface MenteDelBot {
  /**
   * Soles que ha producido y todavía no ha recogido, con el tic en que los cogerá.
   *
   * Esto es lo que sustituye al +25 automático. Un sol producido no está en el
   * banco: está en el suelo, y el bot lo recoge un rato después — o no lo recoge.
   */
  solesEnElSuelo: Array<{ valor: number; recogeEnTick: number }>
  /**
   * Los carriles que CREE amenazados, y cuándo se formó esa impresión.
   *
   * El bot decide con esta foto, no con la realidad del tic actual. Es lo que le
   * da el retardo de reacción: si plantas algo, tarda en enterarse.
   */
  carrilesVistos: number[]
  ultimoVistazo: number
  /** El próximo tic en que se planteará plantar algo. */
  proximaJugada: number
}

export function menteNueva(): MenteDelBot {
  return { solesEnElSuelo: [], carrilesVistos: [], ultimoVistazo: -9999, proximaJugada: 0 }
}

/**
 * Un sol acaba de producirse para el bot.
 *
 * No entra en su banco: queda en el suelo. Lo recogerá con retardo, y con cierta
 * probabilidad se le escapará — igual que a una persona que está mirando otra
 * parte del campo.
 */
export function producirSol(mente: MenteDelBot, rng: Rng, nivel: NivelDelBot, tick: number, valor: number): void {
  if (chance(rng, nivel.solesQueFalla)) return   // se le escapó

  // Entre 0,3 y 2 segundos en darse cuenta y pulsarlo. La franja depende del
  // nivel: quien juega mejor reacciona antes, pero nunca al instante.
  const minMs = 300
  const maxMs = 300 + nivel.reaccionMs
  const esperaMs = minMs + nextFloat(rng) * (maxMs - minMs)
  mente.solesEnElSuelo.push({
    valor,
    recogeEnTick: tick + Math.ceil(esperaMs / 33),
  })
}

/**
 * Recoge los soles cuyo momento ha llegado. Devuelve cuánto suma al banco.
 *
 * Se llama cada tic. Los que no han vencido siguen en el suelo, así que el
 * ingreso del bot llega a rachas y no a compás — que es como llega el de una
 * persona.
 */
export function recogerSoles(mente: MenteDelBot, tick: number): number {
  if (mente.solesEnElSuelo.length === 0) return 0
  let recogido = 0
  const siguenEnElSuelo: typeof mente.solesEnElSuelo = []
  for (const sol of mente.solesEnElSuelo) {
    if (sol.recogeEnTick <= tick) recogido += sol.valor
    else siguenEnElSuelo.push(sol)
  }
  mente.solesEnElSuelo = siguenEnElSuelo
  return recogido
}

/**
 * Actualiza lo que el bot cree que está pasando, como mucho una vez cada
 * `reaccionMs`.
 *
 * Entre vistazo y vistazo decide con información vieja. Ahí está el medio segundo
 * de ventaja que tiene un humano contra una máquina que reacciona en el mismo
 * fotograma, y es lo que hace que se pueda sorprender al bot.
 */
export function echarUnVistazo(
  mente: MenteDelBot,
  nivel: NivelDelBot,
  tick: number,
  carrilesAmenazadosAhora: number[]
): void {
  const cada = Math.ceil(nivel.reaccionMs / 33)
  if (tick - mente.ultimoVistazo < cada) return
  mente.ultimoVistazo = tick
  mente.carrilesVistos = [...carrilesAmenazadosAhora]
}

/**
 * ¿Le toca plantar algo en este tic?
 *
 * El intervalo base se sacude con la irregularidad del nivel, así que el ritmo
 * sube y baja en lugar de marcar el compás. Y de vez en cuando se queda pensando
 * el doble de tiempo, como quien duda.
 */
export function leTocaJugar(
  mente: MenteDelBot,
  rng: Rng,
  nivel: NivelDelBot,
  tick: number,
  intervaloBaseMs: number
): boolean {
  if (tick < mente.proximaJugada) return false

  // Entre (1 − irregularidad/2) y (1 + irregularidad) veces el intervalo base.
  const factor = 1 - nivel.irregularidad / 2 + nextFloat(rng) * nivel.irregularidad * 1.5
  let esperaMs = intervaloBaseMs * factor

  // Una de cada seis veces se lo piensa el doble. Es lo que rompe el patrón: sin
  // esto, aunque cada intervalo varíe, la media sigue sonando a máquina.
  if (chance(rng, 0.17)) esperaMs *= 2

  mente.proximaJugada = tick + Math.ceil(esperaMs / 33)
  return true
}

/**
 * ¿Esta jugada va a ser mediocre?
 *
 * Cuando sí, el bot elige al azar entre lo que puede pagar en lugar de lo mejor.
 * No es hacerle jugar mal: es que una persona no siempre encuentra la respuesta
 * óptima, y un rival que SIEMPRE la encuentra se nota más que uno que pierde.
 */
export function jugadaMediocre(rng: Rng, nivel: NivelDelBot): boolean {
  return chance(rng, nivel.jugadasMalas)
}

/**
 * En qué carril planta.
 *
 * Con la foto que tiene en la cabeza, no con la realidad. Y a veces se equivoca
 * de carril: mira el que estaba amenazado hace un momento en lugar del que lo
 * está ahora.
 */
export function elegirCarril(mente: MenteDelBot, rng: Rng, nivel: NivelDelBot): number {
  const vistos = mente.carrilesVistos
  if (vistos.length === 0) return nextInt(rng, 3)
  // Aun viendo la amenaza, no siempre acude: a veces sigue con su plan.
  if (chance(rng, 0.15 + nivel.jugadasMalas)) return nextInt(rng, 3)
  return vistos[nextInt(rng, vistos.length)]
}
