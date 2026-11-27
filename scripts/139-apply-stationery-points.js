/**
 * 139-apply-stationery-points.js —— 积分价批量同步（68 商品 / 195 SKU）
 * 小样已 PASS（136）。每单回读验证目标价 + guard + 可兑数量；失败 >3 中止；逐条台账断点续跑。
 */
const fs = require('fs');
const path = require('path');
const { cfg, launch, login, post, isOk, sleep, PATHS } = require('./lib/common');

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
const ROOT = path.resolve(__dirname, '..');
const newest = pat => fs.readdirSync(path.join(ROOT, path.dirname(pat)))
  .filter(f => f.startsWith(path.basename(pat).split('*')[0])).sort()
  .map(f => path.join(ROOT, path.dirname(pat), f)).pop();
const PLAN = JSON.parse(fs.readFileSync(newest('backup/133-plan_*.json'), 'utf8'));
const PDET = JSON.parse(fs.readFileSync(newest('backup/131-points-detail_*.json'), 'utf8')).list;
const numEq = (a, b) => Math.abs(Number(a) - Number(b)) < 0.06;
const LEDGER = path.join(PATHS.BACKUP, `139-points-ledger_${Date.now()}.json`);
const FAIL_THRESHOLD = 3;

(async () => {
  console.log('=== 积分价批量同步 ===');
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
    // 网络级重试（"Failed to fetch" 是页面上下文网络抖动，不是业务错误）
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const j = await post(page, `${cfg.BASE}/api3/${ep}`, body, H);
        if (!isOk(j)) throw new Error(ep + ':' + JSON.stringify(j).slice(0, 220));
        return j.data;
      } catch (e) {
        if (attempt < 2 && /Failed to fetch|NetworkError|fetch failed|timeout/i.test(e.message)) {
          console.log(`    网络重试 ${ep} #${attempt + 1}: ${e.message.slice(0, 60)}`);
          await sleep(1500);
          continue;
        }
        throw e;
      }
    }
  };
  const readDetail = gid => call(EP.detail, { ...listTpl, goodsId: gid, solutionType: 2 });

  const mkBody = (d0, targets) => ({
    basicInfo, solutionType: 2, goodsId: d0.goodsId,
    classifyId: d0.classifyId, priceType: d0.priceType, goodsLimitNum: d0.goodsLimitNum,
    exchangeTimeType: d0.exchangeTimeType, exchangeStartTime: d0.exchangeStartTime,
    exchangeEndTime: d0.exchangeEndTime, visibleInNonExchangeTime: d0.visibleInNonExchangeTime,
    pickupSiteList: d0.pickupSiteList || [], applicablePeopleInfo: d0.applicablePeopleInfo || null,
    skuList: d0.skuList.map(s => {
      const t = targets[String(s.skuId)];
      return { skuId: s.skuId, editChangeNum: s.availableChangeNum,
               point: t ? t.point : s.point, pointPrice: t ? t.pointPrice : s.pointPrice,
               isPoint: s.isPoint };
    }),
    i18n: { language: 'zh-CN', timezone: 8 },
    extendInfo: { refer: 'goods/pointsMall/editGoods', source: 80 },
  });

  // 按 goodsId 汇总写入
  const byGid = new Map();
  for (const x of PLAN.plan) {
    for (const w of x.pointWrites) {
      if (!byGid.has(w.goodsId)) byGid.set(w.goodsId, []);
      byGid.get(w.goodsId).push(w);
    }
  }
  let done = new Set();
  if (fs.existsSync(LEDGER)) {
    for (const r of JSON.parse(fs.readFileSync(LEDGER, 'utf8')).records) {
      if (r.status === 'ok') done.add(r.goodsId);
    }
  }
  const todo = [...byGid.entries()].filter(([gid]) => !done.has(gid));
  console.log(`待写 ${todo.length} / ${byGid.size} 商品，${todo.reduce((n, [, ws]) => n + ws.length, 0)} SKU`);
  const records = [];
  let failures = 0;
  const flush = () => fs.writeFileSync(LEDGER, JSON.stringify({ at: new Date().toISOString(),
    records, failures, total: byGid.size, blocked: blocked.length }, null, 1), 'utf8');

  for (let i = 0; i < todo.length; i++) {
    const [gid, ws] = todo[i];
    const d0 = PDET.find(g => g.goodsId === gid);
    try {
      if (!d0) throw new Error('无基线详情');
      const targets = {};
      ws.forEach(w => { targets[String(w.skuId)] = { point: w.target[0], pointPrice: w.target[1] }; });
      await call(EP.update, mkBody(d0, targets));
      await sleep(260);
      const d1 = await readDetail(gid);
      const need = ws.every(w => {
        const s = d1.skuList.find(z => z.skuId === w.skuId);
        return s && numEq(s.point, w.target[0]) && numEq(s.pointPrice, w.target[1]);
      });
      const d1c = (d1.pointClassifyInfo || {}).pointClassifyId;
      const guard = d1c === d0.classifyId && d1.priceType === d0.priceType &&
        d1.goodsLimitNum === d0.goodsLimitNum && numEq(d1.sort, d0.sort) &&
        d1.exchangeTimeType === d0.exchangeTimeType;
      const quota = d1.skuList.every(s => {
        const b = d0.skuList.find(z => z.skuId === s.skuId);
        return b && s.availableChangeNum === b.availableChangeNum;
      });
      const status = (need && guard && quota) ? 'ok' : 'verify_fail';
      records.push({ goodsId: gid, skuCount: ws.length, status, need, guard, quota,
        rollback: d0.skuList.map(s => ({ skuId: s.skuId, point: s.point, pointPrice: s.pointPrice,
          editChangeNum: s.availableChangeNum, isPoint: s.isPoint })),
        guardBase: { classifyId: d0.classifyId, priceType: d0.priceType,
          goodsLimitNum: d0.goodsLimitNum, sort: d0.sort, exchangeTimeType: d0.exchangeTimeType,
          exchangeStartTime: d0.exchangeStartTime, exchangeEndTime: d0.exchangeEndTime,
          visibleInNonExchangeTime: d0.visibleInNonExchangeTime,
          pickupSiteList: d0.pickupSiteList || [], applicablePeopleInfo: d0.applicablePeopleInfo || null },
        at: new Date().toISOString() });
      if (status !== 'ok') failures++;
      console.log(`  [${i + 1}/${todo.length}] gid=${gid} ${ws.length}SKU ${status}`);
    } catch (e) {
      failures++;
      records.push({ goodsId: gid, status: 'error', err: e.message.slice(0, 260), at: new Date().toISOString() });
      console.log(`  [${i + 1}/${todo.length}] gid=${gid} ERROR ${e.message.slice(0, 100)}`);
    }
    flush();
    if (failures > FAIL_THRESHOLD) { console.log(`失败 ${failures} > ${FAIL_THRESHOLD}，中止`); break; }
    await sleep(150);
  }
  console.log(`\n完成 OK ${records.filter(r => r.status === 'ok').length}/${records.length}；失败 ${failures}；守卫ABORT ${blocked.length}；台账 ${LEDGER}`);
  await ctx.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
