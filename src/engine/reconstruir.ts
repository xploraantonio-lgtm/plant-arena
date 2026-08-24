// ─────────────────────────────────────────────────────────────────────────────
// UNA ACCIÓN QUE LLEGA TARDE SE APLICA EN SU TIC DE TODOS MODOS
//
// EL FALLO QUE ESTO ARREGLA, MEDIDO EN UNA PARTIDA DE VERDAD
//   El detector encontró esto en el segundo 59 de una partida móvil contra
//   ordenador: el MISMO girasol con 50 de vida en una pantalla y 75 en la otra.
//   Veinticinco de diferencia, que es exactamente el daño de un lanzaguisantes.
//
//   O sea: en una pantalla había impactado un guisante más. No faltaba ninguna
//   planta ni se había perdido ninguna jugada — un lanzaguisantes había empezado a
//   disparar unos tics antes en un lado, y desde ahí la cuenta iba desfasada para
//   siempre.
//
//   La causa: cuando una acción llegaba después de su tic, el receptor la aplicaba
//   «en el tic siguiente» (`Math.max(tick + 1, accion.tick)`). Es lo único que se
//   puede hacer sin más herramientas, y es una partida distinta desde ese momento.
//   Con datos móviles, los 200 ms de margen se pasan con facilidad.
//
// LA REGLA CORRECTA
//   Una acción se aplica EN SU TIC. Si llegó tarde, no se aplica «más tarde»: se
//   rehace la partida desde el principio con la acción en su sitio y se adelanta
//   hasta donde íbamos. El resultado es idéntico a si hubiera llegado a tiempo.
//
//   Esto se llama rollback y en la mayoría de los juegos es carísimo, porque hay
//   que guardar fotos del estado. Aquí sale gratis por dos decisiones tomadas
//   mucho antes: el motor es determinista (mismas entradas, mismo resultado) y
//   todo el estado son datos planos, generador de azar incluido. Así que no hace
//   falta guardar nada: la partida se vuelve a ejecutar desde el tic 0 y da
//   exactamente lo mismo. Miles de tics tardan milisegundos.
//
// LO QUE NO SE RECONSTRUYE: LO QUE ES SÓLO TUYO
//   Tus soles, tus enfriamientos y tus estadísticas no salen del registro de
//   jugadas — los soles se recogen pulsando y eso no viaja. Si se reconstruyeran,
//   perderías los soles que habías recogido.
//
//   Y no hace falta: nadie más simula tu banco. No forma parte de la partida
//   compartida, así que se conserva tal cual.
// ─────────────────────────────────────────────────────────────────────────────
import { createBattleState, stepTick, type GameState, type EngineVersion } from './simulate.ts'
import { huellaDeLaPartida, tocaHuella, type HuellaEnUnTic } from './huella.ts'
import type { PlantId, PlantStatKey } from '../types/game.ts'

/** Una jugada del registro, con de quién es. */
export interface AccionRegistrada {
  /** El identificador del servidor. Sirve para ordenar y para no duplicar. */
  id: number
  /** Si es mía. Las mías van a mi lado del campo; las del rival, espejadas. */
  mia: boolean
  tick: number
  kind: 'plant' | 'dig'
  plantId?: PlantId | null
  lane: number
  col?: number | null
  /**
   * Las mejoras de la carta y su nivel.
   *
   * Van en el registro porque una carta mejorada tiene más vida o más daño, y
   * reconstruir sin ellas plantaría una carta básica en su sitio: la
   * reconstrucción arreglaría el desfase de tics y a cambio metería una
   * divergencia nueva, peor, en las estadísticas de la planta.
   */
  statRolls?: PlantStatKey[]
  level?: number
}

/**
 * Vuelve a ejecutar la partida entera desde el tic 0 con todas las jugadas.
 *
 * Es la misma idea que una repetición, y por el mismo motivo funciona: con la
 * misma semilla y las mismas jugadas en los mismos tics, el motor da exactamente
 * el mismo resultado.
 */
export function reconstruirHasta(
  semilla: number,
  acciones: readonly AccionRegistrada[],
  hastaTick: number,
  engineVersion: EngineVersion = 'auth-v2'
): GameState {
  const estado = sembrar(semilla, acciones, engineVersion)
  while (estado.tick < hastaTick && estado.status === 'playing') {
    // Sin sonidos: se están rehaciendo tics que el jugador ya vivió, y volver a
    // sonarlos sería un estruendo de dos minutos de partida en un instante.
    stepTick(estado, () => {})
  }
  return estado
}

