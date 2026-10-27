/**
 * 手机端批量体检：逐张比对「显示比例 vs 原图比例」，揪出被裁切/不变比的图
 * 用法: node review-mobile.js [抽样数] [--all]
 */
const { chromium } = require('playwright-core');
const path = require('path');
const fs = require('fs');

const PROFILE = path.resolve(__dirname, 'profile');
const idx = JSON.parse(fs.readFileSync(path.join(__dirname, 'backup', '商品ID映射.json'), 'utf8'));
const products = JSON.parse(fs.readFileSync(path.join(__dirname, 'backup', 'products.json'), 'utf8'));
const N = Number(process.argv[2] || 12);
const ALL = process.argv.includes('--all');

const TOL = 0.02; // 2% 比例误差

(async () => {
  // 按分类分层抽样
  let picks = [];
  if (ALL) {
    picks = products.filter(p => idx[String(p.srcId)]);
  } else {
    const byCat = {};
    products.forEach(p => { if (idx[String(p.srcId)]) (byCat[p.cat1] || (byCat[p.cat1] = [])).push(p); });
    const cats = Object.keys(byCat);
    const per = Math.ceil(N / cats.length);
    cats.forEach(c => {
      const arr = byCat[c];
      const step = Math.max(1, Math.floor(arr.length / per));
      for (let i = 0; i < per && i * step < arr.length; i++) picks.push(arr[i * step]);
    });
    picks = picks.slice(0, N);
  }
  console.log(`体检 ${picks.length} 个商品`);

  const ctx = await chromium.launchPersistentContext(PROFILE, {
    executablePath: 'C:/Users/shenghua/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe',
    headless: true,
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    locale: 'zh-CN',
  });
  const page = ctx.pages()[0] || await ctx.newPage();
  page.setDefaultTimeout(45000);

  const bad = [], noStock = [], results = [];
  for (const p of picks) {
    const gid = idx[String(p.srcId)];
    const url = `https://1183226397.shop.n.weimob.com/bos/shop/1183226397/6017568309397/24343333397/goods/detail/index?id=${gid}`;
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(7000);
      // 滚到底让图片全部加载
      for (let y = 400; y < 3200; y += 800) { await page.evaluate(yy => window.scrollTo(0, yy), y); await page.waitForTimeout(300); }
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(600);

      const r = await page.evaluate((tol) => {
        const out = { imgs: 0, issues: [], soldOut: false };
        out.soldOut = /商品已售完|已售完/.test(document.body.innerText);
        [...document.querySelectorAll('img')].forEach(el => {
          const b = el.getBoundingClientRect();
          if (b.width < 30 || !el.naturalWidth) return;
          out.imgs++;
          const shown = b.width / b.height;
          const real = el.naturalWidth / el.naturalHeight;
          const diff = Math.abs(shown - real) / real;
          if (diff > tol) out.issues.push({ w: Math.round(b.width), h: Math.round(b.height), natW: el.naturalWidth, natH: el.naturalHeight, diff: +(diff * 100).toFixed(1) });
        });
        return out;
      }, TOL);

      const line = `${r.issues.length ? '✗' : '✓'} ${p.srcId} 图${r.imgs} 异常${r.issues.length}${r.soldOut ? ' [售完]' : ''}`;
      console.log(line + (r.issues.length ? ' ' + r.issues.slice(0, 2).map(i => `${i.w}x${i.h}/${i.natW}x${i.natH} 偏差${i.diff}%`).join(' ') : ''));
      results.push({ srcId: p.srcId, goodsId: gid, ...r });
      if (r.issues.length) bad.push({ srcId: p.srcId, goodsId: gid, issues: r.issues });
      if (r.soldOut) noStock.push(p.srcId);
    } catch (e) {
      console.log(`! ${p.srcId} 失败: ${e.message.slice(0, 60)}`);
    }
  }

  console.log(`\n=== 汇总 ===`);
  console.log(`体检 ${results.length} 个 | 比例异常 ${bad.length} 个 | 已售完 ${noStock.length} 个`);
  if (bad.length) bad.slice(0, 10).forEach(b => console.log('  异常:', b.srcId, JSON.stringify(b.issues.slice(0, 3))));
  fs.writeFileSync(path.join(__dirname, 'out', 'review-mobile.json'), JSON.stringify({ results, bad, noStock }, null, 1));
  await ctx.close();
})();
