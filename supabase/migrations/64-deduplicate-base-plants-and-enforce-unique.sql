-- ==============================================================================
-- MIGRACIÓN 64: DEDUPLICACIÓN DE PLANTAS BASE Y RESTRICCIÓN DE UNICIDAD
-- ==============================================================================
-- 1. Deduplica retroactivamente todas las instancias con is_base = TRUE.
--    Para cada usuario y planta, conserva la instancia más antigua (rn = 1).
--    Para las instancias duplicadas (rn > 1):
--      - Cancela cualquier listado en marketplace_listings si existiera.
--      - Suma +1 copia en public.plant_copies (user_id, plant_id).
--      - Elimina la fila duplicada de public.plant_instances.
-- 2. Asegura que la columna is_base tenga DEFAULT true en plant_instances.
-- 3. Crea el índice único parcial definitivo uq_plant_instances_owner_base_plant.
-- ==============================================================================

BEGIN;

DO $$
DECLARE
  r RECORD;
  v_merged_count INTEGER := 0;
BEGIN
  FOR r IN
    WITH ranked AS (
      SELECT
        id,
        owner_id,
        plant_id,
        is_base,
        level,
        is_in_deck,
        deck_slot,
        created_at,
        ROW_NUMBER() OVER (
          PARTITION BY owner_id, plant_id
          ORDER BY created_at ASC, id ASC
        ) AS rn
      FROM public.plant_instances
      WHERE is_base = TRUE
    )
    SELECT * FROM ranked WHERE rn > 1
  LOOP
    -- Eliminar listing preventivamente si existiera
    DELETE FROM public.marketplace_listings WHERE plant_instance_id = r.id;

    -- Acreditar la copia al jugador
    INSERT INTO public.plant_copies (user_id, plant_id, copies)
    VALUES (r.owner_id, r.plant_id, 1)
    ON CONFLICT (user_id, plant_id)
    DO UPDATE SET copies = public.plant_copies.copies + 1;

    -- Eliminar la instancia duplicada
    DELETE FROM public.plant_instances WHERE id = r.id;

    v_merged_count := v_merged_count + 1;
    RAISE NOTICE 'Consolidada instancia % de planta % para usuario %', r.id, r.plant_id, r.owner_id;
  END LOOP;

  RAISE NOTICE 'Total de instancias base duplicadas consolidadas a plant_copies: %', v_merged_count;
END $$;

-- Asegurar default TRUE en columna is_base
ALTER TABLE public.plant_instances ALTER COLUMN is_base SET DEFAULT TRUE;

-- Crear el índice único parcial definitivo
CREATE UNIQUE INDEX IF NOT EXISTS uq_plant_instances_owner_base_plant
ON public.plant_instances (owner_id, plant_id)
WHERE is_base = TRUE;

COMMIT;
