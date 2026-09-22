import type { TaskType } from '../types';

/**
 * 内置提示词模板。
 *
 * 设计约束：
 * 一，模板与生成规则分离。模板由项目提供并可被用户覆盖，生成规则由用户在小说设置中编写。
 * 二，模板内所有可替换位置使用双花括号变量，由上下文构建器统一填充。
 * 三，界面文本与模板文本不使用括号做补充解释，全部以规范化叙述表达。
 */

export interface PromptVars {
  [key: string]: string;
}

export interface BuiltinPrompt {
  taskType: TaskType;
  label: string;
  description: string;
  systemPrompt: string;
  userPrompt: string;
  temperature: number;
  /** 该任务期望的输出形态，用于界面提示与后续解析 */
  outputFormat: 'text' | 'json' | 'options' | 'outline' | 'markdown';
}

/** 所有任务共用的角色设定与写作底线。 */
const COMMON_SYSTEM = `你是一位资深的中文网络小说作者与剧情编辑，长期从事长篇连载创作。
你的职责是根据给定设定与既有剧情，写出可直接发布的中文小说内容。

写作底线：
严格遵循用户提供的生成规则，规则优先级高于你的个人偏好。
保持与既有正文一致的文风、人称、时态与称呼体系。
不出现括号补充说明，不使用作者旁白解释剧情。
不重复用户已经写过的段落，不写占位内容，不写写作建议，只输出成品文本。
情节推进必须有具体行动与对话支撑，避免概括式叙述。`;

/**
 * 角色发言的统一书写规范。
 *
 * 发言一律使用 talk 标记包裹，不写双引号，前端会按角色色相渲染为带引号的对白。
 */
const TALK_RULES = `角色发言书写规范：
凡属角色说出的话，一律使用 <talk chara="角色名">发言内容</talk> 标记，不要写双引号或书名号。
chara 属性填角色图鉴中登记的名字，未登记的角色使用其在本章中的常用称呼。
标记内部只写发言内容本身，不加任何修饰或动作描写。
示例：<talk chara="林见微">这条路我走过三次。</talk>
叙述与动作照常规书写，不要放进 talk 标记内。`;

/**
 * 设定查询机制说明。
 *
 * AI 在大纲阶段登记需要查阅的设定，系统回填后再交给它写作，
 * 这样既保证设定准确，又不必把整本百科塞进上下文。
 */
const QUERY_RULES = `设定查询机制：
当大纲或正文需要依赖某项设定的准确细节，而当前上下文中没有该内容时，
在输出末尾追加查询区块，每行一条，格式如下：
<query>要查询的名称或关键词</query>
可一次提出多条。系统会检索百科、角色图鉴与时间轴，把结果回填后再交给你写作。
已经出现在上下文中的设定不要重复查询。
名称应当具体，例如具体的地名、组织名、功法名，不要提交过于宽泛的词。`;

/**
 * 往期事件调阅机制说明。
 *
 * 调阅会向上下文塞入整个事件的全部章节，代价很高，因此要求模型克制使用。
 */
const RECALL_RULES = `往期事件调阅机制：
当确实需要回顾某个已经写完事件的完整经过，才能避免与旧文冲突时，
在输出末尾追加调阅区块，每行一条，格式如下：
<recall event="事件标题">调阅理由</recall>
调阅会把该事件涉及的全部章节原文送入你的上下文，消耗大量篇幅。
因此每章最多提出一条调阅请求，且只在无法通过大纲与前一章内容判断时才使用。
理由必须说明缺少这段内容会导致什么具体问题。`;

function ruleBlock(): string {
  return `生成规则：
文风要求：{{rulesStyle}}
叙事人称：{{rulesPov}}
对白与称呼约束：{{rulesSpeech}}
明令禁止：{{rulesForbidden}}
附加规则：{{rulesExtra}}
敏感内容许可：{{rulesExplicitText}}`;
}

