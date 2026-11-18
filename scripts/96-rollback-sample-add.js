/**
 * 96 · 回滚小样新增残留: 删除 161785139100397 (小样回滚被守卫拦下未执行)
 * 仅删这一个明确由本次小样新增的条目; 删前确认存在, 删后回读确认消失
 */
const { cfg, launch, login, post, isOk, sleep } = require('./lib/common');
const GID = 161785139100397;
const KEEP = ['authorization','apiclient','weimob-bosid','content-type','referer','source','tcode'];
(async () => {
  const ctx = await launch({ headless: true });
  const page = ctx.pages()[0] || await ctx.newPage(); page.setDefaultTimeout(60000);
  await login(page);
  const R = `${cfg.BASE}/bos/products/ecGoodsmanage/${cfg.BOS_ID}/${cfg.KEY}`;
  const found = [];
  const onReq = r => { const u=r.url(); if(u.includes('/api3/')) found.push({ep:u.replace(cfg.BASE+'/api3/','').split('?')[0],headers:r.headers(),body:r.postData()}); };
  page.on('request', onReq);
  await page.goto(R + '/goods/pointsMall/index', { waitUntil:'domcontentloaded' });
  await page.waitForTimeout(9000);
  page.off('request', onReq);
  const T = found.filter(x=>x.ep==='mall/point/goods/queryPointGoodsListForManagement').pop();
  const H={}; KEEP.forEach(k=>{if(T.headers[k])H[k]=T.headers[k];});
  const basicInfo = T.body ? JSON.parse(T.body).basicInfo : {};
  const detailEp = 'mall/point/goods/queryPointGoodsDetailForManagement';
  // 删前确认存在
  const before = await post(page, cfg.BASE+'/api3/'+detailEp, {...JSON.parse(T.body), goodsId:GID, solutionType:2}, H);
  console.log('删前存在:', isOk(before) && !!(before.data && before.data.skuList), 'gid', GID);
  if (!isOk(before) || !before.data) { console.log('删前不存在, 无需回滚'); await ctx.close(); return; }
  // 删除
  const del = await post(page, cfg.BASE+'/api3/mall/point/goods/deletePointGoods', {
    basicInfo, solutionType:2, goodsIdList:[GID],
    i18n:{language:'zh-CN',timezone:8}, extendInfo:{refer:'goods/pointsMall/index',source:80},
  }, H);
  console.log('删除返回:', JSON.stringify(del).slice(0,200));
  await sleep(600);
  // 删后回读确认消失
  const after = await post(page, cfg.BASE+'/api3/'+detailEp, {...JSON.parse(T.body), goodsId:GID, solutionType:2}, H);
  const gone = !isOk(after) || !after.data || !(after.data.skuList||[]).length;
  console.log('删后消失:', gone);
  if (!gone) console.log('!! 警告: 删除后仍存在, 需人工处理', JSON.stringify(after).slice(0,200));
  await ctx.close();
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});
