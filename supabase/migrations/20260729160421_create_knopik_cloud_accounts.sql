create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique,
  is_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_username_format check (username ~ '^[A-Za-z0-9_-]{3,32}$')
);

create table public.game_saves (
  user_id uuid primary key references auth.users (id) on delete cascade,
  save jsonb not null default '{
    "version": 11,
    "vaultCoins": 0,
    "walletCoins": 0,
    "foodCount": 0,
    "drinkCount": 0,
    "pitbullCount": 0,
    "hatOwned": false,
    "hatEquipped": false,
    "mohawkOwned": false,
    "mohawkEquipped": false,
    "hasbulaRedeemed": false,
    "riskFatigueUntil": 0,
    "riskSpins": 0,
    "riskWins": 0,
    "riskLosses": 0,
    "lastRiskBet": 0,
    "lastRiskChance": 50,
    "boostUntil": 0,
    "settings": {"sound": true, "vibration": true, "suliman": false, "yellow": false},
    "tutorialSeen": false,
    "bestStreak": 0,
    "totalTaps": 0,
    "totalBites": 0,
    "ultraFatigueUntil": 0,
    "level": 1,
    "levelCoins": 0
  }'::jsonb,
  revision bigint not null default 0,
  source_id text,
  updated_at timestamptz not null default now(),
  constraint game_saves_save_is_object check (jsonb_typeof(save) = 'object')
);

create table public.coin_grants (
  id bigint generated always as identity primary key,
  admin_user_id uuid not null references auth.users (id) on delete restrict,
  recipient_user_id uuid not null references auth.users (id) on delete cascade,
  amount bigint not null,
  created_at timestamptz not null default now(),
  constraint coin_grants_amount_range check (amount between 1 and 1000000000)
);

create index coin_grants_admin_user_id_idx
  on public.coin_grants (admin_user_id);
create index coin_grants_recipient_user_id_created_at_idx
  on public.coin_grants (recipient_user_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.game_saves enable row level security;
alter table public.coin_grants enable row level security;

create policy "authenticated users can read player names"
  on public.profiles for select
  to authenticated
  using (true);

create policy "players can read their own save"
  on public.game_saves for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "admins can read player saves"
  on public.game_saves for select
  to authenticated
  using (
    exists (
      select 1
      from public.profiles
      where profiles.id = (select auth.uid())
        and profiles.is_admin
    )
  );

create policy "players can create their own save"
  on public.game_saves for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "players can update their own save"
  on public.game_saves for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "admins can update player saves"
  on public.game_saves for update
  to authenticated
  using (
    exists (
      select 1
      from public.profiles
      where profiles.id = (select auth.uid())
        and profiles.is_admin
    )
  )
  with check (
    exists (
      select 1
      from public.profiles
      where profiles.id = (select auth.uid())
        and profiles.is_admin
    )
  );

create policy "players can read their grants"
  on public.coin_grants for select
  to authenticated
  using (
    recipient_user_id = (select auth.uid())
    or exists (
      select 1
      from public.profiles
      where profiles.id = (select auth.uid())
        and profiles.is_admin
    )
  );

create policy "admins can record grants"
  on public.coin_grants for insert
  to authenticated
  with check (
    admin_user_id = (select auth.uid())
    and exists (
      select 1
      from public.profiles
      where profiles.id = (select auth.uid())
        and profiles.is_admin
    )
  );

grant select on public.profiles to authenticated;
grant select, insert, update on public.game_saves to authenticated;
grant select, insert on public.coin_grants to authenticated;
grant usage, select on sequence public.coin_grants_id_seq to authenticated;
grant usage on schema public to authenticated;

create or replace function private.handle_new_knopik_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_username text;
begin
  requested_username := coalesce(
    nullif(new.raw_user_meta_data ->> 'username', ''),
    split_part(new.email, '@', 1)
  );

  insert into public.profiles (id, username)
  values (new.id, requested_username);

  insert into public.game_saves (user_id)
  values (new.id);

  return new;
end;
$$;

revoke execute on function private.handle_new_knopik_user() from public, anon, authenticated;
grant usage on schema private to supabase_auth_admin;
grant execute on function private.handle_new_knopik_user() to supabase_auth_admin;

create trigger on_knopik_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_knopik_user();

create or replace function public.admin_grant_coins(
  target_user_id uuid,
  coin_amount bigint
)
returns public.game_saves
language plpgsql
security invoker
set search_path = ''
as $$
declare
  updated_save public.game_saves;
  current_wallet bigint;
begin
  if coin_amount is null or coin_amount < 1 or coin_amount > 1000000000 then
    raise exception 'Coin amount must be between 1 and 1000000000';
  end if;

  if not exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and is_admin
  ) then
    raise exception 'Administrator access required';
  end if;

  select case
    when jsonb_typeof(save -> 'walletCoins') = 'number'
      and (save ->> 'walletCoins') ~ '^[0-9]+$'
      then least((save ->> 'walletCoins')::bigint, 9007199254740991)
    else 0
  end
  into current_wallet
  from public.game_saves
  where user_id = target_user_id;

  if not found then
    raise exception 'Target player does not exist';
  end if;

  update public.game_saves
  set save = jsonb_set(
        save,
        '{walletCoins}',
        to_jsonb(least(9007199254740991, current_wallet + coin_amount)),
        true
      ),
      revision = revision + 1,
      source_id = 'admin:' || (select auth.uid())::text,
      updated_at = now()
  where user_id = target_user_id
  returning * into updated_save;

  insert into public.coin_grants (admin_user_id, recipient_user_id, amount)
  values ((select auth.uid()), target_user_id, coin_amount);

  return updated_save;
end;
$$;

revoke all on function public.admin_grant_coins(uuid, bigint) from public, anon;
grant execute on function public.admin_grant_coins(uuid, bigint) to authenticated;

create or replace function public.save_game_progress(
  new_save jsonb,
  expected_revision bigint,
  save_source_id text
)
returns public.game_saves
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_save public.game_saves;
begin
  if jsonb_typeof(new_save) <> 'object' then
    raise exception 'Save payload must be a JSON object';
  end if;

  if save_source_id is null or length(save_source_id) not between 1 and 160 then
    raise exception 'Invalid save source';
  end if;

  update public.game_saves
  set save = new_save,
      revision = revision + 1,
      source_id = save_source_id,
      updated_at = now()
  where user_id = (select auth.uid())
    and revision = expected_revision
  returning * into current_save;

  if found then
    return current_save;
  end if;

  select *
  into current_save
  from public.game_saves
  where user_id = (select auth.uid());

  if not found then
    raise exception 'Player save does not exist';
  end if;

  return current_save;
end;
$$;

revoke all on function public.save_game_progress(jsonb, bigint, text) from public, anon;
grant execute on function public.save_game_progress(jsonb, bigint, text) to authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'game_saves'
  ) then
    execute 'alter publication supabase_realtime add table public.game_saves';
  end if;
end;
$$;
