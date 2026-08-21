BEGIN;

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

  -- Serializa cambios de mazo del mismo usuario.
  PERFORM 1
  FROM public.profiles
  WHERE id = v_uid
  FOR UPDATE;

  -- Todas las cartas deben ser realmente del usuario y no estar en venta.
  SELECT COUNT(*)
  INTO v_invalid
  FROM unnest(p_instance_ids) WITH ORDINALITY AS x(instance_id, ord)
  LEFT JOIN public.plant_instances pi
    ON pi.id = x.instance_id
   AND pi.owner_id = v_uid
   AND COALESCE(pi.is_listed_for_sale, FALSE) = FALSE
  WHERE pi.id IS NULL;

  IF v_invalid > 0 THEN
    RAISE EXCEPTION 'El mazo contiene cartas inválidas, ajenas o en venta';
  END IF;

  -- Primero libera todos los slots para no chocar con el índice único.
  UPDATE public.plant_instances
  SET
    is_in_deck = FALSE,
    deck_slot = NULL
  WHERE owner_id = v_uid
    AND is_in_deck = TRUE;

  -- Guarda el mazo EXACTO y su orden.
  UPDATE public.plant_instances pi
  SET
    is_in_deck = TRUE,
    deck_slot = (x.ord - 1)::INTEGER
  FROM unnest(p_instance_ids) WITH ORDINALITY AS x(instance_id, ord)
  WHERE pi.id = x.instance_id
    AND pi.owner_id = v_uid;

  RETURN jsonb_build_object(
    'success', TRUE,
    'cards', v_count
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.save_active_deck(UUID[])
FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.save_active_deck(UUID[])
TO authenticated;

COMMIT;

SELECT
  has_function_privilege(
    'authenticated',
    'public.save_active_deck(uuid[])',
    'EXECUTE'
  ) AS authenticated_puede;