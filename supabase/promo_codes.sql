-- One-time coin promo codes for KNOPIK TAP.
-- Applied to Supabase project uxxzvjwsexdoqcevzipu as migration create_one_time_promo_codes.

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create table if not exists public.promo_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  amount integer not null,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  redeemed_by uuid references public.profiles(id) on delete set null,
  redeemed_at timestamptz,
  constraint promo_codes_code_format check (code ~ '^[A-Z0-9_-]{3,32}$'),
  constraint promo_codes_amount_range check (amount between 1 and 1000000000),
  constraint promo_codes_redemption_state check (
    (redeemed_by is null and redeemed_at is null)
    or (redeemed_by is not null and redeemed_at is not null)
  )
);

create index if not exists promo_codes_created_by_created_at_idx
  on public.promo_codes (created_by, created_at desc);

create index if not exists promo_codes_redeemed_by_idx
  on public.promo_codes (redeemed_by)
  where redeemed_by is not null;

alter table public.promo_codes enable row level security;
revoke all on table public.promo_codes from public, anon, authenticated;
grant select, insert on table public.promo_codes to authenticated;

drop policy if exists "admins can list promo codes" on public.promo_codes;
create policy "admins can list promo codes"
  on public.promo_codes
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.profiles
      where profiles.id = (select auth.uid())
        and profiles.is_admin = true
    )
  );

drop policy if exists "admins can create promo codes" on public.promo_codes;
create policy "admins can create promo codes"
  on public.promo_codes
  for insert
  to authenticated
  with check (
    created_by = (select auth.uid())
    and exists (
      select 1
      from public.profiles
      where profiles.id = (select auth.uid())
        and profiles.is_admin = true
    )
  );

create or replace function private.redeem_promo_code(promo_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  normalized_code text := upper(trim(promo_code));
  selected_code public.promo_codes%rowtype;
  current_save jsonb;
  current_wallet bigint := 0;
  next_wallet bigint;
  next_save jsonb;
begin
  if caller_id is null then
    raise exception using errcode = '28000', message = 'Сначала войди в аккаунт.';
  end if;

  if normalized_code !~ '^[A-Z0-9_-]{3,32}$' then
    raise exception using errcode = '22023', message = 'Проверь формат промокода.';
  end if;

  if exists (
    select 1
    from public.profiles
    where id = caller_id and is_admin = true
  ) then
    raise exception using errcode = '42501', message = 'Промокоды предназначены для другого игрока.';
  end if;

  select *
  into selected_code
  from public.promo_codes
  where code = normalized_code
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Промокод не найден.';
  end if;

  if selected_code.redeemed_by is not null then
    raise exception using errcode = '23505', message = 'Этот промокод уже использован.';
  end if;

  select save
  into current_save
  from public.game_saves
  where user_id = caller_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Сохранение игрока не найдено.';
  end if;

  begin
    current_wallet := greatest(0, coalesce((current_save ->> 'walletCoins')::bigint, 0));
  exception when invalid_text_representation or numeric_value_out_of_range then
    current_wallet := 0;
  end;

  next_wallet := least(9007199254740991::bigint, current_wallet + selected_code.amount);
  next_save := jsonb_set(current_save, '{walletCoins}', to_jsonb(next_wallet), true);

  update public.game_saves
  set save = next_save,
      revision = revision + 1,
      source_id = 'promo:' || selected_code.id::text,
      updated_at = now()
  where user_id = caller_id;

  update public.promo_codes
  set redeemed_by = caller_id,
      redeemed_at = now()
  where id = selected_code.id;

  return jsonb_build_object(
    'amount', selected_code.amount,
    'save', next_save
  );
end;
$$;

revoke execute on function private.redeem_promo_code(text) from public, anon;
grant execute on function private.redeem_promo_code(text) to authenticated;

create or replace function public.redeem_promo_code(promo_code text)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.redeem_promo_code(promo_code);
$$;

revoke execute on function public.redeem_promo_code(text) from public, anon;
grant execute on function public.redeem_promo_code(text) to authenticated;
