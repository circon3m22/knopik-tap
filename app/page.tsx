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
  ULTRA_TAP_MAX_HOLD_MS,
  ULTRA_TAP_MIN_HOLD_MS,
  appendTapInterval,
  calculateFatigueRatio,
  calculateTapLimit,
  calculateTempoRatio,
  calculateUltraTapCoins,
  classifyTapTempo,
  isUltraTapOverheated,
  rollingAverageTapInterval,
} from "./tempo-engine";
import {
  createSoundEngine,
  type KnopikSoundEngine,
  type UltraStopResult,
} from "./sound-engine";

type TapParticle = { id: number; x: number; y: number };
type RecoveryReason = "rest" | "bite" | "ultra";

const CALM_SERIES_RESET_MS = 6_000;
const WARNING_REST_MS = 2_650;
const RECOVERY_MS = 1_350;
const ANGRY_MS = 1_650;
const ULTRA_VISUAL_DELAY_MS = 360;

const tutorialSlides = [
  {
    eyebrow: "ТЕМП",
    title: "Быстрые тапы дают длинную серию — от 30 до 100",
    copy: "Если тапать медленно, Кнопик напрягается уже через 5–15 касаний.",
  },
  {
    eyebrow: "УЛЬТРА-ТАП",
    title: "Зажми Кнопика и отпусти между 2 и 15 секундами",
    copy: "Чем дольше держишь, тем больше награда. Максимум — 1000 монет.",
  },
  {
    eyebrow: "РИСК",
    title: "Передержишь после 15 секунд — весь баланс сгорит",
    copy: "После удачного ультра-тапа Кнопик 90 секунд быстрее устаёт.",
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

function formatSeconds(milliseconds: number) {
  return (Math.max(0, milliseconds) / 1_000).toFixed(1);
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
  const [tutorialSeen, setTutorialSeen] = useState(false);
  const [tutorialOpen, setTutorialOpen] = useState(true);
  const [tutorialStep, setTutorialStep] = useState(0);
  const [safesOpen, setSafesOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [seriesTaps, setSeriesTaps] = useState(0);
  const [tapLimit, setTapLimit] = useState(0);
  const [averageInterval, setAverageInterval] = useState(600);
  const [fatigueUntil, setFatigueUntil] = useState(0);
  const [clock, setClock] = useState(() => Date.now());
  const [holding, setHolding] = useState(false);
  const [ultraActive, setUltraActive] = useState(false);
  const [ultraElapsed, setUltraElapsed] = useState(0);
  const [ultraPreview, setUltraPreview] = useState(0);
  const [tapPulse, setTapPulse] = useState(0);
  const [particles, setParticles] = useState<TapParticle[]>([]);
  const [biteFlash, setBiteFlash] = useState(false);
  const [purchaseMessage, setPurchaseMessage] = useState("");
  const [momentMessage, setMomentMessage] = useState("");

  const dogStateRef = useRef<DogState>("calm");
  const coinsRef = useRef(coins);
  const settingsRef = useRef(settings);
  const statsRef = useRef(stats);
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
  const holdIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recoveryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const angryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    setTapLimit(0);
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
      const activeFatigue =
        saved.ultraFatigueUntil > Date.now()
          ? saved.ultraFatigueUntil
          : 0;

      coinsRef.current = loadedCoins;
      settingsRef.current = saved.settings;
      statsRef.current = loadedStats;
      fatigueUntilRef.current = activeFatigue;
      setCoins(loadedCoins);
      setSafes(saved.safes);
      setSettings(saved.settings);
      setStats(loadedStats);
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
        }),
      );
    } catch {
      // The game remains playable when local storage is unavailable.
    }
  }, [
    coins.walletCoins,
    fatigueUntil,
    hydrated,
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
      soundRef.current?.close();
    },
    [clearRoundTimers],
  );

  const fatigueRatio = useMemo(() => {
    const remaining = Math.max(0, fatigueUntil - clock);
    if (remaining === 0) return 0;
    return calculateFatigueRatio(FATIGUE_DURATION_MS - remaining);
  }, [clock, fatigueUntil]);

  const fatigueSeconds = Math.ceil(Math.max(0, fatigueUntil - clock) / 1_000);

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
      setUltraElapsed(0);
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
      seriesTapsRef.current = 0;
      tapLimitRef.current = 0;
      tapIntervalsRef.current = [];
      setSeriesTaps(0);
      setTapLimit(0);
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

  const addParticle = useCallback((x: number, y: number) => {
    const id = ++particleIdRef.current;
    setParticles((current) => [...current.slice(-8), { id, x, y }]);
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
        );
      }
      lastTapAtRef.current = now;

      const average = rollingAverageTapInterval(tapIntervalsRef.current);
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
      setTapLimit(nextLimit);
      setAverageInterval(average);
      setTapPulse((current) => current + 1);
      addParticle(x, y);
      updateCoins((current) => ({
        walletCoins: current.walletCoins + 1,
        streakCoins: current.streakCoins + 1,
      }));
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
      getSound,
      transitionTo,
      triggerBite,
      updateCoins,
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
      holdingRef.current = true;
      ultraActiveRef.current = false;
      overheatTriggeredRef.current = false;
      setHolding(true);
      setUltraActive(false);
      setUltraElapsed(0);
      setUltraPreview(0);
      setMomentMessage("Держи. Ультра включится через мгновение");

      holdIntervalRef.current = setInterval(() => {
        const elapsed = performance.now() - holdStartRef.current;
        setUltraElapsed(elapsed);

        if (
          elapsed >= ULTRA_VISUAL_DELAY_MS &&
          !ultraActiveRef.current
        ) {
          ultraActiveRef.current = true;
          setUltraActive(true);
          getSound().ultraStart();
          setMomentMessage("Отпусти до 15 секунд");
          vibrate(18, settingsRef.current.vibration);
        }

        if (ultraActiveRef.current) {
          setUltraPreview(calculateUltraTapCoins(elapsed));
          getSound().ultraPulse(elapsed / ULTRA_TAP_MAX_HOLD_MS);
        }

        if (
          isUltraTapOverheated(elapsed) &&
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

      if (elapsed < ULTRA_TAP_MIN_HOLD_MS) {
        stopHoldVisual("cancel");
        registerTap(point.x, point.y);
        if (elapsed >= ULTRA_VISUAL_DELAY_MS) {
          setMomentMessage("Для ультра-тапа держи минимум 2 секунды");
        }
        return;
      }

      const reward = calculateUltraTapCoins(elapsed);
      stopHoldVisual("success");
      updateCoins((current) => ({
        walletCoins: current.walletCoins + reward,
        streakCoins: 0,
      }));
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
      finishRecovery,
      registerTap,
      resetSeries,
      stopHoldVisual,
      transitionTo,
      updateCoins,
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
    coinsRef.current = resetCoins;
    settingsRef.current = defaults.settings;
    statsRef.current = resetStats;
    fatigueUntilRef.current = 0;
    setCoins(resetCoins);
    setSafes([]);
    setStats(resetStats);
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

  const tempo = classifyTapTempo(averageInterval);
  const tempoLabel =
    tempo === "fast"
      ? "быстрый"
      : tempo === "slow"
        ? "медленный"
        : "ровный";

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
      ? "Не трогай — дай Кнопику успокоиться"
      : dogState === "angry"
        ? "Сейфы целы, незащищённые монеты сгорели"
        : dogState === "recovering"
          ? recoveryReason === "ultra"
            ? "После ультра-тапа нужна пауза"
            : "Скоро можно продолжить"
          : fatigueRatio > 0
            ? `Агрессивная усталость пройдёт через ${fatigueSeconds} сек`
            : "Тапай быстро или удерживай для ультра-тапа";

  const dogImageState =
    dogState === "angry"
      ? "angry"
      : dogState === "warning" ||
          (dogState === "recovering" && recoveryReason === "ultra")
        ? "warning"
        : "calm";
  const dogDisabled = dogState === "angry" || dogState === "recovering";
  const progress =
    tapLimit > 0 ? Math.min(1, seriesTaps / Math.max(1, tapLimit)) : 0;
  const ultraProgress = Math.min(
    1,
    ultraElapsed / ULTRA_TAP_MAX_HOLD_MS,
  );
  const ultraReady = ultraElapsed >= ULTRA_TAP_MIN_HOLD_MS;

  const gameStyle = {
    "--series-progress": progress,
    "--ultra-angle": `${ultraProgress * 360}deg`,
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
      <header className="top-bar">
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
            <span className="ultra-progress-ring" aria-hidden="true" />
            <span className="tap-particles" aria-hidden="true">
              {particles.map((particle) => (
                <span
                  className="tap-particle"
                  key={particle.id}
                  style={{ left: `${particle.x}%`, top: `${particle.y}%` }}
                >
                  +1
                </span>
              ))}
            </span>
            {ultraActive && (
              <span className={`ultra-readout ${ultraReady ? "ready" : ""}`}>
                <small>{ultraReady ? "ОТПУСКАЙ КОГДА ГОТОВ" : "РАЗОГРЕВ"}</small>
                <strong>+{ultraPreview}</strong>
                <b>{formatSeconds(ultraElapsed)} / 15.0 сек</b>
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

          <div className="tempo-panel">
            <div className="tempo-row">
              <span>Темп <strong>{tempoLabel}</strong></span>
              <span>Серия <strong>{seriesTaps} / {tapLimit || "—"}</strong></span>
            </div>
            <div className="series-track" aria-label={`Серия ${seriesTaps} из ${tapLimit || 0}`}>
              <span />
            </div>
            <div className="tempo-footer">
              <span>
                {fatigueRatio > 0
                  ? `Усталость · ${fatigueSeconds} сек`
                  : "Быстрее темп — длиннее серия"}
              </span>
              <span>Удерживай 2–15 сек</span>
            </div>
          </div>

          <p className="moment-message" role="status">
            {momentMessage || "Короткий тап — монета. Удержание — ультра."}
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
