/**
 * 把「已上传 COS 但未入库」的素材补登进素材库（按原分组）
 * 前提：账号素材配额已扩容
 * 数据源：backup/素材未入库.json
 * 用法: node mat-insert.js [--c=3] [--limit=N]
 */
const { chromium } = require('playwright-core');
const path = require('path');
const fs = require('fs');
const PROFILE = path.resolve(__dirname, 'profile');
const MAT = 'https://master.weimob.com/bos/products/mpmaterial/4022657115397/6cva1xbh8X2adufqdiX6cx2wfzo2/store/material';
const MEP = 'material/center/material/getMaterialList';
const PENDING = path.join(__dirname, 'backup', '素材未入库.json');
const DONE = path.join(__dirname, 'backup', '素材已入库.json');
const CONC = Number((process.argv.find(a => a.startsWith('--c=')) || '--c=3').split('=')[1]);
const LIMIT = Number((process.argv.find(a => a.startsWith('--limit=')) || '').split('=')[1] || 0);
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  let pending = JSON.parse(fs.readFileSync(PENDING, 'utf8'));
  const done = fs.existsSync(DONE) ? JSON.parse(fs.readFileSync(DONE, 'utf8')) : [];
  const doneUrls = new Set(done.map(x => x.url));
  pending = pending.filter(x => !doneUrls.has(x.url));
  if (LIMIT) pending = pending.slice(0, LIMIT);
  if (!pending.length) { console.log('没有待入库的素材'); return; }

  const ctx = await chromium.launchPersistentContext(PROFILE, {
    executablePath: 'C:/Users/shenghua/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe',
    headless: false, viewport: { width: 1200, height: 800 }, locale: 'zh-CN',
  });
  const page = ctx.pages()[0] || await ctx.newPage();
  let H = null, mBody = null;
  page.on('request', r => { if (r.url().includes(MEP)) { H = r.headers(); mBody = r.postData(); } });
  await page.goto(MAT, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(13000);
  const hdr = {}; ['authorization', 'apiclient', 'weimob-bosid', 'content-type', 'referer', 'accept'].forEach(k => { if (H[k]) hdr[k] = H[k]; });
  hdr['content-type'] = 'application/json; charset=utf-8';
  // user-agent 必须带：缺了会被风控拦下并返回误导性的「素材容量已超出限额」
  hdr['user-agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36';
  const cookies = await ctx.cookies();
  const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');
  await ctx.close();
  const baseInfo = JSON.parse(mBody).basicInfo;

  // 用「界面真实成功过」的 insertMaterial 请求体当模板（字段一个不差，避免漏字段被判容量超限）
  let PROTO = null;
  const probeFile = path.join(__dirname, 'out', 'mat-ui-probe.json');
  if (fs.existsSync(probeFile)) {
    const d = JSON.parse(fs.readFileSync(probeFile, 'utf8'));
    const r = (d.reqs || []).filter(x => /insertMaterial/.test(x.api)).pop();
    if (r) { try { PROTO = JSON.parse(r.body); } catch (e) { } }
  }
  console.log(PROTO ? '已加载真实请求体模板（proto）' : '⚠ 无模板，用手写 body（可能失败）');

  const post = async body => {
    const r = await fetch('https://master.weimob.com/api3/material/center/material/insertMaterial', {
      method: 'POST', headers: { ...hdr, cookie: cookieStr }, body: JSON.stringify(body),
    });
    const t = await r.text();
    try { return JSON.parse(t); } catch (e) { return { errcode: 'x', errmsg: t.slice(0, 200) }; }
  };

  console.log(`待补登 ${pending.length} 张 | 并发 ${CONC}`);
  const queue = [...pending];
  let ok = 0, fail = 0; const errs = [];
  const t0 = Date.now();
  const save = () => fs.writeFileSync(DONE, JSON.stringify(done, null, 1));
  const worker = async () => {
    while (queue.length) {
      const j = queue.shift();
      const body = PROTO ? JSON.parse(JSON.stringify(PROTO)) : {
        bosId: 4022657115397, productId: 1, vid: 0, vidType: 2, productInstanceId: 24343333397,
        merchantId: 2000569246397, sourceProductId: 1, sourceProductInstanceId: 24343333397,
        sourceProductVersionId: '110499', tcode: 'weimob', url: j.url, groupId: j.gid, size: j.size,
        title: j.title, materialType: 1, materialFileType: 4, channels: [], createUid: 12103830397,
        orderInfo: { order: 0, stage: 'stage_' + Date.now(), total: 1 },
        materialDetailExts: [{ key: 'width', value: j.w || 750 }, { key: 'height', value: j.h || 750 }],
        basicInfo: baseInfo, i18n: { language: 'zh-CN', timezone: 8 },
        extendInfo: { refer: '/bos/products/mpmaterial/{bosId}/{key}/store/material', source: 80 },
      };
      // 只替换与本张图相关的字段，其余完全沿用模板
      body.url = j.url; body.size = j.size; body.title = j.title; body.groupId = j.gid;
      body.orderInfo = { order: 0, stage: 'stage_' + Date.now(), total: 1 };
      body.materialDetailExts = [{ key: 'width', value: j.w || 750 }, { key: 'height', value: j.h || 750 }];
      if (!body.basicInfo) body.basicInfo = baseInfo;
      const r = await post(body);
      if (String(r.errcode) === '0') {
        ok++; done.push(j);
        if (ok % 100 === 0) { save(); console.log(`  ${ok} 张 | ${((Date.now() - t0) / 1000 / ok).toFixed(2)}s/张 | 剩 ${queue.length}`); }
      } else {
        fail++;
        if (errs.length < 5) errs.push({ url: j.url, err: r.errmsg });
      }
    }
  };
  await Promise.all(Array.from({ length: CONC }, worker));
  save();
  console.log(`\n补登完成: 成功 ${ok} / 失败 ${fail} | 用时 ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  if (errs.length) { console.log('错误样例:'); errs.forEach(e => console.log('  ', e.err, e.url.slice(0, 60))); }
})();
