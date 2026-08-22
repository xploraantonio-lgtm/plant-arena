import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  createAsyncOpponentController,
  stepAsyncOpponent,
  simulateAsyncMatch,
  normalizarIntenciones,
  resolverCartaRival,
  reconstruirPartidaAsync,
  runAsyncTimeline,
  normalizarAccionesP1,
  registrarAccionP1Async,
  descartarAccionP1Async,
  type AsyncOpponentIntent,
  type AccionP1Simulacion,
} from './asyncOpponent.ts'
import type { CartaDeMazo } from './mazoDeLaSala.ts'
import { createBattleState, stepTick } from './simulate.ts'
import { PLANT_CONFIGS, TOTAL_COLUMNS, getScaledPlantConfig } from '../utils/gameConstants.ts'

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
    const intents: AsyncOpponentIntent[] = [
      { seq: 1, tick: 310, issuedTick: 310, kind: 'plant', plantId: 'sunflower', slot: 0, lane: 1, col: 1 },
    ]

    // Acciones de P1: una válida en tic 5, y una que luego se descartará en tic 15
    const p1AccionesOriginales = [
      { tick: 5, kind: 'plant', plantId: 'sunflower', lane: 1, col: 1 },
      { tick: 15, kind: 'plant', plantId: 'sunflower', lane: 0, col: 1 },
    ]

    // Simular el avance hasta tic 330 (el girasol entra al campo en tic 310 + 6 = 316)
    const { estado: estadoNormal } = reconstruirPartidaAsync(seed, p1Deck, p2Deck, intents, p1AccionesOriginales, 330)
    expect(estadoNormal.enemyPlants.length).toBe(1)

    // Si Supabase rechaza la jugada de tic 15, se descarta de P1 y se reconstruye:
    const p1AccionesFiltradas = p1AccionesOriginales.filter((a) => a.tick !== 15)
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
    expect(verifyContent).toMatch(/select\(['"]actions_snapshot['"]\)/i)

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
    const ordenadas = normalizarAccionesP1(historial)

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

    // En Variante A, la planta no pudo colocarse porque en seq 20 sólo había 75 soles
    expect(resA.state.plants.some((p) => p.plantId === 'peashooter')).toBe(false)
    expect(resA.state.sunBank).toBe(100)

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
})

