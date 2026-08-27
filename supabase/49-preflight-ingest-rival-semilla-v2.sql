-- ==============================================================================
-- FASE 49: INGESTA CONTROLADA DE BANCO MÍNIMO RIVAL SEMILLA V2 (PREPARACIÓN)
-- ==============================================================================
-- Este script inserta 4 partidas humanas certificadas como semillas V2.
-- REGLAS DE SEGURIDAD:
-- 1. active = FALSE inicialmente (inactivo hasta activación autorizada).
-- 2. Idempotente: ON CONFLICT (source_room_id, source_side) DO NOTHING.
-- 3. No modifica semillas V1, ELO, perfiles, settlement ni matchmaking.
-- ==============================================================================

-- Semilla V2: Semilla V2 #1 (Lionel) | Room: 0184b9a1-384a-4f4e-995b-8579eedd6a48 | Side: 2 | Rating: 1024 | Plantas: 23
INSERT INTO public.ranked_async_opponents (
  source_room_id,
  source_side,
  rating_snapshot,
  deck_snapshot,
  actions_snapshot,
  source_engine_version,
  protocol_version,
  source_duration_ticks,
  active,
  usage_count
) VALUES (
  '0184b9a1-384a-4f4e-995b-8579eedd6a48',
  2,
  1024,
  '[{"slot":0,"plantId":"sunflower","level":0,"statRolls":[]},{"slot":1,"plantId":"wallnut","level":0,"statRolls":[]},{"slot":2,"plantId":"repeater","level":0,"statRolls":[]},{"slot":3,"plantId":"bonkchoy","level":0,"statRolls":[]}]'::jsonb,
  '[{"seq":1,"tick":367,"issuedTick":361,"kind":"plant","plantId":"sunflower","lane":2,"col":0,"slot":0},{"seq":2,"tick":781,"issuedTick":775,"kind":"plant","plantId":"sunflower","lane":1,"col":0,"slot":0},{"seq":3,"tick":976,"issuedTick":970,"kind":"plant","plantId":"sunflower","lane":0,"col":0,"slot":0},{"seq":4,"tick":1268,"issuedTick":1262,"kind":"plant","plantId":"sunflower","lane":2,"col":1,"slot":0},{"seq":5,"tick":1485,"issuedTick":1479,"kind":"plant","plantId":"wallnut","lane":0,"col":5,"slot":1},{"seq":6,"tick":1574,"issuedTick":1568,"kind":"plant","plantId":"sunflower","lane":1,"col":1,"slot":0},{"seq":7,"tick":2052,"issuedTick":2046,"kind":"plant","plantId":"wallnut","lane":1,"col":5,"slot":1},{"seq":8,"tick":2286,"issuedTick":2280,"kind":"plant","plantId":"repeater","lane":1,"col":4,"slot":2},{"seq":9,"tick":2552,"issuedTick":2546,"kind":"plant","plantId":"sunflower","lane":0,"col":1,"slot":0},{"seq":10,"tick":2848,"issuedTick":2842,"kind":"plant","plantId":"wallnut","lane":1,"col":5,"slot":1},{"seq":11,"tick":2956,"issuedTick":2950,"kind":"plant","plantId":"repeater","lane":1,"col":3,"slot":2},{"seq":12,"tick":3214,"issuedTick":3208,"kind":"plant","plantId":"sunflower","lane":1,"col":5,"slot":0},{"seq":13,"tick":3379,"issuedTick":3373,"kind":"plant","plantId":"bonkchoy","lane":1,"col":2,"slot":3},{"seq":14,"tick":3504,"issuedTick":3498,"kind":"plant","plantId":"wallnut","lane":1,"col":5,"slot":1},{"seq":15,"tick":3831,"issuedTick":3825,"kind":"plant","plantId":"bonkchoy","lane":1,"col":5,"slot":3},{"seq":16,"tick":4011,"issuedTick":4005,"kind":"plant","plantId":"sunflower","lane":2,"col":2,"slot":0},{"seq":17,"tick":4249,"issuedTick":4243,"kind":"plant","plantId":"bonkchoy","lane":1,"col":5,"slot":3},{"seq":18,"tick":4485,"issuedTick":4479,"kind":"plant","plantId":"wallnut","lane":2,"col":5,"slot":1},{"seq":19,"tick":4726,"issuedTick":4720,"kind":"plant","plantId":"repeater","lane":1,"col":2,"slot":2},{"seq":20,"tick":5026,"issuedTick":5020,"kind":"plant","plantId":"bonkchoy","lane":1,"col":5,"slot":3},{"seq":21,"tick":5398,"issuedTick":5392,"kind":"plant","plantId":"wallnut","lane":1,"col":5,"slot":1},{"seq":22,"tick":5572,"issuedTick":5566,"kind":"plant","plantId":"bonkchoy","lane":1,"col":5,"slot":3},{"seq":23,"tick":5864,"issuedTick":5858,"kind":"plant","plantId":"bonkchoy","lane":0,"col":4,"slot":3}]'::jsonb,
  'auth-v2',
  'ranked-async-v1',
  5864,
  FALSE,
  0
)
ON CONFLICT (source_room_id, source_side) DO NOTHING;

