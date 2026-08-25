import { describe, it, expect } from 'vitest'
import { simulateAsyncMatch, registrarAccionP1Async, type AccionP1Simulacion } from './asyncOpponent'
import { recalcularGanadorAutoritativo, type DatosDeRepeticion, type JugadaGrabada } from './replay'
import { createBattleState, stepTick } from './simulate'
import type { CartaDeMazo } from './mazoDeLaSala.ts'

describe('B. Victoria Autoritativa Contra Rival Inactivo (0, 1 y N acciones)', () => {
  const p1Deck: CartaDeMazo[] = [
    { slot: 0, plantId: 'peashooter', level: 1, statRolls: [] },
    { slot: 1, plantId: 'repeater', level: 1, statRolls: [] },
    { slot: 2, plantId: 'wallnut', level: 1, statRolls: [] },
    { slot: 3, plantId: 'sunflower', level: 1, statRolls: [] },
  ]
  const p2Deck: CartaDeMazo[] = [
    { slot: 0, plantId: 'sunflower', level: 1, statRolls: [] },
    { slot: 1, plantId: 'wallnut', level: 1, statRolls: [] },
  ]

  function generarTimelineP1Victoria(seed: number): AccionP1Simulacion[] {
    const discovery = createBattleState(seed, false, true, undefined, 'auth-v2')
    const suns: { id: string; tick: number }[] = []

    while (discovery.tick < 3000) {
      for (const s of discovery.suns) {
        if (!suns.some((x) => x.id === s.id)) suns.push({ id: s.id, tick: discovery.tick })
      }
      stepTick(discovery, () => {})
    }

    const p1Historial: AccionP1Simulacion[] = []
    let seq = 1

    // Recolectar primeros 4 soles (100 soles)
    registrarAccionP1Async(p1Historial, { seq: seq++, tick: 80, issuedTick: 80, kind: 'collect', targetId: suns[0].id })
    registrarAccionP1Async(p1Historial, { seq: seq++, tick: 265, issuedTick: 265, kind: 'collect', targetId: suns[1].id })
    registrarAccionP1Async(p1Historial, { seq: seq++, tick: 445, issuedTick: 445, kind: 'collect', targetId: suns[2].id })
    registrarAccionP1Async(p1Historial, { seq: seq++, tick: 630, issuedTick: 630, kind: 'collect', targetId: suns[3].id })

    // Plantar Peashooter en carril 0 (coste 100)
    registrarAccionP1Async(p1Historial, { seq: seq++, tick: 646, issuedTick: 640, kind: 'plant', plantId: 'peashooter', slot: 0, lane: 0, col: 0 })

    // Recolectar siguientes 8 soles (200 soles)
    registrarAccionP1Async(p1Historial, { seq: seq++, tick: 810, issuedTick: 810, kind: 'collect', targetId: suns[4].id })
    registrarAccionP1Async(p1Historial, { seq: seq++, tick: 995, issuedTick: 995, kind: 'collect', targetId: suns[5].id })
    registrarAccionP1Async(p1Historial, { seq: seq++, tick: 1180, issuedTick: 1180, kind: 'collect', targetId: suns[6].id })
    registrarAccionP1Async(p1Historial, { seq: seq++, tick: 1360, issuedTick: 1360, kind: 'collect', targetId: suns[7].id })
    registrarAccionP1Async(p1Historial, { seq: seq++, tick: 1545, issuedTick: 1545, kind: 'collect', targetId: suns[8].id })
    registrarAccionP1Async(p1Historial, { seq: seq++, tick: 1725, issuedTick: 1725, kind: 'collect', targetId: suns[9].id })
    registrarAccionP1Async(p1Historial, { seq: seq++, tick: 1910, issuedTick: 1910, kind: 'collect', targetId: suns[10].id })
    registrarAccionP1Async(p1Historial, { seq: seq++, tick: 2090, issuedTick: 2090, kind: 'collect', targetId: suns[11].id })

    // Plantar Repeater en carril 0 (coste 200)
    registrarAccionP1Async(p1Historial, { seq: seq++, tick: 2106, issuedTick: 2100, kind: 'plant', plantId: 'repeater', slot: 1, lane: 0, col: 1 })

    return p1Historial
  }

  const p1Actions = generarTimelineP1Victoria(12345)

  it('1. Rival con 0 intenciones (AFK): P1 destruye la base y es declarado ganador autoritativo (winner = 1, motivo = simulation)', () => {
    const p2Intents0: any[] = [] // 0 intenciones

    const res = simulateAsyncMatch(
      12345,
      p1Deck,
      p2Deck,
      p1Actions,
      p2Intents0,
      4500,
      'auth-v2'
    )

    expect(res.ok).toBe(true)
    expect(res.p1Ilegal).toBe(false)
    expect(res.baseP2).toBeLessThanOrEqual(0)
    expect(res.baseP1).toBeGreaterThan(0)
    expect(res.ganador).toBe(1)
    expect(res.motivo).toBe('simulation')
    expect(res.telemetria.intentionsTotal).toBe(0)
    expect(res.telemetria.intentionsExecuted).toBe(0)
  })

  it('2. Rival con 1 intención: P1 destruye la base y es declarado ganador autoritativo (winner = 1, motivo = simulation)', () => {
    const p2Intents1 = [
      { seq: 1, tick: 506, issuedTick: 500, kind: 'plant' as const, plantId: 'wallnut', lane: 1, col: 0, slot: 1 },
    ]

    const res = simulateAsyncMatch(
      12345,
      p1Deck,
      p2Deck,
      p1Actions,
      p2Intents1,
      4500,
      'auth-v2'
    )

    expect(res.ok).toBe(true)
    expect(res.p1Ilegal).toBe(false)
    expect(res.baseP2).toBeLessThanOrEqual(0)
    expect(res.baseP1).toBeGreaterThan(0)
    expect(res.ganador).toBe(1)
    expect(res.motivo).toBe('simulation')
    expect(res.telemetria.intentionsTotal).toBe(1)
  })

  it('3. Rival con múltiples intenciones (N acciones): P1 destruye la base y es declarado ganador autoritativo', () => {
    const p2IntentsN = [
      { seq: 1, tick: 506, issuedTick: 500, kind: 'plant' as const, plantId: 'wallnut', lane: 1, col: 0, slot: 1 },
      { seq: 2, tick: 1006, issuedTick: 1000, kind: 'plant' as const, plantId: 'wallnut', lane: 2, col: 0, slot: 1 },
    ]

    const res = simulateAsyncMatch(
      12345,
      p1Deck,
      p2Deck,
      p1Actions,
      p2IntentsN,
      4500,
      'auth-v2'
    )

    expect(res.ok).toBe(true)
    expect(res.p1Ilegal).toBe(false)
    expect(res.baseP2).toBeLessThanOrEqual(0)
    expect(res.baseP1).toBeGreaterThan(0)
    expect(res.ganador).toBe(1)
    expect(res.motivo).toBe('simulation')
  })

  it('4. Replay autoritativo PvP (recalcularGanadorAutoritativo) ante P2 con 0 acciones produce ganador = 1', () => {
    const jugadasP1: JugadaGrabada[] = p1Actions.map((a) => ({
      de: 1 as const,
      seq: a.seq,
      tick: a.tick,
      issuedTick: a.issuedTick,
      kind: a.kind,
      plantId: a.plantId ?? null,
      lane: a.lane ?? null,
      col: a.col ?? null,
      slot: a.slot ?? null,
      targetId: a.targetId ?? null,
    }))

    const datosRepeticion: DatosDeRepeticion = {
      roomId: 'room-test-1',
      mode: 'ranked',
      seed: 12345,
      engineVersion: 'auth-v2',
      jugadaEn: new Date().toISOString(),
      jugadas: jugadasP1,
      jugador1: { nombre: 'P1', avatar: '1', mazo: p1Deck },
      jugador2: { nombre: 'P2', avatar: '2', mazo: p2Deck },
      ganador: 1,
      yoSoy: 1,
    }

    const res = recalcularGanadorAutoritativo(datosRepeticion, 4500)

    expect(res.consistente).toBe(true)
    expect(res.ganador).toBe(1)
    expect(res.motivo).toBe('simulation')
    expect(res.baseP2).toBeLessThanOrEqual(0)
    expect(res.baseP1).toBeGreaterThan(0)
  })
})
