/**
 * 生成入库单 Excel：给导入的 249 个商品全部录 100
 * 用法: node gen-entry100.js [--num=100]
 */
const { chromium } = require('playwright-core');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

const DIR = __dirname;
const PROFILE = path.resolve(DIR, 'profile');
const LIST = 'https://master.weimob.com/bos/products/ecGoodsmanage/4022657115397/6cva1xbh8X2adt8v5yX6cx2wfzo2/goods/list';
const NUM = Number((process.argv.find(a => a.startsWith('--num=')) || '--num=100').split('=')[1]);
const products = JSON.parse(fs.readFileSync(path.join(DIR, 'backup', 'products.json'), 'utf8'));
const cut = n => (n.length > 58 ? n.slice(0, 58) : n);

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
  await ctx.close();
  console.log('库存行:', rows.length);

  const mineNames = new Set(products.map(p => cut(p.name).trim()));
  const mine = rows.filter(r => mineNames.has(String(r.itemSkuTitle || '').trim()));
  console.log('命中我们的 SKU:', mine.length);

  const out = mine.map(r => ({
    商品名称: String(r.itemSkuTitle || '').trim(),
    规格条码: r.productCode,
    '规格/规格值': r.specDetail || '',
    库存单位: r.unitName || '件',
    商品创建来源: '',
    出入库数量: NUM,
  }));
  const header = ['商品名称', '规格条码', '规格/规格值', '库存单位', '商品创建来源', '出入库数量'];
  const ws = XLSX.utils.json_to_sheet(out, { header });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet0');
  const fn = path.join(DIR, 'backup', `入库_全部${NUM}.xlsx`);
  XLSX.writeFile(wb, fn);
  console.log('已生成:', fn, '| 行数', out.length);
  out.slice(0, 3).forEach(x => console.log('  ', JSON.stringify(x)));
})();
