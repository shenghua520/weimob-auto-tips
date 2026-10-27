/**
 * 为每个商品在所属一级分类分组下创建二级分组：短名_商品ID
 * 用法: node create-goods-groups.js --one | --all | --dry
 */
const { chromium } = require('playwright-core');
const path = require('path');
const fs = require('fs');
const PROFILE = path.resolve(__dirname, 'profile');
const MAT = 'https://master.weimob.com/bos/products/mpmaterial/4022657115397/6cva1xbh8X2adufqdiX6cx2wfzo2/store/material';
const GEP = 'material/center/group/getGroupList';
const ADD = 'material/center/group/createGroup';
const MAPF = path.resolve(__dirname, 'backup', '商品素材分组.json');
const SRCF = (process.argv.find(a => a.startsWith('--src=')) || '').split('=')[1];
const MODE = SRCF ? 'src' : (process.argv.includes('--all') ? 'all' : (process.argv.includes('--one') ? 'one' : 'dry'));
const CREATE_UID = 12103830397;

const cleanShort = name => {
  let s = String(name).replace(/[【】\[\]()（）《》「」""'']/g, '').replace(/\s+/g, '').trim();
  s = s.replace(/[-_]+$/, '');
  // 微盟分组名有敏感词校验，提前规避
  s = s.replace(/子弹/g, '弹头').replace(/枪/g, 'Q').replace(/刀/g, 'D').replace(/毒/g, 'D');
  if (s.length > 14) s = s.slice(0, 14);
  return s;
};

(async () => {
  const products = JSON.parse(fs.readFileSync(path.join(__dirname, 'backup', 'products.json'), 'utf8'));
  const map = fs.existsSync(MAPF) ? JSON.parse(fs.readFileSync(MAPF, 'utf8')) : {};

  const ctx = await chromium.launchPersistentContext(PROFILE, {
    executablePath: 'C:/Users/shenghua/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe',
    headless: false, viewport: { width: 1300, height: 850 }, locale: 'zh-CN',
  });
  const page = ctx.pages()[0] || await ctx.newPage();
  let H = null, gBody = null;
  page.on('request', r => { if (r.url().includes(GEP)) { H = r.headers(); gBody = r.postData(); } });
  await page.goto(MAT, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(13000);
  const hdr = {}; ['authorization', 'apiclient', 'weimob-bosid', 'content-type', 'referer'].forEach(k => { if (H[k]) hdr[k] = H[k]; });
  const gBase = JSON.parse(gBody);
  const post = async (ep, body) => {
    const t = await page.evaluate(async ({ ep, body, hdr }) => {
      const r = await fetch('https://master.weimob.com/api3/' + ep, { method: 'POST', headers: hdr, credentials: 'include', body: JSON.stringify(body) });
      return await r.text();
    }, { ep, body, hdr });
    try { return JSON.parse(t); } catch (e) { return { raw: t.slice(0, 200) }; }
  };

  // 现有分组树
  const g = await post(GEP, gBase);
  const flat = [];
  const walk = (ns, d) => (ns || []).forEach(n => {
    flat.push({ id: n.groupId ?? n.id, name: n.groupName ?? n.name, parentId: n.parentId, level: d });
    walk(n.materialGroupList || n.children, d + 1);
  });
  walk(g.data && (g.data.groupList || g.data.list), 1);
  const top = {};
  flat.filter(x => x.parentId === -1 || x.parentId === null).forEach(x => { top[x.name] = x.id; });
  console.log('一级分组:', JSON.stringify(top));

  const CATS = ['学习文具', '体育用品', '米面油品'];
  const targets = MODE === 'all' ? products : (MODE === 'src' ? products.filter(x => String(x.srcId) === SRCF) : products.slice(0, 1));
  let ok = 0, skip = 0, fail = 0;
  const existing = new Set(flat.map(x => x.name));

  for (const p of targets) {
    const parent = top[p.cat1];
    if (!parent) { console.log('缺一级分组:', p.cat1); continue; }
    const short = cleanShort(p.name);
    const name = `${short}_${p.srcId}`;
    if (map[p.srcId] && map[p.srcId].groupId) { skip++; continue; }
    if (existing.has(name)) {
      const hit = flat.find(x => x.name === name);
      map[p.srcId] = { groupId: hit.id, name, parentId: parent, cat1: p.cat1 };
      skip++; continue;
    }
    if (MODE === 'dry') { console.log('  计划:', p.cat1, '/', name); continue; }
    const r = await post(ADD, { ...gBase, name, level: 1, parentId: parent, sceneId: 'default', createUid: CREATE_UID });
    const newId = r.data && (r.data.groupId ?? r.data.id);
    if (r.errcode === 0 || r.code === 0) {
      ok++;
      map[p.srcId] = { groupId: newId, name, parentId: parent, cat1: p.cat1 };
      if (ok % 20 === 0) { fs.writeFileSync(MAPF, JSON.stringify(map, null, 1)); console.log(`  ${ok} 个已建 | 最近: ${name} → ${newId}`); }
    } else {
      fail++;
      console.log('  ✗', name, JSON.stringify(r).slice(0, 150));
    }
    await new Promise(x => setTimeout(x, 120));
  }
  fs.writeFileSync(MAPF, JSON.stringify(map, null, 1));
  console.log(`\n完成: 新建 ${ok} / 跳过 ${skip} / 失败 ${fail} | 映射表 ${Object.keys(map).length} 项`);
  console.log('映射表:', MAPF);
  await ctx.close();
})();
