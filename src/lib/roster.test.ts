import { describe, expect, it } from 'vitest';
import { createInitialState, mergeRoster } from './model';
import { parseRosterRows, parseRosterText } from './roster';

const teams = createInitialState().teams;

describe('名单文本与表格解析', () => {
  it('支持逐行姓名和空行，空小组保留为未分组', () => {
    const parsed = parseRosterText('张三\n\n李四\n王五', teams);
    expect(parsed.rows).toEqual([
      { name: '张三', teamId: null, externalId: '' },
      { name: '李四', teamId: null, externalId: '' },
      { name: '王五', teamId: null, externalId: '' },
    ]);
    expect(parsed.issues).toEqual([]);
    expect(parsed.skipped).toBe(0);
  });

  it('支持中文CSV、Tab和英文乱序表头，保留工号前导零', () => {
    const csv = parseRosterText('姓名,小组,工号\n张三,第一小队,001\n李四,10,002', teams);
    expect(csv.rows.map(row => [row.teamId, row.externalId])).toEqual([['team-1', '001'], ['team-10', '002']]);
    const tabs = parseRosterText('name\tteam\tid\n张三\tgroup 2\t００１', teams);
    expect(tabs.rows[0]).toEqual({ name: '张三', teamId: 'team-2', externalId: '001' });
    const reordered = parseRosterText('id,name,team\nA01,"Jane, Doe",Team 3', teams);
    expect(reordered.rows[0]).toEqual({ name: 'Jane, Doe', teamId: 'team-3', externalId: 'A01' });
  });

  it('正确读取引号、字段内逗号和双引号，不用简单split拆坏CSV', () => {
    const parsed = parseRosterText('姓名,小组,工号\n"王,小明",1,"A""01"', teams);
    expect(parsed.rows[0]).toEqual({ name: '王,小明', teamId: 'team-1', externalId: 'A"01' });
    expect(parsed.issues).toEqual([]);
  });

  it('支持中文逗号与常见小组别名，优先匹配当前自定义队名', () => {
    const parsed = parseRosterText('张三，第一组，001\n李四，第十小队，002', teams);
    expect(parsed.rows.map(row => row.teamId)).toEqual(['team-1', 'team-10']);
    const custom = teams.map((team, i) => i === 0 ? { ...team, name: '星光队' } : team);
    const array = parseRosterRows([['姓名', '小组'], ['张三', '星光队'], ['李四', 2], ['王五', '第十组'], ['小六', '未分组']], custom);
    expect(array.rows.map(row => row.teamId)).toEqual(['team-1', 'team-2', 'team-10', null]);
  });

  it('Excel二维数组可忽略带表头的额外列，拒绝未知组和缺名并列出行号', () => {
    const parsed = parseRosterRows([
      ['部门', '工号', '姓名', '小组'],
      ['研发', '001', '张三', 1],
      ['研发', '002', '', 2],
      ['研发', '003', '李四', '不存在'],
      ['研发', '004', '王五', 10],
    ], teams);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.issues.join(' ')).toContain('第 3 行缺少姓名');
    expect(parsed.issues.join(' ')).toContain('第 4 行');
    expect(parsed.issues.join(' ')).toContain('未知小组');
    expect(parsed.skipped).toBe(2);
  });

  it('同名同组不同工号可共存，没有工号的重名行全部跳过', () => {
    const withIds = parseRosterText('姓名,小组,工号\n陈晨,1,A01\n陈晨,1,A02', teams);
    expect(withIds.rows).toHaveLength(2);
    expect(withIds.issues).toEqual([]);
    const ambiguous = parseRosterText('陈晨,1\n陈晨,1\n陈晨,2', teams);
    expect(ambiguous.rows).toEqual([{ name: '陈晨', teamId: 'team-2', externalId: '' }]);
    expect(ambiguous.skipped).toBe(2);
    expect(ambiguous.issues.join(' ')).toContain('工号');
    const mixed = parseRosterText('陈晨,1,A01\n陈晨,1', teams);
    expect(mixed.rows).toHaveLength(1);
    expect(mixed.rows[0].externalId).toBe('A01');
  });

  it('相同工号的完全重复行保留首条，工号与姓名冲突则全部跳过', () => {
    const duplicate = parseRosterText('姓名,小组,工号\n张三,1,001\n张三,1,001', teams);
    expect(duplicate.rows).toHaveLength(1);
    expect(duplicate.skipped).toBe(1);
    const conflicting = parseRosterText('姓名,小组,工号\n张三,1,001\n李四,1,001\n王五,2,002', teams);
    expect(conflicting.rows).toEqual([{ name: '王五', teamId: 'team-2', externalId: '002' }]);
    expect(conflicting.skipped).toBe(2);
    expect(conflicting.issues.join(' ')).toContain('不同姓名或小组');
  });

  it('公式、非法对象、超长字段及无表头多列均不会进入名单', () => {
    const parsed = parseRosterRows([
      ['姓名', '小组', '工号'],
      ['=WEBSERVICE("https://remote")', 1, '001'],
      ['张三', '=HYPERLINK("https://remote")', '002'],
      ['李四', 1, '@SUM(1)'],
      ['王五', 1, 'x'.repeat(81)],
      ['字'.repeat(41), 1, '004'],
      [{ formula: 'DDE' }, 1, '005'],
      ['正常名字', 1, '006'],
    ], teams);
    expect(parsed.rows).toEqual([{ name: '正常名字', teamId: 'team-1', externalId: '006' }]);
    expect(parsed.skipped).toBe(6);
    expect(parsed.issues.filter(issue => issue.includes('公式'))).toHaveLength(3);
    expect(parseRosterRows([['张三', 1, '001', '第四列']], teams).rows).toEqual([]);
  });

  it('人数最多1000，重复导入不会增加成员或改变ID', () => {
    const parsed = parseRosterRows([['姓名'], ...Array.from({ length: 1000 }, (_, i) => [`成员${i}`])], teams);
    expect(parsed.rows).toHaveLength(1000);
    const first = mergeRoster(createInitialState(), parsed.rows);
    expect(first.added).toBe(1000);
    const again = mergeRoster(first.state, parsed.rows);
    expect(again.state).toBe(first.state);
    expect(again.matched).toBe(1000);
    const tooMany = parseRosterRows(Array.from({ length: 1001 }, (_, i) => [`成员${i}`]), teams);
    expect(tooMany.rows).toEqual([]);
    expect(tooMany.issues[0]).toContain('1000');
  });

  it('拒绝未闭合的CSV引号，不把损坏内容部分导入', () => {
    const parsed = parseRosterText('姓名,小组,工号\n"张三,1,001', teams);
    expect(parsed.rows).toEqual([]);
    expect(parsed.issues[0]).toContain('CSV');
  });
});
