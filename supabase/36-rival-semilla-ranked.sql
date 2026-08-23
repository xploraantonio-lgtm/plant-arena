-- =============================================================================
-- PLANTS ARENA · MIGRACIÓN 36
-- RIVAL SEMILLA RANKED V1 (ASYNC OPPONENTS)
--
-- Implementa el sistema de Rivales Semilla exclusivamente para Ranked.
-- Cuando un jugador espera >= 60 segundos en cola sin encontrar un rival humano,
-- el servidor comprueba primero la prioridad humana y, si sigue sin haber humano,
-- crea una partida asíncrona contra un snapshot histórico verificado con nueva
-- semilla RNG, nombre/avatar inventados y liquidación autoritativa.
--
-- =============================================================================
-- CONTRATO DE PROTOCOLO CANÓNICO (AUTH-V1 & RANKED-ASYNC-V1)
-- =============================================================================
--
-- 1. ACCIÓN P1 AUTH-V1 (match_actions / AccionP1RankedEstricta):
--    - seq: INTEGER NOT NULL, >= 0, único por (room_id, user_id, seq).
--    - issued_tick: INTEGER NOT NULL, >= 0 (NO se permite NULL ni inferencias).
--    - tick: INTEGER NOT NULL, >= 0.
--    - kind: TEXT NOT NULL, estrictamente 'plant' | 'dig' | 'collect'.
--    - Relación temporal:
--        * plant / dig: tick = issued_tick + 6 (MARGEN_DE_RED_TICS).
--        * collect: tick = issued_tick.
--    - collect: target_id NOT NULL, longitud 1..160. Demás campos NULL.
--    - dig: lane en 0..2, col en 0..5 (P1_COLUMNS). Demás campos NULL.
--    - plant: plant_id válido en catálogo, slot en 0..5 (perteneciente al mazo),
--             lane en 0..2, col en 0..5. target_id NULL.
--
-- 2. INTENCIÓN P2 ASYNC-V1 (AsyncOpponentIntentRankedEstricta):
--    - seq: INTEGER NOT NULL, >= 0, único dentro del lote/plan.
--    - issuedTick: INTEGER NOT NULL, >= 0.
--    - tick: INTEGER NOT NULL, >= 0.
--    - kind: TEXT NOT NULL, estrictamente 'plant' | 'dig'.
--    - Relación temporal: tick = issuedTick + 6 O tick = issuedTick.
--    - dig: lane en 0..2, col en 0..5.
--    - plant: plantId válido en catálogo, lane en 0..2, col en 0..5 (o NULL si camina),
--             slot en 0..5 (o NULL).
--
-- 3. DECK SNAPSHOT (CartaDeMazo[]):
--    - JSONB array de 1 a 6 cartas.
--    - Cada carta es un objeto con:
--        * plantId: TEXT válido en catálogo de 15 plantas.
--        * slot: INTEGER NULL o 0..5.
--        * level: INTEGER NULL o >= 0.
--        * statRolls: JSONB array NULL o de strings ('hp','damage','attackSpeed','moveSpeed','cooldown').
--
-- 4. PLAN SNAPSHOT:
--    - JSONB array de intenciones P2 válidas ordenadas por issuedTick ASC, seq ASC.
--    - Sin colisiones de seq con contenido dispar.
--
-- 5. PROTOCOL & ENGINE VERSIONING:
--    - source_engine_version = 'auth-v1' exactamente (NO COALESCE).
--    - protocol_version = 'ranked-async-v1' exactamente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. HELPERS PRIVADOS DE VALIDACIÓN REUTILIZABLES (SERVER-ONLY)
-- -----------------------------------------------------------------------------

/**
 * Valida formalmente un deck snapshot según las reglas estrictas de Ranked Async V1.
 * Retorna JSONB con { "ok": true, "deck": [...] } o { "ok": false, "reason": "...", "details": "..." }.
 */
