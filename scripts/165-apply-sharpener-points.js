/**
 * 165-apply-sharpener-points.js —— 削笔机积分批量（6 兑换商品），复用 139 已验证的 guard 带回逻辑。
 * 小样已 PASS（153）。每单写前快照 → 写 → 回读目标/guard/可兑/非目标 → 台账；失败 3 次中止。
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
const ALLOW = ['updatePointGoods'];
const BLOCK = ['deletePointGoods', 'addPointGoods', 'updatePointGoodsSort', 'moveGoodsToClassify',
  'addPointClassify', 'updatePointClassify', 'deletePointClassify', 'deleteGoods', 'updateGoods',
  'importGoods', 'batchUpdateGoodsSort'];
const KEEP = ['authorization', 'apiclient', 'weimob-bosid', 'content-type', 'referer', 'source', 'tcode'];
const ROOT = path.resolve(__dirname, '..');
const newest = pat => fs.readdirSync(path.join(ROOT, path.dirname(pat)))
  .filter(f => f.startsWith(path.basename(pat).split('*')[0])).sort()
  .map(f => path.join(ROOT, path.dirname(pat), f)).pop();
const PLAN = JSON.parse(fs.readFileSync(newest('backup/161-sharpener-plan_*.json'), 'utf8'));
const numEq = (a, b) => Math.abs(Number(a) - Number(b)) < 0.06;
const WRITES = PLAN.plan.flatMap(e => e.pointWrites.map(w => ({ ...w, seq: e.seq })));
const cid = d => d.classifyId ?? d.pointClassifyInfo?.pointClassifyId;
const LEDGER = path.join(PATHS.BACKUP, `165-sharpener-points-ledger_${Date.now()}.json`);
let BASIC = {};

const mkBody = (d0, targets) => ({
  basicInfo: BASIC, solutionType: 2, goodsId: d0.goodsId,
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

(async () => {
  console.log('=== 削笔机积分批量 ===', WRITES.length, '处');
  const ctx = await launch({ headless: true });
  const page = ctx.pages()[0] || await ctx.newPage();
  page.setDefaultTimeout(60000);
  const blocked = [];
  await page.route('**/api3/**', route => {
    const ep = route.request().url().replace(cfg.BASE + '/api3/', '').split('?')[0];
    if (ALLOW.some(b => ep.endsWith(b))) return route.continue();
    if (BLOCK.some(b => ep.endsWith(b))) { blocked.push(ep); return route.abort(); }
    return route.continue();
  });
  await login(page);
  const found = [];
  const onReq = r => {
    if (!r.url().includes('/api3/')) return;
    found.push({ ep: r.url().replace(`${cfg.BASE}/api3/`, '').split('?')[0],
                 headers: r.headers(), body: r.postData() });
  };
  page.on('request', onReq);
  await page.goto(POINTS_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(9000);
  page.off('request', onReq);
  const tpl = found.filter(f => f.ep === EP.list).pop();
  if (!tpl) throw new Error('未捕获列表模板');
  const H = {};
  KEEP.forEach(k => { if (tpl.headers[k]) H[k] = tpl.headers[k]; });
  BASIC = tpl.body ? (JSON.parse(tpl.body).basicInfo || {}) : {};
  const listTpl = tpl.body ? JSON.parse(tpl.body) : {};
  const call = async (ep, body) => {
    for (let i = 0; i < 3; i++) {
      try {
        const j = await post(page, `${cfg.BASE}/api3/${ep}`, body, H);
        if (!isOk(j)) throw new Error(ep + ':' + JSON.stringify(j).slice(0, 200));
        return j.data;
      } catch (e) {
        if (i < 2 && /Failed to fetch|NetworkError|fetch failed|timeout/i.test(e.message)) {
          console.log('    网络重试', e.message.slice(0, 50)); await sleep(1500); continue;
        }
        throw e;
      }
    }
  };
  const readDetail = gid => call(EP.detail, { ...listTpl, goodsId: gid, solutionType: 2 });

  const records = [];
  for (const w of WRITES) {
    const d0 = await readDetail(w.goodsId);
    const s0 = d0.skuList.find(s => s.skuId === w.skuId);
    if (!s0) throw new Error('sku 不在详情: ' + w.skuId);
    const targets = { [String(w.skuId)]: { point: w.target[0], pointPrice: w.target[1] } };
    await call(EP.update, mkBody(d0, targets));
    await sleep(1000);
    const d1 = await readDetail(w.goodsId);
    const s1 = d1.skuList.find(s => s.skuId === w.skuId);
    const hit = numEq(s1.point, w.target[0]) && numEq(s1.pointPrice, w.target[1]);
    const guardOK = d1.classifyId === d0.classifyId && d1.priceType === d0.priceType &&
      d1.goodsLimitNum === d0.goodsLimitNum && numEq(d1.sort, d0.sort) &&
      d1.exchangeTimeType === d0.exchangeTimeType;
    const quotaOK = numEq(s1.availableChangeNum, s0.availableChangeNum) && s1.isPoint === s0.isPoint;
    const st = (hit && guardOK && quotaOK) ? 'ok' : 'verify_fail';
    records.push({ goodsId: w.goodsId, skuId: w.skuId, status: st,
      cur: [s0.point, s0.pointPrice], target: w.target,
      rollback: [{ skuId: w.skuId, point: s0.point, pointPrice: s0.pointPrice,
                   editChangeNum: s0.availableChangeNum, isPoint: s0.isPoint }],
      guardBase: w.guardBase, at: new Date().toISOString() });
    console.log(`  gid=${w.goodsId}: (${s0.point},${s0.pointPrice})->(${s1.point},${s1.pointPrice}) 目标=${hit} guard=${guardOK} 可兑=${quotaOK} ${st}`);
    fs.writeFileSync(LEDGER, JSON.stringify({ records, blocked, at: new Date().toISOString() }, null, 1));
    if (st !== 'ok') throw new Error('回读失败，中止');
  }
  console.log('RESULT:', 'PASS', '台账:', LEDGER, 'blocked:', blocked.length);
  await ctx.close();
  process.exit(0);
})().catch(e => { console.error('ERROR', e.message); process.exit(2); });
