/**
 * 42 · 重排后「独立复核 + 最终排序表」（严格只读，零写）
 *
 * 不复用 41 的任何运行时结果，只从磁盘读「写前即时快照 + 回滚文件」，
 * 再重新登录后台拉一遍线上全量数据，逐项核对：
 *   1) 393 条数量 / ID 唯一
 *   2) 391 条目标商品的 sort == 计划 newSort
 *   3) 2 条未参与写入的商品 sort 保持原值
 *   4) sort 值域与写前完全一致（393 个值、不增不减不重复）
 *   5) STATIC 字段一字未变；VOLATILE（库存/可兑数/已兑数）只报告不判失败
 *   6) 按「sort 降序」得到的展示顺序 == 二级分组顺序优先 + 组内积分价升序
 *   7) 在售商品 sort 全部未变
 *
 * 产出：backup/兑换商城排序_重排后_<ts>.csv、out/重排后独立复核_<ts>.md
 * 跑法：与 41 相同，凭据走环境变量（config.local.js 亦可，已在 .gitignore）
 */
const fs = require('fs');
const path = require('path');
const { cfg, launch, login, captureHeaders, post, isOk, stamp, writeCsv, PATHS } = require('./lib/common');

const POINTS_PAGE = `${cfg.BASE}/bos/products/ecGoodsmanage/${cfg.BOS_ID}/${cfg.KEY}/goods/pointsMall/index`;
const GOODS_PAGE = `${cfg.BASE}/bos/products/ecGoodsmanage/${cfg.BOS_ID}/${cfg.KEY}/goods/list`;
const EP = 'queryPointGoodsListForManagement';
const EP_GOODS = 'queryGoodsListWithPageForManagement';
const API = `${cfg.BASE}/api3/mall/point/goods/${EP}`;
const API_GOODS = `${cfg.BASE}/api3/mall/goods/${EP_GOODS}`;

// 只读脚本：不放行任何写接口
const WRITE_VERBS = [
  'addGoodsClassify', 'deleteGoodsClassify', 'updateGoodsClassify',
  'moveGoodsToClassify', 'addPointGoods', 'deletePointGoods',
  'addPointClassify', 'updatePointClassify', 'deletePointClassify',
  'updatePointGoodsSort', '/goods/update', '/goods/delete', '/goods/import',
  '/material/delete', '/point/goods/save', '/point/goods/batch',
  'insertMaterial', 'createGroup', 'batchUpdate', 'setOnline',
];

const STATIC = ['minPoint', 'maxPoint', 'minPointPrice', 'maxPointPrice',
  'goodsLimitNum', 'isOnline', 'isCanSell', 'title', 'defaultImageUrl',
  'priceType', 'soldType', 'goodsType', 'subGoodsType', 'outerGoodsCode'];
const VOLATILE = ['goodsStock', 'goodsAvailableNum', 'goodsAlreadySoldNum'];
const norm = v => JSON.stringify(v === undefined ? null : v);
const latest = (dir, re) => fs.readdirSync(dir).filter(f => re.test(f)).sort().pop();

