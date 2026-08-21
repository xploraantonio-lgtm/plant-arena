// ─────────────────────────────────────────────────────────────────────────────
// LAS QUINCE CARTAS HACEN ALGO EN EL MOTOR
//
// La pregunta es buena y no se responde de memoria: el jalapeño parecía estar y
// no estaba — su daño de 1000 al carril vivía en el manejador del clic, así que
// arrasaba una pantalla y no hacía nada en la otra.
//
// Este test recorre el catálogo ENTERO (PLANT_CONFIGS, no una lista escrita a
// mano) y comprueba que cada carta produce su efecto DENTRO del motor. El día que
// se añada la carta 16 y se olvide su comportamiento, lo dice aquí en lugar de en
// una partida con dinero en juego.
//
// Lo que NO se comprueba es que cada carta esté nombrada en simulate.ts: bonkchoy
// y tallnut no lo están y están bien —uno es un cuerpo a cuerpo que camina y el
// otro un muro— porque van por el camino genérico. Lo que se comprueba es que
// hacen lo suyo.
//
// Y cada una necesita SU escenario. La primera versión de este test le pedía a
// todas lo mismo y fallaba en cinco: la patata mina sólo estalla si algo la pisa,
// la lechuga congela en su primer tic y siete segundos después ya está deshelado,
// el aloe cura en lugar de pegar, y el girasol tarda quince segundos en su primer
// ciclo. Ninguno era un fallo del motor: era el test pidiendo lo que no toca.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest'
import { createBattleState, stepTick, crearPlantaDelRival, crearPlantaPropia, type GameState } from './simulate'
import { PLANT_CONFIGS } from '../utils/gameConstants'
import type { PlantId } from '../types/game'

const callar = () => {}
const TODAS = Object.keys(PLANT_CONFIGS) as PlantId[]

/**
 * Qué hace cada carta. Todas las del catálogo tienen que estar aquí, y las que
 * necesitan un escenario propio salen marcadas para que se compruebe aparte.
 */
const QUE_HACE: Record<PlantId, 'produce' | 'daña' | 'aguanta' | 'cura' | 'aparte'> = {
  sunflower: 'produce',
  twinsunflower: 'produce',
  peashooter: 'daña',
  repeater: 'daña',
  threepeater: 'daña',
  melonpult: 'daña',
  chomper: 'daña',
  bonkchoy: 'daña',
  garlic: 'daña',
  wallnut: 'aguanta',
  tallnut: 'aguanta',
  aloe: 'cura',
  squash: 'aparte',          // sólo estalla si algo la pisa
  iceberglettuce: 'aparte',  // congela en su primer tic
  jalapeno: 'aparte',        // explota y no deja planta
}

function correr(estado: GameState, tics: number) {
  for (let i = 0; i < tics; i++) stepTick(estado, callar)
}

/** Una partida con un enemigo delante al que se le puede medir el daño. */
function conUnEnemigoDelante(lane = 1) {
  const estado: GameState = createBattleState(4242, false, true)
  const victima = crearPlantaDelRival(estado, 'wallnut' as PlantId, lane, 6)
  victima.hp = 100000
  victima.maxHp = 100000
  estado.enemyPlants.push(victima)
  return { estado, victima }
}

describe('el catálogo y el motor no se han separado', () => {
  it('las quince cartas están declaradas en este test', () => {
    // Si esto falla es que se añadió una carta y nadie dijo qué hace.
    expect(TODAS.length).toBe(15)
    for (const carta of TODAS) {
      expect(QUE_HACE[carta], `falta declarar qué hace ${carta}`).toBeDefined()
    }
  })

  it('ninguna carta se queda sin plantar', () => {
    // El caso más tonto y el más caro: una carta que al plantarse no aparece.
    for (const carta of TODAS) {
      if (carta === 'jalapeno') continue   // no deja planta: se comprueba abajo
      const estado = createBattleState(1, false, true)
      estado.pending.push({ atTick: 1, kind: 'own_plant', plantId: carta, lane: 1, col: 3 })
      correr(estado, 3)

      expect(estado.plants.length, `${carta} no llegó al campo`).toBe(1)
      expect(estado.plants[0].plantId).toBe(carta)
      expect(estado.plants[0].hp, `${carta} nació sin vida`).toBeGreaterThan(0)
    }
  })
})

