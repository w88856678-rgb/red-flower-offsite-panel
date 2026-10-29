import { appUrl } from '../lib/paths';
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { Crown, Megaphone } from 'lucide-react';
import { getRanking, type ActivityState } from '../lib/model';
import './team-banter.css';

type Feedback = { key: number; changes: Record<string, number> };
type RankedTeam = ReturnType<typeof getRanking>[number];
type AttackSkill = 'combo' | 'laser' | 'meteor';
type Point = { x: number; y: number };
type Flight = { targetId: string; start: Point; control: Point; end: Point };
type BattleGeometry = {
  id: string;
  flights: Flight[];
  region: { left: number; top: number; right: number; bottom: number };
  clip: string;
};

export type BanterActivity = {
  id: string;
  context: string;
  casterId: string;
  casterName: string;
  kind: 'celebrate' | 'attack' | 'challenge';
  skill: AttackSkill;
  targetIds: string[];
  hitTargetIds: string[];
  source: 'manual' | 'automatic';
  tied: boolean;
  phase: 'celebrate' | 'casting' | 'hit';
  endsAt: number;
};

const CELEBRATE_LIFETIME = 2100;
const CHALLENGE_TIMING = { lifetime: 2500, hitAt: 950 };
const ATTACK_TIMING = {
  combo: { lifetime: 2600, hitAt: 1310 },
  laser: { lifetime: 2500, hitAt: 920 },
  meteor: { lifetime: 2700, hitAt: 1210 },
} as const;
const SKILL_LABELS: Record<AttackSkill, string> = { combo: '花花连击', laser: '花花激光', meteor: '大花陨石' };
const FLIGHT_DELAY = 350;
const FLIGHT_DURATION = 600;
// Three targets form one wave; even a full 20-team board finishes promptly.
const targetDelay = (index: number) => Math.floor(index / 3) * 90 + index % 3 * 45;
const FLIGHT_EASING = 'cubic-bezier(0.77, 0, 0.175, 1)';

function snapshot(items: RankedTeam[]) {
  return {
    scores: Object.fromEntries(items.map(item => [item.id, item.score])),
    leaders: new Set(items.filter(item => item.rank === 1 && item.score > 0).map(item => item.id)),
  };
}

function validCaster(activity: BanterActivity, items: RankedTeam[]) {
  const caster = items.find(item => item.id === activity.casterId);
  if (activity.kind !== 'challenge') return Boolean(caster && caster.rank === 1 && caster.score > 0);
  const leader = items.find(item => item.rank === 1 && item.score > 0);
  return Boolean(caster && caster.rank > 3 && leader && activity.targetIds[0] === leader.id);
}

