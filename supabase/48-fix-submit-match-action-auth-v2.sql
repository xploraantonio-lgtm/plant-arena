-- =============================================================================
-- FASE 48: UNIFICACION DE SUBMIT_MATCH_ACTION (AUTH-V2 / AUTH-V1)
--
-- 1. Elimina sobrecarga legacy de migracion 36 que contenia validacion por reloj de pared.
-- 2. Define funcion canonica submit_match_action compatible con p_plant_id y p_plant.
-- 3. Previene excepciones de ventana de tiempo 'tick fuera de ventana' en salas auth-v2.
-- =============================================================================

DROP FUNCTION IF EXISTS public.submit_match_action(UUID, INTEGER, INTEGER, TEXT, TEXT, SMALLINT, SMALLINT, SMALLINT, INTEGER, TEXT);
DROP FUNCTION IF EXISTS public.submit_match_action(UUID, INTEGER, INTEGER, INTEGER, TEXT, TEXT, INTEGER, INTEGER, INTEGER, TEXT);

CREATE OR REPLACE FUNCTION public.submit_match_action(
  p_room_id     UUID,
  p_seq         INTEGER,
  p_tick        INTEGER,
  p_issued_tick INTEGER,
  p_kind        TEXT,
  p_plant_id    TEXT DEFAULT NULL,
  p_lane        INTEGER DEFAULT NULL,
  p_col         INTEGER DEFAULT NULL,
  p_slot        INTEGER DEFAULT NULL,
  p_target_id   TEXT DEFAULT NULL,
  p_plant       TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid             UUID := auth.uid();
  v_room            RECORD;
  v_effective_plant TEXT := COALESCE(p_plant_id, p_plant);
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF p_seq IS NULL OR p_seq < 0 THEN RAISE EXCEPTION 'seq invalido'; END IF;
  IF p_tick IS NULL OR p_tick < 0 THEN RAISE EXCEPTION 'tick invalido'; END IF;
  IF p_kind NOT IN ('plant', 'dig', 'collect') THEN RAISE EXCEPTION 'tipo de accion invalido'; END IF;

  SELECT * INTO v_room FROM public.game_rooms WHERE id = p_room_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sala no encontrada'; END IF;
  IF v_room.engine_version NOT IN ('auth-v1', 'auth-v2') THEN RAISE EXCEPTION 'Sala no autoritativa'; END IF;

  IF v_room.player1_id <> v_uid AND v_room.player2_id <> v_uid THEN
    RAISE EXCEPTION 'No perteneces a esta sala';
  END IF;

  IF v_room.settled_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'room_settled');
  END IF;

  IF v_room.verification_status IN ('verifying', 'verified', 'failed') THEN
    RAISE EXCEPTION 'La partida ya esta cerrada para verificacion';
  END IF;

  -- Idempotencia estricta por (room_id, user_id, seq)
  IF EXISTS (
    SELECT 1 FROM public.match_actions
     WHERE room_id = p_room_id AND user_id = v_uid AND seq = p_seq
  ) THEN
    RETURN jsonb_build_object('ok', TRUE, 'duplicate', TRUE);
  END IF;

  INSERT INTO public.match_actions (
    room_id, user_id, seq, tick, issued_tick, kind, plant_id, lane, col, slot, target_id, created_at
  ) VALUES (
    p_room_id, v_uid, p_seq, p_tick, p_issued_tick, p_kind, v_effective_plant, p_lane, p_col, p_slot, p_target_id, NOW()
  );

  RETURN jsonb_build_object('ok', TRUE);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.submit_match_action(UUID, INTEGER, INTEGER, INTEGER, TEXT, TEXT, INTEGER, INTEGER, INTEGER, TEXT, TEXT) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.submit_match_action(UUID, INTEGER, INTEGER, INTEGER, TEXT, TEXT, INTEGER, INTEGER, INTEGER, TEXT, TEXT) TO authenticated;
