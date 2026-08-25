import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

describe('Migration 43 — Static Audit of _migration_audit Schema', () => {
  const hotfixPath = path.resolve(__dirname, '../../supabase/43-ranked-ux-matchmaking-stats-hotfix.sql')
  const preflightPath = path.resolve(__dirname, '../../supabase/43-ranked-ux-matchmaking-stats-preflight.sql')
  const postcheckPath = path.resolve(__dirname, '../../supabase/43-ranked-ux-matchmaking-stats-postcheck.sql')

  const hotfixSql = fs.readFileSync(hotfixPath, 'utf-8')
  const preflightSql = fs.readFileSync(preflightPath, 'utf-8')
  const postcheckSql = fs.readFileSync(postcheckPath, 'utf-8')

  it('1. Hotfix: Realiza INSERT INTO public._migration_audit (fase, detalle, ejecutado_en) con NOW()', () => {
    expect(hotfixSql).toMatch(/INSERT\s+INTO\s+public\._migration_audit\s*\(\s*fase\s*,\s*detalle\s*,\s*ejecutado_en\s*\)/i)
    expect(hotfixSql).toContain("'43_ranked_ux_matchmaking_stats_hotfix'")
    expect(hotfixSql).toContain('NOW()')

    // No debe contener columnas incorrectas
    expect(hotfixSql).not.toContain('(fase, detalles)')
    expect(hotfixSql).not.toContain('(fase, details)')
    expect(hotfixSql).not.toContain('(fase, migration_name)')
  })

  it('2. Preflight y Postcheck: Consultan únicamente las columnas reales (fase, detalle, ejecutado_en)', () => {
    // Preflight consulta fase
    expect(preflightSql).toContain("fase = '43_ranked_ux_matchmaking_stats_hotfix'")
    expect(preflightSql).not.toContain('detalles')
    expect(preflightSql).not.toContain('details')
    expect(preflightSql).not.toContain('migration_name')
    expect(preflightSql).not.toContain('executed_at')

    // Postcheck consulta fase, detalle y ejecutado_en
    expect(postcheckSql).toContain("fase = '43_ranked_ux_matchmaking_stats_hotfix'")
    expect(postcheckSql).toContain('detalle')
    expect(postcheckSql).toContain('ejecutado_en')
    expect(postcheckSql).not.toContain('detalles')
    expect(postcheckSql).not.toContain('details')
    expect(postcheckSql).not.toContain('migration_name')
    expect(postcheckSql).not.toContain('executed_at')
  })
})
