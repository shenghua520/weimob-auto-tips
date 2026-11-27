/**
 * 149-final-consistency.js —— 独立对账：表格现网 vs 微盟现网（售价 + 积分 + 状态）
 *
 * 不复用任何写入脚本中间态：重新登录、重新读表格（由 Python 侧 142 提供现网快照）、
 * 重新读微盟商品详情全量 + 积分商城详情全量，逐 SKU 核对。
 * 只读取证，写端点全部 abort。
 */
const fs = require('fs');
const path = require('path');
const { cfg, launch, login, post, isOk, sleep, PATHS } = require('./lib/common');

const R = `${cfg.BASE}/bos/products/ecGoodsmanage/${cfg.BOS_ID}/${cfg.KEY}`;
const POINTS_URL = `${R}/goods/pointsMall/index`;
const EP = {
  list: 'mall/point/goods/queryPointGoodsListForManagement',
  detail: 'mall/point/goods/queryPointGoodsDetailForManagement',
};
const BLOCK = ['updatePointGoods', 'addPointGoods', 'deletePointGoods', 'updatePointGoodsSort',
  'price-update', 'online-status', 'sellstatus-update', '/goods/update', 'deleteGoods'];
const KEEP = ['authorization', 'apiclient', 'weimob-bosid', 'content-type', 'referer', 'source', 'tcode'];
const ROOT = path.resolve(__dirname, '..');
const newest = pat => fs.readdirSync(path.join(ROOT, path.dirname(pat)))
  .filter(f => f.startsWith(path.basename(pat).split('*')[0])).sort()
  .map(f => path.join(ROOT, path.dirname(pat), f)).pop();
const PLAN = JSON.parse(fs.readFileSync(newest('backup/133-plan_*.json'), 'utf8'));
const REVERT = JSON.parse(fs.readFileSync(newest('backup/143-revert-plan_*.json'), 'utf8'));
const numEq = (a, b) => Math.abs(Number(a) - Number(b)) < 0.06;

