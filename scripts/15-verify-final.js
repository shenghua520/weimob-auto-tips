/**
 * 批量上架终验：列表统计 + 抽样查详情
 * 用法: node verify-final.js [抽样数]
 */
const { chromium } = require('playwright-core');
const path = require('path');
const PROFILE = path.resolve(__dirname, 'profile');
const LIST = 'https://master.weimob.com/bos/products/ecGoodsmanage/4022657115397/6cva1xbh8X2adt8v5yX6cx2wfzo2/goods/list';
const N = Number(process.argv[2] || 6);

(async () => {
  const idx = JSON.parse(require('fs').readFileSync(path.join(__dirname, 'backup', '商品ID映射.json'), 'utf8'));
  const urls = JSON.parse(require('fs').readFileSync(path.join(__dirname, 'backup', '素材URL映射.json'), 'utf8'));
  const products = JSON.parse(require('fs').readFileSync(path.join(__dirname, 'backup', 'products.json'), 'utf8'));

  const ctx = await chromium.launchPersistentContext(PROFILE, {
    executablePath: 'C:/Users/shenghua/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe',
    headless: false, viewport: { width: 1200, height: 800 }, locale: 'zh-CN',
  });
  const page = ctx.pages()[0] || await ctx.newPage();
  let H = null, lBody = null;
  page.on('request', r => { if (r.url().includes('queryGoodsListWithPageForManagement')) { H = r.headers(); lBody = r.postData(); } });
  await page.goto(LIST, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(12000);
  const hdr = {}; ['authorization', 'apiclient', 'weimob-bosid', 'content-type', 'referer'].forEach(k => { if (H[k]) hdr[k] = H[k]; });
  hdr['content-type'] = 'application/json';
  const base = JSON.parse(lBody).basicInfo;
  const post = async (ep, body) => {
    const t = await page.evaluate(async ({ ep, body, hdr }) => {
      const r = await fetch('https://master.weimob.com/api3/' + ep, { method: 'POST', headers: hdr, credentials: 'include', body: JSON.stringify(body) });
      return await r.text();
    }, { ep, body, hdr });
    try { return JSON.parse(t); } catch (e) { return { errcode: 'x', errmsg: t.slice(0, 200) }; }
  };
  const FO = { querySelfPickupSiteShip: true, isQueryAppointmentTimeInfo: true, isQueryGoodsAbilitiesDetailInfo: true, isQueryPicInfo: true, isQueryVideoInfo: true, isQueryTagInfo: true, isQueryGoodsLimit: true, isQueryClassifyInfo: true, isQueryPropertyInfo: true, isQuerySaleInfo: true, isQueryCategoryInfo: true, isQueryBrandInfo: true, isQueryAttachInfo: true, isFilterDeleted: true, isQueryInvoiceConfig: true, isQueryGoodsStockInfo: true, isQueryGoodsPriceInfo: true, isQueryGoodsExtInfo: true, isQuerySetGoodsPriceInfo: true, isQuerySetGoodsSalesInfo: true, isQueryAutoOffline: true, isQueryAutoSell: true, isQuerySkuInfo: true, isQueryDescInfo: true, queryVidBizType: true };

  // 列表总数
  let total = 0; const all = [];
  for (let pn = 1; pn <= 30; pn++) {
    const lb = JSON.parse(lBody); lb.pageNum = pn; lb.page = pn;
    const lr = await post('mall/goods/queryGoodsListWithPageForManagement', lb);
    const pl = (lr.data && lr.data.pageList) || [];
    if (!pl.length) break;
    all.push(...pl); if (pl.length < 20) break;
  }
  total = all.length;
  const coded = all.filter(g => /^\d+$/.test(String(g.outerGoodsCode || ''))).length;
  console.log(`商品总数 ${total} | 本次导入（编码为数字 srcId）${coded}`);

  // 抽样：覆盖三个分类
  const byCat = {};
  products.forEach(p => { (byCat[p.cat1] || (byCat[p.cat1] = [])).push(p); });
  const picks = [];
  for (const c of Object.keys(byCat)) picks.push(byCat[c][0], byCat[c][Math.floor(byCat[c].length / 2)]);
  const sample = picks.slice(0, N);

  console.log('\n=== 抽样详情 ===');
  let bad = 0;
  for (const p of sample) {
    const gid = idx[String(p.srcId)];
    if (!gid) { console.log('✗', p.srcId, '无 goodsId'); bad++; continue; }
    const d = (await post('mall/goods/queryGoodsDetail', { basicInfo: base, solutionType: 2, goodsId: String(gid), filterOption: FO, i18n: { language: 'zh-CN', timezone: 8 }, extendInfo: { refer: '/bos/products/ecGoodsmanage/{bosId}/{key}/goods/list', source: 80 } })).data || {};
    const u = urls[p.srcId] || {};
    const wantG = (u.goods || []).filter(Boolean).length;
    const wantD = (u.detail || []).filter(Boolean).length;
    const gotG = (d.goodsImageUrl || []).length;
    const gotD = ((d.goodsDesc || '').match(/<img /g) || []).length;
    const cat = (d.categoryList || []).map(c => c.categoryName).join('>');
    const ok = gotG === wantG && gotD === wantD && d.isMultiSku;
    if (!ok) bad++;
    console.log(`${ok ? '✓' : '✗'} ${p.srcId} ${String(d.title).slice(0, 22)} | 图 ${gotG}/${wantG} 详情 ${gotD}/${wantD} | ${cat} | isMultiSku=${!!d.isMultiSku} | 编码 ${d.outerGoodsCode}`);
  }
  console.log(`\n抽样 ${sample.length} 个，异常 ${bad} 个`);
  await ctx.close();
})();
