import { listChapters, searchChapters } from '../repo/novels';
import { readChapterContent } from '../store/chapter-files';
import {
  getCurrentStoryEvent,
  getEncyclopediaCatalog,
  getOutlineTree,
  getStoryEvent,
  listBranches,
  listCharacters,
  listEncyclopediaQueries,
  listFinishedStoryEvents,
  listRelations,
  listStoryEvents,
  listTimelineEvents,
} from '../repo/story';
import {
  DEFAULT_PREFERENCES,
  getNovelPreferences,
  readNovelText,
  NOVEL_TEXT_KEYS,
} from '../repo/settings';
import { estimateTokens, truncateToTokenBudget } from '../token';
import { stripTalkMarkers } from '../markdown/talk';
import type {
  Character,
  ChapterWithVolume,
  ContextBudget,
  EncyclopediaEntry,
  NovelPreferences,
  OutlineNode,
  StoryEvent,
  TimelineEvent,
} from '../types';

/**
 * 分层上下文构建器。
 *
 * 事件驱动的优先级顺序：
 * 一，始终注入层：设定与世界观、整本书大纲、主要人物、角色关系、生成规则、时间轴。
 * 二，事件大纲层：当前事件的完整大纲与步骤进度、所有已完成事件的大纲。
 * 三，前一章全文：保证行文接续自然。
 * 四，百科回填层：模型在大纲阶段提出的查询所对应的条目。
 * 五，按需注入层：检索命中的往期片段，以及经用户放行的事件全文调阅。
 * 六，预算控制：每一层都受 token 上限约束，超出时按相关性裁剪。
 */

export interface ContextLayer {
  key: string;
  label: string;
  content: string;
  tokens: number;
  /** 是否属于始终注入层 */
  always: boolean;
  /** 该层是否因为预算被裁剪 */
  trimmed: boolean;
}

export interface ContextBundle {
  layers: ContextLayer[];
  vars: Record<string, string>;
  totalTokens: number;
  budget: ContextBudget;
  trimmed: boolean;
  /** 供界面展示的引用清单，说明本次注入了哪些内容 */
  citations: Array<{ kind: string; id: string; label: string; tokens: number }>;
}

/**
 * 上下文层的清单，供界面展示与勾选。
 *
 * key 必须与 buildContext 里 push 的第一个参数一致。
 * 新增一层时两处一起补，否则界面上根本勾不到它。
 */
export const CONTEXT_LAYER_CATALOG: Array<{ key: string; label: string; note: string }> = [
  { key: 'worldview', label: '设定与世界观', note: '作品的世界观设定正文' },
  { key: 'setting', label: '核心设定补充', note: '补充性的核心设定' },
  { key: 'style-sample', label: '文风样本', note: '示范段落，用于对齐文笔与叙事腔调' },
  { key: 'outline-overview', label: '整本书大纲', note: '主线脉络，决定剧情走向' },
  { key: 'outline-tree', label: '结构化大纲', note: '大纲页维护的篇章与节拍层级' },
  { key: 'ending-plan', label: '结局与收束计划', note: '预定的结局与收束方式' },
  { key: 'characters-primary', label: '主角与核心人物', note: '主角与关键角色的完整档案' },
  { key: 'characters-secondary', label: '配角与次要人物', note: '次要角色的简要档案' },
  { key: 'relations', label: '角色关系网', note: '人物之间的既有关系' },
  { key: 'rules', label: '生成规则', note: '文风、人称、禁忌等硬性要求' },
  { key: 'calendar', label: '小说内历法', note: '时间写法约定' },
  { key: 'timeline', label: '时间轴', note: '已发生事件的时序' },
  { key: 'encyclopedia-index', label: '百科条目索引', note: '条目的名称与分类，正文按需检索' },
  { key: 'current-event', label: '当前事件大纲', note: '正在推进的事件大纲' },
  { key: 'current-event-steps', label: '事件步骤与进度', note: '步骤清单与当前进度' },
  { key: 'finished-events', label: '已完成事件大纲', note: '已收尾事件的大纲' },
  { key: 'previous-chapter', label: '前一章全文', note: '上一章正文，用于承接语气' },
  { key: 'encyclopedia', label: '百科检索结果', note: '按关键词检索到的条目正文' },
  { key: 'recalled', label: '按需注入的往期正文', note: '模型主动调阅的历史片段' },
];

