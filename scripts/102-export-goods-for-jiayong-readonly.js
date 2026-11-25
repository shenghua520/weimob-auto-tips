/**
 * 102 · 家庭日用缺价商品 · 全量商品库只读导出 —— 零写
 * 目的: 导出微盟商品库全量商品列表，供136行「高桥田庄」整箱商品按名称/条码匹配，
 *       查清它们在商品库的真实身份(是否真实在售/是否有积分设置)。
 * 所有写接口路由层 abort。
 */
const fs = require('fs');
const { cfg, launch, login, post, isOk, stamp } = require('./lib/common');

const EP_GL = 'mall/goods/queryGoodsListWithPageForManagement';
const WRITE_VERBS = [
  'updatePointGoodsSort', 'batchUpdateGoodsSort', 'moveGoodsToClassify',
  'addPointGoods', 'deletePointGoods', 'updatePointGoods', 'addPointClassify',
  'updatePointClassify', 'deletePointClassify', '/goods/update', '/goods/delete',
  '/goods/import', 'insertMaterial', 'createGroup', 'batchUpdate', 'setOnline',
];
const ts = stamp();

(async () => {
  console.log('=== 全量商品库只读导出 [零写] ===');
  const ctx = await launch({ headless: true });
  const page = ctx.pages()[0] || await ctx.newPage();
  page.setDefaultTimeout(60000);
  let blocked = 0;
  await page.route('**/api3/**', route => {
    const u = route.request().url();
    if (WRITE_VERBS.some(w => u.includes(w))) { blocked++; return route.abort(); }
    return route.continue();
  });
  await login(page);

  const found = [];
  page.on('request', r => {
    const u = r.url();
    if (!u.includes('/api3/') || r.method() !== 'POST') return;
    const ep = u.replace(cfg.BASE + '/api3/', '').split('?')[0];
    if (ep === EP_GL) {
      try { found.push({ headers: r.headers(), body: JSON.parse(r.postData()) }); } catch (e) {}
    }
  });
  const BASEURL = `${cfg.BASE}/bos/products/ecGoodsmanage/${cfg.BOS_ID}/${cfg.KEY}`;
  await page.goto(BASEURL + '/goods/list', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(12000);
  const keep = ['authorization', 'apiclient', 'weimob-bosid', 'content-type', 'referer', 'source', 'tcode'];
  const h = found.filter(x => x.body).pop();
  if (!h) throw new Error('未捕获商品列表模板');
  const headers = {}; keep.forEach(k => { if (h.headers[k]) headers[k] = h.headers[k]; });
  console.log('模板已捕获');

  const goods = [];
  let total = 0;
  for (let p = 1; p <= 80; p++) {
    const j = await post(page, cfg.BASE + '/api3/' + EP_GL, { ...h.body, pageNum: p, pageSize: 20 }, headers);
    if (!isOk(j)) { console.log('  翻页失败 p=' + p); break; }
    const l = j.data.pageList || [];
    total = j.data.totalCount || 0;
    goods.push(...l);
    if (l.length < 20 || goods.length >= total) break;
  }
  console.log('商品库全量:', goods.length, '/ total', total);
  const out = `backup/102-goods-all_${ts}.json`;
  fs.writeFileSync(out, JSON.stringify({ exportedAt: new Date().toISOString(), total, count: goods.length, list: goods }, null, 1), 'utf8');
  console.log('已落盘:', out);
  console.log('=== 完成 ===', JSON.stringify({ count: goods.length, total, blocked }));
  await ctx.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
