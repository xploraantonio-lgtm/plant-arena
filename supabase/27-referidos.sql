-- =============================================================================
-- PLANT ARENA · REFERIDOS DE VERDAD, Y EL REPARTO DEL COMERCIO P2P
--
-- Idempotente. Ejecutar después de la 26.
--
-- DE QUÉ SE PARTE
--   El programa de referidos era decoración. Tres cosas lo delataban:
--     · el enlace era «/?ref=<nombre>» y NADIE leía ese parámetro;
--     · profiles.referral_code estaba a NULL para todo el mundo (ningún trigger
--       lo rellenaba);
--     · «Amigos Invitados» y «Bonos Ganados» eran dos ceros guardados en el
--       navegador, no una cuenta de nada.
--   O sea que un jugador podía repartir su enlace a cien personas y no pasaba
--   absolutamente nada.
--
-- QUÉ SE MONTA AQUÍ
--   1. Un código por jugador, y un enlace que sí se registra al entrar.
--   2. La cuenta: un amigo cuenta cuando llega a 1100 copas, y cuenta UNA VEZ
--      (queda sellado; si luego baja de copas, sigue contando).
--   3. Las recompensas individuales: 100 de oro por amigo válido, 1 sobre básico
--      a los 10 y 5 gemas a los 25 — estas últimas sólo para los 5 primeros.
--   4. La temporada de 15 días con su ranking y sus premios escalonados por meta
--      colectiva, que se entregan al vencer el contador.
--   5. El reparto del comercio P2P: de la comisión del 10 %, un 3 % del precio va
--      al primero del ranking de referidos y un 1 % al segundo.
--
-- LO QUE HAY QUE TENER CLARO DEL DINERO
--   Sobre una venta de 10 gemas: comisión 1,00, el vendedor cobra 9,00, el top 1
--   se lleva 0,30 y el top 2 se lleva 0,10. Al proyecto le quedan 0,60.
--
--   En el mensaje se decía «0,7 queda para el proyecto», pero 0,3 + 0,1 + 0,7 son
--   1,1 y la comisión es 1,0. Manda el porcentaje, que es la regla operativa:
--   3 % y 1 % del precio, y al proyecto el 6 % restante. Los tres porcentajes
--   están en shop_config, así que si querías 0,7 se cambia sin migración —
--   bajando el reparto al 2 % y el 1 %, por ejemplo.
--
--   Y el reparto NACE APAGADO. Se enciende cuando una temporada llega a la meta
--   de 300 referidos y asigna esos puestos, que es lo que decía la tabla de
--   premios. Mientras no haya nadie asignado, el 10 % entero es del proyecto.
--
-- POR QUÉ TODO PASA POR FUNCIONES Y NINGUNA TABLA SE ABRE AL CLIENTE
--   Aquí hay dinero: oro, gemas, sobres y un porcentaje de cada venta. Una tabla
--   con permiso de escritura sería una forma de regalarse referidos. Las tablas
--   nuevas quedan sin GRANT ninguno; se leen y se escriben sólo desde estas
--   funciones, que comprueban quién llama.
-- =============================================================================

BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('public.player_packs') IS NULL THEN
    RAISE EXCEPTION 'Falta la 05: no existe player_packs';
  END IF;
  IF to_regprocedure('public.current_user_is_admin()') IS NULL THEN
    RAISE EXCEPTION 'Falta la 01: no existe current_user_is_admin()';
  END IF;
END
$preflight$;


-- -----------------------------------------------------------------------------
-- 0. AJUSTES
--
--    Todo número que se pueda querer tocar sin desplegar vive aquí. shop_config
--    es NUMERIC, así que los interruptores van como 0/1.
-- -----------------------------------------------------------------------------
INSERT INTO public.shop_config (key, value) VALUES
  -- Copas a las que un amigo invitado empieza a contar.
  ('ref_copas_validas',      1100),
  -- Oro por cada amigo que llega ahí.
  ('ref_oro_por_amigo',      100),
  -- Las dos metas individuales y lo que dan.
  ('ref_meta_sobre',         10),
  ('ref_meta_gemas',         25),
  ('ref_gemas_de_la_meta',   5),
  -- «Un validador sólo para los 5 primeros»: cupo global de la meta de 25.
  ('ref_cupo_meta_gemas',    5),
  -- Duración de la temporada.
  ('ref_dias_temporada',     15),
  -- Plazo para engancharse a un enlace, en días desde que se creó la cuenta. Sin
  -- esto, dos veteranos podrían ponerse de referido mutuo cuando les convenga.
  ('ref_dias_para_vincular', 7),
  -- Comercio P2P: comisión total y el trozo que va al ranking.
  ('p2p_comision_pct',       10),
  ('p2p_top1_pct',           3),
  ('p2p_top2_pct',           1),
  -- Apagado hasta que una temporada asigne los puestos con premio de P2P.
  ('p2p_reparto_activo',     0)
ON CONFLICT (key) DO NOTHING;   -- DO NOTHING: no pisar un ajuste ya cambiado


-- -----------------------------------------------------------------------------
-- 1. UN CÓDIGO PARA CADA JUGADOR
--
--    Siete caracteres de un alfabeto sin parecidos: nada de O/0, I/1, S/5. Un
--    código de referido se dicta por voz y se teclea a mano, así que el ahorro de
--    confusiones vale más que el par de bits que se pierden.
--
--    Sin pgcrypto: gen_random_uuid() y md5() están en pg_catalog y funcionan en
--    cualquier proyecto. (Es la lección de la 26, donde gen_random_bytes dejó el
--    botón de compartir muerto por vivir en otro esquema.)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._nuevo_codigo_de_referido()
RETURNS TEXT
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  c_alfabeto CONSTANT TEXT := 'ABCDEFGHJKLMNPQRTUVWXY2346789';
  v_codigo TEXT;
  v_hex    TEXT;
  i        INTEGER;
