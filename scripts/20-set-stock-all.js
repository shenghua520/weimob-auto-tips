/**
 * 批量录库存（覆盖式）：把我们导入的 249 个商品的所有 SKU 设为指定数量
 * 用法: node set-stock-all.js [--num=100] [--dry]
 */
const { chromium } = require('playwright-core');
const path = require('path');
const fs = require('fs');

const DIR = __dirname;
const PROFILE = path.resolve(DIR, 'profile');
const LIST = 'https://master.weimob.com/bos/products/ecGoodsmanage/4022657115397/6cva1xbh8X2adt8v5yX6cx2wfzo2/goods/list';
const NUM = Number((process.argv.find(a => a.startsWith('--num=')) || '--num=100').split('=')[1]);
const DRY = process.argv.includes('--dry');

const products = JSON.parse(fs.readFileSync(path.join(DIR, 'backup', 'products.json'), 'utf8'));
const TITLE_MAX = 58;
const cut = n => (n.length > TITLE_MAX ? n.slice(0, TITLE_MAX) : n);
const mineNames = new Set(products.map(p => cut(p.name).trim()));
const srcOf = {};
products.forEach(p => { srcOf[cut(p.name).trim()] = p.srcId; });

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
    try { return JSON.parse(t); } catch (e) { return { raw: t.slice(0, 200) }; }
  };

  // 1) 拉全部库存行
  const rows = [];
  for (let pn = 1; pn <= 60; pn++) {
    const r = await post('mall/mgr/stock/queryStoreStockListWithPage', {
      basicInfo: base, solutionType: 2,
      queryParameter: { classifyId: '', type: 0, stockStatus: null },
      pageNum: pn, pageSize: 20, i18n: { language: 'zh-CN', timezone: 8 },
      extendInfo: { refer: '/bos/products/ecGoods/{bosId}/{key}/stock/stock-adjustment' },
    });
    const l = (r.data && r.data.pageList) || [];
    rows.push(...l);
    if (l.length < 20) break;
  }
  console.log('库存行总数:', rows.length);

  // 2) 筛出我们导入的商品
  const targets = rows.filter(r => mineNames.has(String(r.itemSkuTitle || '').trim()));
  const uniqSrc = new Set(targets.map(t => srcOf[String(t.itemSkuTitle).trim()]));
  console.log(`命中我们导入的 SKU ${targets.length} 行 / 覆盖商品 ${uniqSrc.size} 个`);
  const missing = products.filter(p => !uniqSrc.has(p.srcId));
  if (missing.length) { console.log('未命中库存行的商品:', missing.length, missing.slice(0, 5).map(m => m.srcId).join(',')); }

  if (DRY) { console.log('dry run，未提交'); await ctx.close(); return; }

  // 3) 逐个设置（assignType=1 覆盖）
  let ok = 0, fail = 0; const errs = [];
  for (const t of targets) {
    const r = await post('mall/mgr/stock/createAsyncStockTask', {
      basicInfo: base, solutionType: 2, assignType: 1, stockNum: NUM, storeIdList: [],
      itemSkuIdList: [t.itemSkuId], i18n: { language: 'zh-CN', timezone: 8 },
      extendInfo: { refer: '/bos/products/ecGoods/{bosId}/{key}/stock/stock-adjustment', source: 80 },
    });
    if (String(r.errcode) === '0') { ok++; if (ok % 50 === 0) console.log(`  ${ok} 行已提交 | 剩 ${targets.length - ok}`); }
    else { fail++; if (errs.length < 5) errs.push({ sku: t.itemSkuId, title: String(t.itemSkuTitle).slice(0, 20), err: JSON.stringify(r).slice(0, 120) }); }
    await new Promise(x => setTimeout(x, 60));
  }
  console.log(`\n库存提交: 成功 ${ok} / 失败 ${fail}（异步任务，约 10-30 秒生效）`);
  if (errs.length) errs.forEach(e => console.log('  ✗', e.title, e.err));

  // 4) 等待生效后抽验
  await new Promise(x => setTimeout(x, 15000));
  const check = await post('mall/mgr/stock/queryStoreStockListWithPage', {
    basicInfo: base, solutionType: 2,
    queryParameter: { classifyId: '', type: 0, stockStatus: null },
    pageNum: 1, pageSize: 20, i18n: { language: 'zh-CN', timezone: 8 },
    extendInfo: { refer: '/bos/products/ecGoods/{bosId}/{key}/stock/stock-adjustment' },
  });
  const sample = ((check.data && check.data.pageList) || []).filter(r => mineNames.has(String(r.itemSkuTitle || '').trim())).slice(0, 5);
  sample.forEach(s => console.log(`  验: ${String(s.itemSkuTitle).slice(0, 22)} | 库存 ${s.totalStockNum} 可用 ${s.usableStockNum}`));
  await ctx.close();
})();
