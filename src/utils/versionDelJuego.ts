// ─────────────────────────────────────────────────────────────────────────────
// CUANDO HAY VERSIÓN NUEVA, EL JUEGO SE RECARGA SOLO
//
// EL PROBLEMA, QUE NO ES DE COMODIDAD
//   La partida es una simulación determinista: los dos clientes ejecutan el mismo
//   motor con la misma semilla y las mismas jugadas. Si uno lleva el motor viejo y
//   el otro el nuevo, NO están jugando la misma partida — cada uno calcula un
//   ganador distinto, los dos reportan cosas contrarias y la partida acaba «en
//   revisión» sin repartir nada a nadie.
//
//   Así que «decidle que recarguen» no es una recomendación: es un requisito. Y
//   pedírselo no funciona, porque la mayoría no lo hace.
//
// CÓMO
//   Al compilar se escribe el número de la compilación en dos sitios: dentro del
//   paquete y en /version.json. El juego pide ese fichero de vez en cuando SIN
//   caché y compara. Si no coinciden, hay versión nueva.
//
// DÓNDE SE RECARGA, Y DÓNDE NO
//   Nunca en mitad de una batalla: eso sería echar a alguien de su propia partida
//   y, en un amistoso con apuesta, hacerle perder las gemas. Sólo se recarga
//   cuando el jugador está en un sitio seguro (el menú), y antes de entrar a
//   buscar rival — que es justo el momento en que importa.
//
//   Mientras esté en la batalla se le avisa y se recarga al salir.
// ─────────────────────────────────────────────────────────────────────────────

/** El número de esta compilación, puesto por vite.config.ts. */
declare const __BUILD_ID__: string

export const VERSION_DE_ESTE_PAQUETE: string =
  typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev'

/** Para no recargar dos veces por lo mismo y acabar en un bucle. */
const MARCA_DE_RECARGA = 'pa_recargado_por_version'

/**
 * Pregunta al servidor qué versión hay publicada.
 *
 * Devuelve null si no se pudo saber (sin conexión, fichero ausente, en
 * desarrollo). En ese caso NO se recarga: ante la duda, mejor dejar jugar.
 */
export async function versionPublicada(): Promise<string | null> {
  try {
    // cache: 'no-store' es lo único que importa de esta llamada. Con la caché del
    // navegador de por medio, el fichero contestaría la versión vieja y esto no
    // detectaría nada.
    const r = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' })
    if (!r.ok) return null
    const j = (await r.json()) as { build?: string }
    return typeof j.build === 'string' ? j.build : null
  } catch {
    return null
  }
}

/** ¿Hay una versión más nueva publicada que la que se está ejecutando? */
export async function hayVersionNueva(): Promise<boolean> {
  // En desarrollo no hay nada que comparar: el paquete no lleva número.
  if (VERSION_DE_ESTE_PAQUETE === 'dev') return false
  const publicada = await versionPublicada()
  return publicada !== null && publicada !== VERSION_DE_ESTE_PAQUETE
}

/**
 * Recarga para coger la versión nueva, una sola vez.
 *
 * La marca en sessionStorage evita el bucle si por lo que sea el fichero y el
 * paquete no llegan a coincidir (un despliegue a medias, una caché intermedia):
 * mejor quedarse con la versión vieja que recargar sin parar.
 */
export function recargarParaActualizar(forzar = false): void {
  try {
    if (!forzar && sessionStorage.getItem(MARCA_DE_RECARGA) === VERSION_DE_ESTE_PAQUETE) return
    sessionStorage.setItem(MARCA_DE_RECARGA, VERSION_DE_ESTE_PAQUETE)
  } catch {
    // Sin sessionStorage se recarga igual: es mejor eso que jugar desincronizado.
  }
  window.location.reload()
}

