-- Preserve every previous server-side game save before updates or deletes.
-- History is private and not exposed through Supabase's Data API.
create schema if not exists private;

create table if not exists private.game_save_history (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  save jsonb not null,
  revision bigint not null,
  source_id text,
  original_updated_at timestamptz not null,
  archived_at timestamptz not null default now(),
  action text not null check (action in ('baseline', 'update', 'delete'))
);

create index if not exists game_save_history_user_archived_idx
  on private.game_save_history (user_id, archived_at desc, id desc);

alter table private.game_save_history enable row level security;
revoke all on schema private from public, anon, authenticated;
revoke all on private.game_save_history from public, anon, authenticated;
revoke all on sequence private.game_save_history_id_seq from public, anon, authenticated;

-- Keep an initial recoverable snapshot for every save present at migration time.
insert into private.game_save_history
  (user_id, save, revision, source_id, original_updated_at, action)
select s.user_id, s.save, s.revision, s.source_id, s.updated_at, 'baseline'
from public.game_saves s
where not exists (
  select 1 from private.game_save_history h where h.user_id = s.user_id
);

create or replace function private.archive_game_save()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, private
as $$
begin
  insert into private.game_save_history
    (user_id, save, revision, source_id, original_updated_at, action)
  values
    (old.user_id, old.save, old.revision, old.source_id, old.updated_at, lower(tg_op));
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function private.archive_game_save() from public, anon, authenticated;

drop trigger if exists archive_game_save_before_change on public.game_saves;
create trigger archive_game_save_before_change
before update or delete on public.game_saves
for each row execute function private.archive_game_save();
