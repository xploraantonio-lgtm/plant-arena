// Módulo central de analítica para Google Analytics 4 (GA4) y HTML5 History API
// Permite disparar Pageviews Virtuales y sincronizar URLs sin recargar la página

declare global {
  interface Window {
    dataLayer?: unknown[]
    gtag?: (...args: unknown[]) => void
    GA_MEASUREMENT_ID?: string
  }
}

export interface PageViewOptions {
  page_title: string
  page_path: string
  page_location?: string
}

export interface GameOverTrackingParams {
  outcome: 'victory' | 'defeat'
  matchMode?: string
  eloChange?: number
  roomId?: string | null
}

export interface GameStartTrackingParams {
  matchMode?: string
  roomId?: string | null
}

export type GameScreen =
  | 'landing'
  | 'menu'
  | 'searching'
  | 'battle'
  | 'partidas'
  | 'repeticion'
  | 'collection'
  | 'jardin'
  | 'shop'
  | 'ranking'
  | 'pass'
  | 'clan'
  | 'market'

export const SCREEN_ROUTES: Record<GameScreen, { path: string; title: string }> = {
  landing: { path: '/', title: 'Plant Arena - Estrategia y Batallas Tácticas' },
  menu: { path: '/play/menu', title: 'Plant Arena - Menú Principal' },
  searching: { path: '/play/matchmaking', title: 'Plant Arena - Buscando Rival' },
  battle: { path: '/play/in-game', title: 'Plant Arena - En Batalla' },
  shop: { path: '/play/shop', title: 'Plant Arena - Tienda' },
  collection: { path: '/play/collection', title: 'Plant Arena - Colección de Plantas' },
  jardin: { path: '/play/garden', title: 'Plant Arena - Jardín Zen' },
  ranking: { path: '/play/ranking', title: 'Plant Arena - Clasificación y Ranking' },
  pass: { path: '/play/pass', title: 'Plant Arena - Pase de Batalla' },
  clan: { path: '/play/clan', title: 'Plant Arena - Clan' },
  market: { path: '/play/market', title: 'Plant Arena - Mercado' },
  partidas: { path: '/play/history', title: 'Plant Arena - Historial de Partidas' },
  repeticion: { path: '/play/replay', title: 'Plant Arena - Repetición' },
}

export function getScreenFromPath(pathname: string, hash: string): GameScreen {
  const path = pathname.toLowerCase()
  const h = hash.toLowerCase()

  if (path.startsWith('/r/')) return 'repeticion'
  if (path.startsWith('/play') || h.includes('play')) {
    if (path.includes('/shop')) return 'shop'
    if (path.includes('/collection')) return 'collection'
    if (path.includes('/garden') || path.includes('/jardin')) return 'jardin'
    if (path.includes('/ranking')) return 'ranking'
    if (path.includes('/pass')) return 'pass'
    if (path.includes('/clan')) return 'clan'
    if (path.includes('/market')) return 'market'
    if (path.includes('/history') || path.includes('/partidas')) return 'partidas'
    if (path.includes('/replay')) return 'repeticion'
    return 'menu'
  }
  return 'landing'
}

export function getShopTabFromPath(pathname: string): 'packs' | 'pass' | 'gold' | 'energy' | 'market' {
  const path = pathname.toLowerCase()
  if (path.includes('/shop/pass')) return 'pass'
  if (path.includes('/shop/gold')) return 'gold'
  if (path.includes('/shop/energy')) return 'energy'
  if (path.includes('/shop/market')) return 'market'
  return 'packs'
}

/**
 * Dispara un evento virtual de page_view hacia Google Analytics 4
 * No requiere recarga y funciona aun si gtag está bloqueado o tardando en cargar.
 */
export function trackPageView({ page_title, page_path, page_location }: PageViewOptions): void {
  if (typeof window === 'undefined') return

  const fullLocation = page_location || `${window.location.origin}${page_path}`

  // Actualizar el título de la pestaña del navegador
  try {
    document.title = page_title
  } catch {
    // Ignorar si el DOM no está listo
  }

  // Registrar en Google Analytics si gtag está disponible
  if (typeof window.gtag === 'function') {
    window.gtag('event', 'page_view', {
      page_title,
      page_location: fullLocation,
      page_path,
    })
  }

  // Log informativo en entorno de desarrollo para verificación rápida
  if (import.meta.env.DEV) {
    console.log(`📊 [GA4 Virtual Pageview] ${page_path} — "${page_title}"`)
  }
}

/**
 * Actualiza la barra de direcciones con HTML5 pushState/replaceState
 * y registra la pageview virtual correspondiente.
 */
export function navigateAndTrack(
  path: string,
  title: string,
  options: { replace?: boolean } = {}
): void {
  if (typeof window === 'undefined') return

  try {
    const currentPath = window.location.pathname.toLowerCase()
    if (currentPath !== path.toLowerCase()) {
      if (window.location.protocol !== 'file:') {
        if (options.replace) {
          window.history.replaceState({ path }, title, path)
        } else {
          window.history.pushState({ path }, title, path)
        }
      }
    }
  } catch (err) {
    console.warn('[History API] No se pudo cambiar el estado del historial:', err)
  }

  trackPageView({
    page_title: title,
    page_path: path,
  })
}

/**
 * Disparar cuando una partida termina (Game Over Screen)
 * Actualiza la URL a /play/game-over para redes de anuncios (Ads) y registra
 * la vista virtual en GA4 junto con el evento personalizado 'game_over'.
 */
export function trackGameOver({ outcome, matchMode, eloChange, roomId }: GameOverTrackingParams): void {
  const title = outcome === 'victory' ? 'Plant Arena - ¡Victoria!' : 'Plant Arena - Fin de Partida'
  const path = '/play/game-over'

  navigateAndTrack(path, title)

  // Evento analítico complementario
  trackEvent('game_over', {
    outcome,
    match_mode: matchMode || 'ranked',
    elo_change: eloChange,
    room_id: roomId || undefined,
  })
}

/**
 * Disparar cuando empieza la partida (In-Game Screen)
 * Actualiza la URL a /play/in-game y registra la vista virtual en GA4.
 */
export function trackGameStart({ matchMode, roomId }: GameStartTrackingParams = {}): void {
  const title = 'Plant Arena - En Batalla'
  const path = '/play/in-game'

  navigateAndTrack(path, title)

  // Evento analítico de nivel/partida iniciada
  trackEvent('game_start', {
    match_mode: matchMode || 'ranked',
    room_id: roomId || undefined,
  })
}

/**
 * Disparar eventos personalizados genéricos hacia GA4
 * (ej: compras en tienda, apertura de sobres, visualización de anuncios).
 */
export function trackEvent(eventName: string, params: Record<string, unknown> = {}): void {
  if (typeof window === 'undefined') return

  if (typeof window.gtag === 'function') {
    window.gtag('event', eventName, params)
  }

  if (import.meta.env.DEV) {
    console.log(`🎯 [GA4 Event] "${eventName}":`, params)
  }
}
