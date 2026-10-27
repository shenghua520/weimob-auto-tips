/**
 * 把 750×1000 新主图写回商品（只改 goodsImageUrl / defaultImageUrl，其余保持原样）
 * 数据源：backup/素材URL映射v2.json
 * 用法: node update-images.js --all [--limit=N] | --src=2924
 */
const { chromium } = require('playwright-core');
const path = require('path');
const fs = require('fs');

const DIR = __dirname;
const PROFILE = path.resolve(DIR, 'profile');
const LIST = 'https://master.weimob.com/bos/products/ecGoodsmanage/4022657115397/6cva1xbh8X2adt8v5yX6cx2wfzo2/goods/list';
const SRC = (process.argv.find(a => a.startsWith('--src=')) || '').split('=')[1];
const ALL = process.argv.includes('--all');
const LIMIT = Number((process.argv.find(a => a.startsWith('--limit=')) || '').split('=')[1] || 0);

const products = JSON.parse(fs.readFileSync(path.join(DIR, 'backup', 'products.json'), 'utf8'));
const urls2 = JSON.parse(fs.readFileSync(path.join(DIR, 'backup', '素材URL映射v2.json'), 'utf8'));
const idx = JSON.parse(fs.readFileSync(path.join(DIR, 'backup', '商品ID映射.json'), 'utf8'));
const tpl = JSON.parse(fs.readFileSync(path.join(DIR, 'out', 'save-goods-body.json'), 'utf8'));

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
    try { return JSON.parse(t); } catch (e) { return {}; }
  };
  const FO = { querySelfPickupSiteShip: true, isQueryAppointmentTimeInfo: true, isQueryGoodsAbilitiesDetailInfo: true, isQueryPicInfo: true, isQueryVideoInfo: true, isQueryTagInfo: true, isQueryGoodsLimit: true, isQueryClassifyInfo: true, isQueryPropertyInfo: true, isQuerySaleInfo: true, isQueryCategoryInfo: true, isQueryBrandInfo: true, isQueryAttachInfo: true, isFilterDeleted: true, isQueryInvoiceConfig: true, isQueryGoodsStockInfo: true, isQueryGoodsPriceInfo: true, isQueryGoodsExtInfo: true, isQuerySetGoodsPriceInfo: true, isQuerySetGoodsSalesInfo: true, isQueryAutoOffline: true, isQueryAutoSell: true, isQuerySkuInfo: true, isQueryDescInfo: true, queryVidBizType: true };
  const detailBody = gid => ({ basicInfo: base, solutionType: 2, goodsId: String(gid), filterOption: FO, i18n: { language: 'zh-CN', timezone: 8 }, extendInfo: { refer: '/bos/products/ecGoodsmanage/{bosId}/{key}/goods/list', source: 80 } });

  let list = ALL ? products : products.filter(p => String(p.srcId) === String(SRC));
  if (ALL) list = list.filter(p => idx[String(p.srcId)] && urls2[String(p.srcId)]);
  if (LIMIT) list = list.slice(0, LIMIT);

  let ok = 0, fail = 0; const fails = [];
  for (const p of list) {
    const gid = idx[String(p.srcId)];
    const imgs = (urls2[String(p.srcId)] || []).filter(Boolean);
    if (!gid || !imgs.length) continue;
    const d = (await post('mall/goods/queryGoodsDetail', detailBody(gid))).data;
    if (!d || !d.goodsId) { fail++; fails.push({ srcId: p.srcId, err: '详情失败' }); continue; }

    const catList = d.categoryList || [];
    const lastCat = catList.length ? catList[catList.length - 1] : {};
    const gcl = (d.goodsClassifyList || []).map(c => c.classifyId);
    const body = {
      ...tpl, ...d, basicInfo: base, solutionType: 2, goodsId: gid,
      categoryId: lastCat.categoryId || tpl.categoryId,
      categoryList: catList.length ? catList : tpl.categoryList,
      goodsClassifyList: d.goodsClassifyList || tpl.goodsClassifyList,
      goodsClassifyIdList: gcl.length ? gcl : tpl.goodsClassifyIdList,
      goodsImageUrl: imgs,
      defaultImageUrl: imgs[0],
      i18n: { language: 'zh-CN', timezone: 8 },
      extendInfo: { refer: '/bos/products/ecGoodsmanage/{bosId}/{key}/goods/list', source: 80 },
    };
    delete body.raw;
    const up = await post('mall/goods/update', body);
    if (String(up.errcode) === '0' || String(up.code) === '0') { ok++; if (ok % 25 === 0) console.log(`  ${ok}/${list.length} 已更新`); }
    else { fail++; fails.push({ srcId: p.srcId, err: JSON.stringify(up).slice(0, 160) }); console.log(`✗ ${p.srcId}`, JSON.stringify(up).slice(0, 120)); }
    await page.waitForTimeout(450);
  }
  console.log(`\n完成: 成功 ${ok} / 失败 ${fail}`);
  fs.writeFileSync(path.join(DIR, 'backup', '新图更新失败.json'), JSON.stringify(fails, null, 1));

  if (SRC) {
    const gid = idx[String(SRC)];
    const d2 = (await post('mall/goods/queryGoodsDetail', detailBody(gid))).data || {};
    console.log(`\n回读 ${SRC}: 图 ${(d2.goodsImageUrl || []).length} 张`);
    (d2.goodsImageUrl || []).slice(0, 3).forEach((u, i) => console.log(`  [${i}] ${String(u).slice(0, 80)}`));
  }
  await ctx.close();
})();
