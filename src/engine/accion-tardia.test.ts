// ─────────────────────────────────────────────────────────────────────────────
// UNA ACCIÓN QUE LLEGA TARDE NO PUEDE SEPARAR LAS DOS PANTALLAS
//
// Este test viene de una divergencia REAL, encontrada por el detector en el
// segundo 59 de una partida móvil contra ordenador: el mismo girasol con 50 de
// vida en una pantalla y 75 en la otra. Veinticinco exactos — el daño de un
// lanzaguisantes. Un guisante más había impactado en un lado.
//
// La causa no era una jugada perdida: era una jugada aplicada TARDE. El receptor
// la ponía «en el tic siguiente» porque su tic ya había pasado, así que su
// lanzaguisantes empezaba a disparar unos tics después que el del otro y la cuenta
// quedaba desfasada para siempre.
//
// Lo que se comprueba aquí es la propiedad que arregla eso: da igual CUÁNDO llegue
// una acción, el tablero acaba igual que si hubiera llegado a tiempo.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest'
import { createBattleState, stepTick, type GameState } from './simulate'
import { reconstruirHasta, conservarLoLocal, type AccionRegistrada } from './reconstruir'
import { huellaDeLaPartida } from './huella'
import type { PlantId } from '../types/game'
import type { PlantStatKey } from '../utils/gameConstants'

const callar = () => {}
const SEMILLA = 4242

function correr(estado: GameState, hasta: number) {
  while (estado.tick < hasta) stepTick(estado, callar)
}

/**
 * La partida de la divergencia real, en pequeño: un lanzaguisantes mío pegando a
 * la nuez del rival en el mismo carril.
 *
 * Los números están elegidos para que la partida NO se acabe antes del tic donde
 * se compara: la nuez tiene 1200 de vida y un lanzaguisantes le hace 25 cada 42
 * tics, o sea unos 950 en toda la prueba. Aguanta, y con ella aguanta la base del
 * rival — que es lo que hace que haya algo que comparar en el tic 1800.
 *
 * El nudo del test es la jugada 3: la que llega tarde.
 */
const JUGADAS: AccionRegistrada[] = [
  { id: 1, mia: true,  tick: 100, kind: 'plant', plantId: 'sunflower' as PlantId,  lane: 0, col: 0 },
  { id: 2, mia: false, tick: 130, kind: 'plant', plantId: 'wallnut' as PlantId,    lane: 2, col: 0 },
  { id: 3, mia: true,  tick: 200, kind: 'plant', plantId: 'peashooter' as PlantId, lane: 2, col: 2 },
  { id: 4, mia: false, tick: 300, kind: 'plant', plantId: 'sunflower' as PlantId,  lane: 1, col: 0 },
]

/** La jugada que llega tarde en los tests, ya en forma de acción del motor. */
const LA_TARDIA = { kind: 'own_plant' as const, plantId: 'peashooter' as PlantId, lane: 2, col: 2 }

/**
 * El camino honrado: un cliente que recibe cada jugada ANTES de su tic y la
 * encola a tiempo, sin reconstruir nada. Es con esto con lo que hay que empatar.
 *
 * Se empuja jugada a jugada, en tics distintos, a propósito: si se empujaran
 * todas de golpe al principio sería el mismo camino que `reconstruirHasta` y el
 * test no compararía nada.
 */
function jugarRecibiendoloTodoATiempo(hasta: number): GameState {
  const estado = createBattleState(SEMILLA, false, true)
  const cola = [...JUGADAS].sort((a, b) => a.tick - b.tick)
  let i = 0

  while (estado.tick < hasta) {
    // Llega con margen: dos tics antes de tener que aplicarse.
    while (i < cola.length && cola[i].tick <= estado.tick + 2) {
      const a = cola[i++]
      const comun = { atTick: a.tick, plantId: a.plantId!, lane: a.lane, col: a.col ?? undefined }
      estado.pending.push(
        a.mia ? { ...comun, kind: 'own_plant' } : { ...comun, kind: 'rival_plant' }
      )
    }
    stepTick(estado, callar)
  }
  return estado
}

/**
 * El camino roto: el cliente al que la jugada del tic 200 le llegó en el 260, y
 * la aplicó «en el tic siguiente» porque era lo único que sabía hacer.
 *
 * Es exactamente el `Math.max(state.tick + 1, accion.tick)` que había antes.
 */
function conElRetrasoDeAntes(hasta: number): GameState {
  const estado = createBattleState(SEMILLA, false, true)
  estado.pending.push({ atTick: 100, kind: 'own_plant', plantId: 'sunflower' as PlantId, lane: 0, col: 0 })
  estado.pending.push({ atTick: 130, kind: 'rival_plant', plantId: 'wallnut' as PlantId, lane: 2, col: 0 })
  estado.pending.push({ atTick: 300, kind: 'rival_plant', plantId: 'sunflower' as PlantId, lane: 1, col: 0 })

  correr(estado, 260)
  estado.pending.push({ atTick: 261, ...LA_TARDIA })
  correr(estado, hasta)
  return estado
}

