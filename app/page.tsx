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
  isUltraTapOverheated,
  rollingAverageTapInterval,
} from "./tempo-engine";
import {
  createSoundEngine,
  type KnopikSoundEngine,
  type UltraStopResult,
} from "./sound-engine";
import {
  COINS_PER_LEVEL,
  MAX_LEVEL,
  addLevelCoins,
  levelMultiplier,
  sanitizeLevelState,
  type LevelState,
} from "./level-engine";
import {
  createRiskOutcome,
  riskMultiplier,
  type RiskChance,
} from "./risk-engine";

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
const DOG_FOOD_PRICE = 100;
const HASBIK_HAT_PRICE = 500;
const ZHIVCHIK_PRICE = 100;
const PITBULL_PRICE = 50;
const ZHIVCHIK_DURATION_MS = 60_000;
const ZHIVCHIK_MULTIPLIER = 4;
const HAT_ULTRA_BONUS_MS = 350;
const MAX_CHEAT_COIN_GRANT = 1_000_000_000;
const RISK_SPIN_MS = 5_400;
const RISK_RESULT_MS = 1_650;
const RISK_RECOVERY_MIN_MS = 30_000;
const RISK_RECOVERY_SPREAD_MS = 30_000;
const SAVE_RECOVERY_MIN_MS = 20_000;
const SAVE_RECOVERY_SPREAD_MS = 40_000;

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

