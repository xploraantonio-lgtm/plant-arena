// ─────────────────────────────────────────────────────────────────────────────
// REPRODUCIR UNA PARTIDA
//
// Una repetición no es un vídeo: es la partida VUELTA A EJECUTAR. Con la misma
// semilla y las mismas jugadas en los mismos tics, el motor da exactamente el
// mismo resultado.
//
// Por eso no hay nada nuevo que guardar. La semilla y los mazos están en
// game_rooms, y lo que hizo cada uno en match_actions: unas decenas de filas en
// lugar de megas de vídeo. Y como es una ejecución y no una grabación, se puede
// pausar, rebobinar, ir a un momento concreto o mirarla desde el otro lado.
//
// Es la razón de todo el trabajo de determinismo: quitar los 46 relojes de pared,
// sembrar el azar, convertir los setTimeout en una cola por tics, sacar el motor
// de React. Sin eso, volver a ejecutar una partida daba otra partida parecida.
// ─────────────────────────────────────────────────────────────────────────────
import { createBattleState, stepTick, TIC_TOPE_DE_PARTIDA, type GameState } from './simulate'

/**
 * Tope al medir la duración de una repetición.
 *
 * El motor garantiza que toda partida acaba en TIC_TOPE_DE_PARTIDA, pero un
 * registro manipulado no tiene por qué respetar nada: el margen evita que medir
 * una repetición cuelgue la pestaña.
 */
const TOPE_DE_SEGURIDAD = TIC_TOPE_DE_PARTIDA + 600
import type { PlantId } from '../types/game'

/** Una jugada tal como la devuelve match_replay. */
export interface JugadaGrabada {
  /** 1 o 2. No el identificador del usuario: una repetición no necesita saberlo. */
  de: 1 | 2
  tick: number
  kind: string
  plantId: string | null
  lane: number
  col: number | null
}

export interface DatosDeRepeticion {
  roomId: string
  mode: string
  seed: number
  jugadaEn: string
  jugador1: { nombre: string | null; avatar: string | null }
  jugador2: { nombre: string | null; avatar: string | null }
  ganador: 1 | 2 | null
  /** Quién eres tú, si participaste. */
  yoSoy: 1 | 2 | null
  jugadas: JugadaGrabada[]
}

export interface Repeticion {
  estado: GameState
  /** El último tic con alguna jugada. */
  ultimoTic: number
  /**
   * El tic en que la partida TERMINA de verdad.
   *
   * Esto es lo que faltaba. La reproducción se paraba unos segundos después de la
   * última jugada, y una partida en la que nadie planta al final se cortaba antes
   * del resultado: se compartió una batalla y el reproductor la dejaba en el
   * segundo 102 sin llegar nunca al mensaje de victoria.
   *
   * Se calcula ejecutando la partida entera una vez al montar la repetición —el
   * motor tarda milisegundos en miles de tics— y ahora se puede porque NINGUNA
   * partida es infinita: a los 2:30 entra la muerte súbita y a los 5:30 hay tope.
   */
  ticFinal: number
  /** Cómo acabó, desde el lado que se está mirando. */
  resultado: 'victory' | 'defeat' | null
  /** Desde qué lado se está mirando. */
  desde: 1 | 2
  /** Avanza un tic. Devuelve si la partida sigue. */
  avanzar(): boolean
  /** Salta a un tic concreto. Hacia atrás vuelve a empezar y corre hasta ahí. */
  irAlTic(objetivo: number): void
}

/**
 * Monta una repetición lista para avanzar tic a tic.
 *
 * `desde` decide de qué lado se mira. Es lo que hace que una repetición sea útil
 * para aprender: puedes ver tu propia partida desde el lado del rival y entender
 * por qué hizo lo que hizo.
 *
 * Las jugadas de quien mira aparecen en su lado del campo; las del otro, espejadas
 * — exactamente igual que en la partida en vivo, porque es el mismo código.
 */
