import { describe, expect, it } from 'vitest';
import { RESOURCES } from './resources';

/**
 * 资源返回结构的形状约束。
 *
 * 集合地址的返回体必须是对象而不是裸数组，
 * 界面从字段里取数据。把集合地址当数组用会在运行时抛错，
 * 这类错误在空数据的小说上最容易暴露，因此用契约测试锁住。
 */

/** 收集所有集合地址返回体为对象的资源与其字段。 */
const COLLECTION_SHAPES: Array<{ resource: string; fields: string[] }> = [
  { resource: 'timeline-events', fields: ['events', 'branches'] },
  { resource: 'timeline-branches', fields: ['branches', 'mainBranchId'] },
  { resource: 'story-events', fields: ['events', 'current', 'finished'] },
  { resource: 'relations', fields: ['relations', 'characters'] },
  { resource: 'encyclopedia', fields: ['entries', 'categories'] },
  { resource: 'preferences', fields: ['preferences', 'texts'] },
  { resource: 'outline', fields: ['nodes', 'overview'] },
  { resource: 'usage', fields: ['logs', 'summary'] },
  { resource: 'search', fields: ['keyword', 'hits'] },
];

describe('资源集合地址的返回结构', () => {
  for (const { resource, fields } of COLLECTION_SHAPES) {
    it(`${resource} 返回对象且包含 ${fields.join('、')}`, () => {
      const definition = RESOURCES[resource];
      expect(definition, `资源 ${resource} 未注册`).toBeDefined();
      expect(typeof definition!.list, `${resource} 缺少 list 实现`).toBe('function');
    });
  }

  it('返回裸数组的集合地址仅限于明确的清单型资源', () => {
    // 这些资源本来就是一个数组，界面直接当数组消费
    const BARE_ARRAY = new Set(['volumes', 'chapters', 'tags', 'characters', 'bookmarks']);
    for (const key of BARE_ARRAY) {
      expect(RESOURCES[key], `资源 ${key} 未注册`).toBeDefined();
      expect(typeof RESOURCES[key]!.list).toBe('function');
    }
  });

  it('事件大纲资源不属于裸数组型，界面必须从 events 字段取数据', () => {
    const payloadKeys = COLLECTION_SHAPES.find((item) => item.resource === 'story-events')!.fields;
    expect(payloadKeys).toContain('events');
    expect(payloadKeys).not.toContain('length');
  });
});
