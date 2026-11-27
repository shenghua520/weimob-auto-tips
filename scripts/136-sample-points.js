/**
 * 136-sample-points.js —— 积分链路小样：seq6 兑换版 3 SKU，写→回读三查→自动回滚
 * updatePointGoods 是 SKU 整体覆盖：显式带回 classifyId/priceType/goodsLimitNum/sort/兑换时段，
 * 以及 SKU 级 editChangeNum(可兑数量)/isPoint，防静默重置（docs/15 + 记忆库铁律）。
 */
const fs = require('fs');
const path = require('path');
const { cfg, launch, login, post, isOk, sleep, stamp, PATHS } = require('./lib/common');

const R = `${cfg.BASE}/bos/products/ecGoodsmanage/${cfg.BOS_ID}/${cfg.KEY}`;
const POINTS_URL = `${R}/goods/pointsMall/index`;
const EP = {
  list: 'mall/point/goods/queryPointGoodsListForManagement',
  detail: 'mall/point/goods/queryPointGoodsDetailForManagement',
  update: 'mall/point/goods/updatePointGoods',
};
const WRITE_ALLOW = ['updatePointGoods'];
const WRITE_BLOCK = ['deletePointGoods', 'addPointGoods', 'updatePointGoodsSort', 'moveGoodsToClassify',
  'addPointClassify', 'updatePointClassify', 'deletePointClassify', 'deleteGoods', 'updateGoods',
  'importGoods', 'batchUpdateGoodsSort', 'point/goods/save', 'point/goods/batch'];
const KEEP = ['authorization', 'apiclient', 'weimob-bosid', 'content-type', 'referer', 'source', 'tcode'];
const SCAN = path.resolve(__dirname, '../.scan');
const PLAN = JSON.parse(fs.readFileSync(sortedFs('backup/133-plan_*.json')[0], 'utf8'));
const PDET = JSON.parse(fs.readFileSync(sortedFs('backup/131-points-detail_*.json')[0], 'utf8')).list;
const SEQ = '6';
const numEq = (a, b) => Math.abs(Number(a) - Number(b)) < 0.06;

function sortedFs(pattern) {
  const dir = path.resolve(__dirname, '..');
  const full = path.join(dir, pattern);
  const parent = path.dirname(full);
  const prefix = path.basename(pattern).split('*')[0];
  return fs.readdirSync(parent).filter(f => f.startsWith(prefix)).sort().map(f => path.join(parent, f));
}

