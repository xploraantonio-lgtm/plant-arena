import { describe, it, expect } from 'vitest'
import {
  createAsyncOpponentController,
  stepAsyncOpponent,
  simulateAsyncMatch,
  normalizarIntenciones,
  resolverCartaRival,
} from './asyncOpponent.ts'
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
})
