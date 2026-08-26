import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

describe('12. Claim Ranked Async Opponent Matchmaking Queue Schema Alignment (Migration 46)', () => {
  const migration46Path = path.resolve(__dirname, '../../supabase/46-fix-matchmaking-queue-schema.sql')
  const preflight46Path = path.resolve(__dirname, '../../supabase/46-fix-matchmaking-queue-schema-preflight.sql')
  const postcheck46Path = path.resolve(__dirname, '../../supabase/46-fix-matchmaking-queue-schema-postcheck.sql')

  const migration46Sql = fs.readFileSync(migration46Path, 'utf-8')
  const preflight46Sql = fs.readFileSync(preflight46Path, 'utf-8')
  const postcheck46Sql = fs.readFileSync(postcheck46Path, 'utf-8')

  // Lista canónica de todas las 13 columnas físicas existentes en public.matchmaking_queue (Producción)
  const canonicalMatchmakingQueueColumns = new Set([
    'id',
    'user_id',
    'mode',
    'tournament_id',
    'colosseum_bet',
    'user_elo',
    'room_code',
    'status',
    'matched_room_id',
    'created_at',
    'last_seen_at',
    'escrow_id',
    'client_engine_version',
  ])

  it('12.1. Hardening Static Schema: matched_room_id existe y matched_at no existe en matchmaking_queue', () => {
    expect(canonicalMatchmakingQueueColumns.has('matched_room_id')).toBe(true)
    expect(canonicalMatchmakingQueueColumns.has('status')).toBe(true)
    expect(canonicalMatchmakingQueueColumns.has('matched_at')).toBe(false)
  })

  it('12.2. SQL Audit: Migración 46 elimina matched_at del UPDATE public.matchmaking_queue', () => {
    const updateMatch = migration46Sql.match(/UPDATE\s+public\.matchmaking_queue\s+SET\s+([^;]+)\s+WHERE/i)
    expect(updateMatch).not.toBeNull()

    const updateBody = updateMatch![1]
    expect(updateBody).not.toContain('matched_at')
    expect(updateBody).toContain("status = 'matched'")
    expect(updateBody).toContain('matched_room_id = v_new_room_id')
  })

  it('12.3. SQL Audit: Toda columna en el UPDATE matchmaking_queue existe físicamente en la tabla', () => {
    const updateMatch = migration46Sql.match(/UPDATE\s+public\.matchmaking_queue\s+SET\s+([^;]+)\s+WHERE/i)
    expect(updateMatch).not.toBeNull()

    const updateBody = updateMatch![1]
    const updatedAssignments = updateBody.split(',').map((s) => s.trim())

    updatedAssignments.forEach((assignment) => {
      const colName = assignment.split('=')[0].trim()
      const existsInTable = canonicalMatchmakingQueueColumns.has(colName)
      if (!existsInTable) {
        throw new Error(`Columna inválida detectada en UPDATE matchmaking_queue: "${colName}". No existe en public.matchmaking_queue.`)
      }
      expect(existsInTable).toBe(true)
    })
  })

  it('12.4. SQL Audit: Migración 46 conserva las correcciones previas de game_rooms (async_display_name, async_avatar_id, status playing)', () => {
    expect(migration46Sql).toContain('async_display_name')
    expect(migration46Sql).toContain('async_avatar_id')
    expect(migration46Sql).toContain("'playing'")
    expect(migration46Sql).not.toContain("'in_progress'")

    const insertMatch = migration46Sql.match(/INSERT\s+INTO\s+public\.game_rooms\s*\(([^)]+)\)/i)
    expect(insertMatch).not.toBeNull()
    const columns = insertMatch![1]
    expect(columns).not.toContain('p1_name')
    expect(columns).not.toContain('p2_name')
    expect(columns).not.toContain('p1_avatar')
    expect(columns).not.toContain('p2_avatar')
  })

  it('12.5. SQL Audit: Ledger usa exclusivamente (fase, detalle, ejecutado_en) y fase 46', () => {
    expect(migration46Sql).toContain("'46_fix_matchmaking_queue_schema'")
    expect(migration46Sql).toMatch(/INSERT INTO public\._migration_audit\s*\(\s*fase,\s*detalle,\s*ejecutado_en\s*\)/i)
    expect(migration46Sql).not.toMatch(/INSERT INTO public\._migration_audit\s*\([^)]*\b(detalles|details|executed_at|migration_name)\b/i)

    expect(preflight46Sql).toContain("fase = '46_fix_matchmaking_queue_schema'")
    expect(preflight46Sql).not.toContain('detalles')
    expect(postcheck46Sql).toContain("fase = '46_fix_matchmaking_queue_schema'")
    expect(postcheck46Sql).not.toContain('detalles')
  })
})
