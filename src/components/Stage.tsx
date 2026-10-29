import { appUrl } from '../lib/paths';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import NumberFlow from '@number-flow/react';
import confetti from 'canvas-confetti';
import { AudioLines, Flower2, Mic2 } from 'lucide-react';
import { GAME_CONFIG, getIndividualRanking, getRanking, getScores, type ActivityState } from '../lib/model';
import TeamBarRanking from './TeamBarRanking';
import './stage.css';

type StageProps = { state: ActivityState; embedded?: boolean };
type Feedback = { key: number; changes: Record<string, number> };
type Reaction = { key: string; teamId: string };
type Standing = { id: string; name: string; score: number; rank: number; sticker?: string; teamName?: string };
const STICKERS = '/stickers/';

function Flower({ file = 'flower-01.png', className = '' }: { file?: string; className?: string }) {
  return <img className={`stage-flower ${className}`} src={appUrl(`${STICKERS}${file}`)} alt="" draggable={false} />;
}

function Score({ value, reduced }: { value: number; reduced: boolean }) {
  return <NumberFlow value={value} animated={!reduced} format={{ useGrouping: false }} />;
}

function GameProgress({ state }: { state: ActivityState }) {
  if (state.scene === 'game' || state.scene === 'leaderboard') return null;
  return <nav className="stage-game-progress" aria-label="当前游戏">
    <span className="stage-game-step stage-game-step-current" aria-current="step" data-game-id={state.gameId} data-active="true">{state.gameId === 'music' ? '猜歌' : GAME_CONFIG[state.gameId].name}</span>
  </nav>;
}

function Heading({ title, gameId }: { title: string; gameId?: ActivityState['gameId'] }) {
  const Icon = gameId === 'music' ? AudioLines : gameId === 'garden' ? Flower2 : gameId === 'lyrics' ? Mic2 : null;
  return <div className="stage-heading"><h2>{title}</h2>{Icon && <Icon className="stage-game-mark" size={42} strokeWidth={1.45} aria-hidden="true" />}</div>;
}

function Ranking({ state, items, individual = false, feedback, reaction, reduced }: { state: ActivityState; items: Standing[]; individual?: boolean; feedback: Feedback | null; reaction: Reaction | null; reduced: boolean }) {
  const hasScores = items.some(item => item.score !== 0);
  const sparse = individual && items.length <= 4;
  return <div className={`stage-ranking ${individual ? 'stage-ranking-individual' : ''} ${sparse ? 'stage-ranking-sparse' : ''}`} style={{ '--standing-count': items.length } as CSSProperties}>
    <div className="stage-ranking-list" role="list" aria-label={individual ? '个人积分排名' : '队伍积分排名'}>
      {items.map((item, index) => {
        const hasPlace = state.scoresVisible && item.score > 0 && item.rank <= 3;
        const isReacting = !individual && hasPlace && index < 3 && state.banterEnabled && !reduced && reaction?.teamId === item.id;
        const delta = !individual && state.scoresVisible ? feedback?.changes[item.id] : undefined;
        const digits = state.scoresVisible ? String(item.score).length : 2;
        const fontSize = Math.min(sparse ? 76 : 56, 338 / (digits * 0.66));
        const scoreWidth = Math.max(144, Math.ceil(digits * fontSize * 0.66) + 6);
        const placeSticker = hasPlace ? item.rank === 1 ? 'flower-08.png' : item.rank === 2 ? 'flower-02.png' : 'flower-03.png' : null;
        return <motion.div className={`stage-team-row ${hasPlace ? `stage-team-top-${item.rank}` : ''} ${isReacting ? 'stage-row-reacting' : ''}`} key={item.id} role="listitem" layout={reduced ? false : 'position'} transition={{ layout: { type: 'spring', bounce: 0, duration: 0.42 } }} data-team-id={individual ? undefined : item.id} data-member-id={individual ? item.id : undefined} data-score={state.scoresVisible ? item.score : undefined} data-banter-active={isReacting || undefined} style={{ '--score-width': `${scoreWidth}px` } as CSSProperties}>
          <span className="stage-rank">{state.scoresVisible && hasScores ? String(item.rank).padStart(2, '0') : '—'}</span>
          <motion.span className="stage-avatar" key={isReacting ? reaction!.key : 'still'} initial={false} animate={isReacting ? { rotate: [0, -7, 5, 0], y: [0, -5, 0], scale: [1, 1.06, 1] } : { rotate: 0, y: 0, scale: 1 }} transition={{ duration: reduced ? 0 : 0.7, ease: 'easeInOut' }}>
            {placeSticker ? <Flower file={placeSticker} /> : <img className="stage-flower" src={appUrl(item.sticker || `${STICKERS}flower-04.png`)} alt="" draggable={false} />}
          </motion.span>
          <span className="stage-name-block"><strong className="stage-team-name">{item.name}</strong>{individual && item.teamName && <span className="stage-member-team">{item.teamName}</span>}</span>
          <AnimatePresence initial={false}>{delta !== undefined && delta !== 0 && <motion.span className={`stage-score-feedback ${delta < 0 ? 'stage-score-feedback-negative' : ''}`} key={`${feedback!.key}-${item.id}`} initial={{ opacity: 0, y: reduced ? 0 : 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: reduced ? 0 : -8 }} transition={{ duration: reduced ? 0 : 0.18 }}>{delta > 0 ? '+' : ''}{delta}</motion.span>}</AnimatePresence>
          <span className="stage-team-score" style={{ width: scoreWidth, fontSize }}>{state.scoresVisible ? <Score value={item.score} reduced={reduced} /> : '—'}</span>
        </motion.div>;
      })}
    </div>
  </div>;
}

