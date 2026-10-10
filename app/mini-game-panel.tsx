"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  MINE_MULTIPLIERS,
  SLOT_SYMBOL_LABELS,
  createMinePickOutcome,
  createSlotOutcome,
  minePayout,
  type SlotOutcome,
  type SlotSymbol,
} from "./mini-game-engine";

export type MiniGameKind = "slots" | "mines";
export type MiniGameStats = {
  slotPlays: number;
  slotWins: number;
  minePlays: number;
  mineWins: number;
  mineLosses: number;
};

type MiniGamePanelProps = {
  kind: MiniGameKind;
  balance: number;
  difficulty: number;
  canChooseBet: boolean;
  stats: MiniGameStats;
  onCommitBet: (kind: MiniGameKind, bet: number) => boolean;
  onResolve: (kind: MiniGameKind, payout: number, won: boolean) => void;
  onClose: () => void;
  onTick: () => void;
};

type MineTile = "hidden" | "safe" | "mine";

const SLOT_GLYPHS: Record<SlotSymbol, string> = {
  cherry: "●●",
  lemon: "●",
  seven: "7",
  star: "★",
  diamond: "◆",
};

const INITIAL_REELS: [SlotSymbol, SlotSymbol, SlotSymbol] = [
  "cherry",
  "lemon",
  "seven",
];

const SLOT_FACE_ORDER: readonly SlotSymbol[] = [
  "cherry",
  "lemon",
  "seven",
  "star",
  "diamond",
];

const INITIAL_REEL_ANGLES = INITIAL_REELS.map(
  (symbol) => -SLOT_FACE_ORDER.indexOf(symbol) * 72,
) as [number, number, number];

