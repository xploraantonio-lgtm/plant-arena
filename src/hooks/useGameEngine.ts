import { useState, useEffect, useRef, useCallback } from 'react'
// ─────────────────────────────────────────────────────────────────────────────
// EL TIEMPO SE MIDE EN TICS Y EL AZAR TIENE SEMILLA
//
// Antes había 46 lecturas de reloj de pared (36 Date.now() + 10
// performance.now()) y 20 Math.random() dentro de la lógica de juego. Con eso,
// dos ejecuciones con la misma entrada daban partidas distintas: el servidor no
// podía recalcular una partida para saber quién ganó, y una repetición no
// reproducía lo ocurrido.
//
// A partir de aquí:
//   · state.tick es el único reloj. Un tic son 33 ms, el mismo sub-paso que ya
//     usaba el bucle (stepDt = 0.033), así que la física no cambia.
//   · state.rng sustituye a Math.random(), sembrado desde game_rooms.seed.
//   · los identificadores de entidad se derivan del tic y de un contador.
//
// La única lectura de reloj real que queda es la del bucle, para saber cuántos
// tics completos han pasado. No entra en la lógica de juego.
// ─────────────────────────────────────────────────────────────────────────────
import { createRng } from '../engine/rng'
import { TICK_MS, MAX_TICKS_PER_FRAME, msToTicks } from '../engine/time'
import { stepTick, createBattleState, type GameState } from '../engine/simulate'
import { MARGEN_DE_RED_TICS } from '../engine/pvp'
import {
  huellaDeLaPartida,
  tocaHuella,
  RETRASO_DE_HUELLA_TICS,
  type HuellaEnUnTic,
} from '../engine/huella'
import {
  reconstruirConHuellas,
  conservarLoLocal,
  type AccionRegistrada,
} from '../engine/reconstruir'
import {
  leerMazo,
  mejorasDeLaCartaEnSlot,
  type CartaDeMazo,
} from '../engine/mazoDeLaSala'
import {
  createAsyncOpponentController,
  stepAsyncOpponent,
  reconstruirPartidaAsync,
  normalizarIntenciones,
  type AsyncOpponentController,
  type AccionP1Simulacion,
} from '../engine/asyncOpponent'
import {
  type InconsistenciaHistorialP1,
} from '../engine/asyncP1History'
import {
  ejecutarCapturaCollectP1,
  ejecutarCapturaPlantP1,
  ejecutarCapturaDigP1,
  ejecutarDescarteAccionP1,
} from '../engine/asyncP1Capture'
import { nivelPorElo } from '../engine/bot'
import type {
  PlantEntity,
  PlantId,
} from '../types/game'
import {
  PLANT_CONFIGS,
  INITIAL_SUN,
  INITIAL_BASE_HP,
  BASE_LEFT_END_X,
  FIELD_WIDTH_PCT,
  TOTAL_COLUMNS,
  getScaledPlantConfig,
  getEligibleStatsForPlant,
  type PlantStatKey,
} from '../utils/gameConstants'
import { soundManager } from '../utils/audioManager'

function getPlantRolls(plantId: PlantId): PlantStatKey[] {
  try {
    const saved = localStorage.getItem('plant_arena_plant_stat_rolls')
    if (saved) {
      const parsed = JSON.parse(saved)
      return parsed[plantId] || []
    }
  } catch {
    // fallback
  }
  return []
}

const createInitialCooldowns = (): Record<PlantId, number> =>
  (Object.keys(PLANT_CONFIGS) as PlantId[]).reduce(
    (acc, id) => ({ ...acc, [id]: 0 }),
    {} as Record<PlantId, number>
  )

