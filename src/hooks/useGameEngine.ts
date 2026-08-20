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
import { createRng, entityId } from '../engine/rng'
import { TICK_MS, MAX_TICKS_PER_FRAME, msToTicks } from '../engine/time'
import { stepTick, createBattleState, type GameState } from '../engine/simulate'
import type {
  PlantEntity,
  PlantId,
} from '../types/game'
import {
  PLANT_CONFIGS,
  INITIAL_SUN,
  INITIAL_BASE_HP,
  SUN_VALUE,
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
  const startGame = useCallback((seed: number = 1, esPvp: boolean = false, ancoraMs?: number) => {
    stateRef.current = createBattleState(seed, false, esPvp)

    ancoraMsRef.current = ancoraMs ?? null
    lastFrameMsRef.current = performance.now()
    accumulatorMsRef.current = 0

    soundManager.playBgm('battle')
    forceRender()
  }, [forceRender])

  // Start practice / sandbox mode
  const startPracticeGame = useCallback((plantId?: string) => {
    // En prácticas no hay rival, así que no hay reloj que compartir.
    ancoraMsRef.current = null
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

  // Collect sun handler
  const collectSun = useCallback(
    (sunId: string) => {
      const state = stateRef.current
      state.suns = state.suns.filter((s) => s.id !== sunId)
      state.sunBank += SUN_VALUE
      state.stats.sunsCollected += 1
      state.stats.score += 50

      soundManager.playSound('points', 0.6)
      forceRender()
    },
    [forceRender]
  )

  // Place plant handler
  const placePlant = useCallback(
    /**
     * Intenta plantar. Devuelve si lo consiguió.
     *
     * Importa porque en PvP la acción sólo se registra en el servidor si aquí SÍ
     * se plantó. Antes devolvía void y el cliente la registraba igual, así que si
     * el clic fallaba (sin soles, en enfriamiento, casilla ocupada) el rival
     * plantaba algo que en tu pantalla no existía: las dos partidas se separaban
     * en el momento.
     */
    (lane: number, col: number): boolean => {
      const state = stateRef.current
      let plantoBien = false
      const card = state.selectedCard
      const slotIdx = state.selectedSlotIndex

      if (!card || card === 'shovel' || state.status !== 'playing') return false

      let rolls: PlantStatKey[] = getPlantRolls(card)
      let cardLevel = 0
      let instanceId: string | undefined = undefined

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
            instanceId = found.instanceId
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

      const config = getScaledPlantConfig(card, rolls)
      if (!config) return false

      if (state.sunBank < config.cost) return false

      // Los enfriamientos guardan el TIC en que expiran, no un instante de
      // reloj real: así se pueden reproducir.
      if (!state.isPracticeMode) {
        if (slotIdx !== null && (state.slotCooldowns[slotIdx] || 0) > state.tick) return false
        if (slotIdx === null && (state.cooldowns[card] || 0) > state.tick) return false
      }

      const colWidth = FIELD_WIDTH_PCT / TOTAL_COLUMNS
      const cellCenterX = BASE_LEFT_END_X + col * colWidth + colWidth / 2

      // Check cell occupancy for static plants
      const isWalkingUnit = config.category === 'melee' || !!config.moveSpeed || card === 'chomper'
      if (!isWalkingUnit) {
        const existing = state.plants.find((p) => p.lane === lane && p.col === col && !p.isWalking)
        if (existing) return false
      }

      // Jalapeño Instant Lane-Clearing Explosion!
      if (card === 'jalapeno') {
        state.sunBank -= config.cost
        if (slotIdx !== null) {
          state.slotCooldowns[slotIdx] = state.tick + msToTicks(config.cooldownMs)
        } else {
          state.cooldowns[card] = state.tick + msToTicks(config.cooldownMs)
        }
        state.stats.plantsPlaced += 1
        state.selectedCard = null
        state.selectedSlotIndex = null

        soundManager.playSound('pea_hit', 1.0)

        // Inflict 1000 damage to ALL enemies in this lane
        const laneEnemies = state.enemyPlants.filter((e) => e.lane === lane && e.hp > 0)
        laneEnemies.forEach((e) => {
          e.hp -= 1000
          if (e.hp <= 0) {
            state.stats.enemyPlantsDefeated += 1
            state.stats.score += 100
          }
        })

        // Temporary full-lane flame visual explosion wave that disappears after 1200ms
        const tempFlame: PlantEntity = {
          id: entityId('jalapeno-flame', state.tick, state.entityCounter++),
          plantId: 'jalapeno',
          instanceId,
          level: cardLevel,
          statRolls: rolls,
          lane,
          col,
          x: 50, // Center of lane for full-width flame wave
          hp: 1,
          maxHp: 1,
          lastActionTime: state.tick,
          isWalking: false,
          state: 'attacking',
          spriteOverride: '/game-assets/plants/jalapeno_flame_fx.png'
        }
        state.plants.push(tempFlame)
        // La llama se apaga a los 1,2 s, contados en tics.
        state.pending.push({
          atTick: state.tick + msToTicks(1200),
          kind: 'remove_plant',
          plantId: tempFlame.id,
        })

        forceRender()
        // El jalapeño SÍ se plantó: sale por aquí porque su efecto es inmediato y
        // no deja planta permanente. Devolver false lo habría dejado fuera del
        // registro y el rival no vería la llamarada.
        return true
      }

      const newPlant: PlantEntity = {
        id: entityId('plant', state.tick, state.entityCounter++),
        plantId: card,
        instanceId,
        level: cardLevel,
        // Las mejoras se congelan aquí, al plantar. El bucle ya no las relee.
        statRolls: rolls,
        damage: config.damage,
        attackSpeedMs: config.attackSpeedMs,
        moveSpeed: config.moveSpeed,
        lane,
        col,
        x: cellCenterX,
        hp: config.maxHp,
        maxHp: config.maxHp,
        lastActionTime: state.tick,
        isWalking: isWalkingUnit,
        state: isWalkingUnit ? 'walking' : 'idle',
      }

      state.plants.push(newPlant)
      state.sunBank -= config.cost
      if (slotIdx !== null) {
        state.slotCooldowns[slotIdx] = state.tick + msToTicks(config.cooldownMs)
      } else {
        state.cooldowns[card] = state.tick + msToTicks(config.cooldownMs)
      }
      state.stats.plantsPlaced += 1
      state.selectedCard = null
      state.selectedSlotIndex = null
      plantoBien = true

      soundManager.playSound('plantation', 0.6)
      forceRender()
      return plantoBien
    },
    [forceRender]
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
   * Si llega tarde (su tic ya pasó), se aplica en el siguiente tic. Las dos
   * pantallas se separan un poco, y eso es aceptable a propósito: quien decide el
   * resultado es el servidor recalculando la partida desde el registro, no lo que
   * vio un navegador.
   */
  const encolarAccionDelRival = useCallback(
    (accion: {
      tick: number
      plantId: PlantId
      lane: number
      col?: number
      statRolls?: PlantStatKey[]
      level?: number
    }) => {
      const state = stateRef.current
      if (state.status !== 'playing') return false
      state.pending.push({
        // Nunca en el pasado: si llegó tarde, en el tic siguiente.
        atTick: Math.max(state.tick + 1, accion.tick),
        kind: 'rival_plant',
        plantId: accion.plantId,
        lane: accion.lane,
        col: accion.col,
        statRolls: accion.statRolls,
        level: accion.level,
      })
    },
    []
  )

  const digPlant = useCallback(
    (target: string | { lane: number; col: number }) => {
      const state = stateRef.current
      if (typeof target === 'string') {
        state.plants = state.plants.filter((p) => p.id !== target)
      } else {
        const colWidth = FIELD_WIDTH_PCT / TOTAL_COLUMNS
        const cellCenterX = BASE_LEFT_END_X + target.col * colWidth + colWidth / 2

        const plantToDig = state.plants.find(
          (p) =>
            p.lane === target.lane &&
            (p.col === target.col || Math.abs(p.x - cellCenterX) < colWidth * 0.8)
        )
        if (plantToDig) {
          state.plants = state.plants.filter((p) => p.id !== plantToDig.id)
        }
      }
      state.selectedCard = null
      soundManager.playSound('plantation', 0.5)
      forceRender()
    },
    [forceRender]
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
        // Un tic entero de partida. Todo lo que era este bucle vive ahora en
        // engine/simulate.ts, sin React y sin navegador, para que el servidor y los
        // tests puedan ejecutarlo igual.
        stepTick(state, reproducirSonido)
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
          if (animationFrameId) cancelAnimationFrame(animationFrameId)
          if (bgIntervalId) {
            clearInterval(bgIntervalId)
            bgIntervalId = null
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
    }, [forceRender, reproducirSonido])

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
    collectSun,
    placePlant,
    digPlant,
    encolarAccionDelRival,
    terminarPorOrdenDelServidor,
  }
}
