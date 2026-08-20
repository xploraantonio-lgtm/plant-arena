// ─────────────────────────────────────────────────────────────────────────────
// LA SIMULACIÓN, SIN REACT Y SIN NAVEGADOR
//
// Este fichero contiene UN tic de partida y nada más. No importa react, no lee
// el reloj, no toca localStorage y no llama al navegador. Sus únicas entradas
// son el estado que recibe y, dentro de él, su propio generador de azar.
//
// Estaba dentro de un useEffect de 670 líneas en useGameEngine.ts. Se saca aquí
// porque de ahí no se podía:
//   · ejecutar en el servidor para recalcular quién ganó una partida;
//   · ejecutar en un test de un tirón, sin montar un componente de React;
//   · ejecutar dos veces y comparar las dos salidas campo por campo.
//
// El hook se queda con lo que de verdad es suyo: el acumulador de fotogramas,
// requestAnimationFrame, el repintado y las acciones del jugador.
//
// LA REGLA QUE MANTIENE ESTO CIERTO
//   Nada de lo que se añada aquí puede leer el reloj (Date.now, performance.now),
//   sortear sin semilla (Math.random), programar nada (setTimeout) ni tocar el
//   navegador (localStorage, document, window). El tic sólo puede mirar y
//   modificar el estado que recibe. determinism.test.ts lo comprueba.
// ─────────────────────────────────────────────────────────────────────────────
import { createRng, nextFloat, nextInt, chance, entityId, type Rng } from './rng'
import { TICK_SECONDS, msToTicks } from './time'
import {
  SOL_DEL_CIELO_MS,
  GIRASOL_MS,
  GIRASOL_DOBLE_MS,
  SOLES_POR_CICLO_GIRASOL,
  SOLES_POR_CICLO_GIRASOL_DOBLE,
} from './balance'
import {
  menteNueva,
  producirSol,
  recogerSoles,
  echarUnVistazo,
  leTocaJugar,
  jugadaMediocre,
  elegirCarril,
  NIVEL_POR_DEFECTO,
  type MenteDelBot,
  type NivelDelBot,
} from './bot'
import type {
  PlantEntity,
  ProjectileEntity,
  SunEntity,
  GameStatus,
  GameStats,
  PlantId,
  PlantStatKey,
} from '../types/game'
import {
  PLANT_CONFIGS,
  INITIAL_SUN,
  INITIAL_BASE_HP,
  SUN_VALUE,
  BASE_LEFT_END_X,
  BASE_RIGHT_START_X,
  FIELD_WIDTH_PCT,
  TOTAL_COLUMNS,
  getScaledPlantConfig,
} from '../utils/gameConstants'

/**
 * Por dónde salen los sonidos.
 *
 * El tic no llama a soundManager directamente: recibe esta función. En el
 * navegador es soundManager.playSound; en un test es una función que los apunta
 * en una lista, y esa lista es en sí misma una comprobación de determinismo —
 * dos ejecuciones iguales deben producir la misma secuencia de sonidos; en el
 * servidor es una función vacía.
 */
export type SonarFn = (nombre: string, volumen: number) => void

const enfriamientosACero = (): Record<PlantId, number> =>
  (Object.keys(PLANT_CONFIGS) as PlantId[]).reduce(
    (acc, id) => ({ ...acc, [id]: 0 }),
    {} as Record<PlantId, number>
  )

// tipoEquivalente se eliminó junto con el catálogo enemigo: ya no hay dos
// catálogos que traducir. El rival juega con las mismas cartas que tú y el motor
// las trata con la misma rama de código.


/**
 * Convierte la carta que plantó el RIVAL en una planta de su lado del campo.
 *
 * Es la pieza que faltaba para el PvP. El rival juega con las mismas 15 plantas
 * que tú, no con los 5 tipos del bot — y no hace falta arte nueva, porque las
 * plantas de ambos lados ya usan los mismos ficheros de sprite y el CSS ya las
 * espeja. Es la misma planta al revés.
 *
 * Las estadísticas salen de SU carta con SUS mejoras. Eso no se puede falsear
 * desde el navegador: el mazo lo lee el servidor de plant_instances y viaja en
 * game_rooms.p2_deck.
 *
 * No cobra soles: quien decide si el rival podía pagar es su propio cliente, y el
 * servidor lo comprueba al recalcular la partida desde el registro de acciones.
 */
export function crearPlantaDelRival(
  state: GameState,
  plantId: PlantId,
  lane: number,
  col: number | undefined,
  statRolls: PlantStatKey[] = [],
  level = 0
): PlantEntity {
  const config = getScaledPlantConfig(plantId, statRolls)
  const camina = config.category === 'melee' || !!config.moveSpeed || plantId === 'chomper'

  // ── LA COLUMNA SE ESPEJA ───────────────────────────────────────────────────
  //
  // El rival planta en SU columna, contada desde SU base. En su pantalla él es el
  // jugador de la izquierda, igual que tú en la tuya, así que su columna 4 está en
  // su mitad izquierda — que en tu pantalla es la mitad DERECHA.
  //
  // Sin espejar, su planta aparecía en tu columna 4: en tu propia mitad, entre tus
  // plantas y detrás de tus defensas. Y como el combate va por posición, cada uno
  // veía una batalla distinta: en una pantalla su lanzaguisantes llegaba a tu base
  // y en la otra lo paraba un muro que en realidad estaba en el otro extremo.
  //
  // El campo va de 15 a 85, así que espejar es 100 − x. En columnas, la 0 pasa a
  // ser la 11.
  const colWidth = FIELD_WIDTH_PCT / TOTAL_COLUMNS
  const colEspejada = col === undefined ? undefined : TOTAL_COLUMNS - 1 - col
  const x = camina || colEspejada === undefined
    ? BASE_RIGHT_START_X - 1
    : BASE_LEFT_END_X + colEspejada * colWidth + colWidth / 2

  const entidad: PlantEntity = {
    id: entityId('rival', state.tick, state.entityCounter++),
    plantId,
    level,
    statRolls,
    lane,
    col: camina ? undefined : colEspejada,
    x,
    hp: config.maxHp,
    maxHp: config.maxHp,
    damage: config.damage ?? 0,
    attackSpeedMs: config.attackSpeedMs,
    moveSpeed: config.moveSpeed,
    isWalking: camina,
    state: camina ? 'walking' : 'idle',
    lastActionTime: state.tick,
  }
  return entidad
}

