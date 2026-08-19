-- =============================================================================
-- PLANT ARENA · FASE 2c (1/2): RECOMPENSAS EN EL SERVIDOR
--
-- Idempotente.
--
-- Cubre pase de batalla, lotería y cofre por victoria. Son los tres caminos que
-- la fase 2a dejó avisando por consola sin entregar nada, porque creaban sobres
-- con un id inventado que open_pack habría rechazado.
--
-- EL CASO MÁS GRAVE ES LA LOTERÍA:
--   LotteryModal.tsx:290 sorteaba el sector ganador con Math.random() en el
--   navegador y luego llamaba a onAddTokens() con el premio. Uno de los diez
--   sectores son 20 gemas, que en tu interfaz equivalen a 20 USD. Es decir: el
--   navegador decidía si se ganaba el premio mayor. Ahora lo decide Postgres.
--
-- PROBABILIDADES Y PREMIOS COPIADOS SIN ALTERAR
--   LotteryModal.tsx:290-316   → pesos de los 10 sectores (suman 100)
--   battlePassManager.ts       → los 20 niveles y su ELO requerido
--   useInventory awardVictoryPack → cofre en el primer hueco libre
-- =============================================================================

BEGIN;

-- =============================================================================
-- 1. NIVELES DEL PASE DE BATALLA
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.battle_pass_levels (
    level         INTEGER PRIMARY KEY CHECK (level BETWEEN 1 AND 100),
    required_elo  INTEGER NOT NULL CHECK (required_elo >= 0),
    arena_name    TEXT NOT NULL,
    reward_type   TEXT NOT NULL CHECK (reward_type IN ('pack','copies','plant','badge')),
    pack_id       TEXT REFERENCES public.shop_packs(pack_id),
    pack_count    INTEGER CHECK (pack_count > 0),
    plant_id      TEXT REFERENCES public.plant_catalog(plant_id),
    copies_count  INTEGER CHECK (copies_count > 0),
    label         TEXT NOT NULL
);

ALTER TABLE public.battle_pass_levels ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "bp_levels_read" ON public.battle_pass_levels;
CREATE POLICY "bp_levels_read" ON public.battle_pass_levels FOR SELECT USING (TRUE);

INSERT INTO public.battle_pass_levels
  (level, required_elo, arena_name, reward_type, pack_id, pack_count, plant_id, copies_count, label) VALUES
  ( 1, 1150, 'Jardín Clásico',            'pack',   'basic',     1, NULL,             NULL, 'Sobre Gratis de Batalla'),
  ( 2, 1300, 'Jardín Clásico',            'copies', NULL,     NULL, 'sunflower',         3, 'x3 Girasol'),
  ( 3, 1450, 'Jardín Clásico',            'copies', NULL,     NULL, 'bonkchoy',          3, 'x3 Bonk Choy'),
  ( 4, 1600, 'Jardín Clásico (Límite)',   'copies', NULL,     NULL, 'twinsunflower',     2, 'x2 Girasol Doble'),
  ( 5, 1750, 'Desierto Nocturno',         'copies', NULL,     NULL, 'jalapeno',          1, 'x1 Jalapeño Garantizado'),
  ( 6, 1900, 'Desierto Nocturno',         'copies', NULL,     NULL, 'repeater',          3, 'x3 Repetidora'),
  ( 7, 2050, 'Rascacielos Cyberpunk',     'copies', NULL,     NULL, 'aloe',              3, 'x3 Aloe Vera'),
  ( 8, 2200, 'Rascacielos Cyberpunk',     'copies', NULL,     NULL, 'tallnut',           3, 'x3 Nuez Alta'),
  ( 9, 2350, 'Rascacielos Cyberpunk',     'pack',   'legendary', 2, NULL,             NULL, 'x2 Sobre VIP Legendario'),
  (10, 2500, 'Rascacielos Cyberpunk',     'pack',   'legendary', 1, NULL,             NULL, 'Sobre VIP Legendario'),
  (11, 2650, 'Rascacielos Cyberpunk',     'copies', NULL,     NULL, 'aloe',              4, 'x4 Aloe Vera'),
  (12, 2800, 'Rascacielos Cyberpunk',     'copies', NULL,     NULL, 'tallnut',           4, 'x4 Nuez Alta'),
  (13, 2950, 'Rascacielos Cyberpunk',     'pack',   'legendary', 1, NULL,             NULL, 'Sobre VIP Legendario'),
  (14, 3100, 'Coliseo Galáctico',         'copies', NULL,     NULL, 'iceberglettuce',    1, 'x1 Lechuga Helada Legendaria'),
  (15, 3250, 'Coliseo Galáctico',         'pack',   'legendary', 2, NULL,             NULL, 'x2 Sobre VIP Legendario'),
  (16, 3400, 'Coliseo Galáctico',         'pack',   'legendary', 2, NULL,             NULL, 'x2 Sobre VIP Legendario'),
  (17, 3550, 'Coliseo Galáctico',         'pack',   'legendary', 2, NULL,             NULL, 'x2 Sobre VIP Legendario'),
  (18, 3700, 'Coliseo Galáctico',         'copies', NULL,     NULL, 'threepeater',       1, 'x1 Threepeater Legendario'),
  (19, 3850, 'Olimpo de Leyendas',        'pack',   'legendary', 3, NULL,             NULL, 'x3 Sobres VIP Legendarios'),
  (20, 4000, 'Olimpo de Leyendas (MÁX)',  'badge',  NULL,     NULL, NULL,             NULL, 'Corona Dorada Leyenda ELO + Skin VIP')
