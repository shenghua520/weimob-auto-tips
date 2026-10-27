/**
 * 手机仿真查看商品详情页（定位图片不自适应问题）
 * 用法: node mobile-review.js [goodsId]
 */
const { chromium, devices } = require('playwright-core');
const path = require('path');
const fs = require('fs');

const PROFILE = path.resolve(__dirname, 'profile');
const GID = process.argv[2] || '161456295100397';
const URL = `https://1183226397.shop.n.weimob.com/bos/shop/1183226397/6017568309397/24343313397/goods/detail/index?id=${GID}`;

(async () => {
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    executablePath: 'C:/Users/shenghua/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe',
    headless: false,
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    locale: 'zh-CN',
  });
  const page = ctx.pages()[0] || await ctx.newPage();
  page.setDefaultTimeout(60000);
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(12000);

  const info = await page.evaluate(() => {
    const imgs = [...document.querySelectorAll('img')];
    return imgs.map((el, i) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        i, src: (el.currentSrc || el.src || '').slice(-40),
        w: Math.round(r.width), h: Math.round(r.height),
        natW: el.naturalWidth, natH: el.naturalHeight,
        style: el.getAttribute('style'), cssW: cs.width, cssMaxW: cs.maxWidth, display: cs.display,
        parentTag: el.parentElement ? el.parentElement.tagName : '',
        parentHtml: el.parentElement ? el.parentElement.outerHTML.slice(0, 200) : '',
      };
    });
  }).catch(() => []);

  console.log('页面图片数:', info.length);
  info.slice(0, 20).forEach(m => console.log(` [${m.i}] ${m.w}x${m.h} (原图 ${m.natW}x${m.natH}) display=${m.display} maxW=${m.cssMaxW} style=${m.style} src=…${m.src}`));

  const vids = await page.evaluate(() => [...document.querySelectorAll('video')].map(v => ({
    src: (v.currentSrc || v.src || '').slice(-40), w: Math.round(v.getBoundingClientRect().width), h: Math.round(v.getBoundingClientRect().height),
  })));
  console.log('页面 video 元素:', vids.length, vids.length ? JSON.stringify(vids) : '');

  const txt = await page.evaluate(() => document.body.innerText.replace(/\n+/g, ' | ').slice(0, 400));
  console.log('\n页面文本:', txt);

  const outDir = path.join(__dirname, 'shots2');
  fs.mkdirSync(outDir, { recursive: true });
  await page.screenshot({ path: path.join(outDir, `mobile-${GID}.png`) });
  // 滚到详情区
  for (let y = 600; y < 4000; y += 700) {
    await page.evaluate(yy => window.scrollTo(0, yy), y);
    await page.waitForTimeout(600);
  }
  await page.screenshot({ path: path.join(outDir, `mobile-${GID}-bottom.png`) });
  fs.writeFileSync(path.join(__dirname, 'out', `mobile-${GID}.json`), JSON.stringify({ info, txt }, null, 1));
  console.log('\n截图: shots2/mobile-' + GID + '.png / -bottom.png');
  await ctx.close();
})();
