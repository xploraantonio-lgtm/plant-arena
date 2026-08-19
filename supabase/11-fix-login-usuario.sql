-- =============================================================================
-- PLANT ARENA · CORRECCIONES SOBRE LAS MIGRACIONES 09 Y 10
--
-- Idempotente. Ejecutar DESPUÉS de 09 y 10.
--
-- 1. get_email_by_username permitía volcar todos los correos. GRAVE.
-- 2. admin_save_battle_pass_level fallaba al crear un nivel nuevo sin etiqueta.
-- =============================================================================

BEGIN;

-- =============================================================================
-- 1. get_email_by_username: COMPARACIÓN EXACTA, NO PATRÓN
--
-- EL PROBLEMA
--   La versión anterior comparaba con ILIKE:
--       WHERE p.username ILIKE trim(p_username) LIMIT 1
--   En ILIKE el operando de la derecha es un PATRÓN, y '%' es comodín. Como
--   p_username llega del navegador sin filtrar y la función está concedida a
--   anon, cualquiera podía hacer:
--
--       rpc('get_email_by_username', { p_username: '%' })    → un correo cualquiera
--       rpc('get_email_by_username', { p_username: 'a%' })   → el primero con 'a'
--
--   Recorriendo prefijos se obtenía la lista completa de correos de los
--   jugadores, sin necesidad de tener cuenta.
--
-- LA CORRECCIÓN
--   Igualdad exacta insensible a mayúsculas. Ya no hay patrón que interpretar,
--   así que '%' sólo encuentra a un usuario que se llame literalmente '%'.
--
-- LO QUE SIGUE SIENDO CIERTO
--   Con el nombre exacto de alguien (y los nombres son públicos: salen en el
--   ranking) todavía se puede obtener su correo, de uno en uno. Eso es
--   inherente a resolver "usuario → correo" en el cliente.
--   El cierre definitivo es hacer el inicio de sesión en el servidor: una Edge
--   Function que reciba usuario + contraseña, resuelva el correo internamente y
--   devuelva la sesión, de forma que el correo nunca llegue al navegador. Es la
--   misma Edge Function que hará falta para verificar partidas.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.get_email_by_username(p_username TEXT)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_email TEXT;
  v_name  TEXT;
BEGIN
  v_name := btrim(COALESCE(p_username, ''));

  -- Nada que buscar
  IF v_name = '' THEN RETURN NULL; END IF;

  -- El nombre de usuario está limitado a 16 caracteres en el cliente. Cortar
  -- aquí evita gastar trabajo en cadenas absurdamente largas.
  IF length(v_name) > 32 THEN RETURN NULL; END IF;

  -- Igualdad exacta, insensible a mayúsculas. NO ILIKE: sin patrón no hay
  -- comodines que explotar.
  SELECT au.email INTO v_email
    FROM public.profiles p
    JOIN auth.users au ON au.id = p.id
   WHERE lower(p.username) = lower(v_name)
   LIMIT 1;

  RETURN v_email;
END;
$$;

