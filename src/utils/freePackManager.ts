export interface FreePackSlot {
  slotId: number // 0, 1, 2, 3
  status: 'empty' | 'locked' | 'unlocking' | 'ready'
  durationHours: 1 | 2 | 4 | 6 | 8 | 12
  unlockStartedAt?: number // Timestamp ms
  arenaLevel: number // 1, 2, 3, 4, 5
}

export interface PlayerRewardPack {
  id: string
  status: 'pending' | 'unlocking' | 'ready'
  durationHours?: number
  arenaLevel: number
  unlockStartedAt?: number // Timestamp ms
  createdAt: number
}

export function createEmptySlots(): FreePackSlot[] {
  return [
    { slotId: 0, status: 'empty', durationHours: 1, arenaLevel: 1 },
    { slotId: 1, status: 'empty', durationHours: 2, arenaLevel: 1 },
    { slotId: 2, status: 'empty', durationHours: 4, arenaLevel: 1 },
    { slotId: 3, status: 'empty', durationHours: 6, arenaLevel: 1 },
  ]
}

/**
 * Normaliza cualquier array de slots (de PostgreSQL, localStorage o de estado)
 * para garantizar que SIEMPRE existan los 4 slots de Plant Arena (0, 1, 2, 3).
 * Cualquier slot faltante se rellena automáticamente con status 'empty'.
 */
export function normalizePackSlots(slots?: FreePackSlot[] | null): FreePackSlot[] {
  const base = createEmptySlots()
  if (!slots || !Array.isArray(slots) || slots.length === 0) {
    return base
  }
  return base.map((emptySlot) => {
    const found = slots.find((s) => s && s.slotId === emptySlot.slotId)
    if (!found) return emptySlot
    return {
      slotId: emptySlot.slotId,
      status: found.status || 'empty',
      durationHours: (found.durationHours || emptySlot.durationHours) as FreePackSlot['durationHours'],
      arenaLevel: found.arenaLevel || 1,
      unlockStartedAt: found.unlockStartedAt,
    }
  })
}

// Rewards are rolled exclusively by Supabase. The browser only renders the persisted result.

// Calculate formatted remaining time string
export function getRemainingTimeString(slot: FreePackSlot): string {
  if (slot.status !== 'unlocking' || !slot.unlockStartedAt) {
    return `${slot.durationHours}h`
  }

  const totalMs = slot.durationHours * 3600 * 1000
  const elapsedMs = Date.now() - slot.unlockStartedAt
  const remainingMs = Math.max(0, totalMs - elapsedMs)

  if (remainingMs <= 0) {
    return '¡LISTO!'
  }

  const totalSec = Math.floor(remainingMs / 1000)
  const hours = Math.floor(totalSec / 3600)
  const mins = Math.floor((totalSec % 3600) / 60)
  const secs = totalSec % 60

  if (hours > 0) {
    return `${hours}h ${mins}m`
  }
  return `${mins}m ${secs}s`
}

/**
 * Calculates the Gold coin cost to unlock a chest slot immediately based on remaining time.
 * Scaled rate: 75 Gold per hour remaining (~1.25 Gold per minute, min 10 Gold).
 * - 1h pack = 75 Gold
 * - 2h pack = 150 Gold
 * - 4h pack = 300 Gold
 * - 6h pack = 450 Gold
 */
export function calculateInstantUnlockGoldCost(slot: FreePackSlot): number {
  if (slot.status === 'ready') return 0

  let remainingHours = slot.durationHours
  if (slot.status === 'unlocking' && slot.unlockStartedAt) {
    const totalMs = slot.durationHours * 3600 * 1000
    const elapsedMs = Date.now() - slot.unlockStartedAt
    const remainingMs = Math.max(0, totalMs - elapsedMs)
    remainingHours = remainingMs / (3600 * 1000)
  }

  // 75 Gold per hour remaining, rounded up, minimum 10 Gold
  return Math.max(10, Math.ceil(remainingHours * 75))
}
