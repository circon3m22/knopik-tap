/** Progress belongs to the account save. Currency and XP are deliberately separate. */
export const ADVENTURE_MAX_LEVEL = 30;
export type AdventureProgress = {
  xp: number;
  claimedSteps: number;
  practicePlays: number;
  timingWins: number;
  memoryWins: number;
  casinoPlays: number;
  coinWins: number;
  diceWins: number;
  towerWins: number;
};

export function whole(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.floor(value)))
    : 0;
}
export function cappedAdd(a: number, b: number): number {
  return Math.min(Number.MAX_SAFE_INTEGER, whole(a) + whole(b));
}
export function adventureThreshold(level: number): number {
  const n = Math.min(ADVENTURE_MAX_LEVEL, Math.max(1, whole(level))) - 1;
  return 120 * n + 30 * n * (n - 1);
}
export function adventureLevel(xp: number) {
  let level = 1;
  while (
    level < ADVENTURE_MAX_LEVEL &&
    whole(xp) >= adventureThreshold(level + 1)
  )
    level++;
  const current = adventureThreshold(level);
  const next = adventureThreshold(level + 1);
  return {
    level,
    current,
    next,
    ratio:
      level === ADVENTURE_MAX_LEVEL
        ? 1
        : (whole(xp) - current) / (next - current),
    remaining: level === ADVENTURE_MAX_LEVEL ? 0 : next - whole(xp),
  };
}

export const CHAPTERS = [
  {
    title: "Большое начало",
    subtitle: "Познакомься с Кнопиком и найди свой ритм",
    color: "green",
  },
  {
    title: "Поймай волну",
    subtitle: "Точность, память и первые открытия",
    color: "blue",
  },
  {
    title: "Выше и выше",
    subtitle: "Новые рекорды и большие награды",
    color: "purple",
  },
  {
    title: "Клуб Кнопика",
    subtitle: "Последние испытания. Твой путь к мастерству",
    color: "orange",
  },
] as const;

export type StepMetric =
  | "taps"
  | "practicePlays"
  | "timingWins"
  | "memoryWins"
  | "vault";
export type AdventureStep = {
  title: string;
  metric: StepMetric;
  target: number;
  xp: number;
  coins: number;
  action: "tap" | "timing" | "memory" | "vault";
};
const step = (
  title: string,
  metric: StepMetric,
  target: number,
  action: AdventureStep["action"],
  chapter: number,
): AdventureStep => ({
  title,
  metric,
  target,
  action,
  xp: 50 + chapter * 30,
  coins: 100 + chapter * 100,
});
export const ADVENTURE_STEPS: readonly AdventureStep[] = [
  step("Первые 20 тапов", "taps", 20, "tap", 0),
  step("Попробуй точный тап", "practicePlays", 1, "timing", 0),
  step("Поймай зелёную зону", "timingWins", 1, "timing", 0),
  step("Разомни память", "memoryWins", 1, "memory", 0),
  step("Сто приветов Кнопику", "taps", 100, "tap", 0),
  step("Первые сбережения", "vault", 100, "vault", 0),
  step("Снова в ритме", "timingWins", 3, "timing", 1),
  step("Пять маленьких игр", "practicePlays", 5, "timing", 1),
  step("Запомни маршрут", "memoryWins", 3, "memory", 1),
  step("Двести пятьдесят тапов", "taps", 250, "tap", 1),
  step("Запас на завтра", "vault", 400, "vault", 1),
  step("Уверенная рука", "timingWins", 5, "timing", 1),
  step("Кнопик всё помнит", "memoryWins", 5, "memory", 2),
  step("Десять игр на навык", "practicePlays", 10, "memory", 2),
  step("Полтысячи тапов", "taps", 500, "tap", 2),
  step("Тёплый сейф", "vault", 1_000, "vault", 2),
  step("Точно в цель", "timingWins", 8, "timing", 2),
  step("Отличная память", "memoryWins", 8, "memory", 2),
  step("Клуб тысячи тапов", "taps", 1_000, "tap", 3),
  step("Двадцать открытий", "practicePlays", 20, "memory", 3),
  step("Мастер точности", "timingWins", 12, "timing", 3),
  step("Мастер памяти", "memoryWins", 12, "memory", 3),
  step("Надёжная копилка", "vault", 2_500, "vault", 3),
  step("Лучший друг Кнопика", "taps", 2_000, "tap", 3),
];

export function sanitizeAdventure(
  value: unknown,
  legacy: { level?: unknown; totalTaps?: unknown } = {},
): AdventureProgress {
  const v =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  return {
    xp:
      "xp" in v
        ? whole(v.xp)
        : Math.max(
            whole(legacy.totalTaps),
            adventureThreshold(Math.min(11, whole(legacy.level) + 1)),
          ),
    claimedSteps: Math.min(ADVENTURE_STEPS.length, whole(v.claimedSteps)),
    practicePlays: whole(v.practicePlays),
    timingWins: whole(v.timingWins),
    memoryWins: whole(v.memoryWins),
    casinoPlays: whole(v.casinoPlays),
    coinWins: whole(v.coinWins),
    diceWins: whole(v.diceWins),
    towerWins: whole(v.towerWins),
  };
}
export function stepProgress(
  progress: AdventureProgress,
  stats: { totalTaps: number; vaultCoins: number },
): number {
  const current = ADVENTURE_STEPS[progress.claimedSteps];
  if (!current) return 0;
  const value =
    current.metric === "taps"
      ? stats.totalTaps
      : current.metric === "vault"
        ? stats.vaultCoins
        : progress[current.metric];
  return Math.min(current.target, whole(value));
}
export function claimAdventureStep(
  progress: AdventureProgress,
  stats: { totalTaps: number; vaultCoins: number },
  expectedStep = progress.claimedSteps,
) {
  if (expectedStep !== progress.claimedSteps) return null;
  const current = ADVENTURE_STEPS[progress.claimedSteps];
  if (!current || stepProgress(progress, stats) < current.target) return null;
  return {
    progress: {
      ...progress,
      claimedSteps: progress.claimedSteps + 1,
      xp: cappedAdd(progress.xp, current.xp),
    },
    coins: current.coins,
    chapterComplete: (progress.claimedSteps + 1) % 6 === 0,
  };
}
