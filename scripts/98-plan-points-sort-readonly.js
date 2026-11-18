/**
 * 98 · 积分商城排序只读方案（docs/19 规则）—— 零写
 * 规则: 一级分组号段 → 二级分组聚集(商品分组树 sort 降序) → 组内总价升序
 *       总价 = 每SKU(point/10 + pointPrice) 取 min; sort=18001-展示位(越大越靠前)
 * 只拉当前实时数据 + 生成计划表，绝不写线上。所有写接口路由层 abort。
 */
const fs = require('fs');
const path = require('path');
const { cfg, launch, login, post, isOk, sleep, stamp, PATHS } = require('./lib/common');

const EP_GL = 'mall/goods/queryGoodsListWithPageForManagement';
const EP_CLS = 'mall/goods/classify/queryAllClassifyListForManagement';
const EP_PL = 'mall/point/goods/queryPointGoodsListForManagement';
const EP_PD = 'mall/point/goods/queryPointGoodsDetailForManagement';
const WRITE_VERBS = [
  'updatePointGoodsSort', 'batchUpdateGoodsSort', 'moveGoodsToClassify',
  'addPointGoods', 'deletePointGoods', 'updatePointGoods', 'addPointClassify',
  'updatePointClassify', 'deletePointClassify', '/goods/update', '/goods/delete',
  '/goods/import', 'insertMaterial', 'createGroup', 'batchUpdate', 'setOnline',
];
const BANDS = [
  ['学习文具', 1, 2000], ['体育用品', 2001, 4000], ['少儿护理', 4001, 6000],
  ['少儿穿戴', 6001, 8000], ['少儿食品', 8001, 10000], ['家庭日用', 10001, 12000],
  ['读物潮玩', 12001, 14000], ['米面油品', 14001, 16000], ['家用电器', 16001, 18000],
];
const MAXSLOT = 18000;
const ts = stamp();

