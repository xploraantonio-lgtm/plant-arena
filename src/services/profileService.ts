import { SupabaseService } from './supabaseService'

/**
 * Fachada de dominio para perfil, saldo, estado de cuenta y mazo activo.
 *
 * Delega en SupabaseService para conservar exactamente los mismos contratos
 * mientras los consumidores se migran de forma incremental.
 */
export const profileService = {
  getProfile: SupabaseService.getProfile.bind(SupabaseService),
  updateProfile: SupabaseService.updateProfile.bind(SupabaseService),
  myBalance: SupabaseService.myBalance.bind(SupabaseService),
  myAuthStatus: SupabaseService.myAuthStatus.bind(SupabaseService),
  saveActiveDeck: SupabaseService.saveActiveDeck.bind(SupabaseService),
} as const
