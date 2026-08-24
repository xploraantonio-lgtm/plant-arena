// ─────────────────────────────────────────────────────────────────────────────
// UNA REPETICIÓN REPRODUCE LA PARTIDA, NO UNA PARECIDA
//
// Es la prueba de la que depende todo lo que viene: los enlaces para compartir,
// los rivales semilla del ranked, y sobre todo la VERIFICACIÓN EN SERVIDOR — que el
// servidor recalcule quién ganó en lugar de creerse el "he ganado" de un
// navegador.
//
// Si esto fallara, una repetición sería una partida parecida y el veredicto del
// servidor podría no coincidir con lo que vieron los jugadores.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest'
import {
  construirRepeticion,
  recalcularGanador,
  recalcularGanadorAutoritativo,
  type DatosDeRepeticion,
  type JugadaGrabada,
} from './replay'
import { stepTick, createBattleState, crearPlantaDelRival, crearPlantaPropia, TIC_MUERTE_SUBITA } from './simulate'
import type { PlantId } from '../types/game'

/** Una partida grabada: lo que devuelve match_replay. */
function partidaGrabada(): DatosDeRepeticion {
  return {
    roomId: 'sala-de-prueba',
    mode: 'ranked',
    seed: 31337,
    engineVersion: 'auth-v1',
    jugadaEn: '2026-08-20T00:00:00Z',
    jugador1: {
      nombre: 'Ana',
      avatar: 'peashooter',
      mazo: [
        { plantId: 'sunflower', slot: 0, level: 0, statRolls: [] },
        { plantId: 'peashooter', slot: 1, level: 0, statRolls: [] },
        { plantId: 'chomper', slot: 2, level: 0, statRolls: [] },
      ],
    },
    jugador2: {
      nombre: 'Beto',
      avatar: 'sunflower',
      mazo: [
        { plantId: 'sunflower', slot: 0, level: 0, statRolls: [] },
        { plantId: 'wallnut', slot: 1, level: 0, statRolls: [] },
      ],
    },
    ganador: null,
    yoSoy: 1,
    jugadas: [
      { de: 1, tick: 40,  kind: 'plant', plantId: 'sunflower',  slot: 0, lane: 0, col: 1 },
      { de: 2, tick: 60,  kind: 'plant', plantId: 'sunflower',  slot: 0, lane: 1, col: 1 },
      { de: 1, tick: 200, kind: 'plant', plantId: 'peashooter', slot: 1, lane: 1, col: 2 },
      { de: 2, tick: 260, kind: 'plant', plantId: 'wallnut',    slot: 1, lane: 1, col: 3 },
      { de: 1, tick: 400, kind: 'plant', plantId: 'chomper',    slot: 2, lane: 2, col: 0 },
    ],
  }
}

