-- =============================================================================
-- PLANT ARENA · COLISEO: DEVOLVER LO COBRADO Y ACEPTAR TICKET
--
-- Idempotente.
--
-- DOS HUECOS QUE CIERRA
--
--   1. NADIE DEVOLVÍA LA APUESTA.
--      place_colosseum_wager descuenta las gemas al entrar en cola y crea el
--      escrow con estado 'held' y sin sala. Si el emparejamiento se rinde tras
--      los cuatro minutos, esas gemas se quedaban retenidas para siempre: el
--      jugador pagaba por una partida que nunca ocurrió. La tabla ya preveía el
--      estado 'refunded', pero nada lo usaba.
--
--   2. EL TICKET SE GASTABA EN EL NAVEGADOR.
--      El coliseo admite ticket como alternativa a las gemas, y el cliente lo
--      descuenta con useColosseumTicket(). Pero la función sólo sabía de gemas,
--      así que el ticket se restaba en local, el servidor no se enteraba, y al
--      recargar volvía: se jugaba gratis.
-- =============================================================================

BEGIN;

-- =============================================================================
-- 1. EL ESCROW RECUERDA CON QUÉ SE PAGÓ Y CUÁNDO CADUCA
--    Sin saber la forma de pago no se puede devolver lo mismo que se cobró.
-- =============================================================================
ALTER TABLE public.colosseum_escrow
  ADD COLUMN IF NOT EXISTS paid_with  TEXT NOT NULL DEFAULT 'gems',
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ;