ON CONFLICT (level) DO UPDATE
  SET required_elo = EXCLUDED.required_elo,
      arena_name   = EXCLUDED.arena_name,
      reward_type  = EXCLUDED.reward_type,
      pack_id      = EXCLUDED.pack_id,
      pack_count   = EXCLUDED.pack_count,
      plant_id     = EXCLUDED.plant_id,
      copies_count = EXCLUDED.copies_count,
      label        = EXCLUDED.label;


-- =============================================================================
-- 2. SECTORES DE LA LOTERÍA
--    weight es el porcentaje. Suman 100, igual que la cadena de ifs del cliente.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.lottery_sectors (
    sector_id    TEXT PRIMARY KEY,
    label        TEXT NOT NULL,
    reward_type  TEXT NOT NULL CHECK (reward_type IN ('gems','gold','pack','plant')),
    gems_amount  NUMERIC(12,2) CHECK (gems_amount > 0),
    gold_amount  BIGINT        CHECK (gold_amount > 0),
    pack_id      TEXT REFERENCES public.shop_packs(pack_id),
    pack_qty     INTEGER       CHECK (pack_qty > 0),
    plant_id     TEXT REFERENCES public.plant_catalog(plant_id),
    plant_qty    INTEGER       CHECK (plant_qty > 0),
    weight       NUMERIC(6,3) NOT NULL CHECK (weight > 0),
    is_active    BOOLEAN NOT NULL DEFAULT TRUE
);

ALTER TABLE public.lottery_sectors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "lottery_sectors_read" ON public.lottery_sectors;
CREATE POLICY "lottery_sectors_read" ON public.lottery_sectors FOR SELECT USING (TRUE);

