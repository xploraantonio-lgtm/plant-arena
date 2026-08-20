// ─────────────────────────────────────────────────────────────────────────────
// LA MISMA PLANTA SE COMPORTA IGUAL EN LOS DOS LADOS
//
// Sin esto, un 1c1 no es un 1c1: los dos jugadores están jugando partidas con
// reglas distintas y los dos pueden ganar la suya de verdad. Es lo que producía
// el "tu rival dijo otra cosa" al probar con dos cuentas.
//
// La causa era que el motor tenía DOS ramas de código para lo mismo:
//   · el bucle de "mis plantas", con las seis habilidades y la cadencia de cada
//     carta;
//   · el bucle del "rival", que sólo sabía de girasol, disparo a 1800 ms fijos y
//     cuerpo a cuerpo.
//
// Así, tu lanzaguisantes disparaba a la cadencia de su carta en tu pantalla y a
// 1800 ms en la del rival; y si el rival plantaba una lechuga de hielo o un aloe,
// en tu pantalla no hacían nada.
//
// Estas comprobaciones no miran posiciones (los dos lados son espejo, así que las
// coordenadas son distintas a propósito): miran EFECTOS. Cuántas veces dispara,
// cuánto daño hace, si su habilidad ocurre. Eso sí tiene que coincidir.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest'
import { stepTick, createBattleState, crearPlantaDelRival, type GameState } from './simulate'
import { PLANT_CONFIGS, BASE_LEFT_END_X, BASE_RIGHT_START_X, SUN_VALUE } from '../utils/gameConstants'
import { GIRASOL_MS, SOLES_POR_CICLO_GIRASOL, SOLES_POR_CICLO_GIRASOL_DOBLE } from './balance'
import type { PlantEntity, PlantId } from '../types/game'

/** Un estado de PvP limpio: sin bot, sin oleadas, sólo lo que se planta. */
function arena(seed = 1): GameState {
  return createBattleState(seed, false, true)
}

/** Planta una carta en MI lado, como lo haría placePlant. */
function plantarMia(state: GameState, plantId: PlantId, lane: number, col: number): PlantEntity {
  const config = PLANT_CONFIGS[plantId]
  const camina = config.category === 'melee' || !!config.moveSpeed || plantId === 'chomper'
  const colWidth = (BASE_RIGHT_START_X - BASE_LEFT_END_X) / 12
  const p: PlantEntity = {
    id: `mia-${plantId}-${lane}-${col}`,
    plantId,
    statRolls: [],
    lane,
    col: camina ? undefined : col,
    x: BASE_LEFT_END_X + col * colWidth + colWidth / 2,
    hp: config.maxHp,
    maxHp: config.maxHp,
    damage: config.damage,
    attackSpeedMs: config.attackSpeedMs,
    moveSpeed: config.moveSpeed,
    lastActionTime: state.tick,
    isWalking: camina,
    state: camina ? 'walking' : 'idle',
  }
  state.plants.push(p)
  return p
}

/** Corre N tics contando los proyectiles que aparecen. */
function contarDisparos(state: GameState, tics: number): number {
  let vistos = 0
  const yaVistos = new Set(state.projectiles.map((p) => p.id))
  for (let i = 0; i < tics; i++) {
    stepTick(state, () => {})
    for (const p of state.projectiles) {
      if (!yaVistos.has(p.id)) {
        yaVistos.add(p.id)
        vistos += 1
      }
    }
  }
  return vistos
}

