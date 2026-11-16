// 60-plan-sort.js — 只读建排序计划表（商品列表 sortNum + 积分 sort，号段镜像换算）
// 号段=展示序（学习文具1~2000最前 … 家用电器16001~18000最后）；sort 越大越靠前 → sort = 18001 - 展示位
const fs = require('fs');
const path = require('path');
const { cfg, launch, login, post, isOk, sleep, PATHS } = require('./lib/common');

const EP_GL = 'mall/goods/queryGoodsListWithPageForManagement';
const EP_GD = 'mall/goods/queryGoodsDetail';
const EP_CLS = 'mall/goods/classify/queryAllClassifyListForManagement';
const EP_PL = 'mall/point/goods/queryPointGoodsListForManagement';
const EP_PD = 'mall/point/goods/queryPointGoodsDetailForManagement';
const FO = {
  querySelfPickupSiteShip: true, isQueryAppointmentTimeInfo: true,
  isQueryGoodsAbilitiesDetailInfo: true, isQueryPicInfo: true, isQueryVideoInfo: true,
  isQueryTagInfo: true, isQueryGoodsLimit: true, isQueryClassifyInfo: true,
  isQueryPropertyInfo: true, isQuerySaleInfo: true, isQueryCategoryInfo: true,
  isQueryBrandInfo: true, isQueryAttachInfo: true, isFilterDeleted: true,
  isQueryInvoiceConfig: true, isQueryGoodsStockInfo: true, isQueryGoodsPriceInfo: true,
  isQueryGoodsExtInfo: true, isQuerySetGoodsPriceInfo: true, isQuerySetGoodsSalesInfo: true,
  isQueryAutoOffline: true, isQueryAutoSell: true, isQuerySkuInfo: true,
  isQueryDescInfo: true, queryVidBizType: true,
};
// 号段表（展示序）：一级分组 -> [起始, 结束]
const BANDS = [
  ['学习文具', 1, 2000], ['体育用品', 2001, 4000], ['少儿护理', 4001, 6000],
  ['少儿穿戴', 6001, 8000], ['少儿食品', 8001, 10000], ['家庭日用', 10001, 12000],
  ['读物潮玩', 12001, 14000], ['米面油品', 14001, 16000], ['家用电器', 16001, 18000],
];
const MAXSLOT = 18000;