CREATE OR REPLACE FUNCTION public._validate_ranked_async_deck(p_deck JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_elem JSONB;
  v_plant_id TEXT;
  v_slot INTEGER;
  v_level INTEGER;
  v_stat_rolls JSONB;
  v_stat_elem JSONB;
  v_count INTEGER := 0;
  v_valid_plants TEXT[] := ARRAY[
    'sunflower', 'peashooter', 'repeater', 'wallnut', 'melonpult',
    'chomper', 'bonkchoy', 'garlic', 'squash', 'twinsunflower',
    'threepeater', 'tallnut', 'jalapeno', 'iceberglettuce', 'aloe'
  ];
  v_valid_stats TEXT[] := ARRAY['hp', 'damage', 'attackSpeed', 'moveSpeed', 'cooldown'];
BEGIN
  IF p_deck IS NULL OR jsonb_typeof(p_deck) <> 'array' THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'INVALID_ASYNC_DECK', 'details', 'El mazo debe ser un array JSON');
  END IF;

  v_count := jsonb_array_length(p_deck);
  IF v_count < 1 OR v_count > 6 THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'INVALID_ASYNC_DECK', 'details', 'El mazo debe contener entre 1 y 6 cartas');
  END IF;

  FOR v_elem IN SELECT * FROM jsonb_array_elements(p_deck) LOOP
    IF jsonb_typeof(v_elem) <> 'object' THEN
      RETURN jsonb_build_object('ok', FALSE, 'reason', 'INVALID_ASYNC_DECK', 'details', 'Cada carta debe ser un objeto JSON');
    END IF;

    v_plant_id := v_elem->>'plantId';
    IF v_plant_id IS NULL OR NOT (v_plant_id = ANY(v_valid_plants)) THEN
      RETURN jsonb_build_object('ok', FALSE, 'reason', 'INVALID_ASYNC_DECK', 'details', 'plantId inválido o desconocido: ' || COALESCE(v_plant_id, 'NULL'));
    END IF;

    IF v_elem ? 'slot' AND v_elem->>'slot' IS NOT NULL THEN
      IF (v_elem->>'slot') !~ '^\d+$' THEN
        RETURN jsonb_build_object('ok', FALSE, 'reason', 'INVALID_ASYNC_DECK', 'details', 'slot debe ser un entero no negativo');
      END IF;
      v_slot := (v_elem->>'slot')::INTEGER;
      IF v_slot < 0 OR v_slot > 5 THEN
        RETURN jsonb_build_object('ok', FALSE, 'reason', 'INVALID_ASYNC_DECK', 'details', 'slot fuera de rango (0..5)');
      END IF;
    END IF;

    IF v_elem ? 'level' AND v_elem->>'level' IS NOT NULL THEN
      IF (v_elem->>'level') !~ '^\d+$' THEN
        RETURN jsonb_build_object('ok', FALSE, 'reason', 'INVALID_ASYNC_DECK', 'details', 'level debe ser un entero no negativo');
      END IF;
      v_level := (v_elem->>'level')::INTEGER;
      IF v_level < 0 THEN
        RETURN jsonb_build_object('ok', FALSE, 'reason', 'INVALID_ASYNC_DECK', 'details', 'level no puede ser negativo');
      END IF;
    END IF;

    IF v_elem ? 'statRolls' AND v_elem->'statRolls' IS NOT NULL AND jsonb_typeof(v_elem->'statRolls') <> 'null' THEN
      v_stat_rolls := v_elem->'statRolls';
      IF jsonb_typeof(v_stat_rolls) <> 'array' THEN
        RETURN jsonb_build_object('ok', FALSE, 'reason', 'INVALID_ASYNC_DECK', 'details', 'statRolls debe ser un array JSON');
      END IF;
      FOR v_stat_elem IN SELECT * FROM jsonb_array_elements(v_stat_rolls) LOOP
        IF jsonb_typeof(v_stat_elem) <> 'string' OR NOT ((v_stat_elem#>>'{}') = ANY(v_valid_stats)) THEN
          RETURN jsonb_build_object('ok', FALSE, 'reason', 'INVALID_ASYNC_DECK', 'details', 'statRolls contiene estadística inválida: ' || COALESCE(v_stat_elem#>>'{}', 'NULL'));
        END IF;
      END LOOP;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('ok', TRUE, 'deck', p_deck);
END;
$$;

REVOKE ALL ON FUNCTION public._validate_ranked_async_deck(JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._validate_ranked_async_deck(JSONB) TO service_role;


/**
 * Valida formalmente un plan de intenciones P2 para Ranked Async V1.
 * Exige campos exactos, verifica unicidad/conflictos de seq y coherencia temporal.
 */
CREATE OR REPLACE FUNCTION public._validate_ranked_async_plan(p_actions JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_elem JSONB;
  v_seq INTEGER;
  v_tick INTEGER;
  v_issued_tick INTEGER;
  v_kind TEXT;
  v_plant_id TEXT;
  v_slot INTEGER;
  v_lane INTEGER;
  v_col INTEGER;
  v_seen_seqs JSONB := '{}'::JSONB;
  v_existing_intent JSONB;
  v_canonical_intent JSONB;
  v_valid_plants TEXT[] := ARRAY[
    'sunflower', 'peashooter', 'repeater', 'wallnut', 'melonpult',
    'chomper', 'bonkchoy', 'garlic', 'squash', 'twinsunflower',
    'threepeater', 'tallnut', 'jalapeno', 'iceberglettuce', 'aloe'
  ];
BEGIN
  IF p_actions IS NULL OR jsonb_typeof(p_actions) <> 'array' THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'INVALID_ASYNC_PLAN', 'details', 'El plan de acciones debe ser un array JSON');
  END IF;

  FOR v_elem IN SELECT * FROM jsonb_array_elements(p_actions) LOOP
    -- Limpieza total de variables por cada elemento para evitar contaminación inter-iteración
    v_seq := NULL;
    v_tick := NULL;
    v_issued_tick := NULL;
    v_kind := NULL;
    v_plant_id := NULL;
    v_slot := NULL;
    v_lane := NULL;
    v_col := NULL;
    v_existing_intent := NULL;
    v_canonical_intent := NULL;

    IF jsonb_typeof(v_elem) <> 'object' THEN
      RETURN jsonb_build_object('ok', FALSE, 'reason', 'INVALID_ASYNC_PLAN', 'details', 'Cada intención debe ser un objeto JSON');
    END IF;

    -- seq
    IF v_elem->>'seq' IS NULL OR (v_elem->>'seq') !~ '^\d+$' THEN
      RETURN jsonb_build_object('ok', FALSE, 'reason', 'MISSING_SEQ', 'details', 'seq obligatorio y entero no negativo');
    END IF;
    v_seq := (v_elem->>'seq')::INTEGER;

    -- issuedTick
    IF v_elem->>'issuedTick' IS NULL THEN
      RETURN jsonb_build_object('ok', FALSE, 'reason', 'MISSING_ISSUED_TICK', 'seq', v_seq, 'details', 'issuedTick es obligatorio');
    END IF;
    IF (v_elem->>'issuedTick') !~ '^\d+$' THEN
      RETURN jsonb_build_object('ok', FALSE, 'reason', 'INVALID_ISSUED_TICK', 'seq', v_seq, 'details', 'issuedTick debe ser un entero no negativo');
    END IF;
    v_issued_tick := (v_elem->>'issuedTick')::INTEGER;

    -- tick
    IF v_elem->>'tick' IS NULL OR (v_elem->>'tick') !~ '^\d+$' THEN
      RETURN jsonb_build_object('ok', FALSE, 'reason', 'MISSING_TICK', 'seq', v_seq, 'issuedTick', v_issued_tick, 'details', 'tick es obligatorio');
    END IF;
    v_tick := (v_elem->>'tick')::INTEGER;

    -- kind
    v_kind := v_elem->>'kind';
    IF v_kind IS NULL OR v_kind NOT IN ('plant', 'dig') THEN
      RETURN jsonb_build_object('ok', FALSE, 'reason', 'INVALID_KIND', 'seq', v_seq, 'issuedTick', v_issued_tick, 'details', 'kind debe ser plant o dig');
    END IF;

    -- Relación temporal
    IF v_tick <> v_issued_tick + 6 AND v_tick <> v_issued_tick THEN
      RETURN jsonb_build_object('ok', FALSE, 'reason', 'INVALID_TICK_RELATION', 'seq', v_seq, 'issuedTick', v_issued_tick, 'details', 'tick debe ser issuedTick+6 o issuedTick');
    END IF;

    -- lane
    IF v_elem->>'lane' IS NULL OR (v_elem->>'lane') !~ '^\d+$' THEN
      RETURN jsonb_build_object('ok', FALSE, 'reason', 'INVALID_ASYNC_INTENT_DATA', 'seq', v_seq, 'issuedTick', v_issued_tick, 'details', 'lane obligatorio');
    END IF;
    v_lane := (v_elem->>'lane')::INTEGER;
    IF v_lane < 0 OR v_lane > 2 THEN
      RETURN jsonb_build_object('ok', FALSE, 'reason', 'INVALID_ASYNC_INTENT_DATA', 'seq', v_seq, 'issuedTick', v_issued_tick, 'details', 'lane fuera de rango (0..2)');
    END IF;

    -- dig específico
    IF v_kind = 'dig' THEN
      IF v_elem->>'col' IS NULL OR (v_elem->>'col') !~ '^\d+$' THEN
        RETURN jsonb_build_object('ok', FALSE, 'reason', 'INVALID_DIG_DATA', 'seq', v_seq, 'issuedTick', v_issued_tick, 'details', 'col obligatorio en dig');
      END IF;
      v_col := (v_elem->>'col')::INTEGER;
      IF v_col < 0 OR v_col > 5 THEN
        RETURN jsonb_build_object('ok', FALSE, 'reason', 'INVALID_DIG_DATA', 'seq', v_seq, 'issuedTick', v_issued_tick, 'details', 'col fuera de rango en dig (0..5)');
      END IF;

      -- Canonicalización explícita para dig: plantId y slot estrictamente NULL
      v_canonical_intent := jsonb_build_object(
        'seq', v_seq,
        'kind', 'dig',
        'issuedTick', v_issued_tick,
        'tick', v_tick,
        'lane', v_lane,
        'col', v_col,
        'plantId', NULL,
        'slot', NULL
      );
    ELSE
      -- plant específico
      v_plant_id := v_elem->>'plantId';
      IF v_plant_id IS NULL OR NOT (v_plant_id = ANY(v_valid_plants)) THEN
        RETURN jsonb_build_object('ok', FALSE, 'reason', 'INVALID_PLANT_DATA', 'seq', v_seq, 'issuedTick', v_issued_tick, 'details', 'plantId inválido en intención P2: ' || COALESCE(v_plant_id, 'NULL'));
      END IF;

      IF v_elem ? 'col' AND v_elem->>'col' IS NOT NULL THEN
        IF (v_elem->>'col') !~ '^\d+$' THEN
          RETURN jsonb_build_object('ok', FALSE, 'reason', 'INVALID_PLANT_DATA', 'seq', v_seq, 'issuedTick', v_issued_tick, 'details', 'col debe ser un entero');
        END IF;
        v_col := (v_elem->>'col')::INTEGER;
        IF v_col < 0 OR v_col > 5 THEN
          RETURN jsonb_build_object('ok', FALSE, 'reason', 'INVALID_PLANT_DATA', 'seq', v_seq, 'issuedTick', v_issued_tick, 'details', 'col fuera de rango en plant (0..5)');
        END IF;
      END IF;

      IF v_elem ? 'slot' AND v_elem->>'slot' IS NOT NULL THEN
        IF (v_elem->>'slot') !~ '^\d+$' THEN
          RETURN jsonb_build_object('ok', FALSE, 'reason', 'INVALID_PLANT_DATA', 'seq', v_seq, 'issuedTick', v_issued_tick, 'details', 'slot debe ser un entero');
        END IF;
        v_slot := (v_elem->>'slot')::INTEGER;
        IF v_slot < 0 OR v_slot > 5 THEN
          RETURN jsonb_build_object('ok', FALSE, 'reason', 'INVALID_PLANT_DATA', 'seq', v_seq, 'issuedTick', v_issued_tick, 'details', 'slot fuera de rango en plant (0..5)');
        END IF;
      END IF;

      -- Canonicalización explícita para plant
      v_canonical_intent := jsonb_build_object(
        'seq', v_seq,
        'kind', 'plant',
        'issuedTick', v_issued_tick,
        'tick', v_tick,
        'lane', v_lane,
        'col', v_col,
        'plantId', v_plant_id,
        'slot', v_slot
      );
    END IF;

    -- Comprobar colisiones de seq dentro del plan
    v_existing_intent := v_seen_seqs->(v_seq::TEXT);
    IF v_existing_intent IS NOT NULL THEN
      IF v_existing_intent <> v_canonical_intent THEN
        RETURN jsonb_build_object(
          'ok', FALSE,
          'reason', 'SEQ_CONFLICT',
          'seq', v_seq,
          'issuedTick', v_issued_tick,
          'details', 'Conflicto de seq en plan: seq ' || v_seq || ' duplicado con contenido distinto'
        );
      END IF;
    ELSE
      v_seen_seqs := jsonb_set(v_seen_seqs, ARRAY[v_seq::TEXT], v_canonical_intent);
    END IF;
  END LOOP;

  RETURN jsonb_build_object('ok', TRUE, 'intents', p_actions);
END;
$$;

REVOKE ALL ON FUNCTION public._validate_ranked_async_plan(JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._validate_ranked_async_plan(JSONB) TO service_role;


-- -----------------------------------------------------------------------------
-- 1. TABLA INTERNA ranked_async_opponents (POOL DE RIVALES SEMILLA)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ranked_async_opponents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_room_id UUID NOT NULL,
  source_side SMALLINT NOT NULL CHECK (source_side IN (1, 2)),
  rating_snapshot INTEGER NOT NULL CHECK (rating_snapshot >= 0 AND rating_snapshot <= 5000),
  deck_snapshot JSONB NOT NULL CHECK (jsonb_typeof(deck_snapshot) = 'array'),
  actions_snapshot JSONB NOT NULL CHECK (jsonb_typeof(actions_snapshot) = 'array'),
  source_engine_version TEXT NOT NULL CHECK (source_engine_version = 'auth-v1'),
  protocol_version TEXT NOT NULL DEFAULT 'ranked-async-v1' CHECK (protocol_version = 'ranked-async-v1'),
  source_duration_ticks INTEGER NOT NULL CHECK (source_duration_ticks >= 300),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_ranked_async_opponents_source UNIQUE(source_room_id, source_side)
);

CREATE INDEX IF NOT EXISTS idx_ranked_async_opponents_active_rating
  ON public.ranked_async_opponents (active, protocol_version, source_engine_version, rating_snapshot);

-- Server-only: ningún cliente anon o authenticated puede acceder directamente.
ALTER TABLE public.ranked_async_opponents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ranked_async_opponents FROM anon, authenticated, PUBLIC;
GRANT ALL ON public.ranked_async_opponents TO service_role;


-- -----------------------------------------------------------------------------
-- 2. EXTENDER game_rooms Y CREAR ranked_async_room_plans (SERVER-ONLY)
-- -----------------------------------------------------------------------------
ALTER TABLE public.game_rooms
  ALTER COLUMN player2_id DROP NOT NULL;

ALTER TABLE public.game_rooms
  ADD COLUMN IF NOT EXISTS is_async_match BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS async_opponent_id UUID REFERENCES public.ranked_async_opponents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS async_display_name TEXT,
  ADD COLUMN IF NOT EXISTS async_avatar_id TEXT,
  ADD COLUMN IF NOT EXISTS async_rating_snapshot INTEGER,
  ADD COLUMN IF NOT EXISTS async_deck_snapshot JSONB;

CREATE INDEX IF NOT EXISTS idx_game_rooms_async
  ON public.game_rooms (player1_id, is_async_match, created_at);

-- Tabla privada para los planes completos de acciones del Rival Semilla.
CREATE TABLE IF NOT EXISTS public.ranked_async_room_plans (
  room_id UUID PRIMARY KEY REFERENCES public.game_rooms(id) ON DELETE CASCADE,
  async_opponent_id UUID NOT NULL REFERENCES public.ranked_async_opponents(id),
  protocol_version TEXT NOT NULL DEFAULT 'ranked-async-v1' CHECK (protocol_version = 'ranked-async-v1'),
  actions_snapshot JSONB NOT NULL CHECK (jsonb_typeof(actions_snapshot) = 'array'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ranked_async_room_plans_opp
  ON public.ranked_async_room_plans (async_opponent_id);

-- Server-only: NUNCA accesible por clientes (anon o authenticated).
ALTER TABLE public.ranked_async_room_plans ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ranked_async_room_plans FROM anon, authenticated, PUBLIC;
GRANT ALL ON public.ranked_async_room_plans TO service_role;

-- Actualizar política de lectura de salas para permitir player2_id nulo en async
DROP POLICY IF EXISTS "rooms_select_own" ON public.game_rooms;
CREATE POLICY "rooms_select_own" ON public.game_rooms
  FOR SELECT TO authenticated
  USING (
    auth.uid() = player1_id
    OR (player2_id IS NOT NULL AND auth.uid() = player2_id)
  );


-- -----------------------------------------------------------------------------
-- 3. CAPTURA DEL POOL DE RIVALES SEMILLA DESDE PARTIDAS VERIFICADAS
-- -----------------------------------------------------------------------------
/**
 * Captura snapshots de intenciones y mazo a partir de una partida Ranked humana
 * verificada determinísticamente con éxito por el servidor.
 *
 * CRITERIO POSITIVO ESTRICTO Y AFIRMATIVO:
 * - mode = 'ranked' y is_async_match = FALSE.
 * - engine_version = 'auth-v1' exactamente.
 * - verification_status = 'verified' y settled_at NOT NULL.
 * - verification_payload con consistent = true e illegalCount = 0 explícitos.
 * - resolutionSource = 'authoritative_replay' EXACTO (no nulo ni consenso ni fallback).
 * - reason permitido (no forfeit ni surrender).
 * - duration >= 300 ticks.
 * - Acciones históricas con seq e issued_tick explícitos y únicos (sin inferir).
 */
CREATE OR REPLACE FUNCTION public.capture_ranked_async_opponents_from_room(p_room_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_room RECORD;
  v_duration INTEGER;
  v_resolution_source TEXT;
  v_reason TEXT;
  
  -- Lado 1 (Side 1)
  v_p1_status TEXT := 'NOT_ELIGIBLE'; -- 'NOT_ELIGIBLE' | 'NEW' | 'IDENTICAL_EXISTING' | 'CONFLICT'
  v_p1_rating INTEGER;
  v_p1_deck_val JSONB;
  v_p1_actions JSONB;
  v_p1_plan_val JSONB;
  v_p1_plant_count INTEGER;
  v_p1_missing_issued INTEGER;
  v_p1_invalid_seq INTEGER;
  v_existing_opp1 RECORD;
  
  -- Lado 2 (Side 2)
  v_p2_status TEXT := 'NOT_ELIGIBLE'; -- 'NOT_ELIGIBLE' | 'NEW' | 'IDENTICAL_EXISTING' | 'CONFLICT'
  v_p2_rating INTEGER;
  v_p2_deck_val JSONB;
  v_p2_actions JSONB;
  v_p2_plan_val JSONB;
  v_p2_plant_count INTEGER;
  v_p2_missing_issued INTEGER;
  v_p2_invalid_seq INTEGER;
  v_existing_opp2 RECORD;
  
  -- Contadores finales
  v_captured_sides INTEGER := 0;
  v_already_existing_sides INTEGER := 0;
  v_not_eligible_sides INTEGER := 0;
BEGIN
  -- ── LOCK DE CONCURRENCIA: Serializa la captura para la misma source room ───
  SELECT * INTO v_room FROM public.game_rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'room_not_found');
  END IF;

  -- Criterios estrictos de elegibilidad de la sala fuente
  IF v_room.mode <> 'ranked' THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'mode_not_ranked');
  END IF;

  IF COALESCE(v_room.is_async_match, FALSE) = TRUE THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'already_async_match');
  END IF;

  IF v_room.engine_version IS NULL OR v_room.engine_version <> 'auth-v1' THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'engine_version_not_auth_v1');
  END IF;

  IF v_room.settled_at IS NULL OR v_room.verification_status <> 'verified' THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'not_settled_or_not_verified');
  END IF;

  IF v_room.player1_id IS NULL OR v_room.player2_id IS NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'missing_human_players');
  END IF;

  IF v_room.p1_deck IS NULL OR v_room.p2_deck IS NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'missing_deck_snapshots');
  END IF;

  IF v_room.verification_payload IS NULL OR jsonb_typeof(v_room.verification_payload) <> 'object' THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'missing_verification_payload');
  END IF;

  -- ── CRITERIO POSITIVO AFIRMATIVO: SÓLO REPLAY DETERMINISTA AUTORITATIVO ───
  v_resolution_source := v_room.verification_payload->>'resolutionSource';
  IF v_resolution_source IS NULL OR v_resolution_source <> 'authoritative_replay' THEN
    RETURN jsonb_build_object(
      'ok', FALSE,
      'reason', 'INVALID_SOURCE_VERIFICATION',
      'details', 'resolutionSource debe ser authoritative_replay'
    );
  END IF;

  IF v_room.verification_payload->>'consistent' IS NULL
     OR v_room.verification_payload->>'consistent' <> 'true' THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'simulation_not_consistent');
  END IF;

  IF v_room.verification_payload->>'illegalCount' IS NULL
     OR (v_room.verification_payload->>'illegalCount') !~ '^\d+$'
     OR (v_room.verification_payload->>'illegalCount')::INTEGER <> 0 THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'had_illegal_actions');
  END IF;

  v_reason := v_room.verification_payload->>'reason';
  IF v_reason IS NOT NULL AND v_reason IN ('forfeit_p1', 'forfeit_p2', 'surrender') THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'match_ended_in_forfeit_or_surrender');
  END IF;

  IF v_room.verification_payload->>'ticks' IS NULL
     OR (v_room.verification_payload->>'ticks') !~ '^\d+$'
     OR (v_room.verification_payload->>'ticks')::INTEGER < 300 THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'duration_too_short');
  END IF;
  v_duration := (v_room.verification_payload->>'ticks')::INTEGER;

  -- ═══════════════════════════════════════════════════════════════════════════
  -- FASE 1: READ / VALIDATE ONLY (CERO ESCRITURAS)
  -- ═══════════════════════════════════════════════════════════════════════════

  -- ── Evaluación Lado 1 (player1_id) ─────────────────────────────────────────
  SELECT COUNT(*) INTO v_p1_plant_count
    FROM public.match_actions
   WHERE room_id = p_room_id AND user_id = v_room.player1_id AND kind = 'plant';

  SELECT COUNT(*) INTO v_p1_missing_issued
    FROM public.match_actions
   WHERE room_id = p_room_id AND user_id = v_room.player1_id AND (issued_tick IS NULL OR issued_tick < 0);

  SELECT COUNT(*) INTO v_p1_invalid_seq
    FROM public.match_actions
   WHERE room_id = p_room_id AND user_id = v_room.player1_id AND (seq IS NULL OR seq < 0);

  IF v_p1_plant_count >= 3 AND v_p1_missing_issued = 0 AND v_p1_invalid_seq = 0 THEN
    v_p1_deck_val := public._validate_ranked_async_deck(v_room.p1_deck);
    IF (v_p1_deck_val->>'ok')::BOOLEAN = TRUE THEN
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'seq', seq,
          'tick', tick,
          'issuedTick', issued_tick,
          'kind', kind,
          'plantId', plant_id,
          'slot', slot,
          'lane', lane,
          'col', col
        ) ORDER BY issued_tick ASC, seq ASC
      ), '[]'::JSONB)
      INTO v_p1_actions
      FROM public.match_actions
      WHERE room_id = p_room_id AND user_id = v_room.player1_id AND kind IN ('plant', 'dig');

      v_p1_plan_val := public._validate_ranked_async_plan(v_p1_actions);
      IF (v_p1_plan_val->>'ok')::BOOLEAN = TRUE THEN
        SELECT COALESCE(elo_rating, 1000) INTO v_p1_rating
          FROM public.profiles WHERE id = v_room.player1_id;

        SELECT * INTO v_existing_opp1
          FROM public.ranked_async_opponents
         WHERE source_room_id = p_room_id AND source_side = 1;

        IF FOUND THEN
          IF v_existing_opp1.deck_snapshot = v_room.p1_deck
             AND v_existing_opp1.actions_snapshot = v_p1_actions
             AND v_existing_opp1.source_engine_version = 'auth-v1'
             AND v_existing_opp1.protocol_version = 'ranked-async-v1'
             AND v_existing_opp1.source_duration_ticks = v_duration
             AND v_existing_opp1.rating_snapshot = v_p1_rating
          THEN
            v_p1_status := 'IDENTICAL_EXISTING';
          ELSE
            v_p1_status := 'CONFLICT';
          END IF;
        ELSE
          v_p1_status := 'NEW';
        END IF;
      END IF;
    END IF;
  END IF;

  -- ── Evaluación Lado 2 (player2_id) ─────────────────────────────────────────
  SELECT COUNT(*) INTO v_p2_plant_count
    FROM public.match_actions
   WHERE room_id = p_room_id AND user_id = v_room.player2_id AND kind = 'plant';

  SELECT COUNT(*) INTO v_p2_missing_issued
    FROM public.match_actions
   WHERE room_id = p_room_id AND user_id = v_room.player2_id AND (issued_tick IS NULL OR issued_tick < 0);

  SELECT COUNT(*) INTO v_p2_invalid_seq
    FROM public.match_actions
   WHERE room_id = p_room_id AND user_id = v_room.player2_id AND (seq IS NULL OR seq < 0);

  IF v_p2_plant_count >= 3 AND v_p2_missing_issued = 0 AND v_p2_invalid_seq = 0 THEN
    v_p2_deck_val := public._validate_ranked_async_deck(v_room.p2_deck);
    IF (v_p2_deck_val->>'ok')::BOOLEAN = TRUE THEN
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'seq', seq,
          'tick', tick,
          'issuedTick', issued_tick,
          'kind', kind,
          'plantId', plant_id,
          'slot', slot,
          'lane', lane,
          'col', col
        ) ORDER BY issued_tick ASC, seq ASC
      ), '[]'::JSONB)
      INTO v_p2_actions
      FROM public.match_actions
      WHERE room_id = p_room_id AND user_id = v_room.player2_id AND kind IN ('plant', 'dig');

      v_p2_plan_val := public._validate_ranked_async_plan(v_p2_actions);
      IF (v_p2_plan_val->>'ok')::BOOLEAN = TRUE THEN
        SELECT COALESCE(elo_rating, 1000) INTO v_p2_rating
          FROM public.profiles WHERE id = v_room.player2_id;

        SELECT * INTO v_existing_opp2
          FROM public.ranked_async_opponents
         WHERE source_room_id = p_room_id AND source_side = 2;

        IF FOUND THEN
          IF v_existing_opp2.deck_snapshot = v_room.p2_deck
             AND v_existing_opp2.actions_snapshot = v_p2_actions
             AND v_existing_opp2.source_engine_version = 'auth-v1'
             AND v_existing_opp2.protocol_version = 'ranked-async-v1'
             AND v_existing_opp2.source_duration_ticks = v_duration
             AND v_existing_opp2.rating_snapshot = v_p2_rating
          THEN
            v_p2_status := 'IDENTICAL_EXISTING';
          ELSE
            v_p2_status := 'CONFLICT';
          END IF;
        ELSE
          v_p2_status := 'NEW';
        END IF;
      END IF;
    END IF;
  END IF;

  -- ── COMPROBACIÓN DE CONFLICTOS: All-or-nothing (0 escrituras si hay conflicto) ───
  IF v_p1_status = 'CONFLICT' OR v_p2_status = 'CONFLICT' THEN
    RETURN jsonb_build_object(
      'ok', FALSE,
      'reason', 'SOURCE_SNAPSHOT_CONFLICT',
      'capturedSides', 0,
      'alreadyExistingSides', 0,
      'notEligibleSides', 0,
      'conflictedSides', (CASE WHEN v_p1_status = 'CONFLICT' THEN 1 ELSE 0 END) + (CASE WHEN v_p2_status = 'CONFLICT' THEN 1 ELSE 0 END),
      'details', 'Conflicto detectado en snapshot existente para la sala fuente. No se realizaron cambios.'
    );
  END IF;

  -- ═══════════════════════════════════════════════════════════════════════════
  -- FASE 2: WRITE ONLY (SÓLO SI NO HUBO NINGÚN CONFLICTO)
  -- ═══════════════════════════════════════════════════════════════════════════

  -- Lado 1
  IF v_p1_status = 'NEW' THEN
    INSERT INTO public.ranked_async_opponents (
      source_room_id,
      source_side,
      rating_snapshot,
      deck_snapshot,
      actions_snapshot,
      source_engine_version,
      protocol_version,
      source_duration_ticks,
      active,
      created_at
    ) VALUES (
      p_room_id,
      1,
      v_p1_rating,
      v_room.p1_deck,
      v_p1_actions,
      'auth-v1',
      'ranked-async-v1',
      v_duration,
      TRUE,
      NOW()
    );
    v_captured_sides := v_captured_sides + 1;
  ELSIF v_p1_status = 'IDENTICAL_EXISTING' THEN
    v_already_existing_sides := v_already_existing_sides + 1;
  ELSE
    v_not_eligible_sides := v_not_eligible_sides + 1;
  END IF;

  -- Lado 2
  IF v_p2_status = 'NEW' THEN
    INSERT INTO public.ranked_async_opponents (
      source_room_id,
      source_side,
      rating_snapshot,
      deck_snapshot,
      actions_snapshot,
      source_engine_version,
      protocol_version,
      source_duration_ticks,
      active,
      created_at
    ) VALUES (
      p_room_id,
      2,
      v_p2_rating,
      v_room.p2_deck,
      v_p2_actions,
      'auth-v1',
      'ranked-async-v1',
      v_duration,
      TRUE,
      NOW()
    );
    v_captured_sides := v_captured_sides + 1;
  ELSIF v_p2_status = 'IDENTICAL_EXISTING' THEN
    v_already_existing_sides := v_already_existing_sides + 1;
  ELSE
    v_not_eligible_sides := v_not_eligible_sides + 1;
  END IF;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'capturedSides', v_captured_sides,
    'alreadyExistingSides', v_already_existing_sides,
    'notEligibleSides', v_not_eligible_sides,
    'conflictedSides', 0
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.capture_ranked_async_opponents_from_room(UUID) FROM anon, authenticated, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.capture_ranked_async_opponents_from_room(UUID) TO service_role;


