-- =============================================================================
-- PRUEBA DE LOS REFERIDOS Y DEL REPARTO DEL MERCADO (migración 27)
--
-- Aquí hay dinero de verdad: oro, gemas, sobres y un porcentaje de cada venta.
-- Así que se prueba lo que se puede pagar dos veces, lo que se puede cobrar sin
-- merecerlo y lo que se puede regalar a uno mismo:
--
--   · engancharse al enlace: a uno mismo no, dos veces no, con la cuenta vieja
--     no, y no después de haber pasado ya las copas;
--   · el sello de «amigo válido»: cuenta al llegar a 1100 y SIGUE contando si
--     luego baja — si no, una recompensa cobrada quedaría sin merecer;
--   · el oro: 100 por amigo, y una sola vez por amigo;
--   · las dos metas, con su cupo de cinco para la de 25;
--   · el cierre de temporada: la meta que se alcanza decide la tabla de premios;
--   · y el reparto del mercado, gema a gema.
--
-- Se ejecuta sobre la base de probar-migraciones.sh, después de la 27.
-- =============================================================================

\set ON_ERROR_STOP on
\timing off

CREATE OR REPLACE FUNCTION public._t(p_nombre TEXT, p_ok BOOLEAN, p_detalle TEXT DEFAULT '')
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok THEN RAISE NOTICE '  OK   %', p_nombre;
  ELSE RAISE WARNING '  FALLA %  → %', p_nombre, p_detalle;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public._soy(p_uid UUID)
RETURNS VOID LANGUAGE sql AS $$ SELECT set_config('test.uid', p_uid::TEXT, false)::VOID $$;


-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN RAISE NOTICE E'\n=== 0. LIMPIEZA Y JUGADORES DE PRUEBA ==='; END $$;

DO $$
DECLARE
  v_id UUID;
  v_uids UUID[] := '{}';
BEGIN
  -- Los jugadores de esta prueba llevan un correo reconocible para poder
  -- borrarlos sin tocar a nadie más.
  FOR v_id IN SELECT id FROM auth.users WHERE email LIKE 'ref%@prueba.test' LOOP
    v_uids := array_append(v_uids, v_id);
  END LOOP;

  IF array_length(v_uids, 1) > 0 THEN
    DELETE FROM public.p2p_fee_ledger
     WHERE buyer_id = ANY(v_uids) OR seller_id = ANY(v_uids)
        OR top1_id = ANY(v_uids) OR top2_id = ANY(v_uids);
    DELETE FROM public.referral_claims  WHERE user_id = ANY(v_uids);
    DELETE FROM public.referrals
     WHERE referred_id = ANY(v_uids) OR referrer_id = ANY(v_uids);
    UPDATE public.referral_seasons SET p2p_top1_id = NULL, p2p_top2_id = NULL
     WHERE p2p_top1_id = ANY(v_uids) OR p2p_top2_id = ANY(v_uids);
    DELETE FROM public.marketplace_listings
     WHERE seller_id = ANY(v_uids) OR buyer_id = ANY(v_uids);
    DELETE FROM public.player_packs     WHERE user_id = ANY(v_uids);
    DELETE FROM public.transactions     WHERE user_id = ANY(v_uids);
    DELETE FROM public.plant_instances  WHERE owner_id = ANY(v_uids);
    DELETE FROM public.pack_slots       WHERE user_id = ANY(v_uids);
    DELETE FROM auth.users WHERE id = ANY(v_uids);
  END IF;

  -- Se deja una temporada limpia y abierta.
  DELETE FROM public.referral_claims;
  UPDATE public.referral_seasons SET status = 'closed', closed_at = NOW()
   WHERE status = 'open';
  INSERT INTO public.referral_seasons (starts_at, ends_at)
  VALUES (NOW(), NOW() + INTERVAL '15 days');
  UPDATE public.shop_config SET value = 0 WHERE key = 'p2p_reparto_activo';
END $$;

-- Tres promotores y sesenta invitados. Sesenta porque la primera meta del
-- ranking son 50 referidos válidos: con menos no se puede comprobar que se
-- elige bien la tabla de premios.
DO $$
DECLARE i INTEGER;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
    ('a0000000-0000-0000-0000-000000000001', 'refa@prueba.test', '{"full_name":"PromoA"}'),
    ('a0000000-0000-0000-0000-000000000002', 'refb@prueba.test', '{"full_name":"PromoB"}'),
    ('a0000000-0000-0000-0000-000000000003', 'refc@prueba.test', '{"full_name":"PromoC"}');

  FOR i IN 1..60 LOOP
    INSERT INTO auth.users (id, email, raw_user_meta_data)
    VALUES (('b0000000-0000-0000-0000-' || lpad(i::TEXT, 12, '0'))::UUID,
            'refi' || i || '@prueba.test',
            ('{"full_name":"Invi' || i || '"}')::JSONB);
  END LOOP;
END $$;