(async () => {
  const ctx = await launch({ headless: true });
  const page = ctx.pages()[0] || await ctx.newPage();
  await login(page);
  const found = [];
  page.on('request', r => {
    const u = r.url();
    if (!u.includes('/api3/') || r.method() !== 'POST') return;
    const ep = u.replace(cfg.BASE + '/api3/', '').split('?')[0];
    if ([EP_GL, EP_PL, EP_CLS].includes(ep)) {
      try { found.push({ ep, headers: r.headers(), body: JSON.parse(r.postData()) }); } catch {}
    }
  });
  await page.goto(cfg.BASE + '/bos/products/ecGoodsmanage/' + cfg.BOS_ID + '/' + cfg.KEY + '/goods/list', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(11000);
  await page.goto(cfg.BASE + '/bos/products/ecGoodsmanage/' + cfg.BOS_ID + '/' + cfg.KEY + '/goods/pointsMall/index', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(10000);
  const keep = ['authorization', 'apiclient', 'weimob-bosid', 'content-type', 'referer', 'source', 'tcode'];
  const pick = ep => {
    const h = found.filter(x => x.ep === ep).pop();
    if (!h) throw new Error('未捕获模板: ' + ep);
    const headers = {}; keep.forEach(k => { if (h.headers[k]) headers[k] = h.headers[k]; });
    return { headers, payload: h.body };
  };
  const G = pick(EP_GL), P = pick(EP_PL);

  // 分组树：用改后快照（分组结构本轮未变），避免跨模块 basicInfo 问题
  const clsSnap = JSON.parse(fs.readFileSync(path.join(PATHS.BACKUP,
    fs.readdirSync(PATHS.BACKUP).filter(x => x.startsWith('商品分组_改后快照')).sort().pop()), 'utf8'));
  const tree = clsSnap.response.data.goodsClassifyList || [];
  const nodeById = new Map();
  tree.forEach(l1 => {
    nodeById.set(l1.classifyId, { id: l1.classifyId, name: l1.name, level: 1, sort: l1.sort || 0, parentId: 0 });
    (l1.childClassifyList || []).forEach(l2 => {
      nodeById.set(l2.classifyId, { id: l2.classifyId, name: l2.name, level: 2, sort: l2.sort || 0, parentId: l1.classifyId, parentName: l1.name });
    });
  });
  console.log('分组树节点:', nodeById.size);

  // 商品列表全量
  const goods = [];
  for (let p = 1; p <= 60; p++) {
    const j = await post(page, cfg.BASE + '/api3/' + EP_GL, { ...G.payload, pageNum: p, pageSize: 20 }, G.headers);
    if (!isOk(j)) throw new Error('商品列表失败 p' + p);
    const l = j.data.pageList || [];
    goods.push(...l);
    if (l.length < 20 || goods.length >= j.data.totalCount) break;
  }
  console.log('商品:', goods.length);

  // 积分商品全量 + 逐条详情（每SKU 总价）
  const pts = [];
  for (let p = 1; p <= 20; p++) {
    const j = await post(page, cfg.BASE + '/api3/' + EP_PL, { ...P.payload, pageNum: p, pageSize: 50 }, P.headers);
    if (!isOk(j)) throw new Error('积分列表失败');
    const l = j.data.pageList || [];
    pts.push(...l);
    if (l.length < 50) break;
    await sleep(150);
  }
  console.log('积分商品:', pts.length);
  const ptsDet = new Map();
  for (let i = 0; i < pts.length; i++) {
    const j = await post(page, cfg.BASE + '/api3/' + EP_PD, { ...P.payload, goodsId: pts[i].goodsId, solutionType: 2 }, P.headers);
    if (isOk(j) && j.data && (j.data.skuList || []).length) ptsDet.set(pts[i].goodsId, j.data);
    if (i % 80 === 0) { console.log(`  积分详情 ${i}/${pts.length}`); await sleep(150); }
  }
  console.log('积分详情:', ptsDet.size);

  // ---- 分组归属：classifyId -> 号段 ----
  const bandIdxOfName = new Map(BANDS.map(([n], i) => [n, i]));
  const stripSuffix = n => String(n || '').replace(/（兑换）$/, '');
  const bandOf = classifyId => {
    const node = nodeById.get(classifyId);
    if (!node) return null;
    const l1Name = node.level === 1 ? node.name : node.parentName;
    const bi = bandIdxOfName.get(stripSuffix(l1Name));
    return bi === undefined ? null : bi;
  };

  // 按 goodsId 索引商品列表（积分商品是复制体，分组归属从这里取）
  const goodsById = new Map(goods.map(g => [g.goodsId, g]));
  const isTwin = g => (g.classifyList || []).some(c => /（兑换）$/.test(c.name || ''));

  // ---- 商品列表排序：只排不带（兑换）的可见商品，段内价格升序 ----
  const goodsRows = goods.filter(g => !isTwin(g)).map(g => {
    const bands = (g.classifyList || []).map(c => bandOf(c.classifyId)).filter(x => x !== null);
    return {
      goodsId: g.goodsId, title: (g.title || '').slice(0, 24),
      band: bands.length ? Math.min(...bands) : -1,
      price: g.goodsPrice ? (g.goodsPrice.minSalePrice ?? 0) : 0,
      oldSort: g.sort,
    };
  });
  goodsRows.sort((a, b) =>
    (a.band === -1 ? 99 : a.band) - (b.band === -1 ? 99 : b.band) ||
    a.price - b.price || a.goodsId - b.goodsId);
  const goodsPlan = [], goodsLeftover = [];
  const bandCount = new Array(BANDS.length).fill(0);
  goodsRows.forEach(r => {
    if (r.band === -1) { goodsLeftover.push({ ...r, newSort: 0 }); return; }
    if (bandCount[r.band] >= 2000) throw new Error('号段溢出: ' + BANDS[r.band][0]);
    bandCount[r.band]++;
    const slot = BANDS[r.band][1] - 1 + bandCount[r.band]; // 展示位
    goodsPlan.push({ ...r, slot, newSort: MAXSLOT + 1 - slot });
  });

  // ---- 积分排序（段内：二级分组聚集(树 sort 降序) -> 总价升序） ----
  const ptsRows = pts.map(p => {
    const det = ptsDet.get(p.goodsId);
    // 商品分组归属：积分详情无该字段，从商品列表快照按 goodsId 取（复制体挂在（兑换）树）
    const gl = goodsById.get(p.goodsId);
    const clsList = (gl && gl.classifyList) || [];
    const nodes = clsList.map(c => nodeById.get(c.classifyId)).filter(Boolean);
    const l2s = nodes.filter(n => n.level === 2);
    const bands = nodes.map(n => bandOf(n.id)).filter(x => x !== null);
    const totals = det ? (det.skuList || []).map(s => (Number(s.point) || 0) / 10 + (Number(s.pointPrice) || 0)) : [];
    return {
      goodsId: p.goodsId, title: (p.title || '').slice(0, 24),
      pointClassifyId: p.pointClassifyInfo ? p.pointClassifyInfo.pointClassifyId : 0,
      band: bands.length ? Math.min(...bands) : -1,
      // 二级聚集键：sort 降序（越大越靠前），同组多挂取最小 band 分支的节点
      l2: l2s.length ? l2s.sort((a, b) => b.sort - a.sort || (a.name < b.name ? -1 : 1))[0] : null,
      total: totals.length ? Math.min(...totals) : 999999,
      oldSort: p.sort,
    };
  });
  ptsRows.sort((a, b) =>
    (a.band === -1 ? 99 : a.band) - (b.band === -1 ? 99 : b.band) ||
    (b.l2 ? b.l2.sort : -1) - (a.l2 ? a.l2.sort : -1) || ((a.l2 && a.l2.name) || '').localeCompare((b.l2 && b.l2.name) || '') ||
    a.total - b.total || a.goodsId - b.goodsId);
  const ptsPlan = [], ptsLeftover = [];
  const pBandCount = new Array(BANDS.length).fill(0);
  ptsRows.forEach(r => {
    if (r.band === -1) { ptsLeftover.push({ ...r, newSort: 0 }); return; }
    if (pBandCount[r.band] >= 2000) throw new Error('积分号段溢出');
    pBandCount[r.band]++;
    const slot = BANDS[r.band][1] - 1 + pBandCount[r.band];
    ptsPlan.push({ ...r, slot, newSort: MAXSLOT + 1 - slot });
  });

  const summary = {
    at: new Date().toISOString(),
    rule: 'sort=18001-展示位（越大越靠前）; 段=号段表; 商品段内价格升序; 积分段内二级聚集+总价(积分/10+现金)升序',
    goods: { total: goodsRows.length, planned: goodsPlan.length, leftover: goodsLeftover.length, bands: BANDS.map(([n], i) => `${n}=${bandCount[i]}`) },
    points: { total: ptsRows.length, planned: ptsPlan.length, leftover: ptsLeftover.length, bands: BANDS.map(([n], i) => `${n}=${pBandCount[i]}`) },
    sample: { goodsFirst: goodsPlan.slice(0, 3).map(r => `${r.title} band${r.band} slot${r.slot} sort${r.newSort}(旧${r.oldSort})`),
              ptsFirst: ptsPlan.slice(0, 3).map(r => `${r.title} band${r.band} ${(r.l2 && r.l2.name) || '-'} ¥${r.total} slot${r.slot} sort${r.newSort}`) },
  };
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  fs.writeFileSync(path.join(PATHS.BACKUP, `60-sort-plan_${ts}.json`), JSON.stringify({ summary, BANDS, goodsPlan, ptsPlan, goodsLeftover, ptsLeftover }, null, 1), 'utf8');
  console.log('SUMMARY', JSON.stringify(summary, null, 1));
  await ctx.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
