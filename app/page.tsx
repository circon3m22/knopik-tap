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
  SAFE_CATALOG,
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
  type OwnedSafe,
  type SafeSize,
} from "./game-logic";

type RecoveryOutcome = "rested" | "bitten";
type RecoveryPhase = "settling" | "relaxed";
type SoundKind = "tap" | "warning" | "bite" | "safe";
type TapParticle = { id: number; x: number; y: number };

const CALM_IDLE_MS = 2_800;
const WARNING_IDLE_MS = 3_100;
const ANGRY_LOCK_MS = 2_000;
const RECOVERY_MS = 1_650;

const tutorialSlides = [
  "Тапай Кнопика — монеты попадают на незащищённый баланс",
  "Когда Кнопик напрягся — остановись и дай ему отдохнуть",
  "При укусе баланс сгорит. Монеты в купленных сейфах останутся",
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

export default function Home() {
  const [dogState, setDogState] = useState<DogState>("calm");
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
  const [recoveryOutcome, setRecoveryOutcome] =
    useState<RecoveryOutcome>("rested");
  const [recoveryPhase, setRecoveryPhase] =
    useState<RecoveryPhase>("relaxed");
  const [tapPulse, setTapPulse] = useState(0);
  const [particles, setParticles] = useState<TapParticle[]>([]);
  const [biteFlash, setBiteFlash] = useState(false);
  const [purchaseMessage, setPurchaseMessage] = useState("");

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
  const messageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
      messageTimerRef,
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
      const loadedCoins = {
        walletCoins: saved.walletCoins,
        streakCoins: 0,
      };
      const loadedStats = {
        bestStreak: saved.bestStreak,
        totalTaps: saved.totalTaps,
        totalBites: saved.totalBites,
      };

      coinsRef.current = loadedCoins;
      settingsRef.current = saved.settings;
      statsRef.current = loadedStats;
      setCoins(loadedCoins);
      setSafes(saved.safes);
      setSettings(saved.settings);
      setStats(loadedStats);
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
  }, [settings]);

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
        }),
      );
    } catch {
      // The game still works when storage is unavailable.
    }
  }, [coins.walletCoins, hydrated, safes, settings, stats, tutorialSeen]);

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
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = kind === "bite" ? "sawtooth" : kind === "warning" ? "triangle" : "sine";
      const startFrequency =
        kind === "bite" ? 125 : kind === "warning" ? 115 : kind === "safe" ? 420 : 660;
      oscillator.frequency.setValueAtTime(startFrequency, now);
      if (kind === "bite" || kind === "warning") {
        oscillator.frequency.exponentialRampToValueAtTime(
          kind === "bite" ? 58 : 82,
          now + (kind === "bite" ? 0.24 : 0.18),
        );
      } else if (kind === "safe") {
        oscillator.frequency.exponentialRampToValueAtTime(840, now + 0.16);
      }
      const duration = kind === "bite" ? 0.26 : kind === "warning" ? 0.21 : kind === "safe" ? 0.18 : 0.06;
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(kind === "bite" ? 0.1 : 0.035, now + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(now);
      oscillator.stop(now + duration + 0.01);
    } catch {
      // Sound is optional.
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
      updateCoins((current) => ({ ...current, streakCoins: 0 }));
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
          beginRecovery("rested", dogStateRef.current);
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
    updateCoins(() => ({ walletCoins: 0, streakCoins: 0 }));
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
        walletCoins: current.walletCoins + 1,
        streakCoins: current.streakCoins + 1,
      }));
      updateStats((current) => ({
        ...current,
        bestStreak: Math.max(current.bestStreak, nextStreak),
      }));

      tapsInSeriesRef.current += 1;
      if (patienceRef.current === null) {
        patienceRef.current = createPatience(now - lastTapAtRef.current);
      }
      fatigueRef.current += tapFatigue();
      lastTapAtRef.current = now;
      const thresholdReached =
        tapsInSeriesRef.current >= 5 &&
        fatigueRef.current >= patienceRef.current;

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
      playSound("safe");
      vibrate([20, 30, 45], settingsRef.current.vibration);
      if (messageTimerRef.current) clearTimeout(messageTimerRef.current);
      messageTimerRef.current = setTimeout(() => setPurchaseMessage(""), 1_800);
    },
    [playSound, updateCoins],
  );

  const finishTutorial = useCallback(() => {
    setTutorialSeen(true);
    setTutorialOpen(false);
    setTutorialStep(0);
  }, []);

  const resetProgress = useCallback(() => {
    clearRoundTimers();
    const defaults = createDefaultSave();
    const resetCoins = { walletCoins: 0, streakCoins: 0 };
    const resetStats = { bestStreak: 0, totalTaps: 0, totalBites: 0 };
    coinsRef.current = resetCoins;
    settingsRef.current = defaults.settings;
    statsRef.current = resetStats;
    setCoins(resetCoins);
    setSafes([]);
    setStats(resetStats);
    setSettings(defaults.settings);
    setTutorialSeen(false);
    setTutorialStep(0);
    setTutorialOpen(true);
    setSafesOpen(false);
    setSettingsOpen(false);
    setResetConfirmOpen(false);
    setRecoveryOutcome("rested");
    setRecoveryPhase("relaxed");
    patienceRef.current = null;
    fatigueRef.current = 0;
    tapsInSeriesRef.current = 0;
    lastTapAtRef.current = Date.now() - 11_000;
    transitionTo("calm");
    localStorage.removeItem(SAVE_KEY);
  }, [clearRoundTimers, transitionTo]);

  const vaultCoins = useMemo(
    () => safes.reduce((total, safe) => total + safe.stored, 0),
    [safes],
  );

  const moodLabel =
    dogState === "warning"
      ? "НАПРЯЖЁН"
      : dogState === "angry"
        ? "ЗОЛ"
        : dogState === "recovering"
          ? "ОТДЫХАЕТ"
          : "СПОКОЕН";

  const statusText = useMemo(() => {
    if (dogState === "warning") return "КНОПИК НАПРЯГСЯ — НЕ ТРОГАЙ";
    if (dogState === "angry") return "НЕЗАЩИЩЁННЫЕ МОНЕТЫ СГОРЕЛИ";
    if (dogState === "recovering") {
      return recoveryOutcome === "bitten"
        ? "СЕЙФЫ ЦЕЛЫ. КНОПИК ОТДЫХАЕТ"
        : "КНОПИК ОТДЫХАЕТ. БАЛАНС НЕ ЗАЩИЩЁН";
    }
    if (coins.walletCoins >= 200) return "МОЖНО ЗАПОЛНИТЬ МАЛЫЙ СЕЙФ";
    return coins.streakCoins > 0
      ? "ЕЩЁ ТАП — ИЛИ ПОРА ОСТАНОВИТЬСЯ?"
      : "ТАПАЙ КНОПИКА";
  }, [coins.streakCoins, coins.walletCoins, dogState, recoveryOutcome]);

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
      <div className="arcade-grid" aria-hidden="true" />

      <header className="hud-panel">
        <div className="brand-lockup" aria-label="Knopik Tap">
          <span>KNOPIK</span>
          <strong>TAP</strong>
        </div>
        <div className="hud-stats">
          <button
            className="hud-stat hud-stat-button"
            type="button"
            aria-label={`Открыть сейфы. В хранилище ${vaultCoins} монет`}
            onClick={() => setSafesOpen(true)}
          >
            <span className="mini-safe" aria-hidden="true"><i /></span>
            <strong>{vaultCoins.toLocaleString("ru-RU")}</strong>
            <small>В СЕЙФАХ</small>
          </button>
          <div className="hud-stat">
            <span className="coin-icon" aria-hidden="true">K</span>
            <strong>{coins.walletCoins.toLocaleString("ru-RU")}</strong>
            <small>БАЛАНС</small>
          </div>
          <div className="hud-stat">
            <span className="mood-icon" aria-hidden="true"><i /><i /><b /></span>
            <strong>{moodLabel}</strong>
            <small>КНОПИК</small>
          </div>
        </div>
      </header>

      <section className="game-zone" aria-live="polite">
        <button
          className={`dog-button tap-${tapPulse % 2 === 0 ? "a" : "b"}`}
          type="button"
          data-testid="knopik"
          aria-label={dogDisabled ? "Кнопик отдыхает" : "Тапнуть Кнопика"}
          disabled={dogDisabled}
          onPointerDown={handlePointerDown}
          onKeyDown={handleKeyDown}
          onContextMenu={(event) => event.preventDefault()}
        >
          <span className="portrait-ring" aria-hidden="true" />
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
                +1
              </span>
            ))}
          </span>
        </button>

        <div className="wallet-display" aria-label={`${coins.walletCoins} незащищённых монет`}>
          <strong>{coins.walletCoins.toLocaleString("ru-RU")}</strong>
          <span>НЕЗАЩИЩЁННЫЙ БАЛАНС</span>
          {coins.streakCoins > 0 && <small>+{coins.streakCoins} ЗА ПОДХОД</small>}
        </div>
        <p className="status-copy" role="status">{statusText}</p>
      </section>

      <nav className="bottom-nav" aria-label="Меню игры">
        <button type="button" onClick={() => setSafesOpen(true)}>
          <span className="nav-icon safe-nav-icon" aria-hidden="true"><i /></span>
          <span>СЕЙФЫ</span>
          {safes.length > 0 && <b>{safes.length}</b>}
        </button>
        <button className="active" type="button" aria-current="page" onClick={() => { setSafesOpen(false); setSettingsOpen(false); }}>
          <span className="nav-icon home-nav-icon" aria-hidden="true"><i /></span>
          <span>ИГРА</span>
        </button>
        <button type="button" onClick={() => setSettingsOpen(true)}>
          <span className="nav-icon settings-nav-icon" aria-hidden="true"><i /><i /><i /></span>
          <span>НАСТРОЙКИ</span>
        </button>
      </nav>

      {tutorialOpen && (
        <div className="modal-backdrop tutorial-backdrop">
          <section className="tutorial-sheet" role="dialog" aria-modal="true" aria-labelledby="tutorial-title">
            <div className="tutorial-badge" aria-hidden="true"><span className="mini-safe"><i /></span></div>
            <p className="sheet-kicker">КАК ИГРАТЬ</p>
            <h1 id="tutorial-title">{tutorialSlides[tutorialStep]}</h1>
            <div className="tutorial-dots" aria-label={`Шаг ${tutorialStep + 1} из 3`}>
              {tutorialSlides.map((_, index) => <span className={index === tutorialStep ? "active" : ""} key={index} />)}
            </div>
            <button
              className="primary-button"
              type="button"
              onClick={() => tutorialStep < tutorialSlides.length - 1 ? setTutorialStep((current) => current + 1) : finishTutorial()}
            >
              {tutorialStep === tutorialSlides.length - 1 ? "ИГРАТЬ" : "ДАЛЬШЕ"}
            </button>
          </section>
        </div>
      )}

      {safesOpen && (
        <div className="modal-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) setSafesOpen(false); }}>
          <section className="safe-sheet" role="dialog" aria-modal="true" aria-labelledby="safes-title">
            <div className="sheet-heading">
              <div><p className="sheet-kicker">ХРАНИЛИЩЕ</p><h2 id="safes-title">Мои сейфы</h2></div>
              <button className="close-button" type="button" aria-label="Закрыть сейфы" onClick={() => setSafesOpen(false)}><span /></button>
            </div>

            <div className="vault-total">
              <span className="large-safe" aria-hidden="true"><i /></span>
              <div><small>ВСЕГО ЗАЩИЩЕНО</small><strong>{vaultCoins.toLocaleString("ru-RU")}</strong><span>монет</span></div>
            </div>

            {purchaseMessage && <p className="purchase-message" role="status">{purchaseMessage}</p>}

            <div className="sheet-scroll">
              <section className="owned-section">
                <h3>Купленные сейфы</h3>
                {safes.length === 0 ? (
                  <p className="empty-safes">Пока пусто. Купленный сейф сразу заполняется и навсегда защищает вклад.</p>
                ) : (
                  <div className="owned-safe-list">
                    {safes.map((safe, index) => {
                      const definition = SAFE_CATALOG.find((entry) => entry.size === safe.size)!;
                      return (
                        <article className={`owned-safe size-${safe.size}`} key={safe.id}>
                          <span className="mini-safe" aria-hidden="true"><i /></span>
                          <div><strong>{definition.name} сейф #{index + 1}</strong><small>{safe.stored} / {safe.capacity} монет</small></div>
                          <b>ПОЛНЫЙ</b>
                        </article>
                      );
                    })}
                  </div>
                )}
              </section>

              <section className="safe-shop">
                <h3>Новый сейф</h3>
                <p>Нужна сумма на сам сейф и ещё столько же, чтобы сразу его заполнить.</p>
                <div className="safe-options">
                  {SAFE_CATALOG.map((safe) => {
                    const required = safe.price + safe.capacity;
                    const available = coins.walletCoins >= required;
                    return (
                      <article className={`safe-option size-${safe.size}`} key={safe.size}>
                        <span className="mini-safe" aria-hidden="true"><i /></span>
                        <div className="safe-option-copy">
                          <strong>{safe.name}</strong>
                          <span>Вместимость {safe.capacity}</span>
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
        <div className="modal-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) setSettingsOpen(false); }}>
          <section className="settings-sheet" role="dialog" aria-modal="true" aria-labelledby="settings-title">
            <div className="sheet-heading">
              <div><p className="sheet-kicker">KNOPIK TAP</p><h2 id="settings-title">Настройки</h2></div>
              <button className="close-button" type="button" aria-label="Закрыть настройки" onClick={() => setSettingsOpen(false)}><span /></button>
            </div>
            <div className="setting-row"><div><strong>Звук</strong><span>Короткие игровые эффекты</span></div><button className="switch" type="button" role="switch" aria-checked={settings.sound} aria-label="Звук" onClick={() => setSettings((current) => ({ ...current, sound: !current.sound }))}><span /></button></div>
            <div className="setting-row"><div><strong>Вибрация</strong><span>Если устройство поддерживает</span></div><button className="switch" type="button" role="switch" aria-checked={settings.vibration} aria-label="Вибрация" onClick={() => setSettings((current) => ({ ...current, vibration: !current.vibration }))}><span /></button></div>
            <button className="settings-action" type="button" onClick={() => { setSettingsOpen(false); setTutorialStep(0); setTutorialOpen(true); }}>ПОВТОРИТЬ ОБУЧЕНИЕ <span>↗</span></button>
            {!resetConfirmOpen ? (
              <button className="settings-action danger-action" type="button" onClick={() => setResetConfirmOpen(true)}>СБРОСИТЬ ПРОГРЕСС</button>
            ) : (
              <div className="reset-confirm" role="alert"><p>Удалить баланс, сейфы, рекорды и настройки?</p><div><button type="button" onClick={() => setResetConfirmOpen(false)}>ОТМЕНА</button><button className="confirm-reset" type="button" onClick={resetProgress}>СБРОСИТЬ</button></div></div>
            )}
            <div className="stats-line"><span>ЛУЧШАЯ СЕРИЯ <strong>{stats.bestStreak}</strong></span><span>ТАПОВ <strong>{stats.totalTaps}</strong></span><span>УКУСОВ <strong>{stats.totalBites}</strong></span></div>
          </section>
        </div>
      )}

      <div className="red-flash" aria-hidden="true" />
    </main>
  );
}
