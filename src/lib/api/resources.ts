import {
  asBool,
  asEnum,
  asInt,
  asRequiredString,
  asString,
  asStringArray,
  queryString,
} from './http';
import {
  createChapter,
  createVolume,
  deleteChapter,
  deleteVolume,
  getChapter,
  getChapterContent,
  getNovel,
  listChapters,
  listVolumes,
  moveChapterToIndex,
  rebuildNovelIndex,
  refreshNovelStats,
  restoreChapter,
  saveChapterContent,
  scrapChapter,
  searchChapters,
  updateChapter,
  updateVolume,
} from '../repo/novels';
import {
  advanceStoryEvent,
  approveRecallRequest,
  activateEncyclopediaVersion,
  createBranch,
  createCharacter,
  createEncyclopediaEntry,
  createEncyclopediaQuery,
  createOutlineNode,
  createRecallRequest,
  createRelation,
  createStoryEvent,
  createTimelineEvent,
  deleteBranch,
  deleteCharacter,
  deleteEncyclopediaEntry,
  deleteEncyclopediaQuery,
  deleteOutlineNode,
  deleteRecallRequest,
  deleteRelation,
  deleteStoryEvent,
  deleteTimelineEvent,
  getCharacter,
  getCurrentStoryEvent,
  getEncyclopediaEntry,
  getMainBranch,
  getOutlineTree,
  getStoryEvent,
  getEncyclopediaVersion,
  listBranches,
  listCharacters,
  listEncyclopedia,
  listEncyclopediaQueries,
  listEncyclopediaVersions,
  listFinishedStoryEvents,
  listRecallRequests,
  listRelations,
  listStoryEvents,
  listTimelineEvents,
  reorderOutlineNodes,
  replaceOutline,
  resolveEncyclopediaQuery,
  updateBranch,
  updateCharacter,
  updateEncyclopediaEntry,
  updateOutlineNode,
  updateRelation,
  updateStoryEvent,
  updateTimelineEvent,
} from '../repo/story';
import {
  NOVEL_TEXT_KEYS,
  getNovelPreferences,
  readNovelText,
  setNovelText,
  updateNovelPreferences,
} from '../repo/settings';
import {
  createBookmark,
  deleteBookmark,
  deleteTag,
  getChapterTags,
  listBookmarks,
  listTags,
  listUsageLogs,
  setChapterTags,
  summarizeUsage,
  getRun,
  listRuns,
} from '../repo/library';
import { getNovelDiskUsage } from '../store/chapter-files';
import { isSetupFileKey, writeSetupFile } from '../store/setup-files';
import { deriveEventTitle, deriveStepsFromOutline } from '../markdown/outline';
import { buildContext } from '../ai/context';
import type {
  Character,
  CharacterRole,
  OutlineKind,
  OutlineStatus,
  RelationKind,
  StoryEventStatus,
} from '../types';

/**
 * 小说内的资源路由表。
 *
 * 所有资源共用同一套 CRUD 语义，通过 URL 中的资源名分发：
 * GET    /api/novels/{novelId}/{resource}          列表或聚合读取
 * POST   /api/novels/{novelId}/{resource}          新建
 * GET    /api/novels/{novelId}/{resource}/{itemId} 单项读取
 * PATCH  /api/novels/{novelId}/{resource}/{itemId} 更新
 * DELETE /api/novels/{novelId}/{resource}/{itemId} 删除
 */

export interface ResourceContext {
  novelId: string;
  url: URL;
  body: Record<string, unknown>;
  itemId?: string;
}

export interface ResourceDefinition {
  label: string;
  list?: (context: ResourceContext) => unknown;
  create?: (context: ResourceContext) => unknown;
  getItem?: (context: ResourceContext & { itemId: string }) => unknown;
  updateItem?: (context: ResourceContext & { itemId: string }) => unknown;
  deleteItem?: (context: ResourceContext & { itemId: string }) => unknown;
  /**
   * 单例资源的整体更新。
   * 配置类资源没有具体条目标识，更新动作直接落在集合地址上。
   */
  updateSelf?: (context: ResourceContext) => unknown;
}