export const BUILTIN_PROMPTS: BuiltinPrompt[] = [
  {
    taskType: 'direction',
    label: '故事发展方向生成',
    description: '首章开篇或事件收尾时，给出若干后续走向供用户挑选或自行输入。',
    outputFormat: 'options',
    temperature: 1.0,
    systemPrompt: `${COMMON_SYSTEM}

当前任务：提出故事发展的若干候选方向。
要求：
每个方向给出一个简短标题与三到五句说明，说明必须包含触发事件、人物动机与可能后果。
方向之间要有实质差异，覆盖不同基调，例如稳健推进、激烈冲突、悬念反转。
不得直接写出正文，不得替用户做最终决定。
输出为 JSON 数组，每个元素形如 {"title":"方向标题","summary":"方向说明","tone":"基调","risk":"可能的风险"}。
只输出 JSON，不要输出任何额外说明文字。`,
    userPrompt: `小说标题：{{novelTitle}}
题材：{{genre}}

设定与世界观：
{{worldview}}

核心设定补充：
{{setting}}

整本书大纲：
{{outlineOverview}}

主要人物：
{{characters}}

角色关系：
{{relations}}

百科现状：
{{encyclopediaIndex}}

既有时间轴：
{{timeline}}

已完成事件的大纲：
{{finishedOutlines}}

当前事件的推进状态：
{{currentEvent}}

用户补充要求：{{instruction}}

请提出 {{optionCount}} 个故事发展方向。`,
  },
  {
    taskType: 'outline',
    label: '事件大纲生成',
    description: '按选定方向产出下一个事件的完整大纲，以 Markdown 输出，含事件时间与步骤。',
    outputFormat: 'markdown',
    temperature: 0.85,
    systemPrompt: `${COMMON_SYSTEM}

当前任务：为下一个故事事件编写完整大纲。
要求：
大纲必须严格依据设定与规则、整本书大纲，以及已经发生的事件来编写。不得推翻已经发生的情节，不得与既有设定矛盾。
大纲描述一个完整事件从起因到收束的全过程，篇幅控制在能够支撑三到十章正文。
事件时间是小说内时间，必须晚于所有已完成事件，并符合小说内历法的表述方式。
大纲用 Markdown 书写，结构固定为：一级标题写事件名，随后依次是起因、经过、转折、收束四节，
经过一节用有序列表拆分成若干步骤，逐步交代谁做了什么、为什么做、结果如何，每一步对应正文中的一章或数章。
如果某个步骤需要依赖具体设定细节，而当前上下文中没有该内容，按设定查询机制提出查询。

${QUERY_RULES}

${RECALL_RULES}

输出格式：先输出大纲 Markdown 正文，随后输出一个步骤区块，每行一个步骤，格式如下：
<step time="该步骤的小说内时间">该步骤的一句话提要</step>
步骤提要按正文推进顺序排列，必须与经过一节的有序列表一一对应。
大纲正文中不要出现 talk 标记。`,
    userPrompt: `小说标题：{{novelTitle}}
题材：{{genre}}

设定与世界观：
{{worldview}}

核心设定补充：
{{setting}}

整本书大纲：
{{outlineOverview}}

结局与收束计划：
{{endingPlan}}

主要人物档案：
{{characters}}

角色关系：
{{relations}}

百科条目索引：
{{encyclopediaIndex}}

百科检索结果：
{{encyclopedia}}

时间轴：
{{timeline}}

已完成事件的大纲：
{{finishedOutlines}}

小说内历法：{{calendar}}

已确认的故事方向：{{direction}}

用户补充要求：{{instruction}}

${ruleBlock()}

请输出下一个事件的完整大纲。`,
  },
  {
    taskType: 'outline_revise',
    label: '事件大纲修改',
    description: '按用户指出的位置与要求改写当前事件大纲，保留未被指出的部分。',
    outputFormat: 'markdown',
    temperature: 0.7,
    systemPrompt: `${COMMON_SYSTEM}

当前任务：按用户要求修改当前事件大纲。
要求：
只改动用户指出的位置，其余内容原样保留，包括步骤顺序与措辞。
改动后必须重新检查与设定、时间轴、已完成事件的一致性，如出现冲突需明确指出。
输出格式与大纲生成一致：先输出修改后的完整大纲 Markdown，再输出步骤区块。
若修改导致步骤增减，必须完整输出新的步骤区块，不要只输出变化的部分。

${QUERY_RULES}`,
    userPrompt: `当前事件大纲：
{{currentEventOutline}}

当前步骤进度：已完成 {{eventProgress}} 步，共 {{eventStepCount}} 步。

设定与世界观：
{{worldview}}

整本书大纲：
{{outlineOverview}}

时间轴：
{{timeline}}

已完成的正文与大纲：
{{context}}

用户的修改要求：
{{instruction}}

${ruleBlock()}

请输出修改后的事件大纲。`,
  },
  {
    taskType: 'chapter',
    label: '正文生成',
    description: '按事件大纲的当前步骤写出本章正文，并标记写到了哪一步。',
    outputFormat: 'text',
    temperature: 1.0,
    systemPrompt: `${COMMON_SYSTEM}

当前任务：写出指定章节的正文。
要求：
直接输出小说正文，使用 Markdown 段落格式，段落之间空一行。
不要输出章节标题，不要输出任何说明、评论或元信息。
目标字数为 {{targetWords}} 字，允许上下浮动 {{tolerance}} 百分比。
本章只推进当前步骤，不要越界写完后续步骤；若本章只需完成当前步骤的一部分，可以停在中途。
与前一章自然衔接，承接上一章的结尾场景与情绪，不得重复前一章已经写过的内容。
正文结束处另起一行，输出本步骤的完成程度标记，格式如下：
<step-status value="done">该步骤在本章完成</step-status>
或
<step-status value="partial">该步骤在本章只完成了一部分，剩余内容如下</step-status>
partial 时在标记后另起一行，用一句话说明本章写到哪里、还剩什么。

${TALK_RULES}

${QUERY_RULES}`,
    userPrompt: `小说标题：{{novelTitle}}
题材：{{genre}}

设定与世界观：
{{worldview}}

核心设定补充：
{{setting}}

主要人物档案：
{{characters}}

角色关系：
{{relations}}

百科检索结果：
{{encyclopedia}}

当前事件的完整大纲：
{{currentEventOutline}}

当前事件的步骤清单与进度：
{{currentEventSteps}}

本章要写的步骤：第 {{stepIndex}} 步，内容为 {{stepTitle}}
本章在事件中的位置：{{eventPosition}}

前一章全文：
{{previousChapter}}

所有已完成事件的大纲：
{{finishedOutlines}}

时间轴：
{{timeline}}

往期情节检索结果：
{{recalled}}

本章任务：{{chapterTitle}}
本章推进方向：{{direction}}

${ruleBlock()}

请写出本章正文。`,
  },
  {
    taskType: 'chapter_revise',
    label: '正文修改',
    description: '局部重写、扩写、缩写或按指令调整已生成的正文。',
    outputFormat: 'text',
    temperature: 0.9,
    systemPrompt: `${COMMON_SYSTEM}

当前任务：按用户要求修改给定正文。
要求：
只修改用户指定的范围，其余内容保持原文。
保持上下文衔接顺畅，修改后的段落要与前后文语气一致。
若用户要求扩写，则补充细节、动作、对话与环境描写，不新增支线情节。
若用户要求缩写，则删减重复描写与冗余修饰，保留关键情节节点与人物台词。
输出完整正文，不要输出修改说明，不要使用删除线或批注标记。
修改时必须保留原有的 talk 标记与其中的角色名，不得把对白改成双引号形式。

${TALK_RULES}`,
    userPrompt: `原文：
{{existingContent}}

用户的修改要求：{{instruction}}
修改类型：{{revisionMode}}
目标字数：{{targetWords}} 字

相关设定：
{{worldview}}

主要人物：
{{characters}}

百科检索结果：
{{encyclopedia}}

当前事件大纲：
{{currentEventOutline}}

${ruleBlock()}

请输出修改后的完整正文。`,
  },
  {
    taskType: 'character_extract',
    label: '角色信息抽取',
    description: '从本章正文中抽取新出现的人物与关系，写入角色图鉴与关系网。',
    outputFormat: 'json',
    temperature: 0.3,
    systemPrompt: `${COMMON_SYSTEM}

当前任务：从给定正文中抽取人物信息与人物之间的关系。
要求：
只记录正文中确实出现或可以直接推断的信息，不要凭空设定。
已被收录的人物只在发现新信息时才输出，未收录的人物完整输出。
输出为 JSON 对象，形如 {"characters":[{"name":"姓名","aliases":["别名"],"emoji":"🙂","roleType":"supporting","gender":"","age":"","faction":"","personality":"","appearance":"","ability":"","background":"","arc":"","speechHue":210,"speechHueReason":"选择该颜色的理由","foreshadowing":[{"title":"伏笔名称","detail":"伏笔说明","status":"planted"}]}],"relations":[{"from":"姓名甲","to":"姓名乙","kind":"friend","label":"关系说明","strength":3}]}。
roleType 取 protagonist、supporting、antagonist、minor、extra 之一。
kind 取 family、lover、friend、rival、enemy、mentor、subordinate、ally、other 之一。
speechHue 是新角色的发言色相，取 0 到 359 的整数。请根据角色的身份与气质选择，例如冷静疏离的角色取偏蓝的色相，热烈张扬的角色取偏红的色相，阴郁的角色取偏紫的色相。避免与已收录角色所用色相接近，并在 speechHueReason 中用一句话说明选择理由。
只输出 JSON，不要输出任何额外说明文字。`,
    userPrompt: `已收录角色及其发言色相：
{{characters}}

当前事件大纲：
{{currentEventOutline}}

待分析正文：
{{existingContent}}

请输出抽取结果。`,
  },
  {
    taskType: 'encyclopedia_extract',
    label: '百科条目抽取',
    description: '从本章正文中抽取地名、组织、种族等新设定，写入百科全书。',
    outputFormat: 'json',
    temperature: 0.3,
    systemPrompt: `${COMMON_SYSTEM}

当前任务：从给定正文中抽取世界设定条目。
要求：
只抽取正文中确实出现的专有名词，包括地名、组织、种族、动植物、物品、功法、节日、制度。
每个条目给出规范名称、分类、别名与不少于两句的说明，说明必须基于正文内容。
已被收录的条目只在正文补充了新信息时才输出，并在 content 中只写新增部分。
输出为 JSON 数组，每个元素形如 {"category":"地理","name":"名称","aliases":"别名","summary":"一句话说明","content":"详细说明","tags":["标签"]}。
只输出 JSON，不要输出任何额外说明文字。`,
    userPrompt: `已收录条目名称：
{{encyclopediaIndex}}

当前事件大纲：
{{currentEventOutline}}

待分析正文：
{{existingContent}}

请输出需要新增或补充的条目。`,
  },
  {
    taskType: 'free',
    label: '自由对话',
    description: '不套用任何任务模板，直接与模型对话，用于试接与排查。',
    outputFormat: 'text',
    temperature: 1.0,
    systemPrompt: `${COMMON_SYSTEM}

当前任务：按用户指令直接回答或写作。`,
    userPrompt: `{{instruction}}`,
  },
];

