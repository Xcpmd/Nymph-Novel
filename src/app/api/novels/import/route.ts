import { asString, handle, readBody } from '@/lib/api/http';
import { importNovel, parsePlainText, type ImportDocument } from '@/lib/service/import';
import { listNovels } from '@/lib/repo/novels';
import type { CharacterRole, RelationKind } from '@/lib/types';

/**
 * POST /api/novels/import
 * 请求体支持两种形态：
 * 传入 archive 字段时为结构化归档对象，直接还原。
 * 传入 text 字段时为纯文本，按第X卷与第X章的标记切分。
 */
export async function POST(request: Request) {
  return handle(async () => {
    const body = await readBody(request);
    const title = asString(body.title) ?? '';

    let document: ImportDocument;
    if (body.archive && typeof body.archive === 'object') {
      const archive = body.archive as Record<string, unknown>;
      const novel = (archive.novel ?? {}) as Record<string, unknown>;
      const texts = (archive.texts ?? {}) as Record<string, unknown>;
      const volumes = Array.isArray(archive.volumes) ? archive.volumes : [];
      const rawCharacters = Array.isArray(archive.characters) ? archive.characters : [];

      const chapters: ImportDocument['chapters'] = [];
      for (const volume of volumes as Array<Record<string, unknown>>) {
        const volumeTitle = asString(volume.title) ?? '';
        const list = Array.isArray(volume.chapters) ? volume.chapters : [];
        for (const chapter of list as Array<Record<string, unknown>>) {
          chapters.push({
            title: asString(chapter.title) ?? '未命名章节',
            content: asString(chapter.content) ?? '',
            volumeTitle: volumeTitle || undefined,
            timelineTime: asString(chapter.timelineTime),
            status: 'generated',
          });
        }
      }

      // 归档中的关系以角色标识记录，这里换算为姓名，导入时按名称重新绑定
      const nameById = new Map<string, string>();
      for (const character of rawCharacters as Array<Record<string, unknown>>) {
        const id = asString(character.id);
        const name = asString(character.name);
        if (id && name) nameById.set(id, name);
      }
      const rawRelations = Array.isArray(archive.relations) ? archive.relations : [];
      const relations: ImportDocument['relations'] = [];
      for (const relation of rawRelations as Array<Record<string, unknown>>) {
        const from = nameById.get(asString(relation.fromCharacterId) ?? '');
        const to = nameById.get(asString(relation.toCharacterId) ?? '');
        if (!from || !to) continue;
        relations.push({
          from,
          to,
          kind: asString(relation.kind) as RelationKind | undefined,
          label: asString(relation.label),
          strength: Number(relation.strength) || 3,
        });
      }

      const rawEncyclopedia = Array.isArray(archive.encyclopedia) ? archive.encyclopedia : [];

      document = {
        title: title || asString(novel.title) || '导入的小说',
        author: asString(novel.author),
        genre: asString(novel.genre),
        summary: asString(novel.summary),
        coverEmoji: asString(novel.coverEmoji),
        worldview: asString(texts.worldview),
        setting: asString(texts.setting),
        outlineOverview: asString(texts.outlineOverview),
        calendar: asString((archive.preferences as Record<string, unknown> | undefined)?.calendar),
        chapters,
        characters: (rawCharacters as Array<Record<string, unknown>>).map((character) => ({
          name: asString(character.name) ?? '',
          aliases: Array.isArray(character.aliases) ? (character.aliases as string[]) : [],
          roleType: asString(character.roleType) as CharacterRole | undefined,
          gender: asString(character.gender),
          age: asString(character.age),
          personality: asString(character.personality),
          ability: asString(character.ability),
          background: asString(character.background),
          emoji: asString(character.emoji),
          isPrimary: character.isPrimary === true,
        })),
        relations,
        encyclopedia: (rawEncyclopedia as Array<Record<string, unknown>>).map((entry) => ({
          name: asString(entry.name) ?? '',
          category: asString(entry.category),
          aliases: asString(entry.aliases),
          summary: asString(entry.summary),
          content: asString(entry.content),
        })),
      };
    } else {
      const text = asString(body.text) ?? '';
      if (!text.trim()) throw new Error('导入内容不能为空');
      document = {
        title: title || '导入的小说',
        author: asString(body.author),
        genre: asString(body.genre),
        chapters: parsePlainText(text),
      };
    }

    if (document.chapters.length === 0) throw new Error('没有解析出任何章节');

    const result = importNovel(document);
    return { ...result, novels: listNovels() };
  });
}
