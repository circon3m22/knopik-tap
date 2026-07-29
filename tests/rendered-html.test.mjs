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

test("server-renders the complete Knopik Tap game", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>KNOPIK TAP<\/title>/i);
  assert.match(html, /manifest\.webmanifest/);
  assert.match(html, /data-testid="knopik"/);
  assert.match(html, /knopik-calm\.png/);
  assert.match(html, /knopik-warning\.png/);
  assert.match(html, /knopik-angry\.png/);
  assert.match(html, /Экран белый, пока Кнопик спокоен/);
  assert.match(html, /<span>Сейф<\/span>/);
  assert.match(html, /УРОВЕНЬ/);
  assert.match(html, /class="saved-balance"/);
  assert.match(html, /class="bottom-bar"/);
  assert.doesNotMatch(html, /state-copy|moment-message/);
  assert.doesNotMatch(html, /Начинай быстро — Кнопик не любит паузы/);
  assert.doesNotMatch(html, /Тёмный синий означает устойчивый темп/);
  assert.doesNotMatch(html, /series-track|Серия 0/);
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
    access(new URL("../public/knopik-calm.png", import.meta.url)),
    access(new URL("../public/knopik-warning.png", import.meta.url)),
    access(new URL("../public/knopik-angry.png", import.meta.url)),
    access(new URL("../public/og-minimal.png", import.meta.url)),
    access(new URL("../public/sw.js", import.meta.url)),
  ]);
});
