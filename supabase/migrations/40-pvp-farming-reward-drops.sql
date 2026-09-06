-- Plant Arena · PvP Farming rewards v0.1
-- 3 server-authoritative drops per victory chest, persisted to prevent rerolls.
-- Shop packs and streamer reward packs are intentionally untouched.

begin;

alter table public.profiles
  add column if not exists farming_inventory jsonb not null default
  '{"water":0,"fertilizer":0,"shovel_fragment":0,"scarecrow_fragment":0,"pesticide":0,"shovel":0,"scarecrow":0}'::jsonb;

alter table public.pack_slots
  add column if not exists reward_drops jsonb;

alter table public.pack_slots
  add column if not exists reward_generated_at timestamptz;

-- The browser can read its inventory through RPC but cannot mint/edit it directly.
revoke update (farming_inventory) on public.profiles from authenticated;

-- New cadence: the four victory slots are 1h / 2h / 4h / 6h.
update public.pack_slots
set duration_hours = case slot_index
  when 0 then 1
  when 1 then 2
  when 2 then 4
  when 3 then 6
  else duration_hours
end
where slot_index between 0 and 3;

create or replace function public.enforce_pack_slot_duration_v2()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  new.duration_hours := case new.slot_index
    when 0 then 1
    when 1 then 2
    when 2 then 4
    when 3 then 6
    else new.duration_hours
  end;
  return new;
end;
$$;

drop trigger if exists trg_pack_slot_duration_v2 on public.pack_slots;
create trigger trg_pack_slot_duration_v2
before insert or update of slot_index, duration_hours on public.pack_slots
for each row execute function public.enforce_pack_slot_duration_v2();

create or replace function public.my_farming_inventory()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_inventory jsonb;
begin
  if v_user is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select coalesce(
    farming_inventory,
    '{"water":0,"fertilizer":0,"shovel_fragment":0,"scarecrow_fragment":0,"pesticide":0,"shovel":0,"scarecrow":0}'::jsonb
  )
  into v_inventory
  from public.profiles
  where id = v_user;

  return coalesce(v_inventory, '{}'::jsonb);
end;
$$;

revoke all on function public.my_farming_inventory() from public;
grant execute on function public.my_farming_inventory() to authenticated;

-- Replaces ONLY the victory-slot claim RPC.
-- Weight per DROP:
--   Water 34%, Fertilizer 24%, Gold 50 14%, Gold 100 6%, Plant 12%,
--   Pesticide 4%, Shovel fragment 3%, Scarecrow fragment 3%.
-- At most one plant can appear in the three drops.
-- Plant roll: 70% common / 30% uncommon; equal chance inside each rarity pool.
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

  -- Idempotencia: si el navegador cerró después del commit, devolver exactamente
  -- el mismo resultado; jamás volver a tirar los dados.
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

  for v_i in 1..3 loop
    v_roll := random();

    if not v_plant_seen and v_roll < 0.12 then
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
      -- When a plant already appeared, reroll inside the remaining 88% so a
      -- second plant is impossible without distorting the relative resource mix.
      v_nonplant := case
        when v_plant_seen then random() * 0.88
        else v_roll - 0.12
      end;

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

revoke all on function public.claim_pack_slot(integer) from public;
grant execute on function public.claim_pack_slot(integer) to authenticated;

commit;
