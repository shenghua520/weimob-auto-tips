// 49-fix-points-quotas.js — 修复可兑数量：updatePointGoods 整单覆盖 editChangeNum
// 口径：每SKU配置额 = (goodsAvailableNum + goodsAlreadySoldNum) / n（列表聚合是剩余量）
// 读 availableChangeNum / 写 editChangeNum / editQuantity 是物理库存回显——别混
// 用法: node 49-fix-points-quotas.js [--sample] [--max=N]
const fs = require('fs');
const path = require('path');
const { cfg, launch, login, post, isOk, sleep, PATHS } = require('./lib/common');

const EP_PL = 'mall/point/goods/queryPointGoodsListForManagement';
const EP_PD = 'mall/point/goods/queryPointGoodsDetailForManagement';
const EP_UP = 'mall/point/goods/updatePointGoods';
const LEDGER = path.join(PATHS.BACKUP, '49-fix-ledger.json');
const MODE = process.argv.includes('--sample') ? 'sample' : 'batch';
const MAX = +(process.argv.find(a => a.startsWith('--max=')) || '--max=999').split('=')[1];
const CONC = +(process.argv.find(a => a.startsWith('--concurrency=')) || '--concurrency=3').split('=')[1];

(async () => {
  // 现存积分条目 × 计划表(54-plan) 求目标配额；也可传 58-fix-set.json 直接用
  const pf = fs.readdirSync(PATHS.BACKUP).filter(x => x.startsWith('54-plan')).sort().pop();
  const { plan } = JSON.parse(fs.readFileSync(path.join(PATHS.BACKUP, pf), 'utf8'));
  const pmap = new Map(plan.map(p => [p.newId, p]));

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

  // 全量现存条目
  const items = [];
  for (let p = 1; p <= 20; p++) {
    const j = await post(page, cfg.BASE + '/api3/' + EP_PL, { ...T.body, pageNum: p, pageSize: 50 }, H);
    if (!isOk(j)) break;
    const l = j.data.pageList || [];
    items.push(...l);
    if (l.length < 50) break;
    await sleep(150);
  }
  // 求目标配额并筛需修复的
  const need = [];
  items.forEach(i => {
    const P = pmap.get(i.goodsId);
    if (!P) return;
    const n = P.skus.length;
    const q = (i.goodsAvailableNum + i.goodsAlreadySoldNum) / n;
    if (!Number.isInteger(q)) return; // 特例跳过，人工处理
    need.push({ newId: i.goodsId, srcId: P.srcId, q, n });
  });
  let queue = MODE === 'sample' ? need.slice(0, 1) : need.slice(0, MAX);
  console.log(`[${MODE}] 现存 ${items.length} | 需修复 ${need.length} | 本块 ${queue.length}`);

  let ledger = [];
  if (fs.existsSync(LEDGER)) ledger = JSON.parse(fs.readFileSync(LEDGER, 'utf8'));
  const done = new Set(ledger.filter(x => x.ok).map(x => x.newId));
  queue = queue.filter(f => !done.has(f.newId));

  const doOne = async F => {
    const jd = await post(page, cfg.BASE + '/api3/' + EP_PD, { ...T.body, goodsId: F.newId, solutionType: 2 }, H);
    const det = isOk(jd) ? jd.data : null;
    if (!det || !(det.skuList || []).length) throw new Error('详情空');
    const ju = await post(page, cfg.BASE + '/api3/' + EP_UP, {
      basicInfo: T.body.basicInfo, solutionType: 2, goodsId: F.newId,
      classifyId: det.pointClassifyInfo ? det.pointClassifyInfo.pointClassifyId : 0,
      priceType: det.priceType, goodsLimitNum: det.goodsLimitNum,   // 必带防重置
      skuList: det.skuList.map(s => ({ skuId: s.skuId, editChangeNum: F.q, point: s.point, pointPrice: s.pointPrice, isPoint: s.isPoint })),
      i18n: { language: 'zh-CN', timezone: 8 }, extendInfo: { refer: 'goods/pointsMall/editGoods', source: 80 },
    }, H);
    if (!isOk(ju)) throw new Error('update:' + JSON.stringify(ju).slice(0, 110));
    await sleep(350);
    const jv = await post(page, cfg.BASE + '/api3/' + EP_PD, { ...T.body, goodsId: F.newId, solutionType: 2 }, H);
    const v = isOk(jv) ? jv.data : null;
    if (!v) throw new Error('verify:空');
    const quotas = v.skuList.map(s => s.availableChangeNum);
    if (!quotas.every(x => x === F.q)) throw new Error(`verify:配额 ${quotas.join(',')}≠${F.q}`);
    const pts = v.skuList.map(s => `${s.point}/${s.pointPrice}`).sort().join(',');
    const pts0 = det.skuList.map(s => `${s.point}/${s.pointPrice}`).sort().join(',');
    if (pts !== pts0) throw new Error('verify:兑换值被动');
  };

  let okCount = 0, failStreak = 0;
  const flush = () => fs.writeFileSync(LEDGER, JSON.stringify(ledger, null, 1), 'utf8');
  const worker = async wid => {
    while (queue.length && failStreak < 3) {
      const F = queue.shift();
      try {
        await doOne(F);
        okCount++; failStreak = 0;
        ledger.push({ newId: F.newId, srcId: F.srcId, q: F.q, ok: true, at: new Date().toISOString() });
        flush();
        if (okCount % 25 === 0) console.log(`[${new Date().toISOString().slice(11, 19)}] W${wid} ok=${okCount}`);
      } catch (e) {
        failStreak++;
        ledger.push({ newId: F.newId, ok: false, err: e.message.slice(0, 140), at: new Date().toISOString() });
        flush();
        console.log(`W${wid} 异常: ${F.newId} | ${e.message.slice(0, 100)}`);
      }
    }
  };
  if (MODE === 'sample') { await doOne(queue[0]); console.log('小样 PASS'); }
  else await Promise.all(Array.from({ length: CONC }, (_, i) => worker(i + 1)));
  console.log(`结束: ok=${okCount} failStreak=${failStreak}`);
  await ctx.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
