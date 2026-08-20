// ─────────────────────────────────────────────────────────────────────────────
// TODA PARTIDA TERMINA, Y TERMINA CON UN RESULTADO
//
// El fallo que arreglan estos tests se vio jugando: una partida en la que nadie
// atacó ni se rindió apareció en la lista como "SIN RESULTADO". No era un fallo
// del registro — es que la partida no tenía final. Los dos plantaban girasoles,
// ninguno llegaba a la base del otro, y a los 120 segundos sin jugadas el
// servidor daba la sala por abandonada.
//
// Lo que se comprueba aquí:
//   · que una partida en la que NO PASA NADA acaba igual;
//   · que la muerte súbita desgasta lo mismo a los dos, así que no cambia quién
//     va ganando: sólo obliga a decidirlo;
//   · y lo más delicado: que las dos pantallas coinciden. Cada jugador se simula
//     a sí mismo como p1, así que cualquier regla que mire un lado concreto haría
//     que los dos se declararan ganadores — y dos reportes contradictorios son
//     una disputa, o sea una partida sin ELO para nadie.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest'
import {
  createBattleState,
  stepTick,
  decidirPorPuntos,
  enMuerteSubita,
  TIC_MUERTE_SUBITA,
  TIC_TOPE_DE_PARTIDA,
  type GameState,
} from './simulate'
import type { PlantId } from '../types/game'

const callar = () => {}

/** Corre hasta que la partida acabe, con un tope de seguridad. */
function jugarHastaElFinal(estado: GameState, tope = TIC_TOPE_DE_PARTIDA + 100): number {
  let tics = 0
  while (estado.status === 'playing' && tics < tope) {
    stepTick(estado, callar)
    tics += 1
  }
  return tics
}

describe('una partida no puede quedarse abierta', () => {
  it('acaba aunque nadie haga nada', () => {
    // Sin bot y sin jugadas: exactamente el caso que se quedaba sin resultado.
    const estado = createBattleState(1234, false, true)
    const tics = jugarHastaElFinal(estado)

    expect(estado.status).not.toBe('playing')
    // No antes de la muerte súbita: nadie atacó, así que nada podía tirar una base.
    expect(tics).toBeGreaterThan(TIC_MUERTE_SUBITA)
    // Y bastante antes del tope: la decide el desgaste, no la red de seguridad.
    expect(tics).toBeLessThan(TIC_TOPE_DE_PARTIDA)
  })

  it('antes de la muerte súbita no se toca ninguna base', () => {
    const estado = createBattleState(1234, false, true)
    const vidaInicial = estado.p1BaseHp
    while (estado.tick < TIC_MUERTE_SUBITA - 1) stepTick(estado, callar)

    expect(enMuerteSubita(estado)).toBe(false)
    expect(estado.p1BaseHp).toBe(vidaInicial)
    expect(estado.p2BaseHp).toBe(vidaInicial)
  })

  it('en muerte súbita las dos bases pierden lo MISMO', () => {
    // Es lo que hace que el desgaste no reparta ventaja: sólo acelera el final.
    const estado = createBattleState(1234, false, true)
    while (estado.tick < TIC_MUERTE_SUBITA + 300) stepTick(estado, callar)

    expect(enMuerteSubita(estado)).toBe(true)
    expect(estado.p1BaseHp).toBeLessThan(600)
    expect(estado.p1BaseHp).toBe(estado.p2BaseHp)
  })

  it('en práctica no hay muerte súbita', () => {
    // La práctica es un campo de tiro: no hay rival ni partida que cerrar.
    const estado = createBattleState(1234, true)
    while (estado.tick < TIC_MUERTE_SUBITA + 300) stepTick(estado, callar)

    expect(enMuerteSubita(estado)).toBe(false)
    expect(estado.p1BaseHp).toBe(600)
    expect(estado.status).toBe('playing')
  })
})

