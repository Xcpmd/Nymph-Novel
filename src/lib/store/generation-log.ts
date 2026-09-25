import fs from 'node:fs';
import path from 'node:path';
import { LOG_DIR } from '../paths';
import { shortId } from '../crypto';
import type { GenerationRun, TaskType } from '../types';

/**
 * 生成请求日志的文件存储。
 *
 * 这类记录是诊断材料，不是小说内容：它一次调用就能有几十 KB 的提示词，
 * 几十条就把数据库撑到几兆，还和作品数据混在一起。
 * 因此改为一条日志一个 txt，落在 data/logs 下，按日期分目录，
 * 既不进小说的库，也不随小说一起搬走。
 *
 * 文件形式也便于直接翻看：出问题时用编辑器打开就能读到完整上下文，
 * 不必先想办法把字段里的长文本导出来。
 */

const SECTION = '──────────────────────────────';

/** 日志条目的字段顺序，解析时按这个顺序读。 */
const HEADER_KEYS = [
  'id',
  'novelId',
  'chapterId',
  'taskType',
  'status',
  'providerId',
  'model',
  'createdAt',
  'updatedAt',
] as const;

/** 把日期转成用于目录名的形式。 */
function datePart(iso: string): string {
  return iso.slice(0, 10);
}

/** 把时间转成用于文件名前缀的形式，冒号在 Windows 上不能做文件名。 */
function timePart(iso: string): string {
  return iso.slice(11, 19).replace(/:/g, '');
}

/** 一条日志的文件名。含小说 id 便于筛选，含记录 id 便于定位。 */
function logFileName(run: Pick<GenerationRun, 'createdAt' | 'novelId' | 'id'>): string {
  return `${timePart(run.createdAt)}-${run.novelId}-${run.id}.txt`;
}

/** 一条日志的完整路径。 */
function logFilePath(run: Pick<GenerationRun, 'createdAt' | 'novelId' | 'id'>): string {
  return path.join(LOG_DIR, datePart(run.createdAt), logFileName(run));
}

/** 序列化一条日志。分节书写，人工阅读与程序解析都方便。 */
function serialize(run: GenerationRun): string {
  const lines: string[] = [
    ...HEADER_KEYS.map((key) => `${key}: ${String(run[key] ?? '')}`),
    '',
    `${SECTION}\n请求参数\n${SECTION}`,
    run.requestJson || '{}',
    '',
    `${SECTION}\n发送给模型的消息\n${SECTION}`,
    run.promptText || '（无）',
    '',
    `${SECTION}\n生成结果（中断时保留已产出的部分）\n${SECTION}`,
    run.partialText || '（无）',
    '',
    `${SECTION}\n用量\n${SECTION}`,
    run.usageJson || '{}',
  ];
  if (run.error) {
    lines.push('', `${SECTION}\n错误\n${SECTION}`, run.error);
  }
  return lines.join('\n');
}

/** 解析一条日志文本。 */
function parse(text: string): Partial<GenerationRun> {
  const result: Partial<GenerationRun> = {};
  const grab = (name: string) => {
    const match = new RegExp(`^${name}: (.*)$`, 'mu').exec(text);
    return match ? match[1] : '';
  };
  result.id = grab('id');
  result.novelId = grab('novelId');
  result.chapterId = grab('chapterId') || null;
  result.taskType = grab('taskType') as TaskType;
  result.status = grab('status') as GenerationRun['status'];
  result.providerId = grab('providerId') || null;
  result.model = grab('model');
  result.createdAt = grab('createdAt');
  result.updatedAt = grab('updatedAt');

  /** 取某一节的内容，节名之后到下一个分隔标题之间。 */
  const section = (title: string): string => {
    const marker = `${SECTION}\n${title}\n${SECTION}\n`;
    const start = text.indexOf(marker);
    if (start < 0) return '';
    const from = start + marker.length;
    const next = text.indexOf(`\n${SECTION}`, from);
    return (next < 0 ? text.slice(from) : text.slice(from, next)).trim();
  };
  const value = (title: string) => {
    const raw = section(title);
    return raw === '（无）' ? '' : raw;
  };
  result.requestJson = value('请求参数') || '{}';
  result.promptText = value('发送给模型的消息');
  result.partialText = value('生成结果（中断时保留已产出的部分）');
  result.usageJson = value('用量') || '{}';
  result.error = value('错误');
  return result;
}

