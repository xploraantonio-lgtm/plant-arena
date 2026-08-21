// ─────────────────────────────────────────────────────────────────────────────
// LA HUELLA DE LA PARTIDA
//
// PARA QUÉ
//   En lockstep no se manda el tablero: cada cliente lo RECALCULA. Eso es lo que
//   hace posible un 1c1 en tiempo real sin un servidor jugando la partida, y
//   también es su punto débil: si los dos cálculos se separan aunque sea un tic,
//   los tableros dejan de coincidir y no vuelven solos. Al final cada uno reporta
//   un ganador distinto y la partida queda en revisión sin repartir nada.
//
//   Los tests comprueban que eso no pasa. Esto comprueba que no pasa DE VERDAD,
//   en las partidas reales de la gente: cada cliente resume su tablero en una
//   cadena corta cada pocos segundos y el servidor compara las dos. Si un día se
//   separan, se sabrá EN QUÉ TIC — que es la mitad de arreglarlo.
//
// LO QUE HACE ESTO POSIBLE: NORMALIZAR EL LADO
//   Cada jugador se ve a sí mismo a la izquierda. Lo que para ti es `plants` para
//   tu rival es `enemyPlants`, y una planta tuya en la columna 4 aparece en su
//   pantalla en la 7. Así que dos tableros IDÉNTICOS producirían dos huellas
//   distintas, y todas las partidas parecerían roas.
//
//   La huella se calcula siempre desde el punto de vista del JUGADOR 1 de la sala.
//   Quien sea el 2 le da la vuelta antes de resumir. Con eso, dos pantallas que
//   están de acuerdo producen exactamente la misma cadena.
// ─────────────────────────────────────────────────────────────────────────────
import { TOTAL_COLUMNS } from '../utils/gameConstants'
import type { GameState } from './simulate'
import type { PlantEntity } from '../types/game'

/** Cada cuántos tics se manda una huella. 300 tics son unos 10 segundos. */
export const CADA_CUANTOS_TICS = 300

/**
 * Una planta, resumida.
 *
 * `col` se devuelve al marco del jugador 1: las plantas del rival se guardan con
 * la columna ya espejada, así que para normalizar hay que deshacerlo.
 *
 * La vida va con tres decimales. Con menos se taparían diferencias de verdad —
 * medio punto de vida es una divergencia— y con más se compararían ruidos del
 * último bit que no significan nada.
 */
function resumirPlanta(p: PlantEntity, desespejar: boolean): string {
  const col = p.col === undefined
    ? '-'
    : desespejar
    ? TOTAL_COLUMNS - 1 - p.col
    : p.col
  return `${p.plantId}:${p.lane}:${col}:${p.hp.toFixed(3)}`
}

/**
 * Resume el tablero en una cadena comparable entre las dos pantallas.
 *
 * @param soyP1 si quien llama es el jugador 1 de la sala (game_room_info lo dice).
 *              Es lo único que hace falta para normalizar: el 2 le da la vuelta.
 */
export function huellaDeLaPartida(state: GameState, soyP1: boolean): string {
  // Las plantas del jugador 1 y las del 2, cada una en el marco de su dueño.
  const deP1 = soyP1 ? state.plants : state.enemyPlants
  const deP2 = soyP1 ? state.enemyPlants : state.plants

  // Quien mira ve SUS plantas sin espejar y las del rival espejadas. Al normalizar
  // hay que deshacer el espejo justo de las del rival.
  const resumen = (lista: PlantEntity[], sonDelRivalDeQuienMira: boolean) =>
    lista
      .map((p) => resumirPlanta(p, sonDelRivalDeQuienMira))
      .sort()
      .join(',')

  const baseP1 = soyP1 ? state.p1BaseHp : state.p2BaseHp
  const baseP2 = soyP1 ? state.p2BaseHp : state.p1BaseHp

  return [
    `t${state.tick}`,
    `b${baseP1.toFixed(3)}/${baseP2.toFixed(3)}`,
    `1[${resumen(deP1, !soyP1)}]`,
    `2[${resumen(deP2, soyP1)}]`,
  ].join('|')
}

/** ¿Toca mandar huella en este tic? */
export function tocaHuella(tick: number): boolean {
  return tick > 0 && tick % CADA_CUANTOS_TICS === 0
}
