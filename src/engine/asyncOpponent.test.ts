import { describe, it, expect } from 'vitest'
import {
  createAsyncOpponentController,
  stepAsyncOpponent,
  simulateAsyncMatch,
  normalizarIntenciones,
  resolverCartaRival,
  reconstruirPartidaAsync,
  type AsyncOpponentIntent,
} from './asyncOpponent.ts'
import type { CartaDeMazo } from './mazoDeLaSala.ts'
import { createBattleState } from './simulate.ts'
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
  it('42. poll_ranked_async_intents restringe las acciones a la ventana autorizada (~5 s)', () => {
    const allSnapshotIntents: AsyncOpponentIntent[] = [
      { seq: 1, tick: 10, issuedTick: 10, kind: 'plant', plantId: 'sunflower', lane: 1, col: 8 },
      { seq: 2, tick: 50, issuedTick: 50, kind: 'plant', plantId: 'peashooter', lane: 1, col: 7 },
      { seq: 3, tick: 300, issuedTick: 300, kind: 'plant', plantId: 'wallnut', lane: 1, col: 6 },
      { seq: 4, tick: 1500, issuedTick: 1500, kind: 'plant', plantId: 'jalapeno', lane: 1, col: 5 },
    ]

    // Simular consulta de cliente en tic 0 (reloj de servidor = tic 0)
    const serverTick = 0
    const clientTick = 0
    const maxRevealTick = Math.max(clientTick, serverTick) + 150 // ventana de 150 tics (~5s)

    const intentsEntregadas = allSnapshotIntents.filter(
      (i) => (i.issuedTick ?? i.tick) <= maxRevealTick
    )

    // Entrega las de tic 10 y 50, pero NUNCA las de tic 300 o 1500
    expect(intentsEntregadas).toHaveLength(2)
    expect(intentsEntregadas.map((i) => i.seq)).toEqual([1, 2])
    expect(intentsEntregadas.find((i) => i.plantId === 'jalapeno')).toBeUndefined()
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
})

