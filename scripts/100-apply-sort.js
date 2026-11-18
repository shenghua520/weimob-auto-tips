/**
 * 100 · 积分商城排序写入（docs/19 规则）—— 只写 sort 单字段
 * 数据源: 98-sort-plan (83 changed) ; 写前基线: 99-sort-baseline
 * 模式: --sample(12条边界小样+三查+自动回滚) / --apply(全量分批) / --rollback(从快照恢复)
 *
 * 安全设计:
 *  - 写守卫白名单优先: 只放行 updatePointGoodsSort(精确endsWith), 其余写接口全 abort
 *  - 专用接口 updatePointGoodsSort 天然只改 sort, 不覆盖价格/分组/限购
 *  - 小样三查: 目标sort变了 / STATIC字段没被冲 / 非目标没动
 *  - 分批 ≤30, 批间 sleep, 失败>3 中止, 逐条台账
 */
const fs = require('fs');
const path = require('path');
const { cfg, launch, login, post, isOk, sleep, stamp, PATHS } = require('./lib/common');

const EP_PL = 'mall/point/goods/queryPointGoodsListForManagement';
const EP_PS = 'mall/point/goods/updatePointGoodsSort';
const MODE = process.argv.includes('--sample') ? 'sample'
  : process.argv.includes('--rollback') ? 'rollback'
  : process.argv.includes('--apply') ? 'apply' : 'dry';
const ts = stamp();

// 写守卫: 只允许 sort 写接口
const WRITE_ALLOW = ['updatePointGoodsSort'];
const WRITE_BLOCK = [
  'updatePointGoods', 'addPointGoods', 'deletePointGoods', 'batchUpdateGoodsSort',
  'moveGoodsToClassify', 'addPointClassify', 'updatePointClassify', 'deletePointClassify',
  '/goods/update', '/goods/delete', '/goods/import', 'insertMaterial', 'createGroup',
  'batchUpdate', 'setOnline',
];
// STATIC 字段: 写 sort 时这些若有变化即为失败
const STATIC = ['minPoint', 'minPointPrice', 'priceType', 'goodsLimitNum', 'visibleInNonExchangeTime', 'pointClassifyId'];
const BATCH = 30;
const MAX_FAIL = 3;

const latest = (dir, prefix) => fs.readdirSync(dir).filter(x => x.startsWith(prefix)).sort().pop();

