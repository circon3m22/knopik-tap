"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import {
  SAVE_KEY,
  SAVE_VERSION,
  createDefaultSave,
  sanitizeSave,
  type CoinState,
  type DogState,
  type GameSettings,
  type GameStats,
  type SaveData,
} from "./game-logic";
import {
  FATIGUE_DURATION_MS,
  ULTRA_TAP_MIN_HOLD_MS,
  appendTapInterval,
  calculateFatigueRatio,
  calculateTapLimit,
  calculateTempoRatio,
  calculateUltraTapCoins,
  chooseUltraTapOverheatDeadline,
  chooseUltraTapTwoSecondReward,
  chooseFatigueDuration,
  isUltraTapOverheated,
  rollingAverageTapInterval,
} from "./tempo-engine";
import {
  createSoundEngine,
  type KnopikSoundEngine,
  type UltraStopResult,
} from "./sound-engine";
import {
  MAX_LEVEL,
  addLevelCoins,
  levelMultiplier,
  levelProgressDetails,
  sanitizeLevelState,
  type LevelState,
} from "./level-engine";
import {
  QUESTS,
  createCaseRewards,
  type CaseKind,
  type CaseReward,
} from "./case-engine";
import {
  createRiskOutcome,
  riskMultiplier,
  type RiskChance,
} from "./risk-engine";
import {
  DEFAULT_DIFFICULTY,
  clampDifficulty,
  difficultyDuration,
  difficultyLuckMultiplier,
  difficultyPatienceMultiplier,
  difficultyRewardMultiplier,
  difficultyTiredChanceMultiplier,
  difficultyTiredSnapMultiplier,
  difficultyUltraFailureChance,
  difficultyUltraDeadlineMultiplier,
  difficultyWithBalancePenalty,
} from "./difficulty-engine";
import {
  CloudAccountGate,
  type CloudAccount,
  type CloudSyncState,
  type PromoCode,
} from "./cloud-account";
import {
  MiniGamePanel,
  type MiniGameKind,
  type MiniGameStats,
} from "./mini-game-panel";
import { resolveMiniGameBet } from "./mini-game-engine";
import { BOOT_IMAGE_ASSETS } from "./boot-assets";
import { useDialogA11y } from "./use-dialog-a11y";

type TapParticle = {
  id: number;
  x: number;
  y: number;
  amount: number;
  jackpot: boolean;
};
type RecoveryReason = "rest" | "bite" | "ultra";
type RiskPhase = "normal" | "selecting" | "transition" | "spinning" | "result";
type RiskStats = {
  spins: number;
  wins: number;
  losses: number;
  lastBet: number;
};
type SaveFlight = {
  id: number;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  amount: number;
};

const CALM_SERIES_RESET_MS = 6_000;
const WARNING_REST_MS = 2_650;
const RECOVERY_MS = 1_350;
const ANGRY_MS = 1_650;
const EMOTION_FRAME_MS = 125;
const ULTRA_VISUAL_DELAY_MS = 360;
const RANDOM_TIRED_CHANCE = 0.015;
const TIRED_SNAP_CHANCE = 0.04;
const LAST_TAP_CHANCE = 0.0025;
const TIRED_MOOD_MIN_MS = 7_000;
const TIRED_MOOD_SPREAD_MS = 6_000;
const DOG_FOOD_PRICE = 150;
const HASBIK_HAT_PRICE = 5_000;
const MOHAWK_PRICE = 10_000;
const MOHAWK_RISK_BONUS = 1.08;
const ZHIVCHIK_PRICE = 300;
const PITBULL_PRICE = 200;
const COCOA_COLA_PRICE = 200;
const BERGAMOT_TEA_PRICE = 300;
const VITA_POWER_PRICE = 5_000;
const ZHIVCHIK_DURATION_MS = 60_000;
const ZHIVCHIK_MULTIPLIER = 4;
const HAT_ULTRA_BONUS_MS = 350;
const HAT_REWARD_ROLL_FLOOR = 0.18;
const MAX_CHEAT_COIN_GRANT = 1_000_000_000;
const RISK_SPIN_MS = 5_400;
const RISK_RESULT_MS = 1_650;
const INVENTORY_LIMIT = 25;
const BULK_BUY_HOLD_MS = 900;
type ShopBuffKind = "food" | "drink" | "pitbull" | "cola" | "tea" | "vita";
const CASE_HOLD_MS = 1_050;
const COMMON_CASE_PRICE = 2_500;
const BIG_CASE_PRICE = 25_000;

type CaseSequence = {
  kind: CaseKind;
  rewards: CaseReward[];
  phase: "ready" | "charging" | "burst" | "reward";
  rewardIndex: number;
};

function riskSectorPath(chance: number) {
  const angle = Math.min(359.999, Math.max(0, chance * 3.6));
  const radians = ((angle - 90) * Math.PI) / 180;
  const endX = 50 + 48 * Math.cos(radians);
  const endY = 50 + 48 * Math.sin(radians);
  return `M 50 50 L 50 2 A 48 48 0 ${angle > 180 ? 1 : 0} 1 ${endX} ${endY} Z`;
}

function CaseRewardArtwork({ reward }: { reward: CaseReward }) {
  if (reward.type === "coins") {
    return <span className="reward-coin-art"><i>К</i></span>;
  }
  const path = reward.type === "buff"
    ? {
        food: "/buffs/food.png",
        drink: "/buffs/zhivchik.png",
        pitbull: "/buffs/pitbull.png",
        cola: "/buffs/cocoa-cola.png",
        tea: "/buffs/bergamot-tea.png",
        shield: "/buffs/pepsi.png",
      }[reward.kind]
    : reward.kind === "hat"
      ? "/hasbik-tubeteika.png"
      : "/knopik-mohawk-v2.png";
  return (
    <span className={`reward-image-art ${reward.type === "upgrade" ? "is-upgrade" : ""}`}>
      <img src={publicAsset(path)} alt="" draggable={false} />
      {reward.type === "upgrade" && <i aria-hidden="true">↑</i>}
    </span>
  );
}
const PUBLIC_BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH?.replace(/\/$/, "") ?? "";
const publicAsset = (path: string) => `${PUBLIC_BASE_PATH}${path}`;

const tutorialSlides = [
  {
    symbol: "TAP",
    eyebrow: "ОСНОВА",
    title: "Тапай по Кнопику и следи за его настроением",
    copy: "Быстрый ровный темп радует Кнопика и окрашивает фон в синий. Медленные нажатия и паузы утомляют его.",
  },
  {
    symbol: "MOOD",
    eyebrow: "ЭМОЦИИ",
    title: "Лицо Кнопика и цвет фона предупреждают об опасности",
    copy: "Весёлый Кнопик терпеливее. Напряжённый или уставший может быстро рассердиться, а при проигрыше пропадут незащищённые монеты и уровни.",
  },
  {
    symbol: "HOLD",
    eyebrow: "УЛЬТРА-ТАП",
    title: "Зажми Кнопика, чтобы зарядить мощную добычу",
    copy: "Чем дольше удержание, тем выше награда и риск. Отпусти вовремя: передержка сжигает добычу. Когда Кнопик устал, ультра-тап недоступен.",
  },
  {
    symbol: "REST",
    eyebrow: "УСТАЛОСТЬ",
    title: "Усталость делает игру опаснее",
    copy: "Кнопик устаёт от рискованной игры и иногда просто теряет терпение. Купленный за активные монеты корм можно использовать прямо на главном экране.",
  },
  {
    symbol: "SAVE",
    eyebrow: "ПРОГРЕСС",
    title: "Развивай уровень и вовремя защищай добычу",
    copy: "Уровни усиливают заработок, но сбрасываются после проигрыша. Монеты в сейфе сохраняются навсегда, хотя при переводе защищается только часть суммы.",
  },
];

function vibrate(pattern: number | number[], enabled: boolean) {
  if (enabled && typeof navigator !== "undefined" && "vibrate" in navigator) {
    navigator.vibrate(pattern);
  }
}

function tempoSceneColor(averageInterval: number, hasTaps: boolean) {
  if (!hasTaps) return "rgb(247 249 252)";

  const ratio = Math.min(1, Math.max(0, (500 - averageInterval) / 240));
  const light = [247, 249, 252];
  const deep = [10, 82, 199];
  const channels = light.map((channel, index) =>
    Math.round(channel + (deep[index] - channel) * ratio),
  );
  return `rgb(${channels.join(" ")})`;
}

type KnopikGameProps = {
  account: CloudAccount;
  initialSave: SaveData;
  syncState: CloudSyncState;
  difficulty: number;
  promoCodes: PromoCode[];
  onSave: (save: SaveData) => void;
  onRefreshPromoCodes: () => Promise<void>;
  onUpdateDifficulty: (difficulty: number) => Promise<string>;
  onCreatePromoCode: (code: string, amount: number) => Promise<string>;
  onRedeemPromoCode: (code: string) => Promise<{ message: string; amount?: number }>;
  onChangePassword: (password: string) => Promise<string>;
  onSignOut: () => Promise<void>;
};

