-- =============================================================================
-- PLANT ARENA · EL COFRE DA ORO ADEMÁS DE LA CARTA
--
-- Idempotente. Ejecutar después de la 04.
--
-- DECISIÓN DE ECONOMÍA
--   El oro entra en el juego por UN SOLO SITIO: el cofre. No hay oro por
--   victoria. El cofre ya entregaba una carta (sorteada según el nivel de
--   arena); el oro es un extra encima, y escala con la duración del cofre: el de
--   2 h da menos, el de 12 h da más.
--
-- POR QUÉ ESTA ES LA ÚNICA FUENTE SEGURA HOY
--   Un oro por victoria tendría que concederlo el servidor, y la partida todavía
--   se resuelve en el navegador. Una RPC del tipo "he ganado, dame oro" sería un
--   grifo sin tope. El cofre, en cambio, hereda tres límites que ya existen:
--     · sólo 4 huecos
--     · cada cofre tarda de 2 a 12 h en abrirse
--     · award_victory_chest tiene enfriamiento de 2 minutos
--   Con eso, el ritmo máximo de oro es de unos 20 por hora esperando, que es
--   justo lo que se busca: un extra, no una alternativa a comprar oro.
--
-- LA RESTRICCIÓN QUE FIJA LOS NÚMEROS
--   Abrir un cofre al instante cuesta 75 de oro por hora restante:
--     2 h → 150   4 h → 300   8 h → 600   12 h → 900
--   El oro que da el cofre debe quedar MUY por debajo, o abrirlo al instante
--   sería dinero gratis. Con 10/20/40/60 el saldo siempre es negativo, así que
--   la apertura instantánea sigue siendo un sumidero.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. TABLA DE RECOMPENSA POR DURACIÓN
--    En tabla y no en el código de la función para que puedas reequilibrar sin
--    volver a tocar SQL, igual que los precios de la tienda.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.chest_rewards (
    duration_hours INTEGER PRIMARY KEY CHECK (duration_hours > 0),
    gold_reward    BIGINT NOT NULL CHECK (gold_reward >= 0)
);

ALTER TABLE public.chest_rewards ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "chest_rewards_read" ON public.chest_rewards;
CREATE POLICY "chest_rewards_read" ON public.chest_rewards FOR SELECT USING (TRUE);

-- Escritura sólo para administradores, como el resto del contenido.
DROP POLICY IF EXISTS "chest_rewards_admin_write" ON public.chest_rewards;
CREATE POLICY "chest_rewards_admin_write" ON public.chest_rewards FOR ALL
  USING (public.current_user_is_admin())
  WITH CHECK (public.current_user_is_admin());
GRANT INSERT, UPDATE, DELETE ON public.chest_rewards TO authenticated;

INSERT INTO public.chest_rewards (duration_hours, gold_reward) VALUES
  ( 2, 10),
  ( 4, 20),
  ( 8, 40),
  (12, 60)
ON CONFLICT (duration_hours) DO UPDATE
  SET gold_reward = EXCLUDED.gold_reward;

-- Guardia: si algún día el oro de un cofre supera lo que cuesta abrirlo al
-- instante, abrirlo sería dinero gratis. Se comprueba al final de la sentencia
-- para poder reequilibrar varias filas de una vez.
CREATE OR REPLACE FUNCTION public._check_chest_rewards()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE v_mal RECORD;
BEGIN
  SELECT duration_hours, gold_reward,
         GREATEST(10, CEIL(duration_hours * 75))::BIGINT AS coste_instantaneo
    INTO v_mal
    FROM public.chest_rewards
   WHERE gold_reward >= GREATEST(10, CEIL(duration_hours * 75))
   LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION
      'El cofre de % h daría % de oro y abrirlo al instante cuesta %. Abrirlo sería dinero gratis. No se guardó nada.',
      v_mal.duration_hours, v_mal.gold_reward, v_mal.coste_instantaneo;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_chest_rewards ON public.chest_rewards;
CREATE CONSTRAINT TRIGGER trg_chest_rewards
  AFTER INSERT OR UPDATE ON public.chest_rewards
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public._check_chest_rewards();

REVOKE EXECUTE ON FUNCTION public._check_chest_rewards() FROM anon, authenticated, PUBLIC;


-- -----------------------------------------------------------------------------
-- 2. claim_pack_slot AHORA ENTREGA CARTA + ORO
--    El resto de la función se mantiene igual: mismas probabilidades por arena,
--    misma revalidación del temporizador, mismo vaciado del hueco.
-- -----------------------------------------------------------------------------
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
  v_gold   BIGINT;
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

  -- NUEVO: el oro. Según la duración del cofre, desde la tabla.
  SELECT gold_reward INTO v_gold
    FROM public.chest_rewards
   WHERE duration_hours = v_slot.duration_hours;
  v_gold := COALESCE(v_gold, 0);

  IF v_gold > 0 THEN
    UPDATE public.profiles
       SET gold_balance = gold_balance + v_gold
     WHERE id = v_uid;
  END IF;

  -- El cofre queda vacío
  UPDATE public.pack_slots
     SET status = 'empty', unlock_started_at = NULL
   WHERE user_id = v_uid AND slot_index = p_slot_index;

  RETURN jsonb_build_object(
    'success',  TRUE,
    'plantId',  v_plant,
    'rarity',   v_rarity,
    'isNew',    v_new,
    'gold',     v_gold
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_pack_slot(INTEGER) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.claim_pack_slot(INTEGER) TO authenticated;

INSERT INTO public._migration_audit (fase, detalle)
VALUES ('oro_en_cofres', jsonb_build_object(
  'tramos', (SELECT count(*) FROM public.chest_rewards)
));

COMMIT;


-- =============================================================================
-- COMPROBACIONES
-- =============================================================================

-- 1. Los cuatro tramos, con el margen frente a la apertura instantánea.
--    'neto' debe ser negativo siempre: abrir al instante nunca puede ser
--    rentable.
SELECT duration_hours                                    AS horas,
       gold_reward                                       AS da_oro,
       GREATEST(10, CEIL(duration_hours * 75))::BIGINT    AS abrir_al_instante,
       gold_reward - GREATEST(10, CEIL(duration_hours * 75))::BIGINT AS neto
  FROM public.chest_rewards
 ORDER BY duration_hours;

-- 2. El guardia funciona. Esto DEBE fallar:
--    (descoméntalo para probarlo)
-- BEGIN;
--   UPDATE public.chest_rewards SET gold_reward = 999 WHERE duration_hours = 2;
-- COMMIT;   -- ← salta el error y no se guarda nada

-- 3. Ritmo máximo de oro, esperando sin pagar. Con 4 huecos y una media de
--    6,5 h por cofre son unos 20 de oro por hora. Comprar oro sale a 140 por
--    gema, así que una hora de espera vale 0,14 gemas: un extra, no una
--    alternativa a comprar.
SELECT round(SUM(gold_reward)::NUMERIC / 4, 1) AS oro_medio_por_cofre,
       SUM(gold_reward)                        AS oro_si_se_abren_los_4
  FROM public.chest_rewards;