-- Semilla V2: Semilla V2 #2 (Luisma_YT) | Room: 7eb24ca0-8648-4da7-9b80-16be654b4206 | Side: 1 | Rating: 1063 | Plantas: 25
INSERT INTO public.ranked_async_opponents (
  source_room_id,
  source_side,
  rating_snapshot,
  deck_snapshot,
  actions_snapshot,
  source_engine_version,
  protocol_version,
  source_duration_ticks,
  active,
  usage_count
) VALUES (
  '7eb24ca0-8648-4da7-9b80-16be654b4206',
  1,
  1063,
  '[{"slot":0,"plantId":"sunflower","level":0,"statRolls":[]},{"slot":1,"plantId":"peashooter","level":0,"statRolls":[]},{"slot":2,"plantId":"wallnut","level":0,"statRolls":[]},{"slot":3,"plantId":"chomper","level":0,"statRolls":[]}]'::jsonb,
  '[{"seq":1,"tick":336,"issuedTick":330,"kind":"plant","plantId":"sunflower","lane":2,"col":0,"slot":0},{"seq":2,"tick":690,"issuedTick":684,"kind":"plant","plantId":"sunflower","lane":1,"col":0,"slot":0},{"seq":3,"tick":884,"issuedTick":878,"kind":"plant","plantId":"sunflower","lane":0,"col":0,"slot":0},{"seq":4,"tick":1302,"issuedTick":1296,"kind":"plant","plantId":"peashooter","lane":1,"col":1,"slot":1},{"seq":5,"tick":1449,"issuedTick":1443,"kind":"plant","plantId":"sunflower","lane":2,"col":1,"slot":0},{"seq":6,"tick":1817,"issuedTick":1811,"kind":"plant","plantId":"peashooter","lane":1,"col":2,"slot":1},{"seq":7,"tick":1983,"issuedTick":1977,"kind":"plant","plantId":"sunflower","lane":0,"col":1,"slot":0},{"seq":8,"tick":2226,"issuedTick":2220,"kind":"plant","plantId":"peashooter","lane":1,"col":3,"slot":1},{"seq":9,"tick":2532,"issuedTick":2526,"kind":"plant","plantId":"peashooter","lane":1,"col":4,"slot":1},{"seq":10,"tick":2748,"issuedTick":2742,"kind":"plant","plantId":"wallnut","lane":1,"col":5,"slot":2},{"seq":11,"tick":2916,"issuedTick":2910,"kind":"plant","plantId":"peashooter","lane":2,"col":2,"slot":1},{"seq":12,"tick":3185,"issuedTick":3179,"kind":"plant","plantId":"peashooter","lane":0,"col":2,"slot":1},{"seq":13,"tick":3318,"issuedTick":3312,"kind":"plant","plantId":"wallnut","lane":1,"col":5,"slot":2},{"seq":14,"tick":3539,"issuedTick":3533,"kind":"plant","plantId":"peashooter","lane":0,"col":3,"slot":1},{"seq":15,"tick":3837,"issuedTick":3831,"kind":"plant","plantId":"wallnut","lane":1,"col":5,"slot":2},{"seq":16,"tick":3916,"issuedTick":3910,"kind":"plant","plantId":"peashooter","lane":0,"col":4,"slot":1},{"seq":17,"tick":4099,"issuedTick":4093,"kind":"plant","plantId":"sunflower","lane":1,"col":5,"slot":0},{"seq":18,"tick":4198,"issuedTick":4192,"kind":"plant","plantId":"peashooter","lane":1,"col":4,"slot":1},{"seq":19,"tick":4344,"issuedTick":4338,"kind":"plant","plantId":"wallnut","lane":1,"col":5,"slot":2},{"seq":20,"tick":4568,"issuedTick":4562,"kind":"plant","plantId":"peashooter","lane":1,"col":4,"slot":1},{"seq":21,"tick":4870,"issuedTick":4864,"kind":"plant","plantId":"wallnut","lane":1,"col":5,"slot":2},{"seq":22,"tick":4950,"issuedTick":4944,"kind":"plant","plantId":"peashooter","lane":1,"col":4,"slot":1},{"seq":23,"tick":5214,"issuedTick":5208,"kind":"plant","plantId":"peashooter","lane":0,"col":5,"slot":1},{"seq":24,"tick":5537,"issuedTick":5531,"kind":"plant","plantId":"wallnut","lane":1,"col":5,"slot":2},{"seq":25,"tick":5684,"issuedTick":5678,"kind":"plant","plantId":"chomper","lane":1,"col":4,"slot":3}]'::jsonb,
  'auth-v2',
  'ranked-async-v1',
  5684,
  FALSE,
  0
)
ON CONFLICT (source_room_id, source_side) DO NOTHING;

