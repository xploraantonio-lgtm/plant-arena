import { useCallback, useEffect, useRef, useState } from 'react'
import { SupabaseService } from '../services/supabaseService'

/**
 * LA COLA DE EMPAREJAMIENTO
 *
 * Habla con las RPC de la migración 17. El cliente no decide nada de lo que
 * importa: no manda el mazo (lo lee el servidor de plant_instances), no elige la
 * semilla (la genera el servidor, la misma para los dos jugadores) y no decide
 * con quién juega.
 *
 * Lo único que hace este hook es entrar en la cola, sondear cada dos segundos y
 * salir limpiamente. Ese sondeo es además el LATIDO: si se deja de llamar más de
 * 45 segundos, el barrido del servidor saca al jugador de la cola y, en coliseo,
 * le devuelve la entrada. Por eso importa tanto que la salida sea limpia.
 */

export type ModoPartida = 'ranked' | 'friendly' | 'colosseum' | 'tournament'

/**
 * QUÉ MODOS BUSCAN RIVAL DE VERDAD
 *
 * Por modo y no un interruptor único, porque lo que falta no afecta igual a todos.
 *
 * YA FUNCIONA, y por eso ranked y amistoso están dentro:
 *   · el servidor junta a dos jugadores y les da la misma semilla;
 *   · el bot se calla cuando hay rival (state.isPvpMode);
 *   · cada plantación se registra con el tic en que debe ocurrir, validada contra
 *     el mazo que guardó el servidor;
 *   · cada cliente aplica las del otro en ese mismo tic, así que veis lo mismo.
 *
 * LO QUE FALTA, y por eso el coliseo se queda fuera:
 *   El servidor todavía NO recalcula la partida: el resultado sale de que los dos
 *   jugadores reporten lo mismo. Si una acción llega tarde, un cliente la aplica
 *   un tic después, las dos simulaciones se separan un poco y pueden acabar
 *   discrepando sobre quién ganó. Entonces la partida queda en disputa.
 *
 *   En ranked y amistoso una disputa cuesta un cero: nadie gana ELO ni cofre y se
 *   vuelve a jugar. En el coliseo hay gemas de verdad — se devuelven (lo hace la
 *   migración 18), pero es una vuelta entera para nada, y con dinero encima.
 *
 * El coliseo entra cuando exista la verificación en servidor: recalcular la
 * partida desde match_actions y que ESE veredicto pague, en lugar de fiarse de lo
 * que vio cada navegador. El motor ya es reproducible para poder hacerlo.
 */
export const MODOS_CON_EMPAREJAMIENTO: ReadonlySet<ModoPartida> = new Set<ModoPartida>([
  'ranked',
  'friendly',
])

/** ¿Este modo busca rival, o va directo al bot? */
export function buscaRival(modo: ModoPartida): boolean {
  return MODOS_CON_EMPAREJAMIENTO.has(modo)
}

export interface PartidaEncontrada {
  roomId: string
  /** Verdadero si se reincorpora a una partida que ya estaba en curso. */
  reanudada: boolean
}

export interface EstadoCola {
  /** Si está buscando ahora mismo. */
  buscando: boolean
  /** Segundos esperando. Lo cuenta el servidor, no el navegador. */
  segundos: number
  /** En coliseo, a los cuántos segundos se cancela y se devuelve la entrada. */
  plazoSegundos: number | null
  /**
   * En ranked, cuándo tocaría ofrecer un fantasma.
   *
   * Los fantasmas todavía no existen —son la repetición de una partida real, así
   * que necesitan antes la tabla de repeticiones—. Hasta entonces esta bandera es
   * la señal para caer al bot local, que es lo que el ranked hace hoy.
   */
  toca_relleno: boolean
  /** Mensaje del servidor, si trae alguno (por ejemplo al devolver la entrada). */
  mensaje: string | null
  error: string | null
}

const ESTADO_INICIAL: EstadoCola = {
  buscando: false,
  segundos: 0,
  plazoSegundos: null,
  toca_relleno: false,
  mensaje: null,
  error: null,
}

/** Cada cuánto se sondea. Bastante por debajo del latido de 45 s del servidor. */
const SONDEO_MS = 2000

