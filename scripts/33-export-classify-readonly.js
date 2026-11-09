/**
 * 33 · 商品分组导出（严格只读 / READ-ONLY）
 *
 * 目标：商城 > 在售商品 > 商品分组 的分组树，导出快照。
 *
 * 只读纪律（本脚本的核心约束，勿删）：
 *   1) 全程不主动调用任何写接口。只触及 queryAllClassifyListForManagement 这一个查询接口。
 *   2) 路由层兜底：页面若意外发出已知写接口（增/删/改/移动/导入），直接 abort，绝不落到线上。
 *   3) 优先「被动读取」页面自己发出的查询响应；仅在读不到时，用同一只读查询重放一次。
 *   4) 只产出「分组」数据，不碰商品 / 素材 / 库存 / 详情 / 积分商城 / 价格。
 *   5) 先落原始 JSON 快照（带时间戳），再派生 CSV / Markdown。
 *   6) 不修改仓库内任何既有文件，只新增本脚本与运行产物。
 *
 * 产出：
 *   backup/商品分组原始快照_<ts>.json   接口 data 原文（完整字段，一字不改）
 *   backup/商品分组_<ts>.csv            UTF-8 BOM，Excel 直接打开
 *   out/商品分组_<ts>.md                可读树形 + 统计
 *
 * 跑法（凭据走环境变量，不落盘；config.local.js 亦可，已在 .gitignore）：
 *   WEIMOB_ACCOUNT=xxx WEIMOB_PASSWORD=xxx \
 *   WEIMOB_BOS_ID=xxx WEIMOB_KEY=xxx WEIMOB_VID=xxx CHROME_PATH=xxx \
 *   node scripts/33-export-classify-readonly.js
 */
const fs = require('fs');
const path = require('path');
const {
  cfg, launch, login, captureHeaders, post, stamp, writeCsv, PATHS,
} = require('./lib/common');

const EP = 'queryAllClassifyListForManagement';                       // 文档记录的查询接口（兜底用）
const API = `${cfg.BASE}/api3/mall/goods/classify/${EP}`;
const CLASSIFY_PAGE =
  `${cfg.BASE}/bos/products/ecGoodsmanage/${cfg.BOS_ID}/${cfg.KEY}/manage/classify/list`;
const PROBE = process.env.PROBE === '1';   // 只列接口台账、不导出（纯只读探查）

// 只读守卫：任何命中已知写动作的请求一律 abort（第二道保险，脚本自身本就不发这些）
const BLOCK = [
  'addGoodsClassify', 'deleteGoodsClassify', 'updateGoodsClassify', 'moveGoodsToClassify',
  '/goods/update', '/goods/delete', '/goods/import', '/material/delete',
];
// 注意：countChildClassifyByParentClassifyId 是页面渲染用的「只读统计查询」，不能阻断。
//       只读 = 不改动线上数据，不等于掐断页面自身的查询请求（掐了反而让树加载不全）。

