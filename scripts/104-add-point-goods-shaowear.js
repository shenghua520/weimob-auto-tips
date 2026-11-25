/**
 * 104 · 少儿穿戴商品加入积分商城（写操作）
 * 计划来源：.scan/shaowear_addpoint_plan.json（21 商品 / 100 SKU）
 * 口径：
 *   - 只加「有库存且未禁用」的 SKU，零库存商品一律不加（用户明确要求）
 *   - 可兑换数量 editChangeNum = 50（用户明确要求「书包兑换区库存都设置50 不要多」）
 *   - 每人限兑 goodsLimitNum = 1；priceType = 3（积分+金额）
 *   - point = 表格 S 列组合健康豆；pointPrice = 表格 R 列组合价格
 *   - classifyId 直传积分商城「少儿穿戴」分组 59464100397
 *   - 只新增（addPointGoods），绝不改原件商品
 * 模式：--dry / --sample / --apply
 * 写守卫：白名单仅 addPointGoods + deletePointGoods（回滚用），其余写接口 abort。
 */
const fs = require('fs');
const path = require('path');
const { cfg, launch, login, post, isOk, sleep, stamp, PATHS } = require('./lib/common');

const PLAN = path.resolve(__dirname, '../.scan/shaowear_addpoint_plan.json');
const EP_ADD = 'mall/point/goods/addPointGoods';
const EP_DEL = 'mall/point/goods/deletePointGoods';
const EP_PL = 'mall/point/goods/queryPointGoodsListForManagement';
const EP_PD = 'mall/point/goods/queryPointGoodsDetailForManagement';
const EP_GD = 'mall/goods/queryGoodsDetail';
const ALLOW = [EP_ADD, EP_DEL, EP_PL, EP_PD, EP_GD];
// 黑名单：精确端点名，禁止子串误伤
const BLOCK_EXACT = [
  'updatePointGoods', 'updatePointGoodsSort', 'moveGoodsToClassify',
  'addPointClassify', 'updatePointClassify', 'deletePointClassify',
  'batchUpdateGoodsSort', 'createAsyncStockTask', 'createInventoryOrder',
  'addGoodsClassify', 'deleteGoodsClassify', 'updateGoodsClassify',
  'deleteGoods', 'importRetailMerchantGoodsAndItem',
];
const mode = (process.argv.find(a => a.startsWith('--')) || '--dry').replace(/^--/, '');
const ts = stamp();
const BATCH = 20;

const save = (name, obj) => {
  const f = path.join(PATHS.BACKUP, `${name}_${ts}.json`);
  fs.writeFileSync(f, JSON.stringify(obj, null, 1), 'utf8');
  console.log('  已落盘:', path.basename(f));
  return f;
};

