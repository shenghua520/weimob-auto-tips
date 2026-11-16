// 47-copy-goods-reclassify.js — 复制商品并改入孪生（兑换）分组
// 复制是前端跳转预填(isCopy=true)，保存走 copyGoods；拦截 payload 只改 goodsClassifyList/goodsClassifyIdList
// 用法: node 47-copy-goods-reclassify.js [--max=N] [--concurrency=3]  台账断点续跑
const fs = require('fs');
const path = require('path');
const { cfg, launch, login, post, isOk, sleep, PATHS } = require('./lib/common');

const EP_LIST = 'mall/goods/queryGoodsListWithPageForManagement';
const EP_DET = 'mall/goods/queryGoodsDetail';
const EP_COPY = 'mall/goods/copyGoods';
const EP_CLS = 'mall/goods/classify/queryAllClassifyListForManagement';
const LEDGER = path.join(PATHS.BACKUP, '47-copy-ledger.json');
const MAX = +(process.argv.find(a => a.startsWith('--max=')) || '--max=999').split('=')[1];
const CONC = +(process.argv.find(a => a.startsWith('--concurrency=')) || '--concurrency=3').split('=')[1];
const FO = {
  querySelfPickupSiteShip: true, isQueryAppointmentTimeInfo: true,
  isQueryGoodsAbilitiesDetailInfo: true, isQueryPicInfo: true, isQueryVideoInfo: true,
  isQueryTagInfo: true, isQueryGoodsLimit: true, isQueryClassifyInfo: true,
  isQueryPropertyInfo: true, isQuerySaleInfo: true, isQueryCategoryInfo: true,
  isQueryBrandInfo: true, isQueryAttachInfo: true, isFilterDeleted: true,
  isQueryInvoiceConfig: true, isQueryGoodsStockInfo: true, isQueryGoodsPriceInfo: true,
  isQueryGoodsExtInfo: true, isQuerySetGoodsPriceInfo: true, isQuerySetGoodsSalesInfo: true,
  isQueryAutoOffline: true, isQueryAutoSell: true, isQuerySkuInfo: true,
  isQueryDescInfo: true, queryVidBizType: true,
};

