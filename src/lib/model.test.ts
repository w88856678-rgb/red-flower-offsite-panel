import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  addScore, createInitialState, getRanking, getScores, getTimerSeconds,
  parseBackup, serializeBackup, toCsv, undoLast, updateState,
  addIndividualScore, getIndividualRanking, getIndividualScores, mergeRoster,
  toAllStatsCsv, toIndividualCsv, undoLatest, getBanterOptions, triggerBanter, triggerChallenge,
} from './model';

describe('计分与撤销', () => {
  it('正式活动从十队零分开始，演示数据单独创建', () => {
    const state = createInitialState();
    expect(state.teams).toHaveLength(10);
    expect(Object.values(getScores(state))).toEqual(Array(10).fill(0));
    expect(getScores(createInitialState(true))['team-1']).toBe(18);
    expect(state.events).toHaveLength(0);
  });

  it('连续快速计分没有丢分，且不修改之前的状态', () => {
    const initial = createInitialState();
    let state = initial;
    for (let i = 0; i < 100; i += 1) state = addScore(state, [{ teamId: 'team-1', delta: 1 }], '答对');
    expect(getScores(state)['team-1']).toBe(100);
    expect(state.revision).toBe(100);
    expect(new Set(state.events.map(event => event.id)).size).toBe(100);
    expect(getScores(initial)['team-1']).toBe(0);
  });

  it('默认最低零分，并记录实际扣分以保证撤销准确', () => {
    let state = addScore(createInitialState(), [{ teamId: 'team-1', delta: 2 }], '加分');
    state = addScore(state, [{ teamId: 'team-1', delta: -5 }], '扣分');
    expect(getScores(state)['team-1']).toBe(0);
    expect(state.events[1].changes).toEqual([{ teamId: 'team-1', delta: -2 }]);
    expect(getScores(undoLast(state))['team-1']).toBe(2);
    const zero = createInitialState();
    expect(addScore(zero, [{ teamId: 'team-1', delta: -1 }], '无可扣积分')).toBe(zero);
  });

  it('打开负分配置后允许扣到负数', () => {
    const state = addScore(updateState(createInitialState(), { allowNegative: true }), [{ teamId: 'team-2', delta: -3 }], '扣分');
    expect(getScores(state)['team-2']).toBe(-3);
  });

  it('关闭负分后拒绝会重新产生负分的撤销，重新开启后可正常撤销', () => {
    let state = updateState(createInitialState(), { allowNegative: true });
    state = addScore(state, [{ teamId: 'team-1', delta: -3 }], '扣分');
    state = addScore(state, [{ teamId: 'team-1', delta: 3 }], '修正为0');
    state = updateState(state, { allowNegative: false });
    expect(undoLast(state)).toBe(state);
    expect(getScores(state)['team-1']).toBe(0);
    expect(state.events[1].undone).toBe(false);
    expect(parseBackup(serializeBackup(state))).toEqual(state);
    const undone = undoLast(updateState(state, { allowNegative: true }));
    expect(getScores(undone)['team-1']).toBe(-3);
    expect(undone.events[1].undone).toBe(true);
  });

  it('前三名批量结算可整批撤销，防止重复结算，撤销后可重新结算', () => {
    const initial = createInitialState();
    const changes = [{ teamId: 'team-1', delta: 3 }, { teamId: 'team-2', delta: 2 }, { teamId: 'team-3', delta: 1 }];
    const scored = addScore(initial, changes, '逛三园 第1轮', 'garden-1');
    expect(getScores(scored)['team-1']).toBe(3);
    expect(addScore(scored, changes, '再次点击', 'garden-1')).toBe(scored);
    const undone = undoLast(scored);
    expect(Object.values(getScores(undone))).toEqual(Array(10).fill(0));
    expect(undone.events[0].undone).toBe(true);
    expect(scored.events[0].undone).toBe(false);
    const reawarded = addScore(undone, changes, '更正后结算', 'garden-1');
    expect(getScores(reawarded)['team-2']).toBe(2);
    expect(reawarded.events).toHaveLength(2);
  });

  it('批次内同队增减先合并，输入异常时整批拒绝', () => {
    const state = createInitialState();
    const next = addScore(state, [{ teamId: 'team-1', delta: 3 }, { teamId: 'team-1', delta: -1 }], '合并');
    expect(next.events[0].changes).toEqual([{ teamId: 'team-1', delta: 2 }]);
    expect(addScore(state, [{ teamId: 'team-1', delta: 1 }, { teamId: 'missing', delta: 1 }], '异常')).toBe(state);
    expect(addScore(state, [{ teamId: 'team-1', delta: 0.5 }], '非整数')).toBe(state);
    expect(addScore(state, [{ teamId: 'team-1', delta: Number.NaN }], '非数字')).toBe(state);
    expect(addScore(state, [{ teamId: '__proto__', delta: 1 }], '非法队伍')).toBe(state);
  });

  it('连续撤销会跳过已撤销记录，没有记录则不修改状态', () => {
    const initial = createInitialState();
    expect(undoLast(initial)).toBe(initial);
    let state = addScore(initial, [{ teamId: 'team-1', delta: 2 }], '第一笔');
    state = addScore(state, [{ teamId: 'team-2', delta: 3 }], '第二笔');
    state = undoLast(undoLast(state));
    expect(state.events.every(event => event.undone)).toBe(true);
    expect(undoLast(state)).toBe(state);
  });

  it('并列排名使用 1、1、3，同分顺序保持队伍原始顺序', () => {
    const state = addScore(createInitialState(), [{ teamId: 'team-1', delta: 5 }, { teamId: 'team-3', delta: 5 }, { teamId: 'team-2', delta: 3 }], '同分');
    expect(getRanking(state).slice(0, 3).map(team => [team.id, team.rank])).toEqual([['team-1', 1], ['team-3', 1], ['team-2', 3]]);
  });
});