/**
 * El estado con el que arranca una batalla.
 *
 * Vive aquí y no en el hook porque quien quiera recalcular una partida —el
 * servidor, un test, un visor de repeticiones— necesita poder construir el punto
 * de partida sin montar React. Con la misma semilla devuelve siempre lo mismo.
 *
 * `seed` viene de game_rooms.seed y es idéntica para los dos jugadores: es lo que
 * hace que ambos simulen la misma partida.
 */
/**
 * @param nivelBot los límites humanos del bot. En ranked se saca del ELO del
 *                 jugador con nivelPorElo(), para que el relleno se parezca a
 *                 alguien de su nivel. En PvP no se usa: el bot no juega.
 */
export function createBattleState(
  seed: number,
  isPracticeMode = false,
  isPvpMode = false,
  nivelBot: NivelDelBot = NIVEL_POR_DEFECTO
): GameState {
  return {
    tick: 0,
    rng: createRng(seed),
    entityCounter: 0,
    // El cartel de la primera oleada se oculta a los 3 s (4 en práctica). Antes lo
    // hacía un setTimeout tras el arranque; ahora es un tic concreto.
    pending: [{ atTick: msToTicks(isPracticeMode ? 4000 : 3000), kind: 'clear_wave_banner' }],
    // Los valores negativos adelantan el primer suceso: con -3500 ms el primer sol
    // cae a los 2,5 s en lugar de a los 6. En práctica no hay oleadas ni rival, así
    // que todo arranca a cero.
    timers: isPracticeMode
      ? { lastSkySun: 0, lastP2PassiveSun: 0, lastEnemySpawn: 0, waveStart: 0 }
      : {
          lastSkySun: -msToTicks(3500),
          lastP2PassiveSun: -msToTicks(3500),
          lastEnemySpawn: -msToTicks(1000),
          waveStart: 0,
        },
    status: 'playing',
    p1BaseHp: INITIAL_BASE_HP,
    p2BaseHp: INITIAL_BASE_HP,
    sunBank: INITIAL_SUN,
    // Paridad: los dos jugadores empiezan con los mismos soles.
    p2SunBank: INITIAL_SUN,
    plants: [],
    enemyPlants: [],
    projectiles: [],
    suns: [],
    selectedCard: null,
    selectedSlotIndex: null,
    cooldowns: enfriamientosACero(),
    slotCooldowns: {},
    wave: 1,
    waveBanner: isPracticeMode ? 'Modo Práctica' : '¡Ola 1 de Plantas Enemigas!',
    stats: { sunsCollected: 0, enemyPlantsDefeated: 0, plantsPlaced: 0, score: 0 },
    ...(isPracticeMode ? { isPracticeMode: true } : {}),
    ...(isPvpMode ? { isPvpMode: true } : {}),
    bot: menteNueva(),
    nivelBot,
  }
}

/**
 * ACCIONES APLAZADAS
 *
 * Antes, cinco efectos del juego se programaban con setTimeout: el hielo
 * desaparecía a los 2 s, el jalapeño a los 1,2 s, el segundo guisante del
 * repetidor salía 180 ms después del primero, el aloe apagaba su efecto a los
 * 1,5 s y el cartel de oleada se ocultaba a los 3 s.
 *
 * Todos mutaban el estado del juego desde FUERA del bucle de tics, con el reloj
 * del navegador. Eso rompe la reproducibilidad de tres formas:
 *   · en una máquina cargada o con la pestaña en segundo plano, el efecto cae en
 *     un tic distinto, así que dos jugadores ven partidas diferentes;
 *   · el servidor, al recalcular la partida de un tirón, no ejecuta setTimeout,
 *     de modo que el hielo nunca desaparecería y el repetidor sólo dispararía
 *     una vez;
 *   · una partida guardada a medias no puede reanudarse, porque los plazos
 *     pendientes viven en el bucle de eventos y no en el estado.
 *
 * Ahora se encolan aquí con el TIC en que deben ejecutarse. La cola es parte del
 * estado, así que se serializa, se reanuda y se compara igual que el resto.
 *
 * Son datos etiquetados y no funciones a propósito: una función no se puede
 * guardar en JSON ni mandar al servidor.
 */
