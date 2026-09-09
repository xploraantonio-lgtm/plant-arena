-- ==============================================================================
-- MIGRACIÓN 65: ASIGNACIÓN DE REPEATER BASE A DRAGONGM
-- ==============================================================================
-- Asigna la carta Repetidora (repeater, Poco Común) como planta base (is_base = TRUE)
-- en el inventario/jardín del usuario Dragongm (ad6fa0b5-7e77-4709-9827-389f5952b145).
-- Si ya la tuviera, incrementa +1 copia en plant_copies.
-- ==============================================================================

BEGIN;

DO $$
DECLARE
  v_user_id UUID;
  v_has_base BOOLEAN;
BEGIN
  -- Obtener el ID de Dragongm
  SELECT id INTO v_user_id
  FROM public.profiles
  WHERE LOWER(TRIM(username)) = 'dragongm'
     OR id = 'ad6fa0b5-7e77-4709-9827-389f5952b145'
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Usuario Dragongm no encontrado en profiles';
  END IF;

  -- Comprobar si ya tiene la planta base en plant_instances
  SELECT EXISTS (
    SELECT 1 FROM public.plant_instances
    WHERE owner_id = v_user_id AND plant_id = 'repeater'
  ) INTO v_has_base;

  IF NOT v_has_base THEN
    INSERT INTO public.plant_instances (
      owner_id, plant_id, rarity, star_level, level, stat_rolls,
      is_base, is_in_deck, deck_slot, is_listed_for_sale
    ) VALUES (
      v_user_id, 'repeater', 'uncommon', 1, 0, '{}'::text[],
      TRUE, FALSE, NULL, FALSE
    );
    RAISE NOTICE 'Repeater asignado exitosamente como planta base a Dragongm (%)', v_user_id;
  ELSE
    INSERT INTO public.plant_copies (user_id, plant_id, copies)
    VALUES (v_user_id, 'repeater', 1)
    ON CONFLICT (user_id, plant_id)
    DO UPDATE SET copies = public.plant_copies.copies + 1;
    RAISE NOTICE 'Dragongm ya tenía Repeater base; se le sumó 1 copia en plant_copies';
  END IF;
END $$;

COMMIT;