DO $$
DECLARE v_n INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_n FROM public.profiles
   WHERE referral_code IS NOT NULL
     AND id::TEXT LIKE 'a0000000%';
  PERFORM public._t('todo perfil nuevo sale con código de referido', v_n = 3,
                    'con código: ' || v_n);

  SELECT COUNT(*) INTO v_n FROM (
    SELECT referral_code FROM public.profiles WHERE referral_code IS NOT NULL
     GROUP BY referral_code HAVING COUNT(*) > 1
  ) AS repes;
  PERFORM public._t('y ningún código repetido', v_n = 0, 'repetidos: ' || v_n);
END $$;


-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN RAISE NOTICE E'\n=== 1. ENGANCHARSE A UN ENLACE ==='; END $$;

DO $$
DECLARE
  v_a UUID := 'a0000000-0000-0000-0000-000000000001';
  v_b UUID := 'a0000000-0000-0000-0000-000000000002';
  v_i1 UUID := 'b0000000-0000-0000-0000-000000000001';
  v_cod_a TEXT;
  v_cod_b TEXT;
  v_r JSONB;
BEGIN
  SELECT referral_code INTO v_cod_a FROM public.profiles WHERE id = v_a;
  SELECT referral_code INTO v_cod_b FROM public.profiles WHERE id = v_b;

  -- Su propio código, no. Sería un referido gratis por cada cuenta creada.
  PERFORM public._soy(v_a);
  v_r := public.referral_bind(v_cod_a);
  PERFORM public._t('no se puede usar tu propio código',
                    (v_r->>'ok')::BOOLEAN IS FALSE AND v_r->>'motivo' = 'es_tu_propio_codigo',
                    v_r::TEXT);

  -- Un código inventado, tampoco.
  PERFORM public._soy(v_i1);
  v_r := public.referral_bind('ZZZZZZZ');
  PERFORM public._t('un código que no existe se rechaza',
                    v_r->>'motivo' = 'codigo_no_existe', v_r::TEXT);

  -- El caso bueno.
  v_r := public.referral_bind(v_cod_a);
  PERFORM public._t('un invitado nuevo se engancha al enlace',
                    (v_r->>'ok')::BOOLEAN IS TRUE, v_r::TEXT);

  -- Y ya no se puede cambiar: si se pudiera, cambiar de referidor sería un
  -- negocio (esperar a ver quién va ganando el ranking y ponerse con ese).
  v_r := public.referral_bind(v_cod_b);
  PERFORM public._t('no se puede cambiar de referidor',
                    v_r->>'motivo' = 'ya_tienes_referidor', v_r::TEXT);

  PERFORM public._t('y queda apuntado en el perfil',
                    (SELECT referred_by FROM public.profiles WHERE id = v_i1) = v_a);
END $$;

DO $$
DECLARE
  v_a UUID := 'a0000000-0000-0000-0000-000000000001';
  v_i2 UUID := 'b0000000-0000-0000-0000-000000000002';
  v_i3 UUID := 'b0000000-0000-0000-0000-000000000003';
  v_cod TEXT;
  v_r JSONB;
BEGIN
  SELECT referral_code INTO v_cod FROM public.profiles WHERE id = v_a;

  -- Una cuenta de hace un mes no puede engancharse: si no, dos veteranos se
  -- pondrían de referido mutuo el día que les conviniera para el ranking.
  UPDATE public.profiles SET created_at = NOW() - INTERVAL '30 days' WHERE id = v_i2;
  PERFORM public._soy(v_i2);
  v_r := public.referral_bind(v_cod);
  PERFORM public._t('una cuenta antigua no puede engancharse',
                    v_r->>'motivo' = 'cuenta_demasiado_antigua', v_r::TEXT);

  -- Ni alguien que ya pasó las copas que hacen válido a un referido: sería
  -- cobrar por un jugador que ya estaba jugando.
  UPDATE public.profiles SET elo_rating = 1200 WHERE id = v_i3;
  PERFORM public._soy(v_i3);
  v_r := public.referral_bind(v_cod);
  PERFORM public._t('quien ya pasó las copas no puede engancharse',
                    v_r->>'motivo' = 'ya_pasaste_las_copas', v_r::TEXT);

  -- Se deshace para las pruebas siguientes.
  UPDATE public.profiles SET created_at = NOW(), elo_rating = 1000
   WHERE id IN (v_i2, v_i3);
END $$;


-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN RAISE NOTICE E'\n=== 2. UN AMIGO CUENTA AL LLEGAR A LAS COPAS ==='; END $$;

DO $$
DECLARE
  v_a UUID := 'a0000000-0000-0000-0000-000000000001';
  v_i1 UUID := 'b0000000-0000-0000-0000-000000000001';
  v_r JSONB;
