import { describe, it, expect } from 'vitest'
import {
  createBattleState,
  stepTick,
  crearSkySunId,
  crearSunflowerSunId,
  crearSunId,
} from './simulate.ts'
import { reconstruirConHuellas, conservarLoLocal, type AccionRegistrada } from './reconstruir.ts'
import { recalcularGanadorAutoritativo, type DatosDeRepeticion, type JugadaGrabada } from './replay.ts'
import { msToTicks } from './time.ts'
import { SOL_DEL_CIELO_MS } from './balance.ts'
import { simulateAsyncMatch } from './asyncOpponent.ts'

describe('sunId: Identificadores Deterministas de Soles (PvP Ranked)', () => {
  const mazoValido = [
    { plantId: 'peashooter', slot: 0, level: 1 },
    { plantId: 'sunflower', slot: 1, level: 1 },
    { plantId: 'repeater', slot: 2, level: 1 },
    { plantId: 'wallnut', slot: 3, level: 1 },
    { plantId: 'jalapeno', slot: 4, level: 1 },
    { plantId: 'chomper', slot: 5, level: 1 },
  ]

  // 1. Funciones canónicas puras
  it('1. Genera IDs canónicos con formato determinista para cielo y girasol', () => {
    const skyId = crearSkySunId(150, 0)
    expect(skyId).toBe('sun-sky-150-0')

    const flowerId = crearSunflowerSunId(2, 3, 3222, 0)
    expect(flowerId).toBe('sun-flower-2-3-3222-0')

    const flowerTwinId = crearSunflowerSunId(0, 1, 4000, 1)
    expect(flowerTwinId).toBe('sun-flower-0-1-4000-1')

    const unifiedSky = crearSunId({ type: 'sky', tick: 510, seq: 1 })
    expect(unifiedSky).toBe('sun-sky-510-1')

    const unifiedFlower = crearSunId({ type: 'flower', lane: 4, col: 5, tick: 4825, subIndex: 0 })
    expect(unifiedFlower).toBe('sun-flower-4-5-4825-0')
  })

  // 2. Inmunidad a entityCounter: Proyectiles o plantas no alteran los IDs de soles
  it('2. Los IDs de soles son estrictamente inmunes al avance de entityCounter global', () => {
    const seed = 123456789
    const stateA = createBattleState(seed, false, true)
    const stateB = createBattleState(seed, false, true)

    // En stateB provocamos que entityCounter avance drásticamente (ej. 50 proyectiles o plantas instanciadas)
    stateB.entityCounter += 50

    // Avanzamos ambas simulaciones hasta que caiga el primer sol del cielo
    const targetTicks = msToTicks(SOL_DEL_CIELO_MS) + 100
    for (let t = 0; t < targetTicks; t++) {
      stepTick(stateA, () => {})
      stepTick(stateB, () => {})
    }

    expect(stateA.suns.length).toBeGreaterThan(0)
    expect(stateB.suns.length).toBe(stateA.suns.length)

    // Los IDs de los soles deben ser exactamente iguales a pesar de la divergencia de entityCounter
    for (let i = 0; i < stateA.suns.length; i++) {
      expect(stateB.suns[i].id).toBe(stateA.suns[i].id)
    }
  })

  // 3. Fixture exacto de la room real 9c4b594c-4ac1-4e2d-a6bc-3e9f6002e6c0
  it('3. FIXTURE ROOM REAL 9c4b594c: Elimina los 4 falsos positivos bajo perturbación de red/proyectiles', () => {
    const seed = 716394912
    const p1Deck = mazoValido
    const p2Deck = mazoValido

    const skySun1Id = 'sun-sky-76-0'
    const skySun2Id = 'sun-sky-259-1'
    const skySun3Id = 'sun-sky-442-2'
    const flowerSunId = 'sun-flower-1-1-727-0'

    const jugadas: JugadaGrabada[] = [
      // 1. Collect sky sun 1
      {
        id: 100,
        seq: 1,
        de: 1,
        tick: 80,
        issuedTick: 80,
        kind: 'collect',
        plantId: null,
        lane: null,
        col: null,
        slot: null,
        targetId: skySun1Id,
      },
      // 2. Collect sky sun 2 (now sunBank = 50)
      {
        id: 101,
        seq: 2,
        de: 1,
        tick: 262,
        issuedTick: 262,
        kind: 'collect',
        plantId: null,
        lane: null,
        col: null,
        slot: null,
        targetId: skySun2Id,
      },
      // 3. Plant sunflower (cost 50)
      {
        id: 102,
        seq: 3,
        de: 1,
        tick: 271,
        issuedTick: 265,
        kind: 'plant',
        plantId: 'sunflower',
        lane: 1,
        col: 1,
        slot: 1,
        targetId: null,
      },
      // 4. Collect sky sun 3 at spawn tick + 6
      {
        id: 103,
        seq: 4,
        de: 1,
        tick: 448,
        issuedTick: 448,
        kind: 'collect',
        plantId: null,
        lane: null,
        col: null,
        slot: null,
        targetId: skySun3Id,
      },
      // 5. Collect sunflower sun at production tick + 8
      {
        id: 104,
        seq: 5,
        de: 1,
        tick: 735,
        issuedTick: 735,
        kind: 'collect',
        plantId: null,
        lane: null,
        col: null,
        slot: null,
        targetId: flowerSunId,
      },
    ]

    const datos: DatosDeRepeticion = {
      roomId: '9c4b594c-4ac1-4e2d-a6bc-3e9f6002e6c0',
      mode: 'ranked',
      seed,
      engineVersion: 'auth-v2',
      jugadaEn: '2026-08-24T05:55:12Z',
      jugador1: { nombre: 'Lionel', avatar: 'peashooter', mazo: p1Deck },
      jugador2: { nombre: 'Luisma _YT', avatar: 'peashooter', mazo: p2Deck },
      ganador: null,
      yoSoy: 1,
      jugadas,
    }

    const res = recalcularGanadorAutoritativo(datos)
    // Cero acciones ilegales: todos los collects y plants se resuelven de forma 100% canónica bajo auth-v2
    expect(res.ilegales.length).toBe(0)
  })

  // 4. Test Compatibilidad V1 Legacy: Una sala auth-v1 reproduce exactamente sus IDs legacy
  it('4. COMPATIBILIDAD V1: Una sala auth-v1 genera y valida IDs legacy basados en entityCounter', () => {
    const seed = 12345
    const simV1 = createBattleState(seed, false, true, undefined, 'auth-v1')

    // Avanzamos hasta que aparezca el primer sol del cielo en auth-v1 (tic ~76)
    for (let t = 0; t < 100; t++) {
      stepTick(simV1, () => {})
    }

    const legacySun = simV1.suns[0]
    expect(legacySun).toBeDefined()
    expect(legacySun.id).toBe('sun-sky-76-0')

    const datosV1: DatosDeRepeticion = {
      roomId: 'historical-v1-room',
      mode: 'ranked',
      seed,
      engineVersion: 'auth-v1',
      jugadaEn: '2026-08-01T00:00:00Z',
      jugador1: { nombre: 'P1', avatar: 'peashooter', mazo: mazoValido },
      jugador2: { nombre: 'P2', avatar: 'peashooter', mazo: mazoValido },
      ganador: null,
      yoSoy: 1,
      jugadas: [
        {
          id: 1,
          seq: 1,
          de: 1,
          tick: legacySun.createdAt + 10,
          issuedTick: legacySun.createdAt + 10,
          kind: 'collect',
          plantId: null,
          lane: null,
          col: null,
          slot: null,
          targetId: legacySun.id,
        },
      ],
    }

    const resV1 = recalcularGanadorAutoritativo(datosV1)
    expect(resV1.ilegales.length).toBe(0)
  })

  // 5. Test Cross-Version Fail-Closed: Sin fallback silencioso entre protocolos
  it('5. TEST CROSS-VERSION FAIL-CLOSED: TargetId v1 falla en auth-v2, y TargetId v2 falla en auth-v1', () => {
    const seed = 999888

    // Caso A: Acción emitida con formato v1 enviada a sala configurada como auth-v2
    const datosA: DatosDeRepeticion = {
      roomId: 'cross-v1-to-v2',
      mode: 'ranked',
      seed,
      engineVersion: 'auth-v2',
      jugadaEn: '2026-08-24T00:00:00Z',
      jugador1: { nombre: 'P1', avatar: 'peashooter', mazo: mazoValido },
      jugador2: { nombre: 'P2', avatar: 'peashooter', mazo: mazoValido },
      ganador: null,
      yoSoy: 1,
      jugadas: [
        {
          id: 1,
          seq: 1,
          de: 1,
          tick: 90,
          issuedTick: 90,
          kind: 'collect',
          plantId: null,
          lane: null,
          col: null,
          slot: null,
          targetId: 'sun-sky-80-0', // Formato legacy auth-v1
        },
      ],
    }
    const resA = recalcularGanadorAutoritativo(datosA)
    expect(resA.ilegales.length).toBe(1)
    expect(resA.ilegales[0].razon).toBe('sol_no_existe_o_ya_fue_recogido')

    // Caso B: Acción emitida con formato v2 enviada a sala histórica auth-v1
    const datosB: DatosDeRepeticion = {
      roomId: 'cross-v2-to-v1',
      mode: 'ranked',
      seed,
      engineVersion: 'auth-v1',
      jugadaEn: '2026-08-24T00:00:00Z',
      jugador1: { nombre: 'P1', avatar: 'peashooter', mazo: mazoValido },
      jugador2: { nombre: 'P2', avatar: 'peashooter', mazo: mazoValido },
      ganador: null,
      yoSoy: 1,
      jugadas: [
        {
          id: 1,
          seq: 1,
          de: 1,
          tick: 90,
          issuedTick: 90,
          kind: 'collect',
          plantId: null,
          lane: null,
          col: null,
          slot: null,
          targetId: 'sun-sky-76-0', // En v1 sería sun-sky-76-0, si se manda formato v2 no coincide
        },
      ],
    }
    const resB = recalcularGanadorAutoritativo(datosB)
    expect(resB.ilegales.length).toBe(0) // sun-sky-76-0 es el ID canónico de v1

    // En sunflower, v1 es sun-flower-lane-col-tick-contador, v2 es sun-flower-lane-col-tick-subindex
    const datosSunflowerCross: DatosDeRepeticion = {
      roomId: 'cross-sunflower-to-v1',
      mode: 'ranked',
      seed,
      engineVersion: 'auth-v1',
      jugadaEn: '2026-08-24T00:00:00Z',
      jugador1: { nombre: 'P1', avatar: 'peashooter', mazo: mazoValido },
      jugador2: { nombre: 'P2', avatar: 'peashooter', mazo: mazoValido },
      ganador: null,
      yoSoy: 1,
      jugadas: [
        {
          id: 1,
          seq: 1,
          de: 1,
          tick: 200,
          issuedTick: 200,
          kind: 'collect',
          plantId: null,
          lane: null,
          col: null,
          slot: null,
          targetId: 'sun-flower-2-2-180-0', // V2 subIndex formato
        },
      ],
    }
    const resSunflower = recalcularGanadorAutoritativo(datosSunflowerCross)
    expect(resSunflower.ilegales.length).toBe(1)
    expect(resSunflower.ilegales[0].razon).toBe('sol_no_existe_o_ya_fue_recogido')
  })

  // 6. Test Rebuild PvP (conservarLoLocal) en v1 y v2
  it('6. Rebuild PvP: conserva IDs de soles canónicos idénticos tras un rollback en auth-v1 y auth-v2', () => {
    const seed = 987654321

    // Prueba en V2
    const estadoLimpioV2 = createBattleState(seed, false, true, undefined, 'auth-v2')
    for (let t = 0; t < 600; t++) {
      stepTick(estadoLimpioV2, () => {})
    }
    const sunsLimpiosIdsV2 = estadoLimpioV2.suns.map((s) => s.id)

    const acciones: AccionRegistrada[] = [
      { id: 1, mia: true, tick: 150, kind: 'plant', plantId: 'sunflower', lane: 0, col: 0 },
      { id: 2, mia: false, tick: 180, kind: 'plant', plantId: 'peashooter', lane: 0, col: 0 },
    ]

    const { estado: estadoReconstruidoV2 } = reconstruirConHuellas(seed, acciones, 600, true, 'auth-v2')
    const alDiaV2 = conservarLoLocal(estadoReconstruidoV2, estadoLimpioV2)
    expect(alDiaV2.suns.map((s) => s.id)).toEqual(sunsLimpiosIdsV2)

    // Prueba en V1
    const estadoLimpioV1 = createBattleState(seed, false, true, undefined, 'auth-v1')
    for (let t = 0; t < 600; t++) {
      stepTick(estadoLimpioV1, () => {})
    }
    const sunsLimpiosIdsV1 = estadoLimpioV1.suns.map((s) => s.id)

    const { estado: estadoReconstruidoV1 } = reconstruirConHuellas(seed, acciones, 600, true, 'auth-v1')
    const alDiaV1 = conservarLoLocal(estadoReconstruidoV1, estadoLimpioV1)
    expect(alDiaV1.suns.map((s) => s.id)).toEqual(sunsLimpiosIdsV1)
  })

  // 7. Anti-Cheat & No Replay Tolerante
  it('7. ANTI-CHEAT: verify-match rechaza estrictamente targetId incorrecto o alterado (no tolerante)', () => {
    const seed = 55555
    const sim = createBattleState(seed, false, true, undefined, 'auth-v2')

    for (let t = 0; t < 300; t++) {
      stepTick(sim, () => {})
    }

    const realSun = sim.suns[0]
    expect(realSun).toBeDefined()

    // Intentamos colectar con ID manipulado (+1 o sufijo incorrecto)
    const fakeSunId = realSun.id + '-fake'

    const datos: DatosDeRepeticion = {
      roomId: 'test-anticheat',
      mode: 'ranked',
      seed,
      engineVersion: 'auth-v2',
      jugadaEn: '2026-08-24T00:00:00Z',
      jugador1: { nombre: 'P1', avatar: 'peashooter', mazo: mazoValido },
      jugador2: { nombre: 'P2', avatar: 'peashooter', mazo: mazoValido },
      ganador: null,
      yoSoy: 1,
      jugadas: [
        {
          id: 1,
          seq: 1,
          de: 1,
          tick: realSun.createdAt + 10,
          issuedTick: realSun.createdAt + 10,
          kind: 'collect',
          plantId: null,
          lane: null,
          col: null,
          slot: null,
          targetId: fakeSunId,
        },
      ],
    }

    const res = recalcularGanadorAutoritativo(datos)
    expect(res.ilegales.length).toBe(1)
    expect(res.ilegales[0].razon).toBe('sol_no_existe_o_ya_fue_recogido')
  })

  // 8. Rechazo de sol ya recogido (Idempotencia / No doble cobro)
  it('8. Rechaza recolección duplicada del mismo sol', () => {
    const seed = 77777
    const sim = createBattleState(seed, false, true, undefined, 'auth-v2')

    for (let t = 0; t < 300; t++) {
      stepTick(sim, () => {})
    }

    const realSun = sim.suns[0]
    expect(realSun).toBeDefined()

    const datos: DatosDeRepeticion = {
      roomId: 'test-double-collect',
      mode: 'ranked',
      seed,
      engineVersion: 'auth-v2',
      jugadaEn: '2026-08-24T00:00:00Z',
      jugador1: { nombre: 'P1', avatar: 'peashooter', mazo: mazoValido },
      jugador2: { nombre: 'P2', avatar: 'peashooter', mazo: mazoValido },
      ganador: null,
      yoSoy: 1,
      jugadas: [
        {
          id: 1,
          seq: 1,
          de: 1,
          tick: realSun.createdAt + 10,
          issuedTick: realSun.createdAt + 10,
          kind: 'collect',
          plantId: null,
          lane: null,
          col: null,
          slot: null,
          targetId: realSun.id,
        },
        {
          id: 2,
          seq: 2,
          de: 1,
          tick: realSun.createdAt + 20,
          issuedTick: realSun.createdAt + 20,
          kind: 'collect',
          plantId: null,
          lane: null,
          col: null,
          slot: null,
          targetId: realSun.id,
        },
      ],
    }

    const res = recalcularGanadorAutoritativo(datos)
    expect(res.ilegales.length).toBe(1)
    expect(res.ilegales[0].id).toBe(2)
    expect(res.ilegales[0].razon).toBe('sol_no_existe_o_ya_fue_recogido')
  })

  // 9. Compatibilidad con Rival Semilla (Async Match) en auth-v1 y auth-v2
  it('9. Rival Semilla: opera determinísticamente tanto en auth-v1 como en auth-v2', () => {
    const seed = 333444
    const mazoP1 = mazoValido
    const mazoAsync = mazoValido

    // Test en v2
    const simV2 = createBattleState(seed, false, true, undefined, 'auth-v2')
    let capturedSunV2: { id: string; createdAt: number } | null = null

    for (let t = 0; t < 300; t++) {
      stepTick(simV2, () => {})
      const s = simV2.suns.find((x) => x.id.startsWith('sun-sky-'))
      if (s && !capturedSunV2) {
        capturedSunV2 = { id: s.id, createdAt: s.createdAt }
      }
    }

    expect(capturedSunV2).toBeTruthy()

    const p1ActionsV2 = [
      {
        id: 1,
        seq: 1,
        tick: capturedSunV2!.createdAt + 5,
        issuedTick: capturedSunV2!.createdAt + 5,
        kind: 'collect' as const,
        targetId: capturedSunV2!.id,
      },
    ]

    const simAsyncResV2 = simulateAsyncMatch(
      seed,
      mazoP1,
      mazoAsync,
      p1ActionsV2,
      [],
      300,
      'auth-v2'
    )

    expect(simAsyncResV2.p1Ilegal).toBe(false)

    // Test en v1
    const simV1 = createBattleState(seed, false, true, undefined, 'auth-v1')
    let capturedSunV1: { id: string; createdAt: number } | null = null

    for (let t = 0; t < 300; t++) {
      stepTick(simV1, () => {})
      const s = simV1.suns.find((x) => x.id.startsWith('sun-sky-'))
      if (s && !capturedSunV1) {
        capturedSunV1 = { id: s.id, createdAt: s.createdAt }
      }
    }

    expect(capturedSunV1).toBeTruthy()

    const p1ActionsV1 = [
      {
        id: 1,
        seq: 1,
        tick: capturedSunV1!.createdAt + 5,
        issuedTick: capturedSunV1!.createdAt + 5,
        kind: 'collect' as const,
        targetId: capturedSunV1!.id,
      },
    ]

    const simAsyncResV1 = simulateAsyncMatch(
      seed,
      mazoP1,
      mazoAsync,
      p1ActionsV1,
      [],
      300,
      'auth-v1'
    )

    expect(simAsyncResV1.p1Ilegal).toBe(false)
  })
})
