import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

describe('Matchmaking _create_room Signature & Queue Status Hardening', () => {
  const m128Path = path.resolve(__dirname, '../../supabase/migrations/128-tournament-complete-system-settlement-and-elo-free.sql')
  const m129Path = path.resolve(__dirname, '../../supabase/migrations/129-fix-matchmaking-create-room-signature-and-queue-update.sql')

  it('Verifica que la migración 129 existe y define la sobrecarga defensiva _create_room', () => {
    expect(fs.existsSync(m129Path)).toBe(true)
    const sql129 = fs.readFileSync(m129Path, 'utf8')

    // 1. Sobrecarga para filas de queue
    expect(sql129).toContain('CREATE OR REPLACE FUNCTION public._create_room(\n  p_cand public.matchmaking_queue,\n  p_fila public.matchmaking_queue\n)')
    
    // 2. Redefinición correcta de _emparejar_lote
    expect(sql129).toContain('CREATE OR REPLACE FUNCTION public._emparejar_lote')
    expect(sql129).toContain('v_room := public._create_room(p_mode, v_cand.user_id, v_fila.user_id, p_bet);')
    expect(sql129).toContain('v_room := public._create_room(p_mode, v_fila.user_id, v_cand.user_id, p_bet);')

    // 3. Actualización de estado en matchmaking_queue
    expect(sql129).toContain("SET status = 'matched', matched_room_id = v_room")
    expect(sql129).toContain('WHERE id IN (v_fila.id, v_cand.id);')
  })

  it('Verifica que la migración 128 fue corregida y no tiene llamadas con tipos de registro incorrectos', () => {
    expect(fs.existsSync(m128Path)).toBe(true)
    const sql128 = fs.readFileSync(m128Path, 'utf8')

    // No debe contener la llamada errónea con 2 registros
    expect(sql128).not.toContain('public._create_room(v_cand, v_fila)')
    expect(sql128).not.toContain('public._create_room(v_fila, v_cand)')

    // Debe contener la llamada con 4 parámetros
    expect(sql128).toContain('v_room := public._create_room(p_mode, v_cand.user_id, v_fila.user_id, p_bet);')
    expect(sql128).toContain('v_room := public._create_room(p_mode, v_fila.user_id, v_cand.user_id, p_bet);')
  })
})