describe('领跑队气氛互动', () => {
  afterEach(() => vi.restoreAllMocks());

  function rankedState(scores = [8, 5, 3, 1]) {
    return addScore(createInitialState(), scores.map((delta, index) => ({ teamId: `team-${index + 1}`, delta })), '测试排名');
  }

  it('零分或全体非正分时不能发起互动', () => {
    const zero = createInitialState();
    expect(getBanterOptions(zero)).toMatchObject({ leader: null, targets: [], canCelebrate: false, canAttack: false });
    expect(triggerBanter(zero, 'celebrate')).toBe(zero);
    expect(triggerBanter(zero, 'attack')).toBe(zero);
    const negative = addScore(updateState(zero, { allowNegative: true }), zero.teams.map(team => ({ teamId: team.id, delta: -1 })), '负分');
    expect(triggerBanter(negative, 'celebrate')).toBe(negative);
    expect(triggerBanter(negative, 'attack')).toBe(negative);
  });

  it('从稳定的第一名发起庆祝，出击覆盖其余所有队伍，包含零分', () => {
    const state = rankedState();
    const options = getBanterOptions(state);
    expect(options.leader?.id).toBe('team-1');
    const targetIds = state.teams.slice(1).map(team => team.id);
    expect(options.targets.map(team => team.id)).toEqual(targetIds);
    expect(options.canCelebrate).toBe(true);
    expect(options.canAttack).toBe(true);
    const celebrated = triggerBanter(state, 'celebrate');
    expect(celebrated.banterCue).toMatchObject({ teamId: 'team-1', kind: 'celebrate' });
    expect(celebrated.banterCue).not.toHaveProperty('targetIds');
    const attacked = triggerBanter(state, 'attack');
    expect(attacked.banterCue).toMatchObject({ teamId: 'team-1', kind: 'attack', targetIds });
    expect(attacked.banterCue?.at).toBeLessThanOrEqual(Date.now());
    expect(attacked.banterCue?.id).not.toBe(celebrated.banterCue?.id);
  });

  it('并列第一、并列目标也不豁免，同分目标保持原队伍顺序', () => {
    const tiedLead = rankedState([8, 8, 5, 1]);
    const cue = triggerBanter(tiedLead, 'attack').banterCue;
    expect(cue).toMatchObject({ teamId: 'team-1', targetIds: tiedLead.teams.slice(1).map(team => team.id) });
    expect(getBanterOptions(tiedLead).targets.some(team => team.id === 'team-2' && team.rank === 1)).toBe(true);
    const tiedTargets = rankedState([8, 5, 5, 5]);
    expect(triggerBanter(tiedTargets, 'attack').banterCue?.targetIds).toEqual(tiedTargets.teams.slice(1).map(team => team.id));
  });

  it('只有一个队伍时仍可庆祝，但不能攻击自己', () => {
    const initial = createInitialState();
    const onlyLeader = addScore(updateState(initial, { teams: initial.teams.slice(0, 1) }), [{ teamId: 'team-1', delta: 3 }], '计分');
    expect(getBanterOptions(onlyLeader)).toMatchObject({ canCelebrate: true, canAttack: false, targets: [] });
    expect(triggerBanter(onlyLeader, 'attack')).toBe(onlyLeader);
    const allTied = rankedState([3, 3, 3]);
    expect(getBanterOptions(allTied).targets.map(team => team.id)).toEqual(allTied.teams.slice(1).map(team => team.id));
    expect(triggerBanter(allTied, 'celebrate').banterCue?.teamId).toBe('team-1');
  });

  it('二十队全场出击可包含十九个目标和负分队，备份完整往返', () => {
    const initial = createInitialState();
    const teams = Array.from({ length: 20 }, (_, index) => ({ ...initial.teams[0], id: `team-${index + 1}`, name: `队伍${index + 1}` }));
    const state = addScore(updateState(initial, { teams, allowNegative: true }), teams.map((team, index) => ({ teamId: team.id, delta: 10 - index })), '全场计分');
    const attacked = triggerBanter(state, 'attack');
    expect(attacked.banterCue?.targetIds).toEqual(teams.slice(1).map(team => team.id));
    expect(attacked.banterCue?.targetIds).toHaveLength(19);
    expect(attacked.events).toBe(state.events);
    expect(parseBackup(serializeBackup(attacked))).toEqual(attacked);
  });

  it('关闭互动、隐分、减弱动画或不在团队场景时拒绝触发', () => {
    const initial = rankedState();
    for (const patch of [
      { banterEnabled: false }, { scoresVisible: false }, { reducedMotion: true },
      { scene: 'welcome' as const }, { scene: 'podium' as const }, { scene: 'mvp' as const },
    ]) {
      const state = updateState(initial, patch);
      expect(getBanterOptions(state)).toMatchObject({ canCelebrate: false, canAttack: false });
      expect(triggerBanter(state, 'celebrate')).toBe(state);
      expect(triggerBanter(state, 'attack')).toBe(state);
    }
    expect(triggerBanter(updateState(initial, { scene: 'game' }), 'attack').banterCue?.kind).toBe('attack');
  });

  it('同毫秒内可连续20次同类或交替互动，每次生成新cue且不改积分', () => {
    const state = rankedState();
    const now = state.events[0].at + 10;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    for (const alternating of [false, true]) {
      let current = state;
      const ids = new Set<string>();
      for (let i = 0; i < 20; i += 1) {
        const next = triggerBanter(current, alternating && i % 2 ? 'attack' : 'celebrate');
        expect(next).not.toBe(current);
        expect(next.banterCue?.at).toBe(now);
        ids.add(next.banterCue!.id);
        current = next;
      }
      expect(ids.size).toBe(20);
      expect(current.revision).toBe(state.revision + 20);
      expect(getBanterOptions(current)).toMatchObject({ canCelebrate: true, canAttack: true });
      expect(current.events).toBe(state.events);
      expect(current.individualEvents).toBe(state.individualEvents);
      expect(getScores(current)).toEqual(getScores(state));
      expect(getIndividualScores(current)).toEqual(getIndividualScores(state));
    }
  });

  it('出击按连击、激光、流星循环，穿插庆祝仍保留下一招的顺序', () => {
    let state = rankedState();
    const initialCelebration = triggerBanter(state, 'celebrate');
    expect(initialCelebration.banterCue).not.toHaveProperty('skill');
    const skills = [];
    for (let i = 0; i < 5; i += 1) {
      state = triggerBanter(state, 'attack');
      skills.push(state.banterCue?.skill);
      if (i === 1) {
        state = triggerBanter(state, 'celebrate');
        expect(state.banterCue).toMatchObject({ kind: 'celebrate', skill: 'laser' });
        expect(state.banterCue).not.toHaveProperty('targetIds');
        state = parseBackup(serializeBackup(state));
      }
    }
    expect(skills).toEqual(['combo', 'laser', 'meteor', 'combo', 'laser']);
    expect(parseBackup(serializeBackup(state))).toEqual(state);
  });

  it('互动使用当前时间，不会被备份中的未来积分时间推迟', () => {
    const dateNow = vi.spyOn(Date, 'now').mockReturnValue(10_000);
    const initial = rankedState();
    const state = updateState(initial, { events: initial.events.map(event => ({ ...event, at: 9_000_000_000_000_000 })) });
    const first = triggerBanter(state, 'celebrate');
    expect(first.banterCue?.at).toBe(10_000);
    dateNow.mockReturnValue(13_000);
    expect(triggerBanter(first, 'attack').banterCue?.at).toBe(13_000);
    const futureCue = updateState(state, { banterCue: { id: 'future-cue', at: 9_000_000_000_000_000, teamId: 'team-1' } });
    expect(triggerBanter(futureCue, 'celebrate').banterCue?.at).toBe(13_000);
  });

  it('互动只修改cue与revision，团队和个人分数、事件及撤销顺序不变', () => {
    let state = mergeRoster(rankedState(), [{ name: '测试成员', teamId: 'team-1', externalId: '001' }]).state;
    state = addIndividualScore(state, state.members[0].id, 2, '个人奖励');
    const next = triggerBanter(state, 'attack');
    expect(next).toEqual({ ...state, revision: state.revision + 1, banterCue: next.banterCue });
    expect(next.events).toBe(state.events);
    expect(next.individualEvents).toBe(state.individualEvents);
    expect(getScores(next)).toEqual(getScores(state));
    expect(getIndividualScores(next)).toEqual(getIndividualScores(state));
    expect(undoLatest(next).individualEvents[0].undone).toBe(true);
    expect(state.banterCue).toBeNull();
  });

  it('新旧cue往返保持原字段，历史目标快照不受当前排名限制', () => {
    const legacy = updateState(rankedState(), { banterCue: { id: 'old-cue', at: 1, teamId: 'team-1' } });
    const restoredLegacy = parseBackup(serializeBackup(legacy));
    expect(restoredLegacy).toEqual(legacy);
    expect(restoredLegacy.banterCue).not.toHaveProperty('kind');
    expect(restoredLegacy.banterCue).not.toHaveProperty('targetIds');
    expect(restoredLegacy.banterCue).not.toHaveProperty('skill');
    const legacyAttack = updateState(legacy, { banterCue: { ...legacy.banterCue!, kind: 'attack', targetIds: ['team-2'] } });
    const restoredAttack = parseBackup(serializeBackup(legacyAttack));
    expect(restoredAttack).toEqual(legacyAttack);
    expect(restoredAttack.banterCue).not.toHaveProperty('skill');
    expect(triggerBanter(restoredAttack, 'attack').banterCue?.skill).toBe('combo');
    const attack = triggerBanter(rankedState(), 'attack');
    const changedRanking = addScore(attack, [{ teamId: 'team-4', delta: 20 }], '后续计分');
    expect(parseBackup(serializeBackup(changedRanking))).toEqual(changedRanking);
    const emptyTargets = updateState(legacy, { banterCue: { ...legacy.banterCue!, kind: 'celebrate', targetIds: [] } });
    expect(parseBackup(serializeBackup(emptyTargets))).toEqual(emptyTargets);
  });

  it('后排和零分队可叫阵稳定的榜一，前三与未知队伍不能发起', () => {
    const state = rankedState();
    const options = getBanterOptions(state);
    expect(options.canChallenge).toBe(true);
    expect(options.challengers.map(team => team.id)).toEqual(state.teams.slice(3).map(team => team.id));
    for (const teamId of ['team-4', 'team-10']) {
      const called = triggerChallenge(state, teamId);
      expect(called.banterCue).toMatchObject({ teamId, kind: 'challenge', targetIds: ['team-1'] });
      expect(called.events).toBe(state.events);
      expect(called.individualEvents).toBe(state.individualEvents);
      expect(getScores(called)).toEqual(getScores(state));
      expect(parseBackup(serializeBackup(called))).toEqual(called);
    }
    for (const id of ['team-1', 'team-2', 'team-3', 'missing']) expect(triggerChallenge(state, id)).toBe(state);
  });

  it('负分后排也可叫阵；并列榜一只选择稳定的首队', () => {
    const initial = updateState(createInitialState(), { allowNegative: true });
    const state = addScore(initial, [8, 8, 3, -1].map((delta, i) => ({ teamId: `team-${i + 1}`, delta })), '并列');
    expect(triggerChallenge(state, 'team-4').banterCue).toMatchObject({ teamId: 'team-4', targetIds: ['team-1'] });
    expect(triggerChallenge(state, 'team-2')).toBe(state);
  });

  it('隐分、关闭动画、不在团队场景、无正分榜一或无后排时不叫阵', () => {
    const initial = rankedState();
    for (const state of [createInitialState(), rankedState(Array(10).fill(3)),
      ...[{ scoresVisible: false }, { banterEnabled: false }, { reducedMotion: true },
        { scene: 'welcome' as const }, { scene: 'mvp' as const }, { scene: 'podium' as const }].map(patch => updateState(initial, patch)),
    ]) {
      expect(getBanterOptions(state).canChallenge).toBe(false);
      expect(triggerChallenge(state, 'team-10')).toBe(state);
    }
  });

  it('叫阵不改个人积分或撤销顺序，不重置三技能轮换，并支持立即连续触发', () => {
    let state = mergeRoster(rankedState(), [{ name: '测试成员', teamId: 'team-10', externalId: '101' }]).state;
    state = addIndividualScore(state, state.members[0].id, 2, '个人奖励');
    state = triggerBanter(state, 'attack');
    expect(state.banterCue?.skill).toBe('combo');
    const called = triggerChallenge(state, 'team-10');
    const again = triggerChallenge(called, 'team-10');
    expect(again.banterCue?.id).not.toBe(called.banterCue?.id);
    expect(again.revision).toBe(state.revision + 2);
    expect(again.individualEvents).toBe(state.individualEvents);
    expect(getIndividualScores(again)).toEqual(getIndividualScores(state));
    expect(undoLatest(again).individualEvents[0].undone).toBe(true);
    expect(triggerBanter(again, 'attack').banterCue?.skill).toBe('laser');
    const changed = addScore(again, [{ teamId: 'team-10', delta: 20 }], '后来反超');
    expect(parseBackup(serializeBackup(changed))).toEqual(changed);
  });

  it('拒绝无效类型与技能、缺失攻击目标、重复、超量、自己或未知目标', () => {
    const state = rankedState();
    const base = { id: 'test-cue', at: 1, teamId: 'team-1' };
    const invalidCues = [
      { ...base, kind: 'other' }, { ...base, kind: null },
      { ...base, skill: 'other' }, { ...base, skill: null }, { ...base, skill: 1 },
      { ...base, kind: 'attack' }, { ...base, kind: 'attack', targetIds: [] },
      { ...base, kind: 'attack', targetIds: 'team-2' },
      { ...base, kind: 'attack', targetIds: ['team-2', 'team-2'] },
      { ...base, kind: 'attack', targetIds: Array.from({ length: state.teams.length }, (_, index) => `team-${index + 2}`) },
      { ...base, kind: 'attack', targetIds: ['team-1'] },
      { ...base, kind: 'attack', targetIds: ['missing'] },
      { ...base, kind: 'attack', targetIds: [null] },
      { ...base, kind: 'celebrate', targetIds: ['team-2'] },
      { ...base, kind: 'challenge' }, { ...base, kind: 'challenge', targetIds: [] },
      { ...base, kind: 'challenge', targetIds: ['team-2', 'team-3'] },
      { ...base, kind: 'challenge', targetIds: ['team-1'] },
      { ...base, targetIds: ['team-2'] },
    ];
    for (const banterCue of invalidCues) {
      expect(() => parseBackup(JSON.stringify({ ...state, banterCue }))).toThrow();
    }
  });
});