(async () => {
  const plan = JSON.parse(fs.readFileSync(PLAN, 'utf8'));
  console.log(`=== 少儿穿戴 上积分商城 [${mode}] ===`);
  console.log('计划:', plan.summary.goods, '个商品 /', plan.summary.sku, '个 SKU / 可兑', plan.summary.changeNum);

  const ctx = await launch({ headless: true });
  const page = ctx.pages()[0] || await ctx.newPage();
  page.setDefaultTimeout(60000);
  const log = { mode, startedAt: new Date().toISOString(), blocked: [], errors: [] };
  await page.route('**/api3/**', route => {
    const u = route.request().url();
    const ep = u.replace(`${cfg.BASE}/api3/`, '').split('?')[0];
    if (ALLOW.includes(ep)) return route.continue();
    // 精确端点匹配才拦，避免子串误伤
    if (BLOCK_EXACT.some(b => ep.endsWith(b) || ep === b)) { log.blocked.push(ep); return route.abort(); }
    return route.continue();
  });
  await login(page);

  const BASEURL = `${cfg.BASE}/bos/products/ecGoodsmanage/${cfg.BOS_ID}/${cfg.KEY}`;
  const keep = ['authorization', 'apiclient', 'weimob-bosid', 'content-type', 'referer', 'source', 'tcode'];

  // 抓积分商城页模板（拿 addPointGoods / 查询接口的请求头）
  const found = [];
  const onReq = r => {
    const u = r.url();
    if (!u.includes('/api3/') || r.method() !== 'POST') return;
    const ep = u.replace(cfg.BASE + '/api3/', '').split('?')[0];
    found.push({ ep, headers: r.headers(), body: r.postData() });
  };
  page.on('request', onReq);
  await page.goto(BASEURL + '/goods/pointsMall/index', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(11000);
  page.off('request', onReq);

  const hPL = found.filter(x => x.ep === EP_PL).pop();
  if (!hPL) throw new Error('未捕获积分列表模板');
  const H = {}; keep.forEach(k => { if (hPL.headers[k]) H[k] = hPL.headers[k]; });
  const PLbody = JSON.parse(hPL.body);
  console.log('模板已捕获');

  // 积分商城模板 body（basicInfo/extendInfo 等壳）
  const PLshell = PLbody;

  // 拉现网积分商品（判定"不多不少"用具体 ID 存在性）
  const listNow = async () => {
    const out = [];
    for (let p = 1; p <= 60; p++) {
      const j = await post(page, cfg.BASE + '/api3/' + EP_PL, { ...PLshell, pageNum: p, pageSize: 50 }, H);
      if (!isOk(j)) break;
      const l = (j.data && j.data.pageList) || [];
      out.push(...l);
      if (l.length < 50) break;
    }
    return out;
  };
  const before = await listNow();
  console.log('现网积分商品总数:', before.length);

  // 详情回读
  const readDetail = async gid => {
    const j = await post(page, cfg.BASE + '/api3/' + EP_PD, { ...PLshell, goodsId: gid }, H);
    return isOk(j) ? j.data : null;
  };

  // 商品详情取 skuId 与现网 SKU（校验 skuId 存在）
  const readGoodsDetail = async gid => {
    const j = await post(page, cfg.BASE + '/api3/' + EP_GD, { goodsId: gid, filterOption: { isQuerySkuInfo: true, isQueryGoodsStockInfo: true, isQueryGoodsPriceInfo: true, isQueryClassifyInfo: true } }, H);
    return isOk(j) ? j.data : null;
  };

  // 构造 addPointGoods body
  const buildBody = (row, template) => ({
    basicInfo: template.basicInfo,
    solutionType: 2,
    goodsId: row.goodsId,
    pickupSiteList: [],
    classifyId: row.classifyId,
    priceType: row.priceType,
    exchangeTimeType: 0,
    exchangeStartTime: null,
    exchangeEndTime: null,
    visibleInNonExchangeTime: true,
    goodsLimitNum: row.goodsLimitNum,
    sort: 0,
    applicablePeopleInfo: { selectPeopleType: 1, inApplicablePeopleTipInfo: { tips: '你暂无资格参加活动' } },
    skuList: row.skuList.map(s => ({
      skuId: s.skuId,
      editChangeNum: s.editChangeNum,
      point: s.point,
      pointPrice: s.pointPrice,
      isPoint: s.isPoint,
    })),
    i18n: { language: 'zh-CN', timezone: 8 },
    extendInfo: template.extendInfo,
  });

  const ledger = [];
  const doAdd = async (row) => {
    const body = buildBody(row, PLshell);
    const j = await post(page, cfg.BASE + '/api3/' + EP_ADD, body, H);
    const ok = isOk(j);
    const rec = { goodsId: row.goodsId, title: row.title, ok, errcode: j.errcode, errmsg: j.errmsg || '', skuCount: row.skuList.length };
    // 回读验证
    if (ok) {
      await sleep(600);
      const d = await readDetail(row.goodsId);
      if (d) {
        const skus = (d.skuList || []).map(s => ({
          skuId: s.skuId, point: s.point, pointPrice: s.pointPrice,
          changeNum: s.availableChangeNum, isPoint: s.isPoint,
        }));
        const want = row.skuList.map(s => ({ skuId: s.skuId, point: s.point, pointPrice: s.pointPrice, changeNum: s.editChangeNum }));
        let bad = 0;
        for (const w of want) {
          const got = skus.find(s => String(s.skuId) === String(w.skuId));
          if (!got) { bad++; continue; }
          if (Number(got.point) !== Number(w.point)) bad++;
          if (Math.abs(Number(got.pointPrice) - Number(w.pointPrice)) > 0.005) bad++;
          if (Number(got.changeNum) !== Number(w.changeNum)) bad++;
        }
        rec.readback = { found: !!d, skuRead: skus.length, mismatch: bad, classifyId: (d.pointClassifyInfo || {}).pointClassifyId, classifyName: (d.pointClassifyInfo || {}).name, priceType: d.priceType, goodsLimitNum: d.goodsLimitNum };
        rec.ok = bad === 0;
      } else {
        rec.readback = { found: false };
        rec.ok = false;
      }
    }
    ledger.push(rec);
    return rec;
  };

  const doDelete = async gid => {
    // body 需带 basicInfo/solutionType/i18n/extendInfo（docs/18 + 96 脚本实测口径）
    const j = await post(page, cfg.BASE + '/api3/' + EP_DEL, {
      basicInfo: PLshell.basicInfo, solutionType: 2, goodsIdList: [gid],
      i18n: { language: 'zh-CN', timezone: 8 },
      extendInfo: PLshell.extendInfo || { refer: 'goods/pointsMall/index', source: 80 },
    }, H);
    if (!isOk(j)) console.log('  删除失败:', JSON.stringify(j).slice(0, 200));
    return isOk(j);
  };

  if (mode === 'dry') {
    console.log('\n=== 计划预览(不写) ===');
    plan.rows.forEach(r => {
      const tiers = {};
      r.skuList.forEach(s => { const k = `${s.pointPrice}元+${s.point}豆`; tiers[k] = (tiers[k] || 0) + 1; });
      console.log(`  gid=${r.goodsId} SKU${r.liveSkuCount} 档位${JSON.stringify(tiers)} | ${r.title.slice(0, 30)}`);
    });
    console.log('\nDRY 完成，未写入任何数据。守卫拦截:', log.blocked.length);
    await ctx.close();
    return;
  }

  if (mode === 'sample') {
    // 小样：取 1 个多SKU商品 + 1 个单档商品
    const picks = [plan.rows.find(r => r.liveSkuCount >= 4) || plan.rows[0], plan.rows[plan.rows.length - 1]];
    console.log('\n=== 小样 ===');
    for (const row of picks) {
      const rec = await doAdd(row);
      console.log(`  加 ${row.goodsId} SKU${row.liveSkuCount}: ok=${rec.ok} 回读=${JSON.stringify(rec.readback)}`);
    }
    console.log('\n=== 小样回滚 ===');
    for (const row of picks) {
      const d = await readDetail(row.goodsId);
      if (d) {
        const del = await doDelete(row.goodsId);
        console.log(`  删 ${row.goodsId}: ${del}`);
        await sleep(600);
        const d2 = await readDetail(row.goodsId);
        console.log(`  回读确认已移除: ${!d2 || !(d2.skuList || []).length ? 'YES' : 'NO (仍有残留)'}`);
      }
    }
    const after = await listNow();
    console.log('\n小样后积分商品总数:', after.length, '(基线', before.length + ')');
    save(`104-sample-ledger_${mode}`, { mode, baseline: before.length, ledger, after: after.length, blocked: log.blocked });
    console.log('RESULT', ledger.every(x => x.ok) ? 'PASS' : 'FAIL');
    await ctx.close();
    return;
  }

  if (mode === 'apply') {
    console.log('\n=== 批量写入 ===');
    let fail = 0;
    for (let i = 0; i < plan.rows.length; i += BATCH) {
      const chunk = plan.rows.slice(i, i + BATCH);
      console.log(`\n批次 ${Math.floor(i / BATCH) + 1}/${Math.ceil(plan.rows.length / BATCH)} (${chunk.length} 个商品)`);
      for (const row of chunk) {
        const rec = await doAdd(row);
        console.log(`  ${rec.ok ? 'OK  ' : 'FAIL'} gid=${row.goodsId} SKU${row.liveSkuCount} ${rec.ok ? '' : JSON.stringify(rec.readback || rec.errmsg)} | ${row.title.slice(0, 24)}`);
        if (!rec.ok) fail++;
        await sleep(300);
      }
      if (fail > 3) { console.log('  失败超阈值，中止'); break; }
      await sleep(1200);
    }
    const after = await listNow();
    const idsBefore = new Set(before.map(x => String(x.goodsId)));
    const idsAfter = new Set(after.map(x => String(x.goodsId)));
    const added = [...idsAfter].filter(x => !idsBefore.has(x));
    const removed = [...idsBefore].filter(x => !idsAfter.has(x));
    const wantIds = plan.rows.map(r => String(r.goodsId));
    const missing = wantIds.filter(x => !idsAfter.has(x));
    const extra = added.filter(x => !wantIds.includes(x));
    const summary = {
      mode, baseline: before.length, after: after.length,
      planGoods: plan.rows.length, planSku: plan.summary.sku,
      ledgerOk: ledger.filter(x => x.ok).length, ledgerFail: ledger.filter(x => !x.ok).length,
      addedCount: added.length, addedIds: added,
      removedCount: removed.length, removedIds: removed,
      missingTargets: missing, extraAdded: extra,
      blocked: log.blocked.length,
    };
    log.summary = summary;
    save('104-addpoint-ledger_apply', { ...log, ledger });
    console.log('\n[汇总]', JSON.stringify(summary, null, 1));
    console.log('RESULT', (ledger.every(x => x.ok) && !missing.length && !extra.length && !removed.length) ? 'PASS' : 'FAIL');
    await ctx.close();
    return;
  }

  console.log('未知模式:', mode);
  await ctx.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