INSERT INTO public.lottery_sectors
  (sector_id, label, reward_type, gems_amount, gold_amount, pack_id, pack_qty, plant_id, plant_qty, weight) VALUES
  ('jackpot_20',          '20 Gemas',          'gems',  20,   NULL, NULL,      NULL, NULL,            NULL,  2),
  ('usd_5',               '5 Gemas',           'gems',   5,   NULL, NULL,      NULL, NULL,            NULL,  4),
  ('pack_legendary',      'Sobre Dorado',      'pack', NULL,  NULL, 'legendary',  1, NULL,            NULL,  6),
  ('plant_repeater',      '3x Repetidor',      'plant',NULL,  NULL, NULL,      NULL, 'repeater',         3, 10),
  ('plant_twinsunflower', '3x Girasol Doble',  'plant',NULL,  NULL, NULL,      NULL, 'twinsunflower',    3, 12),
  ('pack_epic',           'Sobre Épico',       'pack', NULL,  NULL, 'epic',       1, NULL,            NULL, 14),
  ('gold_5000',           '5,000 Oro',         'gold', NULL,  5000, NULL,      NULL, NULL,            NULL, 17),
  ('usd_1',               '1 Gema',            'gems',   1,   NULL, NULL,      NULL, NULL,            NULL, 15),
  ('gold_2500',           '2,500 Oro',         'gold', NULL,  2500, NULL,      NULL, NULL,            NULL, 10),
  ('pack_basic_2',        '2x Sobre Básico',   'pack', NULL,  NULL, 'basic',      2, NULL,            NULL, 10)
ON CONFLICT (sector_id) DO UPDATE
  SET label = EXCLUDED.label, reward_type = EXCLUDED.reward_type,
      gems_amount = EXCLUDED.gems_amount, gold_amount = EXCLUDED.gold_amount,
      pack_id = EXCLUDED.pack_id, pack_qty = EXCLUDED.pack_qty,
      plant_id = EXCLUDED.plant_id, plant_qty = EXCLUDED.plant_qty,
      weight = EXCLUDED.weight;

-- Guardia: si los pesos dejan de sumar 100, el sorteo estaría sesgado sin que
-- nadie lo note. Mejor que falle la migración.
DO $$
DECLARE v_total NUMERIC;
BEGIN
  SELECT SUM(weight) INTO v_total FROM public.lottery_sectors WHERE is_active;
  IF v_total <> 100 THEN
    RAISE EXCEPTION 'Los pesos de la lotería suman %, deberían sumar 100', v_total;
  END IF;
END $$;


-- =============================================================================
-- 3. HELPER INTERNO: ENTREGAR UNA RECOMPENSA
--    Lo comparten pase, lotería y cualquier premio futuro, para que la forma de
--    conceder sobres y copias sea una sola en todo el sistema.
-- =============================================================================
CREATE OR REPLACE FUNCTION public._grant_reward(
  p_uid          UUID,
  p_type         TEXT,
  p_pack_id      TEXT DEFAULT NULL,
  p_pack_count   INTEGER DEFAULT NULL,
  p_plant_id     TEXT DEFAULT NULL,
  p_copies_count INTEGER DEFAULT NULL,
  p_gems         NUMERIC DEFAULT NULL,
  p_gold         BIGINT DEFAULT NULL,
  p_source       TEXT DEFAULT 'gift'
) RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SET search_path = public, pg_temp
AS $$
DECLARE i INTEGER;
BEGIN
  IF p_type = 'pack' AND p_pack_id IS NOT NULL THEN
    FOR i IN 1..COALESCE(p_pack_count, 1) LOOP
      INSERT INTO public.player_packs (user_id, pack_id, source)
      VALUES (p_uid, p_pack_id, p_source);
    END LOOP;
    RETURN jsonb_build_object('type','pack','packId',p_pack_id,'count',COALESCE(p_pack_count,1));

  ELSIF p_type IN ('copies','plant') AND p_plant_id IS NOT NULL THEN
    INSERT INTO public.plant_copies (user_id, plant_id, copies)
    VALUES (p_uid, p_plant_id, COALESCE(p_copies_count, 1))
    ON CONFLICT (user_id, plant_id) DO UPDATE
      SET copies = plant_copies.copies + COALESCE(p_copies_count, 1);
    RETURN jsonb_build_object('type','copies','plantId',p_plant_id,'count',COALESCE(p_copies_count,1));

  ELSIF p_type = 'gems' AND p_gems IS NOT NULL THEN
    UPDATE public.profiles SET gems_balance = gems_balance + p_gems WHERE id = p_uid;
    RETURN jsonb_build_object('type','gems','amount',p_gems);

  ELSIF p_type = 'gold' AND p_gold IS NOT NULL THEN
    UPDATE public.profiles SET gold_balance = gold_balance + p_gold WHERE id = p_uid;
    RETURN jsonb_build_object('type','gold','amount',p_gold);

  ELSIF p_type = 'badge' THEN
    -- Nivel 20: cosmético, no hay nada material que entregar.
    RETURN jsonb_build_object('type','badge');
  END IF;

  RETURN jsonb_build_object('type','none');
