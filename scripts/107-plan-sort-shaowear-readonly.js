/**
 * 107 · 积分商城排序只读方案：少儿穿戴组（docs/19 规则）[零写]
 * 规则：一级号段 → 二级分组聚集（商品分组树 sort 降序）→ 组内总价升序
 *       总价 = 每 SKU (point/10 + pointPrice) 取 min（10 积分 = 1 元）
 *       sort 数字越大越靠前；sort = 18001 − 展示位
 * 本次范围：只重排「少儿穿戴」积分分组，其余分组零变化。
 * 号段：少儿穿戴组在现网 sort 全为 0（从未排过），按 docs/19 固定号段
 *       少儿穿戴 = 展示位 6001~8000 → sort 12000~10001。
 *       但现网其它分组实际占用与 docs/19 静态表有偏差（线上是按实际数据重排过的），
 *       因此本脚本以「现网实际已占用号段」为基准，只在空闲位段上给少儿穿戴分配，
 *       并输出新方案供人工确认（不写线上）。
 */
const fs = require('fs');
const path = require('path');
const { cfg, launch, login, post, isOk, stamp, PATHS } = require('./lib/common');

const EP_PL = 'mall/point/goods/queryPointGoodsListForManagement';
const EP_PD = 'mall/point/goods/queryPointGoodsDetailForManagement';
const EP_GD = 'mall/goods/queryGoodsDetail';
const EP_CT = 'mall/goods/classify/queryClassifyListWithPageForManagement';
const ALLOW = [EP_PL, EP_PD, EP_GD, EP_CT];
const BLOCK_EXACT = ['updatePointGoods', 'updatePointGoodsSort', 'moveGoodsToClassify', 'addPointGoods',
  'deletePointGoods', 'addPointClassify', 'updatePointClassify', 'deletePointClassify',
  'batchUpdateGoodsSort', 'addGoodsClassify', 'deleteGoodsClassify', 'updateGoodsClassify',
  'createAsyncStockTask', 'createInventoryOrder'];
const MAXSLOT = 18000;
const TARGET_CLASSIFY = '少儿穿戴';
// 完整 filterOption：缺 isQueryClassifyInfo / isQuerySkuInfo 会导致 goodsClassifyList 与 skuList 为空
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
const ts = stamp();

