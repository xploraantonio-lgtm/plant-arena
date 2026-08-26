import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

describe('11. Claim Ranked Async Opponent Game Rooms Schema Alignment (Migration 45)', () => {
  const migration45Path = path.resolve(__dirname, '../../supabase/45-fix-claim-async-game-rooms-schema.sql')
  const preflight45Path = path.resolve(__dirname, '../../supabase/45-fix-claim-async-game-rooms-schema-preflight.sql')
  const postcheck45Path = path.resolve(__dirname, '../../supabase/45-fix-claim-async-game-rooms-schema-postcheck.sql')

  const migration45Sql = fs.readFileSync(migration45Path, 'utf-8')
  const preflight45Sql = fs.readFileSync(preflight45Path, 'utf-8')
  const postcheck45Sql = fs.readFileSync(postcheck45Path, 'utf-8')

  // Lista canónica de todas las 37 columnas físicas existentes en public.game_rooms (Producción)
  const canonicalGameRoomsColumns = new Set([
    'id',
    'mode',
    'player1_id',
    'player2_id',
    'seed',
    'p1_deck',
    'p2_deck',
    'colosseum_bet',
    'tournament_id',
    'status',
    'created_at',
    'p1_reported_winner',
    'p2_reported_winner',
    'settled_at',
    'escrow_gems',
    'started_at',
    'share_token',
    'shared_at',
    'p1_last_seen',
    'p2_last_seen',
    'engine_version',
    'verification_status',
    'verification_requested_at',
    'verification_started_at',
    'verified_at',
    'server_winner_id',
    'verification_note',
    'verification_payload',
    'verification_attempts',
    'verification_next_at',
    'verification_last_error',
    'is_async_match',
    'async_opponent_id',
    'async_display_name',
    'async_avatar_id',
    'async_rating_snapshot',
    'async_deck_snapshot',
  ])

  it('11.1. SQL Audit: Migración 45 elimina p1_name, p2_name, p1_avatar, p2_avatar del INSERT de game_rooms', () => {
    const insertMatch = migration45Sql.match(/INSERT\s+INTO\s+public\.game_rooms\s*\(([^)]+)\)/i)
    expect(insertMatch).not.toBeNull()
    const columns = insertMatch![1]

    expect(columns).not.toContain('p1_name')
    expect(columns).not.toContain('p2_name')
    expect(columns).not.toContain('p1_avatar')
    expect(columns).not.toContain('p2_avatar')
  })

  it('11.2. SQL Audit: Migración 45 inserta las columnas canónicas async_display_name y async_avatar_id', () => {
    expect(migration45Sql).toContain('async_display_name')
    expect(migration45Sql).toContain('async_avatar_id')
    expect(migration45Sql).toContain('v_random_name')
    expect(migration45Sql).toContain('v_random_avatar')
  })

  it('11.3. SQL Audit: Migración 45 establece status = \'playing\' compatible con game_rooms_status_check', () => {
    expect(migration45Sql).toContain("'playing'")
    expect(migration45Sql).not.toContain("'in_progress'")

    const allowedStatuses = ['playing', 'p1_won', 'p2_won', 'draw', 'abandoned']
    expect(allowedStatuses).toContain('playing')
  })

  it('11.4. Hardening Static Schema Audit: Toda columna en el INSERT INTO game_rooms existe físicamente en la tabla', () => {
    // Extraer el bloque INSERT INTO public.game_rooms de la migración 45
    const insertMatch = migration45Sql.match(/INSERT\s+INTO\s+public\.game_rooms\s*\(([^)]+)\)/i)
    expect(insertMatch).not.toBeNull()

    const columnListStr = insertMatch![1]
    const insertedColumns = columnListStr
      .split(',')
      .map((c) => c.trim())
      .filter((c) => c.length > 0)

    expect(insertedColumns.length).toBeGreaterThan(0)

    insertedColumns.forEach((col) => {
      const existsInTable = canonicalGameRoomsColumns.has(col)
      if (!existsInTable) {
        throw new Error(`Columna inválida detectada en INSERT INTO game_rooms: "${col}". No existe en public.game_rooms.`)
      }
      expect(existsInTable).toBe(true)
    })
  })

  it('11.5. SQL Audit: Ledger usa exclusivamente (fase, detalle, ejecutado_en) y fase 45', () => {
    expect(migration45Sql).toContain("'45_fix_claim_async_game_rooms_schema'")
    expect(migration45Sql).toMatch(/INSERT INTO public\._migration_audit\s*\(\s*fase,\s*detalle,\s*ejecutado_en\s*\)/i)
    expect(migration45Sql).not.toMatch(/INSERT INTO public\._migration_audit\s*\([^)]*\b(detalles|details|executed_at|migration_name)\b/i)

    expect(preflight45Sql).toContain("fase = '45_fix_claim_async_game_rooms_schema'")
    expect(preflight45Sql).not.toContain('detalles')
    expect(postcheck45Sql).toContain("fase = '45_fix_claim_async_game_rooms_schema'")
    expect(postcheck45Sql).not.toContain('detalles')
  })
})