BEGIN
  PERFORM public._soy(v_a);
  v_r := public.my_referrals();
  PERFORM public._t('el invitado se ve, pero todavía no cuenta',
                    (v_r->>'total')::INTEGER = 1 AND (v_r->>'validos')::INTEGER = 0,
                    v_r::TEXT);

  -- 1099: uno menos que el umbral. No cuenta.
  UPDATE public.profiles SET elo_rating = 1099 WHERE id = v_i1;
  v_r := public.my_referrals();
  PERFORM public._t('con 1099 copas sigue sin contar',
                    (v_r->>'validos')::INTEGER = 0, v_r::TEXT);

  -- 1100: cuenta.
  UPDATE public.profiles SET elo_rating = 1100 WHERE id = v_i1;
  v_r := public.my_referrals();
  PERFORM public._t('a las 1100 copas cuenta',
                    (v_r->>'validos')::INTEGER = 1, v_r::TEXT);

  -- Y si el amigo vuelve a bajar, SIGUE contando. Sin este sello, el contador
  -- subiría y bajaría con cada derrota del amigo y una recompensa ya cobrada
  -- quedaría sin merecer.
  UPDATE public.profiles SET elo_rating = 900 WHERE id = v_i1;
  v_r := public.my_referrals();
  PERFORM public._t('y sigue contando aunque después baje de copas',
                    (v_r->>'validos')::INTEGER = 1, v_r::TEXT);
END $$;


-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN RAISE NOTICE E'\n=== 3. LAS 100 MONEDAS POR AMIGO ==='; END $$;

DO $$
DECLARE
  v_a UUID := 'a0000000-0000-0000-0000-000000000001';
  v_oro_antes BIGINT;
  v_oro_despues BIGINT;
  v_r JSONB;
BEGIN
  SELECT gold_balance INTO v_oro_antes FROM public.profiles WHERE id = v_a;

  PERFORM public._soy(v_a);
  v_r := public.claim_referral_gold();
  SELECT gold_balance INTO v_oro_despues FROM public.profiles WHERE id = v_a;

  PERFORM public._t('cobra 100 de oro por el amigo válido',
                    (v_r->>'ok')::BOOLEAN IS TRUE
                AND v_oro_despues - v_oro_antes = 100,
                    v_r::TEXT || '  oro: ' || v_oro_antes || ' → ' || v_oro_despues);

  -- Y NO dos veces. Es lo más fácil de romper de todo esto.
  v_r := public.claim_referral_gold();
  SELECT gold_balance INTO v_oro_despues FROM public.profiles WHERE id = v_a;
  PERFORM public._t('no se puede cobrar el mismo amigo dos veces',
                    (v_r->>'ok')::BOOLEAN IS FALSE
                AND v_oro_despues - v_oro_antes = 100,
                    v_r::TEXT || '  oro: ' || v_oro_despues);
END $$;


-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN RAISE NOTICE E'\n=== 4. LAS DOS METAS ==='; END $$;

DO $$
DECLARE
  v_a UUID := 'a0000000-0000-0000-0000-000000000001';
  v_cod TEXT;
  v_r JSONB;
  i INTEGER;
  v_uid UUID;
BEGIN
  SELECT referral_code INTO v_cod FROM public.profiles WHERE id = v_a;

  -- Con 1 amigo válido, la meta de 10 no se puede cobrar.
  PERFORM public._soy(v_a);
  v_r := public.claim_referral_reward('sobre_10');
  PERFORM public._t('la meta de 10 no se cobra con 1 amigo',
                    v_r->>'motivo' = 'faltan_amigos', v_r::TEXT);

  -- Se le enganchan 11 invitados más y todos llegan a las copas.
  FOR i IN 4..14 LOOP
    v_uid := ('b0000000-0000-0000-0000-' || lpad(i::TEXT, 12, '0'))::UUID;
    PERFORM public._soy(v_uid);
    PERFORM public.referral_bind(v_cod);
    UPDATE public.profiles SET elo_rating = 1150 WHERE id = v_uid;
  END LOOP;

  PERFORM public._soy(v_a);
  v_r := public.my_referrals();
  PERFORM public._t('ahora tiene 12 amigos válidos',
                    (v_r->>'validos')::INTEGER = 12, v_r::TEXT);

  v_r := public.claim_referral_reward('sobre_10');
  PERFORM public._t('y cobra el sobre básico de la meta de 10',
                    (v_r->>'ok')::BOOLEAN IS TRUE, v_r::TEXT);

  PERFORM public._t('el sobre está en su cuenta, marcado como de referido',
                    (SELECT COUNT(*) FROM public.player_packs
                      WHERE user_id = v_a AND pack_id = 'basic' AND source = 'referral') = 1);

  v_r := public.claim_referral_reward('sobre_10');
  PERFORM public._t('y no se puede cobrar dos veces',
                    v_r->>'motivo' = 'ya_cobrada', v_r::TEXT);

  -- El oro de los once nuevos, de una vez.
  v_r := public.claim_referral_gold();
  PERFORM public._t('el oro de los once nuevos son 1100',
                    (v_r->>'oro')::BIGINT = 1100, v_r::TEXT);
END $$;