describe('un 1c1 tiene las mismas reglas para los dos', () => {
  it('el lanzaguisantes dispara lo mismo esté en un lado o en el otro', () => {
    // Un muro delante para que tenga a quién disparar y no se pierda el conteo.
    const mio = arena()
    plantarMia(mio, 'peashooter', 1, 2)
    mio.enemyPlants.push(crearPlantaDelRival(mio, 'wallnut', 1, 8))
    const disparosMios = contarDisparos(mio, 600)

    const suyo = arena()
    plantarMia(suyo, 'wallnut', 1, 2)
    suyo.enemyPlants.push(crearPlantaDelRival(suyo, 'peashooter', 1, 8))
    const disparosSuyos = contarDisparos(suyo, 600)

    expect(disparosMios).toBeGreaterThan(0)
    // El corazón del asunto: la misma carta, el mismo número de disparos.
    expect(disparosSuyos).toBe(disparosMios)
  })

  it('el girasol produce los mismos soles en los dos lados', () => {
    // Ojo con lo que se mide. Hay una asimetría A PROPÓSITO: tus soles caen al
    // campo y los recoges PULSANDO, mientras que los del rival van directos a su
    // banco — sus soles los recoge él en su pantalla, y aquí no se pueden pulsar.
    //
    // Así que comparar sunBank con p2SunBank mide dos cosas distintas y no dice
    // nada. Lo que tiene que coincidir es cuántos soles PRODUCE la planta y cada
    // cuánto, que es lo que afecta al juego.
    const mio = arena()
    plantarMia(mio, 'sunflower', 1, 2)
    let solesQueSalieron = 0
    const yaVistos = new Set<string>()
    for (let i = 0; i < 600; i++) {
      stepTick(mio, () => {})
      for (const sol of mio.suns) {
        if (yaVistos.has(sol.id)) continue
        yaVistos.add(sol.id)
        // Sólo los del girasol: al campo también caen los del cielo cada 6 s, y
        // contarlos daba el doble. (La primera versión de esta prueba fallaba por
        // eso, no por el motor.)
        if (sol.id.startsWith('sun-flower')) solesQueSalieron += sol.value
      }
    }

    const suyo = arena()
    suyo.enemyPlants.push(crearPlantaDelRival(suyo, 'sunflower', 1, 8))
    const suyosAntes = suyo.p2SunBank
    for (let i = 0; i < 600; i++) stepTick(suyo, () => {})
    const producidosSuyos = suyo.p2SunBank - suyosAntes

    expect(solesQueSalieron).toBeGreaterThan(0)
    expect(producidosSuyos).toBe(solesQueSalieron)
  })

  it('la lechuga de hielo congela también cuando la planta el rival', () => {
    // En mi lado: congela a las plantas del rival.
    const mio = arena()
    mio.enemyPlants.push(crearPlantaDelRival(mio, 'chomper', 1, undefined))
    plantarMia(mio, 'iceberglettuce', 1, 3)
    for (let i = 0; i < 30; i++) stepTick(mio, () => {})
    const congeloAlRival = mio.enemyPlants.some((e) => e.frozenUntil !== undefined)

    // En su lado: debe congelar a las mías igual.
    const suyo = arena()
    plantarMia(suyo, 'chomper', 1, 2)
    suyo.enemyPlants.push(crearPlantaDelRival(suyo, 'iceberglettuce', 1, 8))
    for (let i = 0; i < 30; i++) stepTick(suyo, () => {})
    const meCongelo = suyo.plants.some((p) => p.frozenUntil !== undefined)

    expect(congeloAlRival).toBe(true)
    expect(meCongelo).toBe(true)
  })

  it('el aloe cura también cuando lo planta el rival', () => {
    const suyo = arena()
    const herida = crearPlantaDelRival(suyo, 'wallnut', 1, 9)
    herida.hp = 100
    suyo.enemyPlants.push(herida)
    suyo.enemyPlants.push(crearPlantaDelRival(suyo, 'aloe', 1, 10))

    const antes = herida.hp
    for (let i = 0; i < 200; i++) stepTick(suyo, () => {})
    const despues = suyo.enemyPlants.find((e) => e.id === herida.id)?.hp ?? 0

    expect(despues).toBeGreaterThan(antes)
  })

  it('la patata mina explota también cuando la planta el rival', () => {
    const suyo = arena()
    // Una planta mía avanzando hacia su mina.
    plantarMia(suyo, 'chomper', 1, 1)
    suyo.enemyPlants.push(crearPlantaDelRival(suyo, 'squash', 1, 6))

    let exploto = false
    for (let i = 0; i < 900; i++) {
      const antes = suyo.enemyPlants.length
      stepTick(suyo, () => {})
      // La mina desaparece al detonar.
      if (suyo.enemyPlants.length < antes) exploto = true
      if (exploto) break
    }

    expect(exploto).toBe(true)
  })

  it('el mismo daño acumulado, jugando la misma partida en espejo', () => {
    // La prueba de conjunto: el mismo enfrentamiento visto desde los dos lados
    // tiene que dar el mismo resultado. Si no, los dos jugadores pueden ganar.
    const desdeMiLado = arena(4242)
    plantarMia(desdeMiLado, 'peashooter', 1, 2)
    plantarMia(desdeMiLado, 'sunflower', 0, 1)
    desdeMiLado.enemyPlants.push(crearPlantaDelRival(desdeMiLado, 'wallnut', 1, 8))
    desdeMiLado.enemyPlants.push(crearPlantaDelRival(desdeMiLado, 'peashooter', 2, 9))

    const desdeElSuyo = arena(4242)
    plantarMia(desdeElSuyo, 'wallnut', 1, 2)
    plantarMia(desdeElSuyo, 'peashooter', 2, 1)
    desdeElSuyo.enemyPlants.push(crearPlantaDelRival(desdeElSuyo, 'peashooter', 1, 8))
    desdeElSuyo.enemyPlants.push(crearPlantaDelRival(desdeElSuyo, 'sunflower', 0, 9))

    for (let i = 0; i < 900; i++) {
      stepTick(desdeMiLado, () => {})
      stepTick(desdeElSuyo, () => {})
    }

    // El muro recibe lo mismo en los dos casos, esté de un lado o del otro.
    const muroEnMiLado = desdeMiLado.enemyPlants.find((e) => e.plantId === 'wallnut')
    const muroEnSuLado = desdeElSuyo.plants.find((p) => p.plantId === 'wallnut')

    expect(muroEnMiLado).toBeDefined()
    expect(muroEnSuLado).toBeDefined()
    expect(Math.round(muroEnSuLado!.hp)).toBe(Math.round(muroEnMiLado!.hp))
  })
})

