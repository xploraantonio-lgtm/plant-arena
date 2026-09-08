-- =============================================================================
-- MIGRACIÓN 59: ASIGNACIÓN DE 5 GEMAS AL USUARIO 'AnghelitO091'
--
-- Asigna:
--   + 5 Gemas (gems_balance)
--   + Registro auditado en public.transactions
-- =============================================================================

BEGIN;

DO $$
DECLARE
  v_user RECORD;
  v_new_gems NUMERIC(12, 2);
BEGIN
  -- Buscar usuario por username (ignora mayúsculas/minúsculas y espacios)
  SELECT id, username, gems_balance INTO v_user
  FROM public.profiles
  WHERE LOWER(TRIM(username)) = 'anghelito091'
     OR LOWER(TRIM(username)) LIKE '%anghelito091%'
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontró ningún usuario con username que contenga "anghelito091".';
  ELSE
    -- 1. Actualizar balance de gemas
    UPDATE public.profiles
       SET gems_balance = COALESCE(gems_balance, 0) + 5.0,
           updated_at   = NOW()
     WHERE id = v_user.id
     RETURNING gems_balance INTO v_new_gems;

    -- 2. Registrar transacción en el historial
    INSERT INTO public.transactions (user_id, type, amount_gems, description, status)
    VALUES (
      v_user.id,
      'admin_gift',
      5.0,
      'Asignación administrativa: +5 Gemas',
      'completed'
    );

    RAISE NOTICE '✅ 5 Gemas asignadas exitosamente a "%" (ID: %)', v_user.username, v_user.id;
    RAISE NOTICE '   - Saldo anterior: % Gemas', COALESCE(v_user.gems_balance, 0);
    RAISE NOTICE '   - Nuevo saldo: % Gemas', v_new_gems;
  END IF;
END $$;

COMMIT;
