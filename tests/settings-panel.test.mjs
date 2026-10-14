import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const layout = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../app/settings-panel.css", import.meta.url), "utf8");

const settingsStart = page.indexOf("{settingsOpen && (");
const adminStart = page.indexOf("{adminOpen && account.isAdmin && (", settingsStart);
assert.ok(settingsStart > 0 && adminStart > settingsStart);
const settings = page.slice(settingsStart, adminStart);

test("normal settings use a full-screen administrator-style dialog, close button and title", () => {
  assert.match(settings, /modal-backdrop player-settings-backdrop/);
  assert.match(settings, /settings-sheet player-settings-sheet/);
  assert.match(settings, /admin-panel-heading player-settings-heading/);
  assert.match(settings, /admin-close-button/);
  assert.match(settings, /aria-label="Закрыть настройки"/);
  assert.match(settings, /onClick=\{closeSettings\}/);
  assert.match(settings, /aria-labelledby="settings-title"/);
  assert.match(layout, /import "\.\/settings-panel\.css";/);
  assert.match(css, /\.settings-sheet\.player-settings-sheet/);
  assert.match(css, /height: 100dvh/);
  assert.match(css, /max-width: 600px/);
  assert.match(css, /background: #f0f5fa/);
  assert.match(css, /background: #fff/);
});

test("player features are not dropped during the restyle", () => {
  for (const label of [
    "Аккаунт", "Игра", "Звук", "Бонусы", "Дополнительно", "Чит-код",
    "Повторить обучение", "Журнал обновлений", "Сбросить прогресс", "Статистика",
    "Выйти из аккаунта",
  ]) {
    assert.ok(settings.includes(label), `missing settings control: ${label}`);
  }
  assert.match(settings, /aria-checked=\{settings\.sound\}/);
  assert.match(settings, /role="switch"/);
  assert.match(settings, /onRedeemPromoCode/); // action is still available through the game scope
  assert.match(settings, /resetConfirmOpen/);
  assert.match(settings, /className="confirm-reset"/);
  assert.match(settings, /onClick=\{resetProgress\}/);
  assert.match(settings, /stats\.totalTaps/);
  assert.match(settings, /stats\.totalBites/);
});

test("admin permissions and entry point stay separate from player settings", () => {
  assert.match(settings, /\{account\.isAdmin && \(/);
  assert.match(settings, /setAdminOpen\(true\)/);
  assert.match(settings, /\{!account\.isAdmin && \(/);
  assert.match(page.slice(adminStart), /admin-sheet/);
  assert.match(page.slice(adminStart), /\{adminOpen && account\.isAdmin && \(/);
});

test("player settings retain safe mobile typography and account state indicators", () => {
  assert.match(settings, /syncState === "conflict"/);
  assert.match(settings, /settings\.suliman \|\| settings\.yellow/);
  assert.match(css, /font-size: 16px/); // prevent iOS zoom on input focus
  assert.match(css, /focus-visible/);
  assert.match(css, /prefers-reduced-motion|backdrop-filter: none/);
  assert.match(css, /env\(safe-area-inset-top\)/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
});