(async () => {
  console.log('=== 商品分组导出（只读）===');
  console.log('目标页面:', CLASSIFY_PAGE);
  console.log('只读守卫: 已启用（阻断写接口）\n');

  // headless 覆盖：本机/无显示器环境也能跑
  const ctx = await launch({ headless: true });
  const page = ctx.pages()[0] || await ctx.newPage();
  page.setDefaultTimeout(60000);

  let blocked = 0, touched = [];
  await page.route('**/api3/**', route => {
    const u = route.request().url();
    if (BLOCK.some(b => u.includes(b))) {
      blocked++;
      console.error('  [只读守卫] 已阻断写接口:', u);
      return route.abort();
    }
    return route.continue();
  });

  // 被动监听：页面自己加载分组树时把响应读下来（零主动请求）
  // 自适应：不写死接口名，凡是分组域里返回 goodsClassifyList / systemClassifyList 的响应都收
  let passive = null, passiveRawText = null, realApi = null;
  const apiLog = [];
  const gotTree = new Promise(resolve => {
    let done = false;
    const timer = setTimeout(() => { if (!done) { done = true; resolve(null); } }, 20000);
    page.on('response', async r => {
      const u = r.url();
      if (!u.includes('/api3/mall/goods/classify/')) return;   // 只观察分组域
      touched.push(u);
      let txt = '';
      try {
        txt = await r.text();
        const j = JSON.parse(txt);
        const d = j && j.data;
        const has = d && (Array.isArray(d.goodsClassifyList) || Array.isArray(d.systemClassifyList));
        apiLog.push({ name: u.split('/').pop().split('?')[0], hasTree: !!has, bytes: txt.length });
        if (has) {
          passive = d; passiveRawText = txt; realApi = u;
          if (!done) { done = true; clearTimeout(timer); resolve(d); }
        }
      } catch (e) {
        apiLog.push({ name: u.split('/').pop().split('?')[0], hasTree: false, bytes: txt.length, parseErr: true });
      }
    });
  });

  console.log('打开分组页…');
  await page.goto(CLASSIFY_PAGE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);

  // 若被踢到登录页，走密码登录（common.js 的 login 会切「密码登录」tab，无需短信验证码）
  if (page.url().includes('account.weimob.com')) {
    console.log('需要登录 → 密码登录中…');
    await login(page);
    await page.waitForTimeout(3000);
    if (page.url().includes('account.weimob.com')) {
      await ctx.close();
      throw new Error('登录未完成（可能触发验证码/滑块或账号密码不正确）。未导出任何数据，线上零改动。');
    }
    console.log('登录成功，回到分组页…');
    await page.goto(CLASSIFY_PAGE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4000);
  }

  let data = await gotTree;
  console.log('\n捕获到的分组域接口（只读台账）:');
  if (!apiLog.length) console.log('  （无）');
  apiLog.forEach(a => console.log(`  - ${a.name} | 含分组树: ${a.hasTree} | ${a.bytes} bytes${a.parseErr ? ' | 非JSON' : ''}`));

  // 探查模式：只列台账，不写任何导出文件
  if (PROBE) {
    console.log('\nPROBE 模式结束（未生成导出文件，线上零改动）');
    await ctx.close();
    return;
  }

  let via = realApi
    ? `被动读取页面查询响应（${realApi.split('/').pop().split('?')[0]}，零主动请求）`
    : '被动读取页面查询响应（零主动请求）';
  let rawText = passiveRawText;

  // 兜底：若页面没发出该查询，用捕获到的同源 headers + 原 body 重放「同一只读查询」一次
  if (!data) {
    const p = realApi ? new URL(realApi).pathname : null;
    const keyword = p ? p.split('/').pop() : EP;
    const url = p ? `${cfg.BASE}${p}` : API;
    console.log('未捕获到分组树响应 → 用页面同源请求头重放一次只读查询:', keyword);
    const { headers, payload } = await captureHeaders(page, CLASSIFY_PAGE, keyword);
    const j = await post(page, url, payload || {}, headers);
    if (!j || !j.data || !Array.isArray(j.data.goodsClassifyList)) {
      await ctx.close();
      throw new Error('分组树查询失败：' + JSON.stringify(j).slice(0, 300));
    }
    data = j.data;
    rawText = JSON.stringify(j, null, 1);
    via = `同源请求头重放一次只读查询（${keyword}）`;
  }

  // ---------- 统计（只读计算，不写回线上） ----------
  const l1 = data.goodsClassifyList || [];
  const l2 = l1.reduce((a, g) => a + (g.childClassifyList || []).length, 0);
  const sys = data.systemClassifyList || [];

  console.log('\n=== 分组树（只读结果）===');
  console.log('  自定义一级:', l1.length, '| 自定义二级:', l2, '| 合计:', l1.length + l2);
  console.log('  系统分组  :', sys.length);
  console.log('  触及业务接口次数:', touched.length, '| 被阻断写接口:', blocked);

  // ---------- 1) 原始快照优先落盘 ----------
  const ts = stamp();
  const snapFile = path.join(PATHS.BACKUP, `商品分组原始快照_${ts}.json`);
  fs.writeFileSync(snapFile, rawText || JSON.stringify(data, null, 1), 'utf8');
  console.log('\n[1/3] 原始快照:', snapFile);

  // ---------- 2) 扁平 CSV（只含分组字段） ----------
  const pick = c => [
    c.classifyId, c.parentId, c.classifyLevel, c.isLeaf, c.isShow, c.isHot,
    c.sort, c.countGoodsNum, c.imageUrl || '',
  ];
  const HEAD = ['类型', '层级', '一级分组', '二级分组', '分组名称',
    'classifyId', 'parentId', 'classifyLevel', 'isLeaf', 'isShow', 'isHot',
    'sort', '关联商品数', 'imageUrl'];
  const rows = [];
  l1.forEach(g => {
    rows.push(['自定义', 1, g.name, '', g.name, ...pick(g)]);
    (g.childClassifyList || []).forEach(c => {
      rows.push(['自定义', 2, g.name, c.name, c.name, ...pick(c)]);
    });
  });
  sys.forEach(s => rows.push(['系统', '', '', s.name, s.name, ...pick(s)]));
  const csvFile = path.join(PATHS.BACKUP, `商品分组_${ts}.csv`);
  writeCsv(csvFile, HEAD, rows);
  console.log('[2/3] CSV     :', csvFile, `(${rows.length} 行)`);

  // ---------- 3) 可读 Markdown 树 ----------
  const md = [];
  md.push('# 商品分组快照');
  md.push('');
  md.push(`- 导出时间：${new Date().toLocaleString('zh-CN')}`);
  md.push(`- 来源页面：\`商城 > 在售商品 > 商品分组\``);
  md.push(`- 取数方式：${via}；**未调用任何写接口**，线上数据零改动`);
  md.push(`- 统计：一级 ${l1.length} / 二级 ${l2} / 合计 ${l1.length + l2}，系统分组 ${sys.length}`);
  md.push(`- 原始快照：\`${path.basename(snapFile)}\``);
  md.push('');
  md.push('## 自定义分组');
  md.push('');
  l1.forEach(g => {
    md.push(`- **${g.name}**  \`id=${g.classifyId}\` · 商品数 ${g.countGoodsNum ?? '-'} · 展示 ${g.isShow} · 热门 ${g.isHot} · sort ${g.sort}`);
    (g.childClassifyList || []).forEach(c => {
      md.push(`  - ${c.name}  \`id=${c.classifyId}\` · 商品数 ${c.countGoodsNum ?? '-'} · 展示 ${c.isShow} · sort ${c.sort}`);
    });
  });
  md.push('');
  md.push('## 系统分组（不可删）');
  md.push('');
  sys.forEach(s => md.push(`- ${s.name}  \`id=${s.classifyId}\` · 商品数 ${s.countGoodsNum ?? '-'}`));
  md.push('');
  const mdFile = path.join(PATHS.OUT, `商品分组_${ts}.md`);
  fs.writeFileSync(mdFile, md.join('\n'), 'utf8');
  console.log('[3/3] Markdown:', mdFile);

  // ---------- 一致性自检 ----------
  const flatCount = rows.filter(r => r[0] === '自定义').length;
  if (flatCount !== l1.length + l2) {
    console.error('!! 扁平行数与树节点数不一致，请检查快照。');
  } else {
    console.log('\n自检通过：扁平行数 = 树节点数 =', flatCount);
  }
  console.log('\n=== 完成：仅导出分组，未改动线上任何数据 ===');
  await ctx.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
