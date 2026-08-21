import { useCallback, useEffect, useState } from 'react'
import { hayVersionNueva, recargarParaActualizar } from '../utils/versionDelJuego'

/**
 * Vigila si hay una versión nueva publicada del juego.
 *
 * Devuelve `nueva` para mostrar el banner emergente, `segundosParaRecarga` con
 * la cuenta atrás, y `recargar()` para el botón directo.
 *
 * @param enPartida Si el jugador está en mitad de una batalla activa. Mientras
 *                  lo esté, se muestra solo un aviso no bloqueante y la recarga
 *                  completa espera a que termine la partida.
 */
export function useVersionDelJuego(enPartida: boolean) {
  const [nueva, setNueva] = useState(false)
  const [segundosParaRecarga, setSegundosParaRecarga] = useState<number | null>(null)

  const comprobar = useCallback(async () => {
    try {
      if (await hayVersionNueva()) {
        setNueva(true)
      }
    } catch {
      // Si falla la comprobación, ignorar silenciosamente
    }
  }, [])

  // Comprobar al arrancar y periódicamente (cada 45 segundos)
  useEffect(() => {
    void comprobar()
    const id = setInterval(() => void comprobar(), 45 * 1000)
    return () => clearInterval(id)
  }, [comprobar])

  // Comprobar al volver a la pestaña o recuperar el foco
  useEffect(() => {
    const alVolver = () => {
      if (!document.hidden) void comprobar()
    }
    document.addEventListener('visibilitychange', alVolver)
    window.addEventListener('focus', alVolver)
    return () => {
      document.removeEventListener('visibilitychange', alVolver)
      window.removeEventListener('focus', alVolver)
    }
  }, [comprobar])

  // Cuenta atrás y recarga automática fuera de batalla
  useEffect(() => {
    if (!nueva || enPartida) {
      setSegundosParaRecarga(null)
      return
    }

    // Dar unos segundos para que el jugador lea la ventana emergente
    let remaining = 8
    setSegundosParaRecarga(remaining)

    const timer = setInterval(() => {
      remaining -= 1
      if (remaining <= 0) {
        clearInterval(timer)
        recargarParaActualizar(true)
      } else {
        setSegundosParaRecarga(remaining)
      }
    }, 1000)

    return () => clearInterval(timer)
  }, [nueva, enPartida])

  const recargar = useCallback(() => {
    recargarParaActualizar(true)
  }, [])

  return { nueva, segundosParaRecarga, recargar }
}