/** Keep score baselines separate from feedback: Stage publishes feedback one render later. */
export function useTeamBanter(state: ActivityState, feedback: Feedback | null) {
  const items = getRanking(state);
  const allowed = state.scoresVisible && state.banterEnabled && !state.reducedMotion && (state.scene === 'game' || state.scene === 'leaderboard');
  const context = `${state.scene}:${state.gameId}:${state.scoresVisible}:${state.banterEnabled}:${state.reducedMotion}`;
  const signature = items.map(item => `${item.id}:${item.score}:${item.rank}`).join('|');
  const order = items.map(item => item.id).join('|');
  const [activity, setActivity] = useState<BanterActivity | null>(null);
  const active = useRef<BanterActivity | null>(null);
  const previousContext = useRef(context);
  const baseline = useRef(snapshot(items));
  const previousSignature = useRef(signature);
  const previousOrder = useRef(order);
  const pendingEntrants = useRef<string[]>([]);
  const seenFeedback = useRef(feedback?.key ?? null);
  // A persisted cue is already consumed when this display mounts or refreshes.
  const consumedCues = useRef(new Set(state.banterCue ? [state.banterCue.id] : []));
  const newestCueRevision = useRef(state.revision);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useLayoutEffect(() => {
    const rememberCue = (id: string) => {
      consumedCues.current.add(id);
      newestCueRevision.current = Math.max(newestCueRevision.current, state.revision);
      if (consumedCues.current.size > 64) {
        const oldest = consumedCues.current.values().next().value;
        if (oldest !== undefined) consumedCues.current.delete(oldest);
      }
    };
    const stop = () => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
      active.current = null;
      setActivity(null);
    };
    const start = (next: BanterActivity) => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
      active.current = next;
      setActivity(next);
      if (next.kind !== 'celebrate') {
        next.targetIds.forEach((targetId, index) => {
          timers.current.push(setTimeout(() => {
            const current = active.current;
            if (current?.id !== next.id) return;
            const hit = { ...current, phase: 'hit' as const, hitTargetIds: [...current.hitTargetIds, targetId] };
            active.current = hit;
            setActivity(hit);
          }, (next.kind === 'challenge' ? CHALLENGE_TIMING.hitAt : ATTACK_TIMING[next.skill].hitAt) + targetDelay(index)));
        });
      }
      timers.current.push(setTimeout(() => {
        if (active.current?.id === next.id) stop();
      }, Math.max(0, next.endsAt - Date.now())));
    };

    if (previousContext.current !== context) {
      previousContext.current = context;
      baseline.current = snapshot(items);
      previousSignature.current = signature;
      previousOrder.current = order;
      pendingEntrants.current = [];
      seenFeedback.current = feedback?.key ?? null;
      if (state.banterCue) rememberCue(state.banterCue.id);
      stop();
      return;
    }

    const orderChanged = previousOrder.current !== order;
    previousOrder.current = order;
    // Flights keep one measured destination. A rank swap cancels that cast before
    // it can hit the old row, while ordinary score changes can finish normally.
    if (orderChanged && active.current && active.current.kind !== 'celebrate') stop();

    if (signature !== previousSignature.current) {
      const previous = baseline.current;
      pendingEntrants.current = items.filter(item => item.rank === 1 && item.score > 0
        && !previous.leaders.has(item.id) && item.score > (previous.scores[item.id] ?? 0)).map(item => item.id);
      baseline.current = snapshot(items);
      previousSignature.current = signature;
    }

    const cue = state.banterCue;
    // Remember only 64 cue IDs; revisions also reject delayed transports of an
    // older, evicted cue after a long run of uninterrupted button presses.
    const manual = cue && !consumedCues.current.has(cue.id) && state.revision >= newestCueRevision.current ? cue : null;
    if (manual) rememberCue(manual.id);
    const newFeedback = feedback && seenFeedback.current !== feedback.key ? feedback : null;
    if (newFeedback) seenFeedback.current = newFeedback.key;

    if (!allowed) {
      pendingEntrants.current = [];
      stop();
      return;
    }
    if (active.current && !validCaster(active.current, items)) stop();

    const now = Date.now();
    const leaders = items.filter(item => item.rank === 1 && item.score > 0);
    if (manual) {
      pendingEntrants.current = [];
      const age = now - manual.at;
      const kind = manual.kind === 'challenge' ? 'challenge' : manual.kind === 'attack' ? 'attack' : 'celebrate';
      const caster = kind === 'challenge' ? items.find(item => item.id === manual.teamId && item.rank > 3) : leaders[0];
      if (age < 0 || age > 6000 || !caster || caster.id !== manual.teamId) return;
      const rawSkill = 'skill' in manual ? manual.skill : undefined;
      const skill: AttackSkill = rawSkill === 'laser' || rawSkill === 'meteor' ? rawSkill : 'combo';
      const targets = kind === 'challenge'
        ? leaders[0] && manual.targetIds?.length === 1 && manual.targetIds[0] === leaders[0].id ? [leaders[0].id] : []
        : kind === 'attack'
        ? items.filter(item => item.id !== caster.id && manual.targetIds?.includes(item.id)).map(item => item.id)
        : [];
      if (kind !== 'celebrate' && !targets.length) return;
      start({
        id: manual.id, context, casterId: caster.id, casterName: caster.name, kind, skill, targetIds: targets, hitTargetIds: [],
        source: 'manual', tied: leaders.length > 1, phase: kind !== 'celebrate' ? 'casting' : 'celebrate',
        endsAt: now + (kind === 'challenge' ? CHALLENGE_TIMING.lifetime : kind === 'attack' ? ATTACK_TIMING[skill].lifetime + targetDelay(targets.length - 1) : CELEBRATE_LIFETIME),
      });
      return;
    }

    if (!newFeedback) return;
    const entrants = pendingEntrants.current;
    pendingEntrants.current = [];
    // A score update may arrive during a manual cast; it must never replace that cast.
    if (active.current?.source === 'manual' && active.current.endsAt > now) return;
    const caster = leaders.find(item => entrants.includes(item.id) && newFeedback.changes[item.id] > 0);
    if (!caster) return;
    start({
      id: `leader-${newFeedback.key}-${caster.id}`, context, casterId: caster.id, casterName: caster.name,
      kind: 'celebrate', skill: 'combo', targetIds: [], hitTargetIds: [], source: 'automatic', tied: leaders.length > 1, phase: 'celebrate',
      endsAt: now + CELEBRATE_LIFETIME,
    });
  }, [signature, feedback?.key, context, state.banterCue?.id]);

  useEffect(() => () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);

  // Invalid contexts, lost leads and attack rank swaps hide in the same render,
  // before effect cleanup cancels the underlying timers.
  const casterEligible = activity && validCaster(activity, items);
  const orderStable = !activity || activity.kind === 'celebrate' || previousOrder.current === order;
  return allowed && activity?.context === context && casterEligible && orderStable ? activity : null;
}