export function construirRepeticion(datos: DatosDeRepeticion, desde: 1 | 2 = 1): Repeticion {
  const ultimoTic = datos.jugadas.reduce((m, j) => Math.max(m, j.tick), 0)

  function estadoInicial(): GameState {
    // isPvpMode: el bot no juega. Todo lo que pasa en la partida sale del registro,
    // que es justo lo que una repetición debe reproducir. Si el bot jugara, cada
    // reproducción añadiría plantas que no estuvieron.
    const estado = createBattleState(datos.seed, false, true)

    for (const j of datos.jugadas) {
      if (j.kind !== 'plant' || !j.plantId) continue

      if (j.de === desde) {
        // Las de quien mira: en su lado, sin espejar.
        estado.pending.push({
          atTick: Math.max(1, j.tick),
          kind: 'own_plant',
          plantId: j.plantId as PlantId,
          lane: j.lane,
          col: j.col ?? undefined,
        })
      } else {
        // Las del otro: espejadas, por el mismo camino que en la partida en vivo.
        estado.pending.push({
          atTick: Math.max(1, j.tick),
          kind: 'rival_plant',
          plantId: j.plantId as PlantId,
          lane: j.lane,
          col: j.col ?? undefined,
        })
      }
    }
    return estado
  }

  // Una pasada entera para saber dónde acaba y cómo. Se tira el estado: sólo
  // interesan el tic final y el resultado, que son los que gobiernan la barra de
  // tiempo y el cartel del final.
  const medida = (() => {
    const e = estadoInicial()
    let n = 0
    while (e.status === 'playing' && n < TOPE_DE_SEGURIDAD) {
      stepTick(e, () => {})
      n += 1
    }
    return {
      tic: e.tick,
      resultado: e.status === 'victory' ? 'victory' as const
               : e.status === 'defeat' ? 'defeat' as const
               : null,
    }
  })()

  let estado = estadoInicial()

  return {
    get estado() { return estado },
    ultimoTic,
    ticFinal: medida.tic,
    resultado: medida.resultado,
    desde,

    avanzar() {
      if (estado.status !== 'playing') return false
      stepTick(estado, () => {})
      return estado.status === 'playing'
    },

    irAlTic(objetivo) {
      // Hacia atrás no se puede "des-simular": se vuelve a empezar y se corre hasta
      // el tic pedido. Es instantáneo —miles de tics tardan milisegundos— y es
      // exacto, que es lo que importa: rebobinar y volver a avanzar tiene que dar
      // el mismo estado o la repetición no vale.
      if (objetivo < estado.tick) estado = estadoInicial()
      while (estado.tick < objetivo && estado.status === 'playing') {
        stepTick(estado, () => {})
      }
    },
  }
}

/**
 * Ejecuta la partida entera de una vez y dice quién ganó.
 *
 * Esto es lo que usará el servidor para verificar: en lugar de creerse el "he
 * ganado" de un navegador, recalcula la partida desde el registro y ve el
 * resultado por sí mismo. El motor es un módulo puro sin React ni navegador, así
 * que se puede importar tal cual en una Edge Function.
 *
 * `topeTics` evita que un registro manipulado haga girar el bucle para siempre.
 */
export function recalcularGanador(
  datos: DatosDeRepeticion,
  topeTics = 20000
): { ganador: 1 | 2 | null; tics: number; baseP1: number; baseP2: number } {
  const rep = construirRepeticion(datos, 1)
  let tics = 0
  while (rep.estado.status === 'playing' && tics < topeTics) {
    rep.avanzar()
    tics += 1
  }

  const ganador =
    rep.estado.status === 'victory' ? 1
    : rep.estado.status === 'defeat' ? 2
    : null

  return {
    ganador,
    tics,
    baseP1: rep.estado.p1BaseHp,
    baseP2: rep.estado.p2BaseHp,
  }
}
