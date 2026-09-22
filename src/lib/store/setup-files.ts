import fs from 'node:fs';
import path from 'node:path';
import { novelDir, resolveInsideNovel } from '../paths';

/**
 * 小说设定与规则的 Markdown 文件存储。
 *
 * 目录结构固定为 novel/{novelId}/setup/{文件名}.md。
 * 正文实体落在文件系统上，数据库只作为兜底与索引，
 * 用户可以直接用任意编辑器打开这些文件阅读或修改。
 *
 * 磁盘上不出现任何中文路径。中文目录与文件名在跨平台迁移、
 * 压缩打包、命令行工具处理时容易遇到编码问题，界面展示需要的
 * 中文标题由调用方自行翻译，存储层只认拉丁字符。
 */

/** 设定目录名，早期版本使用中文。 */
const SETUP_DIR = 'setup';
const LEGACY_SETUP_DIR = '设定与规则';

/** 设定与规则支持的文本项，文件名固定，键名与接口字段一致。 */
export const SETUP_FILES = {
  worldview: 'worldview.md',
  setting: 'setting.md',
  outlineOverview: 'outline-overview.md',
  endingPlan: 'ending-plan.md',
  styleSample: 'style-sample.md',
} as const;

export type SetupFileKey = keyof typeof SETUP_FILES;

/**
 * 历史中文文件名到现行拉丁文件名的映射。
 *
 * 早期版本把设定文件写成 世界观.md 这类中文名，读取时要能认出，
 * 否则升级后旧内容会全部读不到。
 */
const LEGACY_SETUP_FILES: Record<string, SetupFileKey> = {
  '世界观.md': 'worldview',
  '设定.md': 'setting',
  '故事大纲.md': 'outlineOverview',
  '结局规划.md': 'endingPlan',
  '文风样例.md': 'styleSample',
};

/** 判断某个键是否属于设定文件。 */
export function isSetupFileKey(key: string): key is SetupFileKey {
  return Object.prototype.hasOwnProperty.call(SETUP_FILES, key);
}

/** 设定目录的绝对路径。 */
function setupDir(novelId: string): string {
  return path.join(novelDir(novelId), SETUP_DIR);
}

/** 历史中文设定目录的绝对路径。 */
function legacySetupDir(novelId: string): string {
  return path.join(novelDir(novelId), LEGACY_SETUP_DIR);
}

/**
 * 计算某个设定项的绝对路径。
 *
 * 文件名取自固定映射表，不接受外部传入，因此不存在路径穿越风险；
 * 仍然统一走 resolveInsideNovel 做一次校验，保持与正文存储一致的安全边界。
 */
function setupFilePath(novelId: string, key: SetupFileKey): string {
  return resolveInsideNovel(novelId, `${SETUP_DIR}/${SETUP_FILES[key]}`);
}

/**
 * 读取一个设定文件。
 *
 * 先找现行拉丁文件名，找不到再回溯历史中文目录与中文文件名，
 * 让升级前的存量内容照旧可读。两处都不存在时返回 null，
 * 交由调用方决定是否回退到数据库。
 */
export function readSetupFile(novelId: string, key: SetupFileKey): string | null {
  const absolute = setupFilePath(novelId, key);
  if (fs.existsSync(absolute)) return fs.readFileSync(absolute, 'utf8');

  const legacyDir = legacySetupDir(novelId);
  if (fs.existsSync(legacyDir)) {
    for (const [fileName, fileKey] of Object.entries(LEGACY_SETUP_FILES)) {
      if (fileKey !== key) continue;
      const candidate = path.join(legacyDir, fileName);
      if (fs.existsSync(candidate)) return fs.readFileSync(candidate, 'utf8');
    }
  }
  return null;
}

/**
 * 写入一个设定文件，自动创建目录。
 *
 * 内容为空时也照常写入，让文件存在本身成为「这一项已初始化」的信号；
 * 判断是否覆盖丢内容的责任在调用方，不在这里做取舍。
 */
export function writeSetupFile(novelId: string, key: SetupFileKey, content: string): void {
  const absolute = setupFilePath(novelId, key);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, content, 'utf8');
}

/** 确保设定目录存在，便于用户在资源管理器中直接看到。 */
export function ensureSetupDir(novelId: string): void {
  fs.mkdirSync(setupDir(novelId), { recursive: true });
}

/** 列出小说目录下实际存在的设定文件，供导入导出与诊断使用。 */
export function listSetupFiles(novelId: string): Array<{ key: SetupFileKey; fileName: string }> {
  const present = new Set<string>();
  const dir = setupDir(novelId);
  if (fs.existsSync(dir)) {
    for (const name of fs.readdirSync(dir)) present.add(name);
  }
  const legacyDir = legacySetupDir(novelId);
  if (fs.existsSync(legacyDir)) {
    for (const name of fs.readdirSync(legacyDir)) present.add(name);
  }
  return (Object.keys(SETUP_FILES) as SetupFileKey[])
    .filter(
      (key) =>
        present.has(SETUP_FILES[key]) ||
        Object.entries(LEGACY_SETUP_FILES).some(([name, k]) => k === key && present.has(name)),
    )
    .map((key) => ({ key, fileName: SETUP_FILES[key] }));
}
