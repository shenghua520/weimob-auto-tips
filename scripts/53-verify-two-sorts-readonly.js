// 62-verify-sort.js — 独立复核（只读，重新登录）：两套 sort 展示顺序 + 分组聚集 + 价格升序 + 值域唯一
const fs = require('fs');
const path = require('path');
const { cfg, launch, login, post, isOk, sleep, PATHS } = require('./lib/common');

const EP_GL = 'mall/goods/queryGoodsListWithPageForManagement';
const EP_PL = 'mall/point/goods/queryPointGoodsListForManagement';

(async () => {
  const pf = fs.readdirSync(PATHS.BACKUP).filter(x => x.startsWith('60-sort-plan')).sort().pop();
  const plan = JSON.parse(fs.readFileSync(path.join(PATHS.BACKUP, pf), 'utf8'));
  const BANDS = plan.BANDS;
  const ledger = JSON.parse(fs.readFileSync(path.join(PATHS.BACKUP, '50-batch-ledger.json'), 'utf8'));
  const twinOf = new Map(ledger.filter(x => x.ok).map(x => [x.srcId, x.newId]));

  const ctx = await launch({ headless: true });
  const page = ctx.pages()[0] || await ctx.newPage();
  await login(page);
  const found = [];
  page.on('request', r => {
    const u = r.url();
    if (!u.includes('/api3/') || r.method() !== 'POST') return;
    const ep = u.replace(cfg.BASE + '/api3/', '').split('?')[0];
    if ([EP_GL, EP_PL].includes(ep)) {
      try { found.push({ ep, headers: r.headers(), body: JSON.parse(r.postData()) }); } catch {}
    }
  });
  await page.goto(cfg.BASE + '/bos/products/ecGoodsmanage/' + cfg.BOS_ID + '/' + cfg.KEY + '/goods/list', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(11000);
  await page.goto(cfg.BASE + '/bos/products/ecGoodsmanage/' + cfg.BOS_ID + '/' + cfg.KEY + '/goods/pointsMall/index', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(10000);
  const keep = ['authorization', 'apiclient', 'weimob-bosid', 'content-type', 'referer', 'source', 'tcode'];
  const pick = ep => {
    const h = found.filter(x => x.ep === ep).pop();
    if (!h) throw new Error('未捕获模板: ' + ep);
    const headers = {}; keep.forEach(k => { if (h.headers[k]) headers[k] = h.headers[k]; });
    return { headers, payload: h.body };
  };
  const G = pick(EP_GL), P = pick(EP_PL);
  const pull = async (T, size) => {
    const all = [];
    for (let p = 1; p <= 60; p++) {
      const j = await post(page, cfg.BASE + '/api3/' + (size === 20 ? EP_GL : EP_PL), { ...T.payload, pageNum: p, pageSize: size }, T.headers);
      if (!isOk(j)) break;
      const l = j.data.pageList || [];
      all.push(...l);
      if (l.length < size) break;
      await sleep(120);
    }
    return all;
  };
  const gAll = await pull(G, 20), pAll = await pull(P, 50);
  const gById = new Map(gAll.map(i => [i.goodsId, i]));
  const pById = new Map(pAll.map(i => [i.goodsId, i]));

  const report = { at: new Date().toISOString(), goodsTotal: gAll.length, pointsTotal: pAll.length, checks: {} };
  // 1) 计划表目标 sort 全部命中（源 + 复制体）
  let gp = 0, gt = 0, gbad = [];
  plan.goodsPlan.forEach(r => {
    gp++;
    if (String((gById.get(r.goodsId) || {}).sort) !== String(r.newSort)) gbad.push({ id: r.goodsId, who: 'src' });
    const twin = twinOf.get(r.goodsId);
    if (twin) {
      gt++;
      if (String((gById.get(twin) || {}).sort) !== String(r.newSort)) gbad.push({ id: twin, who: 'twin', src: r.goodsId });
    }
  });
  report.checks.goodsTarget = { src: gp, twin: gt, fail: gbad.length, sample: gbad.slice(0, 5) };
  // 2) 积分目标 sort
  let pp = 0, pbad = [];
  plan.ptsPlan.forEach(r => {
    pp++;
    if (String((pById.get(r.goodsId) || {}).sort) !== String(r.newSort)) pbad.push(r.goodsId);
  });
  report.checks.pointsTarget = { total: pp, fail: pbad.length, sample: pbad.slice(0, 5) };
  // 3) 展示顺序：按 sort 降序还原，检查价格非递减（段内）
  const visible = gAll.filter(i => !(i.classifyList || []).some(c => /（兑换）$/.test(c.name || '')));
  const bySort = [...visible].sort((a, b) => (b.sort || 0) - (a.sort || 0));
  let inv = 0;
  for (let i = 1; i < bySort.length; i++) {
    const a = bySort[i - 1].goodsPrice ? bySort[i - 1].goodsPrice.minSalePrice : 0;
    const b = bySort[i].goodsPrice ? bySort[i].goodsPrice.minSalePrice : 0;
    if (a != null && b != null && a > b) inv++;
  }
  report.checks.goodsPriceAsc = { checked: bySort.length - 1, inversions: inv };
  // 4) sort 值域唯一
  const gsorts = new Set(gAll.map(i => i.sort));
  const psorts = new Set(pAll.map(i => i.sort));
  report.checks.unique = { goods: gsorts.size + '/' + gAll.length, points: psorts.size + '/' + pAll.length };
  // 5) 两套字段互不影响：抽样源商品在积分侧是否存在（源不在积分商城）
  const srcInPoints = plan.goodsPlan.slice(0, 20).filter(r => pById.has(r.goodsId)).length;
  report.checks.independent = { srcSampleInPoints: srcInPoints + '/20' };

  const out = path.join(PATHS.BACKUP, `62-verify-sort_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`);
  fs.writeFileSync(out, JSON.stringify(report, null, 1), 'utf8');
  console.log('报告:', out);
  console.log('SUMMARY', JSON.stringify(report.checks));
  await ctx.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
