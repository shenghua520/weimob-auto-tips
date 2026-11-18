/**
 * 90 · 登录 + 只读探查（验证登录态 + 抓商品列表接口结构）
 * 只读：仅调用 queryGoodsListWithPageForManagement 查询接口，pageSize=20，取第 1 页。
 */
const fs = require('fs');
const path = require('path');
const { cfg, launch, login, captureHeaders, post, isOk, PATHS } = require('./lib/common');

const EP = 'queryGoodsListWithPageForManagement';
const API = `${cfg.BASE}/api3/mall/goods/${EP}`;

(async () => {
  console.log('=== 登录 + 只读探查 ===');
  const ctx = await launch({ headless: true });
  const page = ctx.pages()[0] || await ctx.newPage();
  page.setDefaultTimeout(60000);

  console.log('打开商品列表页…');
  await page.goto(PATHS.GOODS_LIST, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);

  if (page.url().includes('account.weimob.com')) {
    console.log('未登录 → 密码登录中…');
    const did = await login(page);
    await page.waitForTimeout(4000);
    if (page.url().includes('account.weimob.com')) {
      await ctx.close();
      throw new Error('登录未完成（验证码/滑块或账号密码错误）。零写入。');
    }
    console.log('登录成功 did=' + did);
  } else {
    console.log('已是登录态（profile 有效）');
  }
  console.log('当前地址:', page.url());
  console.log('标题:', await page.title());

  console.log('\n抓商品列表接口请求头…');
  const { headers, payload } = await captureHeaders(page, PATHS.GOODS_LIST, EP, 15000);
  console.log('headers keys:', Object.keys(headers).join(', '));
  console.log('payload:', JSON.stringify(payload));

  const body = { ...(payload || {}), pageNum: 1, pageSize: 20 };
  const j = await post(page, API, body, headers);
  console.log('\nerrcode:', j.errcode, 'errmsg:', j.errmsg);
  if (!isOk(j)) { await ctx.close(); throw new Error('查询失败: ' + JSON.stringify(j).slice(0, 400)); }

  const d = j.data || {};
  console.log('totalCount:', d.totalCount);
  const list = d.pageList || [];
  console.log('page1 count:', list.length);

  // 保存探查快照（只读产物）
  const out = path.join(PATHS.BACKUP, `90-login-probe_${new Date().toISOString().slice(0,19).replace(/[:]/g,'-')}.json`);
  fs.writeFileSync(out, JSON.stringify({ headers, payload, totalCount: d.totalCount, sample: list.slice(0, 3) }, null, 1), 'utf8');
  console.log('快照已存:', out);

  if (list.length) {
    const g = list[0];
    console.log('\n样本字段 keys:', Object.keys(g).join(', '));
  }
  await ctx.close();
  console.log('\n只读探查结束，线上零改动。');
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
