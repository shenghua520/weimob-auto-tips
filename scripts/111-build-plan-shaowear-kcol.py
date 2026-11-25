# -*- coding: utf-8 -*-
"""生成 111 写入计划（plan 表）：行 → K 值 + 依据；含写前快照指纹"""
import json, csv, io, hashlib, collections

REPO = 'D:/workbuddy/weimob-auto-tips'
det = json.load(open(f'{REPO}/backup/103-target-details_2026-11-25T00-59-55.json', encoding='utf-8'))['details']
tree = json.load(open(f'{REPO}/backup/106-classify-tree_2026-11-25T01-08-49.json', encoding='utf-8'))
plan = json.load(open(f'{REPO}/.scan/shaowear_plan_final.json', encoding='utf-8'))
l1 = {str(x['classifyId']): x for x in tree['l1']}
l2map = {str(x['classifyId']): x for x in tree['l2']}


def bases(d):
    out = []
    for c in (d.get('classifyList') or []):
        cid = str(c.get('classifyId'))
        if cid in l2map:
            out.append({'name': l2map[cid]['name'], 'base': l2map[cid]['name'].replace('（兑换）', ''),
                        'parent': l1.get(str(l2map[cid].get('parentId')), {}).get('name'),
                        'cid': cid})
    return out


gidmap = {str(d['goodsId']): d for d in det}
txt = open(f'{REPO}/.scan/shaowear_before_000004.csv', encoding='utf-8').read()
rows = list(csv.reader(io.StringIO(txt)))
mapped = {p['row']: p for p in plan['plan']}
unmatched = {u['row']: u for u in plan['unmatched']}

# 微盟健康体态商品的名称索引（用于未匹配行的名称级证据）
bytitle = {}
for d in det:
    b = bases(d)
    for x in b:
        if x['base'] == '健康体态':
            bytitle.setdefault(d['title'], []).append((str(d['goodsId']), x['name'], x['parent']))

vals, notes = [], []
for i, r in enumerate(rows[1:137], start=1):
    er = i + 1                       # Excel 行号
    seq = (r[0] or '').strip()
    name = (r[1] or '').strip()
    old_k = (r[10] or '').strip()
    p = mapped.get(er)
    u = unmatched.get(er)
    val, basis, gid = None, None, None
    if p:
        d = gidmap.get(str(p['gid']))
        b = [x for x in bases(d) if x['parent'] and '少儿穿戴' in x['parent']]
        val = b[0]['base']
        gid = str(p['gid'])
        basis = f"SKU级匹配(编码/名称+规格)→微盟 gid={gid} {d['title'][:22]} → {b[0]['name']}({b[0]['parent']})"
    elif u:
        hits = bytitle.get(name, [])
        if hits:
            val = '健康体态'
            gid = hits[0][0]
            basis = f"名称完全一致→微盟 gid={gid} {hits[0][1]}({hits[0][2]})"
        else:
            val = '健康体态'
            basis = '微盟商品库1034条无同名商品(防蓝光零命中)、规格亦不匹配T046ET → 按品类归组：微盟护眼/矫姿类均在健康体态【推断】'
    assert val in ('书包', '健康体态'), (er, val)
    vals.append({'row': er - 1, 'excel_row': er, 'col': 10, 'value': val, 'value_type': 'STRING',
                 'seq': seq, 'name': name, 'old_value': old_k, 'gid': gid, 'basis': basis})

# 字段说明：二级分组·少儿穿戴 列(F, idx5) 补「健康体态」
f = list(csv.reader(io.StringIO(open(f'{REPO}/.scan/shaowear_before_00000a.csv', encoding='utf-8').read())))
col_f = [(i, (r[5] if len(r) > 5 else '').strip()) for i, r in enumerate(f)]
filled = [(i, v) for i, v in col_f if v]
first_empty = next(i for i, v in col_f if not v and i >= 41)
print('F 列已填项:', filled)
print('F 列第一个空行(0基):', first_empty, '→ Excel 行', first_empty + 1)

out = {
    'generatedAt': '2026-11-25',
    'scope': '少儿穿戴 sheet(000004) K 列(索引10) 136 个数据行 + 字段说明(00000a) 二级分组·少儿穿戴 列(索引5) 补选项',
    'allowList': [
        '000004!K2:K137 → 值 ∈ {书包, 健康体态}',
        '00000a!F52 → 「健康体态」（补下拉清单，行号 0基=51）',
    ],
    'forbidList': ['除 K 列外的任何列', '其它 8 张分表', '字段说明其它单元格', '序号/名称/价格/图片等一律不动'],
    'writeOrder': ['先补下拉清单(字段说明 F52)，再写 K 值，避免临时出现"不符合下拉选项"红标'],
    'dropdown': {'sheet': '00000a', 'col_index': 5, 'row_index': first_empty, 'excel_row': first_empty + 1,
                 'value': '健康体态', 'before': '', 'after_list': [v for _, v in filled] + ['健康体态']},
    'values': vals,
    'summary': {
        'rows': len(vals),
        '书包': sum(1 for v in vals if v['value'] == '书包'),
        '健康体态': sum(1 for v in vals if v['value'] == '健康体态'),
        'fill_empty': sum(1 for v in vals if not v['old_value']),
        'overwrite_wrong': sum(1 for v in vals if v['old_value']),
        'wrong_old_values': sorted({v['old_value'] for v in vals if v['old_value']}),
        'inferred_rows': [v['excel_row'] for v in vals if '推断' in v['basis']],
        'by_seq': dict(collections.Counter(v['seq'] for v in vals)),
    },
    'baselineFingerprint': hashlib.md5(open(f'{REPO}/.scan/shaowear_before_000004.csv', 'rb').read()).hexdigest(),
}
json.dump(out, open(f'{REPO}/.scan/shaowear_kcol_plan.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('\n=== 计划汇总 ===')
print(json.dumps(out['summary'], ensure_ascii=False, indent=1))
print('\n=== 依据分布（前 6 类）===')
c = collections.Counter()
for v in vals:
    k = v['basis'].split('→')[-1].strip() if '→' in v['basis'] else v['basis'][:30]
    c[k[:40]] += 1
for k, n in c.most_common(8):
    print(f'  {n:>4}  {k}')
print('\n=== 写入样例（前3 + 后3）===')
for v in vals[:3] + vals[-3:]:
    print(f"  行{v['excel_row']} 序号{v['seq']} {v['name'][:24]} K:{v['old_value']!r}→{v['value']} | {v['basis'][:70]}")
