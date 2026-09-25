# Nymph Novel 项目长期约定

## 项目定位

AI 网络小说生成与管理工具。单用户、纯本地运行，不部署到服务器，不涉及权限体系。
全部数据保存在项目根目录的 `data` 目录，该目录已被版本库忽略。

## 架构约定

- 结构化数据进 SQLite，正文只进 Markdown 文件，两者不混用。
- **推理模型的流式增量必须同时读 `content` 与 `reasoning_content`。** 实测 `deepseek-flash` 的帧为 `{"delta":{"content":null,"reasoning_content":"..."}}`，`content` 在全思考阶段恒为 `null`。只读 `content` 会让整条流被静默丢弃，而 `usage` 与结束信号照常返回，上层于是判定成功——表现就是「显示生成完成但内容区一片空白，token 已烧掉」。解析入口是 `client.ts` 的 `parseStreamLine`，两路增量分别以 `delta` 与 `reasoning` 事件下发。
- **`finish_reason: "length"` 必须当成异常处理，不能走完成分支。** 推理模型会把 `max_tokens` 全花在思考上（`completion_tokens_details.reasoning_tokens` 等于总量），正文一字未写就被截断。服务端据此发 `truncated` 事件，`useGeneration` 在正文为空时强制置为 `error`。
- **`useGeneration.start` 返回 `{ text, error, truncated }`**，调用方要在生成结束后立即取正文的（例如连续生成）必须用返回值，读 `generation.text` 拿到的是渲染闭包里的旧 state。
- 连续生成章节必须**串行**：后续章节的「上一章正文」层依赖前一章已落库，并发发出时每章都指向同一章，内容会互相重叠。
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
- **百科条目只存身份信息，正文按版本保存在 `encyclopedia_versions`**。同名再次登记是追加版本而非新建条目，只有 `is_active = 1` 的那一版会进入模型上下文，因此检索与上下文层无需关心版本。
- **章节废案把原位置存在 `original_index_no`，不要靠 `index_no` 反推**。早期实现用 `-(100000 + 原序号)` 编码，同卷两次废同一位置会撞唯一约束导致失败。
- **废案章的 `index_no` 必须落在 `<= -SCRAPPED_INDEX_OFFSET` 的负数保留区**，与正常章的正序号彻底隔离。只让正常章参与重排是不够的：废案章若停在正数区，重排写回时就会压在目标位置上撞唯一约束。`renumberChapters` 现在把两组一起搬移，迁移 v11 负责修正历史数据。
- **直接改库后要 `wal_checkpoint(TRUNCATE)` 再验证**，否则读到的仍是旧快照，会误判成改动没生效。
- 阅读页在 `/novels/{novelId}/read`，三种模式共用同一份正文数据。分页靠 CSS 多列加横向位移，列宽与步长按视口实测写入 CSS 变量；滚动模式把相邻章拼成连续文档。
- **判断客户端渲染的页面是否正常，curl 会误判**：服务端只输出加载态。要用无头浏览器 `--dump-dom` 加 `--virtual-time-budget` 取渲染后的 DOM。
- **批量调整章节文件位置必须走 `relocateChapterFiles`**。按顺序逐个改名会互相覆盖（后者常占着前者的目标路径），先统一改到卷目录下的临时名再落到目标位置。
- 章节相关接口的更新分支统一返回 `{ chapter, chapters }`，不要有分支返回裸 chapter，否则调用方与测试都要做特例判断。
- 工作台流程：方向（手写或 AI）一律先进入「检视并修改故事大纲」，不要跳过大纲直接建事件，否则推进步骤缺骨架。大纲到章节的转换是第二步里的显式按钮，不自动执行。
- **提示词模板里的每个 `{{变量}}` 都必须在服务端 `vars` 里有对应项**，漏掉只会静默变空，不报错。改模板或改 `vars` 时两边一起核对；不要用「把值拼进另一个变量」代偿，那会让内容落在错误的段落里。方向的缺失就是这么藏了很久。
- 模型输出的格式问题一律降级为提示，不拦截：大纲缺步骤就退回去从正文推导，再不行也照常落库并提示，不丢弃用户已生成的内容。
- 工作台各步骤共用同一个生成钩子，`generation.text` 会跨步骤残留。凡是呈现特定步骤产物的地方，都要先按 `generation.meta.taskType` 判断来源，正文区与字数统计尤其如此。
- **`buildContext` 的层过滤只在 `push` 一处把关**：各模板变量都从层内容取值，跳过某层等于清空对应变量，不必逐个清理变量表。新增层时要同时补 `CONTEXT_LAYER_CATALOG`，两处的 key 必须一致。
- **`preferences` 的 updateSelf 有字段白名单**，新增偏好字段必须同步加进那个列表，否则前端保存了也不生效，且表现为静默失败。
- **页面内的未保存输入要走 `useDraftState` 缓存**，客户端路由切换会卸载组件，普通 state 里的内容直接丢失。key 带小说 id 与条目 id，加载数据走 `hydrate` 而不是 setValue，提交成功后调 clear。弹窗表单用 `useFormDraft`。
- **卸载时不要只 clearTimeout**：防抖保存的定时器被清掉，那一次改动就永远留在内存里，而界面看不出异常。应当立刻发出保存。
- 迁移结构提供 `run` 钩子用于「需要先判断再执行」的步骤，例如加列前先查 `PRAGMA table_info`。SQLite 的 ALTER TABLE ADD COLUMN 在列已存在时会直接报错，而迁移可能被多个版本的程序各跑一次。
- **上下文超出预算不再静默裁剪**。`buildContext` 的 `allowTrim` 默认为真，未确认时若发生裁剪，服务端只回一条 `budget-exceeded` 事件且不创建运行记录、不调用模型，由界面确认后带 `confirmOverBudget` 重发。新增生成入口时记得放 `BudgetConfirmPrompt`。
- `generation_runs` 同时承担请求日志职责，`prompt_text` 存实际发出的完整消息，`usage_json` 存本次用量。新增调用模型的地方都要把这两项写进去，否则日志面板会缺内容。
- **发言标记的渲染走 rehype 插件，不能靠 Markdown 行内语法**。私有区字符定界的文本只有在 `rehypeTalkMarkers` 里转成 `span[data-chara]` 才会被渲染，该插件必须挂在 `rehype-sanitize` 之前。行内代码方案已废弃，原因是不能跨行且内容里的反引号会破坏定界。
- 角色发言配色来自 `buildSpeakerColors`，同时登记角色名与全部别名。新增渲染正文的组件时，必须把 `speakers` 与 `showSpeakerName` 传进 `MarkdownView`，否则会静默回落到名称哈希取色，图鉴里配的颜色看起来像没生效。
- **组件渲染层的缺陷挡不住纯函数测试**。涉及最终 HTML 的功能，用 `renderToStaticMarkup` 渲染组件断言输出，测试文件放在组件旁并以 `.test.ts` 命名，内部用 `createElement` 调用。

