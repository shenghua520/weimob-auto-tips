/**
 * 41 · 按「在售商品二级分组 + 积分价升序」重排兑换商城（积分商城）排序
 *
 * 排序规则（用户点名）：
 *   第一优先级：在售商品分组树里的「二级分组」既有顺序
 *               （11-07 导出树：一级 sort 降序，组内二级 sort 降序）
 *   第二优先级：积分价 minPoint 从低到高
 *   sort 数字越大越靠前 → 分组越靠前整体 sort 越大，组内价越低 sort 越大
 *
 * 最小化改动 / 不该改的别改：
 *   - 只写 updatePointGoodsSort 的 sort 一个字段；其余 18 个关键字段逐一验收必须不变
 *   - sort 值域复用「现有 393 个值的集合」重新分配，不引入新数值
 *   - 已验证积分商品 sort 与在售商品 sort 是两套独立字段；本脚本仍会回读复核
 *   - 不动积分分组、积分价、库存、上下架、标题、主图、在售商品、素材等任何范围外对象
 *
 * 模式（默认 --plan，最安全）：
 *   --plan    只生成计划表（本地），零写
 *   --test    小范围：第一个二级分组写入目标值 → 全量回读验收 → 自动回滚 → 再回读确认
 *   --apply   全量分批写入 + 全量验收（需先跑通 --test）
 *   --rollback 从回滚文件恢复原 sort
 *
 * 全程所有其他写接口由路由守卫 abort。
 */
const fs = require('fs');
const path = require('path');
const { cfg, launch, login, captureHeaders, post, isOk, stamp, writeCsv, PATHS } = require('./lib/common');

const MODE = process.argv.includes('--test') ? 'test'
  : process.argv.includes('--apply') ? 'apply'
    : process.argv.includes('--rollback') ? 'rollback' : 'plan';

const POINTS_PAGE = `${cfg.BASE}/bos/products/ecGoodsmanage/${cfg.BOS_ID}/${cfg.KEY}/goods/pointsMall/index`;
const GOODS_PAGE = `${cfg.BASE}/bos/products/ecGoodsmanage/${cfg.BOS_ID}/${cfg.KEY}/goods/list`;
const EP = 'queryPointGoodsListForManagement';
const EP_GOODS = 'queryGoodsListWithPageForManagement';
const API = `${cfg.BASE}/api3/mall/point/goods/${EP}`;
const API_SORT = `${cfg.BASE}/api3/mall/point/goods/updatePointGoodsSort`;
const API_GOODS = `${cfg.BASE}/api3/mall/goods/${EP_GOODS}`;

// 守卫策略：黑名单只拦「明确的写动作」，页面初始化只读请求一律放行
// （白名单式会把 user/current、conditionQueryAndReplaceDomain 等只读初始化也拦掉，
//   导致页面查询根本发不出来 —— 实测踩过）
const WRITE_VERBS = [
  'addGoodsClassify', 'deleteGoodsClassify', 'updateGoodsClassify',
  'moveGoodsToClassify', 'addPointGoods', 'deletePointGoods',
  'addPointClassify', 'updatePointClassify', 'deletePointClassify',
  '/goods/update', '/goods/delete', '/goods/import', '/material/delete',
  '/point/goods/save', '/point/goods/batch',
  'insertMaterial', 'createGroup', 'batchUpdate', 'setOnline',
];
// 本脚本唯一允许写入的接口
const ALLOW_WRITE = ['updatePointGoodsSort'];

// docs/13 铁律的验收字段，拆两组：
//  STATIC   —— 本脚本绝不可能改；一旦变化就是事故，计入失败判定
//  VOLATILE —— 线上真实发生兑换时会自然波动（库存/冻结/可兑数/已兑数），
//              只报告、不计入失败，也绝不「顺手修回去」（不该改的别改）
const STATIC = ['minPoint', 'maxPoint', 'minPointPrice', 'maxPointPrice',
  'goodsLimitNum', 'isOnline', 'isCanSell', 'title', 'defaultImageUrl',
  'priceType', 'soldType', 'goodsType', 'subGoodsType', 'outerGoodsCode'];