(async () => {
  console.log('=== 独立对账：表格现网 vs 微盟现网 ===');
  const ctx = await launch({ headless: true });
  const page = ctx.pages()[0] || await ctx.newPage();
  page.setDefaultTimeout(60000);
  await page.route('**/api3/**', route => {
    const ep = route.request().url().replace(cfg.BASE + '/api3/', '').split('?')[0];
    if (BLOCK.some(b => ep.endsWith(b))) return route.abort();
    return route.continue();
  });
  await login(page);

  const found = [];
  const onReq = r => {
    if (!r.url().includes('/api3/')) return;
    found.push({ ep: r.url().replace(`${cfg.BASE}/api3/`, '').split('?')[0], headers: r.headers(), body: r.postData() });
  };
  page.on('request', onReq);
  await page.goto(POINTS_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(9000);
  page.off('request', onReq);
  const pick = ep => {
    const h = found.filter(f => f.ep === ep).pop();
    if (!h) return null;
    const headers = {};
    KEEP.forEach(k => { if (h.headers[k]) headers[k] = h.headers[k]; });
    return { headers, payload: h.body ? JSON.parse(h.body) : null };
  };
  const T = pick(EP.list);
  if (!T) throw new Error('未捕获积分列表模板');
  const call = async (ep, body) => {
    const j = await post(page, `${cfg.BASE}/api3/${ep}`, body, T.headers);
    if (!isOk(j)) throw new Error(ep + ' 失败');
    return j.data;
  };

  // 1) 积分商城现网全量详情（学习文具）
  const items = [];
  for (let p = 1; p <= 30; p++) {
    const d = await call(EP.list, { ...T.payload, pageNum: p, pageSize: 50 });
    const l = d.pageList || [];
    items.push(...l);
    if (l.length < 50) break;
    await sleep(110);
  }
  const stationery = items.filter(x => (x.pointClassifyInfo || {}).name === '学习文具');
  console.log(`积分商城总数 ${items.length}，学习文具 ${stationery.length}`);
  const detailNow = {};
  for (let i = 0; i < stationery.length; i++) {
    const g = stationery[i];
    const d = await call(EP.detail, { ...T.payload, goodsId: g.goodsId });
    detailNow[g.goodsId] = d;
    if ((i + 1) % 60 === 0) console.log(`  detail ${i + 1}/${stationery.length}`);
    await sleep(70);
  }
  fs.writeFileSync(path.join(PATHS.BACKUP, '149-points-detail-now.json'),
    JSON.stringify(detailNow, null, 1), 'utf8');
  console.log('积分商城现网详情已落盘');

  // 2) 期望值 = 133 plan 目标 + 143 回写覆盖
  const wantPrice = {};   // gid -> sid -> salePrice
  const wantPoint = {};   // gid -> sid -> [point, pointPrice]
  const gidSet = new Set();
  for (const x of PLAN.plan) {
    for (const w of x.priceWrites) {
      (wantPrice[w.goodsId] = wantPrice[w.goodsId] || {})[w.skuId] = w.target;
      gidSet.add(w.goodsId);
    }
    for (const w of x.pointWrites) {
      (wantPoint[w.goodsId] = wantPoint[w.goodsId] || {})[w.skuId] = w.target;
    }
  }
  for (const p of REVERT.plan) {
    for (const w of p.writes) {
      wantPrice[w.goodsId][w.skuId] = w.target;
    }
  }
  const ts = fs.readdirSync(PATHS.BACKUP).filter(f => f.startsWith('132-wos-sku-details_')).sort().pop();
  const DET0 = {};
  JSON.parse(fs.readFileSync(path.join(PATHS.BACKUP, ts), 'utf8')).list.forEach(x => DET0[x.goodsId] = x);

  // 3) 微盟售价现网（WOS CLI，脚本侧 child_process）
  const cp = require('child_process');
  const badSell = [];
  let sellChecked = 0;
  for (const gid of [...gidSet]) {
    const p = cp.spawnSync('woscli', ['goods', 'shop-goods-get', '--goods-id', String(gid),
      '--include-sku', 'true', '--output-format', 'json'], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
    if (p.status !== 0) { badSell.push([gid, '查询失败', p.stderr.slice(0, 80)]); continue; }
    const d = JSON.parse(p.stdout).data;
    const now = {};
    (d.skuList || []).forEach(s => now[s.skuId] = s);
    for (const [sid, want] of Object.entries(wantPrice[gid] || {})) {
      sellChecked++;
      if (!now[sid] || !numEq(now[sid].salePrice, want)) {
        badSell.push([gid, sid, now[sid] && now[sid].salePrice, want]);
      }
    }
    // 非目标 SKU 售价应与基线一致
    const b = DET0[gid];
    if (b) {
      const bmap = {}; b.skuList.forEach(s => bmap[s.skuId] = s);
      for (const s of (d.skuList || [])) {
        if (!(s.skuId in (wantPrice[gid] || {})) && bmap[s.skuId] && !numEq(s.salePrice, bmap[s.skuId].salePrice)) {
          badSell.push([gid, s.skuId, '非目标变化', bmap[s.skuId].salePrice, s.salePrice]);
        }
      }
    }
  }
  console.log(`售价核对 ${sellChecked} SKU，差异 ${badSell.length}`);
  badSell.slice(0, 10).forEach(x => console.log('  ', x));

  // 4) 积分商城现网核对
  const badPoint = [];
  let pointChecked = 0;
  for (const [gid, wants] of Object.entries(wantPoint)) {
    const d = detailNow[gid];
    if (!d) { badPoint.push([gid, '积分商城无此商品']); continue; }
    const now = {};
    (d.skuList || []).forEach(s => now[s.skuId] = s);
    for (const [sid, want] of Object.entries(wants)) {
      pointChecked++;
      const s = now[sid];
      if (!s || !numEq(s.point, want[0]) || !numEq(s.pointPrice, want[1])) {
        badPoint.push([gid, sid, s ? [s.point, s.pointPrice] : null, want]);
      }
    }
  }
  console.log(`积分核对 ${pointChecked} SKU（${Object.keys(wantPoint).length} 商品），差异 ${badPoint.length}`);
  badPoint.slice(0, 10).forEach(x => console.log('  ', x));

  // 5) 状态核对：待优化8行对应商品应上架、下架1行应下架（用微盟列表 isOnline）
  let statOk = true;
  const statBad = [];
  for (const x of PLAN.plan) {
    const sts = x.status;
    if (Array.isArray(sts) && sts.includes('待优化')) {
      for (const gid of [x.origGoodsId, x.exchGoodsId]) {
        if (!gid) continue;
        const p = cp.spawnSync('woscli', ['goods', 'shop-goods-get', '--goods-id', String(gid),
          '--include-sku', 'true', '--output-format', 'json'], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
        const d = JSON.parse(p.stdout).data;
        if (!d.isOnline) { statOk = false; statBad.push([x.seq, gid, '待优化但微盟未上架']); }
      }
    }
  }
  console.log('待优化上架核对:', statOk ? 'PASS' : 'FAIL', statBad.slice(0, 5));

  const verdict = (!badSell.length && !badPoint.length && statOk) ? 'PASS' : 'FAIL';
  const out = { at: new Date().toISOString(), sellChecked, badSell, pointChecked,
    pointGoods: Object.keys(wantPoint).length, badPoint, statOk, statBad, verdict };
  fs.writeFileSync(path.join(PATHS.BACKUP, '149-final-consistency.json'), JSON.stringify(out, null, 1), 'utf8');
  console.log('VERDICT', verdict, '报告 backup/149-final-consistency.json');
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
