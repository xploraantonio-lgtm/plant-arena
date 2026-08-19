// storageSanitizer.ts - Ensures no stale mock data or test numbers persist in browser localStorage

/**
 * Claves que nunca debieron vivir en el navegador. Se borran en CADA arranque,
 * no sólo al cambiar de versión: la primera guardaba el código secreto del
 * minijuego, así que el jugador tenía la respuesta a la vista y podía cobrar el
 * bote a la primera. Ahora el código vive sólo en Postgres.
 */
const CLAVES_OBSOLETAS = [
  'plant_arena_lottery_secret_code',
  'plant_arena_lottery_code_attempts',
  'plant_arena_lottery_code_last_free_reset',
  'plant_arena_lottery_code_free_used',
  'plant_arena_lottery_code_extra_attempts',
  // El estado de administrador se rehidrataba de aquí: bastaba ponerla a 'true'
  // para abrir el panel. Ahora sale de profiles.is_admin en el servidor.
  'plant_arena_admin_auth',
]

export function sanitizeLocalStorage(): void {
  if (typeof window === 'undefined') return

  // Purga incondicional e idempotente. Va antes del bloque versionado a
  // propósito: no debe depender de que se suba SANITIZED_VERSION.
  try {
    CLAVES_OBSOLETAS.forEach((k) => localStorage.removeItem(k))
  } catch {
    // Si localStorage no está disponible, no hay nada que purgar.
  }

  try {
    const SANITIZED_VERSION = 'v3_production_clean'
    const currentVersion = localStorage.getItem('plant_arena_storage_version')

    if (currentVersion !== SANITIZED_VERSION) {
      console.log('[StorageSanitizer] Purging legacy test storage and resetting to clean defaults...')

      // Remove stale balances and test flags
      localStorage.setItem('plant_arena_user_tokens', '0')
      localStorage.setItem('plant_arena_user_gold', '0')
      localStorage.setItem('plant_arena_colosseum_tickets', '0')
      localStorage.setItem('plant_arena_colosseum_current_streak', '0')
      localStorage.setItem('plant_arena_colosseum_max_streak', '0')
      localStorage.setItem('plant_arena_has_vip_pass', 'false')
      localStorage.setItem('plant_arena_claimed_vip_pass', '[]')
      localStorage.setItem('plant_arena_claimed_vip_levels', '[]')

      // Fix player profile
      const rawProfile = localStorage.getItem('plant_arena_player_profile')
      if (rawProfile) {
        try {
          const parsed = JSON.parse(rawProfile)
          if (parsed.name === 'DRAGONMASTER' || !parsed.name) {
            parsed.name = 'Guerrero'
          }
          parsed.totalReferred = 0
          parsed.totalReferralBonusUsd = 0
          localStorage.setItem('plant_arena_player_profile', JSON.stringify(parsed))
        } catch {
          localStorage.removeItem('plant_arena_player_profile')
        }
      }

      // Reset starter inventory: Only the 4 starter cards
      localStorage.setItem(
        'plant_arena_unlocked_plants',
        JSON.stringify(['sunflower', 'peashooter', 'wallnut', 'chomper'])
      )

      const starterCopies = {
        sunflower: 1,
        peashooter: 1,
        wallnut: 1,
        chomper: 1,
        repeater: 0,
        garlic: 0,
        bonkchoy: 0,
        squash: 0,
        twinsunflower: 0,
        tallnut: 0,
        threepeater: 0,
        jalapeno: 0,
        iceberglettuce: 0,
        aloe: 0,
        melonpult: 0,
      }
      localStorage.setItem('plant_arena_plant_copies', JSON.stringify(starterCopies))

      const starterInstances = ['sunflower', 'peashooter', 'wallnut', 'chomper'].map((id) => ({
        instanceId: `inst_base_${id}`,
        plantId: id,
        level: 0,
        statRolls: [],
        isBase: true,
        obtainedAt: Date.now(),
      }))
      localStorage.setItem('plant_arena_plant_instances', JSON.stringify(starterInstances))
      localStorage.setItem('plant_arena_active_deck', JSON.stringify(['sunflower', 'peashooter', 'wallnut', 'chomper']))
      localStorage.removeItem('plant_arena_user_transactions')

      localStorage.setItem('plant_arena_storage_version', SANITIZED_VERSION)
    }
  } catch (e) {
    console.warn('[StorageSanitizer] Exception while sanitizing storage:', e)
  }
}
