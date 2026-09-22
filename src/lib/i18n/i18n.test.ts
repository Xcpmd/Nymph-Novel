import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCALE, DICTIONARIES, createTranslator, interpolate, translate } from './index';

describe('国际化', () => {
  it('默认语言为中文且字典已登记', () => {
    expect(DEFAULT_LOCALE).toBe('zh');
    expect(DICTIONARIES.zh).toBeDefined();
  });

  it('按点分路径读取文案', () => {
    expect(translate('zh', 'nav.shelf')).toBe('书架');
    expect(translate('zh', 'shelf.status.ongoing')).toBe('连载中');
  });

  it('未知路径回退到键名本身，界面不会出现空白', () => {
    expect(translate('zh', 'not.exist.key')).toBe('not.exist.key');
  });

  it('未知语言回退到默认语言', () => {
    expect(translate('en', 'nav.shelf')).toBe('书架');
  });

  it('替换占位符', () => {
    expect(translate('zh', 'shelf.importSuccess', { chapters: 12, volumes: 2 })).toBe(
      '导入完成，共 12 章，2 卷',
    );
  });

  it('interpolate 在缺少参数时输出空字符串而不是保留占位符', () => {
    expect(interpolate('前{{a}}后', {})).toBe('前后');
    expect(interpolate('原样返回')).toBe('原样返回');
  });

  it('绑定语言的翻译函数可用', () => {
    const t = createTranslator('zh');
    expect(t('common.save')).toBe('保存');
    expect(t('search.resultCount', { count: 3 })).toBe('命中 3 章');
  });
});
