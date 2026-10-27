/**
 * 入库单：界面走一遍「添加商品 → 确认入库」，抓完整 API
 */
const { chromium } = require('playwright-core');
const path = require('path');
const fs = require('fs');

const PROFILE = path.resolve(__dirname, 'profile');
const DETAIL = 'https://master.weimob.com/bos/products/ecGoods/4022657115397/6cva1xbh8X2adt8v5yX6cx2wfzo2/stock/inventory/godownEntryDetail?bizType=1101&isDetail=false';

(async () => {
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    executablePath: 'C:/Users/shenghua/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe',
    headless: false, viewport: { width: 1500, height: 950 }, locale: 'zh-CN',
  });
  const page = ctx.pages()[0] || await ctx.newPage();
  page.setDefaultTimeout(60000);
  const reqs = [], resps = [];
  page.on('request', r => {
    if (r.method() === 'POST' && /\/api3\//.test(r.url())) {
      reqs.push({ api: r.url().split('/api3/')[1], body: r.postData() });
    }
  });
  page.on('response', async r => {
    if (/\/api3\//.test(r.url()) && /godown|entry|stock|inventory/i.test(r.url())) {
      try { resps.push({ api: r.url().split('/api3/')[1], text: (await r.text()).slice(0, 400) }); } catch (e) { }
    }
  });

  await page.goto(DETAIL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(14000);
  // 选「其他入库」
  await page.evaluate(() => {
    const els = [...document.querySelectorAll('*')].filter(e => (e.innerText || '').trim() === '其他入库' && e.offsetParent !== null);
    if (els.length) els[els.length - 1].click();
  });
  await page.waitForTimeout(1500);

  // 点「添加商品」
  await page.evaluate(() => {
    const els = [...document.querySelectorAll('*')].filter(e => (e.innerText || '').trim() === '添加商品' && e.offsetParent !== null);
    if (els.length) els[els.length - 1].click();
  });
  await page.waitForTimeout(5000);
  await page.screenshot({ path: path.join(__dirname, 'shots2', 'entry-add-1.png') });

  // 弹窗里搜索商品
  const dlgTxt = await page.evaluate(() => {
    const d = document.querySelector('.klein-modal-wrap, .klein-modal, .klein-drawer');
    return d ? d.innerText.replace(/\n+/g, ' | ').slice(0, 400) : '(无)';
  });
  console.log('添加商品弹窗:', dlgTxt);

  // 尝试输入搜索词
  const inputs = page.locator('.klein-modal input, .klein-drawer input');
  const cnt = await inputs.count();
  console.log('弹窗内输入框数:', cnt);
  if (cnt) {
    await inputs.last().fill('晨光').catch(() => { });
    await page.waitForTimeout(2500);
    // 按回车搜索
    await inputs.last().press('Enter').catch(() => { });
    await page.waitForTimeout(3500);
  }
  await page.screenshot({ path: path.join(__dirname, 'shots2', 'entry-add-2.png') });

  // 勾选第一行
  const checked = await page.evaluate(() => {
    const boxes = [...document.querySelectorAll('.klein-modal tbody .klein-checkbox, .klein-modal .klein-table tbody .klein-checkbox')].filter(x => x.offsetParent !== null);
    if (boxes.length) { boxes[0].click(); return boxes.length; }
    return 0;
  });
  console.log('勾选行数:', checked);
  await page.waitForTimeout(1200);

  // 点弹窗「确定」
  const ok = await page.evaluate(() => {
    const b = [...document.querySelectorAll('.klein-modal button, .klein-drawer button')].filter(x => ['确定', '确 定', '加入'].includes((x.innerText || '').trim()));
    if (b.length) { b[b.length - 1].click(); return (b[b.length - 1].innerText || '').trim(); }
    return '';
  });
  console.log('点确定:', ok);
  await page.waitForTimeout(5000);
  await page.screenshot({ path: path.join(__dirname, 'shots2', 'entry-add-3.png') });

  const tblTxt = await page.evaluate(() => {
    const t = document.querySelector('table');
    return t ? t.innerText.replace(/\n+/g, ' | ').slice(0, 500) : '(无表格)';
  });
  console.log('商品表:', tblTxt);

  // 填数量（如果有输入框）
  const qty = await page.evaluate(() => {
    const ins = [...document.querySelectorAll('tbody input')].filter(x => x.offsetParent !== null);
    if (!ins.length) return 0;
    ins.forEach(i => {
      i.focus(); i.value = '100';
      i.dispatchEvent(new Event('input', { bubbles: true }));
      i.dispatchEvent(new Event('change', { bubbles: true }));
      i.blur();
    });
    return ins.length;
  });
  console.log('填数量输入框:', qty);
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(__dirname, 'shots2', 'entry-add-4.png') });

  // 全选 + 确认入库
  await page.evaluate(() => {
    const th = document.querySelector('thead .klein-checkbox');
    if (th) th.click();
    else {
      const bs = [...document.querySelectorAll('tbody .klein-checkbox')].filter(x => x.offsetParent !== null);
      bs.forEach(b => b.click());
    }
  });
  await page.waitForTimeout(1500);

  const c2 = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].filter(x => (x.innerText || '').trim() === '确认入库' && x.offsetParent !== null);
    if (b.length) { b[0].click(); return 1; }
    return 0;
  });
  console.log('确认入库:', c2);
  await page.waitForTimeout(4000);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('.klein-modal button')].filter(x => /确\s*定|确认/.test((x.innerText || '').trim()));
    if (b.length) b[b.length - 1].click();
  });
  await page.waitForTimeout(8000);
  await page.screenshot({ path: path.join(__dirname, 'shots2', 'entry-add-5.png') });
  const msg = await page.evaluate(() => [...document.querySelectorAll('.klein-message, [class*=message]')].map(e => e.innerText.trim()).filter(Boolean).join(' | '));
  console.log('提示:', msg || '(无)');

  console.log('\n=== 相关请求 ===');
  reqs.filter(r => /godown|entry|stock|inventory/i.test(r.api)).forEach(r => {
    console.log(`\n[${r.api}]`);
    console.log('  ', (r.body || '').replace(/\s+/g, ' ').slice(0, 600));
  });
  console.log('\n=== 相关响应 ===');
  resps.filter(r => /godown|entry|stock|inventory/i.test(r.api)).forEach(r => console.log(`[${r.api}] → ${r.text.slice(0, 200)}`));
  fs.writeFileSync(path.join(__dirname, 'out', 'entry-api.json'), JSON.stringify({ reqs, resps }, null, 1));
  await ctx.close();
})();
