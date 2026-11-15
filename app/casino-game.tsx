"use client";
import { TapIcon } from "./tap-icon";
import { useEffect, useRef, useState } from "react";
import {
  ARCADE_GAMES,
  TOWER_MULTIPLIERS,
  casinoBet,
  casinoPayout,
  flipCoin,
  rollDice,
  towerPick,
  type CasinoKind,
  type CasinoRound,
} from "./arcade-engine";
import { ArcadeArt } from "./arcade-art";
import { useGameDialog } from "./use-game-dialog";

export function CasinoGame({
  kind,
  balance,
  onStart,
  onResolve,
  onClose,
  onTick,
}: {
  kind: CasinoKind;
  balance: number;
  onStart: (kind: CasinoKind, requested: number) => CasinoRound | null;
  onResolve: (id: number, payout: number, won: boolean) => void;
  onClose: () => void;
  onTick: () => void;
}) {
  const [phase, setPhase] = useState<
    "ready" | "rolling" | "climbing" | "safe" | "result"
  >("ready");
  const [lockedBet, setLockedBet] = useState<number | null>(null);
  const [requested, setRequested] = useState(
    Math.max(1, Math.min(100, Math.floor(balance * 0.1))),
  );
  const [choice, setChoice] = useState(0),
    [face, setFace] = useState<number | null>(null),
    [floor, setFloor] = useState(0),
    [danger, setDanger] = useState(-1),
    [picked, setPicked] = useState(-1),
    [paid, setPaid] = useState(0),
    [won, setWon] = useState(false);
  const roundRef = useRef<CasinoRound | null>(null),
    busyRef = useRef(false),
    settledRef = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canClose = phase === "ready" || phase === "result";
  const ref = useGameDialog(onClose, canClose);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const game = ARCADE_GAMES.find((g) => g.id === kind)!;
  const bet = lockedBet ?? casinoBet(balance, requested);
  const commit = () => {
    if (roundRef.current) return roundRef.current;
    const round = onStart(kind, bet);
    if (round) {
      roundRef.current = round;
      setLockedBet(round.bet);
    }
    return round;
  };
  const settle = (payout: number, win: boolean) => {
    if (!roundRef.current || settledRef.current) return;
    settledRef.current = true;
    setPaid(payout);
    setWon(win);
    setPhase("result");
    onResolve(roundRef.current.id, payout, win);
  };
  const roll = () => {
    if (busyRef.current || phase !== "ready") return;
    const round = commit();
    if (!round) return;
    busyRef.current = true;
    setPhase("rolling");
    onTick();
    const outcome = kind === "coin" ? flipCoin(choice) : rollDice(choice);
    timer.current = setTimeout(() => {
      setFace(outcome.face);
      settle(outcome.won ? casinoPayout(round.bet, 1.9) : 0, outcome.won);
    }, 850);
  };
  const pick = (tile: number) => {
    if (busyRef.current || (phase !== "ready" && phase !== "climbing")) return;
    const round = commit();
    if (!round) return;
    busyRef.current = true;
    const outcome = towerPick(tile);
    setDanger(outcome.danger);
    setPicked(tile);
    onTick();
    if (!outcome.safe) {
      settle(0, false);
      return;
    }
    const next = floor + 1;
    setFloor(next);
    if (next === 5) {
      settle(casinoPayout(round.bet, TOWER_MULTIPLIERS[4]), true);
      return;
    }
    setPhase("safe");
  };
  return (
    <div className="tap-overlay">
      <section
        className={`tap-screen casino-screen tone-${game.color}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="casino-title"
        ref={ref}
        tabIndex={-1}
      >
        <header className="tap-screen-heading">
          <div>
            <span className="tap-eyebrow">На удачу · игровые монеты</span>
            <h2 id="casino-title">{game.title}</h2>
          </div>
          {canClose && (
            <button
              className="tap-icon-button"
              onClick={onClose}
              aria-label="Закрыть игру"
            >
              <TapIcon kind="close" />
            </button>
          )}
        </header>
        <div className="casino-balances">
          <span>
            Ставка <b>{bet.toLocaleString("ru-RU")}</b>
          </span>
          <span>
            Активные монеты <b>{balance.toLocaleString("ru-RU")}</b>
          </span>
        </div>
        {phase === "ready" && (
          <label className="casino-bet">
            Размер ставки
            <input
              type="number"
              min="1"
              max={balance}
              value={requested}
              inputMode="numeric"
              onChange={(e) => setRequested(Number(e.target.value))}
            />
            <div className="casino-bet-presets">
              {[0.1, 0.25, 0.5].map((p) => (
                <button
                  key={p}
                  onClick={() =>
                    setRequested(Math.max(1, Math.floor(balance * p)))
                  }
                >
                  {p * 100}%
                </button>
              ))}
            </div>
          </label>
        )}
        {kind === "tower" ? (
          <>
            <div
              className="tower-levels"
              aria-label={`Пройдено этажей ${floor} из 5`}
            >
              {TOWER_MULTIPLIERS.map((m, i) => (
                <span
                  key={m}
                  className={
                    i < floor ? "is-complete" : i === floor ? "is-current" : ""
                  }
                >
                  <small>{i + 1}</small>×{m}
                </span>
              ))}
            </div>
            <h3>
              {phase === "result"
                ? won
                  ? "Башня пройдена"
                  : "Ловушка"
                : phase === "safe"
                  ? "Этаж пройден"
                  : `Выбери плитку · этаж ${floor + 1}`}
            </h3>
            <div className="tower-tiles">
              {[0, 1, 2].map((i) => (
                <button
                  key={i}
                  disabled={phase !== "ready" && phase !== "climbing"}
                  className={
                    picked === i ? (i === danger ? "is-danger" : "is-safe") : ""
                  }
                  onClick={() => pick(i)}
                  aria-label={`Плитка ${i + 1}`}
                >
                  {picked === i ? (i === danger ? "×" : "◆") : "?"}
                </button>
              ))}
            </div>
            {phase === "safe" && (
              <div className="tower-actions">
                <button
                  className="tap-primary"
                  onClick={() =>
                    settle(
                      casinoPayout(bet, TOWER_MULTIPLIERS[floor - 1]),
                      true,
                    )
                  }
                >
                  Забрать{" "}
                  {casinoPayout(
                    bet,
                    TOWER_MULTIPLIERS[floor - 1],
                  ).toLocaleString("ru-RU")}
                </button>
                <button
                  className="tap-secondary"
                  onClick={() => {
                    busyRef.current = false;
                    setDanger(-1);
                    setPicked(-1);
                    setPhase("climbing");
                  }}
                >
                  Выше · ×{TOWER_MULTIPLIERS[floor]}
                </button>
              </div>
            )}
            <p className="arcade-footnote">
              На каждом этаже две безопасные плитки из трёх. После успеха можно
              забрать выплату.
            </p>
          </>
        ) : (
          <>
            <div
              className={`casino-object ${phase === "rolling" ? "is-rolling" : ""}`}
            >
              {face === null ? (
                <ArcadeArt kind={kind} />
              ) : (
                <span
                  className={`casino-face ${kind === "coin" ? "coin-face" : "dice-face"}`}
                >
                  {kind === "coin" ? (face === 0 ? "☀" : "☾") : face}
                </span>
              )}
            </div>
            {phase === "ready" && (
              <div
                className="casino-choices"
                role="group"
                aria-label="Твой прогноз"
              >
                {(kind === "coin" ? ["Солнце", "Луна"] : ["1–3", "4–6"]).map(
                  (label, i) => (
                    <button
                      aria-pressed={choice === i}
                      key={label}
                      onClick={() => setChoice(i)}
                    >
                      {label}
                    </button>
                  ),
                )}
              </div>
            )}
            {phase === "ready" && (
              <button className="tap-primary" onClick={roll} disabled={bet < 1}>
                Играть · {bet.toLocaleString("ru-RU")} монет
              </button>
            )}
            {phase === "rolling" && (
              <p className="casino-rolling" role="status">
                {kind === "coin" ? "Монетка в воздухе…" : "Кубик брошен…"}
              </p>
            )}
            <p className="arcade-footnote">
              Шанс 50% · выплата ×1,9 включает ставку
            </p>
          </>
        )}
        {phase === "result" && (
          <div
            className={`casino-result ${won ? "is-win" : "is-loss"}`}
            role="status"
          >
            <h3>{won ? "Выигрыш" : "Проигрыш"}</h3>
            <strong>
              {paid
                ? `Выплата ${paid.toLocaleString("ru-RU")}`
                : `−${bet.toLocaleString("ru-RU")} монет`}
            </strong>
            <span>+10 XP за завершённую игру</span>
            <button className="tap-primary" onClick={onClose}>
              Вернуться в игры
            </button>
          </div>
        )}
        <details className="casino-rules">
          <summary>Правила и выплаты</summary>
          <p>{game.rules}</p>
          <p>
            Ставка списывается один раз. Сейф не участвует. До завершения раунда
            закрытие недоступно; в башне сначала забери выплату.
          </p>
        </details>
      </section>
    </div>
  );
}
