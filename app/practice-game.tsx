"use client";
import { TapIcon } from "./tap-icon";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  memoryPattern,
  timingHit,
  timingPosition,
  type PracticeKind,
} from "./arcade-engine";
import { useGameDialog } from "./use-game-dialog";

export function PracticeGame({
  kind,
  onComplete,
  onClose,
  onTick,
}: {
  kind: PracticeKind;
  onComplete: (kind: PracticeKind, won: boolean) => void;
  onClose: () => void;
  onTick: () => void;
}) {
  const [phase, setPhase] = useState<
    "ready" | "showing" | "playing" | "feedback" | "finished"
  >("ready");
  const [round, setRound] = useState(0),
    [score, setScore] = useState(0);
  const [position, setPosition] = useState(0.5),
    [lit, setLit] = useState(-1),
    [entered, setEntered] = useState(0),
    [message, setMessage] = useState("");
  const [calm] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const phaseRef = useRef(phase),
    startRef = useRef(0),
    patternRef = useRef<number[]>([]),
    inputRef = useRef<number[]>([]),
    completeRef = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const ref = useGameDialog(onClose);
  const change = (next: typeof phase) => {
    phaseRef.current = next;
    setPhase(next);
  };
  useEffect(() => {
    return () => timers.current.forEach(clearTimeout);
  }, []);
  // Backgrounding a timing attempt resets it; a hidden tab cannot provide a surprise result.
  useEffect(() => {
    const handle = () => {
      if (
        document.hidden &&
        phaseRef.current === "playing" &&
        kind === "timing"
      ) {
        phaseRef.current = "ready";
        setPhase("ready");
        setMessage("Продолжим, когда будешь готов.");
      }
    };
    document.addEventListener("visibilitychange", handle);
    return () => document.removeEventListener("visibilitychange", handle);
  }, [kind]);
  const begin = (now: number) => {
    if (phaseRef.current !== "ready" && phaseRef.current !== "feedback") return;
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setMessage("");
    inputRef.current = [];
    setEntered(0);
    if (kind === "timing") {
      startRef.current = now;
      change("playing");
    } else {
      patternRef.current = memoryPattern();
      change("showing");
      setLit(-1);
      patternRef.current.forEach((tile, i) => {
        timers.current.push(
          setTimeout(
            () => {
              setLit(tile);
              onTick();
            },
            400 + i * 700,
          ),
        );
        timers.current.push(setTimeout(() => setLit(-1), 850 + i * 700));
      });
      timers.current.push(
        setTimeout(() => {
          change("playing");
          setLit(-1);
        }, 3_200),
      );
    }
  };
  const finishAttempt = (hit: boolean) => {
    if (phaseRef.current !== "playing") return;
    change("feedback");
    onTick();
    const next = score + (hit ? 1 : 0);
    setScore(next);
    setRound(round + 1);
    setMessage(
      hit ? "Отлично, получилось!" : "Ничего страшного. Следующая попытка!",
    );
    if (round === 2) {
      change("finished");
      if (!completeRef.current) {
        completeRef.current = true;
        onComplete(kind, next >= 2);
      }
    }
  };
  const stop = (now: number) => {
    const value = timingPosition(now - startRef.current);
    setPosition(value);
    finishAttempt(timingHit(value));
  };
  const choose = (tile: number) => {
    if (phaseRef.current !== "playing") return;
    const index = inputRef.current.length;
    inputRef.current.push(tile);
    setEntered(index + 1);
    onTick();
    if (patternRef.current[index] !== tile) {
      finishAttempt(false);
      return;
    }
    if (index === 3) finishAttempt(true);
  };
  return (
    <div className="tap-overlay">
      <section
        className={`tap-screen practice-screen practice-${kind}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="practice-title"
        ref={ref}
        tabIndex={-1}
      >
        <header className="tap-screen-heading">
          <div>
            <span className="tap-eyebrow">На навык · без ставки</span>
            <h2 id="practice-title">
              {kind === "timing" ? "Точный тап" : "Память Кнопика"}
            </h2>
          </div>
          <button
            className="tap-icon-button"
            onClick={onClose}
            aria-label="Закрыть испытание"
          >
            <TapIcon kind="close" />
          </button>
        </header>
        <div className="practice-score">
          <span>Раунд {Math.min(3, round + 1)} / 3</span>
          <strong>{score} попаданий</strong>
        </div>
        <div className="practice-dots" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <i className={i < round ? "is-filled" : ""} key={i} />
          ))}
        </div>
        <h3>
          {phase === "finished"
            ? score >= 2
              ? "Вот это мастерство!"
              : "Хорошая тренировка!"
            : kind === "timing"
              ? calm
                ? "Нажми зелёную плитку"
                : "Поймай зелёную зону"
              : phase === "showing"
                ? "Смотри и запоминай"
                : phase === "playing"
                  ? "Теперь твоя очередь"
                  : "Четыре плитки. Один узор."}
        </h3>
        {kind === "timing" ? (
          calm ? (
            <div className="calm-targets">
              {[0, 1, 2, 3, 4].map((i) => (
                <button
                  key={i}
                  className={i === 2 ? "target-good" : ""}
                  disabled={phase !== "playing"}
                  onClick={() => finishAttempt(i === 2)}
                  aria-label={
                    i === 2 ? "Зелёная плитка, цель" : `Плитка ${i + 1}`
                  }
                >
                  {i === 2 ? "●" : "·"}
                </button>
              ))}
            </div>
          ) : (
            <div
              className="timing-track"
              role="img"
              aria-label="Зелёная зона в середине шкалы"
            >
              <div className="timing-zone" />
              <span
                key={`${round}-${phase === "playing"}`}
                className={`timing-marker ${phase === "playing" ? "is-moving" : ""}`}
                style={
                  { "--marker-position": `${position * 100}%` } as CSSProperties
                }
              />
            </div>
          )
        ) : (
          <>
            <div className="memory-grid">
              {[0, 1, 2, 3].map((i) => (
                <button
                  key={i}
                  className={`memory-tile memory-${i} ${lit === i ? "is-lit" : ""}`}
                  onClick={() => choose(i)}
                  disabled={phase !== "playing"}
                  aria-label={`Плитка ${i + 1}`}
                >
                  <span>{["●", "◆", "▲", "★"][i]}</span>
                </button>
              ))}
            </div>
            <p className="memory-entered" aria-live="polite">
              {phase === "showing"
                ? "Запомни порядок"
                : phase === "playing"
                  ? `Введено ${entered} из 4`
                  : ""}
            </p>
          </>
        )}
        <p className="practice-message" role="status">
          {message ||
            (kind === "timing"
              ? "Два попадания из трёх — победа."
              : "Две верные последовательности из трёх — победа.")}
        </p>
        {phase === "ready" && (
          <button
            className="tap-primary"
            onClick={(event) => begin(event.timeStamp)}
          >
            {round ? "Попробовать снова" : "Начать"}
          </button>
        )}
        {phase === "playing" && kind === "timing" && !calm && (
          <button
            className="tap-primary"
            onClick={(event) => stop(event.timeStamp)}
          >
            Стоп!
          </button>
        )}
        {phase === "feedback" && (
          <button
            className="tap-primary"
            onClick={(event) => begin(event.timeStamp)}
          >
            Следующий раунд
          </button>
        )}
        {phase === "finished" && (
          <>
            <div className="practice-reward">
              +{score >= 2 ? 40 : 10} XP{score >= 2 ? " и 25 монет" : ""}
            </div>
            <button className="tap-primary" onClick={onClose}>
              Отлично
            </button>
          </>
        )}
        <p className="arcade-footnote">
          {calm && kind === "timing"
            ? "Спокойный режим без движущегося бегунка. "
            : ""}
          За завершение — опыт. Ошибки не отнимают монеты.
        </p>
      </section>
    </div>
  );
}