const PROMPT_INDEX = new Map(BUILTIN_PROMPTS.map((prompt) => [prompt.taskType, prompt]));

/** 取得内置模板，未知任务回落到自由对话。 */
export function getBuiltinPrompt(taskType: TaskType): BuiltinPrompt {
  return PROMPT_INDEX.get(taskType) ?? PROMPT_INDEX.get('free')!;
}

/* ------------------------------------------------------ 选项结构归一化 */

/** 归一化后的方向选项。 */
export interface NormalizedOption {
  title: string;
  summary: string;
  tone?: string;
  risk?: string;
}

/**
 * 寻找选项数组时优先下钻的键名，按模型的实际习惯排序。
 *
 * 提示词要求直接输出 JSON 数组，但启用 JSON 模式后各家模型普遍会再包一层，
 * 实测出现过 {directions:[...]}、{type:'json_object',directions:[...]} 以及
 * {type:'json_object',content:{directions:[...]}} 三种形态。
 */
const OPTION_ARRAY_KEYS = [
  'directions',
  'options',
  'choices',
  'items',
  'list',
  'results',
  'data',
  'content',
];

/** 标题字段的候选键。 */
const OPTION_TITLE_KEYS = ['title', 'name', 'heading', 'label'];

/** 说明字段的候选键。 */
const OPTION_SUMMARY_KEYS = ['summary', 'content', 'description', 'detail', 'desc', 'text'];

