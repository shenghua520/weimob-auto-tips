#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""158-clear-seq56-remarks.py —— 用户确认 seq55/56 数据无误后，清掉两条过期的待人工确认备注。

注意行号基准：get_cell_data/set_range_value 均 0 基；Excel144/145 → row 143/144。
清空用 clear_range_cells，不写空串（MEMORY A 节）。U143(seq55)/U146 应保持不变。
"""
import sys, json, csv, io, os, datetime

sys.path.insert(0, r'C:\Users\shenghua\.workbuddy\plugins\cache\workbuddy-builtin\tencent-docs-plugin\5.11.3-wb.43806934.gecace0f7.ha395516167d4\skills\tencent-docs')
import tencentdocs as td

FILE_ID, SHEET, U = 'DSnVhVGdTR294UE5P', '000001', 20
ROWS = [143, 144]   # 0 基 = Excel 144/145
BACKUP = r'D:\workbuddy\weimob-auto-tips\backup'


def call(tool, args):
    return td.call_tool('sheet-mcp', tool, args, timeout=240)[0]


def read_u(r0, r1):
    d = call('get_cell_data', {'file_id': FILE_ID, 'sheet_id': SHEET,
             'start_row': r0, 'end_row': r1, 'start_col': U, 'end_col': U, 'return_csv': True})
    rows = list(csv.reader(io.StringIO(json.loads(
        d.get('result', {}).get('content', [{}])[0].get('text', '{}')).get('csv_data', ''))))
    return {r0 + i: (r[0] if r else '') for i, r in enumerate(rows)}


def main():
    before = read_u(141, 147)   # Excel142-148
    print('写前 U144/U145:', repr(before[143][:55]), repr(before[144][:55]))
    assert '待人工确认' in before[143] and '待人工确认' in before[144], '备注内容与预期不符，中止'
    near_before = {r: before[r] for r in [141, 142, 145, 146]}

    # 清空（clear_range_cells，不是写空串）
    call('clear_range_cells', {'file_id': FILE_ID, 'sheet_id': SHEET,
         'start_row': min(ROWS), 'end_row': max(ROWS), 'start_col': U, 'end_col': U})

    after = read_u(141, 147)
    cleared = all(not after[r].strip() for r in ROWS)
    near_ok = all(after[r] == near_before[r] for r in [141, 142, 145, 146])
    print('回读: 目标2格全空=', cleared, ' 邻近行未变=', near_ok)
    for r in [141, 142, 145, 146]:
        print(f'  Excel{r+1}: {repr(after[r][:44])}')

    result = 'PASS' if (cleared and near_ok) else 'FAIL'
    p = os.path.join(BACKUP, '158-clear-seq56-remarks-ledger.json')
    json.dump({'rows_excel': [144, 145], 'before': {str(r): before[r] for r in [143, 144]},
               'after': {str(r): after[r] for r in ROWS}, 'cleared': cleared,
               'nearby_intact': near_ok, 'result': result,
               'at': datetime.datetime.now().isoformat()},
              open(p, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('RESULT:', result, '台账:', p)


if __name__ == '__main__':
    main()
