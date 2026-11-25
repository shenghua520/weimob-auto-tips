# -*- coding: utf-8 -*-
"""映射分析 v2：4 张表每行 → 微盟商品 → 二级分组
修正：微盟一级分组名带「（兑换）」后缀，比对时归一化（去后缀）。
匹配优先级：EAN归一 → 内部编码 → 标题精确 → 标题包含+规格交叉
"""
import sys, json, csv, io, os, re
from collections import Counter
sys.path.insert(0, r'C:\Users\shenghua\.workbuddy\plugins\cache\workbuddy-builtin\tencent-docs-plugin\5.11.3-wb.43806934.gecace0f7.ha395516167d4\skills\tencent-docs')
import tencentdocs as td

REPO = 'D:/workbuddy/weimob-auto-tips'
FILE_ID = 'DSnVhVGdTR294UE5P'

bf = 'backup'
f_all = sorted([x for x in os.listdir(f'{REPO}/{bf}') if x.startswith('103-goods-all_')])[-1]
allj = json.load(open(f'{REPO}/{bf}/{f_all}', encoding='utf-8'))
GOODS = allj.get('list') or allj.get('goods') or allj.get('rows') or allj
f_tree = sorted([x for x in os.listdir(f'{REPO}/{bf}') if x.startswith('106-classify-tree_')])[-1]
TREE = json.load(open(f'{REPO}/{bf}/{f_tree}', encoding='utf-8'))

l2_by_id = {str(x['classifyId']): x for x in TREE['l2']}
l1_by_id = {str(x['classifyId']): x for x in TREE['l1']}
STRIP = lambda s: re.sub(r'（兑换）$', '', s or '')

def norm_ean(s):
    d = re.sub(r'\D', '', s or '')
    return d[:12] if len(d) >= 12 else d

def l2_of(g):
    cl = g.get('classifyList') or []
    if not cl: return None, None, None
    c = cl[0]
    x = l2_by_id.get(str(c.get('classifyId')))
    parent = l1_by_id.get(str(x.get('parentId'))) if x else None
    l1n = STRIP(parent['name']) if parent else None
    l1raw = parent['name'] if parent else None
    return l1n, STRIP(c.get('name')), l1raw

IDX_EAN, IDX_CODE, IDX_TITLE = {}, {}, {}
for g in GOODS:
    oc = (g.get('outerGoodsCode') or '').strip()
    if oc:
        IDX_EAN.setdefault(norm_ean(oc), []).append(g)
        IDX_CODE.setdefault(oc.upper(), []).append(g)
    t = (g.get('title') or '').strip()
    if t: IDX_TITLE.setdefault(t, []).append(g)

def csvget(sid, r0, r1, c0, c1):
    d = td.call_tool('sheet-mcp', 'get_cell_data',
                     {'file_id': FILE_ID, 'sheet_id': sid, 'start_row': r0, 'end_row': r1,
                      'start_col': c0, 'end_col': c1, 'return_csv': True}, timeout=240)[0]
    t = d.get('result', {}).get('content', [{}])[0].get('text', '{}')
    try: j = json.loads(t)
    except Exception: return []
    s = j.get('csv_data', '')
    return list(csv.reader(io.StringIO(s))) if s else []

SHEETS = [('000003', '少儿护理'), ('000005', '少儿食品'), ('000008', '米面油品'), ('000009', '家用电器')]

out = {}
for sid, nm in SHEETS:
    rows = csvget(sid, 0, 300, 0, 12)
    data = [(i, r) for i, r in enumerate(rows) if len(r) > 1 and r[0].strip() and r[0].strip() != '序号']
    print(f'\n{"="*110}\n=== {nm} ({sid}) 数据行 {len(data)} ===')
    res = []
    for i, r in data:
        code = r[3].strip() if len(r) > 3 else ''
        title = r[1].strip() if len(r) > 1 else ''
        spec = r[5].strip() if len(r) > 5 else ''
        k_now = r[10].strip() if len(r) > 10 else ''
        hit, how = None, 'none'
        for cand, tag in ((IDX_EAN.get(norm_ean(code), []), 'ean') if code else ([], 'ean'),
                          (IDX_CODE.get(code.upper(), []), 'code') if code else ([], 'code'),
                          (IDX_TITLE.get(title, []), 'title')):
            for g in cand:
                l1n, l2v, l1raw = l2_of(g)
                if l1n == nm:
                    hit, how = (g, l1n, l2v, l1raw), tag
                    break
            if hit: break
        if not hit and code:
            # 标题包含兜底
            for g in GOODS:
                gt = (g.get('title') or '').strip()
                if gt and (gt == title or (title and gt in title) or (gt and title in gt)):
                    l1n, l2v, l1raw = l2_of(g)
                    if l1n == nm:
                        hit, how = (g, l1n, l2v, l1raw), 'title-fuzzy'
                        break
        if hit:
            g, l1n, l2v, l1raw = hit
            res.append({'row': i + 1, 'code': code, 'title': title, 'spec': spec, 'k_now': k_now,
                        'l1': l1n, 'l2': l2v, 'l1raw': l1raw, 'match': 'exact', 'how': how,
                        'goodsId': g.get('goodsId'), 'title_wei': g.get('title'),
                        'wei_code': g.get('outerGoodsCode'),
                        'specs': [s.get('specValueName') for s in (g.get('skuList') or [])][:10]})
        else:
            res.append({'row': i + 1, 'code': code, 'title': title, 'spec': spec, 'k_now': k_now,
                        'l1': None, 'l2': None, 'l1raw': None, 'match': 'none', 'how': '-',
                        'goodsId': None, 'title_wei': None, 'wei_code': None, 'specs': []})
    out[nm] = res
    ok = sum(1 for x in res if x['match'] == 'exact')
    print(f'  命中本组 {ok} / 共 {len(res)};  L2 分布: {dict(Counter(x["l2"] for x in res if x["l2"]))}')
    for x in res:
        if x['match'] != 'exact':
            print(f"   ⚠ 行{x['row']} [{x['match']}] 编码={x['code']!r} | {x['title'][:34]} | 规格={x['spec'][:20]!r} | 微盟L1={x['l1']} L2={x['l2']} | 微盟码={x['wei_code']}")

json.dump(out, open(f'{REPO}/.scan/kcol_map_4sheets.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('\n落盘: .scan/kcol_map_4sheets.json')
