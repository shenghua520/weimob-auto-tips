/**
 * 95 · 体育用品积分商城改价 + 新增（表格改后值回写微盟）
 * 严格七步法: --sample(小样,写完自动回滚) / --apply(批量)
 *   --part=update|add|all
 * 改价: updatePointGoods (SKU级 point/pointPrice 整体覆盖, 显式带回防重置字段)
 * 新增: addPointGoods (兑换版商品加入积分商城 体育用品组59473100397)
 * 只信后台回读值; 失败>3中止; 逐条台账断点续跑
 */
const fs = require('fs');
const path = require('path');
const { cfg, launch, login, post, isOk, sleep, stamp, PATHS } = require('./lib/common');

const R = `${cfg.BASE}/bos/products/ecGoodsmanage/${cfg.BOS_ID}/${cfg.KEY}`;
const POINTS_URL = `${R}/goods/pointsMall/index`;
const EP = {
  list: 'mall/point/goods/queryPointGoodsListForManagement',
  detail: 'mall/point/goods/queryPointGoodsDetailForManagement',
  update: 'mall/point/goods/updatePointGoods',
  add: 'mall/point/goods/addPointGoods',
};
// 写守卫: 除了本次允许的写接口, 其余全 abort
const WRITE_ALLOW = ['updatePointGoods', 'addPointGoods'];
// 精确端点名(用 endsWith 匹配, 不含路径片段, 避免子串误伤)
const WRITE_BLOCK = [
  'deletePointGoods', 'updatePointGoodsSort', 'moveGoodsToClassify',
  'addPointClassify', 'updatePointClassify', 'deletePointClassify',
  'deleteGoods', 'updateGoods', 'importGoods', 'batchUpdateGoodsSort',
  'point/goods/save', 'point/goods/batch', 'deleteMaterial',
];
const KEEP = ['authorization', 'apiclient', 'weimob-bosid', 'content-type', 'referer', 'source', 'tcode'];
const SCAN = path.resolve(__dirname, '../.scan');
const PLAN = JSON.parse(fs.readFileSync(path.join(SCAN, 'price_plan2.json'), 'utf8'));
const ROLLBACK = JSON.parse(fs.readFileSync(path.join(SCAN, 'price_rollback2.json'), 'utf8'));
const MODE = process.argv.includes('--sample') ? 'sample' : (process.argv.includes('--apply') ? 'apply' : 'dry');
const PART = (process.argv.find(a => a.startsWith('--part=')) || '--part=all').split('=')[1];
const ts = stamp();
const LEDGER_U = path.join(PATHS.BACKUP, `95-update-ledger_${ts}.json`);
const LEDGER_A = path.join(PATHS.BACKUP, `95-add-ledger_${ts}.json`);

const numEq = (a, b) => Math.abs(Number(a) - Number(b)) < 0.06;

