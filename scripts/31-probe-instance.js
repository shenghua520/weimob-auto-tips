/**
 * 核实 productInstanceId：两个值各属于哪个账号/实例
 * 只读
 */
const { chromium } = require('playwright-core');
const path = require('path');
const fs = require('fs');

const PROFILE = path.resolve(__dirname, 'profile');
const MAT = 'https://master.weimob.com/bos/products/mpmaterial/4022657115397/6cva1xbh8X2adufqdiX6cx2wfzo2/store/material';

(async () => {
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    executablePath: 'C:/Users/shenghua/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe',
    headless: false, viewport: { width: 1400, height: 900 }, locale: 'zh-CN',
  });
  const page = ctx.pages()[0] || await ctx.newPage();
  page.setDefaultTimeout(60000);

  // 抓各模块请求里的 productInstanceId，看分布
  const seen = [];
  page.on('request', r => {
    if (r.method() !== 'POST' || !/\/api3\//.test(r.url())) return;
    const b = r.postData() || '';
    try {
      const j = JSON.parse(b);
      const top = j.productInstanceId;
      const bi = j.basicInfo && j.basicInfo.productInstanceId;
      if (top || bi) seen.push({ api: r.url().split('/api3/')[1], top, bi, bosId: j.bosId || (j.basicInfo && j.basicInfo.bosId), vid: j.vid ?? (j.basicInfo && j.basicInfo.vid) });
    } catch (e) { }
  });

  let H = null, mBody = null;
  page.on('request', r => { if (r.url().includes('getMaterialList')) { H = r.headers(); mBody = r.postData(); } });
  await page.goto(MAT, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(14000);

  const hdr = {}; ['authorization', 'apiclient', 'weimob-bosid', 'content-type', 'referer', 'accept'].forEach(k => { if (H[k]) hdr[k] = H[k]; });
  hdr['content-type'] = 'application/json; charset=utf-8';
  hdr['user-agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36';
  const cookies = await ctx.cookies();
  hdr.cookie = cookies.map(c => `${c.name}=${c.value}`).join('; ');
  const base = JSON.parse(mBody).basicInfo;

  const post = async (ep, body) => {
    const r = await fetch('https://master.weimob.com/api3/' + ep, { method: 'POST', headers: hdr, body: JSON.stringify(body) });
    const t = await r.text();
    try { return JSON.parse(t); } catch (e) { return { errmsg: t.slice(0, 200) }; }
  };

  console.log('=== 当前素材页 basicInfo ===');
  console.log(JSON.stringify(base, null, 1));

  console.log('\n=== 各接口出现的 productInstanceId 分布 ===');
  const map = new Map();
  seen.forEach(s => {
    const key = `${s.top} | basicInfo:${s.bi} | bosId:${s.bosId}`;
    const cur = map.get(key) || { n: 0, apis: new Set() };
    cur.n++; cur.apis.add(s.api.split('/').slice(0, 3).join('/'));
    map.set(key, cur);
  });
  [...map.entries()].forEach(([k, v]) => console.log(`  [${v.n}次] ${k}\n      模块: ${[...v.apis].slice(0, 5).join(', ')}`));

  // 分别用两个 ID 查素材容量
  const mk = (pid) => {
    const b = JSON.parse(JSON.stringify(base));
    b.productInstanceId = pid;
    return {
      bosId: 4022657115397, merchantId: 2000569246397, sourceProductId: 1, sourceProductInstanceId: pid,
      sourceProductVersionId: '110499', tcode: 'weimob', vid: 0, materialType: 1,
      basicInfo: b, i18n: { language: 'zh-CN', timezone: 8 },
      extendInfo: { refer: '/bos/products/mpmaterial/{bosId}/{key}/store/material', source: 80 },
    };
  };
  console.log('\n=== 用不同 productInstanceId 查素材容量 ===');
  for (const pid of [24343333397, 24343313397]) {
    const t = await post('material/center/material/getMaterialTotal', mk(pid));
    console.log(`  ${pid} → errcode=${t.errcode} ${t.errmsg || ''} data=${JSON.stringify(t.data)}`);
  }

  // 素材库总数
  console.log('\n=== 本账号素材库现状 ===');
  const l = await post('material/center/material/getMaterialList', {
    bosId: 4022657115397, merchantId: 2000569246397, sourceProductId: 1, sourceProductInstanceId: 24343333397,
    sourceProductVersionId: '110499', tcode: 'weimob', vid: 0, materialType: 1, pageNum: 1, pageSize: 20,
    basicInfo: base, i18n: { language: 'zh-CN', timezone: 8 },
    extendInfo: { refer: '/bos/products/mpmaterial/{bosId}/{key}/store/material', source: 80 },
  });
  console.log('图片素材 totalCount:', l.data && (l.data.totalCount || l.data.total));
  fs.writeFileSync(path.join(__dirname, 'out', 'instance-check.json'), JSON.stringify({ base, seen, total: l.data && l.data.totalCount }, null, 1));
  await ctx.close();
})();
