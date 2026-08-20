// ─────────────────────────────────────────────────────────────────────────────
// LA COORDINACIÓN DEL 1c1, FUERA DE REACT
//
// Todo lo que hace que dos navegadores jueguen la MISMA partida: numerar las
// acciones propias, mandarlas con el tic en que deben ocurrir, y aplicar las del
// rival sin duplicarlas ni perderlas.
//
// Estaba metido dentro de Battlefield.tsx, y de ahí no se podía probar: hacía
// falta un navegador, dos cuentas y una base real. Se saca aquí para poder
// levantar DOS clientes en un test, con un servidor de mentira que aplique las
// mismas reglas, y comprobar que los dos acaban viendo lo mismo.
//
// Eso importa más de lo que parece. Este cableado ha tenido varios fallos que
// sólo se veían jugando —acciones rechazadas por antiguas, plantas que aparecían
// en un lado y no en el otro— y cada uno costó una ronda de pruebas manuales con
// dos ventanas. Un test los habría cazado en segundos.
// ─────────────────────────────────────────────────────────────────────────────
import type { PlantId } from '../types/game'
import type { GameState } from './simulate'

/** Una acción tal como la devuelve el servidor. */
export interface AccionDeLaPartida {
  id: number
  userId: string
  seq: number
  tick: number
  kind: string
  plantId: string | null
  lane: number
  col: number | null
}

/** Lo que el coordinador necesita del servidor. */
export interface TransportePvp {
  enviar(accion: {
    seq: number
    tick: number
    kind: 'plant' | 'dig'
    plantId?: string | null
    lane: number
    col?: number | null
  }): Promise<{ ok?: boolean; error?: string }>
  /** Todas las acciones de la sala. */
  leerTodas(): Promise<AccionDeLaPartida[]>
}

/** Lo que el coordinador informa hacia la interfaz. */
export interface DiagnosticoPvp {
  enviadas: number
  recibidas: number
  ultimoEnvio: string
  enSala: number
  misEnSala: number
}

export interface CoordinadorPvp {
  /**
   * Registra una plantación propia. Sólo se llama si en local SÍ se plantó: si se
   * registrara un clic fallido, el rival plantaría algo que aquí no existe.
   */
  registrarPlantacion(carta: PlantId, lane: number, col: number): Promise<void>
  /** Aplica una acción que llegó por el canal en vivo. */
  recibir(a: AccionDeLaPartida): void
  /** Pide al servidor todo lo de la sala y aplica lo que falte. */
  recuperar(): Promise<void>
  /** El estado para el panel de diagnóstico. */
  diagnostico(): DiagnosticoPvp
}

/**
 * Margen de red, en tics.
 *
 * La acción se programa para el tic actual MÁS esto, para que le dé tiempo a
 * llegar antes de que la partida del rival alcance ese tic. Seis tics son unos
 * 200 ms: suficiente para una conexión normal, y poco como retardo entre pulsar
 * y ver la planta del otro.
 */
export const MARGEN_DE_RED_TICS = 6

export function crearCoordinadorPvp(opciones: {
  /** Quién soy, para no aplicarme mis propias acciones dos veces. */
  miId: string
  /** El estado de la partida, para leer el tic y encolar lo del rival. */
  estado: () => GameState
  /** Encola la carta del rival para su tic. */
  encolar: (a: {
    tick: number
    plantId: PlantId
    lane: number
    col?: number
  }) => void
  transporte: TransportePvp
}): CoordinadorPvp {
  const { miId, estado, encolar, transporte } = opciones

  /** Número de orden de mis acciones. Empieza en 1. */
  let orden = 0
  /** El id más alto ya aplicado, para no repetir trabajo al recuperar. */
  let ultimaVista = 0
  /**
   * Las ya aplicadas.
   *
   * Hace falta porque hay DOS caminos de entrada: el canal en vivo y la
   * recuperación periódica. Sin esto, una acción que llegue por los dos plantaría
   * dos veces — y en una simulación determinista eso separa las dos partidas.
   */
  const aplicadas = new Set<number>()

  const diag: DiagnosticoPvp = {
    enviadas: 0,
    recibidas: 0,
    ultimoEnvio: '—',
    enSala: 0,
    misEnSala: 0,
  }

  function aplicar(a: AccionDeLaPartida): void {
    // Las mías ya están plantadas en local.
    if (a.userId === miId) {
      // Se cuentan igual para el diagnóstico y para no volver a mirarlas.
      if (a.id > ultimaVista) ultimaVista = a.id
      aplicadas.add(a.id)
      return
    }
    if (aplicadas.has(a.id)) return
    aplicadas.add(a.id)
    if (a.id > ultimaVista) ultimaVista = a.id

    if (a.kind !== 'plant' || !a.plantId) return
    diag.recibidas += 1
    encolar({
      tick: a.tick,
      plantId: a.plantId as PlantId,
      lane: a.lane,
      col: a.col ?? undefined,
    })
  }

  return {
    async registrarPlantacion(carta, lane, col) {
      orden += 1
      const enTic = estado().tick + MARGEN_DE_RED_TICS
      const r = await transporte.enviar({
        seq: orden,
        tick: enTic,
        kind: 'plant',
        plantId: carta,
        lane,
        col,
      })
      if (r.error) {
        // El error del servidor tal cual: es lo que dice POR QUÉ se rechazó, y sin
        // eso no hay forma de distinguir "no llegó" de "lo rechazaron".
        diag.ultimoEnvio = `✗ ${r.error}`
      } else {
        diag.enviadas += 1
        diag.ultimoEnvio = `✓ ${carta} @tic ${enTic}`
      }
    },

    recibir(a) {
      aplicar(a)
    },

    async recuperar() {
      const todas = await transporte.leerTodas()
      diag.enSala = todas.length
      diag.misEnSala = todas.filter((a) => a.userId === miId).length
      for (const a of todas) {
        if (a.id > ultimaVista || !aplicadas.has(a.id)) aplicar(a)
      }
    },

    diagnostico() {
      return { ...diag }
    },
  }
}
