-- ==============================================================================
-- MIGRACIÓN 66: ASIGNACIÓN DE SQUASH BASE AL USUARIO CAFEE
-- ==============================================================================
-- Asigna la carta Bonkchoy/Aplastador (squash, Poco Común) como planta base (is_base = TRUE)
-- en el inventario/jardín del usuario Cafee (3f77254e-73ab-4243-839c-ff48f7933c77).
-- Si ya la tuviera, incrementa +1 copia en plant_copies.
-- ==============================================================================

BEGIN;

DO $$
DECLARE
  v_user_id UUID;
  v_has_base BOOLEAN;
BEGIN
  -- Obtener el ID de Cafee
  SELECT id INTO v_user_id
  FROM public.profiles
  WHERE LOWER(TRIM(username)) = 'cafee'
     OR id = '3f77254e-73ab-4243-839c-ff48f7933c77'
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Usuario Cafee no encontrado en profiles';
  END IF;

  -- Comprobar si ya tiene la planta base en plant_instances
  SELECT EXISTS (
    SELECT 1 FROM public.plant_instances
    WHERE owner_id = v_user_id AND plant_id = 'squash'
  ) INTO v_has_base;

  IF NOT v_has_base THEN
    INSERT INTO public.plant_instances (
      owner_id, plant_id, rarity, star_level, level, stat_rolls,
      is_base, is_in_deck, deck_slot, is_listed_for_sale
    ) VALUES (
      v_user_id, 'squash', 'uncommon', 1, 0, '{}'::text[],
      TRUE, FALSE, NULL, FALSE
    );
    RAISE NOTICE 'Squash asignado exitosamente como planta base a Cafee (%)', v_user_id;
  ELSE
    INSERT INTO public.plant_copies (user_id, plant_id, copies)
    VALUES (v_user_id, 'squash', 1)
    ON CONFLICT (user_id, plant_id)
    DO UPDATE SET copies = public.plant_copies.copies + 1;
    RAISE NOTICE 'Cafee ya tenía Squash base; se le sumó 1 copia en plant_copies';
  END IF;
END $$;

COMMIT;
