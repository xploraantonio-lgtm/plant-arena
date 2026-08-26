-- =============================================================================
-- PLANT ARENA · MIGRACIÓN 47
-- ACTUALIZACIÓN DE RECOMPENSAS DEL PASE VIP (BATTLE_PASS_LEVELS)
-- =============================================================================
--
-- PROPÓSITO:
-- 1. Actualizar las recompensas del Pase VIP en la tabla public.battle_pass_levels
--    para los 20 niveles canónicos:
--      - Reducción de copias de plantas a 1x (niveles 2, 3, 6, 7, 8, 11, 12).
--      - Sustitución de Sobres Legendarios VIP por Sobres Básicos (niveles 9, 10, 13 -> 1x; 15, 16, 17, 19 -> 2x).
--      - Normalización de etiquetas en plantas legendarias (niveles 14 y 18).
-- 2. Garantizar que el sistema de reclamos sea 100% autoritativo en servidor
--    a través de claim_battle_pass_level() y claim_all_battle_pass_levels().
-- 3. Preservar intactas todas las recompensas históricas y reclamos previos
--    registrados en public.profiles.claimed_vip_levels.
-- 4. Registrar la ejecución en public._migration_audit.
--
-- INVARIANTES:
-- - 0 cambios en ELO, matchmaking, Strategic AI o settlement.
-- - 0 alteraciones en el historial de reclamos ya otorgados a usuarios.
-- =============================================================================

BEGIN;

-- ── 1. ACTUALIZAR RECOMPENSAS EN PUBLIC.BATTLE_PASS_LEVELS ───────────────────
INSERT INTO public.battle_pass_levels
  (level, required_elo, arena_name, reward_type, pack_id, pack_count, plant_id, copies_count, label)
VALUES
  ( 1, 1150, 'Jardín Clásico',            'pack',   'basic', 1, NULL,             NULL, 'Sobre Gratis de Batalla'),
  ( 2, 1300, 'Jardín Clásico',            'copies', NULL,    NULL, 'sunflower',      1,    'x1 Girasol'),
  ( 3, 1450, 'Jardín Clásico',            'copies', NULL,    NULL, 'bonkchoy',       1,    'x1 Bonk Choy'),
  ( 4, 1600, 'Jardín Clásico (Límite)',   'copies', NULL,    NULL, 'twinsunflower',  2,    'x2 Girasol Doble'),
  ( 5, 1750, 'Desierto Nocturno',         'copies', NULL,    NULL, 'jalapeno',       1,    'x1 Jalapeño Garantizado'),
  ( 6, 1900, 'Desierto Nocturno',         'copies', NULL,    NULL, 'repeater',       1,    'x1 Repetidora'),
  ( 7, 2050, 'Rascacielos Cyberpunk',     'copies', NULL,    NULL, 'aloe',           1,    'x1 Aloe Vera'),
  ( 8, 2200, 'Rascacielos Cyberpunk',     'copies', NULL,    NULL, 'tallnut',        1,    'x1 Nuez Alta'),
  ( 9, 2350, 'Rascacielos Cyberpunk',     'pack',   'basic', 1, NULL,             NULL, '1x Sobre Básico'),
  (10, 2500, 'Rascacielos Cyberpunk',     'pack',   'basic', 1, NULL,             NULL, '1x Sobre Básico'),
  (11, 2650, 'Rascacielos Cyberpunk',     'copies', NULL,    NULL, 'aloe',           1,    'x1 Aloe Vera'),
  (12, 2800, 'Rascacielos Cyberpunk',     'copies', NULL,    NULL, 'tallnut',        1,    'x1 Nuez Alta'),
  (13, 2950, 'Rascacielos Cyberpunk',     'pack',   'basic', 1, NULL,             NULL, '1x Sobre Básico'),
  (14, 3100, 'Coliseo Galáctico',         'copies', NULL,    NULL, 'iceberglettuce', 1,    'x1 Lechuga Helada'),
  (15, 3250, 'Coliseo Galáctico',         'pack',   'basic', 2, NULL,             NULL, '2x Sobre Básico'),
  (16, 3400, 'Coliseo Galáctico',         'pack',   'basic', 2, NULL,             NULL, '2x Sobre Básico'),
  (17, 3550, 'Coliseo Galáctico',         'pack',   'basic', 2, NULL,             NULL, '2x Sobre Básico'),
  (18, 3700, 'Coliseo Galáctico',         'copies', NULL,    NULL, 'threepeater',    1,    'x1 Threepeater'),
  (19, 3850, 'Olimpo de Leyendas',        'pack',   'basic', 2, NULL,             NULL, '2x Sobres Básicos'),
  (20, 4000, 'Olimpo de Leyendas (MÁX)',  'badge',  NULL,    NULL, NULL,             NULL, '👑 Corona Dorada Leyenda ELO + Skin VIP')
ON CONFLICT (level) DO UPDATE
  SET required_elo = EXCLUDED.required_elo,
      arena_name   = EXCLUDED.arena_name,
      reward_type  = EXCLUDED.reward_type,
      pack_id      = EXCLUDED.pack_id,
      pack_count   = EXCLUDED.pack_count,
      plant_id     = EXCLUDED.plant_id,
      copies_count = EXCLUDED.copies_count,
      label        = EXCLUDED.label;

-- ── 2. REGISTRO EN EL LEDGER DE AUDITORÍA ────────────────────────────────────
INSERT INTO public._migration_audit (
  fase,
  detalle,
  ejecutado_en
) VALUES (
  '47_update_vip_pass_rewards',
  jsonb_build_object(
    'descripcion', 'Actualización recompensas Pase VIP',
    'niveles_actualizados', 20,
    'cambios_copias', 'Niveles 2, 3, 6, 7, 8, 11, 12 rebalanceados a 1 copia',
    'cambios_sobres', 'Niveles 9, 10, 13 (1x Básico), 15, 16, 17, 19 (2x Básico)',
    'cambios_nombres', 'Niveles 14 (Lechuga Helada) y 18 (Threepeater)'
  ),
  NOW()
);

COMMIT;
