export type GameId = 'music' | 'garden' | 'lyrics' | 'free';
export type Scene = 'welcome' | 'game' | 'leaderboard' | 'podium' | 'mvp';
export type BanterKind = 'celebrate' | 'attack' | 'challenge';
export type AttackSkill = 'combo' | 'laser' | 'meteor';

export interface BanterCue {
  id: string;
  at: number;
  teamId: string;
  kind?: BanterKind;
  targetIds?: string[];
  skill?: AttackSkill;
}

export interface Team {
  id: string;
  name: string;
  color: string;
  sticker: string;
}

export interface ScoreEvent {
  id: string;
  at: number;
  gameId: GameId;
  round: number;
  label: string;
  changes: { teamId: string; delta: number }[];
  undone: boolean;
  settlementKey?: string;
}

export interface Member {
  id: string;
  name: string;
  teamId: string | null;
  externalId: string;
}

export interface NormalizedRosterRow {
  name: string;
  teamId: string | null;
  externalId: string;
}

export interface IndividualScoreEvent {
  id: string;
  at: number;
  gameId: GameId;
  label: string;
  memberId: string;
  delta: number;
  undone: boolean;
}

export interface ActivityState {
  schemaVersion: 1;
  revision: number;
  title: string;
  teams: Team[];
  events: ScoreEvent[];
  gameId: GameId;
  round: number;
  question: number;
  doublePoints: boolean;
  topic: string;
  answer: string;
  showAnswer: boolean;
  scene: Scene;
  scoresVisible: boolean;
  timer: { duration: number; endsAt: number | null; remaining: number };
  podiumRevealed: number;
  muted: boolean;
  reducedMotion: boolean;
  allowNegative: boolean;
  eliminatedIds: string[];
  mvpName: string;
  banterEnabled: boolean;
  banterCue: BanterCue | null;
  members: Member[];
  individualEvents: IndividualScoreEvent[];
  awardMode: 'team' | 'individual';
}

export const GAME_CONFIG: Record<GameId, {
  name: string;
  shortName: string;
  rounds: number;
  seconds: number;
  description: string;
  topics: string[];
}> = {
  music: {
    name: '听前奏猜歌', shortName: '猜歌', rounds: 25, seconds: 5,
    description: '听 3–5 秒歌曲前奏，答对 +1 分，双倍题 +2 分。答错后开放其他队抢答。',
    topics: ['听前奏，猜歌名', '经典金曲', '青春回忆', '全场一起唱'],
  },
  garden: {
    name: '逛三园', shortName: '逛三园', rounds: 3, seconds: 3,
    description: '依次说出主题词语，重复、答非所问或超过 3 秒即淘汰。每轮前三名分别 +3、+2、+1 分。',
    topics: ['水果园', '动物园', '蔬菜园', '零食园'],
  },
  lyrics: {
    name: '歌词接龙', shortName: '接歌词', rounds: 5, seconds: 5,
    description: '唱出包含关键词的完整一句歌词，重复歌曲或 5 秒内未起唱即淘汰。每轮前三名分别 +3、+2、+1 分。',
    topics: ['今天', '好', '爱', '一起', '快乐'],
  },
  free: {
    name: '自由计分', shortName: '自由计分', rounds: 99, seconds: 30,
    description: '按现场约定手动加减分，支持自定义分值。所有积分操作均可查看和撤销。',
    topics: ['逢七过', '手口不一', '加赛时刻', '团队挑战'],
  },
};

const GAME_IDS: GameId[] = ['music', 'garden', 'lyrics', 'free'];
const SCENES: Scene[] = ['welcome', 'game', 'leaderboard', 'podium', 'mvp'];
const SCORE_LIMIT = 1_000_000_000;
const DELTA_LIMIT = 1_000_000;
const MAX_EVENTS = 20_000;
const ATTACK_SKILLS: AttackSkill[] = ['combo', 'laser', 'meteor'];

