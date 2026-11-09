/**
 * 37 · 兑换商城重排「写前基线 + 方案预演」（严格只读 / 零写操作）
 *
 * 做三件事，全部只读：
 *   1) 重新拉一份即时完整基线快照（写前，带时间戳），覆盖全部积分商品所有字段
 *   2) 只读拉在售商品列表，建立 goodsId -> 二级分组 关联，算覆盖率
 *   3) 本地预演两种「二级分组」解读的目标顺序，产出对比表（不写线上）
 *
 * 绝不调用任何写接口；路由守卫同样兜底。
 */
const fs = require('fs');
const path = require('path');
const { cfg, launch, login, captureHeaders, post, isOk, stamp, writeCsv, PATHS } = require('./lib/common');

const POINTS_PAGE =
  `${cfg.BASE}/bos/products/ecGoodsmanage/${cfg.BOS_ID}/${cfg.KEY}/goods/pointsMall/index`;
const EP_POINT = 'queryPointGoodsListForManagement';
const EP_GOODS = 'queryGoodsListWithPageForManagement';   // 在售商品（只读，取 classifyList）
const API_POINT = `${cfg.BASE}/api3/mall/point/goods/${EP_POINT}`;
const API_GOODS = `${cfg.BASE}/api3/mall/goods/${EP_GOODS}`;

const BLOCK = [
  'moveGoodsToClassify', 'addPointGoods', 'updatePointGoods', 'deletePointGoods',
  '/goods/update', '/goods/delete', '/goods/import', '/material/delete',
  '/point/goods/save', '/point/goods/batch', '/point/goods/update',
];

