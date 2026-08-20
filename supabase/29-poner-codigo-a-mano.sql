-- =============================================================================
-- PLANT ARENA · PONER EL CÓDIGO DE REFERIDO A MANO
--
-- Idempotente. Ejecutar después de la 28.
--
-- POR QUÉ HACE FALTA
--   El enganche sólo ocurría al entrar con «?ref=CÓDIGO» en la dirección. Y eso
--   se pierde con facilidad: te mandan el enlace por WhatsApp y lo abres desde la
--   vista previa sin parámetros, o te dicen el código por voz, o te registras
--   primero y te acuerdas después. En todos esos casos el amigo que te trajo no
--   contaba, y no había forma de arreglarlo desde el juego.
--
--   Ahora se puede escribir el código en la pantalla de referidos. Es la misma
--   función de siempre (referral_bind) con las mismas cuatro reglas: lo único
--   nuevo es que la pantalla sabe SI puede ofrecer el cuadro, y por qué no cuando
--   no puede.
--
-- LA PARTE IMPORTANTE: UNA SOLA DEFINICIÓN DE LAS REGLAS
--   La pantalla necesita saber si el jugador puede usar un código, y referral_bind
--   necesita comprobarlo antes de aceptar. Escribir esas cuatro reglas en los dos
--   sitios es pedir que se separen con el tiempo: el cuadro se enseñaría cuando ya
--   no vale, o se escondería cuando sí.
--
--   Así que las reglas viven en UNA función interna y las dos la llaman. Devuelve
--   el motivo por el que no se puede, o NULL si se puede.
-- =============================================================================

BEGIN;

DO $preflight$
BEGIN
  IF to_regprocedure('public.referral_bind(text)') IS NULL THEN
    RAISE EXCEPTION 'Falta la 27: no existe referral_bind()';
  END IF;
END
$preflight$;


-- -----------------------------------------------------------------------------
-- 1. LAS REGLAS, EN UN SOLO SITIO
--
--    NULL = puede engancharse a un código. Si no, el motivo.
--
--    Las cuatro son las que impiden que esto sea una máquina de regalar:
--      · ya tiene referidor  → cambiarlo sería un negocio (esperar a ver quién va
--                              ganando el ranking y ponerse con ese);
--      · cuenta vieja        → dos veteranos se pondrían de referido mutuo el día
--                              que les conviniera;
--      · ya pasó las copas   → sería cobrar por alguien que ya estaba jugando.
--    (La cuarta, «no tu propio código», depende del código y va en referral_bind.)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._motivo_para_no_vincular(p_uid UUID)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_perfil RECORD;
  v_plazo  INTEGER;
  v_umbral INTEGER;
BEGIN
  SELECT * INTO v_perfil FROM public.profiles WHERE id = p_uid;
  IF NOT FOUND THEN RETURN 'sin_perfil'; END IF;

  IF EXISTS (SELECT 1 FROM public.referrals WHERE referred_id = p_uid) THEN
    RETURN 'ya_tienes_referidor';
  END IF;

  SELECT COALESCE(value::INTEGER, 7) INTO v_plazo
    FROM public.shop_config WHERE key = 'ref_dias_para_vincular';
  IF v_perfil.created_at < NOW() - make_interval(days => COALESCE(v_plazo, 7)) THEN
    RETURN 'cuenta_demasiado_antigua';
  END IF;

  SELECT COALESCE(value::INTEGER, 1100) INTO v_umbral
    FROM public.shop_config WHERE key = 'ref_copas_validas';
  IF v_perfil.elo_rating >= COALESCE(v_umbral, 1100) THEN
    RETURN 'ya_pasaste_las_copas';
  END IF;

  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public._motivo_para_no_vincular(UUID)
  FROM anon, authenticated, PUBLIC;


