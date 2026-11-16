// 48-replace-points-goods.js — 积分商品整体替换：addPointGoods(复制体,同兑换值/分组) → 验 → deletePointGoods(原条目)
// classifyId 直传目标积分分组即归位；skuList 整体覆盖语义；台账断点续跑
// 用法: node 48-replace-points-goods.js [--sample] [--max=N] [--concurrency=3]
const fs = require('fs');
const path = require('path');
const { cfg, launch, login, post, isOk, sleep, PATHS } = require('./lib/common');

const EP_PL = 'mall/point/goods/queryPointGoodsListForManagement';
const EP_PD = 'mall/point/goods/queryPointGoodsDetailForManagement';
const EP_ADD = 'mall/point/goods/addPointGoods';
const EP_DEL = 'mall/point/goods/deletePointGoods';
const LEDGER = path.join(PATHS.BACKUP, '48-replace-ledger.json');
const MODE = process.argv.includes('--sample') ? 'sample' : 'batch';
const MAX = +(process.argv.find(a => a.startsWith('--max=')) || '--max=999').split('=')[1];
const CONC = +(process.argv.find(a => a.startsWith('--concurrency=')) || '--concurrency=3').split('=')[1];

(async () => {
  // 计划表：54-plan（源→复制体 SKU 映射 + 兑换值/分组），由只读取数脚本生成
  const pf = fs.readdirSync(PATHS.BACKUP).filter(x => x.startsWith('54-plan')).sort().pop();
  const { plan } = JSON.parse(fs.readFileSync(path.join(PATHS.BACKUP, pf), 'utf8'));
  const SKIP_DEL = new Set(); // 已删原条目的 srcId 填这里（只 add 不 del）
  let ledger = [];
  if (fs.existsSync(LEDGER)) ledger = JSON.parse(fs.readFileSync(LEDGER, 'utf8'));
  const done = new Set(ledger.filter(x => x.ok).map(x => x.srcId));
  let queue = plan.filter(p => !done.has(p.srcId));
  if (MODE === 'sample') queue = queue.slice(0, 1);
  else queue = queue.slice(0, MAX);
  console.log(`[${MODE}] 计划 ${plan.length} | 已完成 ${done.size} | 本块 ${queue.length}`);

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
  const basicInfo = T.body.basicInfo;

  const doOne = async P => {
    const ja = await post(page, cfg.BASE + '/api3/' + EP_ADD, {
      basicInfo, solutionType: 2, goodsId: P.newId,
      pickupSiteList: P.pickupSiteList || [], classifyId: P.classifyId,   // 直传归位
      priceType: P.priceType, exchangeTimeType: P.exchangeTimeType ?? 0,
      exchangeStartTime: P.exchangeStartTime, exchangeEndTime: P.exchangeEndTime,
      visibleInNonExchangeTime: P.visibleInNonExchangeTime ?? true,
      goodsLimitNum: P.goodsLimitNum, sort: P.sort ?? 0,
      applicablePeopleInfo: P.applicablePeopleInfo || { selectPeopleType: 1 },
      skuList: P.skus.map(s => ({ skuId: String(s.copySkuId), editChangeNum: s.editChangeNum, point: s.point, pointPrice: s.pointPrice, isPoint: s.isPoint })),
      i18n: { language: 'zh-CN', timezone: 8 },
      extendInfo: { refer: 'goods/pointsMall/editGoods', source: 80 },
    }, H);
    if (!isOk(ja)) throw new Error('add:' + JSON.stringify(ja).slice(0, 110));
    await sleep(350);
    const jd = await post(page, cfg.BASE + '/api3/' + EP_PD, { ...T.body, goodsId: P.newId, solutionType: 2 }, H);
    const det = isOk(jd) ? jd.data : null;
    if (!det || !(det.skuList || []).length) throw new Error('verify:详情空');
    const want = P.skus.map(s => `${s.point}/${s.pointPrice}/${s.editChangeNum}`).sort().join(',');
    const got = det.skuList.map(s => `${s.point}/${s.pointPrice}/${s.availableChangeNum}`).sort().join(',');
    if (want !== got) throw new Error(`verify:兑换值 ${got}≠${want}`);
    if (!det.pointClassifyInfo || det.pointClassifyInfo.pointClassifyId !== P.classifyId) throw new Error('verify:分组');
    if (det.priceType !== P.priceType || det.goodsLimitNum !== P.goodsLimitNum) throw new Error('verify:模式/限兑');
    if (!SKIP_DEL.has(P.srcId)) {
      const jdel = await post(page, cfg.BASE + '/api3/' + EP_DEL, {
        basicInfo, solutionType: 2, goodsIdList: [P.srcId],
        i18n: { language: 'zh-CN', timezone: 8 }, extendInfo: { refer: 'goods/pointsMall/index', source: 80 },
      }, H);
      if (!isOk(jdel)) throw new Error('del:' + JSON.stringify(jdel).slice(0, 110));
    }
  };

  let okCount = 0, failStreak = 0;
  const flush = () => fs.writeFileSync(LEDGER, JSON.stringify(ledger, null, 1), 'utf8');
  const worker = async wid => {
    while (queue.length && failStreak < 3) {
      const P = queue.shift();
      const t0 = Date.now();
      try {
        await doOne(P);
        okCount++; failStreak = 0;
        ledger.push({ srcId: P.srcId, newId: P.newId, ok: true, ms: Date.now() - t0, at: new Date().toISOString() });
        flush();
        if (okCount % 25 === 0) console.log(`[${new Date().toISOString().slice(11, 19)}] W${wid} ok=${okCount} | ${P.classifyName}`);
      } catch (e) {
        failStreak++;
        ledger.push({ srcId: P.srcId, newId: P.newId, ok: false, err: e.message.slice(0, 140), at: new Date().toISOString() });
        flush();
        console.log(`W${wid} 异常: ${P.srcId} | ${e.message.slice(0, 100)}`);
      }
    }
  };
  await Promise.all(Array.from({ length: CONC }, (_, i) => worker(i + 1)));
  console.log(`结束: ok=${okCount} failStreak=${failStreak} 台账=${ledger.length}`);
  await ctx.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
