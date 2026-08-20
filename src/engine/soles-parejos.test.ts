// ─────────────────────────────────────────────────────────────────────────────
// LOS SOLES TIENEN QUE SER LOS MISMOS PARA LOS DOS
//
// Jugando salió esto: dos jugadores recogiendo «casi al mismo tiempo», uno con
// 250 y el otro con 200. Los soles caían igual en las dos pantallas —misma
// semilla, mismo tic, misma posición—, pero cada uno tenía que PULSAR los suyos,
// y ahí se colaba una diferencia que no tiene nada que ver con jugar mejor: el
// pulso, el ratón, un dedo en un móvil.
//
// Con un ingreso que decide la partida, eso es de lo que un jugador se queja con
// razón. Estos tests fijan la regla nueva:
//
//   · pasados 5 segundos el sol entra igual, lo pulses o no;
//   · quien lo pulsa antes lo cobra ANTES —esa ventaja de tempo se mantiene, es
//     jugar mejor— pero quien se despista no cobra MENOS al final;
//   · y como lo hace el motor en un tic concreto, las dos simulaciones coinciden.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest'
import { createBattleState, stepTick, type GameState } from './simulate'
import { SOL_SE_RECOGE_SOLO_MS, SOL_DEL_CIELO_MS } from './balance'
import { msToTicks } from './time'
import { SUN_VALUE } from '../utils/gameConstants'

const callar = () => {}

function correr(estado: GameState, tics: number) {
  for (let i = 0; i < tics; i++) stepTick(estado, callar)
}

describe('un sol que no se pulsa entra igual', () => {
  it('se recoge solo pasado su plazo', () => {
    const estado = createBattleState(4242, false, true)
    const plazo = msToTicks(SOL_SE_RECOGE_SOLO_MS)

    // Hasta que cae el primer sol no hay nada que recoger.
    correr(estado, msToTicks(SOL_DEL_CIELO_MS) + 2)
    expect(estado.suns.length).toBeGreaterThan(0)
    expect(estado.sunBank).toBe(0)

    // Justo antes del plazo sigue en el campo.
    correr(estado, plazo - 2)
    expect(estado.suns.length).toBeGreaterThan(0)

    // Y pasado el plazo está en el banco.
    correr(estado, 4)
    expect(estado.sunBank).toBeGreaterThanOrEqual(SUN_VALUE)
  })

  it('no se paga dos veces', () => {
    const estado = createBattleState(4242, false, true)
    correr(estado, msToTicks(SOL_DEL_CIELO_MS) + msToTicks(SOL_SE_RECOGE_SOLO_MS) + 10)
    const despuesDelPrimero = estado.sunBank

    // Un tic más no vuelve a cobrar el mismo sol.
    stepTick(estado, callar)
    expect(estado.sunBank).toBe(despuesDelPrimero)
  })
})

describe('dos jugadores acaban con los mismos soles del cielo', () => {
  it('recoger a mano o no recoger nada da el mismo total', () => {
    // Ana pulsa todo lo que cae en cuanto puede. Beto no toca nada.
    //
    // Es el caso del que salió la queja, con la diferencia llevada al extremo:
    // antes Beto acababa con CERO y Ana con todo. Ahora los dos acaban igual.
    const ana = createBattleState(777, false, true)
    const beto = createBattleState(777, false, true)

    const TICS = msToTicks(60_000)
    for (let i = 0; i < TICS; i++) {
      stepTick(ana, callar)
      // Ana recoge a mano, igual que collectSun en el hook.
      for (const s of ana.suns) {
        ana.sunBank += s.value
        ana.stats.sunsCollected += 1
      }
      ana.suns = []

      stepTick(beto, callar)
    }

    // Lo que quede en el campo de Beto todavía es suyo: entrará en cuanto venza
    // su plazo. Se suma para comparar el ingreso TOTAL, que es lo que importa.
    const totalBeto = beto.sunBank + beto.suns.reduce((t, s) => t + s.value, 0)

    expect(ana.sunBank).toBeGreaterThan(0)
    expect(ana.sunBank).toBe(totalBeto)
  })

  it('pero quien recoge antes tiene el dinero antes', () => {
    // La ventaja de tempo sigue existiendo, y es la que hace que recoger valga la
    // pena: con los mismos soles, Ana puede plantar cinco segundos antes.
    const ana = createBattleState(31337, false, true)
    const beto = createBattleState(31337, false, true)

    const TICS = msToTicks(SOL_DEL_CIELO_MS) + 5
    for (let i = 0; i < TICS; i++) {
      stepTick(ana, callar)
      for (const s of ana.suns) ana.sunBank += s.value
      ana.suns = []
      stepTick(beto, callar)
    }

    expect(ana.sunBank).toBeGreaterThan(beto.sunBank)
    expect(beto.sunBank).toBe(0)
  })
})

describe('sigue siendo la misma partida en las dos pantallas', () => {
  it('dos ejecuciones con la misma semilla dan el mismo banco', () => {
    const total = (semilla: number) => {
      const e = createBattleState(semilla, false, true)
      correr(e, msToTicks(90_000))
      return { banco: e.sunBank, enCampo: e.suns.length, tic: e.tick }
    }
    // Si esto fallara, el ingreso dependería de algo que no está en el estado y
    // los dos jugadores volverían a tener partidas distintas.
    expect(total(9001)).toEqual(total(9001))
  })
})
