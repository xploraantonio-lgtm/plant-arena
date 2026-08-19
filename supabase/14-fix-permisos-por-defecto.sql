-- =============================================================================
-- PLANT ARENA · CERRAR LOS PERMISOS QUE SE COLARON POR DEFECTO
--
-- Idempotente. Ejecutar al final de todas las anteriores.
--
-- EL PROBLEMA
--   En la migración 01 se intentó ajustar los privilegios por defecto:
--
--     DO $$ BEGIN
--       ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
--         REVOKE INSERT, UPDATE, DELETE ON TABLES FROM anon, authenticated;
--     EXCEPTION WHEN insufficient_privilege OR undefined_object THEN
--       RAISE NOTICE '...';
--     END $$;
--
--   Ese EXCEPTION se tragó el fallo, así que la orden nunca surtió efecto y
--   NADIE se enteró. Consecuencia: todas las tablas creadas después (04 a 13)
--   heredaron los permisos por defecto de Supabase para anon y authenticated.
--
--   En la mayoría es inofensivo, porque RLS está activo y sin política de
--   escritura no se puede escribir. Pero era una red de seguridad que se creía
--   puesta y no lo estaba: si mañana alguien crea una tabla y olvida el RLS,
--   queda abierta.
--
-- LA CORRECCIÓN
--   1. Revocar de verdad, sin capturar el error: si falla, la migración falla y
--      se ve.
--   2. Repasar tabla por tabla las creadas después de la 01.
--   3. Volver a conceder sólo lo que el cliente necesita de verdad.
-- =============================================================================

BEGIN;

-- =============================================================================
-- 1. anon NO ESCRIBE EN NADA, NUNCA
-- =============================================================================
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON ALL TABLES IN SCHEMA public FROM anon;


-- =============================================================================
-- 2. TABLAS QUE EL CLIENTE NO DEBE TOCAR
--    Todas se gestionan sólo por RPC (SECURITY DEFINER), así que authenticated
--    no necesita ningún permiso de escritura.
-- =============================================================================
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    -- Inventario y catálogos (migración 04)
    'plant_catalog', 'plant_copies', 'player_packs',
    -- Escrow del coliseo (01)
    'colosseum_escrow',
    -- Minijuego del código (08)
    'secret_code_rounds', 'secret_code_attempts',
    'secret_code_entries', 'secret_code_payouts',
    -- Infraestructura interna
    'login_attempts', '_migration_audit'
  ]
  LOOP
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = t) THEN
      EXECUTE format(
        'REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.%I FROM anon, authenticated', t);
    END IF;
  END LOOP;
END $$;


-- =============================================================================
-- 3. TABLAS QUE NO DEBEN SER LEGIBLES POR LOS JUGADORES
--    login_attempts guarda direcciones IP. _migration_audit es historial
--    interno. Ninguna aporta nada al jugador.
-- =============================================================================
REVOKE SELECT ON public.login_attempts   FROM anon, authenticated;
REVOKE SELECT ON public._migration_audit FROM anon, authenticated;


-- =============================================================================
-- 4. PRIVILEGIOS POR DEFECTO, ESTA VEZ SIN TRAGARSE EL ERROR
--
--    Si la orden falla, la migración falla y se ve el mensaje. Es justo lo que
--    no pasó en la 01.
--
--    En Supabase el dueño de los objetos de `public` suele ser `postgres`. Si tu
--    proyecto usa otro rol, cambia el nombre aquí.
-- =============================================================================
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM anon;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM authenticated;

-- Y que una función nueva no sea invocable por un visitante sin sesión sólo por
-- existir.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon, PUBLIC;


-- =============================================================================
-- 5. DEVOLVER LO QUE EL CLIENTE SÍ NECESITA
--    Se reafirma aquí por si el paso 1 o 2 barrió algo de más. Es la lista
--    completa de escrituras directas que el juego hace desde el navegador: todo
--    lo demás pasa por RPC.
-- =============================================================================

