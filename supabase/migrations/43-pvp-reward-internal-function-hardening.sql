-- Plant Arena · PvP reward internal function hardening
-- Internal helpers are not public RPC endpoints; only the authenticated game RPCs remain callable.

revoke all on function public._award_victory_chest_for(uuid) from public;
revoke all on function public._award_victory_chest_for(uuid) from anon;
revoke all on function public._award_victory_chest_for(uuid) from authenticated;

revoke all on function public.enforce_pack_slot_duration_v2() from public;
revoke all on function public.enforce_pack_slot_duration_v2() from anon;
revoke all on function public.enforce_pack_slot_duration_v2() from authenticated;

revoke all on function public.clear_pack_slot_reward_on_reuse_v2() from public;
revoke all on function public.clear_pack_slot_reward_on_reuse_v2() from anon;
revoke all on function public.clear_pack_slot_reward_on_reuse_v2() from authenticated;

revoke all on function public.award_victory_chest() from public;
revoke all on function public.award_victory_chest() from anon;
grant execute on function public.award_victory_chest() to authenticated;

revoke all on function public.claim_pack_slot(integer) from public;
revoke all on function public.claim_pack_slot(integer) from anon;
grant execute on function public.claim_pack_slot(integer) to authenticated;

revoke all on function public.my_farming_inventory() from public;
revoke all on function public.my_farming_inventory() from anon;
grant execute on function public.my_farming_inventory() to authenticated;
