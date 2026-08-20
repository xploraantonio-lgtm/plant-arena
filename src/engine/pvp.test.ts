// ─────────────────────────────────────────────────────────────────────────────
// DOS CLIENTES JUGANDO LA MISMA PARTIDA, SIN NAVEGADOR
//
// Esto es lo que faltaba. Todo el cableado del 1c1 se ha estado probando a mano:
// dos ventanas, dos cuentas, plantar y mirar. Cada fallo costaba una ronda entera
// y varios se descubrieron sólo por una captura de pantalla.
//
// Aquí se levantan DOS clientes con sus dos simulaciones, y un servidor de mentira
// que aplica LAS MISMAS REGLAS que las migraciones 19-24:
//   · el tic no puede ir muy por detrás de por dónde va la partida
//   · nadie va hacia atrás respecto a lo suyo
//   · nada por delante del reloj
//   · una acción repetida no se duplica
//
// Con eso se puede comprobar lo único que importa de verdad: que lo que planta
// uno aparece en la partida del otro, y que las dos simulaciones acaban iguales.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest'
import { crearCoordinadorPvp, type AccionDeLaPartida, type TransportePvp } from './pvp'
import { stepTick, createBattleState, type GameState } from './simulate'
import type { PlantId } from '../types/game'
import { PLANT_CONFIGS, BASE_LEFT_END_X, BASE_RIGHT_START_X, TOTAL_COLUMNS } from '../utils/gameConstants'

/**
 * El servidor de mentira.
 *
 * Guarda las acciones de UNA sala y aplica las mismas comprobaciones que
 * submit_match_action. Si las reglas del SQL cambian, aquí hay que cambiarlas
 * también — y si se olvida, este test dejará de reflejar la realidad. Es el precio
 * de poder probar el cliente sin una base de datos, y merece la pena: los fallos
 * que hemos tenido estaban en el cliente, no en el SQL.
 */
function servidorDeMentira(opciones: { toleranciaAtras?: number } = {}) {
  const toleranciaAtras = opciones.toleranciaAtras ?? 45
  const toleranciaAdelante = 90

  /**
   * Por qué tic va la partida según el reloj del servidor.
   *
   * En producción sale de (ahora − started_at) / 33 ms. Aquí lo pone el test,
   * porque un test avanza mil tics en un milisegundo y el reloj real diría que
   * la partida acaba de empezar: rechazaría todo por futuro. (La primera versión
   * de este test fallaba entera por eso, y el servidor de mentira tenía razón.)
   */
  let ticDelServidor = 0

  const acciones: AccionDeLaPartida[] = []
  let siguienteId = 1
  /** Para poder simular que un mensaje del canal en vivo se pierde. */
  const oyentes = new Map<string, (a: AccionDeLaPartida) => void>()


  return {
    acciones,
    /** El test dice por qué tic va la partida. */
    ponerTic(t: number) { ticDelServidor = t },
    /** Suscribe a un cliente al canal en vivo. */
    escuchar(quien: string, alRecibir: (a: AccionDeLaPartida) => void) {
      oyentes.set(quien, alRecibir)
    },
    /** Deja de entregar mensajes a alguien: simula un canal caído. */
    cortarCanal(quien: string) {
      oyentes.delete(quien)
    },

    /** El transporte que ve un cliente concreto. */
    para(quien: string): TransportePvp {
      return {
        async enviar(a) {
          if (a.tick < 0) return { error: 'Tic inválido' }

          const maxSala = acciones.reduce((m, x) => Math.max(m, x.tick), 0)
          if (maxSala > 0 && a.tick < maxSala - toleranciaAtras) {
            return { error: `Acción demasiado antigua: tic ${a.tick} cuando la partida ya iba por el ${maxSala}` }
          }

          const maxMio = acciones
            .filter((x) => x.userId === quien)
            .reduce((m, x) => Math.max(m, x.tick), 0)
          if (a.tick < maxMio) {
            return { error: `Tus acciones no pueden ir hacia atrás: tic ${a.tick} después del ${maxMio}` }
          }

          if (a.tick > ticDelServidor + toleranciaAdelante) {
            return { error: `Acción en el futuro: tic ${a.tick}` }
          }

          // Repetida (un reintento de red): no se duplica y no es error.
          if (acciones.some((x) => x.userId === quien && x.seq === a.seq)) {
            return { ok: true }
          }

          const guardada: AccionDeLaPartida = {
            id: siguienteId++,
            userId: quien,
            seq: a.seq,
            tick: a.tick,
            kind: a.kind,
            plantId: a.plantId ?? null,
            lane: a.lane,
            col: a.col ?? null,
          }
          acciones.push(guardada)

          // Entrega en vivo a todos los que escuchan, incluido quien la mandó,
          // igual que hace Realtime.
          for (const entregar of oyentes.values()) entregar(guardada)
          return { ok: true }
        },

        async leerTodas() {
          return acciones.map((a) => ({ ...a }))
        },
      }
    },
  }
}