BEGIN
  FOR intento IN 1..20 LOOP
    v_codigo := '';
    v_hex := md5(gen_random_uuid()::TEXT);
    FOR i IN 0..6 LOOP
      -- Dos dígitos hex (0..255) llevados al alfabeto.
      v_codigo := v_codigo || substr(
        c_alfabeto,
        1 + (('x' || substr(v_hex, 1 + i * 2, 2))::BIT(8)::INTEGER % length(c_alfabeto)),
        1
      );
    END LOOP;

    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE referral_code = v_codigo) THEN
      RETURN v_codigo;
    END IF;
  END LOOP;

  -- 29^7 son 17 mil millones: veinte intentos fallidos no es mala suerte, es un
  -- fallo. Mejor romper que devolver algo repetido y saltarse el UNIQUE.
  RAISE EXCEPTION 'No se pudo generar un código de referido único';
END;
$$;

REVOKE EXECUTE ON FUNCTION public._nuevo_codigo_de_referido() FROM anon, authenticated, PUBLIC;


-- Todo perfil nuevo sale con código. Va en un trigger aparte y no dentro del de
-- la 02 a propósito: así esta migración no reescribe una función que ya funciona.
CREATE OR REPLACE FUNCTION public._poner_codigo_de_referido()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.referral_code IS NULL THEN
    UPDATE public.profiles
       SET referral_code = public._nuevo_codigo_de_referido()
     WHERE id = NEW.id AND referral_code IS NULL;
  END IF;
  RETURN NULL;
END;
$$;

-- Las funciones de disparador no las llama nadie a mano: el permiso por defecto
-- se retira igual. Un disparador se ejecuta con el derecho del dueño de la tabla,
-- así que quitarlo no lo rompe — y el control de la prueba de emparejamiento
-- («ninguna función interna es llamable por authenticated») deja de saltar.
REVOKE EXECUTE ON FUNCTION public._poner_codigo_de_referido() FROM anon, authenticated, PUBLIC;

DROP TRIGGER IF EXISTS trg_codigo_de_referido ON public.profiles;
CREATE TRIGGER trg_codigo_de_referido
  AFTER INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public._poner_codigo_de_referido();

-- Y los que ya estaban.
DO $$
DECLARE v_id UUID;
BEGIN
  FOR v_id IN SELECT id FROM public.profiles WHERE referral_code IS NULL LOOP
    UPDATE public.profiles
       SET referral_code = public._nuevo_codigo_de_referido()
     WHERE id = v_id;
  END LOOP;
END $$;


-- -----------------------------------------------------------------------------
-- 2. LAS TABLAS
-- -----------------------------------------------------------------------------

