/**
 * 163-sample-sharpener-points.js —— 削笔机积分链路小样：seq25 书包款兑换版，写→回读三查→自动回滚。
 * updatePointGoods 是 SKU 级整体覆盖，顶层 guard 字段从写前详情逐字段照录（docs/15、MEMORY D 节）。
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
const E = PLAN.plan.find(x => x.seq === '25');
const W = E.pointWrites[0];   // 书包款削笔机兑换版
const numEq = (a, b) => Math.abs(Number(a) - Number(b)) < 0.06;

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
let BASIC = {};

(async () => {
  console.log('=== 削笔机积分小样 ===', W.goodsId, W.skuId, W.cur, '->', W.target);
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
          await sleep(1500); continue;
        }
        throw e;
      }
    }
  };
  const readDetail = () => call(EP.detail, { ...listTpl, goodsId: W.goodsId, solutionType: 2 });

  const d0 = await readDetail();
  const s0 = d0.skuList.find(s => s.skuId === W.skuId);
  if (!s0) throw new Error('sku 不在详情');
  console.log('  写前:', s0.point, s0.pointPrice, '可兑', s0.availableChangeNum, 'isPoint', s0.isPoint);

  // 写
  const targets = { [String(W.skuId)]: { point: W.target[0], pointPrice: W.target[1] } };
  await call(EP.update, mkBody(d0, targets));
  await sleep(1200);

  // 回读三查
  const d1 = await readDetail();
  const s1 = d1.skuList.find(s => s.skuId === W.skuId);
  const hit = numEq(s1.point, W.target[0]) && numEq(s1.pointPrice, W.target[1]);
  const cid = d => d.classifyId ?? d.pointClassifyInfo?.pointClassifyId;
  const guardOK = numEq(cid(d1), cid(d0)) && d1.priceType === d0.priceType &&
    d1.goodsLimitNum === d0.goodsLimitNum && numEq(d1.sort, d0.sort) &&
    d1.exchangeTimeType === d0.exchangeTimeType && numEq(d1.visibleInNonExchangeTime, d0.visibleInNonExchangeTime);
  const quotaOK = numEq(s1.availableChangeNum, s0.availableChangeNum) && s1.isPoint === s0.isPoint;
  const otherOK = d1.skuList.filter(s => s.skuId !== W.skuId).every(s => {
    const b = d0.skuList.find(x => x.skuId === s.skuId);
    return b && numEq(s.point, b.point) && numEq(s.pointPrice, b.pointPrice);
  });
  console.log(`  回读: ${s1.point}/${s1.pointPrice} 目标=${hit} guard=${guardOK} 可兑=${quotaOK} 非目标=${otherOK} blocked=${blocked.length}`);
  let pass = hit && guardOK && quotaOK && otherOK && blocked.length === 0;

  // 回滚
  const rbTargets = { [String(W.skuId)]: { point: s0.point, pointPrice: s0.pointPrice } };
  await call(EP.update, mkBody(d1, rbTargets));
  await sleep(1200);
  const d2 = await readDetail();
  const s2 = d2.skuList.find(s => s.skuId === W.skuId);
  const restored = numEq(s2.point, s0.point) && numEq(s2.pointPrice, s0.pointPrice);
  console.log('  回滚复原:', restored);
  pass &= restored;

  const out = path.join(PATHS.BACKUP, '153-sample-seq56-points-ledger.json');
  fs.writeFileSync(out, JSON.stringify({ write: W, before: { point: s0.point, pointPrice: s0.pointPrice,
    availableChangeNum: s0.availableChangeNum, isPoint: s0.isPoint },
    guardBase: W.guardBase, result: pass ? 'PASS' : 'FAIL', restored,
    at: new Date().toISOString() }, null, 1));
  console.log('RESULT:', pass ? 'PASS' : 'FAIL', '台账:', out);
  await ctx.close();
  process.exit(pass ? 0 : 1);
})().catch(e => { console.error('ERROR', e.message); process.exit(2); });
