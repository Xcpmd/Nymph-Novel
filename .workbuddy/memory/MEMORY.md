# Nymph Novel 项目长期约定

## 项目定位

AI 网络小说生成与管理工具。单用户、纯本地运行，不部署到服务器，不涉及权限体系。
全部数据保存在项目根目录的 `data` 目录，该目录已被版本库忽略。

## 架构约定

- 结构化数据进 SQLite，正文只进 Markdown 文件，两者不混用。
- **磁盘路径一律使用拉丁字符，禁止出现中文。** 中文目录名在跨平台迁移、压缩打包、命令行工具处理时容易遇到编码问题，界面展示需要的中文由 i18n 层翻译。
- 正文路径固定为 `data/novel/{novelId}/vol-XXX/ch-YYY/content.md`，设定文件固定为 `data/novel/{novelId}/setup/{key}.md`，全部由 `src/lib/paths.ts` 与 `src/lib/store/setup-files.ts` 统一生成，任何地方都不许硬编码目录名。
- 历史中文路径的兼容由 `legacyVolumeDirName`、`legacyChapterRelPath`、`normalizeContentRelPath` 一族函数承担。磁盘上的旧目录由 `migrateChapterDirsOnDisk` 在**每次启动**时幂等搬迁，不能只在迁移循环里跑一次，否则版本号推进后新出现的旧目录再也搬不动。
- 章节序号变化时，数据库序号与磁盘目录必须同步，统一走 `renumberChapters` 与 `renumberVolumes`。
- 数据库迁移以 `user_version` 为版本号顺序执行，只在 `src/lib/db/schema.ts` 末尾追加，不修改已发布版本。
- 数据访问层集中在 `src/lib/repo`，接口层只做参数校验与分发，不直接写 SQL。
- 小说内资源统一走 `src/lib/api/resources.ts` 的资源注册表，集合地址负责列表与新建，条目地址负责读取、更新与删除，单例配置类资源用 `updateSelf`。
- **`preferences` 响应中的 `preferences` 字段不得包含文本键**，文本内容只走 `texts` 字段。`getNovelPreferences` 读取的是 `novel_settings` 整张表，若不过滤文本键，返回的空串会在前端展开时覆盖用户输入，造成「保存后刷新即消失」。新增文本型配置时必须同步维护 `isNovelTextKey`。
- **模型在 JSON 模式下普遍会把数组再包一层**，实测出现过 `{directions:[...]}`、`{type:'json_object',directions:[...]}`、`{type:'json_object',content:{directions:[...]}}` 等形态。凡是消费模型结构化输出的地方，都必须先经 `normalizeOptionList` 或 `extractRecordList` 归一，直接 `Array.isArray` 判断会把整批数据静默丢光。排查模型真实返回时读 `generation_runs` 表的 `partial_text`。
- `story-events` 的 create 在未传 `steps` 时，会用 `deriveStepsFromOutline` 从大纲文本推导推进步骤，供手写大纲直接建成事件使用。
- **发言标记的渲染走 rehype 插件，不能靠 Markdown 行内语法**。私有区字符定界的文本只有在 `rehypeTalkMarkers` 里转成 `span[data-chara]` 才会被渲染，该插件必须挂在 `rehype-sanitize` 之前。行内代码方案已废弃，原因是不能跨行且内容里的反引号会破坏定界。
- 角色发言配色来自 `buildSpeakerColors`，同时登记角色名与全部别名。新增渲染正文的组件时，必须把 `speakers` 与 `showSpeakerName` 传进 `MarkdownView`，否则会静默回落到名称哈希取色，图鉴里配的颜色看起来像没生效。
- **组件渲染层的缺陷挡不住纯函数测试**。涉及最终 HTML 的功能，用 `renderToStaticMarkup` 渲染组件断言输出，测试文件放在组件旁并以 `.test.ts` 命名，内部用 `createElement` 调用。

## 界面约定

- 全部界面文本集中在 `src/lib/i18n/zh.ts`，组件内不写死中文。
- 新增语言的方式是复制 `zh.ts` 并登记到 `src/lib/i18n/index.ts` 的语言表。
- 文案不使用括号做补充解释，全部以规范化叙述表达。
- 主题色相通过 CSS 变量 `--accent-hue` 驱动，界面整体保持黑白灰基调。
- 组件样式统一使用 `src/app/globals.css` 中的 `btn`、`card`、`input`、`chip`、`nav-item` 等基础类。

## 安全约定

- API Key 一律以 AES-256-GCM 密文入库，只有服务端调用模型时解密，任何返回给浏览器的数据都不得包含明文。
- Markdown 渲染不启用原始 HTML 解析，并叠加白名单清洗。
- 所有文件操作都要经过 `resolveInsideNovel` 校验，阻止路径越界。

## 校验流程

提交前依次运行 `npm run typecheck`、`npm run lint`、`npm run test`、`npm run check:i18n`，
或直接运行 `npm run verify`。涉及接口改动时另外运行 `npm run smoke`，需要先启动本地服务。

## 环境注意

- 依赖版本有硬约束：TypeScript 必须为 6.x，ESLint 必须为 9.x，否则类型感知与 React 插件无法加载。
- better-sqlite3 为原生模块，已在 `next.config.ts` 的 `serverExternalPackages` 中声明，不要移除。