export function TeamBanterAvatarCue({ activity }: { activity: BanterActivity }) {
  const message = activity.kind === 'challenge' ? '别急，我们在憋大的' : activity.kind === 'attack' ? '你们也不行呀' : activity.source === 'automatic' && activity.tied ? '并列领跑' : activity.source === 'automatic' ? '登顶啦' : '还有谁！';
  const Icon = activity.kind === 'challenge' ? Megaphone : Crown;
  return <>
    <Icon className="team-banter-crown" size={26} strokeWidth={1.7} aria-hidden="true" />
    <span className={`team-banter-bubble ${activity.kind === 'challenge' ? 'team-banter-bubble-challenge' : ''}`}>{message}</span>
  </>;
}

export function TeamBanterStatus({ activity }: { activity: BanterActivity | null }) {
  return <span className="team-banter-status" role="status" aria-live="polite" aria-atomic="true">
    {activity && <span key={activity.id}>{activity.casterName}<i aria-hidden="true">·</i>{activity.kind === 'challenge' ? '后排叫阵' : activity.kind === 'attack' ? SKILL_LABELS[activity.skill] : activity.tied && activity.source === 'automatic' ? '并列领跑' : '先领跑啦'}</span>}
  </span>;
}

// offset positions intentionally ignore the temporary transform used for rank swapping.
function localBox(element: HTMLElement, root: HTMLElement) {
  let x = 0;
  let y = 0;
  let current: HTMLElement | null = element;
  while (current && current !== root) {
    x += current.offsetLeft;
    y += current.offsetTop;
    current = current.offsetParent as HTMLElement | null;
  }
  return { x, y, width: element.offsetWidth, height: element.offsetHeight };
}

function FlowerProjectile({ flight, index, shot = 0, skill }: { flight: Flight; index: number; shot?: number; skill: 'combo' | 'meteor' | 'challenge' }) {
  const ref = useRef<HTMLImageElement>(null);
  const size = skill === 'meteor' ? 92 : skill === 'challenge' ? 32 : 44;
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const frames = Array.from({ length: 17 }, (_, index) => {
      const t = index / 16;
      const inverse = 1 - t;
      const x = inverse * inverse * flight.start.x + 2 * inverse * t * flight.control.x + t * t * flight.end.x;
      const y = inverse * inverse * flight.start.y + 2 * inverse * t * flight.control.y + t * t * flight.end.y;
      return {
        offset: t,
        opacity: t === 0 || t === 1 ? 0 : 1,
        transform: `translate(${x - size / 2}px, ${y - size / 2}px) rotate(${t * (skill === 'meteor' ? 240 : 150) - 20}deg)`,
      };
    });
    const animation = element.animate(frames, {
      duration: skill === 'meteor' ? 720 : FLIGHT_DURATION,
      delay: FLIGHT_DELAY + targetDelay(index) + shot * 140,
      easing: FLIGHT_EASING, fill: 'both',
    });
    return () => animation.cancel();
  }, [flight, index, shot, skill, size]);
  return <img ref={ref} className={`team-banter-projectile team-banter-projectile-${skill}`} style={{ width: size, height: size }} src={appUrl('stickers/flower-01.png')} alt="" draggable={false} data-testid="banter-projectile" data-target-id={flight.targetId} data-projectile-shot={shot + 1} />;
}

