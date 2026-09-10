-- =============================================================================
-- MIGRACIÓN 80: CORRECCIÓN DE OTORGAMIENTO DE +5 ENERGÍAS AL ACTIVAR PASE VIP
-- Y RESTAURACIÓN INMEDIATA PARA EL USUARIO 'Rjnieves'
--
-- 1. Asegura columnas energy_current y energy_last_reset_utc en public.profiles.
-- 2. Actualiza buy_vip_pass(): al activar el Pase VIP la capacidad pasa de 20 a 25,
--    otorgando de inmediato +5 energías al saldo disponible (energy_current).
-- 3. Actualiza my_balance() y get_player_energy() para devolver y sincronizar
--    correctamente la energía diaria y el reseteo estricto a las 00:00 UTC.
-- 4. Restaura inmediatamente 5 energías (5/25 disponibles para jugar) al usuario
--    'Rjnieves' (ID: deb12c17-581d-4c77-b7fe-1e2fe0f98c9d) para que pueda jugar ya.
-- 5. Notifica a PostgREST para recargar la caché de esquemas.
-- =============================================================================

BEGIN;

-- 1. Asegurar columnas de energía en public.profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS energy_current INTEGER DEFAULT 20,
  ADD COLUMN IF NOT EXISTS energy_last_reset_utc TIMESTAMPTZ DEFAULT NOW();

-- 2. Actualizar función autoritativa buy_vip_pass()
CREATE OR REPLACE FUNCTION public.buy_vip_pass()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid         UUID := auth.uid();
  v_precio      NUMERIC;
  v_perfil      RECORD;
  v_current_en  INTEGER;
  v_new_energy  INTEGER;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  SELECT value INTO v_precio FROM public.shop_config WHERE key = 'vip_pass_price_gems';
  v_precio := COALESCE(v_precio, 1000);

  SELECT gems_balance, has_vip_pass, energy_current INTO v_perfil
    FROM public.profiles WHERE id = v_uid FOR UPDATE;
  IF v_perfil IS NULL THEN RAISE EXCEPTION 'Perfil no encontrado'; END IF;
  IF COALESCE(v_perfil.has_vip_pass, FALSE) THEN RAISE EXCEPTION 'Ya tienes el pase VIP'; END IF;
  IF COALESCE(v_perfil.gems_balance, 0) < v_precio THEN
    RAISE EXCEPTION 'Gemas insuficientes: necesitas % y tienes %',
      v_precio, v_perfil.gems_balance;
  END IF;

  -- Al comprar el Pase VIP, la capacidad diaria aumenta de 20 a 25 (+5 partidas).
  -- Se añaden +5 energías directamente a su saldo actual para que el usuario
  -- disponga inmediatamente de las 5 partidas adicionales en el mismo día.
  v_current_en := COALESCE(v_perfil.energy_current, 20);
  v_new_energy := v_current_en + 5;

  UPDATE public.profiles
     SET gems_balance = gems_balance - v_precio,
         has_vip_pass = TRUE,
         energy_current = v_new_energy,
         updated_at = NOW()
   WHERE id = v_uid;

  INSERT INTO public.transactions (user_id, type, amount_gems, description, status)
  VALUES (v_uid, 'shop_purchase', v_precio, 'Pase VIP de temporada (+5 ⚡ diarias)', 'completed');

  RETURN jsonb_build_object(
    'success', TRUE,
    'spent', v_precio,
    'energyAdded', 5,
    'energyCurrent', v_new_energy
  );
END;
$$;

-- 3. Actualizar función my_balance() para incluir energy_current y procesar reseteo diario
CREATE OR REPLACE FUNCTION public.my_balance()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid        UUID := auth.uid();
  r            RECORD;
  v_max_energy INTEGER;
  v_cur_energy INTEGER;
  v_last_reset TIMESTAMPTZ;
  v_now        TIMESTAMPTZ := NOW();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  SELECT gems_balance, gold_balance, colosseum_tickets, elo_rating,
         has_vip_pass, claimed_vip_levels,
         colosseum_current_streak, colosseum_max_streak,
         energy_current, energy_last_reset_utc
    INTO r
    FROM public.profiles
   WHERE id = v_uid
   FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Perfil no encontrado'; END IF;

  v_max_energy := CASE WHEN COALESCE(r.has_vip_pass, FALSE) THEN 25 ELSE 20 END;
  v_cur_energy := COALESCE(r.energy_current, v_max_energy);
  v_last_reset := COALESCE(r.energy_last_reset_utc, v_now);

  -- Comprobar si cambió el día UTC (00:00 UTC)
  IF (DATE_TRUNC('day', v_now AT TIME ZONE 'UTC') > DATE_TRUNC('day', v_last_reset AT TIME ZONE 'UTC')) THEN
    v_cur_energy := v_max_energy;
    v_last_reset := v_now;

    UPDATE public.profiles
       SET energy_current = v_cur_energy,
           energy_last_reset_utc = v_last_reset
     WHERE id = v_uid;
  ELSIF r.energy_current IS NULL THEN
    UPDATE public.profiles
       SET energy_current = v_cur_energy,
           energy_last_reset_utc = v_last_reset
     WHERE id = v_uid;
  END IF;

  RETURN jsonb_build_object(
    'gems_balance', r.gems_balance,
    'gold_balance', r.gold_balance,
    'colosseum_tickets', r.colosseum_tickets,
    'elo_rating', r.elo_rating,
    'has_vip_pass', COALESCE(r.has_vip_pass, FALSE),
    'claimed_vip_levels', COALESCE(r.claimed_vip_levels, '[]'::jsonb),
    'colosseum_current_streak', COALESCE(r.colosseum_current_streak, 0),
    'colosseum_max_streak', COALESCE(r.colosseum_max_streak, 0),
    'energy_current', v_cur_energy,
    'energy_last_reset_utc', v_last_reset
  );