export interface BuildContextOptions {
  /** 当前正在处理的章节，会从往期注入中排除 */
  chapterId?: string;
  /** 本章推进方向，用于检索相关性判断 */
  direction?: string;
  /** 用户附加要求 */
  instruction?: string;
  /** 选定的故事方向 */
  selectedDirection?: string;
  /** 当前事件 id，缺省时自动取正在推进的事件 */
  eventId?: string;
  /** 需要重点参考的往期片段，通常来自模型自主提出的调阅请求 */
  pinnedChapterIds?: string[];
  /** 已回填的百科查询结果，键为查询关键词 */
  queryResults?: Record<string, string>;
  /** 额外需要注入的百科条目名称 */
  focusTerms?: string[];
  /**
   * 是否允许按预算裁剪各层内容，默认允许。
   *
   * 置为 false 时各层保留完整内容，仅用于用户在界面上确认
   * 「保留全文继续发送」之后的这一次请求。
   */
  allowTrim?: boolean;
  /**
   * 本次要注入的层，数组顺序即注入顺序。
   *
   * 留空表示全部启用并沿用默认顺序。传入非空数组时按白名单处理：
   * 未列出的层既不出现在上下文里，也不会占用 token 预算。
   *
   * 各模板变量都从层内容取值，因此在这里过滤就能一路贯通到提示词，
   * 不必再逐项清理变量。
   */
  layerKeys?: string[];
  /**
   * 本次要写第几步，从 0 开始。
   *
   * 缺省沿用事件的推进进度。允许指定是为了补写或跳写：
   * 想回头补第 2 步，或先把高潮那一步写出来，都不必改动事件进度。
   */
  stepIndex?: number;
}

/* ---------------------------------------------------------- 基础渲染 */

function renderCharacter(character: Character, detailed: boolean): string {
  const head = `${character.name}｜${character.roleType}${
    character.aliases.length > 0 ? `｜别名 ${character.aliases.join('、')}` : ''
  }`;
  if (!detailed) {
    // 次要角色只给性格与能力，控制篇幅；其余字段留给按需检索
    const briefBits = [character.personality, character.ability].filter(Boolean).join('；');
    return briefBits ? `- ${head}：${briefBits}` : `- ${head}`;
  }
  const lines = [`### ${head}`];
  const push = (label: string, value: string) => {
    if (value.trim()) lines.push(`- ${label}：${value.trim()}`);
  };
  push('性别与年龄', [character.gender, character.age].filter(Boolean).join(' '));
  push('阵营', character.faction);
  push('外貌', character.appearance);
  push('性格', character.personality);
  push('能力体系', character.ability);
  push('背景', character.background);
  push('成长线', character.arc);
  // 标签能概括戏份定位（例如「宿敌」「导师」），一并送出
  if (character.tags.length > 0) lines.push(`- 标签：${character.tags.join('、')}`);
  if (character.foreshadowing.length > 0) {
    const items = character.foreshadowing
      .map((item) => `${item.title}｜${item.status}｜${item.detail}`)
      .join('；');
    lines.push(`- 伏笔管理：${items}`);
  }
  if (character.notes.trim()) lines.push(`- 备注：${character.notes.trim()}`);
  return lines.join('\n');
}

/** 角色与发言色相的一览表，供模型为新角色避让已有颜色。 */
function renderSpeechPalette(novelId: string): string {
  const characters = listCharacters(novelId);
  if (characters.length === 0) return '尚未登记角色。';
  return characters
    .map((character) => `- ${character.name}：色相 ${character.speechHue}`)
    .join('\n');
}

function renderRelations(novelId: string): string {
  const relations = listRelations(novelId);
  if (relations.length === 0) return '尚未建立角色关系。';
  const characters = new Map(listCharacters(novelId).map((item) => [item.id, item.name]));
  return relations
    .map((relation) => {
      const from = characters.get(relation.fromCharacterId) ?? '未知角色';
      const to = characters.get(relation.toCharacterId) ?? '未知角色';
      const arrow = relation.bidirectional ? '双向' : '单向';
      const label = relation.label ? `，关系说明 ${relation.label}` : '';
      return `- ${from} 与 ${to}：${relation.kind}，${arrow}，密切程度 ${relation.strength}/5${label}`;
    })
    .join('\n');
}

/** 结构化大纲的层级标签。 */
const OUTLINE_KIND_LABELS: Record<string, string> = {
  arc: '篇章',
  beat: '节拍',
  sub: '子项',
};

/**
 * 把结构化大纲渲染成缩进列表。
 *
 * 大纲页维护的节点树原先只用于页面展示，生成时完全读不到，
 * 在那里排好的篇章与节拍等于白排。
 */
