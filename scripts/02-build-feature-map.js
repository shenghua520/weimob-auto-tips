/**
 * 02 · 菜单树归类 + 生成可检索功能地图
 *
 * 输入：out/menus-raw.json（由 01-sniff-menu.js 产生）
 * 产出：
 *   out/feature-map.json    按模块分组的树
 *   out/feature-leaf.json   扁平叶节点（module / path / name / url / authCode）
 *   微盟后台功能地图.html    可搜索、可展开、带直达链接的离线地图
 *   微盟后台功能地图.md      速查表 + 完整树
 *
 * 关键：模块归属看「根节点的 productCode」，不是看树里最多的 code。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PATHS, stamp } = require('./lib/common');

const trees = JSON.parse(fs.readFileSync(path.join(PATHS.OUT, 'menus-raw.json'), 'utf8'));

// 根节点 productCode → 模块名
const ROOT2MODULE = {
  home: '店铺', mpcms: '店铺',
  ecOrder: '商城', ecGoods: '商城', ecPlatform: '商城',
  onecrm: 'CRM', staff: '员工',
  wosheading: '供应链', wosheadingsop: '店务', wosheadingpos: '收银',
  ecTweeter: '分销', mkmarketing: '营销', sente: '数据', im: '客服',
  mav2: 'CDP', mkPromotionLive: '内容',
};

const MOD_ORDER = ['店铺', '商城', 'CRM', '员工', '供应链', '店务', '收银', '分销', '营销', '推广', '数据', '客服', 'CDP', '内容'];

const META = {
  店铺: '店铺主站：装修、财务、素材、消息、组织账号权限、风控',
  商城: '商品与交易：订单、售后、库存、在售商品、商城设置',
  CRM: '客户与会员：客户360、会员体系、积分/储值、券码、数据洞察',
  员工: '员工与排班：员工列表、排班、作品案例',
  供应链: '总部商品与采购：商品、采购、库存、财务对账、报表',
  店务: '门店侧运营：门店、商品、价格、店务、订单',
  收银: 'POS 收银机配置、设备、支付、授权、监控日志',
  分销: '微客分销：微客、客户、推广工具、业绩激励',
  营销: '营销中心与营销日历/活动管理',
  数据: '数据看板、自助取数、管理中心',
  客服: '客服工作台、会话、质检、智能客服、统计',
  CDP: 'CDP 流程看板',
  内容: '直播、小程序直播、文章、内容营销',
  应用: '应用市场与已购应用',
};

/** 树里第一个带 url 的节点 → 取 productCode */
const firstUrl = ns => {
  for (const n of ns) {
    if (n.url) return n.url;
    if (n.children) { const r = firstUrl(n.children); if (r) return r; }
  }
  return '';
};
const countNodes = n => 1 + (n.children ? n.children.reduce((a, c) => a + countNodes(c), 0) : 0);

// 按内容去重（店铺/推广/数据 共用 home 产品线，会重复抓到同一棵树）
const seen = new Set();
const flat = [];
const outTrees = [];

