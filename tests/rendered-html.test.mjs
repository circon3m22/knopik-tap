import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import test from 'node:test';
const html = await readFile(new URL('../.next/server/app/index.html', import.meta.url), 'utf8');

test('static build renders a secure loading screen without exposing game data', () => {
  assert.match(html, /<html lang="ru"/);
  assert.match(html, /<title>KNOPIK TAP<\/title>/);
  assert.match(html, /login-screen/);
  assert.match(html, /Загружаем игру/);
  assert.doesNotMatch(html, /data-testid="knopik"|password_hash|service_role|123456/);
  assert.doesNotMatch(html, /maximum-scale=1|user-scalable=no/);
});
test('every exported script, stylesheet and first-frame image has a local build artifact', async () => {
  const urls = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(match => match[1]);
  const assets = urls.filter(url => /\.(js|css|png|webp)(?:\?|$)/.test(url) && !url.startsWith('http'));
  assert.ok(assets.some(url => url.endsWith('.js')));
  assert.ok(assets.some(url => url.endsWith('.css')));
  for (const url of assets) {
    const path = url.replace(/^\/knopik-tap/, '').split('?')[0];
    await access(new URL(path.startsWith('/_next/') ? `../.next/${path.slice(7)}` : `../public${path}`, import.meta.url));
  }
  if (process.env.GITHUB_PAGES === 'true') assert.ok(assets.every(url => url.startsWith('/knopik-tap/')));
});
test('PWA starts inside the repository path and its offline shell has no missing assets', async () => {
  const manifest = JSON.parse(await readFile(new URL('../public/manifest.webmanifest', import.meta.url)));
  assert.equal(manifest.start_url, './'); assert.equal(manifest.scope, './');
  assert.equal(manifest.theme_color, '#ffffff');
  assert.equal(manifest.display, 'standalone');
  const worker = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
  for (const match of worker.matchAll(/asset\("([^\"]+)"\)/g)) if (match[1] !== '/') await access(new URL(`../public${match[1]}`, import.meta.url));
});
