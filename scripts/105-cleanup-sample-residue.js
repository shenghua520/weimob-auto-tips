/**
 * 105 · 清理 104 小样残留的积分商品（验证式删除）
 * 背景：104 小样 addPointGoods 成功但删除回滚 body 缺字段，导致 2 个残留条目。
 * 本脚本只删除「本次小样新增的 2 个 goodsId」，删前记录完整配置，删后逐条确认消失。
 * 属于纠错写操作，同样走「小样→回读」纪律（先删 1 个验证，再删其余）。
 */
const fs = require('fs');
const path = require('path');
const { cfg, launch, login, post, isOk, sleep, stamp, PATHS } = require('./lib/common');

const EP_PL = 'mall/point/goods/queryPointGoodsListForManagement';
const EP_PD = 'mall/point/goods/queryPointGoodsDetailForManagement';
const EP_DEL = 'mall/point/goods/deletePointGoods';
const ALLOW = [EP_PL, EP_PD, EP_DEL];
const BLOCK_EXACT = ['updatePointGoods', 'updatePointGoodsSort', 'moveGoodsToClassify', 'addPointGoods', 'updatePointClassify', 'deletePointClassify'];
// 小样残留的 goodsId（来自 backup/104-sample-ledger_*.json 的 ledger）
const GIDS = process.argv.slice(2).filter(a => /^\d+$/.test(a)).map(Number);
const ts = stamp();

(async () => {
  console.log('=== 清理 104 小样残留 ===');
  if (!GIDS.length) throw new Error('未指定 goodsId');
  console.log('待清理:', GIDS.join(', '));
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
  await page.goto(BASEURL + '/goods/pointsMall/index', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(11000);
  page.off('request', onReq);
  const hPL = found.filter(x => x.ep === EP_PL).pop();
  if (!hPL) throw new Error('未捕获积分列表模板');
  const H = {}; keep.forEach(k => { if (hPL.headers[k]) H[k] = hPL.headers[k]; });
  const shell = JSON.parse(hPL.body);

  const listNow = async () => {
    const out = [];
    for (let p = 1; p <= 60; p++) {
      const j = await post(page, cfg.BASE + '/api3/' + EP_PL, { ...shell, pageNum: p, pageSize: 50 }, H);
      if (!isOk(j)) break;
      const l = (j.data && j.data.pageList) || [];
      out.push(...l);
      if (l.length < 50) break;
    }
    return out;
  };
  const before = await listNow();
  console.log('清理前积分商品总数:', before.length);

  const results = [];
  for (const gid of GIDS) {
    // 删前留档完整配置
    const d = await post(page, cfg.BASE + '/api3/' + EP_PD, { ...shell, goodsId: gid }, H);
    const cfgBefore = isOk(d) ? {
      goodsId: gid, title: d.data.title, classifyId: (d.data.pointClassifyInfo || {}).pointClassifyId,
      priceType: d.data.priceType, goodsLimitNum: d.data.goodsLimitNum,
      skuList: (d.data.skuList || []).map(s => ({ skuId: s.skuId, point: s.point, pointPrice: s.pointPrice, availableChangeNum: s.availableChangeNum })),
    } : null;
    console.log(`\n--- 清理 gid=${gid} ---`);
    console.log('  删前留档:', JSON.stringify(cfgBefore).slice(0, 200));

    const del = await post(page, cfg.BASE + '/api3/' + EP_DEL, {
      basicInfo: shell.basicInfo, solutionType: 2, goodsIdList: [gid],
      i18n: { language: 'zh-CN', timezone: 8 },
      extendInfo: shell.extendInfo || { refer: 'goods/pointsMall/index', source: 80 },
    }, H);
    console.log('  删除返回:', JSON.stringify(del).slice(0, 160));
    await sleep(800);
    const d2 = await post(page, cfg.BASE + '/api3/' + EP_PD, { ...shell, goodsId: gid }, H);
    const gone = !isOk(d2) || !d2.data || !(d2.data.skuList || []).length;
    console.log('  回读确认已移除:', gone ? 'YES' : 'NO(仍有残留)');
    results.push({ goodsId: gid, delOk: isOk(del), gone, cfgBefore });
    await sleep(400);
  }

  const after = await listNow();
  const idsBefore = new Set(before.map(x => String(x.goodsId)));
  const idsAfter = new Set(after.map(x => String(x.goodsId)));
  const removed = [...idsBefore].filter(x => !idsAfter.has(x));
  const added = [...idsAfter].filter(x => !idsBefore.has(x));
  const summary = {
    before: before.length, after: after.length,
    removed, added, blocked,
    allGone: results.every(r => r.gone),
  };
  fs.writeFileSync(path.join(PATHS.BACKUP, `105-cleanup-sample-residue_${ts}.json`),
    JSON.stringify({ summary, results }, null, 1), 'utf8');
  console.log('\n[汇总]', JSON.stringify(summary));
  console.log('RESULT', summary.allGone && removed.length === GIDS.length && !added.length ? 'PASS' : 'FAIL');
  await ctx.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