export function MiniGamePanel({
  kind,
  balance,
  difficulty,
  canChooseBet,
  stats,
  onCommitBet,
  onResolve,
  onClose,
  onTick,
}: MiniGamePanelProps) {
  const [sessionDifficulty] = useState(difficulty);
  const [bet, setBet] = useState(Math.max(1, balance));
  const [lockedBet, setLockedBet] = useState<number | null>(null);
  const [slotPhase, setSlotPhase] = useState<"ready" | "spinning" | "result">("ready");
  const [slotReels, setSlotReels] = useState(INITIAL_REELS);
  const [reelAngles, setReelAngles] = useState(INITIAL_REEL_ANGLES);
  const [slotOutcome, setSlotOutcome] = useState<SlotOutcome | null>(null);
  const [minePhase, setMinePhase] = useState<"ready" | "playing" | "safe" | "lost" | "cashed">("ready");
  const [mineRound, setMineRound] = useState(0);
  const [previousMineIndex, setPreviousMineIndex] = useState<number | null>(null);
  const [mineTiles, setMineTiles] = useState<MineTile[]>(
    () => Array.from({ length: 5 }, () => "hidden"),
  );
  const committedRef = useRef(false);
  const resolvedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (intervalRef.current) clearInterval(intervalRef.current);
  }, []);

  const selectedBet = Math.min(balance, Math.max(1, Math.floor(bet)));
  const safeBet = lockedBet ?? selectedBet;
  const mineCurrentPayout = minePayout(safeBet, mineRound);
  const mineNextMultiplier = MINE_MULTIPLIERS[Math.min(mineRound, MINE_MULTIPLIERS.length - 1)];

  const commit = () => {
    if (committedRef.current) return true;
    if (!onCommitBet(kind, selectedBet)) return false;
    setLockedBet(selectedBet);
    committedRef.current = true;
    return true;
  };

  const resolve = (payout: number, won: boolean) => {
    if (resolvedRef.current) return;
    resolvedRef.current = true;
    onResolve(kind, payout, won);
  };

  const spinSlots = () => {
    if (slotPhase !== "ready" || !commit()) return;
    const outcome = createSlotOutcome(safeBet, sessionDifficulty);
    setSlotOutcome(null);
    setSlotPhase("spinning");
    setReelAngles(outcome.reels.map((symbol, index) => (
      -SLOT_FACE_ORDER.indexOf(symbol) * 72 - (7 + index * 2) * 360
    )) as [number, number, number]);
    intervalRef.current = setInterval(() => {
      onTick();
    }, 120);
    timerRef.current = setTimeout(() => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
      setSlotReels(outcome.reels);
      setSlotOutcome(outcome);
      setSlotPhase("result");
      resolve(outcome.payout, outcome.payout > 0);
    }, 2_650);
  };

  const chooseMineTile = (selectedIndex: number) => {
    if (minePhase !== "ready" && minePhase !== "playing") return;
    if (!commit()) return;
    const outcome = createMinePickOutcome(
      selectedIndex,
      sessionDifficulty,
      Math.random,
      previousMineIndex,
    );
    const tiles: MineTile[] = Array.from({ length: 5 }, () => "hidden");
    tiles[outcome.mineIndex] = "mine";
    setPreviousMineIndex(outcome.mineIndex);
    if (outcome.safe) tiles[selectedIndex] = "safe";
    setMineTiles(tiles);
    onTick();

    if (!outcome.safe) {
      setMinePhase("lost");
      resolve(0, false);
      return;
    }

    const completedRounds = mineRound + 1;
    setMineRound(completedRounds);
    if (completedRounds >= MINE_MULTIPLIERS.length) {
      const payout = minePayout(safeBet, completedRounds);
      setMinePhase("cashed");
      resolve(payout, true);
      return;
    }
    setMinePhase("safe");
  };

  const continueMines = () => {
    if (minePhase !== "safe") return;
    setMineTiles(Array.from({ length: 5 }, () => "hidden"));
    setMinePhase("playing");
  };

  const cashOutMines = () => {
    if (minePhase !== "safe" || mineRound < 1) return;
    setMinePhase("cashed");
    resolve(mineCurrentPayout, true);
  };

  const finished = slotPhase === "result" || minePhase === "lost" || minePhase === "cashed";
  const canClose = !committedRef.current || finished;

  return (
    <div className={`mini-game-backdrop mini-${kind}`}>
      <section className="mini-game-panel" role="dialog" aria-modal="true" aria-labelledby="mini-game-title">
        <div className="mini-game-topline">
          <span className={`drink-icon ${kind === "slots" ? "drink-cola" : "drink-tea"}`} aria-hidden="true"><i /></span>
          <div>
            <small>{kind === "slots" ? "КАКАО-КОЛА" : "ЧАЙ С БЕРГАМОТОМ"}</small>
            <h2 id="mini-game-title">{kind === "slots" ? "Три барабана" : "Пять кнопок"}</h2>
          </div>
          {canClose && <button className="mini-close" type="button" aria-label="Закрыть мини-игру" onClick={onClose}>×</button>}
        </div>

        <div className="mini-bet-card">
          <span><small>СТАВКА</small><strong>{safeBet.toLocaleString("ru-RU")}</strong></span>
          <span><small>АКТИВНЫЙ БАЛАНС</small><strong>{balance.toLocaleString("ru-RU")}</strong></span>
        </div>

        {canChooseBet && !committedRef.current && (
          <div className="mini-bet-control">
            <input
              type="range"
              min="1"
              max={Math.max(1, balance)}
              value={safeBet}
              aria-label="Размер ставки"
              onChange={(event) => setBet(Number(event.currentTarget.value))}
            />
            <button type="button" onClick={() => setBet(balance)}>Весь баланс</button>
          </div>
        )}

        {kind === "slots" ? (
          <>
            <div className={`slot-machine ${slotPhase === "spinning" ? "is-spinning" : ""} ${slotPhase === "result" && slotOutcome?.payout ? "is-winner" : ""}`} aria-label={`Барабаны: ${slotReels.map((symbol) => SLOT_SYMBOL_LABELS[symbol]).join(", ")}`}>
              <div className="slot-payline" aria-hidden="true" />
              {reelAngles.map((angle, reelIndex) => (
                <div className="slot-reel-window" key={reelIndex}>
                  <div className="slot-reel-perspective">
                    <div
                      className="slot-reel-rotor"
                      style={{
                        "--reel-angle": `${angle}deg`,
                        "--reel-duration": `${1.7 + reelIndex * 0.42}s`,
                      } as CSSProperties}
                    >
                      {SLOT_FACE_ORDER.map((symbol, faceIndex) => (
                        <div
                          className={`slot-reel-face symbol-${symbol}`}
                          style={{ "--face-angle": `${faceIndex * 72}deg` } as CSSProperties}
                          key={symbol}
                        >
                          <span>{SLOT_GLYPHS[symbol]}</span>
                          <small>{SLOT_SYMBOL_LABELS[symbol]}</small>
                        </div>
                      ))}
                    </div>
                  </div>
                  <span className="slot-reel-glass" aria-hidden="true" />
                </div>
              ))}
            </div>
            {slotOutcome && (
              <div className={`mini-result ${slotOutcome.payout > 0 ? "is-win" : "is-loss"}`} role="status">
                <small>{slotOutcome.payout > 0 ? `ВЫИГРЫШ ×${slotOutcome.multiplier}` : "КОМБИНАЦИИ НЕТ"}</small>
                <strong>{slotOutcome.payout > 0 ? `+${slotOutcome.payout.toLocaleString("ru-RU")}` : `−${safeBet.toLocaleString("ru-RU")}`}</strong>
              </div>
            )}
            {slotPhase === "ready" && <button className="mini-primary" type="button" onClick={spinSlots}>Крутить барабаны</button>}
            {slotPhase === "spinning" && <button className="mini-primary" type="button" disabled>Вращение…</button>}
            {slotPhase === "result" && <button className="mini-primary" type="button" onClick={onClose}>Вернуться к Кнопику</button>}
            <p className="mini-stats">ИГР {stats.slotPlays} · ПОБЕД {stats.slotWins}</p>
          </>
        ) : (
          <>
            <div className={`mine-progress phase-${minePhase}`}>
              <span><small>ПРОЙДЕНО</small><strong>{mineRound}</strong></span>
              <span><small>СЕЙЧАС</small><strong>×{mineRound ? MINE_MULTIPLIERS[mineRound - 1] : "1.00"}</strong></span>
              <span><small>ДАЛЬШЕ</small><strong>×{mineNextMultiplier}</strong></span>
            </div>
            <div className="mine-round-track" aria-label={`Пройдено раундов: ${mineRound} из ${MINE_MULTIPLIERS.length}`}>
              {MINE_MULTIPLIERS.map((_, index) => (
                <i className={index < mineRound ? "is-complete" : index === mineRound ? "is-current" : ""} key={index} />
              ))}
            </div>
            <div className={`mine-grid phase-${minePhase}`} aria-label="Пять закрытых кнопок">
              {mineTiles.map((tile, index) => (
                <button
                  className={`mine-tile is-${tile}`}
                  type="button"
                  key={index}
                  disabled={minePhase === "safe" || minePhase === "lost" || minePhase === "cashed"}
                  aria-label={tile === "hidden" ? `Кнопка ${index + 1}` : tile === "safe" ? "Безопасно" : "Мина"}
                  onClick={() => chooseMineTile(index)}
                >
                  <span>{tile === "hidden" ? index + 1 : tile === "safe" ? "✓" : "✹"}</span>
                  <small>{tile === "hidden" ? "ВЫБРАТЬ" : tile === "safe" ? "ЧИСТО" : "МИНА"}</small>
                </button>
              ))}
            </div>
            {minePhase === "ready" && <p className="mine-hint">Выбери одну кнопку. Четыре безопасны, под одной спрятана мина.</p>}
            {minePhase === "safe" && (
              <div className="mine-actions">
                <button type="button" onClick={cashOutMines}>Забрать {mineCurrentPayout.toLocaleString("ru-RU")}</button>
                <button type="button" onClick={continueMines}>Идти дальше</button>
              </div>
            )}
            {minePhase === "lost" && <div className="mini-result is-loss"><small>МИНА</small><strong>−{safeBet.toLocaleString("ru-RU")}</strong></div>}
            {minePhase === "cashed" && <div className="mini-result is-win"><small>МОНЕТЫ ЗАБРАНЫ</small><strong>+{mineCurrentPayout.toLocaleString("ru-RU")}</strong></div>}
            {(minePhase === "lost" || minePhase === "cashed") && <button className="mini-primary" type="button" onClick={onClose}>Вернуться к Кнопику</button>}
            <p className="mini-stats">ИГР {stats.minePlays} · ВЫВОДОВ {stats.mineWins} · МИН {stats.mineLosses}</p>
          </>
        )}
      </section>
    </div>
  );
}
