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
import type {
  PlantEntity,
  EnemyPlantEntity,
  ProjectileEntity,
  SunEntity,
  GameStatus,
  GameStats,
  PlantId,
  EnemyPlantType,
  PlantStatKey,
} from '../types/game'
import {
  PLANT_CONFIGS,
  ENEMY_PLANT_CONFIGS,
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

/**
 * A qué tipo del catálogo enemigo se parece cada carta.
 *
 * El motor usa `type` para dos cosas que no dependen de la carta: si la planta
 * camina y cómo se comporta al descongelarse. Para la planta de un rival real se
 * elige el tipo del bot más parecido y las estadísticas de verdad salen de su
 * carta, no de aquí.
 */
function tipoEquivalente(plantId: PlantId): EnemyPlantType {
  const config = PLANT_CONFIGS[plantId]
  if (!config) return 'enemy_peashooter'
  if (plantId === 'sunflower' || plantId === 'twinsunflower') return 'enemy_sunflower'
  if (config.category === 'defensive') return 'enemy_wallnut'
  if (config.category === 'melee') return 'enemy_chomper'
  if (plantId === 'melonpult') return 'enemy_melonpult'
  return 'enemy_peashooter'
}

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
): EnemyPlantEntity {
  const config = getScaledPlantConfig(plantId, statRolls)
  const camina = config.category === 'melee' || !!config.moveSpeed || plantId === 'chomper'

  // Camina desde su base hacia la tuya; estática, en su columna.
  const colWidth = FIELD_WIDTH_PCT / TOTAL_COLUMNS
  const x = camina || col === undefined
    ? BASE_RIGHT_START_X - 1
    : BASE_LEFT_END_X + col * colWidth + colWidth / 2

  const entidad: EnemyPlantEntity = {
    id: entityId('rival', state.tick, state.entityCounter++),
    type: tipoEquivalente(plantId),
    plantId,
    level,
    statRolls,
    lane,
    col: camina ? undefined : col,
    x,
    hp: config.maxHp,
    maxHp: config.maxHp,
    speed: config.moveSpeed ?? 0,
    damage: config.damage ?? 0,
    // Al morir devuelve soles proporcionales a lo que costó, no los del tipo del
    // bot que le tocara por parecido.
    rewardSun: Math.max(10, Math.round((config.cost ?? 50) / 4)),
    isWalking: camina,
    state: camina ? 'walking' : 'idle',
    lastAttackTime: state.tick,
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
export function createBattleState(seed: number, isPracticeMode = false): GameState {
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
  enemyPlants: EnemyPlantEntity[]
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
  if (!state.isPracticeMode && state.tick - state.timers.lastP2PassiveSun > msToTicks(6000)) {
    state.timers.lastP2PassiveSun = state.tick
    state.p2SunBank += 25
  }

  // 2. PC AI TACTICAL PURCHASING & PLANT SPAWNING (SUNFLOWER-FIRST RULE + THREAT ASSESSMENT)
  const spawnInterval = Math.max(1200, 2200 - state.wave * 200)
  if (!state.isPracticeMode && state.tick - state.timers.lastEnemySpawn > msToTicks(spawnInterval)) {
    state.timers.lastEnemySpawn = state.tick

    // Count active P2 Sunflowers
    const p2Sunflowers = state.enemyPlants.filter(
      (e) => e.type === 'enemy_sunflower' && e.hp > 0
    ).length

    // Assess lane threats (P1 player plants advancing towards P2 base)
    const laneThreats = [0, 1, 2].map((l) => {
      const P1Advancing = state.plants.filter((pl) => pl.lane === l && pl.hp > 0 && pl.x > 25)
      return { lane: l, count: P1Advancing.length, threat: P1Advancing.length > 0 }
    })
    const activeThreatLanes = laneThreats.filter((t) => t.threat).map((t) => t.lane)
    const isEmergency = state.plants.some((pl) => pl.hp > 0 && pl.x > 60)

    let chosenType: EnemyPlantType | null = null

    // REGLA 1: GIRASOLES PRIMERO PARA ESTABLECER ECONOMÍA DE SOLES (Si no hay emergencia)
    if (p2Sunflowers === 0 && !isEmergency) {
      if (state.p2SunBank >= ENEMY_PLANT_CONFIGS.enemy_sunflower.cost) {
        chosenType = 'enemy_sunflower'
      }
    } else if (
      p2Sunflowers === 1 &&
      !isEmergency &&
      chance(state.rng, 0.60) &&
      state.p2SunBank >= ENEMY_PLANT_CONFIGS.enemy_sunflower.cost
    ) {
      chosenType = 'enemy_sunflower'
    } else {
      // REGLA 2: FILTRAR ÚNICAMENTE PLANTAS QUE EL BOT REALMENTE PUEDA PAGAR AHORA MISMO
      const affordableTypes: EnemyPlantType[] = ([
        'enemy_wallnut',
        'enemy_peashooter',
        'enemy_chomper',
        'enemy_melonpult',
        'enemy_sunflower',
      ] as EnemyPlantType[]).filter((t) => ENEMY_PLANT_CONFIGS[t].cost <= state.p2SunBank)

      if (affordableTypes.length > 0) {
        if (activeThreatLanes.length > 0) {
          // MODO DEFENSA: Si el jugador está atacando, priorizar Tanque (Wallnut) o Atacante de carril
          const wallnutCost = ENEMY_PLANT_CONFIGS.enemy_wallnut.cost
          if (state.p2SunBank >= wallnutCost && chance(state.rng, 0.5)) {
            chosenType = 'enemy_wallnut'
          } else {
            const combatTypes = affordableTypes.filter((t) => t !== 'enemy_sunflower')
            if (combatTypes.length > 0) {
              chosenType = combatTypes[nextInt(state.rng, combatTypes.length)]
            } else {
              chosenType = affordableTypes[nextInt(state.rng, affordableTypes.length)]
            }
          }
        } else {
          // MODO ATAQUE: Lanzar unidades ofensivas contra el jugador
          const attackTypes = affordableTypes.filter(
            (t) => t !== 'enemy_sunflower' && t !== 'enemy_wallnut'
          )
          if (attackTypes.length > 0) {
            chosenType = attackTypes[nextInt(state.rng, attackTypes.length)]
          } else {
            chosenType = affordableTypes[nextInt(state.rng, affordableTypes.length)]
          }
        }
      }
    }

    // GUARDIA ESTRICTO: VERIFICAR QUE EL BOT REALMENTE TIENE SOLES SUFICIENTES AHORA MISMO
    if (chosenType) {
      const eConfig = ENEMY_PLANT_CONFIGS[chosenType]

      if (state.p2SunBank < eConfig.cost) {
        // NO TIENE SOLES SUFICIENTES -> CANCELAR COLOCACIÓN
        chosenType = null
      } else {
        const isWalking = eConfig.category === 'melee'

        const lane =
          activeThreatLanes.length > 0 && chance(state.rng, 0.85)
            ? activeThreatLanes[nextInt(state.rng, activeThreatLanes.length)]
            : nextInt(state.rng, 3)

        if (isWalking) {
          state.enemyPlants.push({
            id: entityId('enemy', state.tick, state.entityCounter++),
            type: chosenType,
            lane,
            x: BASE_RIGHT_START_X - 1,
            hp: eConfig.maxHp,
            maxHp: eConfig.maxHp,
            speed: eConfig.speed,
            damage: eConfig.damage,
            isWalking: true,
            state: 'walking',
            lastAttackTime: state.tick,
          })
          // DEDUCIR SOLES RIGUROSAMENTE
          state.p2SunBank = Math.max(0, state.p2SunBank - eConfig.cost)
        } else {
          const preferredCols =
            chosenType === 'enemy_sunflower'
              ? [11, 10, 9, 8]
              : eConfig.category === 'defensive'
              ? [6, 7, 8]
              : [8, 9, 10, 11, 7, 6]

          const availableCols = preferredCols.filter((col) => {
            return !state.enemyPlants.some(
              (e) => e.lane === lane && e.col === col && !e.isWalking
            )
          })

          if (availableCols.length > 0) {
            const targetCol = availableCols[0]
            const colWidth = FIELD_WIDTH_PCT / TOTAL_COLUMNS
            const cellCenterX = BASE_LEFT_END_X + targetCol * colWidth + colWidth / 2

            state.enemyPlants.push({
              id: entityId('enemy', state.tick, state.entityCounter++),
              type: chosenType,
              lane,
              col: targetCol,
              x: cellCenterX,
              hp: eConfig.maxHp,
              maxHp: eConfig.maxHp,
              speed: 0,
              damage: eConfig.damage,
              isWalking: false,
              state: 'idle',
              lastAttackTime: state.tick,
            })
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
  if (state.tick - state.timers.lastSkySun > msToTicks(6000)) {
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

  // 4. UPDATE PLAYER 1 PLANTS
  const nextPlants: PlantEntity[] = []
  for (const plant of state.plants) {
    // Las mejoras vienen de la propia planta, fijadas al plantarla. Antes se
    // leían de localStorage en cada tic y para cada planta: además de ser
    // caro, hacía que la partida dependiera del navegador.
    const config = getScaledPlantConfig(plant.plantId, plant.statRolls ?? [])

    // Sunflower producing suns every 6s
    if (plant.plantId === 'sunflower' || plant.plantId === 'twinsunflower') {
      if (state.tick - plant.lastActionTime > msToTicks(6000)) {
        plant.lastActionTime = state.tick
        const count = plant.plantId === 'twinsunflower' ? 2 : 1
        for (let i = 0; i < count; i++) {
          state.suns.push({
            id: entityId('sun-flower', state.tick, state.entityCounter++),
            x: plant.x + (nextFloat(state.rng) * 6 - 3),
            y: 20 + plant.lane * 20 + 5,
            targetY: 20 + plant.lane * 20 + 10,
            value: SUN_VALUE,
            createdAt: state.tick,
          })
        }
      }
    }

    // Potato Mine (squash ID) arming & detonation logic
    if (plant.plantId === 'squash') {
      const armTime = state.isPracticeMode ? 4000 : 12000
      const elapsed = state.tick - plant.lastActionTime

      if (!plant.isArmed) {
        if (elapsed >= msToTicks(armTime)) {
          plant.isArmed = true
          sonar('pea_hit', 0.8)
        }
      } else {
        // Armed Potato Mine explodes when stepped on!
        const triggerEnemy = state.enemyPlants.find(
          (e) =>
            e.lane === plant.lane &&
            Math.abs(e.x - plant.x) <= 4.5 &&
            e.hp > 0
        )

        if (triggerEnemy) {
          const enemiesInTile = state.enemyPlants.filter(
            (e) =>
              e.lane === plant.lane &&
              Math.abs(e.x - plant.x) <= 5.5 &&
              e.hp > 0
          )
          enemiesInTile.forEach((e) => {
            e.hp -= config.damage || 1800
          })
          sonar('pea_hit', 1.0)
          plant.hp = 0 // Detonate Potato Mine
        }
      }
    }

    // Iceberg Lettuce instant placement detonation: Asset 1 -> Asset 2 for 2s -> Asset 1 brief -> disappear & freeze ALL enemy units for 7s
    if (plant.plantId === 'iceberglettuce' && !plant.isArmed) {
      plant.isArmed = true // Mark as triggered immediately upon placement
      plant.spriteOverride = '/game-assets/plants/iceberglettuce_burst.png'
      sonar('pea_hit', 1.0)

      // Freeze ALL opponent plants/enemies across ALL lanes for 7 seconds!
      const freezeUntilTime = state.tick + msToTicks(7000)
      state.enemyPlants.forEach((e) => {
        e.frozenUntil = freezeUntilTime
      })

      // A los 2 s vuelve un instante a su primer aspecto y 300 ms después se
      // derrite. La segunda mitad la encola iceberg_fade al ejecutarse.
      state.pending.push({
        atTick: state.tick + msToTicks(2000),
        kind: 'iceberg_fade',
        plantId: plant.id,
      })
    }

    // Aloe Healer (scans lane & heals closest wounded friendly plant with cloud FX)
    if (plant.plantId === 'aloe') {
      const healInterval = config.attackSpeedMs || 2500
      const healPower = config.damage || 60

      if (state.tick - plant.lastActionTime > msToTicks(healInterval)) {
        plant.lastActionTime = state.tick
        const woundedAlly = state.plants.find(
          (p) => p.id !== plant.id && p.lane === plant.lane && p.hp < p.maxHp && p.hp > 0
        )
        if (woundedAlly) {
          woundedAlly.hp = Math.min(woundedAlly.maxHp, woundedAlly.hp + healPower)
          woundedAlly.isHealingFx = true
          sonar('plantation', 0.6)

          state.pending.push({
            atTick: state.tick + msToTicks(1500),
            kind: 'clear_heal_fx',
            plantId: woundedAlly.id,
          })
        }
      }
    }

    // Ranged Attackers shoot continuously
    if (config.category === 'ranged') {
      if (state.tick - plant.lastActionTime > msToTicks(config.attackSpeedMs || 1200)) {
        plant.lastActionTime = state.tick

        const projType =
          plant.plantId === 'melonpult'
            ? 'melon'
            : plant.plantId === 'chomper'
            ? 'needle'
            : 'pea'

        if (plant.plantId === 'threepeater') {
          const targetLanes = [plant.lane - 1, plant.lane, plant.lane + 1].filter(
            (l) => l >= 0 && l <= 2
          )
          for (const l of targetLanes) {
            state.projectiles.push({
              id: entityId(`proj-p1-3p-${l}`, state.tick, state.entityCounter++),
              type: 'pea',
              targetTeam: 'p2',
              lane: l,
              x: plant.x + 2,
              y: 20 + l * 19.33 + 7,
              speed: 32,
              damage: config.damage || 25,
            })
          }
        } else {
          state.projectiles.push({
            id: entityId('proj-p1', state.tick, state.entityCounter++),
            type: projType,
            targetTeam: 'p2',
            lane: plant.lane,
            x: plant.x + 2,
            y: 20 + plant.lane * 19.33 + 7,
            speed: projType === 'melon' ? 22 : projType === 'needle' ? 34 : 32,
            damage: config.damage || 25,
            isSplash: projType === 'melon',
          })
        }
        sonar('pea_shoot', 0.4)

        if (plant.plantId === 'repeater') {
          // El segundo guisante sale 180 ms después. Se forma AHORA y se encola
          // para el tic correspondiente: si se formara al ejecutarse, la
          // posición de la planta ya podría haber cambiado y el identificador
          // saldría de otro tic, así que dos ejecuciones no coincidirían.
          state.pending.push({
            atTick: state.tick + msToTicks(180),
            kind: 'spawn_projectile',
            projectile: {
              id: entityId('proj-p1-rep', state.tick, state.entityCounter++),
              type: 'pea',
              targetTeam: 'p2',
              lane: plant.lane,
              x: plant.x + 2,
              y: 20 + plant.lane * 19.33 + 7,
              speed: 32,
              damage: config.damage || 25,
            },
          })
        }
      }
    }

    // Walking P1 Plant (Cactus / Squash P1 moving RIGHT towards P2 base)
    if (plant.isWalking) {
      if (plant.plantId === 'garlic') {
        // Squash hopping & high-leap crushing smash logic!
        if (plant.isSmashing) {
          plant.state = 'attacking'
          const elapsed = state.tick - (plant.smashStartTime || 0)
          if (elapsed >= msToTicks(600)) {
            // Smash impact moment! Inflict massive 600 damage to all enemies in quadrant & expire
            const enemiesInQuadrant = state.enemyPlants.filter(
              (e) =>
                e.lane === plant.lane &&
                Math.abs(e.x - plant.x) <= 5.5 &&
                e.hp > 0
            )
            enemiesInQuadrant.forEach((e) => {
              e.hp -= config.damage || 600
            })
            sonar('pea_hit', 0.9)
            plant.hp = 0 // Expire Squash after full slam animation completes
          }
        } else {
          const enemiesInQuadrant = state.enemyPlants.filter(
            (e) =>
              e.lane === plant.lane &&
              Math.abs(e.x - plant.x) <= 4.8 &&
              e.hp > 0
          )

          if (enemiesInQuadrant.length > 0) {
            plant.isSmashing = true
            plant.smashStartTime = state.tick
            plant.state = 'attacking'
            sonar('pea_hit', 0.7)
          } else {
            plant.state = 'walking'
            plant.x += (config.moveSpeed || 6.0) * dt

            if (plant.x >= BASE_RIGHT_START_X - 1) {
              state.p2BaseHp = Math.max(0, state.p2BaseHp - 150)
              sonar('pea_hit', 0.8)
              plant.hp = 0
            }
          }
        }
      } else {
        const enemyTarget = state.enemyPlants.find(
          (e) =>
            e.lane === plant.lane &&
            e.x >= plant.x &&
            e.x - plant.x <= 3.8 &&
            e.hp > 0
        )

        if (enemyTarget) {
          plant.state = 'attacking'
          const attackInterval = config.attackSpeedMs || 600
          if (state.tick - plant.lastActionTime >= msToTicks(attackInterval)) {
            plant.lastActionTime = state.tick
            enemyTarget.hp -= config.damage || 90
            sonar('pea_hit', 0.5)
          }
        } else {
          plant.state = 'walking'
          plant.x += (config.moveSpeed || 4.5) * dt

          if (plant.x >= BASE_RIGHT_START_X - 1) {
            state.p2BaseHp = Math.max(0, state.p2BaseHp - 40)
            sonar('pea_hit', 0.6)
            plant.hp = 0
          }
        }
      }
    }

    if (plant.hp > 0) {
      nextPlants.push(plant)
    }
  }
  state.plants = nextPlants

  // 5. UPDATE PROJECTILES & HITS
  const nextProjectiles: ProjectileEntity[] = []
  for (const p of state.projectiles) {
    let hit = false

    if (p.targetTeam === 'p2') {
      p.x += p.speed * dt
      for (const e of state.enemyPlants) {
        if (e.lane === p.lane && Math.abs(e.x - p.x) <= 2.5 && e.hp > 0) {
          hit = true
          e.hp -= p.damage
          sonar('pea_hit', 0.4)

          if (p.isSplash) {
            for (const splashE of state.enemyPlants) {
              if (
                splashE.id !== e.id &&
                splashE.lane === p.lane &&
                Math.abs(splashE.x - p.x) <= 7.0 &&
                splashE.hp > 0
              ) {
                splashE.hp -= Math.round(p.damage * 0.6)
              }
            }
          }
          break
        }
      }

      if (!hit && p.x >= BASE_RIGHT_START_X) {
        hit = true
        state.p2BaseHp = Math.max(0, state.p2BaseHp - p.damage)
        sonar('pea_hit', 0.5)
      }
    } else {
      p.x -= p.speed * dt
      for (const pl of state.plants) {
        if (pl.lane === p.lane && Math.abs(pl.x - p.x) <= 2.5 && pl.hp > 0) {
          hit = true
          pl.hp -= p.damage
          sonar('pea_hit', 0.4)
          break
        }
      }

      if (!hit && p.x <= BASE_LEFT_END_X) {
        hit = true
        state.p1BaseHp = Math.max(0, state.p1BaseHp - p.damage)
        sonar('pea_hit', 0.5)
      }
    }

    if (!hit && p.x > 10 && p.x < 90) {
      nextProjectiles.push(p)
    }
  }
  state.projectiles = nextProjectiles

  // 6. UPDATE PLAYER 2 ENEMY PLANTS
  const nextEnemies: EnemyPlantEntity[] = []
  for (const e of state.enemyPlants) {
    if (e.hp <= 0) {
      sonar('zombie_fall', 0.4)
      state.stats.enemyPlantsDefeated += 1
      state.stats.score += 100
      // De la entidad si los trae (planta de un rival real), y si no del
      // catálogo del bot. Sin esto, matar la planta de un rival daría los soles
      // del tipo del bot que le tocara por defecto.
      state.sunBank += e.rewardSun ?? ENEMY_PLANT_CONFIGS[e.type]?.rewardSun ?? 25
      continue
    }

    const config = ENEMY_PLANT_CONFIGS[e.type]

    // Frozen enemy check (Iceberg Lettuce freeze for exactly 7.0 seconds)
    if (e.frozenUntil) {
      if (state.tick < e.frozenUntil) {
        nextEnemies.push(e)
        continue
      } else {
        // 7 seconds expired! Clear freeze & restore walking state
        e.frozenUntil = undefined
        // Se recupera la velocidad que YA tenía la entidad, no la del catálogo:
        // la planta de un rival real tiene la suya, sacada de su carta.
        if (e.isWalking || config.category === 'melee') {
          e.isWalking = true
          if (!e.speed) e.speed = config.speed
        }
      }
    }

    // Enemy Sunflower (Girasol Enemigo P2) generates +25 Sun for PC AI every 6s
    if (e.type === 'enemy_sunflower') {
      if (state.tick - e.lastAttackTime > msToTicks(6000)) {
        e.lastAttackTime = state.tick
        state.p2SunBank += 25
      }
    }

    // Ranged Enemy Plants (Guisantera, Melón, Cactus) shoot left continuously
    if (config.category === 'ranged') {
      if (state.tick - e.lastAttackTime > msToTicks(e.type === 'enemy_chomper' ? 1100 : 1800)) {
        e.lastAttackTime = state.tick
        const projType =
          e.type === 'enemy_melonpult'
            ? 'melon'
            : e.type === 'enemy_chomper'
            ? 'needle'
            : 'pea'
        state.projectiles.push({
          id: entityId('proj-p2', state.tick, state.entityCounter++),
          type: projType,
          targetTeam: 'p1',
          lane: e.lane,
          x: e.x - 2,
          y: 20 + e.lane * 19.33 + 7,
          speed: projType === 'melon' ? 22 : projType === 'needle' ? 34 : 32,
          damage: e.damage,
        })
        sonar('pea_shoot', 0.4)
      }
    }

    // Walking Melee Enemy Plants (Cactus Enemigo walking LEFT)
    if (e.isWalking) {
      const blockingP1 = state.plants.find(
        (pl) =>
          pl.lane === e.lane &&
          pl.x <= e.x &&
          e.x - pl.x <= 3.8 &&
          pl.hp > 0
      )

      if (blockingP1) {
        e.state = 'attacking'
        if (state.tick - e.lastAttackTime > msToTicks(600)) {
          e.lastAttackTime = state.tick
          blockingP1.hp -= e.damage
          sonar('pea_hit', 0.5)
        }
      } else {
        e.state = 'walking'
        e.x -= e.speed * dt

        if (e.x <= BASE_LEFT_END_X + 1) {
          state.p1BaseHp = Math.max(0, state.p1BaseHp - e.damage * dt)
        }
      }
    } else {
      // Static Enemy Plant
      const blockingP1 = state.plants.find(
        (pl) =>
          pl.lane === e.lane &&
          pl.x <= e.x &&
          e.x - pl.x <= 3.0 &&
          pl.hp > 0
      )
      if (blockingP1) {
        e.state = 'attacking'
        blockingP1.hp -= e.damage * dt
      } else {
        e.state = 'idle'
      }
    }

    nextEnemies.push(e)
  }
  state.enemyPlants = nextEnemies

  // 7. VICTORY / DEFEAT CHECKS
  if (state.p1BaseHp <= 0) {
    state.status = 'defeat'
    sonar('zombieFinalKill', 0.7)
  } else if (state.p2BaseHp <= 0) {
    state.status = 'victory'
    sonar('level_select', 0.7)
  }
}