function FlowerBeam({ flight, index }: { flight: Flight; index: number }) {
  const dx = flight.end.x - flight.start.x;
  const dy = flight.end.y - flight.start.y;
  return <span className="team-banter-beam" style={{ left: flight.start.x, top: flight.start.y, width: Math.hypot(dx, dy), transform: `rotate(${Math.atan2(dy, dx)}rad)` }} data-testid="banter-beam" data-target-id={flight.targetId}>
    <span className="team-banter-beam-body" style={{ animationDelay: `${FLIGHT_DELAY + targetDelay(index)}ms` }}><span className="team-banter-beam-glow" /><span className="team-banter-beam-core" /></span>
  </span>;
}

function FlowerPetals({ skill }: { skill: AttackSkill | 'challenge' }) {
  const count = skill === 'challenge' ? 3 : skill === 'meteor' ? 10 : skill === 'combo' ? 7 : 5;
  const radius = skill === 'challenge' ? 30 : skill === 'meteor' ? 70 : skill === 'combo' ? 48 : 42;
  return <>{Array.from({ length: count }, (_, index) => {
    const angle = index / count * Math.PI * 2 - Math.PI / 2;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    return <Petal key={index} x={x} y={y} index={index} large={skill === 'meteor'} />;
  })}</>;
}

