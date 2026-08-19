-- =============================================================================
-- PLANT ARENA · CORRECCIONES DE PRUEBAS
--
-- Idempotente.
--
-- 1. Precio del sobre épico: 5 gemas, no 8.
-- 2. RPC para saber si la cuenta ya tiene contraseña, y dejar de preguntarlo
--    al navegador.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. SOBRE ÉPICO: 5 GEMAS
--
-- La tienda mostraba "5 💎 Gemas" escrito a mano en Shop.tsx, pero
-- PACK_DEFINITIONS.epic.priceUsd valía 8. Los dos números convivían porque la
-- compra nunca cobraba nada: el desajuste sólo salió a la luz al mover el cobro
-- al servidor. Manda el precio que ve el jugador.
--
-- (basic 3 y legendary 10 sí coincidían en ambos sitios.)
-- -----------------------------------------------------------------------------
UPDATE public.shop_packs SET price_gems = 5 WHERE pack_id = 'epic';


-- -----------------------------------------------------------------------------
-- 2. ¿TIENE CONTRASEÑA ESTA CUENTA?
--
-- El modal "REGISTRA TU NICK Y CONTRASEÑA" se decidía con una marca en
-- localStorage ('plant_arena_pwd_set_<id>'), así que reaparecía al cambiar de
-- navegador o al limpiar el almacenamiento, aunque la contraseña estuviera
-- puesta. La pregunta real vive en auth.users, no en el navegador.
--
-- Devuelve también el username para que el cliente no tenga que adivinar si el
-- nick ya está elegido.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.my_auth_status()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid      UUID := auth.uid();
  v_pwd      TEXT;
  v_username TEXT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  SELECT encrypted_password INTO v_pwd FROM auth.users WHERE id = v_uid;
  SELECT username           INTO v_username FROM public.profiles WHERE id = v_uid;

  RETURN jsonb_build_object(
    -- Un usuario que entró sólo con Google no tiene contraseña: la columna
    -- queda nula o vacía. Se comprueba la realidad, no una marca que
    -- mantengamos nosotros.
    'hasPassword', (v_pwd IS NOT NULL AND length(btrim(v_pwd)) > 0),
    'username',    v_username
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.my_auth_status() FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.my_auth_status() TO authenticated;

INSERT INTO public._migration_audit (fase, detalle)
VALUES ('correcciones_pruebas', jsonb_build_object(
  'precio_epico', (SELECT price_gems FROM public.shop_packs WHERE pack_id = 'epic')
));

COMMIT;


-- =============================================================================
-- COMPROBACIONES
-- =============================================================================

-- 1. Precios finales. Espera basic 3, epic 5, legendary 10.
SELECT pack_id, name, price_gems, card_count
  FROM public.shop_packs ORDER BY price_gems;

-- 2. Tu estado de autenticación. Ejecutado desde el editor SQL saldrá el error
--    'No autenticado', que es lo correcto: no hay auth.uid() ahí. Pruébalo
--    desde la app.
SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args,
       has_function_privilege('anon', p.oid, 'EXECUTE')          AS anon_ejecuta,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_ejecuta
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'my_auth_status';
