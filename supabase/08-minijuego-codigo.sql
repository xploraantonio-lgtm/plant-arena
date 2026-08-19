-- =============================================================================
-- PLANT ARENA · MINIJUEGO DEL CÓDIGO SECRETO, POR RONDAS
--
-- Idempotente.
--
-- POR QUÉ SE REESCRIBE DESDE CERO
--   La versión del cliente generaba el código secreto en el navegador
--   (generateRandomSecretCode) y lo guardaba en
--   localStorage['plant_arena_lottery_secret_code']. El jugador tenía la
--   respuesta a la vista: leerla, acertar a la primera y cobrar 20 gemas, tantas
--   veces como quisiera. Era el agujero más directo de todo el proyecto.
--
-- REGLAS NUEVAS
--   · Rondas. El primero que llega al 100% cierra la ronda.
--   · El administrador abre la ronda siguiente. El secreto lo GENERA el
--     servidor: ni el administrador lo conoce, así que no puede jugar con
--     ventaja.
--   · Clasificación pública con el % de acercamiento de cada jugador, SIN
--     revelar las secuencias que probó.
--   · Bote de 20 gemas: 10 / 6 / 4 para 1.º, 2.º y 3.º.
--   · Empates: el importe de ese puesto se reparte entre los empatados.
--     6 gemas entre 2 → 3 cada uno. Entre 3 → 2 cada uno. gems_balance es
--     NUMERIC(12,2), así que los decimales no son problema.
--   · Historial propio de intentos, visible sólo para su dueño.
--   · Comprar intentos: 1 gema → 2 intentos, cobrado por el servidor.
--
-- CÓMO SE MIDE EL ACERCAMIENTO
--   score = aciertos_exactos * 2 + aciertos_de_planta_en_otra_posicion
--   pct   = score / 8 * 100
--   Da 9 escalones de 12,5 en 12,5, y el 100% sólo se alcanza con los 4 exactos.
--   Si quieres otra fórmula, se cambia en _score_secret_guess() y el historial
--   antiguo se conserva porque el pct queda guardado en cada intento.
-- =============================================================================

BEGIN;

