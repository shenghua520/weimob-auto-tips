/**
 * 积分商城商品分组：按「在售商品的分组」批量归类到积分分组
 *
 * 一条命令跑完：拉数 → 建映射 → 分批提交 → 全量验收
 *
 * 用法:
 *   node 32-points-groups.js --dry      # 只看计划，不提交
 *   node 32-points-groups.js            # 执行 + 验收
 *
 * 关键约束（踩过的坑）：
 *   - goodsIdList 单次最多 50 个，必须切片
 *   - 匹配只认 goodsId，不要按标题相似度
 *   - 只调 moveGoodsToClassify，不动其他字段
 */
const path = require('path');
const fs = require('fs');

// playwright-core 可能装在 .bos-scan 下
let chromium;
try { ({ chromium } = require('playwright-core')); }
catch (e) { ({ chromium } = require(__dirname + '/../../.bos-scan/node_modules/playwright-core')); }

const DIR = __dirname;
// profile 位置自适应：本目录 / 工作区 .bos-scan / 环境变量
const PROFILE = process.env.WM_PROFILE || [
  path.resolve(DIR, 'profile'),
  path.resolve(DIR, '..', '.bos-scan', 'profile'),
  path.resolve(DIR, '..', '..', '.bos-scan', 'profile'),
].find(p => fs.existsSync(p)) || path.resolve(DIR, 'profile');
const GOODS_LIST = 'https://master.weimob.com/bos/products/ecGoodsmanage/4022657115397/6cva1xbh8X2adt8v5yX6cx2wfzo2/goods/list';
const DRY = process.argv.includes('--dry');
const BATCH = 50;

// 二级分组 → 积分一级分组
const MAP2TO1 = {
  '中性笔': '学习文具', '笔芯': '学习文具', '修正带/液': '学习文具', '卷笔刀': '学习文具',
  '学生剪刀': '学习文具', '尺规': '学习文具', '橡皮擦': '学习文具', '美术用品': '学习文具',
  '胶水类': '学习文具', '自动铅笔': '学习文具', '钢笔': '学习文具', '铅笔': '学习文具',
  '纸品': '学习文具', '作业本': '学习文具',
  '乒乓球': '体育用品', '其他体育用品': '体育用品', '排球': '体育用品', '篮球': '体育用品',
  '羽毛球': '体育用品', '足球': '体育用品', '跳绳': '体育用品',
  '五常大米': '米面油品', '亚麻籽油': '米面油品', '玉米(胚)油': '米面油品',
  '花生油': '米面油品', '菜籽油': '米面油品',
  '儿童沐浴露': '少儿护理', '儿童洗手液': '少儿护理', '儿童牙膏': '少儿护理', '儿童面霜': '少儿护理',
  '保鲜用品': '家庭日用', '卷纸/卫生纸': '家庭日用', '厨房湿巾': '家庭日用', '地板清洁剂': '家庭日用',
  '垃圾袋': '家庭日用', '抽纸/面巾纸': '家庭日用', '洁厕灵': '家庭日用', '洗衣液': '家庭日用',
  '洗洁精': '家庭日用', '消毒除菌': '家庭日用', '电蚊香液': '家庭日用', '沐浴露': '家庭日用',
  '洗发水': '家庭日用', '洗手液': '家庭日用', '洗面奶': '家庭日用', '牙膏/牙刷': '家庭日用',
  '美妆护肤': '家庭日用', '衣物柔顺剂': '家庭日用', '驱蚊水': '家庭日用',
  '课外阅读': '读物潮玩',
};

const POINT_REFER = { refer: '/bos/products/ecGoodsmanage/{bosId}/{key}/goods/pointsMall/index', source: 80 };