function KnopikGame({
  account,
  initialSave,
  syncState,
  difficulty,
  promoCodes,
  onSave,
  onRefreshPromoCodes,
  onUpdateDifficulty,
  onCreatePromoCode,
  onRedeemPromoCode,
  onChangePassword,
  onSignOut,
}: KnopikGameProps) {
  const [dogState, setDogState] = useState<DogState>("calm");
  const [recoveryReason, setRecoveryReason] =
    useState<RecoveryReason>("rest");
  const [coins, setCoins] = useState<CoinState>({
    walletCoins: 0,
    streakCoins: 0,
  });
  const [vaultCoins, setVaultCoins] = useState(0);
  const [foodCount, setFoodCount] = useState(0);
  const [foodQuantity, setFoodQuantity] = useState(1);
  const [drinkCount, setDrinkCount] = useState(0);
  const [drinkQuantity, setDrinkQuantity] = useState(1);
  const [pitbullCount, setPitbullCount] = useState(0);
  const [pitbullQuantity, setPitbullQuantity] = useState(1);
  const [colaCount, setColaCount] = useState(0);
  const [colaQuantity, setColaQuantity] = useState(1);
  const [teaCount, setTeaCount] = useState(0);
  const [teaQuantity, setTeaQuantity] = useState(1);
  const [vitaPowerCount, setVitaPowerCount] = useState(0);
  const [vitaPowerQuantity, setVitaPowerQuantity] = useState(1);
  const [bulkBuyHolding, setBulkBuyHolding] = useState<ShopBuffKind | null>(null);
  const [vitaPowerShield, setVitaPowerShield] = useState(false);
  const [shieldBreakVisible, setShieldBreakVisible] = useState(false);
  const [hatOwned, setHatOwned] = useState(false);
  const [hatEquipped, setHatEquipped] = useState(false);
  const [mohawkOwned, setMohawkOwned] = useState(false);
  const [mohawkEquipped, setMohawkEquipped] = useState(false);
  const [hatLevel, setHatLevel] = useState(1);
  const [mohawkLevel, setMohawkLevel] = useState(1);
  const [hatUpgradeTokens, setHatUpgradeTokens] = useState(0);
  const [mohawkUpgradeTokens, setMohawkUpgradeTokens] = useState(0);
  const [commonCases, setCommonCases] = useState(0);
  const [bigCases, setBigCases] = useState(0);
  const [questIndex, setQuestIndex] = useState(0);
  const [earInteractionCount, setEarInteractionCount] = useState(0);
  const [hatInteractionCount, setHatInteractionCount] = useState(0);
  const [mohawkInteractionCount, setMohawkInteractionCount] = useState(0);
  const [boostUntil, setBoostUntil] = useState(0);
  const [settings, setSettings] = useState<GameSettings>({
    sound: true,
    vibration: true,
    suliman: false,
    yellow: false,
  });
  const [stats, setStats] = useState<GameStats>({
    bestStreak: 0,
    totalTaps: 0,
    totalBites: 0,
  });
  const [levelState, setLevelState] = useState<LevelState>({
    level: 0,
    progressCoins: 0,
    lifetimeCoins: 0,
  });
  const [tutorialSeen, setTutorialSeen] = useState(false);
  const [tutorialOpen, setTutorialOpen] = useState(true);
  const [tutorialStep, setTutorialStep] = useState(0);
  const [shopOpen, setShopOpen] = useState(false);
  const [shopCategory, setShopCategory] = useState<"food" | "clothes">("food");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [casesOpen, setCasesOpen] = useState(false);
  const [navDragIndex, setNavDragIndex] = useState<number | null>(null);
  const [caseSequence, setCaseSequence] = useState<CaseSequence | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [accountMessage, setAccountMessage] = useState("");
  const [accountPending, setAccountPending] = useState(false);
  const [promoCode, setPromoCode] = useState("");
  const [promoAmount, setPromoAmount] = useState("");
  const [promoMessage, setPromoMessage] = useState("");
  const [promoPending, setPromoPending] = useState(false);
  const [difficultyDraft, setDifficultyDraft] = useState(() => clampDifficulty(difficulty));
  const [difficultyMessage, setDifficultyMessage] = useState("");
  const [difficultyPending, setDifficultyPending] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [seriesTaps, setSeriesTaps] = useState(0);
  const [averageInterval, setAverageInterval] = useState(600);
  const [fatigueUntil, setFatigueUntil] = useState(0);
  const [fatigueVisualDuration, setFatigueVisualDuration] = useState(1);
  const [clock, setClock] = useState(() => Date.now());
  const [holding, setHolding] = useState(false);
  const [ultraActive, setUltraActive] = useState(false);
  const [ultraCharge, setUltraCharge] = useState(0);
  const [ultraPreview, setUltraPreview] = useState(0);
  const [tapPulse, setTapPulse] = useState(0);
  const [balancePulse, setBalancePulse] = useState(0);
  const [particles, setParticles] = useState<TapParticle[]>([]);
  const [biteFlash, setBiteFlash] = useState(false);
  const [shopMessage, setShopMessage] = useState("");
  const [cheatCode, setCheatCode] = useState("");
  const [cheatMessage, setCheatMessage] = useState("");
  const [hasbulaRedeemed, setHasbulaRedeemed] = useState(false);
  const [hatBounce, setHatBounce] = useState(0);
  const [mohawkSwing, setMohawkSwing] = useState(0);
  const [saveFlight, setSaveFlight] = useState<SaveFlight | null>(null);
  const [bankDragProgress, setBankDragProgress] = useState(0);
  const [isBankDragging, setIsBankDragging] = useState(false);
  const bankPlateRef = useRef<HTMLDivElement | null>(null);
  const bankStartXRef = useRef(0);
  const bankDraggingRef = useRef(false);
  const [riskPhase, setRiskPhase] = useState<RiskPhase>("normal");
  const [riskChance, setRiskChance] = useState<RiskChance>(50);
  const [riskBetAmount, setRiskBetAmount] = useState(0);
  const [riskRotation, setRiskRotation] = useState(0);
  const [riskSpinNonce, setRiskSpinNonce] = useState(0);
  const [riskResult, setRiskResult] = useState<"win" | "lose" | null>(null);
  const [riskPayout, setRiskPayout] = useState(0);
  const [riskMessage, setRiskMessage] = useState("");
  const [riskShake, setRiskShake] = useState(0);
  const [riskFatigueUntil, setRiskFatigueUntil] = useState(0);
  const [riskStats, setRiskStats] = useState<RiskStats>({
    spins: 0,
    wins: 0,
    losses: 0,
    lastBet: 0,
  });
  const [miniGame, setMiniGame] = useState<MiniGameKind | null>(null);
  const [miniGameSession, setMiniGameSession] = useState(0);
  const [miniGameStats, setMiniGameStats] = useState<MiniGameStats>({
    slotPlays: 0,
    slotWins: 0,
    minePlays: 0,
    mineWins: 0,
    mineLosses: 0,
  });
  const [levelBurstKey, setLevelBurstKey] = useState(0);
  const [levelBurstVisible, setLevelBurstVisible] = useState(false);
  const [joyFrame, setJoyFrame] = useState(0);
  const [rageFrame, setRageFrame] = useState(0);
  const [joySpriteReady, setJoySpriteReady] = useState(false);
  const [rageSpriteReady, setRageSpriteReady] = useState(false);

  const dogStateRef = useRef<DogState>("calm");
  const coinsRef = useRef(coins);
  const settingsRef = useRef(settings);
  const configuredDifficultyRef = useRef(clampDifficulty(difficulty));
  const difficultyRef = useRef(
    difficultyWithBalancePenalty(difficulty, coins.walletCoins),
  );
  const hasbulaRedeemedRef = useRef(false);
  const statsRef = useRef(stats);
  const levelStateRef = useRef(levelState);
  const boostUntilRef = useRef(0);
  const bonusCarryRef = useRef(0);
  const fatigueUntilRef = useRef(0);
  const fatigueVisualDeadlineRef = useRef(0);
  const seriesTapsRef = useRef(0);
  const tapLimitRef = useRef(0);
  const tapIntervalsRef = useRef<number[]>([]);
  const lastTapAtRef = useRef<number | null>(null);
  const patienceRollRef = useRef<number | null>(null);
  const particleIdRef = useRef(0);
  const soundRef = useRef<KnopikSoundEngine | null>(null);
  const holdStartRef = useRef(0);
  const holdPointRef = useRef({ x: 50, y: 50 });
  const holdingRef = useRef(false);
  const ultraActiveRef = useRef(false);
  const ultraAllowedRef = useRef(true);
  const overheatTriggeredRef = useRef(false);
  const ultraDeadlineRef = useRef(3_000);
  const ultraTwoSecondRewardRef = useRef(400);
  const ultraDoomedRef = useRef(false);
  const holdIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recoveryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const angryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tiredTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shieldBreakTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const levelBurstTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const caseHoldTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bulkBuyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bulkBuyTriggeredRef = useRef(false);
  const caseBurstTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveFlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const riskTransitionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const riskSpinTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const riskSlowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const riskReturnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const riskTickTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const riskMessageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const riskPhaseRef = useRef<RiskPhase>("normal");
  const riskCommittedRef = useRef(false);
  const joySpriteImageRef = useRef<HTMLImageElement | null>(null);
  const rageSpriteImageRef = useRef<HTMLImageElement | null>(null);
  const walletBalanceRef = useRef<HTMLDivElement | null>(null);
  const savedBalanceRef = useRef<HTMLDivElement | null>(null);
  const navDragStartRef = useRef(0);
  const navDidDragRef = useRef(false);
  const tutorialSheetRef = useRef<HTMLElement | null>(null);
  const shopSheetRef = useRef<HTMLElement | null>(null);
  const casesSheetRef = useRef<HTMLElement | null>(null);
  const settingsSheetRef = useRef<HTMLElement | null>(null);
  const shellRef = useRef<HTMLElement | null>(null);
  const caseOpeningRef = useRef<HTMLDivElement | null>(null);
  const earTapStateRef = useRef({
    left: { count: 0, lastAt: 0 },
    right: { count: 0, lastAt: 0 },
  });

  useEffect(() => {
    const watchImage = (
      image: HTMLImageElement | null,
      markReady: (ready: boolean) => void,
    ) => {
      if (!image) return () => undefined;
      const handleReady = () => {
        if (image.naturalWidth > 0) markReady(true);
      };

      if (image.complete) handleReady();
      image.addEventListener("load", handleReady);
      return () => image.removeEventListener("load", handleReady);
    };

    const stopWatchingJoy = watchImage(
      joySpriteImageRef.current,
      setJoySpriteReady,
    );
    const stopWatchingRage = watchImage(
      rageSpriteImageRef.current,
      setRageSpriteReady,
    );
    return () => {
      stopWatchingJoy();
      stopWatchingRage();
    };
  }, []);

  const getSound = useCallback(() => {
    if (!soundRef.current) {
      soundRef.current = createSoundEngine({
        enabled: settingsRef.current.sound,
        volume: 0.72,
      });
    }
    return soundRef.current;
  }, []);

  const transitionTo = useCallback((state: DogState) => {
    dogStateRef.current = state;
    setDogState(state);
  }, []);

  const transitionRisk = useCallback((phase: RiskPhase) => {
    riskPhaseRef.current = phase;
    setRiskPhase(phase);
  }, []);

  const updateCoins = useCallback(
    (updater: (current: CoinState) => CoinState) => {
      setCoins((current) => {
        const next = updater(current);
        coinsRef.current = next;
        difficultyRef.current = difficultyWithBalancePenalty(
          configuredDifficultyRef.current,
          next.walletCoins,
        );
        return next;
      });
    },
    [],
  );

  const updateStats = useCallback(
    (updater: (current: GameStats) => GameStats) => {
      setStats((current) => {
        const next = updater(current);
        statsRef.current = next;
        return next;
      });
    },
    [],
  );

  const triggerLevelBurst = useCallback(() => {
    setLevelBurstKey((current) => current + 1);
    setLevelBurstVisible(true);
    getSound().levelUp();
    vibrate([18, 24, 35], settingsRef.current.vibration);
    if (levelBurstTimerRef.current) {
      clearTimeout(levelBurstTimerRef.current);
    }
    levelBurstTimerRef.current = setTimeout(
      () => setLevelBurstVisible(false),
      1_050,
    );
  }, [getSound]);

  const awardCoins = useCallback(
    (
      baseAmount: number,
      maximum = Number.MAX_SAFE_INTEGER,
      applyTapBoost = false,
    ) => {
      const base = Math.max(0, Math.floor(baseAmount));
      const multiplier = levelMultiplier(levelStateRef.current.level);
      const tapBoost =
        applyTapBoost && boostUntilRef.current > Date.now()
          ? ZHIVCHIK_MULTIPLIER
          : 1;
      const hiddenDifficulty = difficultyRewardMultiplier(difficultyRef.current);
      const precise =
        base * multiplier * tapBoost * hiddenDifficulty + bonusCarryRef.current;
      const earned = Math.min(maximum, Math.max(0, Math.floor(precise)));
      bonusCarryRef.current =
        earned >= maximum ? 0 : Math.max(0, precise - earned);

      if (earned === 0) return 0;
      setBalancePulse((current) => current + 1);
      updateCoins((current) => ({
        walletCoins: current.walletCoins + earned,
        streakCoins: current.streakCoins + earned,
      }));
      const result = addLevelCoins(levelStateRef.current, earned);
      levelStateRef.current = result.state;
      setLevelState(result.state);
      if (result.levelsGained > 0) {
        setCommonCases((current) => Math.min(99, current + result.levelsGained));
        triggerLevelBurst();
      }
      return earned;
    },
    [triggerLevelBurst, updateCoins],
  );

  const clearRoundTimers = useCallback(() => {
    [
      idleTimerRef,
      recoveryTimerRef,
      angryTimerRef,
      flashTimerRef,
      tiredTimerRef,
    ].forEach(
      (timerRef) => {
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = null;
      },
    );
  }, []);

  const resetSeries = useCallback(() => {
    seriesTapsRef.current = 0;
    tapLimitRef.current = 0;
    tapIntervalsRef.current = [];
    lastTapAtRef.current = null;
    patienceRollRef.current = Math.random();
    setSeriesTaps(0);
    setAverageInterval(600);
    updateCoins((current) => ({ ...current, streakCoins: 0 }));
  }, [updateCoins]);

  useEffect(() => {
    try {
      const saved = sanitizeSave(initialSave);
      const loadedCoins = {
        walletCoins: saved.walletCoins,
        streakCoins: 0,
      };
      const loadedStats = {
        bestStreak: saved.bestStreak,
        totalTaps: saved.totalTaps,
        totalBites: saved.totalBites,
      };
      const loadedLevel = sanitizeLevelState({
        level: saved.level,
        progressCoins: saved.levelCoins,
      });
      const activeFatigue = saved.settings.yellow
        ? 0
        : Math.max(
            saved.ultraFatigueUntil > Date.now() ? saved.ultraFatigueUntil : 0,
            saved.riskFatigueUntil > Date.now() ? saved.riskFatigueUntil : 0,
          );

      coinsRef.current = loadedCoins;
      patienceRollRef.current = Math.random();
      difficultyRef.current = difficultyWithBalancePenalty(
        configuredDifficultyRef.current,
        loadedCoins.walletCoins,
      );
      settingsRef.current = saved.settings;
      statsRef.current = loadedStats;
      levelStateRef.current = loadedLevel;
      boostUntilRef.current = saved.boostUntil > Date.now() ? saved.boostUntil : 0;
      fatigueUntilRef.current = activeFatigue;
      dogStateRef.current = activeFatigue > Date.now() ? "tired" : "calm";
      setCoins(loadedCoins);
      setVaultCoins(saved.vaultCoins);
      setFoodCount(saved.foodCount);
      setDrinkCount(saved.drinkCount);
      setPitbullCount(saved.pitbullCount);
      setColaCount(saved.colaCount);
      setTeaCount(saved.teaCount);
      setVitaPowerCount(saved.vitaPowerCount);
      setVitaPowerShield(saved.vitaPowerShield);
      setHatOwned(saved.hatOwned);
      setHatEquipped(saved.hatEquipped);
      setMohawkOwned(saved.mohawkOwned);
      setMohawkEquipped(saved.mohawkEquipped);
      setHatLevel(saved.hatLevel);
      setMohawkLevel(saved.mohawkLevel);
      setHatUpgradeTokens(saved.hatUpgradeTokens);
      setMohawkUpgradeTokens(saved.mohawkUpgradeTokens);
      setCommonCases(saved.commonCases);
      setBigCases(saved.bigCases);
      setQuestIndex(saved.questIndex);
      setEarInteractionCount(saved.earInteractionCount);
      setHatInteractionCount(saved.hatInteractionCount);
      setMohawkInteractionCount(saved.mohawkInteractionCount);
      setHasbulaRedeemed(saved.hasbulaRedeemed);
      hasbulaRedeemedRef.current = saved.hasbulaRedeemed;
      setBoostUntil(saved.boostUntil > Date.now() ? saved.boostUntil : 0);
      setRiskChance(saved.lastRiskChance as RiskChance);
      setRiskFatigueUntil(
        !saved.settings.yellow && saved.riskFatigueUntil > Date.now()
          ? saved.riskFatigueUntil
          : 0,
      );
      setRiskStats({
        spins: saved.riskSpins,
        wins: saved.riskWins,
        losses: saved.riskLosses,
        lastBet: saved.lastRiskBet,
      });
      setMiniGameStats({
        slotPlays: saved.slotPlays,
        slotWins: saved.slotWins,
        minePlays: saved.minePlays,
        mineWins: saved.mineWins,
        mineLosses: saved.mineLosses,
      });
      setSettings(saved.settings);
      setStats(loadedStats);
      setLevelState(loadedLevel);
      setFatigueUntil(activeFatigue);
      setDogState(activeFatigue > Date.now() ? "tired" : "calm");
      setTutorialSeen(saved.tutorialSeen);
      setTutorialOpen(!saved.tutorialSeen);
    } catch {
      localStorage.removeItem(SAVE_KEY);
      setTutorialOpen(true);
    } finally {
      setHydrated(true);
    }

    if (
      "serviceWorker" in navigator &&
      process.env.NODE_ENV === "production"
    ) {
      navigator.serviceWorker.register(publicAsset("/sw.js")).catch(() => undefined);
    }
  }, [initialSave]);

  useEffect(() => {
    settingsRef.current = settings;
    soundRef.current?.setEnabled(settings.sound);
  }, [settings]);

  // Страховка нижнего меню: шелл никогда не должен прокручиваться
  // (overflow:hidden всё равно позволяет браузеру задать scrollTop,
  // например при автофокусе — из-за этого меню «уезжало наверх»).
  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return undefined;
    const pinToTop = () => {
      if (shell.scrollTop !== 0 || shell.scrollLeft !== 0) {
        shell.scrollTo(0, 0);
      }
    };
    pinToTop();
    shell.addEventListener("scroll", pinToTop, { passive: true });
    return () => shell.removeEventListener("scroll", pinToTop);
  }, []);

  useEffect(() => {
    const normalized = clampDifficulty(difficulty);
    configuredDifficultyRef.current = normalized;
    difficultyRef.current = difficultyWithBalancePenalty(
      normalized,
      coinsRef.current.walletCoins,
    );
  }, [difficulty]);

  useEffect(() => {
    if (settingsOpen && account.isAdmin) void onRefreshPromoCodes();
  }, [account.isAdmin, onRefreshPromoCodes, settingsOpen]);

  useEffect(() => {
    fatigueUntilRef.current = fatigueUntil;
    if (fatigueUntil > Date.now() && fatigueUntil !== fatigueVisualDeadlineRef.current) {
      fatigueVisualDeadlineRef.current = fatigueUntil;
      setFatigueVisualDuration(Math.max(1, fatigueUntil - Date.now()));
    } else if (!fatigueUntil) {
      fatigueVisualDeadlineRef.current = 0;
      setFatigueVisualDuration(1);
    }
  }, [fatigueUntil]);

  useEffect(() => {
    boostUntilRef.current = boostUntil;
    if (!boostUntil) return;
    const timer = setInterval(() => {
      const now = Date.now();
      setClock(now);
      if (now >= boostUntilRef.current) {
        boostUntilRef.current = 0;
        setBoostUntil(0);
      }
    }, 1_000);
    return () => clearInterval(timer);
  }, [boostUntil]);

  useEffect(() => {
    if (!hydrated) return;
    const saveTimer = setTimeout(() => {
      try {
        const nextSave = {
            version: SAVE_VERSION,
            vaultCoins,
            walletCoins: coins.walletCoins,
            foodCount,
            drinkCount,
            pitbullCount,
            colaCount,
            teaCount,
            vitaPowerCount,
            vitaPowerShield,
            hatOwned,
            hatEquipped,
            mohawkOwned,
            mohawkEquipped,
            hatLevel,
            mohawkLevel,
            hatUpgradeTokens,
            mohawkUpgradeTokens,
            commonCases,
            bigCases,
            questIndex,
            earInteractionCount,
            hatInteractionCount,
            mohawkInteractionCount,
            hasbulaRedeemed,
            riskFatigueUntil,
            riskSpins: riskStats.spins,
            riskWins: riskStats.wins,
            riskLosses: riskStats.losses,
            slotPlays: miniGameStats.slotPlays,
            slotWins: miniGameStats.slotWins,
            minePlays: miniGameStats.minePlays,
            mineWins: miniGameStats.mineWins,
            mineLosses: miniGameStats.mineLosses,
            lastRiskBet: riskStats.lastBet,
            lastRiskChance: riskChance,
            boostUntil,
            settings,
            tutorialSeen,
            bestStreak: stats.bestStreak,
            totalTaps: stats.totalTaps,
            totalBites: stats.totalBites,
            ultraFatigueUntil: fatigueUntil,
            level: levelState.level,
            levelCoins: levelState.progressCoins,
          } as const;
        onSave(nextSave);
      } catch {
        // The game remains playable when local storage is unavailable.
      }
    }, 450);

    return () => clearTimeout(saveTimer);
  }, [
    fatigueUntil,
    coins.walletCoins,
    boostUntil,
    foodCount,
    drinkCount,
    pitbullCount,
    colaCount,
    teaCount,
    vitaPowerCount,
    vitaPowerShield,
    hatEquipped,
    hatOwned,
    hasbulaRedeemed,
    mohawkEquipped,
    mohawkOwned,
    hatLevel,
    mohawkLevel,
    hatUpgradeTokens,
    mohawkUpgradeTokens,
    commonCases,
    bigCases,
    questIndex,
    earInteractionCount,
    hatInteractionCount,
    mohawkInteractionCount,
    onSave,
    hydrated,
    levelState,
    riskChance,
    riskFatigueUntil,
    riskStats,
    miniGameStats,
    settings,
    stats,
    tutorialSeen,
    vaultCoins,
  ]);

  const submitPasswordChange = useCallback(async () => {
    setAccountPending(true);
    setAccountMessage("");
    const message = await onChangePassword(newPassword);
    setAccountMessage(message);
    if (message === "Пароль изменён.") setNewPassword("");
    setAccountPending(false);
  }, [newPassword, onChangePassword]);

  const signOutAccount = useCallback(async () => {
    setAccountPending(true);
    await onSignOut();
  }, [onSignOut]);

  const submitPromoCode = useCallback(async () => {
    setPromoPending(true);
    setPromoMessage("");
    if (account.isAdmin) {
      const message = await onCreatePromoCode(promoCode, Number(promoAmount));
      setPromoMessage(message);
      if (message === "Промокод создан.") {
        setPromoCode("");
        setPromoAmount("");
      }
    } else {
      const result = await onRedeemPromoCode(promoCode);
      setPromoMessage(result.message);
      if (result.amount) {
        updateCoins((current) => ({
          ...current,
          walletCoins: current.walletCoins + result.amount!,
        }));
        setBalancePulse((current) => current + 1);
        setPromoCode("");
        getSound().purchase();
      }
    }
    setPromoPending(false);
  }, [account.isAdmin, getSound, onCreatePromoCode, onRedeemPromoCode, promoAmount, promoCode, updateCoins]);

  const submitDifficulty = useCallback(async () => {
    setDifficultyPending(true);
    setDifficultyMessage("");
    const message = await onUpdateDifficulty(difficultyDraft);
    setDifficultyMessage(message);
    setDifficultyPending(false);
  }, [difficultyDraft, onUpdateDifficulty]);

  useEffect(() => {
    if (!fatigueUntil) return;
    const timer = setInterval(() => {
      const now = Date.now();
      setClock(now);
      if (now >= fatigueUntilRef.current) {
        fatigueUntilRef.current = 0;
        setFatigueUntil(0);
        setRiskFatigueUntil((current) => (current <= now ? 0 : current));
        if (dogStateRef.current === "tired") {
          transitionTo("calm");
          resetSeries();
        }
      }
    }, 1_000);
    return () => clearInterval(timer);
  }, [fatigueUntil, resetSeries, transitionTo]);

  useEffect(
    () => () => {
      clearRoundTimers();
      if (holdIntervalRef.current) clearInterval(holdIntervalRef.current);
      if (messageTimerRef.current) clearTimeout(messageTimerRef.current);
      if (levelBurstTimerRef.current) {
        clearTimeout(levelBurstTimerRef.current);
      }
      if (saveFlightTimerRef.current) {
        clearTimeout(saveFlightTimerRef.current);
      }
      if (caseHoldTimerRef.current) clearTimeout(caseHoldTimerRef.current);
      if (bulkBuyTimerRef.current) clearTimeout(bulkBuyTimerRef.current);
      if (caseBurstTimerRef.current) clearTimeout(caseBurstTimerRef.current);
      if (shieldBreakTimerRef.current) clearTimeout(shieldBreakTimerRef.current);
      [
        riskTransitionTimerRef,
        riskSpinTimerRef,
        riskSlowTimerRef,
        riskReturnTimerRef,
        riskMessageTimerRef,
      ].forEach((timerRef) => {
        if (timerRef.current) clearTimeout(timerRef.current);
      });
      if (riskTickTimerRef.current) clearInterval(riskTickTimerRef.current);
      soundRef.current?.close();
    },
    [clearRoundTimers],
  );

  const fatigueRatio = useMemo(() => {
    const remaining = Math.max(0, fatigueUntil - clock);
    if (remaining === 0) return 0;
    const duration = difficultyDuration(FATIGUE_DURATION_MS, difficulty);
    return calculateFatigueRatio(duration - remaining, duration);
  }, [clock, difficulty, fatigueUntil]);
  const fatigueCountdownRatio = fatigueUntil > clock
    ? Math.min(1, Math.max(0, (fatigueUntil - clock) / fatigueVisualDuration))
    : 0;

  const stopHoldVisual = useCallback(
    (result: UltraStopResult) => {
      if (holdIntervalRef.current) {
        clearInterval(holdIntervalRef.current);
        holdIntervalRef.current = null;
      }
      holdingRef.current = false;
      ultraActiveRef.current = false;
      setHolding(false);
      setUltraActive(false);
      setUltraCharge(0);
      setUltraPreview(0);
      getSound().stopUltraLoop(result);
    },
    [getSound],
  );

  const enterTiredMood = useCallback(
    (persistent = false) => {
      if (settingsRef.current.yellow) {
        fatigueUntilRef.current = 0;
        setFatigueUntil(0);
        setRiskFatigueUntil(0);
        transitionTo("calm");
        return;
      }
      transitionTo("tired");
      if (tiredTimerRef.current) clearTimeout(tiredTimerRef.current);
      tiredTimerRef.current = null;

      if (persistent) return;
      const duration = difficultyDuration(
        TIRED_MOOD_MIN_MS + Math.random() * TIRED_MOOD_SPREAD_MS,
        difficultyRef.current,
      );
      tiredTimerRef.current = setTimeout(() => {
        tiredTimerRef.current = null;
        if (
          dogStateRef.current === "tired" &&
          fatigueUntilRef.current <= Date.now()
        ) {
          transitionTo("calm");
          resetSeries();
          getSound().rest();
        }
      }, duration);
    },
    [getSound, resetSeries, transitionTo],
  );

  const finishRecovery = useCallback(() => {
    if (settingsRef.current.yellow) {
      fatigueUntilRef.current = 0;
      setFatigueUntil(0);
      setRiskFatigueUntil(0);
      transitionTo("calm");
    } else if (fatigueUntilRef.current > Date.now()) {
      enterTiredMood(true);
    } else {
      transitionTo("calm");
    }
    setRecoveryReason("rest");
    resetSeries();
    getSound().rest();
  }, [enterTiredMood, getSound, resetSeries, transitionTo]);

  const beginRecovery = useCallback(
    (reason: RecoveryReason) => {
      setRecoveryReason(reason);
      transitionTo("recovering");
      recoveryTimerRef.current = setTimeout(finishRecovery, RECOVERY_MS);
    },
    [finishRecovery, transitionTo],
  );

  const triggerBite = useCallback(
    (fromOverheat = false) => {
      if (settingsRef.current.suliman) {
        if (holdingRef.current) stopHoldVisual("cancel");
        transitionTo("calm");
        resetSeries();
        return;
      }
      clearRoundTimers();
      if (holdingRef.current) {
        stopHoldVisual(fromOverheat ? "overheat" : "cancel");
      }
      transitionTo("angry");
      setRecoveryReason("bite");
      setBiteFlash(true);
      const shieldAbsorbed = vitaPowerShield;
      if (shieldAbsorbed) {
        setVitaPowerShield(false);
        setShieldBreakVisible(true);
        updateCoins((current) => ({ ...current, streakCoins: 0 }));
        if (shieldBreakTimerRef.current) clearTimeout(shieldBreakTimerRef.current);
        shieldBreakTimerRef.current = setTimeout(() => setShieldBreakVisible(false), 760);
      } else {
        updateCoins(() => ({ walletCoins: 0, streakCoins: 0 }));
      }
      updateStats((current) => ({
        ...current,
        totalBites: current.totalBites + 1,
      }));
      if (!shieldAbsorbed) bonusCarryRef.current = 0;
      if (!shieldAbsorbed) {
        const resetLevel = { level: 0, progressCoins: 0, lifetimeCoins: 0 };
        levelStateRef.current = resetLevel;
        setLevelState(resetLevel);
        setLevelBurstVisible(false);
      }
      seriesTapsRef.current = 0;
      tapLimitRef.current = 0;
      tapIntervalsRef.current = [];
      setSeriesTaps(0);
      vibrate([90, 35, 80, 35, 55], settingsRef.current.vibration);
      if (!fromOverheat) getSound().bite();
      flashTimerRef.current = setTimeout(() => setBiteFlash(false), 420);
      angryTimerRef.current = setTimeout(
        () => beginRecovery("bite"),
        ANGRY_MS,
      );
    },
    [
      beginRecovery,
      clearRoundTimers,
      getSound,
      resetSeries,
      stopHoldVisual,
      transitionTo,
      updateCoins,
      updateStats,
      vitaPowerShield,
    ],
  );

  const armIdleTimer = useCallback(
    (state: "calm" | "tired" | "warning") => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      const baseDelay = state === "warning" ? WARNING_REST_MS : CALM_SERIES_RESET_MS;
      idleTimerRef.current = setTimeout(
        () => {
          if (state === "warning" && dogStateRef.current === "warning") {
            beginRecovery("rest");
          } else if (state === "calm" && dogStateRef.current === "calm") {
            resetSeries();
          } else if (state === "tired" && dogStateRef.current === "tired") {
            resetSeries();
          }
        },
        difficultyDuration(baseDelay, difficultyRef.current),
      );
    },
    [beginRecovery, resetSeries],
  );

  const handleEarTap = useCallback(
    (ear: "left" | "right") => {
      if (riskPhaseRef.current !== "normal") return;
      const currentState = dogStateRef.current;
      if (
        holdingRef.current ||
        currentState === "angry" ||
        currentState === "recovering"
      ) {
        return;
      }

      getSound().unlock();
      setEarInteractionCount((current) => current + 1);
      if (settingsRef.current.suliman) {
        getSound().tap(0.25);
        vibrate(8, settingsRef.current.vibration);
        return;
      }
      const now = performance.now();
      const previous = earTapStateRef.current[ear];
      const nextCount = now - previous.lastAt <= 2_500 ? previous.count + 1 : 1;
      const biteThreshold = Math.max(
        2,
        Math.round(3 * difficultyPatienceMultiplier(difficultyRef.current)),
      );
      earTapStateRef.current[ear] = { count: nextCount, lastAt: now };
      getSound().warning(0.38 + nextCount * 0.18);
      vibrate(nextCount >= biteThreshold ? [34, 28, 58] : 16, settingsRef.current.vibration);

      if (nextCount >= biteThreshold) {
        earTapStateRef.current.left = { count: 0, lastAt: 0 };
        earTapStateRef.current.right = { count: 0, lastAt: 0 };
        triggerBite();
        return;
      }

      transitionTo("warning");
      armIdleTimer("warning");
    },
    [armIdleTimer, getSound, transitionTo, triggerBite],
  );

  const addParticle = useCallback((
    x: number,
    y: number,
    amount: number,
    jackpot: boolean,
  ) => {
    const id = ++particleIdRef.current;
    setParticles((current) => [
      ...current.slice(-8),
      { id, x, y, amount, jackpot },
    ]);
    setTimeout(
      () =>
        setParticles((current) =>
          current.filter((particle) => particle.id !== id),
        ),
      650,
    );
  }, []);

  const registerTap = useCallback(
    (x: number, y: number) => {
      if (riskPhaseRef.current !== "normal") return;
      const currentState = dogStateRef.current;
      if (currentState === "angry" || currentState === "recovering") return;
      if (currentState === "warning") {
        triggerBite();
        return;
      }

      const now = performance.now();
      if (lastTapAtRef.current !== null) {
        tapIntervalsRef.current = appendTapInterval(
          tapIntervalsRef.current,
          now - lastTapAtRef.current,
          5,
        );
      }
      lastTapAtRef.current = now;

      const average = rollingAverageTapInterval(tapIntervalsRef.current, 5);
      const remaining = Math.max(0, fatigueUntilRef.current - Date.now());
      const fatigueDuration = difficultyDuration(
        FATIGUE_DURATION_MS,
        difficultyRef.current,
      );
      const currentFatigue =
        remaining > 0
          ? calculateFatigueRatio(fatigueDuration - remaining, fatigueDuration)
          : 0;
      const nextSeries = seriesTapsRef.current + 1;
      const effectiveFatigue =
        currentState === "tired"
          ? Math.max(currentFatigue, 0.72)
          : currentFatigue;
      if (patienceRollRef.current === null) {
        patienceRollRef.current = Math.random();
      }
      const patienceRoll = patienceRollRef.current;
      const dynamicLimit = Math.max(
        1,
        Math.round(
          calculateTapLimit(
            average,
            effectiveFatigue,
            () => patienceRoll,
          ) * difficultyPatienceMultiplier(difficultyRef.current),
        ),
      );
      const nextLimit = Math.max(nextSeries, dynamicLimit);
      const tempoRatio = calculateTempoRatio(average);

      seriesTapsRef.current = nextSeries;
      tapLimitRef.current = nextLimit;
      setSeriesTaps(nextSeries);
      setAverageInterval(average);
      setTapPulse((current) => current + 1);
      const jackpot =
        Math.random() <
        LAST_TAP_CHANCE * difficultyLuckMultiplier(difficultyRef.current);
      const earned = awardCoins(jackpot ? 5 : 1, Number.MAX_SAFE_INTEGER, true);
      addParticle(x, y, earned, jackpot);
      updateStats((current) => ({
        ...current,
        totalTaps: current.totalTaps + 1,
        bestStreak: Math.max(current.bestStreak, nextSeries),
      }));
      getSound().tap(tempoRatio);
      vibrate(7, settingsRef.current.vibration);

      if (settingsRef.current.suliman) {
        if (currentState !== "calm") transitionTo("calm");
        armIdleTimer("calm");
        return;
      }

      if (
        currentState === "tired" &&
        Math.random() <
          TIRED_SNAP_CHANCE * difficultyTiredSnapMultiplier(difficultyRef.current)
      ) {
        triggerBite();
        return;
      }

      if (nextSeries >= nextLimit) {
        transitionTo("warning");
        getSound().warning(effectiveFatigue > 0 ? 0.92 : 0.68);
        vibrate([26, 42, 26], settingsRef.current.vibration);
        armIdleTimer("warning");
      } else if (
        !settingsRef.current.yellow &&
        currentState === "calm" &&
        nextSeries >= 4 &&
        Math.random() <
          RANDOM_TIRED_CHANCE * difficultyTiredChanceMultiplier(difficultyRef.current)
      ) {
        enterTiredMood(false);
        getSound().warning(0.46);
        vibrate([18, 32, 18], settingsRef.current.vibration);
        armIdleTimer("tired");
      } else {
        armIdleTimer(currentState === "tired" ? "tired" : "calm");
      }
    },
    [
      addParticle,
      armIdleTimer,
      awardCoins,
      enterTiredMood,
      getSound,
      transitionTo,
      triggerBite,
      updateStats,
    ],
  );

  const startHold = useCallback(
    (x: number, y: number) => {
      if (riskPhaseRef.current !== "normal") return;
      if (holdingRef.current) return;
      const currentState = dogStateRef.current;
      if (currentState === "angry" || currentState === "recovering") return;
      if (currentState === "warning") {
        triggerBite();
        return;
      }

      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
      }
      getSound().unlock();
      holdPointRef.current = { x, y };
      holdStartRef.current = performance.now();
      const standardDeadline =
        chooseUltraTapOverheatDeadline() +
        (hatEquipped ? HAT_ULTRA_BONUS_MS * (1 + (hatLevel - 1) * .22) : 0);
      ultraDeadlineRef.current = Math.min(
        10_000,
        Math.max(
          ULTRA_TAP_MIN_HOLD_MS + 100,
          Math.round(
            standardDeadline *
              difficultyUltraDeadlineMultiplier(difficultyRef.current),
          ),
        ),
      );
      ultraTwoSecondRewardRef.current = chooseUltraTapTwoSecondReward(
        hatEquipped
          ? () =>
              Math.min(
                0.999999999,
                Math.min(.42, HAT_REWARD_ROLL_FLOOR + (hatLevel - 1) * .05) +
                  Math.random() * (1 - Math.min(.42, HAT_REWARD_ROLL_FLOOR + (hatLevel - 1) * .05)),
              )
          : Math.random,
      );
      ultraDoomedRef.current =
        Math.random() < difficultyUltraFailureChance(difficultyRef.current);
      ultraAllowedRef.current = currentState !== "tired";
      holdingRef.current = true;
      ultraActiveRef.current = false;
      overheatTriggeredRef.current = false;
      setHolding(true);
      setUltraActive(false);
      setUltraCharge(0);
      setUltraPreview(0);

      holdIntervalRef.current = setInterval(() => {
        const elapsed = performance.now() - holdStartRef.current;

        if (
          ultraAllowedRef.current &&
          elapsed >= ULTRA_VISUAL_DELAY_MS &&
          !ultraActiveRef.current
        ) {
          ultraActiveRef.current = true;
          setUltraActive(true);
          getSound().ultraStart();
          vibrate(18, settingsRef.current.vibration);
        }

        if (ultraActiveRef.current) {
          setUltraCharge(
            Math.min(
              1,
              Math.max(
                0,
                (elapsed - ULTRA_VISUAL_DELAY_MS) /
                  (ULTRA_TAP_MIN_HOLD_MS - ULTRA_VISUAL_DELAY_MS),
              ),
            ),
          );
          setUltraPreview(
            elapsed >= ULTRA_TAP_MIN_HOLD_MS
              ? calculateUltraTapCoins(
                  elapsed,
                  ultraDeadlineRef.current,
                  ultraTwoSecondRewardRef.current,
                )
              : 0,
          );
          getSound().ultraPulse(elapsed / ultraDeadlineRef.current);
        }

        if (
          ultraAllowedRef.current &&
          isUltraTapOverheated(elapsed, ultraDeadlineRef.current) &&
          !overheatTriggeredRef.current
        ) {
          overheatTriggeredRef.current = true;
          triggerBite(true);
        }
      }, 120);
    },
    [getSound, hatEquipped, hatLevel, triggerBite],
  );

  const finishHold = useCallback(
    (cancelled = false) => {
      if (!holdingRef.current || overheatTriggeredRef.current) return;
      const elapsed = performance.now() - holdStartRef.current;
      const point = holdPointRef.current;

      if (cancelled) {
        stopHoldVisual("cancel");
        return;
      }

      if (!ultraAllowedRef.current) {
        stopHoldVisual("cancel");
        registerTap(point.x, point.y);
        return;
      }

      if (isUltraTapOverheated(elapsed, ultraDeadlineRef.current)) {
        overheatTriggeredRef.current = true;
        triggerBite(true);
        return;
      }

      if (elapsed < ULTRA_TAP_MIN_HOLD_MS) {
        stopHoldVisual("cancel");
        if (elapsed >= ULTRA_VISUAL_DELAY_MS) {
          if (settingsRef.current.yellow) {
            resetSeries();
            transitionTo("calm");
          } else {
            const nextFatigueUntil =
              Date.now() + chooseFatigueDuration(difficultyRef.current);
            fatigueUntilRef.current = nextFatigueUntil;
            setFatigueUntil(nextFatigueUntil);
            setRiskFatigueUntil(nextFatigueUntil);
            setClock(Date.now());
            resetSeries();
            beginRecovery("ultra");
            vibrate([26, 24, 42], settingsRef.current.vibration);
          }
          return;
        }
        registerTap(point.x, point.y);
        return;
      }

      if (ultraDoomedRef.current) {
        overheatTriggeredRef.current = true;
        triggerBite(true);
        return;
      }

      const baseReward = calculateUltraTapCoins(
        elapsed,
        ultraDeadlineRef.current,
        ultraTwoSecondRewardRef.current,
      );
      stopHoldVisual("success");
      awardCoins(baseReward, 1_000);
      if (settingsRef.current.yellow) {
        resetSeries();
        clearRoundTimers();
        transitionTo("calm");
        vibrate([35, 35, 70, 35, 110], settingsRef.current.vibration);
        return;
      }
      const nextFatigueUntil =
        Date.now() + chooseFatigueDuration(difficultyRef.current);
      fatigueUntilRef.current = nextFatigueUntil;
      setFatigueUntil(nextFatigueUntil);
      setClock(Date.now());
      resetSeries();
      clearRoundTimers();
      setRecoveryReason("ultra");
      transitionTo("recovering");
      vibrate([35, 35, 70, 35, 110], settingsRef.current.vibration);
      recoveryTimerRef.current = setTimeout(finishRecovery, 3_200);
    },
    [
      clearRoundTimers,
      awardCoins,
      beginRecovery,
      finishRecovery,
      registerTap,
      resetSeries,
      stopHoldVisual,
      transitionTo,
      triggerBite,
    ],
  );

  const showRiskNotice = useCallback((message: string) => {
    setRiskMessage(message);
    setRiskShake((current) => current + 1);
    if (riskMessageTimerRef.current) clearTimeout(riskMessageTimerRef.current);
    riskMessageTimerRef.current = setTimeout(() => setRiskMessage(""), 1_350);
  }, []);

  const startRiskSpin = useCallback(() => {
    if (riskPhaseRef.current !== "selecting" || riskCommittedRef.current) return;
    const tiredNow =
      !settingsRef.current.yellow &&
      (dogStateRef.current === "tired" || fatigueUntilRef.current > Date.now());
    if (tiredNow) {
      showRiskNotice("Кнопик устал");
      vibrate([12, 26, 12], settingsRef.current.vibration);
      return;
    }

    const availableCoins = coinsRef.current.walletCoins;
    const bet = mohawkEquipped
      ? Math.min(availableCoins, Math.max(1, Math.floor(riskBetAmount)))
      : availableCoins;
    if (bet < 1) {
      showRiskNotice("Нет монет для ставки");
      vibrate(16, settingsRef.current.vibration);
      return;
    }

    riskCommittedRef.current = true;
    clearRoundTimers();
    resetSeries();
    const outcome = createRiskOutcome(
      riskChance,
      bet,
      Math.random,
      difficultyRef.current,
    );
    const payout = outcome.won
      ? Math.round(
          bet * riskMultiplier(riskChance) *
            (mohawkEquipped ? MOHAWK_RISK_BONUS + (mohawkLevel - 1) * .02 : 1),
        )
      : 0;
    const spinDuration = RISK_SPIN_MS;
    setRiskBetAmount(bet);
    setRiskPayout(0);
    setRiskResult(null);
    const winningDegrees = riskChance * 3.6;
    setRiskRotation(1_800 + outcome.finalAngle - winningDegrees / 2);
    setRiskSpinNonce((current) => current + 1);
    setRiskMessage("");
    updateCoins((current) => ({
      walletCoins: Math.max(0, current.walletCoins - bet),
      streakCoins: Math.max(0, current.streakCoins - bet),
    }));
    setRiskStats((current) => ({
      ...current,
      spins: current.spins + 1,
      lastBet: bet,
    }));
    transitionRisk("transition");
    getSound().riskSpin();
    vibrate([18, 22, 28], settingsRef.current.vibration);

    riskTransitionTimerRef.current = setTimeout(() => {
      transitionRisk("spinning");

      let tickIndex = 0;
      const scheduleTick = () => {
        if (riskPhaseRef.current !== "spinning") return;
        getSound().riskTick(tickIndex > 17);
        if (tickIndex % 4 === 0) vibrate(3, settingsRef.current.vibration);
        const nextDelay = Math.min(470, 64 + tickIndex * 15);
        tickIndex += 1;
        riskTickTimerRef.current = setTimeout(scheduleTick, nextDelay);
      };
      scheduleTick();
      riskSlowTimerRef.current = setTimeout(() => getSound().riskSlow(), 3_450);

      riskSpinTimerRef.current = setTimeout(() => {
        if (riskTickTimerRef.current) {
          clearInterval(riskTickTimerRef.current);
          riskTickTimerRef.current = null;
        }
        const mathematicallyWon = outcome.won;
        setRiskResult(mathematicallyWon ? "win" : "lose");
        setRiskPayout(mathematicallyWon ? payout : 0);
        transitionRisk("result");
        setRiskStats((current) => ({
          ...current,
          wins: current.wins + (mathematicallyWon ? 1 : 0),
          losses: current.losses + (mathematicallyWon ? 0 : 1),
        }));
        if (mathematicallyWon) {
          updateCoins((current) => ({
            ...current,
            walletCoins: current.walletCoins + payout,
          }));
          getSound().riskWin();
          vibrate([25, 28, 54, 30, 80], settingsRef.current.vibration);
        } else {
          getSound().riskLose();
          vibrate([42, 38, 24], settingsRef.current.vibration);
        }

        riskReturnTimerRef.current = setTimeout(() => {
          if (settingsRef.current.yellow) {
            fatigueUntilRef.current = 0;
            setFatigueUntil(0);
            setRiskFatigueUntil(0);
            transitionTo("calm");
          } else {
            const tiredUntil =
              Date.now() + chooseFatigueDuration(difficultyRef.current);
            fatigueUntilRef.current = tiredUntil;
            setFatigueUntil(tiredUntil);
            setRiskFatigueUntil(tiredUntil);
            setClock(Date.now());
            setRecoveryReason("rest");
            transitionTo("tired");
          }
          transitionRisk("transition");
          riskTransitionTimerRef.current = setTimeout(() => {
            transitionRisk("normal");
            setRiskRotation(0);
            setRiskResult(null);
            setRiskPayout(0);
            riskCommittedRef.current = false;
          }, 340);
        }, RISK_RESULT_MS);
      }, spinDuration);
    }, 360);
  }, [
    clearRoundTimers,
    getSound,
    mohawkEquipped,
    mohawkLevel,
    resetSeries,
    riskBetAmount,
    riskChance,
    showRiskNotice,
    transitionRisk,
    transitionTo,
    updateCoins,
  ]);

  const handlePointerDown = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      if (riskPhaseRef.current === "selecting") {
        startRiskSpin();
        return;
      }
      if (riskPhaseRef.current !== "normal") return;
      const rect = event.currentTarget.getBoundingClientRect();
      event.currentTarget.setPointerCapture(event.pointerId);
      startHold(
        ((event.clientX - rect.left) / rect.width) * 100,
        ((event.clientY - rect.top) / rect.height) * 100,
      );
    },
    [startHold, startRiskSpin],
  );

  const handlePointerUp = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      finishHold(false);
    },
    [finishHold],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>) => {
      if (
        (event.key !== "Enter" && event.key !== " ") ||
        event.repeat
      ) {
        return;
      }
      event.preventDefault();
      if (riskPhaseRef.current === "selecting") {
        startRiskSpin();
        return;
      }
      if (riskPhaseRef.current !== "normal") return;
      startHold(50, 50);
    },
    [startHold, startRiskSpin],
  );

  const handleKeyUp = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      finishHold(false);
    },
    [finishHold],
  );

  const saveAllToVault = useCallback(() => {
    const activeCoins = coinsRef.current.walletCoins;
    if (
      dogStateRef.current !== "calm" ||
      holdingRef.current ||
      activeCoins < 2
    ) {
      return;
    }

    const protectedCoins = Math.floor(activeCoins / 2);
    const walletRect = walletBalanceRef.current?.getBoundingClientRect();
    const vaultRect = savedBalanceRef.current?.getBoundingClientRect();
    if (walletRect && vaultRect) {
      setSaveFlight({
        id: Date.now(),
        startX: walletRect.left + walletRect.width / 2,
        startY: walletRect.top + walletRect.height / 2,
        endX: vaultRect.left + vaultRect.width / 2,
        endY: vaultRect.top + vaultRect.height / 2,
        amount: protectedCoins,
      });
      if (saveFlightTimerRef.current) clearTimeout(saveFlightTimerRef.current);
      saveFlightTimerRef.current = setTimeout(() => setSaveFlight(null), 1_050);
    }

    updateCoins((current) => ({ ...current, walletCoins: 0 }));
    setVaultCoins((current) => current + protectedCoins);
    clearRoundTimers();
    resetSeries();
    if (settingsRef.current.yellow) {
      fatigueUntilRef.current = 0;
      setFatigueUntil(0);
      setRiskFatigueUntil(0);
      transitionTo("calm");
    } else {
      const tiredUntil =
        Date.now() + chooseFatigueDuration(difficultyRef.current);
      fatigueUntilRef.current = tiredUntil;
      setFatigueUntil(tiredUntil);
      setRiskFatigueUntil(tiredUntil);
      setClock(Date.now());
      setRecoveryReason("rest");
      transitionTo("tired");
    }
    getSound().safe();
    vibrate([20, 28, 44], settingsRef.current.vibration);
  }, [clearRoundTimers, getSound, resetSeries, transitionTo, updateCoins]);

  const buyFood = useCallback(() => {
    const availableSlots = Math.max(0, INVENTORY_LIMIT - foodCount);
    const quantity = Math.min(availableSlots, Math.max(1, Math.floor(foodQuantity)));
    const totalPrice = quantity * DOG_FOOD_PRICE;
    if (quantity < 1 || coinsRef.current.walletCoins < totalPrice) return;

    updateCoins((current) => ({
      ...current,
      walletCoins: current.walletCoins - totalPrice,
    }));
    setFoodCount((current) => Math.min(INVENTORY_LIMIT, current + quantity));
    setFoodQuantity(1);
    setShopMessage(`Корм ×${quantity} добавлен в запас`);
    getSound().purchase();
    vibrate([16, 22, 34], settingsRef.current.vibration);
    if (messageTimerRef.current) clearTimeout(messageTimerRef.current);
    messageTimerRef.current = setTimeout(() => setShopMessage(""), 1_800);
  }, [foodCount, foodQuantity, getSound, updateCoins]);

  const buyDrink = useCallback(() => {
    const availableSlots = Math.max(0, INVENTORY_LIMIT - drinkCount);
    const quantity = Math.min(
      availableSlots,
      Math.max(1, Math.floor(drinkQuantity)),
    );
    const totalPrice = quantity * ZHIVCHIK_PRICE;
    if (quantity < 1 || coinsRef.current.walletCoins < totalPrice) return;
    updateCoins((current) => ({
      ...current,
      walletCoins: current.walletCoins - totalPrice,
    }));
    setDrinkCount((current) => Math.min(INVENTORY_LIMIT, current + quantity));
    setDrinkQuantity(1);
    setShopMessage(`Живчик ×${quantity} добавлен в запас`);
    getSound().purchase();
    vibrate([14, 20, 30], settingsRef.current.vibration);
    if (messageTimerRef.current) clearTimeout(messageTimerRef.current);
    messageTimerRef.current = setTimeout(() => setShopMessage(""), 1_800);
  }, [drinkCount, drinkQuantity, getSound, updateCoins]);

  const activateDrink = useCallback(() => {
    if (drinkCount < 1 || riskPhaseRef.current !== "normal") return;
    setDrinkCount((current) => Math.max(0, current - 1));
    const nextBoostUntil = Math.max(Date.now(), boostUntilRef.current) + ZHIVCHIK_DURATION_MS;
    boostUntilRef.current = nextBoostUntil;
    setBoostUntil(nextBoostUntil);
    getSound().itemUse("drink");
    vibrate([16, 20, 34], settingsRef.current.vibration);
  }, [drinkCount, getSound]);

  const buyPitbull = useCallback(() => {
    const availableSlots = Math.max(0, INVENTORY_LIMIT - pitbullCount);
    const quantity = Math.min(
      availableSlots,
      Math.max(1, Math.floor(pitbullQuantity)),
    );
    const totalPrice = quantity * PITBULL_PRICE;
    if (quantity < 1 || coinsRef.current.walletCoins < totalPrice) return;
    updateCoins((current) => ({
      ...current,
      walletCoins: current.walletCoins - totalPrice,
    }));
    setPitbullCount((current) => Math.min(INVENTORY_LIMIT, current + quantity));
    setPitbullQuantity(1);
    setShopMessage(`Питбуль ×${quantity} добавлен в запас`);
    getSound().purchase();
    vibrate([18, 20, 34], settingsRef.current.vibration);
    if (messageTimerRef.current) clearTimeout(messageTimerRef.current);
    messageTimerRef.current = setTimeout(() => setShopMessage(""), 1_800);
  }, [getSound, pitbullCount, pitbullQuantity, updateCoins]);

  const activatePitbull = useCallback(() => {
    if (
      pitbullCount < 1 ||
      riskPhaseRef.current !== "normal" ||
      (!settingsRef.current.yellow && fatigueUntilRef.current > Date.now()) ||
      dogStateRef.current !== "calm"
    ) return;
    if (coinsRef.current.walletCoins < 1) {
      showRiskNotice("Сначала заработай монеты");
      return;
    }
    setPitbullCount((current) => Math.max(0, current - 1));
    setShopOpen(false);
    setCasesOpen(false);
    setSettingsOpen(false);
    riskCommittedRef.current = false;
    setRiskBetAmount(coinsRef.current.walletCoins);
    setRiskResult(null);
    setRiskPayout(0);
    setRiskRotation(0);
    transitionRisk("selecting");
    getSound().riskEnter();
    vibrate([16, 24, 34], settingsRef.current.vibration);
  }, [getSound, pitbullCount, showRiskNotice, transitionRisk]);

  const buyCola = useCallback(() => {
    const availableSlots = Math.max(0, INVENTORY_LIMIT - colaCount);
    const quantity = Math.min(availableSlots, Math.max(1, Math.floor(colaQuantity)));
    const totalPrice = quantity * COCOA_COLA_PRICE;
    if (quantity < 1 || coinsRef.current.walletCoins < totalPrice) return;
    updateCoins((current) => ({
      ...current,
      walletCoins: current.walletCoins - totalPrice,
    }));
    setColaCount((current) => Math.min(INVENTORY_LIMIT, current + quantity));
    setColaQuantity(1);
    setShopMessage(`Какао-Кола ×${quantity} добавлена в запас`);
    getSound().purchase();
    vibrate([16, 22, 34], settingsRef.current.vibration);
    if (messageTimerRef.current) clearTimeout(messageTimerRef.current);
    messageTimerRef.current = setTimeout(() => setShopMessage(""), 1_800);
  }, [colaCount, colaQuantity, getSound, updateCoins]);

  const buyTea = useCallback(() => {
    const availableSlots = Math.max(0, INVENTORY_LIMIT - teaCount);
    const quantity = Math.min(availableSlots, Math.max(1, Math.floor(teaQuantity)));
    const totalPrice = quantity * BERGAMOT_TEA_PRICE;
    if (quantity < 1 || coinsRef.current.walletCoins < totalPrice) return;
    updateCoins((current) => ({
      ...current,
      walletCoins: current.walletCoins - totalPrice,
    }));
    setTeaCount((current) => Math.min(INVENTORY_LIMIT, current + quantity));
    setTeaQuantity(1);
    setShopMessage(`Чай с бергамотом ×${quantity} добавлен в запас`);
    getSound().purchase();
    vibrate([16, 22, 34], settingsRef.current.vibration);
    if (messageTimerRef.current) clearTimeout(messageTimerRef.current);
    messageTimerRef.current = setTimeout(() => setShopMessage(""), 1_800);
  }, [getSound, teaCount, teaQuantity, updateCoins]);

  const buyVitaPower = useCallback(() => {
    const availableSlots = Math.max(0, INVENTORY_LIMIT - vitaPowerCount);
    const quantity = Math.min(availableSlots, Math.max(1, Math.floor(vitaPowerQuantity)));
    const totalPrice = quantity * VITA_POWER_PRICE;
    if (quantity < 1 || coinsRef.current.walletCoins < totalPrice) return;
    updateCoins((current) => ({
      ...current,
      walletCoins: current.walletCoins - totalPrice,
    }));
    setVitaPowerCount((current) => Math.min(INVENTORY_LIMIT, current + quantity));
    setVitaPowerQuantity(1);
    setShopMessage(`Пепси ×${quantity} добавлена в запас`);
    getSound().purchase();
    vibrate([18, 22, 42], settingsRef.current.vibration);
    if (messageTimerRef.current) clearTimeout(messageTimerRef.current);
    messageTimerRef.current = setTimeout(() => setShopMessage(""), 1_800);
  }, [getSound, updateCoins, vitaPowerCount, vitaPowerQuantity]);

  const buyMaximumBuff = useCallback((kind: ShopBuffKind) => {
    const config = kind === "food"
      ? { count: foodCount, price: DOG_FOOD_PRICE, label: "Корм" }
      : kind === "drink"
        ? { count: drinkCount, price: ZHIVCHIK_PRICE, label: "Живчик" }
        : kind === "pitbull"
          ? { count: pitbullCount, price: PITBULL_PRICE, label: "Питбуль" }
          : kind === "cola"
            ? { count: colaCount, price: COCOA_COLA_PRICE, label: "Какао-Кола" }
            : kind === "tea"
              ? { count: teaCount, price: BERGAMOT_TEA_PRICE, label: "Чай с бергамотом" }
              : { count: vitaPowerCount, price: VITA_POWER_PRICE, label: "Пепси" };
    const freeSlots = Math.max(0, INVENTORY_LIMIT - config.count);
    const affordable = Math.floor(coinsRef.current.walletCoins / config.price);
    const quantity = Math.min(freeSlots, affordable);
    if (quantity < 1) return;

    updateCoins((current) => ({ ...current, walletCoins: current.walletCoins - quantity * config.price }));
    if (kind === "food") setFoodCount((current) => Math.min(INVENTORY_LIMIT, current + quantity));
    else if (kind === "drink") setDrinkCount((current) => Math.min(INVENTORY_LIMIT, current + quantity));
    else if (kind === "pitbull") setPitbullCount((current) => Math.min(INVENTORY_LIMIT, current + quantity));
    else if (kind === "cola") setColaCount((current) => Math.min(INVENTORY_LIMIT, current + quantity));
    else if (kind === "tea") setTeaCount((current) => Math.min(INVENTORY_LIMIT, current + quantity));
    else setVitaPowerCount((current) => Math.min(INVENTORY_LIMIT, current + quantity));

    setFoodQuantity(1);
    setDrinkQuantity(1);
    setPitbullQuantity(1);
    setColaQuantity(1);
    setTeaQuantity(1);
    setVitaPowerQuantity(1);
    setShopMessage(`${config.label} ×${quantity} — куплен максимальный запас`);
    getSound().purchase();
    vibrate([22, 18, 36, 18, 52], settingsRef.current.vibration);
    if (messageTimerRef.current) clearTimeout(messageTimerRef.current);
    messageTimerRef.current = setTimeout(() => setShopMessage(""), 1_800);
  }, [colaCount, drinkCount, foodCount, getSound, pitbullCount, teaCount, updateCoins, vitaPowerCount]);

  const beginBulkBuy = useCallback((kind: ShopBuffKind) => {
    if (bulkBuyTimerRef.current) clearTimeout(bulkBuyTimerRef.current);
    bulkBuyTriggeredRef.current = false;
    setBulkBuyHolding(kind);
    bulkBuyTimerRef.current = setTimeout(() => {
      bulkBuyTriggeredRef.current = true;
      buyMaximumBuff(kind);
      setBulkBuyHolding(null);
      bulkBuyTimerRef.current = null;
    }, BULK_BUY_HOLD_MS);
  }, [buyMaximumBuff]);

  const cancelBulkBuy = useCallback(() => {
    if (bulkBuyTimerRef.current) clearTimeout(bulkBuyTimerRef.current);
    bulkBuyTimerRef.current = null;
    setBulkBuyHolding(null);
  }, []);

  const handleBuffBuyClick = useCallback((purchase: () => void) => {
    if (bulkBuyTriggeredRef.current) {
      bulkBuyTriggeredRef.current = false;
      return;
    }
    purchase();
  }, []);

  const activateVitaPower = useCallback(() => {
    if (vitaPowerShield || vitaPowerCount < 1 || riskPhaseRef.current !== "normal") return;
    setVitaPowerCount((current) => Math.max(0, current - 1));
    setVitaPowerShield(true);
    getSound().itemUse("drink");
    vibrate([20, 24, 48, 20], settingsRef.current.vibration);
  }, [getSound, vitaPowerCount, vitaPowerShield]);

  const openMiniGame = useCallback((kind: MiniGameKind) => {
    const itemCount = kind === "slots" ? colaCount : teaCount;
    if (
      itemCount < 1 ||
      miniGame !== null ||
      riskPhaseRef.current !== "normal" ||
      (!settingsRef.current.yellow && fatigueUntilRef.current > Date.now()) ||
      dogStateRef.current !== "calm"
    ) return;
    if (coinsRef.current.walletCoins < 1) {
      showRiskNotice("Сначала заработай монеты");
      return;
    }
    setShopOpen(false);
    setCasesOpen(false);
    setSettingsOpen(false);
    setMiniGameSession((current) => current + 1);
    setMiniGame(kind);
    getSound().itemUse("drink");
    vibrate([16, 24, 34], settingsRef.current.vibration);
  }, [colaCount, getSound, miniGame, showRiskNotice, teaCount]);

  const commitMiniGameBet = useCallback((kind: MiniGameKind, requestedBet: number) => {
    const availableCoins = coinsRef.current.walletCoins;
    const bet = resolveMiniGameBet(availableCoins, requestedBet, mohawkEquipped);
    const hasItem = kind === "slots" ? colaCount > 0 : teaCount > 0;
    if (!hasItem || bet < 1 || bet > availableCoins) return false;

    if (kind === "slots") setColaCount((current) => Math.max(0, current - 1));
    else setTeaCount((current) => Math.max(0, current - 1));
    updateCoins((current) => ({
      walletCoins: Math.max(0, current.walletCoins - bet),
      streakCoins: Math.max(0, current.streakCoins - bet),
    }));
    setMiniGameStats((current) => ({
      ...current,
      slotPlays: current.slotPlays + (kind === "slots" ? 1 : 0),
      minePlays: current.minePlays + (kind === "mines" ? 1 : 0),
    }));
    resetSeries();
    return true;
  }, [colaCount, mohawkEquipped, resetSeries, teaCount, updateCoins]);

  const resolveMiniGame = useCallback((kind: MiniGameKind, payout: number, won: boolean) => {
    if (payout > 0) {
      updateCoins((current) => ({
        ...current,
        walletCoins: current.walletCoins + payout,
      }));
      setBalancePulse((current) => current + 1);
    }
    setMiniGameStats((current) => ({
      ...current,
      slotWins: current.slotWins + (kind === "slots" && won ? 1 : 0),
      mineWins: current.mineWins + (kind === "mines" && won ? 1 : 0),
      mineLosses: current.mineLosses + (kind === "mines" && !won ? 1 : 0),
    }));
    if (won) {
      getSound().riskWin();
      vibrate([24, 28, 48, 28, 72], settingsRef.current.vibration);
    } else {
      getSound().riskLose();
      vibrate([40, 32, 22], settingsRef.current.vibration);
    }
    if (!settingsRef.current.yellow) {
      const tiredUntil =
        Date.now() + chooseFatigueDuration(difficultyRef.current);
      fatigueUntilRef.current = tiredUntil;
      setFatigueUntil(tiredUntil);
      setRiskFatigueUntil(tiredUntil);
      setClock(Date.now());
      setRecoveryReason("rest");
      resetSeries();
      transitionTo("tired");
    }
  }, [getSound, resetSeries, transitionTo, updateCoins]);

  const submitCheatCode = useCallback(() => {
    const normalizedCode = cheatCode.trim().toLowerCase();
    const [secretWord, amountToken, ...extraTokens] = normalizedCode.split(/\s+/);
    if (secretWord === "medoed") {
      const hasCustomAmount = amountToken !== undefined;
      const amountIsValid =
        !hasCustomAmount ||
        (extraTokens.length === 0 && /^\d+$/.test(amountToken));
      const requestedAmount = hasCustomAmount ? Number(amountToken) : 500;
      if (
        !amountIsValid ||
        !Number.isSafeInteger(requestedAmount) ||
        requestedAmount < 1
      ) {
        setCheatMessage("Укажи положительную целую сумму после секретного слова");
        return;
      }
      const grantedAmount = Math.min(requestedAmount, MAX_CHEAT_COIN_GRANT);
      updateCoins((current) => ({
        ...current,
        walletCoins: Math.min(
          Number.MAX_SAFE_INTEGER,
          current.walletCoins + grantedAmount,
        ),
      }));
      setCheatCode("");
      setCheatMessage(
        `Начислено +${grantedAmount.toLocaleString("ru-RU")} активных монет`,
      );
      getSound().purchase();
      vibrate([16, 22, 34], settingsRef.current.vibration);
      return;
    }
    if (normalizedCode === "yellow") {
      const nextEnabled = !settingsRef.current.yellow;
      setSettings((current) => ({ ...current, yellow: nextEnabled }));
      setCheatCode("");
      setCheatMessage(
        nextEnabled ? "Секретный режим включён" : "Секретный режим выключен",
      );
      if (nextEnabled) {
        clearRoundTimers();
        stopHoldVisual("cancel");
        resetSeries();
        fatigueUntilRef.current = 0;
        setFatigueUntil(0);
        setRiskFatigueUntil(0);
        setRecoveryReason("rest");
        transitionTo("calm");
      }
      getSound().safe();
      return;
    }
    if (normalizedCode === "hasbula") {
      if (hasbulaRedeemedRef.current) {
        setCheatMessage("Промокод уже был использован");
        return;
      }
      hasbulaRedeemedRef.current = true;
      updateCoins((current) => ({
        ...current,
        walletCoins: Math.min(Number.MAX_SAFE_INTEGER, current.walletCoins + 1_000),
      }));
      setHasbulaRedeemed(true);
      setCheatCode("");
      setCheatMessage("Начислено +1 000 активных монет");
      getSound().purchase();
      vibrate([16, 22, 34], settingsRef.current.vibration);
      return;
    }
    if (normalizedCode !== "baobab") {
      setCheatMessage("Код не найден");
      return;
    }
    const nextEnabled = !settingsRef.current.suliman;
    setSettings((current) => ({ ...current, suliman: nextEnabled }));
    setCheatCode("");
    setCheatMessage(
      nextEnabled ? "Секретный режим включён" : "Секретный режим выключен",
    );
    if (nextEnabled) {
      clearRoundTimers();
      stopHoldVisual("cancel");
      resetSeries();
      fatigueUntilRef.current = 0;
      setFatigueUntil(0);
      setRiskFatigueUntil(0);
      transitionTo("calm");
    }
    getSound().safe();
  }, [cheatCode, clearRoundTimers, getSound, resetSeries, stopHoldVisual, transitionTo, updateCoins]);

  const playHatBounce = useCallback(() => {
    setHatBounce((current) => current + 1);
    setHatInteractionCount((current) => current + 1);
    registerTap(50, 16);
  }, [registerTap]);

  const playMohawkSwing = useCallback(() => {
    setMohawkSwing((current) => current + 1);
    setMohawkInteractionCount((current) => current + 1);
    registerTap(50, 14);
  }, [registerTap]);

  const applyCaseRewards = useCallback((rewards: CaseReward[]) => {
    const coinReward = rewards
      .filter((reward): reward is Extract<CaseReward, { type: "coins" }> => reward.type === "coins")
      .reduce((total, reward) => total + reward.amount, 0);
    if (coinReward > 0) {
      updateCoins((current) => ({
        ...current,
        walletCoins: Math.min(Number.MAX_SAFE_INTEGER, current.walletCoins + coinReward),
      }));
      setBalancePulse((current) => current + 1);
    }

    const buffAmount = (kind: string) => rewards
      .filter((reward): reward is Extract<CaseReward, { type: "buff" }> => reward.type === "buff" && reward.kind === kind)
      .reduce((total, reward) => total + reward.amount, 0);
    setFoodCount((current) => Math.min(INVENTORY_LIMIT, current + buffAmount("food")));
    setDrinkCount((current) => Math.min(INVENTORY_LIMIT, current + buffAmount("drink")));
    setPitbullCount((current) => Math.min(INVENTORY_LIMIT, current + buffAmount("pitbull")));
    setColaCount((current) => Math.min(INVENTORY_LIMIT, current + buffAmount("cola")));
    setTeaCount((current) => Math.min(INVENTORY_LIMIT, current + buffAmount("tea")));
    setVitaPowerCount((current) => Math.min(INVENTORY_LIMIT, current + buffAmount("shield")));

    const hatUpgrades = rewards.filter((reward) => reward.type === "upgrade" && reward.kind === "hat").length;
    const mohawkUpgrades = rewards.filter((reward) => reward.type === "upgrade" && reward.kind === "mohawk").length;
    const hatItems = rewards.filter((reward) => reward.type === "item" && reward.kind === "hat").length;
    const mohawkItems = rewards.filter((reward) => reward.type === "item" && reward.kind === "mohawk").length;
    if (hatItems > 0) {
      setHatOwned(true);
      setHatUpgradeTokens((current) => Math.min(99, current + hatUpgrades + Math.max(0, hatItems - (hatOwned ? 0 : 1))));
    } else if (hatUpgrades > 0) {
      setHatUpgradeTokens((current) => Math.min(99, current + hatUpgrades));
    }
    if (mohawkItems > 0) {
      setMohawkOwned(true);
      setMohawkUpgradeTokens((current) => Math.min(99, current + mohawkUpgrades + Math.max(0, mohawkItems - (mohawkOwned ? 0 : 1))));
    } else if (mohawkUpgrades > 0) {
      setMohawkUpgradeTokens((current) => Math.min(99, current + mohawkUpgrades));
    }
  }, [hatOwned, mohawkOwned, updateCoins]);

  const beginCaseHold = useCallback(() => {
    if (!caseSequence || caseSequence.phase !== "ready") return;
    getSound().unlock();
    getSound().caseCharge();
    setCaseSequence((current) => current ? { ...current, phase: "charging" } : current);
    vibrate(18, settingsRef.current.vibration);
    caseHoldTimerRef.current = setTimeout(() => {
      const rewards = createCaseRewards(caseSequence.kind);
      if (caseSequence.kind === "common") {
        setCommonCases((current) => Math.max(0, current - 1));
      } else {
        setBigCases((current) => Math.max(0, current - 1));
      }
      applyCaseRewards(rewards);
      setCaseSequence({
        kind: caseSequence.kind,
        rewards,
        phase: "burst",
        rewardIndex: 0,
      });
      getSound().levelUp();
      vibrate([30, 36, 70, 32, 100], settingsRef.current.vibration);
      caseBurstTimerRef.current = setTimeout(() => {
        setCaseSequence((current) => current ? { ...current, phase: "reward" } : current);
      }, 900);
    }, CASE_HOLD_MS);
  }, [applyCaseRewards, caseSequence, getSound]);

  const cancelCaseHold = useCallback(() => {
    if (caseHoldTimerRef.current) clearTimeout(caseHoldTimerRef.current);
    caseHoldTimerRef.current = null;
    setCaseSequence((current) =>
      current?.phase === "charging" ? { ...current, phase: "ready" } : current,
    );
  }, []);

  const openCase = useCallback((kind: CaseKind) => {
    const available = kind === "common" ? commonCases : bigCases;
    if (available < 1) return;
    setCaseSequence({ kind, rewards: [], phase: "ready", rewardIndex: 0 });
  }, [bigCases, commonCases]);

  const buyCommonCase = useCallback(() => {
    if (coinsRef.current.walletCoins < COMMON_CASE_PRICE || commonCases >= 99) return;
    updateCoins((current) => ({ ...current, walletCoins: current.walletCoins - COMMON_CASE_PRICE }));
    setCommonCases((current) => Math.min(99, current + 1));
    getSound().purchase();
    vibrate([18, 22, 34], settingsRef.current.vibration);
  }, [commonCases, getSound, updateCoins]);

  const buyBigCase = useCallback(() => {
    if (coinsRef.current.walletCoins < BIG_CASE_PRICE || bigCases >= 99) return;
    updateCoins((current) => ({ ...current, walletCoins: current.walletCoins - BIG_CASE_PRICE }));
    setBigCases((current) => Math.min(99, current + 1));
    getSound().purchase();
    vibrate([18, 22, 34], settingsRef.current.vibration);
  }, [bigCases, getSound, updateCoins]);

  const advanceCaseReward = useCallback(() => {
    setCaseSequence((current) => {
      if (!current || current.phase !== "reward") return current;
      if (current.rewardIndex >= current.rewards.length - 1) return null;
      getSound().purchase();
      vibrate(16, settingsRef.current.vibration);
      return { ...current, rewardIndex: current.rewardIndex + 1 };
    });
  }, [getSound]);

  const upgradeClothing = useCallback((kind: "hat" | "mohawk") => {
    if (kind === "hat") {
      if (!hatOwned || hatLevel >= 5 || hatUpgradeTokens < 1) return;
      setHatLevel((current) => Math.min(5, current + 1));
      setHatUpgradeTokens((current) => Math.max(0, current - 1));
    } else {
      if (!mohawkOwned || mohawkLevel >= 5 || mohawkUpgradeTokens < 1) return;
      setMohawkLevel((current) => Math.min(5, current + 1));
      setMohawkUpgradeTokens((current) => Math.max(0, current - 1));
    }
    setShopMessage("Предмет улучшен");
    getSound().levelUp();
    vibrate([20, 24, 44], settingsRef.current.vibration);
  }, [getSound, hatLevel, hatOwned, hatUpgradeTokens, mohawkLevel, mohawkOwned, mohawkUpgradeTokens]);

  const selectNavigation = useCallback((index: number) => {
    setShopOpen(index === 0);
    setCasesOpen(index === 2);
    setSettingsOpen(false);
    setResetConfirmOpen(false);
  }, []);

  const moveNavigationThumb = useCallback((event: PointerEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(0.999, Math.max(0, (event.clientX - rect.left) / rect.width));
    // Во время свайпа двигаем только «линзу»; раздел открываем на отпускании,
    // чтобы листы не мигали и inert-слой не обрывал жест.
    setNavDragIndex(Math.floor(ratio * 3));
  }, []);

  const handleNavigationDown = useCallback((event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    navDragStartRef.current = event.clientX;
    navDidDragRef.current = false;
    // Захват указателя не включаем сразу: короткий тап должен дойти до кнопки
    // обычным click. Захват появляется только после горизонтального сдвига,
    // чтобы свайп по меню не «съедал» клики по кнопкам.
  }, []);

  const handleNavigationMove = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      if (Math.abs(event.clientX - navDragStartRef.current) <= 8) return;
      navDidDragRef.current = true;
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.setPointerCapture(event.pointerId);
      }
      moveNavigationThumb(event);
    },
    [moveNavigationThumb],
  );

  const handleNavigationUp = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      if (!navDidDragRef.current) return;
      // Свайп завершён: фиксируем таб под пальцем, открываем раздел и гасим
      // флаг, чтобы последующий click (он уходит в общий предок из-за
      // захвата указателя) не был обработан повторно.
      navDidDragRef.current = false;
      const rect = event.currentTarget.getBoundingClientRect();
      const ratio = Math.min(0.999, Math.max(0, (event.clientX - rect.left) / rect.width));
      const finalIndex = Math.floor(ratio * 3);
      setNavDragIndex(null);
      getSound().nav(finalIndex - 1);
      selectNavigation(finalIndex);
    },
    [getSound, selectNavigation],
  );

  const clickNavigation = useCallback((index: number) => {
    if (navDidDragRef.current) {
      navDidDragRef.current = false;
      return;
    }
    getSound().nav(index - 1);
    selectNavigation(index);
  }, [getSound, selectNavigation]);

  const handleNavigationKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const currentIndex = shopOpen ? 0 : casesOpen ? 2 : 1;
      const nextIndex =
        event.key === "ArrowRight"
          ? Math.min(2, currentIndex + 1)
          : Math.max(0, currentIndex - 1);
      clickNavigation(nextIndex);
    },
    [casesOpen, clickNavigation, shopOpen],
  );

  const buyOrToggleHat = useCallback(() => {
    if (!hatOwned) {
      if (coinsRef.current.walletCoins < HASBIK_HAT_PRICE) return;
      updateCoins((current) => ({
        ...current,
        walletCoins: current.walletCoins - HASBIK_HAT_PRICE,
      }));
      setHatOwned(true);
      setHatEquipped(true);
      setMohawkEquipped(false);
      setShopMessage("Тюбетейка куплена и надета");
    } else {
      setHatEquipped((current) => {
        if (!current) setMohawkEquipped(false);
        return !current;
      });
      setShopMessage(hatEquipped ? "Тюбетейка снята" : "Тюбетейка надета");
    }
    getSound().purchase();
    vibrate(22, settingsRef.current.vibration);
    if (messageTimerRef.current) clearTimeout(messageTimerRef.current);
    messageTimerRef.current = setTimeout(() => setShopMessage(""), 1_800);
  }, [getSound, hatEquipped, hatOwned, updateCoins]);

  const buyOrToggleMohawk = useCallback(() => {
    if (!mohawkOwned) {
      if (coinsRef.current.walletCoins < MOHAWK_PRICE) return;
      updateCoins((current) => ({
        ...current,
        walletCoins: current.walletCoins - MOHAWK_PRICE,
      }));
      setMohawkOwned(true);
      setMohawkEquipped(true);
      setHatEquipped(false);
      setShopMessage("Эрокез куплен и надет");
    } else {
      setMohawkEquipped((current) => {
        if (!current) setHatEquipped(false);
        return !current;
      });
      setShopMessage(mohawkEquipped ? "Эрокез снят" : "Эрокез надет");
    }
    getSound().purchase();
    vibrate(22, settingsRef.current.vibration);
    if (messageTimerRef.current) clearTimeout(messageTimerRef.current);
    messageTimerRef.current = setTimeout(() => setShopMessage(""), 1_800);
  }, [getSound, mohawkEquipped, mohawkOwned, updateCoins]);

  const feedDog = useCallback(() => {
    const tiredNow =
      dogStateRef.current === "tired" ||
      (dogStateRef.current === "recovering" &&
        fatigueUntilRef.current > Date.now());
    if (!tiredNow || foodCount < 1) return;

    clearRoundTimers();
    setFoodCount((current) => Math.max(0, current - 1));
    fatigueUntilRef.current = 0;
    setFatigueUntil(0);
    setRiskFatigueUntil(0);
    setClock(Date.now());
    setRecoveryReason("rest");
    resetSeries();
    transitionTo("calm");
    setShopMessage("Кнопик поел и снова спокоен");
    getSound().itemUse("food");
    vibrate([18, 24, 38], settingsRef.current.vibration);
    if (messageTimerRef.current) clearTimeout(messageTimerRef.current);
    messageTimerRef.current = setTimeout(() => setShopMessage(""), 1_800);
  }, [clearRoundTimers, foodCount, getSound, resetSeries, transitionTo]);

  const handleFoodItem = useCallback(() => {
    if (foodCount > 0) {
      feedDog();
      return;
    }
    const tiredNow =
      dogStateRef.current === "tired" ||
      (dogStateRef.current === "recovering" && fatigueUntilRef.current > Date.now());
    if (tiredNow && coinsRef.current.walletCoins >= DOG_FOOD_PRICE) {
      updateCoins((current) => ({ ...current, walletCoins: current.walletCoins - DOG_FOOD_PRICE }));
      clearRoundTimers();
      fatigueUntilRef.current = 0;
      setFatigueUntil(0);
      setRiskFatigueUntil(0);
      setClock(Date.now());
      setRecoveryReason("rest");
      resetSeries();
      transitionTo("calm");
      getSound().purchase();
      vibrate([16, 22, 38], settingsRef.current.vibration);
      return;
    }
    // Если нет корма и не получается быстро купить — открываем магазин, чтобы не выглядело сломанным
    setShopOpen(true);
    setShopCategory("food");
    setCasesOpen(false);
    setSettingsOpen(false);
    getSound().uiPress();
  }, [clearRoundTimers, feedDog, foodCount, getSound, resetSeries, transitionTo, updateCoins]);

  const handleDrinkItem = useCallback(() => {
    if (riskPhaseRef.current !== "normal") {
      if (coinsRef.current.walletCoins < ZHIVCHIK_PRICE && drinkCount === 0) {
        setShopOpen(true);
        setShopCategory("food");
        setCasesOpen(false);
        setSettingsOpen(false);
        getSound().uiPress();
      }
      return;
    }
    if (drinkCount > 0) {
      activateDrink();
      return;
    }
    if (coinsRef.current.walletCoins >= ZHIVCHIK_PRICE) {
      updateCoins((current) => ({ ...current, walletCoins: current.walletCoins - ZHIVCHIK_PRICE }));
      const nextBoostUntil = Math.max(Date.now(), boostUntilRef.current) + ZHIVCHIK_DURATION_MS;
      boostUntilRef.current = nextBoostUntil;
      setBoostUntil(nextBoostUntil);
      getSound().purchase();
      vibrate([14, 20, 34], settingsRef.current.vibration);
      return;
    }
    setShopOpen(true);
    setShopCategory("food");
    setCasesOpen(false);
    setSettingsOpen(false);
    getSound().uiPress();
  }, [activateDrink, drinkCount, getSound, updateCoins]);

  const handlePitbullItem = useCallback(() => {
    if (pitbullCount > 0) {
      activatePitbull();
      return;
    }
    const remainingCoins = coinsRef.current.walletCoins - PITBULL_PRICE;
    if (
      remainingCoins >= 1 &&
      riskPhaseRef.current === "normal" &&
      (settingsRef.current.yellow || fatigueUntilRef.current <= Date.now()) &&
      dogStateRef.current === "calm"
    ) {
      updateCoins((current) => ({ ...current, walletCoins: current.walletCoins - PITBULL_PRICE }));
      setShopOpen(false);
      setCasesOpen(false);
      setSettingsOpen(false);
      riskCommittedRef.current = false;
      setRiskBetAmount(remainingCoins);
      setRiskResult(null);
      setRiskPayout(0);
      setRiskRotation(0);
      transitionRisk("selecting");
      getSound().purchase();
      vibrate([16, 24, 34], settingsRef.current.vibration);
      return;
    }
    setShopOpen(true);
    setShopCategory("food");
    setCasesOpen(false);
    setSettingsOpen(false);
    getSound().uiPress();
  }, [activatePitbull, getSound, pitbullCount, transitionRisk, updateCoins]);

  const handleMiniGameItem = useCallback((kind: MiniGameKind) => {
    const itemCount = kind === "slots" ? colaCount : teaCount;
    if (itemCount > 0) {
      openMiniGame(kind);
      return;
    }
    const price = kind === "slots" ? COCOA_COLA_PRICE : BERGAMOT_TEA_PRICE;
    if (
      coinsRef.current.walletCoins - price >= 1 &&
      miniGame === null &&
      riskPhaseRef.current === "normal" &&
      (settingsRef.current.yellow || fatigueUntilRef.current <= Date.now()) &&
      dogStateRef.current === "calm"
    ) {
      updateCoins((current) => ({ ...current, walletCoins: current.walletCoins - price }));
      if (kind === "slots") setColaCount(1);
      else setTeaCount(1);
      setShopOpen(false);
      setCasesOpen(false);
      setSettingsOpen(false);
      setMiniGameSession((current) => current + 1);
      setMiniGame(kind);
      getSound().purchase();
      vibrate([16, 24, 34], settingsRef.current.vibration);
      return;
    }
    setShopOpen(true);
    setShopCategory("food");
    setCasesOpen(false);
    setSettingsOpen(false);
    getSound().uiPress();
  }, [colaCount, getSound, miniGame, openMiniGame, teaCount, updateCoins]);

  const handleVitaPowerItem = useCallback(() => {
    if (vitaPowerShield) return;
    if (vitaPowerCount > 0) {
      activateVitaPower();
      return;
    }
    if (riskPhaseRef.current === "normal" && coinsRef.current.walletCoins >= VITA_POWER_PRICE) {
      updateCoins((current) => ({ ...current, walletCoins: current.walletCoins - VITA_POWER_PRICE }));
      setVitaPowerShield(true);
      getSound().purchase();
      vibrate([20, 24, 48, 20], settingsRef.current.vibration);
      return;
    }
    setShopOpen(true);
    setShopCategory("food");
    setCasesOpen(false);
    setSettingsOpen(false);
    getSound().uiPress();
  }, [activateVitaPower, getSound, updateCoins, vitaPowerCount, vitaPowerShield]);

  const finishTutorial = useCallback(() => {
    setTutorialSeen(true);
    setTutorialOpen(false);
    setTutorialStep(0);
  }, []);

  const resetProgress = useCallback(() => {
    clearRoundTimers();
    stopHoldVisual("cancel");
    const defaults = createDefaultSave();
    const resetCoins = { walletCoins: 0, streakCoins: 0 };
    const resetStats = { bestStreak: 0, totalTaps: 0, totalBites: 0 };
    const resetLevel = {
      level: 0,
      progressCoins: 0,
      lifetimeCoins: 0,
    };
    coinsRef.current = resetCoins;
    settingsRef.current = defaults.settings;
    statsRef.current = resetStats;
    levelStateRef.current = resetLevel;
    bonusCarryRef.current = 0;
    fatigueUntilRef.current = 0;
    setCoins(resetCoins);
    setVaultCoins(0);
    setFoodCount(0);
    setFoodQuantity(1);
    setDrinkCount(0);
    setDrinkQuantity(1);
    setPitbullCount(0);
    setPitbullQuantity(1);
    setColaCount(0);
    setColaQuantity(1);
    setTeaCount(0);
    setTeaQuantity(1);
    setVitaPowerCount(0);
    setVitaPowerQuantity(1);
    setVitaPowerShield(false);
    setShieldBreakVisible(false);
    boostUntilRef.current = 0;
    setBoostUntil(0);
    setHatOwned(false);
    setHatEquipped(false);
    setMohawkOwned(false);
    setMohawkEquipped(false);
    setHatLevel(1);
    setMohawkLevel(1);
    setHatUpgradeTokens(0);
    setMohawkUpgradeTokens(0);
    setCommonCases(0);
    setBigCases(0);
    setQuestIndex(0);
    setEarInteractionCount(0);
    setHatInteractionCount(0);
    setMohawkInteractionCount(0);
    setCasesOpen(false);
    setCaseSequence(null);
    setHasbulaRedeemed(false);
    hasbulaRedeemedRef.current = false;
    setRiskFatigueUntil(0);
    setRiskChance(50);
    setRiskBetAmount(0);
    setRiskRotation(0);
    setRiskResult(null);
    setRiskPayout(0);
    setRiskMessage("");
    setRiskStats({ spins: 0, wins: 0, losses: 0, lastBet: 0 });
    setMiniGame(null);
    setMiniGameStats({ slotPlays: 0, slotWins: 0, minePlays: 0, mineWins: 0, mineLosses: 0 });
    riskCommittedRef.current = false;
    transitionRisk("normal");
    setStats(resetStats);
    setLevelState(resetLevel);
    setSettings(defaults.settings);
    setFatigueUntil(0);
    setTutorialSeen(false);
    setTutorialStep(0);
    setTutorialOpen(true);
    setShopOpen(false);
    setSettingsOpen(false);
    setResetConfirmOpen(false);
    setRecoveryReason("rest");
    setLevelBurstVisible(false);
    setShopMessage("");
    setCheatCode("");
    setCheatMessage("");
    resetSeries();
    transitionTo("calm");
    localStorage.removeItem(SAVE_KEY);
  }, [
    clearRoundTimers,
    resetSeries,
    stopHoldVisual,
    transitionRisk,
    transitionTo,
  ]);

  // A normal tap briefly sets `holding`; it must not toggle the vault button.
  const vaultLocked = dogState !== "calm" || riskPhase !== "normal" || miniGame !== null;
  const isDogTired =
    !settings.yellow &&
    (dogState === "tired" ||
      (dogState === "recovering" && fatigueUntil > clock));
  const isDogResting = !settings.yellow && fatigueUntil > clock;
  const canFeedDog = isDogTired && foodCount > 0;
  const canQuickBuyFood = isDogTired && foodCount === 0 && coins.walletCoins >= DOG_FOOD_PRICE;
  const canQuickBuyDrink = drinkCount === 0 && riskPhase === "normal" && coins.walletCoins >= ZHIVCHIK_PRICE;
  const canQuickBuyPitbull = pitbullCount === 0 && riskPhase === "normal" && dogState === "calm" && coins.walletCoins > PITBULL_PRICE;
  const canQuickBuyCola = colaCount === 0 && riskPhase === "normal" && dogState === "calm" && miniGame === null && coins.walletCoins > COCOA_COLA_PRICE;
  const canQuickBuyTea = teaCount === 0 && riskPhase === "normal" && dogState === "calm" && miniGame === null && coins.walletCoins > BERGAMOT_TEA_PRICE;
  const canQuickBuyVitaPower = !vitaPowerShield && vitaPowerCount === 0 && riskPhase === "normal" && coins.walletCoins >= VITA_POWER_PRICE;
  const canSave = !vaultLocked && coins.walletCoins >= 2;
  const saveAmount = Math.floor(coins.walletCoins / 2);
  const foodTotalPrice = foodQuantity * DOG_FOOD_PRICE;
  const remainingFoodSlots = Math.max(0, INVENTORY_LIMIT - foodCount);
  const canBuyFood =
    remainingFoodSlots > 0 &&
    foodQuantity <= remainingFoodSlots &&
    coins.walletCoins >= foodTotalPrice;
  const canBuyHat = hatOwned || coins.walletCoins >= HASBIK_HAT_PRICE;
  const canBuyMohawk = mohawkOwned || coins.walletCoins >= MOHAWK_PRICE;

  // === New swipe-to-save: свайп от активного баланса к сейфу ===
  const handleBankPointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!canSave) return;
      // Только основная кнопка мыши / один палец
      if (event.button !== 0) return;
      const plate = bankPlateRef.current;
      if (!plate) return;
      bankStartXRef.current = event.clientX;
      bankDraggingRef.current = true;
      setIsBankDragging(true);
      setBankDragProgress(0);
      try {
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
      } catch {}
    },
    [canSave],
  );

  const handleBankPointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!bankDraggingRef.current) return;
      const plate = bankPlateRef.current;
      if (!plate) return;
      const delta = event.clientX - bankStartXRef.current;
      // Свайп только вправо имеет смысл (от актива к сейфу)
      if (delta <= 0) {
        setBankDragProgress(0);
        return;
      }
      const rect = plate.getBoundingClientRect();
      // Полная дистанция ~ 45% ширины пластины — достаточно, чтобы случайно не триггерить
      const threshold = rect.width * 0.46;
      const progress = Math.min(1, delta / threshold);
      setBankDragProgress(progress);
      if (progress >= 0.92) {
        // Порог достигнут — выполняем сохранение
        bankDraggingRef.current = false;
        setIsBankDragging(false);
        setBankDragProgress(0);
        try {
          if ((event.currentTarget as HTMLElement).hasPointerCapture(event.pointerId)) {
            (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
          }
        } catch {}
        saveAllToVault();
      }
    },
    [saveAllToVault],
  );

  const handleBankPointerUp = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!bankDraggingRef.current) return;
      bankDraggingRef.current = false;
      setIsBankDragging(false);
      setBankDragProgress(0);
      try {
        if ((event.currentTarget as HTMLElement).hasPointerCapture(event.pointerId)) {
          (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
        }
      } catch {}
    },
    [],
  );

  const handleBankPointerCancel = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      bankDraggingRef.current = false;
      setIsBankDragging(false);
      setBankDragProgress(0);
      try {
        if ((event.currentTarget as HTMLElement).hasPointerCapture(event.pointerId)) {
          (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
        }
      } catch {}
    },
    [],
  );

  const handleBankKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if ((event.key === "Enter" || event.key === " ") && canSave) {
        event.preventDefault();
        saveAllToVault();
      }
    },
    [canSave, saveAllToVault],
  );

  const remainingDrinkSlots = Math.max(0, INVENTORY_LIMIT - drinkCount);
  const drinkTotalPrice = drinkQuantity * ZHIVCHIK_PRICE;
  const canBuyDrink =
    remainingDrinkSlots > 0 &&
    drinkQuantity <= remainingDrinkSlots &&
    coins.walletCoins >= drinkTotalPrice;
  const remainingPitbullSlots = Math.max(0, INVENTORY_LIMIT - pitbullCount);
  const pitbullTotalPrice = pitbullQuantity * PITBULL_PRICE;
  const canBuyPitbull =
    remainingPitbullSlots > 0 &&
    pitbullQuantity <= remainingPitbullSlots &&
    coins.walletCoins >= pitbullTotalPrice;
  const remainingColaSlots = Math.max(0, INVENTORY_LIMIT - colaCount);
  const colaTotalPrice = colaQuantity * COCOA_COLA_PRICE;
  const canBuyCola =
    remainingColaSlots > 0 &&
    colaQuantity <= remainingColaSlots &&
    coins.walletCoins >= colaTotalPrice;
  const remainingTeaSlots = Math.max(0, INVENTORY_LIMIT - teaCount);
  const teaTotalPrice = teaQuantity * BERGAMOT_TEA_PRICE;
  const canBuyTea =
    remainingTeaSlots > 0 &&
    teaQuantity <= remainingTeaSlots &&
    coins.walletCoins >= teaTotalPrice;
  const remainingVitaPowerSlots = Math.max(0, INVENTORY_LIMIT - vitaPowerCount);
  const vitaPowerTotalPrice = vitaPowerQuantity * VITA_POWER_PRICE;
  const canBuyVitaPower =
    remainingVitaPowerSlots > 0 &&
    vitaPowerQuantity <= remainingVitaPowerSlots &&
    coins.walletCoins >= vitaPowerTotalPrice;
  const boostSeconds = Math.max(0, Math.ceil((boostUntil - clock) / 1_000));
  // Ряд бафов всегда показывает все 6 кнопок; недоступные — disabled, быстрая покупка — «+».
  const selectedRiskMultiplier = Math.round(
    riskMultiplier(riskChance) * (mohawkEquipped ? MOHAWK_RISK_BONUS + (mohawkLevel - 1) * .02 : 1) * 100,
  ) / 100;
  const riskMode = riskPhase !== "normal";
  const navIndex = shopOpen ? 0 : casesOpen ? 2 : 1;
  // Контент (header + игровое поле) должен быть неактивен, когда открыт любой лист/диалог
  const contentInert =
    tutorialOpen ||
    shopOpen ||
    casesOpen ||
    settingsOpen ||
    miniGame !== null ||
    caseSequence !== null;
  // Нижняя навигация остаётся активной в магазине, кейсах и настройках (persistent nav),
  // блокируется только когда открыт туториал, мини-игра или открытие кейса
  const navInert =
    tutorialOpen ||
    miniGame !== null ||
    caseSequence !== null;
  // Для внешних слоёв, где нужна полная блокировка фона
  const anyModalOpen = contentInert;
  const currentQuest = questIndex < QUESTS.length ? QUESTS[questIndex] : null;
  const questWins = riskStats.wins + miniGameStats.slotWins + miniGameStats.mineWins;
  const questProgress = currentQuest
    ? currentQuest.metric === "taps"
      ? stats.totalTaps
      : currentQuest.metric === "vault"
        ? vaultCoins
      : currentQuest.metric === "wins"
          ? questWins
          : currentQuest.metric === "ears"
            ? earInteractionCount
            : currentQuest.metric === "hat"
              ? hatInteractionCount
              : currentQuest.metric === "mohawk"
                ? mohawkInteractionCount
          : levelState.level
    : 0;
  const questComplete = Boolean(currentQuest && questProgress >= currentQuest.target);
  const claimQuestReward = () => {
    if (!questComplete) return;
    setBigCases((current) => Math.min(99, current + 1));
    setQuestIndex((current) => Math.min(QUESTS.length, current + 1));
    getSound().levelUp();
    vibrate([18, 24, 48], settingsRef.current.vibration);
  };

  const closeSheetsToHome = useCallback(
    () => selectNavigation(1),
    [selectNavigation],
  );
  const closeSettingsSheet = useCallback(() => setSettingsOpen(false), []);
  const dismissCaseOpening = useCallback(() => {
    if (caseSequence?.phase === "reward") {
      advanceCaseReward();
      return;
    }
    setCaseSequence(null);
  }, [advanceCaseReward, caseSequence?.phase]);

  useDialogA11y(tutorialOpen, tutorialSheetRef, finishTutorial);
  useDialogA11y(shopOpen, shopSheetRef, closeSheetsToHome);
  useDialogA11y(casesOpen, casesSheetRef, closeSheetsToHome);
  useDialogA11y(settingsOpen, settingsSheetRef, closeSettingsSheet);
  useDialogA11y(caseSequence !== null, caseOpeningRef, dismissCaseOpening);

  const isHappy =
    dogState === "calm" && seriesTaps >= 3 && averageInterval <= 360;
  // Полоски эмоций видны только в своих состояниях; вне их кадр всегда 0 —
  // это выводится в render, а не сбрасывается эффектом.
  const joyAnimationActive = dogState === "calm" && joySpriteReady;
  const rageAnimationActive =
    (dogState === "angry" ||
      (dogState === "recovering" && recoveryReason === "bite")) &&
    rageSpriteReady;
  const shownJoyFrame = joyAnimationActive ? joyFrame : 0;
  const shownRageFrame = rageAnimationActive ? rageFrame : 0;

  useEffect(() => {
    if (!joyAnimationActive) return;

    const targetFrame = isHappy ? 4 : 0;
    const timer = window.setInterval(() => {
      setJoyFrame((currentFrame) => {
        if (currentFrame === targetFrame) {
          window.clearInterval(timer);
          return currentFrame;
        }

        const nextFrame =
          currentFrame + (targetFrame > currentFrame ? 1 : -1);
        if (nextFrame === targetFrame) window.clearInterval(timer);
        return nextFrame;
      });
    }, EMOTION_FRAME_MS);

    return () => window.clearInterval(timer);
  }, [isHappy, joyAnimationActive]);

  useEffect(() => {
    if (!rageAnimationActive) return;

    const targetFrame = dogState === "angry" ? 4 : 0;
    const timer = window.setInterval(() => {
      setRageFrame((currentFrame) => {
        if (currentFrame === targetFrame) {
          window.clearInterval(timer);
          return currentFrame;
        }

        const nextFrame =
          currentFrame + (targetFrame > currentFrame ? 1 : -1);
        if (nextFrame === targetFrame) window.clearInterval(timer);
        return nextFrame;
      });
    }, EMOTION_FRAME_MS);

    return () => window.clearInterval(timer);
  }, [dogState, rageAnimationActive, recoveryReason]);

  const showRageSequence =
    rageSpriteReady &&
    (dogState === "angry" ||
      (dogState === "recovering" && recoveryReason === "bite" && shownRageFrame > 0));
  const isEmotionShifting =
    (dogState === "calm" &&
      ((isHappy && shownJoyFrame < 4) || (!isHappy && shownJoyFrame > 0))) ||
    (dogState === "angry" && shownRageFrame < 4) ||
    (dogState === "recovering" && recoveryReason === "bite" && shownRageFrame > 0);
  const dogImageState =
    showRageSequence
      ? "rage"
      : dogState === "tired" ||
          dogState === "warning" ||
          (dogState === "recovering" && recoveryReason === "ultra")
        ? "warning"
        : joySpriteReady
          ? "joy"
          : "calm";
  const dogDisabled =
    dogState === "angry" ||
    dogState === "recovering" ||
    miniGame !== null ||
    riskPhase === "transition" ||
    riskPhase === "spinning" ||
    riskPhase === "result";
  const multiplier = levelMultiplier(levelState.level);
  const levelBonus = Math.round((multiplier - 1) * 100);
  const levelDetails = levelProgressDetails(levelState);
  const levelProgress = levelDetails.progressRatio;
  const paleCalm =
    riskPhase === "normal" &&
    dogState === "calm" &&
    (!seriesTaps || averageInterval >= 380);
  const tapVariant =
    tapPulse > 0 ? `tap-${tapPulse % 2 === 0 ? "a" : "b"}` : "";
  const balanceVariant =
    balancePulse > 0
      ? `balance-pulse-${balancePulse % 2 === 0 ? "a" : "b"}`
      : "";
  const ultraFarming = ultraActive && ultraCharge >= 0.999;

  const calmScene = tempoSceneColor(averageInterval, seriesTaps > 0);
  const currentScene =
    riskMode
      ? "#25272b"
      : dogState === "angry"
      ? "#d13a32"
      : dogState === "tired"
        ? "#e8c65d"
        : dogState === "warning" ||
            (dogState === "recovering" && fatigueRatio > 0)
          ? "#f4c94d"
          : dogState === "calm"
            ? calmScene
            : "#1478ed";
  const moodLabel =
    dogState === "angry"
      ? "СЕРДИТСЯ"
      : dogState === "warning"
        ? "НА ГРАНИ"
        : dogState === "tired" || dogState === "recovering"
          ? "ОТДЫХАЕТ"
          : isHappy
            ? "РАДУЕТСЯ"
            : "СПОКОЕН";

  const handleInterfacePress = useCallback((event: PointerEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    const button = target.closest("button") as HTMLButtonElement | null;
    if (!button || button.disabled || button.classList.contains("dog-button")) return;
    getSound().uiPress();
    vibrate(3, settingsRef.current.vibration);
  }, [getSound]);

  useEffect(() => {
    const themeMeta = document.querySelector<HTMLMetaElement>(
      'meta[name="theme-color"]',
    );
    document.documentElement.style.backgroundColor = currentScene;
    document.body.style.backgroundColor = currentScene;
    themeMeta?.setAttribute("content", currentScene);
  }, [currentScene]);

  const gameStyle = {
    "--calm-scene": calmScene,
    "--level-progress": levelProgress,
    "--ultra-progress": `${Math.min(100, ultraPreview / 10)}%`,
    "--ultra-fill": `${Math.round(ultraCharge * 1000) / 10}%`,
    "--risk-chance": `${riskChance * 3.6}deg`,
    "--risk-rotation": `${riskRotation}deg`,
    "--risk-sector-offset": `${180 - (riskChance * 3.6) / 2}deg`,
    "--risk-spin-duration": `${RISK_SPIN_MS}ms`,
    "--fatigue-angle": `${Math.round(fatigueCountdownRatio * 360)}deg`,
  } as CSSProperties;

  return (
    <main
      className={`game-shell state-${dogState} ${
        fatigueRatio > 0 ? "has-fatigue" : ""
      } ${holding ? "is-holding" : ""} ${
        ultraActive ? "ultra-active" : ""
      } ${biteFlash ? "bite-flash" : ""} ${paleCalm ? "pale-calm" : ""} ${
        dogState === "calm" && shownJoyFrame > 0 ? "is-happy" : ""
      } ${isEmotionShifting ? "is-emotion-shifting" : ""} ${
        riskMode ? `risk-mode risk-${riskPhase}` : ""
      } ${riskPhase === "transition" && riskResult ? "risk-returning" : ""} ${
        riskShake > 0 ? `risk-shake-${riskShake % 2}` : ""
      }`}
      data-state={dogState}
      data-hydrated={hydrated}
      style={gameStyle}
      ref={shellRef}
      onPointerDownCapture={handleInterfacePress}
    >
      <div
        className={`ultra-fire ${ultraFarming ? "is-farming" : ""}`}
        aria-hidden="true"
      >
        <svg viewBox="0 0 390 844" preserveAspectRatio="none">
          <defs>
            <linearGradient id="fire-back" x1="0" y1="1" x2="0" y2="0">
              <stop offset="0" stopColor="#ffdd55" />
              <stop offset="0.22" stopColor="#ff8a00" />
              <stop offset="0.62" stopColor="#ef340d" />
              <stop offset="1" stopColor="#8c1006" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="fire-core" x1="0" y1="1" x2="0" y2="0">
              <stop offset="0" stopColor="#fffbd1" />
              <stop offset="0.3" stopColor="#ffd83d" />
              <stop offset="0.72" stopColor="#ff6300" />
              <stop offset="1" stopColor="#df2108" stopOpacity="0" />
            </linearGradient>
          </defs>
          <g className="fire-haze">
            <path d="M0 844V520C34 568 45 455 79 510C106 552 119 402 150 462C177 513 188 348 222 438C251 515 268 383 294 453C323 529 345 397 390 502V844Z" />
          </g>
          <g className="flame-layer flame-layer-back">
            <path fill="url(#fire-back)" d="M0 844V600C23 642 36 521 61 566C82 603 82 382 112 470C128 517 147 430 158 360C173 455 190 487 203 548C222 505 224 292 251 420C263 478 279 505 294 562C322 514 329 377 349 481C361 544 371 523 390 586V844Z" />
            <path fill="url(#fire-back)" opacity=".62" d="M76 844C105 711 82 603 121 491C144 425 128 286 151 94C194 309 166 421 205 528C237 615 214 731 242 844ZM238 844C263 721 245 625 280 520C302 454 290 305 312 42C350 324 329 441 362 563C382 641 370 748 390 844Z" />
            <path fill="url(#fire-back)" opacity=".82" d="M20 844C36 748 18 699 49 631C67 590 60 511 73 440C103 541 82 594 111 657C137 714 121 779 145 844ZM151 844C164 748 147 706 177 622C197 567 187 487 204 398C230 527 211 585 242 657C266 715 249 782 270 844ZM271 844C294 763 276 711 310 633C333 580 327 499 344 414C369 544 353 607 381 672V844Z" />
          </g>
          <g className="flame-layer flame-layer-front">
            <path fill="url(#fire-core)" d="M0 844V704C24 732 32 646 53 682C68 706 72 587 91 627C106 658 120 672 130 725C149 687 151 552 173 633C187 685 192 697 204 733C225 685 228 590 248 646C264 692 267 696 279 731C301 692 306 557 329 642C342 692 356 658 368 609C384 688 380 724 390 746V844Z" />
            <path fill="#fff7b2" opacity=".78" d="M34 844C48 787 39 742 61 707C77 682 72 644 83 610C101 672 91 719 111 754C126 780 119 816 129 844ZM181 844C194 792 187 751 207 718C222 693 217 657 227 623C245 682 235 726 255 762C270 790 263 818 273 844ZM302 844C314 796 307 756 327 723C342 699 337 664 347 633C364 690 354 733 374 768V844Z" />
          </g>
          <g className="ember-field">
            {Array.from({ length: 8 }, (_, index) => (
              <circle
                key={index}
                cx={18 + ((index * 71) % 354)}
                cy={790 - ((index * 83) % 610)}
                r={index % 3 === 0 ? 2.2 : 1.25}
                style={{ "--ember-delay": `${-(index % 7) * 0.31}s` } as CSSProperties}
              />
            ))}
          </g>
        </svg>
      </div>
      <div className="game-motion-layer">
      <header className="app-header" inert={contentInert ? true : undefined}>
        <div className="top-bar">
          <button
            className="header-pill header-avatar header-settings-button"
            type="button"
            aria-label={`Открыть настройки аккаунта ${account.username}`}
            title={`Настройки (${account.username})`}
            onClick={() => {
              setShopOpen(false);
              setCasesOpen(false);
              setSettingsOpen(true);
              setDifficultyDraft(clampDifficulty(difficulty));
            }}
          >
            <svg
              className="header-settings-gear"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="3.2" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.24.6.83 1 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
          <div className="wordmark brand-lockup" aria-hidden="true"><h1>KNOPIK</h1></div>
          <div className="header-mood" role="img" aria-label={`Статус Кнопика: ${moodLabel}`}>
            <span className={`mood-indicator mood-${dogState}`} aria-hidden="true"><i /></span>
          </div>
        </div>
        {!riskMode ? (
          <div
            className="level-strip"
            role="group"
            aria-label={`Уровень ${levelState.level} из ${MAX_LEVEL}`}
          >
            <div className="level-title">
              <span>LVL</span>
              <strong>{levelState.level}<small>из {MAX_LEVEL}</small></strong>
            </div>
            <div className="level-progress-block">
              <div className="level-progress-copy">
                <span>{levelState.level >= MAX_LEVEL ? "МАКСИМУМ" : "ДО НОВОГО УРОВНЯ"}</span>
                <strong>{levelState.level >= MAX_LEVEL ? "ГОТОВО" : `${levelDetails.coinsToNext.toLocaleString("ru-RU")} монет`}</strong>
              </div>
              <div className="level-track"><span /></div>
            </div>
            <div className="level-reward">
              <small>БОНУС</small>
              <strong>+{levelBonus}%</strong>
            </div>
          </div>
        ) : (
          <div className="risk-strip" role="group" aria-label={`Шанс выигрыша ${riskChance}%`}>
            <span className="risk-strip-label">СЕКТОР {riskChance}%</span>
            <input
              type="range"
              min="10"
              max="90"
              step="10"
              value={riskChance}
              aria-label="Размер выигрышного сектора"
              onChange={(event) => {
                const nextChance = Number(event.currentTarget.value) as RiskChance;
                setRiskChance(nextChance);
                getSound().riskTick();
                vibrate(8, settingsRef.current.vibration);
              }}
            />
            <strong className="risk-multiplier">×{selectedRiskMultiplier}</strong>
          </div>
        )}
        {!riskMode && currentQuest && (
          <div className={`quest-strip ${questComplete ? "is-complete" : ""}`} role="group" aria-label="Текущее задание кейса">
            <span className="quest-symbol" aria-hidden="true">✓</span>
            <span className="quest-copy">
              <small>{`ЗАДАНИЕ ${questIndex + 1} ИЗ ${QUESTS.length}`}</small>
              <strong>{currentQuest.title}</strong>
            </span>
            {questComplete ? (
              <button type="button" onClick={claimQuestReward}>Забрать кейс</button>
            ) : (
              <b>{Math.min(questProgress, currentQuest.target).toLocaleString("ru-RU")}/{currentQuest.target.toLocaleString("ru-RU")}</b>
            )}
          </div>
        )}
        {riskPhase === "selecting" && mohawkEquipped && (
          <div className="risk-bet-control" role="group" aria-label="Размер ставки рулетки">
            <span><small>СТАВКА</small><strong>{Math.min(coins.walletCoins, Math.max(1, riskBetAmount)).toLocaleString("ru-RU")}</strong></span>
            <input
              type="range"
              min="1"
              max={Math.max(1, coins.walletCoins)}
              step="1"
              value={Math.min(coins.walletCoins, Math.max(1, riskBetAmount))}
              aria-label="Активных монет на прокрутку"
              onChange={(event) => setRiskBetAmount(Number(event.currentTarget.value))}
            />
            <button type="button" onClick={() => setRiskBetAmount(coins.walletCoins)}>ВСЁ</button>
          </div>
        )}
      </header>

      <section
        className="game-stage"
        inert={contentInert ? true : undefined}
      >
        <div
          className={`top-buff-row ${riskMode || miniGame !== null ? "is-hidden" : ""}`}
          role="group"
          aria-label="Быстрые бафы"
        >
          {/* 1. Корм — снятие усталости */}
          <button
            className={`buff-plate ${foodCount === 0 && canQuickBuyFood ? "is-quick-buy" : ""}`}
            type="button"
            disabled={miniGame !== null}
            aria-label={`Корм: ${foodCount} шт.${canQuickBuyFood ? ` (купить за ${DOG_FOOD_PRICE})` : ""}`}
            title="Корм"
            onClick={handleFoodItem}
          >
            <img className="buff-plate-img" src={publicAsset("/buffs/food.png")} alt="" draggable={false} />
            <span className={`buff-plate-badge ${canQuickBuyFood && foodCount === 0 ? "is-price" : ""}`}>
              {foodCount > 0 ? foodCount : canQuickBuyFood ? "+" : 0}
            </span>
          </button>

          {/* 2. Пепси — щит от потери монет */}
          <button
            className={`buff-plate ${vitaPowerShield ? "is-active" : ""} ${vitaPowerCount === 0 && canQuickBuyVitaPower ? "is-quick-buy" : ""}`}
            type="button"
            disabled={vitaPowerShield || miniGame !== null}
            aria-label={`Пепси (щит): ${vitaPowerShield ? "активен" : `${vitaPowerCount} шт.`}${canQuickBuyVitaPower ? ` (купить за ${VITA_POWER_PRICE})` : ""}`}
            title="Пепси"
            onClick={handleVitaPowerItem}
          >
            <img className="buff-plate-img" src={publicAsset("/buffs/pepsi.png")} alt="" draggable={false} />
            <span className={`buff-plate-badge ${canQuickBuyVitaPower && vitaPowerCount === 0 ? "is-price" : ""}`}>
              {vitaPowerShield ? "ON" : vitaPowerCount > 0 ? vitaPowerCount : canQuickBuyVitaPower ? "+" : 0}
            </span>
          </button>

          {/* 3. Живчик — буст ×4 на минуту */}
          <button
            className={`buff-plate ${boostSeconds > 0 ? "is-active" : drinkCount === 0 && canQuickBuyDrink ? "is-quick-buy" : ""}`}
            type="button"
            disabled={riskMode || miniGame !== null}
            aria-label={`Живчик ×4: ${boostSeconds > 0 ? `${boostSeconds} сек.` : `${drinkCount} шт.`}${canQuickBuyDrink ? ` (купить за ${ZHIVCHIK_PRICE})` : ""}`}
            title="Живчик"
            onClick={handleDrinkItem}
          >
            <img className="buff-plate-img" src={publicAsset("/buffs/zhivchik.png")} alt="" draggable={false} />
            <span className={`buff-plate-badge ${boostSeconds > 0 ? "is-timer" : canQuickBuyDrink && drinkCount === 0 ? "is-price" : ""}`}>
              {boostSeconds > 0 ? `${boostSeconds}с` : drinkCount > 0 ? drinkCount : canQuickBuyDrink ? "+" : 0}
            </span>
          </button>

          {/* 4. Питбуль — открывает рулетку */}
          <button
            className={`buff-plate ${pitbullCount === 0 && canQuickBuyPitbull ? "is-quick-buy" : ""}`}
            type="button"
            disabled={riskMode || dogState !== "calm" || miniGame !== null}
            aria-label={`Питбуль (рулетка): ${pitbullCount} шт.${canQuickBuyPitbull ? ` (купить за ${PITBULL_PRICE})` : ""}`}
            title="Питбуль"
            onClick={handlePitbullItem}
          >
            <img className="buff-plate-img" src={publicAsset("/buffs/pitbull.png")} alt="" draggable={false} />
            <span className={`buff-plate-badge ${canQuickBuyPitbull && pitbullCount === 0 ? "is-price" : ""}`}>
              {pitbullCount > 0 ? pitbullCount : canQuickBuyPitbull ? "+" : 0}
            </span>
          </button>

          {/* 5. Какао-Кола — слот-машина */}
          <button
            className={`buff-plate ${colaCount === 0 && canQuickBuyCola ? "is-quick-buy" : ""}`}
            type="button"
            disabled={riskMode || dogState !== "calm" || miniGame !== null}
            aria-label={`Какао-Кола (слоты): ${colaCount} шт.${canQuickBuyCola ? ` (купить за ${COCOA_COLA_PRICE})` : ""}`}
            title="Какао-Кола"
            onClick={() => handleMiniGameItem("slots")}
          >
            <img className="buff-plate-img" src={publicAsset("/buffs/cocoa-cola.png")} alt="" draggable={false} />
            <span className={`buff-plate-badge ${canQuickBuyCola && colaCount === 0 ? "is-price" : ""}`}>
              {colaCount > 0 ? colaCount : canQuickBuyCola ? "+" : 0}
            </span>
          </button>

          {/* 6. Чай с бергамотом — игра с 5 кнопками */}
          <button
            className={`buff-plate ${teaCount === 0 && canQuickBuyTea ? "is-quick-buy" : ""}`}
            type="button"
            disabled={riskMode || dogState !== "calm" || miniGame !== null}
            aria-label={`Чай с бергамотом (5 кнопок): ${teaCount} шт.${canQuickBuyTea ? ` (купить за ${BERGAMOT_TEA_PRICE})` : ""}`}
            title="Бергамот"
            onClick={() => handleMiniGameItem("mines")}
          >
            <img className="buff-plate-img" src={publicAsset("/buffs/bergamot-tea.png")} alt="" draggable={false} />
            <span className={`buff-plate-badge ${canQuickBuyTea && teaCount === 0 ? "is-price" : ""}`}>
              {teaCount > 0 ? teaCount : canQuickBuyTea ? "+" : 0}
            </span>
          </button>
        </div>

        <div className="dog-stage">
          <div className={`dog-orbit ${vitaPowerShield ? "has-vita-shield" : ""}`}>
          {isDogResting && (
            <svg className="fatigue-countdown-ring" viewBox="0 0 120 120" aria-hidden="true">
              <circle
                cx="60"
                cy="60"
                r="55"
                pathLength="100"
                style={{ strokeDashoffset: 100 - fatigueCountdownRatio * 100 }}
              />
            </svg>
          )}
          <button
            className={`dog-button ${tapVariant} ${vitaPowerShield ? "has-vita-shield" : ""} ${isDogTired ? "has-fatigue-ring" : ""}`}
            type="button"
            data-testid="knopik"
            aria-label={
              dogDisabled
                ? "Кнопик отдыхает"
                : "Тапнуть или удерживать Кнопика для ультра-тапа"
            }
            disabled={dogDisabled}
            onPointerDown={handlePointerDown}
            onPointerUp={handlePointerUp}
            onPointerCancel={() => finishHold(true)}
            onKeyDown={handleKeyDown}
            onKeyUp={handleKeyUp}
            onContextMenu={(event) => event.preventDefault()}
          >
            <span className="portrait-surface" aria-hidden="true" />
            {vitaPowerShield && <span className="vita-shield-ring" aria-hidden="true"><i /><i /><i /></span>}
            {shieldBreakVisible && <span className="vita-shield-break" aria-hidden="true"><i /><i /><i /><i /><i /><i /></span>}
            <span className="tap-waves" aria-hidden="true">
              {particles.map((particle) => (
                <i
                  className={`tap-wave ${particle.jackpot ? "jackpot" : ""}`}
                  key={`wave-${particle.id}`}
                />
              ))}
            </span>
            <span className="dog-images" data-image-state={dogImageState}>
              <img
                className="dog-image calm-image"
                src={publicAsset("/knopik-calm-earless.webp")}
                alt=""
                draggable={false}
                loading="eager"
                decoding="async"
                fetchPriority="high"
              />
              <img
                ref={joySpriteImageRef}
                className="dog-image emotion-strip joy-strip"
                src={publicAsset("/knopik-joy-sprite-earless.webp")}
                alt=""
                draggable={false}
                loading="eager"
                decoding="async"
                style={{ transform: `translate3d(-${shownJoyFrame * 20}%, 0, 0)` }}
                onLoad={() => setJoySpriteReady(true)}
              />
              <img
                className="dog-image warning-image"
                src={publicAsset("/knopik-warning-earless.webp")}
                alt=""
                draggable={false}
                loading="eager"
                decoding="async"
              />
              <img
                ref={rageSpriteImageRef}
                className="dog-image emotion-strip rage-strip"
                src={publicAsset("/knopik-rage-sprite-earless.webp")}
                alt=""
                draggable={false}
                loading="eager"
                decoding="async"
                style={{ transform: `translate3d(-${shownRageFrame * 20}%, 0, 0)` }}
                onLoad={() => setRageSpriteReady(true)}
              />
            </span>
            <span className="dog-ears" aria-hidden="true">
              <img
                className="dog-ear dog-ear-left"
                src={publicAsset("/knopik-ear-left.png")}
                alt=""
                draggable={false}
              />
              <img
                className="dog-ear dog-ear-right"
                src={publicAsset("/knopik-ear-right.png")}
                alt=""
                draggable={false}
              />
              {hatOwned && hatEquipped && (
                <>
                  <img
                    className={`dog-hat ${hatBounce ? "hat-jump" : ""}`}
                    key={`hat-${hatBounce}`}
                    src={publicAsset("/hasbik-tubeteika.png")}
                    alt=""
                    aria-hidden="true"
                    draggable={false}
                  />
                </>
              )}
              {mohawkOwned && mohawkEquipped && (
                <>
                  <img
                    className={`dog-mohawk ${mohawkSwing ? "mohawk-swing" : ""}`}
                    key={`mohawk-${mohawkSwing}`}
                    src={publicAsset("/knopik-mohawk-v2.png")}
                    alt=""
                    aria-hidden="true"
                    draggable={false}
                  />
                </>
              )}
            </span>
            <span className="tap-particles" aria-hidden="true">
              {particles.map((particle) => (
                <span
                  className={`tap-impact ${particle.jackpot ? "jackpot" : ""}`}
                  key={particle.id}
                  style={{ left: `${particle.x}%`, top: `${particle.y}%` }}
                >
                  <span className="tap-sparks">
                    {Array.from({ length: 6 }, (_, index) => (
                      <i
                        key={index}
                        style={{ "--spark-angle": `${index * 60}deg` } as CSSProperties}
                      />
                    ))}
                  </span>
                  <span className="tap-particle">
                    {particle.jackpot
                      ? `+${particle.amount} · ПОСЛЕДНИЙ ТАП ×5`
                      : `+${particle.amount}`}
                  </span>
                </span>
              ))}
            </span>
            {riskPhase !== "normal" && (
              <span className={`risk-wheel-shell ${riskResult ? `is-${riskResult}` : ""}`}>
                <span className="risk-wheel">
                  <span className="risk-dial">
                    <span className="risk-dial-rotor" key={`risk-rotor-${riskSpinNonce}`}>
                      <svg className="risk-sector-svg" viewBox="0 0 100 100" aria-hidden="true">
                        <defs>
                          <linearGradient id="risk-sector-green" x1="0" y1="0" x2="1" y2="1">
                            <stop offset="0" stopColor="#c5ff64" />
                            <stop offset="0.58" stopColor="#80df32" />
                            <stop offset="1" stopColor="#54b620" />
                          </linearGradient>
                          <radialGradient id="risk-sector-dark" cx="36%" cy="26%" r="82%">
                            <stop offset="0" stopColor="#4a545d" />
                            <stop offset="0.56" stopColor="#303841" />
                            <stop offset="1" stopColor="#151b21" />
                          </radialGradient>
                        </defs>
                        <circle cx="50" cy="50" r="48" fill="url(#risk-sector-dark)" />
                        <path d={riskSectorPath(riskChance)} fill="url(#risk-sector-green)" />
                      </svg>
                    </span>
                    <span className="risk-wheel-glass" />
                  </span>
                  <span className="risk-pointer" key={`risk-pointer-${riskSpinNonce}`}><i /></span>
                  <span className="risk-center">
                    <small>{riskPhase === "selecting" ? "НАЖМИ · ИГРАТЬ" : "ВЫИГРЫШНЫЙ СЕКТОР"}</small>
                    <strong>{riskChance}%</strong>
                    <em>×{selectedRiskMultiplier} · {(riskBetAmount || coins.walletCoins).toLocaleString("ru-RU")}</em>
                  </span>
                  {riskPhase === "result" && (
                    <span className="risk-result-copy">
                      <small>{riskResult === "win" ? "ПОБЕДА" : "СТАВКА СГОРЕЛА"}</small>
                      <strong>
                        {riskResult === "win"
                          ? `+${riskPayout.toLocaleString("ru-RU")}`
                          : `−${riskBetAmount.toLocaleString("ru-RU")}`}
                      </strong>
                    </span>
                  )}
                </span>
              </span>
            )}
            {ultraActive && (
              <span className={`ultra-readout ${ultraFarming ? "is-farming" : ""}`}>
                <small>{ultraFarming ? "ФАРМ" : "ЗАРЯД"}</small>
                <strong>
                  {ultraFarming ? `+${ultraPreview}` : `${Math.round(ultraCharge * 100)}%`}
                </strong>
              </span>
            )}
          </button>
          <div className="dog-accessory-zones">
            {(["left", "right"] as const).map((ear) => (
              <button
                className={`ear-hit ear-hit-${ear}`}
                key={ear}
                type="button"
                disabled={dogDisabled || riskPhase !== "normal"}
                aria-label={
                  ear === "left"
                    ? "Коснуться левого уха Кнопика"
                    : "Коснуться правого уха Кнопика"
                }
                onClick={() => handleEarTap(ear)}
              />
            ))}
            {hatOwned && hatEquipped && (
              <button
                className="hat-hit-zone"
                type="button"
                aria-label="Постучать по тюбетейке"
                onClick={playHatBounce}
              />
            )}
            {mohawkOwned && mohawkEquipped && (
              <button
                className="mohawk-hit-zone"
                type="button"
                aria-label="Потрепать эрокез"
                onClick={playMohawkSwing}
              />
            )}
          </div>
          </div>
        </div>

        <div className="game-data">
          {riskMessage && <p className="risk-notice" role="status" key={`risk-notice-${riskShake}`}>{riskMessage}</p>}
          <div
            ref={bankPlateRef}
            className={`unified-bank-plate swipe-plate ${canSave ? "can-save" : "is-locked"} ${isBankDragging ? "is-dragging" : ""}`}
            role="group"
            aria-label={`Баланс и перевод в сейф — ${coins.walletCoins} активных, ${vaultCoins} в сейфе`}
            onPointerDown={handleBankPointerDown}
            onPointerMove={handleBankPointerMove}
            onPointerUp={handleBankPointerUp}
            onPointerCancel={handleBankPointerCancel}
            onKeyDown={handleBankKeyDown}
            tabIndex={canSave ? 0 : -1}
            data-drag-progress={bankDragProgress.toFixed(3)}
            style={{ "--drag-progress": bankDragProgress } as CSSProperties}
          >
            {/* Заполнение фона показывает прогресс свайпа */}
            <div className="bank-swipe-fill" aria-hidden="true" style={{ width: `${Math.round(bankDragProgress * 100)}%` }} />
            <div className="bank-swipe-glow" aria-hidden="true" style={{ opacity: bankDragProgress }} />

            <div
              ref={walletBalanceRef}
              className={`bank-side bank-wallet ${balanceVariant}`}
              role="group"
              aria-label={`Активные монеты ${coins.walletCoins}`}
              data-side="wallet"
            >
              <span className="bank-glyph bank-glyph-coin" aria-hidden="true"><i>К</i></span>
              <div className="bank-side-text">
                <small>АКТИВ</small>
                <strong className="balance-number" key={`balance-${balancePulse}`}>
                  {coins.walletCoins.toLocaleString("ru-RU")}
                </strong>
              </div>
            </div>

            <div className="bank-swipe-center" aria-hidden="true">
              <span className={`bank-swipe-arrow-wrap ${canSave ? "can-animate" : "is-locked"}`}>
                {/* Минималистичная анимированная стрелка — показывает направление свайпа */}
                <i className="bank-arrow-line" />
                <i className="bank-arrow-head" />
                <i className="bank-arrow-line ghost-1" />
                <i className="bank-arrow-head ghost-1" />
                <i className="bank-arrow-line ghost-2" />
                <i className="bank-arrow-head ghost-2" />
              </span>
              {canSave && (
                <small className="bank-swipe-label">{bankDragProgress > 0.12 ? `${Math.round(bankDragProgress * 100)}%` : "→ сейф"}</small>
              )}
            </div>

            <div
              ref={savedBalanceRef}
              className={`bank-side bank-vault ${saveFlight ? "receiving-coins" : ""}`}
              role="group"
              aria-label={`Баланс сейфа ${vaultCoins} монет`}
              data-side="vault"
            >
              <span className="bank-glyph bank-glyph-vault" aria-hidden="true"><i /></span>
              <div className="bank-side-text">
                <small>В СЕЙФЕ</small>
                <strong>{vaultCoins.toLocaleString("ru-RU")}</strong>
              </div>
            </div>
          </div>
        </div>
      </section>

      <footer
        inert={navInert ? true : undefined}
        className={`bottom-bar ${miniGame !== null ? "is-locked" : ""}`}
        style={{ "--nav-index": navDragIndex ?? navIndex } as CSSProperties}
        role="tablist"
        aria-label="Разделы игры"
        onPointerDown={handleNavigationDown}
        onPointerMove={handleNavigationMove}
        onPointerUp={handleNavigationUp}
        onPointerCancel={handleNavigationUp}
        onKeyDown={handleNavigationKeyDown}
      >
        <span className="nav-thumb" aria-hidden="true" />
        <button
          className={navIndex === 0 ? "active" : ""}
          type="button"
          role="tab"
          aria-selected={navIndex === 0}
          disabled={miniGame !== null}
          onClick={() => clickNavigation(0)}
        >
          <span className="shop-icon" aria-hidden="true"><i /></span>
          <span>Магазин</span>
        </button>
        <button
          className={`home-nav ${navIndex === 1 ? "active" : ""}`}
          type="button"
          role="tab"
          aria-selected={navIndex === 1}
          disabled={miniGame !== null}
          onClick={() => clickNavigation(1)}
        >
          <span className="home-icon" aria-hidden="true"><i /></span>
          <span>Играть</span>
        </button>
        <button
          className={navIndex === 2 ? "active" : ""}
          type="button"
          role="tab"
          aria-selected={navIndex === 2}
          disabled={miniGame !== null}
          onClick={() => clickNavigation(2)}
        >
          <span className="case-nav-icon" aria-hidden="true"><i /></span>
          <span>Кейсы</span>
        </button>
      </footer>
      </div>

      {miniGame && (
        <MiniGamePanel
          key={`${miniGame}-${miniGameSession}`}
          kind={miniGame}
          balance={coins.walletCoins}
          difficulty={difficultyWithBalancePenalty(difficulty, coins.walletCoins)}
          canChooseBet={mohawkEquipped}
          stats={miniGameStats}
          onCommitBet={commitMiniGameBet}
          onResolve={resolveMiniGame}
          onClose={() => setMiniGame(null)}
          onTick={() => {
            getSound().riskTick();
            vibrate(5, settingsRef.current.vibration);
          }}
        />
      )}

      {saveFlight && (
        <div
          className="save-flight"
          key={saveFlight.id}
          aria-hidden="true"
          style={{
            "--flight-start-x": `${saveFlight.startX}px`,
            "--flight-start-y": `${saveFlight.startY}px`,
            "--flight-end-x": `${saveFlight.endX - saveFlight.startX}px`,
            "--flight-end-y": `${saveFlight.endY - saveFlight.startY}px`,
          } as CSSProperties}
        >
          {Array.from({ length: 9 }, (_, index) => (
            <i
              key={index}
              style={{
                "--flight-delay": `${index * 34}ms`,
                "--flight-mid-x": `${(saveFlight.endX - saveFlight.startX) * 0.46 + (index - 4) * 4}px`,
                "--flight-mid-y": `${(saveFlight.endY - saveFlight.startY) * 0.46 - 48 - (index % 4) * 12}px`,
              } as CSSProperties}
            >K</i>
          ))}
          <strong>+{saveFlight.amount.toLocaleString("ru-RU")}</strong>
        </div>
      )}

      {levelBurstVisible && (
        <div className="level-burst" key={levelBurstKey} aria-hidden="true">
          {Array.from({ length: 24 }, (_, index) => (
            <i
              key={index}
              style={{
                "--burst-angle": `${index * 15}deg`,
                "--burst-distance": `${-(125 + (index % 4) * 24)}px`,
                "--burst-delay": `${(index % 6) * 18}ms`,
              } as CSSProperties}
            />
          ))}
        </div>
      )}

      {casesOpen && (
        <div
          className="modal-backdrop"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) selectNavigation(1);
          }}
        >
          <section className="sheet cases-sheet" role="dialog" aria-modal="true" aria-labelledby="cases-title" ref={casesSheetRef} tabIndex={-1}>
            <div className="cases-heading">
              <div><p className="sheet-kicker">НАГРАДЫ</p><h2 id="cases-title">Кейсы</h2></div>
              <span><strong>{commonCases + bigCases}</strong><small>доступно</small></span>
            </div>
            <div className="case-list">
              <article className="case-card case-common-card">
                <div className="case-miniature" aria-hidden="true"><i /><b>3</b></div>
                <div><small>ЗА НОВЫЙ УРОВЕНЬ</small><h3>Обычный кейс</h3><p>Три награды: монеты, бафы или улучшения.</p></div>
                <div className="case-card-actions">
                  <button type="button" disabled={commonCases < 1} onClick={() => openCase("common")}>Открыть · {commonCases}</button>
                  <button type="button" disabled={coins.walletCoins < COMMON_CASE_PRICE || commonCases >= 99} onClick={buyCommonCase}>Купить · {COMMON_CASE_PRICE.toLocaleString("ru-RU")}</button>
                </div>
              </article>
              <article className="case-card case-big-card">
                <div className="case-miniature" aria-hidden="true"><i /><b>5</b></div>
                <div><small>ЗА ЗАДАНИЯ</small><h3>Большой кейс</h3><p>Пять наград и шанс получить одежду целиком.</p></div>
                <div className="case-card-actions">
                  <button type="button" disabled={bigCases < 1} onClick={() => openCase("big")}>Открыть · {bigCases}</button>
                  <button type="button" disabled={coins.walletCoins < BIG_CASE_PRICE || bigCases >= 99} onClick={buyBigCase}>Купить · {BIG_CASE_PRICE.toLocaleString("ru-RU")}</button>
                </div>
              </article>
            </div>
            <div className={`case-quest-card ${questComplete ? "is-complete" : ""}`}>
              <span aria-hidden="true">✓</span>
              <div>
                <small>{currentQuest ? `ЗАДАНИЕ ${questIndex + 1} ИЗ ${QUESTS.length}` : "ЦЕПОЧКА ЗАВЕРШЕНА"}</small>
                <strong>{currentQuest?.title ?? "Все задания выполнены"}</strong>
                {currentQuest && <progress max={currentQuest.target} value={Math.min(questProgress, currentQuest.target)} aria-label={`Прогресс задания: ${Math.min(questProgress, currentQuest.target)} из ${currentQuest.target}`} />}
              </div>
              {currentQuest && (
                questComplete
                  ? <button type="button" onClick={claimQuestReward}>Забрать</button>
                  : <b>{Math.min(questProgress, currentQuest.target)}/{currentQuest.target}</b>
              )}
            </div>
            <p className="case-hint">Следующее задание откроется после получения награды.</p>
          </section>
        </div>
      )}

      {caseSequence && (
        <div
          className={`case-opening case-${caseSequence.kind} phase-${caseSequence.phase}`}
          role="dialog"
          aria-modal="true"
          aria-label="Открытие кейса"
          ref={caseOpeningRef}
          tabIndex={-1}
        >
          {caseSequence.phase === "reward" ? (
            <button className="case-reward-screen" type="button" onClick={advanceCaseReward}>
              <small>НАГРАДА {caseSequence.rewardIndex + 1} ИЗ {caseSequence.rewards.length}</small>
              <span className={`case-reward-icon reward-${caseSequence.rewards[caseSequence.rewardIndex].type}`} aria-hidden="true"><CaseRewardArtwork reward={caseSequence.rewards[caseSequence.rewardIndex]} /></span>
              <h2>{caseSequence.rewards[caseSequence.rewardIndex].label}</h2>
              <p>{caseSequence.rewardIndex < caseSequence.rewards.length - 1 ? "Нажми, чтобы увидеть следующую награду" : "Нажми, чтобы забрать всё"}</p>
            </button>
          ) : (
            <div className="case-opening-stage">
              <p>{caseSequence.phase === "ready" ? "Зажми кейс" : caseSequence.phase === "charging" ? "Не отпускай…" : "Открыто!"}</p>
              <button
                className="case-crate"
                type="button"
                aria-label="Зажать и открыть кейс"
                onPointerDown={beginCaseHold}
                onPointerUp={cancelCaseHold}
                onPointerCancel={cancelCaseHold}
                onPointerLeave={cancelCaseHold}
                onKeyDown={(event) => {
                  if (!event.repeat && (event.key === "Enter" || event.key === " ")) beginCaseHold();
                }}
                onKeyUp={(event) => {
                  if (event.key === "Enter" || event.key === " ") cancelCaseHold();
                }}
                onContextMenu={(event) => event.preventDefault()}
              >
                <span className="case-crate-lid" />
                <span className="case-crate-body"><i>{caseSequence.kind === "common" ? "3" : "5"}</i></span>
                <span className="case-charge-ring" />
              </button>
              <small>{caseSequence.kind === "common" ? "Обычный кейс · 3 награды" : "Большой кейс · 5 наград"}</small>
            </div>
          )}
          <span className="case-burst-flash" aria-hidden="true" />
          <span className="case-burst-rays" aria-hidden="true" />
          <span className="case-burst-particles" aria-hidden="true">{Array.from({ length: 48 }, (_, index) => <i key={index} style={{ "--case-angle": `${index * 7.5}deg`, "--case-distance": `${220 + (index % 6) * 38}px`, "--case-delay": `${(index % 7) * 14}ms` } as CSSProperties} />)}</span>
          <span className="case-burst-confetti" aria-hidden="true">{Array.from({ length: 28 }, (_, index) => <i key={index} style={{
            "--case-angle": `${(index * (360 / 28))}deg`,
            "--case-distance": `${260 + (index % 5) * 50}px`,
            "--case-delay": `${(index % 6) * 22}ms`,
            background: ["#ff5277", "#ffd84d", "#5ad6ff", "#5cff8a", "#ff7d3a", "#a26bff", "#ff4f8a"][index % 7],
          } as CSSProperties} />)}</span>
          <span className="case-shockwave" aria-hidden="true" />
          <span className="case-light-leak" aria-hidden="true" />
        </div>
      )}

      {tutorialOpen && (
        <div className="modal-backdrop tutorial-backdrop">
          <section
            className="tutorial-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="tutorial-title"
            ref={tutorialSheetRef}
            tabIndex={-1}
          >
            <div className="tutorial-visual" aria-hidden="true">
              <span>{tutorialSlides[tutorialStep].symbol}</span>
              <i />
            </div>
            <p className="sheet-kicker">{tutorialSlides[tutorialStep].eyebrow}</p>
            <h2 id="tutorial-title">{tutorialSlides[tutorialStep].title}</h2>
            <p>{tutorialSlides[tutorialStep].copy}</p>
            <div className="tutorial-dots" role="group" aria-label={`Шаг ${tutorialStep + 1} из ${tutorialSlides.length}`}>
              {tutorialSlides.map((_, index) => (
                <span className={index === tutorialStep ? "active" : ""} key={index} />
              ))}
            </div>
            <button
              className="primary-button"
              type="button"
              onClick={() =>
                tutorialStep < tutorialSlides.length - 1
                  ? setTutorialStep((current) => current + 1)
                  : finishTutorial()
              }
            >
              {tutorialStep === tutorialSlides.length - 1 ? "Начать игру" : "Дальше"}
            </button>
          </section>
        </div>
      )}

      {shopOpen && (
        <div
          className="modal-backdrop"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) selectNavigation(1);
          }}
        >
          <section className="sheet shop-sheet" role="dialog" aria-modal="true" aria-labelledby="shop-title" ref={shopSheetRef} tabIndex={-1}>
            <div className="shop-hero-row">
              <div className="sheet-heading"><h2 id="shop-title">Магазин</h2></div>
              <div className="shop-wallet">
                <span><strong>{coins.walletCoins.toLocaleString("ru-RU")}</strong></span>
                <span className="coin-mark" aria-hidden="true"><i>К</i></span>
              </div>
            </div>

            <div className="shop-categories" role="tablist" aria-label="Разделы магазина">
              <button
                className={shopCategory === "food" ? "active" : ""}
                type="button"
                role="tab"
                aria-selected={shopCategory === "food"}
                tabIndex={shopCategory === "food" ? 0 : -1}
                onClick={() => setShopCategory("food")}
                onKeyDown={(event) => {
                  if (["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) {
                    event.preventDefault();
                    setShopCategory("clothes");
                    (event.currentTarget.nextElementSibling as HTMLButtonElement | null)?.focus();
                  }
                }}
              >
                Бафы
              </button>
              <button
                className={shopCategory === "clothes" ? "active" : ""}
                type="button"
                role="tab"
                aria-selected={shopCategory === "clothes"}
                tabIndex={shopCategory === "clothes" ? 0 : -1}
                onClick={() => setShopCategory("clothes")}
                onKeyDown={(event) => {
                  if (["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) {
                    event.preventDefault();
                    setShopCategory("food");
                    (event.currentTarget.previousElementSibling as HTMLButtonElement | null)?.focus();
                  }
                }}
              >
                Одежда
              </button>
            </div>

            <div className="shop-section-copy">
              <strong>{shopCategory === "food" ? "Бафы" : "Одежда"}</strong>
              <span>{shopCategory === "food" ? "Усиления, восстановление и игровые режимы." : "Предметы с постоянными способностями."}</span>
            </div>

            {shopMessage && <p className="purchase-message" role="status">{shopMessage}</p>}

            {shopCategory === "food" && <div className="shop-product-grid">
            <article className="shop-card shop-product-card food-card">
              <span className="food-pack" aria-hidden="true">
                <img className="shop-buff-image" src={publicAsset("/buffs/food.png")} alt="" draggable={false} />
              </span>
              <div className="food-copy">
                <small>ЗАПАС {foodCount}/{INVENTORY_LIMIT}</small>
                <h3>Корм для Кнопика</h3>
                <p>Полностью снимает усталость.</p>
              </div>
              <button className={`shop-buy-button ${bulkBuyHolding === "food" ? "is-bulk-holding" : ""}`} type="button" disabled={!canBuyFood} onPointerDown={() => beginBulkBuy("food")} onPointerUp={cancelBulkBuy} onPointerCancel={cancelBulkBuy} onPointerLeave={cancelBulkBuy} onClick={() => handleBuffBuyClick(buyFood)}>
                <span>{remainingFoodSlots === 0
                  ? "Запас заполнен"
                  : `Купить · ${DOG_FOOD_PRICE}`}</span>
              </button>
            </article>

            <article className="shop-card shop-product-card drink-card">
              <span className="drink-pack zhivchik-pack" aria-hidden="true"><img className="shop-buff-image" src={publicAsset("/buffs/zhivchik.png")} alt="" draggable={false} /></span>
              <div className="food-copy">
                <small>ЗАПАС {drinkCount}/{INVENTORY_LIMIT}</small>
                <h3>Напиток «Живчик»</h3>
                <p>Умножает обычные тапы на 4 на одну минуту.</p>
              </div>
              <button className={`shop-buy-button drink-action ${bulkBuyHolding === "drink" ? "is-bulk-holding" : ""}`} type="button" disabled={!canBuyDrink} onPointerDown={() => beginBulkBuy("drink")} onPointerUp={cancelBulkBuy} onPointerCancel={cancelBulkBuy} onPointerLeave={cancelBulkBuy} onClick={() => handleBuffBuyClick(buyDrink)}>
                <span>{remainingDrinkSlots === 0
                  ? "Запас заполнен"
                  : `Купить · ${ZHIVCHIK_PRICE}`}</span>
              </button>
            </article>

            <article className="shop-card shop-product-card pitbull-card">
              <span className="drink-pack pitbull-pack" aria-hidden="true"><img className="shop-buff-image" src={publicAsset("/buffs/pitbull.png")} alt="" draggable={false} /></span>
              <div className="food-copy">
                <small>ЗАПАС {pitbullCount}/{INVENTORY_LIMIT}</small>
                <h3>Напиток «Питбуль»</h3>
                <p>Открывает одну игру в рулетку.</p>
              </div>
              <button className={`shop-buy-button pitbull-action ${bulkBuyHolding === "pitbull" ? "is-bulk-holding" : ""}`} type="button" disabled={!canBuyPitbull} onPointerDown={() => beginBulkBuy("pitbull")} onPointerUp={cancelBulkBuy} onPointerCancel={cancelBulkBuy} onPointerLeave={cancelBulkBuy} onClick={() => handleBuffBuyClick(buyPitbull)}>
                <span>{remainingPitbullSlots === 0
                  ? "Запас заполнен"
                  : `Купить · ${PITBULL_PRICE}`}</span>
              </button>
            </article>

            <article className="shop-card shop-product-card cola-card">
              <span className="drink-pack cola-pack" aria-hidden="true"><img className="shop-buff-image" src={publicAsset("/buffs/cocoa-cola.png")} alt="" draggable={false} /></span>
              <div className="food-copy">
                <small>ЗАПАС {colaCount}/{INVENTORY_LIMIT}</small>
                <h3>Какао-Кола</h3>
                <p>Открывает мини-игру «Три барабана».</p>
              </div>
              <button className={`shop-buy-button cola-action ${bulkBuyHolding === "cola" ? "is-bulk-holding" : ""}`} type="button" disabled={!canBuyCola} onPointerDown={() => beginBulkBuy("cola")} onPointerUp={cancelBulkBuy} onPointerCancel={cancelBulkBuy} onPointerLeave={cancelBulkBuy} onClick={() => handleBuffBuyClick(buyCola)}>
                <span>{remainingColaSlots === 0
                  ? "Запас заполнен"
                  : `Купить · ${COCOA_COLA_PRICE}`}</span>
              </button>
            </article>

            <article className="shop-card shop-product-card tea-card">
              <span className="drink-pack tea-pack" aria-hidden="true"><img className="shop-buff-image" src={publicAsset("/buffs/bergamot-tea.png")} alt="" draggable={false} /></span>
              <div className="food-copy">
                <small>ЗАПАС {teaCount}/{INVENTORY_LIMIT}</small>
                <h3>Чай с бергамотом</h3>
                <p>Открывает игру с пятью кнопками и миной.</p>
              </div>
              <button className={`shop-buy-button tea-action ${bulkBuyHolding === "tea" ? "is-bulk-holding" : ""}`} type="button" disabled={!canBuyTea} onPointerDown={() => beginBulkBuy("tea")} onPointerUp={cancelBulkBuy} onPointerCancel={cancelBulkBuy} onPointerLeave={cancelBulkBuy} onClick={() => handleBuffBuyClick(buyTea)}>
                <span>{remainingTeaSlots === 0
                  ? "Запас заполнен"
                  : `Купить · ${BERGAMOT_TEA_PRICE}`}</span>
              </button>
            </article>

            <article className="shop-card shop-product-card vita-card">
              <span className="drink-pack vita-pack" aria-hidden="true"><img className="shop-buff-image" src={publicAsset("/buffs/pepsi.png")} alt="" draggable={false} /></span>
              <div className="food-copy">
                <small>ЗАПАС {vitaPowerCount}/{INVENTORY_LIMIT}</small>
                <h3>Пепси</h3>
                <p>Активирует щит и спасает монеты при укусе.</p>
              </div>
              <button className={`shop-buy-button vita-action ${bulkBuyHolding === "vita" ? "is-bulk-holding" : ""}`} type="button" disabled={!canBuyVitaPower} onPointerDown={() => beginBulkBuy("vita")} onPointerUp={cancelBulkBuy} onPointerCancel={cancelBulkBuy} onPointerLeave={cancelBulkBuy} onClick={() => handleBuffBuyClick(buyVitaPower)}>
                <span>{remainingVitaPowerSlots === 0
                  ? "Запас заполнен"
                  : `Купить · ${VITA_POWER_PRICE}`}</span>
              </button>
            </article>
            </div>}

            {shopCategory === "clothes" && (<div className="shop-product-grid shop-clothes-grid">
            <article className={`shop-card shop-product-card hat-card ${hatOwned ? "owned" : ""}`}>
              <span className="hat-preview" aria-hidden="true">
                <img src={publicAsset("/hasbik-tubeteika.png")} alt="" draggable={false} />
              </span>
              <div className="food-copy">
                <small>{hatOwned ? `LVL ${hatLevel}/5 · УЛУЧШЕНИЙ ${hatUpgradeTokens}` : "АКСЕССУАР"}</small>
                <h3>Тюбетейка Хасбика</h3>
                <p>Улучшает награду и удержание ультра-тапа.</p>
              </div>
              <div className="clothing-actions">
                <button className="shop-buy-button hat-action" type="button" disabled={!canBuyHat} onClick={buyOrToggleHat}>
                  {hatOwned
                    ? hatEquipped ? "Снять" : "Надеть"
                    : `Купить · ${HASBIK_HAT_PRICE}`}
                </button>
                <button className="clothing-upgrade-button" type="button" disabled={!hatOwned || hatLevel >= 5 || hatUpgradeTokens < 1} onClick={() => upgradeClothing("hat")}>
                  {hatLevel >= 5 ? "Максимум" : `Улучшить · ${hatUpgradeTokens}`}
                </button>
              </div>
            </article>
            <article className={`shop-card shop-product-card mohawk-card ${mohawkOwned ? "owned" : ""}`}>
              <span className="mohawk-preview" aria-hidden="true">
                <img src={publicAsset("/knopik-mohawk-v2.png")} alt="" draggable={false} />
              </span>
              <div className="food-copy">
                <small>{mohawkOwned ? `LVL ${mohawkLevel}/5 · УЛУЧШЕНИЙ ${mohawkUpgradeTokens}` : "АКСЕССУАР"}</small>
                <h3>Эрокез</h3>
                <p>Улучшает коэффициенты и открывает выбор ставки.</p>
              </div>
              <div className="clothing-actions">
                <button className="shop-buy-button mohawk-action" type="button" disabled={!canBuyMohawk} onClick={buyOrToggleMohawk}>
                  {mohawkOwned
                    ? mohawkEquipped ? "Снять" : "Надеть"
                    : `Купить · ${MOHAWK_PRICE}`}
                </button>
                <button className="clothing-upgrade-button" type="button" disabled={!mohawkOwned || mohawkLevel >= 5 || mohawkUpgradeTokens < 1} onClick={() => upgradeClothing("mohawk")}>
                  {mohawkLevel >= 5 ? "Максимум" : `Улучшить · ${mohawkUpgradeTokens}`}
                </button>
              </div>
            </article>
            </div>)}

          </section>
        </div>
      )}

      {settingsOpen && (
        <div
          className="modal-backdrop"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) selectNavigation(1);
          }}
        >
          <section className="sheet settings-sheet" role="dialog" aria-modal="true" aria-labelledby="settings-title" ref={settingsSheetRef} tabIndex={-1}>
            <div className="sheet-heading">
              <div><p className="sheet-kicker">KNOPIK</p><h2 id="settings-title">Настройки</h2></div>
            </div>

            <p className="settings-section-title">Аккаунт</p>
            <div className="account-settings">
              <div className="account-summary">
                <span className="account-avatar" aria-hidden="true">{account.username.slice(0, 1).toUpperCase()}</span>
                <div>
                  <strong>{account.username}</strong>
                  <span>{syncState === "saved" ? "Прогресс сохранён" : syncState === "saving" ? "Сохранение…" : "Сохранится при следующей попытке"}</span>
                </div>
              </div>
              <form
                className="password-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void submitPasswordChange();
                }}
              >
                <label>
                  <span>Новый пароль</span>
                  <input
                    id="new-password"
                    name="new-password"
                    type="password"
                    value={newPassword}
                    onChange={(event) => {
                      setNewPassword(event.currentTarget.value);
                      setAccountMessage("");
                    }}
                    placeholder="Минимум 6 символов"
                    autoComplete="new-password"
                    minLength={6}
                    required
                  />
                </label>
                <button type="submit" disabled={accountPending}>Сменить пароль</button>
              </form>
              {accountMessage && <p className="account-message" role="status">{accountMessage}</p>}
              <button className="settings-sign-out" type="button" disabled={accountPending} onClick={() => void signOutAccount()}>Выйти из аккаунта</button>
            </div>
            <p className="settings-section-title">Игра</p>
            <div className="setting-row">
              <div><strong>Звук</strong><span>Тактильные, живые игровые эффекты</span></div>
              <button className="switch" type="button" role="switch" aria-checked={settings.sound} aria-label="Звук" onClick={() => setSettings((current) => ({ ...current, sound: !current.sound }))}><span /></button>
            </div>
            {account.isAdmin && (
              <section className="difficulty-panel">
                <div className="difficulty-heading">
                  <div>
                    <strong>Скрытая сложность</strong>
                    <span>Общая для всех игроков · текущая игра = {DEFAULT_DIFFICULTY}</span>
                  </div>
                  <output htmlFor="difficulty-range">{difficultyDraft}</output>
                </div>
                <input
                  id="difficulty-range"
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={difficultyDraft}
                  aria-label="Скрытая сложность игры"
                  onChange={(event) => {
                    setDifficultyDraft(clampDifficulty(Number(event.currentTarget.value)));
                    setDifficultyMessage("");
                  }}
                />
                <div className="difficulty-scale" aria-hidden="true">
                  <span><b>0</b> очень легко</span>
                  <span><b>50</b> стандарт</span>
                  <span><b>100</b> сложно</span>
                </div>
                <button
                  className="difficulty-save"
                  type="button"
                  disabled={difficultyPending || difficultyDraft === difficulty}
                  onClick={() => void submitDifficulty()}
                >
                  {difficultyPending ? "Сохраняем…" : "Сохранить сложность"}
                </button>
                {difficultyMessage && <p className="difficulty-message" role="status">{difficultyMessage}</p>}
              </section>
            )}
            <p className="settings-section-title">Бонусы</p>
            <section className={`promo-panel ${account.isAdmin ? "promo-admin" : "promo-redeem"}`}>
              <div className="promo-heading">
                <span className="promo-symbol" aria-hidden="true">%</span>
                <div>
                  <strong>{account.isAdmin ? "Промокоды" : "Есть промокод?"}</strong>
                  <span>{account.isAdmin ? "Создай одноразовое начисление монет" : "Активировать его можно только один раз"}</span>
                </div>
              </div>
              <form
                className="promo-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void submitPromoCode();
                }}
              >
                <label>
                  <span>Промокод</span>
                  <input
                    name="promo-code"
                    type="text"
                    value={promoCode}
                    placeholder="Например, KNOPIK100"
                    autoCapitalize="characters"
                    autoCorrect="off"
                    spellCheck={false}
                    maxLength={32}
                    required
                    onChange={(event) => {
                      setPromoCode(event.currentTarget.value.toUpperCase());
                      setPromoMessage("");
                    }}
                  />
                </label>
                {account.isAdmin && (
                  <label>
                    <span>Сумма монет</span>
                    <input
                      className="promo-amount"
                      name="promo-amount"
                      type="number"
                      inputMode="numeric"
                      min="1"
                      max="1000000000"
                      value={promoAmount}
                      placeholder="100"
                      required
                      onChange={(event) => {
                        setPromoAmount(event.currentTarget.value);
                        setPromoMessage("");
                      }}
                    />
                  </label>
                )}
                <button type="submit" disabled={promoPending}>
                  {promoPending ? "Подождите…" : account.isAdmin ? "Создать" : "Активировать"}
                </button>
              </form>
              {promoMessage && <p className="promo-message" role="status">{promoMessage}</p>}
              {account.isAdmin && (
                <div className="promo-list" role="group" aria-label="Созданные промокоды">
                  <div className="promo-list-title"><span>ВСЕ КОДЫ</span><strong>{promoCodes.length}</strong></div>
                  {promoCodes.length === 0 ? (
                    <p className="promo-empty">Пока нет созданных промокодов.</p>
                  ) : promoCodes.map((promo) => (
                    <div className={`promo-code-row ${promo.redeemed ? "is-used" : ""}`} key={promo.id}>
                      <span><strong>{promo.code}</strong><small>{new Date(promo.createdAt).toLocaleDateString("ru-RU")}</small></span>
                      <span><strong>+{promo.amount.toLocaleString("ru-RU")}</strong><small>{promo.redeemed ? "ИСПОЛЬЗОВАН" : "ДОСТУПЕН"}</small></span>
                    </div>
                  ))}
                </div>
              )}
            </section>
            <p className="settings-section-title">Дополнительно</p>
            <form
              className={`cheat-row ${settings.suliman || settings.yellow ? "is-active" : ""}`}
              onSubmit={(event) => {
                event.preventDefault();
                submitCheatCode();
              }}
            >
              <div>
                <strong>Чит-код</strong>
                <span>{settings.suliman || settings.yellow ? `Секретных режимов активно: ${Number(settings.suliman) + Number(settings.yellow)}` : "Введи секретное слово"}</span>
              </div>
              <label>
                <input
                  type="text"
                  value={cheatCode}
                  placeholder="Код"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  aria-label="Чит-код"
                  onChange={(event) => {
                    setCheatCode(event.currentTarget.value);
                    setCheatMessage("");
                  }}
                />
                <button type="submit">Применить</button>
              </label>
              {cheatMessage && <small role="status">{cheatMessage}</small>}
            </form>
            <button className="settings-action" type="button" onClick={() => { setSettingsOpen(false); setTutorialStep(0); setTutorialOpen(true); }}>Повторить обучение <span>↗</span></button>
            {!resetConfirmOpen ? (
              <button className="settings-action danger-action" type="button" onClick={() => setResetConfirmOpen(true)}>Сбросить прогресс</button>
            ) : (
              <div className="reset-confirm" role="alert">
                <p>Удалить баланс, сейф, усталость, рекорды и настройки?</p>
                <div><button type="button" onClick={() => setResetConfirmOpen(false)}>Отмена</button><button className="confirm-reset" type="button" onClick={resetProgress}>Сбросить прогресс</button></div>
              </div>
            )}
            <p className="settings-section-title">Статистика</p>
            <div className="stats-line"><span>ЛУЧШАЯ СЕРИЯ <strong>{stats.bestStreak}</strong></span><span>ТАПОВ <strong>{stats.totalTaps}</strong></span><span>УКУСОВ <strong>{stats.totalBites}</strong></span></div>
          </section>
        </div>
      )}

      <div className="red-flash" aria-hidden="true" />
    </main>
  );
}

