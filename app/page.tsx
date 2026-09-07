'use client';
import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { CloudAccountGate, type CloudGameSession } from './cloud-account';
import { advance, bank, buy, claimMission, equip, finishSuper, ITEMS, MISSIONS, mood, newGame, openCase, saveGame, startSuper, superLimit, tap, useItem as consumeItem, type Game, type ItemId } from './arcade-engine';
import { ArcadeEffects, type Effects } from './arcade-fx';
import { ArcadeGames, type ArcadeKind } from './arcade-games';
import { asset, Dialog, Icon, number, Portrait } from './arcade-ui';
import { KnopikSoundEngine } from './sound-engine';
import { levelMultiplier, levelThreshold, nextLevelThreshold } from './level-engine';
import type { CaseReward, CaseKind } from './case-engine';

type Tab = 'play' | 'shop' | 'cases' | 'profile';
const navigation = [{ id: 'play', title: 'Играть', icon: 'play' }, { id: 'shop', title: 'Магазин', icon: 'bag' }, { id: 'cases', title: 'Кейсы', icon: 'gift' }, { id: 'profile', title: 'Профиль', icon: 'user' }] as const;
const moodText = { neutral: 'Рад тебя видеть', happy: 'На одной волне', warning: 'Сбавь темп', angry: 'Кнопику нужна пауза' };

export default function Home() {
  useEffect(() => {
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
      void navigator.serviceWorker.register(asset('/sw.js'), { updateViaCache: 'none' }).then(registration => registration.update()).catch(() => {});
    }
  }, []);
  return <CloudAccountGate>{session => <Arcade key={session.gameKey} session={session} />}</CloudAccountGate>;
}