// PendingAction y GameState se movieron a engine/simulate.ts: son la forma de la
// simulación, no del hook.
export function useGameEngine() {
  const [isMuted, setIsMuted] = useState<boolean>(soundManager.isMuted())
  const [, setRenderTick] = useState<number>(0)

  // Single mutable reference holding all game state
  const stateRef = useRef<GameState>({
    tick: 0,
    // Semilla provisional. En PvP la pondrá game_rooms.seed, igual para los dos
    // jugadores: es lo que hace que ambos simulen la misma partida.
    rng: createRng(1),
    entityCounter: 0,
    pending: [],
    timers: { lastSkySun: 0, lastP2PassiveSun: 0, lastEnemySpawn: 0, waveStart: 0 },
    status: 'ready',
    p1BaseHp: INITIAL_BASE_HP,
    p2BaseHp: INITIAL_BASE_HP,
    sunBank: INITIAL_SUN,
    p2SunBank: INITIAL_SUN,
    plants: [],
    enemyPlants: [],
    projectiles: [],
    suns: [],
    selectedCard: null,
    selectedSlotIndex: null,
    cooldowns: createInitialCooldowns(),
    slotCooldowns: {},
    wave: 1,
    waveBanner: null,
    stats: {
      sunsCollected: 0,
      enemyPlantsDefeated: 0,
      plantsPlaced: 0,
      score: 0,
    },
  })

  // ── Puente entre el reloj real y los tics ─────────────────────────────────
  // Estas dos son las ÚNICAS que tocan el reloj de pared, y sólo para saber
  // cuántos tics completos han pasado desde el último fotograma. No entran en la
  // lógica de juego.
  const lastFrameMsRef = useRef<number>(performance.now())
  /**
   * Milisegundos sobrantes que no llegaron a completar un tic.
   *
   * Es la pieza que faltaba. El bucle hacía `dt = Math.min(remainingDt, stepDt)`,
   * así que el último paso de cada fotograma valía "lo que quedara" y a 144 Hz se
   * simulaba distinto que a 30 Hz. Ahora sólo se ejecutan tics COMPLETOS y el
   * resto se arrastra al fotograma siguiente.
   */
  const accumulatorMsRef = useRef<number>(0)

  /**
   * EL RELOJ COMÚN DE LA PARTIDA
   *
   * El instante (en Date.now()) que corresponde al tic 0. Cuando hay sala lo pone
   * el SERVIDOR y es el mismo para los dos jugadores.
   *
   * Sin esto, el tic 0 de cada uno era el momento en que ÉL entró al campo, y eso
   * no coincide: entre emparejar y estar jugando pasan un par de segundos
   * distintos por cabeza. Jugando se veía en que los soles del cielo caían en
   * momentos distintos en cada pantalla, y en que al que iba atrasado el servidor
   * le rechazaba las plantaciones por antiguas.
   *
   * En null, la partida cuenta desde que arrancó — que es lo correcto en solitario.
   */
  const ancoraMsRef = useRef<number | null>(null)

  /**
   * De qué lado estoy en la sala, para la huella del tablero.
   *
   * Null fuera del 1c1: contra el bot no hay con quién comparar y no se toma
   * ninguna huella.
   */
  const soyP1Ref = useRef<boolean | null>(null)
  const asyncOpponentRef = useRef<AsyncOpponentController | null>(null)

  /**
   * Huellas tomadas y aún sin mandar.
   *
   * Se acumulan aquí porque el bucle del juego no debe hacer llamadas de red: sólo
   * apunta, y quien pinta las recoge y las manda.
   */
  const huellasPendientesRef = useRef<HuellaEnUnTic[]>([])

  // ── EL REGISTRO DE JUGADAS, PARA PODER REHACER LA PARTIDA ──────────────────
  //
  // Se guardan TODAS las jugadas de las dos partes con el tic en que ocurren. No
  // es un historial para mirar: es lo que permite volver a montar la partida
  // cuando una jugada llega tarde, en lugar de aplicarla fuera de su sitio.
  //
  // Cabe de sobra: una partida larga son unas decenas de jugadas.

  /** La semilla de esta partida. Sin ella no se puede rehacer nada. */
  const semillaRef = useRef<number>(1)
  /** Todas las jugadas conocidas, mías y del rival. */
  const registroRef = useRef<AccionRegistrada[]>([])
  /** Para numerar mis jugadas antes de que el servidor les dé su identificador. */
  const numeroDeJugadaRef = useRef<number>(0)
  /**
   * Cuántas veces se ha rehecho la partida.
   *
   * Se enseña en el panel de diagnóstico: es la medida de cuánto retraso está
   * habiendo de verdad en las partidas de la gente.
   */
  const reconstruccionesRef = useRef<number>(0)
  /**
   * El tic más antiguo afectado por una jugada que llegó tarde, si hay alguna.
   *
   * No se rehace la partida en el momento de recibirla: se apunta aquí y el bucle
   * lo hace una vez por fotograma. Las jugadas atrasadas llegan en ráfagas —la red
   * de seguridad recupera varias de golpe— y rehacer una vez por cada una daría un
   * tirón bien visible en un móvil.
   */
  const rehacerDesdeRef = useRef<number | null>(null)

  /**
   * Los dos mazos de la sala, con el nivel y las mejoras de cada carta.
   *
   * De aquí salen las estadísticas de las plantas de LOS DOS lados, y por eso las
   * dos pantallas simulan la misma planta. Antes cada uno leía sus propias mejoras
   * de su navegador y el rival plantaba la carta básica, así que la misma planta
   * tenía 345 de vida en un lado y 300 en el otro desde el momento de ponerla —
   * divergencia garantizada para cualquiera con una carta mejorada, sin necesidad
   * de que se perdiera nada por la red. Ver engine/mazoDeLaSala.ts.
   *
   * En null fuera del 1c1, y entonces valen las mejoras del navegador: en solitario
   * no hay nadie con quien coincidir.
   */
  const mazoMioRef = useRef<CartaDeMazo[] | null>(null)
  const mazoDelRivalRef = useRef<CartaDeMazo[] | null>(null)
  const isAsyncMatchRef = useRef<boolean>(false)
  const asyncOpponentDeckRef = useRef<CartaDeMazo[] | null>(null)
  const asyncOpponentActionsBufferRef = useRef<any[]>([])
  const accionesP1AsyncRef = useRef<AccionP1Simulacion[]>([])
  const [rankedAsyncInconsistency, setRankedAsyncInconsistency] = useState<{
    reason: InconsistenciaHistorialP1
    seq?: number
    issuedTick?: number
    details?: string
  } | null>(null)
  const rankedAsyncInconsistencyRef = useRef<{
    reason: InconsistenciaHistorialP1
    seq?: number
    issuedTick?: number
    details?: string
  } | null>(null)

  const marcarInconsistenciaRanked = useCallback(
    (inconsistencia: {
      reason: InconsistenciaHistorialP1
      seq?: number
      issuedTick?: number
      details?: string
    }) => {
      rankedAsyncInconsistencyRef.current = inconsistencia
      setRankedAsyncInconsistency(inconsistencia)
      console.warn('[RankedAsync] Inconsistencia autoritativa detectada:', inconsistencia)
    },
    []
  )

  /**
   * Incorpora intenciones del Rival Semilla recibidas progresivamente desde el servidor.
   * Si una intención llega tarde (su issuedTick <= stateRef.current.tick), marca rehacerDesdeRef
   * para que el bucle de juego ejecute una reconstrucción determinista exacta desde ese tic.
   */
  const incorporarIntencionesAsync = useCallback((nuevasIntenciones: any[]) => {
    if (!nuevasIntenciones || nuevasIntenciones.length === 0) return
    const buffer = asyncOpponentActionsBufferRef.current
    const clavesExistentes = new Set(
      buffer.map((i) => `${i.seq ?? ''}_${i.issuedTick ?? i.tick}_${i.kind}_${i.lane}_${i.col ?? ''}`)
    )

    let huboNuevas = false
    let tickMasAntiguoNuevo: number | null = null

    for (const n of nuevasIntenciones) {
      const clave = `${n.seq ?? ''}_${n.issuedTick ?? n.tick}_${n.kind}_${n.lane}_${n.col ?? ''}`
      if (clavesExistentes.has(clave)) continue

      clavesExistentes.add(clave)
      buffer.push(n)
      huboNuevas = true

      const issuedTick = Number(n.issuedTick ?? n.tick)
      if (Number.isInteger(issuedTick) && issuedTick >= 0) {
        tickMasAntiguoNuevo =
          tickMasAntiguoNuevo === null
            ? issuedTick
            : Math.min(tickMasAntiguoNuevo, issuedTick)
      }
    }

    if (!huboNuevas) return

    if (asyncOpponentRef.current) {
      asyncOpponentRef.current.intents = normalizarIntenciones(buffer)
    }

    const currentTick = stateRef.current.tick
    if (
      tickMasAntiguoNuevo !== null &&
      tickMasAntiguoNuevo <= currentTick
    ) {
      rehacerDesdeRef.current =
        rehacerDesdeRef.current === null
          ? tickMasAntiguoNuevo
          : Math.min(rehacerDesdeRef.current, tickMasAntiguoNuevo)
    }
  }, [])

  /**
   * Lo que costó cada jugada mía, por si el servidor la rechaza.
   *
   * Plantar cobra los soles y arranca el enfriamiento en el acto, para que el clic
   * responda sin esperar a la red. Si luego el servidor no acepta la jugada, hay
   * que quitar la planta —en la pantalla del rival nunca existió— y entonces esos
   * soles se habrían cobrado por nada. Aquí queda lo que hay que devolver.
   *
   * La clave es tic:carril:columna, que es lo que identifica la jugada tanto aquí
   * como en la respuesta del servidor.
   */
  const costeDeMisJugadasRef = useRef<Map<string, { coste: number; carta: PlantId; slot: number | null }>>(
    new Map()
  )

  const claveDeJugada = (tick: number, lane: number, col: number | null) => `${tick}:${lane}:${col}`

  // Los temporizadores del juego ya NO viven aquí: están en state.timers, para
  // que formen parte de la simulación y se puedan guardar y reanudar.

  // Force a single React re-render per frame
  /**
   * Lo que la simulación usa para pedir un sonido. El motor no conoce
   * soundManager: recibe esta función, y así el mismo tic sirve para el
   * navegador, para un test y para el servidor.
   */
  const reproducirSonido = useCallback((nombre: string, volumen: number) => {
    soundManager.playSound(nombre, volumen)
  }, [])

  const forceRender = useCallback(() => {
    setRenderTick((t) => (t + 1) % 100000)
  }, [])

  // Audio mute subscription
  useEffect(() => {
    const unsubscribe = soundManager.subscribe((muted) => setIsMuted(muted))
    return () => unsubscribe()
  }, [])

  const toggleMute = useCallback(() => {
    soundManager.toggleMute()
  }, [])

  // Select card handler with optional slotIndex
  const setSelectedCard = useCallback(
    (card: PlantId | 'shovel' | null, slotIndex: number | null = null) => {
      stateRef.current.selectedCard = card
      stateRef.current.selectedSlotIndex = slotIndex
      forceRender()
    },
    [forceRender]
  )

  // Start game
  /**
   * Arranca una partida.
   *
   * `seed` es la semilla del azar. En PvP vendrá de game_rooms.seed y será la
   * misma para los dos jugadores: es lo que garantiza que ambos simulen
   * exactamente la misma partida, y lo que permite al servidor recalcularla.
   * Sin ella se usa un valor fijo, así que en solitario la partida es
   * reproducible pero siempre igual — para variar, pásale una semilla distinta.
   */
  /**
   * @param seed      la semilla del azar, de game_rooms.seed
   * @param esPvp     calla al bot: en PvP el otro lado lo llena el rival
   * @param ancoraMs  el instante (Date.now) que corresponde al tic 0. En PvP lo
   *                  pone el servidor y es el mismo para los dos, así que los dos
   *                  van por el mismo tic aunque uno haya entrado más tarde: el
   *                  que llega tarde simula de golpe los tics que se perdió.
   */
  const startGame = useCallback((
    seed: number = 1,
    esPvp: boolean = false,
    ancoraMs?: number,
    /** Tu ELO, para que el bot de entrenamiento se parezca a alguien de tu nivel. */
    miElo?: number,
    /**
     * De qué lado estás en la sala. Sólo para la huella del tablero: las dos
     * pantallas la calculan desde el punto de vista del jugador 1 para que se
     * puedan comparar. Sin esto no se toma ninguna huella.
     */
    soyP1?: boolean,
    /**
     * Los dos mazos de la sala, tal como los guardó el servidor.
     *
     * De aquí salen las mejoras de las cartas de los dos lados. Sin ellos se cae a
     * las mejoras del navegador, que es lo correcto en solitario y lo que había
     * antes en 1c1 — donde daba dos plantas distintas en cada pantalla.
     */
    mazos?: { mio: unknown; rival: unknown } | null,
    isAsyncMatch?: boolean,
    initialAsyncIntents?: unknown
  ) => {
    stateRef.current = createBattleState(seed, false, esPvp, nivelPorElo(miElo ?? 1500))

    ancoraMsRef.current = ancoraMs ?? null
    soyP1Ref.current = soyP1 === undefined ? null : soyP1
    mazoMioRef.current = leerMazo(mazos?.mio)
    mazoDelRivalRef.current = leerMazo(mazos?.rival)
    isAsyncMatchRef.current = Boolean(isAsyncMatch)

    if (isAsyncMatch && mazos?.rival) {
      const deck = leerMazo(mazos.rival)
      asyncOpponentDeckRef.current = deck
      const initialIntents = Array.isArray(initialAsyncIntents) ? [...initialAsyncIntents] : []
      asyncOpponentActionsBufferRef.current = initialIntents
      asyncOpponentRef.current = createAsyncOpponentController(deck, normalizarIntenciones(initialIntents))
    } else {
      asyncOpponentDeckRef.current = null
      asyncOpponentActionsBufferRef.current = []
      asyncOpponentRef.current = null
    }

    huellasPendientesRef.current = []
    // El registro empieza vacío y con la semilla de ESTA partida: rehacer una
    // partida con la semilla de la anterior daría otra partida distinta.
    semillaRef.current = seed
    registroRef.current = []
    accionesP1AsyncRef.current = []
    rankedAsyncInconsistencyRef.current = null
    setRankedAsyncInconsistency(null)
    numeroDeJugadaRef.current = 0
    reconstruccionesRef.current = 0
    rehacerDesdeRef.current = null
    costeDeMisJugadasRef.current = new Map()
    lastFrameMsRef.current = performance.now()
    accumulatorMsRef.current = 0

    soundManager.playBgm('battle')
    forceRender()
  }, [forceRender])

  // Start practice / sandbox mode
  const startPracticeGame = useCallback((plantId?: string) => {
    asyncOpponentRef.current = null
    // En prácticas no hay rival, así que no hay reloj que compartir.
    ancoraMsRef.current = null
    rankedAsyncInconsistencyRef.current = null
    setRankedAsyncInconsistency(null)
    accionesP1AsyncRef.current = []
    registroRef.current = []
    rehacerDesdeRef.current = null
    const colWidth = FIELD_WIDTH_PCT / TOTAL_COLUMNS

    // Create 3 static target dummies in cols 7, 8, 9 across the 3 lanes
    // Los muñecos de prácticas son plantas normales, como todo lo demás desde
    // que los dos lados comparten una sola rama de código: un muro sin daño que
    // aguanta para poder probar.
    const dummies: PlantEntity[] = [0, 1, 2].map((lane) => {
      const targetCol = 8
      const cellCenterX = BASE_LEFT_END_X + targetCol * colWidth + colWidth / 2
      return {
        id: `dummy-${lane}`,
        plantId: 'wallnut' as PlantId,
        statRolls: [],
        lane,
        col: targetCol,
        x: cellCenterX,
        hp: 850,
        maxHp: 850,
        damage: 0,
        isWalking: false,
        state: 'idle' as const,
        lastActionTime: 0,
      }
    })

    const initialCard = (plantId && plantId in PLANT_CONFIGS) ? (plantId as PlantId) : null

    // Auto-spawn 1 instance of the requested plant in center lane (lane 1, col 1) to test action immediately
    const initialPlants: PlantEntity[] = []
    if (initialCard) {
      const config = PLANT_CONFIGS[initialCard]
      if (config) {
        const isWalkingUnit = config.category === 'melee' || !!config.moveSpeed || initialCard === 'chomper'
        const targetLane = 1
        const targetCol = 1
        const cellCenterX = BASE_LEFT_END_X + targetCol * colWidth + colWidth / 2

        initialPlants.push({
          id: 'practice-auto-plant',
          plantId: initialCard,
          lane: targetLane,
          col: targetCol,
          x: cellCenterX,
          hp: config.maxHp,
          maxHp: config.maxHp,
          lastActionTime: 0,
          isWalking: isWalkingUnit,
          state: isWalkingUnit ? 'walking' : 'idle',
        })
      }
    }

    stateRef.current = {
      tick: 0,
      rng: createRng(1),
      entityCounter: 0,
      // En práctica el cartel dura 4 s.
      pending: [{ atTick: msToTicks(4000), kind: 'clear_wave_banner' }],
      timers: { lastSkySun: 0, lastP2PassiveSun: 0, lastEnemySpawn: 0, waveStart: 0 },
      status: 'playing',
      isPracticeMode: true,
      p1BaseHp: INITIAL_BASE_HP,
      p2BaseHp: 99999,
      sunBank: 9999,
      p2SunBank: 0,
      plants: initialPlants,
      enemyPlants: dummies,
      projectiles: [],
      suns: [],
      selectedCard: initialCard,
      selectedSlotIndex: null,
      cooldowns: createInitialCooldowns(),
      slotCooldowns: {},
      wave: 1,
      waveBanner: `🎯 MODO PRUEBA: ${initialCard ? PLANT_CONFIGS[initialCard].name.toUpperCase() : 'SANDBOX'}`,
      stats: {
        sunsCollected: 0,
        enemyPlantsDefeated: 0,
        plantsPlaced: initialPlants.length,
        score: 0,
      },
    }

    lastFrameMsRef.current = performance.now()
    accumulatorMsRef.current = 0

    soundManager.playBgm('battle')
    forceRender()

  }, [forceRender])

  const prepararRecogidaSol = useCallback((sunId: string): number | null => {
    const state = stateRef.current
    const sol = state.suns.find((s) => s.id === sunId)
    if (!sol) return null
    return state.tick
  }, [])

  const confirmarRecogidaSol = useCallback(
    (sunId: string, issuedTick?: number, seq?: number): boolean => {
      const res = ejecutarCapturaCollectP1({
        isAsyncMatch: isAsyncMatchRef.current,
        sunId,
        issuedTick,
        seq,
        state: stateRef.current,
        historial: accionesP1AsyncRef.current,
        inconsistenciaActual: rankedAsyncInconsistencyRef.current?.reason ?? null,
      })

      if (!res.ok) {
        marcarInconsistenciaRanked({
          reason: res.reason,
          seq: res.seq,
          issuedTick: res.issuedTick,
          details: res.details,
        })
        return false
      }

      if (res.duplicated) {
        return true
      }

      if (res.sunValue !== undefined) {
        soundManager.playSound('points', 0.6)
        forceRender()
        return true
      }

      return true
    },
    [forceRender, marcarInconsistenciaRanked]
  )

  const collectSun = useCallback(
    (sunId: string): number | null => {
      const issuedTick = prepararRecogidaSol(sunId)
      if (issuedTick === null) return null
      confirmarRecogidaSol(sunId, issuedTick)
      return issuedTick
    },
    [prepararRecogidaSol, confirmarRecogidaSol]
  )

  /**
   * ¿Ha empezado ya la partida?
   *
   * Con reloj común, la sala nace con la hora de inicio unos segundos en el
   * FUTURO (migración 28): es la cuenta atrás que hace que los dos jugadores
   * arranquen a la vez en lugar de que el tic 0 sea «cuando entró el más rápido
   * en cargar».
   *
   * Mientras no llegue esa hora, el bucle no avanza ningún tic y no se puede
   * jugar. Sin esta comprobación, plantar durante la cuenta atrás mandaría al
   * servidor una acción con un tic que su reloj todavía no ha alcanzado, y la
   * rechazaría por venir del futuro.
   */
  const haEmpezado = useCallback(() => {
    return ancoraMsRef.current === null || Date.now() >= ancoraMsRef.current
  }, [])

  /**
   * REHACE LA PARTIDA CON EL REGISTRO ENTERO Y VUELVE A DONDE ÍBAMOS.
   *
   * EL FALLO QUE ESTO ARREGLA, MEDIDO EN UNA PARTIDA DE VERDAD
   *   El detector encontró esto en el segundo 59 de una partida móvil contra
   *   ordenador: la MISMA planta con 50 de vida en una pantalla y 75 en la otra.
   *   Veinticinco justos, que es el daño de un guisante. En un lado había
   *   impactado un guisante más.
   *
   *   No faltaba ninguna jugada: una había llegado TARDE. El receptor la aplicaba
   *   «en el tic siguiente», así que su lanzaguisantes empezaba a disparar unos
   *   tics después que el del otro y desde ahí la cuenta iba desfasada para
   *   siempre. Con datos móviles, los 200 ms de margen se pasan con facilidad.
   *
   * LA REGLA
   *   Una jugada se aplica EN SU TIC. Si llegó tarde no se aplica más tarde: se
   *   rehace la partida desde el tic 0 con la jugada en su sitio y se adelanta
   *   hasta donde íbamos. Queda exactamente igual que si hubiera llegado a tiempo.
   *
   *   En otros juegos esto es carísimo porque hay que guardar fotos del estado.
   *   Aquí sale gratis: el motor es determinista y todo el estado son datos planos,
   *   generador de azar incluido. Miles de tics tardan milisegundos.
   */
  const rehacerLaPartida = useCallback((desdeTick: number) => {
    const viejo = stateRef.current
    // Sólo en 1c1: en solitario no hay nada que llegue tarde.
    if (!viejo.isPvpMode || viejo.status !== 'playing') return

    reconstruccionesRef.current += 1

    // ── RAMA ASÍNCRONA (RIVAL SEMILLA RANKED) ─────────────────────────────────
    if (isAsyncMatchRef.current && asyncOpponentDeckRef.current) {
      const selectedCard = viejo.selectedCard
      const selectedSlotIndex = viejo.selectedSlotIndex
      const rebuildRes = reconstruirPartidaAsync(
        semillaRef.current,
        mazoMioRef.current,
        asyncOpponentDeckRef.current,
        asyncOpponentActionsBufferRef.current,
        accionesP1AsyncRef.current,
        viejo.tick
      )

      if (!rebuildRes.ok) {
        marcarInconsistenciaRanked({
          reason: rebuildRes.reason ?? 'TIMELINE_INCONSISTENT',
          seq: rebuildRes.seq,
          issuedTick: rebuildRes.issuedTick,
          details: rebuildRes.details,
        })
        // FAIL CLOSED: No instalar una timeline corrupta o aproximada en stateRef.current
        return
      }

      asyncOpponentRef.current = rebuildRes.controller
      stateRef.current = rebuildRes.estado
      stateRef.current.selectedCard = selectedCard
      stateRef.current.selectedSlotIndex = selectedSlotIndex
      forceRender()
      return
    }

    const soyP1 = soyP1Ref.current

    const { estado, huellas } = reconstruirConHuellas(
      semillaRef.current,
      registroRef.current,
      viejo.tick,
      soyP1 ?? true
    )
    // Los soles y los enfriamientos son sólo tuyos y no salen del registro: si se
    // rehicieran, perderías los soles que ya habías recogido pulsando.
    stateRef.current = conservarLoLocal(estado, viejo)

    // Y las huellas que aún no han salido se cambian por las buenas.
    //
    // Hace falta porque la jugada tardía llega DESPUÉS de tomar la huella del tic
    // anterior: esa huella se calculó sin ella y no cuadra con la del rival. Sin
    // esto, el detector avisaría de una separación que ya está arreglada, y no
    // habría forma de distinguir un aviso falso de uno de verdad.
    //
    // Las que ya se mandaron no se pueden tocar (el servidor no deja reescribir
    // una huella, a propósito). Por eso salen con retraso: ver
    // RETRASO_DE_HUELLA_TICS.
    if (soyP1 !== null && huellasPendientesRef.current.length > 0) {
      const buenas = new Map(
        huellas.filter((h) => h.tick >= desdeTick).map((h) => [h.tick, h.huella])
      )
      if (buenas.size > 0) {
        huellasPendientesRef.current = huellasPendientesRef.current.map((h) => {
          const buena = buenas.get(h.tick)
          return buena === undefined ? h : { tick: h.tick, huella: buena }
        })
      }
    }

    forceRender()
  }, [forceRender, marcarInconsistenciaRanked])

  /** Apunta una jugada mía en el registro, para poder rehacer la partida. */
  const apuntarJugadaPropia = useCallback((jugada: Omit<AccionRegistrada, 'id' | 'mia'>) => {
    numeroDeJugadaRef.current += 1
    registroRef.current.push({ ...jugada, id: numeroDeJugadaRef.current, mia: true })
  }, [])

  // Place plant handler
  const placePlant = useCallback(
    /**
     * Intenta plantar. Devuelve EL TIC en que se plantará, o null si no se pudo.
     *
     * Devuelve el tic, y no un sí o un no, porque es el tic que hay que mandarle
     * al servidor — y tiene que ser EXACTAMENTE el mismo que se usó aquí.
     *
     * Antes quien registraba lo calculaba por su cuenta, con el tic del último
     * fotograma pintado. Entre ese fotograma y el clic el motor puede haber
     * avanzado un tic, así que la planta entraba en mi pantalla en el tic T y en la
     * del rival en el T-1: un tic de diferencia, que es justo la clase de desfase
     * que acaba en «tu rival dijo otra cosa».
     *
     * Y devolver null cuando el clic falla también importa: si se registrara igual
     * (sin soles, en enfriamiento, casilla ocupada) el rival plantaría algo que en
     * tu pantalla no existe.
     */
    (
      lane: number,
      col: number,
      cartaOverride?: PlantId,
      slotOverride?: number | null,
      seq?: number
    ): number | null => {
      const state = stateRef.current
      const card = cartaOverride ?? state.selectedCard
      const slotIdx = slotOverride !== undefined ? slotOverride : state.selectedSlotIndex

      if (!card || card === 'shovel' || state.status !== 'playing') return null
      // Durante la cuenta atrás no se planta: la partida no ha empezado y el
      // servidor rechazaría la acción por venir de un tic que su reloj todavía no
      // ha alcanzado.
      if (!haEmpezado()) return null

      let rolls: PlantStatKey[]
      let cardLevel: number

      if (mazoMioRef.current) {
        // ── EN 1C1, LAS MEJORAS SALEN DEL MAZO DE LA SALA ─────────────────────
        //
        // Y no del navegador. Es la única forma de que el rival plante la MISMA
        // planta: él no puede leer mi localStorage, pero los dos leemos el mazo que
        // guardó el servidor al emparejar.
        //
        // Antes esto salía de aquí abajo, de localStorage, y el rival ponía la
        // carta básica porque no le llegaba ninguna mejora. La misma planta tenía
        // 345 de vida en una pantalla y 300 en la otra desde el momento de
        // plantarla, y la partida acababa en «tu rival dijo otra cosa». Le pasaba a
        // cualquiera con una carta mejorada.
        const mejoras = mejorasDeLaCartaEnSlot(mazoMioRef.current, card, slotIdx)
        rolls = mejoras.statRolls
        cardLevel = mejoras.level
      } else {
        // En solitario y en prácticas: las del navegador, que es lo que hay y no
        // hay nadie con quien coincidir.
        rolls = getPlantRolls(card)
        cardLevel = 0

        try {
          const savedDeckInstIds = localStorage.getItem('plant_arena_active_deck_instances')
          const savedInstances = localStorage.getItem('plant_arena_plant_instances')
          const parsedDeckInstIds: string[] = savedDeckInstIds ? JSON.parse(savedDeckInstIds) : []
          const parsedInstances: any[] = savedInstances ? JSON.parse(savedInstances) : []

          if (slotIdx !== null && parsedDeckInstIds[slotIdx]) {
            const targetInstId = parsedDeckInstIds[slotIdx]
            const found = parsedInstances.find((i) => i.instanceId === targetInstId)
            if (found) {
              rolls = found.statRolls && found.statRolls.length > 0 ? found.statRolls : []
              cardLevel = found.level || 0
            }
          }
        } catch {}

        if (cardLevel > 0 && rolls.length === 0) {
          const eligible = getEligibleStatsForPlant(card)
          const mockRolls: PlantStatKey[] = []
          for (let i = 0; i < cardLevel; i++) {
            mockRolls.push(eligible[i % eligible.length])
          }
          rolls = mockRolls
        }
      }

      const config = getScaledPlantConfig(card, rolls)
      if (!config) return null

      if (state.sunBank < config.cost) return null

      // Los enfriamientos guardan el TIC en que expiran, no un instante de
      // reloj real: así se pueden reproducir.
      if (!state.isPracticeMode) {
        if (slotIdx !== null && (state.slotCooldowns[slotIdx] || 0) > state.tick) return null
        if (slotIdx === null && (state.cooldowns[card] || 0) > state.tick) return null
      }

      // Check cell occupancy for static plants
      const isWalkingUnit = config.category === 'melee' || !!config.moveSpeed || card === 'chomper'
      if (!isWalkingUnit) {
        const existing = state.plants.find((p) => p.lane === lane && p.col === col && !p.isWalking)
        if (existing) return null
      }

      // ── LO QUE SE PLANTA VA A LA COLA, NO AL CAMPO ─────────────────────────
      //
      // Aquí estaba el fallo que separaba las dos partidas.
      //
      // La planta se creaba EN ESTE TIC, y al servidor se mandaba con el tic
      // actual MÁS el margen de red. Así que en tu pantalla existía en el tic T y
      // en la del rival en el T+6: doscientos milisegundos de diferencia en cuándo
      // empieza a disparar, cuándo mata y cuándo pega a la base. Sobre tres
      // minutos, esa diferencia se multiplica hasta que cada uno está viendo otra
      // batalla — y al final los dos reportan ganadores distintos y la partida
      // queda en revisión sin repartir nada.
      //
      // La regla del 1c1 es que TODAS las jugadas entran con el mismo retardo, la
      // propia incluida. Se paga con 200 ms entre pulsar y ver la planta; es el
      // precio conocido de un lockstep y es lo que hace que las dos simulaciones
      // sean la misma.
      //
      // Fuera del 1c1 el retardo es cero y todo sigue igual que antes.
      const retardo = state.isPvpMode ? MARGEN_DE_RED_TICS : 0
      const enTic = state.tick + retardo

      const res = ejecutarCapturaPlantP1({
        isAsyncMatch: isAsyncMatchRef.current,
        card,
        slotIdx,
        lane,
        col,
        rolls,
        cardLevel,
        state,
        seq,
        enTic,
        historial: accionesP1AsyncRef.current,
        inconsistenciaActual: rankedAsyncInconsistencyRef.current?.reason ?? null,
      })

      if (!res.ok) {
        marcarInconsistenciaRanked({
          reason: res.reason,
          seq: res.seq,
          issuedTick: res.issuedTick,
          details: res.details,
        })
        forceRender()
        return null
      }

      if (res.duplicated) {
        forceRender()
        return null
      }

      // Al registro también, con las mejoras de la carta: si más tarde hay que
      // rehacer la partida porque una jugada del rival llegó tarde, ésta tiene que
      // volver a plantarse igual — misma casilla, mismo tic y mismas mejoras.
      if (state.isPvpMode) {
        apuntarJugadaPropia({
          tick: enTic,
          kind: 'plant',
          plantId: card,
          lane,
          col,
          statRolls: rolls,
          level: cardLevel,
        })
        costeDeMisJugadasRef.current.set(claveDeJugada(enTic, lane, col), {
          coste: config.cost,
          carta: card,
          slot: slotIdx,
        })
      }

      soundManager.playSound('plantation', 0.6)
      forceRender()
      return enTic
    },
    [forceRender, haEmpezado, apuntarJugadaPropia, marcarInconsistenciaRanked]
  )

  // Dig plant handler (removes plant by ID or by cell lane & column)
  /**
   * Encola la carta que plantó el rival para el tic en que le toca.
   *
   * No la planta ya: la mete en la cola de acciones aplazadas con SU tic. Los dos
   * clientes reciben la misma acción con el mismo tic, así que los dos la aplican
   * en el mismo momento de la partida y las dos simulaciones convergen — sin que
   * ninguno tenga que esperar al otro.
   *
   * Y SI LLEGA TARDE, SE APLICA EN SU TIC IGUALMENTE.
   *
   * Antes se aplicaba «en el tic siguiente», que era lo único que se sabía hacer,
   * y eso separaba las dos pantallas para siempre: se midió en una partida real,
   * la misma planta con 50 de vida en un lado y 75 en el otro — un guisante de
   * diferencia, porque un lanzaguisantes había empezado a disparar unos tics antes.
   *
   * Ahora se rehace la partida entera desde el tic 0 con la jugada en su sitio.
   * Ver rehacerLaPartida.
   */
  const encolarAccionDelRival = useCallback(
    (accion: {
      /**
       * El identificador del servidor, si se conoce.
       *
       * Se guarda en el registro para que las jugadas del mismo tic se ordenen
       * igual en las dos pantallas. Sin él vale el número de llegada.
       */
      id?: number
      tick: number
      /** 'plant' o 'dig'. Sin esto, una excavación del rival no se podía aplicar. */
      kind?: 'plant' | 'dig'
      plantId?: PlantId
      lane: number
      col?: number
      slot?: number | null
      // Las mejoras de la carta NO vienen aquí a propósito: se sacan del mazo de la
      // sala, que lo guardó el servidor y lo tenemos los dos. Si viajaran con la
      // jugada, cada navegador podría decir que su carta es del nivel que quiera.
    }) => {
      const state = stateRef.current
      if (state.status !== 'playing') return false
      if (accion.kind !== 'dig' && !accion.plantId) return

      // LAS MEJORAS DE SU CARTA SALEN DE SU MAZO EN LA SALA.
      //
      // La jugada sólo trae la carta y la casilla: las mejoras no viajan y no hace
      // falta que viajen, porque el mazo con el nivel y las mejoras de cada carta
      // lo guardó el servidor al emparejar y lo tenemos los dos.
      //
      // Antes no se ponían, así que su planta mejorada aparecía aquí como básica:
      // 300 de vida donde él veía 345, y las dos partidas eran distintas desde ese
      // momento. Ver engine/mazoDeLaSala.ts.
      const mejoras = accion.plantId
        ? mejorasDeLaCartaEnSlot(mazoDelRivalRef.current, accion.plantId, accion.slot)
        : null

      // Al registro siempre, con SU tic: llegue a tiempo o tarde, la partida se
      // tiene que poder rehacer con ella en el sitio correcto.
      numeroDeJugadaRef.current += 1
      registroRef.current.push({
        id: accion.id ?? numeroDeJugadaRef.current,
        mia: false,
        tick: accion.tick,
        kind: accion.kind === 'dig' ? 'dig' : 'plant',
        plantId: accion.plantId ?? null,
        lane: accion.lane,
        col: accion.col ?? null,
        statRolls: mejoras?.statRolls,
        level: mejoras?.level,
      })

      // TARDE: su tic ya pasó. No se aplica más tarde — se rehace la partida con
      // ella en su tic, y queda igual que si hubiera llegado a tiempo.
      //
      // Se apunta y lo hace el bucle en el fotograma siguiente, para que una ráfaga
      // de jugadas atrasadas cueste una sola reconstrucción y no una por cada una.
      if (accion.tick <= state.tick) {
        rehacerDesdeRef.current =
          rehacerDesdeRef.current === null
            ? accion.tick
            : Math.min(rehacerDesdeRef.current, accion.tick)
        return
      }

      // A tiempo: a la cola, para su tic.
      if (accion.kind === 'dig') {
        state.pending.push({
          atTick: accion.tick,
          kind: 'rival_dig',
          lane: accion.lane,
          col: accion.col ?? 0,
        })
        return
      }

      state.pending.push({
        atTick: accion.tick,
        kind: 'rival_plant',
        plantId: accion.plantId!,
        lane: accion.lane,
        col: accion.col,
        statRolls: mejoras?.statRolls,
        level: mejoras?.level,
      })
    },
    []
  )

  /**
   * Excava una planta propia. Devuelve la casilla excavada, o null.
   *
   * Devuelve la casilla porque en 1c1 hay que MANDARLA al servidor. Antes se
   * quitaba en local y no se registraba: la planta desaparecía en tu pantalla y
   * seguía disparando en la del rival, así que las dos partidas dejaban de ser la
   * misma en cuanto alguien usaba el pico.
   *
   * Viaja la CASILLA y no el identificador de la entidad: los identificadores del
   * rival son otros y no le sirven de nada.
   *
   * Y entra con el mismo retardo de red que plantar, por lo mismo: las dos
   * pantallas tienen que quitarla en el MISMO tic.
   */
  const digPlant = useCallback(
    (
      target: string | { lane: number; col: number },
      seq?: number
    ): { lane: number; col: number; tick: number; seq?: number } | null => {
      const state = stateRef.current
      let casilla: { lane: number; col: number } | null = null

      if (typeof target === 'string') {
        const p = state.plants.find((x) => x.id === target)
        if (p && p.col !== undefined && !p.isWalking) casilla = { lane: p.lane, col: p.col }
      } else {
        const colWidth = FIELD_WIDTH_PCT / TOTAL_COLUMNS
        const centro = BASE_LEFT_END_X + target.col * colWidth + colWidth / 2
        const p = state.plants.find(
          (x) =>
            x.lane === target.lane &&
            !x.isWalking &&
            (x.col === target.col || Math.abs(x.x - centro) < colWidth * 0.8)
        )
        if (p && p.col !== undefined) casilla = { lane: p.lane, col: p.col }
      }

      state.selectedCard = null

      if (!casilla) {
        forceRender()
        return null
      }

      const enTic = state.tick + (state.isPvpMode ? MARGEN_DE_RED_TICS : 0)

      const res = ejecutarCapturaDigP1({
        isAsyncMatch: isAsyncMatchRef.current,
        casilla,
        state,
        seq,
        enTic,
        historial: accionesP1AsyncRef.current,
        inconsistenciaActual: rankedAsyncInconsistencyRef.current?.reason ?? null,
      })

      if (!res.ok) {
        marcarInconsistenciaRanked({
          reason: res.reason,
          seq: res.seq,
          issuedTick: res.issuedTick,
          details: res.details,
        })
        forceRender()
        return null
      }

      if (res.duplicated) {
        forceRender()
        return null
      }

      if (state.isPvpMode) {
        apuntarJugadaPropia({ tick: enTic, kind: 'dig', lane: casilla.lane, col: casilla.col })
      }

      soundManager.playSound('plantation', 0.5)
      forceRender()
      return { ...casilla, tick: enTic, seq }
    },
    [forceRender, apuntarJugadaPropia, marcarInconsistenciaRanked]
  )

  /**
   * Deshace una jugada mía que el SERVIDOR rechazó.
   *
   * Puede pasar: llegó con un tic que su reloj ya había pasado, o venía repetida.
   * Si se quedara en mi pantalla, yo tendría una planta que en la del rival no
   * existe — la misma divergencia de siempre, sólo que empezando por mi lado.
   *
   * Se quita del registro y se rehace la partida sin ella: por el mismo camino que
   * una jugada tardía, porque es el mismo problema visto del revés.
   */
  const descartarAccionPropia = useCallback(
    (tick: number, lane: number, col: number | null, seq?: number) => {
      const resDescarte = ejecutarDescarteAccionP1({
        isAsyncMatch: isAsyncMatchRef.current,
        tick,
        lane,
        col,
        seq,
        historial: accionesP1AsyncRef.current,
        registro: registroRef.current,
        costeDeMisJugadas: costeDeMisJugadasRef.current,
        state: stateRef.current,
      })

      if (!resDescarte.ok) {
        marcarInconsistenciaRanked({
          reason: resDescarte.reason,
          seq,
          details: resDescarte.details,
        })
        return
      }

      accionesP1AsyncRef.current = resDescarte.nuevoHistorial
      registroRef.current = resDescarte.nuevoRegistro

      if (!resDescarte.eliminado) return

      // Por el mismo camino agrupado que una jugada tardía.
      rehacerDesdeRef.current =
        rehacerDesdeRef.current === null ? tick : Math.min(rehacerDesdeRef.current, tick)
      forceRender()
    },
    [forceRender, marcarInconsistenciaRanked]
  )

  // High performance game loop (60 FPS + Real-time background tab execution)
  useEffect(() => {
    let animationFrameId: number
    let bgIntervalId: ReturnType<typeof setInterval> | null = null

    /**
     * ACUMULADOR DE PASO FIJO
     *
     * Antes:
     *     let remainingDt = Math.min((now - lastTick) / 1000, 5.0)
     *     const dt = Math.min(remainingDt, stepDt)   ← el resto parcial
     *
     * El último paso de cada fotograma valía "lo que quedara", así que a 144 Hz
     * la simulación avanzaba en trozos distintos que a 30 Hz y las dos partidas
     * divergían. Era el primero de los tres motivos por los que el motor no era
     * determinista.
     *
     * Ahora sólo se ejecutan tics COMPLETOS de 33 ms y los milisegundos
     * sobrantes se arrastran al fotograma siguiente. El número de tics que
     * avanza la partida depende sólo del tiempo transcurrido, no de la cadencia
     * de fotogramas.
     */
    const tickEngine = (nowMs: number) => {
      // Si llegaron jugadas tarde, se rehace la partida AQUÍ y una sola vez.
      //
      // Se agrupan a propósito. Las jugadas atrasadas casi nunca llegan solas:
      // cuando la conexión del rival se atasca, la red de seguridad recupera un
      // puñado de golpe. Rehacer una vez por cada una serían varias
      // reconstrucciones seguidas —unos 100 ms cada una en un ordenador, tres o
      // cuatro veces eso en un móvil— y el juego daría un tirón bien visible.
      //
      // Rehecha desde la más antigua de todas, quedan todas en su sitio con un
      // solo viaje.
      if (rehacerDesdeRef.current !== null) {
        const desde = rehacerDesdeRef.current
        rehacerDesdeRef.current = null
        rehacerLaPartida(desde)
      }

      const state = stateRef.current
      if (state.status !== 'playing') return

      // Tope de 5 s como antes: si la pestaña estuvo en segundo plano, se
      // descartan los tics de más para no congelar la interfaz.
      //
      // OJO: descartar tics rompe la reproducibilidad. Una repetición o una
      // verificación en servidor NO usa este bucle: recorre todos los tics
      // seguidos, sin depender de fotogramas.
      let ticksToRun: number

      if (ancoraMsRef.current !== null) {
        // ── CON RELOJ COMÚN (partida contra otro jugador) ──────────────────────
        //
        // No se cuenta cuánto ha pasado desde el fotograma anterior: se calcula por
        // qué tic DEBERÍA ir la partida según el reloj, y se corre lo que falte.
        // Es la diferencia entre "yo llevo N tics" y "vamos por el tic N", y es lo
        // que mantiene a los dos jugadores en el mismo momento de la partida.
        //
        // De paso arregla dos cosas de gratis: no acumula desfase con el tiempo, y
        // quien vuelve de tener la pestaña en segundo plano se pone al día en lugar
        // de quedarse atrasado para siempre.
        const ticObjetivo = Math.floor((Date.now() - ancoraMsRef.current) / TICK_MS)
        ticksToRun = Math.max(0, ticObjetivo - state.tick)

        // Tope por fotograma para no congelar la pantalla si hay mucho que
        // recuperar. Lo que quede se recupera en los fotogramas siguientes, así
        // que no se pierde ningún tic — al contrario que antes, que los tiraba.
        ticksToRun = Math.min(ticksToRun, MAX_TICKS_PER_FRAME)
        lastFrameMsRef.current = nowMs
      } else {
        // ── SIN RELOJ COMÚN (en solitario) ────────────────────────────────────
        // Acumulador de paso fijo: sólo tics completos, y los milisegundos
        // sobrantes se arrastran al fotograma siguiente.
        const elapsedMs = Math.min(nowMs - lastFrameMsRef.current, MAX_TICKS_PER_FRAME * TICK_MS)
        lastFrameMsRef.current = nowMs
        accumulatorMsRef.current += elapsedMs
        ticksToRun = Math.floor(accumulatorMsRef.current / TICK_MS)
        accumulatorMsRef.current -= ticksToRun * TICK_MS
      }

      while (ticksToRun > 0) {
        ticksToRun -= 1
        if (asyncOpponentRef.current) {
          stepAsyncOpponent(asyncOpponentRef.current, state)
        }
        // Un tic entero de partida. Todo lo que era este bucle vive ahora en
        // engine/simulate.ts, sin React y sin navegador, para que el servidor y los
        // tests puedan ejecutarlo igual.
        stepTick(state, reproducirSonido)

        // La huella se toma AQUÍ, dentro del bucle, porque es el único sitio que
        // ve todos los tics. Comprobarlo fuera —después del fotograma— se salta
        // los controles cada vez que un fotograma avanza más de un tic, y eso pasa
        // constantemente. Medido en producción: «controles = 0», ni un solo tic con
        // huella de los dos, o sea el detector callado para siempre.
        if (soyP1Ref.current !== null && tocaHuella(state.tick)) {
          huellasPendientesRef.current.push({
            tick: state.tick,
            huella: huellaDeLaPartida(state, soyP1Ref.current),
          })
          // Tope por si nadie las recoge (una pestaña de fondo mucho rato): se
          // tiran las más viejas antes que crecer sin límite.
          if (huellasPendientesRef.current.length > 60) {
            huellasPendientesRef.current.splice(0, huellasPendientesRef.current.length - 60)
          }
        }
      }

      forceRender()
    } // End tickEngine

      const gameLoop = (now: number) => {
        tickEngine(now)
        if (!document.hidden) {
          animationFrameId = requestAnimationFrame(gameLoop)
        }
      }

      const handleVisibilityChange = () => {
        if (document.hidden) {
          if (!bgIntervalId) {
            bgIntervalId = setInterval(() => {
              tickEngine(performance.now())
            }, TICK_MS)
          }
        } else {
          if (bgIntervalId) {
            clearInterval(bgIntervalId)
            bgIntervalId = null
          }
          // Al volver de segundo plano se reancla el puente con el reloj real y
          // se vacía el acumulador, para que no entre de golpe todo el tiempo
          // que pasó oculta y aparezca una avalancha de enemigos.
          lastFrameMsRef.current = performance.now()
          accumulatorMsRef.current = 0
          // stateRef.current y no `state`: esta función se crea una sola vez, en el
          // primer render, cuando todavía no hay partida. `state` sería el objeto
          // de entonces, y startGame lo REEMPLAZA por uno nuevo — así que reanclar
          // ahí no tocaba la partida en curso y la avalancha entraba igual, que es
          // justo lo que esto pretende evitar.
          const actual = stateRef.current
          actual.timers.lastEnemySpawn = actual.tick
          actual.timers.lastP2PassiveSun = actual.tick
          actual.timers.lastSkySun = actual.tick
          actual.timers.waveStart = actual.tick
          animationFrameId = requestAnimationFrame(gameLoop)
        }
      }

      document.addEventListener('visibilitychange', handleVisibilityChange)

      lastFrameMsRef.current = performance.now()
      accumulatorMsRef.current = 0
      animationFrameId = requestAnimationFrame(gameLoop)

      return () => {
        document.removeEventListener('visibilitychange', handleVisibilityChange)
        if (animationFrameId) cancelAnimationFrame(animationFrameId)
        if (bgIntervalId) clearInterval(bgIntervalId)
      };
    }, [forceRender, reproducirSonido, rehacerLaPartida])

  const state = stateRef.current

  const surrenderGame = () => {
    stateRef.current.status = 'defeat'
    stateRef.current.p1BaseHp = 0
    soundManager.playSound('defeat', 0.7)
    forceRender()
  }

  /**
   * Termina la partida porque lo dice el SERVIDOR.
   *
   * Hace falta para el caso que faltaba: si el rival se rinde o pierde, tú te
   * quedabas jugando contra un campo vacío sin saber que ya habías ganado. El
   * resultado existía en la base y en su pantalla, pero no en la tuya.
   *
   * No toca la vida de las bases: el marcador que se enseña es el que dice el
   * servidor, no uno inventado aquí para que cuadre.
   */
  const terminarPorOrdenDelServidor = useCallback((resultado: 'victory' | 'defeat') => {
    const state = stateRef.current
    if (state.status !== 'playing') return
    state.status = resultado
    soundManager.playSound(resultado === 'victory' ? 'level_select' : 'defeat', 0.7)
    forceRender()
  }, [forceRender])

  return {
    /**
     * El tic actual. Lo necesita la interfaz para pintar cualquier cosa que
     * dependa de un plazo del juego: el velo de enfriamiento de las cartas, la
     * congelación de un enemigo.
     *
     * Antes esos plazos eran instantes de Date.now() y la interfaz los comparaba
     * con Date.now(). Al pasar el motor a tics, esas comparaciones quedaron
     * mirando un tic contra un reloj de 1,7 billones: siempre falsas. El
     * enfriamiento seguía funcionando en el motor, pero el jugador no lo veía.
     */
    tick: state.tick,
    /**
     * Cuántos tics de retraso llevo respecto al reloj común de la partida.
     *
     * Es la medida del "uno va más rápido que el otro". El reloj común dice por
     * qué tic DEBERÍA ir la partida; esto es la diferencia con el tic al que va de
     * verdad. Cerca de cero significa que las dos pantallas están en el mismo
     * momento y que los soles caen a la vez en las dos.
     *
     * Nulo en las partidas sin reloj común (entrenamiento y práctica).
     */
    desfaseDeTics:
      ancoraMsRef.current === null
        ? null
        : Math.floor((Date.now() - ancoraMsRef.current) / TICK_MS) - state.tick,
    gameStatus: state.status,
    isPracticeMode: !!state.isPracticeMode,
    isMuted,
    toggleMute,
    p1BaseHp: state.p1BaseHp,
    p2BaseHp: state.p2BaseHp,
    sunBank: state.sunBank,
    p2SunBank: state.p2SunBank,
    plants: state.plants,
    enemyPlants: state.enemyPlants,
    projectiles: state.projectiles,
    suns: state.suns,
    selectedCard: state.selectedCard,
    selectedSlotIndex: state.selectedSlotIndex,
    setSelectedCard,
    cooldowns: state.cooldowns,
    slotCooldowns: state.slotCooldowns,
    wave: state.wave,
    waveBanner: state.waveBanner,
    stats: state.stats,
    startGame,
    startPracticeGame,
    surrenderGame,
    prepararRecogidaSol,
    confirmarRecogidaSol,
    collectSun,
    placePlant,
    digPlant,
    encolarAccionDelRival,
    terminarPorOrdenDelServidor,
    /**
     * Recoge las huellas tomadas y las quita de la cola.
     *
     * Se devuelven para que las mande quien pinta: el bucle del juego no debe
     * hacer llamadas de red. Y se vacían al recogerlas para no mandar dos veces la
     * misma.
     */
    tomarHuellasPendientes: (): HuellaEnUnTic[] => {
      if (huellasPendientesRef.current.length === 0) return []

      // ── POR QUÉ SALEN CON RETRASO ──────────────────────────────────────────
      //
      // Una jugada que llega tarde llega DESPUÉS de haber tomado la huella del
      // tic anterior, así que esa huella se calculó sin ella. Rehacer la partida
      // la corrige, pero si ya se hubiera mandado no habría nada que corregir: el
      // servidor no deja reescribir una huella, a propósito.
      //
      // Así que la huella espera unos segundos antes de salir. Es tiempo de sobra
      // para que llegue cualquier jugada retrasada —incluso por la red de
      // seguridad, que repasa cada 3 s— y se rehaga la partida antes.
      //
      // Lo único que se paga es enterarse de una separación de verdad cuatro
      // segundos más tarde, y eso da igual: es un diagnóstico, no el árbitro.
      // Con la partida acabada salen todas: ya no va a llegar nada tarde, y si no
      // se sueltan aquí se perderían los últimos controles de cada partida.
      const acabada = stateRef.current.status !== 'playing'
      const tope = acabada ? Infinity : stateRef.current.tick - RETRASO_DE_HUELLA_TICS
      const salen = huellasPendientesRef.current.filter((h) => h.tick <= tope)
      if (salen.length === 0) return []
      huellasPendientesRef.current = huellasPendientesRef.current.filter((h) => h.tick > tope)
      return salen
    },
    /**
     * Cuántas veces se ha rehecho la partida por una jugada que llegó tarde.
     *
     * Va al panel de diagnóstico. Es la medida de cuánto retraso hay de verdad en
     * las partidas de la gente: si sube mucho, el margen de red se queda corto.
     */
    reconstrucciones: reconstruccionesRef.current,
    descartarAccionPropia,
    incorporarIntencionesAsync,
    rankedAsyncInconsistency,
    getRankedAsyncInconsistency: () => rankedAsyncInconsistencyRef.current,
  }
}
