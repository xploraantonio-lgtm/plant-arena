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
import { crearCoordinadorPvp, MARGEN_DE_RED_TICS, type AccionDeLaPartida, type TransportePvp } from './pvp'
import { stepTick, createBattleState, type GameState } from './simulate'
import type { PlantId } from '../types/game'
import { TOTAL_COLUMNS } from '../utils/gameConstants'

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
    // Lo mismo que hace useGameEngine.encolarAccionDelRival. Está duplicado
    // aquí, y por eso este test comprueba una COPIA del cliente: si el hook
    // cambia y esto no, el test deja de reflejar la realidad.
    encolar: (a) => {
      if (a.kind === 'dig') {
        estado.pending.push({
          atTick: Math.max(estado.tick + 1, a.tick),
          kind: 'rival_dig',
          lane: a.lane,
          col: a.col ?? 0,
        })
        return
      }
      if (!a.plantId) return
      estado.pending.push({
        // Nunca en el pasado: si llegó tarde, en el tic siguiente.
        atTick: Math.max(estado.tick + 1, a.tick),
        kind: 'rival_plant',
        plantId: a.plantId,
        lane: a.lane,
        col: a.col,
      })
    },
    transporte,
  })

  return {
    estado,
    coord,

    /**
     * Planta como lo hace el cliente real: A LA COLA con el margen de red, y
     * después se registra en el servidor.
     *
     * LO DEL MARGEN ES EL FONDO DEL ASUNTO. Antes esta función —y el cliente de
     * verdad— metía la planta en el campo EN ESTE TIC, y al servidor la mandaba
     * con el tic actual más el margen. Así que existía en el tic T en una pantalla
     * y en el T+6 en la otra: doscientos milisegundos de diferencia que se
     * multiplican hasta que cada uno ve otra batalla.
     *
     * Todas las jugadas entran con el mismo retardo, la propia incluida. Es la
     * regla del lockstep y es lo único que hace que las dos simulaciones sean la
     * misma partida.
     */
    async plantar(carta: PlantId, lane: number, col: number) {
      estado.pending.push({
        atTick: estado.tick + MARGEN_DE_RED_TICS,
        kind: 'own_plant',
        plantId: carta,
        lane,
        col,
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


// ─────────────────────────────────────────────────────────────────────────────
// LA COMPROBACIÓN QUE FALTABA: ¿SIGUEN SIENDO LA MISMA PARTIDA?
//
// Los tests de arriba comprueban que lo que planta uno LLEGA al otro. Eso no es
// suficiente, y por eso se nos escapó: llegaba, pero se aplicaba en un tic
// distinto del que se había aplicado en local, y con el jalapeño ni se aplicaba
// el efecto. Las dos partidas se separaban despacio y al final los dos clientes
// reportaban ganadores distintos — «tu rival dijo otra cosa», partida en revisión
// y nadie cobraba.
//
// Lo que se mide aquí es la IGUALDAD de las dos simulaciones, que es la propiedad
// de la que depende todo el 1c1.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Las dos pantallas describen la misma partida, cruzada.
 *
 * Cada jugador se ve a sí mismo a la izquierda, así que:
 *   · mi base es su base rival, y al revés;
 *   · mis plantas son sus enemigas;
 *   · y una planta mía en la x aparece en la 100 − x en su pantalla (el campo va
 *     de 15 a 85, así que espejar es 100 − x).
 */
function esLaMismaPartida(a: GameState, b: GameState) {
  expect(a.tick).toBe(b.tick)

  // Las bases, cruzadas. Es lo que decide quién gana, así que es lo que más
  // importa que coincida.
  expect(a.p1BaseHp).toBeCloseTo(b.p2BaseHp, 6)
  expect(a.p2BaseHp).toBeCloseTo(b.p1BaseHp, 6)

  expect(a.plants.length).toBe(b.enemyPlants.length)
  expect(a.enemyPlants.length).toBe(b.plants.length)

  // Los proyectiles, espejados. Son el detector más fino que hay: un desfase de
  // cinco tics en cuándo empieza a disparar una planta se ve aquí en cuanto vuela
  // el primer guisante, mucho antes de que se note en la vida de una base.
  expect(a.projectiles.length).toBe(b.projectiles.length)
  expect(a.projectiles.map((x) => `${x.lane}|${(x.x).toFixed(3)}`).sort())
    .toEqual(b.projectiles.map((x) => `${x.lane}|${(100 - x.x).toFixed(3)}`).sort())

  // Y planta por planta: misma carta, mismo carril, misma vida y posición espejada.
  const huella = (p: { plantId: string; lane: number; x: number; hp: number }, espejar: boolean) =>
    `${p.plantId}|${p.lane}|${(espejar ? 100 - p.x : p.x).toFixed(3)}|${p.hp.toFixed(3)}`

  expect(a.plants.map((p) => huella(p, false)).sort())
    .toEqual(b.enemyPlants.map((p) => huella(p, true)).sort())
  expect(a.enemyPlants.map((p) => huella(p, false)).sort())
    .toEqual(b.plants.map((p) => huella(p, true)).sort())
}

describe('las dos simulaciones son la misma partida', () => {
  /** Levanta dos clientes conectados por el servidor de mentira. */
  function dos() {
    const srv = servidorDeMentira()
    const ana = cliente('ana', srv.para('ana'))
    const beto = cliente('beto', srv.para('beto'))
    srv.escuchar('ana', (x) => ana.coord.recibir(x))
    srv.escuchar('beto', (x) => beto.coord.recibir(x))
    return { srv, ana, beto }
  }

  /** Avanza los dos clientes en paralelo, tic a tic, como el reloj común. */
  function correrLosDos(srv: any, ana: any, beto: any, hasta: number) {
    for (let t = 1; t <= hasta; t++) {
      srv.ponerTic(t)
      stepTick(ana.estado, () => {})
      stepTick(beto.estado, () => {})
    }
  }

  it('coinciden en TODO momento, no sólo al final', async () => {
    const { srv, ana, beto } = dos()
    srv.ponerTic(0)

    const jugadas: Array<[any, PlantId, number, number, number]> = [
      [ana,  'sunflower' as PlantId, 0, 1, 10],
      [beto, 'sunflower' as PlantId, 1, 1, 20],
      [ana,  'peashooter' as PlantId, 1, 3, 40],
      [beto, 'peashooter' as PlantId, 0, 3, 60],
      [ana,  'wallnut' as PlantId, 2, 5, 90],
      [beto, 'peashooter' as PlantId, 2, 4, 150],
    ]

    // Se comprueba cada 100 tics MIENTRAS se juega, y no al terminar.
    //
    // Comparar sólo el final no vale: cuando la partida acaba las dos bases están
    // a cero y el campo vacío, así que dos partidas distintas se parecen mucho.
    // (La primera versión de este test hacía eso y pasaba con el fallo puesto.)
    let siguiente = 0
    for (let t = 1; t <= 2500; t++) {
      srv.ponerTic(t)
      while (siguiente < jugadas.length && jugadas[siguiente][4] === t) {
        const [quien, carta, lane, col] = jugadas[siguiente]
        await quien.plantar(carta, lane, col)
        siguiente += 1
      }
      stepTick(ana.estado, () => {})
      stepTick(beto.estado, () => {})

      if (t % 100 === 0) {
        // Si esto falla, las dos pantallas ya están jugando partidas distintas y
        // el tic dice exactamente cuándo empezaron a separarse.
        esLaMismaPartida(ana.estado, beto.estado)
      }
    }

    // Y que de verdad ha pasado algo: sin combate, coincidir no prueba nada.
    expect(ana.estado.stats.plantsPlaced + ana.estado.plants.length).toBeGreaterThan(0)
    expect(ana.estado.p2BaseHp).toBeLessThan(600)
  })

  it('el jalapeño arrasa el mismo carril en las dos pantallas', async () => {
    // Éste es el peor de los dos fallos. El daño del jalapeño vivía en el
    // manejador del clic, no en el motor: quien lo plantaba se llevaba el carril
    // del rival por delante, y en la pantalla del rival no moría nadie.
    const { srv, ana, beto } = dos()
    srv.ponerTic(0)

    // Beto pone tres plantas en el carril 1. En la pantalla de Ana son enemigas.
    for (const col of [2, 3, 4]) {
      srv.ponerTic(10)
      await beto.plantar('sunflower' as PlantId, 1, col)
    }
    correrLosDos(srv, ana, beto, 60)

    expect(beto.estado.plants.length).toBe(3)
    expect(ana.estado.enemyPlants.length).toBe(3)

    // Y Ana tira un jalapeño a ese carril.
    srv.ponerTic(61)
    await ana.plantar('jalapeno' as PlantId, 1, 0)
    correrLosDos(srv, ana, beto, 120)

    // Las tres, fuera en LAS DOS pantallas.
    expect(beto.estado.plants.length).toBe(0)
    expect(ana.estado.enemyPlants.length).toBe(0)
    esLaMismaPartida(ana.estado, beto.estado)
  })

  it('y no deja planta: el jalapeño explota y desaparece', async () => {
    const { srv, ana, beto } = dos()
    srv.ponerTic(0)
    srv.ponerTic(10)
    await ana.plantar('jalapeno' as PlantId, 0, 0)

    // La llamarada se ve un momento…
    correrLosDos(srv, ana, beto, 30)
    expect(ana.estado.plants.length).toBe(1)
    expect(ana.estado.plants[0].spriteOverride).toContain('jalapeno')

    // …y a los 1,2 s ya no está, en las dos pantallas.
    correrLosDos(srv, ana, beto, 100)
    expect(ana.estado.plants.length).toBe(0)
    expect(beto.estado.enemyPlants.length).toBe(0)
  })
})

describe('el pico también viaja', () => {
  it('lo que uno excava desaparece en las dos pantallas', async () => {
    // Antes esto no salía del navegador: la planta se quitaba en tu pantalla y en
    // la del rival seguía en pie disparando. Bastaba un pico para que los dos
    // estuvierais jugando partidas distintas.
    const srv = servidorDeMentira()
    const ana = cliente('ana', srv.para('ana'))
    const beto = cliente('beto', srv.para('beto'))
    srv.escuchar('ana', (x) => ana.coord.recibir(x))
    srv.escuchar('beto', (x) => beto.coord.recibir(x))

    srv.ponerTic(10)
    await ana.plantar('sunflower' as PlantId, 1, 4)
    for (let t = 11; t <= 40; t++) {
      srv.ponerTic(t)
      stepTick(ana.estado, () => {})
      stepTick(beto.estado, () => {})
    }
    expect(ana.estado.plants.length).toBe(1)
    expect(beto.estado.enemyPlants.length).toBe(1)

    // Ana la excava.
    srv.ponerTic(41)
    ana.estado.pending.push({
      atTick: ana.estado.tick + MARGEN_DE_RED_TICS,
      kind: 'own_dig',
      lane: 1,
      col: 4,
    })
    await ana.coord.registrarExcavacion(1, 4)

    for (let t = 42; t <= 80; t++) {
      srv.ponerTic(t)
      stepTick(ana.estado, () => {})
      stepTick(beto.estado, () => {})
    }

    expect(ana.estado.plants.length).toBe(0)
    expect(beto.estado.enemyPlants.length).toBe(0)
  })

  it('la columna del pico se espeja, como al plantar', async () => {
    // Si no se espejara, el rival borraría la planta de su propia mitad: la de
    // otro carril y otro sitio. Peor que no borrar nada.
    const srv = servidorDeMentira()
    const ana = cliente('ana', srv.para('ana'))
    const beto = cliente('beto', srv.para('beto'))
    srv.escuchar('ana', (x) => ana.coord.recibir(x))
    srv.escuchar('beto', (x) => beto.coord.recibir(x))

    // Beto pone dos: una en la columna 4 y otra en la 5.
    srv.ponerTic(10)
    await beto.plantar('sunflower' as PlantId, 0, 4)
    await beto.plantar('sunflower' as PlantId, 0, 5)
    for (let t = 11; t <= 40; t++) {
      srv.ponerTic(t)
      stepTick(ana.estado, () => {})
      stepTick(beto.estado, () => {})
    }
    expect(ana.estado.enemyPlants.length).toBe(2)

    // Y excava SÓLO la de la columna 4.
    srv.ponerTic(41)
    beto.estado.pending.push({
      atTick: beto.estado.tick + MARGEN_DE_RED_TICS,
      kind: 'own_dig',
      lane: 0,
      col: 4,
    })
    await beto.coord.registrarExcavacion(0, 4)
    for (let t = 42; t <= 80; t++) {
      srv.ponerTic(t)
      stepTick(ana.estado, () => {})
      stepTick(beto.estado, () => {})
    }

    // Queda una sola, y es la misma en las dos pantallas.
    expect(beto.estado.plants.length).toBe(1)
    expect(ana.estado.enemyPlants.length).toBe(1)
    expect(beto.estado.plants[0].col).toBe(5)
    // Espejada: la 5 de él es la 6 en la pantalla de Ana.
    expect(ana.estado.enemyPlants[0].col).toBe(TOTAL_COLUMNS - 1 - 5)
  })
})