DO $$
BEGIN
  ALTER TABLE public.colosseum_escrow
    ADD CONSTRAINT colosseum_escrow_paid_with_check
    CHECK (paid_with IN ('gems', 'ticket'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Plazo de espera del emparejamiento, editable sin tocar código.
INSERT INTO public.shop_config (key, value) VALUES
  ('colosseum_queue_timeout_seconds', 240)   -- 4 minutos
ON CONFLICT (key) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_escrow_pendiente
  ON public.colosseum_escrow (status, expires_at)
  WHERE status = 'held' AND room_id IS NULL;


-- =============================================================================
-- 2. RETENER LA APUESTA, CON GEMAS O CON TICKET
--
-- La versión de un solo argumento se BORRA explícitamente. CREATE OR REPLACE con
-- otra lista de argumentos crearía una sobrecarga y dejaría la vieja viva — es
-- exactamente el error que ya nos pasó con esta misma función.
-- =============================================================================
DROP FUNCTION IF EXISTS public.place_colosseum_wager(NUMERIC);

CREATE OR REPLACE FUNCTION public.place_colosseum_wager(
  p_bet        NUMERIC,
  p_use_ticket BOOLEAN
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid     UUID := auth.uid();
  v_perfil  RECORD;
  v_id      UUID;
  v_timeout INTEGER;
  v_forma   TEXT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF p_bet IS NULL OR p_bet <= 0 THEN RAISE EXCEPTION 'Apuesta inválida'; END IF;
  IF p_bet > 1000 THEN RAISE EXCEPTION 'Apuesta por encima del máximo permitido'; END IF;

  -- No acumular apuestas: una sola retención pendiente por jugador.
  IF EXISTS (
    SELECT 1 FROM public.colosseum_escrow
     WHERE user_id = v_uid AND status = 'held' AND room_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Ya tienes una apuesta retenida esperando rival. Cancela la búsqueda antes de apostar otra vez.';
  END IF;

  SELECT value::INTEGER INTO v_timeout
    FROM public.shop_config WHERE key = 'colosseum_queue_timeout_seconds';
  v_timeout := COALESCE(v_timeout, 240);

  SELECT gems_balance, colosseum_tickets INTO v_perfil
    FROM public.profiles WHERE id = v_uid FOR UPDATE;
  IF v_perfil IS NULL THEN RAISE EXCEPTION 'Perfil no encontrado'; END IF;

  IF p_use_ticket THEN
    IF v_perfil.colosseum_tickets < 1 THEN
      RAISE EXCEPTION 'No tienes tickets de coliseo';
    END IF;
    UPDATE public.profiles
       SET colosseum_tickets = colosseum_tickets - 1
     WHERE id = v_uid;
    v_forma := 'ticket';
  ELSE
    IF v_perfil.gems_balance < p_bet THEN
      RAISE EXCEPTION 'Saldo insuficiente: necesitas % y tienes %',
        p_bet, v_perfil.gems_balance;
    END IF;
    UPDATE public.profiles
       SET gems_balance = gems_balance - p_bet
     WHERE id = v_uid;
    v_forma := 'gems';
  END IF;

  INSERT INTO public.colosseum_escrow
    (user_id, bet_gems, paid_with, expires_at)
  VALUES
    (v_uid, p_bet, v_forma, NOW() + make_interval(secs => v_timeout))
  RETURNING id INTO v_id;

  INSERT INTO public.transactions (user_id, type, amount_gems, description, status)
  VALUES (v_uid, 'colosseum_bet',
          CASE WHEN v_forma = 'ticket' THEN 0 ELSE p_bet END,
          CASE WHEN v_forma = 'ticket'
               THEN 'Entrada al Coliseo con ticket (apuesta nominal ' || p_bet || ')'
               ELSE 'Apuesta retenida en el Coliseo' END,
          'completed');

  RETURN jsonb_build_object(
    'success',   TRUE,
    'escrowId',  v_id,
    'betPlaced', p_bet,
    'paidWith',  v_forma,
    'expiresIn', v_timeout
  );
END;
$$;


-- =============================================================================
-- 3. DEVOLVER LA APUESTA
--
-- Se llama al cancelar la búsqueda a mano, o cuando vence el plazo. Devuelve
-- EXACTAMENTE lo que se cobró: gemas si se pagó con gemas, un ticket si se pagó
-- con ticket.
--
-- Sólo devuelve retenciones SIN sala. Si ya hay partida asignada, el dinero está
-- en juego y lo liquida la resolución.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.refund_colosseum_wager()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid    UUID := auth.uid();
  v_escrow RECORD;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  SELECT * INTO v_escrow FROM public.colosseum_escrow
   WHERE user_id = v_uid AND status = 'held' AND room_id IS NULL
   ORDER BY created_at
   LIMIT 1
   FOR UPDATE;

  IF NOT FOUND THEN
    -- No es un error: puede que ya se haya emparejado o devuelto.
    RETURN jsonb_build_object('refunded', FALSE, 'reason', 'sin_apuesta_pendiente');
  END IF;

  IF v_escrow.paid_with = 'ticket' THEN
    UPDATE public.profiles
       SET colosseum_tickets = colosseum_tickets + 1
     WHERE id = v_uid;
  ELSE
    UPDATE public.profiles
       SET gems_balance = gems_balance + v_escrow.bet_gems
     WHERE id = v_uid;
  END IF;

  UPDATE public.colosseum_escrow
     SET status = 'refunded', refunded_at = NOW()
   WHERE id = v_escrow.id;

  INSERT INTO public.transactions (user_id, type, amount_gems, description, status)
  VALUES (v_uid, 'colosseum_win',
          CASE WHEN v_escrow.paid_with = 'ticket' THEN 0 ELSE v_escrow.bet_gems END,
          CASE WHEN v_escrow.paid_with = 'ticket'
               THEN 'Ticket devuelto: no se encontró rival'
               ELSE 'Apuesta devuelta: no se encontró rival' END,
          'completed');

  -- Sacar al jugador de la cola, si seguía dentro.
  UPDATE public.matchmaking_queue
     SET status = 'cancelled'
   WHERE user_id = v_uid AND mode = 'colosseum' AND status = 'searching';

  RETURN jsonb_build_object(
    'refunded', TRUE,
    'paidWith', v_escrow.paid_with,
    'amount',   CASE WHEN v_escrow.paid_with = 'ticket' THEN 1 ELSE v_escrow.bet_gems END
  );
END;
$$;


-- =============================================================================
-- 4. BARRIDO DE RETENCIONES CADUCADAS
--
-- Red de seguridad para los casos en que el jugador cierra el navegador sin
-- cancelar: nadie llamaría a refund_colosseum_wager y las gemas se quedarían
-- retenidas para siempre.
--
-- Pensada para un cron cada minuto (pg_cron o una llamada programada).
-- =============================================================================
CREATE OR REPLACE FUNCTION public.expire_stale_colosseum_escrows()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row      RECORD;
  v_gemas    NUMERIC := 0;
  v_tickets  INTEGER := 0;
BEGIN
  FOR v_row IN
    SELECT * FROM public.colosseum_escrow
     WHERE status = 'held'
       AND room_id IS NULL
       AND expires_at IS NOT NULL
       AND expires_at < NOW()
     FOR UPDATE SKIP LOCKED
  LOOP
    IF v_row.paid_with = 'ticket' THEN
      UPDATE public.profiles SET colosseum_tickets = colosseum_tickets + 1
       WHERE id = v_row.user_id;
      v_tickets := v_tickets + 1;
    ELSE
      UPDATE public.profiles SET gems_balance = gems_balance + v_row.bet_gems
       WHERE id = v_row.user_id;
      v_gemas := v_gemas + v_row.bet_gems;
    END IF;

    UPDATE public.colosseum_escrow
       SET status = 'refunded', refunded_at = NOW()
     WHERE id = v_row.id;

    INSERT INTO public.transactions (user_id, type, amount_gems, description, status)
    VALUES (v_row.user_id, 'colosseum_win',
            CASE WHEN v_row.paid_with = 'ticket' THEN 0 ELSE v_row.bet_gems END,
            'Devolución automática: se agotó el tiempo de búsqueda',
            'completed');

    UPDATE public.matchmaking_queue
       SET status = 'cancelled'
     WHERE user_id = v_row.user_id AND mode = 'colosseum' AND status = 'searching';
  END LOOP;

  RETURN jsonb_build_object(
    'gemsRefunded',    v_gemas,
    'ticketsRefunded', v_tickets
  );
END;
$$;


-- =============================================================================
-- 5. PERMISOS
-- =============================================================================
REVOKE EXECUTE ON FUNCTION public.place_colosseum_wager(NUMERIC, BOOLEAN) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.place_colosseum_wager(NUMERIC, BOOLEAN) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.refund_colosseum_wager() FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.refund_colosseum_wager() TO authenticated;

-- El barrido no lo llama el jugador: es para el cron o para el administrador.
REVOKE EXECUTE ON FUNCTION public.expire_stale_colosseum_escrows() FROM anon, authenticated, PUBLIC;

INSERT INTO public._migration_audit (fase, detalle)
VALUES ('coliseo_devolucion_ticket', jsonb_build_object('ok', true));

COMMIT;


-- =============================================================================
-- NOTA PENDIENTE DE DECISIÓN: EL POZO CUANDO SE PAGA CON TICKET
--
-- report_match_result calcula el pozo así:
--     SELECT SUM(bet_gems) WHERE room_id = ... AND status = 'held'
--
-- Una entrada pagada con ticket tiene bet_gems con la apuesta nominal, pero NO
-- se cobraron gemas. Así que el pozo incluye un importe que nunca entró: la casa
-- lo está subvencionando.
--
-- Eso puede ser lo correcto — un ticket es un artículo promocional y su valor lo
-- pone la casa — pero conviene que sea una decisión consciente y no un descuido.
-- Las dos opciones:
--
--   A) La casa subvenciona (comportamiento actual). El ticket vale su apuesta
--      nominal. Coste real por cada partida con ticket. Se puede medir con:
--
--        SELECT SUM(bet_gems) FROM colosseum_escrow
--         WHERE paid_with = 'ticket' AND status = 'settled';
--
--   B) El ticket no aporta al pozo. Quien paga con ticket sólo puede ganar la
--      parte del rival, así que el premio es menor. Requiere cambiar el cálculo
--      del pozo para sumar sólo las entradas con paid_with = 'gems'.
--
-- Dímelo y lo aplico. Mientras no se decida, rige la A.
-- =============================================================================


-- =============================================================================
-- COMPROBACIONES
-- =============================================================================

-- 1. La función vieja de un argumento ya no existe. Espera una sola fila,
--    con args = 'p_bet numeric, p_use_ticket boolean'.
SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'place_colosseum_wager';

-- 2. Columnas nuevas del escrow.
SELECT column_name, data_type, column_default
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'colosseum_escrow'
 ORDER BY ordinal_position;

-- 3. ¿Hay retenciones huérfanas de antes de esta migración? Son gemas que se
--    quedaron cobradas sin partida. Si sale algo, ejecuta el barrido del punto 4
--    (necesita expires_at, que a las viejas les falta: ver el UPDATE de abajo).
SELECT id, user_id, bet_gems, paid_with, created_at, expires_at
  FROM public.colosseum_escrow
 WHERE status = 'held' AND room_id IS NULL
 ORDER BY created_at;

-- 4. Si el punto 3 devolvió filas sin expires_at, dales un plazo ya vencido para
--    que el barrido las recoja:
--
--   UPDATE public.colosseum_escrow
--      SET expires_at = created_at + INTERVAL '4 minutes'
--    WHERE status = 'held' AND room_id IS NULL AND expires_at IS NULL;
--
--   SELECT public.expire_stale_colosseum_escrows();

-- 5. Plazo configurado.
SELECT key, value FROM public.shop_config
 WHERE key = 'colosseum_queue_timeout_seconds';
