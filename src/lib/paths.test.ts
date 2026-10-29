import { describe, expect, it } from 'vitest';
import { appUrl, isScreenPath } from './paths';

describe('根目录与 GitHub Pages 子路径', () => {
  it('本机链接和历史贴纸路径保持原样', () => {
    expect(appUrl('?demo=1', '/')).toBe('/?demo=1');
    expect(appUrl('screen/?demo=1', '/')).toBe('/screen/?demo=1');
    expect(appUrl('/stickers/flower-01.png', '/')).toBe('/stickers/flower-01.png');
  });
  it('仓库下的控制台、大屏与贴纸都带正确前缀', () => {
    const base = '/red-flower-offsite-panel/';
    expect(appUrl('', base)).toBe(base);
    expect(appUrl('?demo=1', base)).toBe(`${base}?demo=1`);
    expect(appUrl('screen/?demo=1', base)).toBe(`${base}screen/?demo=1`);
    expect(appUrl('/stickers/flower-01.png', base)).toBe(`${base}stickers/flower-01.png`);
    expect(appUrl('materials-notice.html', base)).toBe(`${base}materials-notice.html`);
  });
  it('无尾斜线的基路径也能正确拼接', () => {
    expect(appUrl('/stickers/flower-01.png', '/panel')).toBe('/panel/stickers/flower-01.png');
  });
  it('根路径与仓库子路径都能识别只读大屏', () => {
    expect(isScreenPath('/screen', '/')).toBe(true);
    expect(isScreenPath('/screen/', '/')).toBe(true);
    expect(isScreenPath('/panel/screen/', '/panel/')).toBe(true);
    expect(isScreenPath('/panel/screen', '/panel')).toBe(true);
  });
  it('控制台和相似路径不能被误判为大屏', () => {
    expect(isScreenPath('/panel/', '/panel/')).toBe(false);
    expect(isScreenPath('/panel', '/panel/')).toBe(false);
    expect(isScreenPath('/panel/screenshot', '/panel/')).toBe(false);
    expect(isScreenPath('/panel-other/screen/', '/panel/')).toBe(false);
  });
});