(async () => {
  console.log('=== 积分商城排序只读方案 [零写] ===');
  const ctx = await launch({ headless: true });
  const page = ctx.pages()[0] || await ctx.newPage();
  page.setDefaultTimeout(60000);
  let blocked = 0;
  await page.route('**/api3/**', route => {
    const u = route.request().url();
    if (WRITE_VERBS.some(w => u.includes(w))) { blocked++; return route.abort(); }
    return route.continue();
  });
  await login(page);

  const found = [];
  page.on('request', r => {
    const u = r.url();
    if (!u.includes('/api3/') || r.method() !== 'POST') return;
    const ep = u.replace(cfg.BASE + '/api3/', '').split('?')[0];
    if ([EP_GL, EP_CLS, EP_PL].includes(ep)) {
      try { found.push({ ep, headers: r.headers(), body: JSON.parse(r.postData()) }); } catch (e) {}
    }
  });
  const BASEURL = `${cfg.BASE}/bos/products/ecGoodsmanage/${cfg.BOS_ID}/${cfg.KEY}`;
  await page.goto(BASEURL + '/goods/list', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(11000);
  await page.goto(BASEURL + '/goods/pointsMall/index', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(10000);
  const keep = ['authorization', 'apiclient', 'weimob-bosid', 'content-type', 'referer', 'source', 'tcode'];
  const pick = ep => {
    const h = found.filter(x => x.ep === ep).pop();
    if (!h) throw new Error('未捕获模板: ' + ep);
    const headers = {}; keep.forEach(k => { if (h.headers[k]) headers[k] = h.headers[k]; });
    return { headers, payload: h.body };
  };
  const G = pick(EP_GL), P = pick(EP_PL);
  console.log('模板已捕获: 商品列表 + 积分列表');

  // ---- 分组树(实时) ----
  let clsData = null;
  const TC = found.filter(x => x.ep === EP_CLS).pop();
  if (TC) {
    try {
      const j = await post(page, cfg.BASE + '/api3/' + EP_CLS, { ...TC.body, pageNum: 1, pageSize: 200 }, TC.headers);
      if (isOk(j)) clsData = j.data;
    } catch (e) { console.log('  分组树接口失败:', e.message.slice(0, 80)); }
  }
  // fallback: 用 11-16 改后快照(分组结构本轮未变)
  if (!clsData || !(clsData.goodsClassifyList || []).length) {
    const dir = 'D:/workbuddy/2026-11-16-09-28-03/weimob-auto-tips-main/backup';
    const f = fs.readdirSync(dir).filter(x => x.startsWith('商品分组_改后快照')).sort().pop();
    clsData = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).response.data;
    console.log('  分组树用快照 fallback:', f);
  }
  const tree = clsData.goodsClassifyList || [];
  const nodeById = new Map();
  tree.forEach(l1 => {
    nodeById.set(l1.classifyId, { id: l1.classifyId, name: l1.name, level: 1, sort: l1.sort || 0, parentId: 0 });
    (l1.childClassifyList || []).forEach(l2 => {
      nodeById.set(l2.classifyId, { id: l2.classifyId, name: l2.name, level: 2, sort: l2.sort || 0, parentId: l1.classifyId, parentName: l1.name });
    });
  });
  console.log('分组树节点:', nodeById.size);

  // ---- 商品列表全量(取积分复制体的分组归属) ----
  const goods = [];
  for (let p = 1; p <= 60; p++) {
    const j = await post(page, cfg.BASE + '/api3/' + EP_GL, { ...G.payload, pageNum: p, pageSize: 20 }, G.headers);
    if (!isOk(j)) break;
    const l = j.data.pageList || [];
    goods.push(...l);
    if (l.length < 20 || goods.length >= j.data.totalCount) break;
  }
  console.log('商品列表:', goods.length);

  // ---- 积分商品全量 + 详情(算总价) ----
  const pts = [];
  for (let p = 1; p <= 20; p++) {
    const j = await post(page, cfg.BASE + '/api3/' + EP_PL, { ...P.payload, pageNum: p, pageSize: 50 }, P.headers);
    if (!isOk(j)) break;
    const l = j.data.pageList || [];
    pts.push(...l);
    if (l.length < 50) break;
    await sleep(120);
  }
  console.log('积分商品:', pts.length);
  const ptsDet = new Map();
  for (let i = 0; i < pts.length; i++) {
    try {
      const j = await post(page, cfg.BASE + '/api3/' + EP_PD, { ...P.payload, goodsId: pts[i].goodsId, solutionType: 2 }, P.headers);
      if (isOk(j) && j.data && (j.data.skuList || []).length) ptsDet.set(pts[i].goodsId, j.data);
    } catch (e) {}
    if (i % 80 === 0) { console.log(`  积分详情 ${i}/${pts.length}`); await sleep(120); }
  }
  console.log('积分详情:', ptsDet.size);

  // ---- 排序计算 ----
  const bandIdxOfName = new Map(BANDS.map(([n], i) => [n, i]));
  const stripSuffix = n => String(n || '').replace(/（兑换）$/, '');
  const bandOf = cid => {
    const node = nodeById.get(cid);
    if (!node) return null;
    const l1 = node.level === 1 ? node.name : node.parentName;
    const bi = bandIdxOfName.get(stripSuffix(l1));
    return bi === undefined ? null : bi;
  };
  const goodsById = new Map(goods.map(g => [String(g.goodsId), g]));

  const rows = pts.map(p => {
    const det = ptsDet.get(p.goodsId);
    const gl = goodsById.get(String(p.goodsId));
    const clsList = (gl && gl.classifyList) || [];
    const nodes = clsList.map(c => nodeById.get(c.classifyId)).filter(Boolean);
    const l2s = nodes.filter(n => n.level === 2);
    const bands = nodes.map(n => bandOf(n.id)).filter(x => x !== null);
    const totals = det ? (det.skuList || []).map(s => (Number(s.point) || 0) / 10 + (Number(s.pointPrice) || 0)) : [];
    return {
      goodsId: p.goodsId, title: (p.title || '').slice(0, 30),
      code: p.outerGoodsCode || '',
      pointClassifyId: p.pointClassifyInfo ? p.pointClassifyInfo.pointClassifyId : 0,
      pointClassifyName: p.pointClassifyInfo ? p.pointClassifyInfo.name : '',
      band: bands.length ? Math.min(...bands) : -1,
      bandName: bands.length ? BANDS[Math.min(...bands)][0] : '(未匹配)',
      l2: l2s.length ? l2s.sort((a, b) => b.sort - a.sort || (a.name < b.name ? -1 : 1))[0] : null,
      total: totals.length ? Math.min(...totals) : 999999,
      skuCount: det ? (det.skuList || []).length : 0,
      oldSort: p.sort,
    };
  });
  rows.sort((a, b) =>
    (a.band === -1 ? 99 : a.band) - (b.band === -1 ? 99 : b.band) ||
    (b.l2 ? b.l2.sort : -1) - (a.l2 ? a.l2.sort : -1) ||
    ((a.l2 && a.l2.name) || '').localeCompare((b.l2 && b.l2.name) || '') ||
    a.total - b.total || a.goodsId - b.goodsId);

  const plan = [], leftover = [];
  const bandCount = new Array(BANDS.length).fill(0);
  rows.forEach((r, i) => {
    if (r.band === -1) { leftover.push({ ...r, rank: i + 1, newSort: 0 }); return; }
    bandCount[r.band]++;
    const slot = BANDS[r.band][1] - 1 + bandCount[r.band];
    plan.push({ ...r, rank: i + 1, slot, newSort: MAXSLOT + 1 - slot });
  });
  const changed = plan.filter(x => String(x.oldSort) !== String(x.newSort));
  const unmatchedL2 = plan.filter(x => !x.l2);

  // 体育用品组单独视图(本次改动范围)
  const tiyu = plan.filter(x => x.bandName === '体育用品');
  const tiyuChanged = tiyu.filter(x => String(x.oldSort) !== String(x.newSort));

  const out = {
    generatedAt: new Date().toISOString(),
    rule: '一级号段 → 二级分组 sort 降序聚集 → 组内总价(point/10+cash)升序; sort=18001-展示位; 数字越大越靠前',
    summary: {
      totalPoints: pts.length, details: ptsDet.size, planned: plan.length,
      leftover: leftover.length, changed: changed.length, unchanged: plan.length - changed.length,
      unmatchedL2: unmatchedL2.length,
      tiyu: { count: tiyu.length, changed: tiyuChanged.length },
      bands: BANDS.map(([n], i) => `${n}=${bandCount[i]}`),
    },
    tiyuPlan: tiyu.map(x => ({ rank: x.rank, goodsId: x.goodsId, code: x.code, title: x.title,
      l2: x.l2 ? x.l2.name : '(无)', l2sort: x.l2 ? x.l2.sort : null, total: +x.total.toFixed(2),
      skuCount: x.skuCount, oldSort: x.oldSort, newSort: x.newSort, changed: String(x.oldSort) !== String(x.newSort) })),
    fullPlan: plan,
    leftover,
    blockedWrites: blocked,
  };
  const f = path.join(PATHS.BACKUP, `98-sort-plan-readonly_${ts}.json`);
  fs.writeFileSync(f, JSON.stringify(out, null, 1), 'utf8');
  console.log('\n=== SUMMARY ===');
  console.log(JSON.stringify(out.summary, null, 1));
  console.log('\n=== 体育用品组 排序方案(本次改动范围) ===');
  console.log('名次 | 二级分组 | 总价 | ID | 名称 | sort旧→新');
  tiyu.forEach(x => console.log(`  ${x.rank} | ${(x.l2 && x.l2.name) || '-'} | ¥${x.total.toFixed(2)} | ${x.goodsId} | ${x.title.slice(0,18)} | ${x.oldSort}→${x.newSort}${String(x.oldSort)!==String(x.newSort)?' *':''}`));
  console.log('\n[计划表]', path.basename(f));
  console.log('守卫阻断写请求数:', blocked, '(应为0, 因全程只读)');
  await ctx.close();
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
