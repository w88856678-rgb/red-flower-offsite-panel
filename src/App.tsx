import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import NumberFlow from '@number-flow/react';
import { ArrowDownToLine, ArrowUpFromLine, ArrowUpRight, Check, ChevronLeft, Crown, History, LayoutDashboard, Maximize, Minimize, Monitor, Megaphone, Pencil, Settings2, Sparkles, Trophy, Undo2, Upload, Users, X } from 'lucide-react';
import Stage from './components/Stage';
import { appUrl, isScreenPath } from './lib/paths';
import RosterImport from './components/RosterImport';
import Individuals from './components/Individuals';
import Statistics from './components/Statistics';
import { addScore, addIndividualScore, createInitialState, GAME_CONFIG, getScores, getIndividualScores, getIndividualRanking, getBanterOptions, hasRosterFormula, mergeRoster, parseBackup, serializeBackup, triggerBanter, triggerChallenge, undoLatest, updateState, type ActivityState, type GameId, type NormalizedRosterRow, type Member } from './lib/model';
import { isDemo, isSharedDemo, useActivity } from './lib/useActivity';

type Tab = 'teams' | 'people' | 'stats' | 'settings';
type Target = { kind: 'team' | 'individual'; id: string };
type ModalKind = 'score' | 'rename' | 'roster' | 'restore' | 'reset' | 'challenge' | null;
const games: { id: GameId; name: string }[] = [{ id: 'music', name: '猜歌' }, { id: 'garden', name: '逛三园' }, { id: 'lyrics', name: '歌词接龙' }];
const nav = [{ id: 'teams', name: '团队', Icon: LayoutDashboard }, { id: 'people', name: '个人 MVP', Icon: Users }, { id: 'stats', name: '统计', Icon: History }, { id: 'settings', name: '设置', Icon: Settings2 }] as const;
const normalize = (s: string) => s.trim().normalize('NFKC').toLocaleLowerCase();
function download(name: string, text: string) { const url = URL.createObjectURL(new Blob([text], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
function Modal({ title, close, children, wide = false }: { title: string; close: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} className={`modal ${wide ? 'modal-wide' : ''}`} onCancel={close} onClick={e => { if (e.target === e.currentTarget) close(); }}><div className="modal-heading"><h2>{title}</h2><button className="icon-button" aria-label="关闭" onClick={close}><X size={20} /></button></div>{children}</dialog>;
}

function Settings({ state, patch, reset }: { state: ActivityState; patch: (p: Partial<ActivityState>) => void; reset: () => void }) {
  const [title, setTitle] = useState(state.title), [teams, setTeams] = useState(state.teams), [error, setError] = useState('');
  useEffect(() => { setTitle(state.title); setTeams(state.teams); }, [state.title, state.teams]);
  return <form className="settings-form" onSubmit={e => { e.preventDefault(); const names = teams.map(t => normalize(t.name)); if (!title.trim() || names.some(n => !n)) return setError('名称不能为空'); if (new Set(names).size !== names.length) return setError('队名不能重复'); setError(''); patch({ title: title.trim(), teams: teams.map(t => ({ ...t, name: t.name.trim() })) }); }}>
    <section className="surface settings-section"><div className="section-title"><h2>活动</h2><button className="button primary" type="submit"><Check size={15} />保存</button></div><label className="field">名称<input aria-label="活动名称" maxLength={40} value={title} onChange={e => setTitle(e.target.value)} /></label>{error && <p className="error-text" role="alert">{error}</p>}</section>
    <section className="surface settings-section"><div className="section-title"><h2>队伍</h2></div><div className="team-settings-grid">{teams.map((t, i) => <label className="team-setting" key={t.id}><span>{String(i + 1).padStart(2, '0')}</span><img src={appUrl(t.sticker)} alt="" /><input aria-label={`第${i + 1}队名称`} maxLength={24} value={t.name} onChange={e => setTeams(teams.map(team => team.id === t.id ? { ...team, name: e.target.value } : team))} /></label>)}</div></section>
    <section className="surface settings-section"><label className="setting-toggle"><span>动画</span><input type="checkbox" checked={!state.reducedMotion} onChange={e => patch({ reducedMotion: !e.target.checked, banterEnabled: e.target.checked })} /></label><label className="setting-toggle"><span>允许负分</span><input type="checkbox" checked={state.allowNegative} onChange={e => patch({ allowNegative: e.target.checked })} /></label></section>
    <button type="button" className="text-button danger-text reset-button" onClick={reset}>清空积分</button>
  </form>;
}

export default function App() {
  const readOnly = isScreenPath(location.pathname);
  const { state, commit, writeEnabled, saveError, savedAt, screenConnected, corruptedRaw, needsRecovery } = useActivity(readOnly);
  const [tab, setTab] = useState<Tab>('teams');
  const [modal, setModal] = useState<ModalKind>(null);
  const [challengeId, setChallengeId] = useState('');
  const [selected, setSelected] = useState<Target>({ kind: 'team', id: 'team-1' });
  const [target, setTarget] = useState<Target>({ kind: 'team', id: 'team-1' });
  const [name, setName] = useState(''), [group, setGroup] = useState('');
  const [delta, setDelta] = useState(1), [reason, setReason] = useState('');
  const [restoreState, setRestoreState] = useState<ActivityState | null>(null);
  const [toast, setToast] = useState(''), [fullscreen, setFullscreen] = useState(Boolean(document.fullscreenElement));
  const restoreInput = useRef<HTMLInputElement>(null);
  const scores = useMemo(() => getScores(state), [state]);
  const peopleRanking = useMemo(() => getIndividualRanking(state), [state]);
  const leaders = peopleRanking.filter(p => p.score > 0).slice(0, 3);
  const hasEvents = state.events.some(e => !e.undone) || state.individualEvents.some(e => !e.undone);
  const banter = getBanterOptions(state);
  const notify = useCallback((text: string) => setToast(text), []);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 2800); return () => clearTimeout(t); }, [toast]);
  useEffect(() => { const update = () => setFullscreen(Boolean(document.fullscreenElement)); document.addEventListener('fullscreenchange', update); return () => document.removeEventListener('fullscreenchange', update); }, []);

  const patch = useCallback((p: Partial<ActivityState>, feedback = false) => {
    if (p.allowNegative === false && [...Object.values(getScores(state)), ...Object.values(getIndividualScores(state))].some(n => n < 0)) return notify('请先修正负分');
    if (commit(s => updateState(s, p)) && feedback) notify('已保存');
  }, [state, commit, notify]);
  const score = useCallback((item: Target, amount: number, label?: string) => {
    if (!writeEnabled) return notify('请使用原控制台');
    if (Number.isNaN(amount)) { setTarget(item); setDelta(1); setReason(''); setModal('score'); return; }
    if (commit(s => item.kind === 'team' ? addScore(s, [{ teamId: item.id, delta: amount }], label || '团队计分') : addIndividualScore(s, item.id, amount, label || '个人计分'))) setSelected(item);
    else notify('分数未变更');
  }, [commit, writeEnabled, notify]);
  const undo = useCallback(() => {
    if (!writeEnabled) return notify('请使用原控制台');
    let active = false;
    if (commit(s => { active = s.events.some(e => !e.undone) || s.individualEvents.some(e => !e.undone); return undoLatest(s); })) notify('已撤销');
    else notify(active ? '撤销后会出现负分' : '暂无可撤销记录');
  }, [commit, writeEnabled, notify]);

  useEffect(() => {
    if (readOnly) return;
    const handler = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (modal || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (tab === 'teams' && /^[0-9]$/.test(e.key)) { const i = e.key === '0' ? 9 : Number(e.key) - 1; if (state.teams[i]) setSelected({ kind: 'team', id: state.teams[i].id }); }
      if (tab === 'teams' && selected.kind === 'team') {
        if (e.key === '+' || e.key === '=') { e.preventDefault(); score(selected, 1); }
        if (e.key === '-') { e.preventDefault(); score(selected, -1); }
      }
    };
    window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler);
  }, [readOnly, modal, tab, selected, state.teams, undo, score]);

  const backup = () => download(`${state.title}-${new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' })}${isDemo ? '-演示' : ''}.json`, serializeBackup(state));
  const rename = (item: Target, value: string, teamId?: string | null) => { setTarget(item); setName(value); setGroup(teamId || ''); setModal('rename'); };
  const issue = modal !== 'rename' ? '' : !name.trim() ? '名称不能为空' : name.length > (target.kind === 'team' ? 24 : 40) ? '名称过长' : target.kind === 'individual' && (hasRosterFormula(name) || /[\u0000-\u001f\u007f]/.test(name.trim())) ? '请填写纯文本姓名' : target.kind === 'team' && state.teams.some(t => t.id !== target.id && normalize(t.name) === normalize(name)) ? '队名不能重复' : '';
  const importRoster = (rows: NormalizedRosterRow[]): string | null => {
    if (!writeEnabled) return '请使用原控制台';
    try { let added = 0, matched = 0; commit(s => { const r = mergeRoster(s, rows); added = r.added; matched = r.matched; return r.state; }); setModal(null); setTab('people'); notify(added ? `新增 ${added} 人${matched ? `，已有 ${matched} 人` : ''}` : `名单已存在 · ${matched} 人`); return null; }
    catch (e) { return e instanceof Error ? e.message : '导入失败'; }
  };
  const loadBackup = async (file: File) => { try { if (file.size > 8_000_000) throw new Error('备份不能超过 8 MB'); setRestoreState(parseBackup(await file.text())); setModal('restore'); } catch (e) { notify(e instanceof Error ? e.message : '无法读取备份'); } };
  const toggleFullscreen = async () => { try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); } catch { notify('请使用浏览器全屏'); } };

  if (readOnly) return <div className="screen-root"><Stage state={state} /><div className={`screen-toolbar ${isSharedDemo ? 'screen-toolbar-demo' : ''}`}><a href={appUrl(isDemo ? '?demo=1' : '')}><ChevronLeft size={16} />{isSharedDemo ? '开始体验' : '控制台'}</a>{isDemo && <span>演示</span>}<button onClick={toggleFullscreen}>{fullscreen ? <Minimize size={16} /> : <Maximize size={16} />}{fullscreen ? '退出全屏' : '全屏'}</button><a className="asset-notice-link" href={appUrl('materials-notice.html')} target="_blank" rel="noreferrer">素材声明</a></div>{toast && <div className="toast">{toast}</div>}</div>;

  return <div className="app-shell">
    <header className="app-header"><a className="brand" href={appUrl(isDemo ? '?demo=1' : '')}><img src={appUrl('stickers/flower-04.png')} alt="小红花" /><b>{state.title}</b></a><div className="header-actions">{isDemo && <span className="demo-chip">演示</span>}<span className={`save-status ${saveError ? 'failed' : ''}`} title={savedAt ? '已自动保存' : '自动保存'}><i />{saveError ? '保存异常' : '已保存'}</span><button className="icon-button" aria-label="备份" title="备份" onClick={backup}><ArrowDownToLine size={19} /></button><a className="button primary" href={appUrl(`screen/${isDemo ? '?demo=1' : ''}`)} target="_blank" rel="noreferrer"><Monitor size={17} />大屏<ArrowUpRight size={15} /></a></div></header>
    <aside className="sidebar"><nav aria-label="主导航">{nav.map(({ id, name, Icon }) => <button key={id} className={`nav-item ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}><Icon size={19} /><span>{name}</span></button>)}</nav><a className="mode-link" href={appUrl(isDemo ? '' : '?demo=1')} target="_blank" rel="noreferrer">{isDemo ? '正式活动' : '演示活动'}<ArrowUpRight size={13} /></a></aside>
    <main className="workspace">
      {!writeEnabled && <div className="notice warning">此窗口只读<button onClick={() => location.reload()}>重新连接</button></div>}
      {saveError && <div className="notice error">{saveError}<button onClick={backup}>备份</button>{corruptedRaw && <button onClick={() => download('原始记录.json', corruptedRaw)}>原记录</button>}<button onClick={() => restoreInput.current?.click()}>恢复</button>{needsRecovery && <button onClick={() => setModal('reset')}>重新开始</button>}</div>}
      <div className="game-selector" role="tablist" aria-label="当前游戏">{games.map(g => <button key={g.id} role="tab" aria-label={GAME_CONFIG[g.id].name} aria-selected={state.gameId === g.id} className={state.gameId === g.id ? 'active' : ''} onClick={() => patch({ gameId: g.id, scene: 'game', showAnswer: false })}>{g.name}</button>)}</div>
      <div className="content-layout"><section className="main-column">
        <div className="page-heading"><div className="page-title"><h1>{tab === 'teams' ? '团队积分' : tab === 'people' ? '个人 MVP' : tab === 'stats' ? '统计' : '设置'}</h1>{tab === 'people' && <span className="count">{state.members.length}</span>}</div><div className="page-actions">{(tab === 'teams' || tab === 'people') && <><button className="button" disabled={!hasEvents || !writeEnabled} onClick={undo}><Undo2 size={16} />撤销</button>{tab === 'people' ? state.members.length > 0 && <button className="button primary" disabled={!writeEnabled} onClick={() => setModal('roster')}><Upload size={16} />导入名单</button> : <button className="button" onClick={() => setTab('settings')}><Pencil size={15} />队名</button>}</>}</div></div>
        <fieldset className="main-fieldset" disabled={!writeEnabled || needsRecovery}>
          {tab === 'teams' && <div className="surface score-table"><div className="table-heading"><span>队伍</span><span>积分</span><span>计分</span></div>{state.teams.map((team, i) => <div key={team.id} className={`score-row ${selected.kind === 'team' && selected.id === team.id ? 'selected' : ''}`} data-testid={`score-row-${team.id}`} onClick={() => setSelected({ kind: 'team', id: team.id })}><div className="identity-cell"><span className="row-index">{String(i + 1).padStart(2, '0')}</span><img src={appUrl(team.sticker)} alt="" /><b title={team.name}>{team.name}</b><button className="icon-button rename-button" aria-label={`修改${team.name}队名`} onClick={e => { e.stopPropagation(); rename({ kind: 'team', id: team.id }, team.name); }}><Pencil size={14} /></button></div><span className="score-value" data-testid={`score-${team.id}`}><NumberFlow value={scores[team.id]} animated={!state.reducedMotion} /></span><div className="score-buttons"><button aria-label={`${team.name}减1分`} disabled={!state.allowNegative && scores[team.id] <= 0} onClick={e => { e.stopPropagation(); score({ kind: 'team', id: team.id }, -1); }}>−1</button><button className="score-primary" aria-label={`${team.name}加1分`} onClick={e => { e.stopPropagation(); score({ kind: 'team', id: team.id }, 1); }}>+1</button><button aria-label={`${team.name}加2分`} onClick={e => { e.stopPropagation(); score({ kind: 'team', id: team.id }, 2); }}>+2</button><button aria-label={`${team.name}自定义计分`} onClick={e => { e.stopPropagation(); score({ kind: 'team', id: team.id }, NaN); }}>•••</button></div></div>)}</div>}
          {tab === 'people' && <Individuals state={state} onScore={(id, amount) => score({ kind: 'individual', id }, amount)} onRename={(m: Member) => rename({ kind: 'individual', id: m.id }, m.name, m.teamId)} onImport={() => setModal('roster')} />}
          {tab === 'stats' && <Statistics state={state} />}
          {tab === 'settings' && <Settings state={state} patch={p => patch(p, true)} reset={() => setModal('reset')} />}
        </fieldset>
      </section>
      <aside className="right-column"><section className="surface display-panel"><div className="section-title"><h2>大屏</h2><span className={`connection-dot ${screenConnected ? 'connected' : ''}`} title={screenConnected ? '已连接' : '未连接'} /></div><a className="stage-preview" href={appUrl(`screen/${isDemo ? '?demo=1' : ''}`)} target="_blank" rel="noreferrer" aria-label="打开大屏预览"><Stage state={state} embedded /></a><fieldset className="main-fieldset" disabled={!writeEnabled || needsRecovery}><div className="display-options"><button className={state.scene === 'game' ? 'active' : ''} onClick={() => patch({ scene: 'game' })}>游戏</button><button className={state.scene === 'leaderboard' ? 'active' : ''} onClick={() => patch({ scene: 'leaderboard' })}>团队榜</button><button className={state.scene === 'mvp' ? 'active' : ''} onClick={() => patch({ scene: 'mvp' })}>MVP 榜</button></div><label className="display-toggle"><span>显示积分</span><input type="checkbox" checked={state.scoresVisible} onChange={e => patch({ scoresVisible: e.target.checked })} /></label><div className="banter-actions" role="group" aria-label="小红花互动"><button disabled={!banter.canCelebrate} title="领先队得瑟一下，仅气氛动效" onClick={() => commit(s => triggerBanter(s, 'celebrate'))}><Crown size={16} />得瑟</button><button disabled={!banter.canAttack} title="领先队向其他全部队伍发射小红花，不扣分" onClick={() => commit(s => triggerBanter(s, 'attack'))}><Sparkles size={16} />出击</button><button disabled={!banter.canChallenge} title="选择前三名以外的队伍，向榜一叫阵，不扣分" onClick={() => { setChallengeId(banter.challengers.find(t => selected.kind === 'team' && t.id === selected.id)?.id || banter.challengers[0]?.id || ''); setModal('challenge'); }}><Megaphone size={16} />叫阵</button></div></fieldset></section>
        <section className="surface award-panel"><div className="section-title"><h2>颁奖</h2><Trophy size={17} /></div><fieldset className="main-fieldset" disabled={!writeEnabled || needsRecovery}><div className="segmented"><button className={state.awardMode === 'team' ? 'active' : ''} onClick={() => patch({ awardMode: 'team', podiumRevealed: 0 })}>团队</button><button className={state.awardMode === 'individual' ? 'active' : ''} onClick={() => patch({ awardMode: 'individual', podiumRevealed: 0 })}>个人 MVP</button></div>{state.scene !== 'podium' ? <button className="button wide" onClick={() => patch({ scene: 'podium', podiumRevealed: 0 })}>进入颁奖</button> : <button className="button primary wide" disabled={state.podiumRevealed >= 3 || !state.scoresVisible} onClick={() => patch({ podiumRevealed: state.podiumRevealed + 1 })}>{state.podiumRevealed >= 3 ? '已揭晓' : `揭晓第${['三', '二', '一'][state.podiumRevealed]}名`}</button>}</fieldset></section>
        {tab === 'people' && state.members.length > 0 && <section className="mvp-preview"><div className="section-title"><h2>MVP 前三</h2></div>{leaders.length ? leaders.map(p => <div className="mvp-preview-row" key={p.id}><span>{p.rank}</span><b>{p.name}</b><strong>{p.score}</strong></div>) : <span className="muted">等待积分</span>}</section>}
        <div className="backup-actions"><button onClick={backup}><ArrowDownToLine size={15} />备份</button><button disabled={!writeEnabled} onClick={() => restoreInput.current?.click()}><ArrowUpFromLine size={15} />恢复</button><a className="asset-notice-link" href={appUrl('materials-notice.html')} target="_blank" rel="noreferrer">素材声明</a></div>
      </aside></div>
    </main>
    <input ref={restoreInput} className="visually-hidden" type="file" accept=".json,application/json" aria-label="恢复积分备份" onChange={e => { if (e.target.files?.[0]) void loadBackup(e.target.files[0]); e.target.value = ''; }} />

    {modal === 'challenge' && <Modal title="后排叫阵" close={() => setModal(null)}><form onSubmit={e => { e.preventDefault(); if (commit(s => triggerChallenge(s, challengeId))) setModal(null); else notify('当前队伍无法叫阵'); }}><p className="challenge-quote">别急，我们在憋大的</p><label className="field">队伍<select aria-label="叫阵队伍" value={challengeId} onChange={e => setChallengeId(e.target.value)}>{banter.challengers.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label><button className="button primary wide" type="submit" disabled={!writeEnabled || needsRecovery || !banter.canChallenge || !banter.challengers.some(team => team.id === challengeId)}><Megaphone size={16} />叫阵</button></form></Modal>}
    {modal === 'roster' && <Modal title="导入名单" wide close={() => setModal(null)}><RosterImport teams={state.teams} onImport={importRoster} onClose={() => setModal(null)} /></Modal>}
    {modal === 'score' && <Modal title="自定义计分" close={() => setModal(null)}><form onSubmit={e => { e.preventDefault(); if (!Number.isSafeInteger(delta) || !delta || Math.abs(delta) > 1_000_000) return notify('请输入非零整数'); score(target, delta, reason.trim()); setModal(null); }}><p className="modal-target">{target.kind === 'team' ? state.teams.find(t => t.id === target.id)?.name : state.members.find(m => m.id === target.id)?.name}</p><label className="field">分数<input aria-label="增减分数" type="number" min={-1000000} max={1000000} step={1} value={delta} onChange={e => setDelta(Number(e.target.value))} autoFocus required /></label><label className="field">备注<input aria-label="计分备注" value={reason} maxLength={120} onChange={e => setReason(e.target.value)} placeholder="选填" /></label><button className="button primary wide" type="submit">确认</button></form></Modal>}
    {modal === 'rename' && <Modal title={target.kind === 'team' ? '修改队名' : '成员资料'} close={() => setModal(null)}><form onSubmit={e => { e.preventDefault(); if (issue) return; const member = state.members.find(m => m.id === target.id); if (target.kind === 'individual' && !member?.externalId && state.members.some(m => m.id !== target.id && !m.externalId && m.teamId === (group || null) && normalize(m.name) === normalize(name))) return notify('同组姓名重复'); commit(s => updateState(s, target.kind === 'team' ? { teams: s.teams.map(t => t.id === target.id ? { ...t, name: name.trim() } : t) } : { members: s.members.map(m => m.id === target.id ? { ...m, name: name.trim(), teamId: group || null } : m) })); setModal(null); notify('已保存'); }}><label className="field">名称<input aria-label="新的名称" maxLength={target.kind === 'team' ? 24 : 40} value={name} onChange={e => setName(e.target.value)} autoFocus /></label>{target.kind === 'individual' && <label className="field">小组<select aria-label="成员小组" value={group} onChange={e => setGroup(e.target.value)}><option value="">未分组</option>{state.teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>}{issue && <p className="error-text" role="alert">{issue}</p>}<div className="modal-actions"><button className="button" type="button" onClick={() => setModal(null)}>取消</button><button className="button primary" type="submit" disabled={Boolean(issue)}>保存</button></div></form></Modal>}
    {modal === 'restore' && restoreState && <Modal title="恢复备份" close={() => setModal(null)}><p className="restore-name">{restoreState.title}</p><div className="restore-counts"><span>{restoreState.teams.length} 队</span><span>{restoreState.members.length} 人</span></div><p className="modal-note">将替换当前活动。建议先备份。</p><div className="modal-actions"><button className="button" onClick={backup}>备份当前</button><button className="button primary" disabled={!writeEnabled} onClick={() => { if (!commit(s => ({ ...restoreState, banterCue: null, revision: s.revision + 1, timer: { ...restoreState.timer, endsAt: null } }), true)) return; setModal(null); setRestoreState(null); notify('已恢复'); }}>确认恢复</button></div></Modal>}
    {modal === 'reset' && <Modal title="清空积分？" close={() => setModal(null)}><p className="modal-note">保留队伍和名单，清空全部计分记录。</p><div className="modal-actions"><button className="button" onClick={backup}>先备份</button><button className="button danger" onClick={() => { commit(s => ({ ...createInitialState(false), title: s.title, teams: s.teams, members: s.members, reducedMotion: s.reducedMotion, banterEnabled: s.banterEnabled, allowNegative: s.allowNegative, revision: s.revision + 1 }), true); setModal(null); notify('已清空积分'); }}>确认清空</button></div></Modal>}
    <AnimatePresence>{toast && <motion.div className="toast" role="status" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}><Check size={16} />{toast}</motion.div>}</AnimatePresence>
  </div>;
}
