import { memo, useMemo, useState } from 'react';
import { ArrowDownToLine } from 'lucide-react';
import {
  GAME_CONFIG, getIndividualRanking, getRanking, toAllStatsCsv, toCsv, toIndividualCsv,
  type ActivityState, type GameId,
} from '../lib/model';

type Mode = 'team' | 'individual';
type GameTotals = Record<GameId, number>;
type RecordItem = {
  id: string;
  at: number;
  gameId: GameId;
  label: string;
  undone: boolean;
  kind: Mode;
  changes: { id: string; name: string; delta: number }[];
};

const dayFormatter = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' });
const timeFormatter = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const freshTotals = (): GameTotals => ({ music: 0, garden: 0, lyrics: 0, free: 0 });

function sumChange(target: Map<string, GameTotals>, id: string, game: GameId, delta: number) {
  const scores = target.get(id) || freshTotals();
  scores[game] += delta;
  target.set(id, scores);
}

function timeLabel(at: number) {
  const date = new Date(at);
  return Number.isNaN(date.getTime()) ? '—' : timeFormatter.format(date);
}

function downloadCsv(title: string, kind: string, content: string) {
  const safeTitle = title.replace(/[\\/:*?"<>|\r\n]/g, '_').trim() || '团建积分';
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${safeTitle}-${kind}-${dayFormatter.format(new Date())}.csv`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const Statistics = memo(function Statistics({ state }: { state: ActivityState }) {
  const [mode, setMode] = useState<Mode>('team');
  const teamRanking = useMemo(() => getRanking(state), [state.teams, state.events]);
  const individualRanking = useMemo(() => getIndividualRanking(state), [state.teams, state.members, state.individualEvents]);
  const summary = useMemo(() => {
    const teamNames = new Map(state.teams.map(team => [team.id, team.name]));
    const memberNames = new Map(state.members.map(member => [member.id, `${member.name}${member.externalId ? `（${member.externalId}）` : ''}`]));
    const teamTotals = new Map<string, GameTotals>();
    const individualTotals = new Map<string, GameTotals>();
    const records: RecordItem[] = [];
    let operations = 0;

    for (const event of state.events) {
      if (!event.undone) {
        operations += 1;
        for (const change of event.changes) sumChange(teamTotals, change.teamId, event.gameId, change.delta);
      }
      records.push({
        id: `team-${event.id}`, at: event.at, gameId: event.gameId, label: event.label, undone: event.undone, kind: 'team',
        changes: event.changes.map(change => ({ id: change.teamId, name: teamNames.get(change.teamId) || '—', delta: change.delta })),
      });
    }
    for (const event of state.individualEvents) {
      if (!event.undone) {
        operations += 1;
        sumChange(individualTotals, event.memberId, event.gameId, event.delta);
      }
      records.push({
        id: `individual-${event.id}`, at: event.at, gameId: event.gameId, label: event.label, undone: event.undone, kind: 'individual',
        changes: [{ id: event.memberId, name: memberNames.get(event.memberId) || '—', delta: event.delta }],
      });
    }
    records.sort((a, b) => b.at - a.at || b.id.localeCompare(a.id));
    return { teamTotals, individualTotals, operations, records: records.slice(0, 100), recordCount: records.length };
  }, [state.teams, state.members, state.events, state.individualEvents]);

  const rows = useMemo(() => mode === 'team'
    ? teamRanking.map(team => ({ id: team.id, name: team.name, rank: team.rank, score: team.score, secondary: '' }))
    : individualRanking.map(member => ({ id: member.id, name: member.name, rank: member.rank, score: member.score, secondary: [member.teamName === '未分组' ? '' : member.teamName, member.externalId].filter(Boolean).join(' · ') })),
  [mode, teamRanking, individualRanking]);
  const gameTotals = mode === 'team' ? summary.teamTotals : summary.individualTotals;
  const hasOther = useMemo(() => rows.some(row => (gameTotals.get(row.id)?.free || 0) !== 0), [rows, gameTotals]);
  const hasScores = useMemo(() => rows.some(row => row.score !== 0), [rows]);

  return <div className="stats-view">
    <div className="stats-summary">
      <div><span>队伍</span><strong>{state.teams.length}</strong></div>
      <div><span>个人</span><strong>{state.members.length}</strong></div>
      <div><span>有效操作</span><strong>{summary.operations}</strong></div>
    </div>
    <section className="surface stats-surface">
      <div className="stats-toolbar">
        <div className="segmented stats-mode" role="group" aria-label="统计类型">
          <button type="button" className={mode === 'team' ? 'active' : ''} aria-pressed={mode === 'team'} onClick={() => setMode('team')}>团队</button>
          <button type="button" className={mode === 'individual' ? 'active' : ''} aria-pressed={mode === 'individual'} onClick={() => setMode('individual')}>个人</button>
        </div>
        <div className="stats-export-actions">
          <button className="button" type="button" aria-label={`导出${mode === 'team' ? '团队' : '个人'} CSV`} onClick={() => downloadCsv(state.title, mode === 'team' ? '团队积分' : '个人积分', mode === 'team' ? toCsv(state) : toIndividualCsv(state))}><ArrowDownToLine size={16} />CSV</button>
          <button className="text-button" type="button" onClick={() => downloadCsv(state.title, '全部积分', toAllStatsCsv(state))}>全部 CSV</button>
        </div>
      </div>
      {rows.length > 0 ? <div className="stats-table-wrap"><table className="stats-table">
        <thead><tr><th>名次</th><th>{mode === 'team' ? '队伍' : '姓名'}</th><th>猜歌</th><th>逛三园</th><th>接龙</th>{hasOther && <th>其他</th>}<th>合计</th></tr></thead>
        <tbody>{rows.map(row => {
          const games = gameTotals.get(row.id);
          return <tr key={row.id}><td className="stats-rank">{hasScores ? row.rank : '—'}</td><td className="stats-name"><strong>{row.name}</strong>{row.secondary && <small>{row.secondary}</small>}</td><td>{games?.music || 0}</td><td>{games?.garden || 0}</td><td>{games?.lyrics || 0}</td>{hasOther && <td>{games?.free || 0}</td>}<td className="stats-total">{row.score}</td></tr>;
        })}</tbody>
      </table></div> : <div className="stats-empty">暂无记录</div>}
    </section>
    <details className="surface stats-history">
      <summary>计分明细<span>{summary.recordCount > 100 ? '最近 100 条' : summary.recordCount}</span></summary>
      {summary.records.length ? <div className="stats-record-list">{summary.records.map(record => <div className={`stats-record ${record.undone ? 'stats-record-undone' : ''}`} key={record.id} title={record.label || undefined}>
        <div className="stats-record-main"><span className="stats-record-kind">{record.kind === 'team' ? '团队' : '个人'}</span><div className="stats-record-changes">{record.changes.map(change => <span key={change.id}><b>{change.name}</b><strong className={change.delta < 0 ? 'stats-negative' : ''}>{change.delta > 0 ? '+' : ''}{change.delta}</strong></span>)}</div>{record.undone && <em className="stats-undone-label">已撤销</em>}</div>
        <div className="stats-record-meta"><span>{GAME_CONFIG[record.gameId].shortName}</span><time dateTime={Number.isNaN(new Date(record.at).getTime()) ? undefined : new Date(record.at).toISOString()}>{timeLabel(record.at)}</time></div>
      </div>)}</div> : <div className="stats-empty">暂无记录</div>}
    </details>
  </div>;
});

export default Statistics;