/** Un cliente: su simulación y su coordinador. */
function cliente(miId: string, transporte: TransportePvp, semilla = 4242, ancoraMs?: number) {
  const estado: GameState = createBattleState(semilla, false, true)

  const coord = crearCoordinadorPvp({
    miId,
    estado: () => estado,
    encolar: (a) =>
      estado.pending.push({
        // Nunca en el pasado: si llegó tarde, en el tic siguiente.
        atTick: Math.max(estado.tick + 1, a.tick),
        kind: 'rival_plant',
        plantId: a.plantId,
        lane: a.lane,
        col: a.col,
      }),
    transporte,
  })

  return {
    estado,
    coord,

    /**
     * Planta como lo hace el cliente real: PRIMERO en local y luego se registra.
     *
     * Los dos pasos importan. registrarPlantacion sólo habla con el servidor; si el
     * test se quedara ahí, quien planta no tendría la planta en su propia partida y
     * sólo la vería el rival. (La primera versión de este test hacía justo eso y
     * fallaba por ello, no por el código.)
     */
    async plantar(carta: PlantId, lane: number, col: number) {
      const config = PLANT_CONFIGS[carta]
      const camina = config.category === 'melee' || !!config.moveSpeed || carta === 'chomper'
      const anchoCol = (BASE_RIGHT_START_X - BASE_LEFT_END_X) / TOTAL_COLUMNS
      estado.plants.push({
        id: `mia-${carta}-${lane}-${col}-${estado.tick}`,
        plantId: carta,
        statRolls: [],
        lane,
        col: camina ? undefined : col,
        x: camina ? BASE_LEFT_END_X + 1 : BASE_LEFT_END_X + col * anchoCol + anchoCol / 2,
        hp: config.maxHp,
        maxHp: config.maxHp,
        damage: config.damage,
        attackSpeedMs: config.attackSpeedMs,
        moveSpeed: config.moveSpeed,
        lastActionTime: estado.tick,
        isWalking: camina,
        state: camina ? 'walking' : 'idle',
      })
      await coord.registrarPlantacion(carta, lane, col)
    },

    /** Corre hasta el tic que marque el reloj común, como hace el bucle real. */
    avanzarHasta(ticObjetivo: number) {
      while (estado.tick < ticObjetivo) stepTick(estado, () => {})
    },
    ancoraMs,
  }
}

