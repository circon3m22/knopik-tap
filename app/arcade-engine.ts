import { sanitizeSave, type SaveData } from './game-logic.ts';
import { addLevelCoins, levelMultiplier } from './level-engine.ts';
import { createCaseRewards, type CaseKind, type CaseReward } from './case-engine.ts';

export type Mood = 'neutral' | 'happy' | 'warning' | 'angry';
export type Round = NonNullable<SaveData['arcade']>;
export type Game = { save: SaveData; round: Round; hold: number | null; event: number; reward: number; message: string; effect: 'tap' | 'super' | 'bank' | 'bite' | 'shield' | 'reward' | 'none' };
export const ITEMS = [
  { id: 'foodCount', name: 'Корм', detail: 'Снимает всё напряжение', price: 150, image: 'food.png' },
  { id: 'drinkCount', name: 'Живчик', detail: 'Монеты ×4 на 60 секунд', price: 300, image: 'zhivchik.png' },
  { id: 'pitbullCount', name: 'Питбуль', detail: 'Открывает колесо риска', price: 200, image: 'pitbull.png' },
  { id: 'colaCount', name: 'Какао-Кола', detail: 'Одна игра на барабанах', price: 200, image: 'cocoa-cola.png' },
  { id: 'teaCount', name: 'Бергамот', detail: 'Одна игра в мины', price: 300, image: 'bergamot-tea.png' },
  { id: 'vitaPowerCount', name: 'Пепси', detail: 'Защита монет от одного укуса', price: 1500, image: 'pepsi.png' },
] as const;
export type ItemId = typeof ITEMS[number]['id'];
export const MISSIONS = [
  { title: 'Первое знакомство', detail: 'Сделай 50 тапов', target: 50, metric: 'totalTaps' },
  { title: 'В надёжном месте', detail: 'Сохрани 500 монет в сейфе', target: 500, metric: 'vaultCoins' },
  { title: 'Поймать ритм', detail: 'Сделай 250 тапов', target: 250, metric: 'totalTaps' },
  { title: 'Первый выигрыш', detail: 'Выиграй в колесе риска', target: 1, metric: 'riskWins' },
  { title: 'Запас на будущее', detail: 'Накопи 5 000 монет в сейфе', target: 5000, metric: 'vaultCoins' },
  { title: 'На одной волне', detail: 'Сделай 1 000 тапов', target: 1000, metric: 'totalTaps' },
  { title: 'Любимчик', detail: 'Достигни третьего уровня', target: 3, metric: 'level' },
  { title: 'Большая дружба', detail: 'Сделай 5 000 тапов', target: 5000, metric: 'totalTaps' },
] as const;
const clamp = (n: number, max = 100) => Math.min(max, Math.max(0, n));
const sum = (a: number, b: number) => Math.min(Number.MAX_SAFE_INTEGER, a + b);
export function newGame(save: SaveData, now: number): Game {
  const clean = sanitizeSave(save);
  return advance({ save: clean, round: clean.arcade ?? { heat: 0, happiness: 0, combo: 0, lastTap: 0, updatedAt: now, angryUntil: 0 }, hold: null, event: 0, reward: 0, effect: 'none', message: '' }, now);
}
export function mood(game: Game): Mood {
  return game.round.angryUntil > game.round.updatedAt ? 'angry' : game.round.heat >= 70 ? 'warning' : game.round.happiness >= 12 ? 'happy' : 'neutral';
}
export function saveGame(game: Game): SaveData { return { ...game.save, arcade: { ...game.round } }; }
function feedback(g: Game, message: string, effect: Game['effect'] = 'none', reward = 0): Game {
  return { ...g, event: g.event + 1, message, effect, reward };
}
function earn(g: Game, amount: number): Game {
  const level = addLevelCoins({ level: g.save.level, progressCoins: g.save.levelCoins }, amount).state;
  return { ...g, save: { ...g.save, walletCoins: sum(g.save.walletCoins, amount), level: level.level, levelCoins: level.progressCoins } };
}
function bite(g: Game, now: number): Game {
  const shield = g.save.vitaPowerShield;
  return feedback({ ...g, hold: null, round: { ...g.round, heat: 0, happiness: 0, combo: 0, angryUntil: now + 2200 }, save: { ...g.save, vitaPowerShield: false, walletCoins: shield ? g.save.walletCoins : 0, totalBites: sum(g.save.totalBites, 1) } }, shield ? 'Щит спас монеты! Кнопику нужна пауза.' : 'Кнопик укусил! Монеты в сейфе остались целы.', shield ? 'shield' : 'bite');
}
export function advance(game: Game, now: number): Game {
  now = Math.max(game.round.updatedAt, now);
  const idleStart = Math.max(game.round.updatedAt, game.round.lastTap + 800);
  const coolingSeconds = Math.max(0, (now - idleStart) / 1000);
  const happinessDecaySeconds = Math.max(0, (now - Math.max(game.round.updatedAt, game.round.lastTap + 2500)) / 1000);
  const round = { ...game.round, updatedAt: now };
  if (game.hold === null) round.heat = clamp(round.heat - coolingSeconds * 14);
  if (now - round.lastTap > 1600 && game.hold === null) round.combo = 0;
  round.happiness = clamp(round.happiness - happinessDecaySeconds * 3);
  if (round.angryUntil && now >= round.angryUntil) round.angryUntil = 0;
  const next = { ...game, round };
  if (game.hold !== null && now - game.hold >= superLimit(game.save)) return bite(next, now);
  return next;
}
export function superLimit(save: SaveData) { return 2600 + (save.hatEquipped ? save.hatLevel * 150 : 0); }
export function tap(game: Game, now: number, difficulty = 50): Game {
  let g = advance(game, now);
  if (mood(g) === 'angry' || g.hold !== null) return g;
  const interval = now - g.round.lastTap;
  // Ignore synthetic repeats faster than a physical gesture can be resolved.
  if (interval < 65) return g;
  const rhythmic = interval >= 170 && interval <= 1000;
  const combo = rhythmic ? Math.min(50, g.round.combo + 1) : 1;
  const multiplier = 1 + Math.floor(combo / 10);
  const styleBonus = rhythmic && g.save.mohawkEquipped ? 1 + g.save.mohawkLevel * .08 : 1;
  const reward = Math.max(1, Math.round((4 + (rhythmic ? 2 : 0)) * multiplier * styleBonus * levelMultiplier(g.save.level) * (g.save.boostUntil > now ? 4 : 1)));
  const heat = clamp(g.round.heat + (rhythmic ? 1.8 : interval < 170 ? 10 : 3) * (.65 + clamp(difficulty) / 140));
  g = { ...g, round: { ...g.round, heat, happiness: clamp(g.round.happiness + (rhythmic ? 4 : 1)), combo, lastTap: now }, save: { ...g.save, totalTaps: sum(g.save.totalTaps, 1), bestStreak: Math.max(g.save.bestStreak, combo) } };
  if (heat >= 100) return bite(g, now);
  return feedback(earn(g, reward), heat >= 70 ? 'Сбавь темп — Кнопик злится.' : rhythmic ? 'В ритме' : 'Тап!', 'tap', reward);
}
export function startSuper(game: Game, now: number): Game {
  const g = advance(game, now);
  if (mood(g) === 'angry' || g.hold !== null) return g;
  return feedback({ ...g, hold: now }, 'Отпусти в синей зоне.', 'none');
}
export function finishSuper(game: Game, now: number, cancelled = false): Game {
  const started = game.hold;
  const g = advance(game, now);
  if (started === null || g.hold === null) return g;
  const released = { ...g, hold: null };
  if (cancelled || now - started < 400) return feedback(released, 'Заряд отменён.');
  const seconds = (now - started) / 1000;
  const perfect = seconds >= 1 && seconds <= 1.8;
  const reward = Math.round(seconds * (perfect ? 100 : 35) * levelMultiplier(g.save.level) * (g.save.boostUntil > now ? 4 : 1));
  const heat = clamp(g.round.heat + seconds * 13);
  const next = { ...released, round: { ...g.round, heat, lastTap: now, happiness: clamp(g.round.happiness + (perfect ? 24 : 5)) } };
  if (heat >= 100) return bite(next, now);
  return feedback(earn(next, reward), perfect ? 'Идеальный супертап!' : 'Супертап!', 'super', reward);
}
export function bank(game: Game): Game {
  if (game.save.walletCoins <= 0 || game.hold !== null || mood(game) === 'angry') return game;
  const amount = game.save.walletCoins;
  return feedback({ ...game, save: { ...game.save, walletCoins: 0, vaultCoins: sum(game.save.vaultCoins, amount) } }, `${amount.toLocaleString('ru-RU')} монет в сейфе`, 'bank', amount);
}
export function buy(game: Game, id: ItemId | 'hat' | 'mohawk' | CaseKind): Game {
  const item = ITEMS.find(i => i.id === id);
  const price = item?.price ?? ({ hat: 5000, mohawk: 10000, common: 2500, big: 25000 } as Record<string, number>)[id];
  const s = game.save;
  if (!price || game.hold !== null || s.walletCoins + s.vaultCoins < price) return feedback(game, 'Недостаточно монет.');
  if (item && s[item.id] >= 25) return feedback(game, 'В рюкзаке уже 25 таких предметов.');
  if ((id === 'hat' && s.hatOwned) || (id === 'mohawk' && s.mohawkOwned)) return feedback(game, 'Этот предмет уже есть.');
  if ((id === 'common' && s.commonCases >= 99) || (id === 'big' && s.bigCases >= 99)) return feedback(game, 'Сначала открой накопленные кейсы.');
  const walletUsed = Math.min(price, s.walletCoins);
  const save = { ...s, walletCoins: s.walletCoins - walletUsed, vaultCoins: s.vaultCoins - (price - walletUsed) };
  if (item) save[item.id]++;
  if (id === 'hat') { save.hatOwned = true; save.hatEquipped = true; save.mohawkEquipped = false; }
  if (id === 'mohawk') { save.mohawkOwned = true; save.mohawkEquipped = true; save.hatEquipped = false; }
  if (id === 'common') save.commonCases++;
  if (id === 'big') save.bigCases++;
  return feedback({ ...game, save }, 'Покупка в рюкзаке.', 'reward');
}
export function useItem(game: Game, id: ItemId, now: number): Game {
  const g = advance(game, now);
  if (!g.save[id] || g.hold !== null || mood(g) === 'angry') return g;
  if (id === 'vitaPowerCount' && g.save.vitaPowerShield) return feedback(g, 'Щит уже активен.');
  if (id === 'drinkCount' && g.save.boostUntil > now) return feedback(g, 'Живчик ещё действует.');
  const save = { ...g.save, [id]: g.save[id] - 1 };
  const round = { ...g.round };
  if (id === 'foodCount') { round.heat = 0; round.happiness = clamp(round.happiness + 25); }
  if (id === 'drinkCount') save.boostUntil = now + 60000;
  if (id === 'vitaPowerCount') save.vitaPowerShield = true;
  return feedback({ ...g, save, round }, id === 'foodCount' ? 'Кнопик сыт и доволен.' : id === 'drinkCount' ? '60 секунд с монетами ×4.' : id === 'vitaPowerCount' ? 'Щит активирован.' : 'Игра открыта.', 'reward');
}
export function equip(game: Game, kind: 'hat' | 'mohawk', upgrade = false): Game {
  const save = { ...game.save };
  if (kind === 'hat' && !save.hatOwned || kind === 'mohawk' && !save.mohawkOwned) return game;
  if (upgrade) {
    const level = kind === 'hat' ? 'hatLevel' : 'mohawkLevel';
    const tokens = kind === 'hat' ? 'hatUpgradeTokens' : 'mohawkUpgradeTokens';
    if (!save[tokens] || save[level] >= 5) return game;
    save[tokens]--; save[level]++;
  } else if (kind === 'hat') { save.hatEquipped = !save.hatEquipped; save.mohawkEquipped = false; }
  else { save.mohawkEquipped = !save.mohawkEquipped; save.hatEquipped = false; }
  return feedback({ ...game, save }, upgrade ? 'Предмет улучшен.' : 'Образ обновлён.', 'reward');
}
export function claimMission(game: Game): Game {
  const m = MISSIONS[game.save.questIndex];
  if (!m || game.save[m.metric] < m.target || game.save.commonCases >= 99) return game;
  return feedback({ ...game, save: { ...game.save, questIndex: game.save.questIndex + 1, commonCases: game.save.commonCases + 1 } }, 'Задание выполнено. Обычный кейс твой!', 'reward');
}
export function openCase(game: Game, kind: CaseKind, random = Math.random): { game: Game; rewards: CaseReward[] } {
  const key = kind === 'common' ? 'commonCases' : 'bigCases';
  if (!game.save[key]) return { game, rewards: [] };
  let g = { ...game, save: { ...game.save, [key]: game.save[key] - 1 } };
  const rewards = createCaseRewards(kind, random);
  const keys = { food: 'foodCount', drink: 'drinkCount', pitbull: 'pitbullCount', cola: 'colaCount', tea: 'teaCount', shield: 'vitaPowerCount' } as const;
  for (const r of rewards) {
    if (r.type === 'coins') g = earn(g, r.amount);
    else if (r.type === 'buff') {
      const key = keys[r.kind]; const accepted = Math.min(r.amount, 25 - g.save[key]);
      g.save[key] += accepted;
      if (accepted < r.amount) g = earn(g, (r.amount - accepted) * (ITEMS.find(i => i.id === key)?.price ?? 150));
    } else if (r.type === 'upgrade') {
      const key = r.kind === 'hat' ? 'hatUpgradeTokens' : 'mohawkUpgradeTokens';
      if (g.save[key] < 99) g.save[key]++; else g = earn(g, 500);
    } else {
      const key = r.kind === 'hat' ? 'hatOwned' : 'mohawkOwned';
      if (g.save[key]) g = earn(g, r.kind === 'hat' ? 2500 : 5000); else g.save[key] = true;
    }
  }
  return { game: feedback(g, 'Награды уже в рюкзаке. Дубликаты сверх лимита обменены на монеты.', 'reward'), rewards };
}
export function commitBet(game: Game, amount: number): Game {
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > game.save.walletCoins) return game;
  return { ...game, save: { ...game.save, walletCoins: game.save.walletCoins - amount, lastRiskBet: amount } };
}
export function settleBet(game: Game, kind: 'risk' | 'slots' | 'mines', payout: number, won: boolean): Game {
  if (!Number.isSafeInteger(payout) || payout < 0) return game;
  const g = earn(game, payout);
  if (kind === 'risk') { g.save.riskSpins++; g.save[won ? 'riskWins' : 'riskLosses']++; }
  if (kind === 'slots') { g.save.slotPlays++; if (won) g.save.slotWins++; }
  if (kind === 'mines') { g.save.minePlays++; g.save[won ? 'mineWins' : 'mineLosses']++; }
  return feedback(g, won ? `Выигрыш: ${payout.toLocaleString('ru-RU')} монет` : 'В этот раз без выигрыша. Сейф в безопасности.', won ? 'reward' : 'none', payout);
}
