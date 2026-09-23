import { getDb, now, parseJson, transact } from '../db';
import { shortId } from '../crypto';
import type {
  Character,
  CharacterRelation,
  CharacterRole,
  EncyclopediaEntry,
  EncyclopediaQuery,
  EncyclopediaVersion,
  EventRecallRequest,
  ForeshadowingItem,
  OutlineKind,
  OutlineNode,
  OutlineStatus,
  RelationKind,
  SpeechColorMode,
  StoryEvent,
  StoryEventStatus,
  StoryEventStep,
  TimelineBranch,
  TimelineEvent,
} from '../types';

/* ------------------------------------------------------------- 大纲树 */

interface OutlineRow {
  id: string;
  novel_id: string;
  parent_id: string | null;
  kind: string;
  order_no: number;
  title: string;
  content: string;
  status: string;
  chapter_id: string | null;
  created_at: string;
  updated_at: string;
}

function mapOutline(row: OutlineRow): OutlineNode {
  return {
    id: row.id,
    novelId: row.novel_id,
    parentId: row.parent_id,
    kind: row.kind as OutlineKind,
    orderNo: row.order_no,
    title: row.title,
    content: row.content,
    status: row.status as OutlineStatus,
    chapterId: row.chapter_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** 读取扁平的大纲节点列表。 */
export function listOutlineNodes(novelId: string): OutlineNode[] {
  const rows = getDb()
    .prepare('SELECT * FROM outline_nodes WHERE novel_id = ? ORDER BY order_no, created_at')
    .all(novelId) as OutlineRow[];
  return rows.map(mapOutline);
}

/** 把扁平列表组装成树，供大纲编辑器逐级折叠展示。 */
export function getOutlineTree(novelId: string): OutlineNode[] {
  const nodes = listOutlineNodes(novelId);
  const map = new Map<string, OutlineNode>();
  for (const node of nodes) {
    map.set(node.id, { ...node, children: [] });
  }
  const roots: OutlineNode[] = [];
  for (const node of map.values()) {
    if (node.parentId && map.has(node.parentId)) {
      map.get(node.parentId)!.children!.push(node);
    } else {
      roots.push(node);
    }
  }
  const sortTree = (list: OutlineNode[]) => {
    list.sort((a, b) => a.orderNo - b.orderNo);
    for (const item of list) if (item.children) sortTree(item.children);
  };
  sortTree(roots);
  return roots;
}

export interface OutlineNodeInput {
  title: string;
  content?: string;
  kind?: OutlineKind;
  parentId?: string | null;
  chapterId?: string | null;
  status?: OutlineStatus;
  orderNo?: number;
}

/** 新建大纲节点，未指定序号时追加到同级末尾。 */
export function createOutlineNode(novelId: string, input: OutlineNodeInput): OutlineNode {
  const parentId = input.parentId ?? null;
  let orderNo = input.orderNo;
  if (orderNo === undefined) {
    const row = getDb()
      .prepare(
        `SELECT COALESCE(MAX(order_no), 0) AS maxOrder FROM outline_nodes
         WHERE novel_id = ? AND COALESCE(parent_id, '') = COALESCE(?, '')`,
      )
      .get(novelId, parentId) as { maxOrder: number };
    orderNo = row.maxOrder + 1;
  }

  const id = shortId('ol');
  const timestamp = now();
  getDb()
    .prepare(
      `INSERT INTO outline_nodes (id, novel_id, parent_id, kind, order_no, title, content,
         status, chapter_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      novelId,
      parentId,
      input.kind ?? 'beat',
      orderNo,
      input.title,
      input.content ?? '',
      input.status ?? 'planned',
      input.chapterId ?? null,
      timestamp,
      timestamp,
    );
  return mapOutline(getDb().prepare('SELECT * FROM outline_nodes WHERE id = ?').get(id) as OutlineRow);
}

/** 更新大纲节点。 */
export function updateOutlineNode(nodeId: string, patch: Partial<OutlineNode>): OutlineNode | null {
  const fields: string[] = [];
  const values: unknown[] = [];
  const assign = (column: string, value: unknown) => {
    fields.push(`${column} = ?`);
    values.push(value);
  };
  if (patch.title !== undefined) assign('title', patch.title);
  if (patch.content !== undefined) assign('content', patch.content);
  if (patch.kind !== undefined) assign('kind', patch.kind);
  if (patch.status !== undefined) assign('status', patch.status);
  if (patch.parentId !== undefined) assign('parent_id', patch.parentId);
  if (patch.orderNo !== undefined) assign('order_no', patch.orderNo);
  if (patch.chapterId !== undefined) assign('chapter_id', patch.chapterId);
  if (fields.length === 0) return null;
  assign('updated_at', now());
  getDb()
    .prepare(`UPDATE outline_nodes SET ${fields.join(', ')} WHERE id = ?`)
    .run(...values, nodeId);
  const row = getDb().prepare('SELECT * FROM outline_nodes WHERE id = ?').get(nodeId) as
    | OutlineRow
    | undefined;
  return row ? mapOutline(row) : null;
}

/** 删除大纲节点，其子节点一并删除。 */
export function deleteOutlineNode(nodeId: string): void {
  transact(() => {
    const collect = (id: string, bucket: string[]) => {
      bucket.push(id);
      const children = getDb()
        .prepare('SELECT id FROM outline_nodes WHERE parent_id = ?')
        .all(id) as Array<{ id: string }>;
      for (const child of children) collect(child.id, bucket);
    };
    const ids: string[] = [];
    collect(nodeId, ids);
    const statement = getDb().prepare('DELETE FROM outline_nodes WHERE id = ?');
    for (const id of ids) statement.run(id);
  });
}

/** 按给定顺序重排同级节点。 */
export function reorderOutlineNodes(novelId: string, orderedIds: string[]): void {
  const statement = getDb().prepare(
    'UPDATE outline_nodes SET order_no = ?, updated_at = ? WHERE id = ? AND novel_id = ?',
  );
  transact(() => {
    orderedIds.forEach((id, position) => statement.run(position + 1, now(), id, novelId));
  });
}

/** 批量替换整棵大纲，用于 AI 生成后写入或用户整体重排。 */
export function replaceOutline(
  novelId: string,
  nodes: Array<{ title: string; content?: string; kind?: OutlineKind; children?: Array<{ title: string; content?: string }> }>,
): OutlineNode[] {
  transact(() => {
    getDb().prepare('DELETE FROM outline_nodes WHERE novel_id = ?').run(novelId);
  });
  for (const node of nodes) {
    const created = createOutlineNode(novelId, {
      title: node.title,
      content: node.content ?? '',
      kind: node.kind ?? 'beat',
    });
    for (const child of node.children ?? []) {
      createOutlineNode(novelId, {
        title: child.title,
        content: child.content ?? '',
        kind: 'sub',
        parentId: created.id,
      });
    }
  }
  return listOutlineNodes(novelId);
}

/* ----------------------------------------------------------- 角色图鉴 */

interface CharacterRow {
  id: string;
  novel_id: string;
  name: string;
  aliases: string;
  emoji: string;
  role_type: string;
  gender: string;
  age: string;
  faction: string;
  personality: string;
  appearance: string;
  ability: string;
  background: string;
  arc: string;
  foreshadowing: string;
  tags: string;
  notes: string;
  sort_no: number;
  is_primary: number;
  speech_hue: number;
  speech_color_mode: string;
  created_at: string;
  updated_at: string;
}

function mapCharacter(row: CharacterRow): Character {
  return {
    id: row.id,
    novelId: row.novel_id,
    name: row.name,
    aliases: parseJson<string[]>(row.aliases, []),
    emoji: row.emoji,
    roleType: row.role_type as CharacterRole,
    gender: row.gender,
    age: row.age,
    faction: row.faction,
    personality: row.personality,
    appearance: row.appearance,
    ability: row.ability,
    background: row.background,
    arc: row.arc,
    foreshadowing: parseJson<ForeshadowingItem[]>(row.foreshadowing, []),
    tags: parseJson<string[]>(row.tags, []),
    notes: row.notes,
    sortNo: row.sort_no,
    isPrimary: row.is_primary === 1,
    speechHue: row.speech_hue ?? 0,
    speechColorMode: (row.speech_color_mode ?? 'auto') as SpeechColorMode,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** 列出角色，可按角色定位过滤。 */
export function listCharacters(novelId: string, roleType?: CharacterRole): Character[] {
  const params: unknown[] = [novelId];
  let where = 'WHERE novel_id = ?';
  if (roleType) {
    where += ' AND role_type = ?';
    params.push(roleType);
  }
  const rows = getDb()
    .prepare(`SELECT * FROM characters ${where} ORDER BY is_primary DESC, sort_no, created_at`)
    .all(...params) as CharacterRow[];
  return rows.map(mapCharacter);
}

/** 读取单个角色。 */
export function getCharacter(characterId: string): Character | null {
  const row = getDb().prepare('SELECT * FROM characters WHERE id = ?').get(characterId) as
    | CharacterRow
    | undefined;
  return row ? mapCharacter(row) : null;
}

export type CharacterInput = Partial<Omit<Character, 'id' | 'novelId' | 'createdAt' | 'updatedAt'>> & {
  name: string;
};

/**
 * 为新角色挑选一个发言色相。
 *
 * 从黄金角序列中取第一个没被占用的色相，这样即使连续新增角色，
 * 相邻角色的颜色也不会撞在一起。
 */
export function pickSpeechHue(novelId: string): number {
  const used = new Set(
    (getDb().prepare('SELECT speech_hue FROM characters WHERE novel_id = ?').all(novelId) as Array<{
      speech_hue: number;
    }>).map((row) => row.speech_hue),
  );
  for (let step = 0; step < 360; step += 1) {
    const hue = (step * 137 + 20) % 360;
    if (!used.has(hue)) return hue;
  }
  return Math.floor(Math.random() * 360);
}

/** 新建角色。 */
export function createCharacter(novelId: string, input: CharacterInput): Character {
  const max = getDb()
    .prepare('SELECT COALESCE(MAX(sort_no), 0) AS maxSort FROM characters WHERE novel_id = ?')
    .get(novelId) as { maxSort: number };
  const id = shortId('chr');
  const timestamp = now();
  getDb()
    .prepare(
      `INSERT INTO characters (id, novel_id, name, aliases, emoji, role_type, gender, age, faction,
         personality, appearance, ability, background, arc, foreshadowing, tags, notes, sort_no,
         is_primary, speech_hue, speech_color_mode, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      novelId,
      input.name,
      JSON.stringify(input.aliases ?? []),
      input.emoji ?? '🙂',
      input.roleType ?? 'supporting',
      input.gender ?? '',
      input.age ?? '',
      input.faction ?? '',
      input.personality ?? '',
      input.appearance ?? '',
      input.ability ?? '',
      input.background ?? '',
      input.arc ?? '',
      JSON.stringify(input.foreshadowing ?? []),
      JSON.stringify(input.tags ?? []),
      input.notes ?? '',
      input.sortNo ?? max.maxSort + 1,
      input.isPrimary ? 1 : 0,
      input.speechHue ?? pickSpeechHue(novelId),
      input.speechColorMode ?? 'auto',
      timestamp,
      timestamp,
    );
  return getCharacter(id)!;
}

/** 更新角色。 */
export function updateCharacter(
  characterId: string,
  patch: Partial<Character>,
): Character | null {
  const fields: string[] = [];
  const values: unknown[] = [];
  const assign = (column: string, value: unknown) => {
    fields.push(`${column} = ?`);
    values.push(value);
  };
  const scalar: Array<[keyof Character, string]> = [
    ['name', 'name'],
    ['emoji', 'emoji'],
    ['roleType', 'role_type'],
    ['gender', 'gender'],
    ['age', 'age'],
    ['faction', 'faction'],
    ['personality', 'personality'],
    ['appearance', 'appearance'],
    ['ability', 'ability'],
    ['background', 'background'],
    ['arc', 'arc'],
    ['notes', 'notes'],
    ['sortNo', 'sort_no'],
  ];
  for (const [key, column] of scalar) {
    if (patch[key] !== undefined) assign(column, patch[key]);
  }
  if (patch.aliases !== undefined) assign('aliases', JSON.stringify(patch.aliases));
  if (patch.tags !== undefined) assign('tags', JSON.stringify(patch.tags));
  if (patch.foreshadowing !== undefined)
    assign('foreshadowing', JSON.stringify(patch.foreshadowing));
  if (patch.isPrimary !== undefined) assign('is_primary', patch.isPrimary ? 1 : 0);
  // 手动改色后标记为 manual，此后自动选色逻辑不再覆盖它
  if (patch.speechHue !== undefined) {
    assign('speech_hue', Math.max(0, Math.min(359, Math.round(patch.speechHue))));
    if (patch.speechColorMode === undefined) assign('speech_color_mode', 'manual');
  }
  if (patch.speechColorMode !== undefined) assign('speech_color_mode', patch.speechColorMode);
  if (fields.length === 0) return getCharacter(characterId);

  assign('updated_at', now());
  getDb()
    .prepare(`UPDATE characters SET ${fields.join(', ')} WHERE id = ?`)
    .run(...values, characterId);
  return getCharacter(characterId);
}

/** 删除角色，同时清除与之相关的关系。 */
export function deleteCharacter(characterId: string): void {
  getDb().prepare('DELETE FROM characters WHERE id = ?').run(characterId);
}

/** 按名称或别名查找角色，供导入与 AI 抽取结果对齐使用。 */
export function findCharacterByAlias(novelId: string, name: string | undefined): Character | null {
  if (typeof name !== 'string') return null;
  const target = name.trim();
  if (!target) return null;
  for (const character of listCharacters(novelId)) {
    if (character.name === target || character.aliases.includes(target)) return character;
  }
  return null;
}

/* ----------------------------------------------------------- 关系网 */

interface RelationRow {
  id: string;
  novel_id: string;
  from_character_id: string;
  to_character_id: string;
  kind: string;
  label: string;
  bidirectional: number;
  strength: number;
  notes: string;
  created_at: string;
  updated_at: string;
}

function mapRelation(row: RelationRow): CharacterRelation {
  return {
    id: row.id,
    novelId: row.novel_id,
    fromCharacterId: row.from_character_id,
    toCharacterId: row.to_character_id,
    kind: row.kind as RelationKind,
    label: row.label,
    bidirectional: row.bidirectional === 1,
    strength: row.strength,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** 列出关系网中的全部边。 */
export function listRelations(novelId: string): CharacterRelation[] {
  const rows = getDb()
    .prepare('SELECT * FROM character_relations WHERE novel_id = ? ORDER BY created_at')
    .all(novelId) as RelationRow[];
  return rows.map(mapRelation);
}

/** 新建关系。重复的无向边会被合并更新，而不是产生平行边。 */
export function createRelation(
  novelId: string,
  input: {
    fromCharacterId: string;
    toCharacterId: string;
    kind?: RelationKind;
    label?: string;
    bidirectional?: boolean;
    strength?: number;
    notes?: string;
  },
): CharacterRelation {
  if (input.fromCharacterId === input.toCharacterId) {
    throw new Error('角色不能与自己建立关系');
  }
  const bidirectional = input.bidirectional ?? true;
  const existing = getDb()
    .prepare(
      `SELECT * FROM character_relations
       WHERE novel_id = ? AND kind = ?
         AND ((from_character_id = ? AND to_character_id = ?)
           OR (from_character_id = ? AND to_character_id = ?))`,
    )
    .get(
      novelId,
      input.kind ?? 'other',
      input.fromCharacterId,
      input.toCharacterId,
      input.toCharacterId,
      input.fromCharacterId,
    ) as RelationRow | undefined;

  if (existing) {
    getDb()
      .prepare(
        `UPDATE character_relations SET bidirectional = ?, strength = ?, label = ?, notes = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        bidirectional ? 1 : 0,
        input.strength ?? existing.strength,
        input.label ?? existing.label,
        input.notes ?? existing.notes,
        now(),
        existing.id,
      );
    return mapRelation(
      getDb().prepare('SELECT * FROM character_relations WHERE id = ?').get(existing.id) as RelationRow,
    );
  }

  const id = shortId('rel');
  const timestamp = now();
  getDb()
    .prepare(
      `INSERT INTO character_relations (id, novel_id, from_character_id, to_character_id, kind,
         label, bidirectional, strength, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      novelId,
      input.fromCharacterId,
      input.toCharacterId,
      input.kind ?? 'other',
      input.label ?? '',
      bidirectional ? 1 : 0,
      input.strength ?? 3,
      input.notes ?? '',
      timestamp,
      timestamp,
    );
  return mapRelation(
    getDb().prepare('SELECT * FROM character_relations WHERE id = ?').get(id) as RelationRow,
  );
}

/** 更新关系。 */
export function updateRelation(
  relationId: string,
  patch: Partial<CharacterRelation>,
): CharacterRelation | null {
  const fields: string[] = [];
  const values: unknown[] = [];
  const assign = (column: string, value: unknown) => {
    fields.push(`${column} = ?`);
    values.push(value);
  };
  if (patch.kind !== undefined) assign('kind', patch.kind);
  if (patch.label !== undefined) assign('label', patch.label);
  if (patch.bidirectional !== undefined) assign('bidirectional', patch.bidirectional ? 1 : 0);
  if (patch.strength !== undefined) assign('strength', patch.strength);
  if (patch.notes !== undefined) assign('notes', patch.notes);
  if (patch.fromCharacterId !== undefined) assign('from_character_id', patch.fromCharacterId);
  if (patch.toCharacterId !== undefined) assign('to_character_id', patch.toCharacterId);
  if (fields.length === 0) return null;
  assign('updated_at', now());
  getDb()
    .prepare(`UPDATE character_relations SET ${fields.join(', ')} WHERE id = ?`)
    .run(...values, relationId);
  return mapRelation(
    getDb().prepare('SELECT * FROM character_relations WHERE id = ?').get(relationId) as RelationRow,
  );
}

/** 删除关系。 */
export function deleteRelation(relationId: string): void {
  getDb().prepare('DELETE FROM character_relations WHERE id = ?').run(relationId);
}

/* --------------------------------------------------------- 百科全书 */

interface EncyclopediaRow {
  id: string;
  novel_id: string;
  category: string;
  name: string;
  aliases: string;
  summary: string;
  content: string;
  tags: string;
  source_chapter_id: string | null;
  sort_no: number;
  created_at: string;
  updated_at: string;
}

/** 百科版本行。 */
interface EncyclopediaVersionRow {
  id: string;
  entry_id: string;
  novel_id: string;
  version_no: number;
  summary: string;
  content: string;
  tags: string;
  source_chapter_id: string | null;
  origin: string;
  is_active: number;
  created_at: string;
  updated_at: string;
}

function mapVersion(row: EncyclopediaVersionRow): EncyclopediaVersion {
  return {
    id: row.id,
    entryId: row.entry_id,
    novelId: row.novel_id,
    versionNo: row.version_no,
    summary: row.summary,
    content: row.content,
    tags: parseJson<string[]>(row.tags, []),
    sourceChapterId: row.source_chapter_id,
    origin: row.origin === 'ai' ? 'ai' : 'manual',
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** 一次查出全部条目的版本统计，避免逐条查询。 */
function loadVersionStats(novelId: string): Map<string, { count: number; activeNo: number }> {
  const rows = getDb()
    .prepare(
      `SELECT entry_id AS entryId,
              COUNT(*) AS count,
              COALESCE(MAX(CASE WHEN is_active = 1 THEN version_no END), 0) AS activeNo
       FROM encyclopedia_versions
       WHERE novel_id = ?
       GROUP BY entry_id`,
    )
    .all(novelId) as Array<{ entryId: string; count: number; activeNo: number }>;
  return new Map(rows.map((row) => [row.entryId, { count: row.count, activeNo: row.activeNo }]));
}

/** 一次查出全部启用版本的正文。 */
function loadActiveVersions(novelId: string): Map<string, EncyclopediaVersionRow> {
  const rows = getDb()
    .prepare('SELECT * FROM encyclopedia_versions WHERE novel_id = ? AND is_active = 1')
    .all(novelId) as EncyclopediaVersionRow[];
  const map = new Map<string, EncyclopediaVersionRow>();
  for (const row of rows) {
    const current = map.get(row.entry_id);
    // 每个条目正常只有一条启用版本，出现多条时取版本号最大的那个
    if (!current || row.version_no > current.version_no) map.set(row.entry_id, row);
  }
  return map;
}

function mapEntry(
  row: EncyclopediaRow,
  version?: EncyclopediaVersionRow,
  stats?: { count: number; activeNo: number },
): EncyclopediaEntry {
  return {
    id: row.id,
    novelId: row.novel_id,
    category: row.category,
    name: row.name,
    aliases: row.aliases,
    summary: version?.summary ?? '',
    content: version?.content ?? '',
    tags: parseJson<string[]>(version?.tags ?? '[]', []),
    sourceChapterId: version?.source_chapter_id ?? null,
    sortNo: row.sort_no,
    activeVersionNo: stats?.activeNo ?? version?.version_no ?? 0,
    versionCount: stats?.count ?? (version ? 1 : 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** 列出百科条目，正文取各自的启用版本。 */
export function listEncyclopedia(novelId: string, category?: string): EncyclopediaEntry[] {
  const params: unknown[] = [novelId];
  let where = 'WHERE novel_id = ?';
  if (category) {
    where += ' AND category = ?';
    params.push(category);
  }
  const rows = getDb()
    .prepare(`SELECT * FROM encyclopedia_entries ${where} ORDER BY category, sort_no, name`)
    .all(...params) as EncyclopediaRow[];
  const versions = loadActiveVersions(novelId);
  const stats = loadVersionStats(novelId);
  return rows.map((row) => mapEntry(row, versions.get(row.id), stats.get(row.id)));
}

/** 读取单条百科条目，正文取它的启用版本。 */
export function getEncyclopediaEntry(entryId: string): EncyclopediaEntry | null {
  const row = getDb()
    .prepare('SELECT * FROM encyclopedia_entries WHERE id = ?')
    .get(entryId) as EncyclopediaRow | undefined;
  if (!row) return null;
  const version = getDb()
    .prepare(
      'SELECT * FROM encyclopedia_versions WHERE entry_id = ? AND is_active = 1 ORDER BY version_no DESC LIMIT 1',
    )
    .get(entryId) as EncyclopediaVersionRow | undefined;
  const stats = getDb()
    .prepare(
      `SELECT COUNT(*) AS count,
              COALESCE(MAX(CASE WHEN is_active = 1 THEN version_no END), 0) AS activeNo
       FROM encyclopedia_versions WHERE entry_id = ?`,
    )
    .get(entryId) as { count: number; activeNo: number } | undefined;
  return mapEntry(row, version, stats ?? undefined);
}

/** 按名称查找条目，供同名追加版本时使用。 */
export function findEncyclopediaByName(
  novelId: string,
  name: string,
): EncyclopediaRow | undefined {
  return getDb()
    .prepare('SELECT * FROM encyclopedia_entries WHERE novel_id = ? AND name = ? LIMIT 1')
    .get(novelId, name.trim()) as EncyclopediaRow | undefined;
}

/** 列出某条目的全部版本，新的在前。 */
export function listEncyclopediaVersions(entryId: string): EncyclopediaVersion[] {
  const rows = getDb()
    .prepare('SELECT * FROM encyclopedia_versions WHERE entry_id = ? ORDER BY version_no DESC')
    .all(entryId) as EncyclopediaVersionRow[];
  return rows.map(mapVersion);
}

/** 读取单个版本。 */
export function getEncyclopediaVersion(versionId: string): EncyclopediaVersion | null {
  const row = getDb()
    .prepare('SELECT * FROM encyclopedia_versions WHERE id = ?')
    .get(versionId) as EncyclopediaVersionRow | undefined;
  return row ? mapVersion(row) : null;
}

/**
 * 把某条版本设为启用，同条目的其余版本一并停用。
 *
 * 启用版本决定条目对外呈现的正文，也是唯一会进入模型上下文的那一版。
 */
export function activateEncyclopediaVersion(versionId: string): EncyclopediaEntry | null {
  const version = getDb()
    .prepare('SELECT * FROM encyclopedia_versions WHERE id = ?')
    .get(versionId) as EncyclopediaVersionRow | undefined;
  if (!version) return null;

  transact(() => {
    getDb()
      .prepare('UPDATE encyclopedia_versions SET is_active = 0 WHERE entry_id = ?')
      .run(version.entry_id);
    getDb()
      .prepare('UPDATE encyclopedia_versions SET is_active = 1, updated_at = ? WHERE id = ?')
      .run(now(), versionId);
  });
  return getEncyclopediaEntry(version.entry_id);
}

/** 为条目追加一条版本，并把它设为启用。 */
function addEncyclopediaVersion(
  entryId: string,
  novelId: string,
  body: {
    summary: string;
    content: string;
    tags: string[];
    sourceChapterId: string | null;
    origin: 'ai' | 'manual';
  },
): EncyclopediaVersionRow {
  const max = getDb()
    .prepare('SELECT COALESCE(MAX(version_no), 0) AS maxNo FROM encyclopedia_versions WHERE entry_id = ?')
    .get(entryId) as { maxNo: number };
  const next = max.maxNo + 1;
  const timestamp = now();

  transact(() => {
    // 先停用其余版本，保证同一条目始终只有一条启用
    getDb()
      .prepare('UPDATE encyclopedia_versions SET is_active = 0 WHERE entry_id = ?')
      .run(entryId);
    getDb()
      .prepare(
        `INSERT INTO encyclopedia_versions (id, entry_id, novel_id, version_no, summary, content,
           tags, source_chapter_id, origin, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(
        shortId('encv'),
        entryId,
        novelId,
        next,
        body.summary,
        body.content,
        JSON.stringify(body.tags),
        body.sourceChapterId,
        body.origin,
        timestamp,
        timestamp,
      );
  });

  return getDb()
    .prepare('SELECT * FROM encyclopedia_versions WHERE entry_id = ? ORDER BY version_no DESC LIMIT 1')
    .get(entryId) as EncyclopediaVersionRow;
}

/** 百科目录：按分类归组的树。 */
export function getEncyclopediaCatalog(
  novelId: string,
): Array<{ category: string; count: number; entries: EncyclopediaEntry[] }> {
  const entries = listEncyclopedia(novelId);
  const groups = new Map<string, EncyclopediaEntry[]>();
  for (const entry of entries) {
    const list = groups.get(entry.category) ?? [];
    list.push(entry);
    groups.set(entry.category, list);
  }
  return Array.from(groups.entries())
    .map(([category, list]) => ({ category, count: list.length, entries: list }))
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category, 'zh-Hans-CN'));
}

export type EncyclopediaInput =
  Partial<Omit<EncyclopediaEntry, 'id' | 'novelId' | 'createdAt' | 'updatedAt'>> & {
    name: string;
    /** 版本来源。模型抽取的结果记为 ai，便于追溯与默认启用策略 */
    origin?: 'ai' | 'manual';
  };

/**
 * 登记一条百科内容。
 *
 * 同名条目已经存在时，不建重复条目，而是在它下面追加一个新版本并启用，
 * 旧版本原样保留。这样模型反复抽取同一个词条不会把条目列表撑爆，
 * 也能留住被替换掉的旧稿。
 */
export function createEncyclopediaEntry(
  novelId: string,
  input: EncyclopediaInput,
): EncyclopediaEntry {
  const origin = input.origin === 'ai' ? 'ai' : 'manual';
  const existing = findEncyclopediaByName(novelId, input.name);

  if (existing) {
    addEncyclopediaVersion(existing.id, novelId, {
      summary: input.summary ?? '',
      content: input.content ?? '',
      tags: input.tags ?? [],
      sourceChapterId: input.sourceChapterId ?? null,
      origin,
    });
    // 顺带补全分类与别名，让后登记的版本能丰富条目的身份信息
    if (input.category || input.aliases) {
      getDb()
        .prepare(
          `UPDATE encyclopedia_entries
           SET category = COALESCE(NULLIF(?, ''), category),
               aliases = COALESCE(NULLIF(?, ''), aliases),
               updated_at = ?
           WHERE id = ?`,
        )
        .run(input.category?.trim() ?? '', input.aliases ?? '', now(), existing.id);
    }
    return getEncyclopediaEntry(existing.id)!;
  }

  const max = getDb()
    .prepare('SELECT COALESCE(MAX(sort_no), 0) AS maxSort FROM encyclopedia_entries WHERE novel_id = ?')
    .get(novelId) as { maxSort: number };
  const id = shortId('enc');
  const timestamp = now();
  getDb()
    .prepare(
      `INSERT INTO encyclopedia_entries (id, novel_id, category, name, aliases, sort_no, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      novelId,
      input.category?.trim() || '其他',
      input.name,
      input.aliases ?? '',
      input.sortNo ?? max.maxSort + 1,
      timestamp,
      timestamp,
    );
  addEncyclopediaVersion(id, novelId, {
    summary: input.summary ?? '',
    content: input.content ?? '',
    tags: input.tags ?? [],
    sourceChapterId: input.sourceChapterId ?? null,
    origin,
  });
  return getEncyclopediaEntry(id)!;
}

/**
 * 更新百科条目。
 *
 * 身份信息改在条目上，正文改动落在当前启用的版本上，
 * 因此手动编辑不会凭空多出版本；条目还没有版本时先补一个。
 */
export function updateEncyclopediaEntry(
  entryId: string,
  patch: Partial<EncyclopediaEntry>,
): EncyclopediaEntry | null {
  const fields: string[] = [];
  const values: unknown[] = [];
  const assign = (column: string, value: unknown) => {
    fields.push(`${column} = ?`);
    values.push(value);
  };
  if (patch.category !== undefined) assign('category', patch.category);
  if (patch.name !== undefined) assign('name', patch.name);
  if (patch.aliases !== undefined) assign('aliases', patch.aliases);
  if (patch.sortNo !== undefined) assign('sort_no', patch.sortNo);
  if (fields.length > 0) {
    assign('updated_at', now());
    getDb()
      .prepare(`UPDATE encyclopedia_entries SET ${fields.join(', ')} WHERE id = ?`)
      .run(...values, entryId);
  }

  const touchesContent =
    patch.summary !== undefined || patch.content !== undefined || patch.tags !== undefined;
  if (touchesContent) {
    const version = getDb()
      .prepare(
        'SELECT * FROM encyclopedia_versions WHERE entry_id = ? AND is_active = 1 ORDER BY version_no DESC LIMIT 1',
      )
      .get(entryId) as EncyclopediaVersionRow | undefined;

    if (!version) {
      const entry = getDb()
        .prepare('SELECT novel_id FROM encyclopedia_entries WHERE id = ?')
        .get(entryId) as { novel_id: string } | undefined;
      if (!entry) return null;
      addEncyclopediaVersion(entryId, entry.novel_id, {
        summary: patch.summary ?? '',
        content: patch.content ?? '',
        tags: patch.tags ?? [],
        sourceChapterId: patch.sourceChapterId ?? null,
        origin: 'manual',
      });
    } else {
      const versionFields: string[] = [];
      const versionValues: unknown[] = [];
      const assignVersion = (column: string, value: unknown) => {
        versionFields.push(`${column} = ?`);
        versionValues.push(value);
      };
      if (patch.summary !== undefined) assignVersion('summary', patch.summary);
      if (patch.content !== undefined) assignVersion('content', patch.content);
      if (patch.tags !== undefined) assignVersion('tags', JSON.stringify(patch.tags));
      if (patch.sourceChapterId !== undefined) {
        assignVersion('source_chapter_id', patch.sourceChapterId);
      }
      assignVersion('updated_at', now());
      getDb()
        .prepare(`UPDATE encyclopedia_versions SET ${versionFields.join(', ')} WHERE id = ?`)
        .run(...versionValues, version.id);
    }
  }

  return getEncyclopediaEntry(entryId);
}

/** 删除百科条目。 */
export function deleteEncyclopediaEntry(entryId: string): void {
  getDb().prepare('DELETE FROM encyclopedia_entries WHERE id = ?').run(entryId);
}

/* --------------------------------------------------------- 时间轴 */

interface BranchRow {
  id: string;
  novel_id: string;
  name: string;
  parent_branch_id: string | null;
  fork_event_id: string | null;
  merge_event_id: string | null;
  is_main: number;
  color: string;
  description: string;
  created_at: string;
  updated_at: string;
}

interface EventRow {
  id: string;
  novel_id: string;
  branch_id: string;
  chapter_id: string | null;
  event_id: string | null;
  order_no: number;
  novel_time: string;
  title: string;
  description: string;
  impact: string;
  kind: string;
  created_at: string;
  updated_at: string;
}

function mapBranch(row: BranchRow): TimelineBranch {
  return {
    id: row.id,
    novelId: row.novel_id,
    name: row.name,
    parentBranchId: row.parent_branch_id,
    forkEventId: row.fork_event_id,
    mergeEventId: row.merge_event_id,
    isMain: row.is_main === 1,
    color: row.color,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapEvent(row: EventRow): TimelineEvent {
  return {
    id: row.id,
    novelId: row.novel_id,
    branchId: row.branch_id,
    chapterId: row.chapter_id,
    eventId: row.event_id ?? null,
    orderNo: row.order_no,
    novelTime: row.novel_time,
    title: row.title,
    description: row.description,
    impact: row.impact,
    kind: row.kind as TimelineEvent['kind'],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** 列出时间轴分支。 */
export function listBranches(novelId: string): TimelineBranch[] {
  const rows = getDb()
    .prepare('SELECT * FROM timeline_branches WHERE novel_id = ? ORDER BY is_main DESC, created_at')
    .all(novelId) as BranchRow[];
  return rows.map(mapBranch);
}

/** 取得主线分支，不存在时创建一个。 */
export function getMainBranch(novelId: string): TimelineBranch {
  const existing = getDb()
    .prepare('SELECT * FROM timeline_branches WHERE novel_id = ? AND is_main = 1 LIMIT 1')
    .get(novelId) as BranchRow | undefined;
  if (existing) return mapBranch(existing);

  const id = shortId('br');
  const timestamp = now();
  getDb()
    .prepare(
      `INSERT INTO timeline_branches (id, novel_id, name, parent_branch_id, fork_event_id,
         merge_event_id, is_main, color, description, created_at, updated_at)
       VALUES (?, ?, '主线', NULL, NULL, NULL, 1, '', '故事主线时间轴', ?, ?)`,
    )
    .run(id, novelId, timestamp, timestamp);
  return mapBranch(
    getDb().prepare('SELECT * FROM timeline_branches WHERE id = ?').get(id) as BranchRow,
  );
}

/** 新建分支，用于平行宇宙或穿越支线。 */
export function createBranch(
  novelId: string,
  input: {
    name: string;
    parentBranchId?: string | null;
    forkEventId?: string | null;
    mergeEventId?: string | null;
    description?: string;
    color?: string;
  },
): TimelineBranch {
  const id = shortId('br');
  const timestamp = now();
  getDb()
    .prepare(
      `INSERT INTO timeline_branches (id, novel_id, name, parent_branch_id, fork_event_id,
         merge_event_id, is_main, color, description, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
    )
    .run(
      id,
      novelId,
      input.name,
      input.parentBranchId ?? null,
      input.forkEventId ?? null,
      input.mergeEventId ?? null,
      input.color ?? '',
      input.description ?? '',
      timestamp,
      timestamp,
    );
  return mapBranch(
    getDb().prepare('SELECT * FROM timeline_branches WHERE id = ?').get(id) as BranchRow,
  );
}

/** 更新分支，可用于设置分叉点与合并点完成分支合并。 */
export function updateBranch(branchId: string, patch: Partial<TimelineBranch>): TimelineBranch | null {
  const fields: string[] = [];
  const values: unknown[] = [];
  const assign = (column: string, value: unknown) => {
    fields.push(`${column} = ?`);
    values.push(value);
  };
  if (patch.name !== undefined) assign('name', patch.name);
  if (patch.parentBranchId !== undefined) assign('parent_branch_id', patch.parentBranchId);
  if (patch.forkEventId !== undefined) assign('fork_event_id', patch.forkEventId);
  if (patch.mergeEventId !== undefined) assign('merge_event_id', patch.mergeEventId);
  if (patch.description !== undefined) assign('description', patch.description);
  if (patch.color !== undefined) assign('color', patch.color);
  if (patch.isMain !== undefined) assign('is_main', patch.isMain ? 1 : 0);
  if (fields.length === 0) return null;
  assign('updated_at', now());
  getDb()
    .prepare(`UPDATE timeline_branches SET ${fields.join(', ')} WHERE id = ?`)
    .run(...values, branchId);
  return mapBranch(
    getDb().prepare('SELECT * FROM timeline_branches WHERE id = ?').get(branchId) as BranchRow,
  );
}

/** 删除分支连同其事件。主线不允许删除。 */
export function deleteBranch(branchId: string): void {
  const row = getDb().prepare('SELECT is_main FROM timeline_branches WHERE id = ?').get(branchId) as
    | { is_main: number }
    | undefined;
  if (!row) return;
  if (row.is_main === 1) throw new Error('主线分支不允许删除');
  getDb().prepare('DELETE FROM timeline_branches WHERE id = ?').run(branchId);
}

/** 列出时间轴事件，可按分支过滤。 */
export function listTimelineEvents(novelId: string, branchId?: string): TimelineEvent[] {
  const params: unknown[] = [novelId];
  let where = 'WHERE e.novel_id = ?';
  if (branchId) {
    where += ' AND e.branch_id = ?';
    params.push(branchId);
  }
  const rows = getDb()
    .prepare(
      `SELECT e.* FROM timeline_events e
       ${where} ORDER BY e.order_no, e.created_at`,
    )
    .all(...params) as EventRow[];
  return rows.map(mapEvent);
}

/** 新建时间轴事件。 */
export function createTimelineEvent(
  novelId: string,
  input: {
    branchId?: string;
    chapterId?: string | null;
    eventId?: string | null;
    novelTime?: string;
    title: string;
    description?: string;
    impact?: string;
    kind?: TimelineEvent['kind'];
    orderNo?: number;
  },
): TimelineEvent {
  const branchId = input.branchId ?? getMainBranch(novelId).id;
  let orderNo = input.orderNo;
  if (orderNo === undefined) {
    const row = getDb()
      .prepare(
        'SELECT COALESCE(MAX(order_no), 0) AS maxOrder FROM timeline_events WHERE novel_id = ? AND branch_id = ?',
      )
      .get(novelId, branchId) as { maxOrder: number };
    orderNo = row.maxOrder + 1;
  }
  const id = shortId('evt');
  const timestamp = now();
  getDb()
    .prepare(
      `INSERT INTO timeline_events (id, novel_id, branch_id, chapter_id, event_id, order_no, novel_time,
         title, description, impact, kind, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      novelId,
      branchId,
      input.chapterId ?? null,
      input.eventId ?? null,
      orderNo,
      input.novelTime ?? '',
      input.title,
      input.description ?? '',
      input.impact ?? '',
      input.kind ?? 'plot',
      timestamp,
      timestamp,
    );
  const row = getDb().prepare('SELECT * FROM timeline_events WHERE id = ?').get(id) as EventRow;
  return mapEvent(row);
}

/** 更新时间轴事件。 */
export function updateTimelineEvent(
  eventId: string,
  patch: Partial<TimelineEvent>,
): TimelineEvent | null {
  const fields: string[] = [];
  const values: unknown[] = [];
  const assign = (column: string, value: unknown) => {
    fields.push(`${column} = ?`);
    values.push(value);
  };
  if (patch.branchId !== undefined) assign('branch_id', patch.branchId);
  if (patch.chapterId !== undefined) assign('chapter_id', patch.chapterId);
  if (patch.eventId !== undefined) assign('event_id', patch.eventId);
  if (patch.orderNo !== undefined) assign('order_no', patch.orderNo);
  if (patch.novelTime !== undefined) assign('novel_time', patch.novelTime);
  if (patch.title !== undefined) assign('title', patch.title);
  if (patch.description !== undefined) assign('description', patch.description);
  if (patch.impact !== undefined) assign('impact', patch.impact);
  if (patch.kind !== undefined) assign('kind', patch.kind);
  if (fields.length === 0) return null;
  assign('updated_at', now());
  getDb()
    .prepare(`UPDATE timeline_events SET ${fields.join(', ')} WHERE id = ?`)
    .run(...values, eventId);
  const row = getDb().prepare('SELECT * FROM timeline_events WHERE id = ?').get(eventId) as EventRow;
  return mapEvent(row);
}

/** 删除时间轴事件。 */
export function deleteTimelineEvent(eventId: string): void {
  getDb().prepare('DELETE FROM timeline_events WHERE id = ?').run(eventId);
}

/* --------------------------------------------------------- 故事事件 */

interface StoryEventRow {
  id: string;
  novel_id: string;
  branch_id: string;
  volume_id: string | null;
  order_no: number;
  title: string;
  novel_time: string;
  time_sort: string;
  outline: string;
  steps: string;
  progress: number;
  status: string;
  user_choice: string;
  timeline_event_id: string | null;
  started_chapter_id: string | null;
  finished_chapter_id: string | null;
  notes: string;
  created_at: string;
  updated_at: string;
}

function mapStoryEvent(row: StoryEventRow): StoryEvent {
  return {
    id: row.id,
    novelId: row.novel_id,
    branchId: row.branch_id,
    volumeId: row.volume_id,
    orderNo: row.order_no,
    title: row.title,
    novelTime: row.novel_time,
    timeSort: row.time_sort,
    outline: row.outline,
    steps: parseJson<StoryEventStep[]>(row.steps, []),
    progress: row.progress,
    status: row.status as StoryEventStatus,
    userChoice: row.user_choice,
    timelineEventId: row.timeline_event_id,
    startedChapterId: row.started_chapter_id,
    finishedChapterId: row.finished_chapter_id,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** 列出故事事件，可按分支与状态过滤。 */
export function listStoryEvents(
  novelId: string,
  options: { branchId?: string; status?: StoryEventStatus } = {},
): StoryEvent[] {
  const params: unknown[] = [novelId];
  let where = 'WHERE novel_id = ?';
  if (options.branchId) {
    where += ' AND branch_id = ?';
    params.push(options.branchId);
  }
  if (options.status) {
    where += ' AND status = ?';
    params.push(options.status);
  }
  const rows = getDb()
    .prepare(`SELECT * FROM story_events ${where} ORDER BY order_no, created_at`)
    .all(...params) as StoryEventRow[];
  return rows.map(mapStoryEvent);
}

/** 读取单个故事事件。 */
export function getStoryEvent(eventId: string): StoryEvent | null {
  const row = getDb().prepare('SELECT * FROM story_events WHERE id = ?').get(eventId) as
    | StoryEventRow
    | undefined;
  return row ? mapStoryEvent(row) : null;
}

/**
 * 取出当前正在推进的事件。
 *
 * 优先返回已开工的事件，没有则取最早一个待写事件，
 * 两者都不存在说明需要让 AI 生成新的事件大纲。
 */
export function getCurrentStoryEvent(novelId: string, branchId?: string): StoryEvent | null {
  const branch = branchId ?? getMainBranch(novelId).id;
  const row = getDb()
    .prepare(
      `SELECT * FROM story_events
       WHERE novel_id = ? AND branch_id = ? AND status IN ('active', 'writing')
       ORDER BY status = 'writing' DESC, order_no, created_at
       LIMIT 1`,
    )
    .get(novelId, branch) as StoryEventRow | undefined;
  return row ? mapStoryEvent(row) : null;
}

/** 取出已完成的事件，按顺序排列，用于注入历史大纲。 */
export function listFinishedStoryEvents(novelId: string, branchId?: string): StoryEvent[] {
  return listStoryEvents(novelId, { branchId, status: 'done' });
}

export interface StoryEventInput {
  title: string;
  outline?: string;
  steps?: StoryEventStep[];
  novelTime?: string;
  timeSort?: string;
  userChoice?: string;
  volumeId?: string | null;
  branchId?: string;
  orderNo?: number;
  notes?: string;
}

/**
 * 新建故事事件。
 *
 * 同时把事件本身登记为一条时间轴事件，让时间轴页面无需额外同步就能看到它。
 */
export function createStoryEvent(novelId: string, input: StoryEventInput): StoryEvent {
  const branchId = input.branchId ?? getMainBranch(novelId).id;
  let orderNo = input.orderNo;
  if (orderNo === undefined) {
    const row = getDb()
      .prepare(
        'SELECT COALESCE(MAX(order_no), 0) AS maxOrder FROM story_events WHERE novel_id = ? AND branch_id = ?',
      )
      .get(novelId, branchId) as { maxOrder: number };
    orderNo = row.maxOrder + 1;
  }
  const id = shortId('stev');
  const timestamp = now();
  const steps = input.steps ?? [];
  getDb()
    .prepare(
      `INSERT INTO story_events (id, novel_id, branch_id, volume_id, order_no, title, novel_time,
         time_sort, outline, steps, progress, status, user_choice, timeline_event_id,
         started_chapter_id, finished_chapter_id, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'active', ?, NULL, NULL, NULL, ?, ?, ?)`,
    )
    .run(
      id,
      novelId,
      branchId,
      input.volumeId ?? null,
      orderNo,
      input.title,
      input.novelTime ?? '',
      input.timeSort ?? input.novelTime ?? '',
      input.outline ?? '',
      JSON.stringify(steps),
      input.userChoice ?? '',
      input.notes ?? '',
      timestamp,
      timestamp,
    );

  // 事件与时间轴条目一一对应，时间轴以事件大纲的首段作为说明
  const timelineEvent = createTimelineEvent(novelId, {
    branchId,
    eventId: id,
    novelTime: input.novelTime ?? '',
    title: input.title,
    description: firstParagraph(input.outline ?? ''),
    impact: '',
    kind: 'plot',
  });
  getDb()
    .prepare('UPDATE story_events SET timeline_event_id = ? WHERE id = ?')
    .run(timelineEvent.id, id);

  return getStoryEvent(id)!;
}

/** 取正文第一段，用作摘要，避免在时间轴上铺满整份大纲。 */
function firstParagraph(text: string): string {
  const lines = text
    .split('\n')
    .map((line) => line.replace(/^#+\s*/, '').trim())
    .filter((line) => line.length > 0);
  return lines[0] ?? '';
}

/** 更新故事事件。修改大纲时若步骤缩减，进度指针会被夹回合法范围。 */
export function updateStoryEvent(eventId: string, patch: Partial<StoryEvent>): StoryEvent | null {
  const current = getStoryEvent(eventId);
  if (!current) return null;

  const fields: string[] = [];
  const values: unknown[] = [];
  const assign = (column: string, value: unknown) => {
    fields.push(`${column} = ?`);
    values.push(value);
  };
  if (patch.title !== undefined) assign('title', patch.title);
  if (patch.outline !== undefined) assign('outline', patch.outline);
  if (patch.novelTime !== undefined) assign('novel_time', patch.novelTime);
  if (patch.timeSort !== undefined) assign('time_sort', patch.timeSort);
  if (patch.volumeId !== undefined) assign('volume_id', patch.volumeId);
  if (patch.orderNo !== undefined) assign('order_no', patch.orderNo);
  if (patch.userChoice !== undefined) assign('user_choice', patch.userChoice);
  if (patch.notes !== undefined) assign('notes', patch.notes);
  if (patch.branchId !== undefined) assign('branch_id', patch.branchId);
  if (patch.status !== undefined) assign('status', patch.status);
  if (patch.startedChapterId !== undefined) assign('started_chapter_id', patch.startedChapterId);
  if (patch.finishedChapterId !== undefined) assign('finished_chapter_id', patch.finishedChapterId);

  let steps = current.steps;
  if (patch.steps !== undefined) {
    steps = patch.steps;
    assign('steps', JSON.stringify(steps));
  }
  const maxProgress = steps.length;
  const progress =
    patch.progress !== undefined ? patch.progress : Math.min(current.progress, maxProgress);
  if (patch.progress !== undefined || patch.steps !== undefined) {
    assign('progress', Math.max(0, Math.min(maxProgress, progress)));
  }
  if (patch.status === undefined && steps.length > 0 && progress >= maxProgress) {
    assign('status', 'done');
  }

  if (fields.length === 0) return current;
  assign('updated_at', now());
  getDb()
    .prepare(`UPDATE story_events SET ${fields.join(', ')} WHERE id = ?`)
    .run(...values, eventId);

  const updated = getStoryEvent(eventId);
  // 大纲变化后把标题与时间同步到对应的时间轴条目
  if (updated && updated.timelineEventId) {
    updateTimelineEvent(updated.timelineEventId, {
      title: updated.title,
      novelTime: updated.novelTime,
      description: firstParagraph(updated.outline),
    });
  }
  return updated;
}

/**
 * 推进事件进度。
 *
 * 把进度指针前移指定步数，越过末尾时事件自动收尾。
 */
export function advanceStoryEvent(eventId: string, stepsForward = 1): StoryEvent | null {
  const current = getStoryEvent(eventId);
  if (!current) return null;
  const total = current.steps.length;
  const progress = Math.min(total, current.progress + Math.max(0, stepsForward));
  const finished = total > 0 && progress >= total;
  const updated = updateStoryEvent(eventId, {
    progress,
    status: finished ? 'done' : 'writing',
  });
  return updated;
}

/** 删除故事事件，同时清掉它挂载的时间轴条目与查询请求。 */
export function deleteStoryEvent(eventId: string): void {
  const current = getStoryEvent(eventId);
  transact(() => {
    if (current?.timelineEventId) {
      getDb().prepare('DELETE FROM timeline_events WHERE id = ?').run(current.timelineEventId);
    }
    getDb().prepare('DELETE FROM encyclopedia_queries WHERE event_id = ?').run(eventId);
    getDb().prepare('DELETE FROM event_recall_requests WHERE event_id = ?').run(eventId);
    getDb().prepare('DELETE FROM story_events WHERE id = ?').run(eventId);
  });
}

/* ------------------------------------------------- 百科查询与事件调阅 */

interface QueryRow {
  id: string;
  novel_id: string;
  event_id: string | null;
  keyword: string;
  reason: string;
  result: string;
  resolved: number;
  created_at: string;
  updated_at: string;
}

function mapQuery(row: QueryRow): EncyclopediaQuery {
  return {
    id: row.id,
    novelId: row.novel_id,
    eventId: row.event_id,
    keyword: row.keyword,
    reason: row.reason,
    result: row.result,
    resolved: row.resolved === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** 列出某事件下的百科查询请求。 */
export function listEncyclopediaQueries(novelId: string, eventId?: string): EncyclopediaQuery[] {
  const params: unknown[] = [novelId];
  let where = 'WHERE novel_id = ?';
  if (eventId) {
    where += ' AND event_id = ?';
    params.push(eventId);
  }
  const rows = getDb()
    .prepare(`SELECT * FROM encyclopedia_queries ${where} ORDER BY created_at`)
    .all(...params) as QueryRow[];
  return rows.map(mapQuery);
}

/** 记录一条百科查询请求。关键字相同的未完成请求会被合并。 */
export function createEncyclopediaQuery(
  novelId: string,
  input: { keyword: string; eventId?: string | null; reason?: string },
): EncyclopediaQuery {
  const keyword = input.keyword.trim();
  const existing = getDb()
    .prepare(
      `SELECT * FROM encyclopedia_queries
       WHERE novel_id = ? AND keyword = ? AND resolved = 0
         AND COALESCE(event_id, '') = COALESCE(?, '') LIMIT 1`,
    )
    .get(novelId, keyword, input.eventId ?? '') as QueryRow | undefined;
  if (existing) return mapQuery(existing);

  const id = shortId('encq');
  const timestamp = now();
  getDb()
    .prepare(
      `INSERT INTO encyclopedia_queries (id, novel_id, event_id, keyword, reason, result,
         resolved, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, '', 0, ?, ?)`,
    )
    .run(id, novelId, input.eventId ?? null, keyword, input.reason ?? '', timestamp, timestamp);
  return mapQuery(
    getDb().prepare('SELECT * FROM encyclopedia_queries WHERE id = ?').get(id) as QueryRow,
  );
}

/** 回填百科查询结果。 */
export function resolveEncyclopediaQuery(queryId: string, result: string): EncyclopediaQuery | null {
  getDb()
    .prepare('UPDATE encyclopedia_queries SET result = ?, resolved = 1, updated_at = ? WHERE id = ?')
    .run(result, now(), queryId);
  const row = getDb().prepare('SELECT * FROM encyclopedia_queries WHERE id = ?').get(queryId) as
    | QueryRow
    | undefined;
  return row ? mapQuery(row) : null;
}

/** 删除百科查询请求。 */
export function deleteEncyclopediaQuery(queryId: string): void {
  getDb().prepare('DELETE FROM encyclopedia_queries WHERE id = ?').run(queryId);
}

interface RecallRow {
  id: string;
  novel_id: string;
  event_id: string;
  reason: string;
  approved: number;
  created_at: string;
  updated_at: string;
}

/** 列出往期事件调阅请求，附带事件标题便于界面展示。 */
export function listRecallRequests(novelId: string): EventRecallRequest[] {
  const rows = getDb()
    .prepare('SELECT * FROM event_recall_requests WHERE novel_id = ? ORDER BY created_at DESC')
    .all(novelId) as RecallRow[];
  return rows.map((row) => ({
    id: row.id,
    novelId: row.novel_id,
    eventId: row.event_id,
    reason: row.reason,
    approved: row.approved === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    eventTitle: (getDb()
      .prepare('SELECT title FROM story_events WHERE id = ?')
      .get(row.event_id) as { title: string } | undefined)?.title,
  }));
}

/** 记录一条调阅请求。同一事件的请求只保留一条。 */
export function createRecallRequest(
  novelId: string,
  input: { eventId: string; reason?: string },
): EventRecallRequest {
  const existing = getDb()
    .prepare('SELECT * FROM event_recall_requests WHERE novel_id = ? AND event_id = ? LIMIT 1')
    .get(novelId, input.eventId) as RecallRow | undefined;
  if (existing) return listRecallRequests(novelId).find((item) => item.id === existing.id)!;

  const id = shortId('rcq');
  const timestamp = now();
  getDb()
    .prepare(
      `INSERT INTO event_recall_requests (id, novel_id, event_id, reason, approved, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, ?, ?)`,
    )
    .run(id, novelId, input.eventId, input.reason ?? '', timestamp, timestamp);
  return listRecallRequests(novelId).find((item) => item.id === id)!;
}

/** 放行或撤回一条调阅请求。 */
export function approveRecallRequest(requestId: string, approved: boolean): void {
  getDb()
    .prepare('UPDATE event_recall_requests SET approved = ?, updated_at = ? WHERE id = ?')
    .run(approved ? 1 : 0, now(), requestId);
}

/** 删除调阅请求。 */
export function deleteRecallRequest(requestId: string): void {
  getDb().prepare('DELETE FROM event_recall_requests WHERE id = ?').run(requestId);
}
