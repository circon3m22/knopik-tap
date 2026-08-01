create table if not exists public.game_config (
  id boolean primary key default true,
  difficulty smallint not null default 50 check (difficulty between 0 and 100),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint game_config_singleton check (id = true)
);

insert into public.game_config (id, difficulty)
values (true, 50)
on conflict (id) do nothing;

alter table public.game_config enable row level security;

revoke all on table public.game_config from public, anon, authenticated;
grant select, update on table public.game_config to authenticated;

drop policy if exists "authenticated players can read game config" on public.game_config;
create policy "authenticated players can read game config"
on public.game_config
for select
to authenticated
using (id = true);

drop policy if exists "admins can update game config" on public.game_config;
create policy "admins can update game config"
on public.game_config
for update
to authenticated
using (
  id = true
  and exists (
    select 1
    from public.profiles
    where profiles.id = (select auth.uid())
      and profiles.is_admin = true
  )
)
with check (
  id = true
  and difficulty between 0 and 100
  and exists (
    select 1
    from public.profiles
    where profiles.id = (select auth.uid())
      and profiles.is_admin = true
  )
);
