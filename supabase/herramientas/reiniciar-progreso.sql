-- =============================================================================
-- PLANT ARENA · DEJAR A TODOS LOS JUGADORES COMO NUEVOS
--
-- ⚠️  ESTO BORRA DATOS Y NO SE PUEDE DESHACER.
--
--     No hay «ctrl+z» en una base de datos. Antes de ejecutarlo, en Supabase:
--     Database → Backups (o crea una rama). Cuesta un minuto y es la diferencia
--     entre un reinicio y una pérdida.
--
-- QUÉ HACE, Y QUÉ NO
--
--   SÍ borra el PROGRESO de todo el mundo: copas, gemas, oro, tickets, pase VIP,
--   inventario, sobres, cofres, partidas, repeticiones, referidos, movimientos y
--   publicaciones del mercado.
--
--   NO borra las CUENTAS. Nadie pierde su usuario ni su contraseña ni su nick:
--   auth.users no se toca. Al entrar se encuentran el juego desde cero, con sus
--   cuatro cartas de siempre.
--
--   Y NO toca quién es administrador ni los códigos de referido: el código es la
--   identidad del jugador de cara a sus invitados, y cambiarlo rompería enlaces
--   que ya estén repartidos por ahí.
--
-- POR QUÉ TAMBIÉN SE PONE created_at A HOY
--   Un código de referido sólo se puede usar en los primeros días de la cuenta.
--   Si el reinicio dejara las fechas viejas, nadie podría probar los referidos —
--   que es justo una de las cosas que hay que probar. Dejarlas a hoy es lo que
--   hace que «como nuevos» sea verdad.
--
-- NO ES UNA MIGRACIÓN: no está en la serie numerada a propósito. Una migración se
-- ejecuta una vez y en orden; esto se ejecuta cuando tú quieras y tantas veces
-- como quieras.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- PASO 1 · MIRAR ANTES DE TOCAR
--
--   Ejecuta SÓLO esta consulta primero. Dice exactamente qué se va a borrar. Si
--   algún número te sorprende, para aquí.
-- -----------------------------------------------------------------------------
SELECT 'jugadores (NO se borran, se reinician)' AS que, COUNT(*) AS cuantos FROM public.profiles
UNION ALL SELECT 'partidas',            COUNT(*) FROM public.game_rooms
UNION ALL SELECT 'jugadas registradas', COUNT(*) FROM public.match_actions
UNION ALL SELECT 'cartas del inventario', COUNT(*) FROM public.plant_instances
UNION ALL SELECT 'sobres sin abrir',    COUNT(*) FROM public.player_packs
UNION ALL SELECT 'cofres',              COUNT(*) FROM public.pack_slots
UNION ALL SELECT 'movimientos',         COUNT(*) FROM public.transactions
UNION ALL SELECT 'referidos',           COUNT(*) FROM public.referrals
UNION ALL SELECT 'ventas del mercado',  COUNT(*) FROM public.p2p_fee_ledger
UNION ALL SELECT 'gemas en circulación', COALESCE(SUM(gems_balance), 0)::BIGINT FROM public.profiles
UNION ALL SELECT 'oro en circulación',  COALESCE(SUM(gold_balance), 0) FROM public.profiles;


-- -----------------------------------------------------------------------------
-- PASO 2 · EL REINICIO
--
--   Todo en UNA transacción: si algo falla a mitad, no queda medio reiniciado.
--
--   El orden importa por las claves ajenas. La cola antes que las retenciones
--   (matchmaking_queue.escrow_id apunta a colosseum_escrow), y las dos antes que
--   las salas.
-- -----------------------------------------------------------------------------
BEGIN;

-- ── Partidas y todo lo que cuelga de ellas ─────────────────────────────────
DELETE FROM public.match_actions;
DELETE FROM public.matchmaking_queue;
DELETE FROM public.colosseum_escrow;
DELETE FROM public.game_rooms;

-- ── Referidos ──────────────────────────────────────────────────────────────
DELETE FROM public.referral_claims;
DELETE FROM public.referrals;
DELETE FROM public.p2p_fee_ledger;

