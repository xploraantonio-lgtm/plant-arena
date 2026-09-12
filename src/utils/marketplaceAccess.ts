export const MARKETPLACE_MIN_COPAS = 1350

export interface MarketplaceAccessResult {
  /** Compatibilidad: permiso para vender en el mercado (requiere Pase VIP o 1350 copas) */
  hasAccess: boolean
  /** Permiso explícito para publicar y vender cartas o ítems */
  canSell: boolean
  /** Permiso para comprar ofertas en el mercado: ¡TODOS pueden comprar! */
  canBuy: boolean
  unlockedBy: 'vip_pass' | 'copas' | 'none'
  copasActuales: number
  copasRequeridas: number
  copasFaltantes: number
}

export function evaluateMarketplaceAccess(
  hasVipPass?: boolean,
  userElo?: number,
  vipPassExpiresAt?: string | null
): MarketplaceAccessResult {
  const copasActuales =
    typeof userElo === 'number' && Number.isFinite(userElo)
      ? Math.max(0, Math.round(userElo))
      : 1000
  const copasRequeridas = MARKETPLACE_MIN_COPAS
  const copasFaltantes = Math.max(0, copasRequeridas - copasActuales)

  const isVipActive =
    Boolean(hasVipPass) &&
    (!vipPassExpiresAt || new Date(vipPassExpiresAt).getTime() > Date.now())

  if (isVipActive) {
    return {
      hasAccess: true,
      canSell: true,
      canBuy: true,
      unlockedBy: 'vip_pass',
      copasActuales,
      copasRequeridas,
      copasFaltantes,
    }
  }

  if (copasActuales >= copasRequeridas) {
    return {
      hasAccess: true,
      canSell: true,
      canBuy: true,
      unlockedBy: 'copas',
      copasActuales,
      copasRequeridas,
      copasFaltantes: 0,
    }
  }

  return {
    hasAccess: false,
    canSell: false,
    canBuy: true, // ¡Todos los jugadores pueden comprar!
    unlockedBy: 'none',
    copasActuales,
    copasRequeridas,
    copasFaltantes,
  }
}

/**
 * Cálculo matemático autoritativo y unificado del reparto en ventas del Mercado:
 * - 100% cobrado al comprador.
 * - 90% neto acreditado al vendedor.
 * - 10% retenido como comisión del juego.
 * Equivalente exacto a ROUND(price_gems * 0.10, 2) en PostgreSQL.
 */
export function calculateMarketplaceSplit(priceGems: number, comisionPct: number = 10) {
  const safePrice = Math.max(0, Number(priceGems) || 0)
  const safeComisionPct = Number(comisionPct) || 10
  const comision = Math.round(safePrice * (safeComisionPct / 100) * 100) / 100
  const neto = Math.round((safePrice - comision) * 100) / 100
  const vendedorPct = 100 - safeComisionPct

  return {
    precio: safePrice,
    comision,
    neto,
    comisionPct: safeComisionPct,
    vendedorPct,
  }
}
