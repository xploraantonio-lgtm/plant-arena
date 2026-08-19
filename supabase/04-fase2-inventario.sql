-- =============================================================================
-- PLANT ARENA · FASE 2a: INVENTARIO Y CARTAS EN EL SERVIDOR
--
-- Idempotente. Escrito contra el estado real de la base.
--
-- QUÉ RESUELVE
--   · Las cartas dejan de nacer en el navegador. La fase 1 revocó el INSERT
--     sobre plant_instances (un jugador podía acuñarse legendarias 5★ con
--     power_mult 99 y venderlas por gemas). Aquí vuelven a poder crearse, pero
--     sólo a través de RPC que cobran y sortean en el servidor.
--   · El sorteo de rareza sale de random() de Postgres, no de Math.random()
--     del cliente, que se podía repetir hasta obtener lo deseado.
--   · plant_instances adopta el modelo del cliente (level + stat_rolls), que es
--     el único de los dos sin pérdida de información: el juego tiene 5 stats
--     mejorables (hp, damage, attackSpeed, moveSpeed, cooldown) y la tabla sólo
--     tenía 4 multiplicadores, con attackSpeed y moveSpeed colisionando en
--     speed_mult.
--
-- MECÁNICAS REPRODUCIDAS TAL CUAL DEL CLIENTE
--   · packDropManager.ts   → tablas de probabilidad por tipo de sobre
--   · freePackManager.ts   → tablas de probabilidad por nivel de arena
--   · useInventory.ts:480  → fusión: 5 copias, +1 nivel, 1 stat elegible al azar
--   · useInventory.ts:431  → 15% de probabilidad de ticket de coliseo por sobre
-- =============================================================================

BEGIN;

-- =============================================================================
-- 1. CATÁLOGO ESTÁTICO DE PLANTAS
--    La rareza y las stats mejorables dependen de la PLANTA, no de la copia.
--    Tenerlas por instancia era parte del agujero: el jugador escribía
--    rarity = 'legendary' en su propia carta.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.plant_catalog (
    plant_id       TEXT PRIMARY KEY,
    name           TEXT NOT NULL,
    rarity         TEXT NOT NULL CHECK (rarity IN ('common','uncommon','rare','epic','legendary')),
    eligible_stats TEXT[] NOT NULL,
    max_level      INTEGER NOT NULL DEFAULT 5 CHECK (max_level BETWEEN 1 AND 10)
);

ALTER TABLE public.plant_catalog ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "catalog_public_read" ON public.plant_catalog;
CREATE POLICY "catalog_public_read" ON public.plant_catalog FOR SELECT USING (TRUE);

-- Extraído de PLANT_CONFIGS + los POOL_* de packDropManager.ts.
-- max_level 3 para las legendarias, 5 para el resto (useInventory.ts:482).
INSERT INTO public.plant_catalog (plant_id, name, rarity, eligible_stats, max_level) VALUES
  ('sunflower',      'Sunflower',       'common',    ARRAY['hp','cooldown'],                                        5),
  ('peashooter',     'Peashooter',      'common',    ARRAY['hp','cooldown','damage','attackSpeed'],                 5),
  ('wallnut',        'Wall-nut',        'common',    ARRAY['hp','cooldown'],                                        5),
  ('chomper',        'Cactus',          'common',    ARRAY['hp','cooldown','damage','attackSpeed','moveSpeed'],     5),
  ('garlic',         'Ajo Desviador',   'uncommon',  ARRAY['hp','cooldown','damage','moveSpeed'],                   5),
  ('bonkchoy',       'Bonk Choy',       'uncommon',  ARRAY['hp','cooldown','damage','attackSpeed','moveSpeed'],     5),
  ('repeater',       'Repeater',        'uncommon',  ARRAY['hp','cooldown','damage','attackSpeed'],                 5),
  ('melonpult',      'Melon-pult',      'uncommon',  ARRAY['hp','cooldown','damage','attackSpeed'],                 5),
  ('squash',         'Squash',          'uncommon',  ARRAY['hp','cooldown','damage'],                               5),
  ('twinsunflower',  'Twin Sunflower',  'rare',      ARRAY['hp','cooldown'],                                        5),
  ('jalapeno',       'Jalapeño',        'rare',      ARRAY['hp','cooldown','damage'],                               5),
  ('aloe',           'Aloe',            'epic',      ARRAY['hp','cooldown','damage','attackSpeed'],                 5),
  ('tallnut',        'Tall-nut',        'epic',      ARRAY['hp','cooldown'],                                        5),
  ('iceberglettuce', 'Iceberg Lettuce', 'legendary', ARRAY['hp','cooldown'],                                        3),
  ('threepeater',    'Threepeater',     'legendary', ARRAY['hp','cooldown','damage','attackSpeed'],                 3)
