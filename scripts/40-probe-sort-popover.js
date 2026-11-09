/**
 * 40 · 定位「排序」行内编辑的浮层（线上零改动）
 * 点击编辑图标后，扫描整页新增的 input / 弹层文本 / 按钮，仍不提交任何写请求。
 */
const { cfg, launch, login, captureHeaders, post } = require('./lib/common');
const POINTS_PAGE = `${cfg.BASE}/bos/products/ecGoodsmanage/${cfg.BOS_ID}/${cfg.KEY}/goods/pointsMall/index`;
const EP = 'queryPointGoodsListForManagement';
const API = `${cfg.BASE}/api3/mall/point/goods/${EP}`;
const QUERY_OK = ['queryPointGoodsListForManagement', 'queryPointClassifyListWithPageForManagement', 'queryCacheableMenus', 'queryCodeListByProductId', 'getMallNodeInfo'];

const snapInputs = () => Array.from(document.querySelectorAll('input')).map(x => ({
  type: x.type, value: x.value, cls: String(x.className).slice(0, 80),
  ph: x.placeholder || '', vis: !!(x.offsetWidth || x.offsetHeight),
}));

(async () => {
  console.log('=== 排序编辑浮层定位（零改动）===\n');
  const ctx = await launch({ headless: true });
  const page = ctx.pages()[0] || await ctx.newPage();
  page.setDefaultTimeout(60000);
  await page.goto(POINTS_PAGE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);
  if (page.url().includes('account.weimob.com')) {
    await login(page); await page.waitForTimeout(3000);
    await page.goto(POINTS_PAGE, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(6000);
  }
  const cp = await captureHeaders(page, POINTS_PAGE, EP);
  const hdr = cp.headers, pb = cp.payload || {};

  const loc = await page.evaluate(() => {
    const th = Array.from(document.querySelectorAll('th')).find(t => (t.innerText || '').trim() === '排序');
    const idx = Array.from(th.parentElement.children).indexOf(th);
    const rows = Array.from(document.querySelectorAll('tbody tr'));
    let ri = -1;
    for (let i = 0; i < rows.length; i++) {
      const td = rows[i].querySelectorAll('td')[idx];
      if (td && (td.innerText || '').trim() && !/height:\s*0/.test(td.getAttribute('style') || '')) { ri = i; break; }
    }
    return { idx, ri };
  });
  console.log('定位:', JSON.stringify(loc));

  // 拦截所有写请求
  const writes = [];
  await page.route('**/api3/**', route => {
    const req = route.request(), u = req.url();
    if (QUERY_OK.some(q => u.includes(q))) return route.continue();
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method())) {
      writes.push({ url: u, method: req.method(), body: req.postData() });
      console.log('  [拦截]', u);
      return route.abort();
    }
    return route.continue();
  });

  const before = await page.evaluate(snapInputs);
  console.log('点击前可见 input 数:', before.filter(x => x.vis).length);

  const row = page.locator('tbody tr').nth(loc.ri);
  const cell = row.locator('td').nth(loc.idx);
  await cell.hover({ force: true }); await page.waitForTimeout(400);
  await cell.locator('[class*=Edit]').first().click({ force: true });
  await page.waitForTimeout(1500);

  const after = await page.evaluate(snapInputs);
  console.log('点击后可见 input 数:', after.filter(x => x.vis).length);
  const added = after.filter(x => x.vis && !before.some(b => b.vis && b.cls === x.cls && b.value === x.value));
  console.log('新增可见 input:', JSON.stringify(added).slice(0, 900));

  // 找浮层文本
  const layers = await page.evaluate(() => {
    const sels = ['[class*=popover]', '[class*=Popover]', '[class*=tooltip]', '[class*=Tooltip]', '[class*=modal]', '[class*=Modal]', '[class*=bubble]', '[class*=dropdown]'];
    const out = [];
    sels.forEach(s => Array.from(document.querySelectorAll(s)).forEach(el => {
      const t = (el.innerText || '').trim();
      if (t && t.length < 300 && el.offsetHeight > 0) out.push({ cls: String(el.className).slice(0, 70), text: t.replace(/\s+/g, ' ') });
    }));
    return out.slice(0, 12);
  });
  console.log('浮层:', JSON.stringify(layers).slice(0, 1200));

  // 若有可见数字输入框，填入相同值 + 回车（写请求仍被拦）
  const numInp = added.find(x => x.type !== 'checkbox' && x.type !== 'radio');
  if (numInp) {
    console.log('尝试输入相同值:', numInp.value);
    try {
      // 用 page.locator 找可见 input 里值匹配的那个
      const cands = page.locator('input:visible');
      const n = await cands.count();
      let target = null;
      for (let i = 0; i < n; i++) {
        const v = await cands.nth(i).inputValue().catch(() => '');
        if (v === numInp.value) { target = cands.nth(i); break; }
      }
      if (target) {
        await target.fill(numInp.value);
        await page.waitForTimeout(400);
        // 弹窗是「修改排序」+ 取消/确定，必须点「确定」才会发写请求
        const okBtn = page.locator('.klein-modal-footer').getByText('确定', { exact: true });
        console.log('弹窗确定按钮数:', await okBtn.count());
        if (await okBtn.count()) {
          await okBtn.first().click({ force: true, timeout: 6000 });
          console.log('已点击「确定」（写请求拦截中）');
        } else {
          await target.press('Enter');
          console.log('未找到确定按钮，回退回车');
        }
        await page.waitForTimeout(2500);
      }
    } catch (e) { console.log('输入异常:', e.message.slice(0, 140)); }
  }

  console.log('\n=== 捕获的写请求（全部 abort）===');
  if (!writes.length) console.log('  （无）');
  writes.forEach((w, i) => {
    console.log(`  [${i + 1}] ${w.method} ${w.url}`);
    console.log('      body:', (w.body || '').slice(0, 1400));
  });

  const chk = await post(page, API, { ...pb, pageNum: 1, pageSize: 5 }, hdr);
  const f = ((chk.data && chk.data.pageList) || [])[0];
  console.log('\n复核首条 sort:', f && f.sort, f && f.goodsId);
  console.log('=== 结束：线上零改动 ===');
  await ctx.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