describe('reproducir da exactamente la misma partida', () => {
  it('dos reproducciones de la misma grabación coinciden campo por campo', () => {
    const correr = () => {
      const rep = construirRepeticion(partidaGrabada(), 1)
      for (let i = 0; i < 900; i++) rep.avanzar()
      return JSON.stringify(rep.estado)
    }
    expect(correr()).toBe(correr())
  })

  it('reproducir coincide con haber jugado la partida en vivo', () => {
    // Ésta es LA comprobación. Se juega la partida como se jugó —las de Ana en su
    // lado, las de Beto espejadas— y se compara con la reproducción del registro.
    // Si no coincidieran, el servidor no podría recalcular quién ganó.
    const enVivo = createBattleState(31337, false, true, undefined, 'auth-v1')
    const datos = partidaGrabada()
    for (const j of datos.jugadas) {
      if (j.de === 1) {
        enVivo.pending.push({
          atTick: j.tick,
          kind: 'own_plant',
          plantId: j.plantId as PlantId,
          lane: j.lane!,
          col: j.col ?? undefined,
        })
      } else {
        enVivo.pending.push({
          atTick: j.tick,
          kind: 'rival_plant',
          plantId: j.plantId as PlantId,
          lane: j.lane!,
          col: j.col ?? undefined,
        })
      }
    }
    for (let i = 0; i < 900; i++) stepTick(enVivo, () => {})

    const rep = construirRepeticion(datos, 1)
    for (let i = 0; i < 900; i++) rep.avanzar()

    expect(JSON.stringify(rep.estado)).toBe(JSON.stringify(enVivo))
  })

  it('rebobinar y volver a avanzar da el mismo estado', () => {
    // Sin esto no se puede ofrecer una barra de tiempo: saltar a un momento daría
    // un estado distinto del que se vio pasando por ahí.
    const rep = construirRepeticion(partidaGrabada(), 1)
    rep.irAlTic(600)
    const alPasarPor = JSON.stringify(rep.estado)

    rep.irAlTic(100)      // hacia atrás: vuelve a empezar
    rep.irAlTic(600)      // y otra vez adelante
    expect(JSON.stringify(rep.estado)).toBe(alPasarPor)
  })

  it('se puede mirar desde el otro lado', () => {
    // Es lo que hace útil una repetición para aprender: ver tu propia partida
    // desde el lado del rival y entender por qué hizo lo que hizo.
    const desdeAna = construirRepeticion(partidaGrabada(), 1)
    const desdeBeto = construirRepeticion(partidaGrabada(), 2)
    for (let i = 0; i < 600; i++) { desdeAna.avanzar(); desdeBeto.avanzar() }

    // Las plantas de Ana están en su lado cuando se mira desde ella, y en el
    // contrario cuando se mira desde Beto.
    expect(desdeAna.estado.plants.length).toBe(desdeBeto.estado.enemyPlants.length)
    expect(desdeAna.estado.enemyPlants.length).toBe(desdeBeto.estado.plants.length)
    // Y las bases, cruzadas.
    expect(Math.round(desdeAna.estado.p1BaseHp)).toBe(Math.round(desdeBeto.estado.p2BaseHp))
  })

  it('el bot no interfiere: todo lo que pasa sale del registro', () => {
    // Si el bot jugara durante una reproducción, cada vez añadiría plantas que no
    // estuvieron en la partida original.
    const sinJugadas: DatosDeRepeticion = { ...partidaGrabada(), jugadas: [] }
    const rep = construirRepeticion(sinJugadas, 1)
    for (let i = 0; i < 1800; i++) rep.avanzar()

    expect(rep.estado.plants).toHaveLength(0)
    expect(rep.estado.enemyPlants).toHaveLength(0)
  })
})

describe('el servidor puede recalcular quién ganó', () => {
  it('recalcularGanador da el mismo resultado dos veces', () => {
    const a = recalcularGanador(partidaGrabada())
    const b = recalcularGanador(partidaGrabada())
    expect(a).toEqual(b)
  })

  it('no se cuelga con un registro manipulado', () => {
    // Un registro con jugadas absurdas no puede hacer girar el bucle para siempre
    // en el servidor.
    const raro: DatosDeRepeticion = {
      ...partidaGrabada(),
      jugadas: [{ de: 1, tick: 999999, kind: 'plant', plantId: 'sunflower', lane: 0, col: 0 }],
    }
    const r = recalcularGanador(raro, 3000)
    expect(r.tics).toBeLessThanOrEqual(3000)
  })
})

describe('la geometría de la reproducción es la de la partida', () => {
  it('mi planta va en mi columna y la del rival espejada', () => {
    const s = createBattleState(1, false, true)
    const mia = crearPlantaPropia(s, 'wallnut' as PlantId, 1, 4)
    const suya = crearPlantaDelRival(s, 'wallnut' as PlantId, 1, 4)

    // La misma columna, lados opuestos: espejar es 100 − x.
    expect(mia.x).toBeLessThan(50)
    expect(suya.x).toBeGreaterThan(50)
    expect(Math.round(mia.x + suya.x)).toBe(100)
  })
})

