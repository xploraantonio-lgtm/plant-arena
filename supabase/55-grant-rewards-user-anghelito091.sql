-- =============================================================================
-- MIGRACIÓN 55: ASIGNACIÓN DE RECOMPENSAS AL USUARIO 'AnghelitO091'
--
-- Asigna:
--   + 2,000 de oro (gold_balance)
--   + 5 gemas (gems_balance)
--   + Pase VIP (has_vip_pass = TRUE)
--   + 1 Sobre Épico en su inventario (player_packs con pack_id = 'epic')
-- =============================================================================

BEGIN;

-- 1. Actualizar balances y VIP en profiles
UPDATE public.profiles
SET 
  gold_balance = COALESCE(gold_balance, 0) + 2000,
  gems_balance = COALESCE(gems_balance, 0) + 5,
  has_vip_pass = TRUE,
  updated_at = NOW()
WHERE LOWER(TRIM(username)) = 'anghelito091';

-- 2. Insertar sobre épico en el inventario (player_packs) y registrar transacción
DO $$
DECLARE
  v_user RECORD;
  v_pack_id UUID;
BEGIN
  SELECT id, username, gold_balance, gems_balance, has_vip_pass INTO v_user
  FROM public.profiles
  WHERE LOWER(TRIM(username)) = 'anghelito091';

  IF NOT FOUND THEN
    RAISE WARNING 'No se encontró ningún usuario con username = "AnghelitO091". Verifica si el usuario ya inició sesión o está registrado.';
  ELSE
    -- Añadir sobre épico al inventario
    INSERT INTO public.player_packs (user_id, pack_id, source)
    VALUES (v_user.id, 'epic', 'gift')
    RETURNING id INTO v_pack_id;

    -- Registrar transacción para auditoría del balance de gemas
    INSERT INTO public.transactions (user_id, type, amount_gems, description, status)
    VALUES (
      v_user.id,
      'deposit',
      5,
      'Regalo admin para AnghelitO091: 2000 Oro, 5 Gemas, Pase VIP y 1 Sobre Épico',
      'completed'
    );

    RAISE NOTICE '✅ Recompensas asignadas con éxito para "%":', v_user.username;
    RAISE NOTICE '   - Oro: +2000 (Nuevo balance: %)', v_user.gold_balance;
    RAISE NOTICE '   - Gemas: +5 (Nuevo balance: %)', v_user.gems_balance;
    RAISE NOTICE '   - Pase VIP: Activado (has_vip_pass = %)', v_user.has_vip_pass;
    RAISE NOTICE '   - Sobre Épico: Añadido al inventario (ID: %)', v_pack_id;
  END IF;
END $$;

COMMIT;
