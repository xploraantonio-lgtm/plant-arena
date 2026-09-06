-- Plant Arena · PvP victory chest duration consistency
-- Keeps the immediate RPC response aligned with the enforced 1h / 2h / 4h / 6h slot cadence.

create or replace function public._award_victory_chest_for(p_uid uuid)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_elo integer;
  v_arena integer;
  v_libre integer;
  v_dur integer;
  v_ultimo timestamptz;
begin
  if p_uid is null then
    return jsonb_build_object('awarded', false, 'reason', 'sin_usuario');
  end if;

  select max(awarded_at) into v_ultimo
  from public.pack_slots
  where user_id = p_uid;

  if v_ultimo is not null and v_ultimo > now() - interval '2 minutes' then
    return jsonb_build_object('awarded', false, 'reason', 'demasiado_pronto');
  end if;

  select elo_rating into v_elo
  from public.profiles
  where id = p_uid;

  v_arena := case
    when v_elo >= 3100 then 5
    when v_elo >= 2050 then 4
    when v_elo >= 1750 then 3
    when v_elo >= 1600 then 2
    else 1
  end;

  select i into v_libre
  from generate_series(0,3) as i
  where not exists (
    select 1
    from public.pack_slots ps
    where ps.user_id = p_uid
      and ps.slot_index = i
      and ps.status <> 'empty'
  )
  order by i
  limit 1;

  if v_libre is null then
    return jsonb_build_object('awarded', false, 'reason', 'huecos_llenos');
  end if;

  v_dur := case v_libre
    when 0 then 1
    when 1 then 2
    when 2 then 4
    when 3 then 6
    else 1
  end;

  insert into public.pack_slots
    (user_id, slot_index, status, duration_hours, arena_level, unlock_started_at, awarded_at)
  values
    (p_uid, v_libre, 'locked', v_dur, v_arena, null, now())
  on conflict (user_id, slot_index) do update
    set status = 'locked',
        duration_hours = excluded.duration_hours,
        arena_level = excluded.arena_level,
        unlock_started_at = null,
        awarded_at = now();

  return jsonb_build_object(
    'awarded', true,
    'slotId', v_libre,
    'durationHours', v_dur,
    'arenaLevel', v_arena
  );
end;
$$;
