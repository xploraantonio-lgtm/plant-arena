-- =============================================================================
-- PLANT ARENA · FASE 1b: CREACIÓN DE PERFIL EN EL SERVIDOR
--
-- URGENTE: ejecutar cuanto antes. La fase 1 quitó al cliente el permiso de
-- insertar en profiles (era la vía para autoasignarse saldo e is_admin), así
-- que hasta que exista este trigger un usuario nuevo se autentica pero se
-- queda sin perfil.
--
-- Idempotente.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Función endurecida
--
-- Cambios respecto a tu versión:
--
--   a) SET search_path = public, pg_temp
--      Sin esto, una función SECURITY DEFINER puede ser desviada a tablas
--      falsas colocadas en un esquema anterior en el search_path.
--
--   b) Nombre de usuario único garantizado.
--      profiles.username es UNIQUE NOT NULL y tu COALESCE puede producir un
--      duplicado: dos cuentas de Google llamadas "Juan Perez", o dos correos
--      distintos con el mismo prefijo (juan@gmail / juan@hotmail -> "juan").
--      El ON CONFLICT (id) DO NOTHING no cubre eso: salta un unique_violation
--      sobre username, el trigger aborta, y como es un trigger sobre
--      auth.users, ABORTA EL REGISTRO ENTERO. El segundo "Juan" no habría
--      podido crear cuenta y el error sería incomprensible.
--
--   c) Saneado del nombre igual que en el cliente (quita caracteres raros,
--      recorta a 16), para no depender de que el cliente lo haga.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  -- ── Saldos iniciales ──────────────────────────────────────────────────────
  -- Se mantienen los de tu función. OJO: las columnas de profiles tienen otros
  -- DEFAULT (gems 10.00, gold 50000, tickets 2), así que tu función los estaba
  -- pisando con ceros. No lo cambio yo porque es una decisión de diseño de
  -- juego: si quieres los DEFAULT de la tabla, pon los tres a NULL y quita las
  -- columnas del INSERT.
  c_gems    NUMERIC := 0.0;
  c_gold    BIGINT  := 0;
  c_tickets INTEGER := 0;

  v_base TEXT;
  v_name TEXT;
  v_try  INTEGER := 0;
BEGIN
  -- Nombre candidato, en el mismo orden de preferencia que tenías
  v_base := COALESCE(
    new.raw_user_meta_data->>'username',
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'name',
    split_part(COALESCE(new.email, ''), '@', 1)
  );

  -- Saneado: sólo alfanuméricos, guion, guion bajo y espacio
  v_base := regexp_replace(COALESCE(v_base, ''), '[^a-zA-Z0-9_ -]', '', 'g');
  v_base := NULLIF(btrim(v_base), '');
  v_base := left(COALESCE(v_base, 'Guerrero'), 16);

  -- Garantizar unicidad sin abortar el registro
  v_name := v_base;
  WHILE EXISTS (SELECT 1 FROM public.profiles WHERE username = v_name) LOOP
    v_try := v_try + 1;
    IF v_try > 50 THEN
      -- Salida determinista: trozo del uuid, que no puede colisionar
      v_name := left(v_base, 7) || '_' || substr(replace(new.id::text, '-', ''), 1, 8);
      EXIT;
    END IF;
    v_name := left(v_base, 12) || '_' || v_try::TEXT;
  END LOOP;

  INSERT INTO public.profiles (
    id, username, avatar_id, elo_rating,
    gems_balance, gold_balance, colosseum_tickets
  )
  VALUES (
    new.id, v_name, 'peashooter', 1000,
    c_gems, c_gold, c_tickets
  )
  ON CONFLICT (id) DO NOTHING;

  -- Mazo inicial. Sólo si el perfil se acaba de crear, para que un reintento
  -- del trigger no duplique cartas (no hay constraint que lo impida).
  IF NOT EXISTS (SELECT 1 FROM public.plant_instances WHERE owner_id = new.id) THEN
    INSERT INTO public.plant_instances
      (owner_id, plant_id, rarity, star_level, is_in_deck, deck_slot)
    VALUES
      (new.id, 'sunflower',  'common', 1, TRUE, 0),
      (new.id, 'peashooter', 'common', 1, TRUE, 1),
      (new.id, 'wallnut',    'common', 1, TRUE, 2),
      (new.id, 'chomper',    'common', 1, TRUE, 3);
  END IF;

  RETURN new;
