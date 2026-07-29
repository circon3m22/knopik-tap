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
  SAFE_CATALOG,
  SAVE_KEY,
  SAVE_VERSION,
  createDefaultSave,
  sanitizeSave,
  type CoinState,
  type DogState,
  type GameSettings,
  type GameStats,
  type OwnedSafe,
  type SafeSize,
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

type TapParticle = { id: number; x: number; y: number; amount: number };
type RecoveryReason = "rest" | "bite" | "ultra";

const CALM_SERIES_RESET_MS = 6_000;
const WARNING_REST_MS = 2_650;
const RECOVERY_MS = 1_350;
const ANGRY_MS = 1_650;
const ULTRA_VISUAL_DELAY_MS = 360;

const tutorialSlides = [
  {
    eyebrow: "ТЕМП",
    title: "Светлый фон означает, что Кнопик быстро устаёт",
    copy: "Тапай два раза в секунду или быстрее — синий станет глубже, а серия устойчивее.",
  },
  {
    eyebrow: "УЛЬТРА-ТАП",
    title: "У ультра-тапа каждый раз новый скрытый предел",
    copy: "Обычно Кнопик срывается через 2–5 секунд. Иногда он выдерживает намного дольше.",
  },
  {
    eyebrow: "УРОВНИ",
    title: "Каждые 100 заработанных монет повышают уровень",
    copy: "Всего 10 уровней. Каждый даёт небольшой бонус, но проигрыш сбрасывает всё до первого.",
  },
  {
    eyebrow: "СЕЙФЫ",
    title: "Только монеты в сейфах переживают проигрыш",
    copy: "Покупка сейфа сразу оплачивает его и полностью заполняет.",
  },
];

function vibrate(pattern: number | number[], enabled: boolean) {
  if (enabled && typeof navigator !== "undefined" && "vibrate" in navigator) {
    navigator.vibrate(pattern);
  }
}

