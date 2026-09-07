'use client';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { commitBet, settleBet, type Game, type ItemId } from './arcade-engine';
import { createRiskOutcome, riskPointerRotation, riskMultiplier, type RiskChance } from './risk-engine';
import { createMinePickOutcome, createSlotOutcome, minePayout, MINE_MULTIPLIERS } from './mini-game-engine';
import { Icon, number } from './arcade-ui';

export type ArcadeKind = 'risk' | 'slots' | 'mines';
export type ChangeGame = (change: (game: Game) => Game) => Game;
const accessItem: Record<ArcadeKind, ItemId> = { risk: 'pitbullCount', slots: 'colaCount', mines: 'teaCount' };
const titles = { risk: 'Колесо риска', slots: 'Три барабана', mines: 'Пять кнопок' };
const symbols: Record<string, string> = { cherry: '●●', lemon: '●', seven: '7', star: '★', diamond: '◆' };
export function ArcadeGames({ kind, game, change, difficulty, onClose }: { kind: ArcadeKind; game: Game; change: ChangeGame; difficulty: number; onClose: () => void }) {
  const [bet, setBet] = useState(Math.max(1, Math.min(100, game.save.walletCoins)));
  const [chance, setChance] = useState<RiskChance>(50);
  const [phase, setPhase] = useState<'ready' | 'spinning' | 'result'>('ready');
  const [result, setResult] = useState('');
  const [angle, setAngle] = useState(0);
  const [reels, setReels] = useState(['7', '★', '◆']);
  const [tiles, setTiles] = useState<string[]>(Array(5).fill('hidden'));
  const [cooldown, setCooldown] = useState(false);
  const lock = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const mine = game.save.arcadeMine;
  const safeBet = Math.min(game.save.walletCoins, Math.max(1, Math.floor(bet) || 1));
  function start(g: Game): Game {
    const item = accessItem[kind];
    if (!g.save[item] || safeBet < 1 || safeBet > g.save.walletCoins || g.save.arcadeMine) return g;
    const next = commitBet(g, safeBet);
    return { ...next, save: { ...next.save, [item]: next.save[item] - 1 } };
  }
  function spin() {
    if (lock.current || phase !== 'ready') return;
    lock.current = true;
    let played = false;
    let payout = 0;
    let message = '';
    change(g => {
      const next = start(g); if (next === g) return g;
      played = true;
      // Settle before the reveal: closing or reloading never loses a won payout.
      if (kind === 'risk') {
        const outcome = createRiskOutcome(chance, safeBet, Math.random, difficulty);
        setAngle(riskPointerRotation(chance, outcome.finalAngle));
        payout = outcome.payout; message = outcome.won ? `Выигрыш ${number(payout)}` : 'В этот раз без выигрыша';
        setResult(message);
        return { ...settleBet(next, kind, payout, outcome.won), event: next.event, message: '', effect: 'none', reward: 0 };
      }
      const outcome = createSlotOutcome(safeBet, difficulty);
      setReels(outcome.reels.map(s => symbols[s]));
      payout = outcome.payout; message = payout ? `Выигрыш ${number(payout)}` : 'В этот раз без выигрыша';
      setResult(message);
      return { ...settleBet(next, 'slots', payout, payout > 0), event: next.event, message: '', effect: 'none', reward: 0 };
    });
    if (!played) { lock.current = false; return; }
    setPhase('spinning');
    timer.current = setTimeout(() => {
      setPhase('result'); lock.current = false;
      change(g => ({ ...g, event: g.event + 1, message, effect: payout ? 'reward' : 'none', reward: payout }));
    }, matchMedia('(prefers-reduced-motion: reduce)').matches ? 100 : 2400);
  }
  function pick(index: number) {
    if (lock.current || phase === 'result') return;
    lock.current = true;
    setCooldown(true);
    change(g => {
      let next = g;
      if (!next.save.arcadeMine) {
        next = start(next); if (next === g) return g;
        next = { ...next, save: { ...next.save, arcadeMine: { bet: safeBet, round: 0, previous: null } } };
      }
      const active = next.save.arcadeMine!;
      const outcome = createMinePickOutcome(index, difficulty, Math.random, active.previous);
      const faces = Array(5).fill('hidden'); faces[outcome.mineIndex] = 'mine';
      if (outcome.safe) faces[index] = 'safe'; setTiles(faces);
      if (!outcome.safe) {
        setPhase('result'); setResult('Мина. Монеты в сейфе остались целы.');
        return settleBet({ ...next, save: { ...next.save, arcadeMine: undefined } }, 'mines', 0, false);
      }
      const round = active.round + 1;
      if (round === MINE_MULTIPLIERS.length) {
        const payout = minePayout(active.bet, round); setPhase('result'); setResult(`Выигрыш ${number(payout)}`);
        return settleBet({ ...next, save: { ...next.save, arcadeMine: undefined } }, 'mines', payout, true);
      }
      return { ...next, save: { ...next.save, arcadeMine: { bet: active.bet, round, previous: outcome.mineIndex } } };
    });
    timer.current = setTimeout(() => { setTiles(Array(5).fill('hidden')); lock.current = false; setCooldown(false); }, 500);
  }
  function cashOut() {
    if (lock.current || !mine) return;
    change(g => {
      const active = g.save.arcadeMine; if (!active) return g;
      const payout = minePayout(active.bet, active.round);
      setResult(`Забрано ${number(payout)}`); setPhase('result');
      return settleBet({ ...g, save: { ...g.save, arcadeMine: undefined } }, 'mines', payout, true);
    });
  }
  const canStart = game.save[accessItem[kind]] > 0 && safeBet > 0 && !game.save.arcadeMine;
  return <section className="minigame-surface" aria-labelledby="arcade-title">
    <div className="section-heading"><div><span className="eyebrow">Игротека</span><h2 id="arcade-title">{titles[kind]}</h2></div><button className="icon-button" aria-label="Вернуться к Кнопику" onClick={onClose}><Icon name="close" /></button></div>
    <p className="muted">В игре участвуют только монеты из кошелька. Сейф защищён.</p>
    {phase === 'ready' && !mine && <div className="bet-controls"><label>Ставка<input type="number" min="1" max={game.save.walletCoins || 1} value={bet} onChange={e => setBet(Number(e.target.value))} /></label><button className="secondary" onClick={() => setBet(game.save.walletCoins)} disabled={!game.save.walletCoins}>Весь кошелёк</button></div>}
    {kind === 'risk' && <><div className="risk-dial" style={{ '--sector': `${chance * 3.6}deg` } as CSSProperties}><div className={`dial-hand ${phase !== 'ready' ? 'has-spun' : ''}`} style={{ transform: `rotate(${angle}deg)` }} /><span>×{riskMultiplier(chance)}<small>множитель</small></span></div><label className="chance-control">Сектор выигрыша · {chance}%<input type="range" min="10" max="90" step="10" value={chance} disabled={phase !== 'ready'} onChange={e => setChance(Number(e.target.value) as RiskChance)} /></label></>}
    {kind === 'slots' && <div className={`arcade-reels ${phase === 'spinning' ? 'spinning' : ''}`} aria-label={phase === 'spinning' ? 'Барабаны вращаются' : reels.join(', ')}>{reels.map((s, i) => <span key={i}>{phase === 'spinning' ? ['7', '◆', '★'][i] : s}</span>)}</div>}
    {kind === 'mines' && <><div className="mine-progress"><span>Шаг {mine?.round ?? 0} / 10</span><strong>×{MINE_MULTIPLIERS[Math.min(9, mine?.round ?? 0)]} дальше</strong></div><div className="mine-grid">{tiles.map((tile, i) => <button key={i} className={`mine-button tile-${tile}`} aria-label={`Кнопка ${i + 1}${tile === 'safe' ? ', безопасно' : tile === 'mine' ? ', мина' : ''}`} disabled={cooldown || phase === 'result' || (!mine && !canStart)} onClick={() => pick(i)}>{tile === 'safe' ? '✓' : tile === 'mine' ? '×' : i + 1}</button>)}</div>{mine && <button className="primary" disabled={cooldown} onClick={cashOut}>Забрать {number(minePayout(mine.bet, mine.round))} <Icon name="arrow" /></button>}<p className="muted">Выбери кнопку. После удачного шага забери монеты или рискни ещё. Незавершённая игра сохраняется.</p></>}
    {kind !== 'mines' && phase !== 'result' && <button className="primary" disabled={!canStart || phase === 'spinning'} onClick={spin}>{phase === 'spinning' ? 'Лови удачу…' : `Играть · ${number(safeBet)} монет`}<Icon name="play" /></button>}
    {!canStart && !mine && phase === 'ready' && <p className="inline-note">Нужны монеты в кошельке и напиток из магазина.</p>}
    <div role="status" className="game-result">{phase === 'result' ? result : ''}</div>
    {phase === 'result' && <button className="primary" onClick={onClose}>Вернуться к Кнопику<Icon name="arrow" /></button>}
  </section>;
}