function renderOutlineTree(novelId: string): string {
  const tree = getOutlineTree(novelId);
  if (tree.length === 0) return '';
  const lines: string[] = [];
  const walk = (node: OutlineNode, depth: number) => {
    const indent = '  '.repeat(depth);
    const body = node.content.trim();
    const label = OUTLINE_KIND_LABELS[node.kind] ?? node.kind;
    lines.push(`${indent}- [${label}] ${node.title}${body ? `：${body}` : ''}`);
    for (const child of node.children ?? []) walk(child, depth + 1);
  };
  for (const node of tree) walk(node, 0);
  return lines.join('\n');
}

function renderTimeline(novelId: string): string {
  const branches = listBranches(novelId);
  const events = listTimelineEvents(novelId);
  if (events.length === 0) return '时间轴为空，本章为起点。';
  const branchName = new Map(branches.map((branch) => [branch.id, branch.name]));
  const byBranch = new Map<string, TimelineEvent[]>();
  for (const event of events) {
    const list = byBranch.get(event.branchId) ?? [];
    list.push(event);
    byBranch.set(event.branchId, list);
  }
  const blocks: string[] = [];
  for (const [branchId, list] of byBranch) {
    const name = branchName.get(branchId) ?? '未命名分支';
    const branch = branches.find((item) => item.id === branchId);
    const header = branch?.isMain
      ? `分支 ${name}，为主线`
      : `分支 ${name}，自 ${branchName.get(branch?.parentBranchId ?? '') ?? '未知分支'} 分叉`;
    const lines = list
      .sort((a, b) => a.orderNo - b.orderNo)
      .map(
        (event) =>
          `- ${event.novelTime || '时间待定'}｜${event.title}${
            event.description ? `：${event.description}` : ''
          }`,
      );
    blocks.push(`${header}\n${lines.join('\n')}`);
  }
  return blocks.join('\n\n');
}

/** 事件大纲的紧凑写法，用于历史事件的汇总注入。 */
function renderEventOutline(event: StoryEvent, detailed: boolean): string {
  const head = `### 事件 ${event.orderNo}｜${event.title}｜事件时间 ${event.novelTime || '未标注'}｜状态 ${describeEventStatus(event)}`;
  const outline = detailed ? event.outline : condenseOutline(event.outline);
  const stepLines = event.steps
    .map((step, index) => `  ${index + 1}. ${step.novelTime ? `${step.novelTime}｜` : ''}${step.title}`)
    .join('\n');
  return [head, outline, stepLines ? `步骤清单：\n${stepLines}` : ''].filter(Boolean).join('\n');
}

function describeEventStatus(event: StoryEvent): string {
  if (event.status === 'done') return '已完成';
  if (event.progress > 0) return `推进中，已完成 ${event.progress}/${event.steps.length} 步`;
  return '待开工';
}

/** 把长大纲压缩为首段与各节标题，控制历史事件的注入体积。 */
function condenseOutline(outline: string): string {
  const lines = outline.split('\n');
  const kept: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^#{1,3}\s/.test(trimmed)) kept.push(trimmed);
    else if (kept.length > 0 && kept[kept.length - 1] !== '' && kept.length < 3) kept.push(trimmed);
    if (kept.length > 60) break;
  }
  return kept.join('\n');
}

/** 当前事件的步骤清单，标出每一步的完成状态。 */
/** 渲染步骤清单。focusIndex 标记本次要写的那一步，缺省用事件进度。 */
function renderEventSteps(event: StoryEvent, focusIndex?: number): string {
  if (event.steps.length === 0) return '本次事件尚未拆分步骤。';
  const focus = focusIndex ?? event.progress;
  return event.steps
    .map((step, index) => {
      const marker =
        index < focus ? '已完成' : index === focus ? '本次要写' : '未开始';
      const time = step.novelTime ? `时间 ${step.novelTime}｜` : '';
      const detail = step.detail ? `\n    说明：${step.detail}` : '';
      return `${index + 1}. [${marker}] ${time}${step.title}${detail}`;
    })
    .join('\n');
}

/** 百科索引：只给名称与分类，避免把全部条目正文塞进上下文。 */
function renderEncyclopediaIndex(novelId: string): string {
  const catalog = getEncyclopediaCatalog(novelId);
  if (catalog.length === 0) return '百科全书暂无条目。';
  return catalog
    .map(
      (group) =>
        `${group.category}：${group.entries.map((entry) => entry.name).join('、')}`,
    )
    .join('\n');
}

/* ------------------------------------------------------ 百科检索 */

/** 把一条百科条目渲染成可注入的完整内容。 */
function renderEntry(entry: EncyclopediaEntry): string {
  const lines = [`### [${entry.category}] ${entry.name}`];
  if (entry.aliases) lines.push(`别名：${entry.aliases}`);
  if (entry.summary) lines.push(`概述：${entry.summary}`);
  if (entry.content) lines.push(entry.content);
  if (entry.tags.length > 0) lines.push(`标签：${entry.tags.join('、')}`);
  return lines.join('\n');
}

