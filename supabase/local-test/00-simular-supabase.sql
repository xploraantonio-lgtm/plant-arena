-- =============================================================================
-- ANDAMIO PARA PROBAR LAS MIGRACIONES EN UN POSTGRES PELADO
--
-- Supabase añade sobre Postgres unas cuantas cosas que las migraciones dan por
-- hechas: el esquema `auth` con su tabla de usuarios, la función `auth.uid()`
-- que dice quién llama, y los tres roles (anon, authenticated, service_role).
-- Un Postgres recién instalado no tiene nada de eso, así que sin este fichero
-- ninguna migración se aplica.
--
-- PARA QUÉ SIRVE ESTO
--   Reproducir la cadena 01→17 desde cero y ver qué se rompe ANTES de dársela al
--   dueño del juego. Los dos fallos del 2026-08-19 —una columna que yo mismo
--   había borrado en la 04 y un `TEXT[] || texto` que Postgres lee como literal
--   de array— sólo se ven ejecutando, no leyendo. Cada uno costó un viaje de ida
--   y vuelta.
--
-- QUÉ *NO* PRUEBA
--   Nada de PostgREST: los 401 por revocar una columna, el comportamiento real de
--   RLS con un JWT, ni la resolución de sobrecargas desde el cliente. Para eso
--   haría falta Supabase local completo, que necesita Docker. Aquí se validan
--   sintaxis, tipos, nombres de columna y lógica de plpgsql, que es donde hemos
--   estado fallando.
--
-- OJO: `auth.uid()` de aquí es de mentira. Lee una variable de sesión, así que en
-- las pruebas se puede decir "ahora soy este jugador" con:
--     SELECT set_config('test.uid', '<uuid>', false);
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. LOS TRES ROLES
--    Las migraciones les dan y les quitan permisos constantemente. Si no
--    existen, cada GRANT y cada REVOKE falla.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticator') THEN
    CREATE ROLE authenticator NOINHERIT LOGIN PASSWORD 'postgres';
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT anon, authenticated, service_role TO authenticator;
GRANT anon, authenticated, service_role TO postgres;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. EL ESQUEMA auth
--    Sólo lo que las migraciones tocan de verdad: auth.users con las columnas
--    que se leen (id, email, encrypted_password, raw_user_meta_data), porque
--    my_auth_status y handle_new_user las usan.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email              TEXT UNIQUE,
    encrypted_password TEXT,
    raw_user_meta_data JSONB DEFAULT '{}'::JSONB,
    raw_app_meta_data  JSONB DEFAULT '{}'::JSONB,
    created_at         TIMESTAMPTZ DEFAULT NOW()
);

GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. auth.uid() DE MENTIRA
--    En Supabase saca el id del JWT. Aquí lo saca de una variable de sesión, que
--    es lo que permite simular a un jugador concreto en las pruebas.
--
--    Devuelve NULL si no se ha puesto, igual que Supabase con una petición sin
--    autenticar — así se puede comprobar que las funciones lanzan
--    'No autenticado' cuando toca.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS UUID
LANGUAGE plpgsql
STABLE
AS $$
DECLARE v TEXT;
BEGIN
  v := current_setting('test.uid', true);
  IF v IS NULL OR v = '' THEN RETURN NULL; END IF;
  RETURN v::UUID;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION auth.role()
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$ SELECT COALESCE(NULLIF(current_setting('test.role', true), ''), 'authenticated') $$;

CREATE OR REPLACE FUNCTION auth.email()
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$ SELECT email FROM auth.users WHERE id = auth.uid() $$;

GRANT EXECUTE ON FUNCTION auth.uid(), auth.role(), auth.email() TO anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. EXTENSIONES QUE SUPABASE TRAE PUESTAS
-- ─────────────────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Supabase las pone en el esquema `extensions`; algunas migraciones podrían
-- referirse a él.
CREATE SCHEMA IF NOT EXISTS extensions;
GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role;

-- pg_cron no está: las migraciones sólo lo mencionan en comentarios y en
-- consultas comentadas, así que no hace falta simularlo.

SELECT 'andamio listo' AS estado;
