/**
 * 从「失败明细.xlsx」提取失败的商品编码，生成补录导入文件
 * 用法: node gen-fix-from-fail.js <失败明细.xlsx> <输出名>
 */
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
const DIR = __dirname;
const FAIL = process.argv[2];
const NAME = process.argv[3] || 'fix';

const products = JSON.parse(fs.readFileSync(path.join(DIR, 'backup', 'products.json'), 'utf8'));
const urls = JSON.parse(fs.readFileSync(path.join(DIR, 'backup', '素材URL映射.json'), 'utf8'));
const wb = XLSX.readFile(FAIL);
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
const h = rows[0];
const ci = h.findIndex(x => String(x).trim() === '商品编码');
const ti = h.findIndex(x => String(x).trim() === '商品名称');
const ei = h.findIndex(x => /失败原因/.test(String(x)));
console.log('列定位: 编码', ci, '| 名称', ti, '| 原因', ei, '| 数据行', rows.length - 1);

const ids = new Set();
rows.slice(1).forEach(r => { const c = String(r[ci] || '').trim(); if (c) ids.add(c); });
console.log('失败商品:', [...ids].join(','));

const TPL = path.join(DIR, 'backup', '商品导入模板.xlsx');
const th = XLSX.utils.sheet_to_json(XLSX.readFile(TPL).Sheets['Sheet1'], { header: 1, range: 0 })[0];
const CATEGORY = {
  学习文具: { lv1: '3C数码', lv2: '文具耗材' },
  体育用品: { lv1: '服饰', lv2: '运动户外' },
  米面油品: { lv1: '食品', lv2: '粮油干货' },
};

const list = products.filter(p => ids.has(String(p.srcId)));
const out = [];
let seq = 0;
for (const p of list) {
  const u = urls[p.srcId];
  if (!u || !u.goods || !u.goods.filter(Boolean).length) { console.log('无图跳过', p.srcId); continue; }
  seq++;
  const imgs = u.goods.filter(Boolean).slice(0, 10);
  const cat = CATEGORY[p.cat1] || { lv1: '其他', lv2: '其他' };
  const skus = p.skus.length ? p.skus : [{ spec: '', price: p.price, cost: p.cost, marketPrice: p.marketPrice }];
  const specName = (p.specName || '规格').trim() || '规格';
  const safeName = p.name.length > 58 ? p.name.slice(0, 58) : p.name;
  console.log('  ', p.srcId, '原名', [...p.name].length, '字 →', safeName);
  skus.forEach((s, i) => {
    const r = {};
    const set = (k, v) => { if (th.includes(k) && v !== undefined && v !== null && v !== '') r[k] = v; };
    set('商品序号', String(seq));
    set('商品类型', '实物商品（物流发货）');
    set('商品名称', safeName);
    set('商品图片', imgs.join(';'));
    set('商品编码', p.srcId);
    set('一级类目', cat.lv1); set('二级类目', cat.lv2);
    set('可售状态', '可售'); set('销售渠道', '线上');
    set('规格名称', specName); set('规格值组合', (s.spec || `规格${i + 1}`).trim());
    set('配送方式', '商家配送'); set('商家配送模板', '10004850271');
    set('支付方式', '支持线上支付'); set('库存计算方式', '下单减库存');
    set('库存单位', '件'); set('销售单位', '件');
    set('商品分组', `${p.cat1}:${p.cat2}`); set('商品排序', String(p.sort || 0));
    set('商家统一价', String(s.price || p.price));
    set('市场价', String(s.marketPrice || p.marketPrice || ''));
    set('成本价', String(s.cost || p.cost || ''));
    out.push(r);
  });
}
const ws = XLSX.utils.json_to_sheet(out, { header: th });
const wb2 = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb2, ws, 'Sheet1');
const fp = path.join(DIR, 'backup', `最终导入_${NAME}.xlsx`);
XLSX.writeFile(wb2, fp);
console.log(`\n生成 ${fp} | 商品 ${seq} / 行 ${out.length}`);
