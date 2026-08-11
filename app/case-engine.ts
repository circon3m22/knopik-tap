export type CaseKind = "common" | "big";
export type BuffKind = "food" | "drink" | "pitbull" | "cola" | "tea" | "shield";
export type ClothingKind = "hat" | "mohawk";

export type CaseReward =
  | { type: "coins"; amount: number; label: string }
  | { type: "buff"; kind: BuffKind; amount: number; label: string }
  | { type: "upgrade"; kind: ClothingKind; amount: 1; label: string }
  | { type: "item"; kind: ClothingKind; amount: 1; label: string };

export const QUESTS = [
  { id: "tap-1500", title: "Сделай 1 500 тапов", target: 1_500, metric: "taps" },
  { id: "vault-5000", title: "Накопи 5 000 монет в сейфе", target: 5_000, metric: "vault" },
  { id: "win-8", title: "Выиграй 8 мини-игр", target: 8, metric: "wins" },
  { id: "tap-5000", title: "Сделай всего 5 000 тапов", target: 5_000, metric: "taps" },
  { id: "ears-30", title: "Тапни по ушам 30 раз", target: 30, metric: "ears" },
  { id: "hat-15", title: "Встряхни тюбетейку 15 раз", target: 15, metric: "hat" },
  { id: "mohawk-10", title: "Расчеши эрокез 10 раз", target: 10, metric: "mohawk" },
  { id: "level-5", title: "Достигни пятого уровня", target: 5, metric: "level" },
] as const;

function normalizedRandom(random: () => number) {
  return Math.min(.999999, Math.max(0, random()));
}

function integer(minimum: number, maximum: number, random: () => number) {
  return Math.floor(normalizedRandom(random) * (maximum - minimum + 1)) + minimum;
}

function pick<T>(values: readonly T[], random: () => number): T {
  return values[Math.floor(normalizedRandom(random) * values.length)];
}

const BUFF_LABELS: Record<BuffKind, string> = {
  food: "Корм",
  drink: "Живчик",
  pitbull: "Питбуль",
  cola: "Какао-Кола",
  tea: "Чай с бергамотом",
  shield: "Пепси",
};

const CLOTHING_LABELS: Record<ClothingKind, string> = {
  hat: "Тюбетейка Хасбика",
  mohawk: "Эрокез",
};

function commonReward(random: () => number): CaseReward {
  const roll = normalizedRandom(random);
  if (roll < .55) {
    const amount = integer(50, 2_500, random);
    return { type: "coins", amount, label: `${amount.toLocaleString("ru-RU")} монет` };
  }
  if (roll < .84) {
    const kind = pick(["food", "drink", "pitbull", "cola", "tea"] as const, random);
    return { type: "buff", kind, amount: 1, label: `${BUFF_LABELS[kind]} ×1` };
  }
  const kind = pick(["hat", "mohawk"] as const, random);
  return { type: "upgrade", kind, amount: 1, label: `Улучшение: ${CLOTHING_LABELS[kind]}` };
}

function bigReward(random: () => number): CaseReward {
  const roll = normalizedRandom(random);
  if (roll < .38) {
    const amount = integer(1_000, 10_000, random);
    return { type: "coins", amount, label: `${amount.toLocaleString("ru-RU")} монет` };
  }
  if (roll < .72) {
    const kind = pick(["food", "drink", "pitbull", "cola", "tea", "shield"] as const, random);
    const amount = integer(2, kind === "shield" ? 2 : 5, random);
    return { type: "buff", kind, amount, label: `${BUFF_LABELS[kind]} ×${amount}` };
  }
  const kind = pick(["hat", "mohawk"] as const, random);
  return { type: "upgrade", kind, amount: 1, label: `Улучшение: ${CLOTHING_LABELS[kind]}` };
}

export function createCaseRewards(
  kind: CaseKind,
  random: () => number = Math.random,
): CaseReward[] {
  if (kind === "common") {
    return Array.from({ length: 3 }, () => commonReward(random));
  }

  // A whole clothing item has a 20% chance per big case, not per reward slot.
  const itemIndex = normalizedRandom(random) < .2
    ? integer(0, 4, random)
    : -1;
  return Array.from({ length: 5 }, (_, index) => {
    if (index !== itemIndex) return bigReward(random);
    const clothing = pick(["hat", "mohawk"] as const, random);
    return { type: "item", kind: clothing, amount: 1, label: CLOTHING_LABELS[clothing] };
  });
}