END;
$$;

REVOKE EXECUTE ON FUNCTION public._grant_reward(UUID,TEXT,TEXT,INTEGER,TEXT,INTEGER,NUMERIC,BIGINT,TEXT)
  FROM anon, authenticated, PUBLIC;


-- =============================================================================
-- 4. RECLAMAR UN NIVEL DEL PASE
--    Condiciones tomadas de BattlePass.tsx:29 → pase VIP + ELO alcanzado +
--    no reclamado antes.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.claim_battle_pass_level(p_level INTEGER)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid    UUID := auth.uid();
  v_perfil RECORD;
  v_lvl    RECORD;
  v_dado   JSONB;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  SELECT elo_rating, has_vip_pass, claimed_vip_levels
    INTO v_perfil FROM public.profiles WHERE id = v_uid FOR UPDATE;
  IF v_perfil IS NULL THEN RAISE EXCEPTION 'Perfil no encontrado'; END IF;

  IF NOT v_perfil.has_vip_pass THEN
    RAISE EXCEPTION 'Necesitas el Pase VIP para reclamar recompensas del pase';
  END IF;

  SELECT * INTO v_lvl FROM public.battle_pass_levels WHERE level = p_level;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nivel % no existe en el pase', p_level; END IF;

  IF v_perfil.elo_rating < v_lvl.required_elo THEN
    RAISE EXCEPTION 'Necesitas % de ELO para el nivel % (tienes %)',
      v_lvl.required_elo, p_level, v_perfil.elo_rating;
  END IF;

  IF p_level = ANY(COALESCE(v_perfil.claimed_vip_levels, '{}')) THEN
    RAISE EXCEPTION 'Ya reclamaste el nivel %', p_level;
  END IF;

  -- Marcar como reclamado ANTES de entregar: si algo falla después, la
  -- transacción entera se deshace y no queda medio reclamado.
  UPDATE public.profiles
     SET claimed_vip_levels = array_append(COALESCE(claimed_vip_levels,'{}'), p_level)
   WHERE id = v_uid;

  v_dado := public._grant_reward(
    v_uid, v_lvl.reward_type, v_lvl.pack_id, v_lvl.pack_count,
    v_lvl.plant_id, v_lvl.copies_count, NULL, NULL, 'gift'
  );

  RETURN jsonb_build_object('success', TRUE, 'level', p_level,
                            'label', v_lvl.label, 'granted', v_dado);
END;
$$;


-- Reclamar todos los disponibles de una vez (el botón "RECLAMAR TODO").
CREATE OR REPLACE FUNCTION public.claim_all_battle_pass_levels()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid   UUID := auth.uid();
  v_lvl   RECORD;
  v_res   JSONB := '[]'::JSONB;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  FOR v_lvl IN
    SELECT bpl.level
      FROM public.battle_pass_levels bpl, public.profiles p
     WHERE p.id = v_uid
       AND p.has_vip_pass
       AND p.elo_rating >= bpl.required_elo
       AND NOT (bpl.level = ANY(COALESCE(p.claimed_vip_levels, '{}')))
     ORDER BY bpl.level
  LOOP
    v_res := v_res || public.claim_battle_pass_level(v_lvl.level);
  END LOOP;

  RETURN jsonb_build_object('success', TRUE, 'claimed', v_res);
END;
$$;