function TeamScene({ state, feedback, reduced }: { state: ActivityState; feedback: Feedback | null; reaction: Reaction | null; reduced: boolean }) {
  const gameIndex = ['music', 'garden', 'lyrics'].indexOf(state.gameId);
  const art = state.gameId === 'music' ? 'flower-08.png' : state.gameId === 'garden' ? 'flower-03.png' : 'flower-02.png';
  return <section className="stage-game-layout">
    <div className="stage-game-panel" aria-label="当前游戏">
      <span className="stage-game-number">{gameIndex < 0 ? '—' : `0${gameIndex + 1}`}<span> / 03</span></span>
      <AnimatePresence mode="wait" initial={false}><motion.h2 className="stage-current-game-title" key={state.gameId} initial={{ opacity: 0, transform: reduced ? 'none' : 'translateY(8px)' }} animate={{ opacity: 1, transform: 'translateY(0)' }} exit={{ opacity: 0, transform: reduced ? 'none' : 'translateY(-8px)' }} transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}>{state.gameId === 'music' ? <>听前奏<br />猜歌</> : GAME_CONFIG[state.gameId].name}</motion.h2></AnimatePresence>
      <div className="stage-game-art"><Flower file={art} /></div>
      <div className="stage-game-indicator" aria-hidden="true">{[0, 1, 2].map(index => <span key={index} className={gameIndex === index ? 'active' : ''} />)}</div>
    </div>
    <TeamBarRanking state={state} feedback={feedback} reduced={reduced} />
  </section>;
}

function Welcome({ state }: { state: ActivityState }) {
  return <section className="stage-welcome"><Heading title="欢迎入场" /><div className="stage-roster">{state.teams.map((team, index) => <div className="stage-roster-team" key={team.id}><span className="stage-roster-number">{String(index + 1).padStart(2, '0')}</span><img className="stage-flower" src={appUrl(team.sticker || `${STICKERS}flower-04.png`)} alt="" /><strong>{team.name}</strong></div>)}</div></section>;
}

function EmptyState({ title }: { title: string }) {
  return <div className="stage-empty"><Flower file="flower-04.png" /><h2>{title}</h2></div>;
}

function IndividualScene({ state, reduced }: { state: ActivityState; reduced: boolean }) {
  const items = getIndividualRanking(state).filter(item => item.score > 0).slice(0, 10);
  if (!state.scoresVisible || !items.length) return <EmptyState title="MVP 待揭晓" />;
  return <section className="stage-board-scene"><Heading title="MVP" /><Ranking state={state} items={items} individual feedback={null} reaction={null} reduced={reduced} /></section>;
}

