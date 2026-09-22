import type { Character } from '../types';

/**
 * 角色发言配色。
 *
 * 色相存放在角色图鉴里，正文渲染时据此把对白染成该角色的专属颜色。
 * 未登记的角色由 hueForSpeaker 按名称推导，保证同一角色每次渲染颜色一致。
 */

/** 角色名到色相的映射表。 */
export interface SpeakerColor {
  [name: string]: number;
}

/**
 * 由角色图鉴构建配色表。
 *
 * 角色名与其全部别名都登记同一色相，正文里用别名称呼时也能取到设定的颜色。
 */
export function buildSpeakerColors(characters: Character[]): SpeakerColor {
  const colors: SpeakerColor = {};
  for (const character of characters) {
    const name = character.name?.trim();
    if (!name) continue;
    colors[name] = character.speechHue;
    for (const alias of character.aliases ?? []) {
      const trimmed = alias.trim();
      if (trimmed) colors[trimmed] = character.speechHue;
    }
  }
  return colors;
}
