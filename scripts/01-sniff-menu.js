/**
 * 01 · 抓全量菜单树
 *
 * 原理：顶部导航每切一个模块，就会请求一次 queryCacheableMenus。
 *      遍历 14 个入口，收集所有响应，按内容 md5 去重。
 *
 * 产出：out/menus-raw.json     原始树数组（每棵含 menus + 来源 URL）
 *      out/modules.json       顶部导航入口清单
 */
const fs = require('fs');
const path = require('path');
const { cfg, launch, login, PATHS, stamp } = require('./lib/common');

const HOME = `${cfg.BASE}/bos/products/home/${cfg.BOS_ID}/${cfg.KEY}/dashbord/index`;
const EP = 'queryCacheableMenus';

(async () => {
  const ctx = await launch();
  const page = ctx.pages()[0] || await ctx.newPage();
  page.setDefaultTimeout(60000);

  await page.goto(HOME, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);
  if (page.url().includes('account.weimob.com')) {
    await login(page);
    await page.goto(HOME, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(5000);
  }

  const store = new Map(); // hash -> { menus, from }
  page.on('response', async r => {
    if (!r.url().includes(EP)) return;
    const body = await r.text().catch(() => '');
    if (!body || body.length < 500) return;
    try {
      const j = JSON.parse(body);
      const menus = j?.data?.menus;
      if (!Array.isArray(menus) || !menus.length) return;
      const key = JSON.stringify(menus).length + ':' + menus.map(m => m.name).join('|');
      if (!store.has(key)) store.set(key, { menus, codeList: j.data.codeList || [], total: body.length });
    } catch (e) {}
  });

  // 顶部导航入口（含「应用」）
  const mods = await page.evaluate(() => {
    const nav = document.querySelector('.weimob-components-nav-list-index-navList');
    const list = nav ? Array.from(nav.querySelectorAll('li a')).map(a => ({ name: a.innerText.trim(), href: a.getAttribute('href') })) : [];
    const app = Array.from(document.querySelectorAll('a')).find(a => a.innerText.trim() === '应用');
    if (app) list.push({ name: '应用', href: app.getAttribute('href') });
    return list;
  });
  console.log('顶部导航入口:', mods.length, mods.map(m => m.name).join(','));
  fs.writeFileSync(path.join(PATHS.OUT, 'modules.json'), JSON.stringify(mods, null, 1), 'utf8');

  for (const m of mods) {
    await page.goto(m.href, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForTimeout(3500);
    console.log('  已加载', m.name, '| 累计菜单树', store.size);
  }

  const arr = Array.from(store.values());
  fs.writeFileSync(path.join(PATHS.OUT, `menus-raw_${stamp()}.json`), JSON.stringify(arr, null, 1), 'utf8');
  fs.writeFileSync(path.join(PATHS.OUT, 'menus-raw.json'), JSON.stringify(arr, null, 1), 'utf8');

  const count = ns => ns.reduce((a, n) => a + 1 + (n.children ? count(n.children) : 0), 0);
  console.log('\n去重后菜单树:', arr.length, '棵');
  arr.forEach((t, i) => console.log(`  [${i}] ${t.menus.length} 个一级组 / ${count(t.menus)} 节点 | ${t.menus.map(m => m.name).join(' / ')}`));

  await ctx.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