function Arcade({ session }: { session: CloudGameSession }) {
  const { saveProgress } = session;
  const [game, setGame] = useState(() => newGame(session.initialSave, Date.now()));
  const current = useRef(game);
  const [tab, setTab] = useState<Tab>('play');
  const [dialog, setDialog] = useState<'help' | 'settings' | null>(null);
  const [mini, setMini] = useState<ArcadeKind | null>(null);
  const [rewards, setRewards] = useState<CaseReward[] | null>(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [promo, setPromo] = useState('');
  const [promoAmount, setPromoAmount] = useState(1000);
  const [difficulty, setDifficulty] = useState(session.difficulty);
  const [swipe, setSwipe] = useState(0);
  const swipeStart = useRef<number | null>(null);
  const swipeConsumed = useRef(false);
  const [toast, setToast] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dog = useRef<HTMLButtonElement>(null);
  const effects = useRef<Effects>(null);
  const sound = useRef<KnopikSoundEngine | null>(null);
  const section = useRef<HTMLElement>(null);

  const apply = useCallback((next: Game, persist: boolean) => {
    const previous = current.current;
    current.current = next; setGame(next);
    if (persist) saveProgress(saveGame(next));
    if (next.event === previous.event) return next;
    if (next.message && next.effect !== 'tap') {
      setToast(next.message);
      if (toastTimer.current) clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(() => setToast(''), 4500);
    }
    const rect = dog.current?.getBoundingClientRect();
    const x = rect ? rect.left + rect.width / 2 : innerWidth / 2;
    const y = rect ? rect.top + rect.height / 2 : innerHeight / 2;
    const fx = next.effect;
    if (fx === 'tap' || fx === 'super' || fx === 'reward' || fx === 'bite') effects.current?.burst(x, y, fx);
    if (fx === 'tap') sound.current?.tap(next.round.combo / 50);
    else if (fx === 'bite') { sound.current?.ultraStop('overheat'); sound.current?.bite(); }
    else if (fx === 'super') sound.current?.ultraStop('success');
    else if (fx === 'bank') sound.current?.safe();
    else if (fx === 'reward' || fx === 'shield') sound.current?.purchase();
    if (mood(next) === 'warning' && mood(previous) !== 'warning') sound.current?.warning();
    if (next.save.settings.vibration && navigator.vibrate && fx !== 'none') navigator.vibrate(fx === 'bite' ? [40, 50, 40] : fx === 'super' ? 30 : 8);
    return next;
  }, [saveProgress]);
  const change = useCallback((action: (g: Game) => Game) => {
    const next = action(advance(current.current, Date.now()));
    return apply(next, true);
  }, [apply]);

  useEffect(() => {
    const engine = new KnopikSoundEngine({ enabled: current.current.save.settings.sound }); sound.current = engine;
    return () => { engine.close(); sound.current = null; if (toastTimer.current) clearTimeout(toastTimer.current); };
  }, []);
  useEffect(() => { sound.current?.setEnabled(game.save.settings.sound); }, [game.save.settings.sound]);
  useEffect(() => {
    const tick = () => {
      if (document.hidden) return;
      const next = advance(current.current, Date.now());
      apply(next, next.event !== current.current.event);
    };
    const pause = () => {
      const next = finishSuper(current.current, Date.now(), true);
      sound.current?.stopUltraLoop('cancel'); apply(next, true);
    };
    const visibility = () => { if (document.hidden) pause(); else tick(); };
    const interval = setInterval(tick, 80);
    window.addEventListener('blur', pause); window.addEventListener('pagehide', pause); document.addEventListener('visibilitychange', visibility);
    return () => { clearInterval(interval); window.removeEventListener('blur', pause); window.removeEventListener('pagehide', pause); document.removeEventListener('visibilitychange', visibility); };
  }, [apply]);
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busyRef.current) setMini(null); };
    window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close);
  }, []);
  const screenMood = mood(game);
  useEffect(() => {
    const color = screenMood === 'angry' ? '#ed3e43' : screenMood === 'warning' ? '#ffd04b' : '#ffffff';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color);
  }, [screenMood]);

  const s = game.save;
  const state = mood(game);
  const happiness = Math.min(1, game.round.happiness / 100);
  const holding = game.hold !== null;
  const elapsed = holding ? Math.max(0, game.round.updatedAt - game.hold!) : 0;
  const charge = Math.min(100, elapsed / superLimit(s) * 100);
  const m = MISSIONS[s.questIndex];
  const missionProgress = m ? Math.min(m.target, s[m.metric]) : 1;
  const missionReady = Boolean(m && missionProgress >= m.target);
  const levelSpan = nextLevelThreshold(s.level) - levelThreshold(s.level);
  const levelProgress = levelSpan ? Math.min(100, s.levelCoins / levelSpan * 100) : 100;
  const playable = !busy && !mini && !dialog && !rewards && state !== 'angry';
  function navigate(value: Tab) {
    if (busyRef.current) return;
    change(g => finishSuper(g, Date.now(), true)); sound.current?.stopUltraLoop('cancel'); sound.current?.nav();
    setTab(value); setMini(null); setNotice(''); section.current?.scrollTo({ top: 0 });
  }
  function doTap() { if (playable) { sound.current?.unlock(); change(g => tap(g, Date.now(), session.difficulty)); } }
  function beginCharge() {
    if (!playable) return;
    sound.current?.unlock(); const next = change(g => startSuper(g, Date.now())); if (next.hold !== null) sound.current?.ultraStart();
  }
  function endCharge(cancelled = false) {
    if (current.current.hold === null) return;
    change(g => finishSuper(g, Date.now(), cancelled)); sound.current?.stopUltraLoop(cancelled ? 'cancel' : 'success');
  }
  function activate(id: ItemId) {
    if (holding || state === 'angry') return;
    if (!s[id]) { setToast('Этот предмет можно купить в магазине.'); navigate('shop'); return; }
    const gameKind = id === 'pitbullCount' ? 'risk' : id === 'colaCount' ? 'slots' : id === 'teaCount' ? 'mines' : null;
    if (gameKind) { setMini(gameKind); return; }
    change(g => consumeItem(g, id, Date.now()));
  }
  function reveal(kind: CaseKind) {
    change(g => { const result = openCase(g, kind); if (result.rewards.length) setRewards(result.rewards); return result.game; });
  }
  async function request(action: () => Promise<unknown>) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setNotice('');
    try { const result = await action(); if (typeof result === 'string') setNotice(result); }
    catch (e) { setNotice(e instanceof Error ? e.message : 'Не удалось выполнить запрос.'); }
    finally { busyRef.current = false; setBusy(false); }
  }
  function submitPromo(event: FormEvent) {
    event.preventDefault();
    void request(async () => session.account.isAdmin ? session.createPromoCode(promo, promoAmount) : (await session.redeemPromoCode(promo)).message);
  }
  function doBank() { if (!swipeConsumed.current) change(bank); swipeConsumed.current = false; }

  return <div className={`arcade-app mood-${state} ${holding ? 'is-charging' : ''}`} style={{ '--joy': happiness, '--charge': `${charge}%` } as CSSProperties}>
    <a href="#game-content" className="skip-link">К игре</a>
    <div className="scene-blue" aria-hidden="true" /><div className="scene-grid" aria-hidden="true" />
    <header className="arcade-header"><span className="brand">knopik<span>tap</span><i /></span><div className="header-right"><span className="session-name">{session.account.username}</span><span className={`save-indicator sync-${session.syncState}`} aria-label={session.syncState === 'saved' ? 'Прогресс сохранён' : session.syncState === 'saving' ? 'Сохранение прогресса' : 'Ошибка сохранения'}><i /><span>{session.syncState === 'saved' ? 'Сохранено' : session.syncState === 'saving' ? 'Сохраняем' : 'Нет связи'}</span></span><button className="icon-button" aria-label="Настройки" onClick={() => setDialog('settings')}><Icon name="settings" /></button></div></header>
    <main id="game-content" className="arcade-main" ref={section}>
      <div className="game-topline"><div><span className="eyebrow">{tab === 'play' ? 'Твой маленький напарник' : 'Всё для большой дружбы'}</span><h1>{tab === 'play' ? 'Привет, Кнопик.' : tab === 'shop' ? 'Магазин.' : tab === 'cases' ? 'Есть что открыть.' : 'Твоя игра.'}</h1></div><button className="level-badge" onClick={() => navigate('profile')} aria-label={`Уровень ${s.level}. Открыть профиль`}><Icon name="trophy" /><span>{s.level}<small>уровень</small></span></button></div>
      {session.syncState === 'error' && <div className="sync-banner" role="alert"><span>{session.syncError || 'Прогресс сохранён на устройстве. Облачная копия ждёт связи.'}</span><button className="secondary" onClick={() => void request(session.retrySave)} disabled={busy}>Повторить</button></div>}
      {tab === 'play' && !mini && <div className="play-layout">
        <section className="play-stage" aria-label="Игровое поле">
          <div className="stage-topline"><span className={`mood-pill ${state}`}><i />{moodText[state]}</span><button className="icon-button" aria-label="Как играть" onClick={() => setDialog('help')}><Icon name="help" /></button></div>
          <div className="coin-readout"><span className="eyebrow">В кошельке</span><strong>{number(s.walletCoins)}<span className="coin-dot" aria-label="монет">к</span></strong><span className="combo-label">{s.boostUntil > game.round.updatedAt ? `Живчик ×4 · ${Math.ceil((s.boostUntil - game.round.updatedAt) / 1000)} с` : game.round.combo >= 10 ? `Серия ${game.round.combo} · монеты ×${1 + Math.floor(game.round.combo / 10)}` : 'Тапай. Лови ритм. Береги монеты.'}</span></div>
          <div className="knopik-zone"><span className="orbit orbit-one" aria-hidden="true" /><span className="orbit orbit-two" aria-hidden="true" /><span className="stage-caption" aria-hidden="true">TAP INTO<br />A GOOD MOOD.</span><button ref={dog} className="knopik-target" data-testid="knopik" aria-label="Тапнуть Кнопика" disabled={!playable || holding} onClick={doTap}><Portrait mood={state} hat={s.hatEquipped} mohawk={s.mohawkEquipped} /></button>{game.reward > 0 && (game.effect === 'tap' || game.effect === 'super') && game.round.updatedAt - game.round.lastTap < 850 && <span className="tap-reward" key={game.event} aria-hidden="true">+{number(game.reward)}</span>}{s.vitaPowerShield && <span className="shield-badge"><Icon name="shield" size={18} />Щит активен</span>}</div>
          <div className="heat-control"><div><span>{holding ? elapsed >= 1000 && elapsed <= 1800 ? 'Отпускай — идеальный заряд!' : 'Заряжаем супертап' : state === 'angry' ? 'Отдыхаем после укуса' : 'Напряжение'}</span><strong>{holding ? `${(elapsed / 1000).toFixed(1)} с` : `${Math.round(game.round.heat)}%`}</strong></div><div className={`heat-track ${holding ? 'charge-track' : ''}`} role="progressbar" aria-label={holding ? 'Заряд супертапа' : 'Напряжение Кнопика'} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(holding ? charge : game.round.heat)}><span style={{ width: `${holding ? charge : game.round.heat}%` }} />{holding && <i style={{ left: `${1000 / superLimit(s) * 100}%`, width: `${800 / superLimit(s) * 100}%` }} />}</div><small>{state === 'angry' ? 'Сейф в безопасности. Скоро можно продолжить.' : game.round.heat >= 70 ? 'Сделай паузу или дай корм до 100%.' : 'Небольшая пауза снимает напряжение.'}</small></div>
          <button className="super-button" disabled={!playable} onPointerDown={e => { if (!e.isPrimary || e.button !== 0) return; e.currentTarget.setPointerCapture(e.pointerId); beginCharge(); }} onPointerUp={() => endCharge()} onPointerCancel={() => endCharge(true)} onLostPointerCapture={() => endCharge(true)} onKeyDown={e => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); beginCharge(); } }} onKeyUp={e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); endCharge(); } }} onContextMenu={e => e.preventDefault()}><span className="super-icon"><Icon name="bolt" /></span><span><strong>{holding ? 'Отпусти в синей зоне' : 'Супертап'}</strong><small>{holding ? 'Идеальный заряд: 1–1,8 секунды' : 'Удерживай и отпускай вовремя'}</small></span><span aria-hidden="true">↗</span></button>
        </section>
        <aside className="play-sidebar">
          <section className="vault-card"><div className="section-heading"><span className="eyebrow">Сейф</span><Icon name="safe" /></div><strong className="vault-number">{number(s.vaultCoins)}</strong><p>Эти монеты Кнопик не отнимет.</p><button className="bank-button" disabled={!s.walletCoins || holding || state === 'angry'} style={{ '--swipe': `${swipe}%` } as CSSProperties} onClick={doBank} onPointerDown={e => { swipeStart.current = e.clientX; swipeConsumed.current = false; e.currentTarget.setPointerCapture(e.pointerId); }} onPointerMove={e => { if (swipeStart.current === null) return; const progress = Math.min(100, Math.max(0, (e.clientX - swipeStart.current) / 110 * 100)); setSwipe(progress); if (progress >= 100) { change(bank); swipeConsumed.current = true; swipeStart.current = null; setSwipe(0); } }} onPointerUp={() => { swipeStart.current = null; setSwipe(0); }} onPointerCancel={() => { swipeStart.current = null; setSwipe(0); }}><span>Сохранить всё</span><Icon name="arrow" /></button><small>Нажми или проведи вправо</small></section>
          <section className="backpack-card"><div className="section-heading"><h2>Под рукой</h2><button className="text-button" onClick={() => navigate('shop')}>Магазин <span aria-hidden="true">↗</span></button></div><div className="quick-items">{ITEMS.map(item => <button key={item.id} onClick={() => activate(item.id)} disabled={holding || state === 'angry'} aria-label={`${item.name}: ${s[item.id]}. ${s[item.id] ? 'Использовать' : 'Открыть магазин'}`}><span className="quick-art"><img src={asset(`/buffs/${item.image}`)} alt="" /><b>{s[item.id] || '+'}</b></span><span>{item.name}</span>{item.id === 'drinkCount' && s.boostUntil > game.round.updatedAt && <small>{Math.ceil((s.boostUntil - game.round.updatedAt) / 1000)} с</small>}</button>)}</div></section>
          <section className="mission-card"><div className="section-heading"><span className="eyebrow">{m ? `Задание ${s.questIndex + 1} / 8` : 'Все задания выполнены'}</span><Icon name="gift" /></div><h2>{m?.title ?? 'Большая дружба'}</h2><p>{m?.detail ?? 'Продолжай играть и ставить рекорды.'}</p>{m && <><div className="mission-meter"><span style={{ width: `${missionProgress / m.target * 100}%` }} /></div><div className="mission-footer"><small>{number(missionProgress)} / {number(m.target)}</small><button className="text-button" disabled={!missionReady || s.commonCases >= 99} onClick={() => change(claimMission)}>{missionReady ? 'Забрать кейс ↗' : 'Награда: кейс'}</button></div></>}</section>
          {s.arcadeMine && <button className="resume-game" onClick={() => setMini('mines')}>Продолжить «Пять кнопок»<Icon name="arrow" /></button>}
        </aside>
      </div>}
      {tab === 'play' && mini && <ArcadeGames key={mini} kind={mini} game={game} change={change} difficulty={session.difficulty} onClose={() => setMini(null)} />}
      {tab === 'shop' && <section className="shop-content"><div className="section-intro"><p>Запасайся полезным. Играй дольше.</p><span className="balance-tag">Доступно <b>{number(s.walletCoins + s.vaultCoins)}</b> монет</span></div><div className="shop-grid">{ITEMS.map((item, index) => <article className="shop-item" key={item.id}><div className={`product-art product-${index}`}><img src={asset(`/buffs/${item.image}`)} alt={item.name} /><span>{s[item.id]} / 25</span></div><h2>{item.name}</h2><p>{item.detail}</p><button className="secondary" disabled={s[item.id] >= 25 || s.walletCoins + s.vaultCoins < item.price} onClick={() => change(g => buy(g, item.id))}><span>Купить</span><strong>{number(item.price)} к</strong></button></article>)}</div><div className="section-heading wardrobe-title"><h2>Новый образ</h2><span className="muted">Предметы можно улучшать</span></div><div className="wardrobe-grid">{(['hat', 'mohawk'] as const).map(kind => { const hat = kind === 'hat'; const owned = hat ? s.hatOwned : s.mohawkOwned; const equipped = hat ? s.hatEquipped : s.mohawkEquipped; const price = hat ? 5000 : 10000; const level = hat ? s.hatLevel : s.mohawkLevel; const tokens = hat ? s.hatUpgradeTokens : s.mohawkUpgradeTokens; return <article className="wardrobe-item" key={kind}><img src={asset(hat ? '/hasbik-tubeteika.png' : '/knopik-mohawk-v2.png')} alt="" /><div><h3>{hat ? 'Тюбетейка Хасбика' : 'Ирокез'}</h3><p>{hat ? 'Больше времени для супертапа' : 'Больше монет за ритмичные тапы'}</p>{owned && <small>Уровень {level} / 5 · улучшений: {tokens}</small>}<div className="wardrobe-actions"><button className="secondary" disabled={!owned && s.walletCoins + s.vaultCoins < price} onClick={() => change(g => owned ? equip(g, kind) : buy(g, kind))}>{owned ? equipped ? 'Снять' : 'Надеть' : `Купить · ${number(price)}`}</button>{owned && <button className="secondary" disabled={!tokens || level >= 5} onClick={() => change(g => equip(g, kind, true))}>Улучшить</button>}</div></div></article>; })}</div></section>}
      {tab === 'cases' && <section className="cases-content"><p className="muted">В каждом кейсе — монеты, напитки или улучшения. Всё начисляется сразу после открытия.</p><div className="case-grid">{(['common', 'big'] as const).map(kind => { const big = kind === 'big'; const count = big ? s.bigCases : s.commonCases; const price = big ? 25000 : 2500; return <article className={`case-card ${big ? 'case-big' : ''}`} key={kind}><div className="case-emblem"><Icon name="gift" size={76} /><span>{big ? '05' : '03'}</span></div><span className="eyebrow">{big ? 'Пять наград' : 'Три награды'}</span><h2>{big ? 'Большой кейс' : 'Обычный кейс'}</h2><p>{big ? 'Больше монет и шанс на целый предмет.' : 'Небольшой сюрприз для большой игры.'}</p><strong className="case-count">В рюкзаке: {count}</strong><button className="primary" disabled={!count} onClick={() => reveal(kind)}>Открыть кейс<Icon name="arrow" /></button><button className="secondary" disabled={count >= 99 || s.walletCoins + s.vaultCoins < price} onClick={() => change(g => buy(g, kind))}>Купить · {number(price)} монет</button></article>; })}</div></section>}
      {tab === 'profile' && <section className="profile-content" aria-busy={busy}><div className="profile-summary"><span className="profile-avatar"><Icon name={session.account.isAdmin ? 'shield' : 'user'} size={36} /></span><div><span className="eyebrow">{session.account.isAdmin ? 'Администратор' : 'Игрок'}</span><h2>{session.account.username}</h2><p>Уровень {s.level} · монеты ×{levelMultiplier(s.level).toFixed(2)}</p></div></div><div className="level-progress"><div><span>До следующего уровня</span><strong>{s.level >= 10 ? 'Максимальный уровень' : `${number(s.levelCoins)} / ${number(levelSpan)}`}</strong></div><div className="mission-meter"><span style={{ width: `${levelProgress}%` }} /></div></div><div className="stats-grid">{[['Всего тапов', s.totalTaps], ['Лучшая серия', s.bestStreak], ['Монет в сейфе', s.vaultCoins], ['Побед в играх', s.riskWins + s.slotWins + s.mineWins]].map(([label, value]) => <div key={label}><span>{label}</span><strong>{number(Number(value))}</strong></div>)}</div><div className="account-panel"><h2>{session.account.isAdmin ? 'Управление игрой' : 'Есть промокод?'}</h2><form className="promo-form" onSubmit={submitPromo}><label>Промокод<input value={promo} onChange={e => setPromo(e.target.value.toUpperCase())} required pattern="[A-Za-z0-9_-]{3,32}" maxLength={32} placeholder="Например, KNOPIK" autoCapitalize="characters" /></label>{session.account.isAdmin && <label>Монет в награде<input type="number" min="1" max="1000000000" required value={promoAmount} onChange={e => setPromoAmount(Number(e.target.value))} /></label>}<button className="primary" disabled={busy}>{session.account.isAdmin ? 'Создать промокод' : 'Активировать'}<Icon name="arrow" /></button></form>{session.account.isAdmin && <><form className="difficulty-form" onSubmit={e => { e.preventDefault(); void request(() => session.updateDifficulty(difficulty)); }}><label htmlFor="difficulty">Сложность · {difficulty} / 100</label><input id="difficulty" type="range" min="0" max="100" value={difficulty} onChange={e => setDifficulty(Number(e.target.value))} /><p className="muted">Выше сложность — быстрее растёт напряжение и реже выпадают выигрыши. Для игрока изменение применится при следующем входе.</p><button className="secondary" disabled={busy}>Сохранить сложность</button></form><div className="section-heading"><h3>Промокоды</h3><button className="text-button" disabled={busy} onClick={() => void request(session.refreshPromoCodes)}>Обновить</button></div><ul className="promo-list">{session.promoCodes.map(code => <li key={code.id}><code>{code.code}</code><strong>+{number(code.amount)}</strong><span>{code.redeemed ? 'Использован' : 'Доступен'}</span></li>)}</ul></>}<p className="form-message" role="status">{notice}</p></div><button className="text-button signout" disabled={busy} onClick={() => void request(session.signOut)}>{busy ? 'Подожди…' : 'Выйти из аккаунта'}<Icon name="arrow" /></button></section>}
    </main>
    <nav className="arcade-nav" aria-label="Разделы игры">{navigation.map(item => <button key={item.id} aria-current={tab === item.id ? 'page' : undefined} disabled={busy} onClick={() => navigate(item.id)}><Icon name={item.icon} /><span>{item.title}</span>{item.id === 'cases' && s.commonCases + s.bigCases > 0 && <b>{s.commonCases + s.bigCases}</b>}</button>)}</nav>
    <div className="arcade-toast" role="status">{toast && <span>{toast}<button aria-label="Скрыть сообщение" onClick={() => setToast('')}><Icon name="close" size={16} /></button></span>}</div>
    <ArcadeEffects ref={effects} />
    {busy && <div className="request-veil" role="status">Сохраняем изменения…</div>}
    {dialog === 'help' && <Dialog title="Поймай ритм." onClose={() => setDialog(null)}><div className="help-list"><p><b>01 · Тапай Кнопика.</b> Ровный ритм поднимает настроение и множитель монет. Чем он счастливее, тем синее экран.</p><p><b>02 · Следи за напряжением.</b> Жёлтый — пора сделать паузу или дать корм. На 100% Кнопик кусается, экран краснеет, а кошелёк обнуляется.</p><p><b>03 · Сохраняй в сейф.</b> Нажми «Сохранить всё» или проведи вправо. Монеты в сейфе переживут любой укус.</p><p><b>04 · Попробуй супертап.</b> Удерживай кнопку и отпускай через 1–1,8 секунды. Слишком долгий заряд закончится укусом.</p></div><button className="primary" onClick={() => setDialog(null)}>Играть<Icon name="play" /></button></Dialog>}
    {dialog === 'settings' && <Dialog title="Настройки" onClose={() => { if (!busyRef.current) setDialog(null); }}><p className="muted">{session.account.username} · {session.account.isAdmin ? 'администратор' : 'игрок'}</p>{(['sound', 'vibration'] as const).map(key => <label className="toggle-row" key={key}><span>{key === 'sound' ? 'Звуки игры' : 'Вибрация'}</span><input type="checkbox" role="switch" checked={s.settings[key]} onChange={e => { const value = e.target.checked; change(g => ({ ...g, save: { ...g.save, settings: { ...g.save.settings, [key]: value } } })); }} /></label>)}<p className="muted">Анимации учитывают настройку уменьшения движения на твоём устройстве.</p><button className="secondary" disabled={busy} onClick={() => void request(session.retrySave)}>Сохранить прогресс сейчас</button><p className="form-message" role="status">{notice}</p><button className="text-button" disabled={busy} onClick={() => void request(session.signOut)}>Выйти из аккаунта<Icon name="arrow" /></button></Dialog>}
    {rewards && <Dialog title="Вот это находка." onClose={() => setRewards(null)}><p className="muted">Награды уже добавлены. Всё сверх лимита обменено на монеты.</p><ul className="rewards-list">{rewards.map((r, index) => <li key={index}><span><Icon name={r.type === 'coins' ? 'bolt' : r.type === 'upgrade' ? 'trophy' : 'gift'} /></span><strong>{r.label}</strong><Icon name="check" size={18} /></li>)}</ul><button className="primary" onClick={() => setRewards(null)}>Забрать и продолжить<Icon name="arrow" /></button></Dialog>}
  </div>;
}