describe('dos clientes juegan la misma partida', () => {
  it('lo que planta uno aparece en la partida del otro', async () => {
    const srv = servidorDeMentira()
    const ana = cliente('ana', srv.para('ana'))
    const beto = cliente('beto', srv.para('beto'))
    srv.escuchar('ana', (a) => ana.coord.recibir(a))
    srv.escuchar('beto', (a) => beto.coord.recibir(a))

    // Los dos van por el mismo tic: es lo que garantiza el reloj común.
    srv.ponerTic(100)
    srv.ponerTic(100)
    ana.avanzarHasta(100)
    srv.ponerTic(100)
    beto.avanzarHasta(100)

    // Ana planta.
    await ana.coord.registrarPlantacion('sunflower' as PlantId, 0, 3)
    expect(ana.coord.diagnostico().enviadas).toBe(1)

    // Beto la aplica en el tic que Ana pidió.
    srv.ponerTic(120)
    srv.ponerTic(120)
    ana.avanzarHasta(120)
    srv.ponerTic(120)
    beto.avanzarHasta(120)

    expect(beto.estado.enemyPlants).toHaveLength(1)
    expect(beto.estado.enemyPlants[0].plantId).toBe('sunflower')
    // Y en la de Ana está en SU lado, no en el del rival.
    expect(ana.estado.enemyPlants).toHaveLength(0)
    expect(beto.coord.diagnostico().recibidas).toBe(1)
  })

  it('las dos partidas acaban iguales tras una tanda de jugadas', async () => {
    const srv = servidorDeMentira()
    const ana = cliente('ana', srv.para('ana'))
    const beto = cliente('beto', srv.para('beto'))
    srv.escuchar('ana', (a) => ana.coord.recibir(a))
    srv.escuchar('beto', (a) => beto.coord.recibir(a))

    const jugadas: Array<[typeof ana, PlantId, number, number, number]> = [
      [ana,  'sunflower'  as PlantId, 0, 3, 60],
      [beto, 'peashooter' as PlantId, 1, 2, 90],
      [ana,  'wallnut'    as PlantId, 1, 4, 150],
      [beto, 'sunflower'  as PlantId, 2, 3, 200],
    ]

    for (const [quien, carta, carril, columna, enTic] of jugadas) {
      // El servidor sabe por qué tic va la partida: en producción lo saca del
      // reloj, aquí lo dice el test.
      srv.ponerTic(enTic)
      ana.avanzarHasta(enTic)
      beto.avanzarHasta(enTic)
      await quien.plantar(carta, carril, columna)
    }

    srv.ponerTic(600)

    srv.ponerTic(600)

    ana.avanzarHasta(600)
    srv.ponerTic(600)
    beto.avanzarHasta(600)

    // Las dos simulaciones son ESPEJO: lo que en una está en `plants`, en la otra
    // está en `enemyPlants`. Así que no se comparan campo por campo — se compara
    // lo que decide la partida: la vida de las dos bases.
    expect(Math.round(ana.estado.p1BaseHp)).toBe(Math.round(beto.estado.p2BaseHp))
    expect(Math.round(ana.estado.p2BaseHp)).toBe(Math.round(beto.estado.p1BaseHp))
    // Y cada uno ve las mismas plantas, en el lado que le toca.
    expect(ana.estado.plants.length).toBe(beto.estado.enemyPlants.length)
    expect(ana.estado.enemyPlants.length).toBe(beto.estado.plants.length)
  })

  it('si el canal en vivo se cae, la recuperación salva la partida', async () => {
    const srv = servidorDeMentira()
    const ana = cliente('ana', srv.para('ana'))
    const beto = cliente('beto', srv.para('beto'))
    srv.escuchar('ana', (a) => ana.coord.recibir(a))
    // A Beto NO se le suscribe: es como si Realtime estuviera caído para él.

    srv.ponerTic(100)

    srv.ponerTic(100)

    ana.avanzarHasta(100)
    srv.ponerTic(100)
    beto.avanzarHasta(100)
    await ana.coord.registrarPlantacion('peashooter' as PlantId, 1, 3)

    // Sin canal, Beto no se ha enterado.
    expect(beto.estado.pending.filter((p) => p.kind === 'rival_plant')).toHaveLength(0)

    // Pero la recuperación periódica sí se lo trae. Es la red de seguridad, y sin
    // ella un mensaje perdido dejaría las dos partidas divergentes para siempre.
    await beto.coord.recuperar()
    srv.ponerTic(130)
    beto.avanzarHasta(130)

    expect(beto.estado.enemyPlants).toHaveLength(1)
    expect(beto.coord.diagnostico().enSala).toBe(1)
    expect(beto.coord.diagnostico().misEnSala).toBe(0)
  })

  it('una acción que llega por los dos caminos no se planta dos veces', async () => {
    const srv = servidorDeMentira()
    const ana = cliente('ana', srv.para('ana'))
    const beto = cliente('beto', srv.para('beto'))
    srv.escuchar('ana', (a) => ana.coord.recibir(a))
    srv.escuchar('beto', (a) => beto.coord.recibir(a))

    srv.ponerTic(100)

    srv.ponerTic(100)

    ana.avanzarHasta(100)
    srv.ponerTic(100)
    beto.avanzarHasta(100)
    await ana.coord.registrarPlantacion('wallnut' as PlantId, 2, 3)

    // Le llegó por el canal; ahora también por la recuperación.
    await beto.coord.recuperar()
    await beto.coord.recuperar()
    srv.ponerTic(140)
    beto.avanzarHasta(140)

    expect(beto.estado.enemyPlants).toHaveLength(1)
  })

  it('el diagnóstico distingue los tres casos', async () => {
    // Es para lo que se puso: que una captura diga qué está pasando.
    const srv = servidorDeMentira()
    const ana = cliente('ana', srv.para('ana'))
    srv.escuchar('ana', (a) => ana.coord.recibir(a))

    // Caso 1: no se ha enviado nada.
    await ana.coord.recuperar()
    expect(ana.coord.diagnostico().enSala).toBe(0)
    expect(ana.coord.diagnostico().misEnSala).toBe(0)

    // Caso 2: sólo las mías → estoy solo en la sala.
    srv.ponerTic(100)
    ana.avanzarHasta(100)
    await ana.coord.registrarPlantacion('sunflower' as PlantId, 0, 3)
    await ana.coord.recuperar()
    expect(ana.coord.diagnostico().enSala).toBe(1)
    expect(ana.coord.diagnostico().misEnSala).toBe(1)

    // Caso 3: hay más que las mías → estamos juntos.
    const beto = cliente('beto', srv.para('beto'))
    srv.ponerTic(100)
    beto.avanzarHasta(100)
    await beto.coord.registrarPlantacion('peashooter' as PlantId, 1, 3)
    await ana.coord.recuperar()
    expect(ana.coord.diagnostico().enSala).toBe(2)
    expect(ana.coord.diagnostico().misEnSala).toBe(1)
  })
})