-- Perfil: sólo cosmética. Los saldos, el ELO y is_admin quedan fuera.
GRANT UPDATE (username, avatar_id, country) ON public.profiles TO authenticated;

-- Cartas: sólo la asignación al mazo. Ni rareza, ni nivel, ni dueño.
GRANT UPDATE (is_in_deck, deck_slot) ON public.plant_instances TO authenticated;

-- Cola de emparejamiento: entrar y cancelar.
GRANT INSERT (user_id, mode, user_elo, colosseum_bet, tournament_id, room_code)
  ON public.matchmaking_queue TO authenticated;
GRANT UPDATE (status) ON public.matchmaking_queue TO authenticated;

-- Contenido que edita el panel. La política exige current_user_is_admin(), así
-- que el permiso por sí solo no basta.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'tournaments', 'seasons',
    'shop_packs', 'shop_gold_packages', 'shop_config',
    'lottery_sectors', 'battle_pass_levels'
  ]
  LOOP
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = t) THEN
      EXECUTE format('GRANT INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    END IF;
  END LOOP;
END $$;

INSERT INTO public._migration_audit (fase, detalle)
VALUES ('fix_permisos_por_defecto', jsonb_build_object('ok', true));

COMMIT;


-- =============================================================================
-- COMPROBACIONES
-- =============================================================================

-- 1. anon no escribe en NINGUNA tabla. Espera 0 filas.
SELECT table_name, privilege_type
  FROM information_schema.role_table_grants
 WHERE table_schema = 'public' AND grantee = 'anon'
   AND privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE')
 ORDER BY table_name;

-- 2. login_attempts y _migration_audit no son legibles. Espera 0 filas.
SELECT table_name, grantee, privilege_type
  FROM information_schema.role_table_grants
 WHERE table_schema = 'public'
   AND table_name IN ('login_attempts','_migration_audit')
   AND grantee IN ('anon','authenticated');

-- 3. Escrituras directas que quedan para authenticated. Deben ser SÓLO:
--    profiles (username, avatar_id, country)
--    plant_instances (is_in_deck, deck_slot)
--    matchmaking_queue (varias)
--    y las 7 tablas de contenido del panel.
SELECT table_name, privilege_type, string_agg(column_name, ', ' ORDER BY column_name) AS columnas
  FROM information_schema.column_privileges
 WHERE table_schema = 'public' AND grantee = 'authenticated'
   AND privilege_type IN ('INSERT','UPDATE')
 GROUP BY table_name, privilege_type
 ORDER BY table_name, privilege_type;

-- 4. Los privilegios por defecto quedaron puestos. Debe aparecer una línea por
--    cada ALTER DEFAULT PRIVILEGES aplicado.
SELECT defaclrole::regrole AS rol_dueño,
       defaclnamespace::regnamespace AS esquema,
       defaclobjtype AS tipo,
       defaclacl AS permisos
  FROM pg_default_acl
 WHERE defaclnamespace = 'public'::regnamespace;

-- 5. Repaso final: tablas con RLS activo y CERO políticas de escritura que aun
--    así tengan permiso de escritura concedido. Espera 0 filas: si sale algo,
--    es una tabla donde el permiso sobra.
SELECT c.relname AS tabla,
       count(p.polname) FILTER (WHERE p.polcmd IN ('a','w','*')) AS politicas_escritura
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN pg_policy p ON p.polrelid = c.oid
 WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
 GROUP BY c.relname
HAVING count(p.polname) FILTER (WHERE p.polcmd IN ('a','w','*')) = 0
   AND EXISTS (
     SELECT 1 FROM information_schema.role_table_grants g
      WHERE g.table_schema = 'public' AND g.table_name = c.relname
        AND g.grantee IN ('anon','authenticated')
        AND g.privilege_type IN ('INSERT','UPDATE','DELETE')
   )
 ORDER BY tabla;
