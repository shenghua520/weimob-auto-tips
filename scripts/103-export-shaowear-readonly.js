/**
 * 103 · 少儿穿戴分组：全量商品库 + 目标 SKU 级详情（只读，零写）
 * 目的：为「少儿穿戴商品上积分商城」提供写前只读快照，重点是 SKU 级库存（editQuantity），
 *       用于区分「有库存 / 无库存」两类商品，以及识别「原版 + 兑换复制体」孪生体。
 * 产出：
 *   backup/103-goods-all_<ts>.json        商品库全量列表
 *   backup/103-target-details_<ts>.json   目标编码命中商品的 SKU 级详情
 *   backup/103-summary_<ts>.json          基线统计
 * 所有写接口路由层 abort。
 */
const fs = require('fs');
const { cfg, launch, login, post, isOk, stamp } = require('./lib/common');

const EP_GL = 'mall/goods/queryGoodsListWithPageForManagement';
const EP_DETAIL = 'mall/goods/queryGoodsDetail';
const WRITE_VERBS = [
  'updatePointGoodsSort', 'batchUpdateGoodsSort', 'moveGoodsToClassify',
  'addPointGoods', 'deletePointGoods', 'updatePointGoods', 'addPointClassify',
  'updatePointClassify', 'deletePointClassify', '/goods/update', '/goods/delete',
  '/goods/import', 'insertMaterial', 'createGroup', 'batchUpdate', 'setOnline',
  'createAsyncStockTask', 'createInventoryOrder', 'addGoodsClassify', 'deleteGoodsClassify',
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

// 少儿穿戴表 000004 的 29 个唯一编码
const TARGET_CODES = [
  'BNS-6049L', 'BNS-6049', '90368S', '90280', 'B-3914', '22307L', '22280', '22283',
  'B-3609', '8482', 'APS-10442', '22138', '22259', '10485S', '10486S', '10487S', '10488S',
  '22311', '90379', '90353', '8457', 'B-3681', 'W-BNS-6941', 'W-BNS-6961',
  '背部矫正带', '儿童矫正鞋垫', '儿童防蓝光眼镜',
];
const ts = stamp();

(async () => {
  console.log('=== 少儿穿戴 只读导出 [零写] ===');
  const ctx = await launch({ headless: true });
  const page = ctx.pages()[0] || await ctx.newPage();
  page.setDefaultTimeout(60000);
  let blocked = 0;
  await page.route('**/api3/**', route => {
    const u = route.request().url();
    if (WRITE_VERBS.some(w => u.includes(w))) { blocked++; return route.abort(); }
    return route.continue();
  });
  await login(page);

  const found = [];
  page.on('request', r => {
    const u = r.url();
    if (!u.includes('/api3/') || r.method() !== 'POST') return;
    const ep = u.replace(cfg.BASE + '/api3/', '').split('?')[0];
    if (ep === EP_GL) { try { found.push({ headers: r.headers(), body: JSON.parse(r.postData()) }); } catch (e) {} }
  });
  const BASEURL = `${cfg.BASE}/bos/products/ecGoodsmanage/${cfg.BOS_ID}/${cfg.KEY}`;
  await page.goto(BASEURL + '/goods/list', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(12000);
  const keep = ['authorization', 'apiclient', 'weimob-bosid', 'content-type', 'referer', 'source', 'tcode'];
  const h = found.filter(x => x.body).pop();
  if (!h) throw new Error('未捕获商品列表模板');
  const headers = {}; keep.forEach(k => { if (h.headers[k]) headers[k] = h.headers[k]; });
  console.log('模板已捕获');

  const goods = [];
  let total = 0;
  for (let p = 1; p <= 80; p++) {
    const j = await post(page, cfg.BASE + '/api3/' + EP_GL, { ...h.body, pageNum: p, pageSize: 20 }, headers);
    if (!isOk(j)) { console.log('  翻页失败 p=' + p, JSON.stringify(j).slice(0, 120)); break; }
    const l = j.data.pageList || [];
    total = j.data.totalCount || 0;
    goods.push(...l);
    if (l.length < 20 || goods.length >= total) break;
  }
  console.log('商品库全量:', goods.length, '/ total', total);
  fs.writeFileSync(`backup/103-goods-all_${ts}.json`,
    JSON.stringify({ exportedAt: new Date().toISOString(), total, count: goods.length, list: goods }, null, 1), 'utf8');

  // 目标命中：精确编码
  const byCode = {};
  for (const x of goods) {
    const c = String(x.outerGoodsCode || '').trim();
    if (c) (byCode[c] = byCode[c] || []).push(x);
  }
  // 名称匹配（用于编码在微盟为空/组合码的商品）：取标题中文串
  const cn = s => (s || '').replace(/[^一-鿿]/g, '');
  const targets = new Map(); // goodsId -> {codes:[], title}
  const codeHit = {};
  for (const code of TARGET_CODES) {
    const lst = byCode[code] || [];
    if (lst.length) {
      codeHit[code] = lst.map(x => x.goodsId);
      lst.forEach(x => {
        const k = String(x.goodsId);
        if (!targets.has(k)) targets.set(k, { codes: [], title: x.title });
        targets.get(k).codes.push(code);
      });
    } else codeHit[code] = [];
  }
  console.log('\n=== 编码精确命中 ===');
  TARGET_CODES.forEach(c => console.log(`  ${c}: ${(codeHit[c] || []).length || '未命中'}`));

  // 编码未命中 → 名称模糊匹配（限定「书包」分组，避免张冠李戴）
  const bagKw = ['书包', '双肩包', '背包', '护脊', '减负'];
  const missCodes = TARGET_CODES.filter(c => !(codeHit[c] || []).length);
  const byTitle = goods.map(x => ({ x, t: cn(x.title) }));
  const nameHit = {};
  for (const code of missCodes) {
    // 表格里该编码的商品名前缀：用「阳光」「BINNES」「大容量」等关键词定位
    const cand = [];
    for (const { x, t } of byTitle) {
      if (!t) continue;
      const isBag = bagKw.some(k => t.includes(k));
      if (!isBag) continue;
      cand.push(x);
    }
    nameHit[code] = cand.length; // 名称匹配需人工二次确认,这里只统计书包域候选数
  }
  console.log('\n=== 编码未命中, 书包域候选商品数 ===');
  missCodes.forEach(c => console.log(`  ${c}: ${nameHit[c]} 个候选(需按名称确认)`));

  // 拉所有「书包/双肩包/背包/护脊/减负」域 + 矫正带/鞋垫/眼镜 域商品的详情(SKU级库存)
  const DOMAIN_KW = [...bagKw, '矫正带', '坐姿矫正', '鞋垫', '防蓝光', '眼镜', '镜框'];
  const domainGoods = goods.filter(x => {
    const t = cn(x.title);
    return DOMAIN_KW.some(k => t.includes(k));
  });
  console.log('\n域内候选商品数(去重后含孪生体):', domainGoods.length);

  const details = [];
  for (let i = 0; i < domainGoods.length; i++) {
    const g = domainGoods[i];
    const j = await post(page, cfg.BASE + '/api3/' + EP_DETAIL,
      { ...h.body, goodsId: g.goodsId, filterOption: FO }, headers);
    if (isOk(j) && j.data) {
      details.push({
        goodsId: g.goodsId, outerGoodsCode: g.outerGoodsCode || '', listTitle: g.title,
        title: j.data.title || g.title, subTitle: j.data.subTitle || '',
        classifyList: j.data.goodsClassifyList || [],
        salePrice: j.data.salePrice, minSalePrice: j.data.minSalePrice,
        status: j.data.status, soldType: j.data.soldType, isOnline: j.data.isOnline,
        goodsStock: j.data.goodsStock || null,
        skuList: (j.data.skuList || []).map(s => ({
          skuId: s.skuId, itemSkuId: s.itemSkuId, skuBarCode: s.skuBarCode,
          outerSkuCode: s.outerSkuCode, isDisabled: s.isDisabled,
          salePrice: s.salePrice, costPrice: s.costPrice,
          editQuantity: s.editQuantity, frozenQuantity: s.frozenQuantity,
          specValueName: (s.skuSpecValueList || []).map(v => v.specValueName).join('/'),
        })),
      });
    }
    if ((i + 1) % 20 === 0) console.log(`  detail ${i + 1}/${domainGoods.length}`);
  }
  fs.writeFileSync(`backup/103-target-details_${ts}.json`,
    JSON.stringify({ exportedAt: new Date().toISOString(), count: details.length, details }, null, 1), 'utf8');
  console.log('详情落盘:', details.length);

  const summary = {
    goodsTotal: total, goodsScanned: goods.length,
    domainGoods: domainGoods.length, details: details.length,
    codeHitExact: Object.entries(codeHit).filter(([, v]) => v.length).length,
    codeMiss: missCodes, blocked,
  };
  fs.writeFileSync(`backup/103-summary_${ts}.json`, JSON.stringify(summary, null, 1), 'utf8');
  console.log('\n[汇总]', JSON.stringify(summary));
  await ctx.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
