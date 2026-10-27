/**
 * 上传「已规范化」的图片到「各商品的素材二级分组」
 * 数据源：backup/图片处理清单.json + backup/商品素材分组.json
 * 输出：backup/素材URL映射.json  { srcId: { goods:[url], detail:[url], sku:[url] } }
 * 用法: node upload-processed.js --one | --all [--c=3]
 */
const { chromium } = require('playwright-core');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const COS = require('cos-nodejs-sdk-v5');

const PROFILE = path.resolve(__dirname, 'profile');
const MAT = 'https://master.weimob.com/bos/products/mpmaterial/4022657115397/6cva1xbh8X2adufqdiX6cx2wfzo2/store/material';
const MANIFEST = path.resolve(__dirname, 'backup', '图片处理清单.json');
const GROUPS = path.resolve(__dirname, 'backup', '商品素材分组.json');
const OUTMAP = path.resolve(__dirname, 'backup', '素材URL映射.json');
const MEP = 'material/center/material/getMaterialList';

const MODE = process.argv.includes('--all') ? 'all' : 'one';
const CONC = Number((process.argv.find(a => a.startsWith('--c=')) || '--c=2').split('=')[1]);
const md5 = b => crypto.createHash('md5').update(b).digest('hex');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SIZE_OVERRIDE = Number((process.argv.find(a => a.startsWith('--size=')) || '').split('=')[1] || 0);
const STRICT = process.argv.includes('--strict');   // 入库失败视为任务失败
const NO_INSERT = process.argv.includes('--noinsert'); // 跳过素材入库（仅取 URL）
const SAVE = true;
let pending = []; let cur = null;

