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
//   Los enlaces que se COMPARTEN usan siempre el dominio público configurado en
//   VITE_PUBLIC_URL. En cambio, los flujos de autenticación y recuperación deben
//   volver al MISMO entorno desde el que se iniciaron (producción, preview o local),
//   para que una preview de Vercel no salte a producción al abrir el correo.
// ─────────────────────────────────────────────────────────────────────────────

/** Quita la barra final: así al pegar rutas no salen dobles barras. */
function sinBarraFinal(url: string): string {
  return url.replace(/\/+$/, '')
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
 * Adónde tiene que volver Supabase después de OAuth o recuperación de contraseña.
 *
 * Debe ser siempre el origin actual: así producción vuelve a producción, una
 * preview de Vercel vuelve a esa misma preview y localhost vuelve a localhost.
 * Supabase sólo respetará esta URL si está incluida en Authentication → URL
 * Configuration → Redirect URLs; para previews de Vercel se puede usar un patrón
 * permitido como https://*.vercel.app/** o una URL exacta.
 */
export function urlDeVuelta(): string {
  if (typeof window !== 'undefined') return sinBarraFinal(window.location.origin)
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
