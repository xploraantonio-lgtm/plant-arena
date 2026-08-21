import { useCallback, useEffect, useState } from 'react'
import { hayVersionNueva, recargarParaActualizar } from '../utils/versionDelJuego'

/**
 * Vigila si hay una versión nueva publicada.
 *
 * Devuelve `nueva` para poder avisar en pantalla, y `recargar()` para el botón.
 * Además recarga SOLA cuando es seguro hacerlo, que es lo que resuelve el
 * problema de verdad: pedirle a la gente que recargue no funciona.
 *
 * @param enPartida si el jugador está en mitad de una batalla. Mientras lo esté
 *                  NO se recarga: sería echarlo de su propia partida y, en un
 *                  amistoso con apuesta, hacerle perder las gemas.
 */
export function useVersionDelJuego(enPartida: boolean) {
  const [nueva, setNueva] = useState(false)

  const comprobar = useCallback(async () => {
    if (await hayVersionNueva()) setNueva(true)
  }, [])

  // Al arrancar y cada cinco minutos. No hace falta más: el fichero pesa treinta
  // bytes, pero tampoco menos — quien deja la pestaña abierta toda la tarde tiene
  // que enterarse antes de la siguiente partida.
  useEffect(() => {
    void comprobar()
    const id = setInterval(() => void comprobar(), 5 * 60 * 1000)
    return () => clearInterval(id)
  }, [comprobar])

  // Y al volver a la pestaña: es el momento típico en que alguien retoma el juego
  // horas después de haberlo dejado abierto.
  useEffect(() => {
    const alVolver = () => {
      if (!document.hidden) void comprobar()
    }
    document.addEventListener('visibilitychange', alVolver)
    return () => document.removeEventListener('visibilitychange', alVolver)
  }, [comprobar])

  // La recarga automática, sólo fuera de la batalla.
  useEffect(() => {
    if (!nueva || enPartida) return
    // Un momento para que se vea el aviso y no parezca un fallo del navegador.
    const id = setTimeout(() => recargarParaActualizar(), 2500)
    return () => clearTimeout(id)
  }, [nueva, enPartida])

  return { nueva, recargar: recargarParaActualizar }
}