export type PendingAction =
  /** Oculta el cartel de oleada. */
  | { atTick: number; kind: 'clear_wave_banner' }
  /** Quita una planta del campo (hielo derretido, llama del jalapeño apagada). */
  | { atTick: number; kind: 'remove_plant'; plantId: string }
  /** El hielo vuelve un instante a su primer aspecto antes de irse. */
  | { atTick: number; kind: 'iceberg_fade'; plantId: string }
  /** Apaga la nubecita de curación del aloe. */
  | { atTick: number; kind: 'clear_heal_fx'; plantId: string }
  /** El segundo guisante del repetidor. Ya viene formado desde que se encoló. */
  | { atTick: number; kind: 'spawn_projectile'; projectile: ProjectileEntity }
  /**
   * La carta que plantó el RIVAL, para aplicarla en su tic.
   *
   * Llega por la red con el tic FUTURO en que debe ocurrir (el tic actual de
   * quien la manda, más un margen para la red). Los dos clientes la aplican en
   * ese mismo tic, así que las dos simulaciones convergen sin que ninguno tenga
   * que esperar al otro.
   *
   * Es un dato y no una función, como el resto de la cola: así viaja por JSON y
   * el servidor puede recalcular la partida entera desde el registro.
   */
  | {
      atTick: number
      kind: 'rival_plant'
      plantId: PlantId
      lane: number
      col?: number
      statRolls?: PlantStatKey[]
      level?: number
    }

export interface GameState {
  /**
   * El reloj de la simulación. Avanza de uno en uno, 33 ms por tic. Todos los
   * plazos del juego (enfriamientos, cadencias, congelaciones) se guardan como
   * el tic en que expiran, no como un instante de reloj real.
   */
  tick: number
  /** Azar con semilla. Sustituye a Math.random() en toda la lógica. */
  rng: Rng
  /** Contador para los identificadores de entidad, en lugar de Date.now(). */
  entityCounter: number
  /**
   * Cola de acciones aplazadas. Se recorre entera cada tic; nunca tiene más de
   * un puñado de elementos.
   */
  pending: PendingAction[]
  /**
   * Los temporizadores periódicos del juego, en TICS. Viven en el estado y no
   * en refs de React porque forman parte de la simulación: sin ellos no se
   * puede serializar una partida a medias, ni reanudar una repetición, ni
   * comparar dos ejecuciones campo por campo para detectar desincronización.
   *
   * Cada uno guarda el tic de la ÚLTIMA vez que ocurrió el suceso.
   */
  timers: {
    /** Último sol caído del cielo. */
    lastSkySun: number
    /** Último sol pasivo del rival. */
    lastP2PassiveSun: number
    /** Última aparición de enemigo. */
    lastEnemySpawn: number
    /** Comienzo de la oleada actual. */
    waveStart: number
  }
  status: GameStatus
  p1BaseHp: number
  p2BaseHp: number
  sunBank: number
  p2SunBank: number
  plants: PlantEntity[]
  /**
   * Las plantas del otro lado.
   *
   * Son PlantEntity, igual que las tuyas, y eso es el arreglo del PvP: antes
   * eran EnemyPlantEntity, un tipo aparte con su propio catálogo, y por eso la
   * misma carta se comportaba distinto según en qué pantalla estuviera. Ahora hay
   * un solo tipo y una sola rama de código; la única diferencia entre los dos
   * lados es el sentido en que avanzan.
   */
  enemyPlants: PlantEntity[]
  projectiles: ProjectileEntity[]
  suns: SunEntity[]
  selectedCard: PlantId | 'shovel' | null
  selectedSlotIndex: number | null
  cooldowns: Record<PlantId, number>
  slotCooldowns: Record<number, number>
  wave: number
  waveBanner: string | null
  stats: GameStats
  isPracticeMode?: boolean
  /**
   * Partida contra otro jugador de verdad.
   *
   * Cuando está puesta, el bot no planta ni manda oleadas: todo lo que aparece
   * en el lado contrario llega del registro de acciones del rival.
   */
  isPvpMode?: boolean
  /**
   * Lo que el bot lleva en la cabeza: los soles que aún no ha recogido, lo que
   * cree que está pasando, y cuándo se plantea su próxima jugada.
   *
   * Vive en el estado —y no en una variable del módulo— porque si no, una
   * repetición no reproduciría sus errores y el servidor no podría recalcular la
   * partida. Sus despistes forman parte de lo que pasó.
   */
  bot?: MenteDelBot
  /** Los límites humanos del bot en esta partida. */
  nivelBot?: NivelDelBot
}

/**
 * Avanza la partida EXACTAMENTE un tic (33 ms).
 *
 * Modifica `state` en el sitio, a propósito: durante una batalla se llama unas
 * treinta veces por segundo y copiar el estado entero en cada tic sería caro sin
 * ganar nada. Quien necesite comparar dos ejecuciones copia el estado antes de
 * empezar, no en cada tic.
 *
 * Con el mismo estado de entrada y la misma semilla, el estado de salida es
 * idéntico hasta el último decimal. De ahí sale todo lo demás: el servidor puede
 * recalcular la partida, dos jugadores ven lo mismo, y una repetición reproduce
 * lo ocurrido.
 */
/**
 * Un lado del campo.
 *
 * Es todo lo que cambia entre jugar de p1 o de p2. Que sea tan poco es el punto:
 * si hubiera más, volveríamos a tener dos juegos distintos.
 */
interface Lado {
  equipo: 'p1' | 'p2'
  /** Hacia dónde avanzan sus plantas: +1 a la derecha, −1 a la izquierda. */
  sentido: 1 | -1
  /** El equipo al que apuntan sus proyectiles. */
  objetivo: 'p1' | 'p2'
}

const LADO_P1: Lado = { equipo: 'p1', sentido: 1, objetivo: 'p2' }
const LADO_P2: Lado = { equipo: 'p2', sentido: -1, objetivo: 'p1' }

/** Las plantas de un lado. */
function propias(state: GameState, lado: Lado): PlantEntity[] {
  return lado.equipo === 'p1' ? state.plants : state.enemyPlants
}

/** Las del otro. */
function ajenas(state: GameState, lado: Lado): PlantEntity[] {
  return lado.equipo === 'p1' ? state.enemyPlants : state.plants
}

