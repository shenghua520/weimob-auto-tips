/**
 * 108 · 积分商城排序写入：少儿穿戴组（docs/19 规则）
 * 专用接口 updatePointGoodsSort —— 只改 sort 单字段，天然不碰价格/分组/限购/库存。
 * 计划来源：backup/107-sort-plan-shaowear_*.json
 * 模式：--dry / --sample / --apply
 * 小样：取边界样本（组首/组尾/二级分组交界）→ 回读三查 → 自动回滚 → 独立回读确认恢复
 */
const fs = require('fs');
const path = require('path');
const { cfg, launch, login, post, isOk, sleep, stamp, PATHS } = require('./lib/common');

const EP_PL = 'mall/point/goods/queryPointGoodsListForManagement';
const EP_SORT = 'mall/point/goods/updatePointGoodsSort';
const ALLOW = [EP_PL, EP_SORT];
// 黑名单精确端点名（endsWith），避免子串误伤 updatePointGoodsSort
const BLOCK_EXACT = ['updatePointGoods', 'moveGoodsToClassify', 'addPointGoods', 'deletePointGoods',
  'addPointClassify', 'updatePointClassify', 'deletePointClassify', 'batchUpdateGoodsSort',
  'addGoodsClassify', 'deleteGoodsClassify', 'updateGoodsClassify', 'createAsyncStockTask', 'createInventoryOrder'];
const mode = (process.argv.find(a => a.startsWith('--')) || '--dry').replace(/^--/, '');
const ts = stamp();
const BATCH = 15;

const planFiles = fs.readdirSync(PATHS.BACKUP).filter(f => f.startsWith('107-sort-plan-shaowear_') && f.endsWith('.json')).sort();
if (!planFiles.length) throw new Error('找不到排序方案文件');
const PLAN = JSON.parse(fs.readFileSync(path.join(PATHS.BACKUP, planFiles[planFiles.length - 1]), 'utf8'));
console.log('方案文件:', planFiles[planFiles.length - 1]);

const save = (name, obj) => {
  const f = path.join(PATHS.BACKUP, `${name}_${ts}.json`);
  fs.writeFileSync(f, JSON.stringify(obj, null, 1), 'utf8');
  console.log('  已落盘:', path.basename(f));
};