export interface EncyclopediaLookup {
  entry: EncyclopediaEntry;
  score: number;
  /** 命中来源，用于界面显示检索依据 */
  origin: 'encyclopedia' | 'character' | 'timeline';
}

/**
 * 按关键词检索百科、角色图鉴与时间轴。
 *
 * 供模型提出的查询请求回填使用，也用于按本章方向预取相关设定。
 */
export function lookupSettings(novelId: string, keywords: string[]): EncyclopediaLookup[] {
  const entries = getEncyclopediaCatalog(novelId).flatMap((group) => group.entries);
  const characters = listCharacters(novelId);
  const events = listTimelineEvents(novelId);
  const results: EncyclopediaLookup[] = [];

  for (const keyword of keywords) {
    const term = keyword.trim();
    if (!term) continue;

    for (const entry of entries) {
      let score = 0;
      if (entry.name === term) score = 10;
      else if (entry.name.includes(term)) score = 7;
      else if (entry.aliases.includes(term)) score = 6;
      else if (entry.content.includes(term) || entry.summary.includes(term)) score = 3;
      else if (entry.tags.some((tag) => tag.includes(term))) score = 2;
      if (score > 0) results.push({ entry, score, origin: 'encyclopedia' });
    }

    for (const character of characters) {
      if (character.name === term || character.aliases.includes(term)) {
        results.push({
          entry: {
            id: character.id,
            novelId,
            category: '人物',
            name: character.name,
            aliases: character.aliases.join('、'),
            summary: [character.personality, character.ability].filter(Boolean).join('；'),
            content: renderCharacter(character, true),
            tags: character.tags,
            sourceChapterId: null,
            sortNo: character.sortNo,
            // 人物不是百科条目，没有版本概念，填占位值仅供检索结果呈现
            activeVersionNo: 0,
            versionCount: 0,
            createdAt: character.createdAt,
            updatedAt: character.updatedAt,
          },
          score: 9,
          origin: 'character',
        });
      }
    }

    for (const event of events) {
      if (event.title.includes(term)) {
        results.push({
          entry: {
            id: event.id,
            novelId,
            category: '事件',
            name: event.title,
            aliases: '',
            summary: `${event.novelTime || '时间待定'}｜${event.description}`,
            content: event.impact ? `对主线影响：${event.impact}` : '',
            tags: [],
            sourceChapterId: event.chapterId,
            sortNo: event.orderNo,
            // 事件也不是百科条目，同样填占位值
            activeVersionNo: 0,
            versionCount: 0,
            createdAt: event.createdAt,
            updatedAt: event.updatedAt,
          },
          score: 5,
          origin: 'timeline',
        });
      }
    }
  }

  // 同一名称只保留得分最高的一条
  const best = new Map<string, EncyclopediaLookup>();
  for (const result of results) {
    const key = `${result.entry.category}｜${result.entry.name}`;
    const existing = best.get(key);
    if (!existing || existing.score < result.score) best.set(key, result);
  }
  return Array.from(best.values()).sort((a, b) => b.score - a.score);
}

/** 把检索结果拼成注入文本，并受预算约束。 */
function renderLookupResults(
  novelId: string,
  terms: string[],
  budget: number,
): { text: string; tokens: number; cited: string[] } {
  const hits = lookupSettings(novelId, terms);
  if (hits.length === 0) return { text: '未检索到相关设定条目。', tokens: 0, cited: [] };

  const blocks: string[] = [];
  const cited: string[] = [];
  let tokens = 0;
  for (const hit of hits) {
    const block = renderEntry(hit.entry);
    const blockTokens = estimateTokens(block);
    if (tokens + blockTokens > budget) break;
    blocks.push(block);
    cited.push(hit.entry.id);
    tokens += blockTokens;
  }
  if (blocks.length === 0) return { text: '本次检索结果超出预算，已略过。', tokens: 0, cited: [] };
  return { text: blocks.join('\n\n'), tokens, cited };
}

/* --------------------------------------------------------- 规则渲染 */

function renderRules(preferences: NovelPreferences): string {
  const { rules } = preferences;
  return [
    `文风要求：${rules.style || '未设定'}`,
    `叙事人称：${rules.pov || '未设定'}`,
    `对白与称呼约束：${rules.speechHabits || '未设定'}`,
    `明令禁止：${rules.forbidden.length > 0 ? rules.forbidden.join('；') : '无'}`,
    `附加规则：${rules.extra.length > 0 ? rules.extra.join('；') : '无'}`,
    `敏感内容许可：${rules.allowExplicit ? '允许成年角色之间的亲密描写，需与整体氛围一致' : '不写任何性描写'}`,
    `暴力描写：${rules.allowViolence ? '允许适度的冲突与流血描写' : '回避血腥细节'}`,
  ].join('\n');
}

