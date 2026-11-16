// 44 · UI 拦截取证：填表 → 提交时 abort 记录真实 payload（零写入）
// 用途：API 直发报「入参存在空值」等校验错时，拿 UI 真实入参做 diff。
// 跑法: node scripts/44-capture-ui-payload.js [入口URL] [弹窗内名称输入框placeholder]
const fs = require('fs');
const path = require('path');
const { cfg, launch, login, stamp, PATHS } = require('./lib/common');

const R = `${cfg.BASE}/bos/products/ecGoodsmanage/${cfg.BOS_ID}/${cfg.KEY}`;
const PAGE = process.argv[2] || `${R}/manage/classify/list`;
const NAME_PH = process.argv[3] || '填写分组名称';
const NAME = '取证样本（勿提交）';
const ts = stamp();

(async () => {
  const ctx = await launch({ headless: true });
  const page = ctx.pages()[0] || await ctx.newPage();
  page.setDefaultTimeout(60000);

  const captured = [];
  await page.route('**/api3/**', route => {
    const req = route.request();
    const u = req.url();
    // 一切写接口都拦：取证只需要 body，不落线上
    const W = ['add', 'delete', 'update', 'save', 'import', 'move', 'insert', 'create', 'batch'];
    const ep = u.replace(`${cfg.BASE}/api3/`, '');
    if (req.method() === 'POST' && W.some(w => ep.toLowerCase().includes(w)) && !/query|count|get|list|exist/i.test(ep)) {
      captured.push({ ep, body: req.postData() });
      console.log('  [拦截]', ep);
      return route.abort();
    }
    return route.continue();
  });

  await login(page);
  await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(8000);

  // 打开「新建」弹窗
  for (const label of ['新增分组', '新建分组', '新增', '新建', '添加']) {
    const b = page.getByText(label, { exact: true }).first();
    if (await b.count()) { await b.click({ timeout: 5000 }).catch(() => {}); await page.waitForTimeout(2500); break; }
  }

  // 填名称（认弹窗 placeholder，别认列表搜索框）
  const inp = page.locator(`input:visible[placeholder="${NAME_PH}"]`).first();
  if (await inp.count()) await inp.fill(NAME);
  else console.log('  未找到名称输入框', NAME_PH, '— 可能弹窗结构不同，手动检查');

  // 提交（被拦截）
  for (const label of ['确 定', '确定', '保 存', '保存']) {
    const b = page.locator(`.ant-modal button:has-text("${label}"), [class*=modal] button:has-text("${label}")`).last();
    if (await b.count()) {
      await b.click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(2500);
      if (captured.length) break;
    }
  }

  console.log('\n捕获写请求:', captured.length);
  captured.forEach((c, i) => console.log(`#${i}`, c.ep, '\n  ', c.body));
  fs.writeFileSync(path.join(PATHS.BACKUP, `ui-payload_${ts}.json`), JSON.stringify(captured, null, 1), 'utf8');
  await page.screenshot({ path: path.join(PATHS.SHOTS, `ui-payload_${ts}.png`) }).catch(() => {});
  await ctx.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
