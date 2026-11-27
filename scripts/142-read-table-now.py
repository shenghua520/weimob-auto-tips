#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""142-read-table-now.py —— 只读取证：现网学习文具表全量，与本轮基线逐格对比。

用户反馈「49 行非晨光联盟商品价格变回原来的样子」，先定位实际变动的行/列，
不写任何远端数据。输出 .scan/stationery_now.json + 差异报告。
"""
import sys, json, csv, io
from collections import Counter, defaultdict

sys.path.insert(0, r'C:\Users\shenghua\.workbuddy\plugins\cache\workbuddy-builtin\tencent-docs-plugin\5.11.3-wb.43806934.gecace0f7.ha395516167d4\skills\tencent-docs')
import tencentdocs as td

FILE_ID = 'DSnVhVGdTR294UE5P'
SHEET = '000001'
REPO = r'D:\workbuddy\weimob-auto-tips'


def csvget(r0, r1, c0, c1):
    d = td.call_tool('sheet-mcp', 'get_cell_data',
                     {'file_id': FILE_ID, 'sheet_id': SHEET,
                      'start_row': r0, 'end_row': r1,
                      'start_col': c0, 'end_col': c1, 'return_csv': True}, timeout=240)[0]
    t = d.get('result', {}).get('content', [{}])[0].get('text', '{}')
    j = json.loads(t)
    s = j.get('csv_data', '')
    return list(csv.reader(io.StringIO(s))) if s else []


rows = csvget(0, 260, 0, 19)
base = json.load(open(REPO + '/.scan/stationery_probe.json', encoding='utf-8'))
base_rows = {x[0]: x[1:] for x in base['data']}
hdr = base['header']
print('表头列:', ' '.join(f'{chr(65+i)}={v}' for i, v in enumerate(hdr) if v))

changed = []
for i, r in enumerate(rows):
    b = base_rows.get(i)
    if b is None:
        continue
    # 补齐列数
    rr = r + [''] * (20 - len(r))
    bb = b + [''] * (20 - len(b))
    diff = [(j, hdr[j] if j < len(hdr) else f' col{j}', bb[j], rr[j])
            for j in range(20) if bb[j].strip() != rr[j].strip()]
    if diff:
        changed.append((i, rr, diff))

print(f'\n=== 现网 vs 本轮基线：变动行 {len(changed)} ===')
for i, r, diff in changed[:80]:
    print(f'  Excel行{i+1:3d} seq={r[1]:>4} 来源={r[8]:<8} 状态={r[3]:<6} {r[2][:26]:26s}')
    for j, name, old, new in diff:
        print(f'      {chr(65+j)} {name}: {old!r} -> {new!r}')

# 按来源分布
print('\n=== 变动行来源分布 ===', Counter(r[8] for _, r, _ in changed))
# 按列分布
print('=== 变动列分布 ===', Counter(hdr[j] if j < len(hdr) else j for _, _, d in changed for j, *_ in d))

out = {
    'sheet': SHEET,
    'header': hdr,
    'data': [[i] + r for i, r in enumerate(rows)],
    'changed': [{'excel_row': i + 1, 'row': r,
                 'diff': [{'col': j, 'name': n, 'old': o, 'new': v} for j, n, o, v in d]}
                for i, r, d in changed],
}
with open(REPO + '/.scan/stationery_now.json', 'w', encoding='utf-8') as f:
    json.dump(out, f, ensure_ascii=False, indent=1)
print('\n已写 .scan/stationery_now.json')
