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
          exclude_from_ranking?: boolean
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
          exclude_from_ranking?: boolean
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
          exclude_from_ranking?: boolean
          referral_code?: string | null
          referred_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      // Modelo alineado con el cliente (fase 2a): level + stat_rolls.
      // Los 4 multiplicadores (power/hp/speed/cooldown) se eliminaron de la
      // tabla: no podían representar las 5 stats del juego, porque attackSpeed
      // y moveSpeed colisionaban en speed_mult. Las stats se calculan de
      // stat_rolls + PLANT_CONFIGS.
      plant_instances: {
        Row: {
          id: string
          owner_id: string
          plant_id: string
          rarity: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary'
          star_level: number
          level: number
          stat_rolls: string[]
          is_base: boolean
          is_in_deck: boolean
          deck_slot: number | null
          is_listed_for_sale: boolean
          created_at: string
        }
        Insert: {
          id?: string
          owner_id: string
          plant_id: string
          rarity: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary'
          star_level?: number
          level?: number
          stat_rolls?: string[]
          is_base?: boolean
          is_in_deck?: boolean
          deck_slot?: number | null
          is_listed_for_sale?: boolean
          created_at?: string
        }
        Update: {
          is_in_deck?: boolean
          deck_slot?: number | null
        }
        Relationships: []
      }
      // Catálogos y tablas añadidas en la fase 2. Sólo lectura para el cliente:
      // todas las escrituras pasan por RPC.
      plant_catalog: {
        Row: {
          plant_id: string
          name: string
          rarity: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary'
          eligible_stats: string[]
          max_level: number
        }
        Insert: never
        Update: never
        Relationships: []
      }
      plant_copies: {
        Row: { user_id: string; plant_id: string; copies: number }
        Insert: never
        Update: never
        Relationships: []
      }
      player_packs: {
        Row: {
          id: string
          user_id: string
          pack_id: 'basic' | 'epic' | 'legendary'
          source: 'purchase' | 'victory' | 'chest' | 'gift' | 'admin'
          created_at: string
        }
        Insert: never
        Update: never
        Relationships: []
      }
      shop_packs: {
        Row: {
          pack_id: 'basic' | 'epic' | 'legendary'
          name: string
          price_gems: number
          card_count: number
          is_active: boolean
        }
        Insert: never
        Update: never
        Relationships: []
      }
      shop_gold_packages: {
        Row: {
          package_id: string
          name: string
          gold_amount: number
          price_gems: number
          is_active: boolean
        }
        Insert: never
        Update: never
        Relationships: []
      }
      shop_config: {
        Row: { key: string; value: number }
        Insert: never
        Update: never
        Relationships: []
      }
      // Minijuego del código secreto por rondas (migración 08).
      // OJO: la columna "secret" NO se declara aquí a propósito. Tiene el
      // SELECT revocado en la base, así que pedirla devuelve 401; dejarla fuera
      // del tipo hace que un select('*') o un acceso a .secret no compile.
      secret_code_rounds: {
        Row: {
          id: string
          round_number: number
          status: 'open' | 'finished' | 'cancelled'
          free_attempts: number
          prize_pool_gems: number
          prize_1st: number
          prize_2nd: number
          prize_3rd: number
          winner_id: string | null
          code_version?: number
          created_at: string
          finished_at: string | null
        }
        Insert: never
        Update: never
        Relationships: []
      }
      secret_code_attempts: {
        Row: {
          id: string
          round_id: string
          user_id: string
          sequence: string[]
          exact_count: number
          wrong_pos_count: number
          pct: number
          was_free: boolean
          created_at: string
        }
        Insert: never
        Update: never
        Relationships: []
      }
      secret_code_entries: {
        Row: { round_id: string; user_id: string; free_used: number; extra_attempts: number }
        Insert: never
        Update: never
        Relationships: []
      }
      secret_code_payouts: {
        Row: {
          id: string
          round_id: string
          user_id: string
          place: number
          tied_with: number
          pct: number
          gems: number
          created_at: string
        }
        Insert: never
        Update: never
        Relationships: []
      }
      battle_pass_levels: {
        Row: {
          level: number
          required_elo: number
          arena_name: string
          reward_type: 'pack' | 'copies' | 'plant' | 'badge'
          pack_id: string | null
          pack_count: number | null
          plant_id: string | null
          copies_count: number | null
          label: string
        }
        Insert: never
        Update: never
        Relationships: []
      }
      lottery_sectors: {
        Row: {
          sector_id: string
          label: string
          reward_type: 'gems' | 'gold' | 'pack' | 'plant' | 'none'
          gems_amount: number | null
          gold_amount: number | null
          pack_id: string | null
          pack_qty: number | null
          plant_id: string | null
          plant_qty: number | null
          weight: number
          is_active: boolean
        }
        Insert: never
        Update: never
        Relationships: []
      }
      colosseum_escrow: {
        Row: {
          id: string
          user_id: string
          bet_gems: number
          room_id: string | null
          status: 'held' | 'settled' | 'refunded'
          created_at: string
        }
        Insert: never
        Update: never
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
      ranked_player_stats: {
        Row: {
          user_id: string
          wins: number
          losses: number
          draws: number
          updated_at: string
        }
        Insert: {
          user_id: string
          wins?: number
          losses?: number
          draws?: number
          updated_at?: string
        }
        Update: {
          user_id?: string
          wins?: number
          losses?: number
          draws?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'ranked_player_stats_user_id_fkey'
            columns: ['user_id']
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      reward_codes: {
        Row: {
          id: string
          code: string
          normalized_code: string
          reward_type: string
          reward_value: number
          max_uses: number
          used_count: number
          active: boolean
          created_at: string
          expires_at: string | null
        }
        Insert: {
          id?: string
          code: string
          normalized_code: string
          reward_type?: string
          reward_value?: number
          max_uses?: number
          used_count?: number
          active?: boolean
          created_at?: string
          expires_at?: string | null
        }
        Update: {
          id?: string
          code?: string
          normalized_code?: string
          reward_type?: string
          reward_value?: number
          max_uses?: number
          used_count?: number
          active?: boolean
          created_at?: string
          expires_at?: string | null
        }
        Relationships: []
      }
      reward_code_claims: {
        Row: {
          id: string
          reward_code_id: string
          user_id: string
          claimed_at: string
          generated_pack_slot_id: number
        }
        Insert: {
          id?: string
          reward_code_id: string
          user_id: string
          claimed_at?: string
          generated_pack_slot_id: number
        }
        Update: {
          id?: string
          reward_code_id?: string
          user_id?: string
          claimed_at?: string
          generated_pack_slot_id?: number
        }
        Relationships: [
          {
            foreignKeyName: 'reward_code_claims_reward_code_id_fkey'
            columns: ['reward_code_id']
            referencedRelation: 'reward_codes'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'reward_code_claims_user_id_fkey'
            columns: ['user_id']
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      player_reward_packs: {
        Row: {
          id: string
          user_id: string
          reward_code_id: string | null
          source: string
          status: 'pending' | 'unlocking' | 'ready' | 'opened'
          duration_hours: number | null
          arena_level: number
          unlock_started_at: string | null
          created_at: string
          opened_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          reward_code_id?: string | null
          source?: string
          status?: 'pending' | 'unlocking' | 'ready' | 'opened'
          duration_hours?: number | null
          arena_level?: number
          unlock_started_at?: string | null
          created_at?: string
          opened_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          reward_code_id?: string | null
          source?: string
          status?: 'pending' | 'unlocking' | 'ready' | 'opened'
          duration_hours?: number | null
          arena_level?: number
          unlock_started_at?: string | null
          created_at?: string
          opened_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'player_reward_packs_user_id_fkey'
            columns: ['user_id']
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
    }
    Views: {
      /**
       * La clasificación, ya filtrada por el servidor y con orden determinista.
       * Incluye estadísticas W/L de partidas Ranked verificadas.
       */
      leaderboard: {
        Row: {
          id: string
          username: string
          avatar_id: string
          country: string
          elo_rating: number
          ranked_wins: number
          ranked_losses: number
          ranked_draws: number
          ranked_games: number
          ranked_win_rate: number
          rank_position: number
          colosseum_current_streak: number
          colosseum_max_streak: number
          created_at: string
        }
        Relationships: []
      }
    }
    Functions: {
      claim_reward_code: {
        Args: {
          p_code: string
        }
        Returns: Json
      }
      start_unlock_reward_pack: {
        Args: {
          p_pack_id: string
        }
        Returns: Json
      }
      instant_unlock_reward_pack: {
        Args: {
          p_pack_id: string
        }
        Returns: Json
      }
      claim_reward_pack: {
        Args: {
          p_pack_id: string
        }
        Returns: Json
      }
      get_my_reward_packs: {
        Args: Record<PropertyKey, never>
        Returns: Json
      }
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
