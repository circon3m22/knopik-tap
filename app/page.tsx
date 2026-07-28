"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import {
  SAVE_KEY,
  SAVE_VERSION,
  createDefaultSave,
  createPatience,
  sanitizeSave,
  tapFatigue,
  type CoinState,
  type DogState,
  type GameSettings,
  type GameStats,
} from "./game-logic";

type RecoveryOutcome = "saved" | "bitten";
type RecoveryPhase = "settling" | "relaxed";
type SoundKind = "tap" | "warning" | "bite";

type TapParticle = {
  id: number;
  x: number;
  y: number;
};

const CALM_IDLE_MS = 2_800;
const WARNING_IDLE_MS = 3_100;
const ANGRY_LOCK_MS = 2_000;
const RECOVERY_MS = 1_650;

const tutorialSlides = [
  "Нажимай на Кнопика и получай монеты",
  "Когда Кнопик напрягся — остановись",
  "Нажмёшь ещё раз — он укусит, и монеты серии сгорят",
];

function vibrate(pattern: number | number[], enabled: boolean) {
  if (enabled && typeof navigator !== "undefined" && "vibrate" in navigator) {
    navigator.vibrate(pattern);
  }
}

export default function Home() {
  const [dogState, setDogState] = useState<DogState>("calm");
  const [coins, setCoins] = useState<CoinState>({
    bankCoins: 0,
    streakCoins: 0,
  });
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [showFirstHint, setShowFirstHint] = useState(false);
  const [recoveryOutcome, setRecoveryOutcome] =
    useState<RecoveryOutcome>("saved");
  const [recoveryPhase, setRecoveryPhase] =
    useState<RecoveryPhase>("relaxed");
  const [tapPulse, setTapPulse] = useState(0);
  const [particles, setParticles] = useState<TapParticle[]>([]);
  const [biteFlash, setBiteFlash] = useState(false);

  const dogStateRef = useRef<DogState>("calm");
  const coinsRef = useRef(coins);
  const settingsRef = useRef(settings);
  const statsRef = useRef(stats);
  const patienceRef = useRef<number | null>(null);
  const fatigueRef = useRef(0);
  const tapsInSeriesRef = useRef(0);
  const lastTapAtRef = useRef(Date.now() - 11_000);
  const particleIdRef = useRef(0);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recoveryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const relaxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const angryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

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
    [
      settleTimerRef,
      recoveryTimerRef,
      relaxTimerRef,
      angryTimerRef,
      flashTimerRef,
    ].forEach((timerRef) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
    });
  }, []);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(SAVE_KEY);
      const parsed = stored ? JSON.parse(stored) : createDefaultSave();
      const saved = sanitizeSave(parsed);
      const loadedCoins = { bankCoins: saved.bankCoins, streakCoins: 0 };
      const loadedStats = {
        bestStreak: saved.bestStreak,
        totalTaps: saved.totalTaps,
        totalBites: saved.totalBites,
      };

      coinsRef.current = loadedCoins;
      settingsRef.current = saved.settings;
      statsRef.current = loadedStats;
      setCoins(loadedCoins);
      setSettings(saved.settings);
      setStats(loadedStats);
      setTutorialSeen(saved.tutorialSeen);
      setTutorialOpen(!saved.tutorialSeen);
      setShowFirstHint(!saved.tutorialSeen);
    } catch {
      localStorage.removeItem(SAVE_KEY);
      setTutorialOpen(true);
      setShowFirstHint(true);
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
  }, [settings]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(
        SAVE_KEY,
        JSON.stringify({
          version: SAVE_VERSION,
          bankCoins: coins.bankCoins,
          settings,
          tutorialSeen,
          bestStreak: stats.bestStreak,
          totalTaps: stats.totalTaps,
          totalBites: stats.totalBites,
        }),
      );
    } catch {
      // Private browsing and storage quotas must not stop the game.
    }
  }, [coins.bankCoins, hydrated, settings, stats, tutorialSeen]);

  useEffect(() => clearRoundTimers, [clearRoundTimers]);

  const playSound = useCallback((kind: SoundKind) => {
    if (!settingsRef.current.sound) return;

    const AudioConstructor =
      window.AudioContext ??
      (window as typeof window & {
        webkitAudioContext?: typeof AudioContext;
      }).webkitAudioContext;
    if (!AudioConstructor) return;

    try {
      const context =
        audioContextRef.current ?? new AudioConstructor({ latencyHint: "interactive" });
      audioContextRef.current = context;
      void context.resume();
      const now = context.currentTime;

      if (kind === "bite") {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = "sawtooth";
        oscillator.frequency.setValueAtTime(125, now);
        oscillator.frequency.exponentialRampToValueAtTime(58, now + 0.24);
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.1, now + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);
        oscillator.connect(gain).connect(context.destination);
        oscillator.start(now);
        oscillator.stop(now + 0.26);
        return;
      }

      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = kind === "warning" ? "triangle" : "sine";
      oscillator.frequency.setValueAtTime(kind === "warning" ? 115 : 660, now);
      if (kind === "warning") {
        oscillator.frequency.exponentialRampToValueAtTime(82, now + 0.18);
      }
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(
        kind === "warning" ? 0.045 : 0.025,
        now + 0.008,
      );
      gain.gain.exponentialRampToValueAtTime(
        0.0001,
        now + (kind === "warning" ? 0.2 : 0.055),
      );
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(now);
      oscillator.stop(now + (kind === "warning" ? 0.21 : 0.06));
    } catch {
      // Audio is an enhancement; gameplay remains available without it.
    }
  }, []);

  const finishRecovery = useCallback(() => {
    transitionTo("calm");
    setRecoveryPhase("relaxed");
    patienceRef.current = null;
    fatigueRef.current = 0;
    tapsInSeriesRef.current = 0;
  }, [transitionTo]);

  const beginRecovery = useCallback(
    (outcome: RecoveryOutcome, previousState: DogState) => {
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;

      if (outcome === "saved") {
        const savedCoins = coinsRef.current.streakCoins;
        updateCoins((current) => ({
          bankCoins: current.bankCoins + savedCoins,
          streakCoins: 0,
        }));
      }

      setRecoveryOutcome(outcome);
      setRecoveryPhase(previousState === "calm" ? "relaxed" : "settling");
      transitionTo("recovering");
      patienceRef.current = null;
      fatigueRef.current = 0;
      tapsInSeriesRef.current = 0;

      if (previousState !== "calm") {
        relaxTimerRef.current = setTimeout(
          () => setRecoveryPhase("relaxed"),
          760,
        );
      }
      recoveryTimerRef.current = setTimeout(finishRecovery, RECOVERY_MS);
    },
    [finishRecovery, transitionTo, updateCoins],
  );

  const armSettleTimer = useCallback(
    (state: "calm" | "warning") => {
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
      settleTimerRef.current = setTimeout(() => {
        if (
          dogStateRef.current === "calm" ||
          dogStateRef.current === "warning"
        ) {
          beginRecovery("saved", dogStateRef.current);
        }
      }, state === "warning" ? WARNING_IDLE_MS : CALM_IDLE_MS);
    },
    [beginRecovery],
  );

  const triggerBite = useCallback(() => {
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    settleTimerRef.current = null;
    transitionTo("angry");
    setRecoveryOutcome("bitten");
    setBiteFlash(true);
    updateCoins((current) => ({ ...current, streakCoins: 0 }));
    updateStats((current) => ({
      ...current,
      totalBites: current.totalBites + 1,
    }));
    patienceRef.current = null;
    fatigueRef.current = 0;
    tapsInSeriesRef.current = 0;
    lastTapAtRef.current = Date.now();
    vibrate([90, 35, 70], settingsRef.current.vibration);
    playSound("bite");
    flashTimerRef.current = setTimeout(() => setBiteFlash(false), 360);
    angryTimerRef.current = setTimeout(
      () => beginRecovery("bitten", "angry"),
      ANGRY_LOCK_MS,
    );
  }, [beginRecovery, playSound, transitionTo, updateCoins, updateStats]);

  const addParticle = useCallback((x: number, y: number) => {
    const id = ++particleIdRef.current;
    setParticles((current) => [...current.slice(-7), { id, x, y }]);
    setTimeout(
      () => setParticles((current) => current.filter((item) => item.id !== id)),
      620,
    );
  }, []);

  const registerTap = useCallback(
    (x: number, y: number) => {
      const currentState = dogStateRef.current;
      if (currentState === "angry" || currentState === "recovering") return;

      setShowFirstHint(false);
      setTapPulse((current) => current + 1);
      addParticle(x, y);
      updateStats((current) => ({
        ...current,
        totalTaps: current.totalTaps + 1,
      }));

      if (currentState === "warning") {
        triggerBite();
        return;
      }

      const now = Date.now();
      const nextStreak = coinsRef.current.streakCoins + 1;
      updateCoins((current) => ({
        ...current,
        streakCoins: current.streakCoins + 1,
      }));
      updateStats((current) => ({
        ...current,
        bestStreak: Math.max(current.bestStreak, nextStreak),
      }));

      tapsInSeriesRef.current += 1;
      if (patienceRef.current === null) {
        const qaThreshold =
          location.hostname === "localhost"
            ? Number(new URLSearchParams(location.search).get("qaThreshold"))
            : Number.NaN;
        patienceRef.current = Number.isFinite(qaThreshold)
          ? Math.min(100, Math.max(5, Math.floor(qaThreshold)))
          : createPatience(now - lastTapAtRef.current);
      }

      fatigueRef.current += tapFatigue();
      lastTapAtRef.current = now;
      const thresholdReached =
        tapsInSeriesRef.current >= 5 &&
        (fatigueRef.current >= patienceRef.current ||
          (location.hostname === "localhost" &&
            Number.isFinite(
              Number(new URLSearchParams(location.search).get("qaThreshold")),
            ) &&
            tapsInSeriesRef.current >= patienceRef.current));

      playSound("tap");
      vibrate(8, settingsRef.current.vibration);

      if (thresholdReached) {
        transitionTo("warning");
        vibrate([24, 36, 24], settingsRef.current.vibration);
        playSound("warning");
        armSettleTimer("warning");
      } else {
        armSettleTimer("calm");
      }
    },
    [
      addParticle,
      armSettleTimer,
      playSound,
      transitionTo,
      triggerBite,
      updateCoins,
      updateStats,
    ],
  );

  const handlePointerDown = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      const rect = event.currentTarget.getBoundingClientRect();
      registerTap(
        ((event.clientX - rect.left) / rect.width) * 100,
        ((event.clientY - rect.top) / rect.height) * 100,
      );
    },
    [registerTap],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      registerTap(50, 48);
    },
    [registerTap],
  );

  const finishTutorial = useCallback(() => {
    setTutorialSeen(true);
    setTutorialOpen(false);
    setTutorialStep(0);
  }, []);

  const resetProgress = useCallback(() => {
    clearRoundTimers();
    const defaults = createDefaultSave();
    const resetCoins = { bankCoins: 0, streakCoins: 0 };
    const resetStats = { bestStreak: 0, totalTaps: 0, totalBites: 0 };
    coinsRef.current = resetCoins;
    settingsRef.current = defaults.settings;
    statsRef.current = resetStats;
    setCoins(resetCoins);
    setStats(resetStats);
    setSettings(defaults.settings);
    setTutorialSeen(false);
    setTutorialStep(0);
    setTutorialOpen(true);
    setSettingsOpen(false);
    setResetConfirmOpen(false);
    setShowFirstHint(true);
    setRecoveryOutcome("saved");
    setRecoveryPhase("relaxed");
    patienceRef.current = null;
    fatigueRef.current = 0;
    tapsInSeriesRef.current = 0;
    lastTapAtRef.current = Date.now() - 11_000;
    transitionTo("calm");
    localStorage.removeItem(SAVE_KEY);
  }, [clearRoundTimers, transitionTo]);

  const statusText = useMemo(() => {
    if (dogState === "warning") return "Кнопик напрягся";
    if (dogState === "angry") return "Кнопик тебя укусил";
    if (dogState === "recovering") {
      return recoveryOutcome === "saved"
        ? "Монеты сохранены"
        : "Подожди, пока Кнопик успокоится";
    }
    return coins.streakCoins > 0
      ? "Ещё тап — или пора остановиться?"
      : "Тапай Кнопика";
  }, [coins.streakCoins, dogState, recoveryOutcome]);

  const dogImageState =
    dogState === "angry"
      ? "angry"
      : dogState === "warning" ||
          (dogState === "recovering" && recoveryPhase === "settling")
        ? "warning"
        : "calm";

  const dogDisabled = dogState === "angry" || dogState === "recovering";

  return (
    <main
      className={`game-shell state-${dogState} ${biteFlash ? "bite-flash" : ""}`}
      data-state={dogState}
      data-hydrated={hydrated}
    >
      <div className="ambient-ring ambient-ring-one" aria-hidden="true" />
      <div className="ambient-ring ambient-ring-two" aria-hidden="true" />

      <header className="top-bar">
        <div className="brand" aria-label="Knopik Tap">
          <span>KNOPIK</span>
          <strong>TAP</strong>
        </div>

        <div className="bank-balance" aria-label={`${coins.bankCoins} сохранённых монет`}>
          <span className="coin-icon" aria-hidden="true">K</span>
          <span>{coins.bankCoins.toLocaleString("ru-RU")}</span>
        </div>

        <button
          className="icon-button"
          type="button"
          aria-label="Открыть настройки"
          onClick={() => setSettingsOpen(true)}
        >
          <span className="settings-icon" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        </button>
      </header>

      <section className="dog-stage" aria-live="polite">
        <button
          className={`dog-button tap-${tapPulse % 2 === 0 ? "a" : "b"}`}
          type="button"
          data-testid="knopik"
          aria-label={
            dogDisabled
              ? "Кнопик отдыхает"
              : "Нажать на Кнопика и получить монету"
          }
          disabled={dogDisabled}
          onPointerDown={handlePointerDown}
          onKeyDown={handleKeyDown}
          onContextMenu={(event) => event.preventDefault()}
        >
          <span className="dog-halo" aria-hidden="true" />
          <span className="dog-images" data-image-state={dogImageState}>
            <img
              className="dog-image calm-image"
              src="/knopik-calm.png"
              alt=""
              draggable={false}
            />
            <img
              className="dog-image warning-image"
              src="/knopik-warning.png"
              alt=""
              draggable={false}
            />
            <img
              className="dog-image angry-image"
              src="/knopik-angry.png"
              alt=""
              draggable={false}
            />
          </span>
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
        </button>
      </section>

      <section className="round-panel">
        <div className="streak-count" aria-label={`${coins.streakCoins} монет в текущей серии`}>
          <strong>{coins.streakCoins}</strong>
          <span>в серии</span>
        </div>
        <p className="status-copy" role="status">{statusText}</p>
        <p className={`first-hint ${showFirstHint ? "visible" : ""}`}>
          Остановись вовремя — серия сохранится сама
        </p>
      </section>

      {tutorialOpen && (
        <div className="modal-backdrop tutorial-backdrop">
          <section
            className="tutorial-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="tutorial-title"
          >
            <div className="tutorial-mark" aria-hidden="true">
              <span className="coin-icon">K</span>
            </div>
            <p className="sheet-kicker">КАК ИГРАТЬ</p>
            <h1 id="tutorial-title">{tutorialSlides[tutorialStep]}</h1>
            <div className="tutorial-dots" aria-label={`Шаг ${tutorialStep + 1} из 3`}>
              {tutorialSlides.map((_, index) => (
                <span className={index === tutorialStep ? "active" : ""} key={index} />
              ))}
            </div>
            <button
              className="primary-button"
              type="button"
              onClick={() => {
                if (tutorialStep < tutorialSlides.length - 1) {
                  setTutorialStep((current) => current + 1);
                } else {
                  finishTutorial();
                }
              }}
            >
              {tutorialStep === tutorialSlides.length - 1 ? "Играть" : "Дальше"}
            </button>
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
          <section
            className="settings-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-title"
          >
            <div className="sheet-heading">
              <div>
                <p className="sheet-kicker">KNOPIK TAP</p>
                <h2 id="settings-title">Настройки</h2>
              </div>
              <button
                className="close-button"
                type="button"
                aria-label="Закрыть настройки"
                onClick={() => setSettingsOpen(false)}
              >
                <span aria-hidden="true" />
              </button>
            </div>

            <div className="setting-row">
              <div>
                <strong>Звук</strong>
                <span>Короткие эффекты игры</span>
              </div>
              <button
                className="switch"
                type="button"
                role="switch"
                aria-checked={settings.sound}
                aria-label="Звук"
                onClick={() =>
                  setSettings((current) => ({ ...current, sound: !current.sound }))
                }
              >
                <span />
              </button>
            </div>

            <div className="setting-row">
              <div>
                <strong>Вибрация</strong>
                <span>Если устройство поддерживает</span>
              </div>
              <button
                className="switch"
                type="button"
                role="switch"
                aria-checked={settings.vibration}
                aria-label="Вибрация"
                onClick={() =>
                  setSettings((current) => ({
                    ...current,
                    vibration: !current.vibration,
                  }))
                }
              >
                <span />
              </button>
            </div>

            <button
              className="settings-action"
              type="button"
              onClick={() => {
                setSettingsOpen(false);
                setTutorialStep(0);
                setTutorialOpen(true);
              }}
            >
              Повторить обучение
              <span aria-hidden="true">↗</span>
            </button>

            {!resetConfirmOpen ? (
              <button
                className="settings-action danger-action"
                type="button"
                onClick={() => setResetConfirmOpen(true)}
              >
                Сбросить прогресс
              </button>
            ) : (
              <div className="reset-confirm" role="alert">
                <p>Удалить баланс, рекорды и настройки?</p>
                <div>
                  <button type="button" onClick={() => setResetConfirmOpen(false)}>
                    Отмена
                  </button>
                  <button className="confirm-reset" type="button" onClick={resetProgress}>
                    Сбросить
                  </button>
                </div>
              </div>
            )}

            <div className="stats-line" aria-label="Статистика игры">
              <span>Лучшая серия <strong>{stats.bestStreak}</strong></span>
              <span>Укусов <strong>{stats.totalBites}</strong></span>
            </div>
          </section>
        </div>
      )}

      <div className="red-flash" aria-hidden="true" />
    </main>
  );
}
