"use client";
import { useState } from "react";
import { TapIcon } from "./tap-icon";
import {
  ADVENTURE_STEPS,
  CHAPTERS,
  adventureLevel,
  stepProgress,
  type AdventureProgress,
} from "./adventure-engine";
import { useGameDialog } from "./use-game-dialog";
import type { PracticeKind } from "./arcade-engine";

export function AdventurePath({
  progress,
  totalTaps,
  vaultCoins,
  rewardBlocked,
  onClaim,
  onAction,
  onClose,
}: {
  progress: AdventureProgress;
  totalTaps: number;
  vaultCoins: number;
  rewardBlocked: boolean;
  onClaim: () => void;
  onAction: (action: "tap" | "vault" | PracticeKind) => void;
  onClose: () => void;
}) {
  const [chapter, setChapter] = useState(
    Math.min(3, Math.floor(progress.claimedSteps / 6)),
  );
  const ref = useGameDialog(onClose);
  const level = adventureLevel(progress.xp);
  const current = ADVENTURE_STEPS[progress.claimedSteps];
  const amount = stepProgress(progress, { totalTaps, vaultCoins });
  const ready = !!current && amount >= current.target;
  return (
    <div className="tap-overlay">
      <section
        className="tap-screen journey-screen"
        role="dialog"
        aria-modal="true"
        aria-labelledby="journey-title"
        ref={ref}
        tabIndex={-1}
      >
        <header className="tap-screen-heading">
          <div>
            <span className="tap-eyebrow">24 этапа · 4 главы</span>
            <h2 id="journey-title">Путь Кнопика</h2>
          </div>
          <button
            className="tap-icon-button"
            onClick={onClose}
            aria-label="Закрыть путь"
          >
            <TapIcon kind="close" />
          </button>
        </header>
        <div className="journey-summary">
          <span className="journey-level">
            <TapIcon kind="xp" />
            <b>{level.level}</b>
          </span>
          <div>
            <strong>Уровень {level.level} из 30</strong>
            <p>
              {progress.xp.toLocaleString("ru-RU")} XP · {progress.claimedSteps}
              /24 этапа
            </p>
            <progress
              max="1"
              value={level.ratio}
              aria-label="Опыт до следующего уровня"
            />
          </div>
        </div>
        <details className="journey-xp-help">
          <summary>Как начисляется опыт</summary>
          <p>
            Обычный тап — 1 XP. Завершённая игра — 10 XP, победа в испытании —
            40 XP. Опыт не тратится вместе с монетами.
          </p>
        </details>
        <div className="chapter-tabs" role="group" aria-label="Главы">
          {CHAPTERS.map((c, i) => (
            <button
              key={c.title}
              aria-pressed={chapter === i}
              onClick={() => setChapter(i)}
            >
              {i + 1}
              <span>{c.title}</span>
            </button>
          ))}
        </div>
        <div className={`chapter-banner tone-${CHAPTERS[chapter].color}`}>
          <span>Глава {chapter + 1}</span>
          <h3>{CHAPTERS[chapter].title}</h3>
        </div>
        <ol className="journey-nodes" start={chapter * 6 + 1}>
          {ADVENTURE_STEPS.slice(chapter * 6, chapter * 6 + 6).map((s, i) => {
            const index = chapter * 6 + i,
              done = index < progress.claimedSteps,
              active = index === progress.claimedSteps;
            return (
              <li
                key={index}
                className={`${done ? "is-done" : active ? "is-current" : "is-locked"} ${i % 2 ? "node-right" : "node-left"}`}
                aria-current={active ? "step" : undefined}
              >
                <span className="journey-node">
                  <TapIcon
                    kind={
                      !done && !active
                        ? "lock"
                        : s.action === "vault"
                          ? "safe"
                          : done
                            ? (index + 1) % 6 === 0
                              ? "chest"
                              : "star"
                            : (index + 1) % 6 === 0
                              ? "chest"
                              : s.action === "memory"
                                ? "book"
                                : s.action === "timing"
                                  ? "energy"
                                  : "tap"
                    }
                  />
                </span>
                <div>
                  <strong>
                    <span className="journey-step-number">{index + 1}.</span>{" "}
                    {s.title}
                  </strong>
                  <small>
                    {done
                      ? "Пройдено"
                      : active
                        ? `${amount.toLocaleString("ru-RU")} / ${s.target.toLocaleString("ru-RU")}`
                        : "Следующий этап"}{" "}
                    · +{s.xp} XP
                  </small>
                </div>
              </li>
            );
          })}
        </ol>
        <div className="journey-current" aria-live="polite">
          {current ? (
            <>
              <span className="tap-eyebrow">
                Этап · {progress.claimedSteps + 1}/24
              </span>
              <h3>{current.title}</h3>
              <p>
                Награда: {current.coins} монет и {current.xp} XP
                {(progress.claimedSteps + 1) % 6 === 0
                  ? " + кейс за главу"
                  : ""}
                .
              </p>
              <progress
                value={amount}
                max={current.target}
                aria-label={current.title}
              />
              {ready ? (
                <button
                  className="tap-primary"
                  onClick={() => {
                    onClaim();
                    if ((progress.claimedSteps + 1) % 6 === 0) {
                      setChapter(
                        Math.min(
                          3,
                          Math.floor((progress.claimedSteps + 1) / 6),
                        ),
                      );
                    }
                  }}
                  disabled={rewardBlocked}
                >
                  {rewardBlocked
                    ? "Сначала освободи место для кейса"
                    : "Забрать награду"}
                </button>
              ) : (
                <button
                  className="tap-primary"
                  onClick={() => onAction(current.action)}
                >
                  {current.action === "tap"
                    ? "К Кнопику"
                    : current.action === "vault"
                      ? "Пополнить сейф"
                      : "Пройти испытание"}
                </button>
              )}
            </>
          ) : (
            <>
              <h3>Все этапы пройдены</h3>
              <button className="tap-primary" onClick={onClose}>
                К Кнопику
              </button>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