(async () => {
  console.log(`=== 积分小样 seq${SEQ} ===`);
  const x = PLAN.plan.find(p => p.seq === SEQ);
  const gid = x.exchGoodsId;
  const d0 = PDET.find(g => g.goodsId === gid);
  if (!d0) throw new Error('无积分详情 gid=' + gid);
  console.log('goodsId', gid, 'SKU写入', x.pointWrites.length);

  const ctx = await launch({ headless: true });
  const page = ctx.pages()[0] || await ctx.newPage();
  page.setDefaultTimeout(60000);
  const blocked = [];
  await page.route('**/api3/**', route => {
    const ep = route.request().url().replace(cfg.BASE + '/api3/', '').split('?')[0];
    if (WRITE_ALLOW.some(b => ep.endsWith(b))) return route.continue();
    if (WRITE_BLOCK.some(b => ep.endsWith(b))) { blocked.push(ep); return route.abort(); }
    return route.continue();
  });
  await login(page);

  const found = [];
  const onReq = r => {
    if (!r.url().includes('/api3/')) return;
    found.push({ ep: r.url().replace(`${cfg.BASE}/api3/`, '').split('?')[0], headers: r.headers(), body: r.postData() });
  };
  page.on('request', onReq);
  await page.goto(POINTS_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(9000);
  page.off('request', onReq);
  const Tlist = found.filter(f => f.ep === EP.list).pop();
  if (!Tlist) throw new Error('未捕获列表模板');
  const H = {};
  KEEP.forEach(k => { if (Tlist.headers[k]) H[k] = Tlist.headers[k]; });
  const basicInfo = Tlist.body ? (JSON.parse(Tlist.body).basicInfo || {}) : {};
  const listTpl = Tlist.body ? JSON.parse(Tlist.body) : {};
  const call = async (ep, body) => {
    const j = await post(page, `${cfg.BASE}/api3/${ep}`, body, H);
    if (!isOk(j)) throw new Error(ep + ':' + JSON.stringify(j).slice(0, 240));
    return j.data;
  };
  const readDetail = async () => call(EP.detail, { ...listTpl, goodsId: gid, solutionType: 2 });

  const mkBody = (skuTargets) => ({
    basicInfo, solutionType: 2, goodsId: gid,
    classifyId: d0.classifyId, priceType: d0.priceType, goodsLimitNum: d0.goodsLimitNum,
    exchangeTimeType: d0.exchangeTimeType, exchangeStartTime: d0.exchangeStartTime,
    exchangeEndTime: d0.exchangeEndTime, visibleInNonExchangeTime: d0.visibleInNonExchangeTime,
    pickupSiteList: d0.pickupSiteList || [], applicablePeopleInfo: d0.applicablePeopleInfo || null,
    skuList: d0.skuList.map(s => {
      const t = skuTargets[String(s.skuId)];
      return {
        skuId: s.skuId,
        editChangeNum: s.availableChangeNum,   // 写字段名 ≠ 回读字段名
        point: t ? t.point : s.point,
        pointPrice: t ? t.pointPrice : s.pointPrice,
        isPoint: s.isPoint,
      };
    }),
    i18n: { language: 'zh-CN', timezone: 8 },
    extendInfo: { refer: 'goods/pointsMall/editGoods', source: 80 },
  });

  const targetMap = {};
  x.pointWrites.forEach(w => { targetMap[String(w.skuId)] = { point: w.target[0], pointPrice: w.target[1] }; });
  console.log('目标:', JSON.stringify(targetMap));

  console.log('\n[1] 写入');
  await call(EP.update, mkBody(targetMap));
  await sleep(400);

  console.log('\n[2] 回读三查');
  const d1 = await readDetail();
  let ok = true;
  for (const w of x.pointWrites) {
    const s = d1.skuList.find(z => z.skuId === w.skuId);
    const hit = s && numEq(s.point, w.target[0]) && numEq(s.pointPrice, w.target[1]);
    console.log(`  ${w.skuId}: ${w.cur} -> ${s ? [s.point, s.pointPrice] : 'MISS'} 目标=${!!hit}`);
    ok &= !!hit;
  }
  const d1Classify = (d1.pointClassifyInfo || {}).pointClassifyId;   // 回读是嵌套，基线是顶层
  const guardPairs = [
    ['classifyId', d0.classifyId, d1Classify, (a, b) => a === b],
    ['priceType', d0.priceType, d1.priceType, (a, b) => a === b],
    ['goodsLimitNum', d0.goodsLimitNum, d1.goodsLimitNum, (a, b) => a === b],
    ['sort', d0.sort, d1.sort, (a, b) => numEq(a, b)],
    ['exchangeTimeType', d0.exchangeTimeType, d1.exchangeTimeType, (a, b) => a === b],
    ['visibleInNonExchangeTime', d0.visibleInNonExchangeTime, d1.visibleInNonExchangeTime, (a, b) => a === b],
  ];
  for (const [k, before, after, eq] of guardPairs) {
    console.log(`  guard ${k}: ${before} -> ${after} ${eq(before, after) ? 'OK' : 'CHANGED'}`);
  }
  const guardOK = guardPairs.every(([, b, a, eq]) => eq(b, a));
  const quotaOK = d1.skuList.every(s => {
    const b = d0.skuList.find(z => z.skuId === s.skuId);
    return b && s.availableChangeNum === b.availableChangeNum;
  });
  console.log('  防重置 guard=', guardOK, ' 可兑数量=', quotaOK, ' blocked=', blocked.length);
  ok &= guardOK && quotaOK && blocked.length === 0;

  console.log('\n[3] 自动回滚');
  const rb = {};
  d0.skuList.forEach(s => { rb[String(s.skuId)] = { point: s.point, pointPrice: s.pointPrice }; });
  await call(EP.update, mkBody(rb));
  await sleep(400);
  const d2 = await readDetail();
  const restored = d2.skuList.every(s => {
    const b = d0.skuList.find(z => z.skuId === s.skuId);
    return b && numEq(s.point, b.point) && numEq(s.pointPrice, b.pointPrice);
  });
  console.log('  回滚复原:', restored);
  ok &= restored;

  const ledger = { seq: SEQ, goodsId: gid, writes: x.pointWrites, guard: {
    classifyId: d0.classifyId, priceType: d0.priceType, goodsLimitNum: d0.goodsLimitNum, sort: d0.sort },
    rollbackSkus: rb, result: ok ? 'PASS' : 'FAIL', rolledBack: restored,
    at: new Date().toISOString(), blocked: blocked.length };
  const p = path.join(PATHS.BACKUP, '136-sample-points-ledger.json');
  fs.writeFileSync(p, JSON.stringify(ledger, null, 1), 'utf8');
  console.log('\nRESULT:', ledger.result, '台账:', p);
  await ctx.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
