/**
 * 39 · 拦截式定位「改排序」写接口（线上零改动）
 *
 * 手法：页面加载后装 route，让前端真实走一次「排序」行内编辑并提交，
 *       所有非白名单写请求在网络层 abort —— 只记录 URL + body，绝不落到线上。
 *       输入值填「与当前相同的值」，即便漏拦也不会改变数据。
 *
 * 注意：表格含虚拟滚动测量行（height:0 / padding:0），必须跳过，定位真实数据行。
 */
const { cfg, launch, login, captureHeaders, post } = require('./lib/common');

const POINTS_PAGE = `${cfg.BASE}/bos/products/ecGoodsmanage/${cfg.BOS_ID}/${cfg.KEY}/goods/pointsMall/index`;
const EP = 'queryPointGoodsListForManagement';
const API = `${cfg.BASE}/api3/mall/point/goods/${EP}`;
const QUERY_OK = [
  'queryPointGoodsListForManagement', 'queryPointClassifyListWithPageForManagement',
  'queryCacheableMenus', 'queryCodeListByProductId', 'getMallNodeInfo',
];

(async () => {
  console.log('=== 拦截式定位写接口（线上零改动）===\n');
  const ctx = await launch({ headless: true });
  const page = ctx.pages()[0] || await ctx.newPage();
  page.setDefaultTimeout(60000);

  await page.goto(POINTS_PAGE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);
  if (page.url().includes('account.weimob.com')) {
    console.log('登录中…'); await login(page); await page.waitForTimeout(3000);
    await page.goto(POINTS_PAGE, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(6000);
  }

  const cp = await captureHeaders(page, POINTS_PAGE, EP);
  const hdr = cp.headers, pb = cp.payload || {};
  const before = await post(page, API, { ...pb, pageNum: 1, pageSize: 5 }, hdr);
  const beforeFirst = ((before.data && before.data.pageList) || [])[0];
  console.log('变更前首条:', beforeFirst && { goodsId: beforeFirst.goodsId, sort: beforeFirst.sort });

  // ---------- 定位真实数据行 + 排序列 ----------
  const loc = await page.evaluate(() => {
    const ths = Array.from(document.querySelectorAll('th'));
    const th = ths.find(t => (t.innerText || '').trim() === '排序');
    if (!th) return { err: '未找到排序 th' };
    const idx = Array.from(th.parentElement.children).indexOf(th);
    const rows = Array.from(document.querySelectorAll('tbody tr'));
    let ri = -1;
    for (let i = 0; i < rows.length; i++) {
      const td = rows[i].querySelectorAll('td')[idx];
      if (td && (td.innerText || '').trim() && !/height:\s*0/.test(td.getAttribute('style') || '')) { ri = i; break; }
    }
    if (ri < 0) return { err: '未找到真实数据行' };
    const td = rows[ri].querySelectorAll('td')[idx];
    return { idx, ri, totalRows: rows.length, text: (td.innerText || '').trim(), html: td.outerHTML.slice(0, 500) };
  });
  console.log('定位:', JSON.stringify(loc).slice(0, 700));
  if (loc.err) { await ctx.close(); return; }

  // ---------- 装拦截（页面已加载完，只拦后续写请求）----------
  const writes = [];
  await page.route('**/api3/**', route => {
    const req = route.request(), u = req.url();
    if (QUERY_OK.some(q => u.includes(q))) return route.continue();
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method())) {
      writes.push({ url: u, method: req.method(), body: req.postData() });
      console.log('  [拦截] 阻断写请求:', u);
      return route.abort();
    }
    return route.continue();
  });

  const row = page.locator('tbody tr').nth(loc.ri);
  const cell = row.locator('td').nth(loc.idx);
  try {
    await cell.hover({ force: true, timeout: 8000 });
    await page.waitForTimeout(500);
    const icon = cell.locator('[class*=Edit], .table-hover-button').first();
    console.log('编辑图标数:', await cell.locator('[class*=Edit], .table-hover-button').count());
    await icon.click({ force: true, timeout: 8000 });
    console.log('已点击编辑图标');
  } catch (e) { console.log('点击失败:', e.message.slice(0, 160)); }
  await page.waitForTimeout(1200);

  const dom = await cell.evaluate(el => ({
    html: el.outerHTML.slice(0, 900),
    inputs: Array.from(el.querySelectorAll('input')).map(x => ({ type: x.type, value: x.value, cls: x.className })),
  }));
  console.log('编辑态:', JSON.stringify(dom).slice(0, 1000));

  if (dom.inputs.length) {
    const cur = (dom.inputs[0].value || '').trim();
    console.log('填入相同值:', cur);
    try {
      const inp = cell.locator('input').first();
      await inp.fill(cur, { timeout: 6000 });
      await inp.press('Enter', { timeout: 6000 });
      await page.waitForTimeout(2000);
      // 尝试确认按钮
      const ok = cell.getByText(/确定|确认|保存/);
      if (await ok.count()) { await ok.first().click({ force: true, timeout: 3000 }); await page.waitForTimeout(1500); }
    } catch (e) { console.log('提交动作:', e.message.slice(0, 140)); }
  }

  console.log('\n=== 捕获到的写请求（全部已 abort）===');
  if (!writes.length) console.log('  （未触发写请求）');
  writes.forEach((w, i) => {
    console.log(`  [${i + 1}] ${w.method} ${w.url}`);
    console.log('      body:', (w.body || '').slice(0, 1200));
  });

  const after = await post(page, API, { ...pb, pageNum: 1, pageSize: 5 }, hdr);
  const afterFirst = ((after.data && after.data.pageList) || [])[0];
  console.log('\n变更后首条:', afterFirst && { goodsId: afterFirst.goodsId, sort: afterFirst.sort });
  console.log('是否一致:', beforeFirst && afterFirst && String(beforeFirst.sort) === String(afterFirst.sort) ? '✔ 未变（零改动确认）' : '⚠ 需人工复核');
  console.log('\n=== 结束：写请求全部阻断，线上零改动 ===');
  await ctx.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