for (const t of trees) {
  const h = crypto.createHash('md5').update(JSON.stringify(t.menus)).digest('hex');
  if (seen.has(h)) continue;
  seen.add(h);

  const code = (firstUrl(t.menus).match(/bos\/products\/([^/]+)\//) || [])[1] || '?';
  const mod = ROOT2MODULE[code] || code;

  const conv = (n, crumbs) => {
    const p = [...crumbs, n.name];
    const node = { name: n.name, url: n.url || '', authCode: n.authCode || '' };
    if (n.children && n.children.length) node.children = n.children.map(c => conv(c, p));
    else flat.push({ module: mod, group: p[0], name: n.name, path: p.join(' > '), url: n.url || '', authCode: n.authCode || '' });
    return node;
  };

  outTrees.push({
    module: mod,
    code,
    nodes: t.menus.reduce((a, n) => a + countNodes(n), 0),
    menu: t.menus.map(n => conv(n, [])),
  });
}

outTrees.sort((a, b) => MOD_ORDER.indexOf(a.module) - MOD_ORDER.indexOf(b.module));

fs.writeFileSync(path.join(PATHS.OUT, 'feature-map.json'), JSON.stringify(outTrees, null, 1), 'utf8');
fs.writeFileSync(path.join(PATHS.OUT, 'feature-leaf.json'), JSON.stringify(flat, null, 1), 'utf8');

console.log('模块树:', outTrees.length, '| 功能入口:', flat.length);
outTrees.forEach(t => console.log(`  ${t.module} (${t.code}) ${t.nodes} 节点 | ${t.menu.map(m => m.name).join(' / ')}`));

// ---------- 高频需求速查（可按你的业务改） ----------
const QUICK = [
  ['设置/修改邮费模板（运费模板）', '商城', '配送设置', '商家配送', ' → 页签「运费模板管理」'],
  ['给某个商品加邮费', '商城', '在售商品', '商品列表', ' → 编辑 → 支付信息 → 运费模板'],
  ['改商品价格 / 上下架', '商城', '在售商品', '商品列表'],
  ['发货 / 查物流', '商城', '订单管理', '发货管理'],
  ['订单退款 / 售后', '商城', '售后管理', '售后订单'],
  ['查库存', '商城', '库存查询', '库存查询'],
  ['查客户 / 客户360', 'CRM', '客户管理', '客户列表'],
  ['积分规则 / 流水', 'CRM', '积分管理', '基础积分规则'],
  ['储值规则 / 流水', 'CRM', '储值管理', '储值规则'],
  ['优惠券管理', 'CRM', '优惠券', '店铺优惠券'],
  ['交易对账 / 分账', '店铺', '交易对账', '线上交易'],
  ['开发票 / 电票配置', '店铺', '发票管理', '开票管理'],
  ['提现 / 应付账单', '店铺', '应付管理', '提现管理'],
  ['改页面 / 店铺装修', '店铺', '页面管理', '自定义页面'],
  ['员工账号与权限', '店铺', '账号权限', '账号管理'],
  ['店铺基础信息', '店铺', '店铺设置', '店铺信息'],
  ['导购 / 员工管理', '员工', '员工管理', '员工列表'],
  ['门店管理', '店务', '门店管理', '门店列表'],
  ['分销微客', '分销', '微客管理', '微客列表'],
  ['数据看板', '数据', '数据看板 > 公共', '实时访客'],
];

const resolveQuick = QUICK.map(([label, mod, pk, nk, suffix]) => {
  const best = flat.find(l => l.module === mod && l.path.includes(pk) && (!nk || l.name.includes(nk)))
    || flat.find(l => l.module === mod && l.path.includes(pk))
    || flat.find(l => l.module === mod && l.name.includes(nk || pk));
  return { label, mod, path: (best ? best.path : '（未匹配）') + (suffix || ''), url: best ? best.url : '' };
});

// ---------- Markdown ----------
const md = [];
md.push('# 微盟后台功能地图');
md.push('');
md.push(`> 采集方式：读取后台菜单接口 \`queryCacheableMenus\`（只读）  采集时间：${new Date().toLocaleString('zh-CN')}`);
md.push(`> 规模：${outTrees.length} 个模块 / ${flat.length} 个功能入口`);
md.push('');
md.push('## 一、高频需求速查');
md.push('');
md.push('| 我想… | 菜单位置 | 直达 |');
md.push('|---|---|---|');
resolveQuick.forEach(q => md.push(`| ${q.label} | ${q.path} | ${q.url ? '[打开](' + q.url + ')' : '—'} |`));
md.push('');
md.push('## 二、完整菜单树');
md.push('');
for (const t of outTrees) {
  md.push(`### ${t.module}（${t.code}）`);
  md.push('');
  if (META[t.module]) { md.push(META[t.module]); md.push(''); }
  const walk = (ns, d) => {
    for (const n of ns) {
      const pad = '  '.repeat(d);
      if (n.children && n.children.length) { md.push(`${pad}- **${n.name}**`); walk(n.children, d + 1); }
      else md.push(`${pad}- ${n.name}${n.url ? ' — ' + n.url : ''}`);
    }
  };
  walk(t.menu, 0);
  md.push('');
}
const rootDir = path.resolve(__dirname, '..');
fs.writeFileSync(path.join(rootDir, '微盟后台功能地图.md'), md.join('\n'), 'utf8');

// ---------- HTML（单文件、可搜索） ----------
const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>微盟后台功能地图</title>
<style>
*{box-sizing:border-box}:root{--bg:#f5f6f8;--card:#fff;--line:#e6e8eb;--text:#1f2328;--sub:#656d76;--accent:#2563eb;--soft:#eff4ff}
body{margin:0;font-family:system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;background:var(--bg);color:var(--text);font-size:14px;line-height:1.6}
header{padding:18px 28px 14px;background:var(--card);border-bottom:1px solid var(--line);position:sticky;top:0;z-index:20}
h1{margin:0 0 4px;font-size:19px;font-weight:650}.sub{color:var(--sub);font-size:12.5px}
.toolbar{display:flex;gap:10px;margin-top:12px;flex-wrap:wrap}
#q{flex:1;min-width:220px;padding:9px 12px;border:1px solid var(--line);border-radius:8px;font-size:14px;outline:none;background:#fbfcfd}
#q:focus{border-color:var(--accent);background:#fff;box-shadow:0 0 0 3px var(--soft)}
.btn{padding:8px 12px;border:1px solid var(--line);background:#fff;border-radius:8px;cursor:pointer;font-size:13px}
.layout{display:flex;align-items:flex-start}
nav{width:200px;flex:0 0 200px;padding:16px 10px 40px;position:sticky;top:105px;max-height:calc(100vh - 105px);overflow:auto}
.mod{display:flex;justify-content:space-between;padding:7px 10px;border-radius:8px;cursor:pointer;font-size:13.5px}
.mod:hover{background:#eceef2}.mod.on{background:var(--soft);color:var(--accent);font-weight:600}
.mod .n{font-size:11.5px;color:var(--sub)}
main{flex:1;padding:16px 28px 60px;min-width:0}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px 18px;margin-bottom:14px}
.mhead h2{margin:0;font-size:16px}.mhead .tag{font-size:11.5px;color:var(--sub);margin-left:8px}
.desc{color:var(--sub);font-size:12.5px;margin:2px 0 12px}
ul.tree,ul.tree ul{list-style:none;margin:0;padding:0}
ul.tree ul{margin-left:14px;border-left:1px solid #eef0f3;padding-left:12px}
.node>.row{display:flex;align-items:center;gap:7px;padding:4px 6px;border-radius:6px;cursor:pointer}
.node>.row:hover{background:#f7f8fa}.tw{width:14px;color:#9aa2ad;font-size:10px;flex:0 0 14px}
.leaf>.row{cursor:default}.node.collapsed>ul{display:none}
.grp>.row .nm{font-weight:600}
a.go{font-size:11.5px;color:var(--accent);text-decoration:none;opacity:0}
.leaf>.row:hover a.go{opacity:1}
mark{background:#fff3b0;padding:0 1px;border-radius:2px}
.hit{background:#fff;border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin-bottom:8px}
.hit .p{color:var(--sub);font-size:12px}.hit .t{font-weight:600}
table.quick{width:100%;border-collapse:collapse;font-size:13px}
table.quick th{text-align:left;color:var(--sub);font-weight:500;font-size:12px;padding:6px 8px;border-bottom:1px solid var(--line)}
table.quick td{padding:6px 8px;border-bottom:1px solid #f2f4f6}
table.quick td.k{font-weight:600;white-space:nowrap}table.quick td.p{color:var(--sub);font-size:12.5px}
</style></head><body>
<header><h1>微盟后台功能地图</h1><div class="sub" id="stat"></div>
<div class="toolbar"><input id="q" placeholder="搜索功能名 / 路径，例如：积分 储值 对账 发票 运费 退款"/>
<button class="btn" id="expandAll">全部展开</button><button class="btn" id="collapseAll">全部收起</button></div></header>
<div class="layout"><nav id="nav"></nav><main id="main"></main></div>
<script>
const DATA=${JSON.stringify(outTrees)};
const META=${JSON.stringify(META)};
const LEAVES=${JSON.stringify(flat)};
const QUICK=${JSON.stringify(resolveQuick)};
const ORDER=${JSON.stringify(MOD_ORDER)};
let cur='全部';
const cnt=n=>(!n.children||!n.children.length)?1:n.children.reduce((a,c)=>a+cnt(c),0);
const modCnt={};DATA.forEach(t=>modCnt[t.module]=(modCnt[t.module]||0)+t.menu.reduce((a,n)=>a+cnt(n),0));
const total=Object.values(modCnt).reduce((a,b)=>a+b,0);
document.getElementById('stat').textContent='共 '+DATA.length+' 个模块 · '+total+' 个功能入口';
const nav=document.getElementById('nav'),main=document.getElementById('main');
function renderNav(){
 nav.innerHTML='';
 [['全部',total]].concat(ORDER.filter(m=>modCnt[m]).map(m=>[m,modCnt[m]])).forEach(([m,c])=>{
  const d=document.createElement('div');d.className='mod'+(cur===m?' on':'');
  d.innerHTML='<span>'+m+'</span><span class="n">'+c+'</span>';
  d.onclick=()=>{cur=m;renderNav();renderMain();};nav.appendChild(d);});
}
function hi(s,q){if(!q)return s;const i=s.toLowerCase().indexOf(q.toLowerCase());
 if(i<0)return s;return s.slice(0,i)+'<mark>'+s.slice(i,i+q.length)+'</mark>'+s.slice(i+q.length);}
function nodeEl(n,q){
 const leaf=!(n.children&&n.children.length);
 const li=document.createElement('li');li.className='node '+(leaf?'leaf':'grp');
 if(!leaf)li.classList.add('collapsed');
 const row=document.createElement('div');row.className='row';
 const tw=document.createElement('span');tw.className='tw';tw.textContent=leaf?'':'▸';row.appendChild(tw);
 const nm=document.createElement('span');nm.className='nm';nm.innerHTML=hi(n.name,q);row.appendChild(nm);
 if(leaf&&n.url){const a=document.createElement('a');a.className='go';a.textContent='打开';a.href=n.url;a.target='_blank';row.appendChild(a);}
 li.appendChild(row);
 if(!leaf){const ul=document.createElement('ul');n.children.forEach(c=>ul.appendChild(nodeEl(c,q)));li.appendChild(ul);
  row.onclick=()=>{li.classList.toggle('collapsed');tw.textContent=li.classList.contains('collapsed')?'▸':'▾';};}
 return li;
}
function renderQuick(){
 const card=document.createElement('div');card.className='card';
 card.innerHTML='<div class="mhead"><h2>高频需求速查</h2></div><div class="desc">我想做什么 → 去哪</div>';
 const tb=document.createElement('table');tb.className='quick';
 tb.innerHTML='<thead><tr><th style="width:200px">我想…</th><th>菜单位置</th><th style="width:60px"></th></tr></thead>';
 const body=document.createElement('tbody');
 QUICK.forEach(x=>{const tr=document.createElement('tr');
  tr.innerHTML='<td class="k">'+x.label+'</td><td class="p">'+x.path+'</td><td>'+(x.url?'<a class="go" style="opacity:1" target="_blank" href="'+x.url+'">打开</a>':'—')+'</td>';
  body.appendChild(tr);});
 tb.appendChild(body);card.appendChild(tb);main.appendChild(card);
}
function renderMain(){
 const q=document.getElementById('q').value.trim();
 main.innerHTML='';
 if(q){
  const ql=q.toLowerCase();
  const hits=LEAVES.filter(l=>(l.name+l.path).toLowerCase().includes(ql)&&(cur==='全部'||l.module===cur));
  if(!hits.length){main.innerHTML='<div class="desc">没有匹配「'+q+'」的功能</div>';return;}
  const tip=document.createElement('div');tip.className='desc';tip.textContent='找到 '+hits.length+' 个功能';main.appendChild(tip);
  hits.slice(0,300).forEach(l=>{const d=document.createElement('div');d.className='hit';
   d.innerHTML='<div class="p">'+l.module+' · '+hi(l.path,q)+'</div><div class="t">'+hi(l.name,q)+
   '<a class="go" style="opacity:1;margin-left:8px" target="_blank" href="'+l.url+'">打开</a></div>';
   main.appendChild(d);});
  return;
 }
 if(cur==='全部')renderQuick();
 DATA.filter(t=>cur==='全部'||t.module===cur).forEach(t=>{
  const card=document.createElement('div');card.className='card';
  card.innerHTML='<div class="mhead"><h2>'+t.module+'<span class="tag">'+t.code+' · '+
    t.menu.reduce((a,n)=>a+cnt(n),0)+' 项</span></h2></div><div class="desc">'+(META[t.module]||'')+'</div>';
  const ul=document.createElement('ul');ul.className='tree';t.menu.forEach(n=>ul.appendChild(nodeEl(n,'')));card.appendChild(ul);
  main.appendChild(card);});
}
document.getElementById('q').addEventListener('input',renderMain);
document.getElementById('expandAll').onclick=()=>document.querySelectorAll('.node.grp').forEach(n=>{n.classList.remove('collapsed');const t=n.querySelector('.tw');if(t)t.textContent='▾';});
document.getElementById('collapseAll').onclick=()=>document.querySelectorAll('.node.grp').forEach(n=>{n.classList.add('collapsed');const t=n.querySelector('.tw');if(t)t.textContent='▸';});
renderNav();renderMain();
</script></body></html>`;

fs.writeFileSync(path.join(rootDir, '微盟后台功能地图.html'), html, 'utf8');
console.log('\n已生成：微盟后台功能地图.html / .md');
