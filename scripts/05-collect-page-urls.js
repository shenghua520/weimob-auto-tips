/**
 * 05 · 采集装修页面里在用的图片（只读）
 *
 * 目的：算出"哪些素材仍被页面引用"，避免清素材时把首页图删掉。
 *
 * 做法：拿页面清单 → 逐个打开编辑器 → 从 DSL 响应里提取 image-c.weimobwmc.com 的 URL
 *
 * 产出：out/used-urls.json  { perPage:[{pageId,pageName,count}], urls:[...] }
 */
const fs = require('fs');
const path = require('path');
const { launch, cfg, PATHS } = require('./lib/common');

const HOST = 'image-c.weimobwmc.com';
const PAGES_LIST = `${cfg.BASE}/bos/products/mpcms/${cfg.BOS_ID}/${cfg.KEY}/pages/custom`;
const EDITOR = pid => `${cfg.BASE}/bos/products/mpcms/${cfg.BOS_ID}/${cfg.KEY}/design/editor?pageid=${pid}&allChannelHome=false`;

/** 从响应文本里提取图片 URL（DSL 是转义过的 JSON，不能直接正则） */
function pickUrls(str) {
  const out = new Set();
  for (const p of str.split('"')) {
    if (p.indexOf(HOST) < 0) continue;
    const clean = p.replace(/\\+$/g, '').replace(/\\u002F/gi, '/');
    const k = clean.indexOf('http');
    if (k > -1) out.add(clean.slice(k));
  }
  return Array.from(out);
}

(async () => {
  const ctx = await launch();
  const page = ctx.pages()[0] || await ctx.newPage();
  page.setDefaultTimeout(90000);

  // 1) 页面清单
  let listBody = null;
  page.on('response', async r => {
    if (!r.url().includes('cms/mgr/page/query')) return;
    if (r.url().includes('queryListCombinedData')) return;
    const b = await r.text().catch(() => '');
    if (b.indexOf('pageList') > -1) listBody = b;
  });
  await page.goto(PAGES_LIST, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(12000);
  if (!listBody) { console.log('未取到页面清单'); await ctx.close(); return; }

  const pages = (JSON.parse(listBody).data || {}).pageList || [];
  console.log('页面数:', pages.length);
  pages.forEach(p => console.log(`  ${p.pageId} | ${p.pageName} | 首页=${p.home} | ${p.releaseStatusDesc || ''}`));

  // 2) 逐页抓 DSL
  const allUrls = new Set();
  const perPage = [];

  for (const p of pages) {
    let bodies = '';
    const h = async r => {
      if (!r.url().includes('mp-decoration') && !r.url().includes('/cms/')) return;
      const b = await r.text().catch(() => '');
      if (b.length > 3000 && b.indexOf(HOST) > -1) bodies += b;
    };
    page.on('response', h);
    try {
      await page.goto(EDITOR(p.pageId), { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(13000);
    } catch (e) { console.log('  打开失败', p.pageName, e.message.slice(0, 60)); }
    page.off('response', h);

    const urls = bodies ? pickUrls(bodies) : [];
    urls.forEach(u => allUrls.add(u));
    perPage.push({ pageId: p.pageId, pageName: p.pageName, count: urls.length });
    console.log(`  ${p.pageName} → 图片 ${urls.length} 个`);
  }

  const stamp = new Date().toISOString().slice(0, 19).replace(/[:]/g, '-');
  fs.writeFileSync(path.join(PATHS.OUT, 'used-urls.json'), JSON.stringify({ perPage, urls: Array.from(allUrls) }, null, 1), 'utf8');
  fs.writeFileSync(path.join(PATHS.OUT, `used-urls_${stamp}.json`), JSON.stringify({ perPage, urls: Array.from(allUrls) }, null, 1), 'utf8');
  console.log('\n合计被引用图片:', allUrls.size, '→ out/used-urls.json');
  await ctx.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