ON CONFLICT (plant_id) DO UPDATE
  SET name = EXCLUDED.name,
      rarity = EXCLUDED.rarity,
      eligible_stats = EXCLUDED.eligible_stats,
      max_level = EXCLUDED.max_level;


-- =============================================================================
-- 2. plant_instances ADOPTA EL MODELO DEL CLIENTE
-- =============================================================================
ALTER TABLE public.plant_instances
  ADD COLUMN IF NOT EXISTS level      INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stat_rolls TEXT[]  NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS is_base    BOOLEAN NOT NULL DEFAULT FALSE;

-- Los 4 multiplicadores se van: no los lee nadie en el cliente (las stats se
-- calculan de stat_rolls + PLANT_CONFIGS) y no pueden representar el modelo.
-- Dejarlos ahí sería otro campo muerto como los DEFAULT de saldo que ya nos
-- confundieron.
ALTER TABLE public.plant_instances
  DROP COLUMN IF EXISTS power_mult,
  DROP COLUMN IF EXISTS hp_mult,
  DROP COLUMN IF EXISTS speed_mult,
  DROP COLUMN IF EXISTS cooldown_mult;

-- star_level era el equivalente parcial de level. Se conserva sincronizado por
-- si algo lo leía, pero level es el que manda.
UPDATE public.plant_instances SET level = COALESCE(star_level, 1) - 1
 WHERE level = 0 AND star_level IS NOT NULL AND star_level > 1;

-- Sólo valores de stat que existen en el juego.
DO $$
BEGIN
  ALTER TABLE public.plant_instances
    ADD CONSTRAINT plant_instances_stat_rolls_valid
    CHECK (stat_rolls <@ ARRAY['hp','damage','attackSpeed','moveSpeed','cooldown']);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- La rareza sale del catálogo, no del cliente.
UPDATE public.plant_instances pi
   SET rarity = c.rarity
  FROM public.plant_catalog c
 WHERE c.plant_id = pi.plant_id AND pi.rarity <> c.rarity;


-- =============================================================================
-- 3. COPIAS: la moneda de la fusión
--    En el cliente era el mapa plantCopies { plantId: n } en localStorage.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.plant_copies (
    user_id  UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    plant_id TEXT NOT NULL REFERENCES public.plant_catalog(plant_id),
    copies   INTEGER NOT NULL DEFAULT 0 CHECK (copies >= 0),
    PRIMARY KEY (user_id, plant_id)
);

ALTER TABLE public.plant_copies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "copies_select_own" ON public.plant_copies;
CREATE POLICY "copies_select_own" ON public.plant_copies
  FOR SELECT USING (auth.uid() = user_id);
-- Sin políticas de escritura: sólo las RPC (SECURITY DEFINER) la modifican.


