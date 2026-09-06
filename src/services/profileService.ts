import { SupabaseService } from './supabaseService'

/**
 * Fachada de dominio para perfil, saldo y mazo activo.
 *
 * Fase 1 de la refactorización: delega en SupabaseService para mantener
 * exactamente los mismos contratos y comportamiento mientras los consumidores
 * se migran de forma incremental.
 */
export const profileService = {
  getProfile: SupabaseService.getProfile.bind(SupabaseService),
  updateProfile: SupabaseService.updateProfile.bind(SupabaseService),
  myBalance: SupabaseService.myBalance.bind(SupabaseService),
  saveActiveDeck: SupabaseService.saveActiveDeck.bind(SupabaseService),
} as const