export function createInitialState(demo = false): ActivityState {
  const colors = ['#F5223C', '#EA8B20', '#6D59D9', '#339E86', '#4278D4', '#D9578B', '#C6A124', '#5792A4', '#A36BCC', '#8F9D43'];
  const names = ['第一小队', '第二小队', '第三小队', '第四小队', '第五小队', '第六小队', '第七小队', '第八小队', '第九小队', '第十小队'];
  const stickers = [1, 4, 8, 3, 10, 6, 2, 4, 1, 8];
  const teams = names.map((name, i) => ({ id: `team-${i + 1}`, name, color: colors[i], sticker: `/stickers/flower-${String(stickers[i]).padStart(2, '0')}.png` }));
  const state: ActivityState = {
    schemaVersion: 1,
    revision: 0,
    title: '小红花欢乐赛',
    teams,
    events: [],
    gameId: 'music',
    round: 1,
    question: 1,
    doublePoints: false,
    topic: '听前奏，猜歌名',
    answer: '',
    showAnswer: false,
    scene: 'leaderboard',
    scoresVisible: true,
    timer: { duration: 3, endsAt: null, remaining: 3 },
    podiumRevealed: 0,
    muted: true,
    reducedMotion: false,
    allowNegative: false,
    eliminatedIds: [],
    mvpName: '',
    banterEnabled: true,
    banterCue: null,
    members: [],
    individualEvents: [],
    awardMode: 'team',
  };
  if (demo) {
    const demoScores = [18, 15, 12, 11, 10, 9, 8, 7, 5, 3];
    state.events = [{
      id: 'demo-opening-scores', at: Date.now(), gameId: 'music', round: 1,
      label: '演示数据（不计入正式活动）', undone: false,
      changes: teams.map((team, i) => ({ teamId: team.id, delta: demoScores[i] })),
    }];
    const memberNames = ['小花甲', '小花乙', '小花丙', '小花丁', '小花戊', '小花己', '小花庚', '小花辛', '小花壬', '小花癸', '小花子', '小花丑'];
    state.members = memberNames.map((name, i) => ({ id: `demo-member-${i + 1}`, name, teamId: teams[i % teams.length].id, externalId: `DEMO-${i + 1}` }));
    state.individualEvents = state.members.map<IndividualScoreEvent>((member, i) => ({
      id: `demo-individual-${i + 1}`, at: state.events[0].at + i + 1, gameId: 'music',
      label: '虚构人员演示积分', memberId: member.id, delta: [9, 7, 5, 4, 3, 2, 1, 1, 0, 0, 0, 0][i], undone: false,
    })).filter(event => event.delta !== 0);
  }
  return state;
}

export function getScores(state: ActivityState): Record<string, number> {
  const scores: Record<string, number> = Object.create(null);
  for (const team of state.teams) scores[team.id] = 0;
  for (const event of state.events) {
    if (event.undone) continue;
    for (const change of event.changes) {
      if (Object.hasOwn(scores, change.teamId)) scores[change.teamId] += change.delta;
    }
  }
  return scores;
}

