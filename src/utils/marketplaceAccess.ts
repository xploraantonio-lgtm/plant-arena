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
  userElo?: number
): MarketplaceAccessResult {
  const copasActuales =
    typeof userElo === 'number' && Number.isFinite(userElo)
      ? Math.max(0, Math.round(userElo))
      : 1000
  const copasRequeridas = MARKETPLACE_MIN_COPAS
  const copasFaltantes = Math.max(0, copasRequeridas - copasActuales)

  if (Boolean(hasVipPass)) {
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
