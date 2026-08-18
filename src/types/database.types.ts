export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          username: string
          avatar_id: string
          country: string
          elo_rating: number
          gems_balance: number
          gold_balance: number
          colosseum_tickets: number
          colosseum_current_streak: number
          colosseum_max_streak: number
          has_vip_pass: boolean
          claimed_vip_levels: number[]
          is_admin: boolean
          referral_code: string | null
          referred_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          username: string
          avatar_id?: string
          country?: string
          elo_rating?: number
          gems_balance?: number
          gold_balance?: number
          colosseum_tickets?: number
          colosseum_current_streak?: number
          colosseum_max_streak?: number
          has_vip_pass?: boolean
          claimed_vip_levels?: number[]
          is_admin?: boolean
          referral_code?: string | null
          referred_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          username?: string
          avatar_id?: string
          country?: string
          elo_rating?: number
          gems_balance?: number
          gold_balance?: number
          colosseum_tickets?: number
          colosseum_current_streak?: number
          colosseum_max_streak?: number
          has_vip_pass?: boolean
          claimed_vip_levels?: number[]
          is_admin?: boolean
          referral_code?: string | null
          referred_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      plant_instances: {
        Row: {
          id: string
          owner_id: string
          plant_id: string
          rarity: 'common' | 'rare' | 'epic' | 'legendary'
          star_level: number
          power_mult: number
          hp_mult: number
          speed_mult: number
          cooldown_mult: number
          is_in_deck: boolean
          deck_slot: number | null
          is_listed_for_sale: boolean
          created_at: string
        }
        Insert: {
          id?: string
          owner_id: string
          plant_id: string
          rarity: 'common' | 'rare' | 'epic' | 'legendary'
          star_level?: number
          power_mult?: number
          hp_mult?: number
          speed_mult?: number
          cooldown_mult?: number
          is_in_deck?: boolean
          deck_slot?: number | null
          is_listed_for_sale?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          owner_id?: string
          plant_id?: string
          rarity?: 'common' | 'rare' | 'epic' | 'legendary'
          star_level?: number
          power_mult?: number
          hp_mult?: number
          speed_mult?: number
          cooldown_mult?: number
          is_in_deck?: boolean
          deck_slot?: number | null
          is_listed_for_sale?: boolean
          created_at?: string
        }
        Relationships: []
      }
      pack_slots: {
        Row: {
          id: string
          user_id: string
          slot_index: number
          status: 'empty' | 'locked' | 'unlocking' | 'ready'
          duration_hours: number
          arena_level: number
          unlock_started_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          slot_index: number
          status: 'empty' | 'locked' | 'unlocking' | 'ready'
          duration_hours?: number
          arena_level?: number
          unlock_started_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          slot_index?: number
          status?: 'empty' | 'locked' | 'unlocking' | 'ready'
          duration_hours?: number
          arena_level?: number
          unlock_started_at?: string | null
        }
        Relationships: []
      }
      clans: {
        Row: {
          id: string
          name: string
          tag: string
          emblem_id: string
          description: string | null
          min_elo: number
          is_public: boolean
          leader_id: string | null
          vault_gems: number
          base_hp: number
          max_base_hp: number
          shield_until: string | null
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          tag: string
          emblem_id?: string
          description?: string | null
          min_elo?: number
          is_public?: boolean
          leader_id?: string | null
          vault_gems?: number
          base_hp?: number
          max_base_hp?: number
          shield_until?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          tag?: string
          emblem_id?: string
          description?: string | null
          min_elo?: number
          is_public?: boolean
          leader_id?: string | null
          vault_gems?: number
          base_hp?: number
          max_base_hp?: number
          shield_until?: string | null
          created_at?: string
        }
        Relationships: []
      }
      clan_members: {
        Row: {
          clan_id: string
          user_id: string
          role: 'leader' | 'elder' | 'member'
          joined_at: string
        }
        Insert: {
          clan_id: string
          user_id: string
          role: 'leader' | 'elder' | 'member'
          joined_at?: string
        }
        Update: {
          clan_id?: string
          user_id?: string
          role?: 'leader' | 'elder' | 'member'
          joined_at?: string
        }
        Relationships: []
      }
      marketplace_listings: {
        Row: {
          id: string
          seller_id: string
          plant_instance_id: string
          price_gems: number
          status: 'active' | 'sold' | 'cancelled'
          buyer_id: string | null
          created_at: string
          closed_at: string | null
        }
        Insert: {
          id?: string
          seller_id: string
          plant_instance_id: string
          price_gems: number
          status?: 'active' | 'sold' | 'cancelled'
          buyer_id?: string | null
          created_at?: string
          closed_at?: string | null
        }
        Update: {
          id?: string
          seller_id?: string
          plant_instance_id?: string
          price_gems?: number
          status?: 'active' | 'sold' | 'cancelled'
          buyer_id?: string | null
          created_at?: string
          closed_at?: string | null
        }
        Relationships: []
      }
      tournaments: {
        Row: {
          id: string
          title: string
          type: 'free_code' | 'paid'
          access_code: string | null
          entry_cost_gems: number
          duration_minutes: number
          starts_at: string
          ends_at: string
          status: 'scheduled' | 'live' | 'finished'
          created_at: string
        }
        Insert: {
          id?: string
          title: string
          type: 'free_code' | 'paid'
          access_code?: string | null
          entry_cost_gems?: number
          duration_minutes?: number
          starts_at: string
          ends_at: string
          status?: 'scheduled' | 'live' | 'finished'
          created_at?: string
        }
        Update: {
          id?: string
          title?: string
          type?: 'free_code' | 'paid'
          access_code?: string | null
          entry_cost_gems?: number
          duration_minutes?: number
          starts_at?: string
          ends_at?: string
          status?: 'scheduled' | 'live' | 'finished'
          created_at?: string
        }
        Relationships: []
      }
      tournament_participants: {
        Row: {
          tournament_id: string
          user_id: string
          wins: number
          losses: number
          max_losses: number
          is_eliminated: boolean
          final_rank: number | null
          created_at: string
        }
        Insert: {
          tournament_id: string
          user_id: string
          wins?: number
          losses?: number
          max_losses?: number
          is_eliminated?: boolean
          final_rank?: number | null
          created_at?: string
        }
        Update: {
          tournament_id?: string
          user_id?: string
          wins?: number
          losses?: number
          max_losses?: number
          is_eliminated?: boolean
          final_rank?: number | null
          created_at?: string
        }
        Relationships: []
      }
      matchmaking_queue: {
        Row: {
          id: string
          user_id: string
          mode: 'ranked' | 'friendly' | 'colosseum' | 'tournament'
          tournament_id: string | null
          colosseum_bet: number | null
          user_elo: number
          room_code: string | null
          status: 'searching' | 'matched' | 'cancelled'
          matched_room_id: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          mode: 'ranked' | 'friendly' | 'colosseum' | 'tournament'
          tournament_id?: string | null
          colosseum_bet?: number | null
          user_elo: number
          room_code?: string | null
          status?: 'searching' | 'matched' | 'cancelled'
          matched_room_id?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          mode?: 'ranked' | 'friendly' | 'colosseum' | 'tournament'
          tournament_id?: string | null
          colosseum_bet?: number | null
          user_elo?: number
          room_code?: string | null
          status?: 'searching' | 'matched' | 'cancelled'
          matched_room_id?: string | null
          created_at?: string
        }
        Relationships: []
      }
      game_rooms: {
        Row: {
          id: string
          mode: string
          player1_id: string
          player2_id: string
          seed: number
          p1_deck: Json
          p2_deck: Json
          colosseum_bet: number
          tournament_id: string | null
          status: 'playing' | 'p1_won' | 'p2_won' | 'draw' | 'abandoned'
          created_at: string
        }
        Insert: {
          id?: string
          mode: string
          player1_id: string
          player2_id: string
          seed: number
          p1_deck: Json
          p2_deck: Json
          colosseum_bet?: number
          tournament_id?: string | null
          status?: 'playing' | 'p1_won' | 'p2_won' | 'draw' | 'abandoned'
          created_at?: string
        }
        Update: {
          id?: string
          mode?: string
          player1_id?: string
          player2_id?: string
          seed?: number
          p1_deck?: Json
          p2_deck?: Json
          colosseum_bet?: number
          tournament_id?: string | null
          status?: 'playing' | 'p1_won' | 'p2_won' | 'draw' | 'abandoned'
          created_at?: string
        }
        Relationships: []
      }
      seasons: {
        Row: {
          id: string
          season_number: number
          name: string
          starts_at: string
          ends_at: string
          status: 'upcoming' | 'active' | 'finished'
          top1_elo_reward: number
          top2_elo_reward: number
          top3_elo_reward: number
          top1_colosseum_reward: number
          top2_colosseum_reward: number
          top3_colosseum_reward: number
          is_current: boolean
          created_at: string
        }
        Insert: {
          id?: string
          season_number: number
          name: string
          starts_at: string
          ends_at: string
          status?: 'upcoming' | 'active' | 'finished'
          top1_elo_reward?: number
          top2_elo_reward?: number
          top3_elo_reward?: number
          top1_colosseum_reward?: number
          top2_colosseum_reward?: number
          top3_colosseum_reward?: number
          is_current?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          season_number?: number
          name?: string
          starts_at?: string
          ends_at?: string
          status?: 'upcoming' | 'active' | 'finished'
          top1_elo_reward?: number
          top2_elo_reward?: number
          top3_elo_reward?: number
          top1_colosseum_reward?: number
          top2_colosseum_reward?: number
          top3_colosseum_reward?: number
          is_current?: boolean
          created_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      resolve_colosseum_match: {
        Args: {
          p_room_id: string
          p_winner_id: string
        }
        Returns: Json
      }
      buy_marketplace_card: {
        Args: {
          p_listing_id: string
          p_buyer_id: string
        }
        Returns: Json
      }
      deposit_to_clan_vault: {
        Args: {
          p_clan_id: string
          p_user_id: string
          p_amount: number
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}