-- =============================================================================
-- 4. SOBRES EN POSESIÓN
--    Era el array inventoryPacks en localStorage. Sin esto, un jugador se
--    inventa sobres y los abre.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.player_packs (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    pack_id    TEXT NOT NULL CHECK (pack_id IN ('basic','epic','legendary')),
    source     TEXT NOT NULL DEFAULT 'purchase'
               CHECK (source IN ('purchase','victory','chest','gift','admin')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.player_packs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "packs_select_own" ON public.player_packs;
CREATE POLICY "packs_select_own" ON public.player_packs
  FOR SELECT USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_player_packs_user ON public.player_packs (user_id, created_at);


-- =============================================================================
-- 5. HELPERS DE SORTEO (internos, no invocables desde el cliente)
-- =============================================================================

-- Elige una rareza según pesos. Los pesos vienen de packDropManager.ts y
-- freePackManager.ts sin alterar las probabilidades del juego.
CREATE OR REPLACE FUNCTION public._roll_rarity(
  p_common NUMERIC, p_uncommon NUMERIC, p_rare NUMERIC,
  p_epic NUMERIC, p_legendary NUMERIC
) RETURNS TEXT
LANGUAGE plpgsql
VOLATILE
SET search_path = public, pg_temp
AS $$
DECLARE r NUMERIC := random() * 100; acc NUMERIC := 0;
BEGIN
  acc := acc + p_common;     IF r < acc THEN RETURN 'common';    END IF;
  acc := acc + p_uncommon;   IF r < acc THEN RETURN 'uncommon';  END IF;
  acc := acc + p_rare;       IF r < acc THEN RETURN 'rare';      END IF;
  acc := acc + p_epic;       IF r < acc THEN RETURN 'epic';      END IF;
  RETURN 'legendary';
END;
$$;

-- Planta al azar dentro de una rareza.
CREATE OR REPLACE FUNCTION public._random_plant_of_rarity(p_rarity TEXT)
RETURNS TEXT
LANGUAGE sql
VOLATILE
SET search_path = public, pg_temp
AS $$
  SELECT plant_id FROM public.plant_catalog
   WHERE rarity = p_rarity
   ORDER BY random() LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public._roll_rarity(NUMERIC,NUMERIC,NUMERIC,NUMERIC,NUMERIC)
  FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public._random_plant_of_rarity(TEXT)
  FROM anon, authenticated, PUBLIC;


-- =============================================================================
-- 6. ABRIR UN SOBRE
--    Reproduce openSeedPack(): N cartas según el tipo, +1 copia cada una,
--    y 15% de probabilidad de un ticket de coliseo por sobre.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.open_pack(p_pack_row_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid     UUID := auth.uid();
  v_pack    RECORD;
  v_count   INTEGER;
  v_rarity  TEXT;
  v_plant   TEXT;
  v_was_new BOOLEAN;
  v_drops   JSONB := '[]'::JSONB;
  v_ticket  BOOLEAN := FALSE;
  i         INTEGER;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  -- El sobre tiene que existir y ser suyo. FOR UPDATE evita que dos peticiones
  -- simultáneas abran el mismo sobre dos veces.
  SELECT * INTO v_pack FROM public.player_packs
   WHERE id = p_pack_row_id AND user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sobre no encontrado'; END IF;

  v_count := CASE v_pack.pack_id WHEN 'basic' THEN 3 ELSE 4 END;

  FOR i IN 1..v_count LOOP
    v_rarity := CASE v_pack.pack_id
      WHEN 'basic'     THEN public._roll_rarity(60, 30,  8,  2,  0)
      WHEN 'epic'      THEN public._roll_rarity(20, 45, 25,  8,  2)
      ELSE                  public._roll_rarity( 0, 25, 45, 20, 10)
    END;

    v_plant := public._random_plant_of_rarity(v_rarity);
    IF v_plant IS NULL THEN CONTINUE; END IF;

    -- ¿es nueva para el jugador? Se calcula antes de sumar la copia.
    v_was_new := NOT EXISTS (
      SELECT 1 FROM public.plant_copies
       WHERE user_id = v_uid AND plant_id = v_plant AND copies > 0
    ) AND NOT EXISTS (
      SELECT 1 FROM public.plant_instances
       WHERE owner_id = v_uid AND plant_id = v_plant
    );

    INSERT INTO public.plant_copies (user_id, plant_id, copies)
    VALUES (v_uid, v_plant, 1)
    ON CONFLICT (user_id, plant_id) DO UPDATE
      SET copies = plant_copies.copies + 1;

    v_drops := v_drops || jsonb_build_object(
      'plantId', v_plant,
      'rarity',  v_rarity,
      'isNew',   v_was_new
    );
  END LOOP;

  -- 15% de ticket de coliseo por sobre (useInventory.ts:431)
  IF random() < 0.15 THEN
    UPDATE public.profiles SET colosseum_tickets = colosseum_tickets + 1
     WHERE id = v_uid;
    v_ticket := TRUE;
  END IF;

  DELETE FROM public.player_packs WHERE id = p_pack_row_id;

  RETURN jsonb_build_object(
    'success', TRUE,
    'packId',  v_pack.pack_id,
    'drops',   v_drops,
    'colosseumTicket', v_ticket
  );
END;
$$;


-- =============================================================================
-- 7. RECLAMAR UN COFRE LISTO
--    Reproduce drawFreePackCard(): 1 carta según el nivel de arena. Exige que
--    el temporizador haya vencido de verdad (lo valida sync_pack_slots, y aquí
--    se vuelve a comprobar por si se llama directamente).
-- =============================================================================
CREATE OR REPLACE FUNCTION public.claim_pack_slot(p_slot_index INTEGER)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid    UUID := auth.uid();
  v_slot   RECORD;
  v_rarity TEXT;
  v_plant  TEXT;
  v_new    BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF p_slot_index IS NULL OR p_slot_index < 0 OR p_slot_index > 3 THEN
    RAISE EXCEPTION 'Índice de cofre inválido';
  END IF;

  SELECT * INTO v_slot FROM public.pack_slots
   WHERE user_id = v_uid AND slot_index = p_slot_index FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cofre no encontrado'; END IF;

  IF v_slot.status <> 'ready' THEN
    IF v_slot.status = 'unlocking'
       AND v_slot.unlock_started_at IS NOT NULL
       AND NOW() >= v_slot.unlock_started_at
                    + make_interval(hours => v_slot.duration_hours)
    THEN
      NULL;  -- el tiempo venció, se acepta aunque el estado no se hubiera sincronizado
    ELSE
      RAISE EXCEPTION 'El cofre todavía no está listo';
    END IF;
  END IF;

  -- Probabilidades por arena, de freePackManager.ts
  v_rarity := CASE GREATEST(1, LEAST(5, COALESCE(v_slot.arena_level, 1)))
    WHEN 1 THEN public._roll_rarity(50, 50,  0,  0, 0)
    WHEN 2 THEN public._roll_rarity(40, 45, 15,  0, 0)
    WHEN 3 THEN public._roll_rarity( 0, 50, 50,  0, 0)
    WHEN 4 THEN public._roll_rarity( 0,  0,100,  0, 0)
    ELSE        public._roll_rarity( 0,  0, 95,  5, 0)
  END;

  v_plant := public._random_plant_of_rarity(v_rarity);
  IF v_plant IS NULL THEN RAISE EXCEPTION 'Catálogo vacío para la rareza %', v_rarity; END IF;

  v_new := NOT EXISTS (
    SELECT 1 FROM public.plant_copies
     WHERE user_id = v_uid AND plant_id = v_plant AND copies > 0
  ) AND NOT EXISTS (
    SELECT 1 FROM public.plant_instances
     WHERE owner_id = v_uid AND plant_id = v_plant
  );

  INSERT INTO public.plant_copies (user_id, plant_id, copies)
  VALUES (v_uid, v_plant, 1)
  ON CONFLICT (user_id, plant_id) DO UPDATE
    SET copies = plant_copies.copies + 1;

  -- El cofre queda vacío
  UPDATE public.pack_slots
     SET status = 'empty', unlock_started_at = NULL
   WHERE user_id = v_uid AND slot_index = p_slot_index;

  RETURN jsonb_build_object(
    'success', TRUE,
    'plantId', v_plant,
    'rarity',  v_rarity,
    'isNew',   v_new
  );
END;
$$;


-- =============================================================================
-- 8. FUSIONAR: 5 copias → +1 nivel + 1 stat elegible al azar
--    Reproduce fuseAndUpgradePlant() (useInventory.ts:480).
-- =============================================================================
CREATE OR REPLACE FUNCTION public.fuse_plant(p_instance_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid    UUID := auth.uid();
  v_inst   RECORD;
  v_cat    RECORD;
  v_copies INTEGER;
  v_stat   TEXT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  SELECT * INTO v_inst FROM public.plant_instances
   WHERE id = p_instance_id AND owner_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No eres el propietario de esta carta'; END IF;
  IF v_inst.is_listed_for_sale THEN
    RAISE EXCEPTION 'No puedes fusionar una carta que está en venta';
  END IF;

  SELECT * INTO v_cat FROM public.plant_catalog WHERE plant_id = v_inst.plant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Planta desconocida: %', v_inst.plant_id; END IF;

  IF v_inst.level >= v_cat.max_level THEN
    RAISE EXCEPTION 'Esta carta ya alcanzó el nivel máximo (%)', v_cat.max_level;
  END IF;

  SELECT copies INTO v_copies FROM public.plant_copies
   WHERE user_id = v_uid AND plant_id = v_inst.plant_id FOR UPDATE;
  v_copies := COALESCE(v_copies, 0);

  IF v_copies < 5 THEN
    RAISE EXCEPTION 'Se requieren 5 copias base para la fusión (tienes %/5)', v_copies;
  END IF;

  -- Una stat al azar entre las elegibles de ESTA planta
  v_stat := v_cat.eligible_stats[1 + floor(random() * array_length(v_cat.eligible_stats, 1))::INTEGER];

  UPDATE public.plant_copies SET copies = copies - 5
   WHERE user_id = v_uid AND plant_id = v_inst.plant_id;

  UPDATE public.plant_instances
     SET level      = level + 1,
         star_level = LEAST(5, level + 2),   -- espejo del antiguo star_level
         stat_rolls = array_append(stat_rolls, v_stat)
   WHERE id = p_instance_id;

  RETURN jsonb_build_object(
    'success',    TRUE,
    'newLevel',   v_inst.level + 1,
    'rolledStat', v_stat,
    'copiesLeft', v_copies - 5
  );
END;
$$;


-- =============================================================================
-- 9. LEER MI INVENTARIO
--    Una sola llamada en lugar de reconstruirlo desde localStorage.
--    unlockedPlants es derivado: tener una copia o una instancia.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.my_inventory()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  RETURN jsonb_build_object(
    'instances', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'instanceId', id,
               'plantId',    plant_id,
               'level',      level,
               'statRolls',  stat_rolls,
               'isBase',     is_base,
               'isInDeck',   is_in_deck,
               'deckSlot',   deck_slot,
               'isListed',   is_listed_for_sale,
               'obtainedAt', (EXTRACT(EPOCH FROM created_at) * 1000)::BIGINT
             ) ORDER BY created_at)
        FROM public.plant_instances WHERE owner_id = v_uid
    ), '[]'::JSONB),

    'copies', COALESCE((
      SELECT jsonb_object_agg(plant_id, copies)
        FROM public.plant_copies WHERE user_id = v_uid AND copies > 0
    ), '{}'::JSONB),

    'unlocked', COALESCE((
      SELECT jsonb_agg(DISTINCT p) FROM (
        SELECT plant_id AS p FROM public.plant_copies
         WHERE user_id = v_uid AND copies > 0
        UNION
        SELECT plant_id AS p FROM public.plant_instances WHERE owner_id = v_uid
      ) z
    ), '[]'::JSONB),

    'packs', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'rowId',  id,
               'packId', pack_id,
               'source', source,
               'obtainedAt', (EXTRACT(EPOCH FROM created_at) * 1000)::BIGINT
             ) ORDER BY created_at)
        FROM public.player_packs WHERE user_id = v_uid
    ), '[]'::JSONB)
  );