-- El cupo de la meta de 25: «un validador sólo para los 5 primeros».
--
-- Para probar el CUPO se baja la meta a 1 amigo: lo que se comprueba aquí es que
-- el sexto se queda fuera, no cuántos amigos hacen falta (eso ya se comprobó
-- arriba). Al final se restaura.
DO $$
DECLARE
  v_cod TEXT;
  v_r JSONB;
  i INTEGER;
  v_promo UUID;
  v_invi  UUID;
  v_ok INTEGER := 0;
  v_fuera INTEGER := 0;
BEGIN
  UPDATE public.shop_config SET value = 1 WHERE key = 'ref_meta_gemas';

  -- Seis promotores con un amigo válido cada uno.
  FOR i IN 1..6 LOOP
    v_promo := ('c0000000-0000-0000-0000-' || lpad(i::TEXT, 12, '0'))::UUID;
    v_invi  := ('d0000000-0000-0000-0000-' || lpad(i::TEXT, 12, '0'))::UUID;

    DELETE FROM public.referrals WHERE referred_id IN (v_promo, v_invi)
                                    OR referrer_id IN (v_promo, v_invi);
    DELETE FROM public.plant_instances WHERE owner_id IN (v_promo, v_invi);
    DELETE FROM auth.users WHERE id IN (v_promo, v_invi);

    INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
      (v_promo, 'refp' || i || '@prueba.test', ('{"full_name":"Cupo' || i || '"}')::JSONB),
      (v_invi,  'refq' || i || '@prueba.test', ('{"full_name":"CupoI' || i || '"}')::JSONB);

    SELECT referral_code INTO v_cod FROM public.profiles WHERE id = v_promo;
    PERFORM public._soy(v_invi);
    PERFORM public.referral_bind(v_cod);
    UPDATE public.profiles SET elo_rating = 1200 WHERE id = v_invi;
  END LOOP;

  -- Los seis intentan cobrar. Cinco deben poder; el sexto, no.
  FOR i IN 1..6 LOOP
    v_promo := ('c0000000-0000-0000-0000-' || lpad(i::TEXT, 12, '0'))::UUID;
    PERFORM public._soy(v_promo);
    v_r := public.claim_referral_reward('gemas_25');
    IF (v_r->>'ok')::BOOLEAN THEN v_ok := v_ok + 1;
    ELSIF v_r->>'motivo' = 'cupo_agotado' THEN v_fuera := v_fuera + 1;
    END IF;
  END LOOP;

  PERFORM public._t('sólo los 5 primeros cobran las gemas de la meta',
                    v_ok = 5 AND v_fuera = 1,
                    'cobraron ' || v_ok || ', fuera de cupo ' || v_fuera);

  PERFORM public._t('y cada uno cobró 5 gemas',
                    (SELECT gems_balance FROM public.profiles
                      WHERE id = 'c0000000-0000-0000-0000-000000000001') = 5,
                    (SELECT gems_balance::TEXT FROM public.profiles
                      WHERE id = 'c0000000-0000-0000-0000-000000000001'));

  UPDATE public.shop_config SET value = 25 WHERE key = 'ref_meta_gemas';
END $$;


-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN RAISE NOTICE E'\n=== 5. EL CIERRE DE TEMPORADA Y LOS PREMIOS ==='; END $$;

DO $$
DECLARE
  v_r JSONB;
  v_temp UUID;
BEGIN
  SELECT id INTO v_temp FROM public.referral_seasons WHERE status = 'open';

  -- Antes de la fecha no se cierra nada, se pregunte lo que se pregunte.
  PERFORM public._soy('a0000000-0000-0000-0000-000000000001');
  v_r := public.my_referrals();
  PERFORM public._t('antes de los 15 días la temporada sigue abierta',
                    (SELECT status FROM public.referral_seasons WHERE id = v_temp) = 'open');
  PERFORM public._t('y el contador dice lo que queda',
                    (v_r->'temporada'->>'segundos')::BIGINT > 14 * 86400,
                    (v_r->'temporada')::TEXT);
END $$;

DO $$
DECLARE
  v_b UUID := 'a0000000-0000-0000-0000-000000000002';
  v_c UUID := 'a0000000-0000-0000-0000-000000000003';
  v_cod_b TEXT; v_cod_c TEXT;
  v_uid UUID;
  i INTEGER;
  v_r JSONB;
  v_gemas_a NUMERIC; v_gemas_b NUMERIC;
  v_temp UUID;
  v_total INTEGER;
