-- Run this migration in the Supabase SQL editor before deploying the UI.
-- Assumes existing public.game_config(id boolean, difficulty, updated_by, updated_at)
-- and public.profiles(id uuid, is_admin boolean).
alter table public.game_config
  add column if not exists wealth_influence numeric not null default 1.9,
  add column if not exists reward_multiplier numeric not null default 1.8,
  add column if not exists minimum_win_chance numeric not null default 6;
alter table public.game_config alter column difficulty set default 48;
update public.game_config set difficulty = 48, wealth_influence = 1.9,
  reward_multiplier = 1.8, minimum_win_chance = 6 where id = true;
alter table public.game_config
  add constraint economy_wealth_range check (wealth_influence between 0 and 3),
  add constraint economy_reward_range check (reward_multiplier between 0.25 and 3),
  add constraint economy_min_win_range check (minimum_win_chance between 1 and 25);
alter table public.game_config enable row level security;
-- RESTRICTIVE UPDATE policy ensures other permissive policies cannot bypass admin check.
drop policy if exists "economy_admin_only_update" on public.game_config;
create policy "economy_admin_only_update" on public.game_config
  as restrictive for update to authenticated
  using (exists(select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_admin = true))
  with check (exists(select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_admin = true));
-- Important: also audit profiles RLS to prevent users changing their own is_admin.