(async () => {
  console.log(`=== 少儿穿戴 积分商城排序 [${mode}] ===`);
  console.log('计划:', PLAN.summary.targetCount, '个商品 | 新sort范围', JSON.stringify(PLAN.summary.newSortRange));

  const ctx = await launch({ headless: true });
  const page = ctx.pages()[0] || await ctx.newPage();
  page.setDefaultTimeout(60000);
  const log = { mode, startedAt: new Date().toISOString(), blocked: [], errors: [] };
  await page.route('**/api3/**', route => {
    const u = route.request().url();
    const ep = u.replace(`${cfg.BASE}/api3/`, '').split('?')[0];
    if (ALLOW.includes(ep)) return route.continue();
    if (BLOCK_EXACT.some(b => ep.endsWith(b) || ep === b)) { log.blocked.push(ep); return route.abort(); }
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
  console.log('现网积分商品总数:', before.length);

  const writeSort = async (p) => {
    const body = {
      basicInfo: shell.basicInfo, solutionType: 2,
      goodsId: p.goodsId, pointClassifyId: p.pointClassifyId, sort: p.newSort,
      i18n: { language: 'zh-CN', timezone: 8 },
      extendInfo: shell.extendInfo || { refer: 'goods/pointsMall/index', source: 80 },
    };
    const j = await post(page, cfg.BASE + '/api3/' + EP_SORT, body, H);
    return { ok: isOk(j), errcode: j.errcode, errmsg: j.errmsg || '' };
  };

  const ledger = [];
  const applyOne = async (p) => {
    const w = await writeSort(p);
    await sleep(400);
    const now = await listNow();
    const got = now.find(x => String(x.goodsId) === String(p.goodsId));
    const rec = {
      goodsId: p.goodsId, title: p.title, oldSort: p.oldSort, newSort: p.newSort,
      writeOk: w.ok, errcode: w.errcode, errmsg: w.errmsg,
      readSort: got ? got.sort : null,
      match: got && Number(got.sort) === Number(p.newSort),
      classifyOk: got && String((got.pointClassifyInfo || {}).pointClassifyId) === String(p.pointClassifyId),
    };
    rec.ok = rec.writeOk && rec.match && rec.classifyOk;
    ledger.push(rec);
    return rec;
  };

  if (mode === 'dry') {
    console.log('\n=== 计划预览(不写) ===');
    PLAN.plan.forEach(p => console.log(`  ${String(p.rank).padStart(2)} l2=${p.l2.name} 总价¥${p.total} sort ${p.oldSort} → ${p.newSort} | ${p.title.slice(0, 28)}`));
    console.log('\nDRY 完成，未写入。守卫拦截:', log.blocked.length);
    await ctx.close();
    return;
  }

  if (mode === 'sample') {
    // 边界样本：组首(第1)、组尾(第21=书包组末)、二级分组交界(第21/22)、全局末(第25)
    const picks = [PLAN.plan[0], PLAN.plan[20], PLAN.plan[21], PLAN.plan[PLAN.plan.length - 1]];
    console.log('\n=== 小样(边界型) ===');
    for (const p of picks) {
      const rec = await applyOne(p);
      console.log(`  ${rec.ok ? 'OK  ' : 'FAIL'} gid=${p.goodsId} sort ${p.oldSort}→${p.newSort} 回读=${rec.readSort} 分组保持=${rec.classifyOk}`);
    }
    console.log('\n=== 小样回滚 ===');
    for (const p of picks) {
      const w = await writeSort({ ...p, newSort: p.oldSort });
      await sleep(400);
      const now = await listNow();
      const got = now.find(x => String(x.goodsId) === String(p.goodsId));
      console.log(`  回滚 gid=${p.goodsId} → ${p.oldSort}: 写=${w.ok} 回读=${got ? got.sort : 'N/A'}`);
    }
    const after = await listNow();
    const changedLeft = PLAN.plan.filter(p => {
      const got = after.find(x => String(x.goodsId) === String(p.goodsId));
      return got && Number(got.sort) !== Number(p.oldSort);
    });
    console.log('\n回滚后仍有偏差的条目:', changedLeft.length, changedLeft.map(p => p.goodsId));
    save(`108-sample-ledger_${mode}`, { mode, baseline: before.length, after: after.length, ledger, changedLeft: changedLeft.map(p => p.goodsId), blocked: log.blocked });
    console.log('RESULT', ledger.every(x => x.ok) && !changedLeft.length ? 'PASS' : 'FAIL');
    await ctx.close();
    return;
  }

  if (mode === 'apply') {
    console.log('\n=== 批量写入 sort ===');
    let fail = 0;
    for (let i = 0; i < PLAN.plan.length; i += BATCH) {
      const chunk = PLAN.plan.slice(i, i + BATCH);
      console.log(`\n批次 ${Math.floor(i / BATCH) + 1}/${Math.ceil(PLAN.plan.length / BATCH)} (${chunk.length} 条)`);
      for (const p of chunk) {
        const rec = await applyOne(p);
        console.log(`  ${rec.ok ? 'OK  ' : 'FAIL'} gid=${p.goodsId} sort ${p.oldSort}→${p.newSort} 回读=${rec.readSort} | ${p.title.slice(0, 22)}`);
        if (!rec.ok) fail++;
        await sleep(250);
      }
      if (fail > 3) { console.log('  失败超阈值，中止'); break; }
      await sleep(1000);
    }
    const after = await listNow();
    const planIds = new Set(PLAN.plan.map(p => String(p.goodsId)));
    const targetIds = new Set(PLAN.plan.map(p => String(p.goodsId)));
    // 非目标零变化
    const beforeMap = new Map(before.map(x => [String(x.goodsId), x]));
    const afterMap = new Map(after.map(x => [String(x.goodsId), x]));
    const nonTargetChanged = [];
    for (const [gid, b] of beforeMap) {
      if (planIds.has(gid)) continue;
      const a = afterMap.get(gid);
      if (!a) { nonTargetChanged.push({ gid, why: '消失' }); continue; }
      if (Number(a.sort) !== Number(b.sort)) nonTargetChanged.push({ gid, why: `sort ${b.sort}→${a.sort}` });
      if (Number(a.minPoint) !== Number(b.minPoint) || Number(a.minPointPrice) !== Number(b.minPointPrice))
        nonTargetChanged.push({ gid, why: '价格变化' });
    }
    const wrong = [];
    for (const p of PLAN.plan) {
      const a = afterMap.get(String(p.goodsId));
      if (!a) { wrong.push({ gid: p.goodsId, why: '缺失' }); continue; }
      if (Number(a.sort) !== Number(p.newSort)) wrong.push({ gid: p.goodsId, why: `sort=${a.sort} 期望${p.newSort}` });
    }
    const summary = {
      mode, baseline: before.length, after: after.length,
      planCount: PLAN.plan.length,
      ledgerOk: ledger.filter(x => x.ok).length, ledgerFail: ledger.filter(x => !x.ok).length,
      wrong, nonTargetChanged, blocked: log.blocked.length,
    };
    log.summary = summary;
    save('108-sort-ledger_apply', { ...log, ledger });
    console.log('\n[汇总]', JSON.stringify(summary, null, 1));
    console.log('RESULT', (!summary.wrong.length && !summary.nonTargetChanged.length && summary.ledgerFail === 0) ? 'PASS' : 'FAIL');
    await ctx.close();
    return;
  }
})().catch(e => { console.error('FATAL', e); process.exit(1); });