BEGIN
  SELECT referral_code INTO v_cod_b FROM public.profiles WHERE id = v_b;
  SELECT referral_code INTO v_cod_c FROM public.profiles WHERE id = v_c;

  -- PromoB se lleva 25 invitados y PromoC 20. Con los 12 de PromoA, el total
  -- pasa de 50: se alcanza la primera meta del ranking.
  FOR i IN 15..39 LOOP
    v_uid := ('b0000000-0000-0000-0000-' || lpad(i::TEXT, 12, '0'))::UUID;
    PERFORM public._soy(v_uid);
    PERFORM public.referral_bind(v_cod_b);
    UPDATE public.profiles SET elo_rating = 1150 WHERE id = v_uid;
  END LOOP;

  FOR i IN 40..59 LOOP
    v_uid := ('b0000000-0000-0000-0000-' || lpad(i::TEXT, 12, '0'))::UUID;
    PERFORM public._soy(v_uid);
    PERFORM public.referral_bind(v_cod_c);
    UPDATE public.profiles SET elo_rating = 1150 WHERE id = v_uid;
  END LOOP;

  PERFORM public._soy(v_b);
  v_r := public.my_referrals();
  v_total := (v_r->>'totalGlobal')::INTEGER;
  PERFORM public._t('el total colectivo pasa de 50', v_total >= 50,
                    'total: ' || v_total);
  PERFORM public._t('y la meta alcanzada es la de 50',
                    (v_r->>'metaActual')::INTEGER = 50, v_r->>'metaActual');
  PERFORM public._t('PromoB va primero del ranking con 25',
                    (v_r->>'miPuesto')::INTEGER = 1
                AND (v_r->>'validos')::INTEGER = 25, v_r::TEXT);

  SELECT gems_balance INTO v_gemas_b FROM public.profiles WHERE id = v_b;

  -- Vence el contador. Lo cierra la propia consulta de la pantalla, sin cron.
  -- Se envejece la temporada entera: quince días atrás y vencida hace un
  -- segundo. (Mover sólo ends_at rompe el CHECK de que termine después de
  -- empezar, que es justo lo que pasó la primera vez.)
  SELECT id INTO v_temp FROM public.referral_seasons WHERE status = 'open';
  UPDATE public.referral_seasons
     SET starts_at = NOW() - INTERVAL '16 days', ends_at = NOW() - INTERVAL '1 second'
   WHERE status = 'open';
  v_r := public.my_referrals();

  PERFORM public._t('vencido el contador, la temporada se cierra al mirarla',
                    (SELECT status FROM public.referral_seasons WHERE id = v_temp) = 'closed'
                AND (SELECT meta_alcanzada FROM public.referral_seasons WHERE id = v_temp) = 50,
                    (SELECT status || ' meta ' || COALESCE(meta_alcanzada::TEXT, '-')
                       FROM public.referral_seasons WHERE id = v_temp));

  -- Meta 50: 10 gemas al primero, 3 al segundo, 1 al tercero.
  PERFORM public._t('el primero cobra 10 gemas',
                    (SELECT gems_balance FROM public.profiles WHERE id = v_b)
                      - v_gemas_b = 10,
                    (SELECT gems_balance::TEXT FROM public.profiles WHERE id = v_b));

  PERFORM public._t('el segundo cobra 3',
                    EXISTS (SELECT 1 FROM public.transactions
                             WHERE user_id = v_c AND type = 'referral_reward'
                               AND amount_gems = 3));

  PERFORM public._t('el tercero cobra 1',
                    EXISTS (SELECT 1 FROM public.transactions
                             WHERE user_id = 'a0000000-0000-0000-0000-000000000001'
                               AND type = 'referral_reward' AND amount_gems = 1));

  PERFORM public._t('y arranca una temporada nueva',
                    (SELECT COUNT(*) FROM public.referral_seasons WHERE status = 'open') = 1);

  PERFORM public._t('con la meta de 50 el reparto del mercado sigue apagado',
                    (SELECT value FROM public.shop_config
                      WHERE key = 'p2p_reparto_activo') = 0);
END $$;


-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN RAISE NOTICE E'\n=== 6. EL MERCADO: COMISION DEL 10 POR CIENTO ==='; END $$;

DO $$
DECLARE
  v_a UUID := 'a0000000-0000-0000-0000-000000000001';
  v_b UUID := 'a0000000-0000-0000-0000-000000000002';
  v_carta UUID;
  v_listado UUID;
  v_r JSONB;
  v_saldo_a NUMERIC; v_saldo_b NUMERIC;
  v_fila RECORD;
