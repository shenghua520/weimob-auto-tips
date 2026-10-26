/**
 * 公共库：登录、抓请求头、通用 POST、分页
 *
 * 用法：
 *   const { launch, login, captureHeaders, post, paginate, cfg } = require('./lib/common');
 */
const { chromium } = require('playwright-core');
const path = require('path');
const fs = require('fs');

// ---------- 配置 ----------
let cfg;
try {
  cfg = require(path.resolve(__dirname, '../../config.local.js'));
} catch (e) {
  cfg = {
    BASE: process.env.WEIMOB_BASE || 'https://master.weimob.com',
    BOS_ID: process.env.WEIMOB_BOS_ID || '<BOS_ID>',
    KEY: process.env.WEIMOB_KEY || '<KEY>',
    VID: process.env.WEIMOB_VID || '<VID>',
    ACCOUNT: process.env.WEIMOB_ACCOUNT || '<ACCOUNT>',
    PASSWORD: process.env.WEIMOB_PASSWORD || '<PASSWORD>',
    CHROME: process.env.CHROME_PATH || '',
    PROFILE: path.resolve(__dirname, '../../.profile'),
  };
}

const ROOT = path.resolve(__dirname, '../..');
const OUT = path.join(ROOT, 'out');
const BACKUP = path.join(ROOT, 'backup');
const SHOTS = path.join(ROOT, 'shots');
[OUT, BACKUP, SHOTS].forEach(d => fs.mkdirSync(d, { recursive: true }));

/** 商品列表页地址（换成你自己的 productCode/路由） */
const GOODS_LIST = `${cfg.BASE}/bos/products/ecGoodsmanage/${cfg.BOS_ID}/${cfg.KEY}/goods/list`;

/** 素材库地址 */
const MATERIAL = `${cfg.BASE}/bos/products/mpmaterial/${cfg.BOS_ID}/${cfg.KEY}/store/material`;

// ---------- 浏览器 ----------
async function launch(extra = {}) {
  const opts = {
    headless: false,
    viewport: { width: 1500, height: 950 },
    locale: 'zh-CN',
    acceptDownloads: true,
    ...extra,
  };
  // 显式指定 executablePath，避免 playwright 要求的版本与本地缓存不一致
  if (cfg.CHROME) opts.executablePath = cfg.CHROME;
  return chromium.launchPersistentContext(cfg.PROFILE, opts);
}

// ---------- 登录 ----------
async function login(page) {
  const target = GOODS_LIST;
  await page.goto(target, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  if (!page.url().includes('account.weimob.com')) return false; // 已是登录态

  // 默认是「验证码登录」，切到「密码登录」
  await page.getByText('密码登录', { exact: true }).click().catch(() => {});
  await page.waitForTimeout(2000);

  const ins = page.locator('input.ant-input');
  await ins.nth(0).fill(cfg.ACCOUNT);
  await ins.nth(1).fill(cfg.PASSWORD);

  const cb = page.locator('input.ant-checkbox-input');
  if (await cb.count()) {
    const checked = await cb.first().isChecked().catch(() => true);
    if (!checked) await cb.first().check({ force: true }).catch(() => {});
  }

  await page.getByRole('button', { name: /登\s*录/ }).first().click();
  await page.waitForTimeout(9000);
  return true;
}

/**
 * 打开页面并抓取指定接口的请求头（authorization 等）
 * @param {*} page
 * @param {string} url        用于触发请求的页面地址
 * @param {string} endpoint   要抓的接口关键字
 */
async function captureHeaders(page, url, endpoint, waitMs = 12000) {
  let H = null, body = null;
  const onReq = r => {
    if (r.url().includes(endpoint)) { H = r.headers(); body = r.postData(); }
  };
  page.on('request', onReq);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(waitMs);
  page.off('request', onReq);
  if (!H) throw new Error('未捕获到接口请求：' + endpoint);

  const KEEP = ['authorization', 'apiclient', 'weimob-bosid', 'content-type', 'referer'];
  const headers = {};
  KEEP.forEach(k => { if (H[k]) headers[k] = H[k]; });
  return { headers, payload: body ? JSON.parse(body) : null };
}

/** 页面内 fetch 转发（自带 Cookie，跨域也能过） */
async function post(page, url, body, headers) {
  const txt = await page.evaluate(async ({ url, body, headers }) => {
    const r = await fetch(url, {
      method: 'POST', headers, credentials: 'include', body: JSON.stringify(body),
    });
    return await r.text();
  }, { url, body, headers });
  let j = {};
  try { j = JSON.parse(txt); } catch (e) { return { errcode: 'x', errmsg: String(txt).slice(0, 200) }; }
  return j;
}

const isOk = r => r.errcode === 0 || r.errcode === '0';

/**
 * 通用分页拉取
 * @param {(pageNum:number, pageSize:number) => Promise<{list:any[], total:number}>} fetcher
 */
async function paginate(fetcher, pageSize = 20, maxPages = 500) {
  const all = [];
  for (let pn = 1; pn <= maxPages; pn++) {
    const { list, total } = await fetcher(pn, pageSize);
    all.push(...list);
    if (!list.length || all.length >= total) break;
  }
  return all;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:]/g, '-');

/** 写 CSV（UTF-8 BOM，Excel 中文不乱码） */
function writeCsv(file, header, rows) {
  const esc = v => '"' + String(v === null || v === undefined ? '' : v).replace(/"/g, '""').replace(/\r?\n/g, ' ') + '"';
  const lines = ['\uFEFF' + header.map(esc).join(',')];
  rows.forEach(r => lines.push(r.map(esc).join(',')));
  fs.writeFileSync(file, lines.join('\n'), 'utf8');
}

module.exports = {
  cfg, launch, login, captureHeaders, post, isOk, paginate,
  sleep, stamp, writeCsv,
  PATHS: { ROOT, OUT, BACKUP, SHOTS, GOODS_LIST, MATERIAL },
};

// CLI: node scripts/lib/common.js login
if (require.main === module && process.argv[2] === 'login') {
  (async () => {
    const ctx = await launch();
    const page = ctx.pages()[0] || await ctx.newPage();
    const did = await login(page);
    console.log(did ? '已登录并保存登录态' : '已是登录态');
    console.log('当前地址:', page.url());
    await ctx.close();
  })().catch(e => { console.error('ERR', e.message); process.exit(1); });
}
