import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, FileUp, LoaderCircle } from 'lucide-react';
import type { NormalizedRosterRow, Team } from '../lib/model';
import { parseRosterRows, parseRosterText } from '../lib/roster';

type Preview = { rows: NormalizedRosterRow[]; issues: string[]; skipped: number };
type Props = {
  teams: Team[];
  onImport: (rows: NormalizedRosterRow[]) => string | null;
  onClose: () => void;
};

function decodeText(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(buffer);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(buffer);
  const utf8 = new TextDecoder('utf-8').decode(buffer);
  if (!utf8.includes('\uFFFD')) return utf8;
  try { return new TextDecoder('gb18030', { fatal: true }).decode(buffer); }
  catch { throw new Error('无法识别编码，请另存为 UTF-8 CSV。'); }
}

function downloadTemplate(teams: Team[]) {
  const escape = (text: string) => {
    const safe = /^[\s\u0000-\u001f]*[=+\-@]/.test(text) ? `'${text}` : text;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const content = '\uFEFF' + [
    ['姓名', '小组', '工号'],
    ['张三', teams[0]?.name || '第一小队', '001'],
    ['李四', teams[1]?.name || teams[0]?.name || '第二小队', '002'],
  ].map(row => row.map(escape).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url; link.download = '名单模板.csv'; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function RosterImport({ teams, onImport, onClose }: Props) {
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const requestId = useRef(0);

  useEffect(() => () => { requestId.current += 1; }, []);

  function acceptResult(result: Preview, id: number) {
    if (id !== requestId.current) return;
    if (result.rows.length > 1000) throw new Error('每次最多导入 1000 人。');
    setPreview(result);
    setError(result.rows.length ? '' : '没有可导入的姓名，请核对名单。');
  }

  function previewText() {
    const id = ++requestId.current;
    setError(''); setPreview(null); setFileName('');
    try { acceptResult(parseRosterText(text, teams), id); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '名单无法读取。'); }
  }

  async function readFile(file: File) {
    const id = ++requestId.current;
    setLoading(true); setError(''); setPreview(null); setFileName(file.name);
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('文件不能超过 5 MB。');
      const extension = file.name.split('.').at(-1)?.toLowerCase();
      if (extension === 'xls') throw new Error('请将 .xls 另存为 .xlsx 或 CSV。');
      let result: Preview;
      if (extension === 'xlsx') {
        let rows: unknown[][];
        try {
          const { readSheet } = await import('read-excel-file/browser');
          rows = await readSheet(file, { parseNumber: (value: string) => value });
        } catch {
          throw new Error('Excel 读取失败，请另存为 .xlsx 或 CSV。');
        }
        if (id !== requestId.current) return;
        result = parseRosterRows(rows, teams);
      } else if (['csv', 'tsv', 'txt'].includes(extension || '')) {
        const source = decodeText(await file.arrayBuffer());
        if (id !== requestId.current) return;
        result = parseRosterText(source, teams);
      } else {
        throw new Error('请选择 Excel、CSV 或文本名单。');
      }
      acceptResult(result, id);
    } catch (cause) {
      if (id === requestId.current) setError(cause instanceof Error ? cause.message : '名单无法读取。');
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }

  function submit() {
    if (!preview?.rows.length || loading) return;
    setError('');
    try {
      const issue = onImport(preview.rows);
      if (issue) setError(issue);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '导入未完成，请重试。');
    }
  }

  return <div className="roster-import">
    <div className="roster-source-actions">
      <label className={`button roster-file-button ${loading ? 'roster-disabled' : ''}`}>
        <FileUp size={17} />选择文件
        <input
          className="roster-file-input"
          aria-label="选择名单文件"
          type="file"
          accept=".xlsx,.xls,.csv,.tsv,.txt"
          disabled={loading}
          onChange={event => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void readFile(file);
          }}
        />
      </label>
      <button className="button roster-template-button" type="button" disabled={loading} onClick={() => downloadTemplate(teams)}><ArrowDownToLine size={16} />CSV 模板</button>
    </div>
    <label className="roster-paste-label" htmlFor="roster-paste">或粘贴名单</label>
    <textarea
      id="roster-paste"
      className="roster-paste"
      aria-label="粘贴名单"
      placeholder={'姓名,小组,工号\n张三,第一小队,001\n李四,第二小队,002'}
      rows={4}
      value={text}
      disabled={loading}
      onChange={event => {
        requestId.current += 1;
        setText(event.target.value); setPreview(null); setError(''); setFileName('');
      }}
    />
    <div className="roster-preview-actions"><span className="roster-format-hint">Excel / CSV / 逐行姓名</span><button className="button" type="button" disabled={loading || !text.trim()} onClick={previewText}>预览</button></div>
    {loading && <div className="roster-loading" role="status"><LoaderCircle size={16} />读取中…</div>}
    {error && <p className="roster-error" role="alert">{error}</p>}
    {preview && <section className="roster-preview" aria-label="名单预览">
      <div className="roster-preview-heading"><strong>{preview.rows.length} 人</strong>{preview.skipped > 0 && <span>跳过 {preview.skipped} 行</span>}{fileName && <span className="roster-file-name" title={fileName}>{fileName}</span>}</div>
      {preview.rows.length > 0 && <div className="roster-table-wrap"><table className="roster-table"><thead><tr><th>姓名</th><th>小组</th><th>工号</th></tr></thead><tbody>{preview.rows.slice(0, 8).map((row, index) => <tr key={`${row.externalId}-${row.name}-${index}`}><td>{row.name}</td><td>{teams.find(team => team.id === row.teamId)?.name || '—'}</td><td>{row.externalId || '—'}</td></tr>)}</tbody></table></div>}
      {preview.rows.length > 8 && <p className="roster-more">另 {preview.rows.length - 8} 人</p>}
      {preview.issues.length > 0 && <details className="roster-issues"><summary>{preview.issues.length} 处需核对</summary><ul>{preview.issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul></details>}
    </section>}
    <p className="roster-retain-hint">重复导入保留积分</p>
    <div className="roster-footer"><button className="button" type="button" onClick={onClose}>取消</button><button className="button primary" type="button" disabled={loading || !preview?.rows.length} onClick={submit}>导入 {preview?.rows.length || 0} 人</button></div>
  </div>;
}
