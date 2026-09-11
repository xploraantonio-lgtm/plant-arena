import { describe, it, expect } from 'vitest'
import { evaluateMarketplaceAccess, MARKETPLACE_MIN_COPAS } from './marketplaceAccess'

describe('evaluateMarketplaceAccess', () => {
  it('constante de copas requeridas debe ser 1350', () => {
    expect(MARKETPLACE_MIN_COPAS).toBe(1350)
  })

  it('permite acceso si tiene Pase VIP aunque tenga menos de 1350 copas', () => {
    const res = evaluateMarketplaceAccess(true, 1000)
    expect(res.hasAccess).toBe(true)
    expect(res.canSell).toBe(true)
    expect(res.canBuy).toBe(true)
    expect(res.unlockedBy).toBe('vip_pass')
    expect(res.copasActuales).toBe(1000)
    expect(res.copasRequeridas).toBe(1350)
  })

  it('permite acceso si tiene 1350 copas o más aunque no tenga Pase VIP', () => {
    const res = evaluateMarketplaceAccess(false, 1350)
    expect(res.hasAccess).toBe(true)
    expect(res.canSell).toBe(true)
    expect(res.canBuy).toBe(true)
    expect(res.unlockedBy).toBe('copas')
    expect(res.copasFaltantes).toBe(0)

    const resOver = evaluateMarketplaceAccess(false, 1500)
    expect(resOver.hasAccess).toBe(true)
    expect(resOver.canSell).toBe(true)
    expect(resOver.canBuy).toBe(true)
    expect(resOver.unlockedBy).toBe('copas')
  })

  it('bloquea venta pero PERMITE COMPRA si no tiene Pase VIP y tiene menos de 1350 copas', () => {
    const res = evaluateMarketplaceAccess(false, 1200)
    expect(res.hasAccess).toBe(false)
    expect(res.canSell).toBe(false)
    expect(res.canBuy).toBe(true)
    expect(res.unlockedBy).toBe('none')
    expect(res.copasFaltantes).toBe(150)
  })

  it('maneja valores nulos o indefinidos con fallback seguro: venta bloqueada, compra habilitada', () => {
    const res = evaluateMarketplaceAccess(undefined, undefined)
    expect(res.hasAccess).toBe(false)
    expect(res.canSell).toBe(false)
    expect(res.canBuy).toBe(true)
    expect(res.copasActuales).toBe(1000)
    expect(res.copasFaltantes).toBe(350)
  })

  it('permite acceso si tiene Pase VIP y fecha de expiración es futura o nula', () => {
    const futureDate = new Date(Date.now() + 86400000 * 30).toISOString()
    const res = evaluateMarketplaceAccess(true, 1000, futureDate)
    expect(res.canSell).toBe(true)
    expect(res.unlockedBy).toBe('vip_pass')

    const resNull = evaluateMarketplaceAccess(true, 1000, null)
    expect(resNull.canSell).toBe(true)
    expect(resNull.unlockedBy).toBe('vip_pass')
  })

  it('si el Pase VIP expiró en el pasado y no tiene copas, bloquea venta pero permite compra', () => {
    const pastDate = new Date(Date.now() - 86400000).toISOString()
    const res = evaluateMarketplaceAccess(true, 1000, pastDate)
    expect(res.canSell).toBe(false)
    expect(res.canBuy).toBe(true)
    expect(res.unlockedBy).toBe('none')
  })
})