function pickField(source: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

/**
 * 从模型返回的结构中取出记录数组。
 *
 * 模型在 JSON 模式下普遍会把数组再包一层，键名五花八门，
 * 这里按候选键逐层下钻，候选键都落空时退回对象中第一个数组值，
 * 尽量把各种包裹形式都还原成数组，避免调用方拿到对象后静默丢弃整批数据。
 */
export function extractRecordList(
  raw: unknown,
  keys: string[],
  depth = 0,
): Array<Record<string, unknown>> {
  if (depth > 5) return [];

  if (Array.isArray(raw)) {
    return raw.filter(
      (item): item is Record<string, unknown> => typeof item === 'object' && item !== null,
    );
  }

  if (typeof raw !== 'object' || raw === null) return [];
  const record = raw as Record<string, unknown>;

  for (const key of keys) {
    if (!(key in record)) continue;
    const found = extractRecordList(record[key], keys, depth + 1);
    if (found.length > 0) return found;
  }

  // 候选键都落空时逐层下钻，找出第一个能解析出记录的数组。
  // 有些模型会把结果藏在自造的包装名里，例如 { payload: { items: [...] } }。
  for (const value of Object.values(record)) {
    if (typeof value !== 'object' || value === null) continue;
    const found = extractRecordList(value, keys, depth + 1);
    if (found.length > 0) return found;
  }

  return [];
}

/**
 * 把模型返回的方向选项收敛成数组。
 *
 * 无论模型输出的是裸数组，还是套了一层甚至两层对象，
 * 都逐层下钻取出选项列表，避免界面因为拿到的不是数组而一条都显示不出来。
 */
export function normalizeOptionList(raw: unknown): NormalizedOption[] {
  return extractRecordList(raw, OPTION_ARRAY_KEYS)
    .map((item) => ({
      title: pickField(item, OPTION_TITLE_KEYS),
      summary: pickField(item, OPTION_SUMMARY_KEYS),
      tone: pickField(item, ['tone', 'mood', 'style']) || undefined,
      risk: pickField(item, ['risk', 'warning', 'concern']) || undefined,
    }))
    .filter((item) => item.title.length > 0 || item.summary.length > 0);
}

/** 全部任务的展示标签，界面下拉框与用量统计共用。 */
export const TASK_LABELS: Record<TaskType, string> = BUILTIN_PROMPTS.reduce(
  (accumulator, prompt) => {
    accumulator[prompt.taskType] = prompt.label;
    return accumulator;
  },
  {} as Record<TaskType, string>,
);

/**
 * 替换模板中的变量。
 * 未提供的变量会被替换为空字符串，避免界面上出现裸露的占位符。
 */
export function renderTemplate(template: string, vars: PromptVars): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => {
    const value = vars[key];
    return typeof value === 'string' ? value : '';
  });
}

