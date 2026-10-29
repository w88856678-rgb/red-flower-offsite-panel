import { appUrl } from '../lib/paths';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import NumberFlow from '@number-flow/react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { getRanking, getScores, type ActivityState } from '../lib/model';
import { TeamBanterAvatarCue, TeamBanterOverlay, TeamBanterStatus, useTeamBanter } from './TeamBanter';
import './team-bars.css';

export type TeamRankingFeedback = { key: number; changes: Record<string, number> };
type Props = { state: ActivityState; feedback: TeamRankingFeedback | null; reduced: boolean };
type Direction = 'up' | 'down';
type Pulse = { key: number; teamId: string; delta: number };
type Position = { index: number; rank: number };

const FEEDBACK_LIFETIME = 1500;
const MAX_PULSES_PER_TEAM = 3;
const EASE_OUT = [0.23, 1, 0.32, 1] as const;
const EASE_IN_OUT = [0.77, 0, 0.175, 1] as const;

export default function TeamBarRanking({ state, feedback, reduced }: Props) {
  const rootRef = useRef<HTMLElement>(null);
  const banter = useTeamBanter(state, feedback);
  const visible = state.scoresVisible;
  const items = useMemo(() => visible
    ? getRanking(state)
    : state.teams.map(team => ({ ...team, score: 0, rank: 0 })), [state, visible]);
  const scores = useMemo(() => visible ? getScores(state) : {}, [state, visible]);
  const [pulses, setPulses] = useState<Pulse[]>([]);
  const [directions, setDirections] = useState<Record<string, Direction>>({});
  const pulseTimers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const directionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seenFeedback = useRef<number | null>(null);
  const previousPositions = useRef<Map<string, Position> | null>(null);

  // A game/scene change establishes a new baseline; transport clones do not.
  useEffect(() => {
    pulseTimers.current.forEach(clearTimeout);
    pulseTimers.current.clear();
    if (directionTimer.current) clearTimeout(directionTimer.current);
    setPulses(previous => previous.length ? [] : previous);
    setDirections(previous => Object.keys(previous).length ? {} : previous);
    previousPositions.current = visible ? new Map(items.map((item, index) => [item.id, { index, rank: item.rank }])) : null;
    seenFeedback.current = feedback?.key ?? null;
  }, [state.scene, state.gameId]);

  // Each score operation owns a short-lived entry. New operations never wait for an exit.
  useEffect(() => {
    if (!visible || !feedback) {
      pulseTimers.current.forEach(clearTimeout);
      pulseTimers.current.clear();
      setPulses(previous => previous.length ? [] : previous);
      if (!visible) seenFeedback.current = feedback?.key ?? seenFeedback.current;
      return;
    }
    if (seenFeedback.current === feedback.key) return;
    seenFeedback.current = feedback.key;
    const teamIds = new Set(state.teams.map(team => team.id));
    const incoming = Object.entries(feedback.changes)
      .filter(([teamId, delta]) => teamIds.has(teamId) && Number.isFinite(delta) && delta !== 0)
      .map(([teamId, delta]) => ({ key: feedback.key, teamId, delta }));
    if (!incoming.length) return;
    setPulses(previous => {
      const combined = [...previous, ...incoming];
      return combined.filter((pulse, index) => combined.slice(index + 1)
        .filter(later => later.teamId === pulse.teamId).length < MAX_PULSES_PER_TEAM);
    });
    const timer = setTimeout(() => {
      setPulses(previous => previous.filter(pulse => pulse.key !== feedback.key));
      pulseTimers.current.delete(feedback.key);
    }, FEEDBACK_LIFETIME);
    pulseTimers.current.set(feedback.key, timer);
    // The operation key is stable across BroadcastChannel/storage/heartbeat clones.
  }, [feedback?.key, visible]);

  const orderSignature = items.map(item => `${item.id}:${item.rank}`).join('|');
  useEffect(() => {
    if (!visible) {
      previousPositions.current = null;
      if (directionTimer.current) clearTimeout(directionTimer.current);
      setDirections({});
      return;
    }
    const next = new Map(items.map((item, index) => [item.id, { index, rank: item.rank }]));
    const previous = previousPositions.current;
    previousPositions.current = next;
    if (!previous) return;
    const changes: Record<string, Direction> = {};
    for (const [id, position] of next) {
      const before = previous.get(id);
      if (!before) continue;
      if (position.index !== before.index) changes[id] = position.index < before.index ? 'up' : 'down';
      else if (position.rank !== before.rank) changes[id] = position.rank < before.rank ? 'up' : 'down';
    }
    if (!Object.keys(changes).length) return;
    if (directionTimer.current) clearTimeout(directionTimer.current);
    setDirections(changes);
    directionTimer.current = setTimeout(() => setDirections({}), FEEDBACK_LIFETIME);
    // The signature includes every visible rank and position, without replaying on unrelated state changes.
  }, [orderSignature, visible]);

  useEffect(() => () => {
    pulseTimers.current.forEach(clearTimeout);
    pulseTimers.current.clear();
    if (directionTimer.current) clearTimeout(directionTimer.current);
  }, []);

  const values = Object.values(scores);
  const hasScores = values.some(score => score !== 0);
  const diverging = visible && state.allowNegative && values.some(score => score < 0);
  const extent = Math.max(1, ...values.map(score => Math.abs(score)));
  const dense = items.length > 12;
  const digits = visible ? Math.max(1, ...values.map(score => String(score).length)) : 1;
  const scoreFontSize = Math.min(dense ? 29 : 40, 142 / (digits * 0.65));
  const scoreWidth = Math.max(dense ? 52 : 70, Math.ceil(digits * scoreFontSize * 0.65) + 8);
  const rootStyle = {
    '--team-bars-count': Math.max(1, items.length),
    '--team-bars-score-width': `${scoreWidth}px`,
    '--team-bars-score-size': `${scoreFontSize}px`,
  } as CSSProperties;

  return <section ref={rootRef} className={`team-bars ${dense ? 'team-bars-dense' : ''} ${reduced ? 'team-bars-reduced' : ''} ${visible ? '' : 'team-bars-hidden'}`} style={rootStyle} aria-labelledby="team-bars-title" data-scores-visible={visible}>
    <header className="team-bars-heading"><h2 id="team-bars-title">总排名</h2><TeamBanterStatus activity={banter} /></header>
    <div className="team-bars-list" role="list" aria-label={visible ? '队伍总积分排名' : '队伍名单，积分已隐藏'}>
      {items.map(item => {
        const score = visible ? item.score : 0;
        const direction = visible ? directions[item.id] : undefined;
        const activePulses = visible ? pulses.filter(pulse => pulse.teamId === item.id) : [];
        const ratio = visible ? Math.min(1, Math.abs(score) / extent) : 0;
        const endpoint = diverging ? 50 + Math.sign(score) * ratio * 50 : ratio * 100;
        const placed = visible && score > 0 && item.rank <= 3;
        const sticker = placed
          ? `/stickers/flower-${item.rank === 1 ? '08' : item.rank === 2 ? '02' : '03'}.png`
          : item.sticker || '/stickers/flower-04.png';
        const MovementIcon = direction === 'up' ? ArrowUp : ArrowDown;
        const isCaster = banter?.casterId === item.id;
        const isHit = banter && banter.kind !== 'celebrate' && (reduced ? banter.targetIds : banter.hitTargetIds).includes(item.id);
        const banterState = isCaster ? banter.kind !== 'celebrate' ? 'casting' : 'celebrate' : isHit ? 'hit' : undefined;

        return <motion.div
          key={item.id}
          className={`team-bars-row stage-team-row ${placed ? `team-bars-place-${item.rank}` : ''}`}
          role="listitem"
          layout={visible && !reduced ? 'position' : false}
          transition={{ layout: { type: 'spring', duration: 0.5, bounce: 0 } }}
          data-team-id={item.id}
          data-score={visible ? score : undefined}
          data-rank={visible && hasScores ? item.rank : undefined}
          data-direction={direction || 'steady'}
        >
          <span className="team-bars-place" aria-label={visible && hasScores ? `第${item.rank}名` : undefined}>
            {visible && hasScores ? String(item.rank).padStart(2, '0') : '—'}
            <AnimatePresence initial={false}>{direction && <motion.span
              className={`team-bars-movement team-bars-movement-${direction}`}
              key={direction}
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.18, ease: EASE_OUT }}
              aria-hidden="true"
            ><MovementIcon size={13} strokeWidth={2.5} /></motion.span>}</AnimatePresence>
          </span>
          <span key={banterState ? `${banter!.id}-${banterState}` : 'avatar'} className={`team-bars-avatar ${isCaster ? `team-banter-caster team-banter-${banterState}` : ''} ${isHit ? 'team-banter-hit' : ''}`} data-testid={isCaster ? `banter-caster-${item.id}` : undefined} data-banter-state={banterState}>
            <img src={appUrl(sticker)} alt="" draggable={false} />
            {isCaster && <TeamBanterAvatarCue activity={banter} />}
          </span>
          <strong className="team-bars-name stage-team-name" title={item.name}>{item.name}</strong>
          <div className={`team-bars-chart ${diverging ? 'team-bars-chart-diverging' : ''}`} aria-hidden="true" data-bar-value={visible ? score : undefined} data-banter-endpoint={endpoint} data-zero-position={visible ? diverging ? '50%' : '0%' : undefined}>
            {visible && <>
              <span className="team-bars-track" />
              {diverging && <span className="team-bars-zero" />}
              <span className={`team-bars-bar-space ${score < 0 ? 'team-bars-bar-negative' : 'team-bars-bar-positive'}`}>
                <motion.span
                  className="team-bars-fill"
                  data-bar-scale={ratio}
                  initial={false}
                  animate={{ transform: `scaleX(${ratio})` }}
                  transition={reduced ? { duration: 0 } : { duration: 0.28, ease: EASE_IN_OUT }}
                  style={{ backgroundColor: score < 0 ? '#a4a4ac' : item.rank === 1 && score > 0 ? '#D9364E' : item.rank <= 3 && score > 0 ? '#8B8B94' : '#C3C3CB', transformOrigin: score < 0 ? 'right center' : 'left center' }}
                />
              </span>
              <span className="team-bars-delta-anchor" style={{ left: `${Math.max(16, Math.min(84, endpoint))}%` }}>
                <AnimatePresence initial={false}>{activePulses.map((pulse, index) => {
                  const offset = (index - (activePulses.length - 1) / 2) * 46;
                  const resting = `translate(calc(-50% + ${offset}px), 0px)`;
                  const displaced = `translate(calc(-50% + ${offset}px), ${reduced ? 0 : 8}px)`;
                  return <motion.span
                    key={`${pulse.key}-${pulse.teamId}`}
                    className={`team-bars-delta ${pulse.delta < 0 ? 'team-bars-delta-negative' : ''}`}
                    data-testid={`delta-${item.id}`}
                    data-feedback-key={pulse.key}
                    initial={{ opacity: 0, transform: displaced }}
                    animate={{ opacity: 1, transform: resting }}
                    exit={{ opacity: 0, transform: displaced }}
                    transition={{ opacity: { duration: 0.18, ease: EASE_OUT }, transform: { duration: reduced ? 0 : 0.18, ease: EASE_OUT } }}
                  >{pulse.delta > 0 ? '+' : '−'}{Math.abs(pulse.delta)}</motion.span>;
                })}</AnimatePresence>
              </span>
            </>}
          </div>
          <span className="team-bars-score stage-team-score">
            {visible ? <NumberFlow value={score} animated={!reduced} format={{ useGrouping: false }} /> : '—'}
          </span>
        </motion.div>;
      })}
    </div>
    <TeamBanterOverlay activity={banter} containerRef={rootRef} reduced={reduced} />
  </section>;
}
