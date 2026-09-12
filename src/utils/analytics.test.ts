import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  trackPageView,
  navigateAndTrack,
  trackGameOver,
  trackGameStart,
  trackEvent,
  getScreenFromPath,
  getShopTabFromPath,
  SCREEN_ROUTES,
} from './analytics'

describe('analytics utility', () => {
  let mockWindow: Record<string, any>
  let mockDocument: Record<string, any>

  beforeEach(() => {
    vi.clearAllMocks()
    mockDocument = { title: '' }
    mockWindow = {
      dataLayer: [],
      gtag: vi.fn(),
      location: {
        origin: 'https://tusitio.com',
        pathname: '/',
        protocol: 'https:',
      },
      history: {
        pushState: vi.fn(),
        replaceState: vi.fn(),
      },
    }
    vi.stubGlobal('window', mockWindow)
    vi.stubGlobal('document', mockDocument)
  })

  describe('getScreenFromPath', () => {
    it('detects replay links', () => {
      expect(getScreenFromPath('/r/abc1234', '')).toBe('repeticion')
    })

    it('detects main menu from /play or /play/menu', () => {
      expect(getScreenFromPath('/play', '')).toBe('menu')
      expect(getScreenFromPath('/play/menu', '')).toBe('menu')
    })

    it('detects shop from /play/shop', () => {
      expect(getScreenFromPath('/play/shop', '')).toBe('shop')
    })

    it('detects collection from /play/collection', () => {
      expect(getScreenFromPath('/play/collection', '')).toBe('collection')
    })

    it('detects garden from /play/garden', () => {
      expect(getScreenFromPath('/play/garden', '')).toBe('jardin')
    })

    it('detects ranking from /play/ranking', () => {
      expect(getScreenFromPath('/play/ranking', '')).toBe('ranking')
    })

    it('detects pass from /play/pass', () => {
      expect(getScreenFromPath('/play/pass', '')).toBe('pass')
    })

    it('falls back to landing for unknown non-play path', () => {
      expect(getScreenFromPath('/', '')).toBe('landing')
      expect(getScreenFromPath('/about', '')).toBe('landing')
    })
  })

  describe('getShopTabFromPath', () => {
    it('detects specific shop tabs', () => {
      expect(getShopTabFromPath('/play/shop/pass')).toBe('pass')
      expect(getShopTabFromPath('/play/shop/gold')).toBe('gold')
      expect(getShopTabFromPath('/play/shop/energy')).toBe('energy')
      expect(getShopTabFromPath('/play/shop/market')).toBe('market')
      expect(getShopTabFromPath('/play/shop/packs')).toBe('packs')
      expect(getShopTabFromPath('/play/shop')).toBe('packs')
    })
  })

  describe('trackPageView', () => {
    it('calls window.gtag with page_view event and parameters', () => {
      trackPageView({
        page_title: 'Plant Arena - Tienda',
        page_path: '/play/shop',
      })

      expect(window.gtag).toHaveBeenCalledWith('event', 'page_view', {
        page_title: 'Plant Arena - Tienda',
        page_location: `${window.location.origin}/play/shop`,
        page_path: '/play/shop',
      })
      expect(document.title).toBe('Plant Arena - Tienda')
    })

    it('does not throw when window.gtag is undefined (ad blocker)', () => {
      delete (window as any).gtag

      expect(() => {
        trackPageView({
          page_title: 'Test',
          page_path: '/play/test',
        })
      }).not.toThrow()
    })
  })

  describe('navigateAndTrack', () => {
    it('updates window.history.pushState and calls trackPageView', () => {
      const pushStateSpy = vi.spyOn(window.history, 'pushState')

      navigateAndTrack('/play/shop', 'Plant Arena - Tienda')

      expect(pushStateSpy).toHaveBeenCalledWith(
        { path: '/play/shop' },
        'Plant Arena - Tienda',
        '/play/shop'
      )
      expect(window.gtag).toHaveBeenCalledWith('event', 'page_view', expect.objectContaining({
        page_path: '/play/shop',
      }))
    })
  })

  describe('trackGameOver', () => {
    it('updates history to /play/game-over and tracks both pageview and game_over event', () => {
      const pushStateSpy = vi.spyOn(window.history, 'pushState')

      trackGameOver({
        outcome: 'victory',
        matchMode: 'ranked',
        roomId: 'room-123',
      })

      expect(pushStateSpy).toHaveBeenCalledWith(
        { path: '/play/game-over' },
        'Plant Arena - ¡Victoria!',
        '/play/game-over'
      )
      expect(window.gtag).toHaveBeenCalledWith('event', 'page_view', expect.objectContaining({
        page_path: '/play/game-over',
        page_title: 'Plant Arena - ¡Victoria!',
      }))
      expect(window.gtag).toHaveBeenCalledWith('event', 'game_over', {
        outcome: 'victory',
        match_mode: 'ranked',
        elo_change: undefined,
        room_id: 'room-123',
      })
    })
  })

  describe('trackGameStart', () => {
    it('updates history to /play/in-game and tracks game_start', () => {
      const pushStateSpy = vi.spyOn(window.history, 'pushState')

      trackGameStart({
        matchMode: 'ranked',
        roomId: 'room-abc',
      })

      expect(pushStateSpy).toHaveBeenCalledWith(
        { path: '/play/in-game' },
        'Plant Arena - En Batalla',
        '/play/in-game'
      )
      expect(window.gtag).toHaveBeenCalledWith('event', 'game_start', {
        match_mode: 'ranked',
        room_id: 'room-abc',
      })
    })
  })

  describe('trackEvent', () => {
    it('sends custom events to window.gtag', () => {
      trackEvent('pack_opened', { pack_type: 'legendary', source: 'victory' })

      expect(window.gtag).toHaveBeenCalledWith('event', 'pack_opened', {
        pack_type: 'legendary',
        source: 'victory',
      })
    })
  })

  describe('SCREEN_ROUTES mapping', () => {
    it('maps all main game screens properly', () => {
      expect(SCREEN_ROUTES.menu.path).toBe('/play/menu')
      expect(SCREEN_ROUTES.battle.path).toBe('/play/in-game')
      expect(SCREEN_ROUTES.shop.path).toBe('/play/shop')
      expect(SCREEN_ROUTES.collection.path).toBe('/play/collection')
      expect(SCREEN_ROUTES.ranking.path).toBe('/play/ranking')
    })
  })
})
