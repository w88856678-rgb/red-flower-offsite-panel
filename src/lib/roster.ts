import Papa from 'papaparse';
import { hasRosterFormula, normalizeRosterName, rosterIdentity, type NormalizedRosterRow, type Team } from './model';

export type { NormalizedRosterRow } from './model';

export interface RosterParseResult {
  rows: NormalizedRosterRow[];
  issues: string[];
  skipped: number;
}

const NAME_HEADERS = new Set(['姓名', '名字', '成员姓名', '成员', '人员姓名', 'name', 'fullname', 'member', 'membername', 'participant']);
const TEAM_HEADERS = new Set(['小组', '组别', '组名', '队伍', '队名', '所属小组', '分组', 'team', 'group', 'teamname', 'groupname']);
const ID_HEADERS = new Set(['工号', '编号', '外部编号', '员工编号', '员工号', '员工工号', '成员编号', '人员编号', 'id', 'externalid', 'employeeid', 'staffid', 'number', 'no']);

function cellText(value: unknown): string | null {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function groupKey(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase('en-US').replace(/[\s_-]+/g, '');
}

function headerKey(value: string): string {
  return groupKey(value).replace(/[（）():：]/g, '');
}

function groupNumber(value: string): number | null {
  const key = groupKey(value);
  const match = key.match(/^(?:第|小组|group|team)?([0-9]{1,2}|[一二三四五六七八九十]+)(?:小队|小组|组|队)?$/i);
  if (!match) return null;
  const n = match[1];
  if (/^\d+$/.test(n)) return Number(n);
  const digits: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (n === '十') return 10;
  if (n.length === 1) return digits[n] || null;
  if (/^十[一二三四五六七八九]$/.test(n)) return 10 + digits[n[1]];
  if (/^[一二]十$/.test(n)) return digits[n[0]] * 10;
  return null;
}

function makeGroupResolver(teams: Team[]) {
  const named = new Map<string, string[]>();
  for (const team of teams) {
    for (const alias of new Set([groupKey(team.name), groupKey(team.id)])) named.set(alias, [...(named.get(alias) || []), team.id]);
  }
  return (value: string): { teamId: string | null; issue?: string } => {
    const key = groupKey(value);
    if (!key || ['未分组', '未分配', '无', 'none', 'null', '-'].includes(value.trim().toLowerCase())) return { teamId: null };
    const exact = named.get(key);
    if (exact?.length === 1) return { teamId: exact[0] };
    if (exact && exact.length > 1) return { teamId: null, issue: `小组“${value}”对应多个队伍，请改用小组编号。` };
    const number = groupNumber(value);
    if (number !== null && number >= 1 && number <= teams.length) return { teamId: teams[number - 1].id };
    return { teamId: null, issue: `未知小组“${value}”，请使用现有队名或 1–${teams.length}。` };
  };
}

export function parseRosterRows(input: unknown[][], teams: Team[]): RosterParseResult {
  if (!Array.isArray(input)) return { rows: [], issues: ['名单格式无效。'], skipped: 0 };
  const issues: string[] = [];
  const entries: { cells: unknown[]; line: number }[] = [];
  input.forEach((row, i) => {
    if (!Array.isArray(row)) { issues.push(`第 ${i + 1} 行格式无效。`); return; }
    if (row.every(value => value === undefined || value === null || (typeof value === 'string' && !value.trim()))) return;
    entries.push({ cells: row, line: i + 1 });
  });
  if (!entries.length) return { rows: [], issues, skipped: issues.length };
  const first = entries[0].cells.map(value => headerKey(cellText(value) || ''));
  const nameIndex = first.findIndex(value => NAME_HEADERS.has(value));
  const teamIndex = first.findIndex(value => TEAM_HEADERS.has(value));
  const idIndex = first.findIndex(value => ID_HEADERS.has(value));
  const hasHeader = nameIndex >= 0 || [teamIndex, idIndex].filter(i => i >= 0).length >= 2;
  if (hasHeader && nameIndex < 0) return { rows: [], issues: ['表头需要包含“姓名”或 name 列。'], skipped: Math.max(0, entries.length - 1) };
  const data = hasHeader ? entries.slice(1) : entries;
  if (data.length > 1000) return { rows: [], issues: ['一次最多导入 1000 人，请拆分名单。'], skipped: data.length };
  const resolveGroup = makeGroupResolver(teams);
  const candidates: { row: NormalizedRosterRow; line: number; invalid: boolean }[] = [];
  let skipped = issues.length;
  for (const { cells, line } of data) {
    const rawName = cellText(cells[hasHeader ? nameIndex : 0]);
    const rawTeam = cellText(cells[hasHeader ? teamIndex : 1]);
    const rawId = cellText(cells[hasHeader ? idIndex : 2]);
    if (rawName === null || rawTeam === null || rawId === null) { issues.push(`第 ${line} 行包含非文本内容，请使用姓名、小组和工号。`); skipped += 1; continue; }
    if (!hasHeader && cells.length > 3 && cells.slice(3).some(value => String(value ?? '').trim())) { issues.push(`第 ${line} 行超过三列，请添加姓名、小组、工号表头。`); skipped += 1; continue; }
    const name = normalizeRosterName(rawName);
    const externalId = rawId.normalize('NFKC').trim();
    if (!name) { issues.push(`第 ${line} 行缺少姓名。`); skipped += 1; continue; }
    if (name.length > 40 || externalId.length > 80 || rawTeam.length > 100 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(rawName + rawTeam + rawId)) { issues.push(`第 ${line} 行字段过长或含无效字符：姓名最多 40 字，工号最多 80 字。`); skipped += 1; continue; }
    if ([name, rawTeam, externalId].some(hasRosterFormula)) { issues.push(`第 ${line} 行包含公式，请改为纯文本。`); skipped += 1; continue; }
    const group = resolveGroup(rawTeam);
    if (group.issue) { issues.push(`第 ${line} 行：${group.issue}`); skipped += 1; continue; }
    candidates.push({ row: { name, teamId: group.teamId, externalId }, line, invalid: false });
  }
  const externalGroups = new Map<string, typeof candidates>();
  const nameGroups = new Map<string, typeof candidates>();
  for (const candidate of candidates) {
    if (candidate.row.externalId) externalGroups.set(candidate.row.externalId, [...(externalGroups.get(candidate.row.externalId) || []), candidate]);
    const key = rosterIdentity(candidate.row);
    nameGroups.set(key, [...(nameGroups.get(key) || []), candidate]);
  }
  for (const [externalId, group] of externalGroups) {
    if (group.length < 2) continue;
    if (group.some(candidate => rosterIdentity(candidate.row) !== rosterIdentity(group[0].row))) {
      group.forEach(candidate => { candidate.invalid = true; });
      issues.push(`第 ${group.map(candidate => candidate.line).join('、')} 行工号“${externalId}”对应不同姓名或小组，已跳过，请核对。`);
    } else {
      group.slice(1).forEach(candidate => { candidate.invalid = true; });
      issues.push(`工号“${externalId}”重复，保留第 ${group[0].line} 行，其余重复行已跳过。`);
    }
  }
  for (const group of nameGroups.values()) {
    if (group.length < 2) continue;
    const noId = group.filter(candidate => !candidate.row.externalId);
    if (!noId.length) continue;
    noId.forEach(candidate => { candidate.invalid = true; });
    issues.push(`第 ${noId.map(candidate => candidate.line).join('、')} 行“${noId[0].row.name}”同名同组且缺少工号，无法区分，请补充工号。`);
  }
  skipped += candidates.filter(candidate => candidate.invalid).length;
  return { rows: candidates.filter(candidate => !candidate.invalid).map(candidate => candidate.row), issues, skipped };
}

export function parseRosterText(text: string, teams: Team[]): RosterParseResult {
  if (typeof text !== 'string' || text.length > 2_000_000) return { rows: [], issues: ['名单内容过长或格式无效。'], skipped: 0 };
  if (!text.trim()) return { rows: [], issues: [], skipped: 0 };
  const result = Papa.parse<string[]>(text.replace(/^\uFEFF/, ''), {
    header: false,
    dynamicTyping: false,
    skipEmptyLines: 'greedy',
    delimitersToGuess: [',', '\t', ';', '，'],
  });
  const errors = result.errors.filter(error => error.code !== 'UndetectableDelimiter');
  if (errors.length) return {
    rows: [], skipped: result.data.length,
    issues: errors.map(error => `CSV 第 ${(error.row ?? 0) + 1} 行格式有误，请检查引号与分隔符。`),
  };
  return parseRosterRows(result.data, teams);
}
