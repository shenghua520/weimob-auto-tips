/**
 * 131 · 学习文具积分商城列表 + SKU级详情 只读导出（写接口路由层 abort）
 * 产出 backup/131-points-list_<ts>.json + 131-points-detail_<ts>.json
 * 复用 94 的模板抓取法，只筛「学习文具」分组。
 */
const fs = require('fs');
const path = require('path');
const { cfg, launch, login, post, isOk, sleep, stamp, PATHS } = require('./lib/common');

const R = `${cfg.BASE}/bos/products/ecGoodsmanage/${cfg.BOS_ID}/${cfg.KEY}`;
const POINTS_URL = `${R}/goods/pointsMall/index`;
const EP = {
  pointGoods: 'mall/point/goods/queryPointGoodsListForManagement',
  pointDetail: 'mall/point/goods/queryPointGoodsDetailForManagement',
};
const BLOCK = [
  'updatePointGoods', 'addPointGoods', 'deletePointGoods', 'updatePointGoodsSort',
  'moveGoodsToClassify', 'addPointClassify', 'updatePointClassify', 'deletePointClassify',
  '/point/goods/save', '/point/goods/batch', 'deleteGoods', '/goods/update', '/goods/delete',
  'online-status', 'price-update', 'sellstatus-update',
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
  console.log('=== 学习文具积分商城 只读导出（零写）===');
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
  console.log('捕获端点:', [...new Set(found.map(x => x.ep))].join(', '));

  const pick = ep => {
    const h = found.filter(x => x.ep === ep).pop();
    if (!h) return null;
    const headers = {};
    KEEP.forEach(k => { if (h.headers[k]) headers[k] = h.headers[k]; });
    return { headers, payload: h.body ? JSON.parse(h.body) : null };
  };
  const call = async (ep, body, headers) => {
    const j = await post(page, `${cfg.BASE}/api3/${ep}`, body, headers);
    if (!isOk(j)) throw new Error(ep + ' 失败: ' + JSON.stringify(j).slice(0, 240));
    return j.data;
  };

  const T = pick(EP.pointGoods);
  if (!T) throw new Error('未捕获积分列表模板');
  const items = [];
  for (let p = 1; p <= 30; p++) {
    const d = await call(EP.pointGoods, { ...T.payload, pageNum: p, pageSize: 50 }, T.headers);
    const l = d.pageList || [];
    items.push(...l);
    if (l.length < 50) break;
    await sleep(120);
  }
  save('131-points-list', { exportedAt: new Date().toISOString(), total: items.length, list: items });
  const stationery = items.filter(x => (x.pointClassifyInfo || {}).name === '学习文具');
  console.log('积分商城全量:', items.length, ' 学习文具:', stationery.length);

  const TD = pick(EP.pointDetail);
  const detailTpl = TD ? TD.payload : { ...T.payload };
  const details = [];
  for (let i = 0; i < stationery.length; i++) {
    const g = stationery[i];
    try {
      const d = await call(EP.pointDetail, { ...detailTpl, goodsId: g.goodsId, solutionType: 2 }, T.headers);
      details.push({
        goodsId: g.goodsId, title: g.title, outerGoodsCode: g.outerGoodsCode,
        classifyId: (d.pointClassifyInfo || {}).pointClassifyId || 0,
        priceType: d.priceType, goodsLimitNum: d.goodsLimitNum,
        exchangeTimeType: d.exchangeTimeType, exchangeStartTime: d.exchangeStartTime,
        exchangeEndTime: d.exchangeEndTime, visibleInNonExchangeTime: d.visibleInNonExchangeTime,
        pickupSiteList: d.pickupSiteList || [], applicablePeopleInfo: d.applicablePeopleInfo || null,
        sort: d.sort,
        skuList: (d.skuList || []).map(s => ({
          skuId: s.skuId, point: s.point, pointPrice: s.pointPrice, isPoint: s.isPoint,
          availableChangeNum: s.availableChangeNum, editQuantity: s.editQuantity,
        })),
      });
    } catch (e) {
      log.errors.push({ step: 'detail', goodsId: g.goodsId, err: e.message });
      console.log('  详情失败:', g.goodsId, e.message.slice(0, 80));
    }
    if ((i + 1) % 25 === 0) console.log('  detail', i + 1, '/', stationery.length);
    await sleep(120);
  }
  save('131-points-detail', { exportedAt: new Date().toISOString(), count: details.length, list: details });
  log.summary = { pointsList: items.length, stationery: stationery.length,
                  details: details.length, blocked: log.blocked.length, errors: log.errors.length };
  save('131-summary', log);
  console.log('\n=== 完成 ===', JSON.stringify(log.summary));
  await ctx.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
