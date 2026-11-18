/**
 * 99 · 排序重排第1步：只读全量快照 + 基线表（零写）
 * 全新登录抓模板, 全量拉积分商城 410 条列表(sort/classify/价格), 带时间戳落盘。
 * 用途: 写前基线 + 回滚依据 + 非目标零变化的比对基准。
 * 所有写接口路由层 abort。
 */
const fs = require('fs');
const path = require('path');
const { cfg, launch, login, post, isOk, stamp, PATHS } = require('./lib/common');

const EP_PL = 'mall/point/goods/queryPointGoodsListForManagement';
const WRITE_VERBS = [
  'updatePointGoodsSort', 'batchUpdateGoodsSort', 'moveGoodsToClassify',
  'addPointGoods', 'deletePointGoods', 'updatePointGoods', 'addPointClassify',
  'updatePointClassify', 'deletePointClassify', '/goods/update', '/goods/delete',
  '/goods/import', 'insertMaterial', 'createGroup', 'batchUpdate', 'setOnline',
];
const ts = stamp();

(async () => {
  console.log('=== 排序重排 第1步 只读全量快照 [零写] ===');
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
    if (ep === EP_PL) {
      try { found.push({ headers: r.headers(), body: JSON.parse(r.postData()) }); } catch (e) {}
    }
  });
  const BASEURL = `${cfg.BASE}/bos/products/ecGoodsmanage/${cfg.BOS_ID}/${cfg.KEY}`;
  await page.goto(BASEURL + '/goods/pointsMall/index', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(11000);
  const keep = ['authorization', 'apiclient', 'weimob-bosid', 'content-type', 'referer', 'source', 'tcode'];
  const h = found.filter(x => true).pop();
  if (!h) throw new Error('未捕获积分列表模板');
  const headers = {}; keep.forEach(k => { if (h.headers[k]) headers[k] = h.headers[k]; });
  console.log('模板已捕获: 积分列表');

  // 全量分页拉取
  const list = [];
  for (let p = 1; p <= 60; p++) {
    const j = await post(page, cfg.BASE + '/api3/' + EP_PL, { ...h.body, pageNum: p, pageSize: 50 }, headers);
    if (!isOk(j)) { console.log('分页停止 page', p, JSON.stringify(j).slice(0, 120)); break; }
    const pageList = j.data.pageList || [];
    list.push(...pageList);
    if (pageList.length < 50) break;
  }
  console.log('全量积分商品:', list.length);

  // 基线表: 关键字段完整快照
  const baseline = list.map(x => ({
    goodsId: x.goodsId,
    title: x.title,
    outerGoodsCode: x.outerGoodsCode || x.goodsCode || '',
    sort: x.sort,
    pointClassifyId: (x.pointClassifyInfo || {}).pointClassifyId,
    pointClassifyName: (x.pointClassifyInfo || {}).name,
    minPoint: x.minPoint,
    minPointPrice: x.minPointPrice,
    priceType: x.priceType,
    goodsLimitNum: x.goodsLimitNum,
    visibleInNonExchangeTime: x.visibleInNonExchangeTime,
  }));

  // 统计
  const byClassify = {};
  list.forEach(x => {
    const n = (x.pointClassifyInfo || {}).name || '(空)';
    byClassify[n] = (byClassify[n] || 0) + 1;
  });
  const tiyu = baseline.filter(x => x.pointClassifyName === '体育用品');
  const sorts = tiyu.map(x => Number(x.sort)).filter(n => !isNaN(n));
  const summary = {
    total: list.length,
    byClassify,
    tiyuCount: tiyu.length,
    tiyuSortRange: [Math.min(...sorts), Math.max(...sorts)],
    zeroSortCount: baseline.filter(x => Number(x.sort) === 0).length,
    goodsIdMin: Math.min(...baseline.map(x => Number(x.goodsId))),
    goodsIdMax: Math.max(...baseline.map(x => Number(x.goodsId))),
    blockedWrites: blocked,
  };
  console.log('基线摘要:', JSON.stringify(summary, null, 0));

  const out = path.join(PATHS.BACKUP, `99-sort-baseline_${ts}.json`);
  fs.writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), summary, baseline }, null, 1), 'utf8');
  console.log('快照落盘:', out);
  console.log('RESULT PASS | blockedWrites', blocked);
  await ctx.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
