import { describe, expect, it } from 'vitest';
import { buildSpeakerColors } from './speakers';
import type { Character } from '../types';

/**
 * 角色配色表的构建。
 *
 * 正文里可能用角色名，也可能用别名，两者都必须取到图鉴里设定的色相，
 * 否则同一个角色在不同段落会被染成不同颜色。
 */

/** 造一个只填必要字段的角色。 */
function character(name: string, speechHue: number, aliases: string[] = []): Character {
  return {
    id: `chr_${name}`,
    novelId: 'nv_demo',
    name,
    aliases,
    emoji: '🙂',
    roleType: 'supporting',
    gender: '',
    age: '',
    faction: '',
    personality: '',
    appearance: '',
    ability: '',
    background: '',
    arc: '',
    foreshadowing: [],
    tags: [],
    notes: '',
    sortNo: 0,
    isPrimary: false,
    speechHue,
    speechColorMode: 'auto',
    createdAt: '',
    updatedAt: '',
  };
}

describe('buildSpeakerColors', () => {
  it('把角色名映射到图鉴里设定的色相', () => {
    const colors = buildSpeakerColors([character('陨星', 210)]);
    expect(colors['陨星']).toBe(210);
  });

  it('别名也映射到同一色相', () => {
    const colors = buildSpeakerColors([character('顾羽落', 30, ['猫希人', '白猫'])] );
    expect(colors['顾羽落']).toBe(30);
    expect(colors['猫希人']).toBe(30);
    expect(colors['白猫']).toBe(30);
  });

  it('多个角色各保留自己的色相', () => {
    const colors = buildSpeakerColors([character('甲', 10), character('乙', 200)]);
    expect(colors['甲']).toBe(10);
    expect(colors['乙']).toBe(200);
  });

  it('忽略空名字与空别名', () => {
    const colors = buildSpeakerColors([character('甲', 10, ['', '  ']), character('', 99)]);
    expect(Object.keys(colors)).toEqual(['甲']);
  });

  it('没有角色时返回空表', () => {
    expect(buildSpeakerColors([])).toEqual({});
  });
});
