# -*- coding: utf-8 -*-
"""取证：当前线上 字段说明 清单区 vs 写前快照 逐格 diff（判断污染来源）+ 微盟 L2 权威清单"""
import sys, json, csv, io
sys.path.insert(0, r'C:\Users\shenghua\.workbuddy\plugins\cache\workbuddy-builtin\tencent-docs-plugin\5.11.3-wb.43806934.gecace0f7.ha395516167d4\skills\tencent-docs')
import tencentdocs as td

REPO = 'D:/workbuddy/weimob-auto-tips'
FILE_ID = 'DSnVhVGdTR294UE5P'

def csvget(sid, r0, r1, c0, c1):
    d = td.call_tool('sheet-mcp', 'get_cell_data',
                     {'file_id': FILE_ID, 'sheet_id': sid, 'start_row': r0, 'end_row': r1,
                      'start_col': c0, 'end_col': c1, 'return_csv': True}, timeout=180)[0]
    t = d.get('result', {}).get('content', [{}])[0].get('text', '{}')
    try: j = json.loads(t)
    except Exception: return []
    s = j.get('csv_data', '')
    return list(csv.reader(io.StringIO(s))) if s else []

# ---------- 当前线上 字段说明 全量 ----------
cur = csvget('00000a', 0, 95, 0, 13)   # A..N, 行1..96
print('线上字段说明 行数', len(cur))

# ---------- 写前快照 ----------
snap = list(csv.reader(io.StringIO(open(f'{REPO}/.scan/shaowear_before_00000a.csv', encoding='utf-8').read())))
print('快照行数', len(snap))

def grid(rows):
    g = {}
    for i, r in enumerate(rows):
        for j, v in enumerate(r):
            v = (v or '').strip()
            if v: g[(i, j)] = v
    return g

gc, gs = grid(cur), grid(snap)
keys = sorted(set(gc) | set(gs))
diffs = []
for k in keys:
    a, b = gs.get(k, ''), gc.get(k, '')
    if a != b:
        diffs.append({'idx_row': k[0], 'excel_row': k[0] + 1, 'col_idx': k[1],
                      'col_letter': chr(65 + k[1]), 'before': a, 'now': b,
                      'change': '新增' if not a else ('删除' if not b else '修改')})
print(f'\n=== 字段说明 快照 vs 线上 差异 {len(diffs)} 处 ===')
for d in diffs:
    print(f"  {d['col_letter']}{d['excel_row']} [{d['change']}] {d['before'][:40]!r} → {d['now'][:40]!r}")

json.dump(diffs, open(f'{REPO}/.scan/desc_sheet_diff.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)

# ---------- 当前线上各清单列内容 ----------
print('\n=== 线上清单列现状（表头行 42，选项 43 起） ===')
COLS = 'ABCDEFGHIJKL'
titles = {}
for j, c in enumerate(COLS):
    titles[c] = (cur[41][j].strip() if len(cur) > 41 and j < len(cur[41]) else '')
live_opts = {}
for j, c in enumerate(COLS):
    opts = []
    i = 42
    while i < len(cur):
        v = cur[i][j].strip() if j < len(cur[i]) else ''
        if not v: break
        opts.append(v); i += 1
    live_opts[c] = opts
    print(f'  {c} ({titles[c] or "(空表头)"}): {len(opts)} 项 {opts}')

# ---------- 微盟权威 L2 ----------
tree = json.load(open(f'{REPO}/backup/106-classify-tree_2026-11-25T01-08-49.json', encoding='utf-8'))
l1 = {str(x['classifyId']): x for x in tree['l1']}
l2_by_parent = {}
for x in tree['l2']:
    l2_by_parent.setdefault(str(x['parentId']), []).append(x)

print('\n=== 微盟 9 组二级分组（权威） ===')
wei = {}
for x in tree['l1']:
    nm = x['name']
    if nm in ('少儿穿戴','体育用品','学习文具','少儿护理','少儿食品','家庭日用','读物潮玩','米面油品','家用电器'):
        kids = sorted(l2_by_parent.get(str(x['classifyId']), []), key=lambda z: -z['sort'])
        wei[nm] = [{'name': k['name'], 'isShow': k.get('isShow'), 'sort': k['sort']} for k in kids]
        hidden = [k['name'] for k in kids if not k.get('isShow', True)]
        print(f"  {nm:8s} (isShow={x.get('isShow')}) {len(kids)} 项 {[(k['name'], k.get('isShow')) for k in kids]}")
        if hidden: print(f"            ↳ 隐藏组: {hidden}")

json.dump({'live_opts': live_opts, 'titles': titles, 'weimob': wei, 'diff': diffs},
          open(f'{REPO}/.scan/lists_state_now.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('\n落盘: .scan/lists_state_now.json')