/** 模板中出现的全部变量名，供设置页展示可用变量。 */
export function extractPlaceholders(template: string): string[] {
  const found = new Set<string>();
  for (const match of template.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)) {
    if (match[1]) found.add(match[1]);
  }
  return Array.from(found).sort();
}

/* ------------------------------------------------------ 输出标记的解析 */

/**
 * 从模型输出中解析设定查询与事件调阅请求。
 *
 * 这两类标记在交给界面之前必须剥离，否则会混进正文。
 */
export function parseModelDirectives(text: string): {
  queries: string[];
  recalls: Array<{ event: string; reason: string }>;
  clean: string;
} {
  const queries: string[] = [];
  const recalls: Array<{ event: string; reason: string }> = [];

  const withoutQueries = text.replace(/<query>([\s\S]*?)<\/query>/g, (_, raw: string) => {
    const keyword = raw.trim();
    if (keyword) queries.push(keyword);
    return '';
  });

  const clean = withoutQueries.replace(
    /<recall\s+event="([^"]*)"\s*>([\s\S]*?)<\/recall>/g,
    (_, event: string, reason: string) => {
      const title = event.trim();
      if (title) recalls.push({ event: title, reason: reason.trim() });
      return '';
    },
  );

  return { queries: Array.from(new Set(queries)), recalls, clean: clean.trim() };
}

/** 解析步骤清单区块，得到有序的步骤数组。 */
export function parseStepBlocks(text: string): Array<{ time: string; title: string }> {
  const steps: Array<{ time: string; title: string }> = [];
  for (const match of text.matchAll(/<step(?:\s+time="([^"]*)")?\s*>([\s\S]*?)<\/step>/g)) {
    const title = (match[2] ?? '').trim();
    if (title) steps.push({ time: (match[1] ?? '').trim(), title });
  }
  return steps;
}

/** 从正文输出中剥离步骤区块，得到纯正文。 */
export function stripStepBlocks(text: string): string {
  return text
    .replace(/<step(?:\s+time="[^"]*")?\s*>[\s\S]*?<\/step>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** 读取本章的步骤完成标记，缺省视为本步已完成。 */
export function parseStepStatus(text: string): { value: 'done' | 'partial'; remainder: string } {
  const match = /<step-status\s+value="(done|partial)"\s*>([\s\S]*?)<\/step-status>/.exec(text);
  if (!match) return { value: 'done', remainder: '' };
  return {
    value: match[1] === 'partial' ? 'partial' : 'done',
    remainder: (match[2] ?? '').trim(),
  };
}