describe('名单与个人计分', () => {
  function rosterState() {
    return mergeRoster(createInitialState(), [
      { name: '张三', teamId: 'team-1', externalId: '001' },
      { name: '李四', teamId: 'team-2', externalId: '002' },
      { name: '王五', teamId: null, externalId: '' },
    ]).state;
  }

  it('正式名单为空；演示成员完全独立，旧演示备份不偷偷插入人员', () => {
    expect(createInitialState().members).toEqual([]);
    expect(createInitialState().individualEvents).toEqual([]);
    expect(createInitialState(true).members).toHaveLength(12);
    const old = JSON.parse(serializeBackup(createInitialState(true)));
    delete old.members; delete old.individualEvents; delete old.awardMode;
    const restored = parseBackup(JSON.stringify(old));
    expect(restored.members).toEqual([]);
    expect(restored.individualEvents).toEqual([]);
    expect(restored.awardMode).toBe('team');
    expect(getScores(restored)['team-1']).toBe(18);
  });

  it('重复合并名单不清空个人得分、团队得分、历史与成员ID', () => {
    let state = rosterState();
    const memberId = state.members[0].id;
    state = addIndividualScore(state, memberId, 5, '个人答对');
    state = addScore(state, [{ teamId: 'team-1', delta: 3 }], '团队奖励');
    const merged = mergeRoster(state, [{ name: '张三', teamId: 'team-1', externalId: '001' }]);
    expect(merged.state).toBe(state);
    expect(merged).toMatchObject({ added: 0, matched: 1 });
    expect(merged.state.members[0].id).toBe(memberId);
    expect(getIndividualScores(merged.state)[memberId]).toBe(5);
    expect(getScores(merged.state)['team-1']).toBe(3);
    expect(merged.state.individualEvents).toBe(state.individualEvents);
    expect(merged.state.events).toBe(state.events);
  });

  it('同名不同工号可共存；同名无工号面对多个候选时拒绝合并', () => {
    let state = mergeRoster(createInitialState(), [
      { name: '陈晨', teamId: 'team-1', externalId: 'A01' },
      { name: '陈晨', teamId: 'team-1', externalId: 'A02' },
    ]).state;
    expect(state.members).toHaveLength(2);
    state = addIndividualScore(state, state.members[0].id, 3, '答对');
    expect(() => mergeRoster(state, [{ name: '陈晨', teamId: 'team-1', externalId: '' }])).toThrow('工号');
    expect(getIndividualScores(state)[state.members[0].id]).toBe(3);
    expect(getIndividualScores(state)[state.members[1].id]).toBe(0);
    expect(() => mergeRoster(state, [
      { name: '无工号同名', teamId: 'team-1', externalId: '' },
      { name: '无工号同名', teamId: 'team-1', externalId: '' },
    ])).toThrow('重复');
  });

  it('无工号按规范化姓名和小组匹配，已有工号不会因无工号导入被清空', () => {
    const state = rosterState();
    const merged = mergeRoster(state, [{ name: '  张三  ', teamId: 'team-1', externalId: '' }]);
    expect(merged.state).toBe(state);
    expect(merged.state.members[0].externalId).toBe('001');
    const differentTeam = mergeRoster(state, [{ name: '张三', teamId: 'team-3', externalId: '' }]);
    expect(differentTeam.added).toBe(1);
  });

  it('工号匹配可更新分组但保留个人历史；姓名冲突整批失败且不影响原状态', () => {
    let state = rosterState();
    const memberId = state.members[0].id;
    state = addIndividualScore(state, memberId, 6, '答对');
    const moved = mergeRoster(state, [{ name: '张三', teamId: 'team-4', externalId: '001' }]);
    expect(moved.state.members[0].id).toBe(memberId);
    expect(moved.state.members[0].teamId).toBe('team-4');
    expect(getIndividualRanking(moved.state)[0].teamName).toBe('第四小队');
    expect(getIndividualScores(moved.state)[memberId]).toBe(6);
    expect(() => mergeRoster(state, [
      { name: '新成员', teamId: null, externalId: 'NEW' },
      { name: '另一个人', teamId: 'team-1', externalId: '001' },
    ])).toThrow('核对姓名');
    expect(state.members).toHaveLength(3);
    expect(state.members[0].teamId).toBe('team-1');
    expect(() => mergeRoster(state, [
      { name: '张三', teamId: 'team-1', externalId: 'X' },
      { name: '李四', teamId: 'team-1', externalId: 'X' },
    ])).toThrow('不同名单');
  });

  it('空名单不操作，非法组、超长姓名、公式、超过人数上限均整批拒绝', () => {
    const state = rosterState();
    expect(mergeRoster(state, [])).toEqual({ state, added: 0, matched: 0 });
    expect(() => mergeRoster(state, [{ name: '新成员', teamId: 'missing', externalId: '' }])).toThrow('小组');
    expect(() => mergeRoster(state, [{ name: '字'.repeat(41), teamId: null, externalId: '' }])).toThrow('姓名');
    expect(() => mergeRoster(state, [{ name: '=WEBSERVICE("https://remote")', teamId: null, externalId: '' }])).toThrow('公式');
    expect(() => mergeRoster(state, Array.from({ length: 1001 }, (_, i) => ({ name: `成员${i}`, teamId: null, externalId: String(i) })))).toThrow('1000');
  });

  it('个人积分独立于团队，支持负分开关、扣分下限和稳定并列排名', () => {
    let state = rosterState();
    const [a, b] = state.members;
    state = addIndividualScore(state, a.id, 5, '答对');
    state = addIndividualScore(state, b.id, 5, '答对');
    expect(getRanking(state).every(team => team.score === 0)).toBe(true);
    expect(getIndividualRanking(state).map(member => member.rank)).toEqual([1, 1, 3]);
    expect(getIndividualRanking(state)[2].teamName).toBe('未分组');
    state = addIndividualScore(state, a.id, -10, '扣分');
    expect(getIndividualScores(state)[a.id]).toBe(0);
    expect(state.individualEvents.at(-1)?.delta).toBe(-5);
    expect(addIndividualScore(state, 'missing', 1, '无效')).toBe(state);
    expect(addIndividualScore(state, a.id, 0.5, '无效')).toBe(state);
    expect(addIndividualScore(state, a.id, 1_000_001, '无效')).toBe(state);
    state = addIndividualScore(updateState(state, { allowNegative: true }), a.id, -2, '负分');
    expect(getIndividualScores(state)[a.id]).toBe(-2);
  });

  it('跨团队与个人按操作时间撤销，不误撤不同类型的历史', () => {
    let state = rosterState();
    const memberId = state.members[0].id;
    state = addScore(state, [{ teamId: 'team-1', delta: 3 }], '先团队');
    state = addIndividualScore(state, memberId, 2, '再个人');
    state = addScore(state, [{ teamId: 'team-2', delta: 1 }], '最后团队');
    expect(state.events[0].at).toBeLessThan(state.individualEvents[0].at);
    expect(state.individualEvents[0].at).toBeLessThan(state.events[1].at);
    state = undoLatest(state);
    expect(getScores(state)['team-2']).toBe(0);
    expect(getIndividualScores(state)[memberId]).toBe(2);
    state = undoLatest(state);
    expect(getIndividualScores(state)[memberId]).toBe(0);
    expect(getScores(state)['team-1']).toBe(3);
    state = undoLatest(state);
    expect(getScores(state)['team-1']).toBe(0);
    expect(undoLatest(state)).toBe(state);
  });

  it('个人撤销也受负分开关保护；旧 undoLast 保持团队专用', () => {
    let state = updateState(rosterState(), { allowNegative: true });
    const memberId = state.members[0].id;
    state = addIndividualScore(state, memberId, -3, '扣分');
    state = addIndividualScore(state, memberId, 3, '回到0');
    state = updateState(state, { allowNegative: false });
    expect(undoLatest(state)).toBe(state);
    expect(undoLast(state)).toBe(state);
    const undone = undoLatest(updateState(state, { allowNegative: true }));
    expect(getIndividualScores(undone)[memberId]).toBe(-3);
  });

  it('个人、团队与完整CSV分别导出，忽略撤销并对公式和引号安全转义', () => {
    let state = rosterState();
    const memberId = state.members[0].id;
    state = addIndividualScore(state, memberId, 5, '答对');
    state = addIndividualScore(state, memberId, 2, '误操作');
    state = undoLatest(state);
    state = addScore(state, [{ teamId: 'team-1', delta: 3 }], '团队奖励');
    state = updateState(state, { members: state.members.map((member, i) => i === 0 ? { ...member, name: '=SUM(1,2)', externalId: '@ID' } : member), teams: state.teams.map((team, i) => i === 0 ? { ...team, name: '队伍,"A"' } : team) });
    const personal = toIndividualCsv(state);
    expect(personal.startsWith('\uFEFF')).toBe(true);
    expect(personal).toContain('"\'=SUM(1,2)"');
    expect(personal).toContain('"\'@ID"');
    expect(personal).toContain('"队伍,""A"""');
    expect(personal).toContain('"5","0","0","0","5"');
    const all = toAllStatsCsv(state);
    expect(all).toContain('"团队","1","队伍,""A"""');
    expect(all).toContain('"个人","1","\'=SUM(1,2)"');
    expect(all.split('\r\n')).toHaveLength(1 + 10 + 3);
    expect(toCsv(state)).not.toContain('SUM');
  });

  it('新备份往返恢复，并拒绝无效成员、工号冲突、个人事件引用及负分', () => {
    let state = rosterState();
    state = addIndividualScore(state, state.members[0].id, 3, '答对');
    state = updateState(state, { scene: 'mvp', awardMode: 'individual' });
    expect(parseBackup(serializeBackup(state))).toEqual(state);
    const badMember = structuredClone(state); badMember.members[0].teamId = 'missing';
    expect(() => parseBackup(serializeBackup(badMember))).toThrow('小组');
    const duplicateId = structuredClone(state); duplicateId.members[1].externalId = duplicateId.members[0].externalId;
    expect(() => parseBackup(serializeBackup(duplicateId))).toThrow('工号');
    const badEvent = structuredClone(state); badEvent.individualEvents[0].memberId = 'missing';
    expect(() => parseBackup(serializeBackup(badEvent))).toThrow('成员');
    const badNumber = structuredClone(state); badNumber.individualEvents[0].delta = 1.5;
    expect(() => parseBackup(serializeBackup(badNumber))).toThrow();
    const negative = structuredClone(state); negative.individualEvents[0].delta = -1;
    expect(() => parseBackup(serializeBackup(negative))).toThrow('负分');
    const duplicateEvent = structuredClone(state); duplicateEvent.events = [{ id: duplicateEvent.individualEvents[0].id, at: 1, gameId: 'free', round: 1, label: '', changes: [{ teamId: 'team-1', delta: 1 }], undone: false }];
    expect(() => parseBackup(serializeBackup(duplicateEvent))).toThrow('重复');
  });
});