-- =============================================================================
-- 1. RONDAS
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.secret_code_rounds (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    round_number    INTEGER NOT NULL,
    -- El secreto NUNCA se expone. Más abajo se revoca el SELECT de esta columna
    -- para anon y authenticated: ni con la sesión de un jugador se puede leer.
    secret          TEXT[] NOT NULL CHECK (array_length(secret, 1) = 4),
    status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','finished','cancelled')),
    free_attempts   INTEGER NOT NULL DEFAULT 3 CHECK (free_attempts >= 0),
    prize_pool_gems NUMERIC(12,2) NOT NULL DEFAULT 20 CHECK (prize_pool_gems >= 0),
    prize_1st       NUMERIC(12,2) NOT NULL DEFAULT 10 CHECK (prize_1st >= 0),
    prize_2nd       NUMERIC(12,2) NOT NULL DEFAULT 6  CHECK (prize_2nd  >= 0),
    prize_3rd       NUMERIC(12,2) NOT NULL DEFAULT 4  CHECK (prize_3rd  >= 0),
    winner_id       UUID REFERENCES public.profiles(id),
    created_by      UUID REFERENCES public.profiles(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at     TIMESTAMPTZ,
    CHECK (prize_1st + prize_2nd + prize_3rd <= prize_pool_gems)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_scr_round_number ON public.secret_code_rounds (round_number);
-- Como máximo una ronda abierta a la vez.
CREATE UNIQUE INDEX IF NOT EXISTS idx_scr_una_abierta
  ON public.secret_code_rounds ((status)) WHERE status = 'open';

ALTER TABLE public.secret_code_rounds ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "scr_read" ON public.secret_code_rounds;
CREATE POLICY "scr_read" ON public.secret_code_rounds FOR SELECT USING (TRUE);

-- Blindaje de columna: el secreto no se lee ni con sesión válida.
REVOKE SELECT ON public.secret_code_rounds FROM anon, authenticated;
GRANT  SELECT (id, round_number, status, free_attempts, prize_pool_gems,
               prize_1st, prize_2nd, prize_3rd, winner_id, created_at, finished_at)
  ON public.secret_code_rounds TO anon, authenticated;


-- =============================================================================
-- 2. INTENTOS
--    La secuencia probada se guarda para el historial del propio jugador, y la
--    política sólo deja ver los suyos. La clasificación pública sale de una RPC
--    que no devuelve secuencias.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.secret_code_attempts (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    round_id       UUID NOT NULL REFERENCES public.secret_code_rounds(id) ON DELETE CASCADE,
    user_id        UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    sequence       TEXT[] NOT NULL CHECK (array_length(sequence, 1) = 4),
    exact_count    INTEGER NOT NULL CHECK (exact_count BETWEEN 0 AND 4),
    wrong_pos_count INTEGER NOT NULL CHECK (wrong_pos_count BETWEEN 0 AND 4),
    pct            NUMERIC(5,2) NOT NULL CHECK (pct BETWEEN 0 AND 100),
    was_free       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sca_round_user ON public.secret_code_attempts (round_id, user_id);
CREATE INDEX IF NOT EXISTS idx_sca_round_pct  ON public.secret_code_attempts (round_id, pct DESC);

ALTER TABLE public.secret_code_attempts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sca_select_own" ON public.secret_code_attempts;
CREATE POLICY "sca_select_own" ON public.secret_code_attempts
  FOR SELECT USING (auth.uid() = user_id);
-- Sin políticas de escritura: sólo la RPC inserta.


-- =============================================================================
-- 3. INTENTOS DISPONIBLES POR JUGADOR Y RONDA
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.secret_code_entries (
    round_id        UUID NOT NULL REFERENCES public.secret_code_rounds(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    free_used       INTEGER NOT NULL DEFAULT 0 CHECK (free_used >= 0),
    extra_attempts  INTEGER NOT NULL DEFAULT 0 CHECK (extra_attempts >= 0),
    PRIMARY KEY (round_id, user_id)
);

ALTER TABLE public.secret_code_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sce_select_own" ON public.secret_code_entries;
CREATE POLICY "sce_select_own" ON public.secret_code_entries
  FOR SELECT USING (auth.uid() = user_id);


-- =============================================================================
-- 4. PAGOS
--    Se guarda quién cobró qué y por qué puesto, para que el reparto sea
--    auditable y no haya que recalcularlo nunca.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.secret_code_payouts (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    round_id    UUID NOT NULL REFERENCES public.secret_code_rounds(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    place       INTEGER NOT NULL CHECK (place BETWEEN 1 AND 3),
    tied_with   INTEGER NOT NULL DEFAULT 1 CHECK (tied_with >= 1),
    pct         NUMERIC(5,2) NOT NULL,
    gems        NUMERIC(12,2) NOT NULL CHECK (gems >= 0),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (round_id, user_id)
);

ALTER TABLE public.secret_code_payouts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "scp_read" ON public.secret_code_payouts;
-- Los pagos son públicos: es lo que hace creíble la clasificación.
CREATE POLICY "scp_read" ON public.secret_code_payouts FOR SELECT USING (TRUE);


-- =============================================================================
-- 5. PUNTUACIÓN DE UN INTENTO (interno)
--    Conteo estilo Mastermind: primero los exactos, y los aciertos de posición
--    equivocada se cuentan sobre lo que sobra, para no contar dos veces la misma
--    planta.
-- =============================================================================
CREATE OR REPLACE FUNCTION public._score_secret_guess(p_secret TEXT[], p_guess TEXT[])
RETURNS TABLE (exact_count INTEGER, wrong_pos_count INTEGER, pct NUMERIC)
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_exact  INTEGER := 0;
  v_wrong  INTEGER := 0;
  v_sec    TEXT[]  := p_secret;
  v_gue    TEXT[]  := p_guess;
  i        INTEGER;
  j        INTEGER;
BEGIN
  -- Paso 1: exactos. Se marcan como consumidos poniéndolos a NULL.
  FOR i IN 1..4 LOOP
    IF v_gue[i] IS NOT NULL AND v_sec[i] IS NOT NULL AND v_gue[i] = v_sec[i] THEN
      v_exact := v_exact + 1;
      v_sec[i] := NULL;
      v_gue[i] := NULL;
    END IF;
  END LOOP;

  -- Paso 2: planta correcta en posición equivocada, sobre los restos.
  FOR i IN 1..4 LOOP
    IF v_gue[i] IS NULL THEN CONTINUE; END IF;
    FOR j IN 1..4 LOOP
      IF v_sec[j] IS NOT NULL AND v_sec[j] = v_gue[i] THEN
        v_wrong := v_wrong + 1;
        v_sec[j] := NULL;
        v_gue[i] := NULL;
        EXIT;
      END IF;
    END LOOP;
  END LOOP;

  -- Un exacto vale el doble que uno mal colocado. Máximo 8 → 100%.
  RETURN QUERY SELECT v_exact, v_wrong,
                      ROUND(((v_exact * 2 + v_wrong)::NUMERIC / 8) * 100, 2);
END;
$$;

REVOKE EXECUTE ON FUNCTION public._score_secret_guess(TEXT[], TEXT[])
  FROM anon, authenticated, PUBLIC;


-- =============================================================================
-- 6. REPARTO DEL BOTE (interno)
--    Agrupa por pct distinto de mayor a menor, y reparte el importe de cada
--    puesto entre los empatados de ese grupo. Sólo cuenta el mejor intento de
--    cada jugador.
-- =============================================================================
CREATE OR REPLACE FUNCTION public._settle_secret_round(p_round_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_round   RECORD;
  v_grupo   RECORD;
  v_importe NUMERIC;
  v_cada    NUMERIC;
  v_res     JSONB := '[]'::JSONB;
  v_pagado  NUMERIC := 0;
BEGIN
  SELECT * INTO v_round FROM public.secret_code_rounds WHERE id = p_round_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ronda no encontrada'; END IF;

  FOR v_grupo IN
    WITH mejor AS (
      -- El mejor intento de cada jugador
      SELECT user_id, MAX(pct) AS mejor_pct
        FROM public.secret_code_attempts
       WHERE round_id = p_round_id
       GROUP BY user_id
    ), grupos AS (
      -- Un puesto por cada pct distinto, de mayor a menor
      SELECT mejor_pct,
             DENSE_RANK() OVER (ORDER BY mejor_pct DESC) AS puesto,
             array_agg(user_id) AS jugadores,
             count(*) AS empatados
        FROM mejor
       GROUP BY mejor_pct
    )
    SELECT * FROM grupos WHERE puesto <= 3 ORDER BY puesto
  LOOP
    v_importe := CASE v_grupo.puesto
                   WHEN 1 THEN v_round.prize_1st
                   WHEN 2 THEN v_round.prize_2nd
                   ELSE        v_round.prize_3rd
                 END;

    -- Reparto entre empatados. gems_balance es NUMERIC(12,2): se redondea a 2
    -- decimales, y lo que sobre por el redondeo se queda sin repartir.
    v_cada := ROUND(v_importe / v_grupo.empatados, 2);

    INSERT INTO public.secret_code_payouts
      (round_id, user_id, place, tied_with, pct, gems)
    SELECT p_round_id, u, v_grupo.puesto, v_grupo.empatados, v_grupo.mejor_pct, v_cada
      FROM unnest(v_grupo.jugadores) AS u
    ON CONFLICT (round_id, user_id) DO NOTHING;

    UPDATE public.profiles p
       SET gems_balance = gems_balance + v_cada
     WHERE p.id = ANY(v_grupo.jugadores);

    INSERT INTO public.transactions (user_id, type, amount_gems, description, status)
    SELECT u, 'deposit', v_cada,
           'Código secreto ronda #' || v_round.round_number ||
           ' · puesto ' || v_grupo.puesto ||
           CASE WHEN v_grupo.empatados > 1
                THEN ' (empate entre ' || v_grupo.empatados || ')' ELSE '' END,
           'completed'
      FROM unnest(v_grupo.jugadores) AS u;

    v_pagado := v_pagado + (v_cada * v_grupo.empatados);

    v_res := v_res || jsonb_build_object(
      'place', v_grupo.puesto,
      'pct', v_grupo.mejor_pct,
      'players', v_grupo.empatados,
      'gemsEach', v_cada
    );
  END LOOP;

  RETURN jsonb_build_object('payouts', v_res, 'totalPaid', v_pagado);
END;
$$;

REVOKE EXECUTE ON FUNCTION public._settle_secret_round(UUID)
  FROM anon, authenticated, PUBLIC;


-- =============================================================================
-- 7. ABRIR RONDA (sólo administrador)
--    El secreto lo genera el servidor y no se devuelve a nadie. Ni el
--    administrador que abre la ronda lo conoce, así que puede jugar sin ventaja.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.admin_open_secret_code_round(
  p_prize_pool    NUMERIC DEFAULT 20,
  p_prize_1st     NUMERIC DEFAULT 10,
  p_prize_2nd     NUMERIC DEFAULT 6,
  p_prize_3rd     NUMERIC DEFAULT 4,
  p_free_attempts INTEGER DEFAULT 3
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid    UUID := auth.uid();
  v_num    INTEGER;
  v_secret TEXT[];
  v_id     UUID;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF NOT public.current_user_is_admin() THEN
    RAISE EXCEPTION 'Sólo un administrador puede abrir una ronda';
  END IF;

  IF p_prize_1st + p_prize_2nd + p_prize_3rd > p_prize_pool THEN
    RAISE EXCEPTION 'Los premios (% + % + %) superan el bote de %',
      p_prize_1st, p_prize_2nd, p_prize_3rd, p_prize_pool;
  END IF;

  IF EXISTS (SELECT 1 FROM public.secret_code_rounds WHERE status = 'open') THEN
    RAISE EXCEPTION 'Ya hay una ronda abierta. Ciérrala antes de abrir otra.';
  END IF;

  SELECT COALESCE(MAX(round_number), 0) + 1 INTO v_num FROM public.secret_code_rounds;

  -- 4 plantas distintas al azar del catálogo. Lo hace Postgres: el secreto no
  -- pasa por ningún navegador en ningún momento.
  SELECT array_agg(plant_id) INTO v_secret
    FROM (SELECT plant_id FROM public.plant_catalog ORDER BY random() LIMIT 4) z;

  IF array_length(v_secret, 1) <> 4 THEN
    RAISE EXCEPTION 'El catálogo necesita al menos 4 plantas';
  END IF;

  INSERT INTO public.secret_code_rounds
    (round_number, secret, status, free_attempts, prize_pool_gems,
     prize_1st, prize_2nd, prize_3rd, created_by)
  VALUES
    (v_num, v_secret, 'open', p_free_attempts, p_prize_pool,
     p_prize_1st, p_prize_2nd, p_prize_3rd, v_uid)
  RETURNING id INTO v_id;

  -- Nótese que NO se devuelve v_secret.
  RETURN jsonb_build_object(
    'success', TRUE, 'roundId', v_id, 'roundNumber', v_num,
    'prizePool', p_prize_pool, 'freeAttempts', p_free_attempts
  );
END;
$$;


-- =============================================================================
-- 8. CERRAR RONDA A MANO (sólo administrador)
--    Para cuando nadie llega al 100% y se quiere repartir igualmente.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.admin_close_secret_code_round(p_settle BOOLEAN DEFAULT TRUE)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid   UUID := auth.uid();
  v_round RECORD;
  v_pagos JSONB := '{}'::JSONB;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF NOT public.current_user_is_admin() THEN
    RAISE EXCEPTION 'Sólo un administrador puede cerrar una ronda';
  END IF;

  SELECT * INTO v_round FROM public.secret_code_rounds
   WHERE status = 'open' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No hay ninguna ronda abierta'; END IF;

  IF p_settle THEN
    v_pagos := public._settle_secret_round(v_round.id);
  END IF;

  UPDATE public.secret_code_rounds
     SET status = CASE WHEN p_settle THEN 'finished' ELSE 'cancelled' END,
         finished_at = NOW()
   WHERE id = v_round.id;

  RETURN jsonb_build_object('success', TRUE, 'roundNumber', v_round.round_number,
                            'settled', p_settle, 'payouts', v_pagos);
END;
$$;


-- =============================================================================
-- 9. PROBAR UN CÓDIGO
--    El corazón del minijuego. Valida, puntúa, registra, y si es 100% cierra la
--    ronda y reparte el bote en la misma transacción.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.guess_secret_code(p_sequence TEXT[])
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid       UUID := auth.uid();
  v_round     RECORD;
  v_entry     RECORD;
  v_score     RECORD;
  v_gratis    BOOLEAN := FALSE;
  v_pagos     JSONB := '{}'::JSONB;
  v_gano      BOOLEAN := FALSE;
  v_invalidas INTEGER;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  -- Validar la forma de la secuencia antes de tocar nada.
  IF p_sequence IS NULL OR array_length(p_sequence, 1) <> 4 THEN
    RAISE EXCEPTION 'La secuencia debe tener exactamente 4 plantas';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(p_sequence) AS s WHERE s IS NULL) THEN
    RAISE EXCEPTION 'La secuencia no puede tener huecos vacíos';
  END IF;

  -- Cada elemento tiene que ser una planta real del catálogo.
  SELECT count(*) INTO v_invalidas
    FROM unnest(p_sequence) AS s
   WHERE NOT EXISTS (SELECT 1 FROM public.plant_catalog c WHERE c.plant_id = s);
  IF v_invalidas > 0 THEN
    RAISE EXCEPTION 'La secuencia contiene % planta(s) que no existen', v_invalidas;
  END IF;

  -- Bloquear la ronda: si dos jugadores aciertan a la vez, se serializan y el
  -- segundo verá la ronda ya cerrada.
  SELECT * INTO v_round FROM public.secret_code_rounds
   WHERE status = 'open' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No hay ninguna ronda abierta ahora mismo';
  END IF;

  -- Intentos disponibles de este jugador en esta ronda
  INSERT INTO public.secret_code_entries (round_id, user_id)
  VALUES (v_round.id, v_uid)
  ON CONFLICT (round_id, user_id) DO NOTHING;

  SELECT * INTO v_entry FROM public.secret_code_entries
   WHERE round_id = v_round.id AND user_id = v_uid FOR UPDATE;

  IF v_entry.free_used < v_round.free_attempts THEN
    v_gratis := TRUE;
    UPDATE public.secret_code_entries SET free_used = free_used + 1
     WHERE round_id = v_round.id AND user_id = v_uid;
  ELSIF v_entry.extra_attempts > 0 THEN
    UPDATE public.secret_code_entries SET extra_attempts = extra_attempts - 1
     WHERE round_id = v_round.id AND user_id = v_uid;
  ELSE
    RAISE EXCEPTION 'No te quedan intentos. Compra más o espera la próxima ronda.';
  END IF;

  SELECT * INTO v_score FROM public._score_secret_guess(v_round.secret, p_sequence);

  INSERT INTO public.secret_code_attempts
    (round_id, user_id, sequence, exact_count, wrong_pos_count, pct, was_free)
  VALUES
    (v_round.id, v_uid, p_sequence, v_score.exact_count,
     v_score.wrong_pos_count, v_score.pct, v_gratis);

  -- 100% ⇒ los 4 exactos. Cierra la ronda y reparte.
  IF v_score.pct >= 100 THEN
    v_gano := TRUE;
    v_pagos := public._settle_secret_round(v_round.id);
    UPDATE public.secret_code_rounds
       SET status = 'finished', winner_id = v_uid, finished_at = NOW()
     WHERE id = v_round.id;
  END IF;

  RETURN jsonb_build_object(
    'success',       TRUE,
    'exactCount',    v_score.exact_count,
    'wrongPosCount', v_score.wrong_pos_count,
    'pct',           v_score.pct,
    'wasFree',       v_gratis,
    'solved',        v_gano,
    'roundFinished', v_gano,
    'payouts',       v_pagos
  );
END;
$$;


-- =============================================================================
-- 10. COMPRAR INTENTOS
--     Misma lógica que la tienda: precio en la base, cobro atómico, y el perfil
--     bloqueado antes de leer el saldo para que dos compras a la vez no dejen el
--     saldo en negativo.
-- =============================================================================
INSERT INTO public.shop_config (key, value) VALUES
  ('code_attempts_price_gems', 1),
  ('code_attempts_per_purchase', 2)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.buy_secret_code_attempts()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid    UUID := auth.uid();
  v_round  RECORD;
  v_precio NUMERIC;
  v_cuantos INTEGER;
  v_saldo  NUMERIC;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  SELECT * INTO v_round FROM public.secret_code_rounds WHERE status = 'open';
  IF NOT FOUND THEN RAISE EXCEPTION 'No hay ninguna ronda abierta'; END IF;

  SELECT value INTO v_precio  FROM public.shop_config WHERE key = 'code_attempts_price_gems';
  SELECT value INTO v_cuantos FROM public.shop_config WHERE key = 'code_attempts_per_purchase';
  v_precio  := COALESCE(v_precio, 1);
  v_cuantos := COALESCE(v_cuantos, 2)::INTEGER;

  SELECT gems_balance INTO v_saldo FROM public.profiles WHERE id = v_uid FOR UPDATE;
  IF v_saldo IS NULL OR v_saldo < v_precio THEN
    RAISE EXCEPTION 'Necesitas % gema(s) y tienes %', v_precio, COALESCE(v_saldo, 0);
  END IF;

  UPDATE public.profiles SET gems_balance = gems_balance - v_precio WHERE id = v_uid;

  INSERT INTO public.secret_code_entries (round_id, user_id, extra_attempts)
  VALUES (v_round.id, v_uid, v_cuantos)
  ON CONFLICT (round_id, user_id) DO UPDATE
    SET extra_attempts = secret_code_entries.extra_attempts + v_cuantos;

  INSERT INTO public.transactions (user_id, type, amount_gems, description, status)
  VALUES (v_uid, 'shop_purchase', v_precio,
          v_cuantos || ' intentos del código secreto (ronda #' || v_round.round_number || ')',
          'completed');

  RETURN jsonb_build_object('success', TRUE, 'attemptsAdded', v_cuantos, 'spent', v_precio);
END;
$$;


-- =============================================================================
-- 11. MI ESTADO EN LA RONDA
--     Devuelve la ronda, mis intentos restantes y mi historial. Nunca el secreto.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.secret_code_state()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid   UUID := auth.uid();
  v_round RECORD;
  v_entry RECORD;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  SELECT * INTO v_round FROM public.secret_code_rounds
   ORDER BY round_number DESC LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('round', NULL, 'attempts', '[]'::JSONB);
  END IF;

  SELECT * INTO v_entry FROM public.secret_code_entries
   WHERE round_id = v_round.id AND user_id = v_uid;

  RETURN jsonb_build_object(
    'round', jsonb_build_object(
      'id',            v_round.id,
      'roundNumber',   v_round.round_number,
      'status',        v_round.status,
      'freeAttempts',  v_round.free_attempts,
      'prizePool',     v_round.prize_pool_gems,
      'prizes',        jsonb_build_array(v_round.prize_1st, v_round.prize_2nd, v_round.prize_3rd),
      'winnerId',      v_round.winner_id,
      'createdAt',     v_round.created_at,
      'finishedAt',    v_round.finished_at
    ),
    'freeUsed',        COALESCE(v_entry.free_used, 0),
    'extraAttempts',   COALESCE(v_entry.extra_attempts, 0),
    'attemptsLeft',    GREATEST(0, v_round.free_attempts - COALESCE(v_entry.free_used, 0))
                       + COALESCE(v_entry.extra_attempts, 0),
    -- Historial propio, con la secuencia: es suya, puede verla.
    'attempts', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id',            a.id,
               'sequence',      a.sequence,
               'exactCount',    a.exact_count,
               'wrongPosCount', a.wrong_pos_count,
               'pct',           a.pct,
               'wasFree',       a.was_free,
               'createdAt',     a.created_at
             ) ORDER BY a.created_at DESC)
        FROM public.secret_code_attempts a
       WHERE a.round_id = v_round.id AND a.user_id = v_uid
    ), '[]'::JSONB),
    'myPayout', (
      SELECT jsonb_build_object('place', place, 'gems', gems, 'tiedWith', tied_with)
        FROM public.secret_code_payouts
       WHERE round_id = v_round.id AND user_id = v_uid
    )
  );
END;
$$;


-- =============================================================================
-- 12. CLASIFICACIÓN PÚBLICA
--     Nombre, mejor %, número de intentos. NUNCA las secuencias: eso es lo que
--     permite competir sin que se copien las jugadas.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.secret_code_leaderboard(p_round_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid   UUID := auth.uid();
  v_round UUID;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  v_round := COALESCE(
    p_round_id,
    (SELECT id FROM public.secret_code_rounds ORDER BY round_number DESC LIMIT 1)
  );
  IF v_round IS NULL THEN RETURN '[]'::JSONB; END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'userId',      x.user_id,
             'username',    x.username,
             'avatarId',    x.avatar_id,
             'bestPct',     x.mejor_pct,
             'attempts',    x.intentos,
             'lastAttempt', x.ultimo,
             'place',       x.puesto,
             'isMe',        (x.user_id = v_uid)
           ) ORDER BY x.puesto, x.ultimo)
      FROM (
        SELECT a.user_id,
               p.username,
               p.avatar_id,
               MAX(a.pct)          AS mejor_pct,
               count(*)            AS intentos,
               MAX(a.created_at)   AS ultimo,
               DENSE_RANK() OVER (ORDER BY MAX(a.pct) DESC) AS puesto
          FROM public.secret_code_attempts a
          JOIN public.profiles p ON p.id = a.user_id
         WHERE a.round_id = v_round
         GROUP BY a.user_id, p.username, p.avatar_id
      ) x
  ), '[]'::JSONB);
