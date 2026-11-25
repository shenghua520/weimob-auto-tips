/**
 * 109 · 少儿穿戴积分商城 独立只读复核（七步法第 6 步）
 *
 * 独立性：
 *   - 另起脚本、重新登录、重新拉全量列表 + 逐条 detail，全程只读；
 *   - 期望值一律取「写入前的独立产物」，不复用 104/108 写入脚本的任何回读结果：
 *       加品期望  .scan/shaowear_addpoint_plan.json      （写入前计划）
 *       排序期望  backup/107-sort-plan-shaowear_*.json   （写入前只读方案，独立脚本 107）
 *       写前基线  backup/99-sort-baseline_*.json          （写入前全量 427 条，独立脚本 99）
 *       库存底数  backup/103-target-details_*.json        （商品库 SKU 库存）
 *       分组树    backup/106-classify-tree_*.json          （二级分组 sort）
 *   - 路由层守卫：写端点一律 abort，页面上任何非只读 POST 全部拦下并计数。
 *
 * 三轮：
 *   R1 样本级   —— 抽 5 条目标商品（组首/组末/分组交界/SKU最多/全局末）看业务合理性
 *   R2 全量级   —— 21 新增 + 4 原有 逐条 detail 比对；字段分 STATIC(变即失败) / VOLATILE(只报告)
 *   R3 归因级   —— 时间窗 + ID 存在性 + 集合差（不多不少）+ 非目标零变化
 *   R4 规则复算 —— 用现网数据独立重算 docs/19 排序规则，与现网 sort 逐位比对
 */
const fs = require('fs');
const path = require('path');
const { cfg, launch, login, post, isOk, sleep, stamp, PATHS } = require('./lib/common');

const EP_PL = 'mall/point/goods/queryPointGoodsListForManagement';
const EP_PD = 'mall/point/goods/queryPointGoodsDetailForManagement';
const EP_GD = 'mall/goods/queryGoodsDetail';
const EP_CT = 'mall/goods/classify/queryClassifyListWithPageForManagement';
const READ_ALLOW = [EP_PL, EP_PD, EP_GD, EP_CT];
// 写端点：动词前缀正则 + 精确端点名 endsWith（避免 updatePointGoodsSort 被 updatePointGoods 子串误伤）
const WRITE_EXACT = ['updatePointGoods', 'addPointGoods', 'deletePointGoods', 'updatePointGoodsSort',
  'moveGoodsToClassify', 'addPointClassify', 'updatePointClassify', 'deletePointClassify',
  'batchUpdateGoodsSort', 'addGoodsClassify', 'deleteGoodsClassify', 'updateGoodsClassify',
  'updateGoods', 'addGoods', 'deleteGoods', 'saveGoods', 'importGoods', 'copyGoods',
  'batchUpdateGoods', 'batchDeleteGoods', 'createAsyncStockTask', 'createInventoryOrder'];
const WRITE_RE = /(^|\/)(add|update|delete|save|create|modify|import|copy|move|batch|replace|remove|publish|offline|sync|submit|apply|edit|reset)[A-Z]/;

const SCAN = path.resolve(__dirname, '../.scan');
const ts = stamp();
const latest = (dir, prefix, suffix = '.json') => {
  const f = fs.readdirSync(dir).filter(x => x.startsWith(prefix) && x.endsWith(suffix)).sort();
  if (!f.length) throw new Error('找不到文件: ' + prefix);
  return path.join(dir, f[f.length - 1]);
};
const PLAN_ADD = JSON.parse(fs.readFileSync(path.join(SCAN, 'shaowear_addpoint_plan.json'), 'utf8'));
const PLAN_SORT = JSON.parse(fs.readFileSync(latest(PATHS.BACKUP, '107-sort-plan-shaowear_'), 'utf8'));
const BASE = JSON.parse(fs.readFileSync(latest(PATHS.BACKUP, '99-sort-baseline_'), 'utf8'));
const DET103 = JSON.parse(fs.readFileSync(latest(PATHS.BACKUP, '103-target-details_'), 'utf8'));
const TREE = JSON.parse(fs.readFileSync(latest(PATHS.BACKUP, '106-classify-tree_'), 'utf8'));
const LED_ADD = JSON.parse(fs.readFileSync(latest(PATHS.BACKUP, '104-addpoint-ledger_apply_'), 'utf8'));
const LED_SORT = JSON.parse(fs.readFileSync(latest(PATHS.BACKUP, '108-sort-ledger_apply_'), 'utf8'));

