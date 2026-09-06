import { SupabaseService } from './supabaseService'

/**
 * Fachada de dominio para operaciones del Coliseo.
 * Mantiene las llamadas actuales mientras desacoplamos consumidores.
 */
export const colosseumService = {
  placeColosseumWager: SupabaseService.placeColosseumWager.bind(SupabaseService),
  getColosseumLeaderboard: SupabaseService.getColosseumLeaderboard.bind(SupabaseService),
} as const