-- La temporada. Una abierta como máximo.
CREATE TABLE IF NOT EXISTS public.referral_seasons (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    starts_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ends_at    TIMESTAMPTZ NOT NULL,
    status     TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
    closed_at  TIMESTAMPTZ,
    /** Referidos válidos que se contaron al cerrar. */
    total_validos INTEGER,
    /** La meta que se alcanzó, y por tanto la tabla de premios que se aplicó. */
    meta_alcanzada INTEGER,
    /** Quiénes se quedaron con el porcentaje del comercio P2P, si lo hubo. */
    p2p_top1_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    p2p_top2_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    CHECK (ends_at > starts_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_referral_seasons_una_abierta
  ON public.referral_seasons ((status)) WHERE status = 'open';

ALTER TABLE public.referral_seasons ENABLE ROW LEVEL SECURITY;


-- Quién trajo a quién. La clave primaria es el invitado: se tiene un referidor o
-- ninguno, y para siempre. Sin eso, cambiar de referidor sería un negocio.
CREATE TABLE IF NOT EXISTS public.referrals (
    referred_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
    referrer_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    season_id   UUID REFERENCES public.referral_seasons(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    /** Cuándo llegó a las copas que lo hacen contar. Se sella una vez. */
    valid_at    TIMESTAMPTZ,
    /** Cuándo se cobró el oro por este amigo. */
    gold_claimed_at TIMESTAMPTZ,
    CHECK (referred_id <> referrer_id)
);

CREATE INDEX IF NOT EXISTS idx_referrals_referidor
  ON public.referrals (referrer_id, valid_at);

ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;


-- Las metas individuales ya cobradas.
CREATE TABLE IF NOT EXISTS public.referral_claims (
    user_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    season_id  UUID NOT NULL REFERENCES public.referral_seasons(id) ON DELETE CASCADE,
    kind       TEXT NOT NULL CHECK (kind IN ('sobre_10', 'gemas_25')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, season_id, kind)
);

ALTER TABLE public.referral_claims ENABLE ROW LEVEL SECURITY;


-- La tabla de premios, escalonada por meta colectiva. Es una TABLA y no un CASE
-- dentro de una función para que se pueda ajustar desde el panel sin migración.
CREATE TABLE IF NOT EXISTS public.referral_prizes (
    meta    INTEGER NOT NULL CHECK (meta > 0),
    puesto  INTEGER NOT NULL CHECK (puesto > 0),
    gemas   NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (gemas >= 0),
    sobres  INTEGER NOT NULL DEFAULT 0 CHECK (sobres >= 0),
    /** Porcentaje de cada venta del mercado que se lleva este puesto. */
    p2p_pct NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (p2p_pct >= 0),
    PRIMARY KEY (meta, puesto)
);

ALTER TABLE public.referral_prizes ENABLE ROW LEVEL SECURITY;

-- Los premios tal cual se pidieron.
--
-- Dos rarezas de la tabla que NO son erratas mías: en la meta de 300 el primer
-- puesto no lleva gemas (3 sobres y el 3 % del mercado, que valen más) y el
-- tercero se lleva 3 sobres, más que el segundo. Se deja como se pidió; se
-- cambia con un UPDATE cuando quieras.
INSERT INTO public.referral_prizes (meta, puesto, gemas, sobres, p2p_pct) VALUES
  ( 50, 1, 10, 0, 0), ( 50, 2, 3, 0, 0), ( 50, 3, 1, 0, 0),
  (100, 1, 10, 0, 0), (100, 2, 5, 0, 0), (100, 3, 2, 0, 0),
  (150, 1, 10, 1, 0), (150, 2, 5, 0, 0), (150, 3, 2, 0, 0),
  (200, 1, 10, 3, 0), (200, 2, 5, 1, 0), (200, 3, 2, 0, 0),
  (300, 1,  0, 3, 3), (300, 2, 0, 1, 1), (300, 3, 0, 3, 0),
  (300, 4,  3, 0, 0), (300, 5, 1, 0, 0)
ON CONFLICT (meta, puesto) DO NOTHING;


-- El registro del comercio P2P. Una fila por venta, con el reparto entero.
-- Es lo que se enseña en el panel: sin esto, «cuánto se ha llevado el proyecto»
-- habría que reconstruirlo sumando transacciones sueltas.
CREATE TABLE IF NOT EXISTS public.p2p_fee_ledger (
    id         BIGSERIAL PRIMARY KEY,
    listing_id UUID,
    buyer_id   UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    seller_id  UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    price_gems   NUMERIC(12,2) NOT NULL,
    fee_gems     NUMERIC(12,2) NOT NULL,
    seller_gems  NUMERIC(12,2) NOT NULL,
    top1_id      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    top1_gems    NUMERIC(12,2) NOT NULL DEFAULT 0,
    top2_id      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    top2_gems    NUMERIC(12,2) NOT NULL DEFAULT 0,
    project_gems NUMERIC(12,2) NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_p2p_ledger_fecha ON public.p2p_fee_ledger (created_at DESC);

ALTER TABLE public.p2p_fee_ledger ENABLE ROW LEVEL SECURITY;

-- Ninguna de las cinco se abre al cliente: RLS activo y sin política ninguna, así
-- que sólo las alcanzan las funciones de abajo, que son SECURITY DEFINER y
-- comprueban quién llama. Un GRANT aquí sería poder regalarse referidos.
REVOKE ALL ON public.referral_seasons, public.referrals, public.referral_claims,
              public.referral_prizes, public.p2p_fee_ledger
  FROM anon, authenticated;


-- Los premios y el oro necesitan un tipo de transacción propio para poder
-- auditarlos aparte de los depósitos y las compras.
DO $$
BEGIN
  ALTER TABLE public.transactions DROP CONSTRAINT IF EXISTS transactions_type_check;
  ALTER TABLE public.transactions ADD CONSTRAINT transactions_type_check
    CHECK (type IN ('deposit','withdrawal','colosseum_win','colosseum_bet',
                    'colosseum_refund','tournament_fee','marketplace_buy',
                    'marketplace_sell','clan_deposit','shop_purchase',
                    'referral_reward','p2p_share'));
END $$;

-- Y los sobres de referido se distinguen de los comprados y los de cofre.
DO $$
BEGIN
  ALTER TABLE public.player_packs DROP CONSTRAINT IF EXISTS player_packs_source_check;
  ALTER TABLE public.player_packs ADD CONSTRAINT player_packs_source_check
    CHECK (source IN ('purchase','victory','chest','gift','admin','referral'));
END $$;


-- La primera temporada, si no hay ninguna.
INSERT INTO public.referral_seasons (starts_at, ends_at)
SELECT NOW(), NOW() + make_interval(days => COALESCE(
         (SELECT value::INTEGER FROM public.shop_config WHERE key = 'ref_dias_temporada'), 15))
 WHERE NOT EXISTS (SELECT 1 FROM public.referral_seasons);


-- -----------------------------------------------------------------------------
-- 3. UN AMIGO CUENTA CUANDO LLEGA A LAS COPAS, Y CUENTA PARA SIEMPRE
--
--    El sello es lo importante. Si «válido» se calculara como «ELO >= 1100 ahora
--    mismo», el contador subiría y bajaría con cada derrota del amigo, y una
--    recompensa ya cobrada podría quedar sin merecer. Se sella una vez.
--
--    Va en un trigger sobre profiles y no en la liquidación de la partida para
--    que valga por cualquier camino: partida normal, rendición, cierre por
--    abandono o un ajuste del panel.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._sellar_referido_valido()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_umbral INTEGER;
BEGIN
  SELECT value::INTEGER INTO v_umbral
    FROM public.shop_config WHERE key = 'ref_copas_validas';
  v_umbral := COALESCE(v_umbral, 1100);

  IF NEW.elo_rating >= v_umbral THEN
    UPDATE public.referrals
       SET valid_at = NOW()
     WHERE referred_id = NEW.id AND valid_at IS NULL;
  END IF;

  RETURN NULL;
END;
$$;

-- Sólo cuando cambia el ELO: profiles se actualiza en cada compra y en cada
-- cofre, y no hace falta mirar los referidos en ninguna de esas.
REVOKE EXECUTE ON FUNCTION public._sellar_referido_valido() FROM anon, authenticated, PUBLIC;

DROP TRIGGER IF EXISTS trg_sellar_referido_valido ON public.profiles;
CREATE TRIGGER trg_sellar_referido_valido
  AFTER UPDATE OF elo_rating ON public.profiles
  FOR EACH ROW
  WHEN (OLD.elo_rating IS DISTINCT FROM NEW.elo_rating)
  EXECUTE FUNCTION public._sellar_referido_valido();

-- Los que ya habían llegado antes de existir todo esto.
UPDATE public.referrals r
   SET valid_at = NOW()
  FROM public.profiles p
 WHERE p.id = r.referred_id
   AND r.valid_at IS NULL
   AND p.elo_rating >= COALESCE(
         (SELECT value::INTEGER FROM public.shop_config WHERE key = 'ref_copas_validas'), 1100);


-- -----------------------------------------------------------------------------
-- 4. LA TEMPORADA SE CIERRA SOLA CUANDO ALGUIEN MIRA
--
--    Mismo planteamiento que los barridos de la 22: este proyecto no tiene
--    pg_cron, así que un contador que «se entrega al terminar» no se entregaría
--    nunca. Se cierra cuando alguien abre la pantalla de referidos, que es justo
--    quien está esperando el premio.
--
--    Preguntar más veces no adelanta nada: la fecha la mide el servidor.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._cerrar_temporada_de_referidos()
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_temp    RECORD;
  v_total   INTEGER;
  v_meta    INTEGER;
  v_premio  RECORD;
  v_ganador RECORD;
  v_dias    INTEGER;
  v_pagados INTEGER := 0;
  v_top1    UUID;
  v_top2    UUID;
  i         INTEGER;
BEGIN
  SELECT * INTO v_temp FROM public.referral_seasons
   WHERE status = 'open' AND ends_at <= NOW()
   FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN RETURN jsonb_build_object('cerrada', FALSE); END IF;

  SELECT COUNT(*) INTO v_total
    FROM public.referrals
   WHERE season_id = v_temp.id AND valid_at IS NOT NULL;

  -- La meta más alta que se haya alcanzado. Por debajo de la primera no hay
  -- premios de ranking: la meta es colectiva y no se llegó.
  SELECT MAX(meta) INTO v_meta
    FROM public.referral_prizes WHERE meta <= v_total;

  IF v_meta IS NOT NULL THEN
    -- El ranking de la temporada. El desempate por quién llegó antes a su último
    -- referido válido: sin él, dos empatados a diez cambiarían de puesto en cada
    -- consulta y el premio dependería del azar del ordenamiento.
    FOR v_premio IN
      SELECT * FROM public.referral_prizes WHERE meta = v_meta ORDER BY puesto
    LOOP
      SELECT * INTO v_ganador FROM (
        SELECT r.referrer_id,
               COUNT(*) AS validos,
               MAX(r.valid_at) AS ultimo,
               ROW_NUMBER() OVER (ORDER BY COUNT(*) DESC, MAX(r.valid_at) ASC) AS puesto
          FROM public.referrals r
         WHERE r.season_id = v_temp.id AND r.valid_at IS NOT NULL
         GROUP BY r.referrer_id
      ) AS tabla WHERE tabla.puesto = v_premio.puesto;

      CONTINUE WHEN NOT FOUND;   -- menos jugadores que puestos premiados

      IF v_premio.gemas > 0 THEN
        UPDATE public.profiles SET gems_balance = gems_balance + v_premio.gemas
         WHERE id = v_ganador.referrer_id;
        INSERT INTO public.transactions (user_id, type, amount_gems, description, status)
        VALUES (v_ganador.referrer_id, 'referral_reward', v_premio.gemas,
                'Premio de referidos: puesto ' || v_premio.puesto ||
                ' de la meta de ' || v_meta, 'completed');
      END IF;

      FOR i IN 1..v_premio.sobres LOOP
        INSERT INTO public.player_packs (user_id, pack_id, source)
        VALUES (v_ganador.referrer_id, 'basic', 'referral');
      END LOOP;

      IF v_premio.p2p_pct > 0 THEN
        IF v_premio.puesto = 1 THEN v_top1 := v_ganador.referrer_id;
        ELSIF v_premio.puesto = 2 THEN v_top2 := v_ganador.referrer_id;
        END IF;
      END IF;

      v_pagados := v_pagados + 1;
    END LOOP;
  END IF;

  UPDATE public.referral_seasons
     SET status = 'closed', closed_at = NOW(),
         total_validos = v_total, meta_alcanzada = v_meta,
         p2p_top1_id = v_top1, p2p_top2_id = v_top2
   WHERE id = v_temp.id;

  -- El reparto del mercado se enciende sólo si esta temporada asignó los puestos
  -- que lo llevan (la meta de 300). Si no, se queda como estaba.
  IF v_top1 IS NOT NULL OR v_top2 IS NOT NULL THEN
    UPDATE public.shop_config SET value = 1 WHERE key = 'p2p_reparto_activo';
  END IF;

  -- Y arranca la siguiente, para que el programa no se quede sin temporada.
  SELECT COALESCE(value::INTEGER, 15) INTO v_dias
    FROM public.shop_config WHERE key = 'ref_dias_temporada';
  INSERT INTO public.referral_seasons (starts_at, ends_at)
  VALUES (NOW(), NOW() + make_interval(days => COALESCE(v_dias, 15)));

  RETURN jsonb_build_object(
    'cerrada', TRUE, 'total', v_total, 'meta', v_meta, 'premiados', v_pagados
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public._cerrar_temporada_de_referidos()
  FROM anon, authenticated, PUBLIC;


-- -----------------------------------------------------------------------------
-- 5. ENGANCHARSE A UN ENLACE
--
--    Lo llama el cliente cuando entra con «?ref=CÓDIGO» y ya hay sesión.
--
--    Las cuatro reglas son las que impiden que esto sea una máquina de regalar:
--      · uno mismo, no;
--      · sólo una vez y para siempre;
--      · sólo mientras la cuenta es nueva (7 días), o cualquiera se pondría de
--        referido de un amigo el día que a este le convenga para el ranking;
--      · y no si ya se pasó de las copas que hacen válido a un referido, que
--        sería cobrar por alguien que ya estaba jugando.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.referral_bind(p_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid    UUID := auth.uid();
  v_yo     RECORD;
  v_dueño  UUID;
  v_plazo  INTEGER;
  v_umbral INTEGER;
  v_temp   UUID;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF p_code IS NULL OR length(trim(p_code)) = 0 THEN
    RETURN jsonb_build_object('ok', FALSE, 'motivo', 'sin_codigo');
  END IF;

  SELECT * INTO v_yo FROM public.profiles WHERE id = v_uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Perfil no encontrado'; END IF;

  IF EXISTS (SELECT 1 FROM public.referrals WHERE referred_id = v_uid) THEN
    RETURN jsonb_build_object('ok', FALSE, 'motivo', 'ya_tienes_referidor');
  END IF;

  SELECT id INTO v_dueño FROM public.profiles
   WHERE upper(referral_code) = upper(trim(p_code));
  IF v_dueño IS NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'motivo', 'codigo_no_existe');
  END IF;
  IF v_dueño = v_uid THEN
    RETURN jsonb_build_object('ok', FALSE, 'motivo', 'es_tu_propio_codigo');
  END IF;

  SELECT COALESCE(value::INTEGER, 7) INTO v_plazo
    FROM public.shop_config WHERE key = 'ref_dias_para_vincular';
  IF v_yo.created_at < NOW() - make_interval(days => COALESCE(v_plazo, 7)) THEN
    RETURN jsonb_build_object('ok', FALSE, 'motivo', 'cuenta_demasiado_antigua');
  END IF;

  SELECT COALESCE(value::INTEGER, 1100) INTO v_umbral
    FROM public.shop_config WHERE key = 'ref_copas_validas';
  IF v_yo.elo_rating >= COALESCE(v_umbral, 1100) THEN
    RETURN jsonb_build_object('ok', FALSE, 'motivo', 'ya_pasaste_las_copas');
  END IF;

  SELECT id INTO v_temp FROM public.referral_seasons WHERE status = 'open' LIMIT 1;

  INSERT INTO public.referrals (referred_id, referrer_id, season_id)
  VALUES (v_uid, v_dueño, v_temp)
  ON CONFLICT (referred_id) DO NOTHING;

  -- profiles.referred_by ya existía y hay código que lo mira: se mantiene igual.
  UPDATE public.profiles SET referred_by = v_dueño WHERE id = v_uid;

  RETURN jsonb_build_object('ok', TRUE);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.referral_bind(TEXT) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.referral_bind(TEXT) TO authenticated;


-- -----------------------------------------------------------------------------
-- 6. EL RANKING
--
--    Nicks y cuentas, nada más: un ranking no tiene por qué enseñar saldos ni
--    identificadores. Mismo desempate que al repartir premios, para que lo que
--    se ve sea lo que se va a cobrar.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.referral_leaderboard(p_limite INTEGER DEFAULT 10)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_temp UUID;
BEGIN
  SELECT id INTO v_temp FROM public.referral_seasons WHERE status = 'open' LIMIT 1;
  IF v_temp IS NULL THEN RETURN '[]'::JSONB; END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'puesto',  t.puesto,
             'nombre',  p.username,
             'avatar',  p.avatar_id,
             'validos', t.validos
           ) ORDER BY t.puesto)
      FROM (
        SELECT r.referrer_id,
               COUNT(*) AS validos,
               ROW_NUMBER() OVER (ORDER BY COUNT(*) DESC, MAX(r.valid_at) ASC) AS puesto
          FROM public.referrals r
         WHERE r.season_id = v_temp AND r.valid_at IS NOT NULL
         GROUP BY r.referrer_id
      ) AS t
      JOIN public.profiles p ON p.id = t.referrer_id
     WHERE t.puesto <= GREATEST(1, LEAST(50, COALESCE(p_limite, 10)))
  ), '[]'::JSONB);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.referral_leaderboard(INTEGER) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.referral_leaderboard(INTEGER) TO authenticated;


-- -----------------------------------------------------------------------------
-- 7. MI PANEL DE REFERIDOS
--
--    Todo lo que pinta la pantalla en una sola llamada: el código, los amigos con
--    su estado, lo que se puede cobrar ahora mismo, mi puesto, el contador de la
--    temporada y la tabla de premios de la meta que se lleva.
--
--    De paso cierra la temporada si ya venció. Quien abre esta pantalla es quien
--    espera el premio.
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

  SELECT COUNT(*) INTO v_usados FROM public.referral_claims
   WHERE kind = 'gemas_25' AND season_id = v_temp.id;

  -- Mi puesto y el total colectivo de la temporada.
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

  RETURN jsonb_build_object(
    'codigo', v_perfil.referral_code,
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

    -- Lo que se puede cobrar ahora mismo.
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

    -- La temporada y el ranking.
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


-- -----------------------------------------------------------------------------
-- 8. COBRAR
--
--    El oro y las dos metas. Cada cosa se marca en la misma transacción en que se
--    paga: si el pago falla, no queda marcada; si la marca falla, no se paga.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_referral_gold()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid  UUID := auth.uid();
  v_oro  INTEGER;
  v_n    INTEGER;
  v_total BIGINT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  SELECT COALESCE(value::INTEGER, 100) INTO v_oro
    FROM public.shop_config WHERE key = 'ref_oro_por_amigo';

  -- Se marcan y se cuentan en el mismo UPDATE: así dos pulsaciones a la vez no
  -- pueden cobrar los mismos amigos dos veces.
  WITH cobrados AS (
    UPDATE public.referrals
       SET gold_claimed_at = NOW()
     WHERE referrer_id = v_uid AND valid_at IS NOT NULL AND gold_claimed_at IS NULL
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_n FROM cobrados;

  IF v_n = 0 THEN
    RETURN jsonb_build_object('ok', FALSE, 'motivo', 'nada_que_cobrar');
  END IF;

  v_total := v_n::BIGINT * v_oro;

  UPDATE public.profiles SET gold_balance = gold_balance + v_total WHERE id = v_uid;

  INSERT INTO public.transactions (user_id, type, amount_gems, description, status)
  VALUES (v_uid, 'referral_reward', 0,
          v_total || ' de oro por ' || v_n || ' amigo(s) invitado(s)', 'completed');

  RETURN jsonb_build_object('ok', TRUE, 'oro', v_total, 'amigos', v_n);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_referral_gold() FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.claim_referral_gold() TO authenticated;


CREATE OR REPLACE FUNCTION public.claim_referral_reward(p_kind TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid     UUID := auth.uid();
  v_temp    UUID;
  v_validos INTEGER;
  v_objetivo INTEGER;
  v_gemas   NUMERIC;
  v_cupo    INTEGER;
  v_usados  INTEGER;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF p_kind NOT IN ('sobre_10', 'gemas_25') THEN
    RAISE EXCEPTION 'Recompensa desconocida: %', p_kind;
  END IF;

  SELECT id INTO v_temp FROM public.referral_seasons WHERE status = 'open' LIMIT 1;
  IF v_temp IS NULL THEN RAISE EXCEPTION 'No hay temporada abierta'; END IF;

  -- Se bloquea el perfil para que dos pulsaciones simultáneas no pasen las dos.
  PERFORM 1 FROM public.profiles WHERE id = v_uid FOR UPDATE;

  IF EXISTS (SELECT 1 FROM public.referral_claims
              WHERE user_id = v_uid AND kind = p_kind AND season_id = v_temp) THEN
    RETURN jsonb_build_object('ok', FALSE, 'motivo', 'ya_cobrada');
  END IF;

  SELECT COUNT(*) INTO v_validos FROM public.referrals
   WHERE referrer_id = v_uid AND valid_at IS NOT NULL;

  IF p_kind = 'sobre_10' THEN
    SELECT COALESCE(value::INTEGER, 10) INTO v_objetivo
      FROM public.shop_config WHERE key = 'ref_meta_sobre';
    IF v_validos < v_objetivo THEN
      RETURN jsonb_build_object('ok', FALSE, 'motivo', 'faltan_amigos',
                                'tienes', v_validos, 'necesitas', v_objetivo);
    END IF;

    INSERT INTO public.referral_claims (user_id, season_id, kind)
    VALUES (v_uid, v_temp, 'sobre_10');

    INSERT INTO public.player_packs (user_id, pack_id, source)
    VALUES (v_uid, 'basic', 'referral');

    RETURN jsonb_build_object('ok', TRUE, 'sobres', 1);
  END IF;

  -- gemas_25, con cupo global: «un validador sólo para los 5 primeros».
  SELECT COALESCE(value::INTEGER, 25) INTO v_objetivo
    FROM public.shop_config WHERE key = 'ref_meta_gemas';
  SELECT COALESCE(value, 5) INTO v_gemas
    FROM public.shop_config WHERE key = 'ref_gemas_de_la_meta';
  SELECT COALESCE(value::INTEGER, 5) INTO v_cupo
    FROM public.shop_config WHERE key = 'ref_cupo_meta_gemas';

  IF v_validos < v_objetivo THEN
    RETURN jsonb_build_object('ok', FALSE, 'motivo', 'faltan_amigos',
                              'tienes', v_validos, 'necesitas', v_objetivo);
  END IF;

  -- El cupo se cuenta con la tabla bloqueada: si no, cinco jugadores a la vez
  -- podrían pasar los cinco el control y cobrar seis.
  LOCK TABLE public.referral_claims IN SHARE ROW EXCLUSIVE MODE;
  SELECT COUNT(*) INTO v_usados FROM public.referral_claims
   WHERE kind = 'gemas_25' AND season_id = v_temp;
  IF v_usados >= v_cupo THEN
    RETURN jsonb_build_object('ok', FALSE, 'motivo', 'cupo_agotado', 'cupo', v_cupo);
  END IF;

  INSERT INTO public.referral_claims (user_id, season_id, kind)
  VALUES (v_uid, v_temp, 'gemas_25');

  UPDATE public.profiles SET gems_balance = gems_balance + v_gemas WHERE id = v_uid;
  INSERT INTO public.transactions (user_id, type, amount_gems, description, status)
  VALUES (v_uid, 'referral_reward', v_gemas,
          'Meta de ' || v_objetivo || ' referidos', 'completed');

  RETURN jsonb_build_object('ok', TRUE, 'gemas', v_gemas,
                            'quedan', GREATEST(0, v_cupo - v_usados - 1));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_referral_reward(TEXT) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.claim_referral_reward(TEXT) TO authenticated;


-- -----------------------------------------------------------------------------
-- 9. COMPRAR EN EL MERCADO, CON LA COMISIÓN DEL 10 % Y SU REPARTO
--
--    Cambia lo que había: la comisión era del 5 % y el reparto no existía.
--
--    Sobre una venta de 10 gemas:
--      comisión  1,00   (10 %)
--      vendedor  9,00
--      top 1     0,30   (3 % del precio)
--      top 2     0,10   (1 % del precio)
--      proyecto  0,60   (lo que queda de la comisión)
--
--    Con el reparto apagado, los 1,00 enteros son del proyecto.
--
--    Cada venta deja una fila en p2p_fee_ledger con el reparto completo. Es lo
--    que se enseña en el panel: sin ese registro, «cuánto se ha llevado el
--    proyecto» habría que reconstruirlo sumando transacciones sueltas, y el 3 %
--    de un tercero no se podría auditar en absoluto.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.buy_marketplace_card(p_listing_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid    UUID := auth.uid();
  v_list   RECORD;
  v_saldo  NUMERIC;
  v_pct    NUMERIC;
  v_comision NUMERIC;
  v_vendedor NUMERIC;
  v_activo BOOLEAN;
  v_top1   UUID;
  v_top2   UUID;
  v_g1     NUMERIC := 0;
  v_g2     NUMERIC := 0;
  v_proyecto NUMERIC;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  SELECT * INTO v_list FROM public.marketplace_listings
   WHERE id = p_listing_id AND status = 'active' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Esta carta ya no está disponible'; END IF;
  IF v_list.seller_id = v_uid THEN RAISE EXCEPTION 'No puedes comprar tu propia carta'; END IF;

  -- Bloqueo en orden estable de id: evita interbloqueos con compras cruzadas.
  PERFORM 1 FROM public.profiles
    WHERE id IN (v_uid, v_list.seller_id) ORDER BY id FOR UPDATE;

  SELECT gems_balance INTO v_saldo FROM public.profiles WHERE id = v_uid;
  IF v_saldo IS NULL OR v_saldo < v_list.price_gems THEN
    RAISE EXCEPTION 'Saldo insuficiente';
  END IF;

  SELECT COALESCE(value, 10) INTO v_pct FROM public.shop_config
   WHERE key = 'p2p_comision_pct';
  v_pct := LEAST(GREATEST(COALESCE(v_pct, 10), 0), 100);

  v_comision := ROUND(v_list.price_gems * v_pct / 100, 2);
  v_vendedor := v_list.price_gems - v_comision;

  -- ── EL REPARTO ────────────────────────────────────────────────────────────
  SELECT COALESCE(value, 0) > 0 INTO v_activo FROM public.shop_config
   WHERE key = 'p2p_reparto_activo';

  IF COALESCE(v_activo, FALSE) THEN
    -- Los puestos vienen de la última temporada que los asignó, no del ranking
    -- de ahora: el premio se ganó al cerrar una temporada y no puede cambiar de
    -- manos a mitad de la siguiente.
    SELECT p2p_top1_id, p2p_top2_id INTO v_top1, v_top2
      FROM public.referral_seasons
     WHERE status = 'closed' AND (p2p_top1_id IS NOT NULL OR p2p_top2_id IS NOT NULL)
     ORDER BY closed_at DESC LIMIT 1;

    IF v_top1 IS NOT NULL THEN
      SELECT ROUND(v_list.price_gems * COALESCE(value, 3) / 100, 2) INTO v_g1
        FROM public.shop_config WHERE key = 'p2p_top1_pct';
    END IF;
    IF v_top2 IS NOT NULL THEN
      SELECT ROUND(v_list.price_gems * COALESCE(value, 1) / 100, 2) INTO v_g2
        FROM public.shop_config WHERE key = 'p2p_top2_pct';
    END IF;

    -- Nadie puede llevarse más de lo que hay en la comisión, ni siquiera con los
    -- porcentajes mal puestos en la configuración.
    IF COALESCE(v_g1, 0) + COALESCE(v_g2, 0) > v_comision THEN
      v_g1 := ROUND(v_comision * COALESCE(v_g1, 0)
                    / NULLIF(COALESCE(v_g1, 0) + COALESCE(v_g2, 0), 0), 2);
      v_g2 := v_comision - v_g1;
    END IF;
  END IF;

  v_g1 := COALESCE(v_g1, 0);
  v_g2 := COALESCE(v_g2, 0);
  v_proyecto := v_comision - v_g1 - v_g2;

  -- ── EL DINERO ─────────────────────────────────────────────────────────────
  UPDATE public.profiles SET gems_balance = gems_balance - v_list.price_gems
   WHERE id = v_uid;
  INSERT INTO public.transactions (user_id, type, amount_gems, description, status)
  VALUES (v_uid, 'marketplace_buy', v_list.price_gems,
          'Compra de carta en el mercado', 'completed');

  UPDATE public.profiles SET gems_balance = gems_balance + v_vendedor
   WHERE id = v_list.seller_id;
  INSERT INTO public.transactions (user_id, type, amount_gems, description, status)
  VALUES (v_list.seller_id, 'marketplace_sell', v_vendedor,
          'Venta en el mercado (' || (100 - v_pct) || ' %)', 'completed');

  IF v_g1 > 0 THEN
    UPDATE public.profiles SET gems_balance = gems_balance + v_g1 WHERE id = v_top1;
    INSERT INTO public.transactions (user_id, type, amount_gems, description, status)
    VALUES (v_top1, 'p2p_share', v_g1,
            'Reparto del mercado: 1.º del ranking de referidos', 'completed');
  END IF;
  IF v_g2 > 0 THEN
    UPDATE public.profiles SET gems_balance = gems_balance + v_g2 WHERE id = v_top2;
    INSERT INTO public.transactions (user_id, type, amount_gems, description, status)
    VALUES (v_top2, 'p2p_share', v_g2,
            'Reparto del mercado: 2.º del ranking de referidos', 'completed');
  END IF;

  INSERT INTO public.p2p_fee_ledger
    (listing_id, buyer_id, seller_id, price_gems, fee_gems, seller_gems,
     top1_id, top1_gems, top2_id, top2_gems, project_gems)
  VALUES
    (p_listing_id, v_uid, v_list.seller_id, v_list.price_gems, v_comision, v_vendedor,
     CASE WHEN v_g1 > 0 THEN v_top1 END, v_g1,
     CASE WHEN v_g2 > 0 THEN v_top2 END, v_g2, v_proyecto);

  UPDATE public.plant_instances
     SET owner_id = v_uid, is_listed_for_sale = FALSE,
         is_in_deck = FALSE, deck_slot = NULL
   WHERE id = v_list.plant_instance_id;

  UPDATE public.marketplace_listings
     SET status = 'sold', buyer_id = v_uid, closed_at = NOW()
   WHERE id = p_listing_id;

  RETURN jsonb_build_object(
    'success', TRUE,
    'price_gems', v_list.price_gems,
    'fee_gems', v_comision,
    'seller_gems', v_vendedor
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.buy_marketplace_card(UUID) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.buy_marketplace_card(UUID) TO authenticated;


-- -----------------------------------------------------------------------------
-- 10. EL REGISTRO PARA EL PANEL
--
--     Los totales y las últimas ventas. Sólo admin: aquí sale quién compró a
--     quién y por cuánto.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_p2p_report(p_limite INTEGER DEFAULT 50)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.current_user_is_admin() THEN
    RAISE EXCEPTION 'Sólo administradores';
  END IF;

  RETURN jsonb_build_object(
    'totales', COALESCE((
      SELECT jsonb_build_object(
               'ventas',    COUNT(*),
               'volumen',   COALESCE(SUM(price_gems), 0),
               'comision',  COALESCE(SUM(fee_gems), 0),
               'aVendedores', COALESCE(SUM(seller_gems), 0),
               'aTop1',     COALESCE(SUM(top1_gems), 0),
               'aTop2',     COALESCE(SUM(top2_gems), 0),
               'alProyecto', COALESCE(SUM(project_gems), 0)
             ) FROM public.p2p_fee_ledger
    ), '{}'::JSONB),
    'repartoActivo', COALESCE(
      (SELECT value > 0 FROM public.shop_config WHERE key = 'p2p_reparto_activo'), FALSE),
    'porcentajes', jsonb_build_object(
      'comision', (SELECT value FROM public.shop_config WHERE key = 'p2p_comision_pct'),
      'top1',     (SELECT value FROM public.shop_config WHERE key = 'p2p_top1_pct'),
      'top2',     (SELECT value FROM public.shop_config WHERE key = 'p2p_top2_pct')
    ),
    'ventas', COALESCE((
      SELECT jsonb_agg(fila ORDER BY (fila->>'fecha') DESC) FROM (
        SELECT jsonb_build_object(
                 'fecha',    l.created_at,
                 'precio',   l.price_gems,
                 'comision', l.fee_gems,
                 'vendedor', vs.username,
                 'comprador', cp.username,
                 'top1',     t1.username, 'top1Gemas', l.top1_gems,
                 'top2',     t2.username, 'top2Gemas', l.top2_gems,
                 'proyecto', l.project_gems
               ) AS fila
          FROM public.p2p_fee_ledger l
          LEFT JOIN public.profiles vs ON vs.id = l.seller_id
          LEFT JOIN public.profiles cp ON cp.id = l.buyer_id
          LEFT JOIN public.profiles t1 ON t1.id = l.top1_id
          LEFT JOIN public.profiles t2 ON t2.id = l.top2_id
         ORDER BY l.created_at DESC
         LIMIT GREATEST(1, LEAST(500, COALESCE(p_limite, 50)))
      ) AS sub
    ), '[]'::JSONB),
    'temporadas', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'empezo', s.starts_at, 'termina', s.ends_at, 'estado', s.status,
               'validos', s.total_validos, 'meta', s.meta_alcanzada,
               'top1', p1.username, 'top2', p2.username
             ) ORDER BY s.starts_at DESC)
        FROM public.referral_seasons s
        LEFT JOIN public.profiles p1 ON p1.id = s.p2p_top1_id
        LEFT JOIN public.profiles p2 ON p2.id = s.p2p_top2_id
    ), '[]'::JSONB)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_p2p_report(INTEGER) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_p2p_report(INTEGER) TO authenticated;


-- Cerrar la temporada a mano, para no esperar los 15 días al probar.
CREATE OR REPLACE FUNCTION public.admin_close_referral_season()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.current_user_is_admin() THEN
    RAISE EXCEPTION 'Sólo administradores';
  END IF;

  -- Se adelanta el vencimiento y se cierra con el mismo código que lo hará el
  -- contador: así lo que se prueba es lo que va a pasar de verdad.
  -- GREATEST por el CHECK (ends_at > starts_at): una temporada creada en este
  -- mismo segundo tendría starts_at = NOW() y el UPDATE la dejaría inválida.
  UPDATE public.referral_seasons
     SET ends_at = GREATEST(NOW(), starts_at + INTERVAL '1 second')
   WHERE status = 'open';
  RETURN public._cerrar_temporada_de_referidos();
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_close_referral_season() FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_close_referral_season() TO authenticated;


-- -----------------------------------------------------------------------------
-- 11. EL TABLERO DEL MERCADO
--
--     Hacía falta para poder ENCHUFAR la pantalla del mercado al servidor. Hasta
--     ahora la pantalla leía sus ofertas de localStorage y cobraba en dólares de
--     mentira: las tres RPC de comprar, publicar y cancelar existían desde la 01
--     y NADIE las llamaba. O sea que la comisión del 10 % y su reparto no se
--     aplicaban a ninguna venta real, porque no había ventas reales.
--
--     Devuelve lo que la pantalla necesita pintar y nada más: qué carta es, de
--     quién, a cuánto. Ni identificadores de usuario ni saldos.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.marketplace_board(p_limite INTEGER DEFAULT 60)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  RETURN jsonb_build_object(
    -- Los porcentajes viajan con el tablero para que la pantalla pueda decir
    -- «recibirás 9 de 10» sin llevar el número duplicado en el código.
    'comisionPct', COALESCE(
      (SELECT value FROM public.shop_config WHERE key = 'p2p_comision_pct'), 10),
    'ofertas', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id',        l.id,
               'plantId',   pi.plant_id,
               'nivel',     COALESCE(pi.level, 0),
               'statRolls', COALESCE(pi.stat_rolls, '{}'),
               'precio',    l.price_gems,
               'vendedor',  vs.username,
               'esMia',     l.seller_id = v_uid,
               'desde',     l.created_at
             ) ORDER BY l.created_at DESC)
        FROM public.marketplace_listings l
        JOIN public.plant_instances pi ON pi.id = l.plant_instance_id
        LEFT JOIN public.profiles vs ON vs.id = l.seller_id
       WHERE l.status = 'active'
       LIMIT GREATEST(1, LEAST(200, COALESCE(p_limite, 60)))
    ), '[]'::JSONB)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.marketplace_board(INTEGER) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.marketplace_board(INTEGER) TO authenticated;


