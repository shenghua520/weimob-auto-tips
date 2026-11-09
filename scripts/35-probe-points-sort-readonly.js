/**
 * 35 · 兑换商城排序机制只读探查（PROBE / 零主动业务请求）
 *
 * 目的：在动任何写操作之前，搞清三件事：
 *   1) 当前排序由什么控制：商品 sort 字段？还是页面/组件的「排序规则」配置？
 *   2) 有没有现成的「改排序」接口（只被动观察接口名，不触发写）
 *   3) 积分分组是否有层级（一级/二级），「二级分组」到底指哪个
 *
 * 只读保证：
 *   - 只 goto 页面 + 被动监听 response + 读 DOM 文本，不 post 任何业务接口
 *   - 路由守卫 abort 一切写接口
 *   - 不生成导出文件，不改动线上任何数据
 */
const path = require('path');
const fs = require('fs');
const { cfg, launch, login, stamp, PATHS } = require('./lib/common');

const POINTS_PAGE =
  `${cfg.BASE}/bos/products/ecGoodsmanage/${cfg.BOS_ID}/${cfg.KEY}/goods/pointsMall/index`;

const BLOCK = [
  'moveGoodsToClassify', 'addPointGoods', 'updatePointGoods', 'deletePointGoods',
  'addPointClassify', 'updatePointClassify', 'deletePointClassify',
  '/goods/update', '/goods/delete', '/goods/import', '/material/delete',
  '/point/goods/save', '/point/goods/batch', '/point/goods/update',
];

(async () => {
  console.log('=== 兑换商城排序机制探查（纯只读）===');
  console.log('页面:', POINTS_PAGE, '\n');

  const ctx = await launch({ headless: true });
  const page = ctx.pages()[0] || await ctx.newPage();
  page.setDefaultTimeout(60000);

  let blocked = 0;
  await page.route('**/api3/**', route => {
    const u = route.request().url();
    if (BLOCK.some(b => u.includes(b))) {
      blocked++;
      console.error('  [守卫] 阻断写接口:', u);
      return route.abort();
    }
    return route.continue();
  });

  const seen = new Map();
  page.on('response', async r => {
    const u = r.url();
    if (!u.includes('/api3/')) return;
    const name = u.split('/').pop().split('?')[0];
    if (seen.has(name)) return;
    let info = { bytes: 0, keys: [] };
    try {
      const t = await r.text();
      info.bytes = t.length;
      const j = JSON.parse(t);
      const d = j && j.data;
      if (d && typeof d === 'object') info.keys = Object.keys(d).slice(0, 25);
      // 分组层级线索
      if (name.includes('Classify') && d) {
        info.classify = {
          system: (d.systemPointClassifyList || []).map(x => ({ id: x.pointClassifyId, name: x.name, level: x.level, children: (x.childList || x.children || []).length })),
          custom: (d.customPointClassifyList || []).slice(0, 12).map(x => ({ id: x.pointClassifyId, name: x.name, level: x.level, parentId: x.parentId, children: (x.childList || x.children || []).length })),
        };
      }
    } catch (e) { info.parseErr = true; }
    seen.set(name, info);
  });

  await page.goto(POINTS_PAGE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);
  if (page.url().includes('account.weimob.com')) {
    console.log('登录中…');
    await login(page);
    await page.waitForTimeout(3000);
    await page.goto(POINTS_PAGE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(6000);
  }

  // 页面上跟「排序」有关的可见文本（含 iframe）
  const sortTexts = [];
  for (const f of page.frames()) {
    try {
      const t = await f.evaluate(() => {
        const out = [];
        const walk = el => {
          if (!el || out.length > 60) return;
          const txt = (el.innerText || '').trim();
          if (txt && txt.length < 40 && /排序|价格|升序|降序|拖动|拖拽/.test(txt)) out.push(txt.replace(/\s+/g, ' '));
          for (const c of el.children) if (c) walk(c);
        };
        walk(document.body);
        return [...new Set(out)];
      });
      sortTexts.push({ frame: f.url().slice(0, 110), texts: t });
    } catch (e) {}
  }

  console.log('=== 捕获到的 /api3 接口台账 ===');
  [...seen.entries()].forEach(([n, i]) => {
    console.log(`  ${n} | ${i.bytes} bytes${i.parseErr ? ' | 非JSON' : ''}`);
    if (i.keys.length) console.log(`     data keys: ${i.keys.join(', ')}`);
    if (i.classify) console.log('     分组结构:', JSON.stringify(i.classify).slice(0, 900));
  });

  console.log('\n=== 页面含「排序/价格/拖拽」的文本 ===');
  sortTexts.forEach(x => {
    if (x.texts.length) console.log(`  [${x.frame}]`);
    x.texts.forEach(t => console.log('    ·', t));
  });
  if (!sortTexts.some(x => x.texts.length)) console.log('  （未发现排序相关 UI 文本）');

  console.log('\n=== 页面 iframe ===');
  page.frames().forEach(f => console.log('  ', f.url().slice(0, 160)));

  console.log('\n被阻断写接口次数:', blocked);
  console.log('=== 探查结束：未发任何主动业务请求，线上零改动 ===');
  await ctx.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