(async () => {
  console.log('=== 重排后独立复核 [只读] ===\n');

  // ---------- 离线：写前快照 + 回滚文件 + 分组树 ----------
  const snapName = latest(PATHS.BACKUP, /^重排写前即时快照_积分商品_/);
  const baseName = latest(PATHS.BACKUP, /^重排前基线_积分商品_/);
  const clsName = latest(PATHS.BACKUP, /^商品分组原始快照_/);
  if (!snapName || !baseName || !clsName) throw new Error('缺少写前快照 / 基线 / 分组树文件');
  const snap = JSON.parse(fs.readFileSync(path.join(PATHS.BACKUP, snapName), 'utf8'));
  const base = JSON.parse(fs.readFileSync(path.join(PATHS.BACKUP, baseName), 'utf8'));
  const cls = JSON.parse(fs.readFileSync(path.join(PATHS.BACKUP, clsName), 'utf8'));
  const before = snap.points || [];
  const onsaleBefore = snap.onsaleSort || [];

  const rbNames = fs.readdirSync(PATHS.BACKUP).filter(f => /^重排回滚_/.test(f)).sort().reverse();
  const rbName = rbNames.find(f => {
    try { return JSON.parse(fs.readFileSync(path.join(PATHS.BACKUP, f), 'utf8')).mode === 'apply'; }
    catch (e) { return false; }
  });
  if (!rbName) throw new Error('找不到 mode=apply 的回滚文件');
  const rb = JSON.parse(fs.readFileSync(path.join(PATHS.BACKUP, rbName), 'utf8'));
  const items = Array.isArray(rb) ? rb : rb.items;

  console.log('写前快照:', snapName, '|', before.length, '条');
  console.log('回滚文件:', rbName, '| mode:', rb.mode, '|', items.length, '条');
  console.log('分组树  :', clsName);

  const beforeMap = new Map(before.map(p => [String(p.goodsId), p]));
  const targetIds = new Set(items.map(x => String(x.goodsId)));
  const newSortMap = new Map(items.map(x => [String(x.goodsId), String(x.newSort)]));

  // 二级分组顺序（与 41 完全相同的口径）
  const onsaleCls = new Map(base.onsaleClassify.map(o => [String(o.goodsId), o.classifyList]));
  const l1 = ((cls.data || cls).goodsClassifyList || []).slice().sort((a, b) => (b.sort || 0) - (a.sort || 0));
  const groupOrder = [];
  l1.forEach(g => (g.childClassifyList || []).slice()
    .sort((a, b) => (b.sort || 0) - (a.sort || 0))
    .forEach(c => groupOrder.push({ name: c.name, parent: g.name })));
  const gi = new Map(groupOrder.map((g, i) => [g.name, i]));
  const g2Of = p => {
    const arr = onsaleCls.get(String(p.goodsId)) || [];
    const lv2 = arr.filter(c => Number(c.level) === 2).map(c => c.name);
    return (lv2.length ? lv2 : arr.map(c => c.name))[0] || '';
  };

  // ---------- 浏览器：只读拉取 ----------
  const ctx = await launch({ headless: true });
  const page = ctx.pages()[0] || await ctx.newPage();
  page.setDefaultTimeout(60000);
  let blocked = 0;
  await page.route('**/api3/**', route => {
    const u = route.request().url();
    if (route.request().method() !== 'GET' && WRITE_VERBS.some(w => u.includes(w))) {
      blocked++; console.error('  [守卫] 阻断写接口:', u); return route.abort();
    }
    return route.continue();
  });

  await page.goto(POINTS_PAGE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);
  if (page.url().includes('account.weimob.com')) {
    console.log('登录中…'); await login(page); await page.waitForTimeout(3000);
    await page.goto(POINTS_PAGE, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(6000);
  }
  const cp = await captureHeaders(page, POINTS_PAGE, EP);
  const hdr = cp.headers, pb = cp.payload || {};

  const readPoints = async () => {
    const out = [];
    for (let pn = 1; pn <= 40; pn++) {
      const j = await post(page, API, { ...pb, pageNum: pn, pageSize: 50 }, hdr);
      if (!isOk(j)) break;
      const l = (j.data && j.data.pageList) || [];
      out.push(...l);
      if (!l.length || l.length < 50) break;
    }
    return out;
  };
  const readOnsale = async () => {
    let gp = null;
    const onReq = r => { if (r.url().includes(EP_GOODS) && r.postData()) { try { gp = JSON.parse(r.postData()); } catch (e) {} } };
    page.on('request', onReq);
    await page.goto(GOODS_PAGE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(7000);
    page.off('request', onReq);
    const out = [];
    if (!gp) return out;
    for (let pn = 1; pn <= 40; pn++) {
      const j = await post(page, API_GOODS, { ...gp, pageNum: pn, pageSize: 20 }, hdr);
      if (!isOk(j)) break;
      const l = (j.data && j.data.pageList) || [];
      out.push(...l);
      if (!l.length || l.length < 20) break;
    }
    return out;
  };

  const live = await readPoints();
  const liveOnsale = await readOnsale();
  await ctx.close();
  console.log('\n线上回读积分商品:', live.length, '| 在售商品:', liveOnsale.length);

  // ---------- 逐项核对 ----------
  const liveMap = new Map(live.map(p => [String(p.goodsId), p]));
  const c1 = live.length === before.length;
  const c1b = new Set(live.map(p => String(p.goodsId))).size === live.length;

  const wrong = items.filter(x => String((liveMap.get(String(x.goodsId)) || {}).sort) !== String(x.newSort));
  const untouched = before.filter(p => !targetIds.has(String(p.goodsId)));
  const untouchedBad = untouched.filter(p => String((liveMap.get(String(p.goodsId)) || {}).sort) !== String(p.sort));

  const oldSet = new Set(before.map(p => String(p.sort)));
  const newSet = new Set(live.map(p => String(p.sort)));
  const lost = [...oldSet].filter(v => !newSet.has(v));
  const added = [...newSet].filter(v => !oldSet.has(v));

  const staticDiffs = [], vol = [];
  live.forEach(p => {
    const b = beforeMap.get(String(p.goodsId));
    if (!b) { staticDiffs.push({ goodsId: p.goodsId, f: '(缺失)' }); return; }
    STATIC.forEach(f => { if (norm(b[f]) !== norm(p[f])) staticDiffs.push({ goodsId: p.goodsId, f }); });
    VOLATILE.forEach(f => { if (norm(b[f]) !== norm(p[f])) vol.push({ goodsId: p.goodsId, f }); });
    const bn = b.pointClassifyInfo && b.pointClassifyInfo.name;
    const an = p.pointClassifyInfo && p.pointClassifyInfo.name;
    if (bn !== an) staticDiffs.push({ goodsId: p.goodsId, f: 'pointClassifyInfo.name' });
  });

  // 展示顺序 = sort 降序；检查「分组序号非递减，同组内积分价非递减」
  const ordered = live.slice().sort((a, b) => Number(b.sort) - Number(a.sort));
  let prevKey = -1, prevPoint = -Infinity, orderBad = [];
  ordered.forEach((p, n) => {
    const g2 = g2Of(p);
    const k = gi.has(g2) ? gi.get(g2) : 99999;
    const pt = Number(p.minPoint);
    if (k < prevKey || (k === prevKey && pt < prevPoint)) orderBad.push({ rank: n + 1, goodsId: p.goodsId, g2, minPoint: pt, prevKey, prevPoint });
    prevKey = k; prevPoint = pt;
  });

  const onBeforeMap = new Map(onsaleBefore.map(o => [String(o.goodsId), String(o.sort)]));
  const onBad = liveOnsale.filter(g => onBeforeMap.has(String(g.goodsId)) && onBeforeMap.get(String(g.goodsId)) !== String(g.sort));

  const rows = [
    ['积分商品条数 = 写前 393', c1 ? 'PASS' : 'FAIL', `${live.length} / ${before.length}`],
    ['商品ID 全唯一', c1b ? 'PASS' : 'FAIL', `${new Set(live.map(p => String(p.goodsId))).size}`],
    ['391 条目标 sort == 计划值', wrong.length === 0 ? 'PASS' : 'FAIL', `不符 ${wrong.length}`],
    ['2 条未写入商品 sort 未变', untouchedBad.length === 0 ? 'PASS' : 'FAIL', `不符 ${untouchedBad.length}`],
    ['sort 值域与写前完全一致', lost.length === 0 && added.length === 0 && newSet.size === live.length ? 'PASS' : 'FAIL', `丢失 ${lost.length} / 新增 ${added.length} / 去重后 ${newSet.size}`],
    ['STATIC 字段零差异', staticDiffs.length === 0 ? 'PASS' : 'FAIL', `差异 ${staticDiffs.length}`],
    ['展示顺序符合「分组优先+价升序」', orderBad.length === 0 ? 'PASS' : 'FAIL', `违例 ${orderBad.length}`],
    ['在售商品 sort 零变化', onBad.length === 0 ? 'PASS' : 'FAIL', `变化 ${onBad.length}`],
    ['其他写接口被阻断次数', blocked === 0 ? 'PASS' : 'WARN', `${blocked}`],
  ];
  console.log('\n=== 独立复核结果 ===');
  rows.forEach(r => console.log(`  ${r[1]}  ${r[0]}  ${r[2]}`));
  if (vol.length) console.log(`  · 业务自然波动 ${vol.length} 处（兑换导致库存/已兑数变化，非本次改动，不修复）`);
  const pass = rows.every(r => r[1] === 'PASS');
  console.log('\n总判定:', pass ? '✔ 全部通过' : '✗ 存在未通过项');

  // ---------- 产物 ----------
  const ts = stamp();
  const csvFile = path.join(PATHS.BACKUP, `兑换商城排序_重排后_${ts}.csv`);
  writeCsv(csvFile,
    ['展示名次', '商品ID', '商品名称', '二级分组', '所属一级', '积分分组', '积分价', '当前sort', '原sort', '是否改动'],
    ordered.map((p, n) => {
      const b = beforeMap.get(String(p.goodsId)) || {};
      const g2 = g2Of(p);
      const k = gi.has(g2) ? gi.get(g2) : -1;
      return [n + 1, p.goodsId, p.title || '', g2, (groupOrder[k] || {}).parent || '',
        (p.pointClassifyInfo && p.pointClassifyInfo.name) || '', p.minPoint, p.sort, b.sort ?? '',
        String(b.sort) !== String(p.sort) ? '改' : '不变'];
    }));
  console.log('\n[最终排序表]', csvFile);

  const mdFile = path.join(PATHS.OUT, `重排后独立复核_${ts}.md`);
  const md = [
    '# 兑换商城重排 · 独立复核报告', '',
    `- 时间：${new Date().toLocaleString('zh-CN')}`,
    `- 口径：重新登录后台只读回读，与「写前即时快照」逐字段比对；本复核过程零写操作`,
    `- 写前快照：\`${snapName}\`｜回滚文件：\`${rbName}\``,
    '', '## 复核项', '', '| 检查项 | 结果 | 明细 |', '|---|---|---|',
    ...rows.map(r => `| ${r[0]} | ${r[1]} | ${r[2]} |`),
    '', `- 业务自然波动：${vol.length} 处（库存 / 可兑数 / 已兑数，线上真实兑换所致，未做任何修复）`,
    `- 总判定：${pass ? '✔ 全部通过' : '✗ 存在未通过项'}`,
    '', '## 回滚方式', '',
    '```bash',
    'node scripts/41-resort-points-by-classify.js --rollback-file=' + rbName,
    '```',
    '', '## 前 20 名', '', '| 名次 | 二级分组 | 商品 | 积分价 | sort |', '|---|---|---|---|---|',
    ...ordered.slice(0, 20).map((p, n) => `| ${n + 1} | ${g2Of(p)} | ${String(p.title || '').replace(/\|/g, '\\|').slice(0, 26)} | ${p.minPoint} | ${p.sort} |`),
  ];
  fs.writeFileSync(mdFile, md.join('\n'), 'utf8');
  console.log('[复核报告]', mdFile);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
