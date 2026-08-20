// ─────────────────────────────────────────────────────────────────────────────
// LOS NÚMEROS DEL EQUILIBRIO
//
// Todo lo que se toca para ajustar el ritmo de la partida, en un solo sitio.
//
// UNA REGLA QUE NO SE PUEDE ROMPER
//   Estos valores tienen que ser IDÉNTICOS en los dos clientes de una partida. La
//   simulación es determinista, así que si uno juega con el girasol a 15 s y el
//   otro a 6 s, las dos partidas se separan y volvemos al "tu rival dijo otra
//   cosa".
//
//   Por eso viven aquí, en el código, y no en la base: así viajan con el despliegue
//   y los dos navegadores tienen forzosamente los mismos. Si algún día se quieren
//   ajustar en caliente sin desplegar, NO basta con leerlos de shop_config — hay
//   que mandarlos EN LA SALA (game_rooms), para que los dos clientes reciban la
//   misma foto de los números al empezar. Leerlos cada uno por su cuenta sería
//   volver a tener dos juegos.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cada cuánto cae un sol del cielo, en milisegundos.
 *
 * Es el ingreso base y NO compone: cae igual con 0 girasoles que con 10. A 6
 * segundos aporta 250 soles por minuto, que es un girasol cada 12 segundos sin
 * hacer nada. Es lo que sostiene el arranque de la partida.
 */
export const SOL_DEL_CIELO_MS = 6000

/**
 * Cada cuánto produce un girasol, en milisegundos.
 *
 * ESTE es el número que decide el ritmo de la partida, y es el que estaba roto.
 *
 * A 6 segundos, un girasol de 50 soles producía 25 cada 6 s: se pagaba en 12
 * segundos y luego imprimía 250/min para siempre. O sea que cada girasol
 * plantado permitía comprar 5 más por minuto — una bola de nieve. El resultado
 * medido: con 4 girasoles, 1250 soles por minuto, 25 girasoles más por minuto.
 * Jugando se notaba en que el campo se llenaba de girasoles.
 *
 * Y lo peor no era la cantidad, era que NO HABÍA DECISIÓN: con un retorno de 12
 * segundos nunca hay motivo para no plantar otro girasol, ni en el último segundo
 * de la partida.
 *
 * A 15 segundos el retorno es de 30 s. Un girasol plantado en el primer minuto se
 * paga dos o tres veces; uno plantado al final, no. Eso es lo que crea la tensión
 * entre economía y ataque: invertir temprano, atacar tarde.
 *
 * Referencia: en Plants vs Zombies el girasol cuesta lo mismo y produce cada ~24
 * segundos, con un retorno de 48. Aquí las partidas son más cortas, así que 15
 * queda entre medias.
 */
export const GIRASOL_MS = 15000

/**
 * Cada cuánto produce el girasol doble.
 *
 * Produce DOS soles por ciclo, así que con el mismo intervalo rinde el doble. Su
 * coste (125) lo compensa: se paga en 37 s frente a los 30 del sencillo, y ocupa
 * un solo hueco — que en un campo con huecos limitados es su verdadera ventaja.
 */
export const GIRASOL_DOBLE_MS = GIRASOL_MS

/** Cuántos soles da cada uno. */
export const SOLES_POR_CICLO_GIRASOL = 1
export const SOLES_POR_CICLO_GIRASOL_DOBLE = 2
