# -*- coding: utf-8 -*-
"""深查：8 个未命中行在微盟商品库的真实身份（是否存在于其它组/未分组/根本不存在）"""
import sys, json, os, re
from collections import Counter
REPO = 'D:/workbuddy/weimob-auto-tips'
bf = 'backup'
f_all = sorted([x for x in os.listdir(f'{REPO}/{bf}') if x.startswith('103-goods-all_')])[-1]
allj = json.load(open(f'{REPO}/{bf}/{f_all}', encoding='utf-8'))
GOODS = allj.get('list') or allj.get('goods') or allj.get('rows') or allj
f_tree = sorted([x for x in os.listdir(f'{REPO}/{bf}') if x.startswith('106-classify-tree_')])[-1]
TREE = json.load(open(f'{REPO}/{bf}/{f_tree}', encoding='utf-8'))
l2_by_id = {str(x['classifyId']): x for x in TREE['l2']}
l1_by_id = {str(x['classifyId']): x for x in TREE['l1']}
STRIP = lambda s: re.sub(r'（兑换）$', '', s or '')
norm = lambda s: re.sub(r'\D', '', s or '')[:12]

CASES = [
    ('少儿护理', '6902022131943', '蓝月亮225ml儿童苹果洗手液'),
    ('少儿护理', '6949044606172', '青蛙王子50g蜂蜜儿童滋润霜'),
    ('少儿护理', '6949044606158', '青蛙王子50g牛奶儿童滋润霜'),
    ('少儿护理', '6949044601719', '青蛙王子175ml儿童喷雾马齿苋花露水'),
    ('少儿护理', '6949044601696', '青蛙王子195ml儿童祛痱止痒花露水'),
    ('米面油品', '', '道道全双低压榨菜籽油5L*4'),
    ('米面油品', '', '道道全原香菜籽油5L*4'),
    ('米面油品', '', '道道全醇香菜籽油5L*4'),
]

for grp, code, title in CASES:
    print(f'\n{"="*100}')
    print(f'【{grp}】编码={code!r} 标题={title!r}')
    cands = []
    if code:
        n = norm(code)
        cands = [g for g in GOODS if norm(g.get('outerGoodsCode') or '') == n]
    if not cands:
        cands = [g for g in GOODS if (g.get('title') or '').strip() == title]
    if not cands:
        # 标题包含
        cands = [g for g in GOODS if title and title in (g.get('title') or '')]
        print('  （无精确/等值命中，取标题包含候选）')
    if not cands:
        # 关键词
        kw = re.sub(r'[0-9\.\*L gmlkg包袋个只]', '', title)
        cands = [g for g in GOODS if len(kw) >= 4 and kw in (g.get('title') or '')]
        print(f'  （关键词 {kw!r} 候选 {len(cands)}）')
    for g in cands[:6]:
        cl = g.get('classifyList') or []
        l1n = l2v = l1raw = None
        if cl:
            c = cl[0]
            x = l2_by_id.get(str(c.get('classifyId')))
            p = l1_by_id.get(str(x.get('parentId'))) if x else None
            l1raw = p['name'] if p else None
            l1n = STRIP(l1raw)
            l2v = STRIP(c.get('name'))
        print(f"   · 微盟 goodsId={g.get('goodsId')} 码={g.get('outerGoodsCode')!r}")
        print(f"     标题={g.get('title')}")
        print(f"     分组: L1={l1raw}(归一 {l1n}) L2={l2v}  isDeleted={g.get('isDeleted')} isOnline={g.get('isOnline')} soldType={g.get('soldType')}")
        print(f"     规格={[s.get('specValueName') for s in (g.get('skuList') or [])][:8]}")
    if not cands:
        print('   ★ 微盟商品库 1034 条中零命中')
