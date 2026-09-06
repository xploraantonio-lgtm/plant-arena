import { SupabaseService } from './supabaseService'

/** Fachada de dominio para salas y emparejamiento. */
export const MatchmakingService = {
  enterMatchmaking: SupabaseService.enterMatchmaking.bind(SupabaseService),
  pollMatchmaking: SupabaseService.pollMatchmaking.bind(SupabaseService),
  cancelMatchmaking: SupabaseService.cancelMatchmaking.bind(SupabaseService),
  claimRankedAsyncOpponent: SupabaseService.claimRankedAsyncOpponent.bind(SupabaseService),
  getGameRoom: SupabaseService.getGameRoom.bind(SupabaseService),
  gameRoomInfo: SupabaseService.gameRoomInfo.bind(SupabaseService),
} as const
