/**
 * 上传 v2 主图（750×1125）→ 产出 素材URL映射v2.json
 * 复用素材上传链；insertMaterial 用真实请求体模板（见 docs/11 §2.7）
 * 用法: node upload-v2.js --all [--c=4]
 */
const { chromium } = require('playwright-core');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const COS = require('cos-nodejs-sdk-v5');

const DIR = __dirname;
const PROFILE = path.resolve(DIR, 'profile');
const MAT = 'https://master.weimob.com/bos/products/mpmaterial/4022657115397/6cva1xbh8X2adufqdiX6cx2wfzo2/store/material';
const MEP = 'material/center/material/getMaterialList';
const MANIFEST = path.join(DIR, 'backup', '图片处理清单v2.json');
const GROUPS = path.join(DIR, 'backup', '商品素材分组.json');
const OUTMAP = path.join(DIR, 'backup', '素材URL映射v2.json');
const CONC = Number((process.argv.find(a => a.startsWith('--c=')) || '--c=4').split('=')[1]);
const LIMIT = Number((process.argv.find(a => a.startsWith('--limit=')) || '').split('=')[1] || 0);
const md5 = b => crypto.createHash('md5').update(b).digest('hex');
const sleep = ms => new Promise(r => setTimeout(r, ms));

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
  const hdr = {}; ['authorization', 'apiclient', 'weimob-bosid', 'content-type', 'referer', 'accept'].forEach(k => { if (H[k]) hdr[k] = H[k]; });
  hdr['content-type'] = 'application/json; charset=utf-8';
  hdr['user-agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36';
  const cookies = await ctx.cookies();
  hdr.cookie = cookies.map(c => `${c.name}=${c.value}`).join('; ');
  const baseInfo = JSON.parse(mBody).basicInfo;
  await ctx.close();

  // 真实请求体模板
  let PROTO = null;
  const pf = path.join(DIR, 'out', 'mat-ui-probe.json');
  if (fs.existsSync(pf)) {
    const d = JSON.parse(fs.readFileSync(pf, 'utf8'));
    const r = (d.reqs || []).filter(x => /insertMaterial/.test(x.api)).pop();
    if (r) { try { PROTO = JSON.parse(r.body); } catch (e) { } }
  }
  console.log(PROTO ? '已加载请求体模板' : '⚠ 无模板');

  const MEDIA_H = { ...hdr, bizkey: 'mp_material_center_upload', bizmaterialtype: '1', bizmaterialvid: '0', accesskey: '' };
  delete MEDIA_H.apiclient;
  const api = async (ep, body, media) => {
    const r = await fetch('https://master.weimob.com/api3/' + ep, { method: 'POST', headers: media ? MEDIA_H : hdr, body: JSON.stringify(body) });
    const t = await r.text();
    try { return JSON.parse(t); } catch (e) { return { errcode: 'x', errmsg: t.slice(0, 200) }; }
  };

  const uploadOne = async (file, gid, title, w, h, attempt = 1) => {
    try {
      const buf = fs.readFileSync(file);
      const contentType = 'image/jpeg';
      const m5 = md5(buf);
      const head = buf.subarray(0, 64).toString('hex');
      const ext = { refer: '/bos/products/mpmaterial/{bosId}/{key}/store/material', source: 80 };
      const common = {
        contentType, fileCode: head, fileMd5: m5, fileSize: buf.length, srcFileName: title,
        requireType: 'IMAGE', riskReq: { accountType: 15, uid: 4022657115397 },
        basicInfo: baseInfo, i18n: { language: 'zh-CN', timezone: 8 }, extendInfo: ext,
      };
      const pre = await api('mpmedia/center/upload/preUpload', common, true);
      if (pre.code !== 0) throw new Error('preUpload ' + JSON.stringify(pre).slice(0, 120));
      const pp = pre.data.preProcessInfo, cos = pre.data.cosTempInfo;
      if (pre.data.continue !== false) {
        const cli = new COS({ SecretId: cos.secretId, SecretKey: cos.secretKey, SecurityToken: cos.sessionToken });
        await new Promise((res, rej) => cli.putObject({ Bucket: cos.bucket, Region: cos.region, Key: pp.saveKey, Body: buf, ContentType: contentType }, (e, d) => e ? rej(e) : res(d)));
      }
      const conf = await api('mpmedia/center/upload/confirmUpload', { ...common, preProcessInfo: pp, imgWidth: w, imgHeight: h }, true);
      if (conf.code !== 0) throw new Error('confirm ' + JSON.stringify(conf).slice(0, 120));
      const url = conf.data.url;
      const body = PROTO ? JSON.parse(JSON.stringify(PROTO)) : {
        bosId: 4022657115397, productId: 1, vid: 0, vidType: 2, productInstanceId: 24343333397,
        merchantId: 2000569246397, sourceProductId: 1, sourceProductInstanceId: 24343333397,
        sourceProductVersionId: '110499', tcode: 'weimob', materialType: 1, materialFileType: 4,
        channels: [], createUid: 12103830397, basicInfo: baseInfo,
        i18n: { language: 'zh-CN', timezone: 8 }, extendInfo: ext,
      };
      body.url = url; body.size = buf.length; body.title = title; body.groupId = gid;
      body.orderInfo = { order: 0, stage: 'stage_' + Date.now(), total: 1 };
      body.materialDetailExts = [{ key: 'width', value: w }, { key: 'height', value: h }];
      const ins = await api('material/center/material/insertMaterial', body, false);
      if (String(ins.errcode) !== '0') throw new Error('insert ' + JSON.stringify(ins).slice(0, 120));
      return url;
    } catch (e) {
      if (attempt < 3) { await sleep(800 * attempt); return uploadOne(file, gid, title, w, h, attempt + 1); }
      throw e;
    }
  };

  const jobs = [];
  for (const m of manifest) {
    const g = groups[m.srcId];
    if (!g || !g.groupId) continue;
    const rec = outmap[m.srcId] || null;
    m.goods.forEach((x, i) => {
      if (rec && rec[i]) return;
      jobs.push({ srcId: m.srcId, gid: g.groupId, file: x.file, idx: i, w: x.w, h: x.h, title: `${m.srcId}_v2_${x.name}` });
    });
  }
  const targets = LIMIT ? jobs.slice(0, LIMIT) : jobs;
  console.log(`待上传 ${targets.length} 张 | 并发 ${CONC}`);
  if (!targets.length) return;

  let ok = 0, fail = 0;
  const t0 = Date.now();
  const queue = [...targets];
  const save = () => fs.writeFileSync(OUTMAP, JSON.stringify(outmap, null, 1));
  const worker = async () => {
    while (queue.length) {
      const j = queue.shift();
      try {
        const url = await uploadOne(j.file, j.gid, j.title, j.w, j.h);
        const rec = outmap[j.srcId] || (outmap[j.srcId] = []);
        rec[j.idx] = url;
        ok++;
        if (ok % 100 === 0) { save(); console.log(`  ${ok} 张 | ${((Date.now() - t0) / 1000 / ok).toFixed(2)}s/张 | 剩 ${queue.length}`); }
      } catch (e) {
        fail++; console.log('  ✗', j.srcId, path.basename(j.file), e.message.slice(0, 90));
      }
    }
  };
  await Promise.all(Array.from({ length: CONC }, worker));
  save();
  console.log(`\n完成: 成功 ${ok} / 失败 ${fail} / 用时 ${((Date.now() - t0) / 1000).toFixed(0)}s`);
})();
