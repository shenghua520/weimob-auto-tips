/**
 * 91 · 体育用品分组全量只读导出（写接口路由层 abort）
 * 只产出快照，绝不写线上。
 *   backup/91-tiyu-goods_<ts>.json   体育用品商品列表(含成本价)
 *   backup/91-tiyu-details_<ts>.json 体育用品商品详情(含SKU/条码/图片)
 *   backup/91-classify_<ts>.json     实时分组树
 *   backup/91-points_<ts>.json       积分商城(纯豆/组合价)
 *   backup/91-summary_<ts>.json      基线统计
 */
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
  console.log('=== 体育用品全量只读导出 ===');
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
    await page.waitForTimeout(9000);
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
    return post(page, `${cfg.BASE}/api3/${ep}`, body, headers);
  };

  // 1) 分组树（新版接口名 queryClassifyListWithPageForManagement，旧名兜底）
  const cFound = await observe('商品分组', URLS.classify);
  const NEW_EP = 'mall/goods/classify/queryClassifyListWithPageForManagement';
  let C, cEp;
  try { C = pick(cFound, NEW_EP); cEp = NEW_EP; }
  catch (e) { C = pick(cFound, EP.classifyTree); cEp = EP.classifyTree; }
  ALLOW.push(cEp);
  console.log('分组接口:', cEp);
  const cRes = await call(cEp, { ...(C.payload || {}), pageNum: 1, pageSize: 200 }, C.headers);
  if (!isOk(cRes)) throw new Error('分组树查询失败: ' + JSON.stringify(cRes).slice(0, 300));
  const d = cRes.data || {};
  const l1 = d.goodsClassifyList || d.pageList || d.list || [];
  console.log('  一级分组数:', l1.length, '| data keys:', Object.keys(d).join(','));
  save('91-classify', { exportedAt: new Date().toISOString(), response: cRes });

  // 找 体育用品 一级及其二级 id（含兑换副本）
  const tiyuIds = new Set(); const tiyuNames = [];
  for (const g of l1) {
    if (String(g.name || '').replace(/（兑换）/g, '').trim() === '体育用品') {
      tiyuIds.add(g.classifyId);
      tiyuNames.push('L1:' + g.name + '#' + g.classifyId);
      for (const c of (g.childClassifyList || [])) {
        tiyuIds.add(c.classifyId);
        tiyuNames.push('  L2:' + c.name + '#' + c.classifyId);
      }
    }
  }
  console.log('\n体育用品分组ID:', tiyuNames.join('\n'));

  // 2) 商品全量列表
  const G = pick(await observe('商品列表', URLS.goods), EP.goodsList);
  const gAll = []; let gTotal = null;
  for (let pn = 1; pn <= 100; pn++) {
    const j = await call(EP.goodsList, { ...G.payload, pageNum: pn, pageSize: 20 }, G.headers);
    if (!isOk(j)) { log.errors.push({ step: 'goodsList', page: pn, res: j }); break; }
    const list = (j.data && j.data.pageList) || [];
    if (gTotal === null) gTotal = j.data.totalCount;
    gAll.push(...list);
    console.log(`  goods page ${pn}: ${list.length} / 累计 ${gAll.length} / total ${gTotal}`);
    if (!list.length || gAll.length >= gTotal) break;
    await sleep(220);
  }

  // 过滤：classifyList 命中体育用品分组ID（含兑换副本按名称兜底）
  const TIYU_L2_NAMES = ['跳绳','篮球','足球','排球','羽毛球','乒乓球','其他体育用品'];
  const isTiyu = g => (g.classifyList || []).some(c => {
    if (tiyuIds.has(c.classifyId)) return true;
    const nm = String(c.name || '').replace(/（兑换）/g, '').trim();
    return TIYU_L2_NAMES.includes(nm);
  });
  const ty = gAll.filter(isTiyu);
  console.log('\n体育用品商品数:', ty.length, '/ 全站', gAll.length);
  save('91-tiyu-goods', { exportedAt: new Date().toISOString(), totalGoods: gTotal, tiyuCount: ty.length, list: ty });

  // 3) 详情（含SKU/条码/图片/成本价）
  const G2 = pick(await observe('商品列表(取详情)', URLS.goods), EP.goodsList);
  const details = [];
  for (let i = 0; i < ty.length; i++) {
    const g = ty[i];
    const j = await call(EP.goodsDetail, { ...G2.payload, goodsId: g.goodsId, filterOption: FO }, G2.headers);
    if (isOk(j) && j.data) details.push(j.data);
    else log.errors.push({ step: 'detail', goodsId: g.goodsId, res: j });
    if ((i + 1) % 10 === 0) console.log(`  detail ${i + 1}/${ty.length}`);
    await sleep(180);
  }
  save('91-tiyu-details', { exportedAt: new Date().toISOString(), count: details.length, details });

  // 4) 积分商城
  const P = pick(await observe('积分商城', URLS.points), EP.pointGoods);
  const pAll = []; let pTotal = null;
  for (let pn = 1; pn <= 100; pn++) {
    const j = await call(EP.pointGoods, { ...P.payload, pageNum: pn, pageSize: 50 }, P.headers);
    if (!isOk(j)) { log.errors.push({ step: 'pointGoods', page: pn, res: j }); break; }
    const list = (j.data && j.data.pageList) || [];
    if (pTotal === null) pTotal = j.data.totalCount;
    pAll.push(...list);
    console.log(`  points page ${pn}: ${list.length} / 累计 ${pAll.length} / total ${pTotal}`);
    if (!list.length || list.length < 50 || pAll.length >= pTotal) break;
    await sleep(220);
  }
  save('91-points', { exportedAt: new Date().toISOString(), totalCount: pTotal, list: pAll });

  log.finishedAt = new Date().toISOString();
  log.summary = { goodsTotal: gTotal, goodsScanned: gAll.length, tiyuGoods: ty.length, details: details.length, points: pAll.length, blocked: log.blocked.length, errors: log.errors.length };
  save('91-summary', log);
  console.log('\n[汇总]', JSON.stringify(log.summary));
  await ctx.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