describe('la economía del sol no es un impresor', () => {
  it('el girasol tarda al menos 25 segundos en pagarse', () => {
    // ESTE es el número que decide el ritmo de la partida.
    //
    // Estaba a 6 segundos: un girasol de 50 soles producía 25 cada 6 s, o sea que
    // se pagaba en 12 segundos y luego imprimía 250/min para siempre. Cada girasol
    // permitía comprar 5 más por minuto — una bola de nieve. Y lo peor no era la
    // cantidad: era que NO HABÍA DECISIÓN, porque con ese retorno nunca hay motivo
    // para no plantar otro, ni en el último segundo.
    //
    // Con un retorno de 30 s, uno plantado al principio se paga dos o tres veces y
    // uno plantado al final no. Eso es lo que crea la tensión entre economía y
    // ataque.
    const coste = PLANT_CONFIGS.sunflower.cost
    const ciclos = coste / SUN_VALUE
    const retornoSegundos = (ciclos * GIRASOL_MS) / 1000

    expect(retornoSegundos).toBeGreaterThanOrEqual(25)
  })

  it('el sol del cielo no compone: cae igual con muchos girasoles', () => {
    // Es el ingreso base y sostiene el arranque. Que NO dependa de cuántos
    // girasoles haya es lo que evita que la ventaja temprana se vuelva
    // irreversible.
    const contarDelCielo = (cuantosGirasoles: number) => {
      const s = arena(31337)
      for (let i = 0; i < cuantosGirasoles; i++) {
        plantarMia(s, 'sunflower', i % 3, 1 + Math.floor(i / 3))
      }
      let delCielo = 0
      const vistos = new Set<string>()
      for (let i = 0; i < 1800; i++) {
        stepTick(s, () => {})
        for (const sol of s.suns) {
          if (vistos.has(sol.id)) continue
          vistos.add(sol.id)
          if (sol.id.startsWith('sun-sky')) delCielo += sol.value
        }
      }
      return delCielo
    }

    expect(contarDelCielo(4)).toBe(contarDelCielo(0))
  })

  it('el girasol doble rinde el doble por hueco, y por eso cuesta más', () => {
    // Su ventaja real no son los soles: es que ocupa UN hueco en un campo con
    // huecos limitados. Si costara lo mismo, el sencillo no tendría sentido.
    expect(PLANT_CONFIGS.twinsunflower.cost).toBeGreaterThan(PLANT_CONFIGS.sunflower.cost)
    expect(SOLES_POR_CICLO_GIRASOL_DOBLE).toBe(SOLES_POR_CICLO_GIRASOL * 2)
  })
})
