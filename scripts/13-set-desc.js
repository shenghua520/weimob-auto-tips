/**
 * 批量给商品写「图文详情」+ 校正商品图片
 * 数据源：backup/素材URL映射.json（srcId → goods/sku/detail 的 COS URL）
 * 用法: node set-desc2.js --src=2640 --goods=161455872100397  |  --all [--limit=N]
 */
const { chromium } = require('playwright-core');
const path = require('path');
const fs = require('fs');
const DIR = __dirname;
const PROFILE = path.resolve(DIR, 'profile');
const LIST = 'https://master.weimob.com/bos/products/ecGoodsmanage/4022657115397/6cva1xbh8X2adt8v5yX6cx2wfzo2/goods/list';
const SRC = (process.argv.find(a => a.startsWith('--src=')) || '').split('=')[1];
const GOODS = (process.argv.find(a => a.startsWith('--goods=')) || '').split('=')[1];
const LIMIT = Number((process.argv.find(a => a.startsWith('--limit=')) || '').split('=')[1] || 0);
const ALL = process.argv.includes('--all');
const DRY = process.argv.includes('--dry');

const urls = JSON.parse(fs.readFileSync(path.join(DIR, 'backup', '素材URL映射.json'), 'utf8'));
const products = JSON.parse(fs.readFileSync(path.join(DIR, 'backup', 'products.json'), 'utf8'));

