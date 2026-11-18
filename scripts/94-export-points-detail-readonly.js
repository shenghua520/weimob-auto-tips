/**
 * 94 · 积分商城 SKU 级详情 + 分组列表 只读导出（写接口路由层 abort）
 * 只产出快照，绝不写线上。用于「表格改价回写微盟」前的基线取证。
 *   backup/94-points-list_<ts>.json   积分商城全量列表
 *   backup/94-points-detail_<ts>.json 体育用品积分商品 SKU级详情(point/pointPrice/availableChangeNum)
 *   backup/94-point-classify_<ts>.json 积分分组列表(探明带兑换属性)
 */
const fs = require('fs');
const path = require('path');
const { cfg, launch, login, post, isOk, sleep, stamp, PATHS } = require('./lib/common');

const R = `${cfg.BASE}/bos/products/ecGoodsmanage/${cfg.BOS_ID}/${cfg.KEY}`;
const POINTS_URL = `${R}/goods/pointsMall/index`;
const EP = {
  pointGoods: 'mall/point/goods/queryPointGoodsListForManagement',
  pointDetail: 'mall/point/goods/queryPointGoodsDetailForManagement',
  pointClassify: 'mall/point/classify/queryPointClassifyListWithPageForManagement',
};
const ALLOW = Object.values(EP);
const BLOCK = [
  'updatePointGoods', 'addPointGoods', 'deletePointGoods', 'updatePointGoodsSort',
  'moveGoodsToClassify', 'addPointClassify', 'updatePointClassify', 'deletePointClassify',
  '/point/goods/save', '/point/goods/batch', 'deleteGoods', '/goods/update', '/goods/delete',
];
const KEEP = ['authorization', 'apiclient', 'weimob-bosid', 'content-type', 'referer', 'source', 'tcode'];
const ts = stamp();
const save = (name, obj) => {
  const f = path.join(PATHS.BACKUP, `${name}_${ts}.json`);
  fs.writeFileSync(f, JSON.stringify(obj, null, 1), 'utf8');
  console.log('  已落盘:', path.basename(f));
  return f;
};

(async () => {
  console.log('=== 积分商城 SKU 级详情 + 分组 只读导出（零写）===');
  const ctx = await launch({ headless: true });
  const page = ctx.pages()[0] || await ctx.newPage();
  page.setDefaultTimeout(60000);
  const log = { startedAt: new Date().toISOString(), blocked: [], errors: [] };
  await page.route('**/api3/**', route => {
    const u = route.request().url();
    if (BLOCK.some(b => u.includes(b))) { log.blocked.push(u); return route.abort(); }
    return route.continue();
  });
  await login(page);

  console.log('\n=== 监听积分商城页 XHR 模板 ===');
  const found = [];
  const onReq = r => {
    const u = r.url();
    if (!u.includes('/api3/')) return;
    found.push({ ep: u.replace(`${cfg.BASE}/api3/`, '').split('?')[0], headers: r.headers(), body: r.postData() });
  };
  page.on('request', onReq);
  await page.goto(POINTS_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(10000);
  // 触发分组接口
  try { await page.goto(`${R}/goods/pointsMall/index?tab=classify`, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(3000); } catch (e) {}
  page.off('request', onReq);

  console.log('捕获到的 api3 端点:');
  [...new Set(found.map(x => x.ep))].forEach(e => console.log('  ', e));

  const pick = (ep) => {
    const h = found.filter(x => x.ep === ep).pop();
    if (!h) return null;
    const headers = {};
    KEEP.forEach(k => { if (h.headers[k]) headers[k] = h.headers[k]; });
    return { headers, payload: h.body ? JSON.parse(h.body) : null };
  };
  const call = async (ep, body, headers) => {
    const url = `${cfg.BASE}/api3/${ep}`;
    const j = await post(page, url, body, headers);
    if (!isOk(j)) throw new Error(ep + ' 失败: ' + JSON.stringify(j).slice(0, 240));
    return j.data;
  };

  // ---- 1) 积分商城全量列表 ----
  const T = pick(EP.pointGoods);
  if (!T) throw new Error('未捕获积分商品列表模板 ' + EP.pointGoods);
  const items = [];
  for (let p = 1; p <= 30; p++) {
    const d = await call(EP.pointGoods, { ...T.payload, pageNum: p, pageSize: 50 }, T.headers);
    const l = d.pageList || [];
    items.push(...l);
    if (l.length < 50) break;
    await sleep(120);
  }
  save('94-points-list', { exportedAt: new Date().toISOString(), total: items.length, list: items });
  console.log('积分商品列表:', items.length);

  // ---- 2) 积分分组列表 ----
  let cls = null;
  const TC = pick(EP.pointClassify);
  if (TC) {
    try {
      const d = await call(EP.pointClassify, { ...TC.payload, pageNum: 1, pageSize: 100 }, TC.headers);
      cls = d.pageList || d.goodsClassifyList || d;
    } catch (e) { log.errors.push({ step: 'classify', err: e.message }); }
  }
  save('94-point-classify', { exportedAt: new Date().toISOString(), data: cls, rawTemplate: TC ? TC.payload : null });

  // ---- 3) 体育用品积分商品 SKU级详情 ----
  const TD = pick(EP.pointDetail);
  const detailTpl = TD ? TD.payload : { ...T.payload };
  const sports = items.filter(x => x.pointClassifyInfo && x.pointClassifyInfo.name === '体育用品');
  console.log('体育用品积分商品:', sports.length);
  const details = [];
  for (let i = 0; i < sports.length; i++) {
    const g = sports[i];
    try {
      const d = await call(EP.pointDetail, { ...detailTpl, goodsId: g.goodsId, solutionType: 2 }, T.headers);
      details.push({
        goodsId: g.goodsId, title: g.title, outerGoodsCode: g.outerGoodsCode,
        priceType: d.priceType, goodsLimitNum: d.goodsLimitNum,
        classifyId: d.pointClassifyInfo ? d.pointClassifyInfo.pointClassifyId : 0,
        exchangeTimeType: d.exchangeTimeType, exchangeStartTime: d.exchangeStartTime, exchangeEndTime: d.exchangeEndTime,
        visibleInNonExchangeTime: d.visibleInNonExchangeTime,
        pickupSiteList: d.pickupSiteList || [],
        applicablePeopleInfo: d.applicablePeopleInfo || null,
        sort: d.sort,
        skuList: (d.skuList || []).map(s => ({
          skuId: s.skuId, point: s.point, pointPrice: s.pointPrice,
          isPoint: s.isPoint, availableChangeNum: s.availableChangeNum, editQuantity: s.editQuantity,
        })),
      });
    } catch (e) {
      log.errors.push({ step: 'detail', goodsId: g.goodsId, err: e.message });
      console.log('  详情失败:', g.goodsId, e.message.slice(0, 80));
    }
    if ((i + 1) % 20 === 0) console.log('  detail', i + 1, '/', sports.length);
    await sleep(150);
  }
  save('94-points-detail', { exportedAt: new Date().toISOString(), count: details.length, list: details });

  log.summary = { pointsList: items.length, sportsCount: sports.length, details: details.length, blocked: log.blocked.length, errors: log.errors.length };
  save('94-summary', log);
  console.log('\n=== 完成 ===', JSON.stringify(log.summary));
  await ctx.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