(async () => {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const groups = JSON.parse(fs.readFileSync(GROUPS, 'utf8'));
  const outmap = fs.existsSync(OUTMAP) ? JSON.parse(fs.readFileSync(OUTMAP, 'utf8')) : {};

  const ctx = await chromium.launchPersistentContext(PROFILE, {
    executablePath: 'C:/Users/shenghua/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe',
    headless: false, viewport: { width: 1200, height: 800 }, locale: 'zh-CN',
  });
  const page = ctx.pages()[0] || await ctx.newPage();
  let H = null, mBody = null;
  page.on('request', r => { if (r.url().includes(MEP)) { H = r.headers(); mBody = r.postData(); } });
  await page.goto(MAT, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(13000);
  const hdr = {}; ['authorization', 'apiclient', 'weimob-bosid', 'content-type', 'referer', 'origin'].forEach(k => { if (H[k]) hdr[k] = H[k]; });
  const cookies = await ctx.cookies();
  const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');
  const baseInfo = JSON.parse(mBody).basicInfo;
  await ctx.close();

  const MEDIA_H = { ...hdr, cookie: cookieStr, bizkey: 'mp_material_center_upload', bizmaterialtype: '1', bizmaterialvid: '0', accesskey: '' };
  delete MEDIA_H.apiclient;
  const MAT_H = { ...hdr, cookie: cookieStr, apiclient: 'saas-pc' };
  const api = async (ep, body, media) => {
    const r = await fetch('https://master.weimob.com/api3/' + ep, {
      method: 'POST', headers: media ? MEDIA_H : MAT_H, body: JSON.stringify(body),
    });
    const t = await r.text();
    try { return JSON.parse(t); } catch (e) { return { errcode: 'x', errmsg: t.slice(0, 200) }; }
  };
  const uploadOne = async (file, gid, title, w = 750, h = 750, attempt = 1) => {
    try {
      const buf = fs.readFileSync(file);
      const contentType = 'image/jpeg';
      const m5 = md5(buf);
      const head = buf.subarray(0, 64).toString('hex');
      const pre = await api('mpmedia/center/upload/preUpload', {
        contentType, fileCode: head, fileMd5: m5, fileSize: buf.length, srcFileName: title,
        requireType: 'IMAGE', riskReq: { accountType: 15, uid: 4022657115397 },
        basicInfo: baseInfo, i18n: { language: 'zh-CN', timezone: 8 },
        extendInfo: { refer: '/bos/products/mpmaterial/{bosId}/{key}/store/material', source: 80 },
      }, true);
      if (pre.code !== 0) throw new Error('preUpload ' + JSON.stringify(pre).slice(0, 120));
      const pp = pre.data.preProcessInfo, cos = pre.data.cosTempInfo;
      if (pre.data.continue !== false) {
        const cli = new COS({ SecretId: cos.secretId, SecretKey: cos.secretKey, SecurityToken: cos.sessionToken });
        await new Promise((res, rej) => cli.putObject({ Bucket: cos.bucket, Region: cos.region, Key: pp.saveKey, Body: buf, ContentType: contentType }, (e, d) => e ? rej(e) : res(d)));
      }
      const conf = await api('mpmedia/center/upload/confirmUpload', {
        contentType, fileCode: head, fileMd5: m5, fileSize: buf.length, srcFileName: title,
        preProcessInfo: pp, imgWidth: w, imgHeight: h, requireType: 'IMAGE',
        riskReq: { accountType: 15, uid: 4022657115397 },
        basicInfo: baseInfo, i18n: { language: 'zh-CN', timezone: 8 },
        extendInfo: { refer: '/bos/products/mpmaterial/{bosId}/{key}/store/material', source: 80 },
      }, true);
      if (conf.code !== 0) throw new Error('confirm ' + JSON.stringify(conf).slice(0, 120));
      const url = conf.data.url;
      if (NO_INSERT) {
        pending.push({ srcId: cur.srcId, file: path.basename(file), url, size: buf.length, gid, title, err: 'skip(未入库)' });
        if (SAVE) fs.writeFileSync(path.join(__dirname, 'backup', '素材未入库.json'), JSON.stringify(pending, null, 1));
        return url;
      }
      const ins = await api('material/center/material/insertMaterial', {
        bosId: 4022657115397, productId: 1, vid: 0, vidType: 2, productInstanceId: 24343313397,
        merchantId: 2000569246397, sourceProductId: 1, sourceProductInstanceId: 24343313397,
        sourceProductVersionId: '110499', tcode: 'weimob', url, groupId: gid, size: SIZE_OVERRIDE || buf.length,
        title, materialType: 1, materialFileType: 4, channels: [], createUid: 12103830397,
        orderInfo: { order: 0, stage: 'stage_' + Date.now() + Math.floor(Math.random() * 1000), total: 1 },
        materialDetailExts: [], basicInfo: baseInfo, i18n: { language: 'zh-CN', timezone: 8 },
      }, false);
      if (ins.errcode !== 0) {
        // 入库失败不丢弃 URL：图已在 COS，URL 可直接用于商品导入
        pending.push({ srcId: cur.srcId, file: path.basename(file), url, size: buf.length, gid, title, err: (ins.errmsg || '').slice(0, 60) });
        if (SAVE) fs.writeFileSync(path.join(__dirname, 'backup', '素材未入库.json'), JSON.stringify(pending, null, 1));
        if (STRICT) throw new Error('insert ' + JSON.stringify(ins).slice(0, 120));
        return url;
      }
      return url;
    } catch (e) {
      if (attempt < 3) { await sleep(1000 * attempt); return uploadOne(file, gid, title, w, h, attempt + 1); }
      throw e;
    }
  };

  // 任务清单
  const jobs = [];
  const targets = MODE === 'all' ? manifest : manifest.slice(0, 1);
  for (const m of targets) {
    const g = groups[m.srcId];
    if (!g || !g.groupId) { console.log('缺分组:', m.srcId); continue; }
    const done = outmap[m.srcId];
    const push = (file, kind, idx, w, h) => {
      if (done && done[kind] && done[kind][idx]) return;
      jobs.push({ srcId: m.srcId, gid: g.groupId, file, kind, idx, w, h, title: `${m.srcId}_${path.basename(file)}` });
    };
    m.goods.forEach((x, i) => push(x.file, 'goods', i, x.w, x.h));
    (m.sku || []).forEach((x, i) => push(x.file, 'sku', i, x.w, x.h));
    // 详情图按切段展开（D01-01, D01-02, D02-01 …）
    let di = 0;
    for (const d of m.detail) {
      for (const p of d.parts) {
        const file = path.join(path.resolve(__dirname, 'processed'), String(m.srcId), p.file);
        const idx = di++;
        if (outmap[m.srcId] && outmap[m.srcId].detail && outmap[m.srcId].detail[idx]) continue;
        jobs.push({ srcId: m.srcId, gid: g.groupId, file, kind: 'detail', idx, w: p.w, h: p.h, title: `${m.srcId}_${p.file}` });
      }
    }
  }
  console.log(`待上传 ${jobs.length} 张 | 商品 ${targets.length} | 并发 ${CONC}`);
  if (!jobs.length) return;

  let ok = 0, fail = 0;
  const t0 = Date.now();
  const queue = [...jobs];
  const save = () => fs.writeFileSync(OUTMAP, JSON.stringify(outmap, null, 1));
  const worker = async () => {
    while (queue.length) {
      const j = queue.shift();
      try {
        cur = j;
        const url = await uploadOne(j.file, j.gid, j.title, j.w, j.h);
        const rec = outmap[j.srcId] || (outmap[j.srcId] = { goods: [], detail: [], sku: [] });
        rec[j.kind][j.idx] = url;
        ok++;
        if (ok % 50 === 0) { save(); const el = (Date.now() - t0) / 1000; console.log(`  ${ok} 张 | ${(el / ok).toFixed(1)}s/张 | 剩 ${queue.length}`); }
      } catch (e) {
        fail++;
        console.log('  ✗', j.srcId, path.basename(j.file), e.message.slice(0, 90));
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, CONC) }, worker));
  save();
  console.log(`\n完成: 成功 ${ok} / 失败 ${fail} / 用时 ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  console.log('URL 映射:', OUTMAP);
})();
