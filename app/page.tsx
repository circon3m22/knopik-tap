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

type TapParticle = {
  id: number;
  x: number;
  y: number;
  amount: number;
  jackpot: boolean;
};
type RecoveryReason = "rest" | "bite" | "ultra";

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

const tutorialSlides = [
  {
    eyebrow: "ТЕМП",
    title: "Экран белый, пока Кнопик спокоен",
    copy: "С первым тапом он синеет. Быстрый ритм углубляет синий, а паузы возвращают фон к белому.",
  },
  {
    eyebrow: "УЛЬТРА-ТАП",
    title: "У ультра-тапа каждый раз новый скрытый предел",
    copy: "Через 2 секунды получишь 200–600 монет. Дальше доход растёт медленно, а Кнопик может сорваться.",
  },
  {
    eyebrow: "УРОВНИ",
    title: "Каждые 100 заработанных монет повышают уровень",
    copy: "Всего 10 уровней. Каждый даёт небольшой бонус, но проигрыш сбрасывает всё до первого.",
  },
  {
    eyebrow: "СЕЙФ",
    title: "Сейф бесплатный и переживает проигрыш",
    copy: "Перевод необратим: из отправленной суммы защищается половина. Например, 100 монет превращаются в 50 сохранённых.",
  },
];

function vibrate(pattern: number | number[], enabled: boolean) {
  if (enabled && typeof navigator !== "undefined" && "vibrate" in navigator) {
    navigator.vibrate(pattern);
  }
}