-- -----------------------------------------------------------------------------
-- 3.1 BACKFILL IDEMPOTENTE DEL POOL INICIAL
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_rec RECORD;
  v_res JSONB;
  v_evaluated INTEGER := 0;
  v_captured  INTEGER := 0;
  v_existing  INTEGER := 0;
  v_skipped   INTEGER := 0;
  v_conflicted INTEGER := 0;
BEGIN
  FOR v_rec IN (
    SELECT id
      FROM public.game_rooms
     WHERE mode = 'ranked'
       AND is_async_match = FALSE
       AND settled_at IS NOT NULL
       AND verification_status = 'verified'
       AND player1_id IS NOT NULL
       AND player2_id IS NOT NULL
       AND engine_version = 'auth-v1'
       AND verification_payload IS NOT NULL
       AND verification_payload->>'resolutionSource' = 'authoritative_replay'
       AND verification_payload->>'consistent' = 'true'
       AND verification_payload->>'illegalCount' = '0'
       AND COALESCE(verification_payload->>'reason', '') NOT IN ('forfeit_p1', 'forfeit_p2', 'surrender')
       AND (verification_payload->>'ticks') ~ '^\d+$'
       AND (verification_payload->>'ticks')::INTEGER >= 300
       AND p1_deck IS NOT NULL
       AND p2_deck IS NOT NULL
     ORDER BY created_at DESC
     LIMIT 500
  ) LOOP
    v_evaluated := v_evaluated + 1;
    v_res := public.capture_ranked_async_opponents_from_room(v_rec.id);
    IF (v_res->>'ok')::BOOLEAN = TRUE THEN
      v_captured := v_captured + COALESCE((v_res->>'capturedSides')::INTEGER, 0);
      v_existing := v_existing + COALESCE((v_res->>'alreadyExistingSides')::INTEGER, 0);
    ELSE
      IF (v_res->>'reason') = 'SOURCE_SNAPSHOT_CONFLICT' THEN
        v_conflicted := v_conflicted + 1;
      END IF;
      v_skipped := v_skipped + 1;
    END IF;
  END LOOP;

  RAISE NOTICE 'Backfill Rivales Semilla V1: evaluadas=%, capturadas=%, existentes=%, omitidas=%, conflictos=%',
    v_evaluated, v_captured, v_existing, v_skipped, v_conflicted;