describe('la repetición llega hasta el final de la partida', () => {
  // Se compartió una batalla y el reproductor la dejaba en el segundo 102: se
  // paraba unos segundos después de la ÚLTIMA JUGADA, no al acabar la partida. Y
  // si nadie planta en el último minuto —que es lo normal cuando ya está
  // decidida— el mensaje de victoria no llegaba nunca.
  const datosCon = (jugadas: JugadaGrabada[]): DatosDeRepeticion => ({
    roomId: 'r1',
    mode: 'ranked',
    seed: 4242,
    engineVersion: 'auth-v1',
    jugadaEn: '2026-01-01T00:00:00Z',
    jugador1: {
      nombre: 'Ana',
      avatar: null,
      mazo: [
        { plantId: 'sunflower', slot: 0, level: 0, statRolls: [] },
        { plantId: 'peashooter', slot: 1, level: 0, statRolls: [] },
      ],
    },
    jugador2: {
      nombre: 'Beto',
      avatar: null,
      mazo: [
        { plantId: 'sunflower', slot: 0, level: 0, statRolls: [] },
        { plantId: 'peashooter', slot: 1, level: 0, statRolls: [] },
      ],
    },
    ganador: null,
    yoSoy: 1,
    jugadas,
  })

  it('el tic final va mucho más allá de la última jugada', () => {
    // Una sola jugada al segundo 3 y nada más. Antes: la repetición duraba 13
    // segundos. Ahora tiene que llegar hasta donde la partida se decide.
    const rep = construirRepeticion(
      datosCon([{ de: 1, tick: 90, kind: 'plant', plantId: 'sunflower', slot: 0, lane: 0, col: 2 }])
    )

    expect(rep.ultimoTic).toBe(90)
    expect(rep.ticFinal).toBeGreaterThan(rep.ultimoTic + 300)
    // Y la muerte súbita entra a los 2:30, así que el final está más allá.
    expect(rep.ticFinal).toBeGreaterThan(TIC_MUERTE_SUBITA)
  })

  it('sabe cómo acabó', () => {
    const rep = construirRepeticion(
      datosCon([
        { de: 1, tick: 30, kind: 'plant', plantId: 'peashooter', slot: 1, lane: 0, col: 2 },
        { de: 1, tick: 60, kind: 'plant', plantId: 'peashooter', slot: 1, lane: 1, col: 2 },
        { de: 1, tick: 90, kind: 'plant', plantId: 'peashooter', slot: 1, lane: 2, col: 2 },
      ])
    )
    // Ana plantó y Beto no: gana Ana, y la repetición lo sabe antes de empezar
    // (lo necesita para pintar la barra de tiempo).
    expect(rep.resultado).toBe('victory')
  })

  it('avanzando hasta el final se llega al mismo resultado', () => {
    const rep = construirRepeticion(
      datosCon([{ de: 1, tick: 30, kind: 'plant', plantId: 'peashooter', slot: 1, lane: 0, col: 2 }])
    )
    while (rep.avanzar()) { /* hasta que acabe */ }

    expect(rep.estado.status).not.toBe('playing')
    expect(rep.estado.status).toBe(rep.resultado)
    expect(rep.estado.tick).toBe(rep.ticFinal)
  })

  it('mirada desde el otro lado, el resultado es el contrario', () => {
    const jugadas: JugadaGrabada[] = [
      { de: 1, tick: 30, kind: 'plant', plantId: 'peashooter', slot: 1, lane: 0, col: 2 },
      { de: 1, tick: 60, kind: 'plant', plantId: 'peashooter', slot: 1, lane: 1, col: 2 },
    ]
    const deAna = construirRepeticion(datosCon(jugadas), 1)
    const deBeto = construirRepeticion(datosCon(jugadas), 2)

    expect(deAna.resultado).not.toBe(deBeto.resultado)
    expect(Math.abs(deAna.ticFinal - deBeto.ticFinal)).toBeLessThanOrEqual(1)
  })
})

