"use client";
import { TapIcon } from "./tap-icon";
import { useState } from "react";
import { ARCADE_GAMES, type ArcadeKind } from "./arcade-engine";
import { ArcadeArt } from "./arcade-art";
import { useGameDialog } from "./use-game-dialog";

type Props = {
  hidden: boolean;
  balance: number;
  claimedSteps: number;
  legacyUnavailable: string;
  tickets: { roulette: number; slots: number; mines: number };
  onPlay: (kind: ArcadeKind) => void;
  onClose: () => void;
  onJourney: () => void;
};
export function ArcadeLibrary({
  hidden,
  balance,
  claimedSteps,
  tickets,
  legacyUnavailable,
  onPlay,
  onClose,
  onJourney,
}: Props) {
  const [filter, setFilter] = useState<"all" | "skill" | "luck">("all");
  const [selected, setSelected] = useState<ArcadeKind | null>(null);
  const ref = useGameDialog(onClose);
  const game = ARCADE_GAMES.find((g) => g.id === selected);
  const locked = !!game && claimedSteps < game.unlock;
  const legacy =
    game?.id === "roulette" || game?.id === "slots" || game?.id === "mines"
      ? game.id
      : null;
  const entry =
    legacy && tickets[legacy] === 0 ? (legacy === "mines" ? 300 : 200) : 0;
  return (
    <div className="tap-overlay arcade-library-backdrop" hidden={hidden}>
      <section
        className="tap-screen arcade-library"
        role="dialog"
        aria-modal="true"
        aria-labelledby="arcade-title"
        ref={ref}
        tabIndex={-1}
      >
        <header className="tap-screen-heading">
          <div>
            <span className="tap-eyebrow">Клуб Кнопика</span>
            <h2 id="arcade-title">{game ? game.title : "Во что сыграем?"}</h2>
          </div>
          <button
            className="tap-icon-button"
            aria-label="Закрыть игры"
            onClick={onClose}
          >
            <TapIcon kind="close" />
          </button>
        </header>
        {game ? (
          <div className={`game-detail tone-${game.color}`}>
            <button
              className="tap-text-button"
              onClick={() => setSelected(null)}
            >
              ‹ Все игры
            </button>
            <div className="game-detail-art">
              <ArcadeArt kind={game.id} />
            </div>
            <span className="tap-tag">
              {game.category === "skill"
                ? "На навык · бесплатно"
                : "На удачу · игровые монеты"}
            </span>
            <h3>{game.subtitle}</h3>
            <p className="game-rules">{game.rules}</p>
            {legacy && (
              <p className="game-entry">
                Билеты из прежнего запаса: <b>{tickets[legacy]}</b> ·{" "}
                {entry ? `Вход ${entry} монет, затем ставка` : "Вход по билету"}
              </p>
            )}
            {locked ? (
              <>
                <p className="arcade-lock-copy">
                  Откроется после этапа {game.unlock}. Сейчас пройдено{" "}
                  {claimedSteps}.
                </p>
                <button className="tap-primary" onClick={onJourney}>
                  Открыть путь Кнопика
                </button>
              </>
            ) : (
              <>
                <button
                  className="tap-primary"
                  disabled={
                    (game.category === "luck" && balance <= entry) ||
                    (!!legacy && !!legacyUnavailable)
                  }
                  onClick={() => onPlay(game.id)}
                >
                  {game.category === "skill" ? "Начать игру" : "Выбрать ставку"}
                </button>
                {game.category === "luck" && balance <= entry && (
                  <p className="arcade-lock-copy">
                    Нужны монеты на вход и ставку. Их можно заработать с
                    Кнопиком или в играх на навык.
                  </p>
                )}
              </>
            )}
            {legacy && legacyUnavailable && (
              <p className="arcade-lock-copy">{legacyUnavailable}</p>
            )}
            <p className="arcade-footnote">
              {game.category === "skill"
                ? "Без ставки. Можно выйти в любой момент."
                : "Сейф не участвует. Выплата включает ставку. Монеты нельзя купить или вывести."}
            </p>
          </div>
        ) : (
          <>
            <div className="arcade-welcome">
              <p>
                Маленькая игра.
                <br />
                <strong>Большое настроение.</strong>
              </p>
              <span className="arcade-wallet">
                <TapIcon kind="coin" />
                {balance.toLocaleString("ru-RU")}
              </span>
            </div>
            <div
              className="arcade-filters"
              role="group"
              aria-label="Категории игр"
            >
              {(
                [
                  ["all", "Все игры"],
                  ["skill", "На навык"],
                  ["luck", "На удачу"],
                ] as const
              ).map(([id, title]) => (
                <button
                  key={id}
                  aria-pressed={filter === id}
                  onClick={() => setFilter(id)}
                >
                  {title}
                </button>
              ))}
            </div>
            <div className="arcade-grid">
              {ARCADE_GAMES.filter(
                (g) => filter === "all" || g.category === filter,
              ).map((g) => {
                const isLocked = claimedSteps < g.unlock;
                return (
                  <button
                    className={`arcade-card tone-${g.color} ${isLocked ? "is-locked" : ""}`}
                    key={g.id}
                    onClick={() => setSelected(g.id)}
                    aria-label={`${g.title}${isLocked ? `, откроется после этапа ${g.unlock}` : ""}`}
                  >
                    <div className="arcade-cover">
                      {g.badge && !isLocked && (
                        <span className="arcade-new">{g.badge}</span>
                      )}
                      <ArcadeArt kind={g.id} />
                      {isLocked && (
                        <span className="arcade-lock">Этап {g.unlock}</span>
                      )}
                    </div>
                    <strong>{g.title}</strong>
                    <span>{g.subtitle}</span>
                    <small>
                      {g.category === "skill" ? "Бесплатно · +XP" : "На удачу"}
                    </small>
                  </button>
                );
              })}
            </div>
            <p className="arcade-footnote">
              Игры на навык помогают пройти путь. Игры на удачу — по желанию.
            </p>
          </>
        )}
      </section>
    </div>
  );
}