END;
$$;


-- =============================================================================
-- 13. PERMISOS
-- =============================================================================
DO $$
DECLARE f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prokind = 'f'
       AND p.proname IN ('guess_secret_code','buy_secret_code_attempts',
                         'secret_code_state','secret_code_leaderboard',
                         'admin_open_secret_code_round','admin_close_secret_code_round')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon, PUBLIC', f.sig);
    EXECUTE format('GRANT  EXECUTE ON FUNCTION %s TO authenticated',  f.sig);
  END LOOP;
END $$;

-- La tabla vieja queda sin uso. No se borra por si tiene datos que quieras ver.
COMMENT ON TABLE public.user_secret_code IS
  'OBSOLETA desde la migración 08: sustituida por secret_code_rounds/_attempts/_entries. Se puede borrar cuando confirmes que no la necesitas.';

INSERT INTO public._migration_audit (fase, detalle)
VALUES ('minijuego_codigo', jsonb_build_object('tablas', 4, 'rpcs', 6));

COMMIT;


-- =============================================================================
-- COMPROBACIONES
-- =============================================================================

-- 1. El secreto NO debe ser legible. Espera 0 filas.
SELECT grantee, column_name
  FROM information_schema.column_privileges
 WHERE table_schema = 'public' AND table_name = 'secret_code_rounds'
   AND column_name = 'secret' AND grantee IN ('anon','authenticated');