const VOLATILE = ['goodsStock', 'goodsAvailableNum', 'goodsAlreadySoldNum'];
const norm = v => JSON.stringify(v === undefined ? null : v);

const latest = (dir, re) => fs.readdirSync(dir).filter(f => re.test(f)).sort().pop();

(async () => {
  console.log(`=== 兑换商城按二级分组重排 [${MODE}] ===\n`);

  // ---------- 离线：读基线 + 分组树，生成目标顺序 ----------
  const baseFile = path.join(PATHS.BACKUP, latest(PATHS.BACKUP, /^重排前基线_积分商品_/));
  const clsFile = path.join(PATHS.BACKUP, latest(PATHS.BACKUP, /^商品分组原始快照_/));
  const base = JSON.parse(fs.readFileSync(baseFile, 'utf8'));
  const cls = JSON.parse(fs.readFileSync(clsFile, 'utf8'));
  const goods = base.goods;                       // 393 个积分商品（写前全量）
  const onsaleCls = new Map(base.onsaleClassify.map(o => [String(o.goodsId), o.classifyList]));

  const l1 = ((cls.data || cls).goodsClassifyList || []).slice().sort((a, b) => (b.sort || 0) - (a.sort || 0));
  const groupOrder = [];
  l1.forEach(g => (g.childClassifyList || []).slice()
    .sort((a, b) => (b.sort || 0) - (a.sort || 0))
    .forEach(c => groupOrder.push({ name: c.name, parent: g.name })));
  const gi = new Map(groupOrder.map((g, i) => [g.name, i]));

  const g2Of = p => {
    const arr = onsaleCls.get(String(p.goodsId)) || [];
    const lv2 = arr.filter(c => Number(c.level) === 2).map(c => c.name);
    return lv2.length ? lv2 : arr.map(c => c.name);
  };

  const ranked = goods.map((p, i) => {
    const names = g2Of(p);
    const k = Math.min(...names.map(n => gi.has(n) ? gi.get(n) : 99999));
    // 每个积分商品恰好一个二级分组；分组名自带「/」（如 修正带/液），不能用 / 拼接
    return { p, i, g2: names[0] || '', key: Number.isFinite(k) ? k : 99999 };
  }).sort((x, y) => x.key - y.key || (Number(x.p.minPoint) - Number(y.p.minPoint)) || x.i - y.i);

  // sort 值复用：现有值降序集合，按目标名次依次分配（值域完全不变）
  const sortPool = goods.map(p => Number(p.sort)).sort((a, b) => b - a);
  const plan = ranked.map((x, n) => ({
    rank: n + 1, goodsId: x.p.goodsId, title: x.p.title || '',
    g2: x.g2, parent: (groupOrder[x.key] || {}).parent || '',
    pointClassifyId: (x.p.pointClassifyInfo && x.p.pointClassifyInfo.pointClassifyId) || '',
    pointClassifyName: (x.p.pointClassifyInfo && x.p.pointClassifyInfo.name) || '',
    minPoint: x.p.minPoint, oldSort: x.p.sort, newSort: sortPool[n],
  }));
  const unmatched = plan.filter(x => !x.g2 || !gi.has(x.g2));
  const changed = plan.filter(x => String(x.oldSort) !== String(x.newSort));

  console.log('基线:', path.basename(baseFile), '| 分组树:', path.basename(clsFile));
  console.log('商品:', goods.length, '| 二级分组顺序:', groupOrder.length, '| 参与分组:', new Set(plan.map(x => x.g2)).size);
  console.log('未匹配到分组树的商品:', unmatched.length, '| 需改动的商品:', changed.length);
  if (unmatched.length) {
    console.log('⚠ 未匹配样例:', unmatched.slice(0, 5).map(x => `${x.goodsId}:${x.g2}`).join(' '));
    if (MODE !== 'plan') throw new Error('存在未匹配分组的商品，停止写入，需先确认排序基准');
  }

  // ---------- 计划表（本地） ----------
  const ts = stamp();
  const planFile = path.join(PATHS.OUT, `重排计划_二级分组优先_${ts}.csv`);
  writeCsv(planFile,
    ['目标名次', '商品ID', '商品名称', '二级分组', '所属一级', '积分分组', '积分价', '原sort', '新sort', '是否变化'],
    plan.map(x => [x.rank, x.goodsId, x.title, x.g2, x.parent, x.pointClassifyName,
      x.minPoint, x.oldSort, x.newSort, String(x.oldSort) !== String(x.newSort) ? '改' : '不变']));
  console.log('\n[计划表]', planFile);
  console.log('前 8 名:');
  plan.slice(0, 8).forEach(x => console.log(`  ${x.rank}. [${x.g2}] 积分${x.minPoint} ${x.title.slice(0, 18)} | ${x.oldSort} → ${x.newSort}`));

  if (MODE === 'plan') { console.log('\n--plan 结束：零写操作，线上零改动'); return; }

  // ---------- 浏览器 ----------
  const ctx = await launch({ headless: true });
  const page = ctx.pages()[0] || await ctx.newPage();
  page.setDefaultTimeout(60000);
  let blocked = 0;
  await page.route('**/api3/**', route => {
    const u = route.request().url();
    const m = route.request().method();
    if (m === 'GET') return route.continue();
    if (ALLOW_WRITE.some(w => u.includes(w))) return route.continue();  // 唯一放行的写接口
    if (WRITE_VERBS.some(w => u.includes(w))) {
      blocked++;
      console.error('  [守卫] 阻断写接口:', u);
      return route.abort();
    }
    return route.continue();   // 其余（含页面初始化只读 POST）正常放行
  });

  await page.goto(POINTS_PAGE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);
  if (page.url().includes('account.weimob.com')) {
    console.log('登录中…'); await login(page); await page.waitForTimeout(3000);
    await page.goto(POINTS_PAGE, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(6000);
  }
  const cp = await captureHeaders(page, POINTS_PAGE, EP);
  const hdr = cp.headers, pb = cp.payload || {};

  const readPoints = async () => {
    const out = [];
    for (let pn = 1; pn <= 40; pn++) {
      const j = await post(page, API, { ...pb, pageNum: pn, pageSize: 50 }, hdr);
      if (!isOk(j)) break;
      const l = (j.data && j.data.pageList) || [];
      out.push(...l);
      if (!l.length || l.length < 50) break;
    }
    return out;
  };
  const readOnsale = async () => {
    let gp = null;
    const onReq = r => { if (r.url().includes(EP_GOODS) && r.postData()) { try { gp = JSON.parse(r.postData()); } catch (e) {} } };
    page.on('request', onReq);
    await page.goto(GOODS_PAGE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(7000);
    page.off('request', onReq);
    const out = [];
    if (!gp) return out;
    for (let pn = 1; pn <= 40; pn++) {
      const j = await post(page, API_GOODS, { ...gp, pageNum: pn, pageSize: 20 }, hdr);
      if (!isOk(j)) break;
      const l = (j.data && j.data.pageList) || [];
      out.push(...l);
      if (!l.length || l.length < 20) break;
    }
    return out;
  };
  const writeSort = async (goodsId, pointClassifyId, sort) => {
    const body = {
      basicInfo: pb.basicInfo, solutionType: 2, goodsId: Number(goodsId),
      pointClassifyId: Number(pointClassifyId), sort: Number(sort),
      i18n: pb.i18n || { language: 'zh-CN', timezone: 8 },
      extendInfo: { refer: '/bos/products/ecGoodsmanage/{bosId}/{key}/goods/pointsMall/index', source: 80 },
    };
    const j = await post(page, API_SORT, body, hdr);
    return String(j.errcode) === '0' || String(j.code) === '0';
  };

  // 验收：静态字段（含积分分组名）必须一字不变；业务波动字段只报告不判失败
  const verify = (before, after, label) => {
    const bm = new Map(before.map(p => [String(p.goodsId), p]));
    const diffs = [], vol = [];
    after.forEach(p => {
      const b = bm.get(String(p.goodsId));
      if (!b) { diffs.push({ goodsId: p.goodsId, f: '(缺失)' }); return; }
      STATIC.forEach(f => { if (norm(b[f]) !== norm(p[f])) diffs.push({ goodsId: p.goodsId, f, before: norm(b[f]), after: norm(p[f]) }); });
      VOLATILE.forEach(f => { if (norm(b[f]) !== norm(p[f])) vol.push({ goodsId: p.goodsId, f }); });
      const bn = b.pointClassifyInfo && b.pointClassifyInfo.name;
      const an = p.pointClassifyInfo && p.pointClassifyInfo.name;
      if (bn !== an) diffs.push({ goodsId: p.goodsId, f: 'pointClassifyInfo.name', before: bn, after: an });
    });
    console.log(`[${label}] 回读 ${after.length} 条 | 静态字段差异 ${diffs.length} | 业务自然波动 ${vol.length}`);
    diffs.slice(0, 8).forEach(d => console.log('   ✗ 静态字段', JSON.stringify(d)));
    if (vol.length) {
      const ids = [...new Set(vol.map(v => v.goodsId))];
      console.log(`   · 业务自然波动涉及 ${ids.length} 个商品: ${ids.slice(0, 5).join(', ')}（兑换导致库存/已兑数变化，非本脚本所为，不修复不动它）`);
    }
    return { diffs, vol };
  };

  // ---------- rollback 模式 ----------
  // 统一 schema：{ createdAt, baseline, mode, count, items:[{goodsId,pointClassifyId,oldSort,newSort}] }
  // 兼容早期纯数组格式；也支持 --rollback-file=重排回滚_xxx.json 显式指定，避免取错最新文件
  if (MODE === 'rollback') {
    const rbArg = process.argv.find(a => a.startsWith('--rollback-file='));
    const rbName = rbArg ? rbArg.split('=')[1] : latest(PATHS.BACKUP, /^重排回滚_/);
    if (!rbName) throw new Error('backup/ 下找不到任何 重排回滚_*.json');
    const rf = path.join(PATHS.BACKUP, rbName);
    if (!fs.existsSync(rf)) throw new Error('找不到回滚文件：' + rf);
    const raw = JSON.parse(fs.readFileSync(rf, 'utf8'));
    const rj = Array.isArray(raw) ? raw : raw.items;
    if (!Array.isArray(rj) || !rj.length) throw new Error('回滚文件内容为空或格式不对：' + rbName);
    console.log('回滚文件:', rbName, '| 模式:', raw.mode || '(旧格式)', '| 条数:', rj.length);
    let ok = 0, fail = 0;
    for (const r of rj) {
      const good = await writeSort(r.goodsId, r.pointClassifyId, r.oldSort);
      good ? ok++ : fail++;
      await page.waitForTimeout(300);
    }
    const after = await readPoints();
    const am = new Map(after.map(p => [String(p.goodsId), p.sort]));
    const bad = rj.filter(r => String(am.get(String(r.goodsId))) !== String(r.oldSort));
    console.log('回滚完成: 成功', ok, '失败', fail, '| 回读不符', bad.length);
    console.log('静态字段验收差异:', verify(goods, after, 'rollback').diffs.length);
    await ctx.close(); return;
  }

  // ---------- test / apply ----------
  const beforePoints = await readPoints();
  console.log('\n写前回读积分商品:', beforePoints.length);
  const beforeOnsale = await readOnsale();
  const beforeOnMap = new Map(beforeOnsale.map(g => [String(g.goodsId), g.sort]));
  console.log('写前回读在售商品:', beforeOnsale.length, '(含 sort)');
  // 漂移检查：若线上已不是基线，停止
  const bm = new Map(beforePoints.map(p => [String(p.goodsId), p]));
  const drift = goods.filter(g => !bm.has(String(g.goodsId)) || String(bm.get(String(g.goodsId)).sort) !== String(g.sort));
  if (drift.length) { await ctx.close(); throw new Error(`基线漂移 ${drift.length} 条，停止写入（请重新生成基线）`); }
  console.log('基线漂移检查: 0 条 ✔');

  // 写操作前：把「这一刻」的全量线上状态完整落盘（先记录原始数据，再动手）
  const snapFile = path.join(PATHS.BACKUP, `重排写前即时快照_积分商品_${ts}.json`);
  fs.writeFileSync(snapFile, JSON.stringify({
    createdAt: new Date().toISOString(), mode: MODE, count: beforePoints.length,
    points: beforePoints, onsaleSort: beforeOnsale.map(g => ({ goodsId: g.goodsId, sort: g.sort })),
  }, null, 1), 'utf8');
  console.log('[写前即时快照]', path.basename(snapFile), '| 积分商品:', beforePoints.length, '| 在售商品:', beforeOnsale.length);

  const targets = MODE === 'test'
    ? plan.filter(x => x.g2 === plan[0].g2).slice(0, 12)   // 仅第一个二级分组
    : plan.filter(x => String(x.oldSort) !== String(x.newSort));
  console.log(`\n本次写入 ${targets.length} 条（${MODE}）`);

  // 回滚文件必须在「写入之前」落盘：即使中途崩溃/验收误判，也永远有恢复依据
  // test / apply 都落盘；items 只记本次真正会被写的条目（test=12 / apply=391），
  // 回滚时不碰任何范围外商品，符合「不该改的别改」
  const rbFile = path.join(PATHS.BACKUP, `重排回滚_${ts}.json`);
  const rbBody = {
    createdAt: new Date().toISOString(), baseline: path.basename(baseFile),
    mode: MODE, count: targets.length,
    items: targets.map(x => ({
      goodsId: x.goodsId, pointClassifyId: x.pointClassifyId,
      oldSort: x.oldSort, newSort: x.newSort,
    })),
  };
  fs.writeFileSync(rbFile, JSON.stringify(rbBody, null, 1), 'utf8');
  const rbCheck = JSON.parse(fs.readFileSync(rbFile, 'utf8'));
  if (!Array.isArray(rbCheck.items) || rbCheck.items.length !== targets.length) {
    throw new Error('回滚文件落盘校验失败，停止写入');
  }
  console.log('[回滚文件·写入前已落盘]', path.basename(rbFile), '| 条数:', targets.length);

  let ok = 0, fail = 0;
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    const good = await writeSort(t.goodsId, t.pointClassifyId, t.newSort);
    good ? ok++ : fail++;
    if ((i + 1) % 50 === 0 || i === targets.length - 1) console.log(`  进度 ${i + 1}/${targets.length} | 成功 ${ok} 失败 ${fail}`);
    await page.waitForTimeout(300);
    if (fail > 3) { console.error('失败超过 3 条，中止'); break; }
  }
  console.log('写入完成: 成功', ok, '失败', fail);

  // ---------- 回读验收 ----------
  const after = await readPoints();
  const am = new Map(after.map(p => [String(p.goodsId), p]));
  const wrong = targets.filter(t => String((am.get(String(t.goodsId)) || {}).sort) !== String(t.newSort));
  const others = beforePoints.filter(p => !targets.some(t => String(t.goodsId) === String(p.goodsId)));
  const touched = others.filter(p => String((am.get(String(p.goodsId)) || {}).sort) !== String(p.sort));
  const fieldDiffs = verify(beforePoints, after, MODE);
  const afterOnsale = await readOnsale();
  const onDiff = afterOnsale.filter(g => String(beforeOnMap.get(String(g.goodsId))) !== String(g.sort));
  console.log(`\n=== 验收（${MODE}）===`);
  console.log('目标条数 sort 正确:', targets.length - wrong.length, '/', targets.length, '| 不符', wrong.length);
  console.log('范围外积分商品被误改:', touched.length);
  console.log('在售商品 sort 变化:', onDiff.length);
  console.log('静态字段差异:', fieldDiffs.diffs.length, '| 业务自然波动(不判失败):', fieldDiffs.vol.length);
  console.log('被阻断写接口:', blocked);
  const pass = wrong.length === 0 && touched.length === 0 && onDiff.length === 0 && fieldDiffs.diffs.length === 0 && fail === 0;
  console.log('总判定:', pass ? '✔ 全部通过' : '✗ 未通过');

  if (MODE === 'test') {
    // 自动回滚测试写入，线上恢复零改动
    console.log('\n--- 测试回滚（恢复线上原状）---');
    let rok = 0;
    for (const t of targets) {
      if (await writeSort(t.goodsId, t.pointClassifyId, t.oldSort)) rok++;
      await page.waitForTimeout(300);
    }
    const restored = await readPoints();
    const rm = new Map(restored.map(p => [String(p.goodsId), p.sort]));
    const rbad = targets.filter(t => String(rm.get(String(t.goodsId))) !== String(t.oldSort));
    // 与「写前即时状态」比对，才能准确衡量本次写+回滚是否引入了变化
    const rdiff = verify(beforePoints, restored, '回滚后');
    console.log('回滚成功:', rok, '/', targets.length, '| 回读不符:', rbad.length, '| 静态字段差异:', rdiff.diffs.length, '| 业务波动:', rdiff.vol.length);
    console.log(rbad.length === 0 && rdiff.diffs.length === 0 ? '✔ 线上 sort 已恢复原状；其余差异均为业务自然波动，未做任何修复' : '⚠ 回滚未完全，请检查');
  } else if (MODE === 'apply' && pass) {
    // 回滚文件已在写入前落盘，此处只引用，不再覆写（避免 schema 不一致）
    console.log('\n[回滚文件]', rbFile, '(写入前已落盘，可直接 --rollback)');
    const rFile = path.join(PATHS.OUT, `重排验收报告_${ts}.md`);
    const md = [
      '# 兑换商城按二级分组重排 · 验收报告', '',
      `- 时间：${new Date().toLocaleString('zh-CN')}`,
      `- 规则：二级分组顺序（按在售商品分组树 sort）优先，组内积分价 minPoint 升序`,
      `- 商品总数：${beforePoints.length}｜实际写入：${targets.length}（成功 ${ok} / 失败 ${fail}）`,
      `- 目标 sort 正确：${targets.length - wrong.length}/${targets.length}`,
      `- 范围外积分商品误改：${touched.length}｜在售商品 sort 变化：${onDiff.length}`,
      `- 范围外静态字段差异：${fieldDiffs.diffs.length}｜业务自然波动：${fieldDiffs.vol.length}（兑换导致，非本脚本所为）｜阻断其他写接口：${blocked}`,
      `- 判定：${pass ? '✔ 通过' : '✗ 未通过'}`,
      `- 回滚文件：\`${path.basename(rbFile)}\`（node scripts/41-resort-points-by-classify.js --rollback）`,
      '', '## 前 20 名', '', '| 名次 | 二级分组 | 商品 | 积分价 | sort 变化 |', '|---|---|---|---|---|',
      ...plan.slice(0, 20).map(x => `| ${x.rank} | ${x.g2} | ${String(x.title).replace(/\|/g, '\\|').slice(0, 26)} | ${x.minPoint} | ${x.oldSort} → ${x.newSort} |`),
    ];
    fs.writeFileSync(rFile, md.join('\n'), 'utf8');
    console.log('[验收报告]', rFile);
  } else if (MODE === 'apply' && !pass) {
    console.error('\n✗ 验收未通过：线上已部分写入，请立即回滚');
    console.error('   node scripts/41-resort-points-by-classify.js --rollback-file=' + path.basename(rbFile));
    console.error('   回滚文件:', rbFile);
  }

  console.log('\n=== 结束 ===');
  await ctx.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
