// 45 · 商品分组整树复制：X → X+后缀，isShow 可控（详见 docs/17）
// 源清单=改前基线且滤掉已带后缀节点（防双后缀）；幂等；形状 A(sort+图)/B/C 自动降级；小样+三查内置
// 跑法: node scripts/45-copy-classify-tree.js --suffix=（兑换） [--show=false] [--mode=sample|tree]
const fs = require('fs');
const path = require('path');
const { cfg, launch, login, post, isOk, sleep, stamp, PATHS } = require('./lib/common');

const R = `${cfg.BASE}/bos/products/ecGoodsmanage/${cfg.BOS_ID}/${cfg.KEY}`;
const URL_CLASSIFY = `${R}/manage/classify/list`;
const EP_TREE = 'mall/goods/classify/queryAllClassifyListForManagement';
const EP_ADD = 'mall/goods/classify/addGoodsClassify';
const EP_DETAIL = 'mall/goods/classify/queryClassifyDetail';
const ALLOW = [EP_TREE, EP_ADD, EP_DETAIL];
const BLOCK = [
  'deleteGoodsClassify', 'updateGoodsClassify', 'moveGoodsToClassify',
  'goods/deleteGoods', '/goods/update', '/goods/import', 'importRetailMerchantGoodsAndItem',
  'addPointGoods', 'updatePointGoods', 'deletePointGoods', 'updatePointGoodsSort',
  'addPointClassify', 'updatePointClassify', 'deletePointClassify', '/material/delete',
];
const arg = (k, d) => { const m = process.argv.find(a => a.startsWith(`--${k}=`)); return m ? m.split('=').slice(1).join('=') : d; };
const SUFFIX = arg('suffix', '（兑换）');
const SHOW = arg('show', 'false') === 'true';
const MODE = arg('mode', 'tree'); // sample=只建第一个一级副本
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
  const log = { startedAt: new Date().toISOString(), suffix: SUFFIX, show: SHOW, writes: [], blocked: [], errors: [] };
  await page.route('**/api3/**', route => {
    const u = route.request().url();
    if (BLOCK.some(b => u.includes(b))) { log.blocked.push(u); console.error('  [写守卫]', u.split('?')[0]); return route.abort(); }
    return route.continue();
  });
  await login(page);

  // 模板捕获：放宽到 classify/query* 或 count*（节点多时页面换分页接口，docs/09#33）
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

  // ① 改前基线快照（源清单只认它）
  const pre = await call(EP_TREE, tpl);
  if (!isOk(pre)) throw new Error('改前快照失败');
  const preTree = (pre.data && pre.data.goodsClassifyList) || [];
  const preMap = flatMap(preTree);
  save('商品分组_改前快照', { at: new Date().toISOString(), response: pre });

  // ② 计划：滤掉已带后缀节点（docs/09#31），幂等跳过已存在的目标
  const srcL1 = preTree.filter(g => !g.name.endsWith(SUFFIX));
  const l1Plan = srcL1.map(g => {
    const targetName = g.name + SUFFIX;
    const exist = preTree.find(x => x.name === targetName && x.parentId === 0);
    return { src: g, targetName, id: exist ? exist.classifyId : null, skip: !!exist };
  });
  const l2Plan = [];
  for (const p of l1Plan) (p.src.childClassifyList || []).forEach(c => l2Plan.push({ src: c, targetName: c.name + SUFFIX, parentPlan: p }));
  const planL1 = MODE === 'sample' ? l1Plan.slice(0, 1) : l1Plan;
  const planL2 = MODE === 'sample' ? [] : l2Plan;
  console.log(`[计划] 一级 ${planL1.filter(p => !p.skip).length} 待建 | 二级 ${planL2.length} 待建 | 后缀=${SUFFIX} isShow=${SHOW}`);

  // ③ 创建（形状 A→B→C 降级缓存；一级不传 parentId——docs/09#30）
  let shape = 'A'; let fail = 0;
  const created = [];
  const createOne = async (name, level, parentId, src) => {
    const base = { basicInfo: tpl.basicInfo, solutionType: tpl.solutionType ?? 2, classifyLevel: level, name, isShow: SHOW, i18n: tpl.i18n, extendInfo: tpl.extendInfo };
    if (level === 2 && parentId) base.parentId = parentId;
    const A = { ...base }; if (src?.sort != null) A.sort = src.sort; if (src?.imageUrl) A.imageUrl = src.imageUrl;
    const B = (({ imageUrl, ...r }) => r)(A);
    const C = (({ sort, ...r }) => r)(B);
    const bodies = { A, B, C };
    for (const s of [shape, 'B', 'C']) {
      const j = await call(EP_ADD, bodies[s]);
      const ok = isOk(j) && j.data && j.data.returnResult === true;
      if (ok) { shape = s; return { ok, id: j.data.id, shape: s }; }
      if (!String(j.errcode || '').startsWith('00145002')) break; // 非空值错不降级
      log.writes.push({ name, shape: s, ok, response: j });
    }
    return { ok: false };
  };

  for (const p of planL1) {
    if (p.skip) { console.log(`  = 跳过 ${p.targetName}`); continue; }
    const r = await createOne(p.targetName, 1, null, p.src);
    if (!r.ok) { fail++; log.errors.push({ name: p.targetName }); console.error(`  ✗ ${p.targetName}`); if (fail >= 3) break; }
    else { p.id = r.id; created.push({ name: p.targetName, id: r.id, level: 1 }); console.log(`  ✓ ${p.targetName} → ${r.id} [${r.shape}]`); }
    await sleep(800);
  }
  const mid = await call(EP_TREE, tpl);
  const midTree = (mid.data && mid.data.goodsClassifyList) || [];
  planL1.forEach(p => { const e = midTree.find(x => x.name === p.targetName && x.parentId === 0); if (e) p.id = e.classifyId; });

  for (let i = 0; i < planL2.length; i++) {
    const p = planL2[i];
    if (!p.parentPlan.id || fail >= 3) continue;
    if (i > 0 && i % 25 === 0) { await sleep(1500); }
    const r = await createOne(p.targetName, 2, p.parentPlan.id, p.src);
    if (!r.ok) { fail++; log.errors.push({ name: p.targetName }); continue; }
    created.push({ name: p.targetName, id: r.id, level: 2 });
    if (created.filter(c => c.level === 2).length === 1) {
      const d = await call(EP_DETAIL, { basicInfo: tpl.basicInfo, solutionType: tpl.solutionType ?? 2, classifyId: r.id, i18n: tpl.i18n, extendInfo: tpl.extendInfo });
      const dd = d && d.data;
      const pass = isOk(d) && dd && dd.name === p.targetName && dd.isShow === SHOW;
      console.log(`  [小样复核] ${p.targetName} → ${pass ? 'PASS' : 'FAIL，中止'}`);
      if (!pass) break;
    }
    await sleep(600);
  }

  // ④ 改后全量三查
  const post2 = await call(EP_TREE, tpl);
  const postTree = (post2.data && post2.data.goodsClassifyList) || [];
  const postMap = flatMap(postTree);
  save('商品分组_改后快照', { at: new Date().toISOString(), response: post2 });
  const additions = [...postMap.keys()].filter(id => !preMap.has(id));
  const deletions = [...preMap.keys()].filter(id => !postMap.has(id));
  const modifications = [];
  for (const [id, o] of preMap) {
    const n = postMap.get(id); if (!n) continue;
    STATIC_FIELDS.forEach(f => { if ((o[f] ?? null) !== (n[f] ?? null)) modifications.push({ classifyId: id, field: f, before: o[f], after: n[f] }); });
  }
  let structFail = 0;
  for (const p of planL1) {
    const node = postTree.find(x => x.name === p.targetName && x.parentId === 0);
    const want = (p.src.childClassifyList || []).map(c => c.name + SUFFIX).sort();
    const got = node ? (node.childClassifyList || []).map(c => c.name).sort() : [];
    const ok = node && JSON.stringify(want) === JSON.stringify(got) && node.isShow === SHOW && (node.childClassifyList || []).every(c => c.isShow === SHOW);
    if (!ok) structFail++;
    console.log(`  ${p.targetName}: 子级 ${got.length}/${want.length} ${ok ? 'PASS' : 'FAIL'}`);
  }
  log.finishedAt = new Date().toISOString();
  log.summary = { created: created.length, additions: additions.length, modifications: modifications.length, deletions: deletions.length, structFail, fail, pass: additions.length === created.length && !modifications.length && !deletions.length && !structFail && !fail };
  save('整树复制_作业日志', log);
  console.log('\n[汇总]', JSON.stringify(log.summary));
  await ctx.close();
  process.exit(log.summary.pass ? 0 : 2);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