export function getRanking(state: ActivityState): Array<Team & { score: number; rank: number }> {
  const scores = getScores(state);
  const sorted = state.teams.map((team, index) => ({ ...team, score: scores[team.id] || 0, index }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
  let rank = 0;
  return sorted.map(({ index: _index, ...team }, i) => {
    if (i === 0 || team.score !== sorted[i - 1].score) rank = i + 1;
    return { ...team, rank };
  });
}

export interface BanterOptions {
  leader: ReturnType<typeof getRanking>[number] | null;
  targets: ReturnType<typeof getRanking>;
  canCelebrate: boolean;
  canAttack: boolean;
  challengers: ReturnType<typeof getRanking>;
  canChallenge: boolean;
}

export function getBanterOptions(state: ActivityState): BanterOptions {
  const ranking = getRanking(state);
  const leader = ranking.find(team => team.score > 0 && team.rank === 1) || null;
  const targets = leader ? ranking.filter(team => team.id !== leader.id) : [];
  const challengers = ranking.filter(team => team.rank > 3);
  const available = (state.scene === 'game' || state.scene === 'leaderboard')
    && state.scoresVisible && state.banterEnabled && !state.reducedMotion && leader !== null;
  return { leader, targets, challengers, canCelebrate: available, canAttack: available && targets.length > 0, canChallenge: available && challengers.length > 0 };
}

export function triggerBanter(state: ActivityState, kind: 'celebrate' | 'attack'): ActivityState {
  const options = getBanterOptions(state);
  if (!options.leader || (kind !== 'celebrate' && kind !== 'attack')
    || !(kind === 'celebrate' ? options.canCelebrate : options.canAttack)) return state;
  const previousSkill = state.banterCue?.skill;
  const skill = kind === 'attack'
    ? ATTACK_SKILLS[(ATTACK_SKILLS.indexOf(previousSkill as AttackSkill) + 1) % ATTACK_SKILLS.length]
    : previousSkill;
  const banterCue: BanterCue = {
    id: eventId(), at: Date.now(), teamId: options.leader.id, kind,
    ...(kind === 'attack' ? { targetIds: options.targets.map(team => team.id) } : {}),
    ...(skill !== undefined ? { skill } : {}),
  };
  return updateState(state, { banterCue });
}

export function triggerChallenge(state: ActivityState, teamId: string): ActivityState {
  const options = getBanterOptions(state);
  if (!options.canChallenge || !options.leader || !options.challengers.some(team => team.id === teamId)) return state;
  return updateState(state, { banterCue: {
    id: eventId(), at: Date.now(), teamId, kind: 'challenge', targetIds: [options.leader.id],
    ...(state.banterCue?.skill !== undefined ? { skill: state.banterCue.skill } : {}),
  } });
}

export function getIndividualScores(state: ActivityState): Record<string, number> {
  const scores: Record<string, number> = Object.create(null);
  for (const member of state.members) scores[member.id] = 0;
  for (const event of state.individualEvents) {
    if (!event.undone && Object.hasOwn(scores, event.memberId)) scores[event.memberId] += event.delta;
  }
  return scores;
}

export function getIndividualRanking(state: ActivityState): Array<Member & { score: number; rank: number; teamName: string }> {
  const scores = getIndividualScores(state);
  const teamNames = new Map(state.teams.map(team => [team.id, team.name]));
  const sorted = state.members.map((member, index) => ({ ...member, score: scores[member.id] || 0, index }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
  let rank = 0;
  return sorted.map(({ index: _index, ...member }, i) => {
    if (i === 0 || member.score !== sorted[i - 1].score) rank = i + 1;
    return { ...member, rank, teamName: member.teamId ? teamNames.get(member.teamId) || '未分组' : '未分组' };
  });
}

function eventId(): string {
  return globalThis.crypto?.randomUUID?.() || `score-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// 两种计分使用同一递增时间线，保证同一毫秒内的操作也可准确撤销。
function eventTime(state: ActivityState): number {
  let latest = 0;
  for (const event of state.events) latest = Math.max(latest, event.at);
  for (const event of state.individualEvents) latest = Math.max(latest, event.at);
  return Math.max(Date.now(), latest + 1);
}

export function addIndividualScore(state: ActivityState, memberId: string, delta: number, label: string): ActivityState {
  if (state.individualEvents.length >= MAX_EVENTS || !Number.isSafeInteger(delta) || Math.abs(delta) > DELTA_LIMIT) return state;
  const scores = getIndividualScores(state);
  if (!Object.hasOwn(scores, memberId)) return state;
  const nextScore = state.allowNegative ? scores[memberId] + delta : Math.max(0, scores[memberId] + delta);
  if (!Number.isSafeInteger(nextScore) || Math.abs(nextScore) > SCORE_LIMIT) return state;
  const actualDelta = nextScore - scores[memberId];
  if (actualDelta === 0) return state;
  const event: IndividualScoreEvent = {
    id: eventId(), at: eventTime(state), gameId: state.gameId,
    label: String(label || '个人计分').slice(0, 120), memberId, delta: actualDelta, undone: false,
  };
  return updateState(state, { individualEvents: [...state.individualEvents, event] });
}

export function updateState(state: ActivityState, patch: Partial<ActivityState>): ActivityState {
  return { ...state, ...patch, schemaVersion: 1, revision: state.revision + 1 };
}

export function addScore(
  state: ActivityState,
  changes: { teamId: string; delta: number }[],
  label: string,
  settlementKey?: string,
): ActivityState {
  if (!Array.isArray(changes) || changes.length === 0 || changes.length > 100 || state.events.length >= MAX_EVENTS) return state;
  if (settlementKey && state.events.some(event => !event.undone && event.settlementKey === settlementKey)) return state;
  const scores = getScores(state);
  const combined = new Map<string, number>();
  for (const change of changes) {
    if (!change || !Object.hasOwn(scores, change.teamId) || !Number.isSafeInteger(change.delta) || Math.abs(change.delta) > DELTA_LIMIT) return state;
    combined.set(change.teamId, (combined.get(change.teamId) || 0) + change.delta);
  }
  const applied: ScoreEvent['changes'] = [];
  for (const [teamId, delta] of combined) {
    if (Math.abs(delta) > DELTA_LIMIT) return state;
    const next = state.allowNegative ? scores[teamId] + delta : Math.max(0, scores[teamId] + delta);
    if (!Number.isSafeInteger(next) || Math.abs(next) > SCORE_LIMIT) return state;
    const actualDelta = next - scores[teamId];
    if (actualDelta !== 0) applied.push({ teamId, delta: actualDelta });
  }
  if (applied.length === 0) return state;
  const event: ScoreEvent = {
    id: eventId(),
    at: eventTime(state), gameId: state.gameId, round: state.round,
    label: String(label || '手动计分').slice(0, 120), changes: applied, undone: false,
    ...(settlementKey ? { settlementKey: settlementKey.slice(0, 120) } : {}),
  };
  return updateState(state, { events: [...state.events, event] });
}

export function undoLast(state: ActivityState): ActivityState {
  let index = state.events.length - 1;
  while (index >= 0 && state.events[index].undone) index -= 1;
  if (index < 0) return state;
  const next = updateState(state, { events: state.events.map((event, i) => i === index ? { ...event, undone: true } : event) });
  if (!state.allowNegative && Object.values(getScores(next)).some(score => score < 0)) return state;
  return next;
}

export function undoLatest(state: ActivityState): ActivityState {
  let latest: { kind: 'team' | 'individual'; index: number; at: number; id: string } | null = null;
  const inspect = (event: ScoreEvent | IndividualScoreEvent, index: number, kind: 'team' | 'individual') => {
    if (event.undone) return;
    if (!latest || event.at > latest.at || (event.at === latest.at && event.id.localeCompare(latest.id) > 0)) latest = { kind, index, at: event.at, id: event.id };
  };
  state.events.forEach((event, index) => inspect(event, index, 'team'));
  state.individualEvents.forEach((event, index) => inspect(event, index, 'individual'));
  // 回调内的赋值无法被 TypeScript 控制流分析追踪。
  const target = latest as { kind: 'team' | 'individual'; index: number } | null;
  if (!target) return state;
  const next = target.kind === 'team'
    ? updateState(state, { events: state.events.map((event, index) => index === target.index ? { ...event, undone: true } : event) })
    : updateState(state, { individualEvents: state.individualEvents.map((event, index) => index === target.index ? { ...event, undone: true } : event) });
  if (!state.allowNegative && [...Object.values(getScores(next)), ...Object.values(getIndividualScores(next))].some(score => score < 0)) return state;
  return next;
}

export function normalizeRosterName(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim();
}

export function rosterIdentity(row: Pick<NormalizedRosterRow, 'name' | 'teamId'>): string {
  return JSON.stringify([normalizeRosterName(row.name).toLocaleLowerCase('en-US'), row.teamId]);
}

export function hasRosterFormula(value: string): boolean {
  return /^[=+@]/.test(value.trim()) || /^-\s*(?:[a-zA-Z_][\w.]*\s*\(|[^\r\n]*\|)/.test(value.trim());
}

export function mergeRoster(state: ActivityState, rows: NormalizedRosterRow[]): { state: ActivityState; added: number; matched: number } {
  if (!Array.isArray(rows) || rows.length > 1000) throw new Error('一次最多导入 1000 位成员。');
  if (!rows.length) return { state, added: 0, matched: 0 };
  const teamIds = new Set(state.teams.map(team => team.id));
  const normalized = rows.map((row, i) => {
    if (!row || typeof row.name !== 'string' || typeof row.externalId !== 'string' || (row.teamId !== null && typeof row.teamId !== 'string')) throw new Error(`第 ${i + 1} 行名单格式无效。`);
    const name = normalizeRosterName(row.name);
    const externalId = row.externalId.normalize('NFKC').trim();
    if (!name || name.length > 40 || externalId.length > 80 || /[\u0000-\u001f\u007f]/.test(name + externalId)) throw new Error(`第 ${i + 1} 行姓名或工号无效。`);
    if (hasRosterFormula(name) || hasRosterFormula(externalId)) throw new Error(`第 ${i + 1} 行包含公式，请改为纯文本。`);
    if (row.teamId !== null && !teamIds.has(row.teamId)) throw new Error(`第 ${i + 1} 行小组不存在。`);
    return { name, teamId: row.teamId, externalId };
  });
  const incomingIds = new Map<string, NormalizedRosterRow>();
  const incomingNames = new Map<string, { count: number; withoutId: boolean; name: string }>();
  for (const row of normalized) {
    const identity = rosterIdentity(row);
    const nameGroup = incomingNames.get(identity);
    incomingNames.set(identity, { count: (nameGroup?.count || 0) + 1, withoutId: Boolean(nameGroup?.withoutId || !row.externalId), name: row.name });
    if (row.externalId) {
      const prior = incomingIds.get(row.externalId);
      if (prior && (rosterIdentity(prior) !== rosterIdentity(row))) throw new Error(`工号 ${row.externalId} 对应多条不同名单，请先核对。`);
      incomingIds.set(row.externalId, row);
    }
  }
  for (const group of incomingNames.values()) {
    if (group.count > 1 && group.withoutId) throw new Error(`“${group.name}”在同组重复且缺少工号，请补充不同工号。`);
  }
  const members = state.members.map(member => ({ ...member }));
  const membersById = new Map<string, Member[]>();
  const membersByName = new Map<string, Member[]>();
  const indexMember = (member: Member) => {
    if (member.externalId) membersById.set(member.externalId, [...(membersById.get(member.externalId) || []), member]);
    const identity = rosterIdentity(member);
    membersByName.set(identity, [...(membersByName.get(identity) || []), member]);
  };
  for (const member of members) indexMember(member);
  let added = 0;
  let matched = 0;
  let changed = false;
  for (const row of normalized) {
    let match: Member | undefined;
    if (row.externalId) {
      const found = membersById.get(row.externalId) || [];
      if (found.length > 1) throw new Error(`工号 ${row.externalId} 在现有名单重复，请先核对。`);
      match = found[0];
      if (match && normalizeRosterName(match.name).toLocaleLowerCase('en-US') !== row.name.toLocaleLowerCase('en-US')) throw new Error(`工号 ${row.externalId} 已属于“${match.name}”，请核对姓名。`);
    } else {
      const found = membersByName.get(rosterIdentity(row)) || [];
      if (found.length > 1) throw new Error(`“${row.name}”在同组有多位成员，请用工号区分后导入。`);
      match = found[0];
    }
    if (match) {
      matched += 1;
      if (match.name !== row.name || match.teamId !== row.teamId) {
        const oldKey = rosterIdentity(match);
        membersByName.set(oldKey, (membersByName.get(oldKey) || []).filter(member => member.id !== match.id));
        match.name = row.name; match.teamId = row.teamId; changed = true;
        const newKey = rosterIdentity(match);
        membersByName.set(newKey, [...(membersByName.get(newKey) || []), match]);
      }
    } else {
      if (members.length >= 1000) throw new Error('合并后成员超过 1000 人，请核对名单。');
      const member = { id: `member-${eventId()}`, ...row };
      members.push(member);
      indexMember(member);
      added += 1; changed = true;
    }
  }
  return { state: changed ? updateState(state, { members }) : state, added, matched };
}

export function getTimerSeconds(state: ActivityState, now = Date.now()): number {
  const remaining = state.timer.endsAt === null ? state.timer.remaining : Math.ceil((state.timer.endsAt - now) / 1000);
  return Math.min(state.timer.duration, Math.max(0, remaining));
}

export function serializeBackup(state: ActivityState): string {
  return JSON.stringify(state, null, 2);
}

function invalid(message = '备份内容无效，请选择本面板导出的 JSON 文件。'): never {
  throw new Error(message);
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}

function text(value: unknown, max: number, min = 0): string {
  if (typeof value !== 'string' || value.length > max || value.length < min) invalid();
  return value;
}

function integer(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) invalid();
  return value;
}

function bool(value: unknown): boolean {
  if (typeof value !== 'boolean') invalid();
  return value;
}

function game(value: unknown): GameId {
  if (!GAME_IDS.includes(value as GameId)) invalid();
  return value as GameId;
}

function id(value: unknown): string {
  const result = text(value, 100, 1);
  if (!/^[a-zA-Z0-9_-]+$/.test(result) || ['__proto__', 'prototype', 'constructor'].includes(result)) invalid();
  return result;
}

export function parseBackup(source: string): ActivityState {
  if (typeof source !== 'string' || source.length > 8_000_000) invalid('备份文件过大或内容无效。');
  let raw: Record<string, unknown>;
  try { raw = object(JSON.parse(source.replace(/^\uFEFF/, ''))); }
  catch { return invalid('无法读取备份，请选择有效的 JSON 文件。'); }
  if (raw.schemaVersion !== 1) invalid('备份版本不兼容，请选择本面板导出的备份。');
  if (!Array.isArray(raw.teams) || raw.teams.length < 1 || raw.teams.length > 20) invalid('备份应包含 1–20 支队伍。');
  const teamIds = new Set<string>();
  const teams = raw.teams.map(value => {
    const team = object(value);
    const teamId = id(team.id);
    if (teamIds.has(teamId)) invalid('备份中的队伍编号重复。');
    teamIds.add(teamId);
    const color = text(team.color, 7, 7);
    if (!/^#[\da-f]{6}$/i.test(color)) invalid();
    const sticker = text(team.sticker, 40, 1);
    if (!/^\/stickers\/flower-(0[1-9]|1[0-2])\.png$/.test(sticker)) invalid();
    return { id: teamId, name: text(team.name, 24, 1), color, sticker };
  });
  const eliminated = raw.eliminatedIds === undefined ? [] : raw.eliminatedIds;
  if (!Array.isArray(eliminated) || eliminated.length > teams.length) invalid('备份中的淘汰队伍无效。');
  const eliminatedIds = eliminated.map(value => id(value));
  if (new Set(eliminatedIds).size !== eliminatedIds.length || eliminatedIds.some(teamId => !teamIds.has(teamId))) invalid('备份中的淘汰队伍无效或重复。');
  const rawMembers = raw.members === undefined ? [] : raw.members;
  if (!Array.isArray(rawMembers) || rawMembers.length > 1000) invalid('备份名单人数不能超过 1000。');
  const memberIds = new Set<string>();
  const externalIds = new Set<string>();
  const members: Member[] = rawMembers.map(value => {
    const member = object(value);
    const memberId = id(member.id);
    if (memberIds.has(memberId)) invalid('备份中有重复的成员编号。');
    memberIds.add(memberId);
    const teamId = member.teamId === null ? null : id(member.teamId);
    if (teamId !== null && !teamIds.has(teamId)) invalid('备份成员引用了无效小组。');
    const name = text(member.name, 40, 1);
    const externalId = text(member.externalId, 80);
    if (!name.trim() || /[\u0000-\u001f\u007f]/.test(name + externalId) || hasRosterFormula(name) || hasRosterFormula(externalId)) invalid('备份名单必须为有效的纯文本。');
    if (externalId && externalIds.has(externalId)) invalid('备份中有重复的成员工号。');
    if (externalId) externalIds.add(externalId);
    return { id: memberId, name, teamId, externalId };
  });
  if (!Array.isArray(raw.events) || raw.events.length > MAX_EVENTS) invalid('备份积分记录数量超出限制。');
  const eventIds = new Set<string>();
  const settlementKeys = new Set<string>();
  const events = raw.events.map(value => {
    const event = object(value);
    const eventId = id(event.id);
    if (eventIds.has(eventId)) invalid('备份中有重复的积分记录。');
    eventIds.add(eventId);
    const undone = bool(event.undone);
    const settlementKey = event.settlementKey === undefined ? undefined : text(event.settlementKey, 120, 1);
    if (settlementKey && !undone) {
      if (settlementKeys.has(settlementKey)) invalid('备份中有重复的轮次结算。');
      settlementKeys.add(settlementKey);
    }
    if (!Array.isArray(event.changes) || event.changes.length < 1 || event.changes.length > teams.length) invalid();
    const changedTeams = new Set<string>();
    const changes = event.changes.map(value => {
      const change = object(value);
      const teamId = id(change.teamId);
      if (!teamIds.has(teamId) || changedTeams.has(teamId)) invalid('备份积分记录引用了无效或重复的队伍。');
      changedTeams.add(teamId);
      return { teamId, delta: integer(change.delta, -DELTA_LIMIT, DELTA_LIMIT) };
    });
    return {
      id: eventId, at: integer(event.at, 0, 9_000_000_000_000_000),
      gameId: game(event.gameId), round: integer(event.round, 1, 999),
      label: text(event.label, 120), changes, undone,
      ...(settlementKey ? { settlementKey } : {}),
    };
  });
  const rawIndividualEvents = raw.individualEvents === undefined ? [] : raw.individualEvents;
  if (!Array.isArray(rawIndividualEvents) || rawIndividualEvents.length > MAX_EVENTS) invalid('备份个人积分记录数量超出限制。');
  const individualEvents: IndividualScoreEvent[] = rawIndividualEvents.map(value => {
    const event = object(value);
    const eventId = id(event.id);
    if (eventIds.has(eventId)) invalid('备份中有重复的积分记录。');
    eventIds.add(eventId);
    const memberId = id(event.memberId);
    if (!memberIds.has(memberId)) invalid('备份个人积分引用了无效成员。');
    return {
      id: eventId, at: integer(event.at, 0, 9_000_000_000_000_000), gameId: game(event.gameId),
      label: text(event.label, 120), memberId, delta: integer(event.delta, -DELTA_LIMIT, DELTA_LIMIT), undone: bool(event.undone),
    };
  });
  const awardMode = raw.awardMode === undefined ? 'team' : raw.awardMode;
  if (awardMode !== 'team' && awardMode !== 'individual') invalid('备份颁奖模式无效。');
  if (!SCENES.includes(raw.scene as Scene)) invalid();
  const timer = object(raw.timer);
  let banterCue: ActivityState['banterCue'] = null;
  if (raw.banterCue !== undefined && raw.banterCue !== null) {
    const cue = object(raw.banterCue);
    const teamId = id(cue.teamId);
    if (!teamIds.has(teamId)) invalid('表情互动引用了无效的队伍。');
    const kind = cue.kind;
    if (kind !== undefined && kind !== 'celebrate' && kind !== 'attack' && kind !== 'challenge') invalid('表情互动类型无效。');
    const skill = cue.skill;
    if (skill !== undefined && !ATTACK_SKILLS.includes(skill as AttackSkill)) invalid('表情互动技能无效。');
    let targetIds: string[] | undefined;
    if (cue.targetIds !== undefined) {
      if (!Array.isArray(cue.targetIds) || cue.targetIds.length > teams.length - 1) invalid('表情互动的目标队伍无效。');
      targetIds = cue.targetIds.map(value => id(value));
      if (new Set(targetIds).size !== targetIds.length || targetIds.some(targetId => !teamIds.has(targetId) || targetId === teamId)) invalid('表情互动引用了无效或重复的目标队伍。');
    }
    if (kind === 'attack' && !targetIds?.length) invalid('比拼互动至少需要一支目标队伍。');
    if (kind === 'challenge' && targetIds?.length !== 1) invalid('叫阵互动需要一支目标队伍。');
    if (kind !== 'attack' && kind !== 'challenge' && targetIds?.length) invalid('庆祝互动不能包含目标队伍。');
    banterCue = {
      id: id(cue.id), at: integer(cue.at, 0, 9_000_000_000_000_000), teamId,
      ...(kind !== undefined ? { kind } : {}),
      ...(targetIds !== undefined ? { targetIds } : {}),
      ...(skill !== undefined ? { skill: skill as AttackSkill } : {}),
    };
  }
  const result: ActivityState = {
    schemaVersion: 1,
    revision: integer(raw.revision, 0, Number.MAX_SAFE_INTEGER - 1),
    title: text(raw.title, 80, 1), teams, events,
    gameId: game(raw.gameId), round: integer(raw.round, 1, 999), question: integer(raw.question, 1, 999),
    doublePoints: bool(raw.doublePoints), topic: text(raw.topic, 160), answer: text(raw.answer, 200),
    showAnswer: bool(raw.showAnswer), scene: raw.scene as Scene, scoresVisible: bool(raw.scoresVisible),
    timer: {
      duration: integer(timer.duration, 1, 3600),
      endsAt: timer.endsAt === null ? null : integer(timer.endsAt, 0, 9_000_000_000_000_000),
      remaining: integer(timer.remaining, 0, 3600),
    },
    podiumRevealed: integer(raw.podiumRevealed, 0, 3),
    muted: bool(raw.muted), reducedMotion: bool(raw.reducedMotion), allowNegative: bool(raw.allowNegative),
    eliminatedIds,
    mvpName: raw.mvpName === undefined ? '' : text(raw.mvpName, 40),
    banterEnabled: raw.banterEnabled === undefined ? true : bool(raw.banterEnabled),
    banterCue,
    members,
    individualEvents,
    awardMode,
  };
  for (const score of [...Object.values(getScores(result)), ...Object.values(getIndividualScores(result))]) {
    if (!Number.isSafeInteger(score) || Math.abs(score) > SCORE_LIMIT) invalid('备份积分数值超出范围。');
    if (!result.allowNegative && score < 0) invalid('备份包含负分，但未开启允许负分。');
  }
  return result;
}

function csvCell(value: string | number): string {
  let source = String(value);
  if (typeof value === 'string' && /^[\s\u0000-\u001f]*[=+\-@]/.test(source)) source = `'${source}`;
  return `"${source.replace(/"/g, '""')}"`;
}

export function toCsv(state: ActivityState): string {
  const gameScores: Record<GameId, Record<string, number>> = { music: {}, garden: {}, lyrics: {}, free: {} };
  for (const event of state.events) {
    if (event.undone) continue;
    for (const change of event.changes) gameScores[event.gameId][change.teamId] = (gameScores[event.gameId][change.teamId] || 0) + change.delta;
  }
  const rows: (string | number)[][] = [['名次', '队伍', '听前奏猜歌', '逛三园', '歌词接龙', '自由计分', '总积分']];
  for (const team of getRanking(state)) rows.push([team.rank, team.name, ...GAME_IDS.map(gameId => gameScores[gameId][team.id] || 0), team.score]);
  return '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n');
}

export function toIndividualCsv(state: ActivityState): string {
  const gameScores = individualGameScores(state);
  const rows: (string | number)[][] = [['名次', '姓名', '工号', '小组', '听前奏猜歌', '逛三园', '歌词接龙', '自由计分', '总积分']];
  for (const member of getIndividualRanking(state)) rows.push([member.rank, member.name, member.externalId, member.teamName, ...GAME_IDS.map(gameId => gameScores[gameId][member.id] || 0), member.score]);
  return '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n');
}

function individualGameScores(state: ActivityState): Record<GameId, Record<string, number>> {
  const scores: Record<GameId, Record<string, number>> = { music: Object.create(null), garden: Object.create(null), lyrics: Object.create(null), free: Object.create(null) };
  for (const event of state.individualEvents) {
    if (!event.undone) scores[event.gameId][event.memberId] = (scores[event.gameId][event.memberId] || 0) + event.delta;
  }
  return scores;
}

export function toAllStatsCsv(state: ActivityState): string {
  const teamScores: Record<GameId, Record<string, number>> = { music: Object.create(null), garden: Object.create(null), lyrics: Object.create(null), free: Object.create(null) };
  for (const event of state.events) {
    if (event.undone) continue;
    for (const change of event.changes) teamScores[event.gameId][change.teamId] = (teamScores[event.gameId][change.teamId] || 0) + change.delta;
  }
  const personalScores = individualGameScores(state);
  const rows: (string | number)[][] = [['类型', '名次', '名称', '工号', '小组', '听前奏猜歌', '逛三园', '歌词接龙', '自由计分', '总积分']];
  for (const team of getRanking(state)) rows.push(['团队', team.rank, team.name, '', team.name, ...GAME_IDS.map(gameId => teamScores[gameId][team.id] || 0), team.score]);
  for (const member of getIndividualRanking(state)) rows.push(['个人', member.rank, member.name, member.externalId, member.teamName, ...GAME_IDS.map(gameId => personalScores[gameId][member.id] || 0), member.score]);
  return '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n');
}
