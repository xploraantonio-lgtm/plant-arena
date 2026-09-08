-- =============================================================================
-- MIGRACIÓN 56: CÓDIGOS PARA ROBERKD (STREAMER) Y ACERTIJOS PVZ (DINÁMICAS)
--
-- 1. 10 Códigos para RoberKD y su comunidad (Sobres PvP).
-- 2. 10 Códigos de acertijos / dinámicas "¿Qué planta soy?" de Plants vs Zombies.
--
-- NOTA:
-- - max_uses = 1 para códigos únicos (el primero que lo descubra o canjee).
--   (Puedes cambiar max_uses a 50, 100 o más si quieres que muchos miembros
--    de la comunidad lo reclamen).
-- - Cada jugador solo puede canjear un código una sola vez.
-- =============================================================================

BEGIN;

INSERT INTO public.reward_codes (code, normalized_code, reward_type, reward_value, max_uses, used_count, active)
VALUES
  -- ── 1. 10 CÓDIGOS DE ROBERKD (STREAMER / COMUNIDAD) ─────────────────────────
  ('ROBERKD',          'ROBERKD',          'pvp_pack', 1, 1, 0, TRUE),
  ('ROBERKDPVP',       'ROBERKDPVP',       'pvp_pack', 1, 1, 0, TRUE),
  ('ROBERKDPLANT',     'ROBERKDPLANT',     'pvp_pack', 1, 1, 0, TRUE),
  ('ROBERKDKING',      'ROBERKDKING',      'pvp_pack', 1, 1, 0, TRUE),
  ('ROBERKDARENA',     'ROBERKDARENA',     'pvp_pack', 1, 1, 0, TRUE),
  ('ROBERKDPRO',       'ROBERKDPRO',       'pvp_pack', 1, 1, 0, TRUE),
  ('ROBERKDGOD',       'ROBERKDGOD',       'pvp_pack', 1, 1, 0, TRUE),
  ('ROBERKDFAMILY',    'ROBERKDFAMILY',    'pvp_pack', 1, 1, 0, TRUE),
  ('ROBERKDPACK',      'ROBERKDPACK',      'pvp_pack', 1, 1, 0, TRUE),
  ('ROBERKDSTREAM',    'ROBERKDSTREAM',    'pvp_pack', 1, 1, 0, TRUE),

  -- ── 2. 10 CÓDIGOS DE ACERTIJOS Y DINÁMICAS "¿QUÉ PLANTA SOY?" (PvZ) ────────
  -- Acertijo 1: Girasol (Sunflower) -> Produce sol y energía dorada con sonrisa
  ('SOYGIRASOL',       'SOYGIRASOL',       'pvp_pack', 1, 1, 0, TRUE),

  -- Acertijo 2: Lanzaguisantes (Peashooter) -> Primer defensor que escupe guisantes verdes
  ('LANZAGUISANTE',    'LANZAGUISANTE',    'pvp_pack', 1, 1, 0, TRUE),

  -- Acertijo 3: Nuez (Wall-nut) -> Cáscara dura que frena mordidas y llora al romperse
  ('NUEZESCUDO',       'NUEZESCUDO',       'pvp_pack', 1, 1, 0, TRUE),

  -- Acertijo 4: Petacereza (Cherry Bomb) -> Dos hermanos explosivos de mecha corta
  ('PETACEREZA',       'PETACEREZA',       'pvp_pack', 1, 1, 0, TRUE),

  -- Acertijo 5: Hielaguisantes (Snow Pea) -> Dispara proyectiles helados que ralentizan
  ('HIELAGUISANTE',    'HIELAGUISANTE',    'pvp_pack', 1, 1, 0, TRUE),

  -- Acertijo 6: Planta Carnívora (Chomper) -> Se traga al zombi de un bocado pero mastica lento
  ('SOYCARNIVORA',     'SOYCARNIVORA',     'pvp_pack', 1, 1, 0, TRUE),

  -- Acertijo 7: Papapum (Potato Mine) -> Mina bajo tierra que explota al pisarla (¡SPUDOW!)
  ('SPUDOWPAPAPUM',    'SPUDOWPAPAPUM',    'pvp_pack', 1, 1, 0, TRUE),

  -- Acertijo 8: Repetidora (Repeater) -> Mirada seria que dispara dos guisantes a la vez
  ('DOBLEREPEATER',    'DOBLEREPEATER',    'pvp_pack', 1, 1, 0, TRUE),

  -- Acertijo 9: Jalapeño (Jalapeno) -> Picante y explosivo que quema una línea entera
  ('FUEGOJALAPENO',    'FUEGOJALAPENO',    'pvp_pack', 1, 1, 0, TRUE),

  -- Acertijo 10: Melonpulta (Melon-pult) -> Catapulta pesados melones con daño en área
  ('MELONCATAPULTA',   'MELONCATAPULTA',   'pvp_pack', 1, 1, 0, TRUE)

ON CONFLICT (normalized_code) DO UPDATE
  SET active = TRUE,
      max_uses = EXCLUDED.max_uses;

COMMIT;
