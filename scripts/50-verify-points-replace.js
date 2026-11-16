// 50-verify-points-replace.js — 积分替换全量复核（只读）
// 逐条验兑换值(availableChangeNum)/分组/限兑/priceType + 原条目清空 + 分组守恒
// 用法: node 50-verify-points-replace.js
const fs = require('fs');
const path = require('path');
const { cfg, launch, login, post, isOk, sleep, PATHS } = require('./lib/common');

const EP_PL = 'mall/point/goods/queryPointGoodsListForManagement';
const EP_PD = 'mall/point/goods/queryPointGoodsDetailForManagement';

(async () => {
  const pf = fs.readdirSync(PATHS.BACKUP).filter(x => x.startsWith('54-plan')).sort().pop();
  const { plan } = JSON.parse(fs.readFileSync(path.join(PATHS.BACKUP, pf), 'utf8'));
  const wantByNew = new Map(plan.map(p => [p.newId, p]));
  const srcIds = new Set(plan.map(p => p.srcId));

  const ctx = await launch({ headless: true });
  const page = ctx.pages()[0] || await ctx.newPage();
  await login(page);
  const found = [];
  page.on('request', r => {
    const u = r.url();
    if (u.includes('/api3/mall/point/') && r.method() === 'POST') {
      try { found.push({ ep: u.replace(cfg.BASE + '/api3/', '').split('?')[0], headers: r.headers(), body: JSON.parse(r.postData()) }); } catch {}
    }
  });
  await page.goto(cfg.BASE + '/bos/products/ecGoodsmanage/' + cfg.BOS_ID + '/' + cfg.KEY + '/goods/pointsMall/index', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(10000);
  const T = found.filter(x => x.ep === EP_PL).pop();
  if (!T) throw new Error('未捕获模板');
  const keep = ['authorization', 'apiclient', 'weimob-bosid', 'content-type', 'referer', 'source', 'tcode'];
  const H = {}; keep.forEach(k => { if (T.headers[k]) H[k] = T.headers[k]; });

  const items = [];
  for (let p = 1; p <= 20; p++) {
    const j = await post(page, cfg.BASE + '/api3/' + EP_PL, { ...T.body, pageNum: p, pageSize: 50 }, H);
    if (!isOk(j)) throw new Error('列表失败');
    const l = j.data.pageList || [];
    items.push(...l);
    if (l.length < 50) break;
    await sleep(150);
  }
  const idSet = new Set(items.map(i => i.goodsId));
  const report = { at: new Date().toISOString(), total: items.length, expect: plan.length, present: 0, absent: [], valueFail: [], classifyFail: [], limitFail: [], priceTypeFail: [], srcStillIn: [...srcIds].filter(x => idSet.has(x)), classifyDist: {} };
  items.forEach(i => {
    const n = i.pointClassifyInfo ? i.pointClassifyInfo.name : '(无)';
    report.classifyDist[n] = (report.classifyDist[n] || 0) + 1;
  });

  let idx = 0;
  for (const P of plan) {
    idx++;
    const j = await post(page, cfg.BASE + '/api3/' + EP_PD, { ...T.body, goodsId: P.newId, solutionType: 2 }, H);
    const det = isOk(j) ? j.data : null;
    if (!det || !(det.skuList || []).length) { report.absent.push({ srcId: P.srcId, newId: P.newId }); continue; }
    report.present++;
    const want = P.skus.map(s => `${s.point}/${s.pointPrice}/${s.editChangeNum}`).sort().join(',');
    const got = det.skuList.map(s => `${s.point}/${s.pointPrice}/${s.availableChangeNum}`).sort().join(',');
    if (want !== got) report.valueFail.push({ srcId: P.srcId, newId: P.newId, want, got });
    if (!det.pointClassifyInfo || det.pointClassifyInfo.pointClassifyId !== P.classifyId) report.classifyFail.push({ srcId: P.srcId, got: JSON.stringify(det.pointClassifyInfo) });
    if (det.goodsLimitNum !== P.goodsLimitNum) report.limitFail.push({ srcId: P.srcId });
    if (det.priceType !== P.priceType) report.priceTypeFail.push({ srcId: P.srcId });
    if (idx % 50 === 0) { console.log(`验证 ${idx}/${plan.length} ok=${report.present}`); await sleep(120); }
  }

  const out = path.join(PATHS.BACKUP, `50-verify_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`);
  fs.writeFileSync(out, JSON.stringify(report, null, 1), 'utf8');
  console.log('报告:', out);
  console.log('SUMMARY', JSON.stringify({
    total: report.total, expect: report.expect, present: report.present,
    absent: report.absent.length, valueFail: report.valueFail.length,
    classifyFail: report.classifyFail.length, limitFail: report.limitFail.length,
    priceTypeFail: report.priceTypeFail.length, srcStillIn: report.srcStillIn.length,
    classifyDist: report.classifyDist,
  }));
  await ctx.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