function Petal({ x, y, index, large }: { x: number; y: number; index: number; large: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const animation = element.animate([
      { opacity: 0, transform: 'translate(-50%, -50%) scale(.95) rotate(0deg)', offset: 0 },
      { opacity: 1, transform: `translate(calc(-50% + ${x * .45}px), calc(-50% + ${y * .45}px)) scale(1) rotate(${index * 31}deg)`, offset: .24 },
      { opacity: .9, transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y}px)) scale(1) rotate(${index * 58}deg)`, offset: .6 },
      { opacity: 0, transform: `translate(calc(-50% + ${x * 1.12}px), calc(-50% + ${y + 18}px)) scale(.95) rotate(${index * 72}deg)`, offset: 1 },
    ], { duration: large ? 1050 : 850, delay: index % 3 * 35, easing: 'cubic-bezier(0.23, 1, 0.32, 1)', fill: 'both' });
    return () => animation.cancel();
  }, [x, y, index, large]);
  return <span ref={ref} className={`team-banter-petal ${large ? 'team-banter-petal-large' : ''}`} />;
}

export function TeamBanterOverlay({ activity, containerRef, reduced }: {
  activity: BanterActivity | null;
  containerRef: RefObject<HTMLElement | null>;
  reduced: boolean;
}) {
  const [geometry, setGeometry] = useState<BattleGeometry | null>(null);

  useLayoutEffect(() => {
    if (!activity || activity.kind === 'celebrate' || !containerRef.current) {
      setGeometry(null);
      return;
    }
    const root = containerRef.current;
    const charts = new Map(Array.from(root.querySelectorAll<HTMLElement>('.team-bars-row')).map(row => [row.dataset.teamId, row.querySelector<HTMLElement>('.team-bars-chart')]));
    const caster = charts.get(activity.casterId);
    if (!caster) return;
    const casterBox = localBox(caster, root);
    const list = root.querySelector<HTMLElement>('.team-bars-list');
    const listBox = list ? localBox(list, root) : { y: 65, height: root.offsetHeight - 65 };
    const region = { left: casterBox.x, top: listBox.y, right: casterBox.x + casterBox.width, bottom: listBox.y + listBox.height };
    const clampX = (x: number, margin: number) => Math.max(region.left + margin, Math.min(region.right - margin, x));
    const meteor = activity.kind === 'attack' && activity.skill === 'meteor';
    const margin = meteor ? 48 : 22;
    const endpoint = (element: HTMLElement) => {
      const box = localBox(element, root);
      const value = Number(element.dataset.banterEndpoint) || 0;
      return {
        x: clampX(box.x + box.width * value / 100, margin),
        y: box.y + box.height / 2,
        left: box.x + margin,
        right: box.x + box.width - margin,
      };
    };
    const start = endpoint(caster);
    const flights = activity.targetIds.flatMap((targetId, index) => {
      const chart = charts.get(targetId);
      if (!chart) return [];
      const end = endpoint(chart);
      const origin = meteor ? { x: clampX(end.x + 130 - index * 60, 48), y: region.top + 48 } : start;
      return [{ targetId, start: origin, end, control: {
        x: Math.max(start.left, Math.min(start.right, (start.x + end.x) / 2 + 48 + index * 20)),
        y: meteor ? region.top + 28 : Math.max(region.top + 24, start.y - 48 - index * 24),
      } }];
    });
    setGeometry({ id: activity.id, flights, region, clip: `inset(${region.top}px ${Math.max(0, root.offsetWidth - region.right)}px ${Math.max(0, root.offsetHeight - region.bottom)}px ${region.left}px)` });
  }, [activity?.id, containerRef]);

  if (!activity) return null;
  const current = geometry?.id === activity.id ? geometry : null;
  const flights = current?.flights ?? [];
  const visualSkill = activity.kind === 'challenge' ? 'challenge' : activity.skill;
  return <div key={activity.id} className={`team-banter-overlay team-banter-skill-${visualSkill} ${reduced ? 'team-banter-reduced' : ''}`} data-testid="banter-overlay" data-banter-id={activity.id} data-banter-kind={activity.kind} data-banter-skill={activity.kind !== 'celebrate' ? visualSkill : undefined} aria-hidden="true">
    {activity.kind !== 'celebrate' && <div className="team-banter-battlefield" style={{ clipPath: current?.clip }}>
      {!reduced && <>
        {visualSkill === 'challenge' && flights.map((flight, index) => <FlowerProjectile key={`${activity.id}-${flight.targetId}`} flight={flight} index={index} skill="challenge" />)}
        {visualSkill === 'combo' && <>
          <svg key={`${activity.id}-trails`} className="team-banter-trails" width="100%" height="100%">
            {flights.map(flight => <path key={flight.targetId} d={`M ${flight.start.x} ${flight.start.y} Q ${flight.control.x} ${flight.control.y} ${flight.end.x} ${flight.end.y}`} />)}
          </svg>
          {flights.flatMap((flight, index) => [0, 1, 2].map(shot => <FlowerProjectile key={`${activity.id}-${flight.targetId}-${shot}`} flight={flight} index={index} shot={shot} skill="combo" />))}
        </>}
        {visualSkill === 'laser' && <>
          {flights[0] && <span className="team-banter-charge" style={{ left: flights[0].start.x, top: flights[0].start.y }}><span /><img src={appUrl('stickers/flower-01.png')} alt="" /></span>}
          {flights.map((flight, index) => <FlowerBeam key={`${activity.id}-${flight.targetId}`} flight={flight} index={index} />)}
        </>}
        {visualSkill === 'meteor' && flights.map((flight, index) => <FlowerProjectile key={`${activity.id}-${flight.targetId}`} flight={flight} index={index} skill="meteor" />)}
      </>}
      {flights.filter(flight => reduced || activity.hitTargetIds.includes(flight.targetId)).map(flight => <span key={`${activity.id}-${flight.targetId}-hit`} className="team-banter-target-cue" style={{ left: reduced && current ? Math.max(current.region.left + 76, Math.min(current.region.right - 76, flight.end.x)) : flight.end.x, top: flight.end.y }} data-target-id={flight.targetId} data-banter-state="hit">
        {reduced ? <span className="team-banter-static-hit">{activity.kind === 'challenge' ? '收到叫阵' : '你们也不行呀'}</span> : <>
          <span className="team-banter-hit-ring" />
          {visualSkill === 'laser' && <span className="team-banter-hit-ring team-banter-hit-ring-echo" />}
          <FlowerPetals skill={visualSkill} />
          <span className="team-banter-star team-banter-star-one">✦</span><span className="team-banter-star team-banter-star-two">✦</span><span className="team-banter-star team-banter-star-three">✦</span>
        </>}
      </span>)}
    </div>}
  </div>;
}
