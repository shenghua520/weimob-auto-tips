/**
 * 36 · 积分商品「排序」写接口只读探查（零写操作）
 *
 * 只读手段：
 *   - 收集页面加载的 JS 静态资源文本，grep 可能的排序相关接口名
 *   - 读取「排序」控件附近的 DOM / 按钮文本（不点击任何提交）
 *   - 被动监听 queryPointGoodsListForManagement 的查询 payload，看有无排序参数
 * 不点击、不提交、不调用任何写接口。
 */
const { cfg, launch, login } = require('./lib/common');

const POINTS_PAGE =
  `${cfg.BASE}/bos/products/ecGoodsmanage/${cfg.BOS_ID}/${cfg.KEY}/goods/pointsMall/index`;
const BLOCK = [
  'moveGoodsToClassify', 'addPointGoods', 'updatePointGoods', 'deletePointGoods',
  '/goods/update', '/goods/delete', '/goods/import', '/point/goods/save',
];

(async () => {
  console.log('=== 排序写接口只读探查 ===\n');
  const ctx = await launch({ headless: true });
  const page = ctx.pages()[0] || await ctx.newPage();
  page.setDefaultTimeout(60000);
  await page.route('**/api3/**', r => {
    const u = r.request().url();
    if (BLOCK.some(b => u.includes(b))) { console.error('  [守卫] 阻断:', u); return r.abort(); }
    return r.continue();
  });

  // 1) 抓查询接口的同源 payload（含请求头字段与 queryParameter）
  let queryPayload = null;
  page.on('request', r => {
    if (r.url().includes('queryPointGoodsListForManagement') && r.postData()) {
      try { queryPayload = JSON.parse(r.postData()); } catch (e) {}
    }
  });

  // 2) 收集 JS 资源文本里的积分域接口名（含写动作候选）
  const jsHits = new Map();
  page.on('response', async r => {
    const u = r.url();
    if (!/\.js(\?|$)/.test(u)) return;
    try {
      const t = await r.text();
      const re = /["'`](\/api3\/)?(mall\/point\/[^"'`\s]{4,90})["'`]/g;
      let m;
      while ((m = re.exec(t))) {
        const ep = m[2];
        if (/sort|order|drag|move|sequence|rank|update|save|batch|edit|set/i.test(ep)) {
          if (!jsHits.has(ep)) jsHits.set(ep, u.slice(0, 120));
        }
      }
    } catch (e) {}
  });

  await page.goto(POINTS_PAGE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(7000);
  if (page.url().includes('account.weimob.com')) {
    console.log('登录中…');
    await login(page);
    await page.waitForTimeout(3000);
    await page.goto(POINTS_PAGE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(7000);
  }

  console.log('=== 查询接口 payload（只读）===');
  console.log(queryPayload ? JSON.stringify(queryPayload).slice(0, 900) : '（未捕获）');
  if (queryPayload) console.log('queryParameter =', JSON.stringify(queryPayload.queryParameter));

  // 3) 页面按钮 / 排序控件上下文（所有 frame，只读）
  console.log('\n=== 按钮与「排序」上下文（只读）===');
  for (const f of page.frames()) {
    try {
      const o = await f.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button,[role=button],a'))
          .map(b => (b.innerText || '').trim()).filter(t => t && t.length < 30);
        const sortEls = [];
        Array.from(document.querySelectorAll('*')).forEach(el => {
          if (el.children.length) return;
          const t = (el.innerText || '').trim();
          if (t && /排序|升序|降序|拖拽|价格/.test(t) && t.length < 40) {
            const p = el.parentElement;
            sortEls.push({ text: t, parent: p ? (p.innerText || '').trim().slice(0, 160) : '' });
          }
        });
        return { url: location.href.slice(0, 100), btns: [...new Set(btns)].slice(0, 60), sortEls: sortEls.slice(0, 20) };
      });
      if (!o.btns.length && !o.sortEls.length) continue;
      console.log(' frame:', o.url);
      console.log('  按钮:', o.btns.join(' | '));
      o.sortEls.forEach(s => console.log(`  排序控件「${s.text}」上下文: ${s.parent}`));
    } catch (e) {}
  }

  console.log('\n=== 「排序」单元格结构（只读，看是输入框还是纯文本）===');
  for (const f of page.frames()) {
    try {
      const o = await f.evaluate(() => {
        const ths = Array.from(document.querySelectorAll('th,td,[class*=table] [class*=cell]'));
        const hit = ths.find(e => (e.innerText || '').trim() === '排序');
        if (!hit) return null;
        const row = hit.closest('tr');
        return {
          thHtml: hit.outerHTML.slice(0, 500),
          rowHtml: row ? row.outerHTML.slice(0, 1200) : '(无 tr)',
          inputs: document.querySelectorAll('input').length,
        };
      });
      if (o) { console.log('  表头:', o.thHtml); console.log('  行:', o.rowHtml); console.log('  页面 input 数:', o.inputs); }
    } catch (e) {}
  }

  console.log('\n=== JS 里积分域写动作候选接口名 ===');
  if (!jsHits.size) console.log('  （未命中；可能接口名被拼接/混淆，或排序走通用 update）');
  [...jsHits.entries()].forEach(([ep, from]) => console.log('  ', ep, ' <- ', from));

  console.log('\n=== 结束：未点击、未提交、线上零改动 ===');
  await ctx.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
