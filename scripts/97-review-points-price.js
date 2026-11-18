/**
 * 97 · 积分商城改价+新增 独立只读 review（七步法第6步）
 * 全新登录、不复用 95 写入脚本任何结果；写接口路由层全部 abort（零写）
 * 三轮 review:
 *   R1 样本级   —— 抽 5 条看业务合理性(数值/分组/库存/限购/模式)
 *   R2 全量级   —— 不带过滤条件全量扫描; 字段分 STATIC(变即失败)/VOLATILE(只报告)
 *   R3 归因级   —— 时间窗 + 主键区间 + 具体ID存在性 三路交叉
 * 独立路径: 另起脚本 + 重新登录 + 重新拉全量列表 + 逐条 detail，均不经写入脚本。
 */
const fs = require('fs');
const path = require('path');
const { cfg, launch, login, post, isOk, sleep, stamp, PATHS } = require('./lib/common');

const R = `${cfg.BASE}/bos/products/ecGoodsmanage/${cfg.BOS_ID}/${cfg.KEY}`;
const POINTS_URL = `${R}/goods/pointsMall/index`;
const EP = {
  list: 'mall/point/goods/queryPointGoodsListForManagement',
  detail: 'mall/point/goods/queryPointGoodsDetailForManagement',
};
const WRITE_BLOCK = [
  'updatePointGoods', 'addPointGoods', 'deletePointGoods', 'updatePointGoodsSort',
  'moveGoodsToClassify', 'addPointClassify', 'updatePointClassify', 'deletePointClassify',
  'point/goods/save', 'point/goods/batch', 'deleteGoods', '/goods/update', '/goods/delete',
  'importGoods', 'batchUpdateGoodsSort',
];
const KEEP = ['authorization', 'apiclient', 'weimob-bosid', 'content-type', 'referer', 'source', 'tcode'];
const SCAN = path.resolve(__dirname, '../.scan');
const PLAN = JSON.parse(fs.readFileSync(path.join(SCAN, 'price_plan2.json'), 'utf8'));
const ROLLBACK = JSON.parse(fs.readFileSync(path.join(SCAN, 'price_rollback2.json'), 'utf8'));
// 基线: 改价前 94 导出
const BASE_LIST = JSON.parse(fs.readFileSync(path.join(PATHS.BACKUP, '94-points-list_2026-11-17T09-09-50.json'), 'utf8'));
const BASE_DETAIL = JSON.parse(fs.readFileSync(path.join(PATHS.BACKUP, '94-points-detail_2026-11-17T09-09-50.json'), 'utf8'));
const ts = stamp();
const numEq = (a, b) => Math.abs(Number(a) - Number(b)) < 0.06;
const out = path.join(PATHS.BACKUP, `97-review_${ts}.json`);

