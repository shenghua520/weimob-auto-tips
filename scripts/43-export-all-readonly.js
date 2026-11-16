// 43 · 三块数据全量只读采集（商品分组/积分商城/商品列表+详情）——写接口路由层 abort
// 跑法: WEIMOB_* 环境变量或 config.local.js 就绪后 node scripts/43-export-all-readonly.js
const fs = require('fs');
const path = require('path');
const { cfg, launch, login, post, isOk, sleep, stamp, PATHS } = require('./lib/common');

const R = `${cfg.BASE}/bos/products/ecGoodsmanage/${cfg.BOS_ID}/${cfg.KEY}`;
const URLS = {
  goods: `${R}/goods/list`,
  classify: `${R}/manage/classify/list`,
  points: `${R}/goods/pointsMall/index`,
};
const EP = {
  goodsList: 'mall/goods/queryGoodsListWithPageForManagement',
  classifyTree: 'mall/goods/classify/queryAllClassifyListForManagement',
  pointGoods: 'mall/point/goods/queryPointGoodsListForManagement',
  pointClassify: 'mall/point/classify/queryPointClassifyListWithPageForManagement',
  goodsDetail: 'mall/goods/queryGoodsDetail',
};
const ALLOW = Object.values(EP);
const BLOCK = [
  'deleteGoods', '/goods/update', '/goods/delete', '/goods/import', 'importRetailMerchantGoodsAndItem',
  'addGoodsClassify', 'deleteGoodsClassify', 'updateGoodsClassify', 'moveGoodsToClassify',
  'addPointGoods', 'updatePointGoods', 'deletePointGoods', 'updatePointGoodsSort',
  'addPointClassify', 'updatePointClassify', 'deletePointClassify',
  '/point/goods/save', '/point/goods/batch', '/material/delete',
  'createAsyncStockTask', '/upload/preUpload', '/upload/confirmUpload',
];
// queryGoodsDetail 的 filterOption，缺项会导致 skuList/分类/图片为空（docs/03）
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
const save = (name, obj) => {
  const f = path.join(PATHS.BACKUP, `${name}_${ts}.json`);
  fs.writeFileSync(f, JSON.stringify(obj, null, 1), 'utf8');
  console.log('  已落盘:', path.basename(f));
  return f;
};