describe('备份与导出', () => {
  it('表情互动兼容旧备份并且不改变积分记录', () => {
    const state = createInitialState(true);
    const next = updateState(state, { banterEnabled: true, banterCue: { id: 'cue-1', at: Date.now(), teamId: 'team-1' } });
    expect(next.events).toBe(state.events);
    expect(getScores(next)).toEqual(getScores(state));
    expect(parseBackup(serializeBackup(next))).toEqual(next);
    const legacy = JSON.parse(serializeBackup(next));
    delete legacy.banterEnabled; delete legacy.banterCue;
    const restored = parseBackup(JSON.stringify(legacy));
    expect(restored.banterEnabled).toBe(true);
    expect(restored.banterCue).toBe(null);
    expect(() => parseBackup(serializeBackup({ ...state, banterCue: { id: 'cue-2', at: 1, teamId: 'missing' } }))).toThrow('队伍');
  });
  it('可完整往返恢复，包括历史撤销状态与计时器', () => {
    let state = addScore(createInitialState(), [{ teamId: 'team-1', delta: 3 }], '第一笔');
    state = addScore(state, [{ teamId: 'team-2', delta: 1 }], '误操作');
    state = updateState(undoLast(state), { timer: { duration: 5, remaining: 5, endsAt: 123_000 } });
    expect(parseBackup(serializeBackup(state))).toEqual(state);
    expect(parseBackup('\uFEFF' + serializeBackup(state))).toEqual(state);
  });

  it('保存淘汰状态与 MVP，并兼容缺少这两个字段的旧备份', () => {
    const state = updateState(createInitialState(), { eliminatedIds: ['team-2', 'team-7'], mvpName: '小花同学' });
    expect(parseBackup(serializeBackup(state))).toEqual(state);
    const legacy = JSON.parse(serializeBackup(state));
    delete legacy.eliminatedIds;
    delete legacy.mvpName;
    const restored = parseBackup(JSON.stringify(legacy));
    expect(restored.eliminatedIds).toEqual([]);
    expect(restored.mvpName).toBe('');
  });

  it('拒绝重复或未知淘汰队伍，以及超长或非字符串 MVP', () => {
    const state = createInitialState();
    expect(() => parseBackup(serializeBackup({ ...state, eliminatedIds: ['team-1', 'team-1'] }))).toThrow('淘汰');
    expect(() => parseBackup(serializeBackup({ ...state, eliminatedIds: ['missing'] }))).toThrow('淘汰');
    expect(() => parseBackup(serializeBackup({ ...state, eliminatedIds: 'team-1' } as never))).toThrow('淘汰');
    expect(() => parseBackup(serializeBackup({ ...state, mvpName: '花'.repeat(41) }))).toThrow();
    expect(() => parseBackup(serializeBackup({ ...state, mvpName: 1 } as never))).toThrow();
  });

  it('禁止负分时拒绝导入负分，允许负分的有效备份可恢复', () => {
    const scored = addScore(updateState(createInitialState(), { allowNegative: true }), [{ teamId: 'team-3', delta: -2 }], '扣分');
    expect(getScores(parseBackup(serializeBackup(scored)))['team-3']).toBe(-2);
    expect(() => parseBackup(serializeBackup({ ...scored, allowNegative: false }))).toThrow('负分');
  });

  it('拒绝损坏的 JSON、未知版本、重复队伍和非法图片地址', () => {
    expect(() => parseBackup('{invalid')).toThrow('JSON');
    expect(() => parseBackup(JSON.stringify({ ...createInitialState(), schemaVersion: 99 }))).toThrow('版本');
    const duplicate = createInitialState();
    duplicate.teams[1].id = duplicate.teams[0].id;
    expect(() => parseBackup(serializeBackup(duplicate))).toThrow('重复');
    const remoteImage = createInitialState();
    remoteImage.teams[0].sticker = 'https://remote.example/image.png';
    expect(() => parseBackup(serializeBackup(remoteImage))).toThrow();
  });

  it('拒绝无效积分、未知队伍、重复结算、超范围计时器', () => {
    const scored = addScore(createInitialState(), [{ teamId: 'team-1', delta: 3 }], '结算', 'garden-1');
    const badDelta = structuredClone(scored);
    badDelta.events[0].changes[0].delta = 1.5;
    expect(() => parseBackup(serializeBackup(badDelta))).toThrow();
    const missing = structuredClone(scored);
    missing.events[0].changes[0].teamId = 'missing';
    expect(() => parseBackup(serializeBackup(missing))).toThrow('队伍');
    const duplicate = structuredClone(scored);
    duplicate.events.push({ ...structuredClone(duplicate.events[0]), id: 'different-id' });
    expect(() => parseBackup(serializeBackup(duplicate))).toThrow('重复的轮次');
    expect(() => parseBackup(serializeBackup({ ...scored, timer: { duration: 3, remaining: 3, endsAt: 'invalid' } } as never))).toThrow();
  });

  it('拒绝过长名称和原型注入队伍编号', () => {
    const tooLong = createInitialState();
    tooLong.teams[0].name = '队'.repeat(25);
    expect(() => parseBackup(serializeBackup(tooLong))).toThrow();
    const prototype = createInitialState();
    prototype.teams[0].id = '__proto__';
    expect(() => parseBackup(serializeBackup(prototype))).toThrow();
  });

  it('CSV 按总分排序，保留分游戏积分并转义逗号、引号与公式', () => {
    let state = createInitialState();
    state.teams[0].name = '=1+1';
    state.teams[1].name = '队伍,"你好"';
    state = addScore(state, [{ teamId: 'team-1', delta: 2 }], '猜歌');
    state = updateState(state, { gameId: 'garden' });
    state = addScore(state, [{ teamId: 'team-1', delta: 3 }], '逛三园');
    const csv = toCsv(state);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('"1","\'=1+1","2","3","0","0","5"');
    expect(csv).toContain('"队伍,""你好"""');
  });
});

