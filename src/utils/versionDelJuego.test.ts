import { describe, it, expect, vi, beforeEach } from 'vitest'
import { hayVersionNueva, versionPublicada, recargarParaActualizar, VERSION_DE_ESTE_PAQUETE } from './versionDelJuego'

describe('versionDelJuego', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    if (typeof window !== 'undefined') {
      window.sessionStorage.clear()
    }
  })

  it('exporta la versión del paquete actual', () => {
    expect(typeof VERSION_DE_ESTE_PAQUETE).toBe('string')
  })

  it('versionPublicada devuelve null si fetch falla', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')))
    const version = await versionPublicada()
    expect(version).toBeNull()
  })

  it('versionPublicada devuelve el build si la respuesta es válida', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ build: '20260821120000' }),
      })
    )
    const version = await versionPublicada()
    expect(version).toBe('20260821120000')
  })

  it('hayVersionNueva detecta diferencias cuando hay una nueva versión publicada', async () => {
    if (VERSION_DE_ESTE_PAQUETE === 'dev') {
      // En dev siempre es false para no molestar en desarrollo local
      expect(await hayVersionNueva()).toBe(false)
    } else {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ build: 'version_distinta_999999' }),
        })
      )
      const hay = await hayVersionNueva()
      expect(hay).toBe(true)
    }
  })

  it('recargarParaActualizar llama a reload', () => {
    const reloadMock = vi.fn()
    vi.stubGlobal('window', {
      location: { reload: reloadMock },
      sessionStorage: {
        getItem: vi.fn().mockReturnValue(null),
        setItem: vi.fn(),
      },
    })

    recargarParaActualizar(true)
    expect(reloadMock).toHaveBeenCalled()
  })
})
