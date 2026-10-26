/**
 * 04 · 分批删除全部商品（⚠️ 破坏性操作）
 *
 * 前置：
 *   1. 已跑 03-export-goods.js，backup/ 有全量备份
 *   2. 库存已清零（库存清零必须在删商品之前，详见 docs/06）
 *   3. 确认这是要清空的商户
 *
 * 用法：
 *   node scripts/04-delete-goods.js            # 演练，只打印将删多少
 *   node scripts/04-delete-goods.js --yes      # 真删
 *
 * 策略：每批 20，每轮回读 totalCount，数量不降就停；失败批次自动拆单定位。
 */
const fs = require('fs');
const path = require('path');
const { launch, cfg, captureHeaders, post, isOk, sleep, stamp, PATHS } = require('./lib/common');

const QEP = 'queryGoodsListWithPageForManagement';
const QAPI = `${cfg.BASE}/api3/mall/goods/${QEP}`;
const DAPI = `${cfg.BASE}/api3/mall/goods/deleteGoods`;
const BATCH = 20;

const CONFIRM = process.argv.includes('--yes');

(async () => {
  if (!CONFIRM) {
    console.log('[演练模式] 加 --yes 才会真删。');
    console.log('请确认已备份：', fs.existsSync(path.join(PATHS.BACKUP, 'goods-ids.json')) ? '✅ 有 goods-ids.json' : '❌ 未找到备份，先跑 03-export-goods.js');
  }

  const ctx = await launch();
  const page = ctx.pages()[0] || await ctx.newPage();
  page.setDefaultTimeout(60000);

  const { headers, payload } = await captureHeaders(page, PATHS.GOODS_LIST, QEP);

  const listAll = async () => {
    const out = [];
    for (let pn = 1; pn <= 15; pn++) {
      const j = await post(page, QAPI, { ...payload, pageNum: pn, pageSize: 20 }, headers);
      if (!isOk(j)) return { ids: out.map(g => g.goodsId), total: out.length };
      const l = j.data.pageList || [];
      out.push(...l);
      if (!l.length || out.length >= j.data.totalCount) return { ids: out.map(g => g.goodsId), total: j.data.totalCount };
    }
    return { ids: out.map(g => g.goodsId), total: out.length };
  };

  const del = async (ids) => post(page, DAPI, {
    basicInfo: payload.basicInfo,
    solutionType: payload.solutionType === undefined ? 2 : payload.solutionType,
    goodsIdList: ids,
    isDeleteAuditInfo: false,
    i18n: payload.i18n,
    extendInfo: payload.extendInfo,
  }, headers);

  const log = [];
  const fails = [];

  for (let round = 1; round <= 15; round++) {
    const { ids, total } = await listAll();
    console.log(`\n[第${round}轮] 剩余 ${total} 条`);
    if (!ids.length) break;
    if (!CONFIRM) { console.log('  演练：本轮将删除', ids.length, '条，分批', Math.ceil(ids.length / BATCH), '次'); break; }

    const before = total;
    for (let i = 0; i < ids.length; i += BATCH) {
      const batch = ids.slice(i, i + BATCH);
      const r = await del(batch);
      const ok = isOk(r);
      console.log(`  批${i / BATCH + 1}: ${batch.length} 个 → ${ok ? 'OK' : 'FAIL ' + r.errcode + ' ' + (r.errmsg || '')}`);
      log.push({ n: batch.length, ok, errcode: r.errcode, errmsg: r.errmsg });
      if (!ok) {
        for (const id of batch) {
          const r1 = await del([id]);
          if (!isOk(r1)) fails.push({ id, errmsg: r1.errmsg, errcode: r1.errcode });
          await sleep(250);
        }
      }
      await sleep(1000);
    }
    const after = await listAll();
    console.log(`  本轮后剩余 ${after.total}`);
    if (after.total >= before) { console.log('  ⚠ 数量未下降，停止'); break; }
  }

  const fin = await listAll();
  console.log('\n=== 最终剩余商品:', fin.total);
  fs.writeFileSync(path.join(PATHS.BACKUP, `删除商品日志_${stamp()}.json`), JSON.stringify({ log, fails, final: fin.total }, null, 1), 'utf8');
  if (fails.length) console.log('不可删除:', JSON.stringify(fails.slice(0, 10)));
  await ctx.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