function guardarPropias(state: GameState, lado: Lado, lista: PlantEntity[]): void {
  if (lado.equipo === 'p1') state.plants = lista
  else state.enemyPlants = lista
}

/** La X de la base a la que este lado ataca. */
function baseRivalX(lado: Lado): number {
  return lado.equipo === 'p1' ? BASE_RIGHT_START_X : BASE_LEFT_END_X
}

/** Resta vida a la base del equipo indicado. */
function dañarBase(state: GameState, equipo: 'p1' | 'p2', cuanto: number): void {
  if (equipo === 'p1') state.p1BaseHp = Math.max(0, state.p1BaseHp - cuanto)
  else state.p2BaseHp = Math.max(0, state.p2BaseHp - cuanto)
}

/** Suma soles al banco del equipo indicado. */
function sumarSoles(state: GameState, equipo: 'p1' | 'p2', cuanto: number): void {
  if (equipo === 'p1') state.sunBank += cuanto
  else state.p2SunBank += cuanto
}

/**
 * ¿Está esa planta delante de ésta, dentro del alcance?
 *
 * "Delante" depende del sentido, y es la única asimetría real entre los dos
 * lados. Multiplicar por el sentido la resuelve sin duplicar la condición.
 */
function estaDelante(planta: PlantEntity, otra: PlantEntity, alcance: number, sentido: 1 | -1): boolean {
  const d = (otra.x - planta.x) * sentido
  return d >= 0 && d <= alcance
}

/** ¿Llegó a la base rival? */
function llegoALaBase(planta: PlantEntity, lado: Lado): boolean {
  return (planta.x - baseRivalX(lado)) * lado.sentido >= -1
}

/**
 * Un tic de todas las plantas de un lado.
 *
 * Se llama dos veces por tic, una por equipo. Todo lo que hay dentro sale de la
 * carta (getScaledPlantConfig) y del sentido del lado, así que la misma planta
 * hace lo mismo esté donde esté.
 */