/* ---------------------------------------------------------- 主入口 */

/**
 * 构建一次生成所需的完整上下文。
 * 返回值中的 vars 可直接交给模板渲染函数使用。
 */
export function buildContext(novelId: string, options: BuildContextOptions = {}): ContextBundle {
  const preferences = getNovelPreferences(novelId);
  const budget = preferences.budget ?? DEFAULT_PREFERENCES.budget;
  const allowTrim = options.allowTrim !== false;
  /** 用户勾选的层。为空表示不设限，全部启用并沿用默认顺序。 */
  const enabledKeys =
    options.layerKeys && options.layerKeys.length > 0 ? new Set(options.layerKeys) : null;
  const chapters = listChapters(novelId);
  const characters = listCharacters(novelId);

  const current = options.chapterId
    ? chapters.find((chapter) => chapter.id === options.chapterId)
    : undefined;
  // 缺省取正在推进的事件，缺省章节时以事件进度推断位置
  const currentEvent = options.eventId
    ? getStoryEvent(options.eventId)
    : getCurrentStoryEvent(novelId);
  /*
   * 本次要写的步骤。
   *
   * 用户可以指定，缺省跟随事件进度。指定的意义在于补写与跳写：
   * 回头补第 2 步，或先写高潮那一步，都不需要改动事件的进度记录。
   */
  const focusStep = currentEvent
    ? Math.max(
        0,
        Math.min(options.stepIndex ?? currentEvent.progress, currentEvent.steps.length - 1),
      )
    : 0;

  const layers: ContextLayer[] = [];
  const citations: ContextBundle['citations'] = [];

  const push = (
    key: string,
    label: string,
    content: string,
    limit: number,
    always: boolean,
  ): ContextLayer | null => {
    // 未被勾选的层直接跳过，内容也就不会进入任何模板变量
    if (enabledKeys && !enabledKeys.has(key)) return null;
    const rawTokens = estimateTokens(content);
    let text = content;
    let trimmed = false;
    if (rawTokens > limit && allowTrim) {
      text = truncateToTokenBudget(content, limit);
      trimmed = true;
    }
    const layer: ContextLayer = {
      key,
      label,
      content: text,
      tokens: estimateTokens(text),
      always,
      trimmed,
    };
    layers.push(layer);
    return layer;
  };

  // 第一层：设定与世界观
  const worldview = readNovelText(novelId, NOVEL_TEXT_KEYS.worldview);
  push('worldview', '设定与世界观', worldview || '尚未填写世界观设定。', Math.floor(budget.always * 0.3), true);

  const setting = readNovelText(novelId, NOVEL_TEXT_KEYS.setting);
  if (setting.trim()) {
    push('setting', '核心设定补充', setting, Math.floor(budget.always * 0.15), true);
  }

  /*
   * 文风样本。
   *
   * 这一项在设定页一直可以填写，但先前没有任何层承载它，
   * 写进去的样章从未进入提示词，等于白填。
   */
  const styleSample = readNovelText(novelId, NOVEL_TEXT_KEYS.styleSample);
  if (styleSample.trim()) {
    push('style-sample', '文风样本', styleSample, Math.floor(budget.always * 0.2), true);
  }

  // 第二层：整本书大纲与收束计划
  const outlineOverview = readNovelText(novelId, NOVEL_TEXT_KEYS.outlineOverview);
  const endingPlan = readNovelText(novelId, NOVEL_TEXT_KEYS.endingPlan);
  push(
    'outline-overview',
    '整本书大纲',
    outlineOverview || '尚未填写整本书大纲，请先在故事大纲页面补充。',
    Math.floor(budget.always * 0.2),
    true,
  );

  /*
   * 结构化大纲。
   *
   * 大纲页维护的篇章与节拍按层级列出，比一段连续文本更能说明编排意图。
   * 没有维护过节点时不占位，免得白占预算。
   */
  const outlineTreeText = renderOutlineTree(novelId);
  if (outlineTreeText) {
    push('outline-tree', '结构化大纲', outlineTreeText, Math.floor(budget.outlines * 0.3), true);
  }
  if (endingPlan.trim()) {
    push('ending-plan', '结局与收束计划', endingPlan, Math.floor(budget.always * 0.08), true);
  }

  // 第三层：主要人物与其余角色图鉴
  const primary = characters.filter(
    (character) => character.roleType === 'protagonist' || character.isPrimary,
  );
  const secondary = characters.filter((character) => !primary.includes(character));
  const primaryText =
    primary.length > 0
      ? primary.map((character) => renderCharacter(character, true)).join('\n\n')
      : '尚未设定主角。';
  push('characters-primary', '主角与核心人物', primaryText, Math.floor(budget.always * 0.26), true);

  if (secondary.length > 0) {
    const secondaryText = secondary.map((character) => renderCharacter(character, false)).join('\n');
    push('characters-secondary', '配角与次要人物', secondaryText, Math.floor(budget.always * 0.12), true);
  }

  // 第四层：角色关系网
  push('relations', '角色关系网', renderRelations(novelId), Math.floor(budget.always * 0.08), true);

  // 第五层：生成规则
  push('rules', '生成规则', renderRules(preferences), 1200, true);
  // 历法单独成层：它是纯时间写法约定，篇幅小但影响全书一致性
  push(
    'calendar',
    '小说内历法',
    preferences.calendar || '尚未设定历法，时间按通用写法处理。',
    400,
    true,
  );

  // 第六层：完整时间轴，供模型自主判断剧情相关性
  push('timeline', '时间轴', renderTimeline(novelId), Math.floor(budget.always * 0.28), true);

  // 第七层：百科索引，只列名称，正文按需检索
  push(
    'encyclopedia-index',
    '百科条目索引',
    renderEncyclopediaIndex(novelId),
    Math.floor(budget.always * 0.06),
    true,
  );

  // 第八层：当前事件大纲与步骤进度
  const currentEventOutline = currentEvent?.outline ?? '当前没有正在推进的事件，需要先向用户确认故事方向并生成事件大纲。';
  push('current-event', '当前事件大纲', currentEventOutline, Math.floor(budget.outlines * 0.4), true);
  push(
    'current-event-steps',
    '事件步骤与进度',
    currentEvent ? renderEventSteps(currentEvent, focusStep) : '暂无事件步骤。',
    Math.floor(budget.outlines * 0.2),
    true,
  );

  // 第九层：已完成事件的大纲汇总
  const finished = listFinishedStoryEvents(novelId);
  const finishedText =
    finished.length === 0
      ? '尚未完成任何事件。'
      : finished.map((event) => renderEventOutline(event, false)).join('\n\n');
  push('finished-events', '已完成事件大纲', finishedText, Math.floor(budget.outlines * 0.3), false);

  // 第十层：前一章全文，保证接续自然
  const previousChapter = findPreviousChapter(chapters, current);
  if (previousChapter) {
    const file = readChapterContent(previousChapter.novelId, previousChapter.relPath);
    const label = `第${previousChapter.volumeIndex}卷第${previousChapter.indexNo}章 ${previousChapter.title}`;
    const body = file.content.trim() ? file.content : '前一章正文尚未生成，本章为接续起点。';
    push('previous-chapter', '前一章全文', `### ${label}\n\n${body}`, budget.outlines, true);
    citations.push({ kind: 'chapter', id: previousChapter.id, label, tokens: estimateTokens(body) });
  } else {
    push('previous-chapter', '前一章全文', '本章是全书第一章，没有前一章内容。', 200, true);
  }

  // 第十一层：百科检索结果，包含模型提出的查询与按方向预取的条目
  const queryKeywords = currentEvent
    ? listEncyclopediaQueries(novelId, currentEvent.id)
        .filter((query) => query.resolved)
        .map((query) => query.keyword)
    : [];
  const prefetchTerms = [
    options.direction ?? '',
    options.instruction ?? '',
    options.selectedDirection ?? '',
    current?.title ?? '',
  ].filter(Boolean);
  const allKeywords = Array.from(new Set([...queryKeywords, ...prefetchTerms, ...(options.focusTerms ?? [])]));
  const looked = renderLookupResults(novelId, allKeywords, Math.floor(budget.always * 0.18));
  push('encyclopedia', '百科检索结果', looked.text, Math.floor(budget.always * 0.18), true);
  for (const id of looked.cited) {
    citations.push({ kind: 'encyclopedia', id, label: '百科条目', tokens: 0 });
  }

  // 第十二层：按需注入的往期片段，含经用户放行的事件全文调阅
  const recalledBudget = budget.recalled;
  const recallTerms = [options.direction, options.instruction, options.selectedDirection]
    .filter(Boolean)
    .join(' ')
    .trim();
  const pinned = new Set(options.pinnedChapterIds ?? []);
  const selectedIds = new Set<string>();
  const recalledBlocks: string[] = [];
  let recalledTokens = 0;

  const appendRecalled = (chapter: ChapterWithVolume, mode: 'full' | 'excerpt') => {
    if (selectedIds.has(chapter.id)) return;
    if (chapter.id === options.chapterId) return;
    const label = `第${chapter.volumeIndex}卷第${chapter.indexNo}章 ${chapter.title}`;
    const raw = readChapterContent(chapter.novelId, chapter.relPath).content;
    const text = stripTalkMarkers(raw).trim();
    const body =
      mode === 'excerpt'
        ? text.slice(0, 600)
        : text || '本章正文尚未生成。';
    const block = `### ${label}\n${body}`;
    const tokens = estimateTokens(block);
    if (recalledTokens + tokens > recalledBudget) return;
    recalledBlocks.push(block);
    recalledTokens += tokens;
    selectedIds.add(chapter.id);
    citations.push({ kind: 'chapter', id: chapter.id, label, tokens });
  };

  // 用户放行的事件调阅：注入该事件涉及的全部章节
  for (const id of pinned) {
    const chapter = chapters.find((item) => item.id === id);
    if (chapter) appendRecalled(chapter, 'full');
  }

  // 检索增强：用关键词在全文索引中召回相关章节
  if (recallTerms) {
    for (const keyword of recallTerms.split(/\s+/).filter((word) => word.length >= 2).slice(0, 6)) {
      const hits = searchChapters(novelId, keyword, 12);
      for (const hit of hits) {
        const chapter = chapters.find((item) => item.id === hit.chapterId);
        if (chapter) appendRecalled(chapter, 'excerpt');
      }
    }
  }

  push(
    'recalled',
    '按需注入的往期正文',
    recalledBlocks.length > 0 ? recalledBlocks.join('\n\n') : '本次没有需要额外调取的往期正文。',
    recalledBudget,
    false,
  );

  /*
   * 按用户指定的顺序排列各层。
   *
   * 顺序会一路影响到提示词：拼接型变量（例如 context）按层序取内容，
   * 排在前面的层因此更容易被模型当作主线来读。
   */
  if (options.layerKeys && options.layerKeys.length > 0) {
    const order = new Map(options.layerKeys.map((key, index) => [key, index]));
    layers.sort(
      (a, b) =>
        (order.get(a.key) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.key) ?? Number.MAX_SAFE_INTEGER),
    );
  }

  const totalTokens = layers.reduce((sum, layer) => sum + layer.tokens, 0);
  const branchNames = listBranches(novelId).map((branch) => branch.name);
  const stepIndex = currentEvent ? Math.min(focusStep + 1, currentEvent.steps.length) : 0;
  const currentStep = currentEvent?.steps[focusStep];

  const vars: Record<string, string> = {
    novelTitle: '',
    genre: '',
    worldview: layers.find((layer) => layer.key === 'worldview')?.content ?? '',
    setting: layers.find((layer) => layer.key === 'setting')?.content ?? '',
    styleSample: layers.find((layer) => layer.key === 'style-sample')?.content ?? '',
    characters: [
      layers.find((layer) => layer.key === 'characters-primary')?.content ?? '',
      layers.find((layer) => layer.key === 'characters-secondary')?.content ?? '',
    ]
      .filter(Boolean)
      .join('\n\n'),
    relations: layers.find((layer) => layer.key === 'relations')?.content ?? '',
    outlineOverview: layers.find((layer) => layer.key === 'outline-overview')?.content ?? '',
    outlineTree: layers.find((layer) => layer.key === 'outline-tree')?.content ?? '',
    endingPlan: layers.find((layer) => layer.key === 'ending-plan')?.content ?? '',
    outline: layers.find((layer) => layer.key === 'outline-overview')?.content ?? '',
    currentEventOutline,
    currentEventSteps: layers.find((layer) => layer.key === 'current-event-steps')?.content ?? '',
    currentEvent: currentEvent
      ? `事件 ${currentEvent.orderNo}｜${currentEvent.title}｜时间 ${currentEvent.novelTime || '未标注'}｜${describeEventStatus(currentEvent)}`
      : '当前没有正在推进的事件。',
    currentEventOutlineForRevise: currentEventOutline,
    eventProgress: String(currentEvent?.progress ?? 0),
    eventStepCount: String(currentEvent?.steps.length ?? 0),
    eventPosition: currentEvent
      ? `第 ${stepIndex} 步，共 ${currentEvent.steps.length} 步`
      : '尚未进入事件流程',
    stepIndex: String(stepIndex),
    stepTitle: currentStep?.title ?? '事件尚未拆分步骤，请依据大纲推进',
    finishedOutlines: layers.find((layer) => layer.key === 'finished-events')?.content ?? '',
    timeline: layers.find((layer) => layer.key === 'timeline')?.content ?? '',
    encyclopedia: layers.find((layer) => layer.key === 'encyclopedia')?.content ?? '',
    encyclopediaIndex: layers.find((layer) => layer.key === 'encyclopedia-index')?.content ?? '',
    recentSummaries: layers.find((layer) => layer.key === 'finished-events')?.content ?? '',
    previousChapter: layers.find((layer) => layer.key === 'previous-chapter')?.content ?? '',
    recalled: layers.find((layer) => layer.key === 'recalled')?.content ?? '',
    context: layers
      .filter((layer) => ['worldview', 'characters-primary', 'current-event'].includes(layer.key))
      .map((layer) => layer.content)
      .join('\n\n'),
    // 历法也从层里取，这样在界面上取消勾选就能真的不发送
    calendar: layers.find((layer) => layer.key === 'calendar')?.content ?? '',
    targetWords: String(preferences.targetWords),
    tolerance: String(preferences.wordTolerancePercent),
    optionCount: '3',
    direction: options.selectedDirection ?? '',
    instruction: options.instruction ?? '',
    revisionMode: '按指令修改',
    existingContent: '',
    chapterTitle: current?.title ?? '',
    chapterSummary: '',
    chapterImpact: '',
    chapterTime: '',
    outlineFocus: currentEventOutline,
    branches: branchNames.join('、') || '主线',
    rulesStyle: preferences.rules.style,
    rulesPov: preferences.rules.pov,
    rulesSpeech: preferences.rules.speechHabits,
    rulesForbidden:
      preferences.rules.forbidden.length > 0 ? preferences.rules.forbidden.join('；') : '无',
    rulesExtra: preferences.rules.extra.length > 0 ? preferences.rules.extra.join('；') : '无',
    rulesExplicitText: preferences.rules.allowExplicit ? '允许' : '不允许',
    // 大纲规则单独成项，只在生成与改写大纲时注入，正文任务用不到
    outlineRules: preferences.rules.outline.trim() || '未设置，按通用写作要求处理',
  };
  // 模板中以 Revise 结尾的变量名与基础名保持一致，避免出现空占位
  vars.currentEventOutlineRevise = currentEventOutline;

  return {
    layers,
    vars,
    totalTokens,
    budget,
    trimmed: layers.some((layer) => layer.trimmed),
    citations,
  };
}

