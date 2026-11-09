/**
 * 34 · 兑换商城（积分商城）商品排序导出（严格只读 / READ-ONLY）
 *
 * 目标：商城 > 经营工具 > 营销工具 > 商品管理-积分商品列表（pointsMall）
 *       把全部积分商品及其「排序值 sort」导成表格。
 *
 * 只读纪律（勿删）：
 *   1) 只触及 queryPointGoodsListForManagement 这一个查询接口（分页拉全量）。
 *   2) 路由守卫 abort 所有已知写接口（moveGoodsToClassify / 增删改 / 导入…），绝不落到线上。
 *   3) 查询 body 沿用页面自己发出的同源 payload（basicInfo/i18n/extendInfo），不构造空 body。
 *   4) 只产出「积分商品 + 排序」数据，不碰商品库 / 分组 / 库存 / 价格 / 素材 / 积分规则。
 *   5) 先落原始快照（每页原文，带时间戳），再派生 CSV 表格 / Markdown 概览。
 *   6) 不修改仓库内任何既有文件，只新增本脚本与运行产物。
 *
 * 产出：
 *   backup/兑换商城商品排序_原始快照_<ts>.json   接口分页原文（字段一字不改）
 *   backup/兑换商城商品排序_<ts>.csv             UTF-8 BOM，Excel 直接打开
 *   out/兑换商城商品排序_<ts>.md                 概览 + 排序分布
 *
 * 跑法（凭据走环境变量，不落盘；已有 .profile 登录态时无需账号密码）：
 *   WEIMOB_BOS_ID=xxx WEIMOB_KEY=xxx WEIMOB_VID=xxx CHROME_PATH=xxx \
 *   node scripts/34-export-points-sort-readonly.js
 *   PROBE=1 ... 只探查字段名与前几条样本，不导出文件
 */
const fs = require('fs');
const path = require('path');
const {
  cfg, launch, login, captureHeaders, post, isOk, stamp, writeCsv, PATHS,
} = require('./lib/common');

const EP = 'queryPointGoodsListForManagement';
const API = `${cfg.BASE}/api3/mall/point/goods/${EP}`;
const POINTS_PAGE =
  `${cfg.BASE}/bos/products/ecGoodsmanage/${cfg.BOS_ID}/${cfg.KEY}/goods/pointsMall/index`;
const PROBE = process.env.PROBE === '1';
const PAGE_SIZE = 50;          // 仓库实测 50 可用；<=20 铁律只针对 mall/goods 商品列表
const MAX_PAGES = 60;          // 上限保护，避免异常时无限翻页

// 只读守卫：命中即阻断（第二道保险，脚本自身本就不发这些）
const BLOCK = [
  'moveGoodsToClassify', 'addPointGoods', 'updatePointGoods', 'deletePointGoods',
  'addPointClassify', 'updatePointClassify', 'deletePointClassify',
  '/goods/update', '/goods/delete', '/goods/import', '/material/delete',
  '/point/goods/save', '/point/goods/batch',
];

// 排序值字段候选（按优先级；以接口真实字段为准，PROBE 会打印）
const SORT_KEYS = ['sort', 'goodsSort', 'sortNum', 'sortValue', 'orderNum', 'sequence', 'sortNo'];
const pickSortKey = sample => SORT_KEYS.find(k => sample && Object.prototype.hasOwnProperty.call(sample, k)) || null;

