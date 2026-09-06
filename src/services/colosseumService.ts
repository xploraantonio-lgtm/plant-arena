import { SupabaseService } from './supabaseService'

/**
 * Fachada de dominio para operaciones del Coliseo.
 */
export const colosseumService = {
  placeColosseumWager: SupabaseService.placeColosseumWager.bind(SupabaseService),
} as const
