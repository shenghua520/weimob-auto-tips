/**
 * 商品补充同步：视频关联 + 副标题补全 + 图文详情样式加固
 * 用法: node sync-goods.js --src=3124 [--dry]  |  --all [--limit=N]
 */
const { chromium } = require('playwright-core');
const path = require('path');
const fs = require('fs');

const DIR = __dirname;
const PROFILE = path.resolve(DIR, 'profile');
const LIST = 'https://master.weimob.com/bos/products/ecGoodsmanage/4022657115397/6cva1xbh8X2adt8v5yX6cx2wfzo2/goods/list';
const SRC = (process.argv.find(a => a.startsWith('--src=')) || '').split('=')[1];
const LIMIT = Number((process.argv.find(a => a.startsWith('--limit=')) || '').split('=')[1] || 0);
const ALL = process.argv.includes('--all');
const DRY = process.argv.includes('--dry');

const products = JSON.parse(fs.readFileSync(path.join(DIR, 'backup', 'products.json'), 'utf8'));
const urls = JSON.parse(fs.readFileSync(path.join(DIR, 'backup', '素材URL映射.json'), 'utf8'));
const vmap = fs.existsSync(path.join(DIR, 'backup', '视频URL映射.json'))
  ? JSON.parse(fs.readFileSync(path.join(DIR, 'backup', '视频URL映射.json'), 'utf8')) : {};
const idx = JSON.parse(fs.readFileSync(path.join(DIR, 'backup', '商品ID映射.json'), 'utf8'));
const tpl = JSON.parse(fs.readFileSync(path.join(DIR, 'out', 'save-goods-body.json'), 'utf8'));

const TITLE_MAX = 58;
// 详情图样式：小程序 rich-text 不认 max-width，必须显式 width:100%
const imgTag = u => `<p style="margin:0;padding:0;text-align:center"><img src="${u}" style="width:100%;max-width:100%;height:auto;display:block;border:0"/></p>`;