const KEEP = ['authorization', 'apiclient', 'weimob-bosid', 'content-type', 'referer', 'source', 'tcode'];
const numEq = (a, b) => Math.abs(Number(a || 0) - Number(b || 0)) < 0.005;
const CLASSIFY_ID = '59464100397';   // 积分分组「少儿穿戴」
const NEW_SORT_LO = 11976, NEW_SORT_HI = 12000;
const SLOT_BASE = 6001, SORT_MIRROR = 18001;

const rep = {
  reviewedAt: new Date().toISOString(),
  sources: {
    planAdd: '.scan/shaowear_addpoint_plan.json',
    planSort: path.basename(latest(PATHS.BACKUP, '107-sort-plan-shaowear_')),
    baseline: path.basename(latest(PATHS.BACKUP, '99-sort-baseline_')),
    detail103: path.basename(latest(PATHS.BACKUP, '103-target-details_')),
    tree106: path.basename(latest(PATHS.BACKUP, '106-classify-tree_')),
  },
  R1: [], R2: {}, R3: {}, R4: {}, guard: {}, verdict: 'PENDING',
};

(async () => {
  console.log('=== 109 独立只读复核 · 少儿穿戴积分商城（全新登录 / 零写） ===');
  const ctx = await launch({ headless: true });
  const page = ctx.pages()[0] || await ctx.newPage();
  page.setDefaultTimeout(60000);

  const guard = { aborted: [], allowedNonQuery: [], blockedCount: 0 };
  await page.route('**/api3/**', route => {
    const u = route.request().url();
    const ep = u.replace(cfg.BASE + '/api3/', '').split('?')[0];
    const isWrite = WRITE_EXACT.some(w => ep.endsWith(w) || ep === w) || WRITE_RE.test(ep);
    if (isWrite) { guard.aborted.push(ep); guard.blockedCount++; return route.abort(); }
    if (!READ_ALLOW.includes(ep) && !ep.includes('query')) guard.allowedNonQuery.push(ep);
    return route.continue();
  });
  await login(page);

  const BASEURL = `${cfg.BASE}/bos/products/ecGoodsmanage/${cfg.BOS_ID}/${cfg.KEY}`;
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
  const T = found.filter(x => x.ep === EP_PL).pop();
  if (!T) throw new Error('未捕获积分列表模板');
  const H = {}; KEEP.forEach(k => { if (T.headers[k]) H[k] = T.headers[k]; });
  const shell = JSON.parse(T.body || '{}');

  const call = async (ep, body) => {
    const j = await post(page, `${cfg.BASE}/api3/${ep}`, body, H);
    if (!isOk(j)) throw new Error(ep + ' => ' + JSON.stringify(j).slice(0, 180));
    return j.data;
  };
  const listAll = async () => {
    const out = [];
    for (let p = 1; p <= 60; p++) {
      const d = await call(EP_PL, { ...shell, pageNum: p, pageSize: 50 });
      const l = d.pageList || [];
      out.push(...l);
      if (l.length < 50) break;
      await sleep(100);
    }
    return out;
  };

  // ===== 独立重新拉取 =====
  const now = await listAll();
  const nowById = new Map(now.map(x => [String(x.goodsId), x]));
  console.log('现网积分商品总数:', now.length, '| 写前基线:', BASE.baseline.length);
  const baseById = new Map(BASE.baseline.map(x => [String(x.goodsId), x]));

  const planAddIds = new Set(PLAN_ADD.rows.map(r => String(r.goodsId)));
  const planSortById = new Map(PLAN_SORT.plan.map(p => [String(p.goodsId), p]));
  const sortTargetIds = new Set(planSortById.keys());
  const preExistingTargets = [...sortTargetIds].filter(id => baseById.has(id));   // 原有4条（零库存）
  const addedTargets = [...sortTargetIds].filter(id => !baseById.has(id));       // 本轮新增21条

  // ===== R3 归因级：ID 存在性 + 集合差（不多不少） =====
  const baseIds = new Set(baseById.keys());
  const nowIds = new Set(nowById.keys());
  const addedNow = [...nowIds].filter(id => !baseIds.has(id));
  const removedNow = [...baseIds].filter(id => !nowIds.has(id));
  const extraAdded = addedNow.filter(id => !planAddIds.has(id));      // 计划外的新增（应为 0）
  const missingAdded = [...planAddIds].filter(id => !nowIds.has(id)); // 计划内未落地（应为 0）
  const times = [
    LED_ADD.startedAt, LED_ADD.startedAt,
    LED_SORT.startedAt, LED_SORT.startedAt,
    BASE.generatedAt,
  ].filter(Boolean).sort();
  rep.R3 = {
    timeWindow: { baselineAt: BASE.generatedAt, addLedgerAt: LED_ADD.startedAt, sortLedgerAt: LED_SORT.startedAt },
    listNow: now.length, listBase: BASE.baseline.length,
    delta: now.length - BASE.baseline.length,
    planAddCount: planAddIds.size,
    addedNowCount: addedNow.length,
    addedEqualsPlan: addedNow.length === planAddIds.size && extraAdded.length === 0 && missingAdded.length === 0,
    extraAdded, missingAdded,
    removedNowCount: removedNow.length, removedNow,
    targetAllExist: [...sortTargetIds].every(id => nowIds.has(id)),
    preExistingTargetsInBase: preExistingTargets.length,
    addedTargetsInBase: addedTargets.length,
  };
  console.log('R3 归因:', JSON.stringify(rep.R3, null, 1));

  // ===== 逐条 detail（25 个排序目标 + 3 个非目标抽查） =====
  const detailOf = async gid => {
    try { return await call(EP_PD, { ...shell, goodsId: gid }); }
    catch (e) { return { __err: e.message }; }
  };
  const details = new Map();
  const sortedTargets = PLAN_SORT.plan.map(p => String(p.goodsId));
  for (const gid of sortedTargets) {
    details.set(gid, await detailOf(gid));
    await sleep(120);
  }
  const nonTargetSample = [...nowIds].filter(id => !sortTargetIds.has(id)).slice(0, 3);
  for (const gid of nonTargetSample) {
    details.set(gid, await detailOf(gid));
    await sleep(120);
  }

  // ===== R2 全量级 STATIC =====
  const STATIC_FAIL = [], VOLATILE = [];
  const stockMap = new Map();   // skuId -> {editQuantity, isDisabled}
  (DET103.details || []).forEach(d => (d.skuList || []).forEach(s =>
    stockMap.set(String(s.skuId), { editQuantity: s.editQuantity, isDisabled: s.isDisabled, spec: s.specValueName })));
  const l2Map = new Map((TREE.l2 || []).map(x => [String(x.classifyId), { name: x.name, sort: x.sort, id: x.classifyId }]));
  const gid2l2 = new Map();
  (DET103.details || []).forEach(d => {
    for (const c of (d.classifyList || [])) {
      const m = l2Map.get(String(c.classifyId));
      if (m) { gid2l2.set(String(d.goodsId), m); break; }
    }
  });

  // --- R2-1 新增 21 条：逐 SKU 价格 / 可兑数量 / 限兑 / 分组 / 模式 ---
  const addChecks = [];
  for (const r of PLAN_ADD.rows) {
    const gid = String(r.goodsId);
    const d = details.get(gid) || {};
    const issues = [];
    if (d.__err) issues.push('DETAIL_ERR ' + d.__err);
    const liveSkus = d.skuList || [];
    const liveBySku = new Map(liveSkus.map(s => [String(s.skuId), s]));
    const cid = String((d.pointClassifyInfo || {}).pointClassifyId ?? d.classifyId ?? '');
    if (cid !== CLASSIFY_ID) issues.push(`分组≠少儿穿戴 ${cid}`);
    if (Number(d.goodsLimitNum) !== 1) issues.push(`限兑≠1 ${d.goodsLimitNum}`);
    if (Number(d.priceType) !== 3) issues.push(`模式≠3 ${d.priceType}`);
    const ps = PLAN_SORT.plan.find(p => String(p.goodsId) === gid);
    if (ps && Number(d.sort) !== Number(ps.newSort)) issues.push(`sort=${d.sort} 期望${ps.newSort}`);
    for (const s of r.skuList) {
      const live = liveBySku.get(String(s.skuId));
      if (!live) { issues.push(`SKU缺失 ${s.skuId}(${s.spec})`); continue; }
      if (!numEq(live.point, s.point) || !numEq(live.pointPrice, s.pointPrice))
        issues.push(`价格不符 ${s.skuId} ${live.point}/${live.pointPrice}≠${s.point}/${s.pointPrice}`);
      if (Number(live.availableChangeNum) !== Number(r.changeNum))
        issues.push(`可兑数量=${live.availableChangeNum}≠${r.changeNum}`);
      if (live.isPoint !== true) issues.push(`isPoint≠true ${s.skuId}`);
      // 库存约束：只允许有货且未禁用的 SKU 进商城
      const st = stockMap.get(String(s.skuId));
      if (!st) issues.push(`库存底数缺失 ${s.skuId}`);
      else {
        if (!(Number(st.editQuantity) > 0)) issues.push(`零库存SKU被加入 ${s.skuId}(${st.spec})`);
        if (st.isDisabled === true) issues.push(`禁用SKU被加入 ${s.skuId}(${st.spec})`);
      }
    }
    const livePart = liveSkus.filter(s => s.isPoint === true || Number(s.point || 0) > 0);
    if (livePart.length !== r.skuList.length)
      issues.push(`参加兑换SKU数 ${livePart.length}≠计划${r.skuList.length}`);
    const rec = { goodsId: gid, title: r.title, skuCount: r.skuList.length, issues, ok: !issues.length };
    addChecks.push(rec);
    if (issues.length) STATIC_FAIL.push({ scope: '新增21条', goodsId: gid, issues });
    VOLATILE.push({ goodsId: gid, sort: d.sort, availableSum: liveSkus.reduce((a, s) => a + Number(s.availableChangeNum || 0), 0) });
  }

  // --- R2-2 原有 4 条（零库存）：仅 sort 应变，其余字段与写前基线一致 ---
  const preChecks = [];
  for (const gid of preExistingTargets) {
    const d = details.get(gid) || {};
    const b = baseById.get(gid);
    const ps = planSortById.get(gid);
    const issues = [];
    if (d.__err) issues.push('DETAIL_ERR ' + d.__err);
    if (ps && Number(d.sort) !== Number(ps.newSort)) issues.push(`sort=${d.sort} 期望${ps.newSort}`);
    const cid = String((d.pointClassifyInfo || {}).pointClassifyId ?? d.classifyId ?? '');
    if (cid !== CLASSIFY_ID) issues.push(`分组≠少儿穿戴 ${cid}`);
    if (Number(d.goodsLimitNum) !== Number(b.goodsLimitNum)) issues.push(`限兑被改 ${d.goodsLimitNum}≠${b.goodsLimitNum}`);
    if (Number(d.priceType) !== Number(b.priceType)) issues.push(`模式被改 ${d.priceType}≠${b.priceType}`);
    const liveSkus = d.skuList || [];
    const liveMinPoint = liveSkus.length ? Math.min(...liveSkus.map(s => Number(s.point || 0))) : 0;
    const liveMinPrice = liveSkus.length ? Math.min(...liveSkus.map(s => Number(s.pointPrice || 0))) : 0;
    if (!numEq(liveMinPoint, b.minPoint)) issues.push(`minPoint被改 ${liveMinPoint}≠${b.minPoint}`);
    if (!numEq(liveMinPrice, b.minPointPrice)) issues.push(`minPointPrice被改 ${liveMinPrice}≠${b.minPointPrice}`);
    const rec = { goodsId: gid, title: (nowById.get(gid) || {}).title, oldSort: b.sort, newSort: ps && ps.newSort, issues, ok: !issues.length };
    preChecks.push(rec);
    if (issues.length) STATIC_FAIL.push({ scope: '原有4条', goodsId: gid, issues });
  }

  // --- R2-3 少儿穿戴分组内恰好 25 条，且非目标商品不落进新号段 ---
  const groupItems = now.filter(x => String((x.pointClassifyInfo || {}).pointClassifyId) === CLASSIFY_ID);
  const groupIds = new Set(groupItems.map(x => String(x.goodsId)));
  if (groupItems.length !== 25) STATIC_FAIL.push({ scope: '分组构成', why: `少儿穿戴组 ${groupItems.length} 条 ≠ 25` });
  for (const gid of groupIds) if (!sortTargetIds.has(gid)) STATIC_FAIL.push({ scope: '分组构成', goodsId: gid, why: '组内出现非目标商品' });
  const inNewRange = now.filter(x => !sortTargetIds.has(String(x.goodsId)) &&
    Number(x.sort) >= NEW_SORT_LO && Number(x.sort) <= NEW_SORT_HI);
  if (inNewRange.length) STATIC_FAIL.push({ scope: '号段占用', list: inNewRange.map(x => ({ goodsId: x.goodsId, sort: x.sort })) });

  // --- R2-4 非目标 423 条零变化（sort / 价格 / 模式 / 限兑 / 分组 / 兑换时段可见性） ---
  const nonTarget = [];
  for (const b of BASE.baseline) {
    const gid = String(b.goodsId);
    if (sortTargetIds.has(gid)) continue;
    const a = nowById.get(gid);
    if (!a) { nonTarget.push({ goodsId: gid, why: '消失' }); continue; }
    const diffs = [];
    if (Number(a.sort) !== Number(b.sort)) diffs.push(`sort ${b.sort}→${a.sort}`);
    if (!numEq(a.minPoint, b.minPoint)) diffs.push(`minPoint ${b.minPoint}→${a.minPoint}`);
    if (!numEq(a.minPointPrice, b.minPointPrice)) diffs.push(`minPointPrice ${b.minPointPrice}→${a.minPointPrice}`);
    if (Number(a.priceType) !== Number(b.priceType)) diffs.push(`priceType ${b.priceType}→${a.priceType}`);
    if (Number(a.goodsLimitNum) !== Number(b.goodsLimitNum)) diffs.push(`goodsLimitNum ${b.goodsLimitNum}→${a.goodsLimitNum}`);
    if (String((a.pointClassifyInfo || {}).pointClassifyId) !== String(b.pointClassifyId)) diffs.push('分组改变');
    if (a.visibleInNonExchangeTime !== b.visibleInNonExchangeTime) diffs.push('visibleInNonExchangeTime改变');
    if (diffs.length) nonTarget.push({ goodsId: gid, title: b.title, diffs });
  }
  if (nonTarget.length) STATIC_FAIL.push({ scope: '非目标零变化', list: nonTarget.slice(0, 30), count: nonTarget.length });

  rep.R2 = {
    targets: sortedTargets.length,
    addChecked: addChecks.length, addOk: addChecks.filter(x => x.ok).length,
    preChecked: preChecks.length, preOk: preChecks.filter(x => x.ok).length,
    groupItems: groupItems.length,
    nonTargetChecked: BASE.baseline.length - sortTargetIds.size + addedTargets.length,
    nonTargetChanged: nonTarget.length,
    staticFailCount: STATIC_FAIL.length, staticFails: STATIC_FAIL,
    volatileSample: VOLATILE.slice(0, 5),
  };
  console.log('R2 全量: 新增', rep.R2.addOk, '/', rep.R2.addChecked, '原有', rep.R2.preOk, '/', rep.R2.preChecked,
    '非目标变化', nonTarget.length, 'STATIC失败', STATIC_FAIL.length);

  // ===== R4 规则独立复算：docs/19（号段 → 二级分组 sort 降序 → 组内总价升序） =====
  const recomputed = [];
  for (const gid of sortedTargets) {
    const d = details.get(gid) || {};
    const skus = (d.skuList || []).filter(s => s.isPoint === true || Number(s.point || 0) > 0);
    let total = Infinity;
    skus.forEach(s => { const t = Number(s.point || 0) / 10 + Number(s.pointPrice || 0); if (t < total) total = t; });
    if (!isFinite(total)) total = 0;
    const l2 = gid2l2.get(gid) || { name: '(未匹配二级)', sort: -1, id: null };
    recomputed.push({ goodsId: gid, title: d.title || (nowById.get(gid) || {}).title, l2, total: Math.round(total * 100) / 100, liveSort: Number(d.sort) });
  }
  recomputed.sort((a, b) => ((b.l2.sort - a.l2.sort) || (a.total - b.total) || (a.goodsId - b.goodsId)));
  const r4Issues = [];
  recomputed.forEach((r, i) => {
    const expectSort = SORT_MIRROR - (SLOT_BASE + i);
    if (r.liveSort !== expectSort) r4Issues.push({ goodsId: r.goodsId, why: `现网sort=${r.liveSort} 复算=${expectSort} (第${i + 1}位)` });
  });
  // 现网展示序（sort 降序）是否 == 复算序
  const liveOrder = groupItems.slice().sort((a, b) => Number(b.sort) - Number(a.sort)).map(x => String(x.goodsId));
  const calcOrder = recomputed.map(r => String(r.goodsId));
  const orderMatch = JSON.stringify(liveOrder) === JSON.stringify(calcOrder);
  // 组内总价升序
  const groupAsc = [];
  for (const g of ['书包（兑换）', '健康体态（兑换）']) {
    const arr = recomputed.filter(r => r.l2.name === g).map(r => r.total);
    const asc = arr.every((v, i) => i === 0 || v >= arr[i - 1]);
    groupAsc.push({ group: g, count: arr.length, totals: arr, ascending: asc });
    if (!asc) r4Issues.push({ scope: '组内总价', group: g, why: '总价非升序' });
  }
  rep.R4 = {
    rule: 'docs/19：二级分组 sort 降序聚集 → 组内总价(min(point/10+cash))升序 → sort=18001-展示位',
    recomputedOrder: recomputed.map((r, i) => ({ rank: i + 1, sort: SORT_MIRROR - (SLOT_BASE + i), liveSort: r.liveSort, l2: r.l2.name, total: r.total, title: (r.title || '').slice(0, 26) })),
    orderMatch, groups: groupAsc, issues: r4Issues,
  };
  console.log('R4 规则复算: 展示序一致', orderMatch, '| 问题', r4Issues.length);

  // ===== R1 样本级 =====
  const pickIdx = [0, 19, 20, 21, 24];
  const picks = [...new Set(pickIdx.map(i => PLAN_SORT.plan[i]).filter(Boolean))];
  const maxSku = PLAN_ADD.rows.slice().sort((a, b) => b.skuList.length - a.skuList.length)[0];
  const picks2 = picks.concat([maxSku]);
  rep.R1 = picks2.map(p => {
    const gid = String(p.goodsId || maxSku.goodsId);
    const d = details.get(gid) || {};
    const skus = (d.skuList || []).filter(s => s.isPoint === true || Number(s.point || 0) > 0);
    const stock = skus.map(s => { const st = stockMap.get(String(s.skuId)); return st ? st.editQuantity : null; });
    return {
      goodsId: gid, title: (d.title || p.title || '').slice(0, 30),
      l2: (gid2l2.get(gid) || {}).name || null,
      sort: d.sort, expectSort: (planSortById.get(gid) || {}).newSort,
      classify: (d.pointClassifyInfo || {}).name || CLASSIFY_ID,
      priceType: d.priceType, goodsLimitNum: d.goodsLimitNum,
      skuCount: skus.length,
      skus: skus.map(s => ({ spec: (stockMap.get(String(s.skuId)) || {}).spec, point: s.point, pointPrice: s.pointPrice, changeNum: s.availableChangeNum })),
      库存全为正: stock.every(v => Number(v) > 0),
    };
  });
  console.log('\nR1 样本:');
  rep.R1.forEach(r => console.log(`  gid=${r.goodsId} l2=${r.l2} sort=${r.sort}/${r.expectSort} 限兑=${r.goodsLimitNum} SKU=${r.skuCount} 库存全为正=${r.库存全为正} | ${r.title}`));

  // ===== 守卫与总判定 =====
  rep.guard = { blockedWrites: guard.blockedCount, aborted: guard.aborted.slice(0, 20), allowedNonQuery: [...new Set(guard.allowedNonQuery)].slice(0, 20) };
  const verdict = (
    rep.R3.addedEqualsPlan && rep.R3.removedNowCount === 0 && rep.R3.targetAllExist &&
    STATIC_FAIL.length === 0 && r4Issues.length === 0 && orderMatch &&
    rep.R2.addOk === rep.R2.addChecked && rep.R2.preOk === rep.R2.preChecked &&
    guard.blockedCount === 0
  ) ? 'PASS' : 'FAIL';
  rep.verdict = verdict;
  const out = path.join(PATHS.BACKUP, `109-review-shaowear_${ts}.json`);
  fs.writeFileSync(out, JSON.stringify(rep, null, 1), 'utf8');
  console.log('\n[汇总]', JSON.stringify({
    verdict, listNow: rep.R3.listNow, listBase: rep.R3.listBase,
    addedNow: rep.R3.addedNowCount, planAdd: rep.R3.planAddCount, removed: rep.R3.removedNowCount,
    addOk: rep.R2.addOk, preOk: rep.R2.preOk, nonTargetChanged: rep.R2.nonTargetChanged,
    staticFail: STATIC_FAIL.length, r4Issues: r4Issues.length, orderMatch,
    blockedWrites: guard.blockedCount,
  }, null, 1));
  console.log('报告落盘:', path.basename(out));
  console.log('REVIEW VERDICT:', verdict);
  await ctx.close();
  if (verdict !== 'PASS') process.exit(2);
})().catch(e => { console.error('FATAL', e.stack || e.message); process.exit(1); });