/** 确保日志目录存在。 */
function ensureLogDir(): string {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  return LOG_DIR;
}

/** 写入一条日志，覆盖同名文件。 */
function writeLog(run: GenerationRun): void {
  const file = logFilePath(run);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, serialize(run), 'utf8');
}

/** 创建一条日志，返回记录 id。 */
export function createLog(input: {
  novelId: string;
  chapterId?: string | null;
  taskType: TaskType;
  providerId?: string | null;
  model?: string;
  request?: unknown;
  promptText?: string;
}): string {
  const id = shortId('run');
  const timestamp = new Date().toISOString();
  writeLog({
    id,
    novelId: input.novelId,
    chapterId: input.chapterId ?? null,
    taskType: input.taskType,
    providerId: input.providerId ?? null,
    model: input.model ?? '',
    status: 'running',
    requestJson: JSON.stringify(input.request ?? {}),
    promptText: input.promptText ?? '',
    partialText: '',
    usageJson: '',
    error: '',
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  return id;
}

/** 找到某条日志的文件路径。 */
function findLogFile(runId: string): string | null {
  const root = ensureLogDir();
  for (const day of fs.readdirSync(root)) {
    const dir = path.join(root, day);
    if (!fs.statSync(dir).isDirectory()) continue;
    const hit = fs.readdirSync(dir).find((name) => name.includes(runId));
    if (hit) return path.join(dir, hit);
  }
  return null;
}

/** 读取一条日志。 */
export function readLog(runId: string): GenerationRun | null {
  const file = findLogFile(runId);
  if (!file) return null;
  try {
    return parse(fs.readFileSync(file, 'utf8')) as GenerationRun;
  } catch {
    return null;
  }
}

/** 更新一条日志。 */
export function updateLog(
  runId: string,
  patch: {
    status?: GenerationRun['status'];
    partialText?: string;
    error?: string;
    promptText?: string;
    usageJson?: string;
  },
): void {
  const current = readLog(runId);
  if (!current) return;
  // 记录本身按创建时间命名，更新不会改文件名，因此时间戳只影响内容
  writeLog({ ...current, ...patch, updatedAt: new Date().toISOString() });
}

/**
 * 列出某部小说最近的日志。
 *
 * 文件名自带时间前缀，因此按名字倒序即按时间倒序，
 * 只需读最近若干天的目录，不必扫描全部历史。
 */
export function listLogs(novelId: string, limit = 30): GenerationRun[] {
  const root = ensureLogDir();
  const days = fs
    .readdirSync(root)
    .filter((name) => fs.statSync(path.join(root, name)).isDirectory())
    .sort()
    .reverse();

  const found: GenerationRun[] = [];
  for (const day of days) {
    const dir = path.join(root, day);
    const files = fs
      .readdirSync(dir)
      // 文件名形如 143012-{novelId}-{runId}.txt，用小说 id 直接筛掉无关日志
      .filter((name) => name.endsWith('.txt') && name.includes(`-${novelId}-`))
      .sort()
      .reverse();
    for (const name of files) {
      try {
        const run = parse(fs.readFileSync(path.join(dir, name), 'utf8')) as GenerationRun;
        if (run.id) found.push(run);
      } catch {
        // 单条损坏不影响其余日志
      }
      if (found.length >= limit) return found;
    }
  }
  return found;
}

/** 清理超过指定天数的日志目录。 */
export function pruneLogs(olderThanDays = 14): number {
  const root = ensureLogDir();
  const cutoff = new Date(Date.now() - olderThanDays * 86400_000).toISOString().slice(0, 10);
  let removed = 0;
  for (const day of fs.readdirSync(root)) {
    // 目录名就是日期，早于截止日的整目录删掉
    if (day >= cutoff) continue;
    const dir = path.join(root, day);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const name of fs.readdirSync(dir)) {
      fs.unlinkSync(path.join(dir, name));
      removed += 1;
    }
    fs.rmdirSync(dir);
  }
  return removed;
}