END;
$function$;

-- Nadie la invoca a mano: es de trigger.
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated, PUBLIC;


-- -----------------------------------------------------------------------------
-- 2. Enganchar el trigger. Esto es lo que faltaba: la función existía pero no
--    estaba conectada a nada ("triggers": [] en el diagnóstico).
-- -----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- -----------------------------------------------------------------------------
-- 3. Reparar a los usuarios que ya se hayan quedado sin perfil.
--    Si alguien se registró entre la fase 1 y este script, está huérfano.
-- -----------------------------------------------------------------------------
DO $$
DECLARE u RECORD; v_base TEXT; v_name TEXT; v_try INTEGER;
BEGIN
  FOR u IN
    SELECT au.id, au.email, au.raw_user_meta_data
      FROM auth.users au
      LEFT JOIN public.profiles p ON p.id = au.id
     WHERE p.id IS NULL
  LOOP
    v_base := COALESCE(
      u.raw_user_meta_data->>'username',
      u.raw_user_meta_data->>'full_name',
      u.raw_user_meta_data->>'name',
      split_part(COALESCE(u.email, ''), '@', 1)
    );
    v_base := regexp_replace(COALESCE(v_base, ''), '[^a-zA-Z0-9_ -]', '', 'g');
    v_base := NULLIF(btrim(v_base), '');
    v_base := left(COALESCE(v_base, 'Guerrero'), 16);

    v_name := v_base; v_try := 0;
    WHILE EXISTS (SELECT 1 FROM public.profiles WHERE username = v_name) LOOP
      v_try := v_try + 1;
      IF v_try > 50 THEN
        v_name := left(v_base, 7) || '_' || substr(replace(u.id::text, '-', ''), 1, 8);
        EXIT;
      END IF;
      v_name := left(v_base, 12) || '_' || v_try::TEXT;
    END LOOP;

    INSERT INTO public.profiles
      (id, username, avatar_id, elo_rating, gems_balance, gold_balance, colosseum_tickets)
    VALUES (u.id, v_name, 'peashooter', 1000, 0.0, 0, 0)
    ON CONFLICT (id) DO NOTHING;

    IF NOT EXISTS (SELECT 1 FROM public.plant_instances WHERE owner_id = u.id) THEN
      INSERT INTO public.plant_instances
        (owner_id, plant_id, rarity, star_level, is_in_deck, deck_slot)
      VALUES
        (u.id, 'sunflower',  'common', 1, TRUE, 0),
        (u.id, 'peashooter', 'common', 1, TRUE, 1),
        (u.id, 'wallnut',    'common', 1, TRUE, 2),
        (u.id, 'chomper',    'common', 1, TRUE, 3);
    END IF;

    RAISE NOTICE 'Perfil reparado para %', u.id;
  END LOOP;
END $$;

COMMIT;


-- =============================================================================
-- COMPROBACIONES
-- =============================================================================

-- 1. El trigger debe existir. Espera 1 fila.
SELECT t.tgname, c.relname AS tabla, p.proname AS funcion
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_proc  p ON p.oid = t.tgfoid
 WHERE t.tgname = 'on_auth_user_created' AND NOT t.tgisinternal;

-- 2. La función debe tener el search_path fijado. Espera search_path_fijo = true.
SELECT proname, prosecdef AS security_definer, (proconfig IS NOT NULL) AS search_path_fijo
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND proname = 'handle_new_user';

-- 3. Nadie debe quedar sin perfil. Espera 0 filas.
SELECT au.id, au.email
  FROM auth.users au LEFT JOIN public.profiles p ON p.id = au.id
 WHERE p.id IS NULL;

-- 4. El cliente ya NO debe poder insertar perfiles. Espera 0 filas.
SELECT grantee, privilege_type, column_name
  FROM information_schema.column_privileges
 WHERE table_schema = 'public' AND table_name = 'profiles'
   AND grantee IN ('anon', 'authenticated') AND privilege_type = 'INSERT';
