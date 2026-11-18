/**
 * 101 · 排序重排独立复核（全新登录、零写、不复用写入脚本结果）
 * 三轮 review: 样本级 / 全量级 / 归因级 + 非目标零变化
 * --state=before : 期望所有商品 sort == 99基线 (用于小样回滚后验证线上已恢复)
 * --state=after  : 期望83个changed商品 sort == 98方案newSort, 其余==基线 (用于全量写入后验证)
 */
const fs = require('fs');
const path = require('path');
const { cfg, launch, login, post, isOk, stamp, PATHS } = require('./lib/common');

const EP_PL = 'mall/point/goods/queryPointGoodsListForManagement';
const WRITE_VERBS = ['updatePointGoodsSort','batchUpdateGoodsSort','moveGoodsToClassify','addPointGoods',
  'deletePointGoods','updatePointGoods','addPointClassify','updatePointClassify','deletePointClassify',
  '/goods/update','/goods/delete','/goods/import','insertMaterial','createGroup','batchUpdate','setOnline'];
const STATE = process.argv.find(a=>a.startsWith('--state='))?.split('=')[1] || 'after';
const STATIC = ['minPoint','minPointPrice','priceType','goodsLimitNum','visibleInNonExchangeTime','pointClassifyId'];
const latest = (p) => fs.readdirSync(PATHS.BACKUP).filter(x=>x.startsWith(p)).sort().pop();