END;
$$;


-- =============================================================================
-- 10. PERMISOS DE EJECUCIÓN
-- =============================================================================
DO $$
DECLARE f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prokind = 'f'
       AND p.proname IN ('open_pack','claim_pack_slot','fuse_plant','my_inventory')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon, PUBLIC', f.sig);
    EXECUTE format('GRANT  EXECUTE ON FUNCTION %s TO authenticated',  f.sig);
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS idx_plant_copies_user ON public.plant_copies (user_id);

INSERT INTO public._migration_audit (fase, detalle)
VALUES ('fase2a_inventario', jsonb_build_object(
  'catalogo', (SELECT count(*) FROM public.plant_catalog),
  'instancias', (SELECT count(*) FROM public.plant_instances)
));

COMMIT;


-- =============================================================================
-- COMPROBACIONES
-- =============================================================================

-- 1. Catálogo completo. Espera 15.
SELECT count(*) AS plantas_en_catalogo FROM public.plant_catalog;

-- 2. Reparto por rareza. Espera common 4, uncommon 5, rare 2, epic 2, legendary 2.
SELECT rarity, count(*) FROM public.plant_catalog GROUP BY rarity ORDER BY rarity;

-- 3. plant_instances con el modelo nuevo y sin los multiplicadores.
SELECT column_name, data_type
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'plant_instances'
 ORDER BY ordinal_position;

-- 4. Ninguna SECURITY DEFINER sin auth.uid() ni ejecutable por anon.
--    Espera 0 filas (los helpers _roll_rarity/_random_plant no son definer).
SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.prosecdef
   AND p.proname NOT IN ('handle_new_user','current_user_is_admin')
   AND (has_function_privilege('anon', p.oid, 'EXECUTE')
        OR pg_get_functiondef(p.oid) NOT ILIKE '%auth.uid()%');

-- 5. Prueba del sorteo: 1000 tiradas de sobre básico deben acercarse a
--    60/30/8/2/0. Es sólo lectura, no concede nada.
SELECT rarity, count(*) AS veces, round(count(*) / 10.0, 1) AS pct
  FROM (SELECT public._roll_rarity(60,30,8,2,0) AS rarity
          FROM generate_series(1,1000)) z
 GROUP BY rarity ORDER BY veces DESC;