describe('lo que el servidor rechaza, y por qué', () => {
  it('rechaza plantar muy por detrás de la partida, y lo dice claro', async () => {
    const srv = servidorDeMentira()
    const ana = cliente('ana', srv.para('ana'))
    const beto = cliente('beto', srv.para('beto'))

    // Ana va muy adelantada y planta en el tic 600.
    srv.ponerTic(600)
    ana.avanzarHasta(600)
    await ana.coord.registrarPlantacion('sunflower' as PlantId, 0, 3)

    // Beto, 500 tics por detrás (17 segundos): eso ya no es red, es un desfase de
    // relojes. Se rechaza, y el mensaje lo explica.
    srv.ponerTic(100)
    beto.avanzarHasta(100)
    await beto.coord.registrarPlantacion('peashooter' as PlantId, 1, 3)

    expect(beto.coord.diagnostico().enviadas).toBe(0)
    expect(beto.coord.diagnostico().ultimoEnvio).toContain('antigua')
  })

  it('con los relojes alineados, los dos pueden plantar', async () => {
    // El caso que fallaba en producción: los dos separados por lo que tarda la
    // red, unas décimas. Los dos tienen que poder jugar.
    const srv = servidorDeMentira()
    const ana = cliente('ana', srv.para('ana'))
    const beto = cliente('beto', srv.para('beto'))

    srv.ponerTic(300)

    ana.avanzarHasta(300)
    await ana.coord.registrarPlantacion('sunflower' as PlantId, 0, 3)

    srv.ponerTic(288)

    beto.avanzarHasta(288)   // 12 tics por detrás: 0,4 s de red
    await beto.coord.registrarPlantacion('peashooter' as PlantId, 1, 3)

    expect(ana.coord.diagnostico().enviadas).toBe(1)
    expect(beto.coord.diagnostico().enviadas).toBe(1)
    expect(beto.coord.diagnostico().ultimoEnvio).toContain('✓')
  })

  it('un reintento de red no planta dos veces', async () => {
    const srv = servidorDeMentira()
    const ana = cliente('ana', srv.para('ana'))
    srv.ponerTic(100)
    ana.avanzarHasta(100)

    // El mismo número de orden, como haría un reintento.
    await ana.coord.registrarPlantacion('sunflower' as PlantId, 0, 3)
    const transporte = srv.para('ana')
    await transporte.enviar({ seq: 1, tick: 106, kind: 'plant', plantId: 'sunflower', lane: 0, col: 3 })

    expect(srv.acciones).toHaveLength(1)
  })
})