-- =============================================================================
-- 5. GIRAR LA LOTERÍA
--    El sector ganador lo elige Postgres con los mismos pesos que el cliente.
--    El tiro gratis es 1 al día, y vive en user_lottery.last_free_spin en lugar
--    de en localStorage, donde se reiniciaba cambiando de navegador.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.spin_lottery(p_paid BOOLEAN DEFAULT FALSE)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid       UUID := auth.uid();
  v_lot       RECORD;
  v_saldo     NUMERIC;
  v_r         NUMERIC;
  v_acc       NUMERIC := 0;
  v_sector    RECORD;
  v_dado      JSONB;
  c_spin_cost CONSTANT NUMERIC := 1;   -- LotteryModal.tsx:279
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  INSERT INTO public.user_lottery (user_id) VALUES (v_uid)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT * INTO v_lot FROM public.user_lottery WHERE user_id = v_uid FOR UPDATE;

  IF p_paid THEN
    SELECT gems_balance INTO v_saldo FROM public.profiles WHERE id = v_uid FOR UPDATE;
    IF v_saldo IS NULL OR v_saldo < c_spin_cost THEN
      RAISE EXCEPTION 'Necesitas % gema para un tiro adicional', c_spin_cost;
    END IF;
    UPDATE public.profiles SET gems_balance = gems_balance - c_spin_cost WHERE id = v_uid;
  ELSE
    -- Un tiro gratis cada 24 h, medido con el reloj del servidor.
    IF v_lot.last_free_spin IS NOT NULL
       AND v_lot.last_free_spin > NOW() - INTERVAL '24 hours' THEN
      RAISE EXCEPTION 'Ya usaste tu tiro gratis. Vuelve en %',
        date_trunc('minute', (v_lot.last_free_spin + INTERVAL '24 hours') - NOW());
    END IF;
    UPDATE public.user_lottery SET last_free_spin = NOW() WHERE user_id = v_uid;
  END IF;

  -- Sorteo ponderado
  v_r := random() * 100;
  FOR v_sector IN
    SELECT * FROM public.lottery_sectors WHERE is_active ORDER BY sector_id
  LOOP
    v_acc := v_acc + v_sector.weight;
    IF v_r < v_acc THEN EXIT; END IF;
  END LOOP;

  IF v_sector IS NULL THEN RAISE EXCEPTION 'No hay sectores activos en la lotería'; END IF;

  v_dado := public._grant_reward(
    v_uid, v_sector.reward_type, v_sector.pack_id, v_sector.pack_qty,
    v_sector.plant_id, v_sector.plant_qty, v_sector.gems_amount,
    v_sector.gold_amount, 'gift'
  );

  UPDATE public.user_lottery
     SET total_spins = COALESCE(total_spins,0) + 1, updated_at = NOW()
   WHERE user_id = v_uid;

  IF v_sector.reward_type = 'gems' THEN
    INSERT INTO public.transactions (user_id, type, amount_gems, description, status)
    VALUES (v_uid, 'deposit', v_sector.gems_amount,
            'Premio de lotería: ' || v_sector.label, 'completed');
  END IF;

  RETURN jsonb_build_object(
    'success',  TRUE,
    'sectorId', v_sector.sector_id,
    'label',    v_sector.label,
    'granted',  v_dado
  );
END;
$$;