## 界面约定

- 全部界面文本集中在 `src/lib/i18n/zh.ts`，组件内不写死中文。
- 新增语言的方式是复制 `zh.ts` 并登记到 `src/lib/i18n/index.ts` 的语言表。
- 文案不使用括号做补充解释，全部以规范化叙述表达。
- 主题色相通过 CSS 变量 `--accent-hue` 驱动。
- **视觉基调用玻璃拟态**：模块一律用 `.card` 或 `.glass`，三件套缺一不可——半透明底、`backdrop-filter` 模糊、内侧高光描边。只做前两项会发灰发脏。不要再用不透明的 `bg-surface-raised` 覆盖卡片背景。
- 背景是 `FluidBackdrop` 的动态流体光斑，色相由 `--accent-hue` 派生。调色时守住低饱和与低透明度，浓度一高立刻显廉价。
- 浅色主题的文字阴影必须以暗色为主，白色阴影在白底上等于没有。
- 组件样式统一使用 `src/app/globals.css` 中的 `btn`、`card`、`input`、`chip`、`nav-item`、`dropdown-panel` 等基础类。
- **全屏浮层必须用 Portal 渲染到 body**。页面主体带 `relative z-10` 会形成层叠上下文，就地渲染的固定层会被顶部导航盖住。
- 下拉一律用 `primitives` 里的 Select，不要用原生 select，原生展开列表由系统绘制，无法参与这套视觉。
- 书架用 `.cover-card` 竖版封面卡，宽高比 2:3，常态只呈现封面，元信息收在悬浮层里。放大效果作用于媒体元素而非容器，外框尺寸不能变。
- **悬停状态要挂在外层容器上**。卡片里的操作按钮与封面链接互为兄弟节点，把 `:hover` 挂在链接上会让按钮在指针移过去时提前消失；统一用外层容器承接，并配 `:focus-within` 照顾键盘。

## 排版约定

- **全站字号由根字号驱动**。`html` 的 `font-size` 取 `calc(100% * var(--ui-font-scale))`，倍率来自设置项 `uiFontScale`，默认 1.15。新增样式一律用 rem，不要写死 px，否则不跟随界面字号缩放。
- `body` 的字号也必须是相对单位。固定像素会覆盖根字号的继承，导致没有显式设字号的文字完全不参与缩放。
- 阅读区的 `--reader-font-size` 与 `--reader-width` 是独立变量，不随界面字号变化。
- 首屏渲染要用的偏好随服务端设置以 inline style 直接输出在 `html` 上，避免客户端补设造成跳动，主题与界面字号都按这个方式处理。

## 数据安全约定

- **删除文件一律走 `moveToTrash`**，归档到 `public/.trash`，不直接抹除。空目录清理可以照常进行，空目录没有内容可恢复。
- 回收目录会被静态服务暴露，仅适用于本机单用户场景。

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
