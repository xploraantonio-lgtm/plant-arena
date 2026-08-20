// ─────────────────────────────────────────────────────────────────────────────
// LA DIRECCIÓN PÚBLICA DEL JUEGO
//
// EL PROBLEMA
//   Los enlaces que el juego reparte —el de invitación y el de una repetición
//   compartida— se construían con window.location.origin. O sea con la dirección
//   por la que TÚ estabas navegando en ese momento.
//
//   Y eso reparte enlaces equivocados sin avisar: abre el panel desde
//   plant-arena.vercel.app y tu enlace de invitación sale apuntando a Vercel;
//   ábrelo desde localhost y sale apuntando a tu propio ordenador. El jugador lo
//   manda por WhatsApp y el que lo recibe acaba en cualquier sitio menos en el
//   dominio del juego.
//
// LA REGLA
//   Un enlace que sale del juego lleva SIEMPRE el dominio de verdad, se navegue
//   desde donde se navegue. Se configura una vez en VITE_PUBLIC_URL y se acabó.
//
//   La vuelta de un inicio de sesión es el caso contrario y va aparte: ahí sí hay
//   que volver a donde estabas, o quien desarrolla en local acabaría en producción
//   cada vez que entra con Google.
// ─────────────────────────────────────────────────────────────────────────────

/** Quita la barra final: así al pegar rutas no salen dobles barras. */
function sinBarraFinal(url: string): string {
  return url.replace(/\/+$/, '')
}

function esLocal(): boolean {
  if (typeof window === 'undefined') return false
  const h = window.location.hostname
  return h === 'localhost' || h === '127.0.0.1' || h.endsWith('.local')
}

/**
 * El dominio del juego, para todo enlace que se vaya a compartir.
 *
 * Sale de VITE_PUBLIC_URL. Sin esa variable se cae a la dirección actual, que es
 * lo que había antes: funciona, pero reparte el dominio por el que se navegue.
 */
export const URL_PUBLICA: string = sinBarraFinal(
  (import.meta.env.VITE_PUBLIC_URL as string | undefined)?.trim() ||
    (typeof window !== 'undefined' ? window.location.origin : '')
)

/**
 * Adónde tiene que volver el navegador después de entrar con Google.
 *
 * En local, a local: si aquí se devolviera el dominio público, cada inicio de
 * sesión desde el ordenador de desarrollo saltaría a producción y no habría forma
 * de probar la entrada.
 *
 * En cualquier otro sitio, al dominio público: así quien entre por una dirección
 * vieja (la de Vercel, por ejemplo) acaba en el dominio de verdad y no se queda
 * con la sesión abierta en el sitio equivocado.
 *
 * OJO — esto no basta por sí solo. Supabase sólo respeta esta dirección si está
 * en su lista blanca (Authentication → URL Configuration → Redirect URLs). Si no
 * está, ignora lo que se le pase y usa su «Site URL».
 */
export function urlDeVuelta(): string {
  if (esLocal() && typeof window !== 'undefined') return window.location.origin
  return URL_PUBLICA
}

/** El enlace de invitación de un jugador. */
export function enlaceDeReferido(codigo: string | null | undefined): string {
  return `${URL_PUBLICA}/?ref=${codigo ?? ''}`
}

/** El enlace público de una repetición compartida. */
export function enlaceDeRepeticion(token: string): string {
  return `${URL_PUBLICA}/r/${token}`
}