END;
$$;


-- -----------------------------------------------------------------------------
-- 4. SELECCIÓN DE RIVAL SEMILLA (RPC claim_ranked_async_opponent)
-- -----------------------------------------------------------------------------
/**
 * Solicita emparejamiento con un Rival Semilla tras >= 60 segundos en Ranked.
 * Garantiza PRIORIDAD HUMANA ABSOLUTA reintentando emparejamiento humano antes
 * de generar la sala asíncrona.
 * Valida defensivamente tanto el mazo del jugador como el candidato semilla.
 */
CREATE OR REPLACE FUNCTION public.claim_ranked_async_opponent()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid            UUID := auth.uid();
  v_queue          RECORD;
  v_matched_q      RECORD;
  v_waited         INTEGER;
  v_human_room     UUID;
  v_player_elo     INTEGER := 1000;
  v_player_deck    JSONB;
  v_deck_val       JSONB;
  v_candidate      RECORD;
  v_cand_deck_val  JSONB;
  v_cand_plan_val  JSONB;
  v_recent         UUID[];
  v_random_name    TEXT;
  v_random_avatar  TEXT;
  v_new_seed       INTEGER;
  v_new_room_id    UUID;
  v_names          TEXT[] := ARRAY[
    'LeafStorm', 'SolarFox', 'PeaKnight', 'GreenNova', 'GardenWolf',
    'BloomRush', 'NightLeaf', 'SunRider', 'FloraGuard', 'SporeStrike',
    'BrambleFang', 'MossRanger', 'ThornBlade', 'RootWalker', 'VineVanguard',
    'PetalFury', 'BarkTitan', 'FernStriker', 'ShadowSprout', 'TimberWolf'
  ];
  v_avatars        TEXT[] := ARRAY['1', '2', '3', '4', '5', '6', '7', '8'];
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  -- Bloquear fila de cola del usuario para evitar carreras concurrentes
  SELECT * INTO v_queue
    FROM public.matchmaking_queue
   WHERE user_id = v_uid AND status = 'searching'
   FOR UPDATE;

  IF NOT FOUND THEN
    -- Si ya fue emparejado en paralelo mientras entraba la llamada
    SELECT * INTO v_matched_q
      FROM public.matchmaking_queue
     WHERE user_id = v_uid AND status = 'matched'
     ORDER BY created_at DESC LIMIT 1;

    IF FOUND AND v_matched_q.matched_room_id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'matched', TRUE,
        'roomId', v_matched_q.matched_room_id,
        'isAsyncMatch', FALSE
      );
    END IF;

    RETURN jsonb_build_object('matched', FALSE, 'error', 'no_en_cola');
  END IF;

  -- Modo exclusivo Ranked
  IF v_queue.mode <> 'ranked' THEN
    RETURN jsonb_build_object('matched', FALSE, 'error', 'modo_no_permitido');
  END IF;

  -- Comprobar tiempo esperado (mínimo 60 segundos)
  v_waited := EXTRACT(EPOCH FROM (NOW() - v_queue.created_at))::INTEGER;
  IF v_waited < 60 THEN
    RETURN jsonb_build_object(
      'matched', FALSE,
      'error', 'tiempo_insuficiente',
      'waitedSeconds', v_waited
    );
  END IF;

  -- ── PRIORIDAD HUMANA ABSOLUTA ─────────────────────────────────────────────
  v_human_room := public._try_match(v_uid);
  IF v_human_room IS NOT NULL THEN
    RETURN jsonb_build_object(
      'matched', TRUE,
      'roomId', v_human_room,
      'isAsyncMatch', FALSE
    );
  END IF;

  -- ── VALIDAR MAZO ACTIVO DEL JUGADOR ───────────────────────────────────────
  v_player_deck := public._active_deck(v_uid);
  v_deck_val := public._validate_ranked_async_deck(v_player_deck);
  IF (v_deck_val->>'ok')::BOOLEAN IS NOT TRUE THEN
    RETURN jsonb_build_object(
      'matched', FALSE,
      'error', 'invalid_player_deck',
      'details', v_deck_val->>'details'
    );
  END IF;

  SELECT COALESCE(elo_rating, 1000) INTO v_player_elo
    FROM public.profiles WHERE id = v_uid;

  -- Lista de los últimos 10 Rivales Semilla usados por este jugador para anti-repetición
  SELECT COALESCE(array_agg(async_opponent_id), ARRAY[]::UUID[])
    INTO v_recent
    FROM (
      SELECT async_opponent_id
        FROM public.game_rooms
       WHERE player1_id = v_uid
         AND is_async_match = TRUE
         AND async_opponent_id IS NOT NULL
       ORDER BY created_at DESC
       LIMIT 10
    ) s;

  -- ── SELECCIÓN Y VALIDACIÓN DEFENSIVA DEL CANDIDATO SEMILLA ────────────────
  LOOP
    -- Tier 1: ±200 ELO (sin recientes)
    SELECT * INTO v_candidate
      FROM public.ranked_async_opponents
     WHERE active = TRUE
       AND source_engine_version = 'auth-v1'
       AND protocol_version = 'ranked-async-v1'
       AND rating_snapshot BETWEEN (v_player_elo - 200) AND (v_player_elo + 200)
       AND id <> ALL(v_recent)
     ORDER BY random()
     LIMIT 1;

    IF NOT FOUND THEN
      -- Tier 1 con recientes
      SELECT * INTO v_candidate
        FROM public.ranked_async_opponents
       WHERE active = TRUE
         AND source_engine_version = 'auth-v1'
         AND protocol_version = 'ranked-async-v1'
         AND rating_snapshot BETWEEN (v_player_elo - 200) AND (v_player_elo + 200)
       ORDER BY random()
       LIMIT 1;
    END IF;

    IF NOT FOUND THEN
      -- Tier 2: ±400 ELO (sin recientes)
      SELECT * INTO v_candidate
        FROM public.ranked_async_opponents
       WHERE active = TRUE
         AND source_engine_version = 'auth-v1'
         AND protocol_version = 'ranked-async-v1'
         AND rating_snapshot BETWEEN (v_player_elo - 400) AND (v_player_elo + 400)
         AND id <> ALL(v_recent)
       ORDER BY random()
       LIMIT 1;
    END IF;

    IF NOT FOUND THEN
      -- Tier 2 con recientes
      SELECT * INTO v_candidate
        FROM public.ranked_async_opponents
       WHERE active = TRUE
         AND source_engine_version = 'auth-v1'
         AND protocol_version = 'ranked-async-v1'
         AND rating_snapshot BETWEEN (v_player_elo - 400) AND (v_player_elo + 400)
       ORDER BY random()
       LIMIT 1;
    END IF;

    IF NOT FOUND THEN
      -- Tier 3: Cualquier candidato activo
      SELECT * INTO v_candidate
        FROM public.ranked_async_opponents
       WHERE active = TRUE
         AND source_engine_version = 'auth-v1'
         AND protocol_version = 'ranked-async-v1'
         AND id <> ALL(v_recent)
       ORDER BY random()
       LIMIT 1;
    END IF;

    IF NOT FOUND THEN
      -- Tier 3 con recientes
      SELECT * INTO v_candidate
        FROM public.ranked_async_opponents
       WHERE active = TRUE
         AND source_engine_version = 'auth-v1'
         AND protocol_version = 'ranked-async-v1'
       ORDER BY random()
       LIMIT 1;
    END IF;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('matched', FALSE, 'error', 'no_hay_candidato_semilla');
    END IF;

    -- Validar defensivamente el candidato antes de consumirlo
    v_cand_deck_val := public._validate_ranked_async_deck(v_candidate.deck_snapshot);
    v_cand_plan_val := public._validate_ranked_async_plan(v_candidate.actions_snapshot);

    IF (v_cand_deck_val->>'ok')::BOOLEAN = TRUE AND (v_cand_plan_val->>'ok')::BOOLEAN = TRUE THEN
      EXIT; -- Candidato validado exitosamente
    ELSE
      -- Candidato corrupto: desactivarlo para sanear el pool y reintentar
      UPDATE public.ranked_async_opponents SET active = FALSE WHERE id = v_candidate.id;
    END IF;
  END LOOP;

  -- ── GENERAR METADATOS INVENTADOS Y SEMILLA RNG NUEVA GARANTIZADA ──────────
  v_random_name := v_names[1 + floor(random() * array_length(v_names, 1))::INTEGER];
  v_random_avatar := v_avatars[1 + floor(random() * array_length(v_avatars, 1))::INTEGER];

  DECLARE
    v_source_seed INTEGER;
    v_seed_attempts INTEGER := 0;
  BEGIN
    SELECT seed INTO v_source_seed FROM public.game_rooms WHERE id = v_candidate.source_room_id;
    LOOP
      v_new_seed := FLOOR(100000 + random() * 899999)::INTEGER;
      v_seed_attempts := v_seed_attempts + 1;
      EXIT WHEN (v_source_seed IS NULL OR v_new_seed <> v_source_seed)
        AND NOT EXISTS (
          SELECT 1 FROM public.game_rooms
           WHERE async_opponent_id = v_candidate.id
             AND seed = v_new_seed
        );
      IF v_seed_attempts > 100 THEN
        RAISE EXCEPTION 'No se pudo generar una seed única para el Rival Semilla tras 100 intentos';
      END IF;
    END LOOP;
  END;

  -- ── CREACIÓN ATÓMICA DE SALA Y PLAN PRIVADO ───────────────────────────────
  INSERT INTO public.game_rooms (
    mode,
    player1_id,
    player2_id,
    seed,
    p1_deck,
    p2_deck,
    status,
    is_async_match,
    async_opponent_id,
    async_display_name,
    async_avatar_id,
    async_rating_snapshot,
    async_deck_snapshot,
    engine_version,
    created_at
  ) VALUES (
    'ranked',
    v_uid,
    NULL,
    v_new_seed,
    v_player_deck,
    v_candidate.deck_snapshot,
    'playing',
    TRUE,
    v_candidate.id,
    v_random_name,
    v_random_avatar,
    v_candidate.rating_snapshot,
    v_candidate.deck_snapshot,
    'auth-v1',
    NOW()
  ) RETURNING id INTO v_new_room_id;

  INSERT INTO public.ranked_async_room_plans (
    room_id,
    async_opponent_id,
    protocol_version,
    actions_snapshot,
    created_at
  ) VALUES (
    v_new_room_id,
    v_candidate.id,
    'ranked-async-v1',
    v_candidate.actions_snapshot,
    NOW()
  );

  UPDATE public.matchmaking_queue
     SET status = 'matched',
         matched_room_id = v_new_room_id,
         matched_at = NOW()
   WHERE id = v_queue.id;

  RETURN jsonb_build_object(
    'matched', TRUE,
    'roomId', v_new_room_id,
    'isAsyncMatch', TRUE
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_ranked_async_opponent() FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_ranked_async_opponent() TO authenticated;


-- -----------------------------------------------------------------------------
-- 5. LIQUIDACIÓN ELO ASÍNCRONA (RPC settle_verified_async_ranked_match)
-- -----------------------------------------------------------------------------
/**
 * Liquida una partida asíncrona de Ranked verificada por el árbitro autoritativo.
 * Actualiza ÚNICAMENTE el perfil del jugador real (player1_id).
 * Idempotente y protegido contra doble liquidación mediante row locks.
 */
CREATE OR REPLACE FUNCTION public.settle_verified_async_ranked_match(
  p_room_id UUID,
  p_winner_side SMALLINT,
  p_payload JSONB DEFAULT '{}'::JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_room        RECORD;
  v_elo_p1      INTEGER;
  v_mas         INTEGER := 0;
  v_menos       INTEGER := 0;
  v_cofre       JSONB := NULL;
  v_recent_wins INTEGER := 0;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Sólo service_role';
  END IF;

  IF p_winner_side NOT IN (1, 2) THEN
    RAISE EXCEPTION 'winner_side inválido (debe ser 1 o 2)';
  END IF;

  SELECT * INTO v_room FROM public.game_rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sala no encontrada'; END IF;

  IF COALESCE(v_room.is_async_match, FALSE) <> TRUE THEN
    RAISE EXCEPTION 'No es una partida asíncrona';
  END IF;

  IF v_room.mode <> 'ranked' THEN
    RAISE EXCEPTION 'Sólo para partidas Ranked';
  END IF;

  IF v_room.engine_version <> 'auth-v1' THEN
    RAISE EXCEPTION 'Sólo para salas con engine_version auth-v1';
  END IF;

  IF v_room.player1_id IS NULL OR v_room.player2_id IS NOT NULL THEN
    RAISE EXCEPTION 'Estructura de jugadores inválida para partida asíncrona';
  END IF;

  IF v_room.async_opponent_id IS NULL THEN
    RAISE EXCEPTION 'Falta async_opponent_id';
  END IF;

  -- ── COMPROBACIÓN INDEPENDIENTE DEL PLAN PRIVADO Y DECK SNAPSHOT ────────────
  DECLARE
    v_plan RECORD;
    v_opp RECORD;
    v_cand_deck_val JSONB;
    v_cand_plan_val JSONB;
  BEGIN
    SELECT * INTO v_plan FROM public.ranked_async_room_plans WHERE room_id = p_room_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'ASYNC_PLAN_MISSING';
    END IF;

    IF v_plan.protocol_version <> 'ranked-async-v1' THEN
      RAISE EXCEPTION 'PROTOCOL_VERSION_MISMATCH';
    END IF;

    IF v_plan.async_opponent_id <> v_room.async_opponent_id THEN
      RAISE EXCEPTION 'ASYNC_OPPONENT_MISMATCH';
    END IF;

    SELECT * INTO v_opp FROM public.ranked_async_opponents WHERE id = v_room.async_opponent_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'ASYNC_OPPONENT_NOT_FOUND';
    END IF;

    IF v_opp.source_engine_version <> 'auth-v1' THEN
      RAISE EXCEPTION 'SOURCE_ENGINE_VERSION_MISMATCH';
    END IF;

    IF v_opp.protocol_version <> 'ranked-async-v1' THEN
      RAISE EXCEPTION 'OPPONENT_PROTOCOL_MISMATCH';
    END IF;

    IF v_room.async_deck_snapshot <> v_opp.deck_snapshot THEN
      RAISE EXCEPTION 'ASYNC_DECK_SNAPSHOT_MISMATCH';
    END IF;

    IF v_room.p2_deck IS NOT NULL AND v_room.p2_deck <> v_opp.deck_snapshot THEN
      RAISE EXCEPTION 'P2_DECK_MIRROR_MISMATCH';
    END IF;

    v_cand_deck_val := public._validate_ranked_async_deck(v_room.async_deck_snapshot);
    IF (v_cand_deck_val->>'ok')::BOOLEAN IS NOT TRUE THEN
      RAISE EXCEPTION 'INVALID_ASYNC_DECK';
    END IF;

    v_cand_plan_val := public._validate_ranked_async_plan(v_plan.actions_snapshot);
    IF (v_cand_plan_val->>'ok')::BOOLEAN IS NOT TRUE THEN
      RAISE EXCEPTION 'INVALID_ASYNC_PLAN';
    END IF;
  END;

  IF v_room.settled_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', TRUE,
      'status', 'ya_liquidada',
      'winner', v_room.server_winner_id
    );
  END IF;

  IF v_room.verification_status <> 'verifying' THEN
    RAISE EXCEPTION 'La sala no está en verificación';
  END IF;

  SELECT elo_rating INTO v_elo_p1
    FROM public.profiles WHERE id = v_room.player1_id FOR UPDATE;

  IF p_winner_side = 1 THEN
    -- Victoria del jugador real
    v_mas := (public._elo_deltas(v_elo_p1)->>'win')::INTEGER;

    -- Anti-farming: no otorgar cofre si ya se ganó contra la misma Semilla en la última hora
    SELECT COUNT(*) INTO v_recent_wins
      FROM public.game_rooms
     WHERE player1_id = v_room.player1_id
       AND async_opponent_id = v_room.async_opponent_id
       AND status = 'p1_won'
       AND settled_at > NOW() - INTERVAL '1 hour'
       AND id <> p_room_id;

    IF v_recent_wins = 0 THEN
      v_cofre := public._award_victory_chest_for(v_room.player1_id);
    ELSE
      v_cofre := jsonb_build_object('awarded', FALSE, 'reason', 'anti_farming_same_opponent');
    END IF;

    UPDATE public.profiles
       SET elo_rating = elo_rating + v_mas
     WHERE id = v_room.player1_id;

    UPDATE public.game_rooms
       SET status = 'p1_won',
            settled_at = NOW(),
            verification_status = 'verified',
            verified_at = NOW(),
            server_winner_id = v_room.player1_id,
            verification_note = 'server_verified_async',
            verification_payload = COALESCE(p_payload, '{}'::JSONB)
     WHERE id = p_room_id;

    RETURN jsonb_build_object(
      'success', TRUE,
      'status', 'liquidada',
      'winner', v_room.player1_id,
      'winnerSide', 1,
      'mode', 'ranked',
      'eloGained', v_mas,
      'eloLost', 0,
      'chest', v_cofre,
      'isAsyncMatch', TRUE
    );
  ELSE
    -- Derrota del jugador real (Rival Semilla gana)
    v_menos := (public._elo_deltas(v_elo_p1)->>'lose')::INTEGER;

    UPDATE public.profiles
       SET elo_rating = GREATEST(0, elo_rating - v_menos)
     WHERE id = v_room.player1_id;

    UPDATE public.game_rooms
       SET status = 'p2_won',
            settled_at = NOW(),
            verification_status = 'verified',
            verified_at = NOW(),
            server_winner_id = NULL,
            verification_note = 'server_verified_async',
            verification_payload = COALESCE(p_payload, '{}'::JSONB)
     WHERE id = p_room_id;

    RETURN jsonb_build_object(
      'success', TRUE,
      'status', 'liquidada',
      'winner', NULL,
      'winnerSide', 2,
      'mode', 'ranked',
      'eloGained', 0,
      'eloLost', v_menos,
      'isAsyncMatch', TRUE
    );
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.settle_verified_async_ranked_match(UUID, SMALLINT, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_verified_async_ranked_match(UUID, SMALLINT, JSONB) TO service_role;


-- -----------------------------------------------------------------------------
-- 6. ACTUALIZAR game_room_info PARA PARTIDAS ASÍNCRONAS
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.game_room_info(p_room_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid  UUID := auth.uid();
  v_room RECORD;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  SELECT r.*,
         p1.username AS p1_nombre, p1.avatar_id AS p1_avatar, p1.elo_rating AS p1_elo,
         p2.username AS p2_nombre, p2.avatar_id AS p2_avatar, p2.elo_rating AS p2_elo
    INTO v_room
    FROM public.game_rooms r
    LEFT JOIN public.profiles p1 ON p1.id = r.player1_id
    LEFT JOIN public.profiles p2 ON p2.id = r.player2_id
   WHERE r.id = p_room_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'Sala no encontrada'; END IF;

  -- Comprobación de pertenencia segura con soporte para player2_id nulo en async
  IF v_room.is_async_match THEN
    IF v_uid <> v_room.player1_id THEN
      RAISE EXCEPTION 'No participas en esta partida';
    END IF;
  ELSE
    IF v_uid NOT IN (v_room.player1_id, v_room.player2_id) THEN
      RAISE EXCEPTION 'No participas en esta partida';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'id',        v_room.id,
    'mode',      v_room.mode,
    'seed',      v_room.seed,
    'status',    v_room.status,
    'colosseumBet', v_room.colosseum_bet,
    'p1Deck',    v_room.p1_deck,
    'p2Deck',    CASE WHEN v_room.is_async_match THEN v_room.async_deck_snapshot ELSE v_room.p2_deck END,
    'player1',   jsonb_build_object(
                   'id', v_room.player1_id,
                   'username', v_room.p1_nombre,
                   'avatarId', v_room.p1_avatar,
                   'elo', v_room.p1_elo
                 ),
    'player2',   CASE
                   WHEN v_room.is_async_match THEN
                     jsonb_build_object(
                       'id', COALESCE(v_room.async_opponent_id, '00000000-0000-0000-0000-000000000000'::UUID),
                       'username', v_room.async_display_name,
                       'avatarId', v_room.async_avatar_id,
                       'elo', v_room.async_rating_snapshot
                     )
                   ELSE
                     jsonb_build_object(
                       'id', v_room.player2_id,
                       'username', v_room.p2_nombre,
                       'avatarId', v_room.p2_avatar,
                       'elo', v_room.p2_elo
                     )
                 END,
    'iAm',       CASE WHEN v_uid = v_room.player1_id THEN 'p1' ELSE 'p2' END,
    'isAsyncMatch', COALESCE(v_room.is_async_match, FALSE),
    'startedAt', v_room.started_at,
    'serverNow', NOW()
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.game_room_info(UUID) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.game_room_info(UUID) TO authenticated;


-- -----------------------------------------------------------------------------
-- 6.1 FEED AUTORIZADO DE INTENCIONES ASÍNCRONAS (poll_ranked_async_intents)
-- -----------------------------------------------------------------------------
/**
 * Entrega las intenciones del Rival Semilla únicamente hasta la ventana de tiempo
 * autorizada (serverTick + 18 tics ≈ 600 ms).
 * El límite temporal depende EXCLUSIVAMENTE del reloj del servidor.
 * Lee las acciones desde ranked_async_room_plans.
 * Si el plan no existe o es corrupto, falla cerrado con error (NUNCA devuelve []).
 */
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

  -- Ventana autorizada estricta del servidor: serverTick + 18 tics (aprox 600 ms)
  v_max_reveal_tick := v_server_tick + 18;

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


-- -----------------------------------------------------------------------------
-- 7. ACTUALIZAR submit_match_action, report_match_result Y surrender_match
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_match_action(
  p_room_id     UUID,
  p_seq         INTEGER,
  p_tick        INTEGER,
  p_kind        TEXT,
  p_plant       TEXT DEFAULT NULL,
  p_lane        SMALLINT DEFAULT NULL,
  p_col         SMALLINT DEFAULT NULL,
  p_slot        SMALLINT DEFAULT NULL,
  p_issued_tick INTEGER DEFAULT NULL,
  p_target_id   TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid       UUID := auth.uid();
  v_room      RECORD;
  v_tic_ahora INTEGER;
  v_atras     INTEGER;
  v_adelante  INTEGER;
  v_tope      INTEGER;
  v_cuantas   INTEGER;
  v_id        BIGINT;
  v_inicio    TIMESTAMPTZ;
  v_existente RECORD;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF p_seq IS NULL OR p_seq < 0 THEN RAISE EXCEPTION 'seq inválido'; END IF;
  IF p_tick IS NULL OR p_tick < 0 THEN RAISE EXCEPTION 'tick inválido'; END IF;
  IF p_kind NOT IN ('plant', 'dig', 'collect') THEN RAISE EXCEPTION 'tipo de acción inválido'; END IF;

  SELECT * INTO v_room
    FROM public.game_rooms
   WHERE id = p_room_id
   FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Sala no encontrada'; END IF;

  IF v_room.is_async_match THEN
    IF v_uid <> v_room.player1_id THEN
      RAISE EXCEPTION 'No participas en esta partida';
    END IF;
  ELSE
    IF v_uid NOT IN (v_room.player1_id, v_room.player2_id) THEN
      RAISE EXCEPTION 'No participas en esta partida';
    END IF;
  END IF;

  IF v_room.settled_at IS NOT NULL THEN RAISE EXCEPTION 'Partida ya liquidada'; END IF;
  IF v_room.status <> 'playing' THEN RAISE EXCEPTION 'La partida no está activa'; END IF;
  IF v_room.verification_status IN ('verifying', 'verified', 'failed') THEN
    RAISE EXCEPTION 'La partida ya está cerrada para verificación';
  END IF;

  -- ── IDEMPOTENCIA FUERTE POR (room_id, user_id, seq) ───────────────────────
  SELECT * INTO v_existente
    FROM public.match_actions
   WHERE room_id = p_room_id AND user_id = v_uid AND seq = p_seq;

  IF FOUND THEN
    IF v_existente.tick = p_tick
       AND v_existente.kind = p_kind
       AND v_existente.plant_id IS NOT DISTINCT FROM p_plant
       AND v_existente.lane IS NOT DISTINCT FROM p_lane
       AND v_existente.col IS NOT DISTINCT FROM p_col
       AND v_existente.slot IS NOT DISTINCT FROM p_slot
       AND v_existente.issued_tick IS NOT DISTINCT FROM p_issued_tick
       AND v_existente.target_id IS NOT DISTINCT FROM p_target_id
    THEN
      RETURN jsonb_build_object('ok', TRUE, 'duplicate', TRUE, 'id', v_existente.id);
    END IF;
    RAISE EXCEPTION 'seq ya usado con otra acción';
  END IF;

  -- ── VENTANA DE TIEMPO Y LÍMITES ───────────────────────────────────────────
  SELECT COALESCE((SELECT value::INTEGER FROM public.shop_config
                    WHERE key = 'ma_tolerancia_tics_atras'), 30)
    INTO v_atras;
  SELECT COALESCE((SELECT value::INTEGER FROM public.shop_config
                    WHERE key = 'ma_tolerancia_tics_adelante'), 90)
    INTO v_adelante;
  SELECT COALESCE((SELECT value::INTEGER FROM public.shop_config
                    WHERE key = 'ma_max_acciones_por_jugador'), 400)
    INTO v_tope;

  IF v_room.engine_version = 'auth-v1' THEN
    v_adelante := LEAST(v_adelante, 12);
    IF v_room.mode = 'colosseum' THEN
      v_atras := LEAST(v_atras, 30);
    ELSE
      v_atras := LEAST(v_atras, 36);
    END IF;
  END IF;

  v_inicio := COALESCE(v_room.started_at, v_room.created_at);
  v_tic_ahora := GREATEST(
    0,
    FLOOR(EXTRACT(EPOCH FROM (clock_timestamp() - v_inicio)) * 1000.0 / 33.0)::INTEGER
  );

  -- ── VALIDACIÓN ESTRICTA AUTH-V1 ───────────────────────────────────────────
  IF v_room.engine_version = 'auth-v1' THEN
    IF p_issued_tick IS NULL OR p_issued_tick < 0 THEN
      RAISE EXCEPTION 'issued_tick obligatorio y no negativo en auth-v1';
    END IF;

    IF p_issued_tick < v_tic_ahora - v_atras OR p_issued_tick > v_tic_ahora + v_adelante THEN
      RAISE EXCEPTION 'issued_tick fuera de ventana (cliente %, servidor %)', p_issued_tick, v_tic_ahora;
    END IF;

    IF p_kind IN ('plant', 'dig') THEN
      IF p_tick <> p_issued_tick + 6 THEN
        RAISE EXCEPTION 'margen de red inválido: tick debe ser issued_tick + 6';
      END IF;
      IF p_lane IS NULL OR p_lane NOT BETWEEN 0 AND 2 THEN
        RAISE EXCEPTION 'lane inválido (debe ser 0..2)';
      END IF;
      IF p_col IS NULL OR p_col NOT BETWEEN 0 AND 5 THEN
        RAISE EXCEPTION 'col fuera de rango (debe ser 0..5)';
      END IF;
    ELSE
      -- collect
      IF p_tick <> p_issued_tick THEN
        RAISE EXCEPTION 'collect debe ocurrir en issued_tick';
      END IF;
    END IF;

    IF p_kind = 'plant' THEN
      IF p_plant IS NULL THEN RAISE EXCEPTION 'plant_id obligatorio en plant'; END IF;
      IF p_slot IS NULL OR p_slot NOT BETWEEN 0 AND 5 THEN RAISE EXCEPTION 'slot obligatorio (0..5) en plant'; END IF;
      IF NOT public._carta_en_slot(p_room_id, v_uid, p_slot, p_plant) THEN
        RAISE EXCEPTION 'esa carta no pertenece a ese slot de tu mazo';
      END IF;
      IF p_target_id IS NOT NULL THEN RAISE EXCEPTION 'plant no usa target_id'; END IF;
    ELSIF p_kind = 'dig' THEN
      IF p_plant IS NOT NULL OR p_slot IS NOT NULL OR p_target_id IS NOT NULL THEN
        RAISE EXCEPTION 'dig tiene campos incompatibles';
      END IF;
    ELSIF p_kind = 'collect' THEN
      IF p_target_id IS NULL OR char_length(p_target_id) NOT BETWEEN 1 AND 160 THEN
        RAISE EXCEPTION 'target_id obligatorio y no vacío en collect';
      END IF;
      IF p_plant IS NOT NULL OR p_lane IS NOT NULL OR p_col IS NOT NULL OR p_slot IS NOT NULL THEN
        RAISE EXCEPTION 'collect tiene campos incompatibles';
      END IF;
    END IF;
  ELSE
    -- Legacy compatibility
    IF p_tick < (v_tic_ahora - v_atras) OR p_tick > (v_tic_ahora + v_adelante) THEN
      RAISE EXCEPTION 'tick fuera de ventana';
    END IF;
    IF p_kind = 'plant' AND (p_plant IS NULL OR NOT public._carta_en_mazo(p_room_id, v_uid, p_plant)) THEN
      RAISE EXCEPTION 'esa carta no está en tu mazo';
    END IF;
  END IF;

  SELECT COUNT(*) INTO v_cuantas
    FROM public.match_actions
   WHERE room_id = p_room_id AND user_id = v_uid;

  IF v_cuantas >= v_tope THEN
    RAISE EXCEPTION 'Límite de acciones alcanzado';
  END IF;

  INSERT INTO public.match_actions
    (room_id, user_id, seq, tick, issued_tick, server_tick, kind, plant_id, lane, col, slot, target_id)
  VALUES
    (p_room_id, v_uid, p_seq, p_tick, p_issued_tick, v_tic_ahora, p_kind, p_plant, p_lane, p_col, p_slot, p_target_id)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', TRUE, 'id', v_id, 'serverTick', v_tic_ahora);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.submit_match_action(
  UUID, INTEGER, INTEGER, TEXT, TEXT, SMALLINT, SMALLINT, SMALLINT, INTEGER, TEXT
) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_match_action(
  UUID, INTEGER, INTEGER, TEXT, TEXT, SMALLINT, SMALLINT, SMALLINT, INTEGER, TEXT
) TO authenticated;


CREATE OR REPLACE FUNCTION public.report_match_result(p_room_id UUID, p_winner_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid  UUID := auth.uid();
  v_room RECORD;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  SELECT * INTO v_room FROM public.game_rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sala no encontrada'; END IF;

  IF v_room.is_async_match THEN
    IF v_uid <> v_room.player1_id THEN
      RAISE EXCEPTION 'No participas en esta partida';
    END IF;
  ELSE
    IF v_uid NOT IN (v_room.player1_id, v_room.player2_id) THEN
      RAISE EXCEPTION 'No participas en esta partida';
    END IF;
  END IF;

  IF v_room.settled_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', TRUE, 'status', 'ya_liquidada');
  END IF;

  -- Para partidas asíncronas, el reporte del cliente es sólo solicitud de verificación (NO autoritativo)
  IF v_room.is_async_match THEN
    UPDATE public.game_rooms
       SET verification_requested_at = COALESCE(verification_requested_at, NOW())
     WHERE id = p_room_id;
    RETURN jsonb_build_object(
      'success', TRUE,
      'status', 'verificacion_pendiente',
      'authoritative', TRUE
    );
  END IF;

  -- Partidas humanas
  IF v_uid = v_room.player1_id THEN
    IF v_room.p1_reported_winner IS NOT NULL AND v_room.p1_reported_winner <> p_winner_id THEN
      RAISE EXCEPTION 'No puedes cambiar tu reporte';
    END IF;
    UPDATE public.game_rooms SET p1_reported_winner = p_winner_id WHERE id = p_room_id;
    v_room.p1_reported_winner := p_winner_id;
  ELSE
    IF v_room.p2_reported_winner IS NOT NULL AND v_room.p2_reported_winner <> p_winner_id THEN
      RAISE EXCEPTION 'No puedes cambiar tu reporte';
    END IF;
    UPDATE public.game_rooms SET p2_reported_winner = p_winner_id WHERE id = p_room_id;
    v_room.p2_reported_winner := p_winner_id;
  END IF;

  IF v_room.engine_version = 'auth-v1' THEN
    UPDATE public.game_rooms
       SET verification_requested_at = COALESCE(verification_requested_at, NOW())
     WHERE id = p_room_id;
    RETURN jsonb_build_object(
      'success', TRUE,
      'status', 'verificacion_pendiente',
      'authoritative', TRUE
    );
  END IF;

  IF v_room.p1_reported_winner IS NULL OR v_room.p2_reported_winner IS NULL THEN
    RETURN jsonb_build_object('success', TRUE, 'status', 'esperando_al_rival');
  END IF;

  IF v_room.p1_reported_winner <> v_room.p2_reported_winner THEN
    UPDATE public.game_rooms SET status = 'draw', settled_at = NOW() WHERE id = p_room_id;
    RETURN jsonb_build_object('success', FALSE, 'status', 'resultado_en_disputa', 'refunded', TRUE);
  END IF;

  RETURN public._settle_room(p_room_id, v_room.p1_reported_winner);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.report_match_result(UUID, UUID) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.report_match_result(UUID, UUID) TO authenticated;


CREATE OR REPLACE FUNCTION public.surrender_match(p_room_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_room RECORD;
  v_rival UUID;
  v_elo_p1 INTEGER;
  v_menos INTEGER := 0;
  v_result JSONB;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  SELECT * INTO v_room FROM public.game_rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sala no encontrada'; END IF;

  IF v_room.is_async_match THEN
    IF v_uid <> v_room.player1_id THEN
      RAISE EXCEPTION 'No participas en esta partida';
    END IF;
  ELSE
    IF v_uid NOT IN (v_room.player1_id, v_room.player2_id) THEN
      RAISE EXCEPTION 'No participas en esta partida';
    END IF;
  END IF;

  IF v_room.settled_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', TRUE, 'status', 'ya_liquidada');
  END IF;

  IF v_room.verification_status IN ('verifying', 'failed') THEN
    RAISE EXCEPTION 'La partida está cerrada para verificación';
  END IF;

  -- ── CASO ASÍNCRONO ────────────────────────────────────────────────────────
  IF v_room.is_async_match THEN
    SELECT elo_rating INTO v_elo_p1
      FROM public.profiles WHERE id = v_uid FOR UPDATE;

    v_menos := (public._elo_deltas(v_elo_p1)->>'lose')::INTEGER;

    UPDATE public.profiles
       SET elo_rating = GREATEST(0, elo_rating - v_menos)
     WHERE id = v_uid;

    UPDATE public.game_rooms
       SET status = 'p2_won',
           settled_at = NOW(),
           server_winner_id = NULL,
           verification_status = 'verified',
           verified_at = NOW(),
           verification_note = 'server_verified_surrender',
           verification_payload = jsonb_build_object(
             'reason', 'surrender',
             'surrenderedBy', v_uid
           )
     WHERE id = p_room_id;

    RETURN jsonb_build_object(
      'success', TRUE,
      'status', 'liquidada',
      'winner', NULL,
      'mode', 'ranked',
      'eloGained', 0,
      'eloLost', v_menos,
      'authoritative', TRUE,
      'reason', 'surrender',
      'isAsyncMatch', TRUE
    );
  END IF;

  -- ── CASO HUMANO VS HUMANO ──────────────────────────────────────────────────
  v_rival := CASE WHEN v_uid = v_room.player1_id
                  THEN v_room.player2_id ELSE v_room.player1_id END;

  UPDATE public.game_rooms
     SET p1_reported_winner = v_rival,
         p2_reported_winner = v_rival
   WHERE id = p_room_id;

  v_result := public._settle_room(p_room_id, v_rival);

  IF v_room.engine_version = 'auth-v1' THEN
    UPDATE public.game_rooms
       SET verification_status = 'verified',
           verification_requested_at = COALESCE(verification_requested_at, NOW()),
           verification_started_at = COALESCE(verification_started_at, NOW()),
           verified_at = NOW(),
           server_winner_id = v_rival,
           verification_note = 'server_verified_surrender',
           verification_payload = jsonb_build_object(
             'reason', 'surrender',
             'surrenderedBy', v_uid
           )
     WHERE id = p_room_id;
  END IF;

  RETURN v_result || jsonb_build_object(
    'authoritative', v_room.engine_version = 'auth-v1',
    'reason', 'surrender'
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.surrender_match(UUID) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.surrender_match(UUID) TO authenticated;


-- -----------------------------------------------------------------------------
-- 8. ROOM_RESULT SOPORTA PARTIDAS ASÍNCRONAS SIN PLAYER2_ID
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.room_result(p_room_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_room RECORD;
  v_ganador UUID;
  v_i_won BOOLEAN := FALSE;
  v_no_winner BOOLEAN := FALSE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  SELECT * INTO v_room FROM public.game_rooms WHERE id = p_room_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sala no encontrada'; END IF;

  IF v_room.is_async_match THEN
    IF v_uid <> v_room.player1_id THEN
      RAISE EXCEPTION 'No participas en esta partida';
    END IF;
  ELSE
    IF v_uid NOT IN (v_room.player1_id, v_room.player2_id) THEN
      RAISE EXCEPTION 'No participas en esta partida';
    END IF;
  END IF;

  IF v_room.settled_at IS NULL THEN
    RETURN jsonb_build_object(
      'ended', FALSE,
      'status', v_room.status,
      'verificationStatus', v_room.verification_status,
      'verificationNote', v_room.verification_note,
      'isAsyncMatch', COALESCE(v_room.is_async_match, FALSE)
    );
  END IF;

  IF v_room.is_async_match THEN
    v_i_won := (v_room.status = 'p1_won');
    v_no_winner := (v_room.status NOT IN ('p1_won', 'p2_won'));
    v_ganador := CASE WHEN v_room.status = 'p1_won' THEN v_room.player1_id ELSE NULL END;

    RETURN jsonb_build_object(
      'ended', TRUE,
      'status', v_room.status,
      'winner', v_ganador,
      'winnerSide', CASE WHEN v_room.status = 'p1_won' THEN 1 WHEN v_room.status = 'p2_won' THEN 2 ELSE NULL END,
      'iWon', v_i_won,
      'noWinner', v_no_winner,
      'verificationStatus', v_room.verification_status,
      'authoritative', TRUE,
      'isAsyncMatch', TRUE
    );
  END IF;

  v_ganador := COALESCE(
    v_room.server_winner_id,
    CASE v_room.status
      WHEN 'p1_won' THEN v_room.player1_id
      WHEN 'p2_won' THEN v_room.player2_id
      ELSE NULL
    END
  );

  RETURN jsonb_build_object(
    'ended', TRUE,
    'status', v_room.status,
    'winner', v_ganador,
    'winnerSide', CASE WHEN v_room.status = 'p1_won' THEN 1 WHEN v_room.status = 'p2_won' THEN 2 ELSE NULL END,
    'iWon', v_ganador IS NOT NULL AND v_ganador = v_uid,
    'noWinner', v_ganador IS NULL,
    'verificationStatus', v_room.verification_status,
    'authoritative', v_room.engine_version = 'auth-v1',
    'isAsyncMatch', FALSE
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.room_result(UUID) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.room_result(UUID) TO authenticated;

INSERT INTO public._migration_audit(fase, detalle)
VALUES ('36_rival_semilla_ranked_v1', jsonb_build_object(
  'descripcion', 'Implementacion autoritativa de Rival Semilla Ranked V1 y liquidacion asincrona estricta',
  'protocol_version', 'ranked-async-v1',
  'aplicada_en', NOW()
)) ON CONFLICT DO NOTHING;
