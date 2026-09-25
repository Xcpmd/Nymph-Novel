/**
 * 领域模型定义。
 * 数据库行与界面使用的对象在此统一，避免各处出现魔法字符串。
 */

export type NovelStatus = 'drafting' | 'ongoing' | 'paused' | 'finished';

export type ChapterStatus = 'planned' | 'drafting' | 'generated' | 'revised' | 'scrapped';

export type CharacterRole = 'protagonist' | 'supporting' | 'antagonist' | 'minor' | 'extra';

export type OutlineKind = 'arc' | 'beat' | 'sub';

export type OutlineStatus = 'planned' | 'active' | 'done';

export interface Novel {
  id: string;
  title: string;
  author: string;
  genre: string;
  summary: string;
  coverEmoji: string;
  /** 自定义封面，存相对 data 目录的路径，空串表示使用 emoji 封面 */
  coverImage: string;
  /** 封面填充方式 */
  coverFit: CoverFit;
  status: NovelStatus;
  wordCount: number;
  chapterCount: number;
  volumeCount: number;
  createdAt: string;
  updatedAt: string;
}

export type CoverFit = 'cover' | 'contain';

export interface Volume {
  id: string;
  novelId: string;
  indexNo: number;
  title: string;
  summary: string;
  createdAt: string;
  updatedAt: string;
  chapterCount?: number;
  wordCount?: number;
}

