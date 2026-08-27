-- ==============================================================================
-- ROLLBACK FASE 49: ELIMINACIÓN EXCLUSIVA DE LAS 4 FILAS DE RIVAL SEMILLA V2
-- ==============================================================================
DELETE FROM public.ranked_async_opponents
 WHERE source_room_id IN (
   '0184b9a1-384a-4f4e-995b-8579eedd6a48',
   '7eb24ca0-8648-4da7-9b80-16be654b4206',
   'a7c22942-c60b-4db3-903f-5d3ff84a8515',
   '3e35ee42-12b4-43f7-80f9-8d5fd6a585f6'
 );