(async () => {
  const ctx = await launch({ headless: true });
  const page = ctx.pages()[0] || await ctx.newPage();
  await login(page);
  const found = [];
  page.on('request', r => {
    const u = r.url();
    if (!u.includes('/api3/') || r.method() !== 'POST') return;
    const ep = u.replace(cfg.BASE + '/api3/', '').split('?')[0];
    if ([EP_LIST, EP_DET, EP_CLS].includes(ep)) {
      try { found.push({ ep, headers: r.headers(), body: JSON.parse(r.postData()) }); } catch {}
    }
  });
  await page.goto(cfg.BASE + '/bos/products/ecGoodsmanage/' + cfg.BOS_ID + '/' + cfg.KEY + '/goods/list', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(11000);
  const keep = ['authorization', 'apiclient', 'weimob-bosid', 'content-type', 'referer', 'source', 'tcode'];
  const pick = ep => {
    const h = found.filter(x => x.ep === ep).pop();
    if (!h) throw new Error('未捕获模板: ' + ep);
    const headers = {}; keep.forEach(k => { if (h.headers[k]) headers[k] = h.headers[k]; });
    return { headers, payload: h.body };
  };
  const L = pick(EP_LIST);
  const detBody = gid => ({ basicInfo: L.payload.basicInfo, solutionType: 2, goodsId: String(gid), filterOption: FO, i18n: { language: 'zh-CN', timezone: 8 }, extendInfo: { refer: 'goods/list', source: 80 } });

  // 源清单冻结：基线 512 goodsId（改前快照），滤掉已带后缀的
  const snap = JSON.parse(fs.readFileSync(path.join(PATHS.BACKUP, fs.readdirSync(PATHS.BACKUP).filter(x => x.startsWith('商品详情_原始快照')).sort().pop()), 'utf8'));
  const sources = snap.details.filter(d => !/（兑换）/.test(d.title || '')).map(d => ({ goodsId: d.goodsId, title: d.title }));
  // 孪生映射：原组名 -> 兑换组对象（按 classifyId，处理同名不同父）
  const cls = JSON.parse(fs.readFileSync(path.join(PATHS.BACKUP, fs.readdirSync(PATHS.BACKUP).filter(x => x.startsWith('商品分组_改后快照')).sort().pop()), 'utf8'));
  const origNodes = [], twinNodes = [];
  const walk = (list, parentId, parentName) => list.forEach(g => {
    const rec = { id: g.classifyId, name: g.name, parentId, parentName };
    (/（兑换）$/.test(g.name) ? twinNodes : origNodes).push(rec);
    walk(g.childClassifyList || [], g.classifyId, g.name);
  });
  walk(cls.response.data.goodsClassifyList, 0, '');
  const twinOfParent = new Map([[0, 0]]);
  origNodes.filter(n => n.parentId === 0).forEach(o => {
    const t = twinNodes.find(x => x.name === o.name + '（兑换）' && x.parentId === 0);
    if (t) twinOfParent.set(o.id, t.id);
  });
  const twinMap = new Map();
  origNodes.forEach(o => {
    const tp = twinOfParent.get(o.parentId);
    if (tp === undefined) return;
    const t = twinNodes.find(x => x.name === o.name + '（兑换）' && x.parentId === tp);
    if (t) twinMap.set(o.id, t);
  });
  console.log(`源 ${sources.length} | 孪生映射 ${twinMap.size}`);

  let ledger = [];
  if (fs.existsSync(LEDGER)) ledger = JSON.parse(fs.readFileSync(LEDGER, 'utf8'));
  const done = new Set(ledger.filter(x => x.ok).map(x => x.srcId));
  const queue = sources.filter(s => !done.has(s.goodsId)).slice(0, MAX);
  console.log(`已完成 ${done.size} | 本块 ${queue.length} | 并发 ${CONC}`);

  let okCount = 0, failStreak = 0;
  const flush = () => fs.writeFileSync(LEDGER, JSON.stringify(ledger, null, 1), 'utf8');
  const worker = async wid => {
    while (queue.length && failStreak < 3) {
      const S = queue.shift();
      const t0 = Date.now();
      try {
        const jd = await post(page, cfg.BASE + '/api3/' + EP_DET, detBody(S.goodsId), L.headers);
        if (!isOk(jd) || !jd.data) throw new Error('源详情失败');
        const src = jd.data;
        const targets = (src.goodsClassifyList || []).map(c => twinMap.get(c.classifyId)).filter(Boolean);
        if (!targets.length) throw new Error('无孪生组');
        const body = JSON.parse(JSON.stringify(src));
        body.goodsClassifyList = targets.map(t => ({ classifyId: t.id, name: t.name, parentId: t.parentId }));
        body.goodsClassifyIdList = targets.map(t => t.id);
        delete body.goodsId; delete body.skuList; // 新建语义
        const jc = await post(page, cfg.BASE + '/api3/' + EP_COPY, { ...body, basicInfo: L.payload.basicInfo, solutionType: 2, i18n: { language: 'zh-CN', timezone: 8 }, extendInfo: { refer: 'goods/editNoMenu', source: 80 } }, L.headers);
        if (!isOk(jc) || !jc.data || !jc.data.goodsId) throw new Error('copy:' + JSON.stringify(jc).slice(0, 100));
        okCount++; failStreak = 0;
        ledger.push({ srcId: S.goodsId, newId: jc.data.goodsId, ok: true, ms: Date.now() - t0, at: new Date().toISOString() });
        flush();
        if (okCount % 25 === 0) console.log(`[${new Date().toISOString().slice(11, 19)}] W${wid} ok=${okCount}`);
      } catch (e) {
        failStreak++;
        ledger.push({ srcId: S.goodsId, ok: false, err: e.message.slice(0, 140), at: new Date().toISOString() });
        flush();
        console.log(`W${wid} 异常: ${S.goodsId} ${String(S.title).slice(0, 14)} | ${e.message.slice(0, 100)}`);
      }
    }
  };
  await Promise.all(Array.from({ length: CONC }, (_, i) => worker(i + 1)));
  console.log(`结束: ok=${okCount} failStreak=${failStreak} 台账=${ledger.length}`);
  await ctx.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
