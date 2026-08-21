BEGIN;

-- ============================================================
-- 1. PERMITIR TODAS LAS RAREZAS REALES DEL JUEGO
-- ============================================================

ALTER TABLE public.plant_instances
DROP CONSTRAINT IF EXISTS plant_instances_rarity_check;

ALTER TABLE public.plant_instances
ADD CONSTRAINT plant_instances_rarity_check
CHECK (
  rarity IN (
    'common',
    'uncommon',
    'rare',
    'epic',
    'legendary'
  )
);

-- ============================================================
-- 2. REPARAR USUARIOS EXISTENTES
--
-- Si un usuario desbloqueó Jalapeño, Twin Sunflower, etc.
-- mediante plant_copies pero nunca recibió plant_instance,
-- crear su instancia base real.
-- ============================================================

INSERT INTO public.plant_instances (
  owner_id,
  plant_id,
  rarity,
  star_level,
  level,
  stat_rolls,
  is_base,
  is_in_deck,
  deck_slot,
  is_listed_for_sale
)
SELECT
  pc.user_id,
  pc.plant_id,
  c.rarity,
  1,
  0,
  '{}'::TEXT[],
  TRUE,
  FALSE,
  NULL,
  FALSE
FROM public.plant_copies pc
JOIN public.plant_catalog c
  ON c.plant_id = pc.plant_id
WHERE pc.copies > 0
  AND NOT EXISTS (
    SELECT 1
    FROM public.plant_instances pi
    WHERE pi.owner_id = pc.user_id
      AND pi.plant_id = pc.plant_id
  );

-- ============================================================
-- 3. FUTUROS DESBLOQUEOS
--
-- Cada vez que plant_copies pasa a > 0, garantizamos que haya
-- una plant_instance real.
-- ============================================================

CREATE OR REPLACE FUNCTION public.ensure_unlocked_plant_instance()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rarity TEXT;
BEGIN
  IF NEW.copies IS NULL OR NEW.copies <= 0 THEN
    RETURN NEW;
  END IF;

  -- Serializa creación para este usuario.
  PERFORM 1
  FROM public.profiles
  WHERE id = NEW.user_id
  FOR UPDATE;

  -- Ya tiene alguna instancia real de esta planta.
  IF EXISTS (
    SELECT 1
    FROM public.plant_instances
    WHERE owner_id = NEW.user_id
      AND plant_id = NEW.plant_id
  ) THEN
    RETURN NEW;
  END IF;

  SELECT rarity
  INTO v_rarity
  FROM public.plant_catalog
  WHERE plant_id = NEW.plant_id;

  IF v_rarity IS NULL THEN
    RAISE EXCEPTION 'Planta desconocida: %', NEW.plant_id;
  END IF;

  INSERT INTO public.plant_instances (
    owner_id,
    plant_id,
    rarity,
    star_level,
    level,
    stat_rolls,
    is_base,
    is_in_deck,
    deck_slot,
    is_listed_for_sale
  )
  VALUES (
    NEW.user_id,
    NEW.plant_id,
    v_rarity,
    1,
    0,
    '{}'::TEXT[],
    TRUE,
    FALSE,
    NULL,
    FALSE
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ensure_unlocked_plant_instance
ON public.plant_copies;

CREATE TRIGGER trg_ensure_unlocked_plant_instance
AFTER INSERT OR UPDATE OF copies
ON public.plant_copies
FOR EACH ROW
WHEN (NEW.copies > 0)
EXECUTE FUNCTION public.ensure_unlocked_plant_instance();

REVOKE EXECUTE
ON FUNCTION public.ensure_unlocked_plant_instance()
FROM PUBLIC, anon, authenticated;

-- ============================================================
-- 4. GUARDAR MAZO ACTIVO AUTORITATIVO
-- ============================================================

CREATE OR REPLACE FUNCTION public.save_active_deck(
  p_instance_ids UUID[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_count INTEGER;
  v_distinct INTEGER;
  v_invalid INTEGER;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  v_count := COALESCE(array_length(p_instance_ids, 1), 0);

  IF v_count < 3 OR v_count > 6 THEN
    RAISE EXCEPTION 'El mazo debe tener entre 3 y 6 cartas';
  END IF;

  SELECT COUNT(DISTINCT x)
  INTO v_distinct
  FROM unnest(p_instance_ids) AS t(x);

  IF v_distinct <> v_count THEN
    RAISE EXCEPTION 'No puedes usar la misma instancia dos veces';
  END IF;

  -- Evitar dos cambios simultáneos de mazo.
  PERFORM 1
  FROM public.profiles
  WHERE id = v_uid
  FOR UPDATE;

  SELECT COUNT(*)
  INTO v_invalid
  FROM unnest(p_instance_ids)
       WITH ORDINALITY AS x(instance_id, ord)
  LEFT JOIN public.plant_instances pi
    ON pi.id = x.instance_id
   AND pi.owner_id = v_uid
   AND COALESCE(pi.is_listed_for_sale, FALSE) = FALSE
  WHERE pi.id IS NULL;

  IF v_invalid > 0 THEN
    RAISE EXCEPTION
      'El mazo contiene cartas inválidas, ajenas o en venta';
  END IF;

  -- Liberar mazo anterior.
  UPDATE public.plant_instances
  SET
    is_in_deck = FALSE,
    deck_slot = NULL
  WHERE owner_id = v_uid
    AND is_in_deck = TRUE;

  -- Guardar el nuevo mazo exacto.
  UPDATE public.plant_instances pi
  SET
    is_in_deck = TRUE,
    deck_slot = (x.ord - 1)::INTEGER
  FROM unnest(p_instance_ids)
       WITH ORDINALITY AS x(instance_id, ord)
  WHERE pi.id = x.instance_id
    AND pi.owner_id = v_uid;

  RETURN jsonb_build_object(
    'success', TRUE,
    'cards', v_count
  );
END;
$$;

REVOKE EXECUTE
ON FUNCTION public.save_active_deck(UUID[])
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.save_active_deck(UUID[])
TO authenticated;

COMMIT;

-- ============================================================
-- COMPROBACIONES
-- ============================================================

SELECT
  has_function_privilege(
    'authenticated',
    'public.save_active_deck(uuid[])',
    'EXECUTE'
  ) AS authenticated_puede;

-- Debe devolver 0:
SELECT
  pc.user_id,
  pc.plant_id
FROM public.plant_copies pc
WHERE pc.copies > 0
AND NOT EXISTS (
  SELECT 1
  FROM public.plant_instances pi
  WHERE pi.owner_id = pc.user_id
    AND pi.plant_id = pc.plant_id
);