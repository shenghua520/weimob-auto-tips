/**
 * 157-review-seq56-points.js —— seq56 积分独立复核：新开浏览器、重新登录、重新拉2个兑换商品详情，
 * 不复用 155 写入脚本的任何回读结果。核对 point/pointPrice 目标值 + guard 字段 + 非目标 SKU。
 */
const fs = require('fs');
const path = require('path');
const { cfg, launch, login, post, isOk, sleep, PATHS } = require('./lib/common');

const R = `${cfg.BASE}/bos/products/ecGoodsmanage/${cfg.BOS_ID}/${cfg.KEY}`;
const POINTS_URL = `${R}/goods/pointsMall/index`;
const EP = {
  list: 'mall/point/goods/queryPointGoodsListForManagement',
  detail: 'mall/point/goods/queryPointGoodsDetailForManagement',
};
const KEEP = ['authorization', 'apiclient', 'weimob-bosid', 'content-type', 'referer', 'source', 'tcode'];
const ROOT = path.resolve(__dirname, '..');
const newest = pat => fs.readdirSync(path.join(ROOT, path.dirname(pat)))
  .filter(f => f.startsWith(path.basename(pat).split('*')[0])).sort()
  .map(f => path.join(ROOT, path.dirname(pat), f)).pop();
const PLAN = JSON.parse(fs.readFileSync(newest('backup/151-seq56-plan_*.json'), 'utf8'));
const numEq = (a, b) => Math.abs(Number(a) - Number(b)) < 0.06;

(async () => {
  console.log('=== seq56 积分独立复核（重新登录+重新拉详情）===');
  const ctx = await launch({ headless: true });
  const page = ctx.pages()[0] || await ctx.newPage();
  page.setDefaultTimeout(60000);
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
  const listTpl = tpl.body ? JSON.parse(tpl.body) : {};

  const bad = [];
  for (const w of PLAN.pointWrites) {
    const j = await post(page, `${cfg.BASE}/api3/${EP.detail}`,
      { ...listTpl, goodsId: w.goodsId, solutionType: 2 }, H);
    if (!isOk(j)) throw new Error('详情拉取失败: ' + w.goodsId);
    const d = j.data;
    const s = d.skuList.find(x => x.skuId === w.skuId);
    const hit = s && numEq(s.point, w.target[0]) && numEq(s.pointPrice, w.target[1]);
    const g = w.guardBase;
    // 131 快照把嵌套字段提到顶层；原始详情在 pointClassifyInfo 内（MEMORY D 节的口径坑）
    const nowClassifyId = d.classifyId ?? (d.pointClassifyInfo || {}).pointClassifyId;
    const guardOK = numEq(nowClassifyId, g.classifyId) && d.priceType === g.priceType &&
      d.goodsLimitNum === g.goodsLimitNum && numEq(d.sort, g.sort) &&
      d.exchangeTimeType === g.exchangeTimeType &&
      numEq(d.visibleInNonExchangeTime, g.visibleInNonExchangeTime);
    const quotaOK = s && numEq(s.availableChangeNum, w.editChangeNum) && s.isPoint === w.isPoint;
    const gp = [['classifyId', d.classifyId, g.classifyId, numEq(d.classifyId, g.classifyId)],
      ['priceType', d.priceType, g.priceType, d.priceType === g.priceType],
      ['goodsLimitNum', d.goodsLimitNum, g.goodsLimitNum, d.goodsLimitNum === g.goodsLimitNum],
      ['sort', d.sort, g.sort, numEq(d.sort, g.sort)],
      ['exchangeTimeType', d.exchangeTimeType, g.exchangeTimeType, d.exchangeTimeType === g.exchangeTimeType],
      ['visibleInNonExchangeTime', d.visibleInNonExchangeTime, g.visibleInNonExchangeTime,
       numEq(d.visibleInNonExchangeTime, g.visibleInNonExchangeTime)]];
    gp.filter(x => !x[3] && x[0] !== 'classifyId')
      .forEach(x => console.log(`    guard差异 ${x[0]}: 现网=${JSON.stringify(x[1])} 基线=${JSON.stringify(x[2])}`));
    console.log(`  gid=${w.goodsId}: point=${s && s.point}/${s && s.pointPrice} 目标=${hit} guard=${guardOK} 可兑=${quotaOK}`);
    if (!hit || !guardOK || !quotaOK) bad.push({ goodsId: w.goodsId, hit, guardOK, quotaOK,
      guardDiff: gp.filter(x => !x[3]).map(x => [x[0], x[1], x[2]]) });
  }
  const result = bad.length === 0 ? 'PASS' : 'FAIL';
  const out = path.join(PATHS.BACKUP, '157-seq56-points-review.json');
  fs.writeFileSync(out, JSON.stringify({ checked: PLAN.pointWrites.length, bad, result,
    at: new Date().toISOString() }, null, 1));
  console.log('VERDICT:', result, '报告:', out);
  await ctx.close();
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error('ERROR', e.message); process.exit(2); });
