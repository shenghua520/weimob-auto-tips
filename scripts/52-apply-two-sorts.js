// 61-apply-sort.js — 按 60 计划表写入两套 sort（各自独立字段）
// 商品列表: batchUpdateGoodsSort {goodsIdList:[单个], sortNum}；积分: updatePointGoodsSort {goodsId, pointClassifyId, sort}
// 模式: --test(小样自动回滚) / --apply(全量) / --rollback(从回滚文件恢复)
const fs = require('fs');
const path = require('path');
const { cfg, launch, login, post, isOk, sleep, PATHS } = require('./lib/common');

const EP_GL = 'mall/goods/queryGoodsListWithPageForManagement';
const EP_GS = 'mall/goods/batchUpdateGoodsSort';
const EP_PL = 'mall/point/goods/queryPointGoodsListForManagement';
const EP_PS = 'mall/point/goods/updatePointGoodsSort';
const MODE = process.argv.includes('--test') ? 'test' : process.argv.includes('--rollback') ? 'rollback' : 'apply';
const ROLLBACK = path.join(PATHS.BACKUP, '61-sort-rollback.json');

(async () => {
  const pf = fs.readdirSync(PATHS.BACKUP).filter(x => x.startsWith('60-sort-plan')).sort().pop();
  const plan = JSON.parse(fs.readFileSync(path.join(PATHS.BACKUP, pf), 'utf8'));
  const BANDS = plan.BANDS;
  // 源→复制体映射：商品列表排序时两者写同一个 sort（复制体隐藏，跟随源）
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

  const writeGoods = async (goodsId, sortNum) => {
    const j = await post(page, cfg.BASE + '/api3/' + EP_GS, {
      basicInfo: G.payload.basicInfo, solutionType: 2,
      goodsIdList: [goodsId], sortNum,
      i18n: { language: 'zh-CN', timezone: 8 },
      extendInfo: { refer: '/bos/products/ecGoodsmanage/{bosId}/{key}/goods/list', source: 80 },
    }, G.headers);
    if (!isOk(j)) throw new Error('商品sort:' + JSON.stringify(j).slice(0, 100));
  };
  // 源+复制体同 sort
  const writeGoodsPair = async r => {
    await writeGoods(r.goodsId, r.newSort);
    const twin = twinOf.get(r.goodsId);
    if (twin) await writeGoods(twin, r.newSort);
  };
  const writePts = async r => {
    const j = await post(page, cfg.BASE + '/api3/' + EP_PS, {
      basicInfo: P.payload.basicInfo, solutionType: 2,
      goodsId: r.goodsId, pointClassifyId: r.pointClassifyId, sort: r.newSort,
      i18n: { language: 'zh-CN', timezone: 8 },
      extendInfo: { refer: '/bos/products/ecGoodsmanage/{bosId}/{key}/goods/pointsMall/index', source: 80 },
    }, P.headers);
    if (!isOk(j)) throw new Error('积分sort:' + JSON.stringify(j).slice(0, 100));
  };
  // 回读当前 sort（用列表全量，简单可靠）
  const readSorts = async (ep, T, size) => {
    const m = new Map();
    for (let p = 1; p <= 60; p++) {
      const j = await post(page, cfg.BASE + '/api3/' + ep, { ...T.payload, pageNum: p, pageSize: size }, T.headers);
      if (!isOk(j)) break;
      const l = j.data.pageList || [];
      l.forEach(i => m.set(i.goodsId, i.sort));
      if (l.length < size) break;
    }
    return m;
  };

  if (MODE === 'rollback') {
    const rb = JSON.parse(fs.readFileSync(ROLLBACK, 'utf8'));
    let ok = 0;
    for (const r of rb.goods) {
      await writeGoods(r.goodsId, r.oldSort);
      const twin = twinOf.get(r.goodsId);
      if (twin) await writeGoods(twin, r.twinOldSort ?? r.oldSort);
      ok++;
    }
    for (const r of rb.points) { await writePts({ goodsId: r.goodsId, pointClassifyId: r.pointClassifyId, newSort: r.oldSort }); ok++; }
    console.log('回滚完成:', ok);
    await ctx.close(); return;
  }

  // 写前即时快照
  const gNow = await readSorts(EP_GL, G, 20);
  const pNow = await readSorts(EP_PL, P, 50);
  const rb = { createdAt: new Date().toISOString(), plan: pf, goods: [], points: [] };
  plan.goodsPlan.forEach(r => {
    const twin = twinOf.get(r.goodsId);
    rb.goods.push({ goodsId: r.goodsId, oldSort: gNow.get(r.goodsId) ?? r.oldSort,
      twinId: twin || null, twinOldSort: twin ? (gNow.get(twin) ?? null) : null, newSort: r.newSort });
  });
  plan.ptsPlan.forEach(r => rb.points.push({ goodsId: r.goodsId, pointClassifyId: r.pointClassifyId, oldSort: pNow.get(r.goodsId) ?? r.oldSort, newSort: r.newSort }));
  if (MODE === 'apply') fs.writeFileSync(ROLLBACK, JSON.stringify(rb, null, 1), 'utf8');
  console.log(`[${MODE}] 商品 ${rb.goods.length} | 积分 ${rb.points.length} | 回滚文件${MODE === 'apply' ? '已落盘' : '(test不落盘)'}`);

  // 小样：每套取前 12 条（边界：各号段最前，含最低价/二级聚集）
  const gList = MODE === 'test' ? plan.goodsPlan.slice(0, 12) : plan.goodsPlan;
  const pList = MODE === 'test' ? plan.ptsPlan.slice(0, 12) : plan.ptsPlan;
  let gOk = 0, pOk = 0;
  for (const r of gList) {
    try { await writeGoodsPair(r); gOk++; } catch (e) { console.log('商品异常', r.goodsId, e.message.slice(0, 80)); }
    await sleep(MODE === 'test' ? 120 : 80);
  }
  for (const r of pList) {
    try { await writePts(r); pOk++; } catch (e) { console.log('积分异常', r.goodsId, e.message.slice(0, 80)); }
    await sleep(MODE === 'test' ? 120 : 80);
  }
  console.log(`写入完成: 商品 ${gOk}/${gList.length} | 积分 ${pOk}/${pList.length}`);

  // 回读验证目标 sort + STATIC（用列表 sort 字段）
  await sleep(1000);
  const gAfter = await readSorts(EP_GL, G, 20);
  const pAfter = await readSorts(EP_PL, P, 50);
  let gBad = 0, pBad = 0;
  gList.forEach(r => {
    if (String(gAfter.get(r.goodsId)) !== String(r.newSort)) gBad++;
    const twin = twinOf.get(r.goodsId);
    if (twin && String(gAfter.get(twin)) !== String(r.newSort)) gBad++;
  });
  pList.forEach(r => { if (String(pAfter.get(r.goodsId)) !== String(r.newSort)) pBad++; });
  console.log(`回读: 商品sort不符 ${gBad} | 积分sort不符 ${pBad}`);

  if (MODE === 'test') {
    console.log('小样自动回滚…');
    for (const r of gList) {
      const o = rb.goods.find(x => x.goodsId === r.goodsId);
      if (o) {
        await writeGoods(r.goodsId, o.oldSort);
        if (o.twinId && o.twinOldSort !== null) await writeGoods(o.twinId, o.twinOldSort);
      }
    }
    for (const r of pList) { const o = rb.points.find(x => x.goodsId === r.goodsId); if (o) await writePts({ goodsId: r.goodsId, pointClassifyId: r.pointClassifyId, newSort: o.oldSort }); }
    console.log('回滚完成');
  }
  await ctx.close();
  console.log('RESULT', MODE, gBad === 0 && pBad === 0 ? 'PASS' : 'FAIL');
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
