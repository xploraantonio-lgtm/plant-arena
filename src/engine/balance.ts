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

// ─────────────────────────────────────────────────────────────────────────────
// CUÁNTO DURA UNA PARTIDA
//
// Antes: lo que hiciera falta. Y si los dos se dedicaban a plantar girasoles y
// nadie llegaba a la base del otro, la partida NO TERMINABA — se quedaba abierta
// hasta que el servidor la daba por abandonada a los 120 segundos sin jugadas.
// Eso salía en la lista de partidas como "SIN RESULTADO": nadie se rindió, nadie
// atacó, y no ganó nadie.
//
// Ahora toda partida acaba, y acaba con un resultado:
//
//   0 → 2:30   FASE NORMAL. Lo de siempre.
//   2:30 →     MUERTE SÚBITA. Las DOS bases empiezan a perder vida por sí solas.
//              Como pierden lo mismo, cae primero la que ya estaba peor: quien va
//              ganando, gana. Y como la presión sube sola, la partida se cierra.
//   5:30       TOPE. Si a estas alturas siguen las dos en pie, se decide por
//              puntos y se acaba. Es una red de seguridad; con el desgaste no
//              debería llegarse nunca.
//
// POR QUÉ EL DESGASTE ES IGUAL PARA LOS DOS
//   Cada cliente se simula a sí mismo como p1: lo que para ti es `p1BaseHp` para
//   tu rival es `p2BaseHp`. Así que cualquier regla que diga "gana p1" haría que
//   los DOS se declararan ganadores. Todo lo que decide la partida tiene que ser
//   una COMPARACIÓN entre los dos lados —quién tiene más vida, quién tiene más
//   plantas—, porque una comparación da la misma respuesta mirada desde los dos
//   sitios.
// ─────────────────────────────────────────────────────────────────────────────

/** Cuándo empieza la muerte súbita. */
export const MUERTE_SUBITA_MS = 150_000

/**
 * Vida que pierde CADA base por segundo durante la muerte súbita.
 *
 * Con 600 de vida, una base entera se consume en 50 segundos. O sea que en el
 * peor caso —dos bases intactas al llegar a la muerte súbita— la partida se
 * decide sobre el 3:20. Y no es un empate: las plantas siguen peleando, así que
 * la diferencia que ya hubiera se agranda.
 */
export const DESGASTE_MUERTE_SUBITA_POR_SEGUNDO = 12

/**
 * Tope absoluto. Pasado esto se decide por puntos, se juegue lo que se juegue.
 *
 * Existe para que no haya NINGÚN camino por el que una partida siga abierta:
 * ni un registro manipulado, ni un fallo del desgaste, ni una carta que cure la
 * base más rápido de lo que se desgasta.
 */
export const TOPE_DE_PARTIDA_MS = 330_000

/**
 * Cuánto aguanta un sol en el campo antes de recogerse solo.
 *
 * EL PROBLEMA QUE ARREGLA
 *   Los soles caen exactamente igual en las dos pantallas —misma semilla, mismo
 *   tic, misma posición—, pero cada jugador tenía que PULSAR los suyos. Y ahí se
 *   abría una diferencia que no tiene nada que ver con jugar mejor: uno iba por
 *   250 y el otro por 200 recogiendo «casi al mismo tiempo». Los 50 que faltaban
 *   eran dos soles que seguían en el campo esperando, o dos clics que se
 *   escaparon.
 *
 *   Con un ingreso que decide la partida, eso no puede depender del pulso, del
 *   ratón o de un dedo en un móvil. Es justo la clase de cosa de la que un
 *   jugador se queja con razón.
 *
 * POR QUÉ 5 SEGUNDOS Y NO CERO
 *   A cero, recoger dejaría de existir y el campo sería una pantalla que se mira.
 *   A 5 segundos siguen pasando las dos cosas que importan:
 *     · quien recoge rápido cobra ANTES, y adelantar 25 soles cinco segundos al
 *       principio de la partida es una ventaja de tempo real: planta antes;
 *     · quien se despista NO PIERDE el sol, sólo lo cobra tarde.
 *
 *   O sea: la habilidad sigue premiada, el descuido ya no se castiga con menos
 *   ingreso total. Los dos jugadores acaban la partida habiendo cobrado los
 *   mismos soles del cielo.
 *
 * Y como lo hace el motor en un tic concreto, las dos simulaciones coinciden:
 * no es un temporizador del navegador de cada uno.
 */
export const SOL_SE_RECOGE_SOLO_MS = 5000
