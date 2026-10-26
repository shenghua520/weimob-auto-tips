/**
 * 00 · 接口台账自动采集
 *
 * 用途：手动把后台各模块点一遍，脚本自动记录所有 api3 请求（URL + body + 头），
 *      生成 out/api-inventory.json / out/API_清单.md，作为写文档和二次开发的底稿。
 *
 * 用法：
 *   node scripts/00-sniff-api.js              # 打开首页，人工点菜单，按 Ctrl+C 结束并落盘
 *   node scripts/00-sniff-api.js --auto       # 自动遍历顶部导航 14 个模块（更快，但可能漏）
 *
 * 产出：
 *   out/api-inventory.json   { endpoints:[{url, method, body, hits, sampleResp}] , codes:[...] }
 *   out/API_清单.md           按域分组的 Markdown 表格
 */
const fs = require('fs');
const path = require('path');
const { cfg, launch, login, PATHS } = require('./lib/common');

const AUTO = process.argv.includes('--auto');
const HOME = `${cfg.BASE}/bos/products/home/${cfg.BOS_ID}/${cfg.KEY}/dashbord/index`;

const store = new Map();   // key: method+url -> { method, url, body, hits, headers, resp }
const codes = new Set();

(async () => {
  const ctx = await launch();
  const page = ctx.pages()[0] || await ctx.newPage();
  page.setDefaultTimeout(60000);

  page.on('response', async r => {
    const u = r.url();
    if (!u.includes('/api3/')) return;
    try {
      const req = r.request();
      const body = req.postData() || '';
      const key = req.method() + ' ' + u.split('?')[0];
      const prev = store.get(key);
      if (prev) { prev.hits++; return; }
      let sampleResp = '';
      try {
        const t = await r.text();
        sampleResp = t.slice(0, 300);
        // 顺手收集权限码
        const m = t.match(/"[a-zA-Z0-9]+#[a-zA-Z0-9_.]+"/g) || [];
        m.forEach(x => codes.add(x.replace(/"/g, '')));
      } catch (e) {}
      store.set(key, {
        method: req.method(),
        url: u.split('?')[0],
        body: body.slice(0, 2000),
        hits: 1,
        headers: Object.fromEntries(Object.entries(req.headers()).filter(([k]) =>
          ['authorization', 'apiclient', 'weimob-bosid', 'apipath'].includes(k))),
        sampleResp,
      });
    } catch (e) {}
  });

  const dump = (reason) => {
    const endpoints = Array.from(store.values()).sort((a, b) => a.url.localeCompare(b.url));
    const out = { generatedAt: new Date().toISOString(), reason, total: endpoints.length, endpoints, codes: Array.from(codes).sort() };
    fs.writeFileSync(path.join(PATHS.OUT, 'api-inventory.json'), JSON.stringify(out, null, 1), 'utf8');

    // 按域分组出 Markdown
    const byDomain = {};
    endpoints.forEach(e => {
      const rel = e.url.replace(cfg.BASE + '/api3/', '');
      const d = rel.split('/').slice(0, 3).join('/');
      (byDomain[d] = byDomain[d] || []).push(rel);
    });
    const md = ['# API 清单（自动采集）', '', `> 采集于 ${out.generatedAt}｜接口 ${endpoints.length} 个｜权限码 ${out.codes.length} 条`, ''];
    Object.keys(byDomain).sort().forEach(d => {
      md.push(`## ${d}（${byDomain[d].length}）`, '', '| 接口 |', '|---|');
      byDomain[d].forEach(u => md.push(`| \`${u}\` |`));
      md.push('');
    });
    fs.writeFileSync(path.join(PATHS.OUT, 'API_清单.md'), md.join('\n'), 'utf8');

    console.log(`\n已落盘：接口 ${endpoints.length} 个 / 权限码 ${out.codes.length} 条`);
    console.log('  out/api-inventory.json');
    console.log('  out/API_清单.md');
    Object.keys(byDomain).sort().forEach(d => console.log(`  ${d}: ${byDomain[d].length}`));
  };

  await page.goto(HOME, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);
  if (page.url().includes('account.weimob.com')) {
    await login(page);
    await page.goto(HOME, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(6000);
  }

  if (AUTO) {
    const mods = await page.evaluate(() => Array.from(
      document.querySelectorAll('.weimob-components-nav-list-index-navList li a')
    ).map(a => ({ name: a.innerText.trim(), href: a.getAttribute('href') })));
    console.log('自动遍历', mods.length, '个模块（只加载首页，子页面仍需手动点）');
    for (const m of mods) {
      await page.goto(m.href, { waitUntil: 'domcontentloaded' }).catch(() => {});
      await page.waitForTimeout(4000);
      console.log('  ' + m.name + ' | 累计接口 ' + store.size);
    }
    dump('auto');
    await ctx.close();
  } else {
    console.log('浏览器已打开，开始人工点菜单。');
    console.log('点完后回到这里按 Ctrl+C，会先落盘再退出。');
    process.on('SIGINT', () => { dump('manual'); process.exit(0); });
  }
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
