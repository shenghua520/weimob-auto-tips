/**
 * 视频素材：建 9 个一级分组 → 上传视频到对应分组 → 输出 URL 映射
 * 数据源：D:/workbuddy/2026-10-15-13-20-57/上架商品视频/视频清单.csv
 * 用法: node video-upload.js [--dry] [--one]
 */
const { chromium } = require('playwright-core');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const COS = require('cos-nodejs-sdk-v5');

const PROFILE = path.resolve(__dirname, 'profile');
const MAT = 'https://master.weimob.com/bos/products/mpmaterial/4022657115397/6cva1xbh8X2adufqdiX6cx2wfzo2/store/material';
const MEP = 'material/center/material/getMaterialList';
const VDIR = 'D:/workbuddy/2026-10-15-13-20-57/上架商品视频';
const MAPF = path.join(__dirname, 'backup', '视频URL映射.json');
const GRPF = path.join(__dirname, 'backup', '视频分组.json');
const DRY = process.argv.includes('--dry');
const ONE = process.argv.includes('--one');
const CREATE_UID = 12103830397;
const md5 = b => crypto.createHash('md5').update(b).digest('hex');

const CATS = ['家用电器', '米面油品', '读物潮玩', '家庭日用', '少儿食品', '少儿穿戴', '少儿护理', '体育用品', '学习文具'];

// CSV: 商品ID,商品名称,视频文件名,大小MB,Content-Type,原始地址
function readList() {
  const txt = fs.readFileSync(path.join(VDIR, '视频清单.csv'), 'utf8').replace(/^\uFEFF/, '');
  const lines = txt.split(/\r?\n/).filter(Boolean);
  const head = lines.shift().split(',');
  return lines.map(l => {
    const c = l.split(',');
    return { srcId: c[0], name: c[1], file: c[2], sizeMB: c[3], local: path.join(VDIR, c[2]) };
  });
}

