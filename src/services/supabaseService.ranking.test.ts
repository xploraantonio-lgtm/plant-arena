import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SupabaseService } from './supabaseService'
import * as supabaseClientModule from '../lib/supabaseClient'

describe('SupabaseService Ranking & Match Clock Hardening', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('getUserRank con error de backend lanza excepción (PROHIBIDO devolver #1)', async () => {
    vi.spyOn(supabaseClientModule, 'isSupabaseConfigured').mockReturnValue(true)
    vi.spyOn(supabaseClientModule.supabase, 'from').mockReturnValue({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: null,
            error: { message: 'Database connection timeout', code: '57P01' },
          }),
        }),
      }),
    } as any)

    await expect(SupabaseService.getUserRank('user-123')).rejects.toThrowError(
      /Database connection timeout/i
    )
  })

  it('getUserRank para usuario excluido o sin fila devuelve null (NO #1)', async () => {
    vi.spyOn(supabaseClientModule, 'isSupabaseConfigured').mockReturnValue(true)
    vi.spyOn(supabaseClientModule.supabase, 'from').mockReturnValue({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: null,
            error: null,
          }),
        }),
      }),
    } as any)

    const rank = await SupabaseService.getUserRank('excluded-user')
    expect(rank).toBeNull()
  })

  it('getUserRank lanza error si Supabase no está configurado (fail-closed, NO #1)', async () => {
    vi.spyOn(supabaseClientModule, 'isSupabaseConfigured').mockReturnValue(false)

    await expect(SupabaseService.getUserRank('any-user')).rejects.toThrowError(
      /Supabase no está configurado/i
    )
  })

  it('getGlobalLeaderboard con error de backend lanza excepción (distingue ERROR de lista vacía)', async () => {
    vi.spyOn(supabaseClientModule, 'isSupabaseConfigured').mockReturnValue(true)
    vi.spyOn(supabaseClientModule.supabase, 'from').mockReturnValue({
      select: () => ({
        order: () => ({
          limit: async () => ({
            data: null,
            error: { message: 'Network error fetching leaderboard', code: 'PGRST' },
          }),
        }),
      }),
    } as any)

    await expect(SupabaseService.getGlobalLeaderboard(50)).rejects.toThrowError(
      /Network error fetching leaderboard/i
    )
  })

  it('getGlobalLeaderboard con 0 filas reales devuelve [] (EMPTY REAL)', async () => {
    vi.spyOn(supabaseClientModule, 'isSupabaseConfigured').mockReturnValue(true)
    vi.spyOn(supabaseClientModule.supabase, 'from').mockReturnValue({
      select: () => ({
        order: async () => ({
          data: [],
          error: null,
        }),
      }),
    } as any)

    const rows = await SupabaseService.getGlobalLeaderboard()
    expect(rows).toEqual([])
  })

  it('startMatchClock lanza error si falla la RPC (fail-closed, NO devuelve null silencioso)', async () => {
    vi.spyOn(supabaseClientModule, 'isSupabaseConfigured').mockReturnValue(true)
    vi.spyOn(supabaseClientModule.supabase, 'rpc').mockResolvedValue({
      data: null,
      error: { message: 'RPC start_match_clock failed' } as any,
    } as any)

    await expect(SupabaseService.startMatchClock('room-123')).rejects.toThrowError(
      /RPC start_match_clock failed/i
    )
  })

  it('startMatchClock lanza error si Supabase no está configurado', async () => {
    vi.spyOn(supabaseClientModule, 'isSupabaseConfigured').mockReturnValue(false)

    await expect(SupabaseService.startMatchClock('room-123')).rejects.toThrowError(
      /Supabase no está configurado/i
    )
  })

  it('enterMatchmaking envía p_engine_version="auth-v2" al RPC', async () => {
    vi.spyOn(supabaseClientModule, 'isSupabaseConfigured').mockReturnValue(true)
    const rpcSpy = vi.spyOn(supabaseClientModule.supabase, 'rpc').mockResolvedValue({
      data: { matched: false, searching: true },
      error: null,
    } as any)

    const res = await SupabaseService.enterMatchmaking('ranked')
    expect(rpcSpy).toHaveBeenCalledWith('enter_matchmaking', {
      p_mode: 'ranked',
      p_bet: 0,
      p_use_ticket: false,
      p_room_code: null,
      p_engine_version: 'auth-v2',
    })
    expect(res).toEqual({ matched: false, searching: true })
  })

  it('enterMatchmaking propaga client_update_required si el servidor rechaza versión vieja', async () => {
    vi.spyOn(supabaseClientModule, 'isSupabaseConfigured').mockReturnValue(true)
    vi.spyOn(supabaseClientModule.supabase, 'rpc').mockResolvedValue({
      data: {
        matched: false,
        searching: false,
        error: 'client_update_required',
        message: 'Se requiere actualizar el juego a la versión actual para jugar partidas Ranked.',
      },
      error: null,
    } as any)

    const res = await SupabaseService.enterMatchmaking('ranked')
    expect(res.matched).toBe(false)
    expect(res.error).toBe('client_update_required')
  })
})
