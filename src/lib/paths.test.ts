import { describe, expect, it } from 'vitest';
import {
  chapterDirName,
  chapterRelPath,
  legacyChapterRelPath,
  normalizeChapterDirName,
  normalizeContentRelPath,
  normalizeVolumeDirName,
  resolveInsideNovel,
  sanitizeFileName,
  volumeDirName,
} from './paths';

describe('目录与文件命名', () => {
  it('卷与章目录名补足三位序号', () => {
    expect(volumeDirName(1)).toBe('vol-001');
    expect(volumeDirName(12)).toBe('vol-012');
    expect(chapterDirName(7)).toBe('ch-007');
    expect(chapterDirName(240)).toBe('ch-240');
  });

  it('章节相对路径符合约定结构', () => {
    expect(chapterRelPath(1, 1)).toBe('vol-001/ch-001/content.md');
    expect(chapterRelPath(2, 13)).toBe('vol-002/ch-013/content.md');
  });

  it('磁盘路径不出现中文', () => {
    // 中文目录名在跨平台迁移与打包时容易出编码问题，存储层必须保持纯拉丁字符
    const path = chapterRelPath(3, 42);
    expect(/[\u4e00-\u9fff]/u.test(path)).toBe(false);
    expect(/[\u4e00-\u9fff]/u.test(volumeDirName(1))).toBe(false);
    expect(/[\u4e00-\u9fff]/u.test(chapterDirName(1))).toBe(false);
  });
});

describe('旧中文路径兼容', () => {
  it('给出历史中文路径用于定位存量目录', () => {
    expect(legacyChapterRelPath(1, 1)).toBe('卷-001/章-001/正文.md');
    expect(legacyChapterRelPath(2, 13)).toBe('卷-002/章-013/正文.md');
  });

  it('卷章目录名归一为拉丁写法', () => {
    expect(normalizeVolumeDirName('卷-001')).toBe('vol-001');
    expect(normalizeVolumeDirName('vol-002')).toBe('vol-002');
    expect(normalizeChapterDirName('章-007')).toBe('ch-007');
    expect(normalizeChapterDirName('ch-008')).toBe('ch-008');
  });

  it('正文相对路径整体归一', () => {
    expect(normalizeContentRelPath('卷-001/章-001/正文.md')).toBe('vol-001/ch-001/content.md');
    expect(normalizeContentRelPath('卷-012/章-240/正文.md')).toBe('vol-012/ch-240/content.md');
  });

  it('已是拉丁写法的路径保持不变', () => {
    const current = 'vol-003/ch-005/content.md';
    expect(normalizeContentRelPath(current)).toBe(current);
  });
});

describe('resolveInsideNovel', () => {
  it('正常相对路径解析到小说目录内部', () => {
    const resolved = resolveInsideNovel('nv_demo', 'vol-001/ch-001/content.md');
    expect(resolved.replace(/\\/g, '/')).toContain('/novel/nv_demo/vol-001/ch-001/content.md');
  });

  it('拒绝用上级目录逃逸出小说目录', () => {
    expect(() => resolveInsideNovel('nv_demo', '../../other-novel/content.md')).toThrow(/越界/);
  });

  it('拒绝绝对路径写入', () => {
    expect(() => resolveInsideNovel('nv_demo', 'C:/Windows/system32/evil.txt')).toThrow();
  });
});

describe('sanitizeFileName', () => {
  it('替换不能出现在文件名中的字符', () => {
    expect(sanitizeFileName('卷一:序章/开端?')).toBe('卷一_序章_开端_');
  });

  it('压缩连续空白并去除首尾空格', () => {
    expect(sanitizeFileName('  多余   空格  ')).toBe('多余 空格');
  });

  it('空名称回退到默认值', () => {
    expect(sanitizeFileName('', '未命名小说')).toBe('未命名小说');
    expect(sanitizeFileName('///')).toBe('___');
  });
});