export default function Home() {
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
  const [hatOwned, setHatOwned] = useState(false);
  const [hatEquipped, setHatEquipped] = useState(false);
  const [boostUntil, setBoostUntil] = useState(0);
  const [settings, setSettings] = useState<GameSettings>({
    sound: true,
    vibration: true,
    suliman: false,
  });
  const [stats, setStats] = useState<GameStats>({
    bestStreak: 0,
    totalTaps: 0,
    totalBites: 0,
  });
  const [levelState, setLevelState] = useState<LevelState>({
    level: 1,
    progressCoins: 0,
    lifetimeCoins: 0,
  });
  const [tutorialSeen, setTutorialSeen] = useState(false);
  const [tutorialOpen, setTutorialOpen] = useState(true);
  const [tutorialStep, setTutorialStep] = useState(0);
  const [shopOpen, setShopOpen] = useState(false);
  const [shopCategory, setShopCategory] = useState<"food" | "clothes">("food");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [seriesTaps, setSeriesTaps] = useState(0);
  const [averageInterval, setAverageInterval] = useState(600);
  const [fatigueUntil, setFatigueUntil] = useState(0);
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
  const [hatBounce, setHatBounce] = useState(0);
  const [saveFlight, setSaveFlight] = useState<SaveFlight | null>(null);
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
  const [levelBurstKey, setLevelBurstKey] = useState(0);
  const [levelBurstVisible, setLevelBurstVisible] = useState(false);
  const [joyFrame, setJoyFrame] = useState(0);
  const [rageFrame, setRageFrame] = useState(0);
  const [joySpriteReady, setJoySpriteReady] = useState(false);
  const [rageSpriteReady, setRageSpriteReady] = useState(false);

  const dogStateRef = useRef<DogState>("calm");
  const coinsRef = useRef(coins);
  const settingsRef = useRef(settings);
  const statsRef = useRef(stats);
  const levelStateRef = useRef(levelState);
  const boostUntilRef = useRef(0);
  const bonusCarryRef = useRef(0);
  const fatigueUntilRef = useRef(0);
  const seriesTapsRef = useRef(0);
  const tapLimitRef = useRef(0);
  const tapIntervalsRef = useRef<number[]>([]);
  const lastTapAtRef = useRef<number | null>(null);
  const patienceRollRef = useRef(Math.random());
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
  const holdIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recoveryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const angryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tiredTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const levelBurstTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
      const precise = base * multiplier * tapBoost + bonusCarryRef.current;
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
      if (result.levelsGained > 0) triggerLevelBurst();
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
      const stored = localStorage.getItem(SAVE_KEY);
      const parsed = stored ? JSON.parse(stored) : createDefaultSave();
      const saved = sanitizeSave(parsed);
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
      const activeFatigue = Math.max(
        saved.ultraFatigueUntil > Date.now() ? saved.ultraFatigueUntil : 0,
        saved.riskFatigueUntil > Date.now() ? saved.riskFatigueUntil : 0,
      );

      coinsRef.current = loadedCoins;
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
      setHatOwned(saved.hatOwned);
      setHatEquipped(saved.hatEquipped);
      setBoostUntil(saved.boostUntil > Date.now() ? saved.boostUntil : 0);
      setRiskChance(saved.lastRiskChance as RiskChance);
      setRiskFatigueUntil(
        saved.riskFatigueUntil > Date.now() ? saved.riskFatigueUntil : 0,
      );
      setRiskStats({
        spins: saved.riskSpins,
        wins: saved.riskWins,
        losses: saved.riskLosses,
        lastBet: saved.lastRiskBet,
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
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    settingsRef.current = settings;
    soundRef.current?.setEnabled(settings.sound);
  }, [settings]);

  useEffect(() => {
    fatigueUntilRef.current = fatigueUntil;
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
        localStorage.setItem(
          SAVE_KEY,
          JSON.stringify({
            version: SAVE_VERSION,
            vaultCoins,
            walletCoins: coins.walletCoins,
            foodCount,
            drinkCount,
            pitbullCount,
            hatOwned,
            hatEquipped,
            riskFatigueUntil,
            riskSpins: riskStats.spins,
            riskWins: riskStats.wins,
            riskLosses: riskStats.losses,
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
          }),
        );
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
    hatEquipped,
    hatOwned,
    hydrated,
    levelState,
    riskChance,
    riskFatigueUntil,
    riskStats,
    settings,
    stats,
    tutorialSeen,
    vaultCoins,
  ]);

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
    return calculateFatigueRatio(FATIGUE_DURATION_MS - remaining);
  }, [clock, fatigueUntil]);

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
      transitionTo("tired");
      if (tiredTimerRef.current) clearTimeout(tiredTimerRef.current);
      tiredTimerRef.current = null;

      if (persistent) return;
      const duration =
        TIRED_MOOD_MIN_MS + Math.random() * TIRED_MOOD_SPREAD_MS;
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
    if (fatigueUntilRef.current > Date.now()) {
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
      updateCoins(() => ({ walletCoins: 0, streakCoins: 0 }));
      updateStats((current) => ({
        ...current,
        totalBites: current.totalBites + 1,
      }));
      const resetLevel = {
        level: 1,
        progressCoins: 0,
        lifetimeCoins: levelStateRef.current.lifetimeCoins,
      };
      levelStateRef.current = resetLevel;
      bonusCarryRef.current = 0;
      setLevelState(resetLevel);
      setLevelBurstVisible(false);
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
    ],
  );

  const armIdleTimer = useCallback(
    (state: "calm" | "tired" | "warning") => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
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
        state === "warning" ? WARNING_REST_MS : CALM_SERIES_RESET_MS,
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
      if (settingsRef.current.suliman) {
        getSound().tap(0.25);
        vibrate(8, settingsRef.current.vibration);
        return;
      }
      const now = performance.now();
      const previous = earTapStateRef.current[ear];
      const nextCount = now - previous.lastAt <= 2_500 ? previous.count + 1 : 1;
      earTapStateRef.current[ear] = { count: nextCount, lastAt: now };
      getSound().warning(0.38 + nextCount * 0.18);
      vibrate(nextCount >= 3 ? [34, 28, 58] : 16, settingsRef.current.vibration);

      if (nextCount >= 3) {
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
      const currentFatigue =
        remaining > 0
          ? calculateFatigueRatio(FATIGUE_DURATION_MS - remaining)
          : 0;
      const nextSeries = seriesTapsRef.current + 1;
      const effectiveFatigue =
        currentState === "tired"
          ? Math.max(currentFatigue, 0.72)
          : currentFatigue;
      const dynamicLimit = calculateTapLimit(
        average,
        effectiveFatigue,
        () => patienceRollRef.current,
      );
      const nextLimit = Math.max(nextSeries, dynamicLimit);
      const tempoRatio = calculateTempoRatio(average);

      seriesTapsRef.current = nextSeries;
      tapLimitRef.current = nextLimit;
      setSeriesTaps(nextSeries);
      setAverageInterval(average);
      setTapPulse((current) => current + 1);
      const jackpot = Math.random() < LAST_TAP_CHANCE;
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

      if (currentState === "tired" && Math.random() < TIRED_SNAP_CHANCE) {
        triggerBite();
        return;
      }

      if (nextSeries >= nextLimit) {
        transitionTo("warning");
        getSound().warning(effectiveFatigue > 0 ? 0.92 : 0.68);
        vibrate([26, 42, 26], settingsRef.current.vibration);
        armIdleTimer("warning");
      } else if (
        currentState === "calm" &&
        nextSeries >= 4 &&
        Math.random() < RANDOM_TIRED_CHANCE
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
      ultraDeadlineRef.current = Math.min(
        10_000,
        chooseUltraTapOverheatDeadline() +
          (hatEquipped ? HAT_ULTRA_BONUS_MS : 0),
      );
      ultraTwoSecondRewardRef.current = chooseUltraTapTwoSecondReward();
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
    [getSound, hatEquipped, triggerBite],
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
        registerTap(point.x, point.y);
        return;
      }

      const baseReward = calculateUltraTapCoins(
        elapsed,
        ultraDeadlineRef.current,
        ultraTwoSecondRewardRef.current,
      );
      stopHoldVisual("success");
      awardCoins(baseReward, 1_000);
      const nextFatigueUntil = Date.now() + FATIGUE_DURATION_MS;
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
      dogStateRef.current === "tired" || fatigueUntilRef.current > Date.now();
    if (tiredNow) {
      showRiskNotice("Сиба устала");
      vibrate([12, 26, 12], settingsRef.current.vibration);
      return;
    }

    const bet = coinsRef.current.walletCoins;
    if (bet < 1) {
      showRiskNotice("Нет монет для ставки");
      vibrate(16, settingsRef.current.vibration);
      return;
    }

    riskCommittedRef.current = true;
    clearRoundTimers();
    resetSeries();
    const outcome = createRiskOutcome(riskChance, bet);
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const spinDuration = reducedMotion ? 280 : RISK_SPIN_MS;
    setRiskBetAmount(bet);
    setRiskPayout(0);
    setRiskResult(null);
    setRiskRotation(1_800 + outcome.finalAngle);
    setRiskSpinNonce((current) => current + 1);
    setRiskMessage("");
    updateCoins(() => ({ walletCoins: 0, streakCoins: 0 }));
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

      if (!reducedMotion) {
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
      }

      riskSpinTimerRef.current = setTimeout(() => {
        if (riskTickTimerRef.current) {
          clearInterval(riskTickTimerRef.current);
          riskTickTimerRef.current = null;
        }
        const mathematicallyWon = outcome.won;
        setRiskResult(mathematicallyWon ? "win" : "lose");
        setRiskPayout(mathematicallyWon ? outcome.payout : 0);
        transitionRisk("result");
        setRiskStats((current) => ({
          ...current,
          wins: current.wins + (mathematicallyWon ? 1 : 0),
          losses: current.losses + (mathematicallyWon ? 0 : 1),
        }));
        if (mathematicallyWon) {
          updateCoins((current) => ({
            ...current,
            walletCoins: current.walletCoins + outcome.payout,
          }));
          getSound().riskWin();
          vibrate([25, 28, 54, 30, 80], settingsRef.current.vibration);
        } else {
          getSound().riskLose();
          vibrate([42, 38, 24], settingsRef.current.vibration);
        }

        riskReturnTimerRef.current = setTimeout(() => {
          const tiredUntil =
            Date.now() +
            RISK_RECOVERY_MIN_MS +
            Math.random() * RISK_RECOVERY_SPREAD_MS;
          fatigueUntilRef.current = tiredUntil;
          setFatigueUntil(tiredUntil);
          setRiskFatigueUntil(tiredUntil);
          setClock(Date.now());
          setRecoveryReason("rest");
          transitionTo("tired");
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
    resetSeries,
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
    const tiredUntil =
      Date.now() + SAVE_RECOVERY_MIN_MS + Math.random() * SAVE_RECOVERY_SPREAD_MS;
    clearRoundTimers();
    resetSeries();
    fatigueUntilRef.current = tiredUntil;
    setFatigueUntil(tiredUntil);
    setRiskFatigueUntil(tiredUntil);
    setClock(Date.now());
    setRecoveryReason("rest");
    transitionTo("tired");
    getSound().safe();
    vibrate([20, 28, 44], settingsRef.current.vibration);
  }, [clearRoundTimers, getSound, resetSeries, transitionTo, updateCoins]);

  const buyFood = useCallback(() => {
    const availableSlots = Math.max(0, 10 - foodCount);
    const quantity = Math.min(availableSlots, Math.max(1, Math.floor(foodQuantity)));
    const totalPrice = quantity * DOG_FOOD_PRICE;
    if (quantity < 1 || coinsRef.current.walletCoins < totalPrice) return;

    updateCoins((current) => ({
      ...current,
      walletCoins: current.walletCoins - totalPrice,
    }));
    setFoodCount((current) => Math.min(10, current + quantity));
    setFoodQuantity(1);
    setShopMessage(`Корм ×${quantity} добавлен в запас`);
    getSound().purchase();
    vibrate([16, 22, 34], settingsRef.current.vibration);
    if (messageTimerRef.current) clearTimeout(messageTimerRef.current);
    messageTimerRef.current = setTimeout(() => setShopMessage(""), 1_800);
  }, [foodCount, foodQuantity, getSound, updateCoins]);

  const buyDrink = useCallback(() => {
    const availableSlots = Math.max(0, 10 - drinkCount);
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
    setDrinkCount((current) => Math.min(10, current + quantity));
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
    const availableSlots = Math.max(0, 10 - pitbullCount);
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
    setPitbullCount((current) => Math.min(10, current + quantity));
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
      fatigueUntilRef.current > Date.now() ||
      dogStateRef.current !== "calm"
    ) return;
    if (coinsRef.current.walletCoins < 1) {
      showRiskNotice("Сначала заработай монеты");
      return;
    }
    setPitbullCount((current) => Math.max(0, current - 1));
    setShopOpen(false);
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

  const bounceHat = useCallback((event: PointerEvent<HTMLSpanElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setHatBounce((current) => current + 1);
    registerTap(50, 16);
  }, [registerTap]);

  const selectNavigation = useCallback((index: number) => {
    setShopOpen(index === 0);
    setSettingsOpen(index === 2);
    if (index !== 2) setResetConfirmOpen(false);
  }, []);

  const moveNavigationThumb = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      const rect = event.currentTarget.getBoundingClientRect();
      const ratio = Math.min(0.999, Math.max(0, (event.clientX - rect.left) / rect.width));
      selectNavigation(Math.floor(ratio * 3));
    },
    [selectNavigation],
  );

  const handleNavigationDown = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      navDragStartRef.current = event.clientX;
      navDidDragRef.current = false;
      event.currentTarget.setPointerCapture(event.pointerId);
      moveNavigationThumb(event);
    },
    [moveNavigationThumb],
  );

  const handleNavigationMove = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
      if (Math.abs(event.clientX - navDragStartRef.current) > 8) {
        navDidDragRef.current = true;
      }
      moveNavigationThumb(event);
    },
    [moveNavigationThumb],
  );

  const clickNavigation = useCallback((index: number) => {
    if (navDidDragRef.current) {
      navDidDragRef.current = false;
      return;
    }
    getSound().nav(index - 1);
    selectNavigation(index);
  }, [getSound, selectNavigation]);

  const buyOrToggleHat = useCallback(() => {
    if (!hatOwned) {
      if (coinsRef.current.walletCoins < HASBIK_HAT_PRICE) return;
      updateCoins((current) => ({
        ...current,
        walletCoins: current.walletCoins - HASBIK_HAT_PRICE,
      }));
      setHatOwned(true);
      setHatEquipped(true);
      setShopMessage("Тюбетейка куплена и надета");
    } else {
      setHatEquipped((current) => !current);
      setShopMessage(hatEquipped ? "Тюбетейка снята" : "Тюбетейка надета");
    }
    getSound().purchase();
    vibrate(22, settingsRef.current.vibration);
    if (messageTimerRef.current) clearTimeout(messageTimerRef.current);
    messageTimerRef.current = setTimeout(() => setShopMessage(""), 1_800);
  }, [getSound, hatEquipped, hatOwned, updateCoins]);

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
      level: 1,
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
    boostUntilRef.current = 0;
    setBoostUntil(0);
    setHatOwned(false);
    setHatEquipped(false);
    setRiskFatigueUntil(0);
    setRiskChance(50);
    setRiskBetAmount(0);
    setRiskRotation(0);
    setRiskResult(null);
    setRiskPayout(0);
    setRiskMessage("");
    setRiskStats({ spins: 0, wins: 0, losses: 0, lastBet: 0 });
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

  const vaultLocked = dogState !== "calm" || holding || riskPhase !== "normal";
  const isDogTired =
    dogState === "tired" ||
    (dogState === "recovering" && fatigueUntil > Date.now());
  const canFeedDog = isDogTired && foodCount > 0;
  const canSave = !vaultLocked && coins.walletCoins >= 2;
  const saveAmount = Math.floor(coins.walletCoins / 2);
  const foodTotalPrice = foodQuantity * DOG_FOOD_PRICE;
  const remainingFoodSlots = Math.max(0, 10 - foodCount);
  const canBuyFood =
    remainingFoodSlots > 0 &&
    foodQuantity <= remainingFoodSlots &&
    coins.walletCoins >= foodTotalPrice;
  const canBuyHat = hatOwned || coins.walletCoins >= HASBIK_HAT_PRICE;
  const remainingDrinkSlots = Math.max(0, 10 - drinkCount);
  const drinkTotalPrice = drinkQuantity * ZHIVCHIK_PRICE;
  const canBuyDrink =
    remainingDrinkSlots > 0 &&
    drinkQuantity <= remainingDrinkSlots &&
    coins.walletCoins >= drinkTotalPrice;
  const remainingPitbullSlots = Math.max(0, 10 - pitbullCount);
  const pitbullTotalPrice = pitbullQuantity * PITBULL_PRICE;
  const canBuyPitbull =
    remainingPitbullSlots > 0 &&
    pitbullQuantity <= remainingPitbullSlots &&
    coins.walletCoins >= pitbullTotalPrice;
  const boostSeconds = Math.max(0, Math.ceil((boostUntil - clock) / 1_000));
  const selectedRiskMultiplier = riskMultiplier(riskChance);
  const riskMode = riskPhase !== "normal";
  const navIndex = shopOpen ? 0 : settingsOpen ? 2 : 1;

  const tempoRatio =
    seriesTaps > 0 ? calculateTempoRatio(averageInterval) : 0;
  const isHappy =
    dogState === "calm" && seriesTaps >= 3 && averageInterval <= 360;
  useEffect(() => {
    if (dogState !== "calm") {
      setJoyFrame(0);
      return;
    }
    if (!joySpriteReady) {
      setJoyFrame(0);
      return;
    }

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
  }, [dogState, isHappy, joySpriteReady]);

  useEffect(() => {
    const reversingAfterBite =
      dogState === "recovering" && recoveryReason === "bite";
    if (dogState !== "angry" && !reversingAfterBite) {
      setRageFrame(0);
      return;
    }
    if (!rageSpriteReady) {
      setRageFrame(0);
      return;
    }

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
  }, [dogState, rageSpriteReady, recoveryReason]);

  const showRageSequence =
    rageSpriteReady &&
    (dogState === "angry" ||
      (dogState === "recovering" && recoveryReason === "bite" && rageFrame > 0));
  const isEmotionShifting =
    (dogState === "calm" &&
      ((isHappy && joyFrame < 4) || (!isHappy && joyFrame > 0))) ||
    (dogState === "angry" && rageFrame < 4) ||
    (dogState === "recovering" && recoveryReason === "bite" && rageFrame > 0);
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
    riskPhase === "transition" ||
    riskPhase === "spinning" ||
    riskPhase === "result";
  const multiplier = levelMultiplier(levelState.level);
  const levelBonus = Math.round((multiplier - 1) * 100);
  const levelProgress =
    levelState.level >= MAX_LEVEL
      ? 1
      : levelState.progressCoins / COINS_PER_LEVEL;
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
      ? "#ec5148"
      : dogState === "tired"
        ? "#e8c65d"
        : dogState === "warning" ||
            (dogState === "recovering" && fatigueRatio > 0)
          ? "#f4c94d"
          : dogState === "calm"
            ? calmScene
            : "#1478ed";

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
    "--risk-spin-duration": `${RISK_SPIN_MS}ms`,
  } as CSSProperties;

  return (
    <main
      className={`game-shell state-${dogState} ${
        fatigueRatio > 0 ? "has-fatigue" : ""
      } ${holding ? "is-holding" : ""} ${
        ultraActive ? "ultra-active" : ""
      } ${biteFlash ? "bite-flash" : ""} ${paleCalm ? "pale-calm" : ""} ${
        dogState === "calm" && joyFrame > 0 ? "is-happy" : ""
      } ${isEmotionShifting ? "is-emotion-shifting" : ""} ${
        riskMode ? `risk-mode risk-${riskPhase}` : ""
      } ${riskPhase === "transition" && riskResult ? "risk-returning" : ""} ${
        riskShake > 0 ? `risk-shake-${riskShake % 2}` : ""
      }`}
      data-state={dogState}
      data-hydrated={hydrated}
      style={gameStyle}
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
      <header className="app-header">
        <div className="top-bar">
          <div className="wordmark" aria-label="Knopik">
            <strong>KNOPIK</strong>
          </div>
        </div>
        {!riskMode ? (
          <div
            className="level-strip"
            aria-label={`Уровень ${levelState.level} из ${MAX_LEVEL}`}
          >
            <div className="level-title">
              <span>УРОВЕНЬ</span>
              <strong>{levelState.level}<small>/ {MAX_LEVEL}</small></strong>
            </div>
            <div className="level-track"><span /></div>
            <div className="level-reward">
              <strong>{levelState.level >= MAX_LEVEL ? "MAX" : `${levelState.progressCoins}/100`}</strong>
              <small>БОНУС +{levelBonus}%</small>
            </div>
          </div>
        ) : (
          <div className="risk-strip" aria-label={`Шанс выигрыша ${riskChance}%`}>
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
        <div className="boost-row" aria-label="Предметы Кнопика">
          <button className="inventory-item inventory-food" type="button" disabled={!canFeedDog} onClick={feedDog}>
            <span className="food-icon" aria-hidden="true"><i /><i /><i /></span>
            <span className="inventory-copy"><strong>Корм</strong><small>Снять усталость</small></span>
            <b className="inventory-count">{foodCount}</b>
          </button>
          <button className="inventory-item inventory-zhivchik" type="button" disabled={drinkCount < 1 || riskMode} onClick={activateDrink}>
            <span className="drink-icon drink-zhivchik" aria-hidden="true"><i /></span>
            <span className="inventory-copy"><strong>{boostSeconds > 0 ? `×4 · ${boostSeconds}с` : "Живчик"}</strong><small>Тап ×4</small></span>
            <b className="inventory-count">{drinkCount}</b>
          </button>
          <button className="inventory-item inventory-pitbull" type="button" disabled={pitbullCount < 1 || riskMode || isDogTired} onClick={activatePitbull}>
            <span className="drink-icon drink-pitbull" aria-hidden="true"><i /></span>
            <span className="inventory-copy"><strong>Питбуль</strong><small>Открыть рулетку</small></span>
            <b className="inventory-count">{pitbullCount}</b>
          </button>
        </div>
        <div
          ref={savedBalanceRef}
          className={`saved-balance ${saveFlight ? "receiving-coins" : ""}`}
          aria-label={`Баланс сейфа ${vaultCoins} монет`}
        >
          <span className="safe-icon" aria-hidden="true"><i /></span>
          <span><small>БАЛАНС СЕЙФА</small><strong>{vaultCoins.toLocaleString("ru-RU")}</strong></span>
        </div>
      </header>

      <section
        className="game-stage"
      >
        <div className="dog-stage">
          <button
            className={`dog-button ${tapVariant}`}
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
                src="/knopik-calm-earless.png"
                alt=""
                draggable={false}
                loading="eager"
                decoding="sync"
              />
              <img
                ref={joySpriteImageRef}
                className="dog-image emotion-strip joy-strip"
                src="/knopik-joy-sprite-earless.png"
                alt=""
                draggable={false}
                loading="eager"
                decoding="sync"
                fetchPriority="high"
                style={{ transform: `translate3d(-${joyFrame * 20}%, 0, 0)` }}
                onLoad={() => setJoySpriteReady(true)}
              />
              <img
                className="dog-image warning-image"
                src="/knopik-warning-earless.png"
                alt=""
                draggable={false}
                loading="eager"
                decoding="sync"
              />
              <img
                ref={rageSpriteImageRef}
                className="dog-image emotion-strip rage-strip"
                src="/knopik-rage-sprite-earless.png"
                alt=""
                draggable={false}
                loading="eager"
                decoding="sync"
                fetchPriority="high"
                style={{ transform: `translate3d(-${rageFrame * 20}%, 0, 0)` }}
                onLoad={() => setRageSpriteReady(true)}
              />
            </span>
            <span className="dog-ears" aria-hidden="true">
              <img
                className="dog-ear dog-ear-left"
                src="/knopik-ear-left.png"
                alt=""
                draggable={false}
              />
              <img
                className="dog-ear dog-ear-right"
                src="/knopik-ear-right.png"
                alt=""
                draggable={false}
              />
              {hatOwned && hatEquipped && (
                <>
                  <img
                    className={`dog-hat ${hatBounce ? "hat-jump" : ""}`}
                    key={`hat-${hatBounce}`}
                    src="/hasbik-tubeteika.png"
                    alt=""
                    aria-hidden="true"
                    draggable={false}
                  />
                  <span
                    className="hat-hit-zone"
                    onPointerDown={bounceHat}
                    onPointerUp={(event) => event.stopPropagation()}
                    onPointerCancel={(event) => event.stopPropagation()}
                  />
                </>
              )}
            </span>
            <span className="ear-hit-zones" aria-hidden="true">
              {(["left", "right"] as const).map((ear) => (
                <span
                  className={`ear-hit ear-hit-${ear}`}
                  key={ear}
                  onPointerDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    handleEarTap(ear);
                  }}
                  onPointerUp={(event) => event.stopPropagation()}
                  onPointerCancel={(event) => event.stopPropagation()}
                />
              ))}
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
        </div>

        <div className="game-data">
          <div
            ref={walletBalanceRef}
            className={`wallet-balance ${balanceVariant}`}
            aria-label={`Активные монеты ${coins.walletCoins}`}
          >
            <span className="coin-mark" aria-hidden="true"><i>К</i></span>
            <div>
              <strong className="balance-number" key={`balance-${balancePulse}`}>
                {coins.walletCoins.toLocaleString("ru-RU")}
              </strong>
            </div>
          </div>
          {riskMessage && <p className="risk-notice" key={`risk-notice-${riskShake}`}>{riskMessage}</p>}
          <button
            className="quick-save-button"
            type="button"
            disabled={!canSave}
            onClick={saveAllToVault}
          >
            <span className="safe-icon" aria-hidden="true"><i /></span>
            <span>ЗАСЕЙВИТЬ</span>
            <small>В СЕЙФ +{saveAmount.toLocaleString("ru-RU")}</small>
          </button>
        </div>
      </section>

      <footer
        className="bottom-bar"
        style={{ "--nav-index": navIndex } as CSSProperties}
        onPointerDown={handleNavigationDown}
        onPointerMove={handleNavigationMove}
        onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
        }}
      >
        <span className="nav-thumb" aria-hidden="true" />
        <button className={navIndex === 0 ? "active" : ""} type="button" onClick={() => clickNavigation(0)}>
          <span className="shop-icon" aria-hidden="true"><i /></span>
          <span>Магазин</span>
        </button>
        <button className={`home-nav ${navIndex === 1 ? "active" : ""}`} type="button" onClick={() => clickNavigation(1)}>
          <span className="home-icon" aria-hidden="true"><i /></span>
          <span>Главная</span>
        </button>
        <button className={navIndex === 2 ? "active" : ""} type="button" onClick={() => clickNavigation(2)}>
          <span className="settings-icon" aria-hidden="true"><i /><i /><i /></span>
          <span>Настройки</span>
        </button>
      </footer>
      </div>

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

      {tutorialOpen && (
        <div className="modal-backdrop tutorial-backdrop">
          <section
            className="tutorial-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="tutorial-title"
          >
            <div className="tutorial-visual" aria-hidden="true">
              <span>{tutorialSlides[tutorialStep].symbol}</span>
              <i />
            </div>
            <p className="sheet-kicker">{tutorialSlides[tutorialStep].eyebrow}</p>
            <h2 id="tutorial-title">{tutorialSlides[tutorialStep].title}</h2>
            <p>{tutorialSlides[tutorialStep].copy}</p>
            <div className="tutorial-dots" aria-label={`Шаг ${tutorialStep + 1} из ${tutorialSlides.length}`}>
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
              {tutorialStep === tutorialSlides.length - 1 ? "НАЧАТЬ ИГРУ" : "ДАЛЬШЕ"}
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
          <section className="sheet shop-sheet" aria-labelledby="shop-title">
            <div className="sheet-heading">
              <div><p className="sheet-kicker">МАГАЗИН</p><h2 id="shop-title">Забота о Кнопике</h2></div>
            </div>

            <div className="shop-wallet">
              <span>АКТИВНЫЕ МОНЕТЫ</span>
              <strong>{coins.walletCoins.toLocaleString("ru-RU")}</strong>
            </div>

            <div className="shop-categories" role="tablist" aria-label="Разделы магазина">
              <button
                className={shopCategory === "food" ? "active" : ""}
                type="button"
                role="tab"
                aria-selected={shopCategory === "food"}
                onClick={() => setShopCategory("food")}
              >
                Еда и напитки
              </button>
              <button
                className={shopCategory === "clothes" ? "active" : ""}
                type="button"
                role="tab"
                aria-selected={shopCategory === "clothes"}
                onClick={() => setShopCategory("clothes")}
              >
                Одежда
              </button>
            </div>

            {shopMessage && <p className="purchase-message" role="status">{shopMessage}</p>}

            {shopCategory === "food" && <>
            <article className="shop-card food-card">
              <span className="food-pack" aria-hidden="true">
                <span className="food-icon"><i /><i /><i /></span>
              </span>
              <div className="food-copy">
                <small>ЗАПАС {foodCount}/10</small>
                <h3>Корм для Кнопика</h3>
                <p>Одна порция полностью снимает усталость. Купленный корм хранится в запасе.</p>
              </div>
              <div className="food-price"><strong>{DOG_FOOD_PRICE}</strong><span>монет</span></div>
              <div className="quantity-picker" aria-label="Количество корма">
                <button type="button" aria-label="Уменьшить количество" disabled={foodQuantity <= 1} onClick={() => setFoodQuantity((current) => Math.max(1, current - 1))}>−</button>
                <strong>{foodQuantity}</strong>
                <button type="button" aria-label="Увеличить количество" disabled={foodQuantity >= remainingFoodSlots} onClick={() => setFoodQuantity((current) => Math.min(remainingFoodSlots, current + 1))}>+</button>
              </div>
              <button className="shop-buy-button" type="button" disabled={!canBuyFood} onClick={buyFood}>
                {remainingFoodSlots === 0
                  ? "ЗАПАС ПОЛОН"
                  : canBuyFood
                    ? `КУПИТЬ ×${foodQuantity} · ${foodTotalPrice}`
                    : `НУЖНО ${foodTotalPrice}`}
              </button>
            </article>

            <article className="shop-card drink-card">
              <span className="drink-pack zhivchik-pack" aria-hidden="true"><span className="drink-icon drink-zhivchik"><i /></span><b>×4</b></span>
              <div className="food-copy">
                <small>ЗАПАС {drinkCount}/10</small>
                <h3>Напиток «Живчик»</h3>
                <p>Даёт ×4 монет за обычные тапы на одну минуту. Порции включаются отдельно сверху.</p>
              </div>
              <div className="food-price"><strong>{ZHIVCHIK_PRICE}</strong><span>монет</span></div>
              <div className="quantity-picker" aria-label="Количество напитков">
                <button type="button" aria-label="Уменьшить количество" disabled={drinkQuantity <= 1} onClick={() => setDrinkQuantity((current) => Math.max(1, current - 1))}>−</button>
                <strong>{drinkQuantity}</strong>
                <button type="button" aria-label="Увеличить количество" disabled={drinkQuantity >= remainingDrinkSlots} onClick={() => setDrinkQuantity((current) => Math.min(remainingDrinkSlots, current + 1))}>+</button>
              </div>
              <button className="shop-buy-button drink-action" type="button" disabled={!canBuyDrink} onClick={buyDrink}>
                {remainingDrinkSlots === 0
                  ? "ЗАПАС ПОЛОН"
                  : canBuyDrink
                    ? `КУПИТЬ ×${drinkQuantity} · ${drinkTotalPrice}`
                    : `НУЖНО ${drinkTotalPrice}`}
              </button>
            </article>

            <article className="shop-card pitbull-card">
              <span className="drink-pack pitbull-pack" aria-hidden="true"><span className="drink-icon drink-pitbull"><i /></span><b>RISK</b></span>
              <div className="food-copy">
                <small>ЗАПАС {pitbullCount}/10</small>
                <h3>Напиток «Питбуль»</h3>
                <p>Одноразово открывает рулетку. Выбери размер цветного сектора и попади в него стрелкой.</p>
              </div>
              <div className="food-price"><strong>{PITBULL_PRICE}</strong><span>монет</span></div>
              <div className="quantity-picker" aria-label="Количество напитков Питбуль">
                <button type="button" aria-label="Уменьшить количество" disabled={pitbullQuantity <= 1} onClick={() => setPitbullQuantity((current) => Math.max(1, current - 1))}>−</button>
                <strong>{pitbullQuantity}</strong>
                <button type="button" aria-label="Увеличить количество" disabled={pitbullQuantity >= remainingPitbullSlots} onClick={() => setPitbullQuantity((current) => Math.min(remainingPitbullSlots, current + 1))}>+</button>
              </div>
              <button className="shop-buy-button pitbull-action" type="button" disabled={!canBuyPitbull} onClick={buyPitbull}>
                {remainingPitbullSlots === 0
                  ? "ЗАПАС ПОЛОН"
                  : canBuyPitbull
                    ? `КУПИТЬ ×${pitbullQuantity} · ${pitbullTotalPrice}`
                    : `НУЖНО ${pitbullTotalPrice}`}
              </button>
            </article>
            </>}

            {shopCategory === "clothes" && (
            <article className={`shop-card hat-card ${hatOwned ? "owned" : ""}`}>
              <span className="hat-preview" aria-hidden="true">
                <img src="/hasbik-tubeteika.png" alt="" draggable={false} />
              </span>
              <div className="food-copy">
                <small>{hatOwned ? "КУПЛЕНО" : "АКСЕССУАР"}</small>
                <h3>Тюбетейка Хасбика</h3>
                <p>Сидит между ушами и слегка продлевает безопасное удержание ультра-тапа.</p>
              </div>
              <div className="food-price"><strong>{hatOwned ? "✓" : HASBIK_HAT_PRICE}</strong><span>{hatOwned ? "твоя" : "монет"}</span></div>
              <button className="shop-buy-button hat-action" type="button" disabled={!canBuyHat} onClick={buyOrToggleHat}>
                {hatOwned
                  ? hatEquipped ? "СНЯТЬ ТЮБЕТЕЙКУ" : "НАДЕТЬ ТЮБЕТЕЙКУ"
                  : canBuyHat ? `КУПИТЬ · ${HASBIK_HAT_PRICE}` : `НУЖНО ${HASBIK_HAT_PRICE}`}
              </button>
            </article>
            )}
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
          <section className="sheet settings-sheet" aria-labelledby="settings-title">
            <div className="sheet-heading">
              <div><p className="sheet-kicker">KNOPIK TAP</p><h2 id="settings-title">Настройки</h2></div>
            </div>
            <div className="setting-row">
              <div><strong>Звук</strong><span>Тактильные, живые игровые эффекты</span></div>
              <button className="switch" type="button" role="switch" aria-checked={settings.sound} aria-label="Звук" onClick={() => setSettings((current) => ({ ...current, sound: !current.sound }))}><span /></button>
            </div>
            <div className="setting-row">
              <div><strong>Вибрация</strong><span>На iPhone Safari — визуально-звуковой отклик</span></div>
              <button className="switch" type="button" role="switch" aria-checked={settings.vibration} aria-label="Вибрация" onClick={() => setSettings((current) => ({ ...current, vibration: !current.vibration }))}><span /></button>
            </div>
            <form
              className={`cheat-row ${settings.suliman ? "is-active" : ""}`}
              onSubmit={(event) => {
                event.preventDefault();
                submitCheatCode();
              }}
            >
              <div>
                <strong>Чит-код</strong>
                <span>{settings.suliman ? "Секретный режим активен" : "Введи секретное слово"}</span>
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
                <button type="submit">ПРИМЕНИТЬ</button>
              </label>
              {cheatMessage && <small role="status">{cheatMessage}</small>}
            </form>
            <button className="settings-action" type="button" onClick={() => { setSettingsOpen(false); setTutorialStep(0); setTutorialOpen(true); }}>ПОВТОРИТЬ ОБУЧЕНИЕ <span>↗</span></button>
            {!resetConfirmOpen ? (
              <button className="settings-action danger-action" type="button" onClick={() => setResetConfirmOpen(true)}>СБРОСИТЬ ПРОГРЕСС</button>
            ) : (
              <div className="reset-confirm" role="alert">
                <p>Удалить баланс, сейф, усталость, рекорды и настройки?</p>
                <div><button type="button" onClick={() => setResetConfirmOpen(false)}>ОТМЕНА</button><button className="confirm-reset" type="button" onClick={resetProgress}>СБРОСИТЬ</button></div>
              </div>
            )}
            <div className="stats-line"><span>ЛУЧШАЯ СЕРИЯ <strong>{stats.bestStreak}</strong></span><span>ТАПОВ <strong>{stats.totalTaps}</strong></span><span>УКУСОВ <strong>{stats.totalBites}</strong></span></div>
          </section>
        </div>
      )}

      <div className="red-flash" aria-hidden="true" />
    </main>
  );
}
