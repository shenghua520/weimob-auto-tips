/**
 * 库存核验（只读）：我们的商品库存是否为 100，列出未命中的商品
 */
const { chromium } = require('playwright-core');
const path = require('path');
const fs = require('fs');

const DIR = __dirname;
const PROFILE = path.resolve(DIR, 'profile');
const LIST = 'https://master.weimob.com/bos/products/ecGoodsmanage/4022657115397/6cva1xbh8X2adt8v5yX6cx2wfzo2/goods/list';
const products = JSON.parse(fs.readFileSync(path.join(DIR, 'backup', 'products.json'), 'utf8'));
const TITLE_MAX = 58;
const cut = n => (n.length > TITLE_MAX ? n.slice(0, TITLE_MAX) : n);
const mineNames = new Set(products.map(p => cut(p.name).trim()));

(async () => {
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    executablePath: 'C:/Users/shenghua/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe',
    headless: false, viewport: { width: 1300, height: 850 }, locale: 'zh-CN',
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

  const rows = [];
  for (let pn = 1; pn <= 60; pn++) {
    const r = await post('mall/mgr/stock/queryStoreStockListWithPage', {
      basicInfo: base, solutionType: 2, queryParameter: { classifyId: '', type: 0, stockStatus: null },
      pageNum: pn, pageSize: 20, i18n: { language: 'zh-CN', timezone: 8 },
      extendInfo: { refer: '/bos/products/ecGoods/{bosId}/{key}/stock/stock-adjustment' },
    });
    const l = (r.data && r.data.pageList) || [];
    rows.push(...l); if (l.length < 20) break;
  }
  console.log('库存行总数:', rows.length);

  const mine = rows.filter(r => mineNames.has(String(r.itemSkuTitle || '').trim()));
  const stockOf = r => (r.storeWarehouse && r.storeWarehouse.totalStockNum) ?? r.totalStockNum;
  const usableOf = r => (r.storeWarehouse && r.storeWarehouse.usableStockNum) ?? r.usableStockNum;
  const dist = {};
  mine.forEach(r => { const s = stockOf(r); dist[s] = (dist[s] || 0) + 1; });
  console.log('我们商品命中 SKU:', mine.length, '| 库存分布:', JSON.stringify(dist));

  const hitSrc = new Set(mine.map(r => String(r.itemSkuTitle).trim()));
  const missing = products.filter(p => !hitSrc.has(cut(p.name).trim()));
  console.log('\n未命中商品:', missing.length);
  missing.forEach(m => {
    console.log(`  ${m.srcId} | 名=${cut(m.name).slice(0, 30)}`);
    // 找库存行里的相似项
    const cand = rows.filter(r => {
      const t = String(r.itemSkuTitle || '');
      const key = cut(m.name).slice(0, 10);
      return t.includes(key.slice(0, 6));
    }).slice(0, 3);
    cand.forEach(c => console.log(`      候选: ${String(c.itemSkuTitle).slice(0, 40)} | 库存 ${stockOf(c)}`));
  });

  const low = rows.filter(r => mineNames.has(String(r.itemSkuTitle || '').trim()) && stockOf(r) !== 100);
  if (low.length) { console.log('\n库存不等于 100 的行:', low.length); low.slice(0, 8).forEach(r => console.log('  ', String(r.itemSkuTitle).slice(0, 26), '=', stockOf(r))); }
  fs.writeFileSync(path.join(DIR, 'out', 'check-stock.json'), JSON.stringify({ rows: rows.length, mine: mine.length, dist, missing: missing.map(m => m.srcId), low: low.map(r => ({ t: r.itemSkuTitle, s: stockOf(r) })) }, null, 1));
  await ctx.close();
})();