(async () => {
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    executablePath: 'C:/Users/shenghua/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe',
    headless: true, viewport: { width: 1500, height: 950 }, locale: 'zh-CN',
  });
  const page = ctx.pages()[0] || await ctx.newPage();
  page.setDefaultTimeout(60000);
  let H = null, lBody = null;
  page.on('request', r => { if (r.url().includes('queryGoodsListWithPageForManagement')) { H = r.headers(); lBody = r.postData(); } });
  await page.goto(GOODS_LIST, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(14000);
  if (!H) { console.log('❌ 未抓到鉴权头（登录可能失效，先跑 login-pwd.js）'); await ctx.close(); return; }
  const hdr = {}; ['authorization', 'apiclient', 'weimob-bosid', 'content-type', 'referer'].forEach(k => { if (H[k]) hdr[k] = H[k]; });
  const base = JSON.parse(lBody).basicInfo;
  const post = async (ep, body) => {
    const t = await page.evaluate(async ({ ep, body, hdr }) => {
      const r = await fetch('https://master.weimob.com/api3/' + ep, { method: 'POST', headers: hdr, credentials: 'include', body: JSON.stringify(body) });
      return await r.text();
    }, { ep, body, hdr });
    try { return JSON.parse(t); } catch (e) { return {}; }
  };
  const i18n = { language: 'zh-CN', timezone: 8 };

  // 1) 积分分组
  const cls = await post('mall/point/classify/queryPointClassifyListWithPageForManagement', {
    basicInfo: base, pageNum: 1, pageSize: 100, i18n, extendInfo: POINT_REFER,
  });
  const cusCls = (cls.data && cls.data.customPointClassifyList) || [];
  const idOf = {};
  cusCls.forEach(c => { idOf[c.name] = c.pointClassifyId; });
  console.log('积分分组:', cusCls.map(c => `${c.name}(${c.pointClassifyId})`).join(' | '));

  // 2) 积分商品
  const points = [];
  for (let pn = 1; pn <= 30; pn++) {
    const r = await post('mall/point/goods/queryPointGoodsListForManagement', {
      basicInfo: base, pageNum: pn, pageSize: 50, i18n, extendInfo: POINT_REFER, queryParameter: {},
    });
    const l = (r.data && r.data.pageList) || [];
    points.push(...l);
    if (l.length < 50) break;
  }
  console.log('积分商品:', points.length);

  // 3) 在售商品分组
  const onsale = [];
  for (let pn = 1; pn <= 40; pn++) {
    const lb = JSON.parse(lBody); lb.pageNum = pn; lb.page = pn;
    const r = await post('mall/goods/queryGoodsListWithPageForManagement', lb);
    const l = (r.data && r.data.pageList) || [];
    if (!l.length) break;
    onsale.push(...l);
    if (l.length < 20) break;
  }
  const onById = new Map(onsale.map(g => [String(g.goodsId), g]));
  console.log('在售商品:', onById.size);

  // 4) 推目标分组
  const assign = {}, noMap = [];
  points.forEach(p => {
    const o = onById.get(String(p.goodsId));
    if (!o) { noMap.push({ goodsId: p.goodsId, title: p.title, why: '在售无此商品' }); return; }
    const g2 = (o.classifyList || []).map(c => c.name || c.classifyName).filter(Boolean);
    const targets = [...new Set(g2.map(n => MAP2TO1[n]).filter(Boolean))];
    if (targets.length !== 1) { noMap.push({ goodsId: p.goodsId, title: p.title, why: `二级[${g2.join('/')}] → 一级[${targets.join('/')}]` }); return; }
    (assign[targets[0]] || (assign[targets[0]] = [])).push(p.goodsId);
  });

  console.log('\n=== 分派计划 ===');
  let total = 0;
  Object.entries(assign).sort((a, b) => b[1].length - a[1].length).forEach(([k, v]) => {
    total += v.length;
    console.log(`  ${k.padEnd(6)} ${String(v.length).padStart(4)} 个  → id ${idOf[k] || '❌'}`);
  });
  console.log(`  合计 ${total} / ${points.length}`);
  if (noMap.length) { console.log(`\n未分派 ${noMap.length} 个:`); noMap.slice(0, 10).forEach(x => console.log('  ', x.goodsId, x.title.slice(0, 22), '|', x.why)); }

  if (DRY) { console.log('\n(dry run，未提交)'); await ctx.close(); return; }

  // 5) 分批提交
  const snapshot = points.map(p => ({ goodsId: p.goodsId, cls: p.pointClassifyInfo, minPoint: p.minPoint, maxPoint: p.maxPoint, stock: p.goodsStock }));
  let ok = 0, fail = 0;
  for (const [name, ids] of Object.entries(assign)) {
    const cid = idOf[name];
    if (!cid) { console.log(`✗ 分组「${name}」无 id，跳过 ${ids.length}`); fail += ids.length; continue; }
    let done = 0;
    for (let i = 0; i < ids.length; i += BATCH) {
      const chunk = ids.slice(i, i + BATCH);
      const r = await post('mall/point/classify/moveGoodsToClassify', {
        basicInfo: base, solutionType: 2, goodsIdList: chunk.map(Number),
        pointClassifyId: cid, i18n, extendInfo: POINT_REFER,
      });
      if (String(r.errcode) === '0' || String(r.code) === '0') { ok += chunk.length; done += chunk.length; }
      else { fail += chunk.length; console.log(`✗ ${name} 第${Math.floor(i / BATCH) + 1}批:`, JSON.stringify(r).slice(0, 150)); }
      await page.waitForTimeout(900);
    }
    console.log(`✓ ${name} ← ${done}/${ids.length}`);
  }
  console.log(`\n提交完成: 成功 ${ok} / 失败 ${fail}`);

  // 6) 全量验收
  const after = [];
  for (let pn = 1; pn <= 30; pn++) {
    const r = await post('mall/point/goods/queryPointGoodsListForManagement', {
      basicInfo: base, pageNum: pn, pageSize: 50, i18n, extendInfo: POINT_REFER, queryParameter: {},
    });
    const l = (r.data && r.data.pageList) || [];
    after.push(...l);
    if (l.length < 50) break;
  }
  const wantOf = new Map();
  Object.entries(assign).forEach(([n, ids]) => ids.forEach(id => wantOf.set(String(id), n)));
  let grpOk = 0; const grpBad = []; const dist = {};
  after.forEach(p => {
    const now = p.pointClassifyInfo && p.pointClassifyInfo.name;
    dist[now] = (dist[now] || 0) + 1;
    const want = wantOf.get(String(p.goodsId));
    if (want && now === want) grpOk++; else if (want) grpBad.push({ goodsId: p.goodsId, now, want });
  });
  const snapById = new Map(snapshot.map(s => [String(s.goodsId), s]));
  const CHK = ['minPoint', 'maxPoint', 'goodsStock', 'goodsLimitNum', 'goodsAvailableNum', 'isOnline', 'isCanSell', 'sort', 'title', 'defaultImageUrl'];
  const diffs = [];
  after.forEach(p => {
    const s = snapById.get(String(p.goodsId));
    if (!s) return;
    const map = { minPoint: s.minPoint, maxPoint: s.maxPoint, goodsStock: s.stock };
    Object.entries(map).forEach(([k, v]) => { if (JSON.stringify(p[k]) !== JSON.stringify(v)) diffs.push({ goodsId: p.goodsId, field: k, before: v, after: p[k] }); });
  });

  console.log('\n=== 验收 ===');
  console.log('分组分布:', JSON.stringify(dist));
  console.log(`分组正确 ${grpOk}/${wantOf.size} | 错误 ${grpBad.length}`);
  grpBad.slice(0, 8).forEach(x => console.log(`  ✗ ${x.goodsId} 现「${x.now}」应「${x.want}」`));
  console.log(diffs.length === 0 ? '✅ 其他字段未变' : `⚠ 其他字段有 ${diffs.length} 处变化`);
  diffs.slice(0, 8).forEach(d => console.log(`   ${d.goodsId} ${d.field}: ${d.before} → ${d.after}`));

  fs.writeFileSync(path.join(DIR, 'backup', 'points-groups-result.json'), JSON.stringify({ assign, noMap, dist, grpOk, grpBad, diffs, snapshot }, null, 1));
  await ctx.close();
})();