(async () => {
  console.log(`=== 积分商城改价+新增 [${MODE}] part=${PART} ===`);
  const ctx = await launch({ headless: true });
  const page = ctx.pages()[0] || await ctx.newPage();
  page.setDefaultTimeout(60000);
  const blocked = [];
  const rollbackDeleteGids = new Set();  // 回滚删除白名单
  await page.route('**/api3/**', route => {
    const u = route.request().url();
    const ep = u.replace(cfg.BASE + '/api3/', '').split('?')[0];
    // 白名单优先: 本次明确允许的写端点直接放行(避免模糊子串误伤)
    if (WRITE_ALLOW.some(b => ep.endsWith(b))) return route.continue();
    // 回滚删除: 仅放行已登记在回滚白名单的goodsId
    if (ep.endsWith('deletePointGoods')) {
      try { const b = JSON.parse(route.request().postData()); if (b.goodsIdList && b.goodsIdList.every(g => rollbackDeleteGids.has(g))) return route.continue(); } catch(e){}
      console.log('  [守卫ABORT非法删除]', JSON.stringify(route.request().postData()).slice(0,120)); return route.abort();
    }
    // 端点级精确黑名单
    if (WRITE_BLOCK.some(b => ep.endsWith(b))) { blocked.push(u); console.log('  [守卫ABORT]', ep); return route.abort(); }
    return route.continue();
  });
  await login(page);

  // 捕获列表XHR模板(取 basicInfo + headers)
  const found = [];
  const onReq = r => {
    const u = r.url();
    if (!u.includes('/api3/')) return;
    found.push({ ep: u.replace(`${cfg.BASE}/api3/`, '').split('?')[0], headers: r.headers(), body: r.postData() });
  };
  page.on('request', onReq);
  await page.goto(POINTS_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(9000);
  page.off('request', onReq);
  const Tlist = found.filter(x => x.ep === EP.list).pop();
  if (!Tlist) throw new Error('未捕获列表模板');
  const H = {};
  KEEP.forEach(k => { if (Tlist.headers[k]) H[k] = Tlist.headers[k]; });
  const basicInfo = Tlist.body ? (JSON.parse(Tlist.body).basicInfo || {}) : {};
  const api = ep => `${cfg.BASE}/api3/${ep}`;
  const call = async (ep, body) => {
    let j;
    try { j = await post(page, api(ep), body, H); }
    catch (e) { console.log('  [call异常]', ep, 'headers=', JSON.stringify(H).slice(0,400), 'body=', JSON.stringify(body).slice(0,300), 'ERR=', e.message.slice(0,150)); throw e; }
    if (!isOk(j)) throw new Error(ep + ':' + JSON.stringify(j).slice(0, 200));
    return j.data;
  };

  // ============ 改价函数 ============
  const doUpdate = async (u, verifyOnly = false) => {
    const rb = ROLLBACK[String(u.goodsId)];
    if (!rb) throw new Error('无回滚快照 gid=' + u.goodsId);
    // 构造 skuList: 目标价 + 原可兑数量/是否积分SKU 显式带回(防重置)
    const targetMap = {};
    u.sku_list.forEach(s => { targetMap[String(s.skuId)] = s; });
    const skuList = rb.skuList.map(s => {
      const t = targetMap[String(s.skuId)];
      if (!t) throw new Error('SKU不匹配 ' + s.skuId);
      return {
        skuId: s.skuId,
        editChangeNum: s.editChangeNum,   // 可兑数量原样带回
        point: u.target_point,            // 目标豆数(商品级统一)
        pointPrice: u.target_pointPrice,  // 目标现金
        isPoint: s.isPoint,               // 是否积分SKU原样
      };
    });
    const gd = rb.guard;
    const body = {
      basicInfo, solutionType: 2, goodsId: u.goodsId,
      classifyId: gd.classifyId, priceType: gd.priceType,
      goodsLimitNum: gd.goodsLimitNum,
      exchangeTimeType: gd.exchangeTimeType,
      exchangeStartTime: gd.exchangeStartTime, exchangeEndTime: gd.exchangeEndTime,
      visibleInNonExchangeTime: gd.visibleInNonExchangeTime,
      skuList,
      i18n: { language: 'zh-CN', timezone: 8 },
      extendInfo: { refer: 'goods/pointsMall/editGoods', source: 80 },
    };
    if (!verifyOnly) await call(EP.update, body);
    await sleep(300);
    // 回读详情验证
    const d = await call(EP.detail, { ...(Tlist.body ? JSON.parse(Tlist.body) : {}), goodsId: u.goodsId, solutionType: 2 });
    // 三查
    const gotSkus = d.skuList || [];
    for (const s of gotSkus) {
      if (!numEq(s.point, u.target_point) || !numEq(s.pointPrice, u.target_pointPrice))
        throw new Error(`verify价格不符 sku${s.skuId}: ${s.point}/${s.pointPrice} ≠ ${u.target_point}/${u.target_pointPrice}`);
    }
    if (d.priceType !== gd.priceType) throw new Error('verify:priceType被冲');
    if (d.goodsLimitNum !== gd.goodsLimitNum) throw new Error('verify:限兑被冲');
    if (d.pointClassifyInfo && d.pointClassifyInfo.pointClassifyId !== gd.classifyId) throw new Error('verify:分组被冲');
    if (numEq(d.sort, gd.sort) === false) throw new Error('verify:sort被冲 ' + d.sort + '≠' + gd.sort);
    for (const s of gotSkus) {
      const orig = rb.skuList.find(o => String(o.skuId) === String(s.skuId));
      if (orig && s.availableChangeNum !== orig.editChangeNum) throw new Error('verify:可兑数量被冲 ' + s.skuId);
    }
    return { goodsId: u.goodsId, skuCount: gotSkus.length, ok: true };
  };

  // ============ 新增函数 ============
  const doAdd = async (a, verifyOnly = false) => {
    const skuList = a.skuTargets.map(t => ({
      skuId: t.skuId, editChangeNum: 999, point: t.point, pointPrice: t.pointPrice, isPoint: true,
    }));
    const body = {
      basicInfo, solutionType: 2, goodsId: a.goodsId,
      pickupSiteList: [], classifyId: a.pointClassifyId,
      priceType: 3, exchangeTimeType: 0, exchangeStartTime: null, exchangeEndTime: null,
      visibleInNonExchangeTime: true, goodsLimitNum: 1, sort: 0,
      applicablePeopleInfo: { selectPeopleType: 1 },
      skuList,
      i18n: { language: 'zh-CN', timezone: 8 },
      extendInfo: { refer: 'goods/pointsMall/editGoods', source: 80 },
    };
    if (!verifyOnly) await call(EP.add, body);
    await sleep(350);
    const d = await call(EP.detail, { ...(Tlist.body ? JSON.parse(Tlist.body) : {}), goodsId: a.goodsId, solutionType: 2 });
    const gotSkus = d.skuList || [];
    if (gotSkus.length !== skuList.length) throw new Error('verify:SKU数不符 ' + gotSkus.length + '≠' + skuList.length);
    const want = a.skuTargets.map(t => `${t.point}/${t.pointPrice}`).sort().join(',');
    const got = gotSkus.map(s => `${s.point}/${s.pointPrice}`).sort().join(',');
    if (want !== got) throw new Error('verify:兑换值 ' + got + '≠' + want);
    if (!d.pointClassifyInfo || d.pointClassifyInfo.pointClassifyId !== a.pointClassifyId) throw new Error('verify:分组');
    if (d.priceType !== 3 || d.goodsLimitNum !== 1) throw new Error('verify:模式/限购 ' + d.priceType + '/' + d.goodsLimitNum);
    // 可兑数量(库存)必须是999 (读字段 availableChangeNum, 与写字段 editChangeNum 不同名)
    for (const s of gotSkus) {
      if (s.availableChangeNum !== 999) throw new Error('verify:可兑数量 ' + s.skuId + '=' + s.availableChangeNum + '≠999');
    }
    return { goodsId: a.goodsId, code: a.code, skuCount: gotSkus.length, ok: true };
  };

  // 回滚函数
  const rollbackUpdate = async (u) => {
    const rb = ROLLBACK[String(u.goodsId)];
    const gd = rb.guard;
    const skuList = rb.skuList.map(s => ({ skuId: s.skuId, editChangeNum: s.editChangeNum,
      point: s.point, pointPrice: s.pointPrice, isPoint: s.isPoint }));
    await call(EP.update, {
      basicInfo, solutionType: 2, goodsId: u.goodsId, classifyId: gd.classifyId,
      priceType: gd.priceType, goodsLimitNum: gd.goodsLimitNum,
      exchangeTimeType: gd.exchangeTimeType, exchangeStartTime: gd.exchangeStartTime,
      exchangeEndTime: gd.exchangeEndTime, visibleInNonExchangeTime: gd.visibleInNonExchangeTime,
      skuList, i18n: { language: 'zh-CN', timezone: 8 },
      extendInfo: { refer: 'goods/pointsMall/editGoods', source: 80 },
    });
  };
  const rollbackAdd = async (a) => {
    // 登记到回滚删除白名单, 让守卫放行这次恢复原状的删除
    rollbackDeleteGids.add(a.goodsId);
    const j = await post(page, api('mall/point/goods/deletePointGoods'), {
      basicInfo, solutionType: 2, goodsIdList: [a.goodsId],
      i18n: { language: 'zh-CN', timezone: 8 },
      extendInfo: { refer: 'goods/pointsMall/index', source: 80 },
    }, H);
    if (!isOk(j)) console.log('  [回滚删除警告]', a.goodsId, JSON.stringify(j).slice(0, 120));
  };

  // ================= 执行 =================
  let lu = [], la = [];
  if (MODE === 'sample') {
    console.log('\n--- 小样模式 (写完自动回滚) ---');
    if (PART === 'update' || PART === 'all') {
      const u = PLAN.update.find(x => x.sku_list.length >= 2) || PLAN.update[0];  // 边界型: 多SKU
      console.log('改价小样:', u.title, 'goodsId', u.goodsId, '目标', u.target_point + '豆/' + u.target_pointPrice + '元');
      const r = await doUpdate(u);
      console.log('  回读三查 PASS:', JSON.stringify(r));
      await rollbackUpdate(u);
      console.log('  已自动回滚 (线上零残留)');
    }
    if (PART === 'add' || PART === 'all') {
      const a = PLAN.add[0];
      console.log('新增小样:', a.title, 'goodsId', a.goodsId);
      const r = await doAdd(a);
      console.log('  回读三查 PASS:', JSON.stringify(r));
      await rollbackAdd(a);
      console.log('  已自动回滚 (线上零残留)');
    }
  } else if (MODE === 'apply') {
    console.log('\n--- 批量模式 ---');
    // 断点续跑: 读已完成台账
    if (fs.existsSync(LEDGER_U)) lu = JSON.parse(fs.readFileSync(LEDGER_U, 'utf8'));
    if (fs.existsSync(LEDGER_A)) la = JSON.parse(fs.readFileSync(LEDGER_A, 'utf8'));
    const doneU = new Set(lu.filter(x => x.ok).map(x => x.goodsId));
    const doneA = new Set(la.filter(x => x.ok).map(x => x.goodsId));
    const flushU = () => fs.writeFileSync(LEDGER_U, JSON.stringify(lu, null, 1), 'utf8');
    const flushA = () => fs.writeFileSync(LEDGER_A, JSON.stringify(la, null, 1), 'utf8');
    let failStreak = 0;
    const BATCH = 20;
    if (PART === 'update' || PART === 'all') {
      const queue = PLAN.update.filter(x => !doneU.has(x.goodsId));
      console.log(`改价: 总${PLAN.update.length} 已完成${doneU.size} 本轮${queue.length}`);
      for (let i = 0; i < queue.length; i += BATCH) {
        const chunk = queue.slice(i, i + BATCH);
        for (const u of chunk) {
          try {
            const r = await doUpdate(u);
            lu.push({ ...r, ok: true, at: new Date().toISOString() }); flushU();
            failStreak = 0;
          } catch (e) {
            failStreak++;
            lu.push({ goodsId: u.goodsId, ok: false, err: e.message.slice(0, 160), at: new Date().toISOString() }); flushU();
            console.log('  改价异常:', u.goodsId, e.message.slice(0, 100));
            if (failStreak > 3) { console.log('  !! 连续失败>3, 中止'); break; }
          }
        }
        console.log(`  改价批次 ${i + chunk.length}/${queue.length} 完成`);
        if (failStreak > 3) break;
        await sleep(800);
      }
    }
    if (PART === 'add' || PART === 'all') {
      const queue = PLAN.add.filter(x => !doneA.has(x.goodsId));
      console.log(`新增: 总${PLAN.add.length} 已完成${doneA.size} 本轮${queue.length}`);
      for (let i = 0; i < queue.length; i += BATCH) {
        const chunk = queue.slice(i, i + BATCH);
        for (const a of chunk) {
          try {
            const r = await doAdd(a);
            la.push({ ...r, ok: true, at: new Date().toISOString() }); flushA();
            failStreak = 0;
          } catch (e) {
            failStreak++;
            la.push({ goodsId: a.goodsId, code: a.code, ok: false, err: e.message.slice(0, 160), at: new Date().toISOString() }); flushA();
            console.log('  新增异常:', a.goodsId, e.message.slice(0, 100));
            if (failStreak > 3) { console.log('  !! 连续失败>3, 中止'); break; }
          }
        }
        console.log(`  新增批次 ${i + chunk.length}/${queue.length} 完成`);
        if (failStreak > 3) break;
        await sleep(800);
      }
    }
    console.log('批量结束: 改价ok=', lu.filter(x => x.ok).length, ' 新增ok=', la.filter(x => x.ok).length, ' failStreak=', failStreak);
  } else {
    console.log('\n--- dry模式: 仅展示计划, 不写 ---');
    console.log('改价', PLAN.update.length, '个 / 新增', PLAN.add.length, '个 (加 --sample 或 --apply 执行)');
  }
  console.log('守卫拦截写请求数:', blocked.length);
  await ctx.close();
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