(async () => {
  console.log('=== 兑换商城（积分商城）商品排序导出（只读）===');
  console.log('目标页面:', POINTS_PAGE);
  console.log('只读守卫: 已启用（阻断写接口）\n');

  const ctx = await launch({ headless: true });
  const page = ctx.pages()[0] || await ctx.newPage();
  page.setDefaultTimeout(60000);

  let blocked = 0;
  const apiLog = [];
  await page.route('**/api3/**', route => {
    const u = route.request().url();
    if (BLOCK.some(b => u.includes(b))) {
      blocked++;
      console.error('  [只读守卫] 已阻断写接口:', u);
      return route.abort();
    }
    return route.continue();
  });

  // 被动观察：确认页面真实调用的接口名（不主动发任何业务请求）
  page.on('response', r => {
    const u = r.url();
    if (u.includes('/api3/mall/point/goods/') || u.includes('/api3/mall/point/classify/')) {
      const n = u.split('/').pop().split('?')[0];
      if (!apiLog.includes(n)) apiLog.push(n);
    }
  });

  console.log('打开积分商品列表页…');
  await page.goto(POINTS_PAGE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);

  if (page.url().includes('account.weimob.com')) {
    console.log('需要登录 → 密码登录中…');
    await login(page);
    await page.waitForTimeout(3000);
    if (page.url().includes('account.weimob.com')) {
      await ctx.close();
      throw new Error('登录未完成（可能触发验证码/滑块或账号密码不正确）。未导出任何数据，线上零改动。');
    }
    console.log('登录成功，回到积分商品列表页…');
    await page.goto(POINTS_PAGE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(5000);
  }

  console.log('观察到的积分域接口:', apiLog.length ? apiLog.join(' | ') : '（无）');

  // 拿页面自己发出的同源鉴权头 + 查询 payload（不构造空 body）
  const { headers, payload } = await captureHeaders(page, POINTS_PAGE, EP);
  if (!payload) throw new Error('未捕获到积分商品查询的 payload，停止导出（线上零改动）');
  const baseBody = { ...payload };
  console.log('已取得同源请求头与查询 payload，字段:', Object.keys(baseBody).join(', '));

  // ---------- 分页拉全量（每页都是同一个只读查询接口） ----------
  const pages = [], all = [];
  let total = null;
  for (let pn = 1; pn <= MAX_PAGES; pn++) {
    const body = { ...baseBody, pageNum: pn, pageSize: PAGE_SIZE };
    const j = await post(page, API, body, headers);
    if (!isOk(j)) {
      console.error(`  第 ${pn} 页失败:`, (j && (j.errmsg || j.errcode)) || '未知');
      break;
    }
    const d = j.data || {};
    const list = d.pageList || [];
    if (total === null && d.totalCount != null) total = d.totalCount;
    pages.push(j);
    all.push(...list);
    console.log(`  page ${pn}: ${list.length} 条 / 累计 ${all.length}${total != null ? ' / total ' + total : ''}`);
    if (!list.length) break;
    if (list.length < PAGE_SIZE) break;
    if (total != null && all.length >= total) break;
  }

  if (PROBE) {
    const s = all[0] || {};
    console.log('\n=== PROBE：首条商品全部字段 ===');
    console.log(Object.keys(s).join(', '));
    console.log('\n排序相关字段值:');
    SORT_KEYS.filter(k => k in s).forEach(k => console.log(`  ${k} = ${JSON.stringify(s[k])}`));
    console.log('\n前 3 条样本:');
    all.slice(0, 3).forEach((p, i) => console.log(`  [${i + 1}]`, JSON.stringify({
      goodsId: p.goodsId, title: p.title, sort: p.sort, goodsSort: p.goodsSort,
      pointClassifyInfo: p.pointClassifyInfo, minPoint: p.minPoint, maxPoint: p.maxPoint,
    })));
    console.log('\nPROBE 模式结束（未生成导出文件，线上零改动）');
    await ctx.close();
    return;
  }

  if (!all.length) throw new Error('未拉到任何积分商品，未生成表格（线上零改动）');

  // ---------- 字段自适应 ----------
  const sample = all[0] || {};
  const sortKey = pickSortKey(sample);
  const fields = Object.keys(sample);
  console.log('\n商品字段:', fields.join(', '));
  console.log('识别到排序字段:', sortKey || '（未命中候选，将输出全部原字段供核对）');

  // 按排序值降序（数字越大越靠前，与分组排序规则一致）；同时保留接口原始顺序
  const rank = [...all].map((p, i) => ({ p, i })).sort((a, b) => {
    const av = Number(sortKey ? a.p[sortKey] : 0), bv = Number(sortKey ? b.p[sortKey] : 0);
    const an = Number.isFinite(av) ? av : -Infinity, bn = Number.isFinite(bv) ? bv : -Infinity;
    return bn - an || a.i - b.i;
  });

  const clsName = p => (p.pointClassifyInfo && (p.pointClassifyInfo.name || p.pointClassifyInfo.pointClassifyName))
    || p.pointClassifyName || '';
  const clsId = p => (p.pointClassifyInfo && p.pointClassifyInfo.pointClassifyId) || p.pointClassifyId || '';
  // goodsStock 是对象 {stock:[...], goodsStockNum: N,...}，不能直接写进 CSV（会变成 [object Object]）
  const stockNum = p => {
    const s = p.goodsStock;
    if (s == null) return '';
    if (typeof s === 'object') return s.goodsStockNum ?? '';
    return s;
  };

  // ---------- 1) 原始快照优先落盘 ----------
  const ts = stamp();
  const snapFile = path.join(PATHS.BACKUP, `兑换商城商品排序_原始快照_${ts}.json`);
  fs.writeFileSync(snapFile, JSON.stringify({
    exportedAt: new Date().toISOString(), sourcePage: POINTS_PAGE, endpoint: EP,
    readOnly: true, totalCount: total, pageSize: PAGE_SIZE, pageCount: pages.length,
    fields, sortKey, pages,
  }, null, 1), 'utf8');
  console.log('\n[1/3] 原始快照:', snapFile);

  // ---------- 2) CSV 表格 ----------
  const HEAD = ['按排序名次', '接口原始序号', '商品ID', '商品名称', '排序值',
    '当前积分分组', '积分分组ID', '最低积分', '最高积分', '库存数(goodsStockNum)', '上架', '可售', '主图URL'];
  const rows = rank.map(({ p, i }, n) => [
    n + 1, i + 1, p.goodsId, p.title || '',
    sortKey ? (p[sortKey] ?? '') : '',
    clsName(p), clsId(p), p.minPoint ?? '', p.maxPoint ?? '',
    stockNum(p), p.isOnline ?? '', p.isCanSell ?? '', p.defaultImageUrl || '',
  ]);
  const csvFile = path.join(PATHS.BACKUP, `兑换商城商品排序_${ts}.csv`);
  writeCsv(csvFile, HEAD, rows);
  console.log('[2/3] CSV 表格:', csvFile, `(${rows.length} 行商品)`);

  // ---------- 3) Markdown 概览 ----------
  const dist = {};
  all.forEach(p => { const k = clsName(p) || '(无分组)'; dist[k] = (dist[k] || 0) + 1; });
  const sortVals = sortKey ? all.map(p => Number(p[sortKey])).filter(Number.isFinite) : [];
  const uniq = [...new Set(sortVals)];
  const md = [];
  md.push('# 兑换商城（积分商城）商品排序导出');
  md.push('');
  md.push(`- 导出时间：${new Date().toLocaleString('zh-CN')}`);
  md.push(`- 来源页面：\`商城 > 经营工具 > 营销工具 > 商品管理-积分商品列表\``);
  md.push(`- 取数接口：\`${EP}\` 分页只读查询；**未调用任何写接口**，线上数据零改动`);
  md.push(`- 商品总数：${all.length}${total != null ? '（接口 totalCount ' + total + '）' : ''}；分 ${pages.length} 页`);
  md.push(`- 排序字段：\`${sortKey || '未识别'}\`${sortVals.length ? `，取值范围 ${Math.min(...sortVals)} ~ ${Math.max(...sortVals)}，共 ${uniq.length} 个不同值` : ''}`);
  md.push(`- 原始快照：\`${path.basename(snapFile)}\``);
  md.push('');
  md.push('## 积分分组分布');
  md.push('');
  Object.entries(dist).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => md.push(`- ${k}：${v} 个`));
  md.push('');
  md.push('## 排序前 30（按排序值降序）');
  md.push('');
  md.push('| 名次 | 商品ID | 商品名称 | 排序值 | 分组 |');
  md.push('|---|---|---|---|---|');
  rank.slice(0, 30).forEach(({ p }, n) => md.push(`| ${n + 1} | ${p.goodsId} | ${String(p.title || '').replace(/\|/g, '\\|')} | ${sortKey ? (p[sortKey] ?? '-') : '-'} | ${clsName(p) || '-'} |`));
  md.push('');
  const mdFile = path.join(PATHS.OUT, `兑换商城商品排序_${ts}.md`);
  fs.writeFileSync(mdFile, md.join('\n'), 'utf8');
  console.log('[3/3] Markdown:', mdFile);

  // ---------- 一致性自检 ----------
  const okCount = rows.length === all.length && (total == null || all.length >= total || all.length === total);
  console.log('\n自检:', okCount ? `通过（CSV ${rows.length} 行 = 拉取 ${all.length} 条${total != null ? ' / totalCount ' + total : ''}）` : '⚠ 数量不一致，请核对快照');
  console.log('被阻断写接口次数:', blocked);
  console.log('\n=== 完成：仅导出积分商品排序，未改动线上任何数据 ===');
  await ctx.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