-- Las temporadas se cierran y se abre una nueva, para que el contador de 15 días
-- empiece con el reinicio y no a mitad.
UPDATE public.referral_seasons
   SET status = 'closed', closed_at = NOW()
 WHERE status = 'open';

INSERT INTO public.referral_seasons (starts_at, ends_at)
VALUES (NOW(), NOW() + make_interval(days => COALESCE(
  (SELECT value::INTEGER FROM public.shop_config WHERE key = 'ref_dias_temporada'), 15)));

-- El reparto del mercado vuelve a apagarse: lo enciende una temporada que llegue
-- a la meta de 300, y acabamos de borrar todos los referidos.
UPDATE public.shop_config SET value = 0 WHERE key = 'p2p_reparto_activo';

-- ── Mercado, inventario y economía ─────────────────────────────────────────
DELETE FROM public.marketplace_listings;
DELETE FROM public.player_packs;
DELETE FROM public.pack_slots;
DELETE FROM public.transactions;
DELETE FROM public.plant_instances;

-- Estas dos pueden no existir según por dónde ande el esquema, así que se tocan
-- sólo si están. Sin esto, el script entero fallaría por una tabla de menos.
DO $$
BEGIN
  IF to_regclass('public.plant_copies') IS NOT NULL THEN
    DELETE FROM public.plant_copies;
  END IF;
  IF to_regclass('public.user_lottery') IS NOT NULL THEN
    DELETE FROM public.user_lottery;
  END IF;
END $$;

-- ── Los perfiles, a los valores de una cuenta nueva ────────────────────────
--
-- Los mismos con los que nace un perfil en el disparador de la migración 02: si
-- se separaran, «como nuevos» dejaría de ser cierto.
UPDATE public.profiles
   SET elo_rating              = 1000,
       gems_balance            = 0,
       gold_balance            = 0,
       colosseum_tickets       = 0,
       colosseum_current_streak = 0,
       colosseum_max_streak    = 0,
       has_vip_pass            = FALSE,
       claimed_vip_levels      = '{}',
       exclude_from_ranking    = FALSE,
       referred_by             = NULL,
       -- A hoy, para que el plazo de los referidos vuelva a estar abierto.
       created_at              = NOW(),
       updated_at              = NOW();
       -- username, avatar_id, country, referral_code e is_admin NO se tocan.

-- ── El mazo inicial: las cuatro cartas de siempre ──────────────────────────
INSERT INTO public.plant_instances
  (owner_id, plant_id, rarity, star_level, is_in_deck, deck_slot)
SELECT p.id, c.plant_id, 'common', 1, TRUE, c.slot
  FROM public.profiles p
 CROSS JOIN (VALUES
   ('sunflower',  0),
   ('peashooter', 1),
   ('wallnut',    2),
   ('chomper',    3)
 ) AS c(plant_id, slot);

COMMIT;


-- -----------------------------------------------------------------------------
-- PASO 3 · COMPROBAR
--
--   Todo a cero, cuatro cartas por jugador, y nada de partidas ni referidos.
-- -----------------------------------------------------------------------------
SELECT COUNT(*)                        AS jugadores,
       COUNT(*) FILTER (WHERE elo_rating = 1000) AS con_1000_copas,
       COALESCE(SUM(gems_balance), 0)  AS gemas,
       COALESCE(SUM(gold_balance), 0)  AS oro,
       COUNT(*) FILTER (WHERE has_vip_pass) AS con_vip,
       COUNT(referral_code)            AS con_codigo_de_referido
  FROM public.profiles;

SELECT (SELECT COUNT(*) FROM public.game_rooms)     AS partidas,
       (SELECT COUNT(*) FROM public.match_actions)  AS jugadas,
       (SELECT COUNT(*) FROM public.referrals)      AS referidos,
       (SELECT COUNT(*) FROM public.transactions)   AS movimientos,
       (SELECT COUNT(*) FROM public.plant_instances) AS cartas;
-- cartas debe ser jugadores × 4.

SELECT p.username, COUNT(pi.id) AS cartas
  FROM public.profiles p
  LEFT JOIN public.plant_instances pi ON pi.owner_id = p.id
 GROUP BY p.username
 HAVING COUNT(pi.id) <> 4;
-- Debe salir VACÍO: todos con sus cuatro cartas.