BEGIN
  UPDATE public.profiles SET gems_balance = 100 WHERE id IN (v_a, v_b);
  SELECT id INTO v_carta FROM public.plant_instances WHERE owner_id = v_a LIMIT 1;

  PERFORM public._soy(v_a);
  v_r := public.list_marketplace_card(v_carta, 10);
  v_listado := (v_r->>'listing_id')::UUID;

  SELECT gems_balance INTO v_saldo_a FROM public.profiles WHERE id = v_a;
  SELECT gems_balance INTO v_saldo_b FROM public.profiles WHERE id = v_b;

  -- El tablero: es lo que hacía falta para que la PANTALLA del mercado pudiera
  -- dejar de leer de localStorage. Sin esto, la comisión no se aplicaba a nada
  -- porque no había ventas de verdad.
  PERFORM public._t('el tablero enseña la oferta con su carta y su precio',
    (SELECT COUNT(*) FROM jsonb_array_elements(public.marketplace_board(50)->'ofertas') AS o
      WHERE (o->>'id')::UUID = v_listado
        AND (o->>'precio')::NUMERIC = 10
        AND o->>'plantId' IS NOT NULL
        AND (o->>'esMia')::BOOLEAN IS TRUE) = 1,
    public.marketplace_board(50)::TEXT);

  PERFORM public._t('y lleva la comisión, para poder decir cuánto se recibe',
                    (public.marketplace_board(1)->>'comisionPct')::NUMERIC = 10);

  PERFORM public._soy(v_b);
  PERFORM public._t('para el comprador la oferta no es suya',
    (SELECT (o->>'esMia')::BOOLEAN FROM jsonb_array_elements(public.marketplace_board(50)->'ofertas') AS o
      WHERE (o->>'id')::UUID = v_listado) IS FALSE);

  v_r := public.buy_marketplace_card(v_listado);

  PERFORM public._t('el comprador paga las 10 gemas',
                    v_saldo_b - (SELECT gems_balance FROM public.profiles WHERE id = v_b) = 10,
                    (SELECT gems_balance::TEXT FROM public.profiles WHERE id = v_b));
  PERFORM public._t('el vendedor recibe 9',
                    (SELECT gems_balance FROM public.profiles WHERE id = v_a) - v_saldo_a = 9,
                    v_r::TEXT);
  PERFORM public._t('y la comisión es 1',
                    (v_r->>'fee_gems')::NUMERIC = 1, v_r::TEXT);

  SELECT * INTO v_fila FROM public.p2p_fee_ledger WHERE listing_id = v_listado;
  PERFORM public._t('queda registrada para el panel', v_fila.id IS NOT NULL);
  PERFORM public._t('con el reparto apagado, la comisión entera es del proyecto',
                    v_fila.project_gems = 1 AND v_fila.top1_gems = 0
                AND v_fila.top2_gems = 0,
                    'proyecto ' || v_fila.project_gems || ' top1 ' || v_fila.top1_gems);

  PERFORM public._t('y la carta cambió de dueño',
                    (SELECT owner_id FROM public.plant_instances WHERE id = v_carta) = v_b);
END $$;


-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN RAISE NOTICE E'\n=== 7. EL REPARTO 3 Y 1 POR CIENTO, ENCENDIDO ==='; END $$;

DO $$
DECLARE
  v_a UUID := 'a0000000-0000-0000-0000-000000000001';
  v_b UUID := 'a0000000-0000-0000-0000-000000000002';
  v_c UUID := 'a0000000-0000-0000-0000-000000000003';
  v_carta UUID; v_listado UUID;
  v_r JSONB;
  v_g_b NUMERIC; v_g_c NUMERIC;
  v_fila RECORD;
BEGIN
  -- Se simula la temporada que asigna el premio de la meta de 300: PromoB primero
  -- y PromoC segundo.
  UPDATE public.referral_seasons
     SET p2p_top1_id = v_b, p2p_top2_id = v_c
   WHERE status = 'closed' AND meta_alcanzada = 50;
  UPDATE public.shop_config SET value = 1 WHERE key = 'p2p_reparto_activo';

  UPDATE public.profiles SET gems_balance = 100 WHERE id IN (v_a, v_b, v_c);
  SELECT id INTO v_carta FROM public.plant_instances WHERE owner_id = v_a LIMIT 1;

  PERFORM public._soy(v_a);
  v_r := public.list_marketplace_card(v_carta, 10);
  v_listado := (v_r->>'listing_id')::UUID;

  SELECT gems_balance INTO v_g_b FROM public.profiles WHERE id = v_b;
  SELECT gems_balance INTO v_g_c FROM public.profiles WHERE id = v_c;

  -- Compra PromoB, que además es el top 1: paga 10 y le vuelven 0,30.
  PERFORM public._soy(v_b);
  PERFORM public.buy_marketplace_card(v_listado);

  SELECT * INTO v_fila FROM public.p2p_fee_ledger WHERE listing_id = v_listado;

  PERFORM public._t('el top 1 se lleva 0.30 (3 % de 10)',
                    v_fila.top1_gems = 0.30 AND v_fila.top1_id = v_b,
                    'top1: ' || v_fila.top1_gems);
  PERFORM public._t('el top 2 se lleva 0.10 (1 % de 10)',
                    v_fila.top2_gems = 0.10 AND v_fila.top2_id = v_c,
                    'top2: ' || v_fila.top2_gems);
  PERFORM public._t('y al proyecto le quedan 0.60 de la comisión de 1.00',
                    v_fila.project_gems = 0.60 AND v_fila.fee_gems = 1.00,
                    'proyecto: ' || v_fila.project_gems);
  PERFORM public._t('las tres partes suman exactamente la comisión',
                    v_fila.top1_gems + v_fila.top2_gems + v_fila.project_gems
                      = v_fila.fee_gems);

  PERFORM public._t('el top 2 lo recibe en su saldo',
                    (SELECT gems_balance FROM public.profiles WHERE id = v_c) - v_g_c = 0.10,
                    (SELECT gems_balance::TEXT FROM public.profiles WHERE id = v_c));

  PERFORM public._t('y queda apuntado como reparto, no como venta',
                    EXISTS (SELECT 1 FROM public.transactions
                             WHERE user_id = v_c AND type = 'p2p_share'
                               AND amount_gems = 0.10));
