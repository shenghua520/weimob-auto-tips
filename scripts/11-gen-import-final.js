/**
 * 生成批量导入 Excel（用「规范化图片」的素材 URL）
 * 数据源：backup/素材URL映射.json + backup/products.json
 * 用法: node gen-import-final.js [--limit=N] [--src=xxx]
 */
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const BACK = path.resolve(__dirname, 'backup');
const TPL = path.join(BACK, '商品导入模板.xlsx');
const products = JSON.parse(fs.readFileSync(path.join(BACK, 'products.json'), 'utf8'));
const urls = JSON.parse(fs.readFileSync(path.join(BACK, '素材URL映射.json'), 'utf8'));
const LIMIT = Number((process.argv.find(a => a.startsWith('--limit=')) || '').split('=')[1] || 0);
const SRC = (process.argv.find(a => a.startsWith('--src=')) || '').split('=')[1];
const FROM = Number((process.argv.find(a => a.startsWith('--from=')) || '').split('=')[1] || 0);
const TO = Number((process.argv.find(a => a.startsWith('--to=')) || '').split('=')[1] || 0);
const TAG = (process.argv.find(a => a.startsWith('--tag=')) || '').split('=')[1];

const wb = XLSX.readFile(TPL);
const header = XLSX.utils.sheet_to_json(wb.Sheets['Sheet1'], { header: 1, range: 0 })[0];

const CATEGORY = {
  学习文具: { lv1: '3C数码', lv2: '文具耗材' },
  体育用品: { lv1: '服饰', lv2: '运动户外' },
  米面油品: { lv1: '食品', lv2: '粮油干货' },
};

let list = SRC ? products.filter(x => String(x.srcId) === SRC) : products;
if (TO) list = list.slice(FROM, TO);
else if (FROM) list = list.slice(FROM);
else if (LIMIT) list = list.slice(0, LIMIT);

const rows = [];
const skip = [];
let seq = 0;
for (const p of list) {
  const u = urls[p.srcId];
  if (!u || !u.goods || !u.goods.filter(Boolean).length) { skip.push(p); continue; }
  seq++;
  const imgs = u.goods.filter(Boolean).slice(0, 10);
  const cat = CATEGORY[p.cat1] || { lv1: '其他', lv2: '其他' };
  const skus = p.skus.length ? p.skus : [{ spec: '', price: p.price, cost: p.cost, marketPrice: p.marketPrice }];
  const specName = (p.specName || '规格').trim() || '规格';

  skus.forEach((s, i) => {
    const r = {};
    const set = (k, v) => { if (header.includes(k) && v !== undefined && v !== null && v !== '') r[k] = v; };
    set('商品序号', String(seq));
    set('商品类型', '实物商品（物流发货）');
    set('商品名称', p.name.length > 58 ? p.name.slice(0, 58) : p.name);
    set('商品图片', imgs.join(';'));
    set('商品编码', p.srcId);
    set('一级类目', cat.lv1);
    set('二级类目', cat.lv2);
    set('可售状态', '可售');
    set('销售渠道', '线上');
    set('配送方式', '商家配送');
    set('商家配送模板', '10004850271');
    set('支付方式', '支持线上支付');
    set('库存计算方式', '下单减库存');
    set('库存单位', '件');
    set('销售单位', '件');
    set('商品分组', `${p.cat1}:${p.cat2}`);
    set('商品排序', String(p.sort || 0));
    // 单规格商品也必须写规格，否则导入后无 SKU
    set('规格名称', specName);
    set('规格值组合', (s.spec || `规格${i + 1}`).trim());
    if (skus.length > 1 && s.code) set('规格编码', s.code);
    set('商家统一价', String(s.price || p.price));
    set('市场价', String(s.marketPrice || p.marketPrice || ''));
    set('成本价', String(s.cost || p.cost || ''));
    rows.push(r);
  });
}

const ws = XLSX.utils.json_to_sheet(rows, { header });
const wb2 = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb2, ws, 'Sheet1');
const name = TAG || (SRC ? SRC : (TO ? `${FROM}-${TO}` : (LIMIT ? String(LIMIT) : '全部')));
const out = path.join(BACK, `最终导入_${name}.xlsx`);
XLSX.writeFile(wb2, out);
console.log(`商品 ${seq} 个 / 行 ${rows.length} | 跳过（无图）${skip.length}`);
if (skip.length) skip.slice(0, 8).forEach(s => console.log('  跳过:', s.srcId, s.name.slice(0, 30)));
console.log('已生成:', out);
console.log('首行:', JSON.stringify(rows[0]).slice(0, 400));
