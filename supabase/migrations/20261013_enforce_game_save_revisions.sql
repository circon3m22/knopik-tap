-- Block silent last-writer-wins overwrites by unversioned clients.
-- The existing save_game_progress and admin/promo RPCs already increment revision.
-- Clients that still update game_saves directly must upgrade before saving.
create or replace function private.require_game_save_revision()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if new.revision <> old.revision + 1 then
    raise exception using
      errcode = '23514',
      message = 'Game save write rejected: revision must increase exactly once';
  end if;
  return new;
end;
$$;

revoke all on function private.require_game_save_revision() from public, anon, authenticated;

drop trigger if exists require_game_save_revision_before_update on public.game_saves;
create trigger require_game_save_revision_before_update
before update on public.game_saves
for each row execute function private.require_game_save_revision();
