/**
 * 140-diagnose-points.js —— 只读取证：139 批量中 4 次网络失败 + 1 未尝试的商品，当前积分价是否已达标
 */
const fs = require('fs');
const path = require('path');
const { cfg, launch, login, post, isOk, PATHS } = require('./lib/common');
const R = `${cfg.BASE}/bos/products/ecGoodsmanage/${cfg.BOS_ID}/${cfg.KEY}`;
const POINTS_URL = `${R}/goods/pointsMall/index`;
const EP = {
  list: 'mall/point/goods/queryPointGoodsListForManagement',
  detail: 'mall/point/goods/queryPointGoodsDetailForManagement',
};
const KEEP = ['authorization', 'apiclient', 'weimob-bosid', 'content-type', 'referer', 'source', 'tcode'];
const ROOT = path.resolve(__dirname, '..');
const newest = pat => fs.readdirSync(path.join(ROOT, path.dirname(pat)))
  .filter(f => f.startsWith(path.basename(pat).split('*')[0])).sort()
  .map(f => path.join(ROOT, path.dirname(pat), f)).pop();
const PLAN = JSON.parse(fs.readFileSync(newest('backup/133-plan_*.json'), 'utf8'));
const GIDS = [161785173100397, 161785207100397, 161785467100397, 161785618100397, 161785707100397];
const numEq = (a, b) => Math.abs(Number(a) - Number(b)) < 0.06;

(async () => {
  const ctx = await launch({ headless: true });
  const page = ctx.pages()[0] || await ctx.newPage();
  page.setDefaultTimeout(60000);
  await login(page);
  const found = [];
  const onReq = r => {
    if (!r.url().includes('/api3/')) return;
    found.push({ ep: r.url().replace(`${cfg.BASE}/api3/`, '').split('?')[0], headers: r.headers(), body: r.postData() });
  };
  page.on('request', onReq);
  await page.goto(POINTS_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(9000);
  page.off('request', onReq);
  const T = found.filter(f => f.ep === EP.list).pop();
  const H = {};
  KEEP.forEach(k => { if (T.headers[k]) H[k] = T.headers[k]; });
  const tpl = T.body ? JSON.parse(T.body) : {};
  const call = async (ep, body) => {
    const j = await post(page, `${cfg.BASE}/api3/${ep}`, body, H);
    if (!isOk(j)) throw new Error(JSON.stringify(j).slice(0, 200));
    return j.data;
  };
  const report = [];
  for (const gid of GIDS) {
    const ws = [];
    for (const x of PLAN.plan) for (const w of x.pointWrites) if (w.goodsId === gid) ws.push(w);
    const d = await call(EP.detail, { ...tpl, goodsId: gid, solutionType: 2 });
    let reached = 0;
    for (const w of ws) {
      const s = d.skuList.find(z => z.skuId === w.skuId);
      if (s && numEq(s.point, w.target[0]) && numEq(s.pointPrice, w.target[1])) reached++;
    }
    const state = reached === ws.length ? 'ALREADY_WRITTEN' : (reached === 0 ? 'NOT_WRITTEN' : 'PARTIAL');
    report.push({ goodsId: gid, expected: ws.length, reached, state,
      detail: ws.map(w => { const s = d.skuList.find(z => z.skuId === w.skuId);
        return { skuId: w.skuId, cur: s ? [s.point, s.pointPrice] : null, target: w.target }; }) });
    console.log(gid, state, `${reached}/${ws.length}`);
  }
  const p = path.join(PATHS.BACKUP, '140-diagnose-points.json');
  fs.writeFileSync(p, JSON.stringify(report, null, 1), 'utf8');
  console.log('报告:', p);
  await ctx.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