const ROLE_TYPES: CharacterRole[] = ['protagonist', 'supporting', 'antagonist', 'minor', 'extra'];
const RELATION_KINDS: RelationKind[] = [
  'family',
  'lover',
  'friend',
  'rival',
  'enemy',
  'mentor',
  'subordinate',
  'ally',
  'other',
];
const OUTLINE_KINDS: OutlineKind[] = ['arc', 'beat', 'sub'];
const OUTLINE_STATUS: OutlineStatus[] = ['planned', 'active', 'done'];
const EVENT_KINDS = ['plot', 'background', 'fork', 'merge'] as const;
const STORY_EVENT_STATUS: StoryEventStatus[] = ['active', 'writing', 'done', 'archived'];
/** 百科版本来源。ai 表示由模型抽取生成 */
const ENCYCLOPEDIA_ORIGINS = ['ai', 'manual'] as const;

function requireNovel(novelId: string): void {
  if (!getNovel(novelId)) throw new Error('小说不存在');
}

/**
 * 读取小说全部文本型配置，供设定页与大纲页一次取回。
 *
 * 优先读设定目录下的 Markdown 文件，文件不存在时回退到数据库中的旧值，
 * 这样用户既可以直接用编辑器改文件，也不会因为早期数据没有落盘而丢内容。
 */
function getNovelTexts(novelId: string): Record<string, string> {
  return {
    worldview: readNovelText(novelId, NOVEL_TEXT_KEYS.worldview),
    setting: readNovelText(novelId, NOVEL_TEXT_KEYS.setting),
    outlineOverview: readNovelText(novelId, NOVEL_TEXT_KEYS.outlineOverview),
    endingPlan: readNovelText(novelId, NOVEL_TEXT_KEYS.endingPlan),
    styleSample: readNovelText(novelId, NOVEL_TEXT_KEYS.styleSample),
  };
}