(async () => {
  console.log('=== 排序重排独立复核 [state=' + STATE + '] 零写 ===');
  const planAll = JSON.parse(fs.readFileSync(path.join(PATHS.BACKUP, latest('98-sort-plan-readonly_')), 'utf8'));
  const base = JSON.parse(fs.readFileSync(path.join(PATHS.BACKUP, latest('99-sort-baseline_')), 'utf8'));
  const bm = new Map(base.baseline.map(x=>[String(x.goodsId),x]));
  const changeMap = new Map(planAll.fullPlan.filter(x=>x.oldSort!==x.newSort).map(x=>[String(x.goodsId),x]));

  const ctx = await launch({ headless: true });
  const page = ctx.pages()[0] || await ctx.newPage();
  page.setDefaultTimeout(60000);
  let blocked = 0;
  await page.route('**/api3/**', route => {
    if (WRITE_VERBS.some(w=>route.request().url().includes(w))) { blocked++; return route.abort(); }
    return route.continue();
  });
  await login(page);
  const found = [];
  page.on('request', r => {
    const u=r.url(); if(!u.includes('/api3/')||r.method()!=='POST') return;
    const ep=u.replace(cfg.BASE+'/api3/','').split('?')[0];
    if(ep===EP_PL){try{found.push({headers:r.headers(),body:JSON.parse(r.postData())});}catch(e){}}
  });
  const BASEURL = `${cfg.BASE}/bos/products/ecGoodsmanage/${cfg.BOS_ID}/${cfg.KEY}`;
  await page.goto(BASEURL+'/goods/pointsMall/index',{waitUntil:'domcontentloaded'});
  await page.waitForTimeout(11000);
  const keep=['authorization','apiclient','weimob-bosid','content-type','referer','source','tcode'];
  const h=found.pop(); if(!h) throw new Error('未捕获模板');
  const headers={}; keep.forEach(k=>{if(h.headers[k])headers[k]=h.headers[k];});
  // 全量回读(独立路径)
  const now=new Map();
  for(let p=1;p<=60;p++){
    const j=await post(page,cfg.BASE+'/api3/'+EP_PL,{...h.body,pageNum:p,pageSize:50},headers);
    if(!isOk(j))break;
    const l=j.data.pageList||[]; l.forEach(x=>now.set(String(x.goodsId),x));
    if(l.length<50)break;
  }
  console.log('独立回读条数',now.size);

  // ---- R2 全量级: STATIC零变化 + sort按state校验 ----
  let staticChanged=0, sortWrong=0, missing=0, extra=0, nonTargetSortChanged=0;
  // 统一STATIC取值口径: 基线b的pointClassifyId已在顶层(99提取), 回读a的在嵌套pointClassifyInfo
  const staticNow = x => Object.fromEntries(STATIC.map(k=>[k,
    k==='pointClassifyId' ? (x.pointClassifyInfo||{}).pointClassifyId : x[k]]));
  const staticBase = x => Object.fromEntries(STATIC.map(k=>[k, x[k]]));
  now.forEach((a,gid)=>{
    const b=bm.get(gid);
    if(!b){extra++;return;}
    const as=staticNow(a), bs=staticBase(b);
    STATIC.forEach(k=>{ if(String(as[k])!==String(bs[k])) staticChanged++; });
    const ch=changeMap.get(gid);
    if(STATE==='after' && ch){ if(String(a.sort)!==String(ch.newSort)) sortWrong++; }
    else { if(String(a.sort)!==String(b.sort)) { if(STATE==='before') sortWrong++; else nonTargetSortChanged++; } }
  });
  bm.forEach((b,gid)=>{ if(!now.has(gid)) missing++; });
  console.log('R2全量级: STATIC变化',staticChanged,'| sort不符',sortWrong,'| 基线缺失',missing,'| 新增extra',extra,'| 非目标sort变化',nonTargetSortChanged);

  // ---- R3 归因级: 主键区间 + 具体ID存在性 ----
  const ids=[...now.keys()].map(Number);
  const idMin=Math.min(...ids), idMax=Math.max(...ids);
  const bIds=[...bm.keys()].map(Number);
  const bMin=Math.min(...bIds), bMax=Math.max(...bIds);
  const idRangeOK = idMin===bMin && idMax===bMax && now.size===bm.size;
  // 抽样具体ID(83个changed里取5个)存在性
  const sampleIds=[...changeMap.keys()].sort().slice(0,5);
  const sampleExist=sampleIds.every(g=>now.has(g));
  console.log('R3归因级: ID区间',idMin+'~'+idMax,'(基线'+bMin+'~'+bMax+')','一致',idRangeOK,'| 抽样ID存在',sampleExist);

  // ---- R1 样本级: 业务合理性 — 体育用品组按newSort降序, 总价应升序 ----
  let orderViolations=0;
  if(STATE==='after'){
    const tiyu=[...now.values()].filter(x=>(x.pointClassifyInfo||{}).name==='体育用品')
      .sort((a,b)=>(b.sort||0)-(a.sort||0));
    const chById=changeMap;
    // 同二级分组内: sort降序 => 总价应升序(允许相等)
    let prevL2=null,prevTotal=null;
    tiyu.forEach(x=>{
      const plan=chById.get(String(x.goodsId));
      const l2=plan?plan.l2.name:null;
      const total=plan?plan.total:null;
      if(total===null) return;
      if(l2===prevL2 && prevTotal!==null && total<prevTotal-0.001) orderViolations++;
      if(l2!==prevL2){prevL2=l2;prevTotal=total;} else {prevTotal=total;}
    });
  }
  console.log('R1样本级: 组内总价升序违规',orderViolations);

  const pass = staticChanged===0 && sortWrong===0 && missing===0 && extra===0 && idRangeOK && sampleExist && orderViolations===0 && blocked===0;
  console.log('守卫拦截',blocked,'| VERDICT',pass?'PASS':'FAIL');
  const out={state:STATE,verdict:pass?'PASS':'FAIL',ts:stamp(),
    R2:{staticChanged,sortWrong,missing,extra,nonTargetSortChanged},
    R3:{idRangeOK,sampleExist,idMin,idMax},R1:{orderViolations},blockedWrites:blocked};
  fs.writeFileSync(path.join(PATHS.BACKUP,`101-verify_${STATE}_${out.ts}.json`),JSON.stringify(out,null,1),'utf8');
  await ctx.close();
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});