describe('quien va ganando, gana', () => {
  const conVidas = (mia: number, suya: number): GameState => {
    const e = createBattleState(7, false, true)
    e.p1BaseHp = mia
    e.p2BaseHp = suya
    return e
  }

  it('decide por la vida de la base', () => {
    expect(decidirPorPuntos(conVidas(400, 100))).toBe('victory')
    expect(decidirPorPuntos(conVidas(100, 400))).toBe('defeat')
  })

  it('con la misma vida, decide quién tiene más plantas', () => {
    const e = conVidas(300, 300)
    e.pending.push({ atTick: 1, kind: 'own_plant', plantId: 'sunflower' as PlantId, lane: 0, col: 2 })
    stepTick(e, callar)
    stepTick(e, callar)

    expect(e.plants.length).toBe(1)
    expect(e.enemyPlants.length).toBe(0)
    expect(decidirPorPuntos(e)).toBe('victory')
  })

  it('la que va perdiendo cae primero, no la de quien mira', () => {
    // Con menos vida en MI base, el desgaste me la tira antes: pierdo yo. Si el
    // orden de las comprobaciones mirara siempre p1 primero, este test pasaría
    // igual — el que lo caza es el de las dos pantallas, más abajo.
    const e = conVidas(100, 500)
    jugarHastaElFinal(e)
    expect(e.status).toBe('defeat')

    const f = conVidas(500, 100)
    jugarHastaElFinal(f)
    expect(f.status).toBe('victory')
  })
})

describe('las dos pantallas cuentan lo mismo', () => {
  /**
   * Monta la MISMA partida vista desde los dos lados.
   *
   * Ana planta; en la pantalla de Ana eso es una planta propia y en la de Beto
   * es una planta del rival. Es como funciona de verdad: cada cliente se simula
   * a sí mismo como p1.
   */
  function dosPantallas(jugadasDeAna: Array<{ carta: PlantId; lane: number; col: number; tick: number }>) {
    const ana = createBattleState(99, false, true)
    const beto = createBattleState(99, false, true)

    for (const j of jugadasDeAna) {
      ana.pending.push({ atTick: j.tick, kind: 'own_plant', plantId: j.carta, lane: j.lane, col: j.col })
      beto.pending.push({ atTick: j.tick, kind: 'rival_plant', plantId: j.carta, lane: j.lane, col: j.col })
    }
    return { ana, beto }
  }

  it('si una gana, la otra pierde — nunca las dos lo mismo', () => {
    // Ana pone tres lanzaguisantes y nada más: acabará por delante.
    const { ana, beto } = dosPantallas([
      { carta: 'peashooter' as PlantId, lane: 0, col: 2, tick: 10 },
      { carta: 'peashooter' as PlantId, lane: 1, col: 2, tick: 20 },
      { carta: 'peashooter' as PlantId, lane: 2, col: 2, tick: 30 },
    ])

    jugarHastaElFinal(ana)
    jugarHastaElFinal(beto)

    expect(ana.status).not.toBe('playing')
    expect(beto.status).not.toBe('playing')
    // Lo único que no puede pasar: que las dos digan lo mismo. Eso es un "he
    // ganado yo" en las dos pantallas, dos reportes contradictorios y una
    // partida sin resultado para nadie.
    expect(ana.status).not.toBe(beto.status)
    expect(ana.status).toBe('victory')
    expect(beto.status).toBe('defeat')
  })

  it('sin jugadas, las dos pantallas acaban igual y en el mismo tic', () => {
    // Empate perfecto: no hay forma simétrica de sacar un ganador, así que las
    // dos dan derrota. El servidor ve dos reportes que no coinciden y lo registra
    // como empate — sin ELO y, en coliseo, devolviendo lo apostado. Que es lo que
    // corresponde a un empate.
    const { ana, beto } = dosPantallas([])
    const t1 = jugarHastaElFinal(ana)
    const t2 = jugarHastaElFinal(beto)

    expect(t1).toBe(t2)
    expect(ana.status).toBe('defeat')
    expect(beto.status).toBe('defeat')
  })
})
