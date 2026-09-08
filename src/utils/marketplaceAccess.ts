export const MARKETPLACE_MIN_COPAS = 1350

export interface MarketplaceAccessResult {
  hasAccess: boolean
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
      unlockedBy: 'vip_pass',
      copasActuales,
      copasRequeridas,
      copasFaltantes,
    }
  }

  if (copasActuales >= copasRequeridas) {
    return {
      hasAccess: true,
      unlockedBy: 'copas',
      copasActuales,
      copasRequeridas,
      copasFaltantes: 0,
    }
  }

  return {
    hasAccess: false,
    unlockedBy: 'none',
    copasActuales,
    copasRequeridas,
    copasFaltantes,
  }
}
