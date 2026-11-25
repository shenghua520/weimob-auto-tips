# -*- coding: utf-8 -*-
"""生成 K 列补填计划表（对象/现状/目标/依据/风险/验收）
不改数据，只产出计划供审阅。
"""
import sys, json, os, re
from collections import Counter
REPO = 'D:/workbuddy/weimob-auto-tips'

MAP = json.load(open(f'{REPO}/.scan/kcol_map_4sheets.json', encoding='utf-8'))

# 微盟各组二级分组清单（权威，106 分组树）
TREE = json.load(open(f'{REPO}/backup/106-classify-tree_2026-11-25T01-08-49.json', encoding='utf-8'))
l1_by_id = {str(x['classifyId']): x for x in TREE['l1']}
l2_by_parent = {}
for x in TREE['l2']:
    l2_by_parent.setdefault(str(x['parentId']), []).append(x)
STRIP = lambda s: re.sub(r'（兑换）$', '', s or '')

OPTS = {}
for x in TREE['l1']:
    nm = x['name']
    kids = l2_by_parent.get(str(x['classifyId']), [])
    OPTS[nm] = [STRIP(k['name']) for k in kids]

# 手动补 3 行「道道全」（微盟无编码，标题精确命中菜籽油，122 已查证）
MANUAL = {
    ('米面油品', 34): ('菜籽油', '微盟 goodsId=161785402100397 标题「道道全双低压榨菜籽油5L」L1=米面油品(兑换) L2=菜籽油；表内编码列为空'),
    ('米面油品', 35): ('菜籽油', '微盟 goodsId=161785025100397 标题「道道全原香菜籽油5L」L1=米面油品(兑换) L2=菜籽油；表内编码列为空'),
    ('米面油品', 36): ('菜籽油', '微盟 goodsId=161785219100397 标题「道道全醇香菜籽油5L」L1=米面油品(兑换) L2=菜籽油；表内编码列为空'),
}

plan = []
for grp, rows in MAP.items():
    for r in rows:
        row = r['row']
        val, basis = None, None
        if r['match'] == 'exact':
            val = r['l2']
            basis = (f"微盟 goodsId={r['goodsId']} 码={r['wei_code']} "
                     f"标题「{(r['title_wei'] or '')[:28]}」 L1={r['l1raw']} L2={r['l2']}(匹配方式:{r['how']})")
        elif (grp, row) in MANUAL:
            val, basis = MANUAL[(grp, row)]
        else:
            if grp == '少儿护理':
                val, basis = None, '微盟 1034 条商品库零命中（或属其它组），无真值→留空，单列报告'
            else:
                val, basis = None, '微盟零命中 → 留空'
        plan.append({
            'group': grp, 'row': row, 'k_now': r['k_now'], 'k_target': val,
            'action': ('保持' if r['k_now'] == val else ('清空' if val is None else ('填写' if not r['k_now'] else '覆盖'))),
            'title': r['title'], 'code': r['code'], 'spec': r['spec'], 'basis': basis,
        })

print('=' * 110)
print('K 列补填计划表（对象/现状/目标/依据/风险/验收）')
print('=' * 110)
from collections import defaultdict
byg = defaultdict(list)
for p in plan: byg[p['group']].append(p)
for g, ps in byg.items():
    fill = [p for p in ps if p['action'] == '填写']
    keep = [p for p in ps if p['action'] == '保持']
    clr = [p for p in ps if p['action'] == '清空']
    over = [p for p in ps if p['action'] == '覆盖']
    print(f'\n【{g}】共 {len(ps)} 行 → 填写 {len(fill)} / 保持 {len(keep)} / 覆盖 {len(over)} / 清空 {len(clr)}')
    print(f'  目标取值分布: {dict(Counter(p["k_target"] for p in ps if p["k_target"]))}')
    opts = OPTS.get(g, [])
    bad = [p for p in ps if p['k_target'] and p['k_target'] not in opts]
    print(f'  清单合法性: 目标值全部在微盟 {g} L2 清单内 = {not bad}' + (f'  违规: {bad}' if bad else ''))
    if keep: print(f'  保持(已等于目标): {[(p["row"], p["k_now"]) for p in keep]}')
    if over: print(f'  覆盖: {[(p["row"], p["k_now"], "→", p["k_target"]) for p in over]}')
    if clr: print(f'  清空: {[(p["row"], p["k_now"], "→", "(空)") for p in clr]}')

print(f'\n合计: {len(plan)} 行；填写 {sum(1 for p in plan if p["action"]=="填写")}，'
      f'保持 {sum(1 for p in plan if p["action"]=="保持")}，'
      f'覆盖 {sum(1 for p in plan if p["action"]=="覆盖")}，'
      f'清空 {sum(1 for p in plan if p["action"]=="清空")}')

json.dump(plan, open(f'{REPO}/.scan/kcol_fill_plan.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('\n落盘: .scan/kcol_fill_plan.json')
