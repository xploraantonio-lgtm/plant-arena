-- ============================================================================
-- TEMPLATE OPCIONAL — PROGRAMAR verify-pending CON pg_cron + pg_net + Vault
--
-- NO EJECUTAR SIN SUSTITUIR LOS 3 PLACEHOLDERS.
-- NO COMMITTEAR ESTE ARCHIVO DESPUÉS DE PONER VALORES REALES.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS supabase_vault;

-- Cambiar sólo los valores, mantener los nombres.
SELECT vault.create_secret(
  'https://TU_PROJECT_REF.supabase.co',
  'plant_arena_project_url'
);

SELECT vault.create_secret(
  'TU_PUBLISHABLE_O_ANON_KEY',
  'plant_arena_publishable_key'
);

SELECT vault.create_secret(
  'TU_VERIFY_CRON_SECRET',
  'plant_arena_verify_cron_secret'
);

-- Si ya existe un job con ese nombre, eliminarlo antes.
DO $$
DECLARE
  v_jobid BIGINT;
BEGIN
  SELECT jobid INTO v_jobid
    FROM cron.job
   WHERE jobname = 'plant-arena-verify-pending'
   LIMIT 1;

  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_jobid);
  END IF;
END;
$$;

SELECT cron.schedule(
  'plant-arena-verify-pending',
  '* * * * *',
  $cron$
    SELECT net.http_post(
      url := (
        SELECT decrypted_secret
          FROM vault.decrypted_secrets
         WHERE name = 'plant_arena_project_url'
         LIMIT 1
      ) || '/functions/v1/verify-pending',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', (
          SELECT decrypted_secret
            FROM vault.decrypted_secrets
           WHERE name = 'plant_arena_publishable_key'
           LIMIT 1
        ),
        'x-cron-secret', (
          SELECT decrypted_secret
            FROM vault.decrypted_secrets
           WHERE name = 'plant_arena_verify_cron_secret'
           LIMIT 1
        )
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 10000
    ) AS request_id;
  $cron$
);

-- Comprobar:
SELECT jobid, jobname, schedule, active
  FROM cron.job
 WHERE jobname = 'plant-arena-verify-pending';
