// ─────────────────────────────────────────────────────────────────────────────
// LAS MEJORAS DE UNA CARTA SALEN DEL MAZO QUE GUARDÓ EL SERVIDOR
//
// EL FALLO QUE ESTO ARREGLA
//   Las mejoras de una carta (statRolls) le suman un 15% de vida, de daño o de
//   cadencia por cada una. Quien planta las aplica desde su propio navegador; el
//   rival sólo recibe la carta y la casilla, así que planta la versión básica.
//
//   O sea que la misma planta tenía 345 de vida en una pantalla y 300 en la otra
//   DESDE EL MOMENTO EN QUE SE PONE, sin necesidad de ningún retraso de red. Las
//   dos partidas eran distintas de principio a fin, y al final cada uno reportaba
//   un ganador distinto: «tu rival dijo otra cosa». Le pasaba a cualquiera con una
//   carta mejorada, o sea a cualquiera que hubiera jugado un rato.
//
// POR QUÉ NO HACE FALTA MANDAR NADA MÁS
//   Al emparejar, el servidor guarda los dos mazos en la sala (_active_deck) con
//   el nivel y las mejoras de cada carta, y game_room_info los devuelve a LOS DOS
//   jugadores. El dato ya estaba llegando al navegador — sólo que se tiraba.
//
//   Así que las mejoras no viajan con cada jugada: se leen del mazo de la sala, que
//   es el mismo para los dos y lo escribió el servidor. Y por eso tampoco se puede
//   hacer trampa por aquí: da igual lo que diga el navegador de nadie.
//
// LA REGLA DE LAS CARTAS REPETIDAS
//   Una jugada sólo dice qué carta se plantó, no de qué hueco del mazo salió. Si
//   alguien lleva la misma planta en dos huecos con mejoras distintas, las dos
//   pantallas tienen que elegir la MISMA, o vuelve la divergencia.
//
//   Se coge la primera del mazo, que es una regla que las dos pantallas calculan
//   igual. Cuesta que la segunda copia juegue con las mejoras de la primera; a
//   cambio, las dos pantallas ven exactamente la misma planta, que es lo único
//   irrenunciable. Para que sea exacto habría que mandar el hueco en la jugada, y
//   eso sí pide una columna nueva en el registro.
// ─────────────────────────────────────────────────────────────────────────────
import type { PlantId } from '../types/game'
import type { PlantStatKey } from '../utils/gameConstants'

/** Una carta del mazo, tal como la devuelve game_room_info. */
export interface CartaDeMazo {
  plantId: string
  slot?: number | null
  level?: number | null
  statRolls?: string[] | null
}

/** Las mejoras con las que hay que plantar una carta. */
export interface MejorasDeCarta {
  statRolls: PlantStatKey[]
  level: number
}

const SIN_MEJORAS: MejorasDeCarta = { statRolls: [], level: 0 }

/**
 * Convierte lo que llega por JSON en un mazo utilizable, o null si no hay mazo.
 *
 * Devuelve null y no un mazo vacío a propósito: son dos cosas distintas. Un mazo
 * vacío significa «esta carta no tiene mejoras»; no tener mazo significa «no se
 * sabe», y entonces hay que caer al camino de siempre en lugar de plantar cartas
 * básicas por error.
 */
export function leerMazo(bruto: unknown): CartaDeMazo[] | null {
  if (!Array.isArray(bruto)) return null
  const cartas: CartaDeMazo[] = []
  for (const c of bruto) {
    if (!c || typeof c !== 'object') continue
    const carta = c as Record<string, unknown>
    if (typeof carta.plantId !== 'string') continue
    cartas.push({
      plantId: carta.plantId,
      slot: typeof carta.slot === 'number' ? carta.slot : null,
      level: typeof carta.level === 'number' ? carta.level : null,
      statRolls: Array.isArray(carta.statRolls)
        ? carta.statRolls.filter((r): r is string => typeof r === 'string')
        : null,
    })
  }
  return cartas
}

/**
 * Las mejoras de una carta según el mazo de la sala.
 *
 * Sin mazo o sin esa carta en el mazo, devuelve «ninguna mejora»: es lo mismo que
 * ve el rival, y coincidir importa más que acertar.
 */
export function mejorasDeLaCarta(
  mazo: CartaDeMazo[] | null,
  plantId: PlantId
): MejorasDeCarta {
  if (!mazo) return SIN_MEJORAS
  // La primera con esa carta. Ver la regla de las cartas repetidas, arriba.
  const carta = mazo.find((c) => c.plantId === plantId)
  if (!carta) return SIN_MEJORAS

  const statRolls = (carta.statRolls ?? []) as PlantStatKey[]
  // El nivel se deduce de cuántas mejoras hay cuando no viene: son lo mismo
  // contado de dos maneras, y si no cuadran manda la lista, que es la que decide
  // las estadísticas de verdad.
  const level = statRolls.length > 0 ? statRolls.length : carta.level ?? 0
  return { statRolls, level }
}