END $$;

-- Los porcentajes mal puestos no pueden vaciar la comisión.
DO $$
DECLARE
  v_a UUID := 'a0000000-0000-0000-0000-000000000001';
  v_b UUID := 'a0000000-0000-0000-0000-000000000002';
  v_carta UUID; v_listado UUID; v_r JSONB; v_fila RECORD;
BEGIN
  UPDATE public.shop_config SET value = 40 WHERE key = 'p2p_top1_pct';
  UPDATE public.shop_config SET value = 40 WHERE key = 'p2p_top2_pct';

  UPDATE public.profiles SET gems_balance = 100 WHERE id IN (v_a, v_b);
  SELECT id INTO v_carta FROM public.plant_instances WHERE owner_id = v_a LIMIT 1;

  PERFORM public._soy(v_a);
  v_r := public.list_marketplace_card(v_carta, 10);
  v_listado := (v_r->>'listing_id')::UUID;
  PERFORM public._soy(v_b);
  PERFORM public.buy_marketplace_card(v_listado);

  SELECT * INTO v_fila FROM public.p2p_fee_ledger WHERE listing_id = v_listado;
  PERFORM public._t('con porcentajes imposibles, el reparto se recorta a la comisión',
                    v_fila.top1_gems + v_fila.top2_gems <= v_fila.fee_gems
                AND v_fila.project_gems >= 0,
                    'top1 ' || v_fila.top1_gems || ' top2 ' || v_fila.top2_gems ||
                    ' proyecto ' || v_fila.project_gems);

  UPDATE public.shop_config SET value = 3 WHERE key = 'p2p_top1_pct';
  UPDATE public.shop_config SET value = 1 WHERE key = 'p2p_top2_pct';
END $$;


-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN RAISE NOTICE E'\n=== 8. NADA DE ESTO SE PUEDE TOCAR DESDE FUERA ==='; END $$;

DO $$
DECLARE
  v_a UUID := 'a0000000-0000-0000-0000-000000000001';
  v_falló BOOLEAN := FALSE;
BEGIN
  -- El informe del panel es sólo de admin: enseña quién compró a quién.
  PERFORM public._soy(v_a);
  BEGIN
    PERFORM public.admin_p2p_report(10);
  EXCEPTION WHEN OTHERS THEN v_falló := TRUE;
  END;
  PERFORM public._t('un jugador normal no puede ver el registro del mercado', v_falló);

  v_falló := FALSE;
  BEGIN
    PERFORM public.admin_close_referral_season();
  EXCEPTION WHEN OTHERS THEN v_falló := TRUE;
  END;
  PERFORM public._t('ni cerrar la temporada a mano', v_falló);

  -- Y las funciones internas no son llamables.
  PERFORM public._t('las funciones internas de referidos no son llamables',
    NOT EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
         AND p.proname IN ('_cerrar_temporada_de_referidos', '_nuevo_codigo_de_referido')
         AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
    ));
END $$;

DO $$
DECLARE v_n INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_n FROM information_schema.role_table_grants
   WHERE table_schema = 'public'
     AND table_name IN ('referrals','referral_seasons','referral_claims',
                        'referral_prizes','p2p_fee_ledger')
     AND grantee IN ('anon','authenticated');
  PERFORM public._t('ninguna tabla de referidos está abierta al cliente', v_n = 0,
                    'permisos encontrados: ' || v_n);
END $$;


-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN RAISE NOTICE E'\n=== 9. PONER EL CODIGO A MANO (migracion 29) ==='; END $$;

DO $$
DECLARE
  v_a    UUID := 'a0000000-0000-0000-0000-000000000001';   -- promotor
  v_solo UUID := 'f0000000-0000-0000-0000-000000000001';   -- entró sin enlace
  v_cod  TEXT;
  v_r    JSONB;
  v_panel JSONB;