-- -----------------------------------------------------------------------------
-- 2. referral_bind USA ESAS REGLAS
--
--    Mismo comportamiento que en la 27; lo que cambia es que las reglas ya no
--    están escritas aquí dentro.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.referral_bind(p_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid    UUID := auth.uid();
  v_motivo TEXT;
  v_dueño  UUID;
  v_temp   UUID;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF p_code IS NULL OR length(trim(p_code)) = 0 THEN
    RETURN jsonb_build_object('ok', FALSE, 'motivo', 'sin_codigo');
  END IF;

  v_motivo := public._motivo_para_no_vincular(v_uid);
  IF v_motivo IS NOT NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'motivo', v_motivo);
  END IF;

  -- El código puede venir escrito a mano: se quitan espacios y se ignoran
  -- mayúsculas. Nadie debería perder un referido por teclear en minúscula.
  SELECT id INTO v_dueño FROM public.profiles
   WHERE upper(referral_code) = upper(trim(p_code));
  IF v_dueño IS NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'motivo', 'codigo_no_existe');
  END IF;
  IF v_dueño = v_uid THEN
    RETURN jsonb_build_object('ok', FALSE, 'motivo', 'es_tu_propio_codigo');
  END IF;

  SELECT id INTO v_temp FROM public.referral_seasons WHERE status = 'open' LIMIT 1;

  INSERT INTO public.referrals (referred_id, referrer_id, season_id)
  VALUES (v_uid, v_dueño, v_temp)
  ON CONFLICT (referred_id) DO NOTHING;

  UPDATE public.profiles SET referred_by = v_dueño WHERE id = v_uid;

  RETURN jsonb_build_object(
    'ok', TRUE,
    -- El nick de quien te invitó, para poder decir «te invitó Fulano» en lugar de
    -- un «hecho» a secas.
    'referidor', (SELECT username FROM public.profiles WHERE id = v_dueño)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.referral_bind(TEXT) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.referral_bind(TEXT) TO authenticated;


-- -----------------------------------------------------------------------------
-- 3. my_referrals DICE SI HAY QUE ENSEÑAR EL CUADRO
--
--    Tres datos nuevos y nada más:
--      · quién te invitó, si ya tienes referidor;
--      · si puedes usar un código ahora mismo;
--      · el motivo por el que no, para poder explicarlo en lugar de esconder el
--        cuadro sin más — un cuadro que desaparece parece un fallo.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.my_referrals()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid     UUID := auth.uid();
  v_perfil  RECORD;
  v_temp    RECORD;
  v_validos INTEGER;
  v_total   INTEGER;
  v_sin_cobrar INTEGER;
  v_oro     INTEGER;
  v_meta_sobre INTEGER;
  v_meta_gemas INTEGER;
  v_cupo    INTEGER;
  v_usados  INTEGER;
  v_puesto  INTEGER;
  v_meta_actual INTEGER;
  v_meta_siguiente INTEGER;
  v_total_global INTEGER;
  v_motivo  TEXT;
  v_plazo   INTEGER;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  PERFORM public._cerrar_temporada_de_referidos();

  SELECT * INTO v_perfil FROM public.profiles WHERE id = v_uid;
  SELECT * INTO v_temp FROM public.referral_seasons WHERE status = 'open' LIMIT 1;

  SELECT COUNT(*) FILTER (WHERE valid_at IS NOT NULL),
         COUNT(*),
         COUNT(*) FILTER (WHERE valid_at IS NOT NULL AND gold_claimed_at IS NULL)
    INTO v_validos, v_total, v_sin_cobrar
    FROM public.referrals WHERE referrer_id = v_uid;

  SELECT COALESCE(value::INTEGER, 100) INTO v_oro
    FROM public.shop_config WHERE key = 'ref_oro_por_amigo';
  SELECT COALESCE(value::INTEGER, 10) INTO v_meta_sobre
    FROM public.shop_config WHERE key = 'ref_meta_sobre';
  SELECT COALESCE(value::INTEGER, 25) INTO v_meta_gemas
    FROM public.shop_config WHERE key = 'ref_meta_gemas';
  SELECT COALESCE(value::INTEGER, 5) INTO v_cupo
    FROM public.shop_config WHERE key = 'ref_cupo_meta_gemas';
  SELECT COALESCE(value::INTEGER, 7) INTO v_plazo
    FROM public.shop_config WHERE key = 'ref_dias_para_vincular';

  SELECT COUNT(*) INTO v_usados FROM public.referral_claims
   WHERE kind = 'gemas_25' AND season_id = v_temp.id;

  SELECT COUNT(*) INTO v_total_global
    FROM public.referrals
   WHERE season_id = v_temp.id AND valid_at IS NOT NULL;

  SELECT t.puesto INTO v_puesto FROM (
    SELECT r.referrer_id,
           ROW_NUMBER() OVER (ORDER BY COUNT(*) DESC, MAX(r.valid_at) ASC) AS puesto
      FROM public.referrals r
     WHERE r.season_id = v_temp.id AND r.valid_at IS NOT NULL
     GROUP BY r.referrer_id
  ) AS t WHERE t.referrer_id = v_uid;

  SELECT MAX(meta) INTO v_meta_actual
    FROM public.referral_prizes WHERE meta <= v_total_global;
  SELECT MIN(meta) INTO v_meta_siguiente
    FROM public.referral_prizes WHERE meta > v_total_global;

  -- La MISMA función que usa referral_bind para aceptar o rechazar. Si la
  -- pantalla lo decidiera por su cuenta, acabaría enseñando el cuadro cuando ya
  -- no vale o escondiéndolo cuando sí.
  v_motivo := public._motivo_para_no_vincular(v_uid);

  RETURN jsonb_build_object(
    'codigo', v_perfil.referral_code,

    -- ── EL CÓDIGO A MANO ────────────────────────────────────────────────────
    'puedoUsarCodigo', v_motivo IS NULL,
    'motivoNoPuedo',   v_motivo,
    'miReferidor', (
      SELECT p.username FROM public.referrals r
        JOIN public.profiles p ON p.id = r.referrer_id
       WHERE r.referred_id = v_uid
    ),
    -- Días que le quedan para poder usar un código. Sirve para que la pantalla
    -- pueda meter prisa en lugar de callarse hasta que sea tarde.
    'diasParaUsarCodigo', GREATEST(0, CEIL(
      EXTRACT(EPOCH FROM (v_perfil.created_at + make_interval(days => COALESCE(v_plazo, 7)) - NOW()))
      / 86400)),

    'amigos', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'nombre',  p.username,
               'avatar',  p.avatar_id,
               'copas',   p.elo_rating,
               'valido',  r.valid_at IS NOT NULL,
               'oroCobrado', r.gold_claimed_at IS NOT NULL,
               'desde',   r.created_at
             ) ORDER BY r.created_at DESC)
        FROM public.referrals r JOIN public.profiles p ON p.id = r.referred_id
       WHERE r.referrer_id = v_uid
    ), '[]'::JSONB),
    'total',   v_total,
    'validos', v_validos,
    'copasNecesarias', COALESCE(
      (SELECT value::INTEGER FROM public.shop_config WHERE key = 'ref_copas_validas'), 1100),

    'oroPorCobrar', v_sin_cobrar * v_oro,
    'amigosSinCobrar', v_sin_cobrar,
    'oroPorAmigo', v_oro,

    'metaSobre', jsonb_build_object(
      'objetivo',  v_meta_sobre,
      'alcanzada', v_validos >= v_meta_sobre,
      'cobrada',   EXISTS (SELECT 1 FROM public.referral_claims
                            WHERE user_id = v_uid AND kind = 'sobre_10'
                              AND season_id = v_temp.id)
    ),
    'metaGemas', jsonb_build_object(
      'objetivo',  v_meta_gemas,
      'gemas',     COALESCE((SELECT value FROM public.shop_config
                              WHERE key = 'ref_gemas_de_la_meta'), 5),
      'alcanzada', v_validos >= v_meta_gemas,
      'cobrada',   EXISTS (SELECT 1 FROM public.referral_claims
                            WHERE user_id = v_uid AND kind = 'gemas_25'
                              AND season_id = v_temp.id),
      'cupo',      v_cupo,
      'quedan',    GREATEST(0, v_cupo - v_usados)
    ),

    'temporada', jsonb_build_object(
      'terminaEn',  v_temp.ends_at,
      'empezoEn',   v_temp.starts_at,
      'segundos',   GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (v_temp.ends_at - NOW()))))
    ),
    'miPuesto',   v_puesto,
    'totalGlobal', v_total_global,
    'metaActual', v_meta_actual,
    'metaSiguiente', v_meta_siguiente,
    'premios', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'meta', meta, 'puesto', puesto,
               'gemas', gemas, 'sobres', sobres, 'p2pPct', p2p_pct
             ) ORDER BY meta, puesto)
        FROM public.referral_prizes
    ), '[]'::JSONB),
    'ranking', public.referral_leaderboard(10)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.my_referrals() FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.my_referrals() TO authenticated;


INSERT INTO public._migration_audit (fase, detalle)
VALUES ('codigo_de_referido_a_mano', jsonb_build_object('ok', TRUE));

COMMIT;


-- =============================================================================
-- COMPROBACIONES
-- =============================================================================

-- 1. La regla es interna.
SELECT p.proname,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS puede_authenticated
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = '_motivo_para_no_vincular';
-- Debe salir FALSE.

-- 2. Quién puede usar un código y quién no, y por qué.
SELECT p.username,
       p.elo_rating,
       ROUND(EXTRACT(EPOCH FROM (NOW() - p.created_at)) / 86400, 1) AS dias_de_cuenta,
       COALESCE(public._motivo_para_no_vincular(p.id), '— puede —') AS estado
  FROM public.profiles p
 ORDER BY p.created_at DESC
 LIMIT 10;
