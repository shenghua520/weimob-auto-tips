/**
 * 测量店铺列表页商品图容器比例 + object-fit
 */
const { chromium } = require('playwright-core');
const path = require('path');
const fs = require('fs');

const PROFILE = path.resolve(__dirname, 'profile');
const SHOP = 'https://1183226397.shop.n.weimob.com/bos/shop/1183226397/6017568309397/24343313397/goods/detail/index?id=161456140100397';

(async () => {
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    executablePath: 'C:/Users/shenghua/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe',
    headless: false,
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    locale: 'zh-CN',
  });
  const page = ctx.pages()[0] || await ctx.newPage();
  page.setDefaultTimeout(60000);
  await page.goto(SHOP, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(10000);

  // 点「店铺首页」
  await page.evaluate(() => {
    const els = [...document.querySelectorAll('*')].filter(e => (e.innerText || '').trim() === '店铺首页' && e.offsetParent !== null);
    if (els.length) els[0].click();
  });
  await page.waitForTimeout(9000);
  console.log('当前 URL:', page.url());
  await page.screenshot({ path: path.join(__dirname, 'shots2', 'shop-home.png') });

  const data = await page.evaluate(() => {
    const out = { imgs: [], cards: [] };
    [...document.querySelectorAll('img')].forEach(el => {
      const b = el.getBoundingClientRect();
      if (b.width < 60) return;
      const cs = getComputedStyle(el);
      out.imgs.push({
        w: Math.round(b.width), h: Math.round(b.height),
        ratio: +(b.width / b.height).toFixed(3),
        natW: el.naturalWidth, natH: el.naturalHeight,
        natRatio: el.naturalWidth ? +(el.naturalWidth / el.naturalHeight).toFixed(3) : null,
        fit: cs.objectFit, pos: cs.objectPosition,
        parentW: Math.round(el.parentElement ? el.parentElement.getBoundingClientRect().width : 0),
        parentH: Math.round(el.parentElement ? el.parentElement.getBoundingClientRect().height : 0),
        parentRatio: el.parentElement && el.parentElement.getBoundingClientRect().height
          ? +(el.parentElement.getBoundingClientRect().width / el.parentElement.getBoundingClientRect().height).toFixed(3) : null,
        src: (el.currentSrc || el.src || '').slice(-48),
        cls: (el.className || '').slice(0, 40),
      });
    });
    return out;
  });

  console.log('\n=== 列表页图片 ===');
  data.imgs.slice(0, 12).forEach((m, i) => {
    console.log(`[${i}] 显示 ${m.w}x${m.h} (比例 ${m.ratio}) | 原图 ${m.natW}x${m.natH} (比例 ${m.natRatio}) | fit=${m.fit} pos=${m.pos} | 父容器 ${m.parentW}x${m.parentH} (比例 ${m.parentRatio})`);
    console.log(`     src=…${m.src}`);
  });
  fs.writeFileSync(path.join(__dirname, 'out', 'list-img.json'), JSON.stringify(data, null, 1));
  await ctx.close();
})();
