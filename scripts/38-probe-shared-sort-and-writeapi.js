/**
 * 38 · 只读探查：① sort 是否共享 ② 改排序写接口定位
 *
 * 零写操作：只 goto + 被动监听 + DOM 读取 + 同源只读查询。
 * 不点击任何提交按钮、不输入、不保存。
 */
const { cfg, launch, login, captureHeaders, post, isOk } = require('./lib/common');

const POINTS_PAGE = `${cfg.BASE}/bos/products/ecGoodsmanage/${cfg.BOS_ID}/${cfg.KEY}/goods/pointsMall/index`;
const GOODS_PAGE = `${cfg.BASE}/bos/products/ecGoodsmanage/${cfg.BOS_ID}/${cfg.KEY}/goods/list`;
const EP_POINT = 'queryPointGoodsListForManagement';
const EP_GOODS = 'queryGoodsListWithPageForManagement';
const API_POINT = `${cfg.BASE}/api3/mall/point/goods/${EP_POINT}`;
const API_GOODS = `${cfg.BASE}/api3/mall/goods/${EP_GOODS}`;

const BLOCK = [
  'moveGoodsToClassify', 'addPointGoods', 'updatePointGoods', 'deletePointGoods',
  '/goods/update', '/goods/delete', '/goods/import', '/material/delete',
  '/point/goods/save', '/point/goods/batch', '/point/goods/update',
];

(async () => {
  console.log('=== 只读探查：sort 共享性 + 写接口定位 ===\n');
  const ctx = await launch({ headless: true });
  const page = ctx.pages()[0] || await ctx.newPage();
  page.setDefaultTimeout(60000);
  let blocked = 0;
  await page.route('**/api3/**', r => {
    const u = r.request().url();
    if (BLOCK.some(b => u.includes(b))) { blocked++; console.error('  [守卫] 阻断:', u); return r.abort(); }
    return r.continue();
  });

  // 宽松捕获所有 JS 里的积分域接口字符串（含拼接片段）
  const eps = new Set();
  page.on('response', async r => {
    const u = r.url();
    if (!/\.js(\?|$)/.test(u) && !/\.html(\?|$)/.test(u)) return;
    try {
      const t = await r.text();
      const re = /["'`]([A-Za-z0-9_/.-]{0,50}(?:point|Point)[A-Za-z0-9_/.-]{0,60})["'`]/g;
      let m;
      while ((m = re.exec(t))) {
        const s = m[1];
        if (/sort|order|update|save|edit|batch|set|drag|rank|sequence|move/i.test(s)) eps.add(s);
      }
    } catch (e) {}
  });

  await page.goto(POINTS_PAGE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);
  if (page.url().includes('account.weimob.com')) {
    console.log('登录中…'); await login(page); await page.waitForTimeout(3000);
    await page.goto(POINTS_PAGE, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(6000);
  }

  // ---------- ① 积分商品 sort（只读） ----------
  const cp = await captureHeaders(page, POINTS_PAGE, EP_POINT);
  const pb = cp.payload || {}, hdr = cp.headers;
  const points = [];
  for (let pn = 1; pn <= 30; pn++) {
    const j = await post(page, API_POINT, { ...pb, pageNum: pn, pageSize: 50 }, hdr);
    if (!isOk(j)) break;
    const l = (j.data && j.data.pageList) || [];
    points.push(...l);
    if (!l.length || l.length < 50) break;
  }
  const ptMap = new Map(points.map(p => [String(p.goodsId), p.sort]));
  console.log('积分商品:', points.length);

  // ---------- ① 在售商品 sort（只读，同源 payload） ----------
  // 打开在售商品列表页，抓它自己发出的 payload，避免手拼 body
  let goodsPayload = null;
  page.on('request', r => {
    if (r.url().includes(EP_GOODS) && r.postData()) {
      try { goodsPayload = JSON.parse(r.postData()); } catch (e) {}
    }
  });
  await page.goto(GOODS_PAGE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(8000);
  console.log('在售商品列表页同源 payload:', goodsPayload ? Object.keys(goodsPayload).join(', ') : '（未捕获）');

  const onsale = [];
  if (goodsPayload) {
    for (let pn = 1; pn <= 40; pn++) {
      const j = await post(page, API_GOODS, { ...goodsPayload, pageNum: pn, pageSize: 20 }, hdr);
      if (!isOk(j)) break;
      const l = (j.data && j.data.pageList) || [];
      onsale.push(...l);
      if (!l.length || l.length < 20) break;
    }
  }
  console.log('在售商品:', onsale.length);

  const hasSort = onsale.filter(g => g.sort !== undefined).length;
  let same = 0, diff = 0, missing = 0;
  const diffSamples = [];
  onsale.forEach(g => {
    const ps = ptMap.get(String(g.goodsId));
    if (ps === undefined) { missing++; return; }
    if (String(ps) === String(g.sort)) same++;
    else { diff++; if (diffSamples.length < 8) diffSamples.push({ id: g.goodsId, title: (g.title || '').slice(0, 18), pointSort: ps, goodsSort: g.sort }); }
  });
  console.log('\n=== sort 共享性判定 ===');
  console.log('在售商品含 sort 字段:', hasSort, '/', onsale.length);
  console.log('与积分商品 sort 相同:', same, '| 不同:', diff, '| 积分侧无此商品:', missing);
  if (diffSamples.length) diffSamples.forEach(d => console.log('  差异样例:', JSON.stringify(d)));
  console.log('结论:', same > 0 && diff === 0 ? '⚠ 疑似同一字段（改动会连带影响在售列表）' : '✔ 两套独立 sort（改积分排序不影响在售列表）');

  // ---------- ② 「排序」列 DOM：是否可编辑 ----------
  console.log('\n=== 「排序」列数据单元格结构（只读）===');
  await page.goto(POINTS_PAGE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);
  for (const f of page.frames()) {
    try {
      const o = await f.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('tbody tr')).slice(0, 2);
        return rows.map(tr => Array.from(tr.querySelectorAll('td')).map(td => ({
          txt: (td.innerText || '').trim().slice(0, 40),
          html: td.outerHTML.slice(0, 260),
        })));
      });
      o.forEach((row, ri) => {
        console.log(` 行${ri + 1} 共 ${row.length} 列`);
        row.forEach((c, ci) => console.log(`   [${ci}] ${c.txt} | ${c.html.replace(/\s+/g, ' ').slice(0, 200)}`));
      });
    } catch (e) {}
  }

  console.log('\n=== JS 里含写动作关键词的 point 相关字符串 ===');
  if (!eps.size) console.log('  （仍未命中；接口名可能运行时拼接，需人工在页面点一次「排序」编辑抓包）');
  [...eps].slice(0, 40).forEach(s => console.log('  ', s));

  console.log('\n被阻断写接口次数:', blocked);
  console.log('=== 结束：未点击、未提交、线上零改动 ===');
  await ctx.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