function Podium({ state, reduced }: { state: ActivityState; reduced: boolean }) {
  const individual = state.awardMode === 'individual';
  const items: Standing[] = (individual ? getIndividualRanking(state) : getRanking(state)).filter(item => item.score > 0);
  if (!items.length) return <EmptyState title={individual ? 'MVP 待揭晓' : '荣誉待揭晓'} />;
  const revealNeeded: Record<number, number> = { 3: 1, 2: 2, 1: 3 };
  return <section className="stage-awards"><Heading title={individual ? 'MVP' : '团队荣誉'} /><div className="stage-podium-deck">{[2, 1, 3].map(rank => {
    const winners = items.filter(item => item.rank === rank);
    const revealed = state.scoresVisible && state.podiumRevealed >= revealNeeded[rank];
    const names = winners.slice(0, individual ? 8 : 10);
    return <div className={`stage-podium-position stage-podium-position-${rank}`} key={rank}>
      <AnimatePresence mode="wait" initial={false}>{revealed ? <motion.div className="stage-podium-card" key="revealed" initial={{ opacity: 0, y: reduced ? 0 : 20 }} animate={{ opacity: 1, y: 0 }} transition={{ type: 'spring', bounce: 0, duration: reduced ? 0 : 0.45 }}>
        <span className="stage-podium-place">{winners.length > 1 ? '并列 ' : ''}{rank === 1 && individual ? 'MVP' : `第 ${rank} 名`}</span>
        {winners.length ? <><Flower file={rank === 1 ? 'flower-08.png' : rank === 2 ? 'flower-02.png' : 'flower-03.png'} className="stage-podium-flower" /><div className={`stage-podium-names ${winners.length > 3 ? 'stage-podium-names-many' : ''}`}>{names.map(item => <strong key={item.id}>{item.name}</strong>)}{winners.length > names.length && <span className="stage-podium-more">另 {winners.length - names.length} 位</span>}</div><div className="stage-podium-score" style={{ fontSize: Math.min(rank === 1 ? 96 : 80, (rank === 1 ? 460 : 370) / (String(winners[0].score).length * 0.66)) }}><Score value={winners[0].score} reduced={reduced} /></div></> : <span className="stage-podium-vacant">—</span>}
      </motion.div> : <motion.div className="stage-podium-card stage-podium-secret" key="secret" initial={{ opacity: 0 }} animate={{ opacity: 1 }}><span className="stage-podium-place">第 {rank} 名</span><span className="stage-podium-question">?</span></motion.div>}</AnimatePresence>
    </div>;
  })}</div></section>;
}