END;
$$;

-- 4. Actualizar get_player_energy()
CREATE OR REPLACE FUNCTION public.get_player_energy()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid                 UUID := auth.uid();
  v_perfil              RECORD;
  v_max_energy          INTEGER;
  v_current_energy      INTEGER;
  v_last_reset          TIMESTAMPTZ;
  v_now                 TIMESTAMPTZ := NOW();
  v_midnight_utc        TIMESTAMPTZ;
  v_seconds_until_reset INTEGER;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  SELECT elo_rating, has_vip_pass, energy_current, energy_last_reset_utc
    INTO v_perfil
    FROM public.profiles
   WHERE id = v_uid
   FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Perfil no encontrado'; END IF;

  v_max_energy := CASE WHEN COALESCE(v_perfil.has_vip_pass, FALSE) THEN 25 ELSE 20 END;
  v_current_energy := COALESCE(v_perfil.energy_current, v_max_energy);
  v_last_reset := COALESCE(v_perfil.energy_last_reset_utc, v_now);

  -- Comprobar si cambió el día UTC (00:00 UTC)
  IF (DATE_TRUNC('day', v_now AT TIME ZONE 'UTC') > DATE_TRUNC('day', v_last_reset AT TIME ZONE 'UTC')) THEN
    v_current_energy := v_max_energy;
    v_last_reset := v_now;

    UPDATE public.profiles
       SET energy_current = v_current_energy,
           energy_last_reset_utc = v_last_reset
     WHERE id = v_uid;
  ELSIF v_perfil.energy_current IS NULL THEN
    UPDATE public.profiles
       SET energy_current = v_current_energy,
           energy_last_reset_utc = v_last_reset
     WHERE id = v_uid;
  END IF;

  v_midnight_utc := (DATE_TRUNC('day', v_now AT TIME ZONE 'UTC') + INTERVAL '1 day');
  v_seconds_until_reset := GREATEST(0, EXTRACT(EPOCH FROM (v_midnight_utc - v_now))::INTEGER);

  RETURN jsonb_build_object(
    'energyCurrent', v_current_energy,
    'maxEnergy', v_max_energy,
    'hasVip', COALESCE(v_perfil.has_vip_pass, FALSE),
    'userElo', COALESCE(v_perfil.elo_rating, 1000),
    'isUnlimited', COALESCE(v_perfil.elo_rating, 1000) < 1602,
    'secondsUntilReset', v_seconds_until_reset
  );
END;
$$;

-- 5. Permisos de ejecución
GRANT EXECUTE ON FUNCTION public.buy_vip_pass() TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_balance() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_player_energy() TO authenticated;

-- =============================================================================
-- 6. RESTAURACIÓN DE ENERGÍA PARA EL USUARIO 'Rjnieves'
-- =============================================================================
DO $$
DECLARE
  v_target_id   UUID := 'deb12c17-581d-4c77-b7fe-1e2fe0f98c9d';
  v_user        RECORD;
  v_new_energy  INTEGER;
BEGIN
  SELECT id, username, energy_current, has_vip_pass
    INTO v_user
    FROM public.profiles
   WHERE id = v_target_id OR LOWER(TRIM(username)) = 'rjnieves'
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE WARNING 'No se encontró al usuario Rjnieves en public.profiles';
  ELSE
    -- Asegurar que tiene has_vip_pass = TRUE y otorgar las 5 energías
    -- Si consumió las 20 energías estándar, su saldo disponible pasa a ser 5 / 25
    v_new_energy := GREATEST(5, COALESCE(v_user.energy_current, 0) + 5);
    IF COALESCE(v_user.energy_current, 0) <= 0 THEN
      v_new_energy := 5;
    END IF;

    UPDATE public.profiles
       SET has_vip_pass = TRUE,
           energy_current = v_new_energy,
           energy_last_reset_utc = NOW(),
           updated_at = NOW()
     WHERE id = v_user.id;

    INSERT INTO public.transactions (user_id, type, amount_gems, description, status)
    VALUES (
      v_user.id,
      'admin_gift',
      0,
      'Restauración de 5 energías por Pase VIP activado (Bugfix 20/25)',
      'completed'
    );

    RAISE NOTICE '✅ Restauración completada para "%" (ID: %): has_vip_pass = TRUE, energy_current = % / 25',
      v_user.username, v_user.id, v_new_energy;
  END IF;
END $$;

COMMIT;

-- 7. Notificar a PostgREST para recargar esquemas
NOTIFY pgrst, 'reload schema';
