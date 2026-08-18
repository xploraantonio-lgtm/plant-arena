import { supabase, isSupabaseConfigured } from '../lib/supabaseClient'
import type { Database } from '../types/database.types'

type ProfileRow = Database['public']['Tables']['profiles']['Row']
type ProfileUpdate = Database['public']['Tables']['profiles']['Update']
type PlantInstanceRow = Database['public']['Tables']['plant_instances']['Row']
type PlantInstanceInsert = Database['public']['Tables']['plant_instances']['Insert']
type ClanRow = Database['public']['Tables']['clans']['Row']
type TournamentRow = Database['public']['Tables']['tournaments']['Row']

export const SupabaseService = {
  // ---------------------------------------------------------------------------
  // PROFILE & BALANCES
  // ---------------------------------------------------------------------------
  async getProfile(userId: string): Promise<ProfileRow | null> {
    if (!isSupabaseConfigured()) return null
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single()
      if (error) {
        console.warn('[SupabaseService] getProfile error:', error.message)
        return null
      }
      return data as ProfileRow
    } catch (e) {
      console.warn('[SupabaseService] getProfile exception:', e)
      return null
    }
  },

  async updateProfile(userId: string, updates: ProfileUpdate): Promise<boolean> {
    if (!isSupabaseConfigured()) return false
    try {
      const { error } = await (supabase.from('profiles') as any)
        .update(updates)
        .eq('id', userId)
      return !error
    } catch {
      return false
    }
  },

  // ---------------------------------------------------------------------------
  // PLANT INVENTORY & FUSIONS
  // ---------------------------------------------------------------------------
  async getUserPlants(userId: string): Promise<PlantInstanceRow[]> {
    if (!isSupabaseConfigured()) return []
    try {
      const { data, error } = await supabase
        .from('plant_instances')
        .select('*')
        .eq('owner_id', userId)
      if (error) return []
      return (data || []) as PlantInstanceRow[]
    } catch {
      return []
    }
  },

  async insertPlantInstance(plant: PlantInstanceInsert): Promise<PlantInstanceRow | null> {
    if (!isSupabaseConfigured()) return null
    try {
      const { data, error } = await (supabase.from('plant_instances') as any)
        .insert(plant)
        .select()
        .single()
      if (error) return null
      return data as PlantInstanceRow
    } catch {
      return null
    }
  },

  // ---------------------------------------------------------------------------
  // COLOSSEUM MATCH RESOLUTION (RPC)
  // ---------------------------------------------------------------------------
  async resolveColosseumMatch(roomId: string, winnerId: string): Promise<{ success: boolean; payout?: number }> {
    if (!isSupabaseConfigured()) return { success: false }
    try {
      const { data, error } = await (supabase.rpc as any)('resolve_colosseum_match', {
        p_room_id: roomId,
        p_winner_id: winnerId,
      })
      if (error) {
        console.error('[SupabaseService] resolveColosseumMatch error:', error)
        return { success: false }
      }
      return data as { success: boolean; payout?: number }
    } catch {
      return { success: false }
    }
  },

  // ---------------------------------------------------------------------------
  // MARKETPLACE P2P BUY (RPC)
  // ---------------------------------------------------------------------------
  async buyMarketplaceCard(listingId: string, buyerId: string): Promise<{ success: boolean; price_gems?: number }> {
    if (!isSupabaseConfigured()) return { success: false }
    try {
      const { data, error } = await (supabase.rpc as any)('buy_marketplace_card', {
        p_listing_id: listingId,
        p_buyer_id: buyerId,
      })
      if (error) return { success: false }
      return data as { success: boolean; price_gems?: number }
    } catch {
      return { success: false }
    }
  },

  // ---------------------------------------------------------------------------
  // CLAN TREASURY DEPOSIT (RPC)
  // ---------------------------------------------------------------------------
  async depositToClanVault(clanId: string, userId: string, amountGems: number): Promise<{ success: boolean; tickets_awarded?: number }> {
    if (!isSupabaseConfigured()) return { success: false }
    try {
      const { data, error } = await (supabase.rpc as any)('deposit_to_clan_vault', {
        p_clan_id: clanId,
        p_user_id: userId,
        p_amount: amountGems,
      })
      if (error) return { success: false }
      return data as { success: boolean; tickets_awarded?: number }
    } catch {
      return { success: false }
    }
  },

  // ---------------------------------------------------------------------------
  // CLANS & MEMBERS
  // ---------------------------------------------------------------------------
  async getAllClans(): Promise<ClanRow[]> {
    if (!isSupabaseConfigured()) return []
    try {
      const { data } = await supabase.from('clans').select('*').order('created_at', { ascending: false })
      return (data || []) as ClanRow[]
    } catch {
      return []
    }
  },

  // ---------------------------------------------------------------------------
  // TOURNAMENTS
  // ---------------------------------------------------------------------------
  async getActiveTournaments(): Promise<TournamentRow[]> {
    if (!isSupabaseConfigured()) return []
    try {
      const { data } = await supabase.from('tournaments').select('*').order('starts_at', { ascending: true })
      return (data || []) as TournamentRow[]
    } catch {
      return []
    }
  },

  // ---------------------------------------------------------------------------
  // REALTIME MATCHMAKING
  // ---------------------------------------------------------------------------
  async enterMatchmakingQueue(
    userId: string,
    mode: 'ranked' | 'friendly' | 'colosseum' | 'tournament',
    userElo: number,
    extra?: { tournamentId?: string; colosseumBet?: number; roomCode?: string }
  ): Promise<string | null> {
    if (!isSupabaseConfigured()) return null
    try {
      const { data, error } = await (supabase.from('matchmaking_queue') as any)
        .insert({
          user_id: userId,
          mode,
          user_elo: userElo,
          tournament_id: extra?.tournamentId || null,
          colosseum_bet: extra?.colosseumBet || null,
          room_code: extra?.roomCode || null,
          status: 'searching',
        })
        .select('id')
        .single()
      if (error || !data) return null
      return data.id as string
    } catch {
      return null
    }
  },

  async leaveMatchmakingQueue(queueId: string): Promise<boolean> {
    if (!isSupabaseConfigured()) return false
    try {
      const { error } = await (supabase.from('matchmaking_queue') as any)
        .update({ status: 'cancelled' })
        .eq('id', queueId)
      return !error
    } catch {
      return false
    }
  },

  listenForMatch(queueId: string, onMatched: (roomId: string) => void): () => void {
    if (!isSupabaseConfigured()) return () => {}

    const channel = supabase
      .channel(`queue_${queueId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'matchmaking_queue',
          filter: `id=eq.${queueId}`,
        },
        (payload) => {
          const updated = payload.new as Database['public']['Tables']['matchmaking_queue']['Row']
          if (updated.status === 'matched' && updated.matched_room_id) {
            onMatched(updated.matched_room_id)
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  },
}
