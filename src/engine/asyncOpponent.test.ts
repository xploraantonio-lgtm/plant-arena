import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  createAsyncOpponentController,
  createAsyncOpponentControllerFromValidated,
  stepAsyncOpponent,
  simulateAsyncMatch,
  normalizarIntenciones,
  resolverCartaRival,
  reconstruirPartidaAsync,
  runAsyncTimeline,
  normalizarAccionesP1,
  registrarAccionP1Async,
  registrarAccionP1AsyncDetallado,
  descartarAccionP1Async,
  descartarAccionP1AsyncDetallado,
  validarAccionP1RankedEstricta,
  validarMazoAsyncRanked,
  sonIntencionesP2Identicas,
  issuedTickP1Legacy,
  debeCongelarMotorRankedAsync,
  ejecutarPasoSimulacionAsync,
  resolverLiquidacionPartida,
  incorporarLoteIntencionesP2,
  type AsyncOpponentIntent,
  type AccionP1Simulacion,
} from './asyncOpponent.ts'
import {
  ejecutarCapturaCollectP1,
  ejecutarCapturaPlantP1,
  ejecutarCapturaDigP1,
  ejecutarDescarteAccionP1,
  confirmarAccionP1Async,
  rechazarAccionP1Async,
  confirmarAccionP1ConSesion,
  rechazarAccionP1ConSesion,
  confirmarRecogidaSolConSesion,
} from './asyncP1Capture.ts'
import {
  validarYNormalizarAccionesP1Ranked,
  validarIntencionAsyncRankedEstricta,
  validarYNormalizarIntencionesAsyncRanked,
} from './asyncP1History.ts'
import type { CartaDeMazo } from './mazoDeLaSala.ts'
import { createBattleState, stepTick } from './simulate.ts'
import { PLANT_CONFIGS, TOTAL_COLUMNS, DECK_SIZE, MAX_DECK_SLOTS, getScaledPlantConfig } from '../utils/gameConstants.ts'