(async () => {
  console.log('=== 97 独立只读 review (全新登录, 零写) ===');
  const ctx = await launch({ headless: true });
  const page = ctx.pages()[0] || await ctx.newPage();
  page.setDefaultTimeout(60000);
  const blocked = [];
  await page.route('**/api3/**', route => {
    const u = route.request().url();
    if (WRITE_BLOCK.some(b => u.includes(b))) { blocked.push(u); console.log('  [守卫ABORT]', u.split('/api3/')[1]); return route.abort(); }
    return route.continue();
  });
  await login(page);

  const found = [];
  const onReq = r => {
    const u = r.url();
    if (!u.includes('/api3/')) return;
    found.push({ ep: u.replace(`${cfg.BASE}/api3/`, '').split('?')[0], headers: r.headers(), body: r.postData() });
  };
  page.on('request', onReq);
  await page.goto(POINTS_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(10000);
  page.off('request', onReq);
  const Tlist = found.filter(x => x.ep === EP.list).pop();
  if (!Tlist) throw new Error('未捕获列表模板');
  const H = {};
  KEEP.forEach(k => { if (Tlist.headers[k]) H[k] = Tlist.headers[k]; });
  const tpl = Tlist.body ? JSON.parse(Tlist.body) : {};
  const call = async (ep, body) => {
    const j = await post(page, `${cfg.BASE}/api3/${ep}`, body, H);
    if (!isOk(j)) throw new Error(ep + ':' + JSON.stringify(j).slice(0, 200));
    return j.data;
  };

  // ===== 独立路径: 重新拉全量积分商品列表 =====
  const items = [];
  for (let p = 1; p <= 30; p++) {
    const d = await call(EP.list, { ...tpl, pageNum: p, pageSize: 50 });
    const l = d.pageList || [];
    items.push(...l);
    if (l.length < 50) break;
    await sleep(120);
  }
  console.log('现网积分商品列表:', items.length, ' 基线:', BASE_LIST.total);
  const byId = new Map(items.map(x => [String(x.goodsId), x]));
  const baseById = new Map(BASE_LIST.list.map(x => [String(x.goodsId), x]));

  const updateIds = new Set(PLAN.update.map(x => String(x.goodsId)));
  const addIds = new Set(PLAN.add.map(x => String(x.goodsId)));
  const report = { reviewedAt: new Date().toISOString(), listNow: items.length, listBase: BASE_LIST.total, blocked: blocked.length,
    R1: [], R2: {}, R3: {}, nonTarget: {}, verdict: 'PENDING' };

  // ===== R3 归因级: 时间窗(写入at) + 主键区间 + ID存在性 三路交叉 =====
  const lu = JSON.parse(fs.readFileSync(path.join(PATHS.BACKUP, fs.readdirSync(PATHS.BACKUP).filter(x=>/^95-update-ledger_/.test(x)).sort().pop()), 'utf8'));
  const la = JSON.parse(fs.readFileSync(path.join(PATHS.BACKUP, fs.readdirSync(PATHS.BACKUP).filter(x=>/^95-add-ledger_/.test(x)).sort().pop()), 'utf8'));
  const times = [...lu, ...la].map(x => x.at).sort();
  const ids = [...updateIds, ...addIds].map(Number);
  report.R3 = {
    timeWindow: { first: times[0], last: times[times.length - 1], spanMin: +(((new Date(times[times.length-1]) - new Date(times[0]))/60000).toFixed(2)) },
    idRange: { min: Math.min(...ids), max: Math.max(...ids) },
    existCheck: {
      updateAllExist: [...updateIds].every(id => byId.has(id)),
      addAllExist: [...addIds].every(id => byId.has(id)),
      addWereAbsentInBase: [...addIds].every(id => !baseById.has(id)),
      updateWerePresentInBase: [...updateIds].every(id => baseById.has(id)),
      missingUpdate: [...updateIds].filter(id => !byId.has(id)),
      missingAdd: [...addIds].filter(id => !byId.has(id)),
    },
    listDelta: items.length - BASE_LIST.total,
    addCount: addIds.size,
  };
  console.log('R3 归因:', JSON.stringify(report.R3));

  // ===== 逐条 detail 回读 (89 目标 + 抽验非目标) =====
  const targets = [
    ...PLAN.update.map(x => ({ kind: 'update', ...x })),
    ...PLAN.add.map(x => ({ kind: 'add', ...x })),
  ];
  const detailResults = [];
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    try {
      const d = await call(EP.detail, { ...tpl, goodsId: t.goodsId, solutionType: 2 });
      detailResults.push({ kind: t.kind, goodsId: t.goodsId, d });
    } catch (e) {
      detailResults.push({ kind: t.kind, goodsId: t.goodsId, err: e.message.slice(0, 160) });
    }
    if ((i + 1) % 20 === 0) console.log('  detail', i + 1, '/', targets.length);
    await sleep(120);
  }

  // ===== R2 全量级: 字段分 STATIC(变即失败)/VOLATILE(只报告) =====
  const STATIC_FAIL = [];
  const VOLATILE = [];
  for (const r of detailResults) {
    if (r.err) { STATIC_FAIL.push({ goodsId: r.goodsId, why: 'DETAIL_ERR ' + r.err }); continue; }
    const d = r.d;
    const skus = d.skuList || [];
    if (r.kind === 'update') {
      const u = PLAN.update.find(x => String(x.goodsId) === String(r.goodsId));
      const rb = ROLLBACK[String(r.goodsId)];
      const gd = rb.guard;
      // STATIC: 目标价格
      for (const s of skus) {
        if (!numEq(s.point, u.target_point) || !numEq(s.pointPrice, u.target_pointPrice))
          STATIC_FAIL.push({ goodsId: r.goodsId, sku: s.skuId, why: `目标价不符 ${s.point}/${s.pointPrice}≠${u.target_point}/${u.target_pointPrice}` });
      }
      if (skus.length !== u.sku_list.length)
        STATIC_FAIL.push({ goodsId: r.goodsId, why: `SKU数不符 ${skus.length}≠${u.sku_list.length}` });
      // STATIC: 防重置字段(分组/模式/限购/sort/可兑数量)
      if (d.pointClassifyInfo && d.pointClassifyInfo.pointClassifyId !== gd.classifyId)
        STATIC_FAIL.push({ goodsId: r.goodsId, why: '分组被冲' });
      if (d.priceType !== gd.priceType) STATIC_FAIL.push({ goodsId: r.goodsId, why: '模式被冲 ' + d.priceType });
      if (d.goodsLimitNum !== gd.goodsLimitNum) STATIC_FAIL.push({ goodsId: r.goodsId, why: '限购被冲 ' + d.goodsLimitNum });
      if (!numEq(d.sort, gd.sort)) STATIC_FAIL.push({ goodsId: r.goodsId, why: `sort被冲 ${d.sort}≠${gd.sort}` });
      for (const s of skus) {
        const o = rb.skuList.find(z => String(z.skuId) === String(s.skuId));
        if (o && s.availableChangeNum !== o.editChangeNum)
          STATIC_FAIL.push({ goodsId: r.goodsId, sku: s.skuId, why: `可兑数量被冲 ${s.availableChangeNum}≠${o.editChangeNum}` });
      }
    } else {
      const a = PLAN.add.find(x => String(x.goodsId) === String(r.goodsId));
      // STATIC: 新增兑换值/分组/模式/限购/库存
      const want = a.skuTargets.map(t => `${t.point}/${t.pointPrice}`).sort().join(',');
      const got = skus.map(s => `${s.point}/${s.pointPrice}`).sort().join(',');
      if (want !== got) STATIC_FAIL.push({ goodsId: r.goodsId, why: `兑换值不符 ${got}≠${want}` });
      if (skus.length !== a.skuTargets.length) STATIC_FAIL.push({ goodsId: r.goodsId, why: `SKU数不符 ${skus.length}≠${a.skuTargets.length}` });
      if (!d.pointClassifyInfo || d.pointClassifyInfo.pointClassifyId !== a.pointClassifyId)
        STATIC_FAIL.push({ goodsId: r.goodsId, why: '分组不符' });
      if (d.priceType !== 3) STATIC_FAIL.push({ goodsId: r.goodsId, why: '模式非兑换版 ' + d.priceType });
      if (d.goodsLimitNum !== 1) STATIC_FAIL.push({ goodsId: r.goodsId, why: '限购≠1 ' + d.goodsLimitNum });
      for (const s of skus) {
        if (s.availableChangeNum !== 999) STATIC_FAIL.push({ goodsId: r.goodsId, sku: s.skuId, why: `库存≠999 ${s.availableChangeNum}` });
      }
    }
    VOLATILE.push({ goodsId: r.goodsId, kind: r.kind, sort: d.sort, updateTime: d.updateTime || byId.get(String(r.goodsId))?.updateTime || null });
  }
  report.R2 = { targets: targets.length, detailsOk: detailResults.filter(x => !x.err).length,
    detailsErr: detailResults.filter(x => x.err).length, staticFailCount: STATIC_FAIL.length,
    staticFails: STATIC_FAIL, volatileSample: VOLATILE.slice(0, 5) };
  console.log('R2 全量: 目标', targets.length, 'STATIC失败', STATIC_FAIL.length, 'VOLATILE只报告', VOLATILE.length);

  // ===== 非目标零变化: 基线有、非本次目标 的商品, 比对列表层价格字段 =====
  const nonTargetBase = BASE_LIST.list.filter(x => !updateIds.has(String(x.goodsId)) && !addIds.has(String(x.goodsId)));
  const changed = [];
  for (const b of nonTargetBase) {
    const now = byId.get(String(b.goodsId));
    if (!now) { changed.push({ goodsId: b.goodsId, why: '非目标消失' }); continue; }
    // 列表层比对外显价格字段(JSON字符串化关键字段)
    const keys = ['minPointPrice', 'minPoint', 'pointPriceType', 'priceType', 'salePrice', 'goodsStatus'];
    for (const k of keys) {
      if (JSON.stringify(b[k]) !== JSON.stringify(now[k])) {
        changed.push({ goodsId: b.goodsId, key: k, before: b[k], after: now[k] });
      }
    }
  }
  report.nonTarget = { count: nonTargetBase.length, changedCount: changed.length, changed: changed.slice(0, 30) };
  console.log('非目标检查:', nonTargetBase.length, '个, 变化', changed.length);

  // ===== R1 样本级: 抽 5 条(边界型: 多SKU + 新增)看业务合理性 =====
  const multiSku = PLAN.update.filter(x => x.sku_list.length >= 2).slice(0, 3);
  const samplePick = [...multiSku, ...PLAN.add.slice(0, 2)];
  report.R1 = samplePick.map(t => {
    const r = detailResults.find(x => String(x.goodsId) === String(t.goodsId));
    const d = r && r.d;
    return {
      goodsId: t.goodsId, title: t.title, kind: r && r.kind,
      target: t.kind || (t.target_point ? `${t.target_point}豆/${t.target_pointPrice}元` : `${t.skuTargets?.[0]?.point}豆/${t.skuTargets?.[0]?.pointPrice}元`),
      gotSkus: d ? (d.skuList || []).map(s => ({ sku: s.skuId, point: s.point, pointPrice: s.pointPrice, 库存: s.availableChangeNum })) : null,
      mode: d ? d.priceType : null, limit: d ? d.goodsLimitNum : null,
      classify: d && d.pointClassifyInfo ? d.pointClassifyInfo.name : null,
      sort: d ? d.sort : null,
    };
  });
  console.log('R1 样本:', JSON.stringify(report.R1, null, 1).slice(0, 1500));

  // ===== 总判定 =====
  const verdict =
    (report.R3.existCheck.updateAllExist && report.R3.existCheck.addAllExist &&
     report.R3.existCheck.addWereAbsentInBase && report.R3.existCheck.updateWerePresentInBase &&
     report.R3.listDelta === report.R3.addCount &&
     STATIC_FAIL.length === 0 && changed.length === 0) ? 'PASS' : 'FAIL';
  report.verdict = verdict;
  fs.writeFileSync(out, JSON.stringify(report, null, 1), 'utf8');
  console.log('\n=== REVIEW VERDICT:', verdict, '===');
  console.log('报告落盘:', path.basename(out));
  console.log('守卫拦截写请求数:', blocked.length);
  await ctx.close();
  if (verdict !== 'PASS') process.exit(2);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
