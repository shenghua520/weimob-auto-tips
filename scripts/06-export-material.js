/**
 * 06 · 素材全量备份 + 判定"未使用"
 *
 * 前置：先跑 05-collect-page-urls.js 得到 out/used-urls.json
 *
 * 产出：
 *   backup/素材全量备份_<时间>.{json,csv}
 *   backup/未使用素材.json      可删清单（id / title / url / createUid / materialType）
 *   backup/仍在用素材.json      保留清单
 *
 * 判定规则：素材 URL 的文件名（bucket 之后的 uuid.ext）命中 used 集合 → 保留
 */
const fs = require('fs');
const path = require('path');
const { launch, cfg, captureHeaders, post, isOk, paginate, stamp, writeCsv, PATHS } = require('./lib/common');

const EP = 'material/center/material/getMaterialList';
const API = `${cfg.BASE}/api3/${EP}`;

const key = u => (u || '').split('?')[0].split('/').pop();   // uuid.ext

(async () => {
  const ctx = await launch();
  const page = ctx.pages()[0] || await ctx.newPage();
  page.setDefaultTimeout(60000);

  const { headers, payload } = await captureHeaders(page, PATHS.MATERIAL, 'getMaterialList');

  const all = await paginate(async (pageNum, pageSize) => {
    const j = await post(page, API, { ...payload, pageNum, pageSize }, headers);
    if (!isOk(j)) { console.log('  第' + pageNum + '页失败:', j.errmsg); return { list: [], total: 0 }; }
    const list = j.data.pageList || [];
    if (pageNum === 1) console.log('  总数:', j.data.totalCount);
    return { list, total: j.data.totalCount };
  }, 60);

  console.log('导出素材:', all.length);
  const ts = stamp();
  fs.writeFileSync(path.join(PATHS.BACKUP, `素材全量备份_${ts}.json`), JSON.stringify(all, null, 1), 'utf8');
  writeCsv(
    path.join(PATHS.BACKUP, `素材全量备份_${ts}.csv`),
    ['素材ID', '标题', '类型', '大小', '上传时间', '地址'],
    all.map(m => [m.id, m.title, m.materialType, m.size, m.createTime, m.url])
  );

  const usedFile = path.join(PATHS.OUT, 'used-urls.json');
  if (!fs.existsSync(usedFile)) {
    console.log('\n⚠ 未找到 out/used-urls.json，跳过"未使用"判定。');
    console.log('  请先跑 node scripts/05-collect-page-urls.js —— 跳过判定会误删首页图！');
    await ctx.close();
    return;
  }

  const used = JSON.parse(fs.readFileSync(usedFile, 'utf8')).urls;
  const usedKeys = new Set(used.map(key));
  const unused = [], keep = [];
  all.forEach(m => (usedKeys.has(key(m.url)) ? keep : unused).push(m));

  fs.writeFileSync(path.join(PATHS.BACKUP, '未使用素材.json'),
    JSON.stringify(unused.map(m => ({ id: m.id, title: m.title, size: m.size, url: m.url, createUid: m.createUid, materialType: m.materialType, createTime: m.createTime })), null, 1), 'utf8');
  fs.writeFileSync(path.join(PATHS.BACKUP, '仍在用素材.json'),
    JSON.stringify(keep.map(m => ({ id: m.id, title: m.title, url: m.url })), null, 1), 'utf8');

  console.log('\n在用图片(去重):', usedKeys.size);
  console.log('仍被页面引用:', keep.length, '→ backup/仍在用素材.json');
  console.log('可删除(未引用):', unused.length, '→ backup/未使用素材.json');
  await ctx.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