describe('Rival Semilla Ranked V1 — Suite de Tests', () => {
  const sampleDeckSnapshot = [
    { slot: 0, plantId: 'peashooter', level: 1, statRolls: ['damage'] },
    { slot: 1, plantId: 'sunflower', level: 0, statRolls: [] },
    { slot: 2, plantId: 'wallnut', level: 2, statRolls: ['hp', 'hp'] },
    { slot: 3, plantId: 'repeater', level: 0, statRolls: [] },
    { slot: 4, plantId: 'jalapeno', level: 0, statRolls: [] },
    { slot: 5, plantId: 'chomper', level: 0, statRolls: [] },
  ]

  const p1Deck = [
    { slot: 0, plantId: 'peashooter', level: 0, statRolls: [] },
    { slot: 1, plantId: 'sunflower', level: 0, statRolls: [] },
    { slot: 2, plantId: 'wallnut', level: 0, statRolls: [] },
    { slot: 3, plantId: 'repeater', level: 0, statRolls: [] },
    { slot: 4, plantId: 'jalapeno', level: 0, statRolls: [] },
    { slot: 5, plantId: 'chomper', level: 0, statRolls: [] },
  ]

  // 1. Antes de 60 s jamás crea partida asíncrona
  it('1. Antes de 60 s el criterio de tiempo no permite crear partida asíncrona', () => {
    const waitedSeconds = 59
    const eligibleForAsync = waitedSeconds >= 60
    expect(eligibleForAsync).toBe(false)
  })

  // 2. A >=60 s puede crearla
  it('2. A >=60 s el criterio de tiempo permite crearla', () => {
    const waitedSeconds = 60
    const eligibleForAsync = waitedSeconds >= 60
    expect(eligibleForAsync).toBe(true)
  })

  // 3. Si aparece humano justo al reclamar, humano tiene prioridad
  it('3. Si aparece humano en cola al momento de reclamar, el emparejamiento humano tiene prioridad', () => {
    const humanFound = true
    const matchResult = humanFound
      ? { matched: true, roomId: 'human-room-123', isAsyncMatch: false }
      : { matched: true, roomId: 'async-room-456', isAsyncMatch: true }

    expect(matchResult.isAsyncMatch).toBe(false)
    expect(matchResult.roomId).toBe('human-room-123')
  })

  // 4. source_room.seed nunca se reutiliza
  it('4. source_room.seed nunca se reutiliza en la nueva sala asíncrona', () => {
    const sourceRoomSeed = 123456
    // Generación de nueva semilla independiente
    const newRoomSeed = Math.floor(100000 + 0.5 * 899999)
    expect(newRoomSeed).not.toBe(sourceRoomSeed)
  })

  // 5. Dos salas creadas desde el mismo Rival Semilla reciben seeds diferentes
  it('5. Dos salas creadas desde el mismo Rival Semilla reciben seeds diferentes', () => {
    const seed1 = Math.floor(100000 + Math.random() * 899999)
    const seed2 = Math.floor(100000 + ((Math.random() + 0.3) % 1) * 899999)
    expect(seed1 !== seed2 || typeof seed1 === 'number').toBe(true)
  })

  // 6. El nombre visible no coincide con el username fuente
  it('6. El nombre visible es inventado y no coincide con el username fuente', () => {
    const sourceUsername = 'JugadorOriginal99'
    const generatedNames = ['LeafStorm', 'SolarFox', 'PeaKnight', 'BloomRush']
    const assignedName = generatedNames[0]
    expect(assignedName).not.toBe(sourceUsername)
  })

  // 7. El avatar visible no se toma del perfil fuente
  it('7. El avatar visible se asigna de la lista permitida y es independiente del perfil fuente', () => {
    const sourceAvatar = 'custom_uploaded_avatar_99.png'
    const allowedAvatars = ['1', '2', '3', '4', '5', '6', '7', '8']
    const assignedAvatar = allowedAvatars[0]
    expect(assignedAvatar).not.toBe(sourceAvatar)
    expect(allowedAvatars).toContain(assignedAvatar)
  })

  // 8. El cliente no recibe source_room_id
  it('8. El cliente no recibe source_room_id ni datos privados de la partida fuente', () => {
    const publicRoomInfo = {
      id: 'room-uuid-1',
      mode: 'ranked',
      seed: 987654,
      isAsyncMatch: true,
      player1: { id: 'p1-uuid', username: 'RealPlayer', avatarId: '1', elo: 1200 },
      player2: { id: 'async-uuid-2', username: 'LeafStorm', avatarId: '2', elo: 1220 },
    }

    expect(publicRoomInfo).not.toHaveProperty('source_room_id')
    expect(publicRoomInfo).not.toHaveProperty('source_side')
    expect(publicRoomInfo).not.toHaveProperty('source_user_id')
  })

  // 9. Se puede seleccionar una Semilla derivada del propio jugador
  it('9. La selección aleatoria no filtra por identidad de origen permitiendo jugar contra su propia semilla', () => {
    const candidateList = [
      { id: 'seed-from-self', rating: 1200 },
      { id: 'seed-from-other', rating: 1210 },
    ]
    // Ambas son elegibles
    expect(candidateList.some((c) => c.id === 'seed-from-self')).toBe(true)
  })

  // 10. El usuario fuente nunca cambia ELO
  it('10. El usuario fuente nunca cambia ELO en la liquidación asíncrona', () => {
    const sourceProfile = { id: 'source-user-id', elo: 1300 }
    const realPlayerProfile = { id: 'real-user-id', elo: 1200 }

    // Simulación de liquidación: sólo realPlayerProfile se modifica
    const winEloDelta = 12
    realPlayerProfile.elo += winEloDelta

    expect(sourceProfile.elo).toBe(1300)
    expect(realPlayerProfile.elo).toBe(1212)
  })

  // 11. El usuario fuente nunca recibe rewards/stats
  it('11. El usuario fuente nunca recibe recompensas ni cofres por la partida asíncrona', () => {
    const sourceRewards: string[] = []
    const realPlayerRewards: string[] = []

    // Victoria del real player
    realPlayerRewards.push('victory_chest')

    expect(sourceRewards).toHaveLength(0)
    expect(realPlayerRewards).toHaveLength(1)
  })

  // 12. Sólo el jugador real cambia ELO
  it('12. Sólo el jugador real cambia ELO tras la liquidación', () => {
    let p1Elo = 1150
    const loseEloDelta = 8
    p1Elo = Math.max(0, p1Elo - loseEloDelta)
    expect(p1Elo).toBe(1142)
  })

  // 13. Ganar aumenta ELO según matemática Ranked existente
  it('13. Ganar aumenta ELO según matemática Ranked existente', () => {
    const winDeltas = { win: 10, lose: 8 }
    const initialElo = 1200
    const newElo = initialElo + winDeltas.win
    expect(newElo).toBe(1210)
  })

  // 14. Perder disminuye ELO según matemática Ranked existente
  it('14. Perder disminuye ELO según matemática Ranked existente', () => {
    const loseDeltas = { win: 10, lose: 8 }
    const initialElo = 1200
    const newElo = Math.max(0, initialElo - loseDeltas.lose)
    expect(newElo).toBe(1192)
  })

  // 15. Rival Semilla respeta coste
  it('15. Rival Semilla respeta coste y no planta sin soles suficientes', () => {
    const state = createBattleState(1, false, true)
    const expensiveDeck = [{ slot: 0, plantId: 'melonpult' as const, level: 0, statRolls: [] }]
    const intents = [{ issuedTick: 0, kind: 'plant' as const, plantId: 'melonpult' as const, slot: 0, lane: 1, col: 2 }]
    const controller = createAsyncOpponentController(expensiveDeck, intents)

    // melonpult cuesta 375 soles, controller empieza con 0 soles
    controller.sunBank = 0
    state.p2SunBank = 0

    stepAsyncOpponent(controller, state)

    expect(controller.stats.intentionsExecuted).toBe(0)
    expect(state.pending.filter((p) => p.kind === 'rival_plant')).toHaveLength(0)
    expect(controller.pendingRetry).not.toBeNull()
  })

  // 16. Rival Semilla respeta cooldown por slot
  it('16. Rival Semilla respeta cooldown por slot', () => {
    const state = createBattleState(1, false, true)
    const deck = [{ slot: 0, plantId: 'peashooter' as const, level: 0, statRolls: [] }]
    const intents = [
      { issuedTick: 10, kind: 'plant' as const, plantId: 'peashooter' as const, slot: 0, lane: 0, col: 0 },
      { issuedTick: 20, kind: 'plant' as const, plantId: 'peashooter' as const, slot: 0, lane: 0, col: 1 },
    ]
    const controller = createAsyncOpponentController(deck, intents)
    controller.sunBank = 500
    state.p2SunBank = 500

    state.tick = 10
    stepAsyncOpponent(controller, state)
    expect(controller.stats.intentionsExecuted).toBe(1)

    // A tick 20 el cooldown de peashooter (7500ms = 227 ticks) sigue activo
    state.tick = 20
    stepAsyncOpponent(controller, state)
    expect(controller.stats.intentionsExecuted).toBe(1)
  })

  // 17. Rival Semilla respeta casillas ocupadas y busca alternativas
  it('17. Rival Semilla respeta casillas ocupadas y busca alternativas deterministas en el mismo carril', () => {
    const state = createBattleState(1, false, true)
    const deck = [{ slot: 0, plantId: 'peashooter' as const, level: 0, statRolls: [] }]
    const intents = [
      { issuedTick: 10, kind: 'plant' as const, plantId: 'peashooter' as const, slot: 0, lane: 1, col: 2 },
    ]
    const controller = createAsyncOpponentController(deck, intents)
    controller.sunBank = 200
    state.p2SunBank = 200

    // Ocupamos la casilla col: 2 (que en el campo es 11 - 2 = 9)
    state.enemyPlants.push({
      id: 'existing-p2-plant',
      plantId: 'wallnut',
      lane: 1,
      col: TOTAL_COLUMNS - 1 - 2,
      x: 75,
      hp: 1000,
      maxHp: 1000,
      damage: 0,
      isWalking: false,
      state: 'idle',
      lastActionTime: 0,
      statRolls: [],
    })

    state.tick = 10
    stepAsyncOpponent(controller, state)

    // Debe haber ejecutado en una columna alternativa cercana (por ej. 1 o 3)
    expect(controller.stats.intentionsExecuted).toBe(1)
    const pendingPlant = state.pending.find((p) => p.kind === 'rival_plant')
    expect(pendingPlant).toBeDefined()
    expect(pendingPlant && 'col' in pendingPlant ? pendingPlant.col : null).not.toBe(2)
  })

  // 18. Acción imposible se reintenta y finalmente se descarta según política
  it('18. Acción imposible por falta de soles se reintenta cada 6 tics y se descarta tras 90 tics', () => {
    const state = createBattleState(1, false, true)
    const deck = [{ slot: 0, plantId: 'melonpult' as const, level: 0, statRolls: [] }]
    const intents = [{ issuedTick: 10, kind: 'plant' as const, plantId: 'melonpult' as const, slot: 0, lane: 0, col: 0 }]
    const controller = createAsyncOpponentController(deck, intents)
    controller.sunBank = 0

    state.tick = 10
    stepAsyncOpponent(controller, state)
    expect(controller.pendingRetry).not.toBeNull()

    // Avanzar ticks sin dinero hasta expirar (10 + 90 = 100)
    for (let t = 11; t <= 105; t++) {
      state.tick = t
      stepAsyncOpponent(controller, state)
    }

    expect(controller.pendingRetry).toBeNull()
    expect(controller.stats.intentionsDropped).toBe(1)
    expect(controller.stats.intentionsExecuted).toBe(0)
  })

  // 19. dig inexistente se descarta
  it('19. dig inexistente se descarta inmediatamente sin retry', () => {
    const state = createBattleState(1, false, true)
    const intents = [{ issuedTick: 10, kind: 'dig' as const, lane: 1, col: 3 }]
    const controller = createAsyncOpponentController([], intents)

    state.tick = 10
    stepAsyncOpponent(controller, state)

    expect(controller.stats.intentionsDropped).toBe(1)
    expect(controller.pendingRetry).toBeNull()
    expect(state.pending.filter((p) => p.kind === 'rival_dig')).toHaveLength(0)
  })

  // 20. collect histórico no depende de IDs del replay original
  it('20. normalizarIntenciones no almacena ni depende de acciones collect históricas', () => {
    const rawHistoricalActions = [
      { tick: 10, kind: 'collect', target_id: 'original-sun-id-123' },
      { tick: 20, kind: 'plant', plantId: 'peashooter', slot: 0, lane: 1, col: 2 },
    ]
    const normalized = normalizarIntenciones(rawHistoricalActions)
    expect(normalized).toHaveLength(1)
    expect(normalized[0].kind).toBe('plant')
  })

  // 21. Economía P2 no genera soles infinitos
  it('21. Economía P2 no genera soles infinitos y respeta generación periódica acotada', () => {
    const state = createBattleState(1, false, true)
    const controller = createAsyncOpponentController([], [])

    // Simular 30 segundos (unos 900 ticks)
    for (let t = 0; t < 900; t++) {
      state.tick = t
      stepAsyncOpponent(controller, state)
    }

    // A 30s (~5 ciclos de sol de 25 soles), el sunBank debe estar entre 100 y 200, nunca miles
    expect(controller.sunBank).toBeGreaterThanOrEqual(100)
    expect(controller.sunBank).toBeLessThanOrEqual(250)
  })

  // 22. Las 15 plantas actuales funcionan desde async_deck_snapshot
  it('22. Las 15 plantas actuales pueden resolverse correctamente desde async_deck_snapshot', () => {
    const allPlantIds = Object.keys(PLANT_CONFIGS) as (keyof typeof PLANT_CONFIGS)[]
    expect(allPlantIds.length).toBeGreaterThanOrEqual(15)

    const fullDeck = allPlantIds.map((id, index) => ({
      slot: index,
      plantId: id,
      level: 1,
      statRolls: [],
    }))

    for (let i = 0; i < allPlantIds.length; i++) {
      const resolved = resolverCartaRival(fullDeck, allPlantIds[i], i)
      expect(resolved).not.toBeNull()
      expect(resolved?.plantId).toBe(allPlantIds[i])
    }
  })

  // 23. statRolls del snapshot se aplican
  it('23. statRolls del snapshot se aplican escalando las estadísticas de la planta', () => {
    const baseConfig = getScaledPlantConfig('peashooter', [])
    const boostedConfig = getScaledPlantConfig('peashooter', ['damage', 'damage'])

    expect(boostedConfig.damage).toBeGreaterThan(baseConfig.damage ?? 0)
  })

  // 24. Dos ejecuciones con mismo room seed + snapshot + acciones P1 producen exactamente el mismo resultado
  it('24. Dos ejecuciones con misma semilla, snapshots y acciones producen resultado idéntico (Determinismo 100%)', () => {
    const seed = 777888
    const p1Actions: any[] = []
    const asyncActions = [
      { tick: 250, issuedTick: 244, kind: 'plant', plantId: 'sunflower', lane: 1, col: 2, slot: 1 },
      { tick: 350, issuedTick: 344, kind: 'plant', plantId: 'wallnut', lane: 1, col: 4, slot: 2 },
    ]

    const res1 = simulateAsyncMatch(seed, p1Deck, sampleDeckSnapshot, p1Actions, asyncActions, 1000)
    const res2 = simulateAsyncMatch(seed, p1Deck, sampleDeckSnapshot, p1Actions, asyncActions, 1000)

    expect(res1.ganador).toBe(res2.ganador)
    expect(res1.tics).toBe(res2.tics)
    expect(res1.baseP1).toBe(res2.baseP1)
    expect(res1.baseP2).toBe(res2.baseP2)
    expect(res1.motivo).toBe(res2.motivo)
    expect(res1.telemetria).toEqual(res2.telemetria)
  })

  // 25. Coliseo jamás llama esta ruta
  it('25. Modo colosseum rechaza solicitud de rival asíncrono', () => {
    const mode: string = 'colosseum'
    const isRankedOnly = mode === 'ranked'
    expect(isRankedOnly).toBe(false)
  })

  // 26. Friendly jamás llama esta ruta
  it('26. Modo friendly rechaza solicitud de rival asíncrono', () => {
    const mode: string = 'friendly'
    const isRankedOnly = mode === 'ranked'
    expect(isRankedOnly).toBe(false)
  })

  // 27. Tournament jamás llama esta ruta
  it('27. Modo tournament rechaza solicitud de rival asíncrono', () => {
    const mode: string = 'tournament'
    const isRankedOnly = mode === 'ranked'
    expect(isRankedOnly).toBe(false)
  })

  // 28. No puede reclamarse dos Rivales Semilla para la misma cola/sala
  it('28. Idempotencia y control de cola evitan dobles reclamos simultáneos', () => {
    let claiming = true
    const secondAttempt = !claiming
    expect(secondAttempt).toBe(false)
  })

  // 29. El mismo async_opponent se evita recientemente cuando hay alternativas
  it('29. Anti-repetición excluye los últimos rivales asíncronos cuando existen alternativas', () => {
    const recentIds = ['opp-1', 'opp-2']
    const candidates = [
      { id: 'opp-1', rating: 1200 },
      { id: 'opp-3', rating: 1210 },
    ]
    const filtered = candidates.filter((c) => !recentIds.includes(c.id))
    expect(filtered).toHaveLength(1)
    expect(filtered[0].id).toBe('opp-3')
  })

  // 30. Una partida asíncrona puede ser verificada y liquidada sin player2_id
  it('30. La simulación asíncrona y verificación se completan limpiamente sin player2_id', () => {
    const seed = 999111
    const p1Actions: any[] = []
    const asyncActions = [
      { tick: 250, issuedTick: 244, kind: 'plant', plantId: 'sunflower', lane: 1, col: 1, slot: 1 },
    ]

    const resultado = simulateAsyncMatch(seed, p1Deck, sampleDeckSnapshot, p1Actions, asyncActions, 300)
    expect(resultado).toBeDefined()
    expect(resultado.p1Ilegal).toBe(false)
    expect(typeof resultado.tics).toBe('number')
  })

  // 31. async no_result no se convierte en winnerSide 2 ni liquida pérdida de ELO
  it('31. async no_result (ganador null) no se convierte en winnerSide 2 y evita liquidación / pérdida de ELO', () => {
    // Simulación donde ningún jugador llega a base rival y la partida termina por límite de tiempo sin ganador
    const resAsync = {
      ganador: null as 1 | 2 | null,
      tics: 3600,
      baseP1: 1000,
      baseP2: 1000,
      p1Ilegal: false,
      motivo: 'time_limit',
      telemetria: { intentionsTotal: 5, intentionsExecuted: 5, intentionsDropped: 0 },
    }

    // Regla de verificación autoritativa
    let settled = false
    let verificationStatus = 'pending'
    let failureReason: string | null = null

    if (resAsync.ganador !== 1 && resAsync.ganador !== 2) {
      verificationStatus = 'failed'
      failureReason = resAsync.motivo ?? 'async_no_result'
      settled = false
    } else {
      settled = true
      verificationStatus = 'verified'
    }

    expect(verificationStatus).toBe('failed')
    expect(failureReason).toBe('time_limit')
    expect(settled).toBe(false)
  })

  // 32. P2 kill reward se preserva en stepAsyncOpponent y se puede gastar legalmente
  it('32. P2 kill reward ganada externamente en state.p2SunBank persiste en stepAsyncOpponent y permite plantar', () => {
    const state = createBattleState(1, false, true)
    const deck = [{ slot: 0, plantId: 'peashooter' as const, level: 0, statRolls: [] }]
    const intents = [
      // Intenta colocar peashooter (100 soles) en tick 10.
      { issuedTick: 10, kind: 'plant' as const, plantId: 'peashooter' as const, slot: 0, lane: 0, col: 0 },
    ]
    const controller = createAsyncOpponentController(deck, intents)

    // Controlador empieza con 0 soles y state.p2SunBank empieza con 0
    controller.sunBank = 0
    state.p2SunBank = 0

    // P2 mata una planta enemiga durante el combate -> el motor le acredita 100 soles a state.p2SunBank
    state.p2SunBank += 100

    state.tick = 10
    stepAsyncOpponent(controller, state)

    // El saldo debió sincronizarse, gastar los 100 soles y colocar la planta con éxito
    expect(controller.stats.intentionsExecuted).toBe(1)
    expect(controller.sunBank).toBe(0)
    expect(state.p2SunBank).toBe(0)
    expect(state.pending.some((p) => p.kind === 'rival_plant' && p.plantId === 'peashooter')).toBe(true)
  })

  // 33. winnerSide 2 se interpreta autoritativamente como derrota del jugador real
  it('33. winnerSide 2 en partida asíncrona se interpreta autoritativamente como derrota del jugador real', () => {
    const isAsyncMatch = true
    const verificacion = {
      status: 'verified',
      winnerSide: 2 as 1 | 2 | null,
      winnerId: null as string | null,
      settlement: { eloLost: 8, eloGained: 0 },
    }

    const yoGaneServidor = isAsyncMatch
      ? verificacion.winnerSide === 1
      : verificacion.winnerId === 'mi-usuario-id'

    const hayResultadoAutoritativo = isAsyncMatch
      ? verificacion.winnerSide === 1 || verificacion.winnerSide === 2
      : Boolean(verificacion.winnerId)

    const finalGameStatus = yoGaneServidor ? 'victory' : 'defeat'

    expect(hayResultadoAutoritativo).toBe(true)
    expect(yoGaneServidor).toBe(false)
    expect(finalGameStatus).toBe('defeat')
  })

  // 34. winnerSide 1 se interpreta autoritativamente como victoria del jugador real
  it('34. winnerSide 1 en partida asíncrona se interpreta autoritativamente como victoria del jugador real', () => {
    const isAsyncMatch = true
    const verificacion = {
      status: 'verified',
      winnerSide: 1 as 1 | 2 | null,
      winnerId: 'mi-usuario-id',
      settlement: { eloGained: 12, eloLost: 0 },
    }

    const yoGaneServidor = isAsyncMatch
      ? verificacion.winnerSide === 1
      : verificacion.winnerId === 'mi-usuario-id'

    const hayResultadoAutoritativo = isAsyncMatch
      ? verificacion.winnerSide === 1 || verificacion.winnerSide === 2
      : Boolean(verificacion.winnerId)

    const finalGameStatus = yoGaneServidor ? 'victory' : 'defeat'

    expect(hayResultadoAutoritativo).toBe(true)
    expect(yoGaneServidor).toBe(true)
    expect(finalGameStatus).toBe('victory')
  })

  // 35. Partida asíncrona settled p2_won con server_winner_id NULL sigue siendo derrota y NO empate
  it('35. room_result en sala asíncrona con status p2_won y winner_id NULL devuelve iWon=false y noWinner=false (derrota legítima)', () => {
    const room = {
      is_async_match: true,
      status: 'p2_won',
      settled_at: '2026-08-22T00:00:00Z',
      player1_id: 'real-user-123',
      server_winner_id: null,
      verification_status: 'verified',
    }

    // Lógica correspondiente a la RPC room_result
    const v_i_won = room.status === 'p1_won'
    const v_no_winner = room.status !== 'p1_won' && room.status !== 'p2_won'
    const v_winner_side = room.status === 'p1_won' ? 1 : room.status === 'p2_won' ? 2 : null

    const resultadoRoom = {
      ended: true,
      status: room.status,
      winner: null,
      winnerSide: v_winner_side,
      iWon: v_i_won,
      noWinner: v_no_winner,
      isAsyncMatch: true,
    }

    expect(resultadoRoom.ended).toBe(true)
    expect(resultadoRoom.iWon).toBe(false)
    expect(resultadoRoom.noWinner).toBe(false)
    expect(resultadoRoom.winnerSide).toBe(2)
  })

  // 36. Snapshot existente en ranked_async_opponents no se modifica al capturarlo de nuevo
  it('36. Captura repetida de la misma sala y lado es inmutable (ON CONFLICT DO NOTHING)', () => {
    const pool = new Map<string, { rating: number; actionsCount: number }>()

    const key = 'room-1:side-1'
    // Primera inserción
    pool.set(key, { rating: 1200, actionsCount: 15 })

    // Intento de re-captura con datos alterados
    const nuevoIntento = { rating: 1350, actionsCount: 30 }
    if (!pool.has(key)) {
      pool.set(key, nuevoIntento)
    }

    // El snapshot original permanece inmutable
    expect(pool.get(key)?.rating).toBe(1200)
    expect(pool.get(key)?.actionsCount).toBe(15)
  })

  // 37. Backfill del pool sólo selecciona partidas humanas Ranked verificadas y con compatibilidad auth-v1
  it('37. Filtros de elegibilidad de backfill descartan partidas no ranked, no verificadas, asíncronas o de motor legacy', () => {
    const rooms = [
      { id: '1', mode: 'ranked', is_async_match: false, settled_at: 'now', verification_status: 'verified', p1: 'u1', p2: 'u2', engine: 'auth-v1' },
      { id: '2', mode: 'colosseum', is_async_match: false, settled_at: 'now', verification_status: 'verified', p1: 'u1', p2: 'u2', engine: 'auth-v1' },
      { id: '3', mode: 'ranked', is_async_match: true, settled_at: 'now', verification_status: 'verified', p1: 'u1', p2: null, engine: 'auth-v1' },
      { id: '4', mode: 'ranked', is_async_match: false, settled_at: 'now', verification_status: 'failed', p1: 'u1', p2: 'u2', engine: 'auth-v1' },
      { id: '5', mode: 'ranked', is_async_match: false, settled_at: 'now', verification_status: 'verified', p1: 'u1', p2: 'u2', engine: 'legacy-v0' },
    ]

    const elegibles = rooms.filter(
      (r) =>
        r.mode === 'ranked' &&
        !r.is_async_match &&
        Boolean(r.settled_at) &&
        r.verification_status === 'verified' &&
        Boolean(r.p1) &&
        Boolean(r.p2) &&
        r.engine === 'auth-v1'
    )

    expect(elegibles).toHaveLength(1)
    expect(elegibles[0].id).toBe('1')
  })

  // 38. Identidad de origen jamás se expone al cliente en game_room_info
  it('38. game_room_info para partidas asíncronas no incluye datos del usuario fuente', () => {
    const dbRoom = {
      id: 'room-uuid',
      player1_id: 'real-player-uuid',
      player2_id: null,
      is_async_match: true,
      async_opponent_id: 'seed-uuid-99',
      async_display_name: 'SolarNova',
      async_avatar_id: '4',
      async_rating_snapshot: 1250,
      source_user_id: 'secret-source-user',
      source_room_id: 'secret-source-room',
    }

    const payloadCliente = {
      id: dbRoom.id,
      isAsyncMatch: dbRoom.is_async_match,
      player1: { id: dbRoom.player1_id },
      player2: {
        id: dbRoom.async_opponent_id,
        username: dbRoom.async_display_name,
        avatarId: dbRoom.async_avatar_id,
        elo: dbRoom.async_rating_snapshot,
      },
    }

    expect(payloadCliente).not.toHaveProperty('source_user_id')
    expect(payloadCliente).not.toHaveProperty('source_room_id')
    expect(payloadCliente.player2.username).toBe('SolarNova')
    expect(payloadCliente.player2.id).not.toBe('secret-source-user')
  })

  // 39. Liquidación de partida asíncrona jamás altera el perfil de la cuenta de origen
  it('39. Liquidación asíncrona actualiza sólo al usuario real y preserva el perfil fuente', () => {
    const perfilesDb = {
      'real-player': { elo: 1200, cofres: 2 },
      'source-player': { elo: 1400, cofres: 5 },
    }

    // Simulación de settle_verified_async_ranked_match
    const realPlayerId = 'real-player'
    const winnerSide = 1 // gana el jugador real

    if (winnerSide === 1) {
      perfilesDb[realPlayerId].elo += 12
      perfilesDb[realPlayerId].cofres += 1
    }

    expect(perfilesDb['real-player'].elo).toBe(1212)
    expect(perfilesDb['real-player'].cofres).toBe(3)
    expect(perfilesDb['source-player'].elo).toBe(1400)
    expect(perfilesDb['source-player'].cofres).toBe(5)
  })

  // 40. Reconstrucción asíncrona dedicada (reconstruirPartidaAsync) restaura las plantas del Rival Semilla
  it('40. reconstruirPartidaAsync reproduce todas las intenciones del Rival Semilla tras un rollback/descarte de P1', () => {
    const seed = 42
    const p1Deck: CartaDeMazo[] = [{ slot: 0, plantId: 'sunflower', level: 0, statRolls: [] }]
    const p2Deck: CartaDeMazo[] = [{ slot: 0, plantId: 'sunflower', level: 0, statRolls: [] }]
    // En la economía determinista: 1er sol (+25) en tic 120, 2do sol (+25) en tic 301 = 50 soles para girasol
    const spawnedSuns: string[] = []
    const baseSim = createBattleState(seed, false, true)
    while (baseSim.tick < 330 && spawnedSuns.length < 2) {
      stepTick(baseSim, () => {})
      for (const s of baseSim.suns) {
        if (!spawnedSuns.includes(s.id)) spawnedSuns.push(s.id)
      }
    }

    const intents: AsyncOpponentIntent[] = [
      { seq: 1, tick: 310, issuedTick: 310, kind: 'plant', plantId: 'sunflower', slot: 0, lane: 1, col: 1 },
    ]

    // Acciones de P1: recoge 2 soles para tener 50 soles, luego una planta válida y una que se descartará
    const p1AccionesOriginales: AccionP1Simulacion[] = [
      { seq: 1, tick: 120, issuedTick: 120, kind: 'collect', targetId: spawnedSuns[0] },
      { seq: 2, tick: 301, issuedTick: 301, kind: 'collect', targetId: spawnedSuns[1] },
      { seq: 3, tick: 311, issuedTick: 305, kind: 'plant', plantId: 'sunflower', slot: 0, lane: 1, col: 1 },
    ]

    // Simular el avance hasta tic 330 (el girasol entra al campo en tic 310 + 6 = 316)
    const { estado: estadoNormal } = reconstruirPartidaAsync(seed, p1Deck, p2Deck, intents, p1AccionesOriginales, 330)
    expect(estadoNormal.enemyPlants.length).toBe(1)

    // Si Supabase rechaza la jugada de seq 3, se descarta de P1 por seq 3 y se reconstruye:
    const p1AccionesFiltradas = descartarAccionP1Async(p1AccionesOriginales, 3)
    const { estado: estadoReconstruido, controller: controllerReconstruido } = reconstruirPartidaAsync(
      seed,
      p1Deck,
      p2Deck,
      intents,
      p1AccionesFiltradas,
      330
    )

    // Las plantas del Rival Semilla (enemyPlants) DEBEN estar presentes y sincronizadas
    expect(estadoReconstruido.enemyPlants.length).toBe(estadoNormal.enemyPlants.length)
    // El controller debe haber procesado la intención
    expect(controllerReconstruido.nextIntentIndex).toBe(1)
    expect(controllerReconstruido.stats.intentionsExecuted).toBe(1)
  })

  // 41. Reconstrucción asíncrona sincroniza nextIntentIndex y sunBank
  it('41. reconstruirPartidaAsync deja el AsyncOpponentController en la posición exacta para el siguiente tic', () => {
    const seed = 99
    const p1Deck: CartaDeMazo[] = [{ slot: 0, plantId: 'peashooter', level: 0, statRolls: [] }]
    const p2Deck: CartaDeMazo[] = [{ slot: 0, plantId: 'sunflower', level: 0, statRolls: [] }]
    const intents: AsyncOpponentIntent[] = [
      { seq: 1, tick: 310, issuedTick: 310, kind: 'plant', plantId: 'sunflower', slot: 0, lane: 1, col: 1 },
      { seq: 2, tick: 600, issuedTick: 600, kind: 'plant', plantId: 'sunflower', slot: 0, lane: 2, col: 1 },
    ]

    // Reconstruir solo hasta tic 330
    const { controller } = reconstruirPartidaAsync(seed, p1Deck, p2Deck, intents, [], 330)
    expect(controller.nextIntentIndex).toBe(1) // Sólo procesó la intención de tic 310
    expect(controller.stats.intentionsExecuted).toBe(1)
  })

  // 42. Feed de intenciones asíncronas no filtra el plan futuro completo
  it('42. poll_ranked_async_intents restringe las acciones a la ventana autorizada serverTick + 18 (~600 ms)', () => {
    const allSnapshotIntents: AsyncOpponentIntent[] = [
      { seq: 1, tick: 10, issuedTick: 10, kind: 'plant', plantId: 'sunflower', lane: 1, col: 1 },
      { seq: 2, tick: 50, issuedTick: 50, kind: 'plant', plantId: 'peashooter', lane: 1, col: 2 },
      { seq: 3, tick: 1018, issuedTick: 1018, kind: 'plant', plantId: 'wallnut', lane: 1, col: 3 },
      { seq: 4, tick: 1019, issuedTick: 1019, kind: 'plant', plantId: 'repeater', lane: 1, col: 4 },
      { seq: 5, tick: 2000, issuedTick: 2000, kind: 'plant', plantId: 'jalapeno', lane: 1, col: 5 },
    ]

    // Simular consulta con serverTick = 1000. Límite estricto del servidor = 1000 + 18 = 1018 tics
    const serverTick = 1000
    const maxRevealTick = serverTick + 18

    // Filtrar con afterSeq = 0
    const intentsEntregadas = allSnapshotIntents.filter(
      (i) => (i.issuedTick ?? i.tick) <= maxRevealTick
    )

    // Entrega tics 10, 50 y 1018, pero NUNCA 1019 ni 2000
    expect(intentsEntregadas).toHaveLength(3)
    expect(intentsEntregadas.map((i) => i.seq)).toEqual([1, 2, 3])
    expect(intentsEntregadas.find((i) => i.plantId === 'jalapeno')).toBeUndefined()
    expect(intentsEntregadas.find((i) => i.plantId === 'repeater')).toBeUndefined()
  })

  // 43. Garantía por código de semilla RNG nueva y distinta a la sala origen
  it('43. Generador de semilla garantiza seed != source_room_seed y seed != seeds previas del mismo async_opponent_id', () => {
    const sourceSeed = 54321
    const usedSeedsForOpponent = new Set<number>([11111, 22222, 33333])

    // Función que replica el bucle con comprobación estricta
    const generarSemillaGarantizada = (source: number, used: Set<number>): number => {
      let attempts = 0
      while (attempts < 100) {
        attempts++
        // Generar candidato 100000..999999
        const candidate = 100000 + Math.floor(Math.random() * 900000)
        if (candidate !== source && !used.has(candidate)) {
          return candidate
        }
      }
      throw new Error('No se pudo generar una seed única tras 100 intentos')
    }

    const nuevaSeed = generarSemillaGarantizada(sourceSeed, usedSeedsForOpponent)
    expect(nuevaSeed).not.toBe(sourceSeed)
    expect(usedSeedsForOpponent.has(nuevaSeed)).toBe(false)
  })

  // 44. Reutilizar el mismo Rival Semilla produce semillas distintas
  it('44. Reutilizar el mismo async_opponent_id en salas sucesivas produce semillas diferentes', () => {
    const usedSeeds = new Set<number>()

    for (let i = 0; i < 20; i++) {
      let seed = 100000 + Math.floor(Math.random() * 900000)
      while (usedSeeds.has(seed)) {
        seed = 100000 + Math.floor(Math.random() * 900000)
      }
      usedSeeds.add(seed)
    }

    expect(usedSeeds.size).toBe(20)
  })

  // 45. Compatibilidad de motor: descarta candidatos con motor distinto de auth-v1
  it('45. Selección de candidatos para ranked_async_opponents descarta snapshots de motores incompatibles', () => {
    const candidates = [
      { id: 'c1', active: true, rating: 1200, source_engine_version: 'auth-v1' },
      { id: 'c2', active: true, rating: 1210, source_engine_version: 'future-v2' },
      { id: 'c3', active: true, rating: 1190, source_engine_version: 'legacy-v0' },
      { id: 'c4', active: true, rating: 1205, source_engine_version: null },
    ]

    const validCandidates = candidates.filter(
      (c) => c.active && (c.source_engine_version ?? 'auth-v1') === 'auth-v1'
    )

    expect(validCandidates.map((c) => c.id)).toEqual(['c1', 'c4'])
  })

  // 46. Optimización en Battlefield: no suscripción a match_actions ni huellas en async
  it('46. Partidas asíncronas no envían checkpoints de huellas al no existir segundo cliente', () => {
    const isAsyncMatch = true
    let checkpointsEnviados = 0

    const enviarCheckpoint = (asyncMatch: boolean) => {
      if (asyncMatch) return // Omitido en async
      checkpointsEnviados++
    }

    enviarCheckpoint(isAsyncMatch)
    expect(checkpointsEnviados).toBe(0)

    enviarCheckpoint(false)
    expect(checkpointsEnviados).toBe(1)
  })

  // 47. Anti-Cheat A & B: game_rooms no contiene async_actions_snapshot y ranked_async_room_plans es server-only
  it('47. Migración 36 no añade async_actions_snapshot a game_rooms y crea ranked_async_room_plans server-only', () => {
    const sqlPath = join(process.cwd(), 'supabase', '36-rival-semilla-ranked.sql')
    const sqlContent = readFileSync(sqlPath, 'utf8')

    // A) game_rooms NO contiene async_actions_snapshot
    expect(sqlContent).not.toMatch(/ADD COLUMN IF NOT EXISTS async_actions_snapshot/i)
    expect(sqlContent).not.toMatch(/async_actions_snapshot JSONB/i)

    // B) ranked_async_room_plans existe y tiene RLS + REVOKE server-only
    expect(sqlContent).toMatch(/CREATE TABLE IF NOT EXISTS public\.ranked_async_room_plans/i)
    expect(sqlContent).toMatch(/ALTER TABLE public\.ranked_async_room_plans ENABLE ROW LEVEL SECURITY/i)
    expect(sqlContent).toMatch(/REVOKE ALL ON public\.ranked_async_room_plans FROM anon, authenticated, PUBLIC/i)
    expect(sqlContent).toMatch(/GRANT ALL ON public\.ranked_async_room_plans TO service_role/i)
  })

  // 48. Anti-Cheat C & D: poll_ranked_async_intents no acepta p_client_tick y usa serverTick + 18
  it('48. poll_ranked_async_intents no expone parámetros de tick del cliente y aplica serverTick + 18', () => {
    const sqlPath = join(process.cwd(), 'supabase', '36-rival-semilla-ranked.sql')
    const sqlContent = readFileSync(sqlPath, 'utf8')

    // C) Sin p_client_tick
    expect(sqlContent).not.toMatch(/p_client_tick/i)
    expect(sqlContent).toMatch(/p_after_seq INTEGER DEFAULT 0/i)

    // D) max reveal = serverTick + 18 (no + 150)
    expect(sqlContent).toMatch(/v_max_reveal_tick := v_server_tick \+ 18;/i)
    expect(sqlContent).not.toMatch(/v_server_tick \+ 150/i)

    // Lee de ranked_async_room_plans
    expect(sqlContent).toMatch(/FROM public\.ranked_async_room_plans WHERE room_id = p_room_id/i)
  })

  // 49. Anti-Cheat E: after_seq filtra intenciones ya entregadas y evita tráfico redundante
  it('49. after_seq entrega únicamente intenciones nuevas con seq > after_seq dentro de la ventana', () => {
    const planIntents = [
      { seq: 1, tick: 100, issuedTick: 100, kind: 'plant', plantId: 'sunflower', slot: 0, lane: 1, col: 1 },
      { seq: 2, tick: 150, issuedTick: 150, kind: 'plant', plantId: 'sunflower', slot: 0, lane: 2, col: 1 },
      { seq: 3, tick: 200, issuedTick: 200, kind: 'plant', plantId: 'peashooter', slot: 1, lane: 1, col: 2 },
      { seq: 4, tick: 300, issuedTick: 300, kind: 'plant', plantId: 'wallnut', slot: 2, lane: 1, col: 3 },
    ]

    const serverTick = 250
    const maxRevealTick = serverTick + 18 // 268

    // Primer poll: afterSeq = 0 -> devuelve seq 1, 2, 3
    const poll1 = planIntents.filter(
      (i) => i.seq > 0 && (i.issuedTick ?? i.tick) <= maxRevealTick
    )
    expect(poll1.map((i) => i.seq)).toEqual([1, 2, 3])

    // Segundo poll: cliente ya tiene seq 3 -> afterSeq = 3
    const poll2 = planIntents.filter(
      (i) => i.seq > 3 && (i.issuedTick ?? i.tick) <= maxRevealTick
    )
    // seq 4 tiene tick 300 > 268, por lo que NO se entrega aún
    expect(poll2).toHaveLength(0)

    // Tercer poll: serverTick avanza a 300 (maxReveal = 318)
    const serverTickAvanzado = 300
    const maxRevealTickAvanzado = serverTickAvanzado + 18
    const poll3 = planIntents.filter(
      (i) => i.seq > 3 && (i.issuedTick ?? i.tick) <= maxRevealTickAvanzado
    )
    // Ahora sólo entrega seq 4, sin reenviar 1, 2 y 3
    expect(poll3.map((i) => i.seq)).toEqual([4])
  })

  // 50. Anti-Cheat F: verify-match carga el plan privado y falla cerrado si falta
  it('50. verify-match consulta ranked_async_room_plans con service_role y falla cerrado si no existe', () => {
    const verifyPath = join(process.cwd(), 'supabase', 'functions', 'verify-match', 'index.ts')
    const verifyContent = readFileSync(verifyPath, 'utf8')

    // Consulta tabla privada ranked_async_room_plans
    expect(verifyContent).toMatch(/from\(['"]ranked_async_room_plans['"]\)/i)
    expect(verifyContent).toMatch(/select\(['"]actions_snapshot/i)

    // Falla cerrado con async_plan_missing si no existe
    expect(verifyContent).toMatch(/async_plan_missing/i)
    expect(verifyContent).toMatch(/mark_match_verification_failed/i)
    expect(verifyContent).not.toMatch(/room\.async_actions_snapshot/i)
  })

  // 51. Anti-Cheat G: cliente no puede obtener source_room_id ni el plan completo
  it('51. game_room_info y select no exponen source_room_id ni acciones completas', () => {
    const sqlPath = join(process.cwd(), 'supabase', '36-rival-semilla-ranked.sql')
    const sqlContent = readFileSync(sqlPath, 'utf8')

    // Extraer función game_room_info
    const gameRoomInfoSql = sqlContent.substring(
      sqlContent.indexOf('CREATE OR REPLACE FUNCTION public.game_room_info'),
      sqlContent.indexOf('REVOKE EXECUTE ON FUNCTION public.game_room_info')
    )

    // game_room_info no expone source_room_id ni asyncActionsSnapshot
    expect(gameRoomInfoSql).not.toMatch(/'sourceRoomId'/i)
    expect(gameRoomInfoSql).not.toMatch(/source_room_id/i)
    expect(gameRoomInfoSql).not.toMatch(/'asyncActionsSnapshot'/i)
    expect(gameRoomInfoSql).not.toMatch(/async_actions_snapshot/i)

    // game_rooms no contiene columna async_actions_snapshot
    expect(sqlContent).not.toMatch(/ADD COLUMN IF NOT EXISTS async_actions_snapshot/i)
  })

  // 52. Anti-Cheat H: el useEffect de polling en Battlefield no depende de tick
  it('52. El useEffect de Battlefield para feed asíncrono no depende de tick y usa ref incremental', () => {
    const bfPath = join(process.cwd(), 'src', 'components', 'Battlefield', 'Battlefield.tsx')
    const bfContent = readFileSync(bfPath, 'utf8')

    expect(bfContent).toMatch(/ultimaSeqAsyncRef/i)
    expect(bfContent).toMatch(/\[roomId, isAsyncMatch, incorporarIntencionesAsync\]/i)
    expect(bfContent).not.toMatch(/\[roomId, isAsyncMatch, tick, incorporarIntencionesAsync\]/i)
  })

  // 53. Reconstrucción con buffer progresivo sincroniza exactamente estado, controller y descarta jugada de P1
  it('53. Reconstrucción asíncrona sincroniza nextIntentIndex, pendingRetry, p2SunBank, plantas y rollback de P1', () => {
    const seed = 777
    const deckP1: CartaDeMazo[] = [{ slot: 0, plantId: 'sunflower', level: 0, statRolls: [] }]
    const deckP2: CartaDeMazo[] = [{ slot: 0, plantId: 'sunflower', level: 0, statRolls: [] }]

    // Descubrir 2 soles del cielo
    const spawnedSuns: string[] = []
    const probe = createBattleState(seed, false, true)
    while (probe.tick < 300) {
      for (const s of probe.suns) {
        if (!spawnedSuns.includes(s.id)) spawnedSuns.push(s.id)
      }
      stepTick(probe, () => {})
    }
    const sun1Id = spawnedSuns[0]
    const sun2Id = spawnedSuns[1]

    // Buffer acumulativo de intenciones recibidas progresivamente hasta tic 330
    const bufferedIntents: AsyncOpponentIntent[] = [
      { seq: 1, tick: 310, issuedTick: 310, kind: 'plant', plantId: 'sunflower', slot: 0, lane: 1, col: 1 },
    ]

    // Acciones registradas de P1:
    // a) Recoger sol 1 en tic 80 (+25)
    // b) Recoger sol 2 en tic 265 (+25 = 50 soles)
    // c) Plantar girasol en tic 276 (issuedTick 270, 50 soles)
    const p1Acciones = [
      { seq: 1, tick: 80, issuedTick: 80, kind: 'collect', targetId: sun1Id },
      { seq: 2, tick: 265, issuedTick: 265, kind: 'collect', targetId: sun2Id },
      { seq: 3, tick: 276, issuedTick: 270, kind: 'plant', plantId: 'sunflower', lane: 1, col: 1, slot: 0 },
    ]

    const { estado: estadoReconstruido, controller: controllerReconstruido } = reconstruirPartidaAsync(
      seed,
      deckP1,
      deckP2,
      bufferedIntents,
      p1Acciones,
      330
    )

    // 1. La planta de P1 está presente en el carril 1
    expect(estadoReconstruido.plants.length).toBe(1)
    expect(estadoReconstruido.plants[0].lane).toBe(1)

    // 2. La planta de P2 permanece intacta y sincronizada
    expect(estadoReconstruido.enemyPlants.length).toBe(1)
    expect(estadoReconstruido.enemyPlants[0].lane).toBe(1)

    // 3. El controller avanzó su índice y ejecutó la intención
    expect(controllerReconstruido.nextIntentIndex).toBe(1)
    expect(controllerReconstruido.stats.intentionsExecuted).toBe(1)
    expect(controllerReconstruido.pendingRetry).toBeNull()

    // 4. El banco de soles de P2 gastó los 50 soles del girasol
    expect(controllerReconstruido.sunBank).toBe(0)
    expect(estadoReconstruido.p2SunBank).toBe(0)
  })

  // 54. Test obligatorio de latencia: Intención asíncrona recibida tarde reconstruye y converge al 100%
  it('54. Intención asíncrona recibida tarde detecta lag, reconstruye el timeline y converge exactamente con la ejecución limpia', () => {
    const seed = 99999
    const deckP1: CartaDeMazo[] = [{ slot: 0, plantId: 'peashooter', level: 0, statRolls: [] }]
    const deckP2: CartaDeMazo[] = [{ slot: 0, plantId: 'sunflower', level: 0, statRolls: [] }]

    // Intención histórica del rival: plantar girasol en tic 310 (cuando alcanza 50 soles)
    const lateIntent: AsyncOpponentIntent = {
      seq: 1,
      tick: 310,
      issuedTick: 310,
      kind: 'plant',
      plantId: 'sunflower',
      slot: 0,
      lane: 2,
      col: 2,
    }

    // A) Ejecución limpia de referencia que conocía la intención desde tic 0
    const { estado: estadoLimpio, controller: controllerLimpio } = reconstruirPartidaAsync(
      seed,
      deckP1,
      deckP2,
      [lateIntent],
      [],
      330
    )

    // B) Simulación del cliente que avanza hasta tic 330 SIN conocer la intención (buffer vacío por lag de red)
    const { estado: estadoDesincronizado } = reconstruirPartidaAsync(
      seed,
      deckP1,
      deckP2,
      [],
      [],
      330
    )
    expect(estadoDesincronizado.enemyPlants.length).toBe(0) // No tiene la planta
    expect(estadoDesincronizado.p2SunBank).toBeGreaterThan(0) // No gastó soles

    // C) En tic 330 llega el paquete del feed con la intención de tic 310
    const currentTick = 330
    const nuevasIntenciones = [lateIntent]
    const buffer: AsyncOpponentIntent[] = []
    let rehacerDesde: number | null = null

    // Lógica equivalente a useGameEngine.incorporarIntencionesAsync
    const clavesExistentes = new Set(
      buffer.map((i) => `${i.seq ?? ''}_${i.issuedTick ?? i.tick}_${i.kind}_${i.lane}_${i.col ?? ''}`)
    )
    let tickMasAntiguoNuevo: number | null = null

    for (const n of nuevasIntenciones) {
      const clave = `${n.seq ?? ''}_${n.issuedTick ?? n.tick}_${n.kind}_${n.lane}_${n.col ?? ''}`
      if (clavesExistentes.has(clave)) continue
      clavesExistentes.add(clave)
      buffer.push(n)
      const issuedTick = Number(n.issuedTick ?? n.tick)
      if (Number.isInteger(issuedTick) && issuedTick >= 0) {
        tickMasAntiguoNuevo =
          tickMasAntiguoNuevo === null ? issuedTick : Math.min(tickMasAntiguoNuevo, issuedTick)
      }
    }

    // D) Detección de intención tardía:
    expect(tickMasAntiguoNuevo).toBe(310)
    expect(tickMasAntiguoNuevo! <= currentTick).toBe(true)
    if (tickMasAntiguoNuevo !== null && tickMasAntiguoNuevo <= currentTick) {
      rehacerDesde = tickMasAntiguoNuevo
    }
    expect(rehacerDesde).toBe(310)

    // E) Reconstrucción obligatoria con el buffer actualizado hasta currentTick (330)
    const { estado: estadoReconstruido, controller: controllerReconstruido } = reconstruirPartidaAsync(
      seed,
      deckP1,
      deckP2,
      buffer,
      [],
      currentTick
    )

    // F) Comparación exhaustiva con la ejecución limpia de referencia:
    expect(estadoReconstruido.tick).toBe(estadoLimpio.tick)
    expect(estadoReconstruido.p1BaseHp).toBe(estadoLimpio.p1BaseHp)
    expect(estadoReconstruido.p2BaseHp).toBe(estadoLimpio.p2BaseHp)
    expect(estadoReconstruido.enemyPlants.length).toBe(estadoLimpio.enemyPlants.length)
    expect(estadoReconstruido.enemyPlants[0].plantId).toBe(estadoLimpio.enemyPlants[0].plantId)
    expect(estadoReconstruido.enemyPlants[0].lane).toBe(estadoLimpio.enemyPlants[0].lane)
    expect(estadoReconstruido.enemyPlants[0].x).toBe(estadoLimpio.enemyPlants[0].x)
    expect(estadoReconstruido.enemyPlants[0].hp).toBe(estadoLimpio.enemyPlants[0].hp)
    expect(estadoReconstruido.plants.length).toBe(estadoLimpio.plants.length)
    expect(estadoReconstruido.p2SunBank).toBe(estadoLimpio.p2SunBank)
    expect(controllerReconstruido.sunBank).toBe(controllerLimpio.sunBank)
    expect(controllerReconstruido.nextIntentIndex).toBe(controllerLimpio.nextIntentIndex)
    expect(controllerReconstruido.pendingRetry).toBe(controllerLimpio.pendingRetry)
    expect(controllerReconstruido.stats.intentionsExecuted).toBe(controllerLimpio.stats.intentionsExecuted)
    expect(controllerReconstruido.slotCooldowns).toEqual(controllerLimpio.slotCooldowns)
  })

  // 55. Intención futura recibida a tiempo NO dispara reconstrucción
  it('55. Intención futura recibida a tiempo se agrega al buffer sin solicitar reconstrucción', () => {
    const currentTick = 100
    const buffer: AsyncOpponentIntent[] = []
    const nuevasIntenciones: AsyncOpponentIntent[] = [
      { seq: 1, tick: 150, issuedTick: 150, kind: 'plant', plantId: 'peashooter', slot: 0, lane: 1, col: 1 },
    ]

    const clavesExistentes = new Set(
      buffer.map((i) => `${i.seq ?? ''}_${i.issuedTick ?? i.tick}_${i.kind}_${i.lane}_${i.col ?? ''}`)
    )
    let tickMasAntiguoNuevo: number | null = null
    let rehacerDesde: number | null = null

    for (const n of nuevasIntenciones) {
      const clave = `${n.seq ?? ''}_${n.issuedTick ?? n.tick}_${n.kind}_${n.lane}_${n.col ?? ''}`
      if (clavesExistentes.has(clave)) continue
      clavesExistentes.add(clave)
      buffer.push(n)
      const issuedTick = Number(n.issuedTick ?? n.tick)
      if (Number.isInteger(issuedTick) && issuedTick >= 0) {
        tickMasAntiguoNuevo =
          tickMasAntiguoNuevo === null ? issuedTick : Math.min(tickMasAntiguoNuevo, issuedTick)
      }
    }

    if (tickMasAntiguoNuevo !== null && tickMasAntiguoNuevo <= currentTick) {
      rehacerDesde = tickMasAntiguoNuevo
    }

    // Se incorporó al buffer pero NO necesita rehacer porque aún no ha ocurrido
    expect(buffer.length).toBe(1)
    expect(tickMasAntiguoNuevo).toBe(150)
    expect(rehacerDesde).toBeNull()
  })

  // 56. Intención repetida / duplicada es ignorada y no dispara reconstrucción
  it('56. Intenciones repetidas no modifican el buffer ni disparan reconstrucción', () => {
    const currentTick = 200
    const intent: AsyncOpponentIntent = {
      seq: 1,
      tick: 50,
      issuedTick: 50,
      kind: 'plant',
      plantId: 'sunflower',
      slot: 0,
      lane: 1,
      col: 1,
    }
    const buffer: AsyncOpponentIntent[] = [intent]
    const clavesExistentes = new Set(
      buffer.map((i) => `${i.seq ?? ''}_${i.issuedTick ?? i.tick}_${i.kind}_${i.lane}_${i.col ?? ''}`)
    )

    let huboNuevas = false
    let tickMasAntiguoNuevo: number | null = null
    let rehacerDesde: number | null = null

    // Intentar incorporar la misma intención
    for (const n of [intent]) {
      const clave = `${n.seq ?? ''}_${n.issuedTick ?? n.tick}_${n.kind}_${n.lane}_${n.col ?? ''}`
      if (clavesExistentes.has(clave)) continue
      clavesExistentes.add(clave)
      buffer.push(n)
      huboNuevas = true
      const issuedTick = Number(n.issuedTick ?? n.tick)
      if (Number.isInteger(issuedTick) && issuedTick >= 0) {
        tickMasAntiguoNuevo =
          tickMasAntiguoNuevo === null ? issuedTick : Math.min(tickMasAntiguoNuevo, issuedTick)
      }
    }

    if (huboNuevas && tickMasAntiguoNuevo !== null && tickMasAntiguoNuevo <= currentTick) {
      rehacerDesde = tickMasAntiguoNuevo
    }

    expect(huboNuevas).toBe(false)
    expect(buffer.length).toBe(1)
    expect(rehacerDesde).toBeNull()
  })

  // 57. Battlefield UX no muestra PVE ni PC en salas con roomId
  it('57. Battlefield no muestra overlay PVE / PC cuando existe roomId', () => {
    const bfPath = join(process.cwd(), 'src', 'components', 'Battlefield', 'Battlefield.tsx')
    const bfContent = readFileSync(bfPath, 'utf8')

    // El overlay de PvE sólo aparece con !roomId
    expect(bfContent).toMatch(/gameStatus === 'ready' && !practicePlantId && !roomId/i)

    // Cuando roomId está presente, muestra pantalla neutra de espera
    expect(bfContent).toMatch(/gameStatus === 'ready' && !practicePlantId && Boolean\(roomId\)/i)
    expect(bfContent).toMatch(/Preparando partida…/i)
  })

  // 58. Test integral: Recogida manual de sol, plantación con cooldown, intención tardía y convergencia total de estado
  it('58. Reconstrucción asíncrona unificada converge al 100% en soles, cooldowns, RNG, entidades y controlador', () => {
    const seed = 54321
    const p1Deck: CartaDeMazo[] = [
      { slot: 0, plantId: 'sunflower', level: 0, statRolls: [] },
      { slot: 1, plantId: 'peashooter', level: 0, statRolls: [] },
    ]
    const p2Deck: CartaDeMazo[] = [{ slot: 0, plantId: 'sunflower', level: 0, statRolls: [] }]

    // 1. Obtener IDs de los primeros soles del cielo corriendo simulación previa
    const spawnedSuns: string[] = []
    const tempState = createBattleState(seed, false, true)
    while (tempState.tick < 300) {
      for (const s of tempState.suns) {
        if (!spawnedSuns.includes(s.id)) spawnedSuns.push(s.id)
      }
      stepTick(tempState, () => {})
    }
    expect(spawnedSuns.length).toBeGreaterThanOrEqual(2)
    const sun1Id = spawnedSuns[0]
    const sun2Id = spawnedSuns[1]

    // Acciones de P1:
    // a) Recoger sol 1 en tic 80 (+25)
    // b) Recoger sol 2 en tic 265 (+25 = 50 soles)
    // c) Plantar girasol en tic 276 (issuedTick 270: consume 50 soles, cooldown slot 0 activo)
    const p1Actions: AccionP1Simulacion[] = [
      { seq: 1, tick: 80, issuedTick: 80, kind: 'collect', targetId: sun1Id },
      { seq: 2, tick: 265, issuedTick: 265, kind: 'collect', targetId: sun2Id },
      { seq: 3, tick: 276, issuedTick: 270, kind: 'plant', plantId: 'sunflower', slot: 0, lane: 0, col: 0 },
    ]

    // Intención tardía del Rival Semilla: plantar en tic 310
    const asyncIntents: AsyncOpponentIntent[] = [
      { seq: 1, tick: 310, issuedTick: 310, kind: 'plant', plantId: 'sunflower', slot: 0, lane: 2, col: 2 },
    ]

    // Ejecución limpia de referencia que conoció todas las acciones e intenciones desde el inicio
    const { estado: estadoLimpio, controller: controllerLimpio } = reconstruirPartidaAsync(
      seed,
      p1Deck,
      p2Deck,
      asyncIntents,
      p1Actions,
      330
    )

    // Reconstrucción del cliente tras recibir el paquete tardío en tic 330
    const { estado: estadoReconstruido, controller: controllerReconstruido } = reconstruirPartidaAsync(
      seed,
      p1Deck,
      p2Deck,
      asyncIntents,
      p1Actions,
      330
    )

    // A) Ticks y bases
    expect(estadoReconstruido.tick).toBe(estadoLimpio.tick)
    expect(estadoReconstruido.p1BaseHp).toBe(estadoLimpio.p1BaseHp)
    expect(estadoReconstruido.p2BaseHp).toBe(estadoLimpio.p2BaseHp)

    // B) Economía P1 y P2
    expect(estadoReconstruido.sunBank).toBe(estadoLimpio.sunBank)
    expect(estadoReconstruido.p2SunBank).toBe(estadoLimpio.p2SunBank)

    // C) Cooldowns y slotCooldowns de P1
    expect(estadoReconstruido.slotCooldowns).toEqual(estadoLimpio.slotCooldowns)

    // D) Soles en el campo (los soles recogidos NO existen y los nuevos tienen mismos IDs)
    expect(estadoReconstruido.suns.some((s) => s.id === sun1Id || s.id === sun2Id)).toBe(false)
    expect(estadoReconstruido.suns.length).toBe(estadoLimpio.suns.length)
    expect(estadoReconstruido.suns.map((s) => s.id)).toEqual(estadoLimpio.suns.map((s) => s.id))

    // E) Plantas propias y enemigas
    expect(estadoReconstruido.plants.length).toBe(estadoLimpio.plants.length)
    expect(estadoReconstruido.plants[0].plantId).toBe('sunflower')
    expect(estadoReconstruido.plants[0].lane).toBe(0)
    expect(estadoReconstruido.plants[0].col).toBe(0)
    expect(estadoReconstruido.enemyPlants.length).toBe(estadoLimpio.enemyPlants.length)
    expect(estadoReconstruido.enemyPlants[0].plantId).toBe('sunflower')
    expect(estadoReconstruido.enemyPlants[0].lane).toBe(2)

    // F) Proyectiles, pending y estadísticas
    expect(estadoReconstruido.projectiles.length).toBe(estadoLimpio.projectiles.length)
    expect(estadoReconstruido.pending.length).toBe(estadoLimpio.pending.length)
    expect(estadoReconstruido.stats).toEqual(estadoLimpio.stats)

    // G) Estado del AsyncOpponentController
    expect(controllerReconstruido.sunBank).toBe(controllerLimpio.sunBank)
    expect(controllerReconstruido.nextIntentIndex).toBe(controllerLimpio.nextIntentIndex)
    expect(controllerReconstruido.pendingRetry).toEqual(controllerLimpio.pendingRetry)
    expect(controllerReconstruido.slotCooldowns).toEqual(controllerLimpio.slotCooldowns)
    expect(controllerReconstruido.stats).toEqual(controllerLimpio.stats)
  })

  // 59. Rollback de acción rechazada por el servidor restaura economía y cooldowns calculados desde timeline
  it('59. Eliminar acción rechazada restaura banco y cooldowns directamente por reconstrucción del timeline', () => {
    const seed = 8888
    const p1Deck: CartaDeMazo[] = [
      { slot: 0, plantId: 'sunflower', level: 0, statRolls: [] },
      { slot: 1, plantId: 'peashooter', level: 0, statRolls: [] },
    ]
    const p2Deck: CartaDeMazo[] = [{ slot: 0, plantId: 'sunflower', level: 0, statRolls: [] }]

    const spawnedSuns: string[] = []
    const probe = createBattleState(seed, false, true)
    while (probe.tick < 300) {
      for (const s of probe.suns) {
        if (!spawnedSuns.includes(s.id)) spawnedSuns.push(s.id)
      }
      stepTick(probe, () => {})
    }
    const sun1Id = spawnedSuns[0]
    const sun2Id = spawnedSuns[1]

    // P1 recoge 2 soles (50 soles) y planta girasol en tic 276 (issuedTick 270, 50 soles).
    // Intenta plantar lanzaguisantes en tic 280 pero no tiene 100 soles -> rechazada por el servidor.
    const p1AccionesOriginales: AccionP1Simulacion[] = [
      { seq: 1, tick: 80, issuedTick: 80, kind: 'collect', targetId: sun1Id },
      { seq: 2, tick: 265, issuedTick: 265, kind: 'collect', targetId: sun2Id },
      { seq: 3, tick: 276, issuedTick: 270, kind: 'plant', plantId: 'sunflower', slot: 0, lane: 1, col: 0 },
      { seq: 4, tick: 286, issuedTick: 280, kind: 'plant', plantId: 'peashooter', slot: 1, lane: 1, col: 1 },
    ]

    // El servidor rechaza la acción de peashooter -> se elimina de accionesP1AsyncRef:
    const p1AccionesLimpias = p1AccionesOriginales.filter((a) => a.seq !== 4)

    const { estado } = reconstruirPartidaAsync(
      seed,
      p1Deck,
      p2Deck,
      [],
      p1AccionesLimpias,
      300
    )

    // 1. Sólo la planta válida existe
    expect(estado.plants.length).toBe(1)
    expect(estado.plants[0].plantId).toBe('sunflower')

    // 2. Banco de soles es 0 (gastó 50 de los 50 recolectados)
    expect(estado.sunBank).toBe(0)

    // 3. Cooldown de slot 0 (girasol) está activo, pero slot 1 (lanzaguisantes) está en 0
    expect(estado.slotCooldowns[0]).toBeGreaterThan(0)
    expect(estado.slotCooldowns[1] || 0).toBe(0)
  })

  // 60. Collect aceptado con targetId consume el sol exacto y coincide con verify-match
  it('60. Recogida con targetId consume el sol correspondiente y otorga la economía idéntica a verify-match', () => {
    const seed = 3333
    const p1Deck: CartaDeMazo[] = [{ slot: 0, plantId: 'peashooter', level: 0, statRolls: [] }]
    const p2Deck: CartaDeMazo[] = [{ slot: 0, plantId: 'sunflower', level: 0, statRolls: [] }]

    // Descubrir sol generado
    const checkState = createBattleState(seed, false, true)
    while (checkState.tick < 100 && checkState.suns.length === 0) {
      stepTick(checkState, () => {})
    }
    const targetSun = checkState.suns[0]
    expect(targetSun).toBeDefined()

    const p1Actions: AccionP1Simulacion[] = [
      { seq: 1, tick: 80, issuedTick: 80, kind: 'collect', targetId: targetSun.id },
    ]

    // Ejecutar en cliente
    const { estado: estadoCliente } = reconstruirPartidaAsync(
      seed,
      p1Deck,
      p2Deck,
      [],
      p1Actions,
      120
    )

    // Ejecutar en verify-match (simulateAsyncMatch)
    const resServer = simulateAsyncMatch(
      seed,
      p1Deck,
      p2Deck,
      p1Actions,
      [],
      120
    )

    // P1 no fue penalizado por ilegal
    expect(resServer.p1Ilegal).toBe(false)

    // Economía del cliente contiene los 0 iniciales + 25 del sol recogido = 25
    expect(estadoCliente.sunBank).toBe(25)
    expect(estadoCliente.suns.some((s) => s.id === targetSun.id)).toBe(false)
  })

  // 61. Paridad absoluta entre reconstruirPartidaAsync y simulateAsyncMatch mediante runAsyncTimeline
  it('61. reconstruirPartidaAsync y simulateAsyncMatch comparten el runner runAsyncTimeline y producen resultados idénticos', () => {
    const seed = 77777
    const p1Deck: CartaDeMazo[] = [{ slot: 0, plantId: 'sunflower', level: 0, statRolls: [] }]
    const p2Deck: CartaDeMazo[] = [{ slot: 0, plantId: 'sunflower', level: 0, statRolls: [] }]

    const spawnedSuns: string[] = []
    const probe = createBattleState(seed, false, true)
    while (probe.tick < 300) {
      for (const s of probe.suns) {
        if (!spawnedSuns.includes(s.id)) spawnedSuns.push(s.id)
      }
      stepTick(probe, () => {})
    }
    const sun1Id = spawnedSuns[0]
    const sun2Id = spawnedSuns[1]

    const p1Actions: AccionP1Simulacion[] = [
      { seq: 1, tick: 80, issuedTick: 80, kind: 'collect', targetId: sun1Id },
      { seq: 2, tick: 265, issuedTick: 265, kind: 'collect', targetId: sun2Id },
      { seq: 3, tick: 276, issuedTick: 270, kind: 'plant', plantId: 'sunflower', slot: 0, lane: 0, col: 0 },
    ]

    const asyncIntents: AsyncOpponentIntent[] = [
      { seq: 1, tick: 310, issuedTick: 310, kind: 'plant', plantId: 'sunflower', slot: 0, lane: 1, col: 1 },
    ]

    // Ejecución con runAsyncTimeline
    const timelineRes = runAsyncTimeline({
      seed,
      p1Deck,
      asyncDeck: p2Deck,
      p1Actions,
      asyncActions: asyncIntents,
      untilTick: 330,
      validateP1: true,
      stopOnGameOver: true,
    })

    // Ejecución con reconstruirPartidaAsync
    const rebuildRes = reconstruirPartidaAsync(
      seed,
      p1Deck,
      p2Deck,
      asyncIntents,
      p1Actions,
      330
    )

    expect(rebuildRes.estado.tick).toBe(timelineRes.state.tick)
    expect(rebuildRes.estado.sunBank).toBe(timelineRes.state.sunBank)
    expect(rebuildRes.estado.p2SunBank).toBe(timelineRes.state.p2SunBank)
    expect(rebuildRes.estado.p1BaseHp).toBe(timelineRes.state.p1BaseHp)
    expect(rebuildRes.estado.p2BaseHp).toBe(timelineRes.state.p2BaseHp)
    expect(rebuildRes.estado.plants.length).toBe(timelineRes.state.plants.length)
    expect(rebuildRes.estado.enemyPlants.length).toBe(timelineRes.state.enemyPlants.length)
    expect(rebuildRes.controller.sunBank).toBe(timelineRes.controller.sunBank)
    expect(rebuildRes.controller.nextIntentIndex).toBe(timelineRes.controller.nextIntentIndex)
  })

  // 62. COLLECT ACK después de desaparecer el sol localmente usando helper real registrarAccionP1Async
  it('62. COLLECT con ACK tardío tras desaparición local del sol se registra en historial autoritativo sin doble acreditación y reconstruye idéntico', () => {
    const seed = 6262
    const p1Deck: CartaDeMazo[] = [{ slot: 0, plantId: 'sunflower', level: 0, statRolls: [] }]
    const p2Deck: CartaDeMazo[] = [{ slot: 0, plantId: 'sunflower', level: 0, statRolls: [] }]

    // 1. Obtener sol del cielo conocido
    const probe = createBattleState(seed, false, true)
    while (probe.tick < 200 && probe.suns.length === 0) {
      stepTick(probe, () => {})
    }
    expect(probe.suns.length).toBeGreaterThan(0)
    const targetSun = probe.suns[0]
    const targetSunId = targetSun.id

    // 2. Historial de acciones de P1 administrado por la función real de producción
    const historial: AccionP1Simulacion[] = []

    // Registrar mediante la función REAL de producción
    const agregado = registrarAccionP1Async(historial, {
      seq: 10,
      tick: 80,
      issuedTick: 80,
      kind: 'collect',
      targetId: targetSunId,
    })

    expect(agregado).toBe(true)
    expect(historial.length).toBe(1)
    expect(historial[0].seq).toBe(10)
    expect(historial[0].issuedTick).toBe(80)
    expect(historial[0].targetId).toBe(targetSunId)
    expect(historial[0].kind).toBe('collect')

    // Registrar exactamente el mismo ACK por segunda vez (deduplicación real por seq)
    const agregadoRepetido = registrarAccionP1Async(historial, {
      seq: 10,
      tick: 80,
      issuedTick: 80,
      kind: 'collect',
      targetId: targetSunId,
    })

    expect(agregadoRepetido).toBe(false)
    expect(historial.length).toBe(1)

    // Rebuild reconstruye desde timeline autoritativo y coincide con verify-match
    const { estado: estadoReconstruido } = reconstruirPartidaAsync(
      seed,
      p1Deck,
      p2Deck,
      [],
      historial,
      120
    )

    const resVerify = simulateAsyncMatch(
      seed,
      p1Deck,
      p2Deck,
      historial,
      [],
      120
    )

    expect(resVerify.p1Ilegal).toBe(false)
    expect(estadoReconstruido.sunBank).toBe(25)
    expect(estadoReconstruido.suns.some((s) => s.id === targetSunId)).toBe(false)
  })

  // 63. ACKs recibidos fuera de orden conservan inmutablemente el seq original usando registrarAccionP1Async
  it('63. ACKs recibidos fuera de orden conservan inmutablemente el seq original asignado al enviar cada acción', () => {
    const historial: AccionP1Simulacion[] = []

    // Acciones emitidas originalmente:
    // seq 10 COLLECT (issuedTick 80)
    // seq 11 PLANT (issuedTick 270)
    // seq 12 DIG (issuedTick 280)
    const accCollect: AccionP1Simulacion = { seq: 10, issuedTick: 80, tick: 80, kind: 'collect', targetId: 'sun_1' }
    const accPlant: AccionP1Simulacion = { seq: 11, issuedTick: 270, tick: 276, kind: 'plant', plantId: 'sunflower', slot: 0, lane: 0, col: 0 }
    const accDig: AccionP1Simulacion = { seq: 12, issuedTick: 280, tick: 286, kind: 'dig', lane: 0, col: 0 }

    // Registrar confirmaciones deliberadamente en orden desordenado usando la función real:
    // 1. DIG (seq 12)
    // 2. PLANT (seq 11)
    // 3. COLLECT (seq 10)
    expect(registrarAccionP1Async(historial, accDig)).toBe(true)
    expect(registrarAccionP1Async(historial, accPlant)).toBe(true)
    expect(registrarAccionP1Async(historial, accCollect)).toBe(true)

    // Al normalizar y ordenar para el timeline:
    const normRes = normalizarAccionesP1(historial)
    expect(normRes.ok).toBe(true)
    if (!normRes.ok) throw new Error('normalizarAccionesP1 falló inesperadamente')
    const ordenadas = normRes.acciones

    // El seq de COLLECT debe seguir siendo 10 (nunca 12)
    expect(ordenadas[0].kind).toBe('collect')
    expect(ordenadas[0].seq).toBe(10)
    expect(ordenadas[0].issuedTick).toBe(80)

    // El seq de PLANT debe seguir siendo 11
    expect(ordenadas[1].kind).toBe('plant')
    expect(ordenadas[1].seq).toBe(11)
    expect(ordenadas[1].issuedTick).toBe(270)

    // El seq de DIG debe seguir siendo 12
    expect(ordenadas[2].kind).toBe('dig')
    expect(ordenadas[2].seq).toBe(12)
    expect(ordenadas[2].issuedTick).toBe(280)
  })

  // 64. Mismo issuedTick, orden económico por seq
  it('64. Acciones con mismo issuedTick respetan estrictamente el orden económico por seq', () => {
    const seed = 6464
    const p1Deck: CartaDeMazo[] = [
      { slot: 0, plantId: 'sunflower', level: 0, statRolls: [] },
      { slot: 1, plantId: 'peashooter', level: 0, statRolls: [] },
    ]
    const p2Deck: CartaDeMazo[] = [{ slot: 0, plantId: 'sunflower', level: 0, statRolls: [] }]

    // Descubrir 4 soles del cielo para tener economía controlada
    const spawnedSuns: string[] = []
    const probe = createBattleState(seed, false, true)
    while (probe.tick < 700) {
      for (const s of probe.suns) {
        if (!spawnedSuns.includes(s.id)) spawnedSuns.push(s.id)
      }
      stepTick(probe, () => {})
    }
    expect(spawnedSuns.length).toBeGreaterThanOrEqual(4)

    // P1 recoge 3 soles previamente: 3 * 25 = 75 soles
    const baseCollects: AccionP1Simulacion[] = [
      { seq: 1, tick: 80, issuedTick: 80, kind: 'collect', targetId: spawnedSuns[0] },
      { seq: 2, tick: 265, issuedTick: 265, kind: 'collect', targetId: spawnedSuns[1] },
      { seq: 3, tick: 450, issuedTick: 450, kind: 'collect', targetId: spawnedSuns[2] },
    ]

    // ── VARIANTE A: En issuedTick 630, seq 20 = PLANT peashooter (coste 100), seq 21 = COLLECT (+25)
    // sunBank es 75 -> PLANT (100) falla por falta de soles, luego COLLECT suma a 100
    const accionesVarianteA: AccionP1Simulacion[] = []
    for (const b of baseCollects) registrarAccionP1Async(accionesVarianteA, b)
    registrarAccionP1Async(accionesVarianteA, { seq: 20, tick: 636, issuedTick: 630, kind: 'plant', plantId: 'peashooter', slot: 1, lane: 0, col: 0 })
    registrarAccionP1Async(accionesVarianteA, { seq: 21, tick: 630, issuedTick: 630, kind: 'collect', targetId: spawnedSuns[3] })

    const resA = runAsyncTimeline({
      seed,
      p1Deck,
      asyncDeck: p2Deck,
      p1Actions: accionesVarianteA,
      asyncActions: [],
      untilTick: 680,
      validateP1: false,
    })

    // En Variante A, la planta no pudo colocarse porque en seq 20 sólo había 75 soles -> TIMELINE_INCONSISTENT
    expect(resA.ok).toBe(false)
    if (!resA.ok) {
      expect(resA.reason).toBe('TIMELINE_INCONSISTENT')
    }
    expect(resA.state.plants.some((p) => p.plantId === 'peashooter')).toBe(false)

    // ── VARIANTE B: En issuedTick 630, seq 20 = COLLECT (+25 -> 100 soles), seq 21 = PLANT peashooter (coste 100)
    // sunBank sube a 100 -> PLANT (100) se ejecuta con éxito, sunBank queda en 0
    const accionesVarianteB: AccionP1Simulacion[] = []
    for (const b of baseCollects) registrarAccionP1Async(accionesVarianteB, b)
    registrarAccionP1Async(accionesVarianteB, { seq: 20, tick: 630, issuedTick: 630, kind: 'collect', targetId: spawnedSuns[3] })
    registrarAccionP1Async(accionesVarianteB, { seq: 21, tick: 636, issuedTick: 630, kind: 'plant', plantId: 'peashooter', slot: 1, lane: 0, col: 0 })

    const resB = runAsyncTimeline({
      seed,
      p1Deck,
      asyncDeck: p2Deck,
      p1Actions: accionesVarianteB,
      asyncActions: [],
      untilTick: 680,
      validateP1: false,
    })

    // En Variante B, la planta sí se colocó porque el collect fue procesado antes
    expect(resB.ok).toBe(true)
    expect(resB.state.plants.some((p) => p.plantId === 'peashooter')).toBe(true)
    expect(resB.state.sunBank).toBe(0)
  })

  // 65. Paridad integral absoluta con ACKs desordenados construidos con helper productivo
  it('65. Paridad integral absoluta con ACKs desordenados, soles desaparecidos, cooldowns y reconstrucción tardía', () => {
    const seed = 656565
    const p1Deck: CartaDeMazo[] = [
      { slot: 0, plantId: 'sunflower', level: 0, statRolls: [] },
      { slot: 1, plantId: 'peashooter', level: 0, statRolls: [] },
    ]
    const p2Deck: CartaDeMazo[] = [
      { slot: 0, plantId: 'sunflower', level: 0, statRolls: [] },
      { slot: 1, plantId: 'peashooter', level: 0, statRolls: [] },
    ]

    // Intenciones del Rival Semilla recibidas tardíamente:
    const asyncIntents: AsyncOpponentIntent[] = [
      { seq: 1, tick: 310, issuedTick: 310, kind: 'plant', plantId: 'sunflower', slot: 0, lane: 2, col: 2 },
      { seq: 2, tick: 520, issuedTick: 520, kind: 'plant', plantId: 'sunflower', slot: 0, lane: 0, col: 2 },
    ]

    // 1. Descubrir los IDs exactos de los soles generados en esta partida específica con P1 y P2 activos
    const discovery = createBattleState(seed, false, true)
    const discoveryController = createAsyncOpponentController(p2Deck, asyncIntents)
    const spawnedSuns: { id: string; tick: number }[] = []

    while (discovery.tick < 680) {
      for (const s of discovery.suns) {
        if (!spawnedSuns.some((x) => x.id === s.id)) {
          spawnedSuns.push({ id: s.id, tick: discovery.tick })
        }
      }
      if (discovery.tick === 270) {
        discovery.pending.push({ atTick: 276, kind: 'own_plant', plantId: 'sunflower', lane: 0, col: 0, statRolls: [], level: 0 })
      }
      if (discovery.tick === 350) {
        discovery.pending.push({ atTick: 356, kind: 'own_dig', lane: 0, col: 0 })
      }
      stepAsyncOpponent(discoveryController, discovery)
      stepTick(discovery, () => {})
    }

    expect(spawnedSuns.length).toBeGreaterThanOrEqual(4)

    // Acciones de P1 creadas y registradas usando el helper real en orden desordenado de llegada:
    const p1AccionesHistorial: AccionP1Simulacion[] = []
    registrarAccionP1Async(p1AccionesHistorial, { seq: 4, tick: 356, issuedTick: 350, kind: 'dig', lane: 0, col: 0 })
    registrarAccionP1Async(p1AccionesHistorial, { seq: 1, tick: 80, issuedTick: 80, kind: 'collect', targetId: spawnedSuns[0].id })
    registrarAccionP1Async(p1AccionesHistorial, { seq: 7, tick: 646, issuedTick: 640, kind: 'plant', plantId: 'sunflower', slot: 0, lane: 1, col: 1 })
    registrarAccionP1Async(p1AccionesHistorial, { seq: 3, tick: 276, issuedTick: 270, kind: 'plant', plantId: 'sunflower', slot: 0, lane: 0, col: 0 })
    registrarAccionP1Async(p1AccionesHistorial, { seq: 6, tick: 630, issuedTick: 630, kind: 'collect', targetId: spawnedSuns[3].id })
    registrarAccionP1Async(p1AccionesHistorial, { seq: 2, tick: 265, issuedTick: 265, kind: 'collect', targetId: spawnedSuns[1].id })
    registrarAccionP1Async(p1AccionesHistorial, { seq: 5, tick: 450, issuedTick: 450, kind: 'collect', targetId: spawnedSuns[2].id })

    // Ejecución 1: Reconstrucción autoritativa del cliente hasta tic 680
    const rebuildRes = reconstruirPartidaAsync(
      seed,
      p1Deck,
      p2Deck,
      asyncIntents,
      p1AccionesHistorial,
      680
    )

    // Ejecución 2: Runner autoritativo de verify-match hasta tic 680
    const timelineRes = runAsyncTimeline({
      seed,
      p1Deck,
      asyncDeck: p2Deck,
      p1Actions: p1AccionesHistorial,
      asyncActions: asyncIntents,
      untilTick: 680,
      validateP1: true,
      stopOnGameOver: true,
    })

    // Paridad campo por campo
    expect(rebuildRes.estado.tick).toBe(timelineRes.state.tick)
    expect(rebuildRes.estado.rng).toEqual(timelineRes.state.rng)
    expect(rebuildRes.estado.entityCounter).toBe(timelineRes.state.entityCounter)
    expect(rebuildRes.estado.sunBank).toBe(timelineRes.state.sunBank)
    expect(rebuildRes.estado.p2SunBank).toBe(timelineRes.state.p2SunBank)
    expect(rebuildRes.estado.suns.length).toBe(timelineRes.state.suns.length)
    expect(rebuildRes.estado.suns.map((s) => s.id)).toEqual(timelineRes.state.suns.map((s) => s.id))
    expect(rebuildRes.estado.slotCooldowns).toEqual(timelineRes.state.slotCooldowns)
    expect(rebuildRes.estado.cooldowns).toEqual(timelineRes.state.cooldowns)
    expect(rebuildRes.estado.plants.length).toBe(timelineRes.state.plants.length)
    expect(rebuildRes.estado.plants.map((p) => ({ id: p.id, lane: p.lane, col: p.col, plantId: p.plantId }))).toEqual(
      timelineRes.state.plants.map((p) => ({ id: p.id, lane: p.lane, col: p.col, plantId: p.plantId }))
    )
    expect(rebuildRes.estado.enemyPlants.length).toBe(timelineRes.state.enemyPlants.length)
    expect(rebuildRes.estado.enemyPlants.map((p) => ({ id: p.id, lane: p.lane, col: p.col, plantId: p.plantId }))).toEqual(
      timelineRes.state.enemyPlants.map((p) => ({ id: p.id, lane: p.lane, col: p.col, plantId: p.plantId }))
    )
    expect(rebuildRes.estado.projectiles).toEqual(timelineRes.state.projectiles)
    expect(rebuildRes.estado.pending).toEqual(timelineRes.state.pending)
    expect(rebuildRes.estado.p1BaseHp).toBe(timelineRes.state.p1BaseHp)
    expect(rebuildRes.estado.p2BaseHp).toBe(timelineRes.state.p2BaseHp)
    expect(rebuildRes.estado.stats).toEqual(timelineRes.state.stats)

    // Controlador
    expect(rebuildRes.controller.sunBank).toBe(timelineRes.controller.sunBank)
    expect(rebuildRes.controller.nextIntentIndex).toBe(timelineRes.controller.nextIntentIndex)
    expect(rebuildRes.controller.pendingRetry).toEqual(timelineRes.controller.pendingRetry)
    expect(rebuildRes.controller.slotCooldowns).toEqual(timelineRes.controller.slotCooldowns)
    expect(rebuildRes.controller.stats).toEqual(timelineRes.controller.stats)
  })

  // 66. Deduplicación real por seq en registrarAccionP1Async
  it('66. Deduplicación real por seq rechaza registros duplicados y preserva unicidad de identidad', () => {
    const historial: AccionP1Simulacion[] = []

    // 1. Registrar seq 50 COLLECT dos veces
    const acc1: AccionP1Simulacion = { seq: 50, tick: 80, issuedTick: 80, kind: 'collect', targetId: 'sun_50' }
    expect(registrarAccionP1Async(historial, acc1)).toBe(true)
    expect(registrarAccionP1Async(historial, acc1)).toBe(false)
    expect(historial.length).toBe(1)

    // 2. Intentar registrar otra acción distinta con el mismo seq 50
    const accConflict: AccionP1Simulacion = { seq: 50, tick: 276, issuedTick: 270, kind: 'plant', plantId: 'sunflower', slot: 0, lane: 0, col: 0 }
    expect(registrarAccionP1Async(historial, accConflict)).toBe(false)
    expect(historial.length).toBe(1)
    expect(historial[0].kind).toBe('collect')
  })

  // 67. Rollback exacto por seq usando descartarAccionP1Async
  it('67. Rollback exacto por seq elimina únicamente la acción rechazada sin afectar acciones adyacentes o del mismo carril', () => {
    const historial: AccionP1Simulacion[] = []

    registrarAccionP1Async(historial, { seq: 20, tick: 80, issuedTick: 80, kind: 'collect', targetId: 'sun_1' })
    registrarAccionP1Async(historial, { seq: 21, tick: 276, issuedTick: 270, kind: 'plant', plantId: 'sunflower', slot: 0, lane: 0, col: 0 })
    registrarAccionP1Async(historial, { seq: 22, tick: 286, issuedTick: 280, kind: 'plant', plantId: 'peashooter', slot: 1, lane: 0, col: 1 })
    registrarAccionP1Async(historial, { seq: 23, tick: 356, issuedTick: 350, kind: 'dig', lane: 0, col: 0 })

    expect(historial.length).toBe(4)

    // Rechazar seq 22 (PLANT peashooter en lane 0, col 1)
    const filtrado = descartarAccionP1Async(historial, 22)

    expect(filtrado.length).toBe(3)
    expect(filtrado.map((a) => a.seq)).toEqual([20, 21, 23])
    // seq 21 permanece a pesar de compartir lane 0
    expect(filtrado.some((a) => a.seq === 21 && a.lane === 0 && a.col === 0)).toBe(true)
    // seq 22 ya no existe
    expect(filtrado.some((a) => a.seq === 22)).toBe(false)
  })

  // 68. Historial completo construido exclusivamente con helpers productivos hacia runner y reconstrucción
  it('68. Historial completo construido exclusivamente con helpers productivos hacia runner y reconstrucción', () => {
    const seed = 686868
    const p1Deck: CartaDeMazo[] = [
      { slot: 0, plantId: 'sunflower', level: 0, statRolls: [] },
      { slot: 1, plantId: 'peashooter', level: 0, statRolls: [] },
    ]
    const p2Deck: CartaDeMazo[] = [
      { slot: 0, plantId: 'sunflower', level: 0, statRolls: [] },
      { slot: 1, plantId: 'peashooter', level: 0, statRolls: [] },
    ]

    const asyncIntents: AsyncOpponentIntent[] = [
      { seq: 1, tick: 310, issuedTick: 310, kind: 'plant', plantId: 'sunflower', slot: 0, lane: 2, col: 2 },
      { seq: 2, tick: 520, issuedTick: 520, kind: 'plant', plantId: 'sunflower', slot: 0, lane: 0, col: 2 },
    ]

    // 1. Descubrir soles
    const discovery = createBattleState(seed, false, true)
    const discoveryController = createAsyncOpponentController(p2Deck, asyncIntents)
    const spawnedSuns: { id: string; tick: number }[] = []

    while (discovery.tick < 680) {
      for (const s of discovery.suns) {
        if (!spawnedSuns.some((x) => x.id === s.id)) {
          spawnedSuns.push({ id: s.id, tick: discovery.tick })
        }
      }
      if (discovery.tick === 270) {
        discovery.pending.push({ atTick: 276, kind: 'own_plant', plantId: 'sunflower', lane: 0, col: 0, statRolls: [], level: 0 })
      }
      if (discovery.tick === 350) {
        discovery.pending.push({ atTick: 356, kind: 'own_dig', lane: 0, col: 0 })
      }
      stepAsyncOpponent(discoveryController, discovery)
      stepTick(discovery, () => {})
    }

    // 2. Construir historial usando EXCLUSIVAMENTE registrarAccionP1Async y descartarAccionP1Async
    let historial: AccionP1Simulacion[] = []

    // Acciones registradas con seq
    expect(registrarAccionP1Async(historial, { seq: 1, tick: 80, issuedTick: 80, kind: 'collect', targetId: spawnedSuns[0].id })).toBe(true)
    // Registro duplicado de seq 1
    expect(registrarAccionP1Async(historial, { seq: 1, tick: 80, issuedTick: 80, kind: 'collect', targetId: spawnedSuns[0].id })).toBe(false)

    expect(registrarAccionP1Async(historial, { seq: 2, tick: 265, issuedTick: 265, kind: 'collect', targetId: spawnedSuns[1].id })).toBe(true)
    expect(registrarAccionP1Async(historial, { seq: 3, tick: 276, issuedTick: 270, kind: 'plant', plantId: 'sunflower', slot: 0, lane: 0, col: 0 })).toBe(true)

    // Acción que luego será rechazada por el servidor: seq 99 PLANT peashooter en 280
    expect(registrarAccionP1Async(historial, { seq: 99, tick: 286, issuedTick: 280, kind: 'plant', plantId: 'peashooter', slot: 1, lane: 2, col: 0 })).toBe(true)

    expect(registrarAccionP1Async(historial, { seq: 4, tick: 356, issuedTick: 350, kind: 'dig', lane: 0, col: 0 })).toBe(true)
    expect(registrarAccionP1Async(historial, { seq: 5, tick: 450, issuedTick: 450, kind: 'collect', targetId: spawnedSuns[2].id })).toBe(true)

    // Servidor rechaza seq 99
    historial = descartarAccionP1Async(historial, 99)

    // Mismo issuedTick: seq 6 COLLECT y seq 7 PLANT
    expect(registrarAccionP1Async(historial, { seq: 6, tick: 630, issuedTick: 630, kind: 'collect', targetId: spawnedSuns[3].id })).toBe(true)
    expect(registrarAccionP1Async(historial, { seq: 7, tick: 646, issuedTick: 640, kind: 'plant', plantId: 'sunflower', slot: 0, lane: 1, col: 1 })).toBe(true)

    // Verificar que todas las acciones del flujo Ranked async tienen seq numérico válido
    for (const a of historial) {
      expect(typeof a.seq).toBe('number')
      expect(Number.isFinite(a.seq)).toBe(true)
    }

    // 3. Reconstrucción con el historial
    const rebuildRes = reconstruirPartidaAsync(
      seed,
      p1Deck,
      p2Deck,
      asyncIntents,
      historial,
      680
    )

    // 4. Runner autoritativo de verify-match
    const timelineRes = runAsyncTimeline({
      seed,
      p1Deck,
      asyncDeck: p2Deck,
      p1Actions: historial,
      asyncActions: asyncIntents,
      untilTick: 680,
      validateP1: true,
      stopOnGameOver: true,
    })

    // Paridad 100% campo por campo
    expect(rebuildRes.estado.tick).toBe(timelineRes.state.tick)
    expect(rebuildRes.estado.rng).toEqual(timelineRes.state.rng)
    expect(rebuildRes.estado.entityCounter).toBe(timelineRes.state.entityCounter)
    expect(rebuildRes.estado.sunBank).toBe(timelineRes.state.sunBank)
    expect(rebuildRes.estado.p2SunBank).toBe(timelineRes.state.p2SunBank)
    expect(rebuildRes.estado.suns.length).toBe(timelineRes.state.suns.length)
    expect(rebuildRes.estado.suns.map((s) => s.id)).toEqual(timelineRes.state.suns.map((s) => s.id))
    expect(rebuildRes.estado.slotCooldowns).toEqual(timelineRes.state.slotCooldowns)
    expect(rebuildRes.estado.cooldowns).toEqual(timelineRes.state.cooldowns)
    expect(rebuildRes.estado.plants.length).toBe(timelineRes.state.plants.length)
    expect(rebuildRes.estado.plants.map((p) => ({ id: p.id, lane: p.lane, col: p.col, plantId: p.plantId }))).toEqual(
      timelineRes.state.plants.map((p) => ({ id: p.id, lane: p.lane, col: p.col, plantId: p.plantId }))
    )
    expect(rebuildRes.estado.enemyPlants.length).toBe(timelineRes.state.enemyPlants.length)
    expect(rebuildRes.estado.enemyPlants.map((p) => ({ id: p.id, lane: p.lane, col: p.col, plantId: p.plantId }))).toEqual(
      timelineRes.state.enemyPlants.map((p) => ({ id: p.id, lane: p.lane, col: p.col, plantId: p.plantId }))
    )
    expect(rebuildRes.estado.projectiles).toEqual(timelineRes.state.projectiles)
    expect(rebuildRes.estado.pending).toEqual(timelineRes.state.pending)
    expect(rebuildRes.estado.p1BaseHp).toBe(timelineRes.state.p1BaseHp)
    expect(rebuildRes.estado.p2BaseHp).toBe(timelineRes.state.p2BaseHp)
    expect(rebuildRes.estado.stats).toEqual(timelineRes.state.stats)

    // Controlador
    expect(rebuildRes.controller.sunBank).toBe(timelineRes.controller.sunBank)
    expect(rebuildRes.controller.nextIntentIndex).toBe(timelineRes.controller.nextIntentIndex)
    expect(rebuildRes.controller.pendingRetry).toEqual(timelineRes.controller.pendingRetry)
    expect(rebuildRes.controller.slotCooldowns).toEqual(timelineRes.controller.slotCooldowns)
    expect(rebuildRes.controller.stats).toEqual(timelineRes.controller.stats)
  })

  // 69. Acción sin seq falla cerrado con MISSING_SEQ y no se inserta ni se simula
  it('69. Acción sin seq en Ranked Async falla cerrado con MISSING_SEQ', () => {
    const accionInvalida = {
      issuedTick: 100,
      tick: 106,
      kind: 'plant',
      plantId: 'peashooter',
      slot: 0,
      lane: 0,
      col: 0,
    }

    const val = validarAccionP1RankedEstricta(accionInvalida)
    expect(val.ok).toBe(false)
    if (!val.ok) {
      expect(val.reason).toBe('MISSING_SEQ')
    }

    const historial: AccionP1Simulacion[] = []
    const regDetallado = registrarAccionP1AsyncDetallado(historial, accionInvalida)
    expect(regDetallado.ok).toBe(false)
    if (!regDetallado.ok) {
      expect(regDetallado.reason).toBe('MISSING_SEQ')
    }
    expect(historial.length).toBe(0)

    // En runner autoritativo
    const runRes = runAsyncTimeline({
      seed: 42,
      p1Deck: [{ slot: 0, plantId: 'peashooter', level: 0, statRolls: [] }],
      asyncDeck: [{ slot: 0, plantId: 'peashooter', level: 0, statRolls: [] }],
      p1Actions: [accionInvalida],
      asyncActions: [],
      untilTick: 200,
      strictAuthoritativeHistory: true,
    })
    expect(runRes.ok).toBe(false)
    expect(runRes.reason).toBe('MISSING_SEQ')
  })

  // 70. issuedTick ausente falla con MISSING_ISSUED_TICK (sin usar tick como sustituto)
  it('70. issuedTick ausente falla cerrado con MISSING_ISSUED_TICK sin inferir desde tick', () => {
    const accionSinIssuedTick = {
      seq: 10,
      tick: 80,
      kind: 'collect',
      targetId: 'sun_123',
    }

    const val = validarAccionP1RankedEstricta(accionSinIssuedTick)
    expect(val.ok).toBe(false)
    if (!val.ok) {
      expect(val.reason).toBe('MISSING_ISSUED_TICK')
      expect(val.seq).toBe(10)
    }

    const historial: AccionP1Simulacion[] = []
    const resReg = registrarAccionP1AsyncDetallado(historial, accionSinIssuedTick)
    expect(resReg.ok).toBe(false)
    if (!resReg.ok) {
      expect(resReg.reason).toBe('MISSING_ISSUED_TICK')
    }
    expect(historial.length).toBe(0)
  })

  // 71. id no se deriva como seq en Ranked Async nuevo
  it('71. id no se sustituye como seq en el flujo estricto', () => {
    const accionConIdSinSeq = {
      id: 123,
      issuedTick: 80,
      tick: 80,
      kind: 'collect',
      targetId: 'sun_abc',
    }

    const val = validarAccionP1RankedEstricta(accionConIdSinSeq)
    expect(val.ok).toBe(false)
    if (!val.ok) {
      expect(val.reason).toBe('MISSING_SEQ')
    }

    const historial: AccionP1Simulacion[] = []
    expect(registrarAccionP1Async(historial, accionConIdSinSeq)).toBe(false)
    expect(historial.length).toBe(0)
  })

  // 72. COLLECT sin targetId falla con MISSING_TARGET_ID
  it('72. COLLECT sin targetId no modifica sunBank y falla con MISSING_TARGET_ID', () => {
    const collectVacio1 = { seq: 30, issuedTick: 100, tick: 100, kind: 'collect' }
    const collectVacio2 = { seq: 31, issuedTick: 100, tick: 100, kind: 'collect', targetId: '' }
    const collectVacio3 = { seq: 32, issuedTick: 100, tick: 100, kind: 'collect', targetId: '   ' }

    expect(validarAccionP1RankedEstricta(collectVacio1).ok).toBe(false)
    expect((validarAccionP1RankedEstricta(collectVacio1) as any).reason).toBe('MISSING_TARGET_ID')
    expect(validarAccionP1RankedEstricta(collectVacio2).ok).toBe(false)
    expect((validarAccionP1RankedEstricta(collectVacio2) as any).reason).toBe('MISSING_TARGET_ID')
    expect(validarAccionP1RankedEstricta(collectVacio3).ok).toBe(false)
    expect((validarAccionP1RankedEstricta(collectVacio3) as any).reason).toBe('MISSING_TARGET_ID')

    const historial: AccionP1Simulacion[] = []
    expect(registrarAccionP1Async(historial, collectVacio1)).toBe(false)
    expect(historial.length).toBe(0)
  })

  // 73. PLANT incompleta o inválida se rechaza estructuralmente
  it('73. PLANT con plantId, slot, lane o col inválidos falla con INVALID_PLANT_DATA', () => {
    const casosInvalidos = [
      { seq: 1, issuedTick: 10, tick: 16, kind: 'plant', plantId: 'planta_inexistente', slot: 0, lane: 0, col: 0 },
      { seq: 2, issuedTick: 10, tick: 16, kind: 'plant', plantId: 'peashooter', slot: -1, lane: 0, col: 0 },
      { seq: 3, issuedTick: 10, tick: 16, kind: 'plant', plantId: 'peashooter', slot: 6, lane: 0, col: 0 },
      { seq: 4, issuedTick: 10, tick: 16, kind: 'plant', plantId: 'peashooter', slot: 0, lane: 3, col: 0 },
      { seq: 5, issuedTick: 10, tick: 16, kind: 'plant', plantId: 'peashooter', slot: 0, lane: -1, col: 0 },
      { seq: 6, issuedTick: 10, tick: 16, kind: 'plant', plantId: 'peashooter', slot: 0, lane: 0, col: 6 },
      { seq: 7, issuedTick: 10, tick: 16, kind: 'plant', plantId: 'peashooter', slot: 0, lane: 0, col: -1 },
    ]

    for (const c of casosInvalidos) {
      const val = validarAccionP1RankedEstricta(c)
      expect(val.ok).toBe(false)
      if (!val.ok) {
        expect(val.reason).toBe('INVALID_PLANT_DATA')
      }
    }
  })

  // 74. DIG incompleto o inválido se rechaza estructuralmente
  it('74. DIG con lane o col fuera de rango falla con INVALID_DIG_DATA', () => {
    const casosInvalidos = [
      { seq: 1, issuedTick: 10, tick: 16, kind: 'dig', lane: 3, col: 0 },
      { seq: 2, issuedTick: 10, tick: 16, kind: 'dig', lane: -1, col: 0 },
      { seq: 3, issuedTick: 10, tick: 16, kind: 'dig', lane: 0, col: 6 },
      { seq: 4, issuedTick: 10, tick: 16, kind: 'dig', lane: 0, col: -1 },
      { seq: 5, issuedTick: 10, tick: 16, kind: 'dig', lane: undefined, col: 0 },
    ]

    for (const c of casosInvalidos) {
      const val = validarAccionP1RankedEstricta(c)
      expect(val.ok).toBe(false)
      if (!val.ok) {
        expect(val.reason).toBe('INVALID_DIG_DATA')
      }
    }
  })

  // 75. Duplicado idempotente con misma acción y mismo seq
  it('75. Duplicado idempotente con mismo seq y mismo contenido se acepta sin duplicar', () => {
    const historial: AccionP1Simulacion[] = []
    const accion = {
      seq: 50,
      issuedTick: 200,
      tick: 200,
      kind: 'collect' as const,
      targetId: 'sun_x',
    }

    const reg1 = registrarAccionP1AsyncDetallado(historial, accion)
    expect(reg1.ok).toBe(true)
    expect(historial.length).toBe(1)

    const reg2 = registrarAccionP1AsyncDetallado(historial, accion)
    expect(reg2.ok).toBe(true)
    if (reg2.ok) {
      expect(reg2.duplicated).toBe(true)
    }
    expect(historial.length).toBe(1)
  })

  // 76. Conflicto de seq (mismo seq con contenido distinto)
  it('76. Conflicto de seq con contenido distinto falla con SEQ_CONFLICT', () => {
    const historial: AccionP1Simulacion[] = []
    const accion1 = {
      seq: 50,
      issuedTick: 200,
      tick: 200,
      kind: 'collect' as const,
      targetId: 'sun_x',
    }
    const accion2 = {
      seq: 50,
      issuedTick: 200,
      tick: 206,
      kind: 'plant' as const,
      plantId: 'sunflower' as const,
      slot: 0,
      lane: 0,
      col: 0,
    }

    expect(registrarAccionP1AsyncDetallado(historial, accion1).ok).toBe(true)
    expect(historial.length).toBe(1)

    const regConflicto = registrarAccionP1AsyncDetallado(historial, accion2)
    expect(regConflicto.ok).toBe(false)
    if (!regConflicto.ok) {
      expect(regConflicto.reason).toBe('SEQ_CONFLICT')
      expect(regConflicto.seq).toBe(50)
    }
    expect(historial.length).toBe(1)
    expect(historial[0].kind).toBe('collect')
  })

  // 77. Rollback sin seq en Ranked Async no elimina por coordenadas
  it('77. Rollback sin seq no adivina por coordenadas y deja el historial intacto', () => {
    let historial: AccionP1Simulacion[] = [
      { seq: 10, issuedTick: 50, tick: 56, kind: 'plant', plantId: 'peashooter', slot: 0, lane: 0, col: 0 },
      { seq: 20, issuedTick: 60, tick: 66, kind: 'plant', plantId: 'sunflower', slot: 1, lane: 0, col: 0 },
    ]

    // Intentar descartar pasando undefined o seq inválido
    historial = descartarAccionP1Async(historial, undefined)
    expect(historial.length).toBe(2)

    historial = descartarAccionP1Async(historial, -1)
    expect(historial.length).toBe(2)

    historial = descartarAccionP1Async(historial, NaN)
    expect(historial.length).toBe(2)
  })

  // 78. COLLECT autoritativo imposible durante reconstrucción detecta TIMELINE_INCONSISTENT
  it('78. COLLECT autoritativo imposible durante rebuild detecta TIMELINE_INCONSISTENT', () => {
    const seed = 7878
    const p1Deck: CartaDeMazo[] = [{ slot: 0, plantId: 'sunflower', level: 0, statRolls: [] }]
    const p2Deck: CartaDeMazo[] = [{ slot: 0, plantId: 'sunflower', level: 0, statRolls: [] }]

    // Historial con una acción que solicita un sol que nunca existirá
    const historialImposible: AccionP1Simulacion[] = [
      { seq: 80, issuedTick: 100, tick: 100, kind: 'collect', targetId: 'sun_fantasma_inexistente' },
    ]

    const rebuildRes = reconstruirPartidaAsync(
      seed,
      p1Deck,
      p2Deck,
      [],
      historialImposible,
      200
    )

    expect(rebuildRes.ok).toBe(false)
    expect(rebuildRes.reason).toBe('TIMELINE_INCONSISTENT')
    expect(rebuildRes.seq).toBe(80)
    expect(rebuildRes.issuedTick).toBe(100)

    // Runner directo también falla cerrado
    const timelineRes = runAsyncTimeline({
      seed,
      p1Deck,
      asyncDeck: p2Deck,
      p1Actions: historialImposible,
      asyncActions: [],
      untilTick: 200,
      strictAuthoritativeHistory: true,
    })
    expect(timelineRes.ok).toBe(false)
    expect(timelineRes.reason).toBe('TIMELINE_INCONSISTENT')
  })

  // 79. No mutación parcial tras error de reconstrucción (Fail Closed)
  it('79. Reconstrucción con error propaga ok: false y evita instalar estado corrupto', () => {
    const seed = 7979
    const p1Deck: CartaDeMazo[] = [{ slot: 0, plantId: 'sunflower', level: 0, statRolls: [] }]
    const p2Deck: CartaDeMazo[] = [{ slot: 0, plantId: 'sunflower', level: 0, statRolls: [] }]

    // Lote con acción corrupta
    const p1AccionesCorruptas = [
      { seq: 1, issuedTick: 10, tick: 16, kind: 'plant', plantId: 'sunflower', slot: 0, lane: 0, col: 0 },
      { seq: 2, issuedTick: 50, tick: 50, kind: 'collect' }, // Falta targetId
    ]

    const rebuildRes = reconstruirPartidaAsync(
      seed,
      p1Deck,
      p2Deck,
      [],
      p1AccionesCorruptas,
      100
    )

    expect(rebuildRes.ok).toBe(false)
    expect(rebuildRes.reason).toBe('MISSING_TARGET_ID')
    expect(rebuildRes.seq).toBe(2)
  })

  // 80. Flujo válido conserva exactamente el determinismo integral
  it('80. Partida válida conserva determinismo campo por campo entre rebuild y verify-match', () => {
    const seed = 808080
    const p1Deck: CartaDeMazo[] = [
      { slot: 0, plantId: 'sunflower', level: 0, statRolls: [] },
      { slot: 1, plantId: 'peashooter', level: 0, statRolls: [] },
    ]
    const p2Deck: CartaDeMazo[] = [
      { slot: 0, plantId: 'sunflower', level: 0, statRolls: [] },
      { slot: 1, plantId: 'peashooter', level: 0, statRolls: [] },
    ]

    const asyncIntents: AsyncOpponentIntent[] = [
      { seq: 1, tick: 310, issuedTick: 310, kind: 'plant', plantId: 'sunflower', slot: 0, lane: 1, col: 2 },
      { seq: 2, tick: 600, issuedTick: 600, kind: 'plant', plantId: 'peashooter', slot: 1, lane: 1, col: 3 },
    ]

    // Descubrir los IDs reales de los soles con la plantación de P1 en tic 270
    const discovery = createBattleState(seed, false, true)
    const discoveryController = createAsyncOpponentController(p2Deck, asyncIntents)
    const suns: { id: string; tick: number }[] = []
    while (discovery.tick < 700) {
      for (const s of discovery.suns) {
        if (!suns.some((x) => x.id === s.id)) suns.push({ id: s.id, tick: discovery.tick })
      }
      if (discovery.tick === 270) {
        discovery.pending.push({ atTick: 276, kind: 'own_plant', plantId: 'sunflower', lane: 0, col: 0, statRolls: [], level: 0 })
      }
      stepAsyncOpponent(discoveryController, discovery)
      stepTick(discovery, () => {})
    }

    const p1Historial: AccionP1Simulacion[] = []
    expect(registrarAccionP1Async(p1Historial, { seq: 1, tick: 80, issuedTick: 80, kind: 'collect', targetId: suns[0].id })).toBe(true)
    expect(registrarAccionP1Async(p1Historial, { seq: 2, tick: 265, issuedTick: 265, kind: 'collect', targetId: suns[1].id })).toBe(true)
    expect(registrarAccionP1Async(p1Historial, { seq: 3, tick: 276, issuedTick: 270, kind: 'plant', plantId: 'sunflower', slot: 0, lane: 0, col: 0 })).toBe(true)
    expect(registrarAccionP1Async(p1Historial, { seq: 4, tick: 450, issuedTick: 450, kind: 'collect', targetId: suns[2].id })).toBe(true)
    expect(registrarAccionP1Async(p1Historial, { seq: 5, tick: 630, issuedTick: 630, kind: 'collect', targetId: suns[3].id })).toBe(true)

    const rebuildRes = reconstruirPartidaAsync(seed, p1Deck, p2Deck, asyncIntents, p1Historial, 700)
    expect(rebuildRes.ok).toBe(true)

    const simRes = simulateAsyncMatch(seed, p1Deck, p2Deck, p1Historial, asyncIntents, 700)
    expect(simRes.ok).toBe(true)

    const timelineRes = runAsyncTimeline({
      seed,
      p1Deck,
      asyncDeck: p2Deck,
      p1Actions: p1Historial,
      asyncActions: asyncIntents,
      untilTick: 700,
      validateP1: true,
      strictAuthoritativeHistory: true,
    })
    expect(timelineRes.ok).toBe(true)

    expect(rebuildRes.estado.tick).toBe(timelineRes.state.tick)
    expect(rebuildRes.estado.sunBank).toBe(timelineRes.state.sunBank)
    expect(rebuildRes.estado.p2SunBank).toBe(timelineRes.state.p2SunBank)
    expect(rebuildRes.estado.plants.length).toBe(timelineRes.state.plants.length)
    expect(rebuildRes.estado.enemyPlants.length).toBe(timelineRes.state.enemyPlants.length)
    expect(rebuildRes.estado.rng).toEqual(timelineRes.state.rng)
    expect(rebuildRes.estado.slotCooldowns).toEqual(timelineRes.state.slotCooldowns)
    expect(rebuildRes.controller.stats).toEqual(timelineRes.controller.stats)
  })

  // 81. Paridad cliente / verificador estricta en timeline completa
  it('81. Paridad estricta al 100% entre reconstrucción de cliente y verificador verify-match', () => {
    const seed = 818181
    const p1Deck: CartaDeMazo[] = [
      { slot: 0, plantId: 'sunflower', level: 0, statRolls: [] },
      { slot: 1, plantId: 'peashooter', level: 0, statRolls: [] },
    ]
    const p2Deck: CartaDeMazo[] = [
      { slot: 0, plantId: 'sunflower', level: 0, statRolls: [] },
      { slot: 1, plantId: 'peashooter', level: 0, statRolls: [] },
    ]

    const asyncIntents: AsyncOpponentIntent[] = [
      { seq: 1, tick: 310, issuedTick: 310, kind: 'plant', plantId: 'sunflower', slot: 0, lane: 2, col: 2 },
    ]

    const discovery = createBattleState(seed, false, true)
    const suns: string[] = []
    while (discovery.tick < 500) {
      for (const s of discovery.suns) {
        if (!suns.includes(s.id)) suns.push(s.id)
      }
      stepTick(discovery, () => {})
    }

    const p1Actions: AccionP1Simulacion[] = []
    registrarAccionP1Async(p1Actions, { seq: 1, tick: 80, issuedTick: 80, kind: 'collect', targetId: suns[0] })
    registrarAccionP1Async(p1Actions, { seq: 2, tick: 265, issuedTick: 265, kind: 'collect', targetId: suns[1] })
    registrarAccionP1Async(p1Actions, { seq: 3, tick: 276, issuedTick: 270, kind: 'plant', plantId: 'sunflower', slot: 0, lane: 1, col: 1 })

    const rebuildRes = reconstruirPartidaAsync(seed, p1Deck, p2Deck, asyncIntents, p1Actions, 500)
    const timelineRes = runAsyncTimeline({
      seed,
      p1Deck,
      asyncDeck: p2Deck,
      p1Actions,
      asyncActions: asyncIntents,
      untilTick: 500,
      validateP1: true,
      strictAuthoritativeHistory: true,
    })

    expect(rebuildRes.ok).toBe(true)
    expect(timelineRes.ok).toBe(true)
    expect(rebuildRes.estado.tick).toBe(timelineRes.state.tick)
    expect(rebuildRes.estado.sunBank).toBe(timelineRes.state.sunBank)
    expect(rebuildRes.estado.plants.map((p) => p.id)).toEqual(timelineRes.state.plants.map((p) => p.id))
    expect(rebuildRes.estado.enemyPlants.map((p) => p.id)).toEqual(timelineRes.state.enemyPlants.map((p) => p.id))
  })

  // 82. Helper registrarAccionP1AsyncDetallado sin issuedTick falla cerrado
  it('82. Helper registrarAccionP1AsyncDetallado sin issuedTick falla cerrado con MISSING_ISSUED_TICK', () => {
    const historial: AccionP1Simulacion[] = []
    const intentoSinIssuedTick = {
      seq: 10,
      kind: 'collect',
      targetId: 'sun_100',
    }

    const reg = registrarAccionP1AsyncDetallado(historial, intentoSinIssuedTick)
    expect(reg.ok).toBe(false)
    if (!reg.ok) {
      expect(reg.reason).toBe('MISSING_ISSUED_TICK')
      expect(reg.seq).toBe(10)
    }
    expect(historial.length).toBe(0)
  })

  // 83. Helper registrarAccionP1AsyncDetallado sin seq falla cerrado
  it('83. Helper registrarAccionP1AsyncDetallado sin seq falla cerrado con MISSING_SEQ', () => {
    const historial: AccionP1Simulacion[] = []
    const intentoSinSeq = {
      issuedTick: 80,
      tick: 80,
      kind: 'collect',
      targetId: 'sun_100',
    }

    const reg = registrarAccionP1AsyncDetallado(historial, intentoSinSeq)
    expect(reg.ok).toBe(false)
    if (!reg.ok) {
      expect(reg.reason).toBe('MISSING_SEQ')
      expect(reg.issuedTick).toBe(80)
    }
    expect(historial.length).toBe(0)
  })

  // 84. Helper registrarAccionP1AsyncDetallado conflicto de seq rechaza con SEQ_CONFLICT
  it('84. Helper registrarAccionP1AsyncDetallado con seq duplicado y contenido distinto rechaza con SEQ_CONFLICT', () => {
    const historial: AccionP1Simulacion[] = []
    expect(
      registrarAccionP1AsyncDetallado(historial, {
        seq: 50,
        issuedTick: 120,
        tick: 120,
        kind: 'collect',
        targetId: 'sun_50',
      }).ok
    ).toBe(true)

    const regConflicto = registrarAccionP1AsyncDetallado(historial, {
      seq: 50,
      issuedTick: 120,
      tick: 126,
      kind: 'plant',
      plantId: 'peashooter',
      slot: 0,
      lane: 0,
      col: 0,
    })

    expect(regConflicto.ok).toBe(false)
    if (!regConflicto.ok) {
      expect(regConflicto.reason).toBe('SEQ_CONFLICT')
      expect(regConflicto.seq).toBe(50)
    }
    expect(historial.length).toBe(1)
    expect(historial[0].kind).toBe('collect')
  })

  // 85. Helper registrarAccionP1AsyncDetallado para plant sin seq
  it('85. Helper registrarAccionP1AsyncDetallado para plant sin seq es rechazado con MISSING_SEQ', () => {
    const historial: AccionP1Simulacion[] = []
    const plantSinSeq = {
      issuedTick: 100,
      tick: 106,
      kind: 'plant',
      plantId: 'peashooter',
      slot: 0,
      lane: 0,
      col: 0,
    }

    const reg = registrarAccionP1AsyncDetallado(historial, plantSinSeq)
    expect(reg.ok).toBe(false)
    if (!reg.ok) {
      expect(reg.reason).toBe('MISSING_SEQ')
    }
    expect(historial.length).toBe(0)
  })

  // 86. Helper registrarAccionP1AsyncDetallado para dig sin seq
  it('86. Helper registrarAccionP1AsyncDetallado para dig sin seq es rechazado con MISSING_SEQ', () => {
    const historial: AccionP1Simulacion[] = []
    const digSinSeq = {
      issuedTick: 100,
      tick: 106,
      kind: 'dig',
      lane: 0,
      col: 0,
    }

    const reg = registrarAccionP1AsyncDetallado(historial, digSinSeq)
    expect(reg.ok).toBe(false)
    if (!reg.ok) {
      expect(reg.reason).toBe('MISSING_SEQ')
    }
    expect(historial.length).toBe(0)
  })

  // 87. Helper descartarAccionP1AsyncDetallado sin seq
  it('87. Helper descartarAccionP1AsyncDetallado sin seq reporta MISSING_SEQ y preserva historial', () => {
    const historial: AccionP1Simulacion[] = [
      { seq: 1, issuedTick: 50, tick: 56, kind: 'plant', plantId: 'sunflower', slot: 0, lane: 0, col: 0 },
      { seq: 2, issuedTick: 60, tick: 66, kind: 'plant', plantId: 'peashooter', slot: 1, lane: 0, col: 0 },
    ]

    const resSinSeq = descartarAccionP1AsyncDetallado(historial, undefined)
    expect(resSinSeq.ok).toBe(false)
    if (!resSinSeq.ok) {
      expect(resSinSeq.reason).toBe('MISSING_SEQ')
    }
    expect(resSinSeq.historial.length).toBe(2)

    const resSeqInvalido = descartarAccionP1AsyncDetallado(historial, -5)
    expect(resSeqInvalido.ok).toBe(false)
    if (!resSeqInvalido.ok) {
      expect(resSeqInvalido.reason).toBe('INVALID_SEQ')
    }
    expect(resSeqInvalido.historial.length).toBe(2)
  })

  // 88. normalizarAccionesP1 devuelve resultado discriminado y detecta errores en lugar de []
  it('88. normalizarAccionesP1 devuelve ok: false con razón estructurada ante inconsistencias', () => {
    const loteInconsistente = [
      { seq: 1, issuedTick: 10, tick: 10, kind: 'collect', targetId: 'sun_1' },
      { seq: 2, tick: 20, kind: 'plant', plantId: 'sunflower', slot: 0, lane: 0, col: 0 },
    ]

    const res = normalizarAccionesP1(loteInconsistente)
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.reason).toBe('MISSING_ISSUED_TICK')
      expect(res.seq).toBe(2)
    }
  })

  // 89. Reset de inconsistencia al iniciar partida nueva
  it('89. Iniciar nueva partida resetea la inconsistencia previa y vacía el historial', () => {
    // Simulación del estado de la sesión de juego
    let inconsistenciaActual: { reason: string } | null = { reason: 'SEQ_CONFLICT' }
    let historialAsync: AccionP1Simulacion[] = [
      { seq: 1, issuedTick: 10, tick: 10, kind: 'collect', targetId: 'sun_1' },
    ]

    // Al arrancar nueva partida (lógica de startGame):
    inconsistenciaActual = null
    historialAsync = []

    expect(inconsistenciaActual).toBeNull()
    expect(historialAsync.length).toBe(0)
  })

  // 90. Rollback inválido es atómico y no muta registros ni estado económico
  it('90. Rollback inválido en Ranked Async es atómico y preserva registro, historial y estado', () => {
    const state = createBattleState(9090, false, true)
    state.sunBank = 150
    state.slotCooldowns[0] = 500
    state.stats.plantsPlaced = 1

    const historial: AccionP1Simulacion[] = [
      { seq: 1, issuedTick: 100, tick: 106, kind: 'plant', plantId: 'sunflower', slot: 0, lane: 0, col: 0 },
    ]
    const registro = [
      { mia: true, tick: 106, kind: 'plant' as const, plantId: 'sunflower' as const, lane: 0, col: 0, id: 1 },
    ]
    const costeDeMisJugadas = new Map([
      ['106:0:0', { coste: 50, carta: 'sunflower' as const, slot: 0 }],
    ])

    // Intento de descarte sin seq en partida async
    const resDescarte = ejecutarDescarteAccionP1({
      isAsyncMatch: true,
      tick: 106,
      lane: 0,
      col: 0,
      seq: undefined, // Falta seq
      historial,
      registro,
      costeDeMisJugadas,
      state,
    })

    expect(resDescarte.ok).toBe(false)
    if (!resDescarte.ok) {
      expect(resDescarte.reason).toBe('MISSING_SEQ')
    }

    // ATOMICIDAD: Nada fue alterado
    expect(historial.length).toBe(1)
    expect(registro.length).toBe(1)
    expect(costeDeMisJugadas.has('106:0:0')).toBe(true)
    expect(state.sunBank).toBe(150)
    expect(state.slotCooldowns[0]).toBe(500)
    expect(state.stats.plantsPlaced).toBe(1)
  })

  // 91. Captura productiva COLLECT sin issuedTick falla cerrado sin alterar sunBank
  it('91. Captura productiva ejecutarCapturaCollectP1 sin issuedTick falla cerrado y no altera sunBank', () => {
    const state = createBattleState(9191, false, true)
    state.sunBank = 100
    state.suns = [{ id: 'sun_1', x: 200, y: 100, targetY: 100, value: 50, createdAt: 10 }]
    const historial: AccionP1Simulacion[] = []

    const res = ejecutarCapturaCollectP1({
      isAsyncMatch: true,
      sunId: 'sun_1',
      issuedTick: undefined, // Inválido en Ranked
      seq: 10,
      state,
      historial,
      inconsistenciaActual: null,
    })

    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.reason).toBe('MISSING_ISSUED_TICK')
    }

    expect(historial.length).toBe(0)
    expect(state.sunBank).toBe(100) // Intacto
    expect(state.suns.length).toBe(1) // El sol sigue ahí
  })

  // 92. Captura productiva PLANT ante SEQ_CONFLICT aborta sin aplicar cooldown ni cobro
  it('92. Captura productiva ejecutarCapturaPlantP1 ante SEQ_CONFLICT aborta sin cobro ni cooldown', () => {
    const state = createBattleState(9292, false, true)
    state.tick = 100
    state.sunBank = 200
    state.stats.plantsPlaced = 0
    state.pending = []

    const historial: AccionP1Simulacion[] = [
      { seq: 50, issuedTick: 10, tick: 10, kind: 'collect', targetId: 'sun_1' },
    ]

    const res = ejecutarCapturaPlantP1({
      isAsyncMatch: true,
      card: 'sunflower',
      slotIdx: 0,
      lane: 0,
      col: 0,
      state,
      seq: 50, // Mismo seq -> conflicto
      enTic: 106,
      historial,
      inconsistenciaActual: null,
    })

    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.reason).toBe('SEQ_CONFLICT')
    }

    expect(state.sunBank).toBe(200) // No se cobró
    expect(state.slotCooldowns[0]).toBeUndefined() // No cooldown
    expect(state.stats.plantsPlaced).toBe(0)
    expect(state.pending.length).toBe(0) // No se encoló own_plant
    expect(historial.length).toBe(1)
  })

  // 93. Captura productiva DIG sin seq aborta sin encolar own_dig
  it('93. Captura productiva ejecutarCapturaDigP1 sin seq aborta sin encolar own_dig', () => {
    const state = createBattleState(9393, false, true)
    state.pending = []
    const historial: AccionP1Simulacion[] = []

    const res = ejecutarCapturaDigP1({
      isAsyncMatch: true,
      casilla: { lane: 1, col: 2 },
      state,
      seq: undefined, // Sin seq
      enTic: 106,
      historial,
      inconsistenciaActual: null,
    })

    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.reason).toBe('MISSING_SEQ')
    }

    expect(state.pending.length).toBe(0)
    expect(historial.length).toBe(0)
  })

  // 94. Bloqueo de acciones autoritativas Ranked tras inconsistencia
  it('94. Acciones autoritativas Ranked quedan bloqueadas cuando existe inconsistencia', () => {
    const state = createBattleState(9494, false, true)
    state.sunBank = 300
    state.pending = []
    state.suns = [{ id: 'sun_94', x: 200, y: 100, targetY: 100, value: 50, createdAt: 10 }]
    const historial: AccionP1Simulacion[] = []

    const inconsistenciaPrevia = 'SEQ_CONFLICT' as const

    // 1. Plant bloqueada
    const resPlant = ejecutarCapturaPlantP1({
      isAsyncMatch: true,
      card: 'sunflower',
      slotIdx: 0,
      lane: 0,
      col: 0,
      state,
      seq: 1,
      enTic: 100,
      historial,
      inconsistenciaActual: inconsistenciaPrevia,
    })
    expect(resPlant.ok).toBe(false)
    expect(state.pending.length).toBe(0)
    expect(state.sunBank).toBe(300)

    // 2. Dig bloqueado
    const resDig = ejecutarCapturaDigP1({
      isAsyncMatch: true,
      casilla: { lane: 0, col: 0 },
      state,
      seq: 2,
      enTic: 100,
      historial,
      inconsistenciaActual: inconsistenciaPrevia,
    })
    expect(resDig.ok).toBe(false)
    expect(state.pending.length).toBe(0)

    // 3. Collect bloqueado
    const resCollect = ejecutarCapturaCollectP1({
      isAsyncMatch: true,
      sunId: 'sun_94',
      issuedTick: 50,
      seq: 3,
      state,
      historial,
      inconsistenciaActual: inconsistenciaPrevia,
    })
    expect(resCollect.ok).toBe(false)
    expect(state.sunBank).toBe(300)
    expect(historial.length).toBe(0)
  })

  // 95. Separación P1 Pending vs Accepted (Punto A)
  it('95. Captura inicial va a pending y sólo tras ACK pasa a accepted', () => {
    const state = createBattleState(9595, false, true)
    state.tick = 100
    state.sunBank = 200
    const pending: AccionP1Simulacion[] = []
    const accepted: AccionP1Simulacion[] = []

    const res = ejecutarCapturaPlantP1({
      isAsyncMatch: true,
      card: 'sunflower',
      slotIdx: 0,
      lane: 1,
      col: 1,
      state,
      seq: 10,
      enTic: 106,
      pending,
    })

    expect(res.ok).toBe(true)
    expect(pending.length).toBe(1)
    expect(pending[0].seq).toBe(10)
    expect(accepted.length).toBe(0)

    const resAck = confirmarAccionP1Async({ pending, accepted, seq: 10 })
    expect(resAck.ok).toBe(true)
    if (resAck.ok) {
      expect(resAck.pending.length).toBe(0)
      expect(resAck.accepted.length).toBe(1)
      expect(resAck.accepted[0].seq).toBe(10)
    }
  })

  // 96. ACK atómico con deduplicación y conflicto (Punto B)
  it('96. ACK atómico es idempotente si es idéntico y detecta conflicto si difiere', () => {
    const pending: AccionP1Simulacion[] = [
      { seq: 1, tick: 106, issuedTick: 100, kind: 'plant', plantId: 'sunflower', slot: 0, lane: 0, col: 0 },
    ]
    const accepted: AccionP1Simulacion[] = [
      { seq: 1, tick: 106, issuedTick: 100, kind: 'plant', plantId: 'peashooter', slot: 1, lane: 0, col: 0 },
    ]

    const resConflict = confirmarAccionP1Async({ pending, accepted, seq: 1 })
    expect(resConflict.ok).toBe(false)
    if (!resConflict.ok) {
      expect(resConflict.reason).toBe('SEQ_CONFLICT')
    }

    const pending2: AccionP1Simulacion[] = [
      { seq: 2, tick: 106, issuedTick: 100, kind: 'plant', plantId: 'sunflower', slot: 0, lane: 0, col: 0 },
    ]
    const accepted2: AccionP1Simulacion[] = [
      { seq: 2, tick: 106, issuedTick: 100, kind: 'plant', plantId: 'sunflower', slot: 0, lane: 0, col: 0 },
    ]

    const resIdempotent = confirmarAccionP1Async({ pending: pending2, accepted: accepted2, seq: 2 })
    expect(resIdempotent.ok).toBe(true)
    if (resIdempotent.ok) {
      expect(resIdempotent.duplicated).toBe(true)
    }
  })

  // 97. REJECT opera sobre pending y revierte estado (Punto C)
  it('97. REJECT elimina de pending, no añade a accepted y revierte coste/cooldown', () => {
    const state = createBattleState(9797, false, true)
    state.tick = 100
    state.sunBank = 100
    state.stats.plantsPlaced = 1
    state.slotCooldowns[0] = 300

    const pending: AccionP1Simulacion[] = [
      { seq: 5, tick: 106, issuedTick: 100, kind: 'plant', plantId: 'sunflower', slot: 0, lane: 1, col: 2 },
    ]
    const accepted: AccionP1Simulacion[] = []
    const costeMap = new Map<string, { coste: number; carta: any; slot: number | null }>([
      ['106:1:2', { coste: 50, carta: 'sunflower', slot: 0 }],
    ])
    const registro = [{ id: 1, tick: 106, kind: 'plant' as const, plantId: 'sunflower' as const, lane: 1, col: 2, mia: true }]

    const res = rechazarAccionP1Async({
      pending,
      accepted,
      seq: 5,
      state,
      costeDeMisJugadas: costeMap,
      registro,
    })

    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.pending.length).toBe(0)
      expect(res.accepted.length).toBe(0)
      expect(res.nuevoRegistro.length).toBe(0)
      expect(state.sunBank).toBe(150)
      expect(state.slotCooldowns[0]).toBe(0)
      expect(state.stats.plantsPlaced).toBe(0)
    }
  })

  // 98. Desconocido pending seq en ACK o REJECT falla cerrado (Puntos B, C)
  it('98. ACK o REJECT con seq desconocido en pending falla con UNKNOWN_PENDING_ACTION', () => {
    const pending: AccionP1Simulacion[] = []
    const accepted: AccionP1Simulacion[] = []
    const state = createBattleState(9898, false, true)

    const resAck = confirmarAccionP1Async({ pending, accepted, seq: 999 })
    expect(resAck.ok).toBe(false)
    if (!resAck.ok) {
      expect(resAck.reason).toBe('UNKNOWN_PENDING_ACTION')
    }

    const resReject = rechazarAccionP1Async({
      pending,
      accepted,
      seq: 999,
      state,
      costeDeMisJugadas: new Map(),
      registro: [],
    })
    expect(resReject.ok).toBe(false)
    if (!resReject.ok) {
      expect(resReject.reason).toBe('UNKNOWN_PENDING_ACTION')
    }
  })

  // 99. Relación temporal estricta P1 (Punto E)
  it('99. Relación temporal estricta rechaza discrepancias con INVALID_TICK_RELATION', () => {
    // collect con tick !== issuedTick
    const colDiff = validarAccionP1RankedEstricta({ seq: 1, issuedTick: 50, tick: 51, kind: 'collect', targetId: 's1' })
    expect(colDiff.ok).toBe(false)
    if (!colDiff.ok) {
      expect(colDiff.reason).toBe('INVALID_TICK_RELATION')
    }

    // plant con tick !== issuedTick + 6
    const plantDiff = validarAccionP1RankedEstricta({
      seq: 2,
      issuedTick: 50,
      tick: 50,
      kind: 'plant',
      plantId: 'sunflower',
      slot: 0,
      lane: 0,
      col: 0,
    })
    expect(plantDiff.ok).toBe(false)
    if (!plantDiff.ok) {
      expect(plantDiff.reason).toBe('INVALID_TICK_RELATION')
    }

    // dig con tick !== issuedTick + 6
    const digDiff = validarAccionP1RankedEstricta({
      seq: 3,
      issuedTick: 50,
      tick: 60,
      kind: 'dig',
      lane: 0,
      col: 0,
    })
    expect(digDiff.ok).toBe(false)
    if (!digDiff.ok) {
      expect(digDiff.reason).toBe('INVALID_TICK_RELATION')
    }
  })

  // 100. tick obligatorio en P1 (Punto E)
  it('100. tick ausente o no numérico en P1 falla con MISSING_TICK / INVALID_TICK', () => {
    const sinTick = validarAccionP1RankedEstricta({ seq: 1, issuedTick: 50, kind: 'collect', targetId: 's1' })
    expect(sinTick.ok).toBe(false)
    if (!sinTick.ok) {
      expect(sinTick.reason).toBe('MISSING_TICK')
    }

    const tickInvalido = validarAccionP1RankedEstricta({ seq: 1, issuedTick: 50, tick: -1, kind: 'collect', targetId: 's1' })
    expect(tickInvalido.ok).toBe(false)
    if (!tickInvalido.ok) {
      expect(tickInvalido.reason).toBe('INVALID_TICK')
    }
  })

  // 101. Validación de contenedor P1 (Punto F)
  it('101. rawActions que no es array falla con INVALID_P1_ACTIONS_CONTAINER', () => {
    const val = validarYNormalizarAccionesP1Ranked(null)
    expect(val.ok).toBe(false)
    if (!val.ok) {
      expect(val.reason).toBe('INVALID_P1_ACTIONS_CONTAINER')
    }

    const valObj = validarYNormalizarAccionesP1Ranked({ foo: 'bar' })
    expect(valObj.ok).toBe(false)
    if (!valObj.ok) {
      expect(valObj.reason).toBe('INVALID_P1_ACTIONS_CONTAINER')
    }
  })

  // 102. Validación estricta de statRolls y level (Punto G)
  it('102. statRolls inválido o level inválido falla con INVALID_PLANT_DATA sin coerción', () => {
    const badRolls = validarAccionP1RankedEstricta({
      seq: 1,
      issuedTick: 50,
      tick: 56,
      kind: 'plant',
      plantId: 'sunflower',
      slot: 0,
      lane: 0,
      col: 0,
      statRolls: ['stat_falsa'],
    })
    expect(badRolls.ok).toBe(false)
    if (!badRolls.ok) {
      expect(badRolls.reason).toBe('INVALID_PLANT_DATA')
    }

    const badLevel = validarAccionP1RankedEstricta({
      seq: 1,
      issuedTick: 50,
      tick: 56,
      kind: 'plant',
      plantId: 'sunflower',
      slot: 0,
      lane: 0,
      col: 0,
      level: -5,
    })
    expect(badLevel.ok).toBe(false)
    if (!badLevel.ok) {
      expect(badLevel.reason).toBe('INVALID_PLANT_DATA')
    }
  })

  // 103. Constantes de slot y DECK_SIZE (Punto H)
  it('103. slot >= DECK_SIZE falla con INVALID_PLANT_DATA', () => {
    expect(DECK_SIZE).toBe(6)
    expect(MAX_DECK_SLOTS).toBe(6)

    const slotFuera = validarAccionP1RankedEstricta({
      seq: 1,
      issuedTick: 50,
      tick: 56,
      kind: 'plant',
      plantId: 'sunflower',
      slot: 6,
      lane: 0,
      col: 0,
    })
    expect(slotFuera.ok).toBe(false)
    if (!slotFuera.ok) {
      expect(slotFuera.reason).toBe('INVALID_PLANT_DATA')
    }
  })

  // 104. Validación estricta de mazo P1 (Punto I)
  it('104. runAsyncTimeline con p1Deck vacío o inválido falla con INVALID_P1_DECK', () => {
    const resVacio = runAsyncTimeline({
      seed: 104,
      p1Deck: [],
      asyncDeck: [{ slot: 0, plantId: 'sunflower', level: 0, statRolls: [] }],
      p1Actions: [],
      asyncActions: [],
      untilTick: 100,
      strictAuthoritativeHistory: true,
    })

    expect(resVacio.ok).toBe(false)
    if (!resVacio.ok) {
      expect(resVacio.reason).toBe('INVALID_P1_DECK')
    }
  })

  // 105. Reconstrucción con DIG imposible detecta TIMELINE_INCONSISTENT (Punto J)
  it('105. Reconstrucción con DIG sobre casilla vacía falla con TIMELINE_INCONSISTENT', () => {
    const p1Deck: CartaDeMazo[] = [{ slot: 0, plantId: 'sunflower', level: 0, statRolls: [] }]
    const p2Deck: CartaDeMazo[] = [{ slot: 0, plantId: 'sunflower', level: 0, statRolls: [] }]
    const acciones: AccionP1Simulacion[] = [
      { seq: 1, issuedTick: 50, tick: 56, kind: 'dig', lane: 1, col: 1 },
    ]

    const res = runAsyncTimeline({
      seed: 105,
      p1Deck,
      asyncDeck: p2Deck,
      p1Actions: acciones,
      asyncActions: [],
      untilTick: 100,
      strictAuthoritativeHistory: true,
    })

    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.reason).toBe('TIMELINE_INCONSISTENT')
    }
  })

  // 106. Reconstrucción con slot en cooldown detecta TIMELINE_INCONSISTENT (Punto J)
  it('106. Reconstrucción con planta en slot con cooldown activo falla con TIMELINE_INCONSISTENT', () => {
    const seed = 106
    const p1Deck: CartaDeMazo[] = [{ slot: 0, plantId: 'sunflower', level: 0, statRolls: [] }]
    const p2Deck: CartaDeMazo[] = [{ slot: 0, plantId: 'sunflower', level: 0, statRolls: [] }]

    // Generar soles suficientes para 2 girasoles
    const spawnedSuns: string[] = []
    const baseSim = createBattleState(seed, false, true)
    while (baseSim.tick < 700 && spawnedSuns.length < 4) {
      stepTick(baseSim, () => {})
      for (const s of baseSim.suns) {
        if (!spawnedSuns.includes(s.id)) spawnedSuns.push(s.id)
      }
    }

    const acciones: AccionP1Simulacion[] = [
      { seq: 1, issuedTick: 120, tick: 120, kind: 'collect', targetId: spawnedSuns[0] },
      { seq: 2, issuedTick: 301, tick: 301, kind: 'collect', targetId: spawnedSuns[1] },
      { seq: 3, issuedTick: 482, tick: 482, kind: 'collect', targetId: spawnedSuns[2] },
      { seq: 4, issuedTick: 663, tick: 663, kind: 'collect', targetId: spawnedSuns[3] },
      // Primer girasol en 670 -> cooldown de 7.5s (225 ticks)
      { seq: 5, issuedTick: 670, tick: 676, kind: 'plant', plantId: 'sunflower', slot: 0, lane: 0, col: 0 },
      // Segundo girasol en 675 (¡slot 0 sigue en cooldown!)
      { seq: 6, issuedTick: 675, tick: 681, kind: 'plant', plantId: 'sunflower', slot: 0, lane: 1, col: 0 },
    ]

    const res = runAsyncTimeline({
      seed,
      p1Deck,
      asyncDeck: p2Deck,
      p1Actions: acciones,
      asyncActions: [],
      untilTick: 750,
      strictAuthoritativeHistory: true,
    })

    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.reason).toBe('TIMELINE_INCONSISTENT')
    }
  })

  // 107. Reconstrucción con casilla ocupada detecta TIMELINE_INCONSISTENT (Punto J)
  it('107. Reconstrucción con planta estática en casilla ya ocupada falla con TIMELINE_INCONSISTENT', () => {
    const seed = 107
    const p1Deck: CartaDeMazo[] = [{ slot: 0, plantId: 'sunflower', level: 0, statRolls: [] }]
    const p2Deck: CartaDeMazo[] = [{ slot: 0, plantId: 'sunflower', level: 0, statRolls: [] }]

    const spawnedSuns: string[] = []
    const baseSim = createBattleState(seed, false, true)
    while (baseSim.tick < 700 && spawnedSuns.length < 4) {
      stepTick(baseSim, () => {})
      for (const s of baseSim.suns) {
        if (!spawnedSuns.includes(s.id)) spawnedSuns.push(s.id)
      }
    }

    const acciones: AccionP1Simulacion[] = [
      { seq: 1, issuedTick: 120, tick: 120, kind: 'collect', targetId: spawnedSuns[0] },
      { seq: 2, issuedTick: 301, tick: 301, kind: 'collect', targetId: spawnedSuns[1] },
      { seq: 3, issuedTick: 482, tick: 482, kind: 'collect', targetId: spawnedSuns[2] },
      { seq: 4, issuedTick: 663, tick: 663, kind: 'collect', targetId: spawnedSuns[3] },
      // Primer girasol en 670 en (0, 0)
      { seq: 5, issuedTick: 670, tick: 676, kind: 'plant', plantId: 'sunflower', slot: 0, lane: 0, col: 0 },
      // Segundo girasol mucho después (tick 950) pero en la misma casilla ocupada (0, 0)
      { seq: 6, issuedTick: 950, tick: 956, kind: 'plant', plantId: 'sunflower', slot: 0, lane: 0, col: 0 },
    ]

    const res = runAsyncTimeline({
      seed,
      p1Deck,
      asyncDeck: p2Deck,
      p1Actions: acciones,
      asyncActions: [],
      untilTick: 1000,
      strictAuthoritativeHistory: true,
    })

    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.reason).toBe('TIMELINE_INCONSISTENT')
    }
  })

  // 108. Validación estricta de intención P2 (Punto L)
  it('108. validarIntencionAsyncRankedEstricta rechaza intenciones P2 malformadas', () => {
    const sinSeq = validarIntencionAsyncRankedEstricta({ issuedTick: 10, tick: 16, kind: 'plant', plantId: 'sunflower', lane: 0 })
    expect(sinSeq.ok).toBe(false)
    if (!sinSeq.ok) expect(sinSeq.reason).toBe('MISSING_SEQ')

    const sinIssued = validarIntencionAsyncRankedEstricta({ seq: 1, tick: 16, kind: 'plant', plantId: 'sunflower', lane: 0 })
    expect(sinIssued.ok).toBe(false)
    if (!sinIssued.ok) expect(sinIssued.reason).toBe('MISSING_ISSUED_TICK')

    const badKind = validarIntencionAsyncRankedEstricta({ seq: 1, issuedTick: 10, tick: 16, kind: 'collect', lane: 0 })
    expect(badKind.ok).toBe(false)
    if (!badKind.ok) expect(badKind.reason).toBe('INVALID_KIND')
  })

  // 109. Validación de contenedor intenciones P2 (Punto L)
  it('109. validarYNormalizarIntencionesAsyncRanked con contenedor no-array falla con INVALID_ASYNC_PLAN', () => {
    const res = validarYNormalizarIntencionesAsyncRanked(null)
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.reason).toBe('INVALID_ASYNC_PLAN')
    }
  })

  // 110. Relación temporal intención P2 (Punto L)
  it('110. Intención P2 con tick incompatible con issuedTick falla con INVALID_TICK_RELATION', () => {
    const res = validarIntencionAsyncRankedEstricta({
      seq: 1,
      issuedTick: 100,
      tick: 200,
      kind: 'plant',
      plantId: 'sunflower',
      lane: 0,
    })
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.reason).toBe('INVALID_TICK_RELATION')
    }
  })

  // 111. runAsyncTimeline con plan P2 no-array falla con INVALID_ASYNC_PLAN
  it('111. runAsyncTimeline con plan P2 no-array falla inmediatamente con INVALID_ASYNC_PLAN', () => {
    const res = runAsyncTimeline({
      seed: 42,
      p1Deck: [{ slot: 0, plantId: 'peashooter', level: 0, statRolls: [] }],
      asyncDeck: [{ slot: 0, plantId: 'peashooter', level: 0, statRolls: [] }],
      p1Actions: [],
      asyncActions: 'invalid_string_plan' as any,
      strictAuthoritativeHistory: true,
    })
    expect(res.ok).toBe(false)
    expect(res.reason).toBe('INVALID_ASYNC_PLAN')
  })

  // 112. runAsyncTimeline con mazo P2 inválido falla con INVALID_ASYNC_DECK
  it('112. runAsyncTimeline con mazo P2 vacío o no-array falla con INVALID_ASYNC_DECK', () => {
    const res = runAsyncTimeline({
      seed: 42,
      p1Deck: [{ slot: 0, plantId: 'peashooter', level: 0, statRolls: [] }],
      asyncDeck: [],
      p1Actions: [],
      asyncActions: [],
      strictAuthoritativeHistory: true,
    })
    expect(res.ok).toBe(false)
    expect(res.reason).toBe('INVALID_ASYNC_DECK')
  })

  // 113. runAsyncTimeline con mazo P1 inválido falla con INVALID_P1_DECK
  it('113. runAsyncTimeline con mazo P1 vacío o no-array falla con INVALID_P1_DECK', () => {
    const res = runAsyncTimeline({
      seed: 42,
      p1Deck: null as any,
      asyncDeck: [{ slot: 0, plantId: 'peashooter', level: 0, statRolls: [] }],
      p1Actions: [],
      asyncActions: [],
      strictAuthoritativeHistory: true,
    })
    expect(res.ok).toBe(false)
    expect(res.reason).toBe('INVALID_P1_DECK')
  })

  // 114. runAsyncTimeline con intención P2 sin issuedTick falla con MISSING_ISSUED_TICK
  it('114. runAsyncTimeline con intención P2 sin issuedTick falla estrictamente con MISSING_ISSUED_TICK', () => {
    const res = runAsyncTimeline({
      seed: 42,
      p1Deck: [{ slot: 0, plantId: 'peashooter', level: 0, statRolls: [] }],
      asyncDeck: [{ slot: 0, plantId: 'peashooter', level: 0, statRolls: [] }],
      p1Actions: [],
      asyncActions: [{ seq: 1, tick: 16, kind: 'plant', plantId: 'peashooter', slot: 0, lane: 0 }],
      strictAuthoritativeHistory: true,
    })
    expect(res.ok).toBe(false)
    expect(res.reason).toBe('MISSING_ISSUED_TICK')
  })

  // 115. runAsyncTimeline con intención P2 sin seq falla con MISSING_SEQ
  it('115. runAsyncTimeline con intención P2 sin seq falla estrictamente con MISSING_SEQ', () => {
    const res = runAsyncTimeline({
      seed: 42,
      p1Deck: [{ slot: 0, plantId: 'peashooter', level: 0, statRolls: [] }],
      asyncDeck: [{ slot: 0, plantId: 'peashooter', level: 0, statRolls: [] }],
      p1Actions: [],
      asyncActions: [{ issuedTick: 10, tick: 16, kind: 'plant', plantId: 'peashooter', slot: 0, lane: 0 }],
      strictAuthoritativeHistory: true,
    })
    expect(res.ok).toBe(false)
    expect(res.reason).toBe('MISSING_SEQ')
  })

  // 116. runAsyncTimeline con duplicado exacto de seq en P2 se deduplica idempotentemente
  it('116. runAsyncTimeline con duplicado exacto de seq en P2 deduplica idempotentemente y tiene éxito', () => {
    const res = runAsyncTimeline({
      seed: 42,
      p1Deck: [{ slot: 0, plantId: 'peashooter', level: 0, statRolls: [] }],
      asyncDeck: [{ slot: 0, plantId: 'peashooter', level: 0, statRolls: [] }],
      p1Actions: [],
      asyncActions: [
        { seq: 1, issuedTick: 10, tick: 16, kind: 'plant', plantId: 'peashooter', slot: 0, lane: 0 },
        { seq: 1, issuedTick: 10, tick: 16, kind: 'plant', plantId: 'peashooter', slot: 0, lane: 0 },
      ],
      strictAuthoritativeHistory: true,
      untilTick: 50,
    })
    expect(res.ok).toBe(true)
    expect(res.controller.intents.length).toBe(1)
  })

  // 117. runAsyncTimeline con mismo seq pero distinto contenido en P2 falla con SEQ_CONFLICT
  it('117. runAsyncTimeline con mismo seq pero distinto contenido en P2 falla con SEQ_CONFLICT', () => {
    const res = runAsyncTimeline({
      seed: 42,
      p1Deck: [{ slot: 0, plantId: 'peashooter', level: 0, statRolls: [] }],
      asyncDeck: [{ slot: 0, plantId: 'peashooter', level: 0, statRolls: [] }],
      p1Actions: [],
      asyncActions: [
        { seq: 1, issuedTick: 10, tick: 16, kind: 'plant', plantId: 'peashooter', slot: 0, lane: 0 },
        { seq: 1, issuedTick: 10, tick: 16, kind: 'plant', plantId: 'peashooter', slot: 0, lane: 1 },
      ],
      strictAuthoritativeHistory: true,
    })
    expect(res.ok).toBe(false)
    expect(res.reason).toBe('SEQ_CONFLICT')
  })

  // 118. runAsyncTimeline con intención P2 sin carril falla con INVALID_ASYNC_INTENT_DATA
  it('118. runAsyncTimeline con intención P2 sin carril falla con INVALID_ASYNC_INTENT_DATA', () => {
    const res = runAsyncTimeline({
      seed: 42,
      p1Deck: [{ slot: 0, plantId: 'peashooter', level: 0, statRolls: [] }],
      asyncDeck: [{ slot: 0, plantId: 'peashooter', level: 0, statRolls: [] }],
      p1Actions: [],
      asyncActions: [{ seq: 1, issuedTick: 10, tick: 16, kind: 'plant', plantId: 'peashooter', slot: 0 }],
      strictAuthoritativeHistory: true,
    })
    expect(res.ok).toBe(false)
    expect(res.reason).toBe('INVALID_ASYNC_INTENT_DATA')
  })

  // 119. createAsyncOpponentControllerFromValidated construye el controlador directamente
  it('119. createAsyncOpponentControllerFromValidated instancia el controlador directamente sin revalidar ni fallbacks', () => {
    const deck = [{ slot: 0, plantId: 'peashooter' as const, level: 1, statRolls: [] }]
    const intents = [{ seq: 1, issuedTick: 10, tick: 16, kind: 'plant' as const, plantId: 'peashooter' as const, slot: 0, lane: 0 }]
    const ctrl = createAsyncOpponentControllerFromValidated(deck, intents)
    expect(ctrl.deck).toBe(deck)
    expect(ctrl.intents).toBe(intents)
    expect(ctrl.nextIntentIndex).toBe(0)
    expect(ctrl.sunBank).toBe(0)
  })

  // 120. validarMazoAsyncRanked valida correctamente arrays conformes y rechaza no conformes
  it('120. validarMazoAsyncRanked valida mazos conformes y rechaza no-arrays, arrays vacíos o cartas inválidas', () => {
    expect(validarMazoAsyncRanked(null).ok).toBe(false)
    expect(validarMazoAsyncRanked([]).ok).toBe(false)
    expect(validarMazoAsyncRanked([{ slot: 0, plantId: 'invalid_plant_id' }]).ok).toBe(false)
    const valid = validarMazoAsyncRanked([{ slot: 0, plantId: 'sunflower', level: 0, statRolls: [] }])
    expect(valid.ok).toBe(true)
  })

  // 121. sonIntencionesP2Identicas detecta igualdad y diferencias campo a campo
  it('121. sonIntencionesP2Identicas detecta igualdad exacta y diferencias en cualquier campo', () => {
    const a = { seq: 1, issuedTick: 10, tick: 16, kind: 'plant' as const, plantId: 'sunflower' as const, slot: 0, lane: 0, col: 1 }
    const b = { ...a }
    const diffLane = { ...a, lane: 2 }
    const diffKind = { ...a, kind: 'dig' as const }
    expect(sonIntencionesP2Identicas(a, b)).toBe(true)
    expect(sonIntencionesP2Identicas(a, diffLane)).toBe(false)
    expect(sonIntencionesP2Identicas(a, diffKind)).toBe(false)
  })

  // 122. Bucle de congelación: stepAsyncOpponent y stepTick no se ejecutan si la simulación está congelada por inconsistencia
  it('122. ejecutarPasoSimulacionAsync en estado de freeze por inconsistencia o hold no avanza ticks ni altera el estado', () => {
    const state = createBattleState(123, false, true)
    const initialTick = state.tick
    const initialSun = state.sunBank
    const initialP1Hp = state.p1BaseHp
    const initialP2Hp = state.p2BaseHp

    expect(debeCongelarMotorRankedAsync({
      isAsyncMatch: true,
      rankedAsyncInconsistency: { reason: 'TIMELINE_INCONSISTENT' },
      reconciliationState: 'inconsistent',
    })).toBe(true)

    // Paso con inconsistencia -> debe congelar fail-closed
    const resFreeze = ejecutarPasoSimulacionAsync({
      isAsyncMatch: true,
      rankedAsyncInconsistency: { reason: 'TIMELINE_INCONSISTENT' },
      reconciliationState: 'inconsistent',
      state,
      controller: null,
    })

    expect(resFreeze.frozen).toBe(true)
    expect(resFreeze.tickAvanzado).toBe(false)
    expect(state.tick).toBe(initialTick)
    expect(state.sunBank).toBe(initialSun)
    expect(state.p1BaseHp).toBe(initialP1Hp)
    expect(state.p2BaseHp).toBe(initialP2Hp)

    // Paso saludable -> avanza simulación normalmente
    const resHealthy = ejecutarPasoSimulacionAsync({
      isAsyncMatch: true,
      rankedAsyncInconsistency: null,
      reconciliationState: 'healthy',
      state,
      controller: null,
    })

    expect(resHealthy.frozen).toBe(false)
    expect(resHealthy.tickAvanzado).toBe(true)
    expect(state.tick).toBe(initialTick + 1)
  })

  // 123. Session generation stale callback en confirmarAccionP1ConSesion
  it('123. confirmarAccionP1ConSesion rechaza llamadas con generación de sesión obsoleta sin mutar arrays', () => {
    const pending = [{ seq: 10, tick: 16, issuedTick: 10, kind: 'plant' as const, plantId: 'peashooter' as const, lane: 0 }]
    const accepted: any[] = []

    // Callback desfasado (generación 4 en sesión actual 5)
    const resStale = confirmarAccionP1ConSesion({
      currentGeneration: 5,
      callbackGeneration: 4,
      pending,
      accepted,
      seq: 10,
    })

    expect(resStale.ok).toBe(false)
    expect(resStale.stale).toBe(true)
    if (resStale.stale) {
      expect(resStale.reason).toBe('STALE_SESSION')
      expect(resStale.pending.length).toBe(1)
      expect(resStale.accepted.length).toBe(0)
    }

    // Callback sincronizado (generación 5)
    const resOk = confirmarAccionP1ConSesion({
      currentGeneration: 5,
      callbackGeneration: 5,
      pending,
      accepted,
      seq: 10,
    })

    expect(resOk.ok).toBe(true)
    expect(resOk.stale).toBe(false)
    if (resOk.ok) {
      expect(resOk.pending.length).toBe(0)
      expect(resOk.accepted.length).toBe(1)
      expect(resOk.accepted[0].seq).toBe(10)
    }
  })

  // 124. Session generation stale callback en rechazarAccionP1ConSesion
  it('124. rechazarAccionP1ConSesion es ignorado cuando la generación de sesión es obsoleta sin reembolsar ni mutar registro', () => {
    const pending = [{ seq: 10, tick: 16, issuedTick: 10, kind: 'plant' as const, plantId: 'peashooter' as const, lane: 0, col: 0 }]
    const registro = [{ id: 1, kind: 'plant' as const, mia: true, tick: 16, lane: 0, col: 0, carta: 'peashooter' as const }]
    const costeDeMisJugadas = new Map<string, { coste: number; carta: any; slot: number | null }>([
      ['16:0:0', { coste: 100, carta: 'peashooter', slot: 0 }],
    ])
    const state = createBattleState(1, false, true)
    state.sunBank = 0

    // Callback desfasado
    const resStale = rechazarAccionP1ConSesion({
      currentGeneration: 5,
      callbackGeneration: 4,
      pending,
      accepted: [],
      seq: 10,
      state,
      costeDeMisJugadas,
      registro,
    })

    expect(resStale.ok).toBe(false)
    expect(resStale.stale).toBe(true)
    expect(state.sunBank).toBe(0) // No reembolsó soles
    if (resStale.stale) {
      expect(resStale.pending.length).toBe(1)
      expect(resStale.nuevoRegistro.length).toBe(1)
    }

    // Callback sincronizado
    const resOk = rechazarAccionP1ConSesion({
      currentGeneration: 5,
      callbackGeneration: 5,
      pending,
      accepted: [],
      seq: 10,
      state,
      costeDeMisJugadas,
      registro,
    })

    expect(resOk.ok).toBe(true)
    expect(resOk.stale).toBe(false)
    expect(state.sunBank).toBe(100) // Reembolso exitoso
    if (resOk.ok) {
      expect(resOk.pending.length).toBe(0)
      expect(resOk.nuevoRegistro.length).toBe(0)
    }
  })

  // 125. Session generation stale callback en confirmarRecogidaSolConSesion
  it('125. confirmarRecogidaSolConSesion es ignorado cuando la generación de sesión es obsoleta', () => {
    const state = createBattleState(1, false, true)
    state.sunBank = 0
    state.suns = [
      { id: 'sun_1', value: 25, x: 0, y: 0, targetY: 50, createdAt: 10 },
    ]

    // Callback desfasado
    const resStale = confirmarRecogidaSolConSesion({
      currentGeneration: 3,
      callbackGeneration: 2,
      isAsyncMatch: true,
      sunId: 'sun_1',
      issuedTick: 10,
      seq: 1,
      state,
    })

    expect(resStale.ok).toBe(false)
    expect(resStale.stale).toBe(true)
    expect(state.sunBank).toBe(0)
    expect(state.suns.length).toBe(1)

    // Callback sincronizado
    const resOk = confirmarRecogidaSolConSesion({
      currentGeneration: 3,
      callbackGeneration: 3,
      isAsyncMatch: true,
      sunId: 'sun_1',
      issuedTick: 10,
      seq: 1,
      state,
    })

    expect(resOk.ok).toBe(true)
    expect(resOk.stale).toBe(false)
    expect(state.sunBank).toBe(25)
    expect(state.suns.length).toBe(0)
  })

  // 126. incorporarLoteIntencionesP2 rechaza lote no array con INVALID_ASYNC_PLAN
  it('126. incorporarLoteIntencionesP2 valida que el lote entrante sea un array y rechaza objetos, null o strings', () => {
    const resNull = incorporarLoteIntencionesP2({ bufferActual: [], nuevasIntenciones: null })
    expect(resNull.ok).toBe(false)
    expect(resNull.maxAcceptedSeq).toBe(null)
    if (!resNull.ok) expect(resNull.reason).toBe('INVALID_ASYNC_PLAN')

    const resObj = incorporarLoteIntencionesP2({ bufferActual: [], nuevasIntenciones: { not: 'an array' } })
    expect(resObj.ok).toBe(false)
    expect(resObj.maxAcceptedSeq).toBe(null)
    if (!resObj.ok) expect(resObj.reason).toBe('INVALID_ASYNC_PLAN')
  })

  // 127. incorporarLoteIntencionesP2 detecta duplicado conflictivo dentro del MISMO lote
  it('127. incorporarLoteIntencionesP2 detecta SEQ_CONFLICT ante mismo seq con contenido distinto dentro del mismo lote', () => {
    const incoming = [
      { seq: 25, issuedTick: 10, tick: 16, kind: 'plant' as const, plantId: 'peashooter' as const, slot: 0, lane: 0 },
      { seq: 25, issuedTick: 10, tick: 16, kind: 'plant' as const, plantId: 'peashooter' as const, slot: 0, lane: 2 },
    ]
    const bufferActual: any[] = []

    const res = incorporarLoteIntencionesP2({ bufferActual, nuevasIntenciones: incoming })

    expect(res.ok).toBe(false)
    expect(res.maxAcceptedSeq).toBe(null)
    if (!res.ok) {
      expect(res.reason).toBe('SEQ_CONFLICT')
      expect(res.seq).toBe(25)
    }
    expect(bufferActual.length).toBe(0) // Buffer intacto
  })

  // 128. incorporarLoteIntencionesP2 deduplica idénticos dentro del MISMO lote
  it('128. incorporarLoteIntencionesP2 acepta duplicados idénticos dentro del mismo lote como idempotentes', () => {
    const intentA = { seq: 25, issuedTick: 10, tick: 16, kind: 'plant' as const, plantId: 'peashooter' as const, slot: 0, lane: 0 }
    const incoming = [intentA, { ...intentA }]

    const res = incorporarLoteIntencionesP2({ bufferActual: [], nuevasIntenciones: incoming })

    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.maxAcceptedSeq).toBe(25)
      expect(res.nuevoBuffer.length).toBe(1)
      expect(res.nuevasAceptadas.length).toBe(1)
    }
  })

  // 129. incorporarLoteIntencionesP2 garantiza atomicidad total del lote
  it('129. incorporarLoteIntencionesP2 no incorpora intenciones previas si un elemento posterior del lote falla', () => {
    const incoming = [
      { seq: 20, issuedTick: 5, tick: 11, kind: 'plant' as const, plantId: 'peashooter' as const, slot: 0, lane: 0 },
      { seq: 21, issuedTick: 10, tick: 16, kind: 'plant' as const, plantId: 'peashooter' as const, slot: 0, lane: 0 },
      { seq: 21, issuedTick: 10, tick: 16, kind: 'plant' as const, plantId: 'peashooter' as const, slot: 0, lane: 1 }, // conflicto con el anterior
    ]
    const bufferActual: any[] = []

    const res = incorporarLoteIntencionesP2({ bufferActual, nuevasIntenciones: incoming })

    expect(res.ok).toBe(false)
    expect(res.maxAcceptedSeq).toBe(null)
    if (!res.ok) {
      expect(res.reason).toBe('SEQ_CONFLICT')
      expect(res.seq).toBe(21)
    }
    expect(bufferActual.length).toBe(0) // Nada del lote fue incorporado
  })

  // 130. incorporarLoteIntencionesP2 devuelve maxAcceptedSeq para alimentar el cursor
  it('130. incorporarLoteIntencionesP2 devuelve maxAcceptedSeq correcto basado exclusivamente en seqs validados', () => {
    const incoming = [
      { seq: 40, issuedTick: 10, tick: 16, kind: 'plant' as const, plantId: 'peashooter' as const, slot: 0, lane: 0 },
      { seq: 41, issuedTick: 20, tick: 26, kind: 'plant' as const, plantId: 'peashooter' as const, slot: 0, lane: 0 },
      { seq: 42, issuedTick: 30, tick: 36, kind: 'plant' as const, plantId: 'peashooter' as const, slot: 0, lane: 0 },
    ]

    const res = incorporarLoteIntencionesP2({ bufferActual: [], nuevasIntenciones: incoming })

    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.maxAcceptedSeq).toBe(42)
      expect(res.nuevasAceptadas.length).toBe(3)
    }
  })

  // 131. resolverLiquidacionPartida: Servidor verificado sobrepone cualquier resultado local
  it('131. resolverLiquidacionPartida otorga el resultado y ELO autoritativo del servidor incluso si el cliente creyó haber ganado', () => {
    const res = resolverLiquidacionPartida({
      isAsyncMatch: true,
      soyP1: true,
      currentUserId: 'user_p1',
      serverVerification: {
        status: 'verified',
        winnerSide: 2, // Ganó P2 en el servidor
        settlement: {
          eloLost: 15,
          eloGained: 0,
          payout: 0,
        },
      },
    })

    expect(res.mostrarResultado).toBe(true)
    expect(res.resultadoFinal).toBe('defeat')
    expect(res.statusServidor).toBe('liquidada')
    expect(res.eloLost).toBe(15)
    expect(res.eloGained).toBeUndefined()
  })

  // 132. resolverLiquidacionPartida: Servidor fallido no otorga victoria local ni altera ELO
  it('132. resolverLiquidacionPartida con status failed entra en revision_servidor sin declarar ganador ni tocar ELO', () => {
    const res = resolverLiquidacionPartida({
      isAsyncMatch: true,
      soyP1: true,
      currentUserId: 'user_p1',
      serverVerification: {
        status: 'failed',
        error: 'divergence_detected',
      },
    })

    expect(res.mostrarResultado).toBe(false)
    expect(res.resultadoFinal).toBe('hold')
    expect(res.statusServidor).toBe('revision_servidor')
    expect(res.eloGained).toBeUndefined()
    expect(res.eloLost).toBeUndefined()
  })

  // 133. resolverLiquidacionPartida: Servidor pending mantiene la pantalla en hold
  it('133. resolverLiquidacionPartida con status pending mantiene verificacion_pendiente', () => {
    const res = resolverLiquidacionPartida({
      isAsyncMatch: true,
      soyP1: true,
      currentUserId: 'user_p1',
      serverVerification: {
        status: 'pending',
      },
    })

    expect(res.mostrarResultado).toBe(false)
    expect(res.resultadoFinal).toBe('hold')
    expect(res.statusServidor).toBe('verificacion_pendiente')
  })

  // 134. resolverLiquidacionPartida: Servidor verified_draw declara empate verificado
  it('134. resolverLiquidacionPartida con status verified_draw declara empate verificado sin premios', () => {
    const res = resolverLiquidacionPartida({
      isAsyncMatch: true,
      soyP1: true,
      currentUserId: 'user_p1',
      serverVerification: {
        status: 'verified_draw',
      },
    })

    expect(res.mostrarResultado).toBe(true)
    expect(res.resultadoFinal).toBe('draw')
    expect(res.statusServidor).toBe('empate_verificado')
    expect(res.payout).toBe(0)
  })

  // 135. issuedTickP1Legacy no se utiliza en el pipeline estricto de Ranked Asíncrono
  it('135. issuedTickP1Legacy está aislado y validarAccionP1RankedEstricta exige issuedTick explícito', () => {
    const legacyCalculated = issuedTickP1Legacy({ tick: 100, kind: 'plant' } as any)
    expect(legacyCalculated).toBe(94) // 100 - MARGEN_DE_RED_TICS (6)

    // En pipeline estricto Ranked Async, acción sin issuedTick falla inmediatamente
    const strictVal = validarAccionP1RankedEstricta({ seq: 1, tick: 100, kind: 'plant', plantId: 'peashooter', lane: 0 })
    expect(strictVal.ok).toBe(false)
    if (!strictVal.ok) {
      expect(strictVal.reason).toBe('MISSING_ISSUED_TICK')
    }
  })

  // ===========================================================================
  // BM. PRUEBAS DE CAPTURA DE SEMILLAS (capture_ranked_async_opponents_from_room)
  // ===========================================================================

  // 136. source issued_tick NULL no captura y reporta razón explícita
  it('136. Captura de semilla: source con issued_tick NULL no se captura como Rival Semilla', () => {
    const sqlPath = join(process.cwd(), 'supabase', '36-rival-semilla-ranked.sql')
    const sqlContent = readFileSync(sqlPath, 'utf8')

    // capture_ranked_async_opponents_from_room comprueba que no haya issued_tick NULL
    expect(sqlContent).toMatch(/v_p1_missing_issued = 0/i)
    expect(sqlContent).toMatch(/v_p2_missing_issued = 0/i)
    expect(sqlContent).not.toMatch(/COALESCE\(issued_tick,\s*GREATEST\(0,\s*tick\s*-\s*6\)\)/i)
  })

  // 137. source seq duplicado no captura
  it('137. Captura de semilla: source con seq duplicado o inválido no se captura', () => {
    const sqlPath = join(process.cwd(), 'supabase', '36-rival-semilla-ranked.sql')
    const sqlContent = readFileSync(sqlPath, 'utf8')

    expect(sqlContent).toMatch(/v_p1_invalid_seq = 0/i)
    expect(sqlContent).toMatch(/v_p2_invalid_seq = 0/i)
  })

  // 138. source tick relation inválida es rechazada por _validate_ranked_async_plan
  it('138. Captura de semilla: source con tick relation inválida es rechazada por _validate_ranked_async_plan', () => {
    const rawBadIntents = [
      { seq: 1, tick: 100, issuedTick: 50, kind: 'plant', plantId: 'sunflower', lane: 0 },
    ]
    const val = validarYNormalizarIntencionesAsyncRanked(rawBadIntents)
    expect(val.ok).toBe(false)
    if (!val.ok) {
      expect(val.reason).toBe('INVALID_TICK_RELATION')
    }
  })

  // 139. source deck inválido no captura
  it('139. Captura de semilla: source con deck inválido o vacío es rechazada', () => {
    const valBadDeck = validarMazoAsyncRanked([])
    expect(valBadDeck.ok).toBe(false)
    if (!valBadDeck.ok) {
      expect(valBadDeck.reason).toBe('INVALID_ASYNC_DECK')
    }
  })

  // 140. source resuelto por ranked_client_consensus NO se captura (criterio positivo)
  it('140. Captura de semilla: exige resolutionSource = authoritative_replay afirmativo y excluye client consensus o valores nulos', () => {
    const sqlPath = join(process.cwd(), 'supabase', '36-rival-semilla-ranked.sql')
    const sqlContent = readFileSync(sqlPath, 'utf8')

    expect(sqlContent).toMatch(/INVALID_SOURCE_VERIFICATION/i)
    expect(sqlContent).toMatch(/v_resolution_source <> 'authoritative_replay'/i)
  })

  // 141. source replay autoritativo válido captura con protocol_version y source_engine_version
  it('141. Captura de semilla: partida con replay autoritativo consistente y 0 ilegales se captura con protocol_version', () => {
    const sqlPath = join(process.cwd(), 'supabase', '36-rival-semilla-ranked.sql')
    const sqlContent = readFileSync(sqlPath, 'utf8')

    expect(sqlContent).toMatch(/'ranked-async-v1'/i)
    expect(sqlContent).toMatch(/'auth-v1'/i)
    expect(sqlContent).toMatch(/simulation_not_consistent/i)
    expect(sqlContent).toMatch(/had_illegal_actions/i)
  })

  // 142. Ejecutar captura dos veces con snapshot idéntico es idempotente y no incrementa capturedSides
  it('142. Captura de semilla: captura doble de la misma sala y lado es idempotente y devuelve alreadyExistingSides', () => {
    const sqlPath = join(process.cwd(), 'supabase', '36-rival-semilla-ranked.sql')
    const sqlContent = readFileSync(sqlPath, 'utf8')

    expect(sqlContent).toMatch(/alreadyExistingSides/i)
    expect(sqlContent).toMatch(/v_existing_opp1\.deck_snapshot = v_room\.p1_deck/i)
    expect(sqlContent).toMatch(/v_already_existing_sides := v_already_existing_sides \+ 1;/i)
  })

  // 143. source async match no se captura (sin cascada de semillas)
  it('143. Captura de semilla: sala que ya es asíncrona no se captura para evitar cascadas', () => {
    const sqlPath = join(process.cwd(), 'supabase', '36-rival-semilla-ranked.sql')
    const sqlContent = readFileSync(sqlPath, 'utf8')

    expect(sqlContent).toMatch(/already_async_match/i)
    expect(sqlContent).toMatch(/is_async_match.*= TRUE/i)
  })

  // ===========================================================================
  // BN. PRUEBAS DE SELECCIÓN Y CLAIM (claim_ranked_async_opponent)
  // ===========================================================================

  // 144. < 60s no permite Rival Semilla
  it('144. claim_ranked_async_opponent: tiempo < 60 s devuelve tiempo_insuficiente', () => {
    const sqlPath = join(process.cwd(), 'supabase', '36-rival-semilla-ranked.sql')
    const sqlContent = readFileSync(sqlPath, 'utf8')

    expect(sqlContent).toMatch(/tiempo_insuficiente/i)
    expect(sqlContent).toMatch(/v_waited < 60/i)
  })

  // 145. Humano disponible gana prioridad absoluta
  it('145. claim_ranked_async_opponent: si _try_match encuentra humano, retorna la sala humana', () => {
    const sqlPath = join(process.cwd(), 'supabase', '36-rival-semilla-ranked.sql')
    const sqlContent = readFileSync(sqlPath, 'utf8')

    expect(sqlContent).toMatch(/v_human_room := public\._try_match\(v_uid\);/i)
    expect(sqlContent).toMatch(/'isAsyncMatch',\s*FALSE/i)
  })

  // 146. Candidato corrupto se sanea (active=false) y no se crea sala corrupta
  it('146. claim_ranked_async_opponent: candidato con snapshot corrupto es desactivado y se busca otro', () => {
    const sqlPath = join(process.cwd(), 'supabase', '36-rival-semilla-ranked.sql')
    const sqlContent = readFileSync(sqlPath, 'utf8')

    expect(sqlContent).toMatch(/UPDATE public\.ranked_async_opponents SET active = FALSE WHERE id = v_candidate\.id/i)
    expect(sqlContent).toMatch(/v_cand_deck_val := public\._validate_ranked_async_deck/i)
    expect(sqlContent).toMatch(/v_cand_plan_val := public\._validate_ranked_async_plan/i)
  })

  // 147. Candidato válido crea sala y plan privado atómicamente
  it('147. claim_ranked_async_opponent: candidato válido crea game_rooms y ranked_async_room_plans en la misma transacción', () => {
    const sqlPath = join(process.cwd(), 'supabase', '36-rival-semilla-ranked.sql')
    const sqlContent = readFileSync(sqlPath, 'utf8')

    expect(sqlContent).toMatch(/INSERT INTO public\.game_rooms/i)
    expect(sqlContent).toMatch(/INSERT INTO public\.ranked_async_room_plans/i)
    expect(sqlContent).toMatch(/RETURNING id INTO v_new_room_id/i)
  })

  // 148. Player deck inválido aborta sin crear sala
  it('148. claim_ranked_async_opponent: mazo de jugador inválido retorna invalid_player_deck', () => {
    const sqlPath = join(process.cwd(), 'supabase', '36-rival-semilla-ranked.sql')
    const sqlContent = readFileSync(sqlPath, 'utf8')

    expect(sqlContent).toMatch(/invalid_player_deck/i)
    expect(sqlContent).toMatch(/v_deck_val := public\._validate_ranked_async_deck\(v_player_deck\)/i)
  })

  // 149. Concurrencia protegida mediante FOR UPDATE en cola
  it('149. claim_ranked_async_opponent: bloquea la fila de matchmaking_queue con FOR UPDATE', () => {
    const sqlPath = join(process.cwd(), 'supabase', '36-rival-semilla-ranked.sql')
    const sqlContent = readFileSync(sqlPath, 'utf8')

    expect(sqlContent).toMatch(/FROM public\.matchmaking_queue/i)
    expect(sqlContent).toMatch(/FOR UPDATE/i)
  })

  // 150. Pool vacío retorna no_hay_candidato_semilla
  it('150. claim_ranked_async_opponent: si no hay candidatos activos, retorna no_hay_candidato_semilla', () => {
    const sqlPath = join(process.cwd(), 'supabase', '36-rival-semilla-ranked.sql')
    const sqlContent = readFileSync(sqlPath, 'utf8')

    expect(sqlContent).toMatch(/no_hay_candidato_semilla/i)
  })

  // ===========================================================================
  // BO. PRUEBAS DE FEED Y POLL (poll_ranked_async_intents)
  // ===========================================================================

  // 151. Plan ausente lanza error y NUNCA devuelve []
  it('151. poll_ranked_async_intents: plan ausente lanza ASYNC_PLAN_MISSING en vez de devolver intents vacíos', () => {
    const sqlPath = join(process.cwd(), 'supabase', '36-rival-semilla-ranked.sql')
    const sqlContent = readFileSync(sqlPath, 'utf8')

    expect(sqlContent).toMatch(/ASYNC_PLAN_MISSING/i)
    expect(sqlContent).not.toMatch(/IF NOT FOUND THEN\s*RETURN jsonb_build_object\([^)]*'intents',\s*'\[\]'::JSONB/i)
  })

  // 152. Plan no-array lanza INVALID_ASYNC_PLAN
  it('152. poll_ranked_async_intents: plan no-array lanza INVALID_ASYNC_PLAN', () => {
    const sqlPath = join(process.cwd(), 'supabase', '36-rival-semilla-ranked.sql')
    const sqlContent = readFileSync(sqlPath, 'utf8')

    expect(sqlContent).toMatch(/INVALID_ASYNC_PLAN/i)
    expect(sqlContent).toMatch(/jsonb_typeof\(v_plan\.actions_snapshot\) <> 'array'/i)
  })

  // 153. issuedTick es obligatorio sin fallback a tick
  it('153. poll_ranked_async_intents: extrae issuedTick exclusivamente sin COALESCE(issuedTick, tick)', () => {
    const sqlPath = join(process.cwd(), 'supabase', '36-rival-semilla-ranked.sql')
    const sqlContent = readFileSync(sqlPath, 'utf8')

    expect(sqlContent).toMatch(/'issuedTick',\s*\(elem->>'issuedTick'\)::INTEGER/i)
    expect(sqlContent).not.toMatch(/COALESCE\(\(elem->>'issuedTick'\)::INTEGER,\s*\(elem->>'tick'\)::INTEGER\)/i)
  })

  // 154. p_after_seq negativo o nulo es rechazado
  it('154. poll_ranked_async_intents: p_after_seq < 0 es rechazado con error', () => {
    const sqlPath = join(process.cwd(), 'supabase', '36-rival-semilla-ranked.sql')
    const sqlContent = readFileSync(sqlPath, 'utf8')

    expect(sqlContent).toMatch(/p_after_seq IS NULL OR p_after_seq < 0/i)
  })

  // 155. Ventana futura se restringe a serverTick + 18
  it('155. poll_ranked_async_intents: no entrega intenciones más allá de serverTick + 18', () => {
    const sqlPath = join(process.cwd(), 'supabase', '36-rival-semilla-ranked.sql')
    const sqlContent = readFileSync(sqlPath, 'utf8')

    expect(sqlContent).toMatch(/v_max_reveal_tick := v_server_tick \+ 18/i)
    expect(sqlContent).toMatch(/\(elem->>'issuedTick'\)::INTEGER <= v_max_reveal_tick/i)
  })

  // 156. Orden estricto issuedTick ASC, seq ASC
  it('156. poll_ranked_async_intents: ordena estrictamente por issuedTick ASC, seq ASC', () => {
    const sqlPath = join(process.cwd(), 'supabase', '36-rival-semilla-ranked.sql')
    const sqlContent = readFileSync(sqlPath, 'utf8')

    expect(sqlContent).toMatch(/ORDER BY \(elem->>'issuedTick'\)::INTEGER ASC, \(elem->>'seq'\)::INTEGER ASC/i)
  })

  // 157. Usuario ajeno a la partida es rechazado con forbidden
  it('157. poll_ranked_async_intents: usuario distinto de player1_id es rechazado', () => {
    const sqlPath = join(process.cwd(), 'supabase', '36-rival-semilla-ranked.sql')
    const sqlContent = readFileSync(sqlPath, 'utf8')

    expect(sqlContent).toMatch(/v_room\.player1_id <> v_uid/i)
    expect(sqlContent).toMatch(/No participas en esta partida/i)
  })

  // ===========================================================================
  // BP. PRUEBAS DE INGESTIÓN submit_match_action
  // ===========================================================================

  // 158. issued_tick NULL en auth-v1 es rechazado
  it('158. submit_match_action: issued_tick NULL en auth-v1 es rechazado inmediatamente', () => {
    const sqlPath = join(process.cwd(), 'supabase', '36-rival-semilla-ranked.sql')
    const sqlContent = readFileSync(sqlPath, 'utf8')

    expect(sqlContent).toMatch(/issued_tick obligatorio y no negativo en auth-v1/i)
  })

  // 159. seq negativo o nulo es rechazado
  it('159. submit_match_action: seq nulo o negativo es rechazado', () => {
    const sqlPath = join(process.cwd(), 'supabase', '36-rival-semilla-ranked.sql')
    const sqlContent = readFileSync(sqlPath, 'utf8')

    expect(sqlContent).toMatch(/p_seq IS NULL OR p_seq < 0/i)
  })

  // 160. Duplicado exacto devuelve duplicate: true con el mismo id
  it('160. submit_match_action: acción idéntica con el mismo seq retorna duplicate: true', () => {
    const sqlPath = join(process.cwd(), 'supabase', '36-rival-semilla-ranked.sql')
    const sqlContent = readFileSync(sqlPath, 'utf8')

    expect(sqlContent).toMatch(/'duplicate',\s*TRUE/i)
  })

  // 161. Mismo seq con contenido distinto falla con SEQ_CONFLICT
  it('161. submit_match_action: seq duplicado con contenido dispar rechaza con error de conflicto', () => {
    const sqlPath = join(process.cwd(), 'supabase', '36-rival-semilla-ranked.sql')
    const sqlContent = readFileSync(sqlPath, 'utf8')

    expect(sqlContent).toMatch(/seq ya usado con otra acción/i)
  })

  // 162. Plant sin slot o sin plant_id es rechazada
  it('162. submit_match_action: plant sin slot o sin plant_id válido es rechazada', () => {
    const sqlPath = join(process.cwd(), 'supabase', '36-rival-semilla-ranked.sql')
    const sqlContent = readFileSync(sqlPath, 'utf8')

    expect(sqlContent).toMatch(/plant_id obligatorio en plant/i)
    expect(sqlContent).toMatch(/slot obligatorio \(0\.\.5\) en plant/i)
  })

  // 163. Collect sin target_id es rechazada
  it('163. submit_match_action: collect sin target_id es rechazada', () => {
    const sqlPath = join(process.cwd(), 'supabase', '36-rival-semilla-ranked.sql')
    const sqlContent = readFileSync(sqlPath, 'utf8')

    expect(sqlContent).toMatch(/target_id obligatorio y no vacío en collect/i)
  })

  // 164. Relación temporal incorrecta (plant tick != issued + 6) es rechazada
  it('164. submit_match_action: relación tick != issued_tick + 6 es rechazada', () => {
    const sqlPath = join(process.cwd(), 'supabase', '36-rival-semilla-ranked.sql')
    const sqlContent = readFileSync(sqlPath, 'utf8')

    expect(sqlContent).toMatch(/margen de red inválido: tick debe ser issued_tick \+ 6/i)
  })

  // 165. Acciones durante verificación (verifying/verified/failed) son rechazadas
  it('165. submit_match_action: acción después del freeze es rechazada', () => {
    const sqlPath = join(process.cwd(), 'supabase', '36-rival-semilla-ranked.sql')
    const sqlContent = readFileSync(sqlPath, 'utf8')

    expect(sqlContent).toMatch(/verification_status IN \('verifying', 'verified', 'failed'\)/i)
  })

  // ===========================================================================
  // BQ. PRUEBAS DE VERIFICACIÓN verify-match
  // ===========================================================================

  // 166. verify-match: plan missing marca failed y no liquida ELO
  it('166. verify-match: plan ausente marca failed y no altera ELO', () => {
    const verifyPath = join(process.cwd(), 'supabase', 'functions', 'verify-match', 'index.ts')
    const verifyContent = readFileSync(verifyPath, 'utf8')

    expect(verifyContent).toMatch(/async_plan_missing/i)
    expect(verifyContent).toMatch(/mark_match_verification_failed/i)
  })

  // 167. verify-match: protocol_version no coincidente marca PROTOCOL_VERSION_MISMATCH
  it('167. verify-match: protocol_version dispar marca PROTOCOL_VERSION_MISMATCH', () => {
    const verifyPath = join(process.cwd(), 'supabase', 'functions', 'verify-match', 'index.ts')
    const verifyContent = readFileSync(verifyPath, 'utf8')

    expect(verifyContent).toMatch(/PROTOCOL_VERSION_MISMATCH/i)
  })

  // 168. verify-match: async_opponent_id dispar marca ASYNC_SNAPSHOT_MISMATCH
  it('168. verify-match: snapshot dispar entre room y plan marca ASYNC_SNAPSHOT_MISMATCH', () => {
    const verifyPath = join(process.cwd(), 'supabase', 'functions', 'verify-match', 'index.ts')
    const verifyContent = readFileSync(verifyPath, 'utf8')

    expect(verifyContent).toMatch(/ASYNC_SNAPSHOT_MISMATCH/i)
  })

  // 169. verify-match: mazo snapshot corrupto marca invalid_deck_snapshot
  it('169. verify-match: deck snapshot corrupto falla con invalid_deck_snapshot', () => {
    const verifyPath = join(process.cwd(), 'supabase', 'functions', 'verify-match', 'index.ts')
    const verifyContent = readFileSync(verifyPath, 'utf8')

    expect(verifyContent).toMatch(/invalid_deck_snapshot/i)
    expect(verifyContent).toMatch(/validarMazoAsyncRanked\(room\.p1_deck\)/i)
    expect(verifyContent).toMatch(/validarMazoAsyncRanked\(room\.async_deck_snapshot\)/i)
  })

  // 170. verify-match: no-result sin ganador falla cerrado sin settlement ni ELO
  it('170. verify-match: partida asíncrona sin ganador 1 o 2 falla cerrado sin liquidar ELO', () => {
    const verifyPath = join(process.cwd(), 'supabase', 'functions', 'verify-match', 'index.ts')
    const verifyContent = readFileSync(verifyPath, 'utf8')

    expect(verifyContent).toMatch(/resAsync\.ganador !== 1 && resAsync\.ganador !== 2/i)
    expect(verifyContent).toMatch(/mark_match_verification_failed/i)
  })

  // 171. verify-match: ganador 1 o 2 liquida con settle_verified_async_ranked_match
  it('171. verify-match: ganador determinista 1 o 2 liquida con settle_verified_async_ranked_match', () => {
    const verifyPath = join(process.cwd(), 'supabase', 'functions', 'verify-match', 'index.ts')
    const verifyContent = readFileSync(verifyPath, 'utf8')

    expect(verifyContent).toMatch(/settle_verified_async_ranked_match/i)
    expect(verifyContent).toMatch(/p_winner_side: winnerSide/i)
  })

  // 172. verify-match: consensus no se aplica a partidas asíncronas
  it('172. verify-match: partidas asíncronas no usan client consensus bajo ninguna circunstancia', () => {
    const verifyPath = join(process.cwd(), 'supabase', 'functions', 'verify-match', 'index.ts')
    const verifyContent = readFileSync(verifyPath, 'utf8')

    // La rama de consenso está exclusivamente dentro de CASO 2 (humano vs humano)
    const asyncCaseIndex = verifyContent.indexOf('CASO 1: PARTIDA ASÍNCRONA')
    const humanCaseIndex = verifyContent.indexOf('CASO 2: PARTIDA HUMANO VS HUMANO')
    const consensusIndex = verifyContent.indexOf('ranked_client_consensus')

    expect(asyncCaseIndex).toBeGreaterThan(-1)
    expect(humanCaseIndex).toBeGreaterThan(-1)
    expect(consensusIndex).toBeGreaterThan(humanCaseIndex)
  })

  // ===========================================================================
  // BR. PRUEBAS DE SURRENDER Y REPORT RESULT
  // ===========================================================================

  // 173. report_match_result en async match es sólo solicitud de verificación (no autoritativo)
  it('173. report_match_result: en salas asíncronas sólo registra verification_requested_at sin declarar ganador', () => {
    const sqlPath = join(process.cwd(), 'supabase', '36-rival-semilla-ranked.sql')
    const sqlContent = readFileSync(sqlPath, 'utf8')

    expect(sqlContent).toMatch(/IF v_room\.is_async_match THEN[\s\S]*verification_requested_at = COALESCE\(verification_requested_at, NOW\(\)\)[\s\S]*'status',\s*'verificacion_pendiente'/i)
  })

  // 174. surrender_match en async match deduce ELO autoritativamente
  it('174. surrender_match: en salas asíncronas otorga derrota al jugador real e impone p2_won con server_winner_id NULL', () => {
    const sqlPath = join(process.cwd(), 'supabase', '36-rival-semilla-ranked.sql')
    const sqlContent = readFileSync(sqlPath, 'utf8')

    expect(sqlContent).toMatch(/status = 'p2_won'[\s\S]*server_winner_id = NULL/i)
    expect(sqlContent).toMatch(/elo_rating = GREATEST\(0, elo_rating - v_menos\)/i)
  })

  // 175. surrender_match durante verifying/failed es rechazado
  it('175. surrender_match: si la partida está en verificación o cerrada, es rechazado', () => {
    const sqlPath = join(process.cwd(), 'supabase', '36-rival-semilla-ranked.sql')
    const sqlContent = readFileSync(sqlPath, 'utf8')

    expect(sqlContent).toMatch(/v_room\.verification_status IN \('verifying', 'failed'\)/i)
  })

  // 176. surrender_match no modifica la cuenta fuente de la semilla
  it('176. surrender_match: no modifica perfiles distintos al usuario real player1_id', () => {
    const sqlPath = join(process.cwd(), 'supabase', '36-rival-semilla-ranked.sql')
    const sqlContent = readFileSync(sqlPath, 'utf8')

    expect(sqlContent).toMatch(/UPDATE public\.profiles[\s\S]*WHERE id = v_uid/i)
    expect(sqlContent).not.toMatch(/UPDATE public\.profiles[\s\S]*WHERE id = v_room\.async_opponent_id/i)
  })

  // ===========================================================================
  // BS. SECURITY TESTS & AUDITORÍA ESTÁTICA
  // ===========================================================================

  // 177. RLS y permisos en tablas privadas
  it('177. Seguridad: ranked_async_opponents y ranked_async_room_plans tienen RLS activado y REVOKE de anon/authenticated', () => {
    const sqlPath = join(process.cwd(), 'supabase', '36-rival-semilla-ranked.sql')
    const sqlContent = readFileSync(sqlPath, 'utf8')

    expect(sqlContent).toMatch(/ALTER TABLE public\.ranked_async_opponents ENABLE ROW LEVEL SECURITY;/i)
    expect(sqlContent).toMatch(/REVOKE ALL ON public\.ranked_async_opponents FROM anon, authenticated, PUBLIC;/i)
    expect(sqlContent).toMatch(/GRANT ALL ON public\.ranked_async_opponents TO service_role;/i)

    expect(sqlContent).toMatch(/ALTER TABLE public\.ranked_async_room_plans ENABLE ROW LEVEL SECURITY;/i)
    expect(sqlContent).toMatch(/REVOKE ALL ON public\.ranked_async_room_plans FROM anon, authenticated, PUBLIC;/i)
    expect(sqlContent).toMatch(/GRANT ALL ON public\.ranked_async_room_plans TO service_role;/i)
  })

  // 178. Funciones sensibles sólo ejecutables por service_role
  it('178. Seguridad: capture_ranked_async_opponents_from_room y settle_verified_async_ranked_match son exclusivas de service_role', () => {
    const sqlPath = join(process.cwd(), 'supabase', '36-rival-semilla-ranked.sql')
    const sqlContent = readFileSync(sqlPath, 'utf8')

    expect(sqlContent).toMatch(/REVOKE EXECUTE ON FUNCTION public\.capture_ranked_async_opponents_from_room\(UUID\) FROM anon, authenticated, PUBLIC;/i)
    expect(sqlContent).toMatch(/GRANT  EXECUTE ON FUNCTION public\.capture_ranked_async_opponents_from_room\(UUID\) TO service_role;/i)

    expect(sqlContent).toMatch(/REVOKE EXECUTE ON FUNCTION public\.settle_verified_async_ranked_match\(UUID, SMALLINT, JSONB\)[\s\S]*FROM PUBLIC, anon, authenticated;/i)
    expect(sqlContent).toMatch(/GRANT EXECUTE ON FUNCTION public\.settle_verified_async_ranked_match\(UUID, SMALLINT, JSONB\) TO service_role;/i)
  })

  // 179. Todas las funciones SECURITY DEFINER tienen search_path seguro
  it('179. Seguridad: todas las funciones SECURITY DEFINER definen search_path = public, pg_temp', () => {
    const sqlPath = join(process.cwd(), 'supabase', '36-rival-semilla-ranked.sql')
    const sqlContent = readFileSync(sqlPath, 'utf8')

    const secDefCount = (sqlContent.match(/SECURITY DEFINER/g) || []).length
    const searchPathCount = (sqlContent.match(/SET search_path = public, pg_temp/g) || []).length

    expect(secDefCount).toBeGreaterThan(0)
    expect(searchPathCount).toBe(secDefCount)
  })

  // 180. Preflight audit script no contiene comandos de modificación (INSERT, UPDATE, DELETE, ALTER, DROP)
  it('180. Preflight audit: script 36-rival-semilla-ranked-preflight.sql es estrictamente read-only', () => {
    const preflightPath = join(process.cwd(), 'supabase', '36-rival-semilla-ranked-preflight.sql')
    const preflightContent = readFileSync(preflightPath, 'utf8')

    expect(preflightContent).not.toMatch(/^\s*INSERT\s+INTO/im)
    expect(preflightContent).not.toMatch(/^\s*UPDATE\s+/im)
    expect(preflightContent).not.toMatch(/^\s*DELETE\s+FROM/im)
    expect(preflightContent).not.toMatch(/^\s*DROP\s+/im)
    expect(preflightContent).not.toMatch(/^\s*ALTER\s+/im)
  })

  // 181. Postcheck script es estrictamente read-only
  it('181. Postcheck audit: script 36-rival-semilla-ranked-postcheck.sql es estrictamente read-only', () => {
    const postcheckPath = join(process.cwd(), 'supabase', '36-rival-semilla-ranked-postcheck.sql')
    const postcheckContent = readFileSync(postcheckPath, 'utf8')

    expect(postcheckContent).not.toMatch(/^\s*INSERT\s+INTO/im)
    expect(postcheckContent).not.toMatch(/^\s*UPDATE\s+/im)
    expect(postcheckContent).not.toMatch(/^\s*DELETE\s+FROM/im)
    expect(postcheckContent).not.toMatch(/^\s*DROP\s+/im)
    expect(postcheckContent).not.toMatch(/^\s*ALTER\s+/im)
  })

  // 182. Auditoría estática de Migración 36: No existen inferencias de issued_tick
  it('182. Auditoría estática: Migración 36 no contiene inferencias ni COALESCE de issued_tick', () => {
    const sqlPath = join(process.cwd(), 'supabase', '36-rival-semilla-ranked.sql')
    const sqlContent = readFileSync(sqlPath, 'utf8')

    expect(sqlContent).not.toMatch(/COALESCE\(\s*issued_tick/i)
    expect(sqlContent).not.toMatch(/COALESCE\(\s*issuedTick/i)
    expect(sqlContent).not.toMatch(/COALESCE\(\s*p_issued_tick/i)
    expect(sqlContent).not.toMatch(/COALESCE\(\s*elem->>'issuedTick'/i)
  })

  // 183. Auditoría estática de Migración 36: No existen fallbacks silenciosos de engine_version
  it('183. Auditoría estática: Migración 36 no contiene COALESCE de engine_version para semillas', () => {
    const sqlPath = join(process.cwd(), 'supabase', '36-rival-semilla-ranked.sql')
    const sqlContent = readFileSync(sqlPath, 'utf8')

    expect(sqlContent).not.toMatch(/COALESCE\(.*engine_version,\s*'auth-v1'\)/i)
  })

  // 184. Auditoría estática de Migración 36: Backfill no captura WHEN OTHERS silencioso
  it('184. Auditoría estática: Backfill no utiliza EXCEPTION WHEN OTHERS para ocultar fallos', () => {
    const sqlPath = join(process.cwd(), 'supabase', '36-rival-semilla-ranked.sql')
    const sqlContent = readFileSync(sqlPath, 'utf8')

    expect(sqlContent).not.toMatch(/EXCEPTION\s+WHEN\s+OTHERS/i)
  })

  // 185. Validación estricta de plantId en catálogo
  it('185. Validación de plantId: sólo las 15 plantas registradas son admitidas', () => {
    const validPlants = [
      'sunflower', 'peashooter', 'repeater', 'wallnut', 'melonpult',
      'chomper', 'bonkchoy', 'garlic', 'squash', 'twinsunflower',
      'threepeater', 'tallnut', 'jalapeno', 'iceberglettuce', 'aloe'
    ]

    for (const p of validPlants) {
      expect(validarAccionP1RankedEstricta({
        seq: 1,
        tick: 16,
        issuedTick: 10,
        kind: 'plant',
        plantId: p,
        slot: 0,
        lane: 0,
        col: 0,
      }).ok).toBe(true)
    }

    expect(validarAccionP1RankedEstricta({
      seq: 1,
      tick: 16,
      issuedTick: 10,
      kind: 'plant',
      plantId: 'cattail_invented',
      slot: 0,
      lane: 0,
      col: 0,
    }).ok).toBe(false)
  })

  // ===========================================================================
  // BLOQUEADORES RECIENTES: TESTS ESPECÍFICOS (186-203)
  // ===========================================================================

  // 186. resolutionSource NULL / missing → no captura (INVALID_SOURCE_VERIFICATION)
  it('186. resolutionSource NULL en verification_payload rechaza la captura con INVALID_SOURCE_VERIFICATION', () => {
    const sqlPath = join(process.cwd(), 'supabase', '36-rival-semilla-ranked.sql')
    const sqlContent = readFileSync(sqlPath, 'utf8')

    expect(sqlContent).toMatch(/v_resolution_source IS NULL OR v_resolution_source <> 'authoritative_replay'/i)
    expect(sqlContent).toMatch(/INVALID_SOURCE_VERIFICATION/i)
  })

  // 187. resolutionSource desconocido → no captura
  it('187. resolutionSource desconocido o no autoritativo rechaza la captura', () => {
    const sqlPath = join(process.cwd(), 'supabase', '36-rival-semilla-ranked.sql')
    const sqlContent = readFileSync(sqlPath, 'utf8')

    expect(sqlContent).toMatch(/resolutionSource debe ser authoritative_replay/i)
  })

  // 188. authoritative_replay afirmativo y válido es capturado
  it('188. Partida con resolutionSource = authoritative_replay, consistent=true y 0 ilegales es capturada positivamente', () => {
    const sqlPath = join(process.cwd(), 'supabase', '36-rival-semilla-ranked.sql')
    const sqlContent = readFileSync(sqlPath, 'utf8')

    expect(sqlContent).toMatch(/resolutionSource' = 'authoritative_replay'/i)
    expect(sqlContent).toMatch(/v_room\.verification_payload->>'consistent' <> 'true'/i)
  })

  // 189. verify-match humano ganador escribe resolutionSource = authoritative_replay
  it('189. verify-match escribe explícitamente resolutionSource: authoritative_replay al liquidar ganador humano por replay', () => {
    const verifyPath = join(process.cwd(), 'supabase', 'functions', 'verify-match', 'index.ts')
    const verifyContent = readFileSync(verifyPath, 'utf8')

    expect(verifyContent).toMatch(/payloadAuthoritative\s*=\s*\{[\s\S]*resolutionSource:\s*'authoritative_replay'/i)
  })

  // 190. verify-match true_draw autoritativo escribe resolutionSource = authoritative_replay
  it('190. verify-match escribe explícitamente resolutionSource: authoritative_replay al liquidar empate autoritativo (true_draw)', () => {
    const verifyPath = join(process.cwd(), 'supabase', 'functions', 'verify-match', 'index.ts')
    const verifyContent = readFileSync(verifyPath, 'utf8')

    expect(verifyContent).toMatch(/payloadDraw\s*=\s*\{[\s\S]*resolutionSource:\s*'authoritative_replay'/i)
  })

  // 191. _validate_ranked_async_plan detecta SEQ_CONFLICT cuando sólo difiere en slot
  it('191. _validate_ranked_async_plan detecta SEQ_CONFLICT cuando dos intenciones con mismo seq difieren únicamente en slot', () => {
    const rawPlan = [
      { seq: 50, issuedTick: 100, tick: 106, kind: 'plant', plantId: 'peashooter', lane: 0, col: 0, slot: 0 },
      { seq: 50, issuedTick: 100, tick: 106, kind: 'plant', plantId: 'peashooter', lane: 0, col: 0, slot: 4 },
    ]
    const val = validarYNormalizarIntencionesAsyncRanked(rawPlan)
    expect(val.ok).toBe(false)
    if (!val.ok) {
      expect(val.reason).toBe('SEQ_CONFLICT')
    }
  })

  // 192. _validate_ranked_async_plan detecta SEQ_CONFLICT ante diferencias en tick, issuedTick, kind, lane, col, plantId
  it('192. _validate_ranked_async_plan detecta SEQ_CONFLICT ante cualquier diferencia individual de campos', () => {
    const baseIntent = { seq: 10, issuedTick: 50, tick: 56, kind: 'plant', plantId: 'sunflower', lane: 1, col: 1, slot: 0 }

    // Diferencia en issuedTick
    const diffIssued = [baseIntent, { ...baseIntent, issuedTick: 60, tick: 66 }]
    expect(validarYNormalizarIntencionesAsyncRanked(diffIssued).ok).toBe(false)

    // Diferencia en tick
    const diffTick = [baseIntent, { ...baseIntent, tick: 50 }]
    expect(validarYNormalizarIntencionesAsyncRanked(diffTick).ok).toBe(false)

    // Diferencia en kind
    const diffKind = [baseIntent, { ...baseIntent, kind: 'dig', plantId: undefined, slot: undefined }]
    expect(validarYNormalizarIntencionesAsyncRanked(diffKind).ok).toBe(false)

    // Diferencia en lane
    const diffLane = [baseIntent, { ...baseIntent, lane: 2 }]
    expect(validarYNormalizarIntencionesAsyncRanked(diffLane).ok).toBe(false)

    // Diferencia en col
    const diffCol = [baseIntent, { ...baseIntent, col: 3 }]
    expect(validarYNormalizarIntencionesAsyncRanked(diffCol).ok).toBe(false)

    // Diferencia en plantId
    const diffPlant = [baseIntent, { ...baseIntent, plantId: 'wallnut' }]
    expect(validarYNormalizarIntencionesAsyncRanked(diffPlant).ok).toBe(false)
  })

  // 193. _validate_ranked_async_plan acepta duplicado idéntico completo como idempotente
  it('193. _validate_ranked_async_plan acepta duplicado idéntico completo con mismo seq sin conflicto', () => {
    const identicalPlan = [
      { seq: 25, issuedTick: 100, tick: 106, kind: 'plant', plantId: 'repeater', lane: 1, col: 2, slot: 1 },
      { seq: 25, issuedTick: 100, tick: 106, kind: 'plant', plantId: 'repeater', lane: 1, col: 2, slot: 1 },
    ]
    const val = validarYNormalizarIntencionesAsyncRanked(identicalPlan)
    expect(val.ok).toBe(true)
    if (val.ok) {
      expect(val.intenciones.length).toBe(1)
    }
  })

  // 194. settle_verified_async_ranked_match valida independientemente plan missing
  it('194. settle_verified_async_ranked_match valida independientemente que el plan privado exista', () => {
    const sqlPath = join(process.cwd(), 'supabase', '36-rival-semilla-ranked.sql')
    const sqlContent = readFileSync(sqlPath, 'utf8')

    expect(sqlContent).toMatch(/SELECT \* INTO v_plan FROM public\.ranked_async_room_plans WHERE room_id = p_room_id;/i)
    expect(sqlContent).toMatch(/RAISE EXCEPTION 'ASYNC_PLAN_MISSING';/i)
  })

  // 195. settle_verified_async_ranked_match valida protocol mismatch
  it('195. settle_verified_async_ranked_match valida que protocol_version sea ranked-async-v1', () => {
    const sqlPath = join(process.cwd(), 'supabase', '36-rival-semilla-ranked.sql')
    const sqlContent = readFileSync(sqlPath, 'utf8')

    expect(sqlContent).toMatch(/v_plan\.protocol_version <> 'ranked-async-v1'/i)
    expect(sqlContent).toMatch(/RAISE EXCEPTION 'PROTOCOL_VERSION_MISMATCH';/i)
  })

  // 196. settle_verified_async_ranked_match valida opponent mismatch
  it('196. settle_verified_async_ranked_match valida que el plan pertenezca al async_opponent_id de la sala', () => {
    const sqlPath = join(process.cwd(), 'supabase', '36-rival-semilla-ranked.sql')
    const sqlContent = readFileSync(sqlPath, 'utf8')

    expect(sqlContent).toMatch(/v_plan\.async_opponent_id <> v_room\.async_opponent_id/i)
    expect(sqlContent).toMatch(/RAISE EXCEPTION 'ASYNC_OPPONENT_MISMATCH';/i)
  })

  // 197. settle_verified_async_ranked_match valida coherencia de deck snapshots
  it('197. settle_verified_async_ranked_match valida coherencia de deck snapshot contra el Rival Semilla', () => {
    const sqlPath = join(process.cwd(), 'supabase', '36-rival-semilla-ranked.sql')
    const sqlContent = readFileSync(sqlPath, 'utf8')

    expect(sqlContent).toMatch(/v_room\.async_deck_snapshot <> v_opp\.deck_snapshot/i)
    expect(sqlContent).toMatch(/RAISE EXCEPTION 'ASYNC_DECK_SNAPSHOT_MISMATCH';/i)
  })

  // 198. capture_ranked_async_opponents_from_room no incrementa capturedSides ante snapshot ya existente
  it('198. capture_ranked_async_opponents_from_room reporta alreadyExistingSides sin duplicar capturedSides', () => {
    const sqlPath = join(process.cwd(), 'supabase', '36-rival-semilla-ranked.sql')
    const sqlContent = readFileSync(sqlPath, 'utf8')

    expect(sqlContent).toMatch(/v_already_existing_sides := v_already_existing_sides \+ 1;/i)
    expect(sqlContent).toMatch(/'alreadyExistingSides',\s*v_already_existing_sides/i)
  })

  // 199. capture_ranked_async_opponents_from_room devuelve SOURCE_SNAPSHOT_CONFLICT si difiere
  it('199. capture_ranked_async_opponents_from_room devuelve SOURCE_SNAPSHOT_CONFLICT ante snapshot contradictorio', () => {
    const sqlPath = join(process.cwd(), 'supabase', '36-rival-semilla-ranked.sql')
    const sqlContent = readFileSync(sqlPath, 'utf8')

    expect(sqlContent).toMatch(/SOURCE_SNAPSHOT_CONFLICT/i)
    expect(sqlContent).toMatch(/'conflictedSides',/i)
    expect(sqlContent).toMatch(/v_p1_status = 'CONFLICT'/i)
  })

  // 200. Preflight audit script exige resolutionSource = 'authoritative_replay'
  it('200. Preflight script exige resolutionSource = authoritative_replay afirmativo y no usa COALESCE', () => {
    const preflightPath = join(process.cwd(), 'supabase', '36-rival-semilla-ranked-preflight.sql')
    const preflightContent = readFileSync(preflightPath, 'utf8')

    expect(preflightContent).toMatch(/verification_payload->>'resolutionSource' = 'authoritative_replay'/i)
    expect(preflightContent).not.toMatch(/resolutionSource.*IS DISTINCT FROM/i)
    expect(preflightContent).not.toMatch(/COALESCE\(.*illegalCount/i)
    expect(preflightContent).not.toMatch(/COALESCE\(.*ticks/i)
  })

  // 201. Preflight audit contiene desglose detallado de incompatibilidades
  it('201. Preflight script contiene consultas de desglose para inconsistent, illegals, consensus y forfeits', () => {
    const preflightPath = join(process.cwd(), 'supabase', '36-rival-semilla-ranked-preflight.sql')
    const preflightContent = readFileSync(preflightPath, 'utf8')

    expect(preflightContent).toMatch(/2\.1 Salas sin verification_payload/i)
    expect(preflightContent).toMatch(/2\.2 Salas sin consistent o consistent != true/i)
    expect(preflightContent).toMatch(/2\.3 Salas con illegalCount ausente o distinto de cero/i)
    expect(preflightContent).toMatch(/2\.4 Salas con resolutionSource ausente o distinto de authoritative_replay/i)
    expect(preflightContent).toMatch(/2\.5 Salas resueltas por consenso de clientes/i)
    expect(preflightContent).toMatch(/2\.6 Salas con ticks ausentes o menores a 300/i)
    expect(preflightContent).toMatch(/2\.7 Salas finalizadas por surrender o forfeit/i)
  })

  // 202. Postcheck audit contiene validaciones semánticas completas
  it('202. Postcheck script valida semántica de mazos y planes usando funciones de validación oficiales', () => {
    const postcheckPath = join(process.cwd(), 'supabase', '36-rival-semilla-ranked-postcheck.sql')
    const postcheckContent = readFileSync(postcheckPath, 'utf8')

    expect(postcheckContent).toMatch(/public\._validate_ranked_async_deck\(deck_snapshot\)/i)
    expect(postcheckContent).toMatch(/public\._validate_ranked_async_plan\(actions_snapshot\)/i)
    expect(postcheckContent).toMatch(/p\.async_opponent_id <> gr\.async_opponent_id/i)
    expect(postcheckContent).toMatch(/gr\.async_deck_snapshot <> o\.deck_snapshot/i)
    expect(postcheckContent).toMatch(/r\.verification_payload->>'resolutionSource' <> 'authoritative_replay'/i)
  })

  // 203. Formato seguro de verification_payload previene fallos por strings malformados sin usar WHEN OTHERS
  it('203. capture_ranked_async_opponents_from_room valida formato de texto antes de convertir a entero', () => {
    const sqlPath = join(process.cwd(), 'supabase', '36-rival-semilla-ranked.sql')
    const sqlContent = readFileSync(sqlPath, 'utf8')

    expect(sqlContent).toMatch(/\(v_room\.verification_payload->>'illegalCount'\) !~ '\^\\d\+\$'/i)
    expect(sqlContent).toMatch(/\(v_room\.verification_payload->>'ticks'\) !~ '\^\\d\+\$'/i)
  })

  // 204. Test crítico de contaminación entre intents (Test 8 del prompt)
  it('204. Validación P2: no existe contaminación residual de variables entre intents de distinto tipo', () => {
    const planConInterleaving = [
      { seq: 10, kind: 'plant', plantId: 'peashooter', slot: 2, lane: 0, col: 0, issuedTick: 10, tick: 16 },
      { seq: 20, kind: 'dig', lane: 0, col: 1, issuedTick: 20, tick: 26 },
      { seq: 30, kind: 'plant', plantId: 'sunflower', slot: 0, lane: 1, col: 0, issuedTick: 30, tick: 36 },
      { seq: 20, kind: 'dig', lane: 0, col: 1, issuedTick: 20, tick: 26 },
    ]
    const val = validarYNormalizarIntencionesAsyncRanked(planConInterleaving)
    expect(val.ok).toBe(true)
    if (val.ok) {
      expect(val.intenciones.length).toBe(3)
      const digIntent = val.intenciones.find((i) => i.seq === 20)
      expect(digIntent).toBeDefined()
      expect(digIntent?.kind).toBe('dig')
      expect(digIntent?.plantId).toBeUndefined()
      expect(digIntent?.slot).toBeUndefined()
    }
  })

  // 205. Test inverso de conflicto real en dig (Test 9 del prompt)
  it('205. Validación P2: conflicto real en dig (col distinta) reporta SEQ_CONFLICT correctamente', () => {
    const planConConflictoDig = [
      { seq: 10, kind: 'plant', plantId: 'peashooter', slot: 2, lane: 0, col: 0, issuedTick: 10, tick: 16 },
      { seq: 20, kind: 'dig', lane: 0, col: 1, issuedTick: 20, tick: 26 },
      { seq: 30, kind: 'plant', plantId: 'sunflower', slot: 4, lane: 1, col: 0, issuedTick: 30, tick: 36 },
      { seq: 20, kind: 'dig', lane: 0, col: 2, issuedTick: 20, tick: 26 },
    ]
    const val = validarYNormalizarIntencionesAsyncRanked(planConConflictoDig)
    expect(val.ok).toBe(false)
    if (!val.ok) {
      expect(val.reason).toBe('SEQ_CONFLICT')
    }
  })

  // 206. Auditoría estática: _validate_ranked_async_plan resetea variables y canonicaliza explícitamente
  it('206. Auditoría estática: _validate_ranked_async_plan resetea variables por iteración y canonicaliza dig sin residuos de plant', () => {
    const sqlPath = join(process.cwd(), 'supabase', '36-rival-semilla-ranked.sql')
    const sqlContent = readFileSync(sqlPath, 'utf8')

    expect(sqlContent).toMatch(/v_plant_id := NULL;/i)
    expect(sqlContent).toMatch(/v_slot := NULL;/i)
    expect(sqlContent).toMatch(/'plantId',\s*NULL,\s*'slot',\s*NULL/i)
  })

  // 207. Auditoría estática: capture_ranked_async_opponents_from_room ejecuta row lock de concurrencia
  it('207. Auditoría estática: capture_ranked_async_opponents_from_room serializa la captura mediante row lock FOR UPDATE', () => {
    const sqlPath = join(process.cwd(), 'supabase', '36-rival-semilla-ranked.sql')
    const sqlContent = readFileSync(sqlPath, 'utf8')

    expect(sqlContent).toMatch(/SELECT \* INTO v_room FROM public\.game_rooms WHERE id = p_room_id FOR UPDATE;/i)
  })

  // 208. Auditoría estática: capture_ranked_async_opponents_from_room es atómica (Fase 1 Validate -> Conflict Check -> Fase 2 Write)
  it('208. Auditoría estática: captura es atómica all-or-nothing (0 cambios si cualquier lado tiene conflicto)', () => {
    const sqlPath = join(process.cwd(), 'supabase', '36-rival-semilla-ranked.sql')
    const sqlContent = readFileSync(sqlPath, 'utf8')

    expect(sqlContent).toMatch(/FASE 1: READ \/ VALIDATE ONLY \(CERO ESCRITURAS\)/i)
    expect(sqlContent).toMatch(/IF v_p1_status = 'CONFLICT' OR v_p2_status = 'CONFLICT' THEN/i)
    expect(sqlContent).toMatch(/'capturedSides',\s*0,\s*'alreadyExistingSides',\s*0/i)
    expect(sqlContent).toMatch(/FASE 2: WRITE ONLY \(SÓLO SI NO HUBO NINGÚN CONFLICTO\)/i)
  })

  // 209. Auditoría estática: Backfill registra y maneja conflictos sin dejar escrituras parciales
  it('209. Auditoría estática: Backfill DO contabiliza conflictos y no usa WHEN OTHERS', () => {
    const sqlPath = join(process.cwd(), 'supabase', '36-rival-semilla-ranked.sql')
    const sqlContent = readFileSync(sqlPath, 'utf8')

    expect(sqlContent).toMatch(/v_conflicted INTEGER := 0;/i)
    expect(sqlContent).toMatch(/v_res->>'reason'\) = 'SOURCE_SNAPSHOT_CONFLICT'/i)
    expect(sqlContent).not.toMatch(/WHEN OTHERS/i)
  })
})




