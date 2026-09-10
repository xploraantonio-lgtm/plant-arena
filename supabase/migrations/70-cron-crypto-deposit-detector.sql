-- ============================================================================
-- MIGRACIÓN 70: CRON AUTÓNOMO PARA DETECCIÓN DE DEPÓSITOS USDT BEP20
-- ============================================================================

-- 1. Asegurar clave de cursor en crypto_treasury_config
INSERT INTO public.crypto_treasury_config (key, value, description)
VALUES ('last_scanned_bsc_block', '120975819', 'Último bloque de BSC escaneado por crypto-deposit-detector')
ON CONFLICT (key) DO NOTHING;

-- 2. Eliminar cron previo si ya existiera para evitar duplicados
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'crypto-deposit-detector-job') THEN
    PERFORM cron.unschedule('crypto-deposit-detector-job');
  END IF;
END $$;

-- 3. Programar ejecución cada 2 minutos usando net.http_post
SELECT cron.schedule(
  'crypto-deposit-detector-job',
  '*/2 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://lesrjhbzsampjsjbocfa.supabase.co/functions/v1/crypto-deposit-detector',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxlc3JqaGJ6c2FtcGpzamJvY2ZhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcwMTQyMDQsImV4cCI6MjEwMjU5MDIwNH0.TJJcZv2Q5O4YDgVNyAJcolGFsAImPTu1J-le60ZkfTA',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxlc3JqaGJ6c2FtcGpzamJvY2ZhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcwMTQyMDQsImV4cCI6MjEwMjU5MDIwNH0.TJJcZv2Q5O4YDgVNyAJcolGFsAImPTu1J-le60ZkfTA'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 15000
  );
  $$
);
