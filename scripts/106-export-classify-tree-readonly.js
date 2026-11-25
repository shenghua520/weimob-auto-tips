/**
 * 106 · 取商品分组树（含二级分组 sort）[只读]
 * 用途：为积分商城排序方案提供「二级分组 sort 降序」依据。
 * 优先 queryAllClassifyListForManagement（全量树，含 childClassifyList）；
 * 兜底 queryClassifyListWithPageForManagement（分页，可能只返回一级）。
 * 零写，写接口路由层 abort。
 */
const fs = require('fs');
const path = require('path');
const { cfg, launch, login, post, isOk, stamp, PATHS } = require('./lib/common');

const EP_ALL = 'mall/goods/classify/queryAllClassifyListForManagement';
const EP_PAGE = 'mall/goods/classify/queryClassifyListWithPageForManagement';
const EP_CNT = 'mall/goods/classify/countChildClassifyByParentClassifyId';
const ALLOW = [EP_ALL, EP_PAGE, EP_CNT];
const BLOCK_EXACT = ['addGoodsClassify', 'deleteGoodsClassify', 'updateGoodsClassify', 'moveGoodsToClassify',
  '/goods/update', '/goods/delete', '/goods/import', 'addPointGoods', 'updatePointGoods', 'deletePointGoods'];
const ts = stamp();

(async () => {
  console.log('=== 商品分组树导出 [只读] ===');
  const ctx = await launch({ headless: true });
  const page = ctx.pages()[0] || await ctx.newPage();
  page.setDefaultTimeout(60000);
  let blocked = 0;
  await page.route('**/api3/**', route => {
    const u = route.request().url();
    const ep = u.replace(`${cfg.BASE}/api3/`, '').split('?')[0];
    if (ALLOW.includes(ep)) return route.continue();
    if (BLOCK_EXACT.some(b => ep.endsWith(b) || ep === b)) { blocked++; return route.abort(); }
    return route.continue();
  });
  await login(page);

  const BASEURL = `${cfg.BASE}/bos/products/ecGoodsmanage/${cfg.BOS_ID}/${cfg.KEY}`;
  const keep = ['authorization', 'apiclient', 'weimob-bosid', 'content-type', 'referer', 'source', 'tcode'];
  const found = [];
  const onReq = r => {
    const u = r.url();
    if (!u.includes('/api3/') || r.method() !== 'POST') return;
    found.push({ ep: u.replace(cfg.BASE + '/api3/', '').split('?')[0], headers: r.headers(), body: r.postData() });
  };
  page.on('request', onReq);
  await page.goto(BASEURL + '/manage/classify/list', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(10000);
  page.off('request', onReq);

  const hPage = found.filter(x => x.ep === EP_PAGE).pop();
  const hAll = found.filter(x => x.ep === EP_ALL).pop();
  const src = hAll || hPage;
  if (!src) throw new Error('未捕获分组接口模板');
  const H = {}; keep.forEach(k => { if (src.headers[k]) H[k] = src.headers[k]; });
  const shell = src.body ? JSON.parse(src.body) : {};

  const call = async (ep, body) => {
    if (!ALLOW.includes(ep)) throw new Error('非白名单 ' + ep);
    return post(page, cfg.BASE + '/api3/' + ep, body, H);
  };

  let tree = [];
  let usedEp = EP_ALL;
  if (hAll) {
    const j = await call(EP_ALL, { ...shell, solutionType: 2 });
    if (isOk(j)) {
      const d = j.data || {};
      tree = d.goodsClassifyList || d.list || d.pageList || [];
      console.log('全量树接口 返回一级:', tree.length);
    }
  }
  if (!tree.length) {
    const j = await call(EP_PAGE, { ...shell, pageNum: 1, pageSize: 200 });
    if (!isOk(j)) throw new Error('分组查询失败: ' + JSON.stringify(j).slice(0, 200));
    const d = j.data || {};
    tree = d.goodsClassifyList || d.list || d.pageList || [];
    usedEp = EP_PAGE;
    console.log('分页接口 返回一级:', tree.length);
  }

  // 二级分组：优先从树里取；没有就按 parentId 逐个查子分组
  const l2 = [];
  tree.forEach(g => (g.childClassifyList || []).forEach(c => l2.push(c)));
  console.log('树内二级分组:', l2.length);

  if (!l2.length) {
    // 用 countChildClassifyByParentClassifyId 找子级? 它只返回数量。
    // 改用 queryClassifyListWithPageForManagement 带 parentId 参数逐个查
    console.log('树内无二级, 尝试按 parentId 逐个查询...');
    for (const g of tree) {
      for (const parentIdKey of ['parentClassifyId', 'parentId', 'classifyParentId']) {
        const j = await call(EP_PAGE, { ...shell, pageNum: 1, pageSize: 100, [parentIdKey]: g.classifyId });
        if (!isOk(j)) continue;
        const d = j.data || {};
        const list = d.pageList || d.goodsClassifyList || d.list || [];
        const kids = list.filter(x => String(x.parentId) === String(g.classifyId));
        if (kids.length) { l2.push(...kids); console.log(`  ${g.name}: ${kids.length} 个子级`); break; }
      }
    }
  }

  const out = {
    exportedAt: new Date().toISOString(), usedEp,
    l1: tree.map(g => ({ classifyId: g.classifyId, name: g.name, sort: g.sort, isShow: g.isShow, classifyLevel: g.classifyLevel, parentId: g.parentId })),
    l2: l2.map(c => ({ classifyId: c.classifyId, name: c.name, sort: c.sort, isShow: c.isShow, classifyLevel: c.classifyLevel, parentId: c.parentId })),
    blocked,
  };
  const f = path.join(PATHS.BACKUP, `106-classify-tree_${ts}.json`);
  fs.writeFileSync(f, JSON.stringify(out, null, 1), 'utf8');
  console.log('一级', out.l1.length, '| 二级', out.l2.length, '| 阻断', blocked);
  console.log('落盘:', path.basename(f));
  await ctx.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