(async () => {
  const ctx = await launch({ headless: true });
  const page = ctx.pages()[0] || await ctx.newPage();
  page.setDefaultTimeout(60000);
  const log = { startedAt: new Date().toISOString(), requests: [], blocked: [], errors: [] };
  await page.route('**/api3/**', route => {
    const u = route.request().url();
    if (BLOCK.some(b => u.includes(b))) { log.blocked.push(u); return route.abort(); }
    return route.continue();
  });
  await login(page);

  // 捕获页面自己的查询模板（headers+payload），业务请求一律复用同源模板
  const observe = async (label, url) => {
    console.log(`\n=== ${label} ===`);
    const found = [];
    const onReq = r => {
      const u = r.url();
      if (!u.includes('/api3/')) return;
      found.push({ ep: u.replace(`${cfg.BASE}/api3/`, '').split('?')[0], headers: r.headers(), body: r.postData() });
    };
    page.on('request', onReq);
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(10000);
    page.off('request', onReq);
    return found;
  };
  const KEEP = ['authorization', 'apiclient', 'weimob-bosid', 'content-type', 'referer', 'source', 'tcode'];
  const pick = (found, ep) => {
    const h = found.filter(x => x.ep === ep).pop();
    if (!h) throw new Error('未捕获到同源请求模板: ' + ep);
    const headers = {};
    KEEP.forEach(k => { if (h.headers[k]) headers[k] = h.headers[k]; });
    return { headers, payload: h.body ? JSON.parse(h.body) : null };
  };
  const call = async (ep, body, headers) => {
    if (!ALLOW.includes(ep)) throw new Error('非白名单接口: ' + ep);
    log.requests.push({ at: new Date().toISOString(), ep });
    return post(page, `${cfg.BASE}/api3/${ep}`, body, headers);
  };

  // 1) 商品列表（pageSize=20 铁律，传大静默返空）
  const G = pick(await observe('商品列表', URLS.goods), EP.goodsList);
  const goodsPages = []; let gTotal = null; const gAll = [];
  for (let pn = 1; pn <= 100; pn++) {
    const j = await call(EP.goodsList, { ...G.payload, pageNum: pn, pageSize: 20 }, G.headers);
    if (!isOk(j)) { log.errors.push({ step: 'goodsList', page: pn, res: j }); break; }
    goodsPages.push(j);
    const list = (j.data && j.data.pageList) || [];
    if (gTotal === null) gTotal = j.data.totalCount;
    gAll.push(...list);
    console.log(`  page ${pn}: ${list.length} / 累计 ${gAll.length} / total ${gTotal}`);
    if (!list.length || gAll.length >= gTotal) break;
    await sleep(250);
  }
  save('商品列表_原始快照', { exportedAt: new Date().toISOString(), totalCount: gTotal, pages: goodsPages });

  // 2) 商品分组
  const C = pick(await observe('商品分组', URLS.classify), EP.classifyTree);
  const cRes = await call(EP.classifyTree, C.payload, C.headers);
  const l1 = (cRes.data && cRes.data.goodsClassifyList) || [];
  console.log(`  一级 ${l1.length} / 二级 ${l1.reduce((a, g) => a + (g.childClassifyList || []).length, 0)}`);
  save('商品分组_原始快照', { exportedAt: new Date().toISOString(), response: cRes });

  // 3) 积分商城（pageSize=50 可用）
  const P = pick(await observe('积分商城', URLS.points), EP.pointGoods);
  const pPages = []; let pTotal = null; const pAll = [];
  for (let pn = 1; pn <= 100; pn++) {
    const j = await call(EP.pointGoods, { ...P.payload, pageNum: pn, pageSize: 50 }, P.headers);
    if (!isOk(j)) { log.errors.push({ step: 'pointGoods', page: pn, res: j }); break; }
    pPages.push(j);
    const list = (j.data && j.data.pageList) || [];
    if (pTotal === null) pTotal = j.data.totalCount;
    pAll.push(...list);
    console.log(`  page ${pn}: ${list.length} / 累计 ${pAll.length} / total ${pTotal}`);
    if (!list.length || list.length < 50 || pAll.length >= pTotal) break;
    await sleep(250);
  }
  let pcRes = null;
  try { pcRes = await call(EP.pointClassify, pick(await observe('积分分组', URLS.points), EP.pointClassify).payload, P.headers); } catch (e) { console.log('  积分分组:', e.message); }
  save('积分商城_原始快照', { exportedAt: new Date().toISOString(), totalCount: pTotal, pages: pPages, pointClassify: pcRes });

  // 4) 商品详情（逐商品，列表字段不含规格/图片/类目/分组）
  const G2 = pick(await observe('商品列表(取详情)', URLS.goods), EP.goodsList);
  const details = [];
  for (const g of gAll) {
    const j = await call(EP.goodsDetail, { ...G2.payload, goodsId: g.goodsId, filterOption: FO }, G2.headers);
    if (isOk(j) && j.data) details.push(j.data); else log.errors.push({ step: 'detail', goodsId: g.goodsId });
    await sleep(200);
  }
  console.log(`  详情 ${details.length}/${gAll.length}`);
  save('商品详情_原始快照', { exportedAt: new Date().toISOString(), details });

  log.finishedAt = new Date().toISOString();
  log.summary = { goods: gAll.length, goodsTotal: gTotal, points: pAll.length, pointsTotal: pTotal, details: details.length, blocked: log.blocked.length, errors: log.errors.length };
  save('只读采集_作业日志', log);
  console.log('\n[汇总]', JSON.stringify(log.summary));
  await ctx.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
