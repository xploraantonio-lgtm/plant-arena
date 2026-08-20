// ─────────────────────────────────────────────────────────────────────────────
// EL BOT NO DEBE PARECER UN BOT
//
// Estos tests no comprueban que el bot juegue bien: comprueban que tenga los
// límites de una persona. Un rival difícil que reacciona en el mismo fotograma y
// no falla nunca un clic se nota más que uno que gana.
//
// Todo con el azar CON SEMILLA, así que sus despistes son reproducibles: una
// repetición reproduce sus errores exactos y el servidor puede recalcular la
// partida.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest'
import { createRng } from './rng'
import {
  menteNueva,
  producirSol,
  recogerSoles,
  echarUnVistazo,
  leTocaJugar,
  nivelPorElo,
  NIVEL_POR_DEFECTO,
} from './bot'

/**
 * Un nivel que NO falla ningún sol.
 *
 * Para probar el RETARDO hace falta separarlo del FALLO: con un nivel normal, el
 * sol del test puede escaparse y entonces no se mide el retardo, se mide otra
 * cosa. (La primera versión de estos tests fallaba justo por eso.)
 */
const SIN_FALLOS = { ...NIVEL_POR_DEFECTO, solesQueFalla: 0 }

describe('los soles se le escapan y llegan tarde, como a una persona', () => {
  it('no recoge el sol en el mismo instante en que se produce', () => {
    // Era lo que más delataba al bot anterior: +25 automáticos cada 6 segundos
    // mientras el jugador tenía que pulsar cada sol. Se sentía como "los captura
    // antes de que yo pueda".
    const mente = menteNueva()
    const rng = createRng(1)
    producirSol(mente, rng, SIN_FALLOS, 0, 25)

    expect(recogerSoles(mente, 0)).toBe(0)   // en el instante, nada
    // Y tarda al menos 300 ms (9 tics) en cogerlo.
    expect(recogerSoles(mente, 8)).toBe(0)
  })

  it('acaba recogiéndolo', () => {
    const mente = menteNueva()
    const rng = createRng(7)
    producirSol(mente, rng, SIN_FALLOS, 0, 25)
    // Pasado el margen de reacción del nivel, ya está en el banco.
    expect(recogerSoles(mente, 200)).toBe(25)
    // Y no se cobra dos veces.
    expect(recogerSoles(mente, 300)).toBe(0)
  })

  it('se le escapan algunos, y más cuanto peor juega', () => {
    const cuantosRecoge = (elo: number) => {
      const mente = menteNueva()
      const rng = createRng(4242)
      const nivel = nivelPorElo(elo)
      for (let i = 0; i < 400; i++) producirSol(mente, rng, nivel, i * 10, 25)
      return recogerSoles(mente, 99999) / 25
    }

    const novato = cuantosRecoge(1000)
    const bueno = cuantosRecoge(3000)

    // Al novato se le escapa una parte apreciable.
    expect(novato).toBeLessThan(400)
    // Al bueno se le escapan menos, pero NO cero: sigue siendo una persona.
    expect(bueno).toBeGreaterThan(novato)
    expect(bueno).toBeLessThan(400)
  })

  it('los soles llegan a rachas, no a compás', () => {
    // Un ingreso perfectamente regular suena a máquina aunque los números sean
    // correctos. Lo que se mide es que los momentos de cobro NO estén igualmente
    // espaciados.
    const mente = menteNueva()
    const rng = createRng(31337)
    for (let i = 0; i < 60; i++) producirSol(mente, rng, SIN_FALLOS, i * 182, 25)

    const momentos: number[] = []
    for (let t = 0; t < 12000; t++) {
      if (recogerSoles(mente, t) > 0) momentos.push(t)
    }
    const huecos = momentos.slice(1).map((m, i) => m - momentos[i])
    const media = huecos.reduce((a, b) => a + b, 0) / huecos.length
    const desviacion = Math.sqrt(
      huecos.reduce((a, b) => a + (b - media) ** 2, 0) / huecos.length
    )

    expect(huecos.length).toBeGreaterThan(20)
    // Si fuera un metrónomo la desviación sería casi cero.
    expect(desviacion).toBeGreaterThan(2)
  })
})

describe('ve tarde, y por eso se le puede sorprender', () => {
  it('no se entera de una amenaza nueva hasta pasado su tiempo de reacción', () => {
    const mente = menteNueva()
    const nivel = nivelPorElo(1500)   // 1200 ms ≈ 37 tics

    echarUnVistazo(mente, nivel, 100, [1])
    expect(mente.carrilesVistos).toEqual([1])

    // Plantas algo en otro carril justo después: todavía no lo ve.
    echarUnVistazo(mente, nivel, 110, [1, 2])
    expect(mente.carrilesVistos).toEqual([1])

    // Pasado su tiempo de reacción, sí.
    echarUnVistazo(mente, nivel, 100 + 40, [1, 2])
    expect(mente.carrilesVistos).toEqual([1, 2])
  })

  it('quien juega mejor reacciona antes, pero nunca al instante', () => {
    const novato = nivelPorElo(1000)
    const bueno = nivelPorElo(3000)
    expect(bueno.reaccionMs).toBeLessThan(novato.reaccionMs)
    expect(bueno.reaccionMs).toBeGreaterThan(0)
  })
})

describe('su ritmo sube y baja', () => {
  it('no planta a intervalos iguales', () => {
    // El bot anterior plantaba cada 2,2 segundos exactos, y ACELERABA con las
    // oleadas: se volvía más máquina justo cuando la partida se pone tensa.
    const mente = menteNueva()
    const rng = createRng(555)
    const nivel = nivelPorElo(1500)

    const momentos: number[] = []
    for (let t = 0; t < 6000; t++) {
      if (leTocaJugar(mente, rng, nivel, t, 2000)) momentos.push(t)
    }
    const huecos = momentos.slice(1).map((m, i) => m - momentos[i])
    const distintos = new Set(huecos)

    expect(huecos.length).toBeGreaterThan(20)
    // Un metrónomo daría un solo valor.
    expect(distintos.size).toBeGreaterThan(8)
  })

  it('de vez en cuando se queda pensando el doble', () => {
    const mente = menteNueva()
    const rng = createRng(909)
    const nivel = nivelPorElo(1500)

    const momentos: number[] = []
    for (let t = 0; t < 20000; t++) {
      if (leTocaJugar(mente, rng, nivel, t, 2000)) momentos.push(t)
    }
    const huecos = momentos.slice(1).map((m, i) => m - momentos[i])
    const base = 2000 / 33

    // Alguna pausa larga: es lo que rompe el patrón. Sin ella, aunque cada
    // intervalo varíe, la media sigue sonando a compás.
    expect(Math.max(...huecos)).toBeGreaterThan(base * 1.8)
  })
})

describe('todo esto sigue siendo reproducible', () => {
  it('la misma semilla da los mismos despistes', () => {
    const jugar = () => {
      const mente = menteNueva()
      const rng = createRng(12345)
      const nivel = nivelPorElo(1500)
      let recogido = 0
      const jugadas: number[] = []
      for (let t = 0; t < 3000; t++) {
        if (t % 182 === 0) producirSol(mente, rng, nivel, t, 25)
        recogido += recogerSoles(mente, t)
        if (leTocaJugar(mente, rng, nivel, t, 2000)) jugadas.push(t)
      }
      return { recogido, jugadas: jugadas.join(',') }
    }

    // Si esto fallara, las repeticiones no reproducirían la partida y el servidor
    // no podría recalcularla: los errores del bot forman parte de lo que pasó.
    expect(jugar()).toEqual(jugar())
  })
})
