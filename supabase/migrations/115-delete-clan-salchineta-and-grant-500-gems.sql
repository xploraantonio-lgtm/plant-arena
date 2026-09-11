-- =============================================================================
-- MIGRACIÓN 115: ELIMINAR CLAN SALCHINETA, ASIGNAR 500 GEMAS A SALCHINFT Y
--               AJUSTE DE REACTIVACIÓN INMEDIATA CON CUALQUIER SALDO (> 0 💎)
--
-- 1. Elimina el clan 'salchineta' (o derivado) y limpia registros asociados.
-- 2. Desvincula a 'SalchiNFT' de clan_members para que pueda fundar un nuevo clan.
-- 3. Acredita de forma atómica +500 Gemas ($5.00 USD) a 'SalchiNFT'.
-- 4. Corrige deposit_to_clan_vault:
--    - El estado de derrota ocurre ÚNICAMENTE cuando el tesoro llega a 0.
--    - Con cualquier aporte que deje el tesoro > 0 (así sean 50 💎), el clan
--      se reactiva automáticamente a 'active'.
-- 5. Reactiva a 'active' cualquier clan con vault_gems > 0 o sin derrotas.
-- =============================================================================

BEGIN;

-- ── 1. ELIMINAR CLAN SALCHINETA Y DESVINCULAR SALCHINFT ─────────────────────

DO $$
DECLARE
  v_clan_id   UUID;
  v_salchi_id UUID;
BEGIN
  -- Obtener ID de SalchiNFT
  SELECT id INTO v_salchi_id 
    FROM public.profiles 
   WHERE LOWER(TRIM(username)) = 'salchinft' 
   LIMIT 1;

  -- Buscar clan Salchineta por nombre, tag o si el líder es SalchiNFT
  SELECT id INTO v_clan_id
    FROM public.clans
   WHERE LOWER(TRIM(name)) LIKE '%salchineta%'
      OR LOWER(TRIM(tag)) LIKE '%salchineta%'
      OR (v_salchi_id IS NOT NULL AND leader_id = v_salchi_id)
   LIMIT 1;

  IF v_clan_id IS NOT NULL THEN
    IF to_regclass('public.clan_join_requests') IS NOT NULL THEN
      EXECUTE 'DELETE FROM public.clan_join_requests WHERE clan_id = $1' USING v_clan_id;
    END IF;

    IF to_regclass('public.clan_audit_logs') IS NOT NULL THEN
      EXECUTE 'DELETE FROM public.clan_audit_logs WHERE clan_id = $1' USING v_clan_id;
    END IF;

    DELETE FROM public.clan_members WHERE clan_id = v_clan_id;
    DELETE FROM public.clans WHERE id = v_clan_id;
    RAISE NOTICE '✅ Clan Salchineta (ID: %) eliminado correctamente.', v_clan_id;
  END IF;

  -- Desvincular a SalchiNFT de cualquier clan por si acaso
  IF v_salchi_id IS NOT NULL THEN
    IF to_regclass('public.clan_join_requests') IS NOT NULL THEN
      EXECUTE 'DELETE FROM public.clan_join_requests WHERE user_id = $1' USING v_salchi_id;
    END IF;
    DELETE FROM public.clan_members WHERE user_id = v_salchi_id;
  END IF;
END $$;


-- ── 2. ASIGNAR +500 GEMAS A SalchiNFT ───────────────────────────────────────

DO $$
DECLARE
  v_user       RECORD;
  v_old_gems   NUMERIC;
  v_new_gems   NUMERIC;
BEGIN
  SELECT id, username, gems_balance
    INTO v_user
    FROM public.profiles
   WHERE LOWER(TRIM(username)) = 'salchinft'
   LIMIT 1
   FOR UPDATE;

  IF FOUND THEN
    v_old_gems := COALESCE(v_user.gems_balance, 0.0);
    v_new_gems := v_old_gems + 500.0;

    UPDATE public.profiles
       SET gems_balance = v_new_gems,
           updated_at   = NOW()
     WHERE id = v_user.id;

    INSERT INTO public.transactions (user_id, type, amount_gems, description, status)
    VALUES (
      v_user.id,
      'deposit',
      500.0,
      'Asignación para prueba de fundación de clan (+500 Gemas)',
      'completed'
    );

    RAISE NOTICE '✅ Asignadas +500 Gemas a SalchiNFT. Saldo anterior: % 💎 | Nuevo saldo: % 💎', v_old_gems, v_new_gems;
  END IF;
