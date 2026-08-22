/**
 * LA RED DE SEGURIDAD DEL DETERMINISMO
 *
 * Estas pruebas son el motivo por el que el motor se puede llevar al servidor. Si
 * alguna falla, significa que ha entrado azar sin semilla o una lectura de reloj
 * de pared en la lógica de juego, y entonces:
 *
 *   · el servidor no puede recalcular una partida para saber quién ganó,
 *   · una repetición no reproduce lo que pasó,
 *   · y un rival asíncrono haría otra cosa cada vez.
 *
 * Conviene ejecutarlas en cada cambio del motor:  npm test
 */

import { describe, it, expect } from 'vitest'
import {
  createRng,
  cloneRng,
  nextFloat,
  nextInt,
  nextRange,
  chance,
  pick,
  entityId,
} from './rng'
import {
  TICK_MS,
  msToTicks,
  ticksToMs,
  secondsToTicks,
  isReady,
  ticksRemaining,
} from './time'

describe('generador con semilla', () => {
  it('la misma semilla da la misma secuencia', () => {
    const a = createRng(12345)
    const b = createRng(12345)
    const serieA = Array.from({ length: 500 }, () => nextFloat(a))
    const serieB = Array.from({ length: 500 }, () => nextFloat(b))
    expect(serieA).toEqual(serieB)
  })

  it('semillas distintas dan secuencias distintas', () => {
    const a = createRng(1)
    const b = createRng(2)
    const serieA = Array.from({ length: 100 }, () => nextFloat(a))
    const serieB = Array.from({ length: 100 }, () => nextFloat(b))
    expect(serieA).not.toEqual(serieB)
  })

  it('siempre devuelve valores en [0, 1)', () => {
    const rng = createRng(999)
    for (let i = 0; i < 10_000; i++) {
      const v = nextFloat(rng)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('normaliza la semilla: negativa y fraccionaria no rompen', () => {
    // Sin el >>> 0 de createRng, una semilla así daría secuencias imprevisibles
    // según cómo llegara el número desde la base de datos.
    for (const semilla of [-1, -99999, 3.7, 0]) {
      const rng = createRng(semilla)
      const v = nextFloat(rng)
      expect(Number.isFinite(v)).toBe(true)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('clonar no altera la secuencia del original', () => {
    const original = createRng(777)
    nextFloat(original)
    nextFloat(original)

    const copia = cloneRng(original)
    const desdeLaCopia = Array.from({ length: 50 }, () => nextFloat(copia))
    const desdeElOriginal = Array.from({ length: 50 }, () => nextFloat(original))

    // La copia parte del mismo estado, así que produce lo mismo.
    expect(desdeLaCopia).toEqual(desdeElOriginal)
  })

  it('se puede reanudar desde un estado guardado', () => {
    // Es lo que permite empezar a ver una repetición por la mitad.
    const rng = createRng(4242)
    for (let i = 0; i < 30; i++) nextFloat(rng)

    const guardado = rng.s
    const esperado = Array.from({ length: 20 }, () => nextFloat(rng))

    const restaurado = { s: guardado }
    const obtenido = Array.from({ length: 20 }, () => nextFloat(restaurado))

    expect(obtenido).toEqual(esperado)
  })

  it('nextInt se mantiene dentro del rango', () => {
    const rng = createRng(555)
    for (let i = 0; i < 5000; i++) {
      const v = nextInt(rng, 3) // los 3 carriles del juego
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(3)
      expect(Number.isInteger(v)).toBe(true)
    }
  })

  it('nextInt con max 0 o negativo devuelve 0 en lugar de NaN', () => {
    const rng = createRng(1)
    expect(nextInt(rng, 0)).toBe(0)
    expect(nextInt(rng, -5)).toBe(0)
  })

  it('nextRange incluye los dos extremos', () => {
    const rng = createRng(2026)
    const vistos = new Set<number>()
    for (let i = 0; i < 2000; i++) vistos.add(nextRange(rng, 2, 5))
    expect([...vistos].sort()).toEqual([2, 3, 4, 5])
  })

  it('chance respeta la probabilidad de forma aproximada', () => {
    const rng = createRng(31337)
    let aciertos = 0
    const n = 20_000
    for (let i = 0; i < n; i++) if (chance(rng, 0.15)) aciertos++
    // El bot usa chance(0.15) para el ticket de coliseo; margen amplio para no
    // tener una prueba que falle de vez en cuando.
    expect(aciertos / n).toBeGreaterThan(0.13)
    expect(aciertos / n).toBeLessThan(0.17)
  })

  it('pick devuelve undefined con array vacío y nunca sale del array', () => {
    const rng = createRng(8)
    expect(pick(rng, [])).toBeUndefined()
    const opciones = ['sunflower', 'peashooter', 'wallnut'] as const
    for (let i = 0; i < 500; i++) {
      expect(opciones).toContain(pick(rng, opciones))
    }
  })

  it('los identificadores de entidad son deterministas', () => {
    // El motor los generaba con Date.now() y Math.random(), así que al comparar
    // dos simulaciones TODAS las entidades salían distintas y la comparación era
    // inútil.
    expect(entityId('plant', 120, 7)).toBe('plant-120-7')
    expect(entityId('plant', 120, 7)).toBe(entityId('plant', 120, 7))
    expect(entityId('plant', 120, 8)).not.toBe(entityId('plant', 120, 7))
  })
})

describe('tiempo en tics', () => {
  it('un tic son 33 ms, igual que el sub-paso que ya usaba el motor', () => {
    expect(TICK_MS).toBe(33)
  })

  it('los enfriamientos redondean hacia arriba, nunca quedan más cortos', () => {
    // 7.500 ms es el enfriamiento del Peashooter. 227,27 tics → 228.
    expect(msToTicks(7500)).toBe(228)
    expect(ticksToMs(228)).toBeGreaterThanOrEqual(7500)

    // Ningún enfriamiento debe acabar antes de lo que dice la carta.
    for (const ms of [5000, 7500, 10_000, 12_000, 15_000, 1, 32, 33, 34]) {
      expect(ticksToMs(msToTicks(ms))).toBeGreaterThanOrEqual(ms)
    }
  })

  it('secondsToTicks coincide con msToTicks', () => {
    expect(secondsToTicks(7.5)).toBe(msToTicks(7500))
    expect(secondsToTicks(1)).toBe(msToTicks(1000))
  })

  it('isReady compara enteros, sin reloj de pared', () => {
    const listoEn = 100
    expect(isReady(99, listoEn)).toBe(false)
    expect(isReady(100, listoEn)).toBe(true)
    expect(isReady(101, listoEn)).toBe(true)
  })

  it('ticksRemaining nunca es negativo', () => {
    expect(ticksRemaining(50, 100)).toBe(50)
    expect(ticksRemaining(100, 100)).toBe(0)
    expect(ticksRemaining(150, 100)).toBe(0)
  })
})

describe('el acumulador de paso fijo', () => {
  /**
   * Reproduce el patrón que sustituye al bucle actual.
   *
   * El motor hacía `dt = Math.min(remainingDt, stepDt)`, así que el último paso
   * de cada fotograma valía "lo que quedara". A 144 Hz y a 30 Hz se simulaba
   * distinto. Aquí sólo se ejecutan pasos COMPLETOS y el resto se arrastra al
   * fotograma siguiente.
   */
  function avanzar(acumuladoMs: number): { tics: number; resto: number } {
    const tics = Math.floor(acumuladoMs / TICK_MS)
    return { tics, resto: acumuladoMs - tics * TICK_MS }
  }

  it('el total de tics no depende de la cadencia de fotogramas', () => {
    const totalMs = 10_000

    // Simular la misma partida a tres cadencias distintas
    const contar = (msPorFotograma: number) => {
      let resto = 0
      let tics = 0
      let transcurrido = 0
      while (transcurrido < totalMs) {
        const paso = Math.min(msPorFotograma, totalMs - transcurrido)
        transcurrido += paso
        const r = avanzar(resto + paso)
        tics += r.tics
        resto = r.resto
      }
      return tics
    }

    const a144 = contar(1000 / 144)
    const a60 = contar(1000 / 60)
    const a30 = contar(1000 / 30)

    // Esto es lo que hoy NO se cumple. Con el acumulador, las tres coinciden.
    expect(a144).toBe(a60)
    expect(a60).toBe(a30)
    expect(a60).toBe(Math.floor(totalMs / TICK_MS))
  })

  it('el resto se arrastra en lugar de perderse', () => {
    // Un fotograma de 40 ms deja 7 ms pendientes: no se descartan.
    const primero = avanzar(40)
    expect(primero.tics).toBe(1)
    expect(primero.resto).toBe(7)

    // Al fotograma siguiente esos 7 ms cuentan.
    const segundo = avanzar(primero.resto + 30)
    expect(segundo.tics).toBe(1)
    expect(segundo.resto).toBe(4)
  })

  it('un fotograma más corto que un tic no avanza la simulación', () => {
    const r = avanzar(10)
    expect(r.tics).toBe(0)
    expect(r.resto).toBe(10)
  })
})
