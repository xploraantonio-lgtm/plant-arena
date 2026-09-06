import { SupabaseService } from './supabaseService'

/** Fachada de dominio para salas y emparejamiento. */
export const MatchmakingService = {
  getGameRoom: SupabaseService.getGameRoom.bind(SupabaseService),
  gameRoomInfo: SupabaseService.gameRoomInfo.bind(SupabaseService),
} as const