END $$;


-- ── 3. RPC: DEPÓSITO AL TESORO DEL CLAN (Reactivación inmediata con > 0 💎) ──

CREATE OR REPLACE FUNCTION public.deposit_to_clan_vault(p_amount NUMERIC)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid         UUID := auth.uid();
  v_clan_id     UUID;
  v_clan        RECORD;
  v_profile     RECORD;
  v_tickets     INTEGER;
  v_new_vault   NUMERIC;
  v_was_def     BOOLEAN;
  v_is_react    BOOLEAN := FALSE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;

  SELECT clan_id INTO v_clan_id FROM public.clan_members WHERE user_id = v_uid;
  IF v_clan_id IS NULL THEN RAISE EXCEPTION 'NO_CLAN'; END IF;

  SELECT * INTO v_clan FROM public.clans WHERE id = v_clan_id FOR UPDATE;

  SELECT gems_balance, username INTO v_profile FROM public.profiles WHERE id = v_uid FOR UPDATE;
  IF v_profile.gems_balance IS NULL OR v_profile.gems_balance < p_amount THEN
    RAISE EXCEPTION 'INSUFFICIENT_GEMS';
  END IF;

  v_tickets := FLOOR(p_amount / 100.0)::INTEGER;
  v_new_vault := COALESCE(v_clan.vault_gems, 0) + p_amount;
  v_was_def := (v_clan.status = 'defeated');
  -- Reactivación automática en cuanto el tesoro tenga > 0 Gemas (incluso 50 💎)
  v_is_react := (v_was_def AND v_new_vault > 0.0);

  -- 1. Descontar gemas y otorgar tickets al donante
  UPDATE public.profiles
     SET gems_balance      = gems_balance - p_amount,
         colosseum_tickets = COALESCE(colosseum_tickets, 0) + v_tickets,
         updated_at        = NOW()
   WHERE id = v_uid;

  -- 2. Inyectar gemas al tesoro del clan y reactivar si tiene > 0 Gemas
  UPDATE public.clans
     SET vault_gems = v_new_vault,
         status     = CASE WHEN v_new_vault > 0.0 THEN 'active' ELSE status END,
         updated_at = NOW()
   WHERE id = v_clan_id;

  -- 3. Transacción y auditoría
  INSERT INTO public.transactions (user_id, type, amount_gems, description, status)
  VALUES (
    v_uid,
    'clan_deposit',
    p_amount,
    'Aporte al Tesoro del Clan' || CASE WHEN v_is_react THEN ' (¡Clan Reactivado!)' ELSE '' END,
    'completed'
  );

  INSERT INTO public.clan_audit_logs (
    clan_id, clan_name, action, performed_by, performed_by_name, amount_gems, details
  ) VALUES (
    v_clan_id, v_clan.name, 'DEPOSIT', v_uid, v_profile.username, p_amount,
    jsonb_build_object(
      'tickets_awarded', v_tickets,
      'vault_before', v_clan.vault_gems,
      'vault_after', v_new_vault,
      'reactivated', v_is_react
    )
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'tickets_awarded', v_tickets,
    'clan_id', v_clan_id,
    'vault_gems', v_new_vault,
    'status', CASE WHEN v_new_vault > 0.0 THEN 'active' ELSE v_clan.status END,
    'reactivated', v_is_react
  );
END;
$$;

REVOKE ALL ON FUNCTION public.deposit_to_clan_vault(NUMERIC) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.deposit_to_clan_vault(NUMERIC) FROM anon;
GRANT EXECUTE ON FUNCTION public.deposit_to_clan_vault(NUMERIC) TO authenticated;


-- ── 4. REACTIVAR CUALQUIER CLAN CON TESORO > 0 O SIN DERROTAS ────────────────

UPDATE public.clans
   SET status     = 'active',
       updated_at = NOW()
 WHERE status = 'defeated'
   AND (COALESCE(vault_gems, 0) > 0 OR losses = 0 OR losses IS NULL);

NOTIFY pgrst, 'reload schema';

COMMIT;