/**
 * Lo mismo, pero apuntando las huellas de los tics de control por el camino.
 *
 * Hace falta porque una acción tardía llega DESPUÉS de haber mandado la huella
 * del tic anterior: esa huella se calculó sin la jugada y no cuadra con la del
 * rival. Si se quedara así, el detector avisaría de una separación que en realidad
 * ya se arregló, y no habría forma de distinguir un aviso falso de uno de verdad.
 *
 * Rehacer la partida ya recorre todos esos tics, así que las huellas correctas
 * salen del mismo viaje sin coste extra.
 */
export function reconstruirConHuellas(
  semilla: number,
  acciones: readonly AccionRegistrada[],
  hastaTick: number,
  soyP1: boolean,
  engineVersion: EngineVersion = 'auth-v2'
): { estado: GameState; huellas: HuellaEnUnTic[] } {
  const estado = sembrar(semilla, acciones, engineVersion)
  const huellas: HuellaEnUnTic[] = []

  while (estado.tick < hastaTick && estado.status === 'playing') {
    stepTick(estado, () => {})
    // Dentro del bucle, igual que en el juego: un tic de control que se comprueba
    // desde fuera se salta en cuanto un paso avanza más de un tic.
    if (tocaHuella(estado.tick)) {
      huellas.push({ tick: estado.tick, huella: huellaDeLaPartida(estado, soyP1) })
    }
  }

  return { estado, huellas }
}

/** Una partida nueva con todas las jugadas del registro ya en su cola. */
function sembrar(
  semilla: number,
  acciones: readonly AccionRegistrada[],
  engineVersion: EngineVersion = 'auth-v2'
): GameState {
  const estado = createBattleState(semilla, false, true, undefined, engineVersion)

  // Por tic, y a igualdad de tic en el orden en que están: el registro llega
  // desordenado cuando el canal en vivo y la recuperación periódica se solapan, y
  // lo que manda es el tic de cada jugada, no cuándo se supo de ella.
  const enOrden = [...acciones].sort((a, b) => a.tick - b.tick)

  for (const a of enOrden) {
    // Nunca antes del tic 1: una acción en el tic 0 se aplicaría antes de que la
    // partida empiece a contar y no se llegaría a ejecutar.
    const atTick = Math.max(1, a.tick)

    if (a.kind === 'dig') {
      estado.pending.push({
        atTick,
        kind: a.mia ? 'own_dig' : 'rival_dig',
        lane: a.lane,
        col: a.col ?? 0,
      })
      continue
    }
    if (!a.plantId) continue

    // Las dos ramas son iguales salvo el lado. Van separadas porque en el motor
    // 'own_plant' y 'rival_plant' son dos formas distintas de la misma unión.
    const comun = {
      atTick,
      plantId: a.plantId,
      lane: a.lane,
      col: a.col ?? undefined,
      statRolls: a.statRolls,
      level: a.level,
    }
    estado.pending.push(
      a.mia ? { ...comun, kind: 'own_plant' } : { ...comun, kind: 'rival_plant' }
    )
  }

  return estado
}

/**
 * Pasa al estado reconstruido lo que es sólo del jugador.
 *
 * Sin esto, reconstruir le quitaría al jugador los soles que había recogido a
 * mano: el registro de jugadas no sabe nada de eso. Y no hay riesgo en
 * conservarlo, porque nada de esto lo simula el rival.
 */
export function conservarLoLocal(nuevo: GameState, viejo: GameState): GameState {
  nuevo.sunBank = viejo.sunBank
  nuevo.cooldowns = viejo.cooldowns
  nuevo.slotCooldowns = viejo.slotCooldowns
  nuevo.selectedCard = viejo.selectedCard
  nuevo.selectedSlotIndex = viejo.selectedSlotIndex

  // Las estadísticas van a medias, así que se parten.
  //
  //   · los soles recogidos y las plantas puestas son tuyos y no salen del
  //     registro: se conservan;
  //   · las plantas derribadas las cuenta el motor, así que vale la cuenta de la
  //     partida rehecha — que es la buena.
  //
  // Y el marcador se recompone de sus dos piezas (50 por sol, 100 por planta
  // derribada) en lugar de arrastrar el de antes, que llevaba dentro las bajas de
  // la línea temporal equivocada.
  nuevo.stats = {
    sunsCollected: viejo.stats.sunsCollected,
    plantsPlaced: viejo.stats.plantsPlaced,
    enemyPlantsDefeated: nuevo.stats.enemyPlantsDefeated,
    score: viejo.stats.sunsCollected * 50 + nuevo.stats.enemyPlantsDefeated * 100,
  }
  // Conservamos únicamente los soles de la simulación canónica (nuevo) que NO hayan sido
  // recogidos previamente en la sesión local (es decir, los que aún siguen en viejo.suns).
  const idsViejos = new Set(viejo.suns.map((s) => s.id))
  nuevo.suns = nuevo.suns.filter((s) => idsViejos.has(s.id))
  return nuevo
}