/** 找到当前章节的上一章，跨卷时取上一卷的最后一章。 */
export function findPreviousChapter(
  chapters: ChapterWithVolume[],
  current: ChapterWithVolume | undefined,
): ChapterWithVolume | undefined {
  if (chapters.length === 0) return undefined;
  const ordered = [...chapters].sort(
    (a, b) => a.volumeIndex - b.volumeIndex || a.indexNo - b.indexNo,
  );
  if (!current) return ordered[ordered.length - 1];
  const position = ordered.findIndex((chapter) => chapter.id === current.id);
  if (position <= 0) return undefined;
  return ordered[position - 1];
}

/**
 * 取出某个事件涉及的全部章节，供用户放行调阅时确定注入范围。
 */
export function listEventChapters(novelId: string, eventId: string): ChapterWithVolume[] {
  return listChapters(novelId).filter((chapter) => chapter.eventId === eventId);
}

/** 仅构建供模型自主选择的轻量索引，用于两段式上下文加载。 */
export function buildTimelineIndex(novelId: string): {
  timeline: string;
  events: Array<{ id: string; label: string; time: string; status: string; outline: string }>;
} {
  const events = listStoryEvents(novelId);
  return {
    timeline: renderTimeline(novelId),
    events: events.map((event) => ({
      id: event.id,
      label: `事件 ${event.orderNo}｜${event.title}`,
      time: event.novelTime,
      status: describeEventStatus(event),
      outline: event.outline.slice(0, 200),
    })),
  };
}

/** 统计上下文体积，供界面在做生成前的预算提示。 */
export function getContextUsage(
  novelId: string,
  options: BuildContextOptions = {},
): {
  totalTokens: number;
  budget: ContextBudget;
  layers: Array<{ key: string; label: string; tokens: number; trimmed: boolean }>;
} {
  const bundle = buildContext(novelId, options);
  return {
    totalTokens: bundle.totalTokens,
    budget: bundle.budget,
    layers: bundle.layers.map((layer) => ({
      key: layer.key,
      label: layer.label,
      tokens: layer.tokens,
      trimmed: layer.trimmed,
    })),
  };
}

export { renderCharacter, renderRelations, renderRules, renderTimeline, renderSpeechPalette };
