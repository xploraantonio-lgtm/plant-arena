create or replace function public.enforce_pack_slot_duration_v2()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.duration_hours not in (1, 2, 4, 6) then
    new.duration_hours := 1;
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_pack_slot_duration_v2() from public, anon, authenticated;

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
  v_roll double precision;
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

  -- El tiempo pertenece al pack, no al slot.
  -- 1h 50%, 2h 30%, 4h 15%, 6h 5%.
  v_roll := random();
  v_dur := case
    when v_roll < 0.50 then 1
    when v_roll < 0.80 then 2
    when v_roll < 0.95 then 4
    else 6
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

revoke all on function public._award_victory_chest_for(uuid) from public, anon, authenticated;

create or replace function public.claim_pack_slot(p_slot_index integer)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_slot public.pack_slots%rowtype;
  v_now timestamptz := clock_timestamp();
  v_drops jsonb := '[]'::jsonb;
  v_inventory jsonb;
  v_gold_balance bigint;
  v_roll double precision;
  v_nonplant double precision;
  v_plant_chance double precision;
  v_plant_seen boolean := false;
  v_plant_id text;
  v_rarity text;
  v_is_new boolean;
  v_pool text[];
  v_i integer;
  v_water integer := 0;
  v_fertilizer integer := 0;
  v_shovel_fragment integer := 0;
  v_scarecrow_fragment integer := 0;
  v_pesticide integer := 0;
  v_gold integer := 0;