export function useMatchmaking() {
  const [estado, setEstado] = useState<EstadoCola>(ESTADO_INICIAL)
  const [encontrada, setEncontrada] = useState<PartidaEncontrada | null>(null)

  const intervaloRef = useRef<ReturnType<typeof setInterval> | null>(null)
  /**
   * Si el hook sigue vivo. Un sondeo en vuelo puede volver después de que el
   * componente se haya desmontado, y llamar a setState entonces avisa en consola
   * y, peor, puede reabrir una búsqueda ya cancelada.
   */
  const vivoRef = useRef<boolean>(true)
  /** Para saber en el desmontaje si hay que cancelar la cola. */
  const buscandoRef = useRef<boolean>(false)

  const pararSondeo = useCallback(() => {
    if (intervaloRef.current) {
      clearInterval(intervaloRef.current)
      intervaloRef.current = null
    }
  }, [])

  /** Deja de buscar. En coliseo el servidor devuelve la entrada. */
  const cancelar = useCallback(async () => {
    pararSondeo()
    buscandoRef.current = false
    if (vivoRef.current) setEstado(ESTADO_INICIAL)
    await SupabaseService.cancelMatchmaking()
  }, [pararSondeo])

  const sondear = useCallback(async () => {
    const r = await SupabaseService.pollMatchmaking()
    if (!vivoRef.current) return

    if (r.error) {
      setEstado((e) => ({ ...e, error: r.error ?? null }))
      return
    }

    if (r.matched && r.roomId) {
      pararSondeo()
      buscandoRef.current = false
      setEstado(ESTADO_INICIAL)
      setEncontrada({ roomId: r.roomId, reanudada: false })
      return
    }

    // El plazo del coliseo venció: el servidor ya canceló y devolvió.
    if (r.timedOut) {
      pararSondeo()
      buscandoRef.current = false
      setEstado({
        ...ESTADO_INICIAL,
        mensaje: r.message ?? 'No apareció rival. Se te devolvió la entrada.',
      })
      return
    }

    if (!r.searching) {
      // Nos sacaron de la cola (barrido por falta de latido, o cancelación desde
      // otra pestaña). No se insiste: se refleja y se para.
      pararSondeo()
      buscandoRef.current = false
      setEstado(ESTADO_INICIAL)
      return
    }

    setEstado({
      buscando: true,
      segundos: r.waitedSeconds ?? 0,
      plazoSegundos: r.timeoutSeconds ?? null,
      toca_relleno: Boolean(r.ghostAvailable),
      mensaje: null,
      error: null,
    })
  }, [pararSondeo])

  /**
   * Entra en la cola.
   *
   * En coliseo cobra la entrada ANTES de encolar, así que si esto falla por saldo
   * no se ha cobrado nada. `betGems` es obligatorio en coliseo incluso pagando
   * con ticket: es la apuesta nominal con la que se forma el pozo y con la que se
   * emparejan los rivales.
   */
  const buscar = useCallback(
    async (
      modo: ModoPartida,
      opciones: { betGems?: number; useTicket?: boolean; roomCode?: string } = {}
    ): Promise<{ ok: boolean; error?: string }> => {
      setEncontrada(null)
      setEstado({ ...ESTADO_INICIAL, buscando: true })

      const r = await SupabaseService.enterMatchmaking(modo, opciones)

      if (!vivoRef.current) {
        // Se salió de la pantalla mientras se entraba en la cola. Hay que
        // deshacerlo o el jugador se queda encolado (y en coliseo, cobrado).
        await SupabaseService.cancelMatchmaking()
        return { ok: false }
      }

      if (r.error) {
        setEstado({ ...ESTADO_INICIAL, error: r.error })
        return { ok: false, error: r.error }
      }

      if (r.matched && r.roomId) {
        setEstado(ESTADO_INICIAL)
        setEncontrada({ roomId: r.roomId, reanudada: Boolean(r.resumed) })
        return { ok: true }
      }

      buscandoRef.current = true
      pararSondeo()
      intervaloRef.current = setInterval(() => { void sondear() }, SONDEO_MS)
      return { ok: true }
    },
    [pararSondeo, sondear]
  )

  // Salida limpia. Si el jugador cierra la pestaña o cambia de pantalla mientras
  // busca, hay que sacarlo de la cola: si no, otro se emparejaría con una pestaña
  // cerrada y, en coliseo, su entrada se quedaría retenida hasta que el barrido
  // del servidor la devolviera minutos después.
  useEffect(() => {
    vivoRef.current = true

    const alCerrar = () => {
      if (!buscandoRef.current) return
      // fetch con keepalive es lo único que sobrevive al cierre de la pestaña.
      // Si no llega, el barrido del servidor lo arregla en 45 segundos.
      void SupabaseService.cancelMatchmaking()
    }
    window.addEventListener('beforeunload', alCerrar)

    return () => {
      vivoRef.current = false
      window.removeEventListener('beforeunload', alCerrar)
      if (intervaloRef.current) clearInterval(intervaloRef.current)
      intervaloRef.current = null
      if (buscandoRef.current) {
        buscandoRef.current = false
        void SupabaseService.cancelMatchmaking()
      }
    }
  }, [])

  return { estado, encontrada, buscar, cancelar }
}