describe('llegue cuando llegue, el tablero acaba igual', () => {
  it('reconstruir da lo mismo que haberlo recibido todo a tiempo', () => {
    // Ésta es la propiedad que sostiene todo: reconstruir no es «una aproximación
    // buena», es exactamente la partida que se habría jugado sin retrasos.
    const aTiempo = jugarRecibiendoloTodoATiempo(1800)
    const reconstruida = reconstruirHasta(SEMILLA, JUGADAS, 1800)

    expect(huellaDeLaPartida(reconstruida, true)).toBe(huellaDeLaPartida(aTiempo, true))
  })

  it('sin reconstruir, aplicarla «en el tic siguiente» SÍ separa las pantallas', () => {
    // Esto es lo que hacía el código antes, y es la prueba de que el fallo era ése.
    //
    // Ana la aplica en su tic (200). Beto la recibe en el tic 260 y la mete en el
    // 261, que es lo único que se puede hacer sin reconstruir.
    const ana = jugarRecibiendoloTodoATiempo(1800)
    const beto = conElRetrasoDeAntes(1800)

    // Y aquí está la divergencia que se vio en producción: la misma planta con
    // vidas distintas. Si algún día esto volviera a pasar, sería que alguien
    // volvió a aplicar acciones tardías sin reconstruir.
    expect(huellaDeLaPartida(beto, true)).not.toBe(huellaDeLaPartida(ana, true))

    const nuezAna = ana.enemyPlants.find((p) => p.lane === 2)
    const nuezBeto = beto.enemyPlants.find((p) => p.lane === 2)
    expect(nuezAna!.hp).not.toBe(nuezBeto!.hp)
    // Y la diferencia es un múltiplo del daño de un guisante, igual que en la
    // partida real: 25 exactos.
    expect(Math.abs(nuezAna!.hp - nuezBeto!.hp) % 25).toBe(0)
  })

  it('reconstruir alcanza a quien no tuvo retraso, con sus soles intactos', () => {
    // Éste es el caso de producción de punta a punta: Ana lo recibe todo a tiempo,
    // Beto recibe una jugada tarde y se separa. Beto reconstruye y vuelve a estar
    // en la misma partida que Ana — sin perder los soles que había recogido.
    const ana = jugarRecibiendoloTodoATiempo(900)
    const beto = conElRetrasoDeAntes(900)
    beto.sunBank = 480

    // Antes de reconstruir: separados.
    expect(huellaDeLaPartida(beto, true)).not.toBe(huellaDeLaPartida(ana, true))

    // Después: la misma partida, y sus soles siguen ahí.
    const alDia = conservarLoLocal(reconstruirHasta(SEMILLA, JUGADAS, beto.tick), beto)
    expect(huellaDeLaPartida(alDia, true)).toBe(huellaDeLaPartida(ana, true))
    expect(alDia.sunBank).toBe(480)
  })

  it('reconstruir dos veces da lo mismo: es determinista', () => {
    const una = reconstruirHasta(SEMILLA, JUGADAS, 2400)
    const otra = reconstruirHasta(SEMILLA, JUGADAS, 2400)
    expect(huellaDeLaPartida(otra, true)).toBe(huellaDeLaPartida(una, true))
    expect(otra.tick).toBe(una.tick)
  })

  it('y da lo mismo en qué orden lleguen las jugadas al registro', () => {
    // El registro puede llegar desordenado (el canal en vivo y la recuperación
    // periódica se solapan). Lo que manda es el TIC de cada acción, no el orden en
    // que aparecieron.
    const alReves = [...JUGADAS].reverse()
    expect(huellaDeLaPartida(reconstruirHasta(SEMILLA, alReves, 1800), true))
      .toBe(huellaDeLaPartida(reconstruirHasta(SEMILLA, JUGADAS, 1800), true))
  })
})

