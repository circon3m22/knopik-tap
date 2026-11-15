import { cappedAdd, whole } from "./adventure-engine.ts";

export type CasinoKind = "coin" | "dice" | "tower";
export type PracticeKind = "timing" | "memory";
export type ArcadeKind =
  | "roulette"
  | "slots"
  | "mines"
  | CasinoKind
  | PracticeKind;
export const ARCADE_GAMES: readonly {
  id: ArcadeKind;
  title: string;
  subtitle: string;
  category: "skill" | "luck";
  color: string;
  unlock: number;
  badge?: string;
  rules: string;
}[] = [
  {
    id: "timing",
    title: "Точный тап",
    subtitle: "Поймай момент",
    category: "skill",
    color: "green",
    unlock: 0,
    badge: "Новое",
    rules:
      "Останови бегунок в зелёной зоне. Три попытки: два попадания — победа. Вход бесплатный, за игру — 10 XP, за победу — 40 XP и 25 монет.",
  },
  {
    id: "memory",
    title: "Память Кнопика",
    subtitle: "Повтори узор",
    category: "skill",
    color: "purple",
    unlock: 0,
    badge: "Новое",
    rules:
      "Запомни последовательность четырёх плиток и повтори её. Три раунда: два верных — победа. Бесплатно. За игру — 10 XP, за победу — 40 XP и 25 монет.",
  },
  {
    id: "roulette",
    title: "Колесо удачи",
    subtitle: "Выбери свой сектор",
    category: "luck",
    color: "blue",
    unlock: 0,
    rules:
      "Знакомая рулетка: выбери сектор перед вращением. Запас Питбуля служит билетом; если его нет, вход стоит 200 монет. Ставка списывается отдельно. Без эрокеза на кону весь оставшийся активный баланс. Итог зависит от сложности игры, сейф не участвует.",
  },
  {
    id: "slots",
    title: "Три барабана",
    subtitle: "Собери комбинацию",
    category: "luck",
    color: "orange",
    unlock: 0,
    rules:
      "Пара — ×1,35, три одинаковых — ×3,2, три семёрки — ×4, три алмаза — ×6. Запас Какао служит билетом, иначе вход 200 монет. Без эрокеза ставка — весь оставшийся активный баланс. Вероятности зависят от сложности игры. Выплата включает ставку.",
  },
  {
    id: "mines",
    title: "Пять кнопок",
    subtitle: "Рискни или забери",
    category: "luck",
    color: "pink",
    unlock: 0,
    rules:
      "Выбирай кнопку, после успеха забери выигрыш или продолжай. До 10 раундов. Запас Бергамота служит билетом, иначе вход 300 монет. Без эрокеза ставка — весь оставшийся активный баланс. Вероятность успеха зависит от сложности игры; выплата включает ставку.",
  },
  {
    id: "coin",
    title: "Монетка",
    subtitle: "Солнце или луна?",
    category: "luck",
    color: "yellow",
    unlock: 2,
    badge: "Новое",
    rules:
      "Выбери солнце или луну. Шанс каждой стороны ровно 50%. При совпадении выплата ×1,9, включая ставку. Вход бесплатный, размер ставки выбираешь сам. За завершённый раунд — 10 XP независимо от результата.",
  },
  {
    id: "dice",
    title: "Кубик",
    subtitle: "Меньше или больше",
    category: "luck",
    color: "blue",
    unlock: 6,
    badge: "Новое",
    rules:
      "Предскажи число: 1–3 или 4–6. Шанс каждого исхода 50%, кубик имеет шесть равновероятных граней. Победа возвращает ×1,9 ставки. Вход бесплатный, за раунд — 10 XP независимо от исхода.",
  },
  {
    id: "tower",
    title: "Башня сокровищ",
    subtitle: "Пять этажей наверх",
    category: "luck",
    color: "purple",
    unlock: 12,
    badge: "Новое",
    rules:
      "На каждом этаже две безопасные плитки из трёх. Шанс успеха 2/3. После успеха можно забрать выплату или подняться. Множители: ×1,4 / ×2,1 / ×3,15 / ×4,72 / ×7,08, включая ставку. На пятом этаже автоматический вывод. Вход бесплатный, завершение даёт 10 XP.",
  },
];

export const TOWER_MULTIPLIERS = [1.4, 2.1, 3.15, 4.72, 7.08] as const;
export function randomUnit(random: () => number): number {
  const value = random();
  return Number.isFinite(value) ? Math.min(0.999999999, Math.max(0, value)) : 0;
}
export function casinoBet(balance: number, requested: number): number {
  return Math.min(whole(balance), Math.max(1, whole(requested)));
}
export function casinoPayout(bet: number, multiplier: number): number {
  return whole(whole(bet) * multiplier);
}
export function flipCoin(choice: number, random: () => number = Math.random) {
  const face = Math.floor(randomUnit(random) * 2);
  return { face, won: face === choice };
}
export function rollDice(choice: number, random: () => number = Math.random) {
  const face = Math.floor(randomUnit(random) * 6) + 1;
  return { face, won: choice === (face <= 3 ? 0 : 1) };
}
export function towerPick(
  selected: number,
  random: () => number = Math.random,
) {
  const danger = Math.floor(randomUnit(random) * 3);
  return {
    danger,
    safe:
      Number.isInteger(selected) &&
      selected >= 0 &&
      selected < 3 &&
      selected !== danger,
  };
}

export type CasinoRound = {
  id: number;
  kind: CasinoKind;
  bet: number;
  settled: boolean;
};
/** Parent owns this ledger: rapid clicks or repeated result callbacks cannot pay twice. */
export function settleCasino(
  round: CasinoRound | null,
  id: number,
  balance: number,
  payout: number,
) {
  if (!round || round.id !== id || round.settled) return null;
  const maximum = round.kind === "tower" ? TOWER_MULTIPLIERS[4] : 1.9;
  const paid = Math.min(whole(payout), casinoPayout(round.bet, maximum));
  return {
    round: { ...round, settled: true },
    balance: cappedAdd(balance, paid),
    paid,
  };
}
export function timingPosition(elapsedMs: number): number {
  const phase = (Math.max(0, elapsedMs) % 1_600) / 800;
  return phase <= 1 ? phase : 2 - phase;
}
export function timingHit(position: number): boolean {
  return Number.isFinite(position) && position >= 0.36 && position <= 0.64;
}
export function memoryPattern(random: () => number = Math.random): number[] {
  return Array.from({ length: 4 }, () => Math.floor(randomUnit(random) * 4));
}