(async () => {
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    executablePath: 'C:/Users/shenghua/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe',
    headless: false, viewport: { width: 1400, height: 900 }, locale: 'zh-CN',
  });
  const page = ctx.pages()[0] || await ctx.newPage();
  let H = null, lBody = null;
  page.on('request', r => { if (r.url().includes('queryGoodsListWithPageForManagement')) { H = r.headers(); lBody = r.postData(); } });
  await page.goto(LIST, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(12000);
  const hdr = {}; ['authorization', 'apiclient', 'weimob-bosid', 'content-type', 'referer'].forEach(k => { if (H[k]) hdr[k] = H[k]; });
  const base = JSON.parse(lBody).basicInfo;
  const post = async (ep, body) => {
    const t = await page.evaluate(async ({ ep, body, hdr }) => {
      const r = await fetch('https://master.weimob.com/api3/' + ep, { method: 'POST', headers: hdr, credentials: 'include', body: JSON.stringify(body) });
      return await r.text();
    }, { ep, body, hdr });
    try { return JSON.parse(t); } catch (e) { return { raw: t.slice(0, 300) }; }
  };

  // 建立 outerGoodsCode(商品编码=srcId) → goodsId 索引
  const lbp = JSON.parse(lBody);
  const index = {};
  if (ALL || !GOODS) {
    for (let pn = 1; pn <= 20; pn++) {
      lbp.pageNum = pn; lbp.page = pn;
      const lr = await post('mall/goods/queryGoodsListWithPageForManagement', lbp);
      const pl = (lr.data && lr.data.pageList) || [];
      if (!pl.length) break;
      pl.forEach(g => { const code = String(g.outerGoodsCode || ''); if (code) index[code] = g.goodsId; });
      if (pl.length < 20) break;
    }
    console.log('商品索引:', Object.keys(index).length, '条');
    fs.writeFileSync(path.join(DIR, 'backup', '商品ID映射.json'), JSON.stringify(index, null, 1));
  }

  const FO = { querySelfPickupSiteShip: true, isQueryAppointmentTimeInfo: true, isQueryGoodsAbilitiesDetailInfo: true, isQueryPicInfo: true, isQueryVideoInfo: true, isQueryTagInfo: true, isQueryGoodsLimit: true, isQueryClassifyInfo: true, isQueryPropertyInfo: true, isQuerySaleInfo: true, isQueryCategoryInfo: true, isQueryBrandInfo: true, isQueryAttachInfo: true, isFilterDeleted: true, isQueryInvoiceConfig: true, isQueryGoodsStockInfo: true, isQueryGoodsPriceInfo: true, isQueryGoodsExtInfo: true, isQuerySetGoodsPriceInfo: true, isQuerySetGoodsSalesInfo: true, isQueryAutoOffline: true, isQueryAutoSell: true, isQuerySkuInfo: true, isQueryDescInfo: true, queryVidBizType: true };
  const detailBody = gid => ({ basicInfo: base, solutionType: 2, goodsId: String(gid), filterOption: FO, i18n: { language: 'zh-CN', timezone: 8 }, extendInfo: { refer: '/bos/products/ecGoodsmanage/{bosId}/{key}/goods/list', source: 80 } });
  const tpl = JSON.parse(fs.readFileSync(path.join(DIR, 'out', 'save-goods-body.json'), 'utf8'));

  let list = ALL ? products : products.filter(p => String(p.srcId) === String(SRC));
  if (ALL) list = list.filter(p => urls[p.srcId] && (urls[p.srcId].goods || []).filter(Boolean).length);
  if (LIMIT) list = list.slice(0, LIMIT);

  let ok = 0, fail = 0; const fails = [];
  for (const p of list) {
    const u = urls[p.srcId];
    if (!u) { continue; }
    const goodsImages = (u.goods || []).filter(Boolean).slice(0, 10);
    const detailU = (u.detail || []).filter(Boolean);
    if (!goodsImages.length && !detailU.length) continue;
    const gid = GOODS || index[String(p.srcId)];
    if (!gid) { fail++; fails.push({ srcId: p.srcId, err: '未找到 goodsId' }); console.log('✗', p.srcId, '未找到 goodsId'); continue; }

    const descHtml = detailU.map(x => `<p style="text-align:center"><img src="${x}" style="max-width:100%"/></p>`).join('');
    const dd = await post('mall/goods/queryGoodsDetail', detailBody(gid));
    const d = dd.data;
    if (!d || !d.goodsId) { fail++; fails.push({ srcId: p.srcId, err: '详情获取失败' }); console.log('✗', p.srcId, '详情失败'); continue; }
    const catList = d.categoryList || [];
    const lastCat = catList.length ? catList[catList.length - 1] : {};
    const gcl = (d.goodsClassifyList || []).map(c => c.classifyId);
    const body = {
      ...tpl, ...d, basicInfo: base, solutionType: 2, goodsId: gid,
      categoryId: lastCat.categoryId || tpl.categoryId,
      categoryList: catList.length ? catList : tpl.categoryList,
      goodsClassifyList: d.goodsClassifyList || tpl.goodsClassifyList,
      goodsClassifyIdList: gcl.length ? gcl : tpl.goodsClassifyIdList,
      goodsImageUrl: goodsImages.length ? goodsImages : d.goodsImageUrl,
      defaultImageUrl: goodsImages.length ? goodsImages[0] : d.defaultImageUrl,
      goodsDesc: descHtml || d.goodsDesc,
      i18n: { language: 'zh-CN', timezone: 8 },
      extendInfo: { refer: '/bos/products/ecGoodsmanage/{bosId}/{key}/goods/list', source: 80 },
    };
    delete body.raw;
    if (DRY) { console.log('dry', p.srcId, gid, '图', goodsImages.length, '详情', detailU.length); continue; }
    const up = await post('mall/goods/update', body);
    if (String(up.errcode) === '0' || String(up.code) === '0') { ok++; console.log(`✓ ${p.srcId} ${p.name.slice(0, 20)} | 图 ${goodsImages.length} | 详情 ${detailU.length}`); }
    else { fail++; fails.push({ srcId: p.srcId, goodsId: gid, err: JSON.stringify(up).slice(0, 160) }); console.log('✗', p.srcId, JSON.stringify(up).slice(0, 140)); }
    await page.waitForTimeout(600);
  }
  console.log(`\n完成: 成功 ${ok} / 失败 ${fail}`);
  fs.writeFileSync(path.join(DIR, 'backup', '详情写入失败.json'), JSON.stringify(fails, null, 1));
  if (!ALL && !DRY) {
    const gid = GOODS || index[String(SRC)];
    const d2 = (await post('mall/goods/queryGoodsDetail', detailBody(gid))).data || {};
    console.log('回读: 图', (d2.goodsImageUrl || []).length, '| goodsDesc 长度', String(d2.goodsDesc || '').length);
    console.log('desc 前 150:', String(d2.goodsDesc || '').slice(0, 150));
  }
  await ctx.close();
})();
