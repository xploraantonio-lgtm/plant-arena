-- =============================================================================
-- PLANTS ARENA — MIGRACIÓN 34
-- Cola de verificación + exclusión de workers + recuperación fail-closed
--
-- REQUIERE: 33-arbitro-autoritativo.sql
--
-- OBJETIVOS
--   1) Ninguna sala auth-v1 queda olvidada si los dos clientes desaparecen.
--   2) Dos verificadores no liquidan la misma sala a la vez.
--   3) Un worker caído después de congelar una sala NO libera escrow ni inventa
--      ganador: la sala queda en revisión (fail closed).
--   4) Los reintentos tienen backoff y son observables.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. TELEMETRÍA / BACKOFF DEL WORKER
-- -----------------------------------------------------------------------------
ALTER TABLE public.game_rooms
  ADD COLUMN IF NOT EXISTS verification_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS verification_next_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verification_last_error TEXT;

ALTER TABLE public.game_rooms DROP CONSTRAINT IF EXISTS game_rooms_verification_attempts_check;
ALTER TABLE public.game_rooms
  ADD CONSTRAINT game_rooms_verification_attempts_check
  CHECK (verification_attempts >= 0);

CREATE INDEX IF NOT EXISTS idx_game_rooms_auth_v1_worker_queue
  ON public.game_rooms (
    verification_status,
    verification_next_at,
    verification_requested_at
  )
  WHERE engine_version = 'auth-v1'
    AND settled_at IS NULL;

-- El barrido de la 33 estaba revocado para todos los clientes. El worker
-- server-side sí necesita poder llamarlo.
REVOKE EXECUTE ON FUNCTION public.settle_abandoned_rooms()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_abandoned_rooms()
  TO service_role;