(async () => {
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    executablePath: 'C:/Users/shenghua/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe',
    headless: false, viewport: { width: 1400, height: 900 }, locale: 'zh-CN',
  });
  const page = ctx.pages()[0] || await ctx.newPage();
  let H = null, lBody = null;
  page.on('request', r => { if (r.url().includes('queryGoodsListWithPageForManagement')) { H = r.headers(); lBody = r.postData(); } });
  await page.goto(LIST, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(12000);
  const hdr = {}; ['authorization', 'apiclient', 'weimob-bosid', 'content-type', 'referer'].forEach(k => { if (H[k]) hdr[k] = H[k]; });
  const base = JSON.parse(lBody).basicInfo;
  const post = async (ep, body) => {
    const t = await page.evaluate(async ({ ep, body, hdr }) => {
      const r = await fetch('https://master.weimob.com/api3/' + ep, { method: 'POST', headers: hdr, credentials: 'include', body: JSON.stringify(body) });
      return await r.text();
    }, { ep, body, hdr });
    try { return JSON.parse(t); } catch (e) { return { raw: t.slice(0, 300) }; }
  };

  const FO = { querySelfPickupSiteShip: true, isQueryAppointmentTimeInfo: true, isQueryGoodsAbilitiesDetailInfo: true, isQueryPicInfo: true, isQueryVideoInfo: true, isQueryTagInfo: true, isQueryGoodsLimit: true, isQueryClassifyInfo: true, isQueryPropertyInfo: true, isQuerySaleInfo: true, isQueryCategoryInfo: true, isQueryBrandInfo: true, isQueryAttachInfo: true, isFilterDeleted: true, isQueryInvoiceConfig: true, isQueryGoodsStockInfo: true, isQueryGoodsPriceInfo: true, isQueryGoodsExtInfo: true, isQuerySetGoodsPriceInfo: true, isQuerySetGoodsSalesInfo: true, isQueryAutoOffline: true, isQueryAutoSell: true, isQuerySkuInfo: true, isQueryDescInfo: true, queryVidBizType: true };
  const detailBody = gid => ({ basicInfo: base, solutionType: 2, goodsId: String(gid), filterOption: FO, i18n: { language: 'zh-CN', timezone: 8 }, extendInfo: { refer: '/bos/products/ecGoodsmanage/{bosId}/{key}/goods/list', source: 80 } });

  let list = ALL ? products : products.filter(p => String(p.srcId) === String(SRC));
  if (ALL) list = list.filter(p => idx[String(p.srcId)]);
  if (LIMIT) list = list.slice(0, LIMIT);

  let ok = 0, fail = 0; const fails = [];
  for (const p of list) {
    const gid = idx[String(p.srcId)];
    if (!gid) { continue; }
    const dd = await post('mall/goods/queryGoodsDetail', detailBody(gid));
    const d = dd.data;
    if (!d || !d.goodsId) { fail++; fails.push({ srcId: p.srcId, err: '详情失败' }); continue; }

    // 1) 标题截断 + 副标题补全
    const full = p.name;
    const title = full.length > TITLE_MAX ? full.slice(0, TITLE_MAX) : full;
    const rest = full.length > TITLE_MAX ? full.slice(TITLE_MAX).replace(/^[\s/|·]+/, '').trim() : '';
    const subTitle = rest || d.subTitle || '';

    // 2) 视频
    const v = vmap[String(p.srcId)];

    // 3) 详情图样式
    const u = urls[p.srcId] || {};
    const detailU = (u.detail || []).filter(Boolean);
    const goodsImages = (u.goods || []).filter(Boolean).slice(0, 10);
    const descHtml = detailU.length ? detailU.map(imgTag).join('') : d.goodsDesc;

    const catList = d.categoryList || [];
    const lastCat = catList.length ? catList[catList.length - 1] : {};
    const gcl = (d.goodsClassifyList || []).map(c => c.classifyId);
    const body = {
      ...tpl, ...d, basicInfo: base, solutionType: 2, goodsId: gid,
      title, subTitle,
      categoryId: lastCat.categoryId || tpl.categoryId,
      categoryList: catList.length ? catList : tpl.categoryList,
      goodsClassifyList: d.goodsClassifyList || tpl.goodsClassifyList,
      goodsClassifyIdList: gcl.length ? gcl : tpl.goodsClassifyIdList,
      goodsImageUrl: goodsImages.length ? goodsImages : d.goodsImageUrl,
      defaultImageUrl: goodsImages.length ? goodsImages[0] : d.defaultImageUrl,
      goodsDesc: descHtml,
      i18n: { language: 'zh-CN', timezone: 8 },
      extendInfo: { refer: '/bos/products/ecGoodsmanage/{bosId}/{key}/goods/list', source: 80 },
    };
    if (v && v.url) { body.goodsVideoUrl = v.url; body.goodsVideoImageUrl = v.cover || ''; }
    delete body.raw;

    const tag = `图${goodsImages.length}/详${detailU.length}/副${subTitle ? subTitle.slice(0, 12) : '-'}${v ? '/视频' : ''}`;
    if (DRY) { console.log(`dry ${p.srcId} ${tag}`); continue; }
    const up = await post('mall/goods/update', body);
    if (String(up.errcode) === '0' || String(up.code) === '0') { ok++; console.log(`✓ ${p.srcId} ${String(title).slice(0, 20)} | ${tag}`); }
    else { fail++; fails.push({ srcId: p.srcId, err: JSON.stringify(up).slice(0, 200) }); console.log(`✗ ${p.srcId}`, JSON.stringify(up).slice(0, 160)); }
    await page.waitForTimeout(500);
  }
  console.log(`\n完成: 成功 ${ok} / 失败 ${fail}`);
  fs.writeFileSync(path.join(DIR, 'backup', '同步失败.json'), JSON.stringify(fails, null, 1));

  // 单商品回读
  if (!ALL && SRC) {
    const gid = idx[String(SRC)];
    const d2 = (await post('mall/goods/queryGoodsDetail', detailBody(gid))).data || {};
    console.log(`\n回读 ${SRC}: title=${d2.title}`);
    console.log('  subTitle=', d2.subTitle, '| 视频=', d2.goodsVideoUrl, '| 封面=', d2.goodsVideoImageUrl);
    console.log('  图', (d2.goodsImageUrl || []).length, '| desc', String(d2.goodsDesc || '').length, '字符');
  }
  await ctx.close();
})();
