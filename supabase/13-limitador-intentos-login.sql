-- =============================================================================
-- PLANT ARENA · LIMITADOR DE INTENTOS DE INICIO DE SESIÓN
--
-- Idempotente.
--
-- Da soporte a la Edge Function supabase/functions/login. Contar intentos por IP
-- es justo lo que el navegador no puede hacer: era la pieza que faltaba para
-- que el inicio de sesión por nombre de usuario dejara de necesitar exponer los
-- correos.
--
-- Nadie salvo la Edge Function (que usa service_role) puede tocar estas
-- funciones: no se conceden ni a anon ni a authenticated.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.login_attempts (
    key          TEXT PRIMARY KEY,         -- IP del solicitante
    attempts     INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    window_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    blocked_until TIMESTAMPTZ
);

ALTER TABLE public.login_attempts ENABLE ROW LEVEL SECURITY;
-- Sin políticas: sólo service_role la ve. Es intencional — contiene direcciones
-- IP y no debe ser legible por los jugadores.

CREATE INDEX IF NOT EXISTS idx_login_attempts_window
  ON public.login_attempts (window_start);

-- Parámetros, editables sin tocar código.
INSERT INTO public.shop_config (key, value) VALUES
  ('login_max_attempts', 10),      -- fallos permitidos por ventana
  ('login_window_minutes', 15),    -- duración de la ventana
  ('login_block_minutes', 15)      -- bloqueo tras agotarla
ON CONFLICT (key) DO NOTHING;


-- -----------------------------------------------------------------------------
-- ¿Puede intentarlo? No consume nada: sólo consulta.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_login_rate_limit(p_key TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row      RECORD;
  v_max      INTEGER;
  v_ventana  INTEGER;
BEGIN
  IF p_key IS NULL OR btrim(p_key) = '' THEN RETURN TRUE; END IF;

  SELECT value::INTEGER INTO v_max     FROM public.shop_config WHERE key = 'login_max_attempts';
  SELECT value::INTEGER INTO v_ventana FROM public.shop_config WHERE key = 'login_window_minutes';
  v_max     := COALESCE(v_max, 10);
  v_ventana := COALESCE(v_ventana, 15);

  SELECT * INTO v_row FROM public.login_attempts WHERE key = p_key;
  IF NOT FOUND THEN RETURN TRUE; END IF;

  -- Bloqueo activo
  IF v_row.blocked_until IS NOT NULL AND v_row.blocked_until > NOW() THEN
    RETURN FALSE;
  END IF;

  -- Ventana expirada: cuenta como si empezara de cero
  IF v_row.window_start < NOW() - make_interval(mins => v_ventana) THEN
    RETURN TRUE;
  END IF;

  RETURN v_row.attempts < v_max;
END;
$$;


-- -----------------------------------------------------------------------------
-- Registrar un fallo. Sólo se llama cuando la contraseña es incorrecta, para no
-- penalizar a quien acierta.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.register_failed_login(p_key TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_max      INTEGER;
  v_ventana  INTEGER;
  v_bloqueo  INTEGER;
  v_attempts INTEGER;
BEGIN
  IF p_key IS NULL OR btrim(p_key) = '' THEN RETURN; END IF;

  SELECT value::INTEGER INTO v_max     FROM public.shop_config WHERE key = 'login_max_attempts';
  SELECT value::INTEGER INTO v_ventana FROM public.shop_config WHERE key = 'login_window_minutes';
  SELECT value::INTEGER INTO v_bloqueo FROM public.shop_config WHERE key = 'login_block_minutes';
  v_max     := COALESCE(v_max, 10);
  v_ventana := COALESCE(v_ventana, 15);
  v_bloqueo := COALESCE(v_bloqueo, 15);

  INSERT INTO public.login_attempts (key, attempts, window_start)
  VALUES (p_key, 1, NOW())
  ON CONFLICT (key) DO UPDATE
    SET attempts = CASE
          -- Ventana expirada: reiniciar la cuenta
          WHEN login_attempts.window_start < NOW() - make_interval(mins => v_ventana) THEN 1
          ELSE login_attempts.attempts + 1
        END,
        window_start = CASE
          WHEN login_attempts.window_start < NOW() - make_interval(mins => v_ventana) THEN NOW()
          ELSE login_attempts.window_start
        END,
        blocked_until = NULL
  RETURNING attempts INTO v_attempts;

  IF v_attempts >= v_max THEN
    UPDATE public.login_attempts
       SET blocked_until = NOW() + make_interval(mins => v_bloqueo)
     WHERE key = p_key;
  END IF;
END;
$$;


-- -----------------------------------------------------------------------------
-- Limpiar tras un inicio de sesión correcto.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.clear_login_attempts(p_key TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_key IS NULL OR btrim(p_key) = '' THEN RETURN; END IF;
  DELETE FROM public.login_attempts WHERE key = p_key;
END;
$$;


-- -----------------------------------------------------------------------------
-- Ninguna de las tres es invocable desde el navegador. Sólo la Edge Function,
-- que usa service_role y por tanto no pasa por estos permisos.
-- -----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.check_login_rate_limit(TEXT) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.register_failed_login(TEXT)  FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.clear_login_attempts(TEXT)   FROM anon, authenticated, PUBLIC;


-- -----------------------------------------------------------------------------
-- Con la Edge Function en marcha, get_email_by_username deja de ser necesaria.
-- No se borra todavía para no romper el cliente antes de desplegarlo: cuando
-- confirmes que el login nuevo funciona, ejecuta la línea comentada.
-- -----------------------------------------------------------------------------
COMMENT ON FUNCTION public.get_email_by_username(TEXT) IS
  'OBSOLETA: la resuelve la Edge Function login, que no devuelve el correo. Borrar cuando el cliente nuevo esté desplegado: DROP FUNCTION public.get_email_by_username(TEXT);';

-- DROP FUNCTION IF EXISTS public.get_email_by_username(TEXT);   -- ← tras desplegar

INSERT INTO public._migration_audit (fase, detalle)
VALUES ('limitador_login', jsonb_build_object('ok', true));

COMMIT;


-- =============================================================================
-- COMPROBACIONES
-- =============================================================================

-- 1. Parámetros cargados.
SELECT key, value FROM public.shop_config
 WHERE key LIKE 'login_%' ORDER BY key;

-- 2. Las tres funciones existen y NO son invocables desde el navegador.
--    Espera anon_ejecuta = false y auth_ejecuta = false en las tres.
SELECT p.proname,
       has_function_privilege('anon', p.oid, 'EXECUTE')          AS anon_ejecuta,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_ejecuta
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN ('check_login_rate_limit','register_failed_login','clear_login_attempts')
 ORDER BY p.proname;

-- 3. login_attempts no debe ser legible por los jugadores: contiene IPs.
--    Espera 0 filas.
SELECT grantee, privilege_type
  FROM information_schema.role_table_grants
 WHERE table_schema = 'public' AND table_name = 'login_attempts'
   AND grantee IN ('anon','authenticated');