(async () => {
  console.log('=== 写前基线 + 重排方案预演（只读）===\n');
  const ctx = await launch({ headless: true });
  const page = ctx.pages()[0] || await ctx.newPage();
  page.setDefaultTimeout(60000);
  let blocked = 0;
  await page.route('**/api3/**', r => {
    const u = r.request().url();
    if (BLOCK.some(b => u.includes(b))) { blocked++; console.error('  [守卫] 阻断:', u); return r.abort(); }
    return r.continue();
  });

  await page.goto(POINTS_PAGE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);
  if (page.url().includes('account.weimob.com')) {
    console.log('登录中…'); await login(page); await page.waitForTimeout(3000);
    await page.goto(POINTS_PAGE, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(6000);
  }

  // 同源 payload（各自沿用页面自己发出的 body 结构）
  const cp = await captureHeaders(page, POINTS_PAGE, EP_POINT);
  const pointBody = cp.payload || {};
  const hdr = cp.headers;

  // ---------- 1) 积分商品全量（基线） ----------
  const points = [];
  let total = null;
  for (let pn = 1; pn <= 60; pn++) {
    const j = await post(page, API_POINT, { ...pointBody, pageNum: pn, pageSize: 50 }, hdr);
    if (!isOk(j)) break;
    const l = (j.data && j.data.pageList) || [];
    if (total === null && j.data && j.data.totalCount != null) total = j.data.totalCount;
    points.push(...l);
    if (!l.length || l.length < 50) break;
    if (total != null && points.length >= total) break;
  }
  console.log('积分商品基线:', points.length, '/ totalCount', total);

  // ---------- 2) 在售商品全量（只读；pageSize≤20 铁律） ----------
  // 优先拿页面自己发过的在售商品 payload；这里用积分页同源 basicInfo 构造最小只读查询
  const goodsBody = {
    basicInfo: pointBody.basicInfo, solutionType: 2, pageNum: 1, pageSize: 20,
    queryParameter: { classifyId: '', type: 0, stockStatus: null },
    i18n: pointBody.i18n || { language: 'zh-CN', timezone: 8 },
    extendInfo: { refer: '/bos/products/ecGoodsmanage/{bosId}/{key}/goods/list', source: 80 },
  };
  const onsale = [];
  for (let pn = 1; pn <= 60; pn++) {
    const j = await post(page, API_GOODS, { ...goodsBody, pageNum: pn }, hdr);
    if (!isOk(j)) { console.log('  在售商品第', pn, '页失败:', (j && (j.errmsg || j.errcode)) || '?'); break; }
    const l = (j.data && j.data.pageList) || [];
    onsale.push(...l);
    if (!l.length || l.length < 20) break;
  }
  console.log('在售商品:', onsale.length);

  const byId = new Map(onsale.map(g => [String(g.goodsId), g]));
  const g2Of = p => {
    const o = byId.get(String(p.goodsId));
    if (!o) return null;
    const arr = o.classifyList || o.goodsClassifyList || [];
    return arr.map(c => c.name || c.classifyName).filter(Boolean);
  };
  const mapped = points.filter(p => (g2Of(p) || []).length > 0);
  const unmapped = points.filter(p => (g2Of(p) || []).length === 0);
  console.log('能关联到二级分组:', mapped.length, '/ 未关联:', unmapped.length);

  // ---------- 3) 分组顺序基准：11-07 导出的商品分组树 ----------
  const clsFiles = fs.readdirSync(PATHS.BACKUP).filter(f => /^商品分组原始快照_/.test(f)).sort();
  let groupOrder = [];   // 二级分组名，按 一级sort降序 + 组内二级sort降序
  if (clsFiles.length) {
    const cj = JSON.parse(fs.readFileSync(path.join(PATHS.BACKUP, clsFiles[clsFiles.length - 1]), 'utf8'));
    const d = cj.data || cj;
    const l1 = (d.goodsClassifyList || []).slice().sort((a, b) => (b.sort || 0) - (a.sort || 0));
    l1.forEach(g => (g.childClassifyList || []).slice()
      .sort((a, b) => (b.sort || 0) - (a.sort || 0))
      .forEach(c => groupOrder.push(c.name)));
    console.log('11-07 分组树二级顺序:', groupOrder.length, '个');
  }

  // ---------- 方案 A：按「在售商品二级分组」优先，组内按积分价升序 ----------
  const orderA = new Map(groupOrder.map((n, i) => [n, i]));
  const rankA = [...points].map((p, i) => {
    const g2 = g2Of(p) || [];
    const gi = Math.min(...g2.map(n => orderA.has(n) ? orderA.get(n) : 99999));
    return { p, i, g2, gi: Number.isFinite(gi) ? gi : 99999 };
  }).sort((x, y) => x.gi - y.gi || (Number(x.p.minPoint) - Number(y.p.minPoint)) || x.i - y.i);

  // ---------- 方案 B：按「积分分组（一级）」优先，组内按积分价升序 ----------
  const ptOrder = ['学习文具', '体育用品', '少儿护理', '少儿穿戴', '少儿食品', '家庭日用', '读物潮玩', '米面油品', '家用电器'];
  const orderB = new Map(ptOrder.map((n, i) => [n, i]));
  const rankB = [...points].map((p, i) => {
    const n = (p.pointClassifyInfo && p.pointClassifyInfo.name) || '';
    return { p, i, gi: orderB.has(n) ? orderB.get(n) : 99999 };
  }).sort((x, y) => x.gi - y.gi || (Number(x.p.minPoint) - Number(y.p.minPoint)) || x.i - y.i);

  // ---------- 落盘：写前基线（最优先） ----------
  const ts = stamp();
  const baseFile = path.join(PATHS.BACKUP, `重排前基线_积分商品_${ts}.json`);
  fs.writeFileSync(baseFile, JSON.stringify({
    capturedAt: new Date().toISOString(), sourcePage: POINTS_PAGE, endpoint: EP_POINT,
    readOnly: true, totalCount: total, count: points.length,
    // 只保留与排序/回滚有关的字段，仍含 goodsId 与全部原字段以保真
    goods: points,
    onsaleCount: onsale.length,
    onsaleClassify: onsale.map(g => ({ goodsId: g.goodsId, classifyList: (g.classifyList || g.goodsClassifyList || []).map(c => ({ name: c.name || c.classifyName, id: c.classifyId, level: c.classifyLevel })) })),
  }, null, 1), 'utf8');
  console.log('\n[基线]', baseFile);

  // ---------- 预演对比表（本地，不写线上） ----------
  const A_FILE = path.join(PATHS.OUT, `重排预演_方案A_二级分组优先_${ts}.csv`);
  writeCsv(A_FILE,
    ['目标名次', '当前sort', '商品ID', '商品名称', '二级分组', '积分分组', '最低积分', '最高积分'],
    rankA.map((x, n) => [n + 1, x.p.sort, x.p.goodsId, x.p.title || '', x.g2.join('/'),
      (x.p.pointClassifyInfo && x.p.pointClassifyInfo.name) || '', x.p.minPoint ?? '', x.p.maxPoint ?? '']));
  const B_FILE = path.join(PATHS.OUT, `重排预演_方案B_积分分组优先_${ts}.csv`);
  writeCsv(B_FILE,
    ['目标名次', '当前sort', '商品ID', '商品名称', '积分分组', '最低积分', '最高积分'],
    rankB.map((x, n) => [n + 1, x.p.sort, x.p.goodsId, x.p.title || '',
      (x.p.pointClassifyInfo && x.p.pointClassifyInfo.name) || '', x.p.minPoint ?? '', x.p.maxPoint ?? '']));
  console.log('[预演A]', A_FILE);
  console.log('[预演B]', B_FILE);

  // ---------- 概览 ----------
  const grpA = {};
  rankA.forEach(x => { const k = x.g2.join('/') || '(未关联)'; grpA[k] = (grpA[k] || 0) + 1; });
  const grpB = {};
  rankB.forEach(x => { const k = (x.p.pointClassifyInfo && x.p.pointClassifyInfo.name) || '(无)'; grpB[k] = (grpB[k] || 0) + 1; });
  const md = [];
  md.push('# 兑换商城重排 · 写前基线与方案预演（只读）');
  md.push('');
  md.push(`- 生成时间：${new Date().toLocaleString('zh-CN')}`);
  md.push(`- 积分商品 ${points.length} 个 / 在售商品 ${onsale.length} 个 / 能关联二级分组 ${mapped.length} 个（未关联 ${unmapped.length}）`);
  md.push(`- 基线文件：\`${path.basename(baseFile)}\``);
  md.push('- **本次未调用任何写接口，线上零改动**');
  md.push('');
  md.push('## 方案 A：按在售商品「二级分组」优先 + 组内积分价升序');
  md.push('');
  md.push(`分组数 ${Object.keys(grpA).length}，前 12 组：`);
  Object.entries(grpA).slice(0, 12).forEach(([k, v]) => md.push(`- ${k}：${v} 个`));
  md.push('');
  md.push('前 15 名：');
  md.push('');
  md.push('| 名次 | 商品名称 | 二级分组 | 积分价 |');
  md.push('|---|---|---|---|');
  rankA.slice(0, 15).forEach((x, n) => md.push(`| ${n + 1} | ${String(x.p.title || '').replace(/\|/g, '\\|')} | ${x.g2.join('/') || '-'} | ${x.p.minPoint} |`));
  md.push('');
  md.push('## 方案 B：按「积分分组（一级）」优先 + 组内积分价升序');
  md.push('');
  md.push(`分组数 ${Object.keys(grpB).length}：`);
  Object.entries(grpB).forEach(([k, v]) => md.push(`- ${k}：${v} 个`));
  md.push('');
  md.push('前 15 名：');
  md.push('');
  md.push('| 名次 | 商品名称 | 积分分组 | 积分价 |');
  md.push('|---|---|---|---|');
  rankB.slice(0, 15).forEach((x, n) => md.push(`| ${n + 1} | ${String(x.p.title || '').replace(/\|/g, '\\|')} | ${(x.p.pointClassifyInfo && x.p.pointClassifyInfo.name) || '-'} | ${x.p.minPoint} |`));
  const mdFile = path.join(PATHS.OUT, `重排方案对比_${ts}.md`);
  fs.writeFileSync(mdFile, md.join('\n'), 'utf8');
  console.log('[对比]', mdFile);

  console.log('\n方案 A 分组数:', Object.keys(grpA).length, '| 前 6:', Object.entries(grpA).slice(0, 6).map(([k, v]) => `${k}(${v})`).join(' '));
  console.log('方案 B 分组数:', Object.keys(grpB).length, '|', JSON.stringify(grpB));
  console.log('\n被阻断写接口次数:', blocked);
  console.log('=== 完成：基线已落盘，预演仅本地文件，线上零改动 ===');
  await ctx.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