function tempoSceneColor(averageInterval: number, hasTaps: boolean) {
  if (!hasTaps) return "rgb(247 249 252)";

  const ratio = calculateTempoRatio(averageInterval);
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
  const [depositInput, setDepositInput] = useState("100");
  const [settings, setSettings] = useState<GameSettings>({
    sound: true,
    vibration: true,
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
  const [safesOpen, setSafesOpen] = useState(false);
  const [shopOpen, setShopOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [seriesTaps, setSeriesTaps] = useState(0);
  const [averageInterval, setAverageInterval] = useState(600);
  const [fatigueUntil, setFatigueUntil] = useState(0);
  const [clock, setClock] = useState(() => Date.now());
  const [holding, setHolding] = useState(false);
  const [ultraActive, setUltraActive] = useState(false);
  const [ultraPreview, setUltraPreview] = useState(0);
  const [tapPulse, setTapPulse] = useState(0);
  const [balancePulse, setBalancePulse] = useState(0);
  const [particles, setParticles] = useState<TapParticle[]>([]);
  const [biteFlash, setBiteFlash] = useState(false);
  const [purchaseMessage, setPurchaseMessage] = useState("");
  const [shopMessage, setShopMessage] = useState("");
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
    (baseAmount: number, maximum = Number.MAX_SAFE_INTEGER) => {
      const base = Math.max(0, Math.floor(baseAmount));
      const multiplier = levelMultiplier(levelStateRef.current.level);
      const precise = base * multiplier + bonusCarryRef.current;
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
        walletCoins: 0,
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
      const activeFatigue =
        saved.ultraFatigueUntil > Date.now()
          ? saved.ultraFatigueUntil
          : 0;

      coinsRef.current = loadedCoins;
      settingsRef.current = saved.settings;
      statsRef.current = loadedStats;
      levelStateRef.current = loadedLevel;
      fatigueUntilRef.current = activeFatigue;
      setCoins(loadedCoins);
      setVaultCoins(saved.vaultCoins);
      setSettings(saved.settings);
      setStats(loadedStats);
      setLevelState(loadedLevel);
      setFatigueUntil(activeFatigue);
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
    if (!hydrated) return;
    const saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(
          SAVE_KEY,
          JSON.stringify({
            version: SAVE_VERSION,
            vaultCoins,
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
    hydrated,
    levelState,
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
      const earned = awardCoins(jackpot ? 5 : 1);
      addParticle(x, y, earned, jackpot);
      updateStats((current) => ({
        ...current,
        totalTaps: current.totalTaps + 1,
        bestStreak: Math.max(current.bestStreak, nextSeries),
      }));
      getSound().tap(tempoRatio);
      vibrate(7, settingsRef.current.vibration);

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
      ultraDeadlineRef.current = chooseUltraTapOverheatDeadline();
      ultraTwoSecondRewardRef.current = chooseUltraTapTwoSecondReward();
      holdingRef.current = true;
      ultraActiveRef.current = false;
      overheatTriggeredRef.current = false;
      setHolding(true);
      setUltraActive(false);
      setUltraPreview(0);

      holdIntervalRef.current = setInterval(() => {
        const elapsed = performance.now() - holdStartRef.current;

        if (
          elapsed >= ULTRA_VISUAL_DELAY_MS &&
          !ultraActiveRef.current
        ) {
          ultraActiveRef.current = true;
          setUltraActive(true);
          getSound().ultraStart();
          vibrate(18, settingsRef.current.vibration);
        }

        if (ultraActiveRef.current) {
          setUltraPreview(
            calculateUltraTapCoins(
              elapsed,
              ultraDeadlineRef.current,
              ultraTwoSecondRewardRef.current,
            ),
          );
          getSound().ultraPulse(elapsed / ultraDeadlineRef.current);
        }

        if (
          isUltraTapOverheated(elapsed, ultraDeadlineRef.current) &&
          !overheatTriggeredRef.current
        ) {
          overheatTriggeredRef.current = true;
          triggerBite(true);
        }
      }, 80);
    },
    [getSound, triggerBite],
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

  const handlePointerDown = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      const rect = event.currentTarget.getBoundingClientRect();
      event.currentTarget.setPointerCapture(event.pointerId);
      startHold(
        ((event.clientX - rect.left) / rect.width) * 100,
        ((event.clientY - rect.top) / rect.height) * 100,
      );
    },
    [startHold],
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
      startHold(50, 50);
    },
    [startHold],
  );

  const handleKeyUp = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      finishHold(false);
    },
    [finishHold],
  );

  const depositToVault = useCallback(
    (amount: number) => {
      const requestedCoins = Math.floor(amount);
      if (
        dogStateRef.current !== "calm" ||
        holdingRef.current ||
        !Number.isFinite(requestedCoins) ||
        requestedCoins < 2 ||
        coinsRef.current.walletCoins < requestedCoins
      ) {
        return;
      }
      const protectedCoins = Math.floor(requestedCoins / 2);

      updateCoins((current) => ({
        ...current,
        walletCoins: current.walletCoins - requestedCoins,
      }));
      setVaultCoins((current) => current + protectedCoins);
      setPurchaseMessage(`Защищено +${protectedCoins} монет`);
      getSound().safe();
      vibrate([20, 30, 50], settingsRef.current.vibration);
      if (messageTimerRef.current) clearTimeout(messageTimerRef.current);
      messageTimerRef.current = setTimeout(
        () => setPurchaseMessage(""),
        1_800,
      );
    },
    [getSound, updateCoins],
  );

  const feedDog = useCallback(() => {
    const tiredNow =
      dogStateRef.current === "tired" ||
      (dogStateRef.current === "recovering" &&
        fatigueUntilRef.current > Date.now());
    if (!tiredNow || vaultCoins < DOG_FOOD_PRICE) return;

    clearRoundTimers();
    setVaultCoins((current) => current - DOG_FOOD_PRICE);
    fatigueUntilRef.current = 0;
    setFatigueUntil(0);
    setClock(Date.now());
    setRecoveryReason("rest");
    resetSeries();
    transitionTo("calm");
    setShopMessage("Кнопик поел и снова спокоен");
    getSound().safe();
    vibrate([18, 24, 38], settingsRef.current.vibration);
    if (messageTimerRef.current) clearTimeout(messageTimerRef.current);
    messageTimerRef.current = setTimeout(() => setShopMessage(""), 1_800);
  }, [clearRoundTimers, getSound, resetSeries, transitionTo, vaultCoins]);

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
    setDepositInput("100");
    setStats(resetStats);
    setLevelState(resetLevel);
    setSettings(defaults.settings);
    setFatigueUntil(0);
    setTutorialSeen(false);
    setTutorialStep(0);
    setTutorialOpen(true);
    setSafesOpen(false);
    setShopOpen(false);
    setSettingsOpen(false);
    setResetConfirmOpen(false);
    setRecoveryReason("rest");
    setLevelBurstVisible(false);
    setShopMessage("");
    resetSeries();
    transitionTo("calm");
    localStorage.removeItem(SAVE_KEY);
  }, [
    clearRoundTimers,
    resetSeries,
    stopHoldVisual,
    transitionTo,
  ]);

  const requestedDeposit = /^\d+$/.test(depositInput)
    ? Number(depositInput)
    : 0;
  const protectedDeposit = Math.floor(requestedDeposit / 2);
  const vaultLocked = dogState !== "calm" || holding;
  const isDogTired =
    dogState === "tired" ||
    (dogState === "recovering" && fatigueUntil > Date.now());
  const canBuyFood =
    isDogTired && vaultCoins >= DOG_FOOD_PRICE;
  const canDeposit =
    !vaultLocked &&
    Number.isSafeInteger(requestedDeposit) &&
    requestedDeposit >= 2 &&
    requestedDeposit <= coins.walletCoins;

  const tempoRatio =
    seriesTaps > 0 ? calculateTempoRatio(averageInterval) : 0;
  const isHappy =
    dogState === "calm" && seriesTaps >= 2 && tempoRatio >= 0.65;
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
  const dogDisabled = dogState === "angry" || dogState === "recovering";
  const multiplier = levelMultiplier(levelState.level);
  const levelBonus = Math.round((multiplier - 1) * 100);
  const levelProgress =
    levelState.level >= MAX_LEVEL
      ? 1
      : levelState.progressCoins / COINS_PER_LEVEL;
  const paleCalm = dogState === "calm" && tempoRatio < 0.52;
  const tapVariant =
    tapPulse > 0 ? `tap-${tapPulse % 2 === 0 ? "a" : "b"}` : "";
  const balanceVariant =
    balancePulse > 0
      ? `balance-pulse-${balancePulse % 2 === 0 ? "a" : "b"}`
      : "";

  const gameStyle = {
    "--calm-scene": tempoSceneColor(averageInterval, seriesTaps > 0),
    "--level-progress": levelProgress,
  } as CSSProperties;

  return (
    <main
      className={`game-shell state-${dogState} ${
        fatigueRatio > 0 ? "has-fatigue" : ""
      } ${holding ? "is-holding" : ""} ${
        ultraActive ? "ultra-active" : ""
      } ${biteFlash ? "bite-flash" : ""} ${paleCalm ? "pale-calm" : ""} ${
        dogState === "calm" && joyFrame > 0 ? "is-happy" : ""
      } ${isEmotionShifting ? "is-emotion-shifting" : ""}`}
      data-state={dogState}
      data-hydrated={hydrated}
      style={gameStyle}
    >
      <div className="game-motion-layer">
      <header className="app-header">
        <div className="top-bar">
          <div className="wordmark" aria-label="Knopik Tap">
            <strong>KNOPIK <small>TAP</small></strong>
          </div>
          <div
            className="saved-balance"
            aria-label={`Сохранено ${vaultCoins} монет`}
          >
            <span className="safe-icon" aria-hidden="true"><i /></span>
            <span><small>СОХРАНЕНО</small><strong>{vaultCoins.toLocaleString("ru-RU")}</strong></span>
          </div>
        </div>
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
      </header>

      <section
        className="game-stage"
      >
        <div className="dog-stage">
          <div className="ultra-aura" aria-hidden="true">
            {Array.from({ length: 10 }, (_, index) => (
              <i key={index} />
            ))}
          </div>
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
                src="/knopik-calm.png"
                alt=""
                draggable={false}
                loading="eager"
                decoding="sync"
              />
              <img
                className="dog-image emotion-strip joy-strip"
                src="/knopik-joy-sprite.png"
                alt=""
                draggable={false}
                loading="eager"
                decoding="sync"
                fetchPriority="high"
                style={{ transform: `translate3d(-${joyFrame * 20}%, 0, 0)` }}
                onLoad={(event) => {
                  const image = event.currentTarget;
                  void image.decode().catch(() => undefined).then(() => setJoySpriteReady(true));
                }}
              />
              <img
                className="dog-image warning-image"
                src="/knopik-warning.png"
                alt=""
                draggable={false}
                loading="eager"
                decoding="sync"
              />
              <img
                className="dog-image emotion-strip rage-strip"
                src="/knopik-rage-sprite.png"
                alt=""
                draggable={false}
                loading="eager"
                decoding="sync"
                fetchPriority="high"
                style={{ transform: `translate3d(-${rageFrame * 20}%, 0, 0)` }}
                onLoad={(event) => {
                  const image = event.currentTarget;
                  void image.decode().catch(() => undefined).then(() => setRageSpriteReady(true));
                }}
              />
            </span>
            <span className="dog-ears" aria-hidden="true">
              <img className="dog-ear dog-ear-left" src="/knopik-ear-left.png" alt="" draggable={false} />
              <img className="dog-ear dog-ear-right" src="/knopik-ear-right.png" alt="" draggable={false} />
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
            {ultraActive && (
              <span className="ultra-readout">
                <small>УЛЬТРА-ТАП</small>
                <strong>+{ultraPreview}</strong>
              </span>
            )}
          </button>
        </div>

        <div className="game-data">
          <div className={`wallet-balance ${balanceVariant}`}>
            <span className="coin-mark" aria-hidden="true">K</span>
            <div>
              <strong className="balance-number" key={`balance-${balancePulse}`}>
                {coins.walletCoins.toLocaleString("ru-RU")}
              </strong>
              <small>НЕЗАЩИЩЁННЫЕ МОНЕТЫ</small>
            </div>
          </div>
        </div>
      </section>

      <footer className="bottom-bar">
        <button type="button" onClick={() => setSafesOpen(true)}>
          <span className="safe-icon" aria-hidden="true"><i /></span>
          <span>Сейф</span>
        </button>
        <button type="button" onClick={() => setShopOpen(true)}>
          <span className="food-icon" aria-hidden="true"><i /><i /><i /></span>
          <span>Магазин</span>
        </button>
        <button type="button" onClick={() => setSettingsOpen(true)}>
          <span className="settings-icon" aria-hidden="true"><i /><i /><i /></span>
          <span>Настройки</span>
        </button>
        <button
          className="help-button"
          type="button"
          onClick={() => {
            setTutorialStep(0);
            setTutorialOpen(true);
          }}
        >
          <span aria-hidden="true">?</span>
          <span>Как играть</span>
        </button>
      </footer>
      </div>

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
              <span>{tutorialStep + 1}</span>
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

      {safesOpen && (
        <div
          className="modal-backdrop"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) setSafesOpen(false);
          }}
        >
          <section className="sheet safe-sheet" role="dialog" aria-modal="true" aria-labelledby="safes-title">
            <div className="sheet-heading">
              <div><p className="sheet-kicker">ХРАНИЛИЩЕ</p><h2 id="safes-title">Сейф</h2></div>
              <button className="close-button" type="button" aria-label="Закрыть" onClick={() => setSafesOpen(false)}><span /></button>
            </div>

            <div className="vault-total">
              <span className="large-safe-icon" aria-hidden="true"><i /></span>
              <div><small>ВСЕГО ЗАЩИЩЕНО</small><strong>{vaultCoins.toLocaleString("ru-RU")}</strong><span>монет</span></div>
            </div>

            {purchaseMessage && <p className="purchase-message" role="status">{purchaseMessage}</p>}

            <div className="vault-deposit">
              <div className="vault-rule">
                <strong>Курс защиты 2 : 1</strong>
                <span>Положишь 100 — в сейф попадёт 50. Защищённые монеты не сгорают.</span>
              </div>

              {vaultLocked && (
                <p className="vault-locked" role="status">
                  Кнопик устал или напряжён. Пополнение откроется, когда он успокоится.
                </p>
              )}

              <div className="deposit-presets" aria-label="Быстрый выбор суммы">
                {[50, 100, 500].map((amount) => (
                  <button
                    type="button"
                    key={amount}
                    disabled={vaultLocked || coins.walletCoins < amount}
                    onClick={() => setDepositInput(String(amount))}
                  >
                    {amount}
                  </button>
                ))}
                <button
                  type="button"
                  disabled={vaultLocked || coins.walletCoins < 2}
                  onClick={() => setDepositInput(String(coins.walletCoins))}
                >
                  ВСЁ
                </button>
              </div>

              <label className="deposit-field">
                <span>СУММА ИЗ ТЕКУЩЕГО БАЛАНСА</span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={depositInput}
                  disabled={vaultLocked}
                  onChange={(event) =>
                    setDepositInput(
                      event.target.value.replace(/\D/g, "").slice(0, 12),
                    )
                  }
                  aria-label="Сумма перевода в сейф"
                />
                <small>Доступно {coins.walletCoins.toLocaleString("ru-RU")}</small>
              </label>

              <div className="deposit-result">
                <span>В СЕЙФ ПОПАДЁТ</span>
                <strong>+{Number.isFinite(protectedDeposit) ? protectedDeposit.toLocaleString("ru-RU") : 0}</strong>
              </div>

              <button
                className="deposit-button"
                type="button"
                disabled={!canDeposit}
                onClick={() => depositToVault(requestedDeposit)}
              >
                {vaultLocked
                  ? "СЕЙФ ВРЕМЕННО ЗАКРЫТ"
                  : canDeposit
                    ? "ЗАЩИТИТЬ МОНЕТЫ"
                    : "НЕДОСТАТОЧНО МОНЕТ"}
              </button>
              <p className="deposit-note">Перевод необратим. Нечётная монета округляется вниз.</p>
            </div>
          </section>
        </div>
      )}

      {shopOpen && (
        <div
          className="modal-backdrop"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) setShopOpen(false);
          }}
        >
          <section className="sheet shop-sheet" role="dialog" aria-modal="true" aria-labelledby="shop-title">
            <div className="sheet-heading">
              <div><p className="sheet-kicker">МАГАЗИН</p><h2 id="shop-title">Забота о Кнопике</h2></div>
              <button className="close-button" type="button" aria-label="Закрыть" onClick={() => setShopOpen(false)}><span /></button>
            </div>

            <div className="shop-wallet">
              <span>БАЛАНС СЕЙФА</span>
              <strong>{vaultCoins.toLocaleString("ru-RU")}</strong>
            </div>

            {shopMessage && <p className="purchase-message" role="status">{shopMessage}</p>}

            <article className={`food-card ${isDogTired ? "needed" : ""}`}>
              <span className="food-pack" aria-hidden="true">
                <span className="food-icon"><i /><i /><i /></span>
              </span>
              <div className="food-copy">
                <small>ВОССТАНОВЛЕНИЕ</small>
                <h3>Корм для Кнопика</h3>
                <p>Полностью снимает усталость и возвращает спокойное настроение.</p>
              </div>
              <div className="food-price"><strong>{DOG_FOOD_PRICE}</strong><span>монет</span></div>
              <button type="button" disabled={!canBuyFood} onClick={feedDog}>
                {canBuyFood
                  ? `ПОКОРМИТЬ · ${DOG_FOOD_PRICE}`
                  : !isDogTired
                    ? "КНОПИК НЕ УСТАЛ"
                    : `НУЖНО ${DOG_FOOD_PRICE}`}
              </button>
            </article>
          </section>
        </div>
      )}

      {settingsOpen && (
        <div
          className="modal-backdrop"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) setSettingsOpen(false);
          }}
        >
          <section className="sheet settings-sheet" role="dialog" aria-modal="true" aria-labelledby="settings-title">
            <div className="sheet-heading">
              <div><p className="sheet-kicker">KNOPIK TAP</p><h2 id="settings-title">Настройки</h2></div>
              <button className="close-button" type="button" aria-label="Закрыть" onClick={() => setSettingsOpen(false)}><span /></button>
            </div>
            <div className="setting-row">
              <div><strong>Звук</strong><span>Тактильные, живые игровые эффекты</span></div>
              <button className="switch" type="button" role="switch" aria-checked={settings.sound} aria-label="Звук" onClick={() => setSettings((current) => ({ ...current, sound: !current.sound }))}><span /></button>
            </div>
            <div className="setting-row">
              <div><strong>Вибрация</strong><span>На iPhone Safari — визуально-звуковой отклик</span></div>
              <button className="switch" type="button" role="switch" aria-checked={settings.vibration} aria-label="Вибрация" onClick={() => setSettings((current) => ({ ...current, vibration: !current.vibration }))}><span /></button>
            </div>
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
