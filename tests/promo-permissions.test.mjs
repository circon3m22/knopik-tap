import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const [migration, canonicalSql, cloud] = await Promise.all([
  read("../supabase/migrations/20261015_fix_tap_promo_cross_account_permissions.sql"),
  read("../supabase/promo_codes.sql"),
  read("../app/cloud-account.tsx"),
]);

test("promo RPC uses a constrained security-definer gateway to private server code", () => {
  for (const sql of [migration, canonicalSql]) {
    assert.match(sql, /create or replace function public\.redeem_promo_code\(promo_code text\)/i);
    assert.match(sql, /security definer/i);
    assert.match(sql, /set search_path = ''/i);
    assert.match(sql, /auth\.uid\(\)\)*\s+is null/i);
    assert.match(sql, /return private\.redeem_promo_code\(promo_code\)/i);
    assert.match(sql, /revoke (?:all|execute) on function public\.redeem_promo_code\(text\) from public, anon/i);
    assert.match(sql, /grant execute on function public\.redeem_promo_code\(text\) to authenticated/i);
  }
});

test("private schema and save archive are not exposed to normal players", () => {
  assert.doesNotMatch(migration, /grant\s+usage\s+on\s+schema\s+private\s+to\s+authenticated/i);
  assert.match(canonicalSql, /revoke all on schema private from public, anon, authenticated/i);
  assert.match(canonicalSql, /revoke execute on function private\.redeem_promo_code\(text\) from public, anon, authenticated/i);
});

test("promotion is one-use, locked and attributed to the caller's own saved game", () => {
  assert.match(canonicalSql, /where code = normalized_code\s+for update/i);
  assert.match(canonicalSql, /selected_code\.redeemed_by is not null/i);
  assert.match(canonicalSql, /where user_id = caller_id\s+for update/i);
  assert.match(canonicalSql, /revision = revision \+ 1/i);
  assert.match(canonicalSql, /redeemed_by = caller_id/i);
  assert.match(canonicalSql, /where id = caller_id and is_admin = true/i);
});

test("player can activate through the public RPC without admin listing permissions", () => {
  assert.match(cloud, /getSupabaseClient\(\)\.rpc\("redeem_promo_code"/);
  assert.match(cloud, /promo_code: normalizedCode/);
  assert.match(cloud, /if \(currentAccount\.isAdmin\)/);
  assert.match(canonicalSql, /create policy "admins can list promo codes"/i);
  assert.match(canonicalSql, /grant select, insert on table public\.promo_codes to authenticated/i);
});
