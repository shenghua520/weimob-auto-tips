/** 92 · 只读探查：列出各页面实际发出的 api3 接口名 + body 结构（零写入） */
const fs = require('fs');
const path = require('path');
const { cfg, launch, login, PATHS } = require('./lib/common');

const R = `${cfg.BASE}/bos/products/ecGoodsmanage/${cfg.BOS_ID}/${cfg.KEY}`;
const URLS = {
  classify: `${R}/manage/classify/list`,
  points: `${R}/goods/pointsMall/index`,
};

(async () => {
  const ctx = await launch({ headless: true });
  const page = ctx.pages()[0] || await ctx.newPage();
  page.setDefaultTimeout(60000);
  await login(page);

  const report = {};
  for (const [label, url] of Object.entries(URLS)) {
    console.log('\n===', label, '===');
    const found = [];
    const onReq = r => {
      const u = r.url();
      if (!u.includes('/api3/')) return;
      let body = null;
      try { body = r.postData() ? JSON.parse(r.postData()) : null; } catch (e) {}
      found.push({ ep: u.replace(`${cfg.BASE}/api3/`, '').split('?')[0], body });
    };
    page.on('request', onReq);
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(11000);
    page.off('request', onReq);
    const seen = new Set();
    for (const f of found) {
      if (seen.has(f.ep)) continue;
      seen.add(f.ep);
      console.log('  ', f.ep);
      if (/classify|point/i.test(f.ep) && f.body) {
        console.log('      body:', JSON.stringify(f.body).slice(0, 500));
      }
    }
    report[label] = [...seen];
  }
  const f = path.join(PATHS.BACKUP, `92-sniff_${new Date().toISOString().slice(0,19).replace(/[:]/g,'-')}.json`);
  fs.writeFileSync(f, JSON.stringify(report, null, 1), 'utf8');
  console.log('\n已存', f);
  await ctx.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
