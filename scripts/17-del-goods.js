/**
 * 按指定 ID 删除商品（先快照再删）
 * 用法: node del-goods.js <id1,id2,...> [--yes]
 */
const { chromium } = require('playwright-core');
const path = require('path');
const fs = require('fs');
const PROFILE = path.resolve(__dirname, 'profile');
const LIST = 'https://master.weimob.com/bos/products/ecGoodsmanage/4022657115397/6cva1xbh8X2adt8v5yX6cx2wfzo2/goods/list';
const DEL = 'https://master.weimob.com/api3/mall/goods/deleteGoods';
const IDS = (process.argv[2] || '').split(',').filter(Boolean);
const YES = process.argv.includes('--yes');
const DRY = process.argv.includes('--dry');

(async () => {
  if (!IDS.length) { console.log('用法: node del-goods.js <id,id,...> [--yes]'); return; }
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    executablePath: 'C:/Users/shenghua/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe',
    headless: false, viewport: { width: 1200, height: 800 }, locale: 'zh-CN',
  });
  const page = ctx.pages()[0] || await ctx.newPage();
  let H = null, lBody = null;
  page.on('request', r => { if (r.url().includes('queryGoodsListWithPageForManagement')) { H = r.headers(); lBody = r.postData(); } });
  await page.goto(LIST, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(12000);
  const keep = ['authorization', 'apiclient', 'weimob-bosid', 'content-type', 'referer'];
  const headers = {}; keep.forEach(k => { if (H[k]) headers[k] = H[k]; });
  const qBase = JSON.parse(lBody);
  const rpost = async (url, ep, body) => {
    const res = await page.evaluate(async ({ url, body, headers }) => {
      const r = await fetch(url, { method: 'POST', headers, credentials: 'include', body: JSON.stringify(body) });
      return await r.text();
    }, { url, body, headers });
    try { return JSON.parse(res); } catch (e) { return { errcode: 'x', errmsg: res.slice(0, 150) }; }
  };

  // 1) 先快照：从商品列表取目标商品当前信息落盘
  const all = [];
  for (let pn = 1; pn <= 30; pn++) {
    const lb = JSON.parse(JSON.stringify(qBase)); lb.pageNum = pn; lb.page = pn;
    const lr = await rpost('https://master.weimob.com/api3/mall/goods/queryGoodsListWithPageForManagement', 'x', lb);
    const pl = (lr.data && lr.data.pageList) || [];
    if (!pl.length) break;
    all.push(...pl);
    if (pl.length < 20) break;
  }
  const snap = all.filter(g => IDS.includes(String(g.goodsId)))
    .map(g => ({ goodsId: g.goodsId, title: g.title, outerGoodsCode: g.outerGoodsCode, goodsStatus: g.goodsStatus, isOnline: g.isOnline, images: (g.goodsImageUrl || []).length }));
  IDS.forEach(id => { if (!snap.some(s => String(s.goodsId) === id)) snap.push({ goodsId: id, title: '(列表中未找到)', outerGoodsCode: null }); });
  const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const snapFile = path.join(__dirname, 'backup', `删除前快照_${ts}.json`);
  fs.writeFileSync(snapFile, JSON.stringify(snap, null, 1));
  console.log('=== 待删除快照（已存', snapFile, '）===');
  snap.forEach(s => console.log(' ', s.goodsId, '| code=', s.outerGoodsCode, '|', s.title, '| 图', s.images, '| desc', s.descLen));

  if (DRY || !YES) { console.log('\n(dry run / 未加 --yes，未执行删除)'); await ctx.close(); return; }

  // 2) 删除
  const body = {
    basicInfo: qBase.basicInfo, solutionType: 2,
    goodsIdList: IDS.map(Number), isDeleteAuditInfo: false,
    i18n: qBase.i18n, extendInfo: qBase.extendInfo,
  };
  const r = await rpost(DEL, '', body);
  console.log('\n删除结果:', JSON.stringify(r).slice(0, 200));
  fs.writeFileSync(path.join(__dirname, 'backup', `删除记录_${ts}.json`), JSON.stringify({ ids: IDS, snap, result: r }, null, 1));
  await ctx.close();
})();
