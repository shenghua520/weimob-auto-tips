// 46 · 验证式删除单个分组：空组双确认 → 单次 deleteGoodsClassify → 全量比对恰好少一个
// 跑法: node scripts/46-delete-classify-verified.js <classifyId> <期望名称>
const fs = require('fs');
const path = require('path');
const { cfg, launch, login, post, isOk, sleep, stamp, PATHS } = require('./lib/common');

const R = `${cfg.BASE}/bos/products/ecGoodsmanage/${cfg.BOS_ID}/${cfg.KEY}`;
const URL_CLASSIFY = `${R}/manage/classify/list`;
const EP_TREE = 'mall/goods/classify/queryAllClassifyListForManagement';
const EP_COUNT = 'mall/goods/classify/countChildClassifyByParentClassifyId';
const EP_DEL = 'mall/goods/classify/deleteGoodsClassify';
const ALLOW = [EP_TREE, EP_COUNT, EP_DEL];
const BLOCK = [
  'addGoodsClassify', 'updateGoodsClassify', 'moveGoodsToClassify',
  'goods/deleteGoods', '/goods/update', '/goods/import', 'importRetailMerchantGoodsAndItem',
  'addPoint', 'updatePoint', 'deletePoint', '/material/delete',
];
const TARGET_ID = Number(process.argv[2]);
const TARGET_NAME = process.argv[3];
if (!TARGET_ID || !TARGET_NAME) { console.error('用法: node scripts/46-delete-classify-verified.js <classifyId> <期望名称>'); process.exit(1); }
const ts = stamp();
const save = (name, obj) => {
  const f = path.join(PATHS.BACKUP, `${name}_${ts}.json`);
  fs.writeFileSync(f, JSON.stringify(obj, null, 1), 'utf8');
  console.log('  已落盘:', path.basename(f));
};
const STATIC_FIELDS = ['name', 'parentId', 'classifyLevel', 'isShow', 'isHot', 'sort', 'imageUrl'];
const flatMap = tree => {
  const m = new Map();
  const walk = list => (list || []).forEach(g => {
    m.set(g.classifyId, { name: g.name, parentId: g.parentId, classifyLevel: g.classifyLevel, isShow: g.isShow, isHot: g.isHot, sort: g.sort, imageUrl: g.imageUrl ?? null, children: (g.childClassifyList || []).length });
    walk(g.childClassifyList);
  });
  walk(tree);
  return m;
};

(async () => {
  const ctx = await launch({ headless: true });
  const page = ctx.pages()[0] || await ctx.newPage();
  page.setDefaultTimeout(60000);
  const log = { startedAt: new Date().toISOString(), target: { classifyId: TARGET_ID, name: TARGET_NAME }, writes: [], errors: [] };
  await page.route('**/api3/**', route => {
    const u = route.request().url();
    if (BLOCK.some(b => u.includes(b))) { console.error('  [写守卫]', u.split('?')[0]); return route.abort(); }
    return route.continue();
  });
  await login(page);

  const found = [];
  const onReq = r => {
    const u = r.url();
    if (u.includes('/api3/')) found.push({ ep: u.replace(`${cfg.BASE}/api3/`, '').split('?')[0], headers: r.headers(), body: r.postData() });
  };
  page.on('request', onReq);
  let hit = null;
  for (let i = 1; i <= 3 && !hit; i++) {
    found.length = 0;
    await page.goto(URL_CLASSIFY, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(i === 1 ? 10000 : 15000);
    hit = found.filter(x => /classify\/(query|count)/.test(x.ep)).pop() || null;
  }
  page.off('request', onReq);
  if (!hit) throw new Error('未捕获查询模板');
  const KEEP = ['authorization', 'apiclient', 'weimob-bosid', 'content-type', 'referer', 'source', 'tcode'];
  const headers = {}; KEEP.forEach(k => { if (hit.headers[k]) headers[k] = hit.headers[k]; });
  const raw = hit.body ? JSON.parse(hit.body) : {};
  const tpl = {
    basicInfo: raw.basicInfo, solutionType: raw.solutionType ?? 2,
    isQueryRelationGoodsCount: true, hiddenSysClassifyShow: true,
    isQueryRelationCategory: true, isSystemClassifyShow: true,
    i18n: raw.i18n || { language: 'zh-CN', timezone: 8 },
    extendInfo: raw.extendInfo || { source: 80 },
  };
  const call = (ep, body) => {
    if (!ALLOW.includes(ep)) throw new Error('非白名单: ' + ep);
    return post(page, `${cfg.BASE}/api3/${ep}`, body, headers);
  };

  // ① 删前快照 + 身份/空组双确认
  const pre = await call(EP_TREE, tpl);
  const preTree = (pre.data && pre.data.goodsClassifyList) || [];
  const preMap = flatMap(preTree);
  save('商品分组_删前快照', { at: new Date().toISOString(), response: pre });
  const node = preTree.find(g => g.classifyId === TARGET_ID);
  if (!node) { console.log('目标不存在，无需删除'); process.exit(0); }
  console.log(`[核对] name=${node.name} parent=${node.parentId} 子级=${(node.childClassifyList || []).length}`);
  if (node.name !== TARGET_NAME || (node.childClassifyList || []).length !== 0) { console.error('目标与预期不符或非空组，中止'); process.exit(2); }
  const cnt = await call(EP_COUNT, { basicInfo: tpl.basicInfo, solutionType: tpl.solutionType ?? 2, classifyId: TARGET_ID, i18n: tpl.i18n, extendInfo: tpl.extendInfo });
  if (isOk(cnt) && (cnt.data > 0 || cnt.data?.count > 0)) { console.error('子级计数>0，级联风险，中止'); process.exit(2); }

  // ② 删除（唯一写操作）
  const del = await call(EP_DEL, { basicInfo: tpl.basicInfo, solutionType: tpl.solutionType ?? 2, classifyId: TARGET_ID, i18n: tpl.i18n, extendInfo: tpl.extendInfo });
  const delOk = isOk(del) && del.data != null;
  log.writes.push({ ep: EP_DEL, classifyId: TARGET_ID, ok: delOk, response: del });
  console.log('[删除]', JSON.stringify(del).slice(0, 160), '| ok=', delOk);
  if (!delOk) { await ctx.close(); process.exit(2); }
  await sleep(1500);

  // ③ 删后全量比对：删除集恰好={目标}
  const post2 = await call(EP_TREE, tpl);
  const postTree = (post2.data && post2.data.goodsClassifyList) || [];
  const postMap = flatMap(postTree);
  save('商品分组_删后快照', { at: new Date().toISOString(), response: post2 });
  const deletions = [...preMap.keys()].filter(id => !postMap.has(id));
  const additions = [...postMap.keys()].filter(id => !preMap.has(id));
  const modifications = [];
  for (const [id, o] of preMap) {
    const n = postMap.get(id); if (!n) continue;
    STATIC_FIELDS.forEach(f => { if ((o[f] ?? null) !== (n[f] ?? null)) modifications.push({ classifyId: id, field: f }); });
  }
  const pass = !postMap.has(TARGET_ID) && deletions.length === 1 && deletions[0] === TARGET_ID && !additions.length && !modifications.length;
  log.finishedAt = new Date().toISOString();
  log.summary = { deletions, additions: additions.length, modifications: modifications.length, pass };
  save('删除_作业日志', log);
  console.log('[汇总]', JSON.stringify(log.summary), pass ? 'PASS' : 'FAIL');
  await ctx.close();
  process.exit(pass ? 0 : 2);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
