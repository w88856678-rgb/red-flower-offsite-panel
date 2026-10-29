import { useMemo, useState } from 'react';
import NumberFlow from '@number-flow/react';
import { ChevronLeft, ChevronRight, Ellipsis, Pencil, Search } from 'lucide-react';
import { getIndividualRanking, type ActivityState, type Member } from '../lib/model';

type IndividualsProps = {
  state: ActivityState;
  onScore: (id: string, delta: number) => void;
  onRename: (member: Member) => void;
  onImport: () => void;
};

const PAGE_SIZE = 12;
const UNGROUPED = '__ungrouped__';
const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase().trim();

export default function Individuals({ state, onScore, onRename, onImport }: IndividualsProps) {
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('');
  const [page, setPage] = useState(0);

  const standings = useMemo(() => new Map(getIndividualRanking(state).map(member => [member.id, member])), [state.members, state.individualEvents, state.teams]);
  const groupOptions = useMemo(() => {
    const used = new Set(state.members.map(member => member.teamId));
    return { teams: state.teams.filter(team => used.has(team.id)), hasUngrouped: used.has(null) };
  }, [state.members, state.teams]);
  const filtered = useMemo(() => {
    const needle = normalize(query);
    return state.members.filter(member => {
      const matchesGroup = !group || (group === UNGROUPED ? member.teamId === null : member.teamId === group);
      return matchesGroup && (!needle || normalize(member.name).includes(needle) || normalize(member.externalId).includes(needle));
    });
  }, [state.members, query, group]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const visible = useMemo(() => filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE), [filtered, currentPage]);

  if (!state.members.length) return <div className="surface individual-empty"><button type="button" className="button primary" onClick={onImport}>导入名单</button></div>;

  return <section className="surface individual-panel">
    <div className="individual-filters">
      <div className="individual-search"><Search size={17} aria-hidden="true" /><input type="search" aria-label="搜索个人" placeholder="姓名或工号" value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} /></div>
      <select aria-label="筛选小组" value={group} onChange={event => { setGroup(event.target.value); setPage(0); }}>
        <option value="">全部小组</option>
        {groupOptions.teams.map(team => <option value={team.id} key={team.id}>{team.name}</option>)}
        {groupOptions.hasUngrouped && <option value={UNGROUPED}>未分组</option>}
      </select>
    </div>
    <div className="score-table individual-table">
      <div className="table-heading"><span>成员</span><span>积分</span><span>计分</span></div>
      {visible.map(member => {
        const standing = standings.get(member.id);
        const score = standing?.score ?? 0;
        const rank = standing?.rank ?? 0;
        const teamName = standing?.teamName || '未分组';
        const ranked = score !== 0 && rank > 0;
        return <div className="score-row individual-row" key={member.id} data-testid={`person-row-${member.id}`} role="group" aria-label={[member.name, member.externalId, teamName].filter(Boolean).join(' ')}>
          <div className="identity-cell individual-identity-cell">
            <span className={`individual-rank ${ranked && score > 0 && rank <= 3 ? 'individual-rank-top' : ''}`} aria-label={ranked ? `第${rank}名` : '未得分'}>{ranked ? rank : '—'}</span>
            <span className="individual-person"><strong>{member.name}</strong><span className="individual-meta">{member.externalId && <span>{member.externalId}</span>}<span>{teamName}</span></span></span>
            <button type="button" className="icon-button individual-rename" aria-label={`修改${member.name}姓名`} title="修改姓名" onClick={() => onRename(member)}><Pencil size={15} aria-hidden="true" /></button>
          </div>
          <div className={`score-value individual-score ${String(score).length > 6 ? 'individual-score-wide' : ''}`} data-testid={`person-score-${member.id}`}><NumberFlow value={score} animated={!state.reducedMotion} format={{ useGrouping: false }} /></div>
          <div className="score-buttons individual-score-buttons">
            <button type="button" aria-label={`${member.name}减1分`} disabled={!state.allowNegative && score <= 0} onClick={() => onScore(member.id, -1)}>−1</button>
            <button type="button" className="add-main" aria-label={`${member.name}加1分`} onClick={() => onScore(member.id, 1)}>+1</button>
            <button type="button" className="add-secondary" aria-label={`${member.name}加2分`} onClick={() => onScore(member.id, 2)}>+2</button>
            <button type="button" className="icon-button" aria-label={`${member.name}自定义计分`} title="自定义计分" onClick={() => onScore(member.id, NaN)}><Ellipsis size={18} aria-hidden="true" /></button>
          </div>
        </div>;
      })}
      {!visible.length && <div className="individual-no-results" role="status">未找到</div>}
    </div>
    {pageCount > 1 && <div className="individual-pagination">
      <button type="button" className="icon-button" aria-label="上一页" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={18} aria-hidden="true" /></button>
      <span aria-live="polite">{currentPage + 1} / {pageCount}</span>
      <button type="button" className="icon-button" aria-label="下一页" disabled={currentPage >= pageCount - 1} onClick={() => setPage(currentPage + 1)}><ChevronRight size={18} aria-hidden="true" /></button>
    </div>}
  </section>;
}
