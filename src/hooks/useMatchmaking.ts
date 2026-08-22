import { useCallback, useEffect, useRef, useState } from 'react'
import { SupabaseService } from '../services/supabaseService'

/**
 * LA COLA DE EMPAREJAMIENTO
 *
 * Habla con las RPC de emparejamiento. El cliente no decide nada de lo que
 * importa: no manda el mazo (lo lee el servidor de plant_instances), no elige la
 * semilla (la genera el servidor) y no decide con quién juega.
 *
 * En Ranked: busca rival humano real durante 0-60 segundos. Si pasan >= 60 s
 * sin rival humano, el servidor comprueba de nuevo la prioridad humana y, si
 * no hay humano, selecciona un Rival Semilla determinista con nueva sala.
 */

export type ModoPartida = 'ranked' | 'friendly' | 'colosseum' | 'tournament'

export const MODOS_CON_EMPAREJAMIENTO: ReadonlySet<ModoPartida> = new Set<ModoPartida>([
  'ranked',
  'friendly',
])

/** ¿Este modo busca rival, o va directo a la simulación local? */
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
  /** Mensaje del servidor, si trae alguno (por ejemplo al devolver la entrada). */
  mensaje: string | null
  error: string | null
}

const ESTADO_INICIAL: EstadoCola = {
  buscando: false,
  segundos: 0,
  plazoSegundos: null,
  mensaje: null,
  error: null,
}

/** Cada cuánto se sondea. Bastante por debajo del latido de 45 s del servidor. */
const SONDEO_MS = 2000

export function useMatchmaking() {
  const [estado, setEstado] = useState<EstadoCola>(ESTADO_INICIAL)
  const [encontrada, setEncontrada] = useState<PartidaEncontrada | null>(null)

  const intervaloRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const modoRef = useRef<ModoPartida>('ranked')
  const claimingRef = useRef<boolean>(false)
  const vivoRef = useRef<boolean>(true)
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
    claimingRef.current = false
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
      claimingRef.current = false
      setEstado(ESTADO_INICIAL)
      setEncontrada({ roomId: r.roomId, reanudada: false })
      return
    }

    // El plazo del coliseo venció: el servidor ya canceló y devolvió.
    if (r.timedOut) {
      pararSondeo()
      buscandoRef.current = false
      claimingRef.current = false
      setEstado({
        ...ESTADO_INICIAL,
        mensaje: r.message ?? 'No apareció rival. Se te devolvió la entrada.',
      })
      return
    }

    if (!r.searching) {
      // Nos sacaron de la cola (barrido por falta de latido, o cancelación desde otra pestaña).
      pararSondeo()
      buscandoRef.current = false
      claimingRef.current = false
      setEstado(ESTADO_INICIAL)
      return
    }

    const segundosEsperados = r.waitedSeconds ?? 0

    // En Ranked: si ya pasaron >= 60 segundos, solicitar automáticamente Rival Semilla
    if (modoRef.current === 'ranked' && segundosEsperados >= 60 && !claimingRef.current) {
      claimingRef.current = true
      try {
        const claimRes = await SupabaseService.claimRankedAsyncOpponent()
        if (!vivoRef.current) return

        if (claimRes.matched && claimRes.roomId) {
          pararSondeo()
          buscandoRef.current = false
          claimingRef.current = false
          setEstado(ESTADO_INICIAL)
          setEncontrada({ roomId: claimRes.roomId, reanudada: false })
          return
        }
      } catch (e) {
        console.warn('Error al reclamar Rival Semilla:', e)
      } finally {
        claimingRef.current = false
      }
    }

    setEstado({
      buscando: true,
      segundos: segundosEsperados,
      plazoSegundos: r.timeoutSeconds ?? null,
      mensaje: null,
      error: null,
    })
  }, [pararSondeo])

  const buscar = useCallback(
    async (
      modo: ModoPartida,
      opciones: { betGems?: number; useTicket?: boolean; roomCode?: string } = {}
    ): Promise<{ ok: boolean; error?: string }> => {
      modoRef.current = modo
      claimingRef.current = false
      setEncontrada(null)
      setEstado({ ...ESTADO_INICIAL, buscando: true })

      const r = await SupabaseService.enterMatchmaking(modo, opciones)

      if (!vivoRef.current) {
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

  useEffect(() => {
    vivoRef.current = true

    const alCerrar = () => {
      if (!buscandoRef.current) return
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
