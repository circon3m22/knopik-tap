import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the secure boot shell and preloads all game art", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>KNOPIK TAP<\/title>/i);
  assert.match(html, /manifest\.webmanifest/);
  assert.match(html, /apple-touch-icon-v2\.png/);
  assert.match(html, /icon-192-v2\.png/);
  assert.match(html, /og\.png/);
  assert.match(html, /class="boot-splash(?:\s|\")/);
  assert.match(html, /class="auth-screen(?:\s|\")/);
  assert.match(html, /class="auth-loading-brand(?:\s|\")/);
  assert.match(html, /class="auth-loading-logo(?:\s|\")/);
  assert.doesNotMatch(html, /data-testid="knopik"/);
  assert.match(html, /knopik-joy-sprite-earless\.webp/);
  assert.match(html, /knopik-rage-sprite-earless\.webp/);
  assert.match(html, /knopik-ear-left\.png/);
  assert.match(html, /knopik-ear-right\.png/);
  assert.match(html, /knopik-warning-earless\.webp/);
  for (const asset of [
    "knopik-calm-earless.webp",
    "knopik-joy-sprite-earless.webp",
    "knopik-warning-earless.webp",
    "knopik-rage-sprite-earless.webp",
    "knopik-ear-left.png",
    "knopik-ear-right.png",
    "buffs/food.png",
    "buffs/zhivchik.png",
    "buffs/pitbull.png",
    "buffs/cocoa-cola.png",
    "buffs/bergamot-tea.png",
    "buffs/pepsi.png",
    "hasbik-tubeteika.png",
    "knopik-mohawk-v2.png",
  ]) {
    assert.match(html, new RegExp(asset.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Your site is taking shape/i);
});

test("main interface keeps the requested compact balance and aligned buy badges", async () => {
  const [pageSource, menuStyles, vibrantStyles] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/menu-refresh.css", import.meta.url), "utf8"),
    readFile(new URL("../app/home-vibrant.css", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(pageSource, /<small>АКТИВНЫЕ МОНЕТЫ<\/small>/);
  for (const quickBuyFlag of [
    "canQuickBuyFood",
    "canQuickBuyDrink",
    "canQuickBuyPitbull",
    "canQuickBuyCola",
    "canQuickBuyTea",
    "canQuickBuyVitaPower",
  ]) {
    assert.match(pageSource, new RegExp(`${quickBuyFlag} \\? "\\+"`));
  }
  assert.match(menuStyles, /\.inventory-item > \.inventory-count\.is-price\s*\{[\s\S]*?top:\s*-2px;[\s\S]*?right:\s*-2px;[\s\S]*?display:\s*grid;[\s\S]*?width:\s*18px;[\s\S]*?height:\s*18px;/);
  assert.match(menuStyles, /\.inventory-count\.is-price::before\s*\{[\s\S]*?content:\s*none;/);
  assert.match(menuStyles, /\.vault-row\s*\{[\s\S]*?width:\s*min\(100%,\s*310px\);[\s\S]*?minmax\(122px,\s*0\.76fr\)/);
  assert.match(menuStyles, /\.quick-save-button,[\s\S]*?\.saved-balance\s*\{[\s\S]*?height:\s*36px;/);
  assert.match(menuStyles, /\.saved-balance \.safe-icon\s*\{[\s\S]*?display:\s*inline-block;/);
  assert.match(menuStyles, /@media \(max-height:\s*580px\)[\s\S]*?\.dog-button,[\s\S]*?width:\s*min\(64vw,\s*154px\)/);
  assert.match(pageSource, /className="inventory-timer"/);
  assert.match(pageSource, /bottom-bar\$\{shopOpen \|\| casesOpen \? " is-overlay-nav" : ""\}/);
  assert.match(vibrantStyles, /\.boost-row \.inventory-item[\s\S]*?border-radius:\s*50%;/);
  assert.match(vibrantStyles, /\.bottom-bar\.is-overlay-nav[\s\S]*?z-index:\s*130;/);
  assert.match(vibrantStyles, /\.settings-close\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?top:\s*max\(14px,[\s\S]*?right:\s*max\(14px,/);
});

test("keeps the minimal game scene mood-driven and isolates premium styles to auth", async () => {
  const [layoutSource, pageSource, airStyles, authStyles, accountSource] = await Promise.all([
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/air.css", import.meta.url), "utf8"),
    readFile(new URL("../app/auth-premium.css", import.meta.url), "utf8"),
    readFile(new URL("../app/cloud-account.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(layoutSource, /import "\.\/interface-v2\.css";[\s\S]*?import "\.\/menu-refresh\.css";[\s\S]*?import "\.\/air\.css";[\s\S]*?import "\.\/auth-premium\.css";/);
  assert.match(pageSource, /className="vault-row"/);
  assert.doesNotMatch(pageSource, /balance-transfer|vault-transfer-button/);
  assert.match(airStyles, /\.game-shell\.state-calm,[\s\S]*?--scene:\s*#dcecff;/);
  assert.match(airStyles, /\.game-shell\.state-tired\s*\{[\s\S]*?--scene:\s*#fdf1d2;/);
  assert.match(airStyles, /\.game-shell\.state-warning,[\s\S]*?--scene:\s*#ffe9b4;/);
  assert.match(airStyles, /\.game-shell\.state-angry\s*\{[\s\S]*?--scene:\s*#c02c24;/);
  assert.match(airStyles, /\.game-shell \.dog-button,[\s\S]*?width:\s*min\(74vw,\s*318px,\s*calc\(100dvh - 575px\)\);/);
  assert.doesNotMatch(authStyles, /\.game-shell|\.balance-transfer|\.bottom-bar/);
  assert.match(accountSource, /username:\s*"Kamrad"/);
  assert.match(accountSource, /username:\s*"salaga"/);
});

test("ships PWA assets and removes the temporary starter", async () => {
  const [manifestText, packageText] = await Promise.all([
    readFile(new URL("../public/manifest.webmanifest", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);
  const manifest = JSON.parse(manifestText);
  assert.equal(manifest.name, "Knopik Tap");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.orientation, "portrait");
  assert.doesNotMatch(packageText, /react-loading-skeleton/);
  await assert.rejects(access(new URL("../app/_sites-preview", import.meta.url)));
  await Promise.all([
    access(new URL("../public/knopik-calm-earless.png", import.meta.url)),
    access(new URL("../public/knopik-warning-earless.png", import.meta.url)),
    access(new URL("../public/knopik-joy-sprite-earless.png", import.meta.url)),
    access(new URL("../public/knopik-rage-sprite-earless.png", import.meta.url)),
    access(new URL("../public/knopik-calm-earless.webp", import.meta.url)),
    access(new URL("../public/knopik-warning-earless.webp", import.meta.url)),
    access(new URL("../public/knopik-joy-sprite-earless.webp", import.meta.url)),
    access(new URL("../public/knopik-rage-sprite-earless.webp", import.meta.url)),
    access(new URL("../public/knopik-ear-left.png", import.meta.url)),
    access(new URL("../public/knopik-ear-right.png", import.meta.url)),
    access(new URL("../public/hasbik-tubeteika.png", import.meta.url)),
    access(new URL("../public/knopik-mohawk-v2.png", import.meta.url)),
    access(new URL("../public/apple-touch-icon.png", import.meta.url)),
    access(new URL("../public/icon-192.png", import.meta.url)),
    access(new URL("../public/icon-512.png", import.meta.url)),
    access(new URL("../public/apple-touch-icon-v2.png", import.meta.url)),
    access(new URL("../public/icon-192-v2.png", import.meta.url)),
    access(new URL("../public/icon-512-v2.png", import.meta.url)),
    access(new URL("../public/og-minimal.png", import.meta.url)),
    access(new URL("../public/og.png", import.meta.url)),
    access(new URL("../public/sw.js", import.meta.url)),
  ]);
});