export default function Stage({ state, embedded = false }: StageProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [scale, setScale] = useState(0.5);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [reaction, setReaction] = useState<Reaction | null>(null);
  const previousScores = useRef<Record<string, number> | null>(null);
  const previousEvents = useRef<ActivityState['events'] | null>(null);
  const previousContext = useRef('');
  const feedbackSequence = useRef(0);
  const previousRanks = useRef<Record<string, number> | null>(null);
  const feedbackTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reactionTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const consumedCue = useRef<string | null>(null);
  const preference = useReducedMotion();
  const reduced = state.reducedMotion || Boolean(preference);
  const confettiInstance = useRef<ReturnType<typeof confetti.create> | null>(null);
  const previousReveal = useRef({ scene: state.scene, count: state.podiumRevealed, mode: state.awardMode });

  useEffect(() => {
    const element = wrapperRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setScale(Math.min(entry.contentRect.width / 1920, entry.contentRect.height / 1080)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const scores = getScores(state);
    const previous = previousScores.current;
    const priorEvents = previousEvents.current;
    const context = `${state.scene}:${state.gameId}:${state.scoresVisible}`;
    const changedContext = previousContext.current !== context;
    const ranking = getRanking(state);
    const priorRanks = previousRanks.current;
    previousScores.current = scores;
    previousEvents.current = state.events;
    previousContext.current = context;
    previousRanks.current = Object.fromEntries(ranking.map(item => [item.id, item.rank]));
    if (!previous || !priorEvents) return;
    const sameEvent = (a: ActivityState['events'][number], b: ActivityState['events'][number]) => a === b || JSON.stringify(a) === JSON.stringify(b);
    // Storage and BroadcastChannel may deliver the same revision more than once.
    if (!changedContext && priorEvents.length === state.events.length && priorEvents.every((event, index) => sameEvent(event, state.events[index]))) return;
    const appended = state.events.length > priorEvents.length && priorEvents.every((event, index) => sameEvent(event, state.events[index])) && state.events.slice(priorEvents.length).every(event => !event.undone);
    let undoCount = 0;
    const undone = state.events.length === priorEvents.length && priorEvents.every((event, index) => {
      const next = state.events[index];
      if (sameEvent(event, next)) return true;
      if (!event.undone && next.undone && sameEvent({ ...event, undone: true }, next)) { undoCount++; return true; }
      return false;
    }) && undoCount === 1;
    if (changedContext || !state.scoresVisible || (!appended && !undone)) {
      setFeedback(null);
      setReaction(null);
      if (feedbackTimeout.current) clearTimeout(feedbackTimeout.current);
      if (reactionTimeout.current) clearTimeout(reactionTimeout.current);
      return;
    }
    const changes: Record<string, number> = {};
    state.teams.forEach(team => { const difference = (scores[team.id] ?? 0) - (previous[team.id] ?? 0); if (difference) changes[team.id] = difference; });
    if (!Object.keys(changes).length) return;
    setFeedback({ key: ++feedbackSequence.current, changes });
    if (feedbackTimeout.current) clearTimeout(feedbackTimeout.current);
    feedbackTimeout.current = setTimeout(() => setFeedback(null), 1700);
    if (!reduced && state.banterEnabled && state.scoresVisible) {
      const candidates = ranking.slice(0, 3);
      const scorer = candidates.find(item => item.score > 0 && item.rank === 1 && priorRanks?.[item.id] !== 1 && changes[item.id] > 0) || candidates.find(item => item.score > 0 && item.rank <= 3 && changes[item.id] > 0);
      if (scorer) {
        setReaction({ key: `score-${Date.now()}`, teamId: scorer.id });
        if (reactionTimeout.current) clearTimeout(reactionTimeout.current);
        reactionTimeout.current = setTimeout(() => setReaction(null), 1200);
      }
    }
  }, [state.events, state.teams, state.scene, state.gameId, state.scoresVisible]);

  useEffect(() => {
    if (!state.banterEnabled || reduced || !state.scoresVisible) {
      setReaction(null);
      if (reactionTimeout.current) clearTimeout(reactionTimeout.current);
    }
    const cue = state.banterCue;
    if (!cue || consumedCue.current === cue.id) return;
    consumedCue.current = cue.id;
    const age = Date.now() - cue.at;
    if (!state.banterEnabled || reduced || !state.scoresVisible || age < 0 || age > 10000) return;
    const team = getRanking(state).slice(0, 3).find(item => item.id === cue.teamId && item.score > 0 && item.rank <= 3);
    if (!team) return;
    setReaction({ key: cue.id, teamId: team.id });
    if (reactionTimeout.current) clearTimeout(reactionTimeout.current);
    reactionTimeout.current = setTimeout(() => setReaction(null), 1200);
  }, [state.banterCue?.id, state.banterEnabled, reduced, state.scoresVisible]);

  useEffect(() => {
    const previous = previousReveal.current;
    previousReveal.current = { scene: state.scene, count: state.podiumRevealed, mode: state.awardMode };
    const ranking = state.awardMode === 'individual' ? getIndividualRanking(state) : getRanking(state);
    if (embedded || reduced || !state.scoresVisible || state.scene !== 'podium' || state.podiumRevealed !== 3 || (previous.scene === 'podium' && previous.count === 3 && previous.mode === state.awardMode) || !ranking.some(item => item.score > 0) || !canvasRef.current) return;
    confettiInstance.current ??= confetti.create(canvasRef.current, { resize: true });
    const fire = confettiInstance.current;
    const colors = ['#D9364E', '#D8D8DE', '#FFFFFF'];
    void fire({ particleCount: 30, spread: 60, origin: { x: 0.08, y: 0.65 }, angle: 55, colors, disableForReducedMotion: true });
    void fire({ particleCount: 30, spread: 60, origin: { x: 0.92, y: 0.65 }, angle: 125, colors, disableForReducedMotion: true });
  }, [state.scene, state.podiumRevealed, state.awardMode, state.scoresVisible, embedded, reduced]);

  useEffect(() => () => { if (feedbackTimeout.current) clearTimeout(feedbackTimeout.current); if (reactionTimeout.current) clearTimeout(reactionTimeout.current); confettiInstance.current?.reset(); }, []);

  return <div className={`stage-viewport ${embedded ? 'stage-embedded' : ''}`} ref={wrapperRef}><div className={`stage-canvas stage-scene-${state.scene} ${reduced ? 'stage-reduced' : ''}`} style={{ transform: `translate(-50%, -50%) scale(${scale})` }}>
    <header className="stage-header"><div className="stage-brand"><Flower /><span>{state.title}</span></div><GameProgress state={state} /></header>
    <main className="stage-main">
      {state.scene === 'welcome' && <Welcome state={state} />}
      {(state.scene === 'game' || state.scene === 'leaderboard') && <TeamScene state={state} feedback={feedback} reaction={reaction} reduced={reduced} />}
      {state.scene === 'mvp' && <IndividualScene state={state} reduced={reduced} />}
      {state.scene === 'podium' && <Podium state={state} reduced={reduced} />}
    </main>
    <canvas className="stage-confetti" ref={canvasRef} />
  </div></div>;
}