describe('un solo tic de diferencia ya separa las pantallas', () => {
  it('la misma jugada un tic antes da otra partida, y casi no se nota', () => {
    // Esto era el segundo fallo de esta tanda, y no un caso de laboratorio.
    //
    // El componente mandaba la jugada al servidor con `tick + MARGEN`, calculado
    // con el tic del ÚLTIMO FOTOGRAMA PINTADO, mientras el motor la aplicaba con su
    // tic de verdad. Entre un fotograma y el clic el motor puede haber avanzado un
    // tic, así que de vez en cuando la planta entraba en mi pantalla en el tic T y
    // en la del rival en el T-1.
    //
    // LO IMPORTANTE DE ESTE TEST NO ES QUE FALLE: ES CADA CUÁNTO SE VE.
    //
    // La primera versión comparaba sólo en el tic 1800 y PASABA, o sea que no
    // detectaba nada. Con un tic de diferencia el lanzaguisantes, que dispara cada
    // 42 tics, lleva los mismos disparos en el 1800 que si hubiera entrado a
    // tiempo: la diferencia sólo asoma en el hueco de un tic entre disparo y
    // disparo, uno de cada 42.
    //
    // Ahí está la explicación de por qué esto duró tanto sin verse: mires cuando
    // mires, el 97% de las veces los dos tableros parecen iguales. Y da igual —
    // basta con que se vea una vez para que la partida termine en «tu rival dijo
    // otra cosa». Por eso el arreglo tiene que ser exacto y no aproximado.
    const bueno = reconstruirHasta(SEMILLA, JUGADAS, 200)
    const desfasado = reconstruirHasta(
      SEMILLA,
      JUGADAS.map((a) => (a.id === 3 ? { ...a, tick: a.tick - 1 } : a)),
      200
    )

    let distintos = 0
    for (let t = 200; t < 1800; t++) {
      correr(bueno, t)
      correr(desfasado, t)
      if (huellaDeLaPartida(desfasado, true) !== huellaDeLaPartida(bueno, true)) distintos++
    }

    // Se separan de verdad...
    expect(distintos).toBeGreaterThan(0)
    // ...y son minoría los tics en que se ve. Si esto empezara a fallar por lo
    // alto, mejor: querría decir que el motor delata antes los desfases.
    expect(distintos).toBeLessThan(1600 / 2)
  })
})

describe('lo que es sólo tuyo no se reconstruye', () => {
  it('los soles recogidos a mano no se pierden al reconstruir', () => {
    // Sin esto, reconstruir te quitaría los soles que habías pulsado: el registro
    // de jugadas no sabe nada de ellos. Y no hay riesgo en conservarlos, porque
    // nadie más simula tu banco.
    const viejo = reconstruirHasta(SEMILLA, JUGADAS, 1200)
    viejo.sunBank = 725
    viejo.stats.sunsCollected = 29

    const nuevo = conservarLoLocal(reconstruirHasta(SEMILLA, JUGADAS, 1200), viejo)

    expect(nuevo.sunBank).toBe(725)
    expect(nuevo.stats.sunsCollected).toBe(29)
  })

  it('pero el tablero compartido sí, que es de lo que se trata', () => {
    const viejo = reconstruirHasta(SEMILLA, JUGADAS, 1200)
    viejo.sunBank = 999
    // Se le mete una planta huérfana que no está en el registro: al reconstruir
    // debe desaparecer.
    viejo.plants.push({ ...viejo.plants[0], id: 'huerfana' })

    const nuevo = conservarLoLocal(reconstruirHasta(SEMILLA, JUGADAS, 1200), viejo)

    expect(nuevo.plants.some((p) => p.id === 'huerfana')).toBe(false)
    expect(nuevo.sunBank).toBe(999)
  })
})

describe('las mejoras de la carta tienen que viajar', () => {
  it('si no viajan, una carta mejorada separa las dos pantallas al instante', () => {
    // ESTO ES UN FALLO APARTE, y afecta a cualquiera que tenga cartas mejoradas.
    //
    // Las mejoras (statRolls) cambian la vida, el daño y la cadencia de la planta:
    // cada una suma un 15%. Quien planta las aplica; el rival, que sólo recibe la
    // carta y la casilla, planta la versión básica.
    //
    // O sea que la misma planta tiene 345 de vida en una pantalla y 300 en la otra
    // desde el momento en que se pone, sin que haga falta ningún retraso de red.
    // Al final los dos reportan resultados distintos y la partida queda en
    // revisión — el mismo síntoma, otra causa.
    const conMejoras: AccionRegistrada[] = [
      { id: 1, mia: true, tick: 100, kind: 'plant', plantId: 'peashooter' as PlantId,
        lane: 1, col: 2, statRolls: ['hp', 'damage'] as PlantStatKey[], level: 2 },
    ]
    const sinMejoras: AccionRegistrada[] = [{ ...conMejoras[0], statRolls: undefined, level: undefined }]

    const mia = reconstruirHasta(SEMILLA, conMejoras, 200)
    const suya = reconstruirHasta(SEMILLA, sinMejoras, 200)

    expect(huellaDeLaPartida(mia, true)).not.toBe(huellaDeLaPartida(suya, true))
    // Y la diferencia es exactamente el 15% por mejora de vida.
    expect(mia.plants[0].maxHp).toBe(Math.round(300 * 1.15))
    expect(suya.plants[0].maxHp).toBe(300)
  })
})
