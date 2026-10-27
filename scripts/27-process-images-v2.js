/**
 * 图片规范化 v2：适配「同一张图被多种容器裁切」的核心机制
 *
 * 机制：微盟前台把同一张商品图复用到
 *   - 详情页轮播：2:3（750×1125）  object-fit:fill
 *   - 列表卡片  ：接近 1:1
 *   - 其他位置  ：比例各异
 * 若图是 1:1，塞进 2:3 会被拉伸/裁切；若是 2:3 塞进 1:1 会被裁上下。
 *
 * 解法：**2:3 画布 + 主体缩放进中心 1:1 安全区**
 *   → 2:3 容器：完整显示（含上下留白）
 *   → 1:1 容器：裁掉上下留白，主体正好完整
 *   → 任何中间比例都不切主体
 *
 * 用法: node process-images-v2.js --src=2640 | --all
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const BACK = path.resolve(__dirname, 'backup');
const OUT = path.resolve(__dirname, 'processed2');
const products = JSON.parse(fs.readFileSync(path.join(BACK, 'products.json'), 'utf8'));
const SRC = (process.argv.find(a => a.startsWith('--src=')) || '').split('=')[1];
const ALL = process.argv.includes('--all');
const LIMIT = Number((process.argv.find(a => a.startsWith('--limit=')) || '').split('=')[1] || 0);

const PANEL_W = 750;      // 画布宽
const PANEL_H = 1000;     // 画布高 = 3:4（官方建议 750×750 / 750×1000）
const SAFE = 750;         // 中心安全区（1:1），主体永远收在这里
const PAD = Math.round((PANEL_H - SAFE) / 2);  // 上下白边 125

const naturalSort = imgs => [...imgs].sort((a, b) =>
  (parseInt(String(a.file).replace(/[^\d]/g, ''), 10) || 0) - (parseInt(String(b.file).replace(/[^\d]/g, ''), 10) || 0));

/** 主体进 750×750 安全区，再扩到 750×1125 画布 */
async function toPanel(src, dst) {
  const body = await sharp(src)
    .resize({ width: SAFE, height: SAFE, fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .flatten({ background: '#ffffff' })
    .toBuffer();
  await sharp(body)
    .extend({ top: PAD, bottom: PANEL_H - SAFE - PAD, left: 0, right: 0, background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .jpeg({ quality: 90, mozjpeg: true })
    .toFile(dst);
  return { w: PANEL_W, h: PANEL_H };
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  let list = ALL ? products : (SRC ? products.filter(x => String(x.srcId) === SRC) : products.slice(0, 1));
  if (LIMIT) list = list.slice(0, LIMIT);

  const manifestPath = path.join(BACK, '图片处理清单v2.json');
  let manifest = (ALL && fs.existsSync(manifestPath)) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : [];
  const doneSet = new Set(manifest.map(m => String(m.srcId)));
  const bad = [];

  for (const p of list) {
    if (ALL && doneSet.has(String(p.srcId))) continue;
    const dir = path.join(OUT, String(p.srcId));
    fs.mkdirSync(dir, { recursive: true });
    const rec = { srcId: p.srcId, name: p.name, cat1: p.cat1, goods: [] };

    const mainBanner = [...naturalSort(p.images.main), ...naturalSort(p.images.banner)];
    let i = 0;
    for (const it of mainBanner) {
      i++;
      const dst = path.join(dir, `G${String(i).padStart(2, '0')}.jpg`);
      try {
        const r = await toPanel(it.path, dst);
        rec.goods.push({ file: dst, name: `G${String(i).padStart(2, '0')}.jpg`, kind: i === 1 ? '主图' : `轮播${i - 1}`, w: r.w, h: r.h, src: it.path });
      } catch (e) {
        bad.push({ srcId: p.srcId, file: it.file, err: e.message.slice(0, 80) });
      }
    }
    manifest.push(rec);
    doneSet.add(String(p.srcId));
    if (ALL) fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 1));
    console.log(`${p.srcId} ${p.name.slice(0, 22)} → ${rec.goods.length} 张 750×1000${bad.some(b => b.srcId === p.srcId) ? ' ⚠' : ''}`);
  }
  if (ALL) fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 1));
  console.log(`\n共 ${manifest.length} 个商品 | 坏图 ${bad.length}`);
})();
