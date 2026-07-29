import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../supabase/migrations/20260729160421_create_knopik_cloud_accounts.sql",
  import.meta.url,
);

test("cloud schema enables RLS and scopes player saves", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /alter table public\.profiles enable row level security/i);
  assert.match(sql, /alter table public\.game_saves enable row level security/i);
  assert.match(sql, /alter table public\.coin_grants enable row level security/i);
  assert.match(sql, /\(select auth\.uid\(\)\) = user_id/i);
  assert.match(sql, /security invoker/i);
  assert.doesNotMatch(sql, /auth\.role\(\)/i);
});

test("admin grants and player saves use atomic revisions", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /create or replace function public\.admin_grant_coins/i);
  assert.match(sql, /create or replace function public\.save_game_progress/i);
  assert.match(sql, /and revision = expected_revision/i);
  assert.match(sql, /revision = revision \+ 1/i);
  assert.match(sql, /insert into public\.coin_grants/i);
});