-- =============================================================================
-- 6. COFRE POR VICTORIA
--    Coloca un cofre en el primer hueco libre, con duración aleatoria (2/4/8/12)
--    como hacía awardVictoryPack en el cliente.
--
-- LÍMITE CONOCIDO: la partida todavía no se resuelve en el servidor, así que
-- esta función se fía de que el cliente diga "he ganado". Lo acota lo siguiente:
--   · sólo 4 huecos, y cada uno tarda entre 2 y 12 h en abrirse
--   · un cofre como máximo cada 2 minutos, que es menos de lo que dura una
--     partida
-- Queda cerrado del todo cuando exista resolución de partida (fase 2c 2/2).
-- =============================================================================
ALTER TABLE public.pack_slots
  ADD COLUMN IF NOT EXISTS awarded_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.award_victory_chest()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid     UUID := auth.uid();
  v_elo     INTEGER;
  v_arena   INTEGER;
  v_libre   INTEGER;
  v_dur     INTEGER;
  v_ultimo  TIMESTAMPTZ;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  -- Freno anti-repetición
  SELECT MAX(awarded_at) INTO v_ultimo FROM public.pack_slots WHERE user_id = v_uid;
  IF v_ultimo IS NOT NULL AND v_ultimo > NOW() - INTERVAL '2 minutes' THEN
    RETURN jsonb_build_object('awarded', FALSE, 'reason', 'demasiado_pronto');
  END IF;

  SELECT elo_rating INTO v_elo FROM public.profiles WHERE id = v_uid;

  -- Nivel de arena por ELO, mismos tramos que arenaManager.ts
  v_arena := CASE
    WHEN v_elo >= 3100 THEN 5
    WHEN v_elo >= 2050 THEN 4
    WHEN v_elo >= 1750 THEN 3
    WHEN v_elo >= 1600 THEN 2
    ELSE 1
  END;

  -- Primer hueco libre: sin fila, o con estado 'empty'
  SELECT i INTO v_libre FROM generate_series(0,3) AS i
   WHERE NOT EXISTS (
     SELECT 1 FROM public.pack_slots ps
      WHERE ps.user_id = v_uid AND ps.slot_index = i AND ps.status <> 'empty'
   )
   ORDER BY i LIMIT 1;

  IF v_libre IS NULL THEN
    RETURN jsonb_build_object('awarded', FALSE, 'reason', 'huecos_llenos');
  END IF;

  v_dur := (ARRAY[2,4,8,12])[1 + floor(random() * 4)::INTEGER];

  INSERT INTO public.pack_slots
    (user_id, slot_index, status, duration_hours, arena_level, unlock_started_at, awarded_at)
  VALUES (v_uid, v_libre, 'locked', v_dur, v_arena, NULL, NOW())
  ON CONFLICT (user_id, slot_index) DO UPDATE
    SET status = 'locked', duration_hours = EXCLUDED.duration_hours,
        arena_level = EXCLUDED.arena_level, unlock_started_at = NULL,
        awarded_at = NOW();

  RETURN jsonb_build_object(
    'awarded', TRUE, 'slotId', v_libre,
    'durationHours', v_dur, 'arenaLevel', v_arena
  );
END;
$$;


-- =============================================================================
-- 7. sync_pack_slots: RESPETAR LA DURACIÓN QUE PUSO EL SERVIDOR
--
-- La versión de la fase 1c imponía la duración según el índice del hueco para
-- que el cliente no pudiera mandar duration_hours = 0. Efecto secundario: la
-- duración dejaba de ser aleatoria. Ahora que la asigna award_victory_chest en
-- el servidor, se conserva la de la fila existente y sólo se impone la del
-- índice al crear un hueco nuevo. El cliente sigue sin poder elegirla.
-- =============================================================================
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

    SELECT status, unlock_started_at, duration_hours, arena_level
      INTO v_prev
      FROM public.pack_slots
     WHERE user_id = v_uid AND slot_index = v_idx
     FOR UPDATE;

    -- La duración la manda el servidor: la existente si la hay, y si no la que
    -- corresponde al índice. Nunca la que envíe el cliente.
    v_dur := COALESCE(v_prev.duration_hours,
                      CASE v_idx WHEN 0 THEN 2 WHEN 1 THEN 4 WHEN 2 THEN 8 ELSE 12 END);

    -- El nivel de arena también: lo fija award_victory_chest al conceder.
    v_arena := COALESCE(v_prev.arena_level, 1);
    v_arena := GREATEST(1, LEAST(5, v_arena));

    v_want := COALESCE(v_in->>'status', 'empty');
    IF v_want NOT IN ('empty', 'locked', 'unlocking', 'ready') THEN
      RAISE EXCEPTION 'Estado de cofre inválido: %', v_want;
    END IF;

    v_final   := v_want;
    v_started := NULL;

    IF v_want = 'unlocking' THEN
      IF v_prev.status = 'unlocking' AND v_prev.unlock_started_at IS NOT NULL THEN
        v_started := v_prev.unlock_started_at;
      ELSE
        v_started := NOW();
      END IF;

    ELSIF v_want = 'ready' THEN
      IF v_prev.status = 'ready' THEN
        v_final := 'ready';
      ELSIF v_prev.status = 'unlocking'
            AND v_prev.unlock_started_at IS NOT NULL
            AND NOW() >= v_prev.unlock_started_at + make_interval(hours => v_dur)
      THEN
        v_final := 'ready';
      ELSE
        v_final   := COALESCE(v_prev.status, 'empty');
        v_started := v_prev.unlock_started_at;
        v_rechazados := v_rechazados || jsonb_build_object(
          'slotId', v_idx, 'motivo', 'todavia_no_esta_listo', 'estado_real', v_final
        );
      END IF;

    ELSIF v_want = 'locked' AND v_prev.status IS NULL THEN
      -- Un cofre sólo aparece por award_victory_chest. Si el cliente pide
      -- 'locked' en un hueco que no existe, se ignora.
      v_final := 'empty';
      v_rechazados := v_rechazados || jsonb_build_object(
        'slotId', v_idx, 'motivo', 'los_cofres_los_concede_el_servidor'
      );
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


