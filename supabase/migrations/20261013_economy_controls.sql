-- Apply in Supabase SQL editor before deploying the new game client.
-- Configuration is globally readable through the existing game_config SELECT policy.
alter table public.game_config
  add column if not exists wealth_impact numeric(4,2) not null default 1,
  add column if not exists reward_multiplier numeric(4,2) not null default 1,
  add column if not exists min_win_chance integer not null default 5;

update public.game_config
set wealth_impact = 1, reward_multiplier = 1, min_win_chance = 5
where id = true;

alter table public.game_config
  add constraint game_config_wealth_impact_range check (wealth_impact between 0 and 3),
  add constraint game_config_reward_multiplier_range check (reward_multiplier between 0.25 and 3),
  add constraint game_config_min_win_chance_range check (min_win_chance between 1 and 25);

-- Never rely on a client-provided isAdmin flag for writes.
create or replace function public.update_economy_config(
  p_difficulty integer,
  p_wealth_impact numeric,
  p_reward_multiplier numeric,
  p_min_win_chance integer
) returns table(difficulty integer, wealth_impact numeric, reward_multiplier numeric, min_win_chance integer)
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.is_admin is true
  ) then
    raise exception 'Only administrators may update economy settings' using errcode = '42501';
  end if;
  if p_difficulty not between 0 and 100
     or p_wealth_impact not between 0 and 3
     or p_reward_multiplier not between 0.25 and 3
     or p_min_win_chance not between 1 and 25 then
    raise exception 'Invalid economy settings' using errcode = '22023';
  end if;
  return query
    update public.game_config g
    set difficulty = p_difficulty,
        wealth_impact = p_wealth_impact,
        reward_multiplier = p_reward_multiplier,
        min_win_chance = p_min_win_chance,
        updated_by = auth.uid(),
        updated_at = now()
    where g.id = true
    returning g.difficulty, g.wealth_impact, g.reward_multiplier, g.min_win_chance;
end;
$$;
revoke all on function public.update_economy_config(integer,numeric,numeric,integer) from public;
grant execute on function public.update_economy_config(integer,numeric,numeric,integer) to authenticated;

-- Important: audit existing game_config UPDATE policies and game_saves write policies.
-- An existing permissive UPDATE policy can bypass this RPC, so revoke direct
-- authenticated UPDATE access only after checking all other consumers.
