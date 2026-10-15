-- Fix cross-account promo redemption after private schema was locked down
-- by the cloud-save history migration.
--
-- Problem: the public RPC was SECURITY INVOKER, so a regular player needed
-- USAGE on private to reach private.redeem_promo_code. Granting private USAGE
-- would unnecessarily expose the entire private function namespace.
--
-- The public authenticated-only wrapper now crosses that boundary using its
-- owner permissions. The internal function continues to authorize auth.uid(),
-- reject administrator redemption, lock the unique code and current player's
-- game save, and increment that player's save revision transactionally.
-- A caller cannot specify another player's account or save data.
create or replace function public.redeem_promo_code(promo_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '28000', message = 'Сначала войди в аккаунт.';
  end if;

  return private.redeem_promo_code(promo_code);
end;
$$;

revoke all on function public.redeem_promo_code(text) from public, anon;
grant execute on function public.redeem_promo_code(text) to authenticated;

-- Do not grant authenticated USAGE on private; archived user saves remain
-- inaccessible, and no additional functions or tables are exposed.