describe('计时与状态更新', () => {
  it('按截止时间计算，页面停顿后也不累计漂移', () => {
    const state = updateState(createInitialState(), { timer: { duration: 5, remaining: 5, endsAt: 10_000 } });
    expect(getTimerSeconds(state, 5_000)).toBe(5);
    expect(getTimerSeconds(state, 5_001)).toBe(5);
    expect(getTimerSeconds(state, 9_999)).toBe(1);
    expect(getTimerSeconds(state, 10_001)).toBe(0);
    expect(getTimerSeconds(state, 20_000)).toBe(0);
    expect(getTimerSeconds(updateState(state, { timer: { duration: 5, remaining: 3, endsAt: null } }), 100_000)).toBe(3);
  });

  it('未来截止时间、时钟回拨和过大的暂停剩余时间均不超过本轮时长', () => {
    const future = updateState(createInitialState(), { timer: { duration: 3, remaining: 3, endsAt: 999_999_999 } });
    expect(getTimerSeconds(future, 0)).toBe(3);
    const paused = updateState(future, { timer: { duration: 3, remaining: 3600, endsAt: null } });
    expect(getTimerSeconds(paused)).toBe(3);
    const expired = updateState(future, { timer: { duration: 3, remaining: 0, endsAt: 1 } });
    expect(getTimerSeconds(expired, 100)).toBe(0);
    const restored = updateState(future, { timer: { ...future.timer, endsAt: null, remaining: getTimerSeconds(future, 0) } });
    expect(parseBackup(serializeBackup(restored)).timer.remaining).toBe(3);
  });

  it('更新状态不可覆盖 schemaVersion 和 revision', () => {
    const state = createInitialState();
    const next = updateState(state, { title: '新的活动', revision: 999, schemaVersion: 2 } as never);
    expect(next.title).toBe('新的活动');
    expect(next.schemaVersion).toBe(1);
    expect(next.revision).toBe(1);
    expect(state.title).toBe('小红花欢乐赛');
  });
});
