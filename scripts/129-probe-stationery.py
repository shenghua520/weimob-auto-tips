#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""129-probe-stationery.py —— 只读取证：学习文具分表(000001)的表头/状态列/价格列分布。

只读，不写任何远端数据。输出 .scan/stationery_probe.json 供后续 plan 使用。
"""
import sys, json, csv, io, os
from collections import Counter

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
    try:
        j = json.loads(t)
    except Exception:
        return [], {'_raw': t[:300]}
    s = j.get('csv_data', '')
    return (list(csv.reader(io.StringIO(s))) if s else []), {'bytes': len(s)}


rows, meta = csvget(0, 260, 0, 19)
print('=== 表头 ===')
hdr = rows[0] if rows else []
for j, v in enumerate(hdr):
    if v.strip():
        print(f'  {chr(65+j)} = {v.strip()[:40]}')

# 本表 A 列为空、序号在 B 列（下标 1）
SEQ = next((j for j, v in enumerate(hdr) if '序号' in v), 1)
data = [(i, r) for i, r in enumerate(rows)
        if len(r) > SEQ and r[SEQ].strip() and r[SEQ].strip() != '序号']
print(f'\n=== 有效数据行 {len(data)} 行（Excel 行 {data[0][0]+1}–{data[-1][0]+1}）===')

# 找出所有非空列的取值分布（列数少、取值少 = 枚举型字段）
for col in range(min(12, len(hdr))):
    vals = [r[col].strip() for _, r in data if len(r) > col and r[col].strip()]
    cnt = Counter(vals)
    if vals and (len(cnt) <= 12 or col in (0, 1, 2, 3)):
        show = dict(cnt.most_common(12))
        print(f'  {chr(65+col)}({hdr[col].strip()[:10]}) 非空{len(vals)}: {show}')

print('\n=== 前 3 行 / 后 3 行样本 ===')
for i, r in data[:3] + data[-3:]:
    print(f'  行{i+1}:', [v[:24] for v in r[:12]])

out = {'sheet': SHEET, 'meta': meta, 'header': hdr,
       'data': [[i] + r for i, r in data]}
os.makedirs(os.path.join(REPO, '.scan'), exist_ok=True)
p = os.path.join(REPO, '.scan', 'stationery_probe.json')
json.dump(out, open(p, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('\n落盘:', p)