-- =============================================================================
-- 8. PERMISOS
-- =============================================================================
DO $$
DECLARE f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prokind = 'f'
       AND p.proname IN ('claim_battle_pass_level','claim_all_battle_pass_levels',
                         'spin_lottery','award_victory_chest','sync_pack_slots')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon, PUBLIC', f.sig);
    EXECUTE format('GRANT  EXECUTE ON FUNCTION %s TO authenticated',  f.sig);
  END LOOP;
END $$;

INSERT INTO public._migration_audit (fase, detalle)
VALUES ('fase2c_recompensas', jsonb_build_object(
  'niveles_pase', (SELECT count(*) FROM public.battle_pass_levels),
  'sectores_loteria', (SELECT count(*) FROM public.lottery_sectors)
));

COMMIT;


-- =============================================================================
-- COMPROBACIONES
-- =============================================================================

-- 1. Catálogos cargados. Espera 20 niveles y 10 sectores.
SELECT (SELECT count(*) FROM public.battle_pass_levels)  AS niveles_pase,
       (SELECT count(*) FROM public.lottery_sectors)     AS sectores_loteria,
       (SELECT SUM(weight) FROM public.lottery_sectors)  AS suma_pesos;

-- 2. Distribución del sorteo: 2000 tiradas simuladas contra los pesos.
--    Sólo lectura, no concede nada.
WITH tiradas AS (
  SELECT (
    SELECT s.sector_id FROM (
      SELECT sector_id,
             SUM(weight) OVER (ORDER BY sector_id) AS acc
        FROM public.lottery_sectors WHERE is_active
    ) s WHERE s.acc > r.v ORDER BY s.acc LIMIT 1
  ) AS sector
  FROM (SELECT random()*100 AS v FROM generate_series(1,2000)) r
)
SELECT t.sector, count(*) AS veces, round(count(*)/20.0, 1) AS pct_real,
       ls.weight AS pct_esperado
  FROM tiradas t JOIN public.lottery_sectors ls ON ls.sector_id = t.sector
 GROUP BY t.sector, ls.weight
 ORDER BY ls.weight DESC;

-- 3. Ninguna SECURITY DEFINER sin auth.uid() ni ejecutable por anon.
--    Espera 0 filas.
SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.prosecdef
   AND p.proname NOT IN ('handle_new_user','current_user_is_admin')
   AND (has_function_privilege('anon', p.oid, 'EXECUTE')
        OR pg_get_functiondef(p.oid) NOT ILIKE '%auth.uid()%');
