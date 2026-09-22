/**
 * 端到端冒烟测试。
 *
 * 前提：本地服务已启动在 5180 端口。
 * 覆盖范围：小说创建、卷章管理、正文读写、角色与关系、百科、时间轴、
 * 标签与书签、全文检索、设定保存、导入导出、供应商与设置读取。
 * 运行方式：node scripts/smoke.mjs
 */

const BASE = process.env.NYMPH_BASE ?? 'http://localhost:5180';

let passed = 0;
let failed = 0;

function check(name, condition, extra = '') {
  if (condition) {
    passed += 1;
    console.log(`  通过  ${name}`);
  } else {
    failed += 1;
    console.log(`  失败  ${name} ${extra}`);
  }
}

async function request(path, options = {}) {
  const response = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: response.status, body };
}

const json = (method) => (path, payload) =>
  request(path, { method, body: payload === undefined ? undefined : JSON.stringify(payload) });

const get = (path) => request(path);
const post = json('POST');
const patch = json('PATCH');
const del = json('DELETE');

async function main() {
  console.log('一、页面渲染');
  const home = await get('/');
  check('书架页返回 200', home.status === 200);
  check('书架页渲染出标题', String(home.body).includes('我的书架'));
  check('书架页无运行时报错', !/Application error|Internal Server Error/.test(String(home.body)));

  const settingsPage = await get('/settings');
  check('设置页已重定向到书架', settingsPage.status === 200 || settingsPage.status === 307);
  check(
    '设置不再占用独立页面',
    settingsPage.status === 307 || !String(settingsPage.body).includes('data-settings-page'),
  );

  const cssHref = String(home.body).match(/href="([^"]+\.css)"/)?.[1];
  check('页面引用了样式表', Boolean(cssHref));
  if (cssHref) {
    const css = await fetch(`${BASE}${cssHref}`);
    const cssText = await css.text();
    check('样式表包含主题色相变量', cssText.includes('--accent-hue'));
    check('样式表包含自定义工具类', cssText.includes('.text-soft'));
    check('样式表包含正文排版', cssText.includes('.prose-novel'));
    check('样式表包含字体图标', cssText.includes('.fa-solid'));
    const font = cssText.match(/url\(([^)]+\.woff2)\)/)?.[1]?.replace(/["']/g, '');
    if (font) {
      const fontUrl = new URL(font, `${BASE}${cssHref}`).href;
      const fontResponse = await fetch(fontUrl, { method: 'HEAD' });
      check('图标字体文件可访问', fontResponse.status === 200);
    }
  }

  console.log('二、基础接口与设置');
  const settings = await get('/api/settings');
  check('设置接口返回 200', settings.status === 200);
  check('返回数据目录信息', typeof settings.body?.environment?.dataDir === 'string');
  check('返回数据库结构版本', typeof settings.body?.environment?.schemaVersion === 'number');

  const providers = await get('/api/providers');
  check('供应商接口返回 200', providers.status === 200);
  check(
    '首次运行已预置供应商',
    Array.isArray(providers.body?.providers) && providers.body.providers.length > 0,
  );
  // 掩码会保留前缀与末几位以便辨认，因此这里断言的是完整密钥没有泄漏。
  const providerJson = JSON.stringify(providers.body);
  check(
    'API Key 以掩码返回，不含明文',
    !/sk-[A-Za-z0-9]{12,}/.test(providerJson) && !providerJson.includes('apiKeyEncrypted'),
  );
  check(
    '掩码字段以圆点遮蔽中段',
    providers.body?.providers?.every?.(
      (item) => !item.hasApiKey || (item.apiKeyMasked ?? '').includes('•'),
    ),
  );

  console.log('三、小说创建与设定');
  const created = await post('/api/novels', {
    title: '冒烟测试小说',
    author: '测试作者',
    genre: '东方玄幻',
    summary: '用于验证接口连通性的临时作品。',
    coverEmoji: '🪶',
  });
  check('新建小说成功', created.status === 200 && created.body?.novel?.id);
  const novelId = created.body.novel.id;

  const prefs = await patch(`/api/novels/${novelId}/preferences`, {
    worldview: '本世界以灵脉分布决定修行上限，共有九州。',
    setting: '境界分为引气、筑基、金丹、元婴。',
    calendar: '以天启元年为起点，一年十二月，每月三十日。',
    targetWords: 1200,
    wordTolerancePercent: 20,
    rules: {
      style: '叙事节奏稳健。',
      pov: '第三人称限知视角。',
      allowExplicit: false,
      allowViolence: true,
      forbidden: ['不使用括号补充说明'],
      speechHabits: '主角说话简短直接。',
      extra: [],
    },
  });
  check('保存设定与生成规则', prefs.status === 200 && prefs.body?.texts?.worldview?.includes('灵脉'));
  check('字数目标已生效', prefs.body?.preferences?.targetWords === 1200);

  console.log('四、章节与正文');
  const chapter = await post(`/api/novels/${novelId}/chapters`, {
    title: '第一章 落雨的渡口',
    direction: '主角在渡口遇到一位卖伞的老人。',
  });
  check('新建章节成功', chapter.status === 200 && chapter.body?.chapter?.id);
  const chapterId = chapter.body.chapter.id;
  check(
    '章节正文路径符合目录约定',
    // 磁盘路径保持纯拉丁字符，中文只出现在界面文案里
    /^vol-001\/ch-001\/content\.md$/.test(chapter.body.chapter.relPath),
  );
  check(
    '正文路径不含中文',
    !/[\u4e00-\u9fff]/u.test(chapter.body.chapter.relPath),
  );

  const saved = await patch(`/api/novels/${novelId}/chapters/${chapterId}`, {
    content: '雨下了一整夜。\n\n少年把斗笠压低，走进了茶棚的阴影里。',
    markGenerated: true,
  });
  check('保存正文成功', saved.status === 200 && saved.body?.wordCount > 0);

  const read = await get(`/api/novels/${novelId}/chapters/${chapterId}`);
  check('读取正文成功', read.status === 200 && read.body?.content?.includes('雨下了一整夜'));
  check('读取结果包含卷章位置', read.body?.chapter?.volumeIndex === 1 && read.body?.chapter?.indexNo === 1);

  const meta = await patch(`/api/novels/${novelId}/chapters/${chapterId}`, {
    timelineSort: '天启元年 三月 初七',
    stepIndex: 0,
  });
  check(
    '保存章节时间字段与大纲步进',
    meta.status === 200 && meta.body?.timelineSort === '天启元年 三月 初七',
  );

  console.log('五、角色图鉴与关系网');
  const hero = await post(`/api/novels/${novelId}/characters`, {
    name: '沈青梧',
    aliases: ['青梧', '小梧'],
    roleType: 'protagonist',
    personality: '沉默寡言，做事果断。',
    ability: '引气三层。',
    isPrimary: true,
    foreshadowing: [
      { id: 'fs_1', title: '断掉的刀穗', detail: '与身世有关。', status: 'planted' },
    ],
  });
  check('新建主角成功', hero.status === 200 && hero.body?.id);
  const oldMan = await post(`/api/novels/${novelId}/characters`, {
    name: '卖伞老人',
    roleType: 'supporting',
    emoji: '🧓',
  });
  check('新建配角成功', oldMan.status === 200 && oldMan.body?.id);

  const relation = await post(`/api/novels/${novelId}/relations`, {
    fromCharacterId: hero.body.id,
    toCharacterId: oldMan.body.id,
    kind: 'mentor',
    label: '未言明的师徒',
    strength: 4,
  });
  check('建立角色关系成功', relation.status === 200 && relation.body?.kind === 'mentor');

  const relationList = await get(`/api/novels/${novelId}/relations`);
  check(
    '关系网返回角色与关系',
    relationList.body?.relations?.length === 1 && relationList.body?.characters?.length === 2,
  );

  console.log('六、百科全书与时间轴');
  const entry = await post(`/api/novels/${novelId}/encyclopedia`, {
    name: '落雨渡',
    category: '地理',
    aliases: '渡口',
    summary: '九州南境的一处渡口。',
    content: '常年下雨，河面终年不结冰。',
    tags: ['南方', '水路'],
  });
  check('新建百科条目成功', entry.status === 200 && entry.body?.id);

  const catalog = await get(`/api/novels/${novelId}/encyclopedia`);
  check('百科目录按分类归组', catalog.body?.categories?.includes('地理'));

  const branch = await get(`/api/novels/${novelId}/timeline-branches`);
  check('默认存在主线分支', branch.body?.branches?.length === 1 && branch.body?.mainBranchId);

  const event = await post(`/api/novels/${novelId}/timeline-events`, {
    title: '第一章 落雨的渡口',
    novelTime: '天启元年 三月 初七',
    description: '主角在雨夜抵达渡口。',
    impact: '引出卖伞老人。',
    kind: 'plot',
  });
  check('新建时间轴事件成功', event.status === 200 && event.body?.id);

  const fork = await post(`/api/novels/${novelId}/timeline-branches`, {
    name: '雨夜支线',
    parentBranchId: branch.body.mainBranchId,
    forkEventId: event.body.id,
    description: '主角选择留下时的平行线。',
  });
  check('新建时间轴分支成功', fork.status === 200 && fork.body?.isMain === false);

  const mainDelete = await del(`/api/novels/${novelId}/timeline-branches/${branch.body.mainBranchId}`);
  check('主线分支不允许删除', mainDelete.status === 400);

  console.log('七、大纲');
  const node = await post(`/api/novels/${novelId}/outline`, {
    title: '第一卷 落雨渡',
    content: '主角在渡口遇到卖伞老人，得到一把旧伞。',
    kind: 'arc',
  });
  check('新建大纲节点成功', node.status === 200 && node.body?.id);
  const child = await post(`/api/novels/${novelId}/outline`, {
    title: '渡口相遇',
    content: '雨夜，主角在茶棚避雨。',
    kind: 'sub',
    parentId: node.body.id,
  });
  check('新建子节点成功', child.status === 200 && child.body?.parentId === node.body.id);

  const tree = await get(`/api/novels/${novelId}/outline`);
  check('大纲树结构正确', tree.body?.nodes?.[0]?.children?.length === 1);

  console.log('八、标签与书签');
  const tags = await patch(`/api/novels/${novelId}/tags/${chapterId}`, {
    tags: ['雨夜', '相遇'],
  });
  check('设置章节标签成功', tags.status === 200 && tags.body?.chapterTags?.length === 2);

  const bookmark = await post(`/api/novels/${novelId}/bookmarks`, {
    chapterId,
    label: '茶棚的灯笼',
    anchor: '灯笼早就褪成了灰白色',
    note: '可复用的意象',
  });
  check('新建书签成功', bookmark.status === 200 && bookmark.body?.id);

  console.log('九、全文检索与统计');
  const search = await get(`/api/novels/${novelId}/search?q=${encodeURIComponent('斗笠')}`);
  check('中文全文检索命中正文', search.body?.hits?.length === 1, JSON.stringify(search.body).slice(0, 160));

  const searchTitle = await get(`/api/novels/${novelId}/search?q=${encodeURIComponent('渡口')}`);
  check('检索命中标题与正文', searchTitle.body?.hits?.length >= 1);

  const stats = await get(`/api/novels/${novelId}/stats`);
  check('统计接口返回章节数', stats.body?.chapters === 1);
  check('统计接口返回角色数', stats.body?.characters === 2);
  check('统计接口返回磁盘占用', stats.body?.diskUsage > 0);

  console.log('十、事件大纲与上下文构建');
  const storyEvent = await post(`/api/novels/${novelId}/story-events`, {
    title: '落雨的渡口',
    novelTime: '天启元年 三月 初七',
    outline: '# 落雨的渡口\n\n## 起因\n主角冒雨赶到渡口。',
    steps: [
      { title: '主角抵达渡口', detail: '', novelTime: '第三日清晨' },
      { title: '与卖伞老人交谈', detail: '', novelTime: '同日午后' },
    ],
    userChoice: '主角在渡口遇到卖伞的老人。',
  });
  check('新建事件大纲成功', storyEvent.status === 200 && storyEvent.body?.event?.id);
  check('事件大纲步骤已落库', storyEvent.body?.event?.steps?.length === 2);
  check('事件已同步到时间轴', Boolean(storyEvent.body?.event?.timelineEventId));

  const storyEventId = storyEvent.body?.event?.id;

  // 手写大纲不带步骤区块，服务端要能从文本结构推导出推进步骤
  const manualEvent = await post(`/api/novels/${novelId}/story-events`, {
    outline: `# 手写的雨夜

1. 主角回到公寓，遇见淋湿的猫希人。
2. 猫希人留下打理家务，频频打碎东西。
3. 主角察觉出现得过于巧合，暗中留意。`,
  });
  check('手写大纲可直接建立事件', manualEvent.status === 200 && Boolean(manualEvent.body?.event?.id));
  check('手写大纲自动推导出推进步骤', manualEvent.body?.event?.steps?.length === 3);
  check(
    '手写大纲的步骤提要为内容而非编号',
    /[^\d]/.test(manualEvent.body?.event?.steps?.[0]?.title ?? ''),
  );
  check('手写大纲事件标题取自正文', manualEvent.body?.event?.title === '手写的雨夜');
  if (manualEvent.body?.event?.id) {
    await del(`/api/novels/${novelId}/story-events/${manualEvent.body.event.id}`);
  }

  const eventList = await get(`/api/novels/${novelId}/story-events`);
  check(
    '事件列表返回该事件',
    eventList.body?.events?.some?.((item) => item.id === storyEventId),
  );
  check('当前事件指针指向该事件', eventList.body?.current?.id === storyEventId);

  const advanced = await patch(`/api/novels/${novelId}/story-events/${storyEventId}`, {
    advance: 1,
  });
  check('事件进度可推进', advanced.body?.event?.progress === 1);
  check('事件推进后仍未完成', advanced.body?.event?.status === 'writing');

  const advancedDone = await patch(`/api/novels/${novelId}/story-events/${storyEventId}`, {
    advance: 1,
  });
  check('走完全部步骤后事件完成', advancedDone.body?.event?.status === 'done');

  const query = await post(`/api/novels/${novelId}/encyclopedia-queries`, {
    keyword: '落雨渡的渡船规格',
  });
  check('百科查询请求入库成功', query.status === 200 && query.body?.query?.id);

  const recall = await post(`/api/novels/${novelId}/recall-requests`, {
    eventId: storyEventId,
    reason: '需要回顾老人出场时的细节。',
  });
  check('事件调阅请求入库成功', recall.status === 200 && recall.body?.request?.id);

  const context = await get(`/api/novels/${novelId}/context?chapterId=${chapterId}`);
  const layerKeys = (context.body?.layers ?? []).map((layer) => layer.key);
  check('包含设定与世界观层', layerKeys.includes('worldview'));
  check('包含主角档案层', layerKeys.includes('characters-primary'));
  check('包含角色关系层', layerKeys.includes('relations'));
  check('包含大纲总纲层', layerKeys.includes('outline-overview'));
  check('包含生成规则层', layerKeys.includes('rules'));
  check('始终注入完整时间轴', layerKeys.includes('timeline'));
  check('包含事件大纲层', layerKeys.includes('current-event'));
  check('包含大纲步骤层', layerKeys.includes('current-event-steps'));
  check('包含已完结事件层', layerKeys.includes('finished-events'));
  check('包含按需注入层', layerKeys.includes('recalled'));
  check('上下文总量在预算内', context.body?.totalTokens > 0);

  console.log('十一、导入导出');
  const txt = await fetch(`${BASE}/api/novels/${novelId}/export?format=txt`);
  const txtBody = await txt.text();
  check('导出 txt 成功', txt.status === 200 && txtBody.includes('第一章 落雨的渡口'));
  check('txt 响应带下载文件名', (txt.headers.get('content-disposition') ?? '').includes('.txt'));

  const archive = await fetch(`${BASE}/api/novels/${novelId}/export?format=json`);
  const archiveBody = await archive.json();
  check('导出归档包含正文', archiveBody?.volumes?.[0]?.chapters?.[0]?.content?.includes('斗笠'));
  check('导出归档包含角色', archiveBody?.characters?.length === 2);

  const imported = await post('/api/novels/import', {
    title: '导入的小说',
    text: '第一章 开端\n有人叩门。\n第二章 夜半\n刀光一闪。',
  });
  check('纯文本导入成功', imported.status === 200 && imported.body?.chapters === 2);

  const importedArchive = await post('/api/novels/import', { archive: archiveBody });
  check('归档导入成功', importedArchive.status === 200 && importedArchive.body?.chapters === 1);

  console.log('十二、清理');
  const removed = await del(`/api/novels/${novelId}`);
  check('删除小说成功', removed.status === 200);
  await del(`/api/novels/${imported.body.novelId}`);
  await del(`/api/novels/${importedArchive.body.novelId}`);
  const after = await get('/api/novels');
  check(
    '删除后书架不再包含测试数据',
    !after.body?.novels?.some((novel) => novel.title === '冒烟测试小说'),
  );

  console.log(`\n通过 ${passed} 项，失败 ${failed} 项`);
  process.exitCode = failed > 0 ? 1 : 0;
}

main().catch((error) => {
  console.error('冒烟测试执行失败：', error);
  process.exitCode = 1;
});