-- Sigue necesitando ser invocable sin sesión: es parte del inicio de sesión.
REVOKE EXECUTE ON FUNCTION public.get_email_by_username(TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_email_by_username(TEXT) TO anon, authenticated;


-- =============================================================================
-- 2. admin_save_battle_pass_level: ETIQUETA OBLIGATORIA AL CREAR
--
-- battle_pass_levels.label es NOT NULL. En el UPDATE se usaba
-- COALESCE(p_label, label), correcto; pero en el INSERT se pasaba p_label tal
-- cual, así que crear un nivel nuevo sin etiqueta fallaba con violación de
-- NOT NULL en lugar de un mensaje útil.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.admin_save_battle_pass_level(
  p_level INTEGER,
  p_required_elo INTEGER,
  p_arena_name TEXT,
  p_reward_type TEXT,
  p_pack_id TEXT DEFAULT NULL,
  p_pack_count INTEGER DEFAULT NULL,
  p_plant_id TEXT DEFAULT NULL,
  p_copies_count INTEGER DEFAULT NULL,
  p_label TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid   UUID := auth.uid();
  v_label TEXT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF NOT public.current_user_is_admin() THEN
    RAISE EXCEPTION 'Sólo un administrador puede editar niveles del pase';
  END IF;

  IF p_level IS NULL OR p_level < 1 THEN
    RAISE EXCEPTION 'Nivel inválido: %', p_level;
  END IF;
  IF p_required_elo IS NULL OR p_required_elo < 0 THEN
    RAISE EXCEPTION 'El ELO requerido no puede ser negativo';
  END IF;

  -- Coherencia entre tipo de premio y sus campos, para no dejar filas que
  -- luego _grant_reward no sepa entregar.
  IF p_reward_type = 'pack' AND (p_pack_id IS NULL OR COALESCE(p_pack_count, 0) < 1) THEN
    RAISE EXCEPTION 'Un premio de tipo "pack" necesita sobre y cantidad';
  END IF;
  IF p_reward_type IN ('copies','plant') AND (p_plant_id IS NULL OR COALESCE(p_copies_count, 0) < 1) THEN
    RAISE EXCEPTION 'Un premio de tipo "%" necesita planta y cantidad', p_reward_type;
  END IF;

  UPDATE public.battle_pass_levels
     SET required_elo = p_required_elo,
         arena_name   = p_arena_name,
         reward_type  = p_reward_type,
         pack_id      = p_pack_id,
         pack_count   = p_pack_count,
         plant_id     = p_plant_id,
         copies_count = p_copies_count,
         label        = COALESCE(p_label, label)
   WHERE level = p_level;

  IF NOT FOUND THEN
    -- Etiqueta por defecto: label es NOT NULL y el INSERT no tiene fila previa
    -- de la que heredarla.
    v_label := COALESCE(NULLIF(btrim(COALESCE(p_label, '')), ''), 'Nivel ' || p_level);

    INSERT INTO public.battle_pass_levels (
      level, required_elo, arena_name, reward_type,
      pack_id, pack_count, plant_id, copies_count, label
    ) VALUES (
      p_level, p_required_elo, COALESCE(p_arena_name, 'Arena'), p_reward_type,
      p_pack_id, p_pack_count, p_plant_id, p_copies_count, v_label
    );
  END IF;

  RETURN jsonb_build_object('success', TRUE, 'level', p_level);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_save_battle_pass_level(
  INTEGER,INTEGER,TEXT,TEXT,TEXT,INTEGER,TEXT,INTEGER,TEXT) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_save_battle_pass_level(
  INTEGER,INTEGER,TEXT,TEXT,TEXT,INTEGER,TEXT,INTEGER,TEXT) TO authenticated;

INSERT INTO public._migration_audit (fase, detalle)
VALUES ('fix_login_usuario', jsonb_build_object('ok', true));

COMMIT;


-- =============================================================================
-- COMPROBACIONES
-- =============================================================================

-- 1. El comodín ya NO devuelve nada. Las tres primeras deben dar NULL.
SELECT
  public.get_email_by_username('%')   AS con_comodin,
  public.get_email_by_username('a%')  AS con_prefijo,
  public.get_email_by_username('_')   AS con_guion_bajo,
  public.get_email_by_username('')    AS vacio;

-- 2. Un nombre real SÍ debe resolver (sustituye por uno de los tuyos).
SELECT p.username,
       public.get_email_by_username(p.username) IS NOT NULL AS resuelve,
       public.get_email_by_username(upper(p.username)) IS NOT NULL AS resuelve_en_mayusculas
  FROM public.profiles p LIMIT 5;

-- 3. Ninguna SECURITY DEFINER sin auth.uid() ni ejecutable por anon, salvo las
--    tres que deben serlo: handle_new_user (trigger), current_user_is_admin
--    (helper) y get_email_by_username (parte del login).
--    Espera 0 filas.
SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_ejecuta
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.prosecdef
   AND p.proname NOT IN ('handle_new_user','current_user_is_admin','get_email_by_username')
   AND (has_function_privilege('anon', p.oid, 'EXECUTE')
        OR pg_get_functiondef(p.oid) NOT ILIKE '%auth.uid()%');
