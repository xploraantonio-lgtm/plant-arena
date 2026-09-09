-- =============================================================================
-- 62: OPTIMIZACIÓN DE RENDIMIENTO EN FEED DE INTENCIONES ASÍNCRONAS
--
-- Amplía la ventana autorizada de poll_ranked_async_intents de 18 tics (~600ms)
-- a 45 tics (~1500ms). Esto permite que los clientes sondeen con menor
-- frecuencia (cada 800ms-1200ms en lugar de 350ms) reduciendo hasta un 70%
-- la carga de CPU y el consumo de conexiones en PostgreSQL durante horas pico.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.poll_ranked_async_intents(
  p_room_id UUID,
  p_after_seq INTEGER DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_room RECORD;
  v_plan RECORD;
  v_inicio TIMESTAMPTZ;
  v_server_tick INTEGER;
  v_max_reveal_tick INTEGER;
  v_intents JSONB;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF p_after_seq IS NULL OR p_after_seq < 0 THEN
    RAISE EXCEPTION 'p_after_seq inválido';
  END IF;

  SELECT * INTO v_room FROM public.game_rooms WHERE id = p_room_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sala no encontrada'; END IF;

  IF NOT COALESCE(v_room.is_async_match, FALSE) THEN
    RAISE EXCEPTION 'Esta sala no es asíncrona';
  END IF;

  IF v_room.mode <> 'ranked' THEN
    RAISE EXCEPTION 'Esta sala no es ranked';
  END IF;

  IF v_room.status <> 'playing' THEN
    RAISE EXCEPTION 'La partida no está en curso';
  END IF;

  IF v_room.player1_id <> v_uid THEN
    RAISE EXCEPTION 'No participas en esta partida';
  END IF;

  SELECT * INTO v_plan FROM public.ranked_async_room_plans WHERE room_id = p_room_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ASYNC_PLAN_MISSING';
  END IF;

  IF v_plan.actions_snapshot IS NULL OR jsonb_typeof(v_plan.actions_snapshot) <> 'array' THEN
    RAISE EXCEPTION 'INVALID_ASYNC_PLAN';
  END IF;

  -- Calcular tic del servidor (33ms por tic)
  v_inicio := COALESCE(v_room.started_at, v_room.created_at);
  v_server_tick := GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (clock_timestamp() - v_inicio)) * 1000.0 / 33.0)::INTEGER);

  -- Ventana autorizada estricta del servidor: serverTick + 45 tics (aprox 1500 ms)
  v_max_reveal_tick := v_server_tick + 45;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'seq', (elem->>'seq')::INTEGER,
      'tick', (elem->>'tick')::INTEGER,
      'issuedTick', (elem->>'issuedTick')::INTEGER,
      'kind', elem->>'kind',
      'plantId', elem->>'plantId',
      'slot', (elem->>'slot')::INTEGER,
      'lane', (elem->>'lane')::INTEGER,
      'col', (elem->>'col')::INTEGER
    ) ORDER BY (elem->>'issuedTick')::INTEGER ASC, (elem->>'seq')::INTEGER ASC
  ), '[]'::JSONB)
  INTO v_intents
  FROM jsonb_array_elements(v_plan.actions_snapshot) AS elem
  WHERE (elem->>'seq')::INTEGER > p_after_seq
    AND (elem->>'issuedTick')::INTEGER <= v_max_reveal_tick;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'serverTick', v_server_tick,
    'maxRevealedTick', v_max_reveal_tick,
    'intents', v_intents
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.poll_ranked_async_intents(UUID, INTEGER) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.poll_ranked_async_intents(UUID, INTEGER) TO authenticated;