(async () => {
  console.log('=== 积分商城排序写入 [' + MODE + '] ===');
  const planFile = latest(PATHS.BACKUP, '98-sort-plan-readonly_');
  const baseFile = latest(PATHS.BACKUP, '99-sort-baseline_');
  const planAll = JSON.parse(fs.readFileSync(path.join(PATHS.BACKUP, planFile), 'utf8'));
  const base = JSON.parse(fs.readFileSync(path.join(PATHS.BACKUP, baseFile), 'utf8'));
  const changes = planAll.fullPlan.filter(x => x.oldSort !== x.newSort);
  console.log('计划变更', changes.length, '| 基线', base.baseline.length, '| 方案文件', planFile);

  // 写前一致性校验: 方案oldSort必须==基线sort
  const bm = new Map(base.baseline.map(x => [String(x.goodsId), x]));
  const drift = changes.filter(x => String((bm.get(String(x.goodsId)) || {}).sort) !== String(x.oldSort));
  if (drift.length) { console.error('写前漂移', drift.length, '方案作废需重算'); process.exit(1); }
  console.log('写前一致性 PASS (0漂移)');

  // 变更清单(写死): 只有这83个goodsId的sort可改
  const allowIds = new Set(changes.map(x => String(x.goodsId)));

  const ctx = await launch({ headless: true });
  const page = ctx.pages()[0] || await ctx.newPage();
  page.setDefaultTimeout(60000);
  const blocked = [];
  await page.route('**/api3/**', route => {
    const u = route.request().url();
    const ep = u.replace(cfg.BASE + '/api3/', '').split('?')[0];
    // 白名单优先: 本次允许的sort写接口直接放行
    if (WRITE_ALLOW.some(b => ep.endsWith(b))) return route.continue();
    if (WRITE_BLOCK.some(b => ep.endsWith(b))) { blocked.push(ep); console.log('  [守卫ABORT]', ep); return route.abort(); }
    return route.continue();
  });
  await login(page);

  const found = [];
  page.on('request', r => {
    const u = r.url();
    if (!u.includes('/api3/') || r.method() !== 'POST') return;
    const ep = u.replace(cfg.BASE + '/api3/', '').split('?')[0];
    if (ep === EP_PL) { try { found.push({ headers: r.headers(), body: JSON.parse(r.postData()) }); } catch (e) {} }
  });
  const BASEURL = `${cfg.BASE}/bos/products/ecGoodsmanage/${cfg.BOS_ID}/${cfg.KEY}`;
  await page.goto(BASEURL + '/goods/pointsMall/index', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(11000);
  const keep = ['authorization', 'apiclient', 'weimob-bosid', 'content-type', 'referer', 'source', 'tcode'];
  const h = found.pop();
  if (!h) throw new Error('未捕获积分列表模板');
  const headers = {}; keep.forEach(k => { if (h.headers[k]) headers[k] = h.headers[k]; });
  console.log('模板已捕获');

  const readAll = async () => {
    const m = new Map();
    for (let p = 1; p <= 60; p++) {
      const j = await post(page, cfg.BASE + '/api3/' + EP_PL, { ...h.body, pageNum: p, pageSize: 50 }, headers);
      if (!isOk(j)) break;
      const l = j.data.pageList || [];
      l.forEach(x => m.set(String(x.goodsId), x));
      if (l.length < 50) break;
    }
    return m;
  };
  const writeSort = async (r, sortVal) => {
    const j = await post(page, cfg.BASE + '/api3/' + EP_PS, {
      basicInfo: h.body.basicInfo, solutionType: 2,
      goodsId: r.goodsId, pointClassifyId: Number(r.pointClassifyId), sort: Number(sortVal),
      i18n: { language: 'zh-CN', timezone: 8 },
      extendInfo: { refer: '/bos/products/ecGoodsmanage/{bosId}/{key}/goods/pointsMall/index', source: 80 },
    }, headers);
    if (!isOk(j)) throw new Error('sort写失败:' + JSON.stringify(j).slice(0, 120));
  };

  // 回滚快照: 从写前基线取每个goodsId的oldSort
  const rollbackFile = path.join(PATHS.BACKUP, `100-sort-rollback_${ts}.json`);
  const snapshot = { createdAt: new Date().toISOString(), planFile, baseFile,
    points: changes.map(x => ({ goodsId: x.goodsId, pointClassifyId: x.pointClassifyId, oldSort: x.oldSort, newSort: x.newSort })) };
  if (MODE === 'apply') fs.writeFileSync(rollbackFile, JSON.stringify(snapshot, null, 1), 'utf8');
  console.log('回滚快照', MODE === 'apply' ? '已落盘 ' + path.basename(rollbackFile) : '(sample/dry不落盘)');

  if (MODE === 'rollback') {
    const rbFile = process.argv.find(a => a.startsWith('--file='));
    const rf = rbFile ? path.join(PATHS.BACKUP, rbFile.split('=')[1]) : latest(PATHS.BACKUP, '100-sort-rollback_');
    const rb = JSON.parse(fs.readFileSync(rf, 'utf8'));
    let ok = 0;
    for (const r of rb.points) { try { await writeSort(r, r.oldSort); ok++; } catch (e) { console.log('回滚异常', r.goodsId, e.message.slice(0, 80)); } }
    console.log('回滚完成', ok, '/', rb.points.length);
    console.log('RESULT ROLLBACK', ok === rb.points.length ? 'PASS' : 'FAIL');
    await ctx.close(); return;
  }

  // 小样选取: 边界型 — sort=0的新品 + 各二级分组最低newSort(组首) + 最高newSort(全局第一)
  let targets = changes.slice();
  if (MODE === 'sample') {
    const pickIds = new Set();
    // 全局第一(最高newSort)
    pickIds.add(String(changes.slice().sort((a,b)=>b.newSort-a.newSort)[0].goodsId));
    // sort=0 的新品取2个
    changes.filter(x=>x.oldSort===0).slice(0,2).forEach(x=>pickIds.add(String(x.goodsId)));
    // 每个二级分组取组首(newSort最大)1个
    const byL2 = {};
    changes.forEach(x=>{const k=x.l2.name; if(!byL2[k]||x.newSort>byL2[k].newSort) byL2[k]=x;});
    Object.values(byL2).forEach(x=>pickIds.add(String(x.goodsId)));
    targets = changes.filter(x=>pickIds.has(String(x.goodsId))).slice(0,12);
    console.log('小样边界样本', targets.length, '个: sort=0新品', targets.filter(x=>x.oldSort===0).length,
      '| 二级分组组首', new Set(targets.map(x=>x.l2.name)).size);
  }
  if (MODE === 'dry') { console.log('DRY: 目标', targets.length, '不写入'); await ctx.close(); return; }

  // 写前STATIC快照(从小样本/全量)
  const before = await readAll();
  const beforeStat = new Map();
  targets.forEach(r => { const b = before.get(String(r.goodsId)); if (b) beforeStat.set(String(r.goodsId), Object.fromEntries(STATIC.map(k=>[k, b[k]]))); });
  // 非目标快照(全量basline已经在base里)

  // 写入
  const ledger = [];
  let fail = 0, abort = false;
  for (let i = 0; i < targets.length; i += (MODE === 'sample' ? targets.length : BATCH)) {
    const chunk = targets.slice(i, i + (MODE === 'sample' ? targets.length : BATCH));
    for (const r of chunk) {
      if (abort) break;
      try {
        await writeSort(r, r.newSort);
        ledger.push({ goodsId: r.goodsId, ok: true, oldSort: r.oldSort, newSort: r.newSort });
      } catch (e) {
        fail++; ledger.push({ goodsId: r.goodsId, ok: false, err: e.message.slice(0, 120) });
        console.log('写异常', r.goodsId, e.message.slice(0, 100));
        if (fail > MAX_FAIL) { abort = true; console.log('失败超阈值', MAX_FAIL, '中止'); }
      }
      await sleep(MODE === 'sample' ? 120 : 80);
    }
    console.log('批次完成', i + 1, '-', Math.min(i + (MODE === 'sample' ? targets.length : BATCH), targets.length), '累计失败', fail);
    if (MODE === 'apply') await sleep(500);
  }

  // 回读三查
  await sleep(1000);
  const after = await readAll();
  let sortWrong = 0, staticChanged = 0, nonTargetChanged = 0;
  targets.forEach(r => {
    const a = after.get(String(r.goodsId));
    if (!a || String(a.sort) !== String(r.newSort)) sortWrong++;
    // STATIC三查
    const bstat = beforeStat.get(String(r.goodsId));
    if (bstat) STATIC.forEach(k => { if (String(a[k]) !== String(bstat[k])) staticChanged++; });
  });
  // 非目标: 不在allowIds的, sort不能变
  after.forEach((a, gid) => {
    if (allowIds.has(gid)) return;
    const b = bm.get(gid);
    if (b && String(a.sort) !== String(b.sort)) nonTargetChanged++;
  });
  console.log('三查: 目标sort不符', sortWrong, '| STATIC变化', staticChanged, '| 非目标sort变化', nonTargetChanged,
    '| 写异常', fail, '| 守卫拦截', blocked.length);
  const pass = sortWrong === 0 && staticChanged === 0 && nonTargetChanged === 0 && fail === 0;

  // 台账
  const ledgerFile = path.join(PATHS.BACKUP, `100-sort-ledger_${MODE}_${ts}.json`);
  fs.writeFileSync(ledgerFile, JSON.stringify({ mode: MODE, ts, summary: { targets: targets.length, sortWrong, staticChanged, nonTargetChanged, fail, blocked: blocked.length, pass }, ledger }, null, 1), 'utf8');
  console.log('台账:', path.basename(ledgerFile));

  // 小样自动回滚
  if (MODE === 'sample') {
    console.log('小样自动回滚…');
    for (const r of targets) { try { await writeSort(r, r.oldSort); } catch (e) { console.log('回滚异常', r.goodsId); } }
    console.log('回滚完成, 请复核线上已恢复原状');
  }
  console.log('RESULT', MODE.toUpperCase(), pass ? 'PASS' : 'FAIL');
  await ctx.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