export const RESOURCES: Record<string, ResourceDefinition> = {
  /* ---------------------------------------------------------------- 卷 */
  volumes: {
    label: '卷',
    list: ({ novelId }) => listVolumes(novelId),
    create: ({ novelId, body }) => {
      const title = asString(body.title);
      const volume = createVolume(novelId, title);
      return { ...volume, volumes: listVolumes(novelId) };
    },
    updateItem: ({ itemId, body }) =>
      updateVolume(itemId, {
        title: asString(body.title),
        summary: asString(body.summary),
      }),
    deleteItem: ({ itemId, novelId }) => {
      deleteVolume(itemId);
      return { ok: true, volumes: listVolumes(novelId) };
    },
  },

  /* ---------------------------------------------------------------- 章 */
  chapters: {
    label: '章',
    list: ({ novelId, url }) => {
      const volumeId = queryString(url, 'volumeId');
      // scope=scrapped 时只列废案，供目录里的废案区使用
      const onlyScrapped = queryString(url, 'scope') === 'scrapped';
      const chapters = listChapters(novelId, { volumeId, onlyScrapped });
      const tagMap = new Map(chapters.map((chapter) => [chapter.id, getChapterTags(chapter.id)]));
      return chapters.map((chapter) => ({ ...chapter, tags: tagMap.get(chapter.id) ?? [] }));
    },
    create: ({ novelId, body }) => {
      const chapter = createChapter(novelId, {
        title: asRequiredString(body.title, '章节标题'),
        direction: asString(body.direction),
        volumeId: asString(body.volumeId) || undefined,
        index: asInt(body.index),
        outlineNodeId: asString(body.outlineNodeId) || undefined,
        eventId: asString(body.eventId) || undefined,
        stepIndex: asInt(body.stepIndex),
      });
      return { chapter, chapters: listChapters(novelId) };
    },
    getItem: ({ itemId }) => getChapterContent(itemId),
    updateItem: ({ itemId, body, novelId }) => {
      /*
       * 废案与还原走独立动作。
       *
       * 它们会连带改动序号与正文位置，不适合通过普通字段更新触发，
       * 放在这里显式分流，也便于把失败原因原样带回界面。
       */
      const action = asString(body.action);
      if (action === 'scrap') {
        const chapter = scrapChapter(itemId);
        if (!chapter) throw new Error('章节不存在');
        return { chapter, chapters: listChapters(novelId) };
      }
      if (action === 'restore') {
        const result = restoreChapter(itemId);
        if (!result.ok) {
          if (result.reason === 'occupied') {
            throw new Error(
              `原位置已被《${result.occupiedTitle ?? '其他章节'}》占用，请先把它设为废案再还原`,
            );
          }
          throw new Error(result.reason === 'notScrapped' ? '该章节不是废案' : '章节不存在');
        }
        return { chapter: result.chapter, chapters: listChapters(novelId) };
      }

      // 正文与元数据分开处理，避免一次请求同时覆盖两者
      if (body.content !== undefined) {
        const content = asString(body.content) ?? '';
        const chapter = saveChapterContent(itemId, content, {
          markGenerated: asBool(body.markGenerated) ?? false,
        });
        if (body.title !== undefined) {
          updateChapter(itemId, { title: asString(body.title) });
        }
        return { chapter: getChapter(itemId), wordCount: chapter?.wordCount ?? 0 };
      }
      const updated = updateChapter(itemId, {
        title: asString(body.title),
        status: asEnum(body.status, ['planned', 'drafting', 'generated', 'revised'] as const),
        eventId: body.eventId === null ? null : asString(body.eventId),
        stepIndex: asInt(body.stepIndex),
        timelineSort: asString(body.timelineSort),
        branchId: body.branchId === null ? null : asString(body.branchId),
        direction: asString(body.direction),
        notes: asString(body.notes),
      });

      // 序号改动会牵动同卷其他章节，走专用路径重排并同步文件
      const indexNo = asInt(body.indexNo, 1);
      if (indexNo !== undefined) {
        const moved = moveChapterToIndex(itemId, indexNo);
        return { chapter: moved ?? updated, chapters: listChapters(novelId) };
      }
      return { chapter: updated, chapters: listChapters(novelId) };
    },
    deleteItem: ({ itemId, novelId }) => {
      deleteChapter(itemId);
      return { ok: true, chapters: listChapters(novelId) };
    },
  },

  /* -------------------------------------------------------------- 大纲 */
  outline: {
    label: '大纲',
    list: ({ novelId }) => ({
      nodes: getOutlineTree(novelId),
      overview: readNovelText(novelId, NOVEL_TEXT_KEYS.outlineOverview),
    }),
    create: ({ novelId, body }) => {
      // 传入 nodes 字段时表示用生成结果整体替换大纲，用于 AI 产出后一键写入
      if (Array.isArray(body.nodes)) {
        const nodes = replaceOutline(
          novelId,
          body.nodes as Array<{
            title: string;
            content?: string;
            kind?: OutlineKind;
            children?: Array<{ title: string; content?: string }>;
          }>,
        );
        return { nodes: getOutlineTree(novelId), flat: nodes };
      }
      return createOutlineNode(novelId, {
        title: asRequiredString(body.title, '节点标题'),
        content: asString(body.content),
        kind: asEnum(body.kind, OUTLINE_KINDS, 'beat'),
        parentId: asString(body.parentId) || null,
        chapterId: asString(body.chapterId) || null,
        status: asEnum(body.status, OUTLINE_STATUS, 'planned'),
        orderNo: asInt(body.orderNo),
      });
    },
    updateItem: ({ itemId, body, novelId }) => {
      // 支持通过 orderedIds 字段整体重排，用于拖拽后一次性保存
      const ordered = asStringArray(body.orderedIds);
      if (ordered) {
        reorderOutlineNodes(novelId, ordered);
        return { ok: true };
      }
      return updateOutlineNode(itemId, {
        title: asString(body.title),
        content: asString(body.content),
        kind: asEnum(body.kind, OUTLINE_KINDS),
        status: asEnum(body.status, OUTLINE_STATUS),
        parentId: body.parentId === null ? null : asString(body.parentId),
        orderNo: asInt(body.orderNo),
        chapterId: body.chapterId === null ? null : asString(body.chapterId),
      });
    },
    deleteItem: ({ itemId }) => {
      deleteOutlineNode(itemId);
      return { ok: true };
    },
  },

  /* ---------------------------------------------------------- 角色图鉴 */
  characters: {
    label: '角色',
    list: ({ novelId, url }) =>
      listCharacters(novelId, asEnum(queryString(url, 'roleType'), ROLE_TYPES)),
    create: ({ novelId, body }) =>
      createCharacter(novelId, {
        name: asRequiredString(body.name, '角色名称'),
        aliases: asStringArray(body.aliases),
        emoji: asString(body.emoji),
        roleType: asEnum(body.roleType, ROLE_TYPES, 'supporting'),
        gender: asString(body.gender),
        age: asString(body.age),
        faction: asString(body.faction),
        personality: asString(body.personality),
        appearance: asString(body.appearance),
        ability: asString(body.ability),
        background: asString(body.background),
        arc: asString(body.arc),
        tags: asStringArray(body.tags),
        notes: asString(body.notes),
        isPrimary: asBool(body.isPrimary),
        speechHue: asInt(body.speechHue, 0, 359),
        speechColorMode: asEnum(body.speechColorMode, ['auto', 'manual'] as const),
      }),
    getItem: ({ itemId }) => getCharacter(itemId),
    updateItem: ({ itemId, body }) =>
      updateCharacter(itemId, {
        name: asString(body.name),
        aliases: asStringArray(body.aliases),
        emoji: asString(body.emoji),
        roleType: asEnum(body.roleType, ROLE_TYPES),
        gender: asString(body.gender),
        age: asString(body.age),
        faction: asString(body.faction),
        personality: asString(body.personality),
        appearance: asString(body.appearance),
        ability: asString(body.ability),
        background: asString(body.background),
        arc: asString(body.arc),
        foreshadowing: Array.isArray(body.foreshadowing)
          ? (body.foreshadowing as Character['foreshadowing'])
          : undefined,
        tags: asStringArray(body.tags),
        notes: asString(body.notes),
        isPrimary: asBool(body.isPrimary),
        speechHue: asInt(body.speechHue, 0, 359),
        speechColorMode: asEnum(body.speechColorMode, ['auto', 'manual'] as const),
      }),
    deleteItem: ({ itemId }) => {
      deleteCharacter(itemId);
      return { ok: true };
    },
  },

  /* ---------------------------------------------------------- 关系网 */
  relations: {
    label: '角色关系',
    list: ({ novelId }) => ({
      relations: listRelations(novelId),
      characters: listCharacters(novelId),
    }),
    create: ({ novelId, body }) =>
      createRelation(novelId, {
        fromCharacterId: asRequiredString(body.fromCharacterId, '起始角色'),
        toCharacterId: asRequiredString(body.toCharacterId, '目标角色'),
        kind: asEnum(body.kind, RELATION_KINDS, 'other'),
        label: asString(body.label),
        bidirectional: asBool(body.bidirectional) ?? true,
        strength: asInt(body.strength, 1, 5),
        notes: asString(body.notes),
      }),
    updateItem: ({ itemId, body }) =>
      updateRelation(itemId, {
        kind: asEnum(body.kind, RELATION_KINDS),
        label: asString(body.label),
        bidirectional: asBool(body.bidirectional),
        strength: asInt(body.strength, 1, 5),
        notes: asString(body.notes),
        fromCharacterId: asString(body.fromCharacterId),
        toCharacterId: asString(body.toCharacterId),
      }),
    deleteItem: ({ itemId }) => {
      deleteRelation(itemId);
      return { ok: true };
    },
  },

  /*
   * 生成请求日志。
   *
   * 每次调用模型都会留下一条记录，含实际发出的消息全文、模型输出、
   * 用量与失败原因，供界面右下角的日志面板查看。
   */
  'generation-runs': {
    label: '请求日志',
    list: ({ novelId, url }) => ({
      runs: listRuns(novelId, asInt(queryString(url, 'limit'), 1, 200) ?? 40),
    }),
    getItem: ({ itemId }) => getRun(itemId),
  },

  /* -------------------------------------------------------- 百科全书 */
  encyclopedia: {
    label: '百科条目',
    list: ({ novelId, url }) => ({
      entries: listEncyclopedia(novelId, queryString(url, 'category')),
      categories: Array.from(new Set(listEncyclopedia(novelId).map((entry) => entry.category))),
    }),
    create: ({ novelId, body }) =>
      createEncyclopediaEntry(novelId, {
        name: asRequiredString(body.name, '条目名称'),
        category: asString(body.category),
        aliases: asString(body.aliases),
        summary: asString(body.summary),
        content: asString(body.content),
        tags: asStringArray(body.tags),
        sourceChapterId: asString(body.sourceChapterId) || null,
        // 同名条目已存在时会追加一个版本而不是重复建条目，
        // origin 用于区分这一版是模型抽取还是用户填写
        origin: asEnum(body.origin, ENCYCLOPEDIA_ORIGINS),
      }),
    getItem: ({ itemId }) => getEncyclopediaEntry(itemId),
    updateItem: ({ itemId, body }) =>
      updateEncyclopediaEntry(itemId, {
        name: asString(body.name),
        category: asString(body.category),
        aliases: asString(body.aliases),
        summary: asString(body.summary),
        content: asString(body.content),
        tags: asStringArray(body.tags),
        sourceChapterId: body.sourceChapterId === null ? null : asString(body.sourceChapterId),
      }),
    deleteItem: ({ itemId }) => {
      deleteEncyclopediaEntry(itemId);
      return { ok: true };
    },
  },

  /*
   * 百科条目版本。
   *
   * 同一条目下的多份正文共用条目身份，界面在这里列出历史版本，
   * 并把某一版设为启用。只有启用版本会进入给模型的上下文。
   */
  'encyclopedia-versions': {
    label: '百科条目版本',
    list: ({ url }) => {
      const entryId = queryString(url, 'entryId');
      if (!entryId) return { versions: [] };
      return { versions: listEncyclopediaVersions(entryId) };
    },
    getItem: ({ itemId }) => getEncyclopediaVersion(itemId),
    updateItem: ({ itemId, body }) => {
      // 启用某一版，同条目其余版本自动停用
      if (body.action === 'activate' || body.isActive === true) {
        const entry = activateEncyclopediaVersion(itemId);
        if (!entry) throw new Error('版本不存在');
        return { entry };
      }
      throw new Error('仅支持把某个版本设为启用');
    },
  },

  /* -------------------------------------------------------- 时间轴事件 */
  'timeline-events': {
    label: '时间轴事件',
    list: ({ novelId, url }) => ({
      events: listTimelineEvents(novelId, queryString(url, 'branchId')),
      branches: listBranches(novelId),
    }),
    create: ({ novelId, body }) =>
      createTimelineEvent(novelId, {
        branchId: asString(body.branchId) || undefined,
        chapterId: asString(body.chapterId) || null,
        novelTime: asString(body.novelTime),
        title: asRequiredString(body.title, '事件标题'),
        description: asString(body.description),
        impact: asString(body.impact),
        kind: asEnum(body.kind, EVENT_KINDS, 'plot'),
        orderNo: asInt(body.orderNo),
      }),
    updateItem: ({ itemId, body }) =>
      updateTimelineEvent(itemId, {
        branchId: asString(body.branchId),
        chapterId: body.chapterId === null ? null : asString(body.chapterId),
        novelTime: asString(body.novelTime),
        title: asString(body.title),
        description: asString(body.description),
        impact: asString(body.impact),
        kind: asEnum(body.kind, EVENT_KINDS),
        orderNo: asInt(body.orderNo),
      }),
    deleteItem: ({ itemId }) => {
      deleteTimelineEvent(itemId);
      return { ok: true };
    },
  },

  /* -------------------------------------------------------- 时间轴分支 */
  'timeline-branches': {
    label: '时间轴分支',
    list: ({ novelId }) => ({
      branches: listBranches(novelId),
      mainBranchId: getMainBranch(novelId).id,
    }),
    create: ({ novelId, body }) =>
      createBranch(novelId, {
        name: asRequiredString(body.name, '分支名称'),
        parentBranchId: asString(body.parentBranchId) || null,
        forkEventId: asString(body.forkEventId) || null,
        mergeEventId: asString(body.mergeEventId) || null,
        description: asString(body.description),
        color: asString(body.color),
      }),
    updateItem: ({ itemId, body }) =>
      updateBranch(itemId, {
        name: asString(body.name),
        parentBranchId: asString(body.parentBranchId) || null,
        forkEventId: body.forkEventId === null ? null : asString(body.forkEventId),
        mergeEventId: body.mergeEventId === null ? null : asString(body.mergeEventId),
        description: asString(body.description),
        color: asString(body.color),
      }),
    deleteItem: ({ itemId }) => {
      deleteBranch(itemId);
      return { ok: true };
    },
  },

  /* -------------------------------------------------------------- 标签 */
  tags: {
    label: '标签',
    list: ({ novelId }) => listTags(novelId),
    create: ({ novelId, body }) => {
      const chapterId = asString(body.chapterId);
      const names = asStringArray(body.tags) ?? [];
      if (chapterId) {
        setChapterTags(chapterId, names, novelId);
        return { tags: listTags(novelId), chapterTags: getChapterTags(chapterId) };
      }
      return { tags: listTags(novelId) };
    },
    getItem: ({ itemId }) => ({ chapterTags: getChapterTags(itemId) }),
    updateItem: ({ itemId, body, novelId }) => {
      setChapterTags(itemId, asStringArray(body.tags) ?? [], novelId);
      return { chapterTags: getChapterTags(itemId), tags: listTags(novelId) };
    },
    deleteItem: ({ itemId }) => {
      deleteTag(itemId);
      return { ok: true };
    },
  },

  /* -------------------------------------------------------------- 书签 */
  bookmarks: {
    label: '书签',
    list: ({ novelId }) => listBookmarks(novelId),
    create: ({ novelId, body }) =>
      createBookmark(novelId, {
        chapterId: asRequiredString(body.chapterId, '章节'),
        label: asString(body.label),
        anchor: asString(body.anchor),
        note: asString(body.note),
      }),
    deleteItem: ({ itemId }) => {
      deleteBookmark(itemId);
      return { ok: true };
    },
  },

  /* ---------------------------------------------------------- 小说配置 */
  preferences: {
    label: '小说配置',
    list: ({ novelId }) => ({
      preferences: getNovelPreferences(novelId),
      texts: getNovelTexts(novelId),
    }),
    updateSelf: ({ novelId, body }) => {
      // 文本型配置与接口字段同名，键名一致时直接写入对应文件
      const writeText = (key: string, value: string) => {
        if (isSetupFileKey(key)) {
          writeSetupFile(novelId, key, value);
        }
        // 数据库同步保留一份，作为文件被误删时的回退来源
        setNovelText(novelId, key, value);
      };
      const textKeys = Object.values(NOVEL_TEXT_KEYS) as string[];
      for (const key of textKeys) {
        const value = asString(body[key]);
        if (value !== undefined) writeText(key, value);
      }
      // 兼容下划线写法，避免旧调用方写入的字段石沉大海
      const LEGACY_TEXT_ALIASES: Record<string, string> = {
        outline_overview: 'outlineOverview',
        ending_plan: 'endingPlan',
        style_sample: 'styleSample',
      };
      for (const [alias, canonical] of Object.entries(LEGACY_TEXT_ALIASES)) {
        const value = asString(body[alias]);
        if (value !== undefined) writeText(canonical, value);
      }
      const patch: Record<string, unknown> = {};
      for (const key of [
        'targetWords',
        'wordTolerancePercent',
        'calendar',
        'autoAdvanceEvent',
        'autoExtractSettings',
        'allowEventRecall',
      ]) {
        if (body[key] !== undefined) patch[key] = body[key];
      }
      if (body.rules !== undefined) patch.rules = body.rules;
      if (body.budget !== undefined) patch.budget = body.budget;
      if (Object.keys(patch).length > 0) {
        updateNovelPreferences(novelId, patch);
      }
      return {
        preferences: getNovelPreferences(novelId),
        texts: getNovelTexts(novelId),
      };
    },
  },

  /* -------------------------------------------------------- 故事事件 */
  'story-events': {
    label: '故事事件',
    list: ({ novelId, url }) => ({
      events: listStoryEvents(novelId, {
        branchId: queryString(url, 'branchId'),
        status: asEnum(queryString(url, 'status'), STORY_EVENT_STATUS),
      }),
      current: getCurrentStoryEvent(novelId),
      finished: listFinishedStoryEvents(novelId),
    }),
    create: ({ novelId, body }) => {
      const given = Array.isArray(body.steps)
        ? (body.steps as Array<{ title: string; detail?: string; novelTime?: string }>)
        : [];
      const outline = asString(body.outline) ?? '';
      // 手写大纲不带步骤标记，这里从文本结构推导推进步骤，
      // 否则事件建成后没有节点可推进，正文生成也会失去骨架。
      const derived: Array<{ title: string; detail?: string; novelTime?: string }> =
        given.length > 0 ? given : deriveStepsFromOutline(outline);
      if (derived.length === 0) {
        throw new Error('大纲内容不足以推导推进步骤，请补充条目或改用 AI 生成');
      }
      const event = createStoryEvent(novelId, {
        title: asRequiredString(
          asString(body.title) || deriveEventTitle(outline),
          '事件标题',
        ),
        outline,
        steps: derived.map((step) => ({
          title: String(step.title ?? ''),
          detail: String(step.detail ?? ''),
          novelTime: step.novelTime ? String(step.novelTime) : undefined,
        })),
        novelTime: asString(body.novelTime),
        timeSort: asString(body.timeSort),
        userChoice: asString(body.userChoice),
        volumeId: asString(body.volumeId) || null,
        branchId: asString(body.branchId) || undefined,
        notes: asString(body.notes),
      });
      return { event, events: listStoryEvents(novelId) };
    },
    getItem: ({ itemId }) => getStoryEvent(itemId),
    updateItem: ({ itemId, body, novelId }) => {
      /*
       * 按大纲拆分章节。
       *
       * 事件大纲的每个推进步骤对应一章，这里一次性把它们建成章节目录，
       * 免去逐条新建。已经建过的步骤跳过，重复点击不会产生重复章节。
       */
      if (asString(body.action) === 'splitChapters') {
        const event = getStoryEvent(itemId);
        if (!event) throw new Error('事件不存在');
        if (event.steps.length === 0) {
          throw new Error('该事件还没有推进步骤，无法拆分章节');
        }

        const taken = new Set(
          listChapters(novelId)
            .filter((chapter) => chapter.eventId === itemId)
            .map((chapter) => chapter.stepIndex ?? -1),
        );
        const volumes = listVolumes(novelId);
        const volumeId = volumes[volumes.length - 1]?.id;

        let created = 0;
        event.steps.forEach((step, index) => {
          if (taken.has(index)) return;
          createChapter(novelId, {
            title: step.title || `第${index + 1}章`,
            volumeId,
            eventId: itemId,
            stepIndex: index,
            direction: event.userChoice || '',
          });
          created += 1;
        });

        return { event, created, chapters: listChapters(novelId) };
      }

      // advance 字段表示按步推进，用于章节生成后的进度前移
      if (body.advance !== undefined) {
        const stepsForward = asInt(body.advance) ?? 1;
        const event = advanceStoryEvent(itemId, stepsForward);
        return { event, events: listStoryEvents(novelId) };
      }
      const steps = Array.isArray(body.steps)
        ? (body.steps as Array<{ title: string; detail?: string; novelTime?: string }>)
        : undefined;
      const event = updateStoryEvent(itemId, {
        title: asString(body.title),
        outline: asString(body.outline),
        novelTime: asString(body.novelTime),
        timeSort: asString(body.timeSort),
        notes: asString(body.notes),
        status: asEnum(body.status, STORY_EVENT_STATUS),
        progress: asInt(body.progress, 0),
        steps: steps
          ? steps.map((step) => ({
              title: String(step.title ?? ''),
              detail: String(step.detail ?? ''),
              novelTime: step.novelTime ? String(step.novelTime) : undefined,
            }))
          : undefined,
      });
      return { event, events: listStoryEvents(novelId) };
    },
    deleteItem: ({ itemId, novelId }) => {
      deleteStoryEvent(itemId);
      return { ok: true, events: listStoryEvents(novelId) };
    },
  },

  /* ---------------------------------------------------- 百科查询请求 */
  'encyclopedia-queries': {
    label: '设定查询请求',
    list: ({ novelId, url }) =>
      listEncyclopediaQueries(novelId, queryString(url, 'eventId')),
    create: ({ novelId, body }) => {
      const query = createEncyclopediaQuery(novelId, {
        keyword: asRequiredString(body.keyword, '查询关键词'),
        eventId: asString(body.eventId) || null,
        reason: asString(body.reason),
      });
      return { query, queries: listEncyclopediaQueries(novelId) };
    },
    updateItem: ({ itemId, body }) => resolveEncyclopediaQuery(itemId, asString(body.result) ?? ''),
    deleteItem: ({ itemId }) => {
      deleteEncyclopediaQuery(itemId);
      return { ok: true };
    },
  },

  /* ---------------------------------------------------- 往期事件调阅 */
  'recall-requests': {
    label: '往期事件调阅',
    list: ({ novelId }) => listRecallRequests(novelId),
    create: ({ novelId, body }) => {
      const request = createRecallRequest(novelId, {
        eventId: asRequiredString(body.eventId, '事件'),
        reason: asString(body.reason),
      });
      return { request, requests: listRecallRequests(novelId) };
    },
    updateItem: ({ itemId, body, novelId }) => {
      approveRecallRequest(itemId, asBool(body.approved) ?? false);
      return { requests: listRecallRequests(novelId) };
    },
    deleteItem: ({ itemId, novelId }) => {
      deleteRecallRequest(itemId);
      return { ok: true, requests: listRecallRequests(novelId) };
    },
  },

  /* -------------------------------------------------------------- 检索 */
  search: {
    label: '全文检索',
    list: ({ novelId, url }) => {
      const keyword = queryString(url, 'q') ?? '';
      const limit = asInt(queryString(url, 'limit')) ?? 40;
      return { keyword, hits: searchChapters(novelId, keyword, limit) };
    },
  },

  /* ---------------------------------------------------------- 上下文预览 */
  context: {
    label: '上下文预览',
    list: ({ novelId, url }) => {
      const chapterId = queryString(url, 'chapterId');
      const direction = queryString(url, 'direction');
      const eventId = queryString(url, 'eventId');
      const bundle = buildContext(novelId, { chapterId, direction, eventId });
      return {
        totalTokens: bundle.totalTokens,
        budget: bundle.budget,
        trimmed: bundle.trimmed,
        layers: bundle.layers,
        citations: bundle.citations,
      };
    },
  },

  /* -------------------------------------------------------------- 统计 */
  stats: {
    label: '统计',
    list: ({ novelId }) => {
      const novel = getNovel(novelId);
      const storyEvents = listStoryEvents(novelId);
      return {
        novel,
        volumes: listVolumes(novelId).length,
        chapters: listChapters(novelId).length,
        characters: listCharacters(novelId).length,
        relations: listRelations(novelId).length,
        encyclopedia: listEncyclopedia(novelId).length,
        events: listTimelineEvents(novelId).length,
        branches: listBranches(novelId).length,
        // 事件进度概览，供概览页展示整体推进情况
        storyEvents: storyEvents.length,
        storyEventsDone: storyEvents.filter((event) => event.status === 'done').length,
        currentEvent: getCurrentStoryEvent(novelId),
        diskUsage: getNovelDiskUsage(novelId),
        usage: summarizeUsage(novelId),
      };
    },
  },

  /* ---------------------------------------------------------- 用量记录 */
  usage: {
    label: '用量明细',
    list: ({ novelId, url }) => ({
      logs: listUsageLogs({ novelId, limit: asInt(queryString(url, 'limit')) ?? 120 }),
      summary: summarizeUsage(novelId),
    }),
  },

  /* -------------------------------------------------------- 索引重建 */
  index: {
    label: '检索索引',
    list: ({ novelId }) => ({ indexed: rebuildNovelIndex(novelId) }),
    create: ({ novelId }) => {
      const count = rebuildNovelIndex(novelId);
      refreshNovelStats(novelId);
      return { ok: true, indexed: count };
    },
  },
};

/** 供界面展示的资源清单与说明。 */
export const RESOURCE_CATALOG = Object.entries(RESOURCES).map(([key, value]) => ({
  key,
  label: value.label,
  operations: {
    list: Boolean(value.list),
    create: Boolean(value.create),
    getItem: Boolean(value.getItem),
    updateItem: Boolean(value.updateItem),
    deleteItem: Boolean(value.deleteItem),
    updateSelf: Boolean(value.updateSelf),
  },
}));

/** 便捷断言，供路由在进入分发前校验小说存在。 */
export { requireNovel };

/** 判断资源名是否已注册。 */
export function hasResource(resource: string): boolean {
  return Object.prototype.hasOwnProperty.call(RESOURCES, resource);
}