begin
  if v_user is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select * into v_slot
  from public.pack_slots
  where user_id = v_user and slot_index = p_slot_index
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'SLOT_NOT_FOUND');
  end if;

  if v_slot.status = 'empty' and v_slot.reward_drops is not null then
    select farming_inventory, gold_balance
      into v_inventory, v_gold_balance
    from public.profiles where id = v_user;

    return jsonb_build_object(
      'success', true,
      'alreadyOpened', true,
      'drops', v_slot.reward_drops,
      'farmingItems', coalesce(v_inventory, '{}'::jsonb),
      'goldBalance', coalesce(v_gold_balance, 0)
    );
  end if;

  if v_slot.status = 'unlocking' then
    if v_slot.unlock_started_at is null
       or v_now < v_slot.unlock_started_at + make_interval(hours => v_slot.duration_hours) then
      return jsonb_build_object('success', false, 'error', 'PACK_NOT_READY');
    end if;
  elsif v_slot.status <> 'ready' then
    return jsonb_build_object('success', false, 'error', 'PACK_NOT_READY');
  end if;

  -- 6h: 75% de probabilidad de incluir una planta.
  -- Resto: 12%. Máximo una planta por pack.
  v_plant_chance := case when v_slot.duration_hours = 6 then 0.75 else 0.12 end;

  for v_i in 1..3 loop
    v_roll := random();

    if not v_plant_seen and v_roll < v_plant_chance then
      v_plant_seen := true;

      if random() < 0.70 then
        v_pool := array['sunflower','peashooter','wallnut','chomper'];
        v_rarity := 'common';
      else
        v_pool := array['garlic','bonkchoy','repeater','melonpult','squash'];
        v_rarity := 'uncommon';
      end if;

      v_plant_id := v_pool[1 + floor(random() * array_length(v_pool, 1))::integer];

      select not exists (
        select 1 from public.plant_instances
        where owner_id = v_user and plant_id = v_plant_id and is_base = true
      ) into v_is_new;

      if v_is_new then
        insert into public.plant_instances (
          owner_id, plant_id, rarity, star_level, level, stat_rolls,
          is_base, is_in_deck, deck_slot, is_listed_for_sale
        ) values (
          v_user, v_plant_id, v_rarity, 1, 0, '{}'::text[],
          true, false, null, false
        );
      else
        insert into public.plant_copies(user_id, plant_id, copies)
        values (v_user, v_plant_id, 1)
        on conflict (user_id, plant_id)
        do update set copies = public.plant_copies.copies + 1;
      end if;

      v_drops := v_drops || jsonb_build_array(jsonb_build_object(
        'type', 'plant',
        'plantId', v_plant_id,
        'rarity', v_rarity,
        'isNew', v_is_new,
        'quantity', 1
      ));
    else
      v_nonplant := random() * 0.88;

      if v_nonplant < 0.34 then
        v_water := v_water + 1;
        v_drops := v_drops || jsonb_build_array(jsonb_build_object('type','item','itemId','water','quantity',1));
      elsif v_nonplant < 0.58 then
        v_fertilizer := v_fertilizer + 1;
        v_drops := v_drops || jsonb_build_array(jsonb_build_object('type','item','itemId','fertilizer','quantity',1));
      elsif v_nonplant < 0.72 then
        v_gold := v_gold + 50;
        v_drops := v_drops || jsonb_build_array(jsonb_build_object('type','gold','quantity',50));
      elsif v_nonplant < 0.78 then
        v_gold := v_gold + 100;
        v_drops := v_drops || jsonb_build_array(jsonb_build_object('type','gold','quantity',100));
      elsif v_nonplant < 0.82 then
        v_pesticide := v_pesticide + 1;
        v_drops := v_drops || jsonb_build_array(jsonb_build_object('type','item','itemId','pesticide','quantity',1));
      elsif v_nonplant < 0.85 then
        v_shovel_fragment := v_shovel_fragment + 1;
        v_drops := v_drops || jsonb_build_array(jsonb_build_object('type','item','itemId','shovel_fragment','quantity',1));
      else
        v_scarecrow_fragment := v_scarecrow_fragment + 1;
        v_drops := v_drops || jsonb_build_array(jsonb_build_object('type','item','itemId','scarecrow_fragment','quantity',1));
      end if;
    end if;
  end loop;

  select coalesce(farming_inventory, '{}'::jsonb)
    into v_inventory
  from public.profiles
  where id = v_user
  for update;

  v_inventory := jsonb_set(v_inventory, '{water}', to_jsonb(coalesce((v_inventory->>'water')::integer,0) + v_water), true);
  v_inventory := jsonb_set(v_inventory, '{fertilizer}', to_jsonb(coalesce((v_inventory->>'fertilizer')::integer,0) + v_fertilizer), true);
  v_inventory := jsonb_set(v_inventory, '{shovel_fragment}', to_jsonb(coalesce((v_inventory->>'shovel_fragment')::integer,0) + v_shovel_fragment), true);
  v_inventory := jsonb_set(v_inventory, '{scarecrow_fragment}', to_jsonb(coalesce((v_inventory->>'scarecrow_fragment')::integer,0) + v_scarecrow_fragment), true);
  v_inventory := jsonb_set(v_inventory, '{pesticide}', to_jsonb(coalesce((v_inventory->>'pesticide')::integer,0) + v_pesticide), true);
  v_inventory := jsonb_set(v_inventory, '{shovel}', to_jsonb(coalesce((v_inventory->>'shovel')::integer,0)), true);
  v_inventory := jsonb_set(v_inventory, '{scarecrow}', to_jsonb(coalesce((v_inventory->>'scarecrow')::integer,0)), true);

  update public.profiles
  set farming_inventory = v_inventory,
      gold_balance = gold_balance + v_gold
  where id = v_user
  returning gold_balance into v_gold_balance;

  update public.pack_slots
  set status = 'empty',
      unlock_started_at = null,
      reward_drops = v_drops,
      reward_generated_at = v_now
  where id = v_slot.id;

  return jsonb_build_object(
    'success', true,
    'drops', v_drops,
    'farmingItems', v_inventory,
    'goldBalance', v_gold_balance
  );
end;
$$;

grant execute on function public.claim_pack_slot(integer) to authenticated;
revoke all on function public.claim_pack_slot(integer) from anon;