describe('cada carta hace lo suyo', () => {
  for (const carta of TODAS) {
    const hace = QUE_HACE[carta]
    if (hace === 'aparte') continue

    it(`${carta} (${hace})`, () => {
      const { estado, victima } = conUnEnemigoDelante(1)
      const vidaInicial = victima.hp

      // Un aliado herido en el mismo carril, para que el aloe tenga a quien curar.
      let herido: { hp: number } | undefined
      if (hace === 'cura') {
        const h = crearPlantaPropia(estado, 'wallnut' as PlantId, 1, 4)
        h.hp = 10
        estado.plants.push(h)
        herido = h
      }

      estado.pending.push({ atTick: 1, kind: 'own_plant', plantId: carta, lane: 1, col: 3 })

      // Veinticinco segundos: da para el ciclo del girasol (15 s más los 5 que
      // tarda el sol en recogerse solo) y para varias tandas de disparos.
      correr(estado, 760)

      if (hace === 'produce') {
        // El sol del cielo también entra al banco, así que el banco a secas no
        // dice nada: se compara contra la MISMA partida sin la carta.
        const testigo = createBattleState(4242, false, true)
        correr(testigo, 760)
        expect(estado.sunBank, `${carta} no produjo soles`).toBeGreaterThan(testigo.sunBank)
        return
      }

      if (hace === 'daña') {
        const laVictima = estado.enemyPlants.find((p) => p.id === victima.id)
        expect(laVictima, `${carta}: la víctima desapareció`).toBeDefined()
        expect(laVictima!.hp, `${carta} no hizo daño en 25 segundos`).toBeLessThan(vidaInicial)
        return
      }

      if (hace === 'cura') {
        expect(herido!.hp, `${carta} no curó a nadie`).toBeGreaterThan(10)
        return
      }

      // 'aguanta': un muro. No pega, pero sigue en pie — que es su trabajo.
      const mia = estado.plants.find((p) => p.plantId === carta)
      expect(mia, `${carta} no sigue en el campo`).toBeDefined()
      expect(mia!.hp, `${carta} perdió toda la vida sola`).toBeGreaterThan(0)
      expect(PLANT_CONFIGS[carta].damage ?? 0, `${carta} debería ser un muro`).toBe(0)
    })
  }
})

describe('las tres que necesitan su escenario', () => {
  it('la patata mina se arma y estalla cuando algo la pisa', () => {
    const estado = createBattleState(11, false, true)
    estado.pending.push({ atTick: 1, kind: 'own_plant', plantId: 'squash' as PlantId, lane: 1, col: 6 })

    // Primero se le deja armarse SOLA. Tarda 12 s y un cuerpo a cuerpo cruza el
    // campo en 6: si se pone el bicho desde el principio, se la come antes de que
    // se arme. Eso es comportamiento correcto del juego, no un fallo — pero hace
    // imposible probar la explosión. (La primera versión de este test lo hacía
    // así y la mina moría sin armarse.)
    correr(estado, 300)
    expect(estado.plants[0]?.isArmed, 'se armó antes de los 12 s').toBeFalsy()
    correr(estado, 100)
    const mina = estado.plants.find((p) => p.plantId === 'squash')
    expect(mina?.isArmed, 'no se armó a los 12 s').toBe(true)

    // Y ahora sí: un enemigo que CAMINA hacia ella. Con uno estático no pasaría
    // nada, y eso es correcto: la mina se pisa.
    const bicho = crearPlantaDelRival(estado, 'bonkchoy' as PlantId, 1, 0)
    estado.enemyPlants.push(bicho)
    correr(estado, 600)

    expect(estado.enemyPlants.find((p) => p.id === bicho.id), 'la mina no se lo llevó')
      .toBeUndefined()
    // Y la mina se gasta: es de un solo uso.
    expect(estado.plants.find((p) => p.plantId === 'squash'), 'la mina no se gastó')
      .toBeUndefined()
  })

  it('la lechuga de hielo congela el carril en su primer tic', () => {
    const estado = createBattleState(12, false, true)
    const victima = crearPlantaDelRival(estado, 'peashooter' as PlantId, 1, 6)
    estado.enemyPlants.push(victima)

    estado.pending.push({ atTick: 1, kind: 'own_plant', plantId: 'iceberglettuce' as PlantId, lane: 1, col: 3 })
    correr(estado, 5)

    // Congela YA, no al rato: por eso se mira temprano. Y dura 7 s, así que
    // mirarlo a los 25 segundos —como hacía la primera versión de este test— es
    // mirarlo cuando ya está deshelado.
    const congelada = estado.enemyPlants.find((p) => p.id === victima.id)
    expect(congelada?.frozenUntil, 'no congeló').toBeDefined()
    expect(congelada!.frozenUntil!).toBeGreaterThan(estado.tick)

    // Y pasado el hielo, se descongela.
    correr(estado, 260)
    expect(estado.enemyPlants.find((p) => p.id === victima.id)?.frozenUntil).toBeUndefined()
  })

  it('el jalapeño arrasa SU carril y no deja planta', () => {
    const estado = createBattleState(7, false, true)
    for (const col of [4, 5, 6]) {
      estado.enemyPlants.push(crearPlantaDelRival(estado, 'peashooter' as PlantId, 1, col))
    }
    // Y una en otro carril, que NO debe morir.
    estado.enemyPlants.push(crearPlantaDelRival(estado, 'peashooter' as PlantId, 0, 4))

    estado.pending.push({ atTick: 1, kind: 'own_plant', plantId: 'jalapeno' as PlantId, lane: 1, col: 0 })
    correr(estado, 5)

    expect(estado.enemyPlants.filter((p) => p.lane === 1)).toHaveLength(0)
    expect(estado.enemyPlants.filter((p) => p.lane === 0)).toHaveLength(1)

    // La llamarada se ve un momento y se apaga: no queda planta.
    expect(estado.plants.length).toBe(1)
    correr(estado, 45)
    expect(estado.plants.length).toBe(0)
  })
})