-- -----------------------------------------------------------------------------
-- 2. begin_match_verification: LOCK LÓGICO
--
-- Si otro worker ya está verificando, NO vuelve a "adueñarse" de la sala.
-- Devuelve busy=true. Esto complementa el FOR UPDATE de la RPC.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.begin_match_verification(p_room_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_room RECORD;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Sólo service_role';
  END IF;

  SELECT *
    INTO v_room
    FROM public.game_rooms
   WHERE id = p_room_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sala no encontrada';
  END IF;

  IF v_room.engine_version <> 'auth-v1' THEN
    RAISE EXCEPTION 'Sala no autoritativa';
  END IF;

  IF v_room.settled_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', TRUE,
      'alreadySettled', TRUE,
      'winner', v_room.server_winner_id,
      'status', v_room.status
    );
  END IF;

  IF v_room.verification_status = 'failed' THEN
    RETURN jsonb_build_object(
      'ok', FALSE,
      'locked', TRUE,
      'status', 'failed',
      'note', v_room.verification_note
    );
  END IF;

  IF v_room.verification_status = 'verified' THEN
    RETURN jsonb_build_object(
      'ok', TRUE,
      'alreadySettled', v_room.settled_at IS NOT NULL,
      'locked', TRUE,
      'status', 'verified'
    );
  END IF;

  IF v_room.verification_status = 'verifying' THEN
    RETURN jsonb_build_object(
      'ok', TRUE,
      'busy', TRUE,
      'status', 'verifying',
      'startedAt', v_room.verification_started_at
    );
  END IF;

  UPDATE public.game_rooms
     SET verification_status = 'verifying',
         verification_requested_at = COALESCE(verification_requested_at, NOW()),
         verification_started_at = NOW(),
         verification_note = NULL,
         verification_next_at = NULL,
         verification_last_error = NULL,
         verification_attempts = verification_attempts + 1
   WHERE id = p_room_id;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'alreadySettled', FALSE,
    'busy', FALSE
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.begin_match_verification(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_match_verification(UUID)
  TO service_role;

-- -----------------------------------------------------------------------------
-- 3. PROGRAMAR REINTENTO
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.schedule_match_verification_retry(
  p_room_id UUID,
  p_delay_ms INTEGER DEFAULT 2000,
  p_error TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_delay INTEGER := LEAST(GREATEST(COALESCE(p_delay_ms, 2000), 250), 60000);
  v_room RECORD;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Sólo service_role';
  END IF;

  SELECT *
    INTO v_room
    FROM public.game_rooms
   WHERE id = p_room_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sala no encontrada';
  END IF;

  IF v_room.settled_at IS NOT NULL
     OR v_room.verification_status IN ('verified', 'failed') THEN
    RETURN jsonb_build_object(
      'ok', TRUE,
      'scheduled', FALSE,
      'status', v_room.verification_status
    );
  END IF;

  UPDATE public.game_rooms
     SET verification_status = 'pending',
         verification_started_at = NULL,
         verification_next_at =
           clock_timestamp() + make_interval(secs => v_delay / 1000.0),
         verification_last_error =
           CASE
             WHEN p_error IS NULL THEN verification_last_error
             ELSE LEFT(p_error, 500)
           END
   WHERE id = p_room_id;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'scheduled', TRUE,
    'delayMs', v_delay
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.schedule_match_verification_retry(UUID, INTEGER, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.schedule_match_verification_retry(UUID, INTEGER, TEXT)
  TO service_role;

-- -----------------------------------------------------------------------------
-- 4. CLAIM DE TRABAJO
--
-- Marca temporalmente las filas elegidas con next_at +30 s. Si el worker muere
-- antes de procesarlas, vuelven solas a estar disponibles después de 30 s.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_pending_match_verifications(
  p_limit INTEGER DEFAULT 8
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 8), 1), 25);
  v_result JSONB;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Sólo service_role';
  END IF;

  WITH candidatas AS (
    SELECT r.id
      FROM public.game_rooms r
     WHERE r.engine_version = 'auth-v1'
       AND r.settled_at IS NULL
       AND r.verification_status = 'pending'
       AND r.verification_requested_at IS NOT NULL
       AND (
         r.verification_next_at IS NULL
         OR r.verification_next_at <= NOW()
       )
     ORDER BY r.verification_requested_at ASC, r.created_at ASC
     LIMIT v_limit
     FOR UPDATE SKIP LOCKED
  ),
  reclamadas AS (
    UPDATE public.game_rooms r
       SET verification_next_at = NOW() + INTERVAL '30 seconds'
      FROM candidatas c
     WHERE r.id = c.id
    RETURNING r.id
  )
  SELECT COALESCE(jsonb_agg(id), '[]'::JSONB)
    INTO v_result
    FROM reclamadas;

  RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_pending_match_verifications(INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_pending_match_verifications(INTEGER)
  TO service_role;

-- -----------------------------------------------------------------------------
-- 5. VERIFICACIONES ATASCADAS
--
-- Si el proceso murió DESPUÉS de begin_match_verification, la sala quedó
-- "verifying" y submit_match_action ya no acepta inputs. No se reabre ni se
-- devuelve escrow automáticamente: se marca revisión manual.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_stuck_match_verifications(
  p_age_seconds INTEGER DEFAULT 180
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_age INTEGER := LEAST(GREATEST(COALESCE(p_age_seconds, 180), 60), 3600);
  v_count INTEGER;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Sólo service_role';
  END IF;

  WITH marcadas AS (
    UPDATE public.game_rooms
       SET verification_status = 'failed',
           verification_note = 'worker_stuck_after_verification_lock',
           verification_last_error = 'verifying excedió el tiempo máximo del worker',
           verification_payload =
             COALESCE(verification_payload, '{}'::JSONB)
             || jsonb_build_object(
                  'workerRecovery', TRUE,
                  'failedAt', NOW(),
                  'reason', 'worker_stuck_after_verification_lock'
                )
     WHERE engine_version = 'auth-v1'
       AND settled_at IS NULL
       AND verification_status = 'verifying'
       AND verification_started_at IS NOT NULL
       AND verification_started_at < NOW() - make_interval(secs => v_age)
    RETURNING id
  )
  SELECT COUNT(*) INTO v_count FROM marcadas;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'markedForReview', v_count,
    'escrowReleased', FALSE
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.mark_stuck_match_verifications(INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_stuck_match_verifications(INTEGER)
  TO service_role;

-- -----------------------------------------------------------------------------
-- 6. COMPROBACIONES
-- -----------------------------------------------------------------------------
COMMIT;

SELECT column_name, data_type, column_default
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name = 'game_rooms'
   AND column_name IN (
     'verification_attempts',
     'verification_next_at',
     'verification_last_error'
   )
 ORDER BY column_name;

SELECT p.proname,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_puede,
       has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_puede
  FROM pg_proc p
 WHERE p.pronamespace = 'public'::regnamespace
   AND p.proname IN (
     'begin_match_verification',
     'schedule_match_verification_retry',
     'claim_pending_match_verifications',
     'mark_stuck_match_verifications',
     'settle_abandoned_rooms'
   )
 ORDER BY p.proname;

-- Resultado esperado:
-- authenticated_puede = false para las 5 funciones
-- service_role_puede  = true  para las 5 funciones