export interface Chapter {
  id: string;
  novelId: string;
  volumeId: string;
  indexNo: number;
  title: string;
  relPath: string;
  status: ChapterStatus;
  wordCount: number;
  eventId: string | null;
  stepIndex: number | null;
  timelineSort: string;
  branchId: string | null;
  direction: string;
  notes: string;
  /** 设为废案前的序号。还原时据此回到原位置，正常章节为 null */
  originalIndexNo: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChapterWithVolume extends Chapter {
  volumeIndex: number;
  volumeTitle: string;
  tags?: Tag[];
}

export interface OutlineNode {
  id: string;
  novelId: string;
  parentId: string | null;
  kind: OutlineKind;
  orderNo: number;
  title: string;
  content: string;
  status: OutlineStatus;
  chapterId: string | null;
  createdAt: string;
  updatedAt: string;
  children?: OutlineNode[];
}

export interface ForeshadowingItem {
  id: string;
  title: string;
  detail: string;
  status: 'planted' | 'pending' | 'resolved';
  payoffChapterId?: string;
}

export interface Character {
  id: string;
  novelId: string;
  name: string;
  aliases: string[];
  emoji: string;
  roleType: CharacterRole;
  gender: string;
  age: string;
  faction: string;
  personality: string;
  appearance: string;
  ability: string;
  background: string;
  arc: string;
  foreshadowing: ForeshadowingItem[];
  tags: string[];
  notes: string;
  sortNo: number;
  isPrimary: boolean;
  /** 发言色相 0-359，配合明暗主题组合出实际颜色 */
  speechHue: number;
  /** auto 表示由系统根据角色身份自动维护色相，manual 表示用户已手动指定 */
  speechColorMode: SpeechColorMode;
  createdAt: string;
  updatedAt: string;
}

export type SpeechColorMode = 'auto' | 'manual';

/**
 * 一次生成请求的记录。
 *
 * 这类记录已改为按条落成 txt 文件，放在 data/logs 下。
 * 类型放在公共类型里，是因为文件存储层与仓储层都要用到它，
 * 留在一侧会让另一侧产生反向依赖。
 */
export interface GenerationRun {
  id: string;
  novelId: string;
  chapterId: string | null;
  taskType: TaskType;
  providerId: string | null;
  model: string;
  status: 'running' | 'paused' | 'done' | 'failed' | 'cancelled';
  requestJson: string;
  /** 实际发给模型的消息全文，供请求日志查看 */
  promptText: string;
  /** 模型输出全文 */
  partialText: string;
  /** token 用量与耗时，JSON 字符串 */
  usageJson: string;
  error: string;
  createdAt: string;
  updatedAt: string;
}

export type RelationKind =
  | 'family'
  | 'lover'
  | 'friend'
  | 'rival'
  | 'enemy'
  | 'mentor'
  | 'subordinate'
  | 'ally'
  | 'other';

export interface CharacterRelation {
  id: string;
  novelId: string;
  fromCharacterId: string;
  toCharacterId: string;
  kind: RelationKind;
  label: string;
  bidirectional: boolean;
  strength: number;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface EncyclopediaEntry {
  id: string;
  novelId: string;
  category: string;
  name: string;
  aliases: string;
  /** 当前启用版本的摘要。条目本身不存正文，正文按版本保存。 */
  summary: string;
  content: string;
  tags: string[];
  sourceChapterId: string | null;
  sortNo: number;
  /** 当前启用的版本号，没有任何版本时为 0 */
  activeVersionNo: number;
  /** 该条目累计的版本数 */
  versionCount: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * 百科条目的一个版本。
 *
 * 同名条目再次登记时不建重复条目，而是追加一条版本记录；
 * 只有处于启用状态的版本会进入给模型的上下文。
 */
export interface EncyclopediaVersion {
  id: string;
  entryId: string;
  novelId: string;
  versionNo: number;
  summary: string;
  content: string;
  tags: string[];
  sourceChapterId: string | null;
  /** 版本来源：ai 为模型抽取，manual 为用户填写 */
  origin: 'ai' | 'manual';
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TimelineBranch {
  id: string;
  novelId: string;
  name: string;
  parentBranchId: string | null;
  forkEventId: string | null;
  mergeEventId: string | null;
  isMain: boolean;
  color: string;
  description: string;
  createdAt: string;
  updatedAt: string;
}

export interface TimelineEvent {
  id: string;
  novelId: string;
  branchId: string;
  chapterId: string | null;
  eventId: string | null;
  orderNo: number;
  novelTime: string;
  title: string;
  description: string;
  impact: string;
  kind: 'plot' | 'background' | 'fork' | 'merge';
  createdAt: string;
  updatedAt: string;
}

export type StoryEventStatus = 'active' | 'writing' | 'done' | 'archived';

/** 事件大纲中的单个步骤，一章通常推进一到多个步骤 */
export interface StoryEventStep {
  title: string;
  detail: string;
  /** 该步骤预期的章节内时间点，用于写入时间轴 */
  novelTime?: string;
}

/** 故事事件：承载一份完整大纲，逐章推进直到完成 */
export interface StoryEvent {
  id: string;
  novelId: string;
  branchId: string;
  volumeId: string | null;
  orderNo: number;
  title: string;
  novelTime: string;
  timeSort: string;
  /** 大纲正文，Markdown 格式 */
  outline: string;
  steps: StoryEventStep[];
  /** 已完成的步骤数，等于 steps.length 时事件结束 */
  progress: number;
  status: StoryEventStatus;
  userChoice: string;
  timelineEventId: string | null;
  startedChapterId: string | null;
  finishedChapterId: string | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
  /** 派生字段：事件涉及的章节数 */
  chapterCount?: number;
}

/**
 * 故事事件集合地址的返回结构。
 *
 * 集合地址同时给出事件清单、当前待推进的事件与已完成事件，
 * 界面按需取用，不要把它当成裸数组。
 */
export interface StoryEventListPayload {
  events: StoryEvent[];
  current: StoryEvent | null;
  finished: StoryEvent[];
}

export type QueryStatus = 'pending' | 'resolved';

/** AI 提出、随后由系统回填的百科查询请求 */
export interface EncyclopediaQuery {
  id: string;
  novelId: string;
  eventId: string | null;
  keyword: string;
  reason: string;
  result: string;
  resolved: boolean;
  createdAt: string;
  updatedAt: string;
}

/** AI 提出的往期事件调阅请求，需用户放行后才注入正文 */
export interface EventRecallRequest {
  id: string;
  novelId: string;
  eventId: string;
  reason: string;
  approved: boolean;
  createdAt: string;
  updatedAt: string;
  eventTitle?: string;
}

export interface Tag {
  id: string;
  novelId: string;
  name: string;
  color: string;
  createdAt: string;
}

export interface Bookmark {
  id: string;
  novelId: string;
  chapterId: string;
  label: string;
  anchor: string;
  note: string;
  createdAt: string;
  chapterTitle?: string;
  volumeIndex?: number;
  chapterIndex?: number;
}

export type ProviderPresetId = 'deepseek' | 'glm' | 'mimo' | 'openai' | 'ollama' | 'custom';

export interface ModelParams {
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
  stop?: string[];
}

export interface Provider {
  id: string;
  name: string;
  presetId: ProviderPresetId;
  baseUrl: string;
  /** 仅在服务端出现；返回给界面时使用 apiKeyMasked */
  apiKey?: string;
  apiKeyMasked: string;
  hasApiKey: boolean;
  defaultModel: string;
  models: string[];
  params: ModelParams;
  stream: boolean;
  maxRetries: number;
  enabled: boolean;
  isActive: boolean;
  sortNo: number;
  createdAt: string;
  updatedAt: string;
}

export type TaskType =
  | 'direction'
  | 'outline'
  | 'outline_revise'
  | 'outline_overview_revise'
  | 'outline_node_write'
  | 'chapter'
  | 'chapter_revise'
  | 'character_extract'
  | 'encyclopedia_extract'
  | 'free';

export interface PromptTemplate {
  id: string;
  providerId: string | null;
  taskType: TaskType;
  systemPrompt: string;
  userPrompt: string;
  temperature: number | null;
  isBuiltin: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UsageLog {
  id: string;
  novelId: string | null;
  chapterId: string | null;
  providerId: string | null;
  providerName: string;
  model: string;
  taskType: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimated: boolean;
  durationMs: number;
  createdAt: string;
}

export interface GenerationRules {
  /** 文风描述 */
  style: string;
  /** 叙事人称 */
  pov: string;
  /** 是否允许 H 内容 */
  allowExplicit: boolean;
  /** 是否允许暴力描写 */
  allowViolence: boolean;
  /** 禁止出现的内容 */
  forbidden: string[];
  /** 角色口吻与称呼约束 */
  speechHabits: string;
  /** 自定义附加规则，逐条生效 */
  extra: string[];
  /** 大纲生成规则，只在生成与改写大纲时注入，正文任务用不到 */
  outline: string;
}

export interface ContextBudget {
  /** 上下文总预算，单位 token */
  total: number;
  /** 始终注入层预算：设定、规则、角色、百科 */
  always: number;
  /** 按需注入的往期章节预算 */
  recalled: number;
  /** 事件大纲层预算：当前事件步骤、前一章全文与历史事件大纲 */
  outlines: number;
  /** 预留的生成空间 */
  reserved: number;
}

export interface NovelPreferences {
  /** 每章目标字数 */
  targetWords: number;
  /** 允许的字数容差，按百分比计 */
  wordTolerancePercent: number;
  /** 小说内历法说明 */
  calendar: string;
  /**
   * 参与提示词的上下文层与顺序。
   *
   * 空数组表示不设限：全部层都注入，并沿用程序内置的顺序。
   * 非空时按白名单处理，数组顺序即注入顺序。
   */
  contextLayers: string[];
  /** 生成规则 */
  rules: GenerationRules;
  /** 上下文预算 */
  budget: ContextBudget;
  /** 生成章节时是否自动推进事件大纲进度 */
  autoAdvanceEvent: boolean;
  /** 章末是否自动抽取新设定并写入百科与角色图鉴 */
  autoExtractSettings: boolean;
  /** 是否允许 AI 申请调阅往期事件全文 */
  allowEventRecall: boolean;
}

export interface CreateChapterInput {
  title: string;
  direction?: string;
  volumeId?: string;
  index?: number;
  outlineNodeId?: string;
  eventId?: string;
  stepIndex?: number;
}

export interface SearchHit {
  chapterId: string;
  novelId: string;
  volumeIndex: number;
  chapterIndex: number;
  title: string;
  volumeTitle: string;
  snippet: string;
  score: number;
  matchedIn: 'title' | 'content' | 'both';
}

export interface ConceptHit {
  kind: 'character' | 'encyclopedia' | 'outline' | 'event';
  id: string;
  title: string;
  subtitle: string;
  snippet: string;
}

export type ThemeMode = 'light' | 'dark' | 'system';