function procesarLado(state: GameState, lado: Lado, dt: number, sonar: SonarFn): void {
  const misPlantas = propias(state, lado)
  const susPlantas = ajenas(state, lado)
  const siguientes: PlantEntity[] = []

  for (const planta of misPlantas) {
    // ── MUERTA: recompensa a quien la mató ────────────────────────────────────
    if (planta.hp <= 0) {
      sonar('zombie_fall', 0.4)
      const quienMato = lado.equipo === 'p1' ? 'p2' : 'p1'
      const config = getScaledPlantConfig(planta.plantId, planta.statRolls ?? [])
      sumarSoles(state, quienMato, Math.max(10, Math.round((config.cost ?? 50) / 4)))
      // Las estadísticas son del jugador local, que siempre es p1.
      if (lado.equipo === 'p2') {
        state.stats.enemyPlantsDefeated += 1
        state.stats.score += 100
      }
      continue
    }

    const config = getScaledPlantConfig(planta.plantId, planta.statRolls ?? [])

    // ── CONGELADA ─────────────────────────────────────────────────────────────
    if (planta.frozenUntil !== undefined) {
      if (state.tick < planta.frozenUntil) {
        siguientes.push(planta)
        continue
      }
      planta.frozenUntil = undefined
    }

    // ── GIRASOL ───────────────────────────────────────────────────────────────
    if (planta.plantId === 'sunflower' || planta.plantId === 'twinsunflower') {
      const esDoble = planta.plantId === 'twinsunflower'
      // Intervalo propio, no el del sol del cielo. Los dos valían 6 s, y por eso
      // el girasol se pagaba a sí mismo en 12 segundos: era un impresor de soles.
      // Los números y el razonamiento están en engine/balance.ts.
      const cada = esDoble ? GIRASOL_DOBLE_MS : GIRASOL_MS
      if (state.tick - planta.lastActionTime > msToTicks(cada)) {
        planta.lastActionTime = state.tick
        const cuantos = esDoble ? SOLES_POR_CICLO_GIRASOL_DOBLE : SOLES_POR_CICLO_GIRASOL

        if (lado.equipo === 'p1') {
          // Los tuyos caen al campo y los recoges tú pulsando.
          for (let i = 0; i < cuantos; i++) {
            state.suns.push({
              id: entityId('sun-flower', state.tick, state.entityCounter++),
              x: planta.x + (nextFloat(state.rng) * 6 - 3),
              y: 20 + planta.lane * 20 + 5,
              targetY: 20 + planta.lane * 20 + 10,
              value: SUN_VALUE,
              createdAt: state.tick,
            })
          }
        } else {
          // Los del rival van directos a su banco: sus soles los recoge él en SU
          // pantalla, y aquí no se pueden pulsar. La cantidad y el ritmo son los
          // mismos, que es lo que importa para que el juego sea el mismo.
          sumarSoles(state, 'p2', cuantos * SUN_VALUE)
        }
      }
    }

    // ── PATATA MINA ───────────────────────────────────────────────────────────
    if (planta.plantId === 'squash') {
      const tiempoDeArmado = state.isPracticeMode ? 4000 : 12000
      const transcurrido = state.tick - planta.lastActionTime

      if (!planta.isArmed) {
        if (transcurrido >= msToTicks(tiempoDeArmado)) {
          planta.isArmed = true
          sonar('pea_hit', 0.8)
        }
      } else {
        const pisada = susPlantas.find(
          (a) => a.lane === planta.lane && Math.abs(a.x - planta.x) <= 4.5 && a.hp > 0
        )
        if (pisada) {
          for (const a of susPlantas) {
            if (a.lane === planta.lane && Math.abs(a.x - planta.x) <= 5.5 && a.hp > 0) {
              a.hp -= config.damage || 1800
            }
          }
          sonar('pea_hit', 1.0)
          planta.hp = 0
        }
      }
    }

    // ── LECHUGA DE HIELO ──────────────────────────────────────────────────────
    if (planta.plantId === 'iceberglettuce' && !planta.isArmed) {
      planta.isArmed = true
      planta.spriteOverride = '/game-assets/plants/iceberglettuce_burst.png'
      sonar('pea_hit', 1.0)

      const hasta = state.tick + msToTicks(7000)
      for (const a of susPlantas) a.frozenUntil = hasta

      state.pending.push({
        atTick: state.tick + msToTicks(2000),
        kind: 'iceberg_fade',
        plantId: planta.id,
      })
    }

    // ── ALOE ──────────────────────────────────────────────────────────────────
    if (planta.plantId === 'aloe') {
      const cada = config.attackSpeedMs || 2500
      const cuanto = config.damage || 60

      if (state.tick - planta.lastActionTime > msToTicks(cada)) {
        planta.lastActionTime = state.tick
        const herida = misPlantas.find(
          (a) => a.id !== planta.id && a.lane === planta.lane && a.hp < a.maxHp && a.hp > 0
        )
        if (herida) {
          herida.hp = Math.min(herida.maxHp, herida.hp + cuanto)
          herida.isHealingFx = true
          sonar('plantation', 0.6)
          state.pending.push({
            atTick: state.tick + msToTicks(1500),
            kind: 'clear_heal_fx',
            plantId: herida.id,
          })
        }
      }
    }

    // ── DISPARO A DISTANCIA ───────────────────────────────────────────────────
    if (config.category === 'ranged') {
      if (state.tick - planta.lastActionTime > msToTicks(config.attackSpeedMs || 1200)) {
        planta.lastActionTime = state.tick

        const tipo =
          planta.plantId === 'melonpult' ? 'melon'
          : planta.plantId === 'chomper' ? 'needle'
          : 'pea'

        const velocidad = tipo === 'melon' ? 22 : tipo === 'needle' ? 34 : 32
        const salidaX = planta.x + 2 * lado.sentido

        if (planta.plantId === 'threepeater') {
          for (const carril of [planta.lane - 1, planta.lane, planta.lane + 1].filter((l) => l >= 0 && l <= 2)) {
            state.projectiles.push({
              id: entityId(`proj-${lado.equipo}-3p-${carril}`, state.tick, state.entityCounter++),
              type: 'pea',
              targetTeam: lado.objetivo,
              lane: carril,
              x: salidaX,
              y: 20 + carril * 19.33 + 7,
              speed: 32,
              damage: config.damage || 25,
            })
          }
        } else {
          state.projectiles.push({
            id: entityId(`proj-${lado.equipo}`, state.tick, state.entityCounter++),
            type: tipo,
            targetTeam: lado.objetivo,
            lane: planta.lane,
            x: salidaX,
            y: 20 + planta.lane * 19.33 + 7,
            speed: velocidad,
            damage: config.damage || 25,
            isSplash: tipo === 'melon',
          })
        }
        sonar('pea_shoot', 0.4)

        if (planta.plantId === 'repeater') {
          // El segundo guisante sale 180 ms después. Se forma AHORA y se encola
          // para su tic: si se formara al ejecutarse, la posición ya podría haber
          // cambiado y el identificador saldría de otro tic.
          state.pending.push({
            atTick: state.tick + msToTicks(180),
            kind: 'spawn_projectile',
            projectile: {
              id: entityId(`proj-${lado.equipo}-rep`, state.tick, state.entityCounter++),
              type: 'pea',
              targetTeam: lado.objetivo,
              lane: planta.lane,
              x: salidaX,
              y: 20 + planta.lane * 19.33 + 7,
              speed: 32,
              damage: config.damage || 25,
            },
          })
        }
      }
    }

    // ── LAS QUE CAMINAN ───────────────────────────────────────────────────────
    if (planta.isWalking) {
      if (planta.plantId === 'garlic') {
        // El ajo salta y machaca.
        if (planta.isSmashing) {
          planta.state = 'attacking'
          if (state.tick - (planta.smashStartTime || 0) >= msToTicks(600)) {
            for (const a of susPlantas) {
              if (a.lane === planta.lane && Math.abs(a.x - planta.x) <= 5.5 && a.hp > 0) {
                a.hp -= config.damage || 600
              }
            }
            sonar('pea_hit', 0.9)
            planta.hp = 0
          }
        } else {
          const cerca = susPlantas.some(
            (a) => a.lane === planta.lane && Math.abs(a.x - planta.x) <= 4.8 && a.hp > 0
          )
          if (cerca) {
            planta.isSmashing = true
            planta.smashStartTime = state.tick
            planta.state = 'attacking'
            sonar('pea_hit', 0.7)
          } else {
            planta.state = 'walking'
            planta.x += (config.moveSpeed || 6.0) * dt * lado.sentido
            if (llegoALaBase(planta, lado)) {
              dañarBase(state, lado.objetivo, 150)
              sonar('pea_hit', 0.8)
              planta.hp = 0
            }
          }
        }
      } else {
        const enfrente = susPlantas.find(
          (a) => a.lane === planta.lane && estaDelante(planta, a, 3.8, lado.sentido) && a.hp > 0
        )

        if (enfrente) {
          planta.state = 'attacking'
          if (state.tick - planta.lastActionTime >= msToTicks(config.attackSpeedMs || 600)) {
            planta.lastActionTime = state.tick
            enfrente.hp -= config.damage || 90
            sonar('pea_hit', 0.5)
          }
        } else {
          planta.state = 'walking'
          planta.x += (config.moveSpeed || 4.5) * dt * lado.sentido
          if (llegoALaBase(planta, lado)) {
            dañarBase(state, lado.objetivo, 40)
            sonar('pea_hit', 0.6)
            planta.hp = 0
          }
        }
      }
    } else {
      // ── LAS ESTÁTICAS CUERPO A CUERPO ──────────────────────────────────────
      // Sólo las que no son a distancia: un lanzaguisantes ya disparó arriba.
      if (config.category !== 'ranged') {
        const pegada = susPlantas.find(
          (a) => a.lane === planta.lane && estaDelante(planta, a, 3.0, lado.sentido) && a.hp > 0
        )
        if (pegada) {
          planta.state = 'attacking'
          pegada.hp -= (config.damage || 0) * dt
        } else {
          planta.state = 'idle'
        }
      }
    }

    if (planta.hp > 0) siguientes.push(planta)
  }

  guardarPropias(state, lado, siguientes)
}