BEGIN
  -- Un jugador que se registró SIN el enlace: es el caso que no tenía arreglo.
  DELETE FROM public.referrals WHERE referred_id = v_solo OR referrer_id = v_solo;
  DELETE FROM public.plant_instances WHERE owner_id = v_solo;
  DELETE FROM auth.users WHERE id = v_solo;
  INSERT INTO auth.users (id, email, raw_user_meta_data)
  VALUES (v_solo, 'refsolo@prueba.test', '{"full_name":"SinEnlace"}');

  SELECT referral_code INTO v_cod FROM public.profiles WHERE id = v_a;

  PERFORM public._soy(v_solo);
  v_panel := public.my_referrals();
  PERFORM public._t('el panel ofrece el cuadro para escribir el código',
                    (v_panel->>'puedoUsarCodigo')::BOOLEAN IS TRUE
                AND v_panel->>'motivoNoPuedo' IS NULL
                AND v_panel->>'miReferidor' IS NULL,
                    v_panel::TEXT);

  PERFORM public._t('y dice cuántos días le quedan para usarlo',
                    (v_panel->>'diasParaUsarCodigo')::INTEGER > 0,
                    v_panel->>'diasParaUsarCodigo');

  -- Escrito a mano: en minúsculas y con espacios, como se teclea de verdad.
  v_r := public.referral_bind('  ' || lower(v_cod) || ' ');
  PERFORM public._t('el código se acepta en minúsculas y con espacios',
                    (v_r->>'ok')::BOOLEAN IS TRUE, v_r::TEXT);
  PERFORM public._t('y devuelve el nick de quien lo invitó',
                    v_r->>'referidor' IS NOT NULL, v_r::TEXT);

  -- Y a partir de ahí el cuadro NO se enseña.
  v_panel := public.my_referrals();
  PERFORM public._t('con referidor, el cuadro ya no se ofrece',
                    (v_panel->>'puedoUsarCodigo')::BOOLEAN IS FALSE
                AND v_panel->>'motivoNoPuedo' = 'ya_tienes_referidor',
                    v_panel::TEXT);
  PERFORM public._t('y el panel dice quién lo invitó',
                    v_panel->>'miReferidor' IS NOT NULL, v_panel->>'miReferidor');

  PERFORM public._soy(v_a);
  v_panel := public.my_referrals();
  PERFORM public._t('el promotor lo ve entre sus invitados',
                    (v_panel->>'total')::INTEGER >= 1, v_panel->>'total');
END $$;

DO $$
DECLARE
  v_a     UUID := 'a0000000-0000-0000-0000-000000000001';
  v_viejo UUID := 'f0000000-0000-0000-0000-000000000002';
  v_alto  UUID := 'f0000000-0000-0000-0000-000000000003';
  v_cod   TEXT;
  v_panel JSONB;
  v_r     JSONB;
  i       INTEGER;
  v_id    UUID;
BEGIN
  SELECT referral_code INTO v_cod FROM public.profiles WHERE id = v_a;

  FOR i IN 2..3 LOOP
    v_id := ('f0000000-0000-0000-0000-' || lpad(i::TEXT, 12, '0'))::UUID;
    DELETE FROM public.referrals WHERE referred_id = v_id;
    DELETE FROM public.plant_instances WHERE owner_id = v_id;
    DELETE FROM auth.users WHERE id = v_id;
  END LOOP;

  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
    (v_viejo, 'refviejo@prueba.test', '{"full_name":"Veterano"}'),
    (v_alto,  'refalto@prueba.test',  '{"full_name":"Subido"}');

  -- Cuenta de hace un mes: el cuadro NO debe ofrecerse, y el panel tiene que
  -- decir por qué. Un cuadro que simplemente no está parece un fallo.
  UPDATE public.profiles SET created_at = NOW() - INTERVAL '30 days' WHERE id = v_viejo;
  PERFORM public._soy(v_viejo);
  v_panel := public.my_referrals();
  PERFORM public._t('cuenta vieja: no se ofrece, y se explica',
                    (v_panel->>'puedoUsarCodigo')::BOOLEAN IS FALSE
                AND v_panel->>'motivoNoPuedo' = 'cuenta_demasiado_antigua',
                    v_panel::TEXT);
  PERFORM public._t('y los días restantes son cero',
                    (v_panel->>'diasParaUsarCodigo')::INTEGER = 0,
                    v_panel->>'diasParaUsarCodigo');

  -- Y el servidor lo rechaza igual, no sólo la pantalla: es la misma regla.
  v_r := public.referral_bind(v_cod);
  PERFORM public._t('y el servidor lo rechaza con el mismo motivo',
                    v_r->>'motivo' = 'cuenta_demasiado_antigua', v_r::TEXT);

  -- Quien ya pasó las copas tampoco.
  UPDATE public.profiles SET elo_rating = 1300 WHERE id = v_alto;
  PERFORM public._soy(v_alto);
  v_panel := public.my_referrals();
  PERFORM public._t('quien ya pasó las copas tampoco puede',
                    v_panel->>'motivoNoPuedo' = 'ya_pasaste_las_copas',
                    v_panel::TEXT);

  -- Un código inventado, con la cuenta ya en regla.
  UPDATE public.profiles SET elo_rating = 1000, created_at = NOW() WHERE id = v_alto;
  DELETE FROM public.referrals WHERE referred_id = v_alto;
  PERFORM public._soy(v_alto);
  v_r := public.referral_bind('NOEXISTE');
  PERFORM public._t('un código inventado se rechaza',
                    v_r->>'motivo' = 'codigo_no_existe', v_r::TEXT);
END $$;


DO $$ BEGIN RAISE NOTICE E'\n=== FIN ==='; END $$;