function createSafeId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function tempoSceneColor(averageInterval: number, hasTaps: boolean) {
  const ratio = hasTaps ? calculateTempoRatio(averageInterval) : 0.56;
  const light = [105, 184, 245];
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
  const [safes, setSafes] = useState<OwnedSafe[]>([]);
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
  const [particles, setParticles] = useState<TapParticle[]>([]);
  const [biteFlash, setBiteFlash] = useState(false);
  const [purchaseMessage, setPurchaseMessage] = useState("");
  const [momentMessage, setMomentMessage] = useState("");
  const [levelBurstKey, setLevelBurstKey] = useState(0);
  const [levelBurstVisible, setLevelBurstVisible] = useState(false);

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
  const holdIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recoveryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const angryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
    [idleTimerRef, recoveryTimerRef, angryTimerRef, flashTimerRef].forEach(
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
      setSafes(saved.safes);
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
    try {
      localStorage.setItem(
        SAVE_KEY,
        JSON.stringify({
          version: SAVE_VERSION,
          walletCoins: coins.walletCoins,
          safes,
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
  }, [
    coins.walletCoins,
    fatigueUntil,
    hydrated,
    levelState,
    safes,
    settings,
    stats,
    tutorialSeen,
  ]);

  useEffect(() => {
    if (!fatigueUntil) return;
    const timer = setInterval(() => {
      const now = Date.now();
      setClock(now);
      if (now >= fatigueUntilRef.current) {
        fatigueUntilRef.current = 0;
        setFatigueUntil(0);
      }
    }, 1_000);
    return () => clearInterval(timer);
  }, [fatigueUntil]);

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

  const finishRecovery = useCallback(() => {
    transitionTo("calm");
    setRecoveryReason("rest");
    resetSeries();
    getSound().rest();
  }, [getSound, resetSeries, transitionTo]);

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
      setMomentMessage(
        fromOverheat
          ? "Перегрев. Незащищённый баланс сгорел"
          : "Кнопик укусил. Баланс сгорел",
      );
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
    (state: "calm" | "warning") => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      idleTimerRef.current = setTimeout(
        () => {
          if (state === "warning" && dogStateRef.current === "warning") {
            beginRecovery("rest");
          } else if (state === "calm" && dogStateRef.current === "calm") {
            resetSeries();
          }
        },
        state === "warning" ? WARNING_REST_MS : CALM_SERIES_RESET_MS,
      );
    },
    [beginRecovery, resetSeries],
  );

  const addParticle = useCallback((x: number, y: number, amount: number) => {
    const id = ++particleIdRef.current;
    setParticles((current) => [
      ...current.slice(-8),
      { id, x, y, amount },
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
      const dynamicLimit = calculateTapLimit(
        average,
        currentFatigue,
        () => patienceRollRef.current,
      );
      const nextLimit = Math.max(nextSeries, dynamicLimit);
      const tempoRatio = calculateTempoRatio(average);

      seriesTapsRef.current = nextSeries;
      tapLimitRef.current = nextLimit;
      setSeriesTaps(nextSeries);
      setAverageInterval(average);
      setTapPulse((current) => current + 1);
      const earned = awardCoins(1);
      addParticle(x, y, earned);
      updateStats((current) => ({
        ...current,
        totalTaps: current.totalTaps + 1,
        bestStreak: Math.max(current.bestStreak, nextSeries),
      }));
      getSound().tap(tempoRatio);
      vibrate(7, settingsRef.current.vibration);

      if (nextSeries >= nextLimit) {
        transitionTo("warning");
        setMomentMessage("Кнопик напрягся. Отпусти его отдохнуть");
        getSound().warning(currentFatigue > 0 ? 0.92 : 0.68);
        vibrate([26, 42, 26], settingsRef.current.vibration);
        armIdleTimer("warning");
      } else {
        setMomentMessage("");
        armIdleTimer("calm");
      }
    },
    [
      addParticle,
      armIdleTimer,
      awardCoins,
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
      holdingRef.current = true;
      ultraActiveRef.current = false;
      overheatTriggeredRef.current = false;
      setHolding(true);
      setUltraActive(false);
      setUltraPreview(0);
      setMomentMessage("Держи. Ультра включится через мгновение");

      holdIntervalRef.current = setInterval(() => {
        const elapsed = performance.now() - holdStartRef.current;

        if (
          elapsed >= ULTRA_VISUAL_DELAY_MS &&
          !ultraActiveRef.current
        ) {
          ultraActiveRef.current = true;
          setUltraActive(true);
          getSound().ultraStart();
          setMomentMessage("Огонь усиливается. Момент срыва неизвестен");
          vibrate(18, settingsRef.current.vibration);
        }

        if (ultraActiveRef.current) {
          setUltraPreview(
            calculateUltraTapCoins(elapsed, ultraDeadlineRef.current),
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
      }, 50);
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
        setMomentMessage("");
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
        if (elapsed >= ULTRA_VISUAL_DELAY_MS) {
          setMomentMessage("Для ультра-тапа держи минимум 2 секунды");
        }
        return;
      }

      const baseReward = calculateUltraTapCoins(
        elapsed,
        ultraDeadlineRef.current,
      );
      stopHoldVisual("success");
      const reward = awardCoins(baseReward, 1_000);
      const nextFatigueUntil = Date.now() + FATIGUE_DURATION_MS;
      fatigueUntilRef.current = nextFatigueUntil;
      setFatigueUntil(nextFatigueUntil);
      setClock(Date.now());
      setMomentMessage(`Ультра-тап: +${reward}. Кнопик очень устал`);
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

  const buySafe = useCallback(
    (size: SafeSize) => {
      const definition = SAFE_CATALOG.find((entry) => entry.size === size);
      if (!definition) return;
      const requiredCoins = definition.price + definition.capacity;
      if (coinsRef.current.walletCoins < requiredCoins) return;

      updateCoins((current) => ({
        ...current,
        walletCoins: current.walletCoins - requiredCoins,
      }));
      setSafes((current) => [
        ...current,
        {
          id: createSafeId(),
          size: definition.size,
          capacity: definition.capacity,
          stored: definition.capacity,
          purchasedAt: Date.now(),
        },
      ]);
      setPurchaseMessage(`${definition.name} сейф заполнен`);
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
    setSafes([]);
    setStats(resetStats);
    setLevelState(resetLevel);
    setSettings(defaults.settings);
    setFatigueUntil(0);
    setTutorialSeen(false);
    setTutorialStep(0);
    setTutorialOpen(true);
    setSafesOpen(false);
    setSettingsOpen(false);
    setResetConfirmOpen(false);
    setRecoveryReason("rest");
    setMomentMessage("");
    setLevelBurstVisible(false);
    resetSeries();
    transitionTo("calm");
    localStorage.removeItem(SAVE_KEY);
  }, [
    clearRoundTimers,
    resetSeries,
    stopHoldVisual,
    transitionTo,
  ]);

  const vaultCoins = useMemo(
    () => safes.reduce((total, safe) => total + safe.stored, 0),
    [safes],
  );

  const statusTitle =
    dogState === "warning"
      ? "Напрягся"
      : dogState === "angry"
        ? "Разозлился"
        : dogState === "recovering"
          ? recoveryReason === "ultra"
            ? "Очень устал"
            : "Отдыхает"
          : fatigueRatio > 0
            ? "Устал, но готов"
            : "Спокоен";

  const statusCopy =
    dogState === "warning"
      ? "Ещё одно касание может стоить всего баланса"
      : dogState === "angry"
        ? "Сейфы целы, незащищённые монеты сгорели"
        : dogState === "recovering"
          ? recoveryReason === "ultra"
            ? "После ультра-тапа нужна пауза"
            : "Скоро можно продолжить"
          : fatigueRatio > 0
            ? "После ультра Кнопик срывается намного быстрее"
            : "Светлее фон — Кнопик устает быстрее";

  const dogImageState =
    dogState === "angry"
      ? "angry"
      : dogState === "warning" ||
          (dogState === "recovering" && recoveryReason === "ultra")
        ? "warning"
        : "calm";
  const dogDisabled = dogState === "angry" || dogState === "recovering";
  const multiplier = levelMultiplier(levelState.level);
  const levelBonus = Math.round((multiplier - 1) * 100);
  const levelProgress =
    levelState.level >= MAX_LEVEL
      ? 1
      : levelState.progressCoins / COINS_PER_LEVEL;

  const gameStyle = {
    "--calm-scene": tempoSceneColor(averageInterval, seriesTaps > 1),
    "--level-progress": levelProgress,
  } as CSSProperties;

  return (
    <main
      className={`game-shell state-${dogState} ${
        fatigueRatio > 0 ? "has-fatigue" : ""
      } ${holding ? "is-holding" : ""} ${
        ultraActive ? "ultra-active" : ""
      } ${biteFlash ? "bite-flash" : ""}`}
      data-state={dogState}
      data-hydrated={hydrated}
      style={gameStyle}
    >
      <header className="app-header">
        <div className="top-bar">
          <div className="wordmark" aria-label="Knopik Tap">
            <span>K</span>
            <strong>KNOPIK <small>TAP</small></strong>
          </div>
          <div className="top-actions">
            <button
              className="vault-button"
              type="button"
              onClick={() => setSafesOpen(true)}
              aria-label={`Открыть сейфы. Защищено ${vaultCoins} монет`}
            >
              <span className="safe-icon" aria-hidden="true"><i /></span>
              <span><small>ЗАЩИЩЕНО</small><strong>{vaultCoins.toLocaleString("ru-RU")}</strong></span>
            </button>
            <button
              className="round-icon-button"
              type="button"
              aria-label="Настройки"
              onClick={() => setSettingsOpen(true)}
            >
              <span className="settings-icon" aria-hidden="true"><i /><i /><i /></span>
            </button>
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

      <section className="game-stage" aria-live="polite">
        <div className="state-copy">
          <span className="state-label"><i />{statusTitle}</span>
          <h1>{statusCopy}</h1>
        </div>

        <div className="dog-stage">
          <div className="ultra-aura" aria-hidden="true">
            {Array.from({ length: 10 }, (_, index) => (
              <i key={index} />
            ))}
          </div>
          <button
            className={`dog-button tap-${tapPulse % 2 === 0 ? "a" : "b"}`}
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
            <span className="dog-images" data-image-state={dogImageState}>
              <img className="dog-image calm-image" src="/knopik-calm.png" alt="" draggable={false} />
              <img className="dog-image warning-image" src="/knopik-warning.png" alt="" draggable={false} />
              <img className="dog-image angry-image" src="/knopik-angry.png" alt="" draggable={false} />
            </span>
            <span className="tap-particles" aria-hidden="true">
              {particles.map((particle) => (
                <span
                  className="tap-particle"
                  key={particle.id}
                  style={{ left: `${particle.x}%`, top: `${particle.y}%` }}
                >
                  +{particle.amount}
                </span>
              ))}
            </span>
            {ultraActive && (
              <span className="ultra-readout">
                <small>УЛЬТРА-ТАП</small>
                <strong>+{ultraPreview}</strong>
                <b>ОТПУСТИ НА ИНТУИЦИИ</b>
              </span>
            )}
          </button>
        </div>

        <div className="game-data">
          <div className="wallet-balance">
            <span className="coin-mark" aria-hidden="true">K</span>
            <div>
              <strong>{coins.walletCoins.toLocaleString("ru-RU")}</strong>
              <small>НЕЗАЩИЩЁННЫЕ МОНЕТЫ</small>
            </div>
          </div>

          <p className="moment-message" role="status">
            {momentMessage || "Тёмный синий означает устойчивый темп"}
          </p>
        </div>
      </section>

      <footer className="bottom-bar">
        <button type="button" onClick={() => setSafesOpen(true)}>
          <span className="safe-icon" aria-hidden="true"><i /></span>
          <span>Сейфы</span>
          {safes.length > 0 && <b>{safes.length}</b>}
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
              <div><p className="sheet-kicker">ХРАНИЛИЩЕ</p><h2 id="safes-title">Мои сейфы</h2></div>
              <button className="close-button" type="button" aria-label="Закрыть" onClick={() => setSafesOpen(false)}><span /></button>
            </div>

            <div className="vault-total">
              <span className="large-safe-icon" aria-hidden="true"><i /></span>
              <div><small>ВСЕГО ЗАЩИЩЕНО</small><strong>{vaultCoins.toLocaleString("ru-RU")}</strong><span>монет</span></div>
            </div>

            {purchaseMessage && <p className="purchase-message" role="status">{purchaseMessage}</p>}

            <div className="sheet-scroll">
              <section className="owned-section">
                <h3>Купленные</h3>
                {safes.length === 0 ? (
                  <p className="empty-safes">Пока пусто. Монеты защищаются только после покупки заполненного сейфа.</p>
                ) : (
                  <div className="owned-safe-list">
                    {safes.map((safe, index) => {
                      const definition = SAFE_CATALOG.find((entry) => entry.size === safe.size)!;
                      return (
                        <article className={`owned-safe size-${safe.size}`} key={safe.id}>
                          <span className="safe-icon" aria-hidden="true"><i /></span>
                          <div><strong>{definition.name} #{index + 1}</strong><small>{safe.stored} из {safe.capacity} монет</small></div>
                          <b>ЗАЩИЩЁН</b>
                        </article>
                      );
                    })}
                  </div>
                )}
              </section>

              <section className="safe-shop">
                <h3>Купить и заполнить</h3>
                <p>Списывается стоимость сейфа и такая же сумма для вклада.</p>
                <div className="safe-options">
                  {SAFE_CATALOG.map((safe) => {
                    const required = safe.price + safe.capacity;
                    const available = coins.walletCoins >= required;
                    return (
                      <article className={`safe-option size-${safe.size}`} key={safe.size}>
                        <span className="safe-icon" aria-hidden="true"><i /></span>
                        <div>
                          <strong>{safe.name}</strong>
                          <span>{safe.capacity} монет</span>
                          <small>{safe.price} сейф + {safe.capacity} вклад</small>
                        </div>
                        <button type="button" disabled={!available} onClick={() => buySafe(safe.size)}>
                          {available ? `КУПИТЬ · ${required}` : `НУЖНО ${required}`}
                        </button>
                      </article>
                    );
                  })}
                </div>
              </section>
            </div>
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
              <div><strong>Вибрация</strong><span>Если устройство поддерживает</span></div>
              <button className="switch" type="button" role="switch" aria-checked={settings.vibration} aria-label="Вибрация" onClick={() => setSettings((current) => ({ ...current, vibration: !current.vibration }))}><span /></button>
            </div>
            <button className="settings-action" type="button" onClick={() => { setSettingsOpen(false); setTutorialStep(0); setTutorialOpen(true); }}>ПОВТОРИТЬ ОБУЧЕНИЕ <span>↗</span></button>
            {!resetConfirmOpen ? (
              <button className="settings-action danger-action" type="button" onClick={() => setResetConfirmOpen(true)}>СБРОСИТЬ ПРОГРЕСС</button>
            ) : (
              <div className="reset-confirm" role="alert">
                <p>Удалить баланс, сейфы, усталость, рекорды и настройки?</p>
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