-- 2. Ninguna SECURITY DEFINER sin auth.uid() ni ejecutable por anon.
--    Espera 0 filas.
SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.prosecdef
   AND p.proname NOT IN ('handle_new_user','current_user_is_admin')
   AND (has_function_privilege('anon', p.oid, 'EXECUTE')
        OR pg_get_functiondef(p.oid) NOT ILIKE '%auth.uid()%');

-- 3. Prueba de la puntuación. Espera, en orden:
--    4 exactos → 100 | 0 exactos 4 mal colocados → 50 | 2 y 2 → 75 | nada → 0
SELECT * FROM public._score_secret_guess(
  ARRAY['sunflower','peashooter','wallnut','chomper'],
  ARRAY['sunflower','peashooter','wallnut','chomper']);
SELECT * FROM public._score_secret_guess(
  ARRAY['sunflower','peashooter','wallnut','chomper'],
  ARRAY['chomper','wallnut','peashooter','sunflower']);
SELECT * FROM public._score_secret_guess(
  ARRAY['sunflower','peashooter','wallnut','chomper'],
  ARRAY['sunflower','peashooter','chomper','wallnut']);
SELECT * FROM public._score_secret_guess(
  ARRAY['sunflower','peashooter','wallnut','chomper'],
  ARRAY['aloe','tallnut','jalapeno','garlic']);

-- 4. Abrir la primera ronda. Ejecútalo DESDE LA APP (necesita auth.uid() de un
--    administrador). Aquí en el editor SQL dará 'No autenticado', que es lo
--    correcto. Si prefieres abrirla a mano desde aquí, usa:
--
--   INSERT INTO public.secret_code_rounds (round_number, secret, created_by)
--   SELECT 1, (SELECT array_agg(plant_id) FROM (
--            SELECT plant_id FROM public.plant_catalog ORDER BY random() LIMIT 4) z),
--          NULL;