/**
 * Un tic de todos los proyectiles.
 *
 * Antes esto tenía dos ramas y no eran iguales: los que iban hacia el rival
 * hacían daño en área y los que venían hacia ti no, así que su melón no
 * salpicaba en tu pantalla. Ahora el sentido sale del equipo al que apunta y el
 * resto es común.
 */
function moverProyectiles(state: GameState, dt: number, sonar: SonarFn): void {
  const siguientes: ProjectileEntity[] = []

  for (const proy of state.projectiles) {
    const sentido: 1 | -1 = proy.targetTeam === 'p2' ? 1 : -1
    const blancos = proy.targetTeam === 'p2' ? state.enemyPlants : state.plants
    const baseX = proy.targetTeam === 'p2' ? BASE_RIGHT_START_X : BASE_LEFT_END_X

    proy.x += proy.speed * dt * sentido
    let impacto = false

    for (const objetivo of blancos) {
      if (objetivo.lane === proy.lane && Math.abs(objetivo.x - proy.x) <= 2.5 && objetivo.hp > 0) {
        impacto = true
        objetivo.hp -= proy.damage
        sonar('pea_hit', 0.4)

        if (proy.isSplash) {
          for (const salpicado of blancos) {
            if (
              salpicado.id !== objetivo.id &&
              salpicado.lane === proy.lane &&
              Math.abs(salpicado.x - proy.x) <= 7.0 &&
              salpicado.hp > 0
            ) {
              salpicado.hp -= Math.round(proy.damage * 0.6)
            }
          }
        }
        break
      }
    }

    if (!impacto && (proy.x - baseX) * sentido >= 0) {
      impacto = true
      dañarBase(state, proy.targetTeam, proy.damage)
      sonar('pea_hit', 0.5)
    }

    if (!impacto && proy.x > 10 && proy.x < 90) siguientes.push(proy)
  }

  state.projectiles = siguientes
}

