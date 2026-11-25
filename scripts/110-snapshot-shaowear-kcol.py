# -*- coding: utf-8 -*-
"""110 · 少儿穿戴表 K 列（二级分组）补填 —— 步骤1 只读取证（零写）

产出：
  .scan/shaowear_before_000004.json   少儿穿戴 sheet 全量快照（写前基线）
  .scan/shaowear_before_00000a.json   字段说明 sheet 快照（下拉清单来源）
  .scan/shaowear_sheets.json          子表清单

注意：get_cell_data 的 start_row/start_col/end_row/end_col 均为 0 基下标。
"""
import sys, json, os
sys.path.insert(0, r'C:\Users\shenghua\.workbuddy\plugins\cache\workbuddy-builtin\tencent-docs-plugin\5.11.3-wb.43806934.gecace0f7.ha395516167d4\skills\tencent-docs')
import tencentdocs as td

FILE_ID = 'DSnVhVGdTR294UE5P'
OUT = 'D:/workbuddy/weimob-auto-tips/.scan'


def call(tool, args):
    res, err = td.call_tool('sheet-mcp', tool, args, timeout=180)
    if err:
        raise RuntimeError(f'{tool} ERR: {err}')
    txt = res.get('result', {}).get('content', [{}])[0].get('text', '') if res else ''
    try:
        return json.loads(txt)
    except Exception:
        return {'_raw': txt}


def csv_of(d):
    if isinstance(d, dict) and 'csv_data' in d:
        return d['csv_data']
    try:
        return json.loads(d['result']['content'][0]['text'])['csv_data']
    except Exception:
        return ''


# 1) 子表清单
info = call('get_sheet_info', {'file_id': FILE_ID})
json.dump(info, open(f'{OUT}/shaowear_sheets.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('=== 子表清单 ===')
def walk(node):
    if isinstance(node, dict):
        if 'sheet_id' in node or 'sheetId' in node:
            print('  ', node.get('sheet_id') or node.get('sheetId'), node.get('title') or node.get('name') or '')
        for v in node.values():
            walk(v)
    elif isinstance(node, list):
        for v in node:
            walk(v)
walk(info)

# 2) 少儿穿戴 sheet 全量快照（0 基：行 0=表头，列 0=A 序号，列 10=K 二级分组）
print('\n=== 读取 000004 少儿穿戴 全量（行0-260 / 列A-T） ===')
sh = call('get_cell_data', {'file_id': FILE_ID, 'sheet_id': '000004',
                            'start_row': 0, 'end_row': 260, 'start_col': 0, 'end_col': 19,
                            'return_csv': True})
json.dump(sh, open(f'{OUT}/shaowear_before_000004.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
csv_s = csv_of(sh)
open(f'{OUT}/shaowear_before_000004.csv', 'w', encoding='utf-8').write(csv_s)
lines = csv_s.split('\n')
print('CSV 行数:', len(lines))
print('表头:', lines[0])
print('首数据行:', lines[1][:160])
print('末数据行:', lines[-2][:120] if len(lines) > 1 else '')

# 3) 字段说明 sheet（下拉清单来源）
print('\n=== 读取 00000a 字段说明（行0-90 / 列A-J） ===')
sh2 = call('get_cell_data', {'file_id': FILE_ID, 'sheet_id': '00000a',
                             'start_row': 0, 'end_row': 90, 'start_col': 0, 'end_col': 9,
                             'return_csv': True})
json.dump(sh2, open(f'{OUT}/shaowear_before_00000a.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
c2 = csv_of(sh2)
open(f'{OUT}/shaowear_before_00000a.csv', 'w', encoding='utf-8').write(c2)
for i, l in enumerate(c2.split('\n')):
    if l.strip():
        print(f'  行{i}:', l[:300])
