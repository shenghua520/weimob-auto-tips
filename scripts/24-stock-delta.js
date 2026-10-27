/**
 * 用增量方式把库存调到目标值（可能为负）
 * 用法: node stock-delta.js [--num=100] [--dry]
 */
const { chromium } = require('playwright-core');
const path = require('path');
const fs = require('fs');

const DIR = __dirname;
const PROFILE = path.resolve(DIR, 'profile');
const LIST = 'https://master.weimob.com/bos/products/ecGoodsmanage/4022657115397/6cva1xbh8X2adt8v5yX6cx2wfzo2/goods/list';
const NUM = Number((process.argv.find(a => a.startsWith('--num=')) || '--num=100').split('=')[1]);
const DRY = process.argv.includes('--dry');
const LIMIT = Number((process.argv.find(a => a.startsWith('--limit=')) || '').split('=')[1] || 0);
const products = JSON.parse(fs.readFileSync(path.join(DIR, 'backup', 'products.json'), 'utf8'));
const cut = n => (n.length > 58 ? n.slice(0, 58) : n);
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
  const stockOf = r => (r.storeWarehouse && r.storeWarehouse.totalStockNum) ?? r.totalStockNum ?? 0;
  const mine = rows.filter(r => mineNames.has(String(r.itemSkuTitle || '').trim()));
  const bad = mine.filter(r => stockOf(r) !== NUM);
  console.log(`需调整 ${bad.length} 个`);

  if (DRY) { bad.forEach(b => console.log('  ', b.itemSkuId, stockOf(b), '→', NUM, 'delta', NUM - stockOf(b))); await ctx.close(); return; }

  for (const b of (LIMIT ? bad.slice(0, LIMIT) : bad)) {
    const delta = NUM - stockOf(b);
    const r = await post('mall/mgr/stock/createAsyncStockTask', {
      basicInfo: base, solutionType: 2, assignType: 2, stockNum: delta, storeIdList: [],
      itemSkuIdList: [b.itemSkuId], i18n: { language: 'zh-CN', timezone: 8 },
      extendInfo: { refer: '/bos/products/ecGoods/{bosId}/{key}/stock/stock-adjustment', source: 80 },
    });
    console.log(`  ${b.itemSkuId} 当前${stockOf(b)} delta${delta} → ${JSON.stringify(r).slice(0, 90)}`);
    await new Promise(x => setTimeout(x, 100));
  }
  await ctx.close();
})();
