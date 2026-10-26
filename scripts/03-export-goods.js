/**
 * 03 · 商品全量备份（只读）
 *
 * ⚠️ 商品列表接口 pageSize 上限 20，传大会返回空 + totalCount=0（不报错）
 *
 * 产出：backup/商品全量备份_<时间>.json / .csv
 *      backup/goods-ids.json
 */
const fs = require('fs');
const path = require('path');
const { launch, cfg, captureHeaders, post, isOk, paginate, stamp, writeCsv, PATHS } = require('./lib/common');

const EP = 'queryGoodsListWithPageForManagement';
const API = `${cfg.BASE}/api3/mall/goods/${EP}`;

(async () => {
  const ctx = await launch();
  const page = ctx.pages()[0] || await ctx.newPage();
  page.setDefaultTimeout(60000);

  console.log('抓取商品列表接口请求头…');
  const { headers, payload } = await captureHeaders(page, PATHS.GOODS_LIST, EP);

  const all = await paginate(async (pageNum, pageSize) => {
    const body = { ...payload, pageNum, pageSize };
    const j = await post(page, API, body, headers);
    if (!isOk(j)) { console.log('  第' + pageNum + '页失败:', j.errmsg); return { list: [], total: 0 }; }
    const list = j.data.pageList || [];
    console.log(`  page${pageNum}: ${list.length} / total ${j.data.totalCount}`);
    return { list, total: j.data.totalCount };
  }, 20);

  console.log('\n导出商品:', all.length);
  const ts = stamp();
  fs.writeFileSync(path.join(PATHS.BACKUP, `商品全量备份_${ts}.json`), JSON.stringify(all, null, 1), 'utf8');
  writeCsv(
    path.join(PATHS.BACKUP, `商品全量备份_${ts}.csv`),
    ['商品ID', '商品名称', '价格', '库存', '销量', '上架', '可售', '品牌', '创建时间'],
    all.map(g => [g.goodsId, g.title, g.goodsPrice, g.goodsStock, g.realSaleNum, g.isOnline, g.isCanSell, g.brandName, g.createTime])
  );
  fs.writeFileSync(path.join(PATHS.BACKUP, 'goods-ids.json'), JSON.stringify(all.map(g => g.goodsId), null, 1), 'utf8');

  console.log('已保存 backup/商品全量备份_' + ts + '.{json,csv}');
  console.log('库存合计:', all.reduce((a, g) => a + (Number(g.goodsStock) || 0), 0));
  await ctx.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
