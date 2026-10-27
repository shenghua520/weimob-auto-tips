/**
 * 批量导入：一次登录，多个 Excel 流水线导入
 * 用法: node import-batch.js <file1.xlsx> <file2.xlsx> ...
 */
const { chromium } = require('playwright-core');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const COS = require('cos-nodejs-sdk-v5');
const XLSX = require('xlsx');

const PROFILE = path.resolve(__dirname, 'profile');
const LIST = 'https://master.weimob.com/bos/products/ecGoodsmanage/4022657115397/6cva1xbh8X2adt8v5yX6cx2wfzo2/goods/list';
const FILES = process.argv.slice(2).filter(a => a.endsWith('.xlsx'));

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  if (!FILES.length) { console.log('用法: node import-batch.js a.xlsx b.xlsx'); return; }
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    executablePath: 'C:/Users/shenghua/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe',
    headless: false, viewport: { width: 1200, height: 800 }, locale: 'zh-CN',
  });
  const page = ctx.pages()[0] || await ctx.newPage();
  let H = null, lBody = null;
  page.on('request', r => { if (r.url().includes('queryGoodsListWithPageForManagement')) { H = r.headers(); lBody = r.postData(); } });
  await page.goto(LIST, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(12000);
  const hdr = {}; ['authorization', 'apiclient', 'weimob-bosid', 'content-type', 'referer', 'origin'].forEach(k => { if (H[k]) hdr[k] = H[k]; });
  hdr['content-type'] = 'application/json';
  const cookies = await ctx.cookies();
  const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');
  await ctx.close();
  const baseInfo = JSON.parse(lBody).basicInfo;
  const post = async (ep, body) => {
    const r = await fetch('https://master.weimob.com/api3/' + ep, { method: 'POST', headers: { ...hdr, cookie: cookieStr }, body: JSON.stringify(body) });
    const t = await r.text();
    try { return JSON.parse(t); } catch (e) { return { errcode: 'x', errmsg: t.slice(0, 200) }; }
  };

  // 阶段一：全部上传 + 发起导入
  const jobs = [];
  for (const F of FILES) {
    const buf = fs.readFileSync(F);
    const md5 = crypto.createHash('md5').update(buf).digest('hex');
    const ext = {
      srcFileName: path.basename(F), fileMd5: md5, fileSize: buf.length, fileCode: buf.subarray(0, 64).toString('hex'),
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      riskReq: { accountType: 15, uid: 4022657115397 }, basicInfo: baseInfo,
      i18n: { language: 'zh-CN', timezone: 8 },
      extendInfo: { refer: '/bos/products/ecGoodsmanage/{bosId}/{key}/goods/list', source: 80 },
    };
    const pre = await post('merchant/backstage/service/upload/preUpload', ext);
    if (pre.code !== 0) { console.log('preUpload 失败', F, JSON.stringify(pre).slice(0, 200)); continue; }
    const pp = pre.data.preProcessInfo, cos = pre.data.cosTempInfo;
    if (pre.data.continue !== false) {
      const cli = new COS({ SecretId: cos.secretId, SecretKey: cos.secretKey, SecurityToken: cos.sessionToken });
      await new Promise((res, rej) => cli.putObject({ Bucket: cos.bucket, Region: cos.region, Key: pp.saveKey, Body: buf, ContentType: ext.contentType }, (e, d) => e ? rej(e) : res(d)));
    }
    const conf = await post('merchant/backstage/service/upload/confirmUpload', { ...ext, preProcessInfo: pp });
    if (conf.code !== 0) { console.log('confirm 失败', F, JSON.stringify(conf).slice(0, 200)); continue; }
    const fileUrl = conf.data.url;
    const imp = await post('mall/goods/import/importRetailMerchantGoodsAndItem', {
      bosId: 4022657115397, productId: 145, vid: 6017568309397, vidType: 2,
      productInstanceId: 24343313397, basicInfo: baseInfo, solutionType: 2,
      subGoodsTypes: [101, 202, 203, 206, 207], hasDrugGoodsAccess: 0, fileUrl,
      i18n: { language: 'zh-CN', timezone: 8 },
      extendInfo: { refer: '/bos/products/ecGoodsmanage/{bosId}/{key}/goods/list', source: 80 },
    });
    const rid = imp.data && imp.data.asyncProcessResult && imp.data.asyncProcessResult.resultId;
    console.log(`${path.basename(F)} → resultId ${rid || '失败 ' + JSON.stringify(imp).slice(0, 150)}`);
    if (rid) jobs.push({ file: F, rid });
  }

  // 阶段二：轮询结果
  const summary = [];
  for (const j of jobs) {
    const dlBody = {
      bosId: 4022657115397, productId: 145, vid: 6017568309397, vidType: 2, productInstanceId: 24343313397,
      id: j.rid, apiPrefix: '/api3', cookieName: 'saasAuthData', login: '', logout: '', url: {},
      tcode: 'weimob', merchantId: 2000569246397, ...baseInfo,
    };
    let detail = null;
    for (let i = 0; i < 20; i++) {
      await sleep(3000);
      const d = await post('merchant/backstage/service/download/detail', dlBody);
      if (d.data && (d.data.status === 1 || d.data.excelResult)) { detail = d.data; break; }
    }
    if (!detail) { console.log(j.file, '结果未就绪'); summary.push({ file: j.file, ok: false }); continue; }
    const er = detail.excelResult || {};
    console.log(`${path.basename(j.file)}: 共 ${er.totalCount} / 成功 ${er.successCount} / 失败 ${er.failCount}`);
    summary.push({ file: j.file, total: er.totalCount, success: er.successCount, fail: er.failCount });
    if (er.failCount > 0 && detail.mediaUrl) {
      const fb = Buffer.from(await (await fetch(detail.mediaUrl)).arrayBuffer());
      const fn = path.join(__dirname, 'backup', `失败明细_${path.basename(j.file)}`);
      fs.writeFileSync(fn, fb);
      const wb = XLSX.read(fb, { type: 'buffer' });
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
      const h = rows[0]; const ei = h.findIndex(x => /失败原因/.test(String(x)));
      console.log('  失败明细:', fn);
      rows.slice(1, 4).forEach((r, i) => { if (ei >= 0 && r[ei]) console.log(`    ${r[ei]}`); });
    }
  }
  console.log('\n=== 汇总 ===');
  summary.forEach(s => console.log(' ', path.basename(s.file), JSON.stringify(s)));
  const tot = summary.reduce((a, s) => a + (s.success || 0), 0);
  const tf = summary.reduce((a, s) => a + (s.fail || 0), 0);
  console.log(`总成功 ${tot} / 总失败 ${tf}`);
})();