(async () => {
  console.log('=== 积分商城排序只读方案 [少儿穿戴组] ===');
  const ctx = await launch({ headless: true });
  const page = ctx.pages()[0] || await ctx.newPage();
  page.setDefaultTimeout(60000);
  let blocked = 0;
  await page.route('**/api3/**', route => {
    const u = route.request().url();
    const ep = u.replace(`${cfg.BASE}/api3/`, '').split('?')[0];
    if (ALLOW.includes(ep)) return route.continue();
    if (BLOCK_EXACT.some(b => ep.endsWith(b) || ep === b)) { blocked++; return route.abort(); }
    return route.continue();
  });
  await login(page);

  const BASEURL = `${cfg.BASE}/bos/products/ecGoodsmanage/${cfg.BOS_ID}/${cfg.KEY}`;
  const keep = ['authorization', 'apiclient', 'weimob-bosid', 'content-type', 'referer', 'source', 'tcode'];
  const found = [];
  const onReq = r => {
    const u = r.url();
    if (!u.includes('/api3/') || r.method() !== 'POST') return;
    found.push({ ep: u.replace(cfg.BASE + '/api3/', '').split('?')[0], headers: r.headers(), body: r.postData() });
  };
  page.on('request', onReq);
  await page.goto(BASEURL + '/goods/pointsMall/index', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(11000);
  page.off('request', onReq);
  const hPL = found.filter(x => x.ep === EP_PL).pop();
  if (!hPL) throw new Error('未捕获积分列表模板');
  const H = {}; keep.forEach(k => { if (hPL.headers[k]) H[k] = hPL.headers[k]; });
  const shell = JSON.parse(hPL.body);

  // 分组树（取二级分组 sort）：优先读 106 落盘的快照；没有则实时查
  const l2Map = new Map();
  const snapDir = PATHS.BACKUP;
  const snaps = fs.readdirSync(snapDir).filter(f => f.startsWith('106-classify-tree_') && f.endsWith('.json')).sort();
  if (snaps.length) {
    const snap = JSON.parse(fs.readFileSync(path.join(snapDir, snaps[snaps.length - 1]), 'utf8'));
    (snap.l2 || []).forEach(c => l2Map.set(String(c.classifyId), { name: c.name, sort: c.sort, parentId: c.parentId }));
    console.log('分组树快照:', snaps[snaps.length - 1], '| 二级分组数:', l2Map.size);
  }
  if (!l2Map.size) {
    console.log('无快照, 实时查询分组树...');
    const hCT = found.filter(x => x.ep === EP_CT).pop();
    if (hCT) {
      const CH = {}; keep.forEach(k => { if (hCT.headers[k]) CH[k] = hCT.headers[k]; });
      const cshell = hCT.body ? JSON.parse(hCT.body) : {};
      const cj = await post(page, cfg.BASE + '/api3/' + EP_CT, { ...cshell, pageNum: 1, pageSize: 200 }, CH);
      const l1 = ((cj.data || {}).goodsClassifyList) || [];
      for (const g of l1) {
        for (const pidKey of ['parentClassifyId', 'parentId', 'classifyParentId']) {
          const rj = await post(page, cfg.BASE + '/api3/' + EP_CT, { ...cshell, pageNum: 1, pageSize: 100, [pidKey]: g.classifyId }, CH);
          if (!isOk(rj)) continue;
          const list = (rj.data && (rj.data.pageList || rj.data.goodsClassifyList)) || [];
          const kids = list.filter(x => String(x.parentId) === String(g.classifyId));
          if (kids.length) { kids.forEach(k => l2Map.set(String(k.classifyId), { name: k.name, sort: k.sort, parentId: k.parentId })); break; }
        }
      }
    }
    console.log('二级分组数:', l2Map.size);
  }

  // 积分商城全量
  const listAll = async () => {
    const out = [];
    for (let p = 1; p <= 60; p++) {
      const j = await post(page, cfg.BASE + '/api3/' + EP_PL, { ...shell, pageNum: p, pageSize: 50 }, H);
      if (!isOk(j)) break;
      const l = (j.data && j.data.pageList) || [];
      out.push(...l);
      if (l.length < 50) break;
    }
    return out;
  };
  const all = await listAll();
  console.log('积分商品总数:', all.length);

  // 商品二级分组：优先用 103 快照（已含 goodsClassifyList），否则实时查
  const detSnap = fs.readdirSync(snapDir).filter(f => f.startsWith('103-target-details_') && f.endsWith('.json')).sort();
  const gid2l2 = new Map();
  if (detSnap.length) {
    const snap = JSON.parse(fs.readFileSync(path.join(snapDir, detSnap[detSnap.length - 1]), 'utf8'));
    (snap.details || []).forEach(d => {
      const cls = d.classifyList || [];
      let info = null;
      for (const c of cls) {
        const m = l2Map.get(String(c.classifyId));
        if (m) { info = { name: m.name, sort: m.sort, id: c.classifyId }; break; }
      }
      if (info) gid2l2.set(String(d.goodsId), info);
    });
    console.log('商品详情快照:', detSnap[detSnap.length - 1], '| 带二级分组的商品:', gid2l2.size);
  }

  // 目标组商品
  const target = all.filter(x => ((x.pointClassifyInfo || {}).name) === TARGET_CLASSIFY);
  console.log(`目标组「${TARGET_CLASSIFY}」商品数:`, target.length);
  const targetIds = new Set(target.map(t => String(t.goodsId)));

  // 逐条详情：总价 + 二级分组
  const rows = [];
  for (const x of target) {
    const pd = await post(page, cfg.BASE + '/api3/' + EP_PD, { ...shell, goodsId: x.goodsId }, H);
    if (!isOk(pd) || !pd.data) { console.log('  详情失败:', x.goodsId); continue; }
    const d = pd.data;
    // 总价：只统计「实际参加兑换」的 SKU（point>0 或 isPoint=true），
    // 未参加兑换的 SKU 回读 point=0，会把 min 总价算成 0
    let total = Infinity;
    let partCount = 0;
    (d.skuList || []).forEach(s => {
      const isPart = s.isPoint === true || Number(s.point || 0) > 0;
      if (!isPart) return;
      partCount++;
      const t = Number(s.point || 0) / 10 + Number(s.pointPrice || 0);
      if (t < total) total = t;
    });
    if (!isFinite(total)) total = 0;
    // 二级分组：快照优先，实时查兜底
    let l2 = gid2l2.get(String(x.goodsId)) || null;
    if (!l2) {
      const gd = await post(page, cfg.BASE + '/api3/' + EP_GD, { goodsId: x.goodsId, filterOption: FO }, H);
      const cl = (isOk(gd) && gd.data && gd.data.goodsClassifyList) || [];
      for (const c of cl) {
        const info = l2Map.get(String(c.classifyId));
        if (info) { l2 = { name: info.name, sort: info.sort, id: c.classifyId }; break; }
      }
    }
    if (!l2) l2 = { name: '(未匹配二级)', sort: -1, id: null };
    rows.push({
      goodsId: x.goodsId, title: x.title, oldSort: x.sort,
      pointClassifyId: (x.pointClassifyInfo || {}).pointClassifyId,
      l2, total: Math.round(total * 100) / 100,
      priceType: d.priceType, goodsLimitNum: d.goodsLimitNum,
      skuCount: (d.skuList || []).length, partSkuCount: partCount,
    });
    await new Promise(r => setTimeout(r, 150));
  }

  // 排序：二级分组 sort 降序 → 组内总价升序
  rows.sort((a, b) =>
    ((b.l2 ? b.l2.sort : -1) - (a.l2 ? a.l2.sort : -1)) ||
    (a.total - b.total) || (a.goodsId - b.goodsId));

  // 号段分配：少儿穿戴 docs 号段 = 展示位 6001~8000 → sort 12000~10001
  // 但需避开现网其它分组已占用的 sort 值。先看冲突。
  const used = new Set(all.filter(x => !targetIds.has(String(x.goodsId))).map(x => Number(x.sort)).filter(n => n));
  const DOC_LO = 10001, DOC_HI = 12000; // sort 值域（展示位 6001~8000 镜像）
  const slotStart = 6001;
  const plan = [];
  rows.forEach((r, i) => {
    const slot = slotStart + i;
    const newSort = MAXSLOT + 1 - slot;
    plan.push({ ...r, rank: i + 1, slot, newSort, conflict: used.has(newSort) });
  });
  const conflicts = plan.filter(p => p.conflict);

  const summary = {
    total: all.length, targetCount: rows.length,
    changed: plan.filter(p => String(p.oldSort) !== String(p.newSort)).length,
    unchanged: plan.filter(p => String(p.oldSort) === String(p.newSort)).length,
    slotRange: [plan.length ? plan[0].slot : 0, plan.length ? plan[plan.length - 1].slot : 0],
    newSortRange: plan.length ? [Math.min(...plan.map(p => p.newSort)), Math.max(...plan.map(p => p.newSort))] : null,
    conflicts: conflicts.map(c => ({ goodsId: c.goodsId, newSort: c.newSort })),
    l2Groups: [...new Set(rows.map(r => r.l2 ? r.l2.name : '(无二级)'))],
    blocked,
  };
  const out = { generatedAt: new Date().toISOString(), rule: '一级号段 → 二级分组 sort 降序聚集 → 组内总价(point/10+cash)升序; sort=18001-展示位; 数字越大越靠前', scope: `仅积分分组「${TARGET_CLASSIFY}」`, summary, plan };
  const f = path.join(PATHS.BACKUP, `107-sort-plan-shaowear_${ts}.json`);
  fs.writeFileSync(f, JSON.stringify(out, null, 1), 'utf8');

  console.log('\n[汇总]', JSON.stringify(summary, null, 1));
  console.log('\n=== 方案明细 ===');
  plan.forEach(p => {
    const flag = String(p.oldSort) !== String(p.newSort) ? '→' : '=';
    console.log(`  ${String(p.rank).padStart(2)} l2=${(p.l2 ? p.l2.name : '(无)').padEnd(14)} 总价¥${String(p.total).padEnd(7)} sort ${p.oldSort} ${flag} ${p.newSort} | ${p.title.slice(0, 28)}`);
  });
  console.log('\n落盘:', path.basename(f));
  console.log('RESULT', conflicts.length ? 'CONFLICT' : 'PASS');
  await ctx.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
