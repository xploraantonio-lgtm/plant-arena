-- Plant Arena · PvP Farming rewards v0.2
-- Prevents a previously claimed reward from being reused when the same PvP
-- victory slot receives a new chest.

begin;

create or replace function public.clear_pack_slot_reward_on_reuse_v2()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- A claimed chest is stored as status='empty' with reward_drops persisted so
  -- reconnects can receive the exact same result and never reroll it. As soon
  -- as that slot is assigned a NEW chest, invalidate the previous persisted
  -- result before the new chest can be opened.
  if old.status = 'empty' and new.status <> 'empty' then
    new.reward_drops := null;
    new.reward_generated_at := null;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_pack_slot_reward_reuse_v2 on public.pack_slots;
create trigger trg_pack_slot_reward_reuse_v2
before update of status on public.pack_slots
for each row execute function public.clear_pack_slot_reward_on_reuse_v2();

commit;