const BOOT_SPLASH_MIN_MS = 3_500;
const BOOT_SPLASH_EXIT_MS = 650;
const BOOT_ASSET_TIMEOUT_MS = 12_000;
const BOOT_SPLASH_FORCE_MS = 15_000;

/** Waits for an image to download and decode without making a failed resource fatal. */
function preloadBootImage(source: string) {
  return new Promise<void>((resolve) => {
    const image = new Image();
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      image.onload = null;
      image.onerror = null;

      if (image.naturalWidth > 0 && typeof image.decode === "function") {
        void image.decode().catch(() => undefined).then(() => resolve());
        return;
      }
      resolve();
    };

    image.decoding = "async";
    image.onload = finish;
    image.onerror = finish;
    image.src = source;
    if (image.complete) finish();
  });
}

export default function Home() {
  const [bootReady, setBootReady] = useState(false);
  const [assetsReady, setAssetsReady] = useState(false);
  const [assetPreloadTimedOut, setAssetPreloadTimedOut] = useState(false);
  const [loadedAssetCount, setLoadedAssetCount] = useState(0);
  const [splashPhase, setSplashPhase] = useState<"active" | "leaving" | "done">("active");
  const bootStartRef = useRef<number>(0);

  useEffect(() => {
    bootStartRef.current = Date.now();
  }, []);

  const handleBootReady = useCallback(() => setBootReady(true), []);

  // Запускаем загрузку всех изображений главного экрана ещё под сплэшем. Теги
  // preload в layout начинают сетевые запросы раньше, а decode здесь гарантирует,
  // что при открытии экрана изображения уже готовы к отрисовке.
  useEffect(() => {
    let cancelled = false;
    let finished = false;

    const finish = (timedOut = false) => {
      if (cancelled || finished) return;
      finished = true;
      window.clearTimeout(timeout);
      setAssetPreloadTimedOut(timedOut);
      setAssetsReady(true);
    };

    const timeout = window.setTimeout(() => finish(true), BOOT_ASSET_TIMEOUT_MS);
    void Promise.all(
      BOOT_IMAGE_ASSETS.map((asset) =>
        preloadBootImage(publicAsset(asset)).finally(() => {
          if (!cancelled) {
            setLoadedAssetCount((count) =>
              Math.min(count + 1, BOOT_IMAGE_ASSETS.length),
            );
          }
        }),
      ),
    ).then(() => finish());

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, []);

  // Прячем сплэш только после проверки профиля, загрузки изображений и
  // увеличенной минимальной длительности заставки.
  useEffect(() => {
    if (!bootReady || !assetsReady || splashPhase !== "active") return;
    const elapsed = Date.now() - bootStartRef.current;
    const timer = window.setTimeout(
      () => setSplashPhase("leaving"),
      Math.max(0, BOOT_SPLASH_MIN_MS - elapsed),
    );
    return () => window.clearTimeout(timer);
  }, [assetsReady, bootReady, splashPhase]);

  useEffect(() => {
    if (splashPhase !== "leaving") return;
    const timer = window.setTimeout(() => setSplashPhase("done"), BOOT_SPLASH_EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [splashPhase]);

  // Страховка на случай недоступной сети или зависшего запроса к профилю.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSplashPhase((phase) => (phase === "active" ? "leaving" : phase));
    }, BOOT_SPLASH_FORCE_MS);
    return () => window.clearTimeout(timer);
  }, []);

  const splashVisible = splashPhase !== "done";
  const contentRevealed = splashPhase !== "active";
  const splashStatus = !bootReady
    ? "Подготавливаем профиль…"
    : !assetsReady
      ? `Загружаем ресурсы · ${loadedAssetCount}/${BOOT_IMAGE_ASSETS.length}`
      : assetPreloadTimedOut
        ? "Почти готово…"
        : "Игра готова";

  return (
    <>
      {splashVisible && (
        <div
          className={`boot-splash${splashPhase === "leaving" ? " is-leaving" : ""}`}
          role="status"
          aria-label="Загрузка"
          aria-hidden={splashPhase === "leaving"}
        >
          <div className="boot-splash-inner">
            <div className="boot-splash-word">KNOPIK</div>
            <div className="boot-splash-dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </div>
            <p className="boot-splash-status">{splashStatus}</p>
          </div>
        </div>
      )}
      <div className={`boot-content${contentRevealed ? " is-revealed" : ""}`}>
        <CloudAccountGate onBootReady={handleBootReady}>
          {({ account, initialSave, gameKey, syncState, difficulty, promoCodes, saveProgress, refreshPromoCodes, updateDifficulty, createPromoCode, redeemPromoCode, changePassword, signOut }) => (
            <KnopikGame
              key={gameKey}
              account={account}
              initialSave={initialSave}
              syncState={syncState}
              difficulty={difficulty}
              promoCodes={promoCodes}
              onSave={saveProgress}
              onRefreshPromoCodes={refreshPromoCodes}
              onUpdateDifficulty={updateDifficulty}
              onCreatePromoCode={createPromoCode}
              onRedeemPromoCode={redeemPromoCode}
              onChangePassword={changePassword}
              onSignOut={signOut}
            />
          )}
        </CloudAccountGate>
      </div>
    </>
  );
}
