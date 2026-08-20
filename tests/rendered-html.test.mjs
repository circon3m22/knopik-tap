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

test("server-renders the Knopik Tap account gateway", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>KNOPIK TAP<\/title>/i);
  assert.match(html, /manifest\.webmanifest/);
  assert.match(html, /apple-touch-icon-v2\.png/);
  assert.match(html, /icon-192-v2\.png/);
  assert.match(html, /og\.png/);
  assert.match(html, /class="auth-screen"/);
  assert.match(html, /class="auth-loader"/);
  assert.match(html, /aria-label="Загрузка профиля"/);
  assert.doesNotMatch(html, /data-testid="knopik"/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Your site is taking shape/i);
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
