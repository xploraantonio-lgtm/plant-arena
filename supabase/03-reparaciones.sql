-- =============================================================================
-- PLANT ARENA · FASE 1c: REPARACIONES
--
-- 1. Alinear los DEFAULT de profiles con lo que realmente aplica el trigger.
-- 2. Devolver los cofres a funcionar, pero con el temporizador validado por el
--    servidor (la fase 1 los dejó en sólo lectura porque el jugador podía
--    ponerlos en 'ready' al instante).
--
-- Idempotente.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. UNA SOLA FUENTE DE VERDAD PARA LOS SALDOS INICIALES
--
-- La tabla decía 10 gemas / 50.000 oro / 2 tickets; el trigger aplica 0/0/0.
-- Confirmado que manda el trigger, así que los DEFAULT se alinean. Si no, el
-- día que algo inserte un perfil sin nombrar esas columnas, el jugador
-- aparecería con 10 gemas de regalo y nadie sabría por qué.
-- -----------------------------------------------------------------------------
ALTER TABLE public.profiles
  ALTER COLUMN gems_balance      SET DEFAULT 0.00,
  ALTER COLUMN gold_balance      SET DEFAULT 0,
  ALTER COLUMN colosseum_tickets SET DEFAULT 0;


-- -----------------------------------------------------------------------------
-- 2. COFRES CON TEMPORIZADOR DE SERVIDOR
--
-- Sustituye al upsert directo de saveUserPackSlots. Acepta la misma forma de
-- datos que ya envía el cliente, pero:
--
--   · duration_hours se IMPONE desde el índice (0→2h, 1→4h, 2→8h, 3→12h).
--     Antes el cliente podía mandar 0 y el cofre estaba listo al momento.
--   · unlock_started_at lo estampa el servidor con NOW(). El reloj del
--     jugador deja de contar.
--   · pasar a 'ready' exige que el tiempo haya transcurrido de verdad.
--     Si no, se conserva el estado que había y se informa del rechazo.
--
-- Devuelve los slots autoritativos para que el cliente adopte lo que diga el
-- servidor, no al contrario.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_pack_slots(p_slots JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid        UUID := auth.uid();
  v_in         JSONB;
  v_idx        INTEGER;
  v_dur        INTEGER;
  v_arena      INTEGER;
  v_want       TEXT;
  v_final      TEXT;
  v_started    TIMESTAMPTZ;
  v_prev       RECORD;
  v_rechazados JSONB := '[]'::JSONB;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF p_slots IS NULL OR jsonb_typeof(p_slots) <> 'array' THEN
    RAISE EXCEPTION 'Se esperaba un array de slots';
  END IF;
  IF jsonb_array_length(p_slots) > 4 THEN
    RAISE EXCEPTION 'Máximo 4 cofres';
  END IF;

  FOR v_in IN SELECT * FROM jsonb_array_elements(p_slots)
  LOOP
    v_idx := COALESCE((v_in->>'slotId')::INTEGER, (v_in->>'slot_index')::INTEGER);
    IF v_idx IS NULL OR v_idx < 0 OR v_idx > 3 THEN
      RAISE EXCEPTION 'Índice de cofre inválido: %', COALESCE(v_idx::TEXT, 'null');
    END IF;

    -- La duración la fija el índice, no el cliente.
    v_dur := CASE v_idx WHEN 0 THEN 2 WHEN 1 THEN 4 WHEN 2 THEN 8 ELSE 12 END;

    v_arena := COALESCE((v_in->>'arenaLevel')::INTEGER, (v_in->>'arena_level')::INTEGER, 1);
    v_arena := GREATEST(1, LEAST(5, v_arena));

    v_want := COALESCE(v_in->>'status', 'empty');
    IF v_want NOT IN ('empty', 'locked', 'unlocking', 'ready') THEN
      RAISE EXCEPTION 'Estado de cofre inválido: %', v_want;
    END IF;

    SELECT status, unlock_started_at, duration_hours
      INTO v_prev
      FROM public.pack_slots
     WHERE user_id = v_uid AND slot_index = v_idx
     FOR UPDATE;

    v_final   := v_want;
    v_started := NULL;

    IF v_want = 'unlocking' THEN
      IF v_prev.status = 'unlocking' AND v_prev.unlock_started_at IS NOT NULL THEN
        -- Ya estaba corriendo: se respeta el arranque original.
        v_started := v_prev.unlock_started_at;
      ELSE
        v_started := NOW();
      END IF;

    ELSIF v_want = 'ready' THEN
      IF v_prev.status = 'ready' THEN
        v_final := 'ready';                       -- ya estaba ganado
      ELSIF v_prev.status = 'unlocking'
            AND v_prev.unlock_started_at IS NOT NULL
            AND NOW() >= v_prev.unlock_started_at
                         + make_interval(hours => COALESCE(v_prev.duration_hours, v_dur))
      THEN
        v_final := 'ready';                       -- el tiempo pasó de verdad
      ELSE
        -- Intento de abrir antes de hora: se mantiene lo que había.
        v_final   := COALESCE(v_prev.status, 'empty');
        v_started := v_prev.unlock_started_at;
        v_rechazados := v_rechazados || jsonb_build_object(
          'slotId', v_idx,
          'motivo', 'todavia_no_esta_listo',
          'estado_real', v_final
        );
      END IF;
    END IF;

    INSERT INTO public.pack_slots
      (user_id, slot_index, status, duration_hours, arena_level, unlock_started_at)
    VALUES
      (v_uid, v_idx, v_final, v_dur, v_arena, v_started)
    ON CONFLICT (user_id, slot_index) DO UPDATE
      SET status            = EXCLUDED.status,
          duration_hours    = EXCLUDED.duration_hours,
          arena_level       = EXCLUDED.arena_level,
          unlock_started_at = EXCLUDED.unlock_started_at;
  END LOOP;

  RETURN jsonb_build_object(
    'success',    TRUE,
    'rechazados', v_rechazados,
    'slots', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'slotId',          slot_index,
               'status',          status,
               'durationHours',   duration_hours,
               'arenaLevel',      arena_level,
               'unlockStartedAt', CASE WHEN unlock_started_at IS NULL THEN NULL
                                       ELSE (EXTRACT(EPOCH FROM unlock_started_at) * 1000)::BIGINT
                                  END
             ) ORDER BY slot_index)
        FROM public.pack_slots WHERE user_id = v_uid
    ), '[]'::JSONB)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.sync_pack_slots(JSONB) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.sync_pack_slots(JSONB) TO authenticated;

-- El índice único que necesita el ON CONFLICT de arriba.
CREATE UNIQUE INDEX IF NOT EXISTS idx_pack_slots_user_slot
  ON public.pack_slots (user_id, slot_index);

COMMIT;


-- =============================================================================
-- COMPROBACIONES
-- =============================================================================

-- 1. DEFAULT alineados. Espera 0.00 / 0 / 0.
SELECT column_name, column_default
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'profiles'
   AND column_name IN ('gems_balance', 'gold_balance', 'colosseum_tickets');

-- 2. Ninguna función SECURITY DEFINER sin auth.uid() ni ejecutable por anon.
--    Espera 0 filas.
SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_ejecuta,
       (pg_get_functiondef(p.oid) ILIKE '%auth.uid()%')  AS usa_auth_uid
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.prosecdef
   AND p.proname <> 'handle_new_user'
   AND (has_function_privilege('anon', p.oid, 'EXECUTE')
        OR pg_get_functiondef(p.oid) NOT ILIKE '%auth.uid()%');

-- 3. Ninguna tabla debe dejar escribir a anon. Espera 0 filas.
SELECT table_name, privilege_type
  FROM information_schema.role_table_grants
 WHERE table_schema = 'public' AND grantee = 'anon'
   AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE');