describe('arbitro autoritativo auth-v1 (recalcularGanadorAutoritativo)', () => {
  const mazoBasico = [
    { plantId: 'peashooter', slot: 0, level: 0, statRolls: [] },
    { plantId: 'sunflower', slot: 1, level: 0, statRolls: [] },
    { plantId: 'wallnut', slot: 2, level: 0, statRolls: [] },
  ]

  it('detecta partida legal y otorga victoria al lado correspondiente', () => {
    const datos: DatosDeRepeticion = {
      roomId: 'room-auth-1',
      mode: 'ranked',
      seed: 12345,
      engineVersion: 'auth-v1',
      jugadaEn: '2026-08-20T00:00:00Z',
      jugador1: { nombre: 'Ana', avatar: null, mazo: mazoBasico },
      jugador2: { nombre: 'Beto', avatar: null, mazo: mazoBasico },
      ganador: null,
      yoSoy: 1,
      jugadas: [
        // Ana planta peashooter tras acumular 100 soles con margen de red válido (issuedTick: 960, tick: 966)
        { de: 1, seq: 1, issuedTick: 960, tick: 966, kind: 'plant', plantId: 'peashooter', lane: 1, col: 2, slot: 0 },
      ],
    }

    const res = recalcularGanadorAutoritativo(datos)
    expect(res.consistente).toBe(true)
    expect(res.ganador).toBe(1)
    expect(res.motivo).toBe('simulation')
    expect(res.ilegales).toHaveLength(0)
  })

  it('declara forfeit unilateral si un jugador comete una acción ilegal (ej. sin soles)', () => {
    const datos: DatosDeRepeticion = {
      roomId: 'room-auth-illegal',
      mode: 'ranked',
      seed: 99999,
      engineVersion: 'auth-v1',
      jugadaEn: '2026-08-20T00:00:00Z',
      jugador1: { nombre: 'Hacker', avatar: null, mazo: mazoBasico },
      jugador2: { nombre: 'Legal', avatar: null, mazo: mazoBasico },
      ganador: null,
      yoSoy: 2,
      jugadas: [
        // P1 intenta plantar peashooter 3 veces seguidas en el tick 0 sin soles suficientes (costo 100 cada uno, inicial 100)
        { de: 1, seq: 1, issuedTick: 0, tick: 6, kind: 'plant', plantId: 'peashooter', lane: 0, col: 0, slot: 0 },
        { de: 1, seq: 2, issuedTick: 0, tick: 6, kind: 'plant', plantId: 'peashooter', lane: 1, col: 0, slot: 0 },
      ],
    }

    const res = recalcularGanadorAutoritativo(datos)
    expect(res.ganador).toBe(2) // Gana P2 por forfeit de P1
    expect(res.motivo).toBe('forfeit_p1')
    expect(res.ilegales.length).toBeGreaterThan(0)
    expect(res.ilegales[0].de).toBe(1)
  })

  it('declara empate perfecto cuando ambos terminan en defeat simétrico', () => {
    const datos: DatosDeRepeticion = {
      roomId: 'room-auth-draw',
      mode: 'ranked',
      seed: 55555,
      engineVersion: 'auth-v1',
      jugadaEn: '2026-08-20T00:00:00Z',
      jugador1: { nombre: 'Ana', avatar: null, mazo: mazoBasico },
      jugador2: { nombre: 'Beto', avatar: null, mazo: mazoBasico },
      ganador: null,
      yoSoy: 1,
      jugadas: [], // Sin jugadas, la muerte súbita drena ambas bases al mismo tiempo con perfecta simetría
    }

    const res = recalcularGanadorAutoritativo(datos)
    expect(res.motivo).toBe('true_draw')
    expect(res.consistente).toBe(true)
    expect(res.ganador).toBeNull()
  })
})
