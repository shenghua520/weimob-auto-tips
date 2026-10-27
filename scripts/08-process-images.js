/**
 * 图片规范化处理
 *  主图/轮播图/SKU图 → 750x750 画布，等比缩放后居中，四周白底补边（不裁剪）
 *  详情图           → 宽 750 等比缩放，按高度切成多段（每段 ≤1200px），顺序命名
 * 用法: node process-images.js --src=2640 | --all | --limit=5
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const BACK = path.resolve(__dirname, 'backup');
const OUT = path.resolve(__dirname, 'processed');
const products = JSON.parse(fs.readFileSync(path.join(BACK, 'products.json'), 'utf8'));
const SRC = (process.argv.find(a => a.startsWith('--src=')) || '').split('=')[1];
const LIMIT = Number((process.argv.find(a => a.startsWith('--limit=')) || '').split('=')[1] || 0);
const ALL = process.argv.includes('--all');

const CANVAS = 750;          // 商品图片画布边长
const DETAIL_MAX_H = 1200;   // 详情图每段最大高度

const naturalSort = imgs => [...imgs].sort((a, b) =>
  (parseInt(String(a.file).replace(/[^\d]/g, ''), 10) || 0) - (parseInt(String(b.file).replace(/[^\d]/g, ''), 10) || 0));

async function squareContain(src, dst) {
  await sharp(src)
    .resize({ width: CANVAS, height: CANVAS, fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 90, mozjpeg: true })
    .toFile(dst);
  const m = await sharp(dst).metadata();
  return { w: m.width, h: m.height };
}

async function sliceDetail(src, dir, baseName) {
  const meta = await sharp(src).metadata();
  const buf = await sharp(src).resize({ width: CANVAS, withoutEnlargement: false }).toBuffer();
  const m2 = await sharp(buf).metadata();
  const out = [];
  // 均匀切分：避免最后一段只剩几像素的碎片
  const n = Math.max(1, Math.ceil(m2.height / DETAIL_MAX_H));
  const segH = Math.ceil(m2.height / n);
  let idx = 0;
  for (let y = 0; y < m2.height; y += segH) {
    const h = Math.min(segH, m2.height - y);
    idx++;
    const dst = path.join(dir, `${baseName}-${String(idx).padStart(2, '0')}.jpg`);
    await sharp(buf).extract({ left: 0, top: y, width: m2.width, height: h }).jpeg({ quality: 90, mozjpeg: true }).toFile(dst);
    out.push({ file: path.basename(dst), w: m2.width, h });
  }
  return { srcW: meta.width, srcH: meta.height, outW: m2.width, outH: m2.height, parts: out };
}

(async () => {
  let list = ALL ? products : (SRC ? products.filter(x => String(x.srcId) === SRC) : products.slice(0, 1));
  if (LIMIT) list = list.slice(0, LIMIT);
  fs.mkdirSync(OUT, { recursive: true });
  // 清单增量合并（支持断点续跑）
  const manifestPath = path.join(BACK, '图片处理清单.json');
  let manifest = [];
  if (ALL && fs.existsSync(manifestPath)) {
    try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch (e) { manifest = []; }
  }
  const doneSet = new Set(manifest.map(m => String(m.srcId)));
  const bad = [];

  for (const p of list) {
    if (ALL && doneSet.has(String(p.srcId))) continue;
    const dir = path.join(OUT, String(p.srcId));
    fs.mkdirSync(dir, { recursive: true });
    const rec = { srcId: p.srcId, name: p.name, cat1: p.cat1, cat2: p.cat2, goods: [], sku: [], detail: [] };

    // 商品图片：主图 → 轮播（顺序），统一 750x750 白底自适应
    const mainBanner = [...naturalSort(p.images.main), ...naturalSort(p.images.banner)];
    let i = 0;
    for (const it of mainBanner) {
      i++;
      const dst = path.join(dir, `G${String(i).padStart(2, '0')}.jpg`);
      try {
        const r = await squareContain(it.path, dst);
        rec.goods.push({ file: dst, name: `G${String(i).padStart(2, '0')}.jpg`, kind: i === 1 ? '主图' : `轮播${i - 1}`, w: r.w, h: r.h, src: it.path });
      } catch (e) {
        bad.push({ srcId: p.srcId, name: p.name, file: it.file, type: 'goods', err: e.message.slice(0, 80) });
      }
    }

    // SKU 图
    let si = 0;
    for (const it of naturalSort(p.images.sku)) {
      si++;
      const dst = path.join(dir, `S${String(si).padStart(2, '0')}.jpg`);
      try {
        const r = await squareContain(it.path, dst);
        rec.sku.push({ file: dst, name: `S${String(si).padStart(2, '0')}.jpg`, spec: it.file, w: r.w, h: r.h, src: it.path });
      } catch (e) {
        bad.push({ srcId: p.srcId, name: p.name, file: it.file, type: 'sku', err: e.message.slice(0, 80) });
      }
    }

    // 详情图：切段
    let di = 0;
    for (const it of naturalSort(p.images.detail)) {
      di++;
      try {
        const info = await sliceDetail(it.path, dir, `D${String(di).padStart(2, '0')}`);
        rec.detail.push({ src: it.path, srcFile: it.file, ...info });
      } catch (e) {
        bad.push({ srcId: p.srcId, name: p.name, file: it.file, type: 'detail', err: e.message.slice(0, 80) });
      }
    }
    manifest.push(rec);
    doneSet.add(String(p.srcId));
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 1));
    fs.writeFileSync(path.join(BACK, '图片处理坏图.json'), JSON.stringify(bad, null, 1));
    const parts = rec.detail.reduce((a, d) => a + d.parts.length, 0);
    console.log(`${p.srcId} ${p.name.slice(0, 24)} → 商品图 ${rec.goods.length} | SKU ${rec.sku.length} | 详情 ${rec.detail.length}→${parts} 段${bad.some(b => b.srcId === p.srcId) ? ' ⚠有坏图' : ''}`);
  }
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 1));
  console.log(`\n清单 ${manifest.length} 个商品 | 坏图 ${bad.length} 张（见 backup/图片处理坏图.json）`);
})();
