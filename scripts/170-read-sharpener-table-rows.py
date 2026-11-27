#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""170-read-sharpener-table-rows.py —— 只读：读学习文具 sheet 中 6 个削笔机商品的全部规格行，
特别是「整盒」规格的进价/售价，供与微盟成本价交叉匹配。
"""
import sys, json, csv, io, os, datetime
sys.path.insert(0, r'C:\Users\shenghua\.workbuddy\plugins\cache\workbuddy-builtin\tencent-docs-plugin\5.11.3-wb.43806934.gecace0f7.ha395516167d4\skills\tencent-docs')
import tencentdocs as td

FILE_ID = 'DSnVhVGdTR294UE5P'
SHEET = '000001'
REPO = r'D:\workbuddy\weimob-auto-tips'
BK = os.path.join(REPO, 'backup')
ts = datetime.datetime.now().strftime('%Y%m%d-%H%M%S')

d = td.call_tool('sheet-mcp', 'get_cell_data',
                 {'file_id': FILE_ID, 'sheet_id': SHEET,
                  'start_row': 0, 'end_row': 260, 'start_col': 0, 'end_col': 19,
                  'return_csv': True}, timeout=240)[0]
t = d.get('result', {}).get('content', [{}])[0].get('text', '{}')
j = json.loads(t)
rows = list(csv.reader(io.StringIO(j.get('csv_data', ''))))
hdr = rows[0]
print('=== 表头 ===')
for k, v in enumerate(hdr):
    if v.strip():
        print(f'  {chr(65+k)}[{k}] = {v.strip()[:50]}')

# 列名定位
def col(name_part):
    for k, v in enumerate(hdr):
        if name_part in v:
            return k
    return None

SEQ = col('序号') if col('序号') is not None else 1
print(f'\n序号列下标={SEQ}')

KWS = ['削笔', '卷笔', '双孔屑', '书包款', '糖果猫咪', '小酷龙', 'B1单孔', 'B2双孔']
hits = []
for i, r in enumerate(rows):
    line = ' | '.join(x.strip() for x in r)
    if any(kw in line for kw in KWS):
        hits.append((i, r))

print(f'\n=== 命中削笔机相关行 {len(hits)} 行 ===')
for i, r in hits:
    cells = [f'{chr(65+k)}={v.strip()}' for k, v in enumerate(r) if v.strip()]
    print(f'Excel行{i+1} (seq={r[SEQ].strip() if len(r)>SEQ else "?"}): ' + ' | '.join(cells))

out = {'at': datetime.datetime.now().isoformat(), 'header': hdr,
       'hits': [{'excel_row': i+1, 'row_index': i, 'cells': r} for i, r in hits]}
p = os.path.join(BK, f'170-sharpener-table-rows_{ts}.json')
json.dump(out, open(p, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('\n落盘:', p)
