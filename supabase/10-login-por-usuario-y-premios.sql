-- =============================================================================
-- PLANT ARENA · LOGIN POR USUARIO, RUEDA (SIGUE INTENTANDO) Y PASE DE BATALLA
-- Idempotente.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. BUSCADOR DE EMAIL POR NOMBRE DE USUARIO PARA LOGIN
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_email_by_username(p_username TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_email TEXT;
BEGIN
  IF p_username IS NULL OR trim(p_username) = '' THEN
    RETURN NULL;
  END IF;

  SELECT au.email INTO v_email
    FROM auth.users au
    JOIN public.profiles p ON p.id = au.id
   WHERE p.username ILIKE trim(p_username)
   LIMIT 1;

  RETURN v_email;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_email_by_username(TEXT) TO anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. SOPORTAR SECTOR "SIGUE INTENTANDO" (SIN PREMIO) EN LA RULETA
-- -----------------------------------------------------------------------------
-- Permitir 'none' en reward_type si no estaba permitido
ALTER TABLE public.lottery_sectors DROP CONSTRAINT IF EXISTS lottery_sectors_reward_type_check;
ALTER TABLE public.lottery_sectors ADD CONSTRAINT lottery_sectors_reward_type_check
  CHECK (reward_type IN ('gems','gold','pack','plant','none'));

-- Insertar o asegurar el sector "try_again" (Sigue Intentando)
INSERT INTO public.lottery_sectors (sector_id, label, reward_type, weight, is_active)
VALUES ('try_again', 'Sigue Intentando 💨', 'none', 5.0, FALSE)
ON CONFLICT (sector_id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 3. PERMITIR ACTUALIZAR PASE DE BATALLA
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_save_battle_pass_level(
  p_level INTEGER,
  p_required_elo INTEGER,
  p_arena_name TEXT,
  p_reward_type TEXT,
  p_pack_id TEXT DEFAULT NULL,
  p_pack_count INTEGER DEFAULT NULL,
  p_plant_id TEXT DEFAULT NULL,
  p_copies_count INTEGER DEFAULT NULL,
  p_label TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF NOT public.current_user_is_admin() THEN
    RAISE EXCEPTION 'Sólo un administrador puede editar niveles del pase';
  END IF;

  UPDATE public.battle_pass_levels
     SET required_elo = p_required_elo,
         arena_name   = p_arena_name,
         reward_type  = p_reward_type,
         pack_id      = p_pack_id,
         pack_count   = p_pack_count,
         plant_id     = p_plant_id,
         copies_count = p_copies_count,
         label        = COALESCE(p_label, label)
   WHERE level = p_level;

  IF NOT FOUND THEN
    INSERT INTO public.battle_pass_levels (
      level, required_elo, arena_name, reward_type, pack_id, pack_count, plant_id, copies_count, label
    ) VALUES (
      p_level, p_required_elo, p_arena_name, p_reward_type, p_pack_id, p_pack_count, p_plant_id, p_copies_count, p_label
    );
  END IF;

  RETURN jsonb_build_object('success', TRUE, 'level', p_level);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_save_battle_pass_level(INTEGER,INTEGER,TEXT,TEXT,TEXT,INTEGER,TEXT,INTEGER,TEXT) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_save_battle_pass_level(INTEGER,INTEGER,TEXT,TEXT,TEXT,INTEGER,TEXT,INTEGER,TEXT) TO authenticated;

INSERT INTO public._migration_audit (fase, detalle)
VALUES ('login_usuario_y_premios', jsonb_build_object('ok', true));

COMMIT;