(async () => {
  const products = JSON.parse(fs.readFileSync(path.join(__dirname, 'backup', 'products.json'), 'utf8'));
  const cat1Of = {};
  products.forEach(p => { cat1Of[String(p.srcId)] = p.cat1; });
  const list = readList().filter(x => fs.existsSync(x.local));
  console.log(`视频任务 ${list.length} 个`);
  list.forEach(x => console.log(' ', x.srcId, cat1Of[x.srcId] || '(无分类)', x.file, x.sizeMB + 'MB'));

  const ctx = await chromium.launchPersistentContext(PROFILE, {
    executablePath: 'C:/Users/shenghua/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe',
    headless: false, viewport: { width: 1200, height: 800 }, locale: 'zh-CN',
  });
  const page = ctx.pages()[0] || await ctx.newPage();
  let H = null, mBody = null, gBody = null;
  page.on('request', r => {
    const u = r.url();
    if (u.includes(MEP)) { H = r.headers(); mBody = r.postData(); }
    if (u.includes('getGroupList')) gBody = r.postData();
  });
  await page.goto(MAT, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(13000);
  // 切视频 tab 触发 materialType=3 的 getGroupList
  await page.getByText('视频', { exact: true }).first().click().catch(() => { });
  await page.waitForTimeout(5000);
  const cookies = await ctx.cookies();
  const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');
  await ctx.close();

  const hdr = { ...H };
  Object.keys(hdr).forEach(k => { if (!['authorization', 'apiclient', 'weimob-bosid', 'content-type', 'referer', 'accept'].includes(k)) delete hdr[k]; });
  hdr['content-type'] = 'application/json; charset=utf-8';
  hdr['user-agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36';
  hdr.cookie = cookieStr;

  const baseInfo = JSON.parse(mBody).basicInfo;
  const gBase3 = gBody ? JSON.parse(gBody) : null;
  if (gBase3) { gBase3.materialType = 3; }
  const gBase1 = gBase3 ? { ...JSON.parse(JSON.stringify(gBase3)), materialType: 1 } : null;

  const post = async (ep, body) => {
    const r = await fetch('https://master.weimob.com/api3/' + ep, { method: 'POST', headers: hdr, body: JSON.stringify(body) });
    const t = await r.text();
    try { return JSON.parse(t); } catch (e) { return { errcode: 'x', errmsg: t.slice(0, 200) }; }
  };

  // 1) 现有视频分组
  const gl = await post('material/center/group/getGroupList', gBase3);
  const flat = [];
  const walk = (ns, d) => (ns || []).forEach(n => {
    const id = n.groupId ?? n.id;
    flat.push({ id, name: n.name ?? n.groupName, level: n.level, parentId: n.parentId, mt: n.materialType });
    walk(n.materialGroupList || n.children, d + 1);
  });
  walk(gl.data && (gl.data.groupList || gl.data.list), 0);
  console.log('\n现有视频分组:', flat.filter(x => x.parentId === -1 || x.parentId === null).map(x => `${x.name}(${x.id})`).join(', ') || '(空)');

  const GRP = {};
  for (const c of CATS) {
    let hit = flat.find(x => x.name === c && (x.parentId === -1 || x.parentId === null));
    if (hit) { GRP[c] = hit.id; continue; }
    if (DRY) { console.log('  计划建组:', c); continue; }
    const r = await post('material/center/group/createGroup', { ...gBase3, name: c, level: 0, parentId: -1, sceneId: 'default', createUid: CREATE_UID });
    const id = r.data && (r.data.groupId ?? r.data.id);
    if (String(r.errcode) === '0' && id) { GRP[c] = id; console.log(`  + 建组 ${c} → ${id}`); }
    else console.log(`  ✗ 建组 ${c}`, JSON.stringify(r).slice(0, 160));
    await new Promise(x => setTimeout(x, 200));
  }
  fs.writeFileSync(GRPF, JSON.stringify(GRP, null, 1));
  console.log('视频分组:', JSON.stringify(GRP));
  if (DRY) return;

  // 2) 上传
  const map = fs.existsSync(MAPF) ? JSON.parse(fs.readFileSync(MAPF, 'utf8')) : {};
  const targets = ONE ? list.slice(0, 1) : list;
  let ok = 0, skip = 0, fail = 0;
  for (const it of targets) {
    if (map[it.srcId] && map[it.srcId].url) { skip++; continue; }
    const cat = cat1Of[it.srcId];
    const gid = GRP[cat] || GRP['学习文具'];
    try {
      const buf = fs.readFileSync(it.local);
      const fileCode = buf.subarray(0, 64).toString('hex');
      const m5 = md5(buf);
      const extInfo = { refer: '/bos/products/mpmaterial/{bosId}/{key}/store/material', source: 80 };
      const common = {
        contentType: 'video/mp4', fileCode, fileMd5: m5, fileSize: buf.length, srcFileName: it.file,
        requireType: 'VIDEO', riskReq: { accountType: 15, uid: 4022657115397 },
        optionals: ['SAVE_DURATION', 'SAVE_COVER'],
        basicInfo: baseInfo, i18n: { language: 'zh-CN', timezone: 8 }, extendInfo: extInfo,
      };
      // 视频 preUpload 需要业务头
      const vhdr = { ...hdr, bizkey: 'mp_material_center_upload', bizmaterialtype: '3', bizmaterialvid: '0', accesskey: '' };
      const postV = async (ep, body) => {
        const r = await fetch('https://master.weimob.com/api3/' + ep, { method: 'POST', headers: vhdr, body: JSON.stringify(body) });
        const t = await r.text();
        try { return JSON.parse(t); } catch (e) { return { code: 'x', msg: t.slice(0, 200) }; }
      };
      const pre = await postV('mpmedia/center/upload/preUpload', common);
      if (pre.code !== 0) throw new Error('preUpload ' + JSON.stringify(pre).slice(0, 160));
      const pp = pre.data.preProcessInfo, cos = pre.data.cosTempInfo;
      if (pre.data.continue !== false) {
        const cli = new COS({ SecretId: cos.secretId, SecretKey: cos.secretKey, SecurityToken: cos.sessionToken });
        await new Promise((res, rej) => cli.putObject({ Bucket: cos.bucket, Region: cos.region, Key: pp.saveKey, Body: buf, ContentType: 'video/mp4' }, (e, d) => e ? rej(e) : res(d)));
      }
      const conf = await postV('mpmedia/center/upload/confirmUpload', { ...common, preProcessInfo: pp });
      if (conf.code !== 0) throw new Error('confirm ' + JSON.stringify(conf).slice(0, 160));
      const url = conf.data.url;
      const det = conf.data.detail || {};
      const cover = det.mediaCover || {};
      const ins = await post('material/center/material/insertMaterial', {
        bosId: 4022657115397, productId: 1, vid: 0, vidType: 2, productInstanceId: 24343333397,
        merchantId: 2000569246397, sourceProductId: 1, sourceProductInstanceId: 24343333397,
        sourceProductVersionId: '110499', tcode: 'weimob',
        url, size: buf.length, title: it.file, duration: det.duration || 0,
        channels: [], introduction: '', groupId: gid, materialType: 3, materialFileType: 10,
        materialDetailExts: cover.url
          ? [{ key: 'thumb_url', value: cover.url }, { key: 'thumb_height', value: cover.height || 720 }, { key: 'thumb_width', value: cover.width || 720 }]
          : [],
        createUid: CREATE_UID, basicInfo: baseInfo,
        i18n: { language: 'zh-CN', timezone: 8 }, extendInfo: extInfo,
      });
      if (String(ins.errcode) !== '0') throw new Error('insert ' + JSON.stringify(ins).slice(0, 160));
      map[it.srcId] = { url, cover: cover.url || '', duration: det.duration || 0, size: buf.length, groupId: gid, cat1: cat, file: it.file };
      fs.writeFileSync(MAPF, JSON.stringify(map, null, 1));
      ok++;
      console.log(`✓ ${it.srcId} ${it.file} → ${url.slice(0, 60)}… | 组 ${gid}`);
    } catch (e) {
      fail++;
      console.log(`✗ ${it.srcId} ${it.file}: ${e.message.slice(0, 140)}`);
    }
  }
  console.log(`\n完成: 成功 ${ok} / 跳过 ${skip} / 失败 ${fail}`);
  console.log('映射:', MAPF);
})();