-- Semilla V2: Semilla V2 #3 (Lionel) | Room: a7c22942-c60b-4db3-903f-5d3ff84a8515 | Side: 2 | Rating: 1024 | Plantas: 15
INSERT INTO public.ranked_async_opponents (
  source_room_id,
  source_side,
  rating_snapshot,
  deck_snapshot,
  actions_snapshot,
  source_engine_version,
  protocol_version,
  source_duration_ticks,
  active,
  usage_count
) VALUES (
  'a7c22942-c60b-4db3-903f-5d3ff84a8515',
  2,
  1024,
  '[{"slot":0,"plantId":"sunflower","level":0,"statRolls":[]},{"slot":1,"plantId":"peashooter","level":0,"statRolls":[]},{"slot":2,"plantId":"wallnut","level":0,"statRolls":[]},{"slot":3,"plantId":"chomper","level":0,"statRolls":[]}]'::jsonb,
  '[{"seq":1,"tick":393,"issuedTick":387,"kind":"plant","plantId":"sunflower","lane":2,"col":0,"slot":0},{"seq":2,"tick":748,"issuedTick":742,"kind":"plant","plantId":"sunflower","lane":1,"col":0,"slot":0},{"seq":3,"tick":1112,"issuedTick":1106,"kind":"plant","plantId":"sunflower","lane":0,"col":0,"slot":0},{"seq":4,"tick":1429,"issuedTick":1423,"kind":"plant","plantId":"peashooter","lane":1,"col":3,"slot":1},{"seq":5,"tick":1670,"issuedTick":1664,"kind":"plant","plantId":"wallnut","lane":1,"col":5,"slot":2},{"seq":6,"tick":1866,"issuedTick":1860,"kind":"plant","plantId":"peashooter","lane":1,"col":4,"slot":1},{"seq":7,"tick":2196,"issuedTick":2190,"kind":"plant","plantId":"peashooter","lane":1,"col":2,"slot":1},{"seq":8,"tick":2440,"issuedTick":2434,"kind":"plant","plantId":"wallnut","lane":1,"col":5,"slot":2},{"seq":9,"tick":2781,"issuedTick":2775,"kind":"plant","plantId":"peashooter","lane":1,"col":1,"slot":1},{"seq":10,"tick":2944,"issuedTick":2938,"kind":"plant","plantId":"wallnut","lane":2,"col":5,"slot":2},{"seq":11,"tick":3149,"issuedTick":3143,"kind":"plant","plantId":"peashooter","lane":1,"col":5,"slot":1},{"seq":12,"tick":3571,"issuedTick":3565,"kind":"plant","plantId":"peashooter","lane":1,"col":5,"slot":1},{"seq":13,"tick":3738,"issuedTick":3732,"kind":"plant","plantId":"chomper","lane":1,"col":5,"slot":3},{"seq":14,"tick":4132,"issuedTick":4126,"kind":"plant","plantId":"chomper","lane":1,"col":5,"slot":3},{"seq":15,"tick":4529,"issuedTick":4523,"kind":"plant","plantId":"chomper","lane":1,"col":4,"slot":3}]'::jsonb,
  'auth-v2',
  'ranked-async-v1',
  4529,
  FALSE,
  0
)
ON CONFLICT (source_room_id, source_side) DO NOTHING;

