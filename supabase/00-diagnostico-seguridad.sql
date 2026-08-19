-- =============================================================================
-- DIAGNÓSTICO DE SEGURIDAD · Plant Arena   (v2)
-- Sólo lectura. No modifica nada.
--
-- Esta versión sólo consulta los catálogos del sistema y descubre las tablas y
-- columnas que EXISTEN de verdad. No menciona ninguna columna por su nombre,
-- así que no puede fallar como la v1 (que se rompió en profiles.is_admin, una
-- columna que está en schema.sql pero no en la base real).
--
-- Ejecutar en el editor SQL. Devuelve UNA fila con un JSON: cópiala completa.
-- =============================================================================

SELECT jsonb_pretty(jsonb_build_object(

  -- 1. TODAS las funciones y TODAS sus sobrecargas.
  --    Lo más importante: revela si quedaron versiones viejas vulnerables
  --    conviviendo con las nuevas, y quién puede ejecutarlas.
  'funciones', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'nombre',           p.proname,
      'args',             pg_get_function_identity_arguments(p.oid),
      'security_definer', p.prosecdef,
      'search_path_fijo', (p.proconfig IS NOT NULL),
      'anon_ejecuta',     has_function_privilege('anon',          p.oid, 'EXECUTE'),
      'auth_ejecuta',     has_function_privilege('authenticated', p.oid, 'EXECUTE'),
      -- Si es SECURITY DEFINER, recibe un id por parámetro y esto es false,
      -- es explotable por cualquier usuario autenticado.
      'usa_auth_uid',     (pg_get_functiondef(p.oid) ILIKE '%auth.uid()%')
    ) ORDER BY p.proname, pg_get_function_identity_arguments(p.oid))
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f'
  ), '[]'::jsonb),

  -- 2. Permisos de COLUMNA para anon/authenticated en todas las tablas.
  --    Confirma que tu REVOKE/GRANT sobre profiles quedó aplicado, y descubre
  --    si alguna otra tabla deja escribir campos sensibles.
  'grants_columna', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'tabla',      table_name,
      'rol',        grantee,
      'privilegio', privilege_type,
      'columna',    column_name
    ) ORDER BY table_name, grantee, privilege_type, column_name)
    FROM information_schema.column_privileges
    WHERE table_schema = 'public'
      AND grantee IN ('anon', 'authenticated')
      AND privilege_type IN ('INSERT', 'UPDATE')
  ), '[]'::jsonb),

  -- 3. Permisos de TABLA completos (un UPDATE suelto aquí anula el punto 2).
  'grants_tabla', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'tabla',      table_name,
      'rol',        grantee,
      'privilegio', privilege_type
    ) ORDER BY table_name, grantee, privilege_type)
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND grantee IN ('anon', 'authenticated')
      AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE')
  ), '[]'::jsonb),

  -- 4. RLS y políticas por tabla.
  --    polcmd: r=SELECT  a=INSERT  w=UPDATE  d=DELETE  *=ALL
  --    Una tabla con RLS y 0 políticas de escritura rechaza en silencio todo
  --    INSERT/UPDATE que venga del cliente.
  'tablas', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'tabla',      c.relname,
      'rls_activo', c.relrowsecurity,
      'rls_forzado', c.relforcerowsecurity,
      -- nº de filas estimado: evita hacer count(*) por tabla
      'filas_aprox', GREATEST(c.reltuples::bigint, 0),
      'politicas',  COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'nombre',     pol.polname,
          'cmd',        pol.polcmd,
          'roles',      (SELECT array_agg(r.rolname::text)
                           FROM pg_roles r WHERE r.oid = ANY(pol.polroles)),
          'using',      pg_get_expr(pol.polqual,      pol.polrelid),
          'with_check', pg_get_expr(pol.polwithcheck, pol.polrelid)
        ) ORDER BY pol.polname)
        FROM pg_policy pol WHERE pol.polrelid = c.oid
      ), '[]'::jsonb)
    ) ORDER BY c.relname)
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
  ), '[]'::jsonb),

  -- 5. Columnas REALES de todas las tablas, descubiertas del catálogo.
  --    Aquí se ve qué dice la base frente a lo que dice schema.sql.
  'columnas', COALESCE((
    SELECT jsonb_object_agg(table_name, cols)
    FROM (
      SELECT table_name,
             jsonb_agg(
               column_name || ' ' || data_type ||
               CASE WHEN is_nullable = 'NO' THEN ' NOT NULL' ELSE '' END ||
               COALESCE(' DEFAULT ' || column_default, '')
               ORDER BY ordinal_position
             ) AS cols
      FROM information_schema.columns
      WHERE table_schema = 'public'
      GROUP BY table_name
    ) z
  ), '{}'::jsonb),

  -- 6. CHECK constraints: los guardias que ya existen, para reutilizarlos.
  'checks', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'tabla', c.relname,
      'nombre', con.conname,
      'expr',  pg_get_constraintdef(con.oid)
    ) ORDER BY c.relname, con.conname)
    FROM pg_constraint con
    JOIN pg_class c     ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND con.contype = 'c'
  ), '[]'::jsonb),

  -- 7. Triggers activos.
  'triggers', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'tabla',   c.relname,
      'trigger', t.tgname,
      'funcion', p.proname
    ) ORDER BY c.relname, t.tgname)
    FROM pg_trigger t
    JOIN pg_class c     ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_proc p      ON p.oid = t.tgfoid
    WHERE n.nspname = 'public' AND NOT t.tgisinternal
  ), '[]'::jsonb),

  -- 8. Vistas (pueden filtrar datos saltándose RLS si son SECURITY DEFINER).
  'vistas', COALESCE((
    SELECT jsonb_agg(c.relname ORDER BY c.relname)
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('v', 'm')
  ), '[]'::jsonb),

  -- 9. Conteos exactos, descubiertos dinámicamente. No puede fallar por
  --    tablas ausentes porque enumera sólo las que existen.
  'conteos', COALESCE((
    SELECT jsonb_object_agg(t.relname, t.n)
    FROM (
      SELECT c.relname,
             (xpath(
                '/row/c/text()',
                query_to_xml(
                  format('SELECT count(*) AS c FROM public.%I', c.relname),
                  false, true, ''
                )
              ))[1]::text::bigint AS n
      FROM pg_class c
      JOIN pg_namespace n2 ON n2.oid = c.relnamespace
      WHERE n2.nspname = 'public' AND c.relkind = 'r'
    ) t
  ), '{}'::jsonb)

)) AS diagnostico;
