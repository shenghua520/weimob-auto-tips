# -*- coding: utf-8 -*-
"""映射分析：4 张表每行 → 微盟商品 → 二级分组（取可见组名）
数据源：
  - 表格：腾讯文档 9 分表（只读）
  - 微盟：backup/103-goods-all_*.json（商品库全量 1034 条，含 classifyList）
  - 分组树：backup/106-classify-tree_*.json（l1/l2）
"""
import sys, json, csv, io, os, re
sys.path.insert(0, r'C:\Users\shenghua\.workbuddy\plugins\cache\workbuddy-builtin\tencent-docs-plugin\5.11.3-wb.43806934.gecace0f7.ha395516167d4\skills\tencent-docs')
import tencentdocs as td

REPO = 'D:/workbuddy/weimob-auto-tips'
FILE_ID = 'DSnVhVGdTR294UE5P'

# ---------- 微盟数据 ----------
bf = 'backup'
f_all = sorted([x for x in os.listdir(f'{REPO}/{bf}') if x.startswith('103-goods-all_')])[-1]
allj = json.load(open(f'{REPO}/{bf}/{f_all}', encoding='utf-8'))
GOODS = allj.get('list') or allj.get('goods') or allj.get('rows') or allj
f_tree = sorted([x for x in os.listdir(f'{REPO}/{bf}') if x.startswith('106-classify-tree_')])[-1]
TREE = json.load(open(f'{REPO}/{bf}/{f_tree}', encoding='utf-8'))

l2_by_id = {str(x['classifyId']): x for x in TREE['l2']}
l1_by_id = {str(x['classifyId']): x for x in TREE['l1']}

# 可见组名映射：二级分组名（去「（兑换）」后缀）→ 该分组所属可见一级组
def visible_l1_of(classifyId):
    x = l2_by_id.get(str(classifyId))
    if not x: return None, None
    p = l1_by_id.get(str(x.get('parentId')))
    return (p['name'] if p else None), x['name']

# 商品索引：EAN(12/13位归一) → 商品；outerGoodsCode → 商品
def norm_ean(s):
    d = re.sub(r'\D', '', s or '')
    return d[:12] if len(d) >= 12 else d

IDX_EAN = {}
IDX_CODE = {}
for g in GOODS:
    oc = (g.get('outerGoodsCode') or '').strip()
    if oc:
        IDX_CODE.setdefault(oc, []).append(g)
        IDX_CODE.setdefault(oc.upper(), []).append(g)
    ne = norm_ean(oc)
    if ne:
        IDX_EAN.setdefault(ne, []).append(g)
print(f'微盟商品库 {len(GOODS)} 条; EAN 索引 {len(IDX_EAN)}; 编码索引 {len(IDX_CODE)}')

def l2_of(g):
    """商品的一级分组名 + 二级分组可见名"""
    cl = g.get('classifyList') or []
    if not cl: return None, None, None
    c = cl[0]
    l1n, l2n = visible_l1_of(c.get('classifyId'))
    raw = c.get('name')
    vis = re.sub(r'（兑换）$', '', raw or '')
    return l1n, vis, raw

# ---------- 表格 ----------
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
    print(f'\n{"="*110}')
    print(f'=== {nm} ({sid}) 数据行 {len(data)} ===')
    res = []
    for i, r in data:
        code = r[3].strip() if len(r) > 3 else ''
        title = r[1].strip() if len(r) > 1 else ''
        spec = r[5].strip() if len(r) > 5 else ''
        k_now = r[10].strip() if len(r) > 10 else ''
        cand = []
        if code:
            cand = list(IDX_EAN.get(norm_ean(code), [])) or list(IDX_CODE.get(code, []))
        hit = None
        for g in cand:
            l1n, l2v, l2raw = l2_of(g)
            if l1n == nm:
                hit = (g, l1n, l2v, l2raw); break
        if not hit and cand:
            g0 = cand[0]
            l1n, l2v, l2raw = l2_of(g0)
            hit = (g0, l1n, l2v, l2raw)
        if hit:
            g, l1n, l2v, l2raw = hit
            res.append({'row': i + 1, 'code': code, 'title': title, 'spec': spec,
                        'k_now': k_now, 'l1': l1n, 'l2': l2v, 'l2raw': l2raw,
                        'match': 'exact' if l1n == nm else 'other-group',
                        'goodsId': g.get('goodsId'),
                        'title_wei': g.get('title'),
                        'specs': [s.get('specValueName') for s in (g.get('skuList') or [])][:8]})
        else:
            res.append({'row': i + 1, 'code': code, 'title': title, 'spec': spec,
                        'k_now': k_now, 'l1': None, 'l2': None, 'l2raw': None,
                        'match': 'none', 'goodsId': None, 'title_wei': None, 'specs': []})
    out[nm] = res
    ok = sum(1 for x in res if x['match'] == 'exact')
    other = sum(1 for x in res if x['match'] == 'other-group')
    none = sum(1 for x in res if x['match'] == 'none')
    print(f'  精确命中本组 {ok} / 命中其它组 {other} / 未命中 {none} / 共 {len(res)}')
    from collections import Counter
    print('  L2 分布:', dict(Counter(x['l2'] for x in res if x['l2'])))
    for x in res:
        if x['match'] != 'exact':
            print(f"   ⚠ 行{x['row']} [{x['match']}] {x['code']} | {x['title'][:30]} | 微盟L1={x['l1']} L2={x['l2']} | {x['title_wei']}")

json.dump(out, open(f'{REPO}/.scan/kcol_map_4sheets.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('\n落盘: .scan/kcol_map_4sheets.json')