INSERT INTO public._migration_audit (fase, detalle)
VALUES ('referidos', jsonb_build_object('ok', TRUE));

COMMIT;


-- =============================================================================
-- COMPROBACIONES
-- =============================================================================

-- 1. Todo el mundo tiene código, y ninguno repetido.
SELECT COUNT(*) AS perfiles,
       COUNT(referral_code) AS con_codigo,
       COUNT(DISTINCT referral_code) AS codigos_distintos
  FROM public.profiles;

-- 2. Las cinco tablas nuevas están cerradas al cliente. Debe salir VACÍO.
SELECT table_name, grantee, privilege_type
  FROM information_schema.role_table_grants
 WHERE table_schema = 'public'
   AND table_name IN ('referrals','referral_seasons','referral_claims',
                      'referral_prizes','p2p_fee_ledger')
   AND grantee IN ('anon','authenticated');

-- 3. La temporada abierta y cuánto le queda.
SELECT starts_at, ends_at, status,
       ROUND(EXTRACT(EPOCH FROM (ends_at - NOW())) / 86400, 1) AS dias_restantes
  FROM public.referral_seasons ORDER BY starts_at DESC;

-- 4. El reparto del mercado: nace apagado.
SELECT key, value FROM public.shop_config
 WHERE key LIKE 'p2p_%' OR key LIKE 'ref_%' ORDER BY key;

-- 5. La tabla de premios.
SELECT meta, puesto, gemas, sobres, p2p_pct
  FROM public.referral_prizes ORDER BY meta, puesto;