export function stepTick(state: GameState, sonar: SonarFn): void {
  state.tick += 1

  // Duración fija de un tic en segundos. Sustituye al dt variable: es el
  // mismo 0.033 que usaba el motor, pero ahora es constante siempre.
  const dt = TICK_SECONDS

  // 0. ACCIONES APLAZADAS QUE VENCEN EN ESTE TIC
  //
  // Va primero para que un efecto programado para el tic N ocurra ANTES de
  // que ese mismo tic mueva plantas y proyectiles. Así el orden es siempre
  // el mismo, que es lo único que importa para la reproducibilidad.
  if (state.pending.length > 0) {
    const aunNoVencen: PendingAction[] = []
    for (const accion of state.pending) {
      if (accion.atTick > state.tick) {
        aunNoVencen.push(accion)
        continue
      }
      switch (accion.kind) {
        case 'clear_wave_banner':
          state.waveBanner = null
          break

        case 'remove_plant':
          state.plants = state.plants.filter((p) => p.id !== accion.plantId)
          break

        case 'iceberg_fade': {
          // Sólo si el hielo sigue en el campo: pudo derretirlo un enemigo.
          const hielo = state.plants.find((p) => p.id === accion.plantId)
          if (hielo) {
            hielo.spriteOverride = '/game-assets/plants/iceberglettuce_hd.png'
            aunNoVencen.push({
              atTick: state.tick + msToTicks(300),
              kind: 'remove_plant',
              plantId: accion.plantId,
            })
          }
          break
        }

        case 'clear_heal_fx': {
          const aliado = state.plants.find((p) => p.id === accion.plantId)
          if (aliado) aliado.isHealingFx = false
          break
        }

        case 'spawn_projectile':
          state.projectiles.push(accion.projectile)
          break

        case 'rival_plant':
          state.enemyPlants.push(
            crearPlantaDelRival(
              state,
              accion.plantId,
              accion.lane,
              accion.col,
              accion.statRolls ?? [],
              accion.level ?? 0
            )
          )
          break
      }
    }
    state.pending = aunNoVencen
  }

  // Practice Mode: Instant Sun & Cooldown reset
  if (state.isPracticeMode) {
    state.sunBank = 9999
    for (const k in state.cooldowns) {
      state.cooldowns[k as PlantId] = 0
    }
  }

  // 1. PC AI SKY SUN RECOVERY (Synchronized with sky sun drop every 6.0s for 100% fair parity)
  // El bot no juega si hay un rival de verdad al otro lado: sus plantas llegan
  // por el registro de acciones. Sin esta guarda, en una partida contra otro
  // jugador seguirías peleando contra la máquina — que es exactamente el fallo
  // que apareció al probarlo con dos cuentas.
  const juegaElBot = !state.isPracticeMode && !state.isPvpMode

  const mente = state.bot ?? (state.bot = menteNueva())
  const nivel = state.nivelBot ?? NIVEL_POR_DEFECTO

  if (juegaElBot) {
    // Su ingreso base, al mismo ritmo que cae el sol del cielo para ti.
    if (state.tick - state.timers.lastP2PassiveSun > msToTicks(SOL_DEL_CIELO_MS)) {
      state.timers.lastP2PassiveSun = state.tick
      // AL SUELO, no al banco. Antes era un +25 automático y por eso no fallaba
      // ni un sol mientras el jugador tenía que pulsar cada uno: era lo que más
      // delataba que enfrente había una máquina.
      producirSol(mente, state.rng, nivel, state.tick, 25)
    }
    // Y recoge lo que le toque en este tic. Llega a rachas, no a compás.
    state.p2SunBank += recogerSoles(mente, state.tick)
  }

  // 2. PC AI TACTICAL PURCHASING & PLANT SPAWNING (SUNFLOWER-FIRST RULE + THREAT ASSESSMENT)
  // El intervalo base ya no acelera con las oleadas: eso hacía que el bot fuera
  // cada vez más máquina justo cuando la partida se pone tensa. Ahora es fijo y
  // lo que varía es el ritmo, con la irregularidad de su nivel.
  const spawnInterval = 2000
  if (juegaElBot && leTocaJugar(mente, state.rng, nivel, state.tick, spawnInterval)) {
    state.timers.lastEnemySpawn = state.tick

    const p2Sunflowers = state.enemyPlants.filter(
      (e) => e.plantId === 'sunflower' && e.hp > 0
    ).length

    // Lo que está pasando DE VERDAD…
    const amenazaAhora = [0, 1, 2].filter((l) =>
      state.plants.some((pl) => pl.lane === l && pl.hp > 0 && pl.x > 25)
    )
    // …y lo que el bot alcanza a ver, que llega con retraso. Ese medio segundo
    // es lo que permite sorprenderle, y lo que un rival que reacciona en el mismo
    // fotograma no concede nunca.
    echarUnVistazo(mente, nivel, state.tick, amenazaAhora)
    const activeThreatLanes = mente.carrilesVistos

    // La emergencia sí la ve al momento: cuando algo está a punto de llegarle a
    // la base, hasta el jugador más distraído lo nota.
    const isEmergency = state.plants.some((pl) => pl.hp > 0 && pl.x > 60)

    let chosenType: PlantId | null = null

    // REGLA 1: GIRASOLES PRIMERO PARA ESTABLECER ECONOMÍA DE SOLES (Si no hay emergencia)
    if (p2Sunflowers === 0 && !isEmergency) {
      if (state.p2SunBank >= PLANT_CONFIGS.sunflower.cost) {
        chosenType = 'sunflower'
      }
    } else if (
      p2Sunflowers === 1 &&
      !isEmergency &&
      chance(state.rng, 0.60) &&
      state.p2SunBank >= PLANT_CONFIGS.sunflower.cost
    ) {
      chosenType = 'sunflower'
    } else {
      // REGLA 2: FILTRAR ÚNICAMENTE PLANTAS QUE EL BOT REALMENTE PUEDA PAGAR AHORA MISMO
      const affordableTypes: PlantId[] = ([
        'wallnut',
        'peashooter',
        'chomper',
        'melonpult',
        'sunflower',
      ] as PlantId[]).filter((t) => PLANT_CONFIGS[t].cost <= state.p2SunBank)

      if (affordableTypes.length > 0) {
        if (activeThreatLanes.length > 0) {
          // MODO DEFENSA: Si el jugador está atacando, priorizar Tanque (Wallnut) o Atacante de carril
          const wallnutCost = PLANT_CONFIGS.wallnut.cost
          if (state.p2SunBank >= wallnutCost && chance(state.rng, 0.5)) {
            chosenType = 'wallnut'
          } else {
            const combatTypes = affordableTypes.filter((t) => t !== 'sunflower')
            if (combatTypes.length > 0) {
              chosenType = combatTypes[nextInt(state.rng, combatTypes.length)]
            } else {
              chosenType = affordableTypes[nextInt(state.rng, affordableTypes.length)]
            }
          }
        } else {
          // MODO ATAQUE: Lanzar unidades ofensivas contra el jugador
          const attackTypes = affordableTypes.filter(
            (t) => t !== 'sunflower' && t !== 'wallnut'
          )
          // Una parte de sus jugadas es mediocre a propósito: elige entre lo que
          // puede pagar en lugar de lo mejor. Un rival que SIEMPRE acierta se nota
          // más que uno que pierde.
          if (attackTypes.length > 0 && !jugadaMediocre(state.rng, nivel)) {
            chosenType = attackTypes[nextInt(state.rng, attackTypes.length)]
          } else {
            chosenType = affordableTypes[nextInt(state.rng, affordableTypes.length)]
          }
        }
      }
    }

    // GUARDIA ESTRICTO: VERIFICAR QUE EL BOT REALMENTE TIENE SOLES SUFICIENTES AHORA MISMO
    if (chosenType) {
      const eConfig = PLANT_CONFIGS[chosenType]

      if (state.p2SunBank < eConfig.cost) {
        // NO TIENE SOLES SUFICIENTES -> CANCELAR COLOCACIÓN
        chosenType = null
      } else {
        const isWalking = eConfig.category === 'melee'

        // Con la foto que tiene en la cabeza, y a veces equivocándose de carril.
        const lane = elegirCarril(mente, state.rng, nivel)

        if (isWalking) {
          // Por la misma vía que la planta de un rival humano: así el bot juega
          // con EXACTAMENTE las mismas reglas. Antes plantaba los 5 tipos del
          // catálogo enemigo, con sus estadísticas aparte, y de ahí salía la
          // sensación de que "se nota que es un bot".
          state.enemyPlants.push(crearPlantaDelRival(state, chosenType, lane, undefined))
          // DEDUCIR SOLES RIGUROSAMENTE
          state.p2SunBank = Math.max(0, state.p2SunBank - eConfig.cost)
        } else {
          // OJO CON EL MARCO DE REFERENCIA.
          //
          // crearPlantaDelRival recibe la columna VISTA POR SU DUEÑO —contada desde
          // SU base— y la espeja. El bot es dueño de este lado, así que tiene que
          // hablar en su propio marco: su columna 0 es la pegada a su base.
          //
          // Antes estas listas estaban en coordenadas absolutas del campo (6 a 11,
          // la mitad derecha). Al empezar a espejar, el 11 pasó a ser el 0 y las
          // plantas del bot aparecían dentro de la mitad del jugador: había 17
          // enemigos y ninguno atacaba. Lo cazó el test de sonidos.
          //
          //   0,1 = detrás, junto a su base    ·    4,5 = delante, en la frontera
          const preferredCols =
            chosenType === 'sunflower'
              ? [0, 1, 2, 3]          // los girasoles, protegidos detrás
              : eConfig.category === 'defensive'
              ? [5, 4, 3]             // los muros, delante
              : [3, 2, 1, 0, 4, 5]    // los atacantes, a media altura

          const availableCols = preferredCols.filter((propia) => {
            // La ocupación se compara con la columna YA espejada, que es la que se
            // guarda en la entidad.
            const enElCampo = TOTAL_COLUMNS - 1 - propia
            return !state.enemyPlants.some(
              (e) => e.lane === lane && e.col === enElCampo && !e.isWalking
            )
          })

          if (availableCols.length > 0) {
            const targetCol = availableCols[0]
            // La posición la calcula crearPlantaDelRival a partir de la columna.

            state.enemyPlants.push(crearPlantaDelRival(state, chosenType, lane, targetCol))
            // DEDUCIR SOLES RIGUROSAMENTE
            state.p2SunBank = Math.max(0, state.p2SunBank - eConfig.cost)
          }
        }
      }
    }
  }

  // Wave progression timer (Every 25s)
  if (state.tick - state.timers.waveStart > msToTicks(25000)) {
    state.timers.waveStart = state.tick
    state.wave += 1
    if (state.wave % 3 === 0) {
      state.waveBanner = '¡Gran Ola de Plantas Enemigas!'
      sonar('zombie_groan', 0.5)
    } else {
      state.waveBanner = `¡Ola ${state.wave} de Plantas Enemigas!`
    }
    state.pending.push({ atTick: state.tick + msToTicks(3000), kind: 'clear_wave_banner' })
  }

  // 3. SKY SUN GENERATION (Every 6s)
  if (state.tick - state.timers.lastSkySun > msToTicks(SOL_DEL_CIELO_MS)) {
    state.timers.lastSkySun = state.tick
    state.suns.push({
      id: entityId('sun-sky', state.tick, state.entityCounter++),
      x: BASE_LEFT_END_X + nextFloat(state.rng) * FIELD_WIDTH_PCT,
      y: -5,
      targetY: 25 + nextFloat(state.rng) * 50,
      value: SUN_VALUE,
      createdAt: state.tick,
    })
  }

  // Update Suns (suns float to target position and STAY until clicked)
  state.suns = state.suns.map((s) => {
    if (s.y < s.targetY) {
      return { ...s, y: Math.min(s.targetY, s.y + 20 * dt) }
    }
    return s
  })

  // ───────────────────────────────────────────────────────────────────────────
  // 4-6. LOS DOS LADOS, CON LAS MISMAS REGLAS
  //
  // Antes esto eran TRES bloques con dos ramas de código para lo mismo: 250
  // líneas para "mis plantas" y 110 para las "del rival". Con eso, la misma carta
  // se comportaba distinto según en qué pantalla estuviera:
  //
  //   · tu lanzaguisantes disparaba a la cadencia de su carta en tu pantalla y a
  //     1800 ms fijos en la del rival;
  //   · la patata mina, la lechuga de hielo, el aloe y el ajo NO EXISTÍAN en el
  //     lado del rival: si él las plantaba, no hacían nada;
  //   · los proyectiles hacia el rival hacían daño en área y los que venían hacia
  //     ti no, así que su melón no salpicaba.
  //
  // O sea que los dos jugadores estaban jugando partidas con reglas distintas y
  // los dos podían ganar la suya de verdad. Eso es lo que producía el "tu rival
  // dijo otra cosa" al probarlo con dos cuentas: no era un desfase de red, eran
  // dos juegos diferentes.
  //
  // Ahora hay UNA función y se llama dos veces, una por lado. La única diferencia
  // entre los dos es el SENTIDO: +1 avanza hacia la derecha, −1 hacia la
  // izquierda. Todo lo demás —cadencias, daños, habilidades, área— sale de la
  // carta y es idéntico.
  // ───────────────────────────────────────────────────────────────────────────
  procesarLado(state, LADO_P1, dt, sonar)
  moverProyectiles(state, dt, sonar)
  procesarLado(state, LADO_P2, dt, sonar)


  // 7. VICTORY / DEFEAT CHECKS
  if (state.p1BaseHp <= 0) {
    state.status = 'defeat'
    sonar('zombieFinalKill', 0.7)
  } else if (state.p2BaseHp <= 0) {
    state.status = 'victory'
    sonar('level_select', 0.7)
  }
}