-- Semilla V2: Semilla V2 #4 (Lionel) | Room: 3e35ee42-12b4-43f7-80f9-8d5fd6a585f6 | Side: 2 | Rating: 1024 | Plantas: 17
INSERT INTO public.ranked_async_opponents (
  source_room_id,
  source_side,
  rating_snapshot,
  deck_snapshot,
  actions_snapshot,
  source_engine_version,
  protocol_version,
  source_duration_ticks,
  active,
  usage_count
) VALUES (
  '3e35ee42-12b4-43f7-80f9-8d5fd6a585f6',
  2,
  1024,
  '[{"slot":0,"plantId":"sunflower","level":0,"statRolls":[]},{"slot":1,"plantId":"wallnut","level":0,"statRolls":[]},{"slot":2,"plantId":"repeater","level":0,"statRolls":[]},{"slot":3,"plantId":"bonkchoy","level":0,"statRolls":[]}]'::jsonb,
  '[{"seq":1,"tick":391,"issuedTick":385,"kind":"plant","plantId":"sunflower","lane":1,"col":0,"slot":0},{"seq":2,"tick":726,"issuedTick":720,"kind":"plant","plantId":"sunflower","lane":2,"col":0,"slot":0},{"seq":3,"tick":972,"issuedTick":966,"kind":"plant","plantId":"sunflower","lane":0,"col":0,"slot":0},{"seq":4,"tick":1594,"issuedTick":1588,"kind":"plant","plantId":"wallnut","lane":1,"col":5,"slot":1},{"seq":5,"tick":1678,"issuedTick":1672,"kind":"plant","plantId":"sunflower","lane":0,"col":1,"slot":0},{"seq":6,"tick":1867,"issuedTick":1861,"kind":"plant","plantId":"bonkchoy","lane":0,"col":3,"slot":3},{"seq":7,"tick":2014,"issuedTick":2008,"kind":"plant","plantId":"sunflower","lane":2,"col":1,"slot":0},{"seq":8,"tick":2253,"issuedTick":2247,"kind":"plant","plantId":"wallnut","lane":2,"col":5,"slot":1},{"seq":9,"tick":2454,"issuedTick":2448,"kind":"plant","plantId":"sunflower","lane":1,"col":1,"slot":0},{"seq":10,"tick":2722,"issuedTick":2716,"kind":"plant","plantId":"bonkchoy","lane":0,"col":4,"slot":3},{"seq":11,"tick":2889,"issuedTick":2883,"kind":"plant","plantId":"wallnut","lane":0,"col":5,"slot":1},{"seq":12,"tick":2995,"issuedTick":2989,"kind":"plant","plantId":"sunflower","lane":2,"col":2,"slot":0},{"seq":13,"tick":3217,"issuedTick":3211,"kind":"plant","plantId":"bonkchoy","lane":0,"col":3,"slot":3},{"seq":14,"tick":3377,"issuedTick":3371,"kind":"plant","plantId":"sunflower","lane":0,"col":2,"slot":0},{"seq":15,"tick":3693,"issuedTick":3687,"kind":"plant","plantId":"repeater","lane":1,"col":4,"slot":2},{"seq":16,"tick":3845,"issuedTick":3839,"kind":"plant","plantId":"wallnut","lane":1,"col":5,"slot":1},{"seq":17,"tick":4072,"issuedTick":4066,"kind":"plant","plantId":"bonkchoy","lane":0,"col":4,"slot":3}]'::jsonb,
  'auth-v2',
  'ranked-async-v1',
  4072,
  FALSE,
  0
)
ON CONFLICT (source_room_id, source_side) DO NOTHING;

