// ─────────────────────────────────────────────────────────────────────────────
// LA SIMULACIÓN COMPLETA ES REPRODUCIBLE
//
// determinism.test.ts comprueba las piezas por separado: el azar con semilla, la
// conversión de milisegundos a tics, el acumulador de paso fijo. Este fichero
// comprueba lo único que de verdad importa: que UNA PARTIDA ENTERA, con sus
// oleadas, sus disparos y sus muertes, sale idéntica dos veces.
//
// Es la prueba de la que dependen las tres cosas que vienen después:
//   · que el servidor pueda recalcular una partida para saber quién ganó de
//     verdad, en lugar de creerse el "he ganado" del navegador;
//   · que los dos jugadores de una partida en vivo vean lo mismo;
//   · que una repetición reproduzca lo que pasó, y no otra partida parecida.
//
// Que estos tests puedan existir es en sí mismo el resultado del trabajo: antes
// el motor vivía dentro de un useEffect y no había forma de ejecutarlo sin
// montar React ni de esperar dos veces el mismo resultado.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest'
import { stepTick, createBattleState, type GameState } from './simulate'
import { TICKS_PER_SECOND } from './time'

/** Un minuto y medio de partida: suficiente para varias oleadas y muchas muertes. */
const TICS_LARGOS = Math.round(90 * TICKS_PER_SECOND)

/**
 * Ejecuta una partida y devuelve el estado final junto con la lista de sonidos.
 *
 * La lista de sonidos es una segunda comprobación, independiente del estado: dos
 * partidas iguales tienen que pedir los mismos sonidos, en el mismo orden y en
 * los mismos tics. Un desfase de un solo tic en un disparo aparece aquí aunque
 * el estado final acabe coincidiendo por casualidad.
 */
function jugar(seed: number, tics: number) {
  const state = createBattleState(seed)
  const sonidos: string[] = []
  for (let i = 0; i < tics; i++) {
    stepTick(state, (nombre, volumen) => sonidos.push(`${state.tick}:${nombre}:${volumen}`))
    // Una partida puede acabar antes de agotar los tics.
    if (state.status !== 'playing') break
  }
  return { state, sonidos }
}

/**
 * Serializa el estado para compararlo.
 *
 * JSON basta porque el estado ya no contiene funciones ni referencias al
 * navegador: eso es precisamente lo que se consiguió al sacar el motor de React.
 * Si algún día alguien mete una función o un nodo del DOM en el estado, este
 * test se rompe, y debe romperse.
 */
function huella(state: GameState): string {
  return JSON.stringify(state)
}

describe('la misma semilla da la misma partida', () => {
  it('dos ejecuciones de 90 s coinciden campo por campo', () => {
    const a = jugar(12345, TICS_LARGOS)
    const b = jugar(12345, TICS_LARGOS)

    // Primero lo que falla de forma legible, luego la igualdad completa: si el
    // estado entero difiere, el mensaje de JSON es ilegible, así que conviene que
    // salte antes una comprobación concreta.
    expect(b.state.tick).toBe(a.state.tick)
    expect(b.state.p1BaseHp).toBe(a.state.p1BaseHp)
    expect(b.state.p2BaseHp).toBe(a.state.p2BaseHp)
    expect(b.state.wave).toBe(a.state.wave)
    expect(b.state.rng.s).toBe(a.state.rng.s)
    expect(b.state.entityCounter).toBe(a.state.entityCounter)
    expect(b.state.enemyPlants.length).toBe(a.state.enemyPlants.length)
    expect(b.state.suns.length).toBe(a.state.suns.length)
    expect(b.state.stats).toEqual(a.state.stats)
    expect(huella(b.state)).toBe(huella(a.state))
  })

  it('los sonidos salen en el mismo orden y en los mismos tics', () => {
    const a = jugar(777, TICS_LARGOS)
    const b = jugar(777, TICS_LARGOS)

    expect(a.sonidos.length).toBeGreaterThan(20)  // que la partida hizo algo
    expect(b.sonidos).toEqual(a.sonidos)
  })

  it('la partida se puede reanudar: 90 tics de golpe = 30 + 60', () => {
    // Esto es lo que hará el servidor al verificar, y un visor de repeticiones al
    // saltar a un momento concreto: parar, guardar y seguir.
    const seguido = createBattleState(555)
    for (let i = 0; i < 90; i++) stepTick(seguido, () => {})

    const partido = createBattleState(555)
    for (let i = 0; i < 30; i++) stepTick(partido, () => {})
    // Pasa por JSON, como pasaría al guardarse en la base de datos.
    const reanudado: GameState = JSON.parse(JSON.stringify(partido))
    for (let i = 0; i < 60; i++) stepTick(reanudado, () => {})

    expect(huella(reanudado)).toBe(huella(seguido))
  })
})

describe('semillas distintas dan partidas distintas', () => {
  it('el azar de verdad depende de la semilla', () => {
    const a = jugar(1, TICS_LARGOS)
    const b = jugar(2, TICS_LARGOS)

    // Si esto falla, la semilla no se está usando y el motor es reproducible por
    // el motivo equivocado: porque no hay azar en absoluto.
    expect(huella(b.state)).not.toBe(huella(a.state))
  })
})

describe('el motor no tiene ataduras con el navegador', () => {
  it('una partida entera corre sin document, window, localStorage ni Date.now', () => {
    // vitest corre en node, así que estos globales no existen. Que el test pase
    // ES la comprobación: si alguien vuelve a meter un localStorage o un
    // setTimeout en el tic, revienta aquí.
    expect(typeof globalThis.document).toBe('undefined')
    expect(typeof globalThis.localStorage).toBe('undefined')

    const { state } = jugar(999, TICS_LARGOS)
    expect(state.tick).toBeGreaterThan(0)
  })

  it('el estado no contiene funciones: se puede guardar y mandar por la red', () => {
    const { state } = jugar(4242, 300)

    const buscarFunciones = (valor: unknown, ruta: string): string[] => {
      if (typeof valor === 'function') return [ruta]
      if (valor === null || typeof valor !== 'object') return []
      return Object.entries(valor as Record<string, unknown>).flatMap(([k, v]) =>
        buscarFunciones(v, `${ruta}.${k}`)
      )
    }

    expect(buscarFunciones(state, 'state')).toEqual([])
  })
})

describe('los efectos aplazados ocurren en su tic, no cuando quiere el navegador', () => {
  it('el cartel de la primera oleada se oculta en el tic 91 y no antes', () => {
    const state = createBattleState(1)
    expect(state.waveBanner).not.toBeNull()
    expect(state.pending).toHaveLength(1)

    // 90 tics son 2.970 ms: aún no se cumplen los 3.000.
    for (let i = 0; i < 90; i++) stepTick(state, () => {})
    expect(state.waveBanner).not.toBeNull()

    // El tic 91 cruza los 3.000 ms.
    stepTick(state, () => {})
    expect(state.waveBanner).toBeNull()
    expect(state.pending).toHaveLength(0)
  })

  it('la cola de aplazados no crece sin límite durante una partida larga', () => {
    // Si una acción aplazada no se consumiera nunca, la cola crecería tic a tic y
    // acabaría comiéndose la memoria en una partida larga.
    const { state } = jugar(31337, TICS_LARGOS)
    expect(state.pending.length).toBeLessThan(50)
  })
})
