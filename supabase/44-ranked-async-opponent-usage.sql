-- =============================================================================
-- MIGRACIÓN 44: COMPLETAR METADATA DE USO DE RIVALES SEMILLA
-- =============================================================================
-- PROPÓSITO:
-- 1. Añadir columnas usage_count (BIGINT NOT NULL DEFAULT 0) y last_used_at
--    (TIMESTAMPTZ) a la tabla public.ranked_async_opponents.
-- 2. Añadir restricción CHECK (usage_count >= 0).
-- 3. Registrar la ejecución en _migration_audit bajo la fase
--    '44_ranked_async_opponent_usage_metadata'.
--
-- INVARIANTES:
-- - Semillas históricas conservan sus snapshots íntegros e inicializan usage_count = 0.
-- - No altera ELO, W/L, sobres, perfiles ni partidas activas.
-- =============================================================================

BEGIN;

-- ── 1. AÑADIR COLUMNAS DE METADATA DE USO EN RANKED_ASYNC_OPPONENTS ──────────
ALTER TABLE public.ranked_async_opponents
  ADD COLUMN IF NOT EXISTS usage_count BIGINT NOT NULL DEFAULT 0;

ALTER TABLE public.ranked_async_opponents
  ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ;

-- ── 2. RESTRICCIÓN DE INTEGRIDAD CHECK (USAGE_COUNT >= 0) ────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_ranked_async_opponents_usage_count'
  ) THEN
    ALTER TABLE public.ranked_async_opponents
      ADD CONSTRAINT chk_ranked_async_opponents_usage_count
      CHECK (usage_count >= 0);
  END IF;
END $$;

-- ── 3. REGISTRO EN EL LEDGER DE AUDITORÍA ────────────────────────────────────
INSERT INTO public._migration_audit (
  fase,
  detalle,
  ejecutado_en
) VALUES (
  '44_ranked_async_opponent_usage_metadata',
  jsonb_build_object(
    'descripcion', 'Completar metadata de uso en ranked_async_opponents (usage_count BIGINT NOT NULL DEFAULT 0, last_used_at TIMESTAMPTZ, CHECK usage_count >= 0)',
    'columnas_añadidas', jsonb_build_array('usage_count', 'last_used_at'),
    'constraints_añadidas', jsonb_build_array('chk_ranked_async_opponents_usage_count')
  ),
  NOW()
);

COMMIT;
