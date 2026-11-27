#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""147-clear-remarks.py —— 清空 137 加的非晨光联盟 3 条备注（Excel U77/U78/U81）

用户确认：「你加的，而且是非晨光联盟的」——清 Excel 77/78/81（seq31，来源1688），
保留 Excel 144/145（晨光联盟，SKU 对齐问题仍在）。

允许改动清单：仅 U 列这 3 格。用 clear_range_cells（不是写空串）。
小样：清 U77 → 回读 → 回滚复原 → 再批量清 3 格 → 回读 → 台账。
"""
import sys, json, csv, io, os, datetime

sys.path.insert(0, r'C:\Users\shenghua\.workbuddy\plugins\cache\workbuddy-builtin\tencent-docs-plugin\5.11.3-wb.43806934.gecace0f7.ha395516167d4\skills\tencent-docs')
import tencentdocs as td

FILE_ID = 'DSnVhVGdTR294UE5P'
SHEET = '000001'
U = 20       # U 列 0 基下标
ROWS = [76, 77, 80]          # Excel 77/78/81 的 0 基行号
REPO = r'D:\workbuddy\weimob-auto-tips'
BK = os.path.join(REPO, 'backup')
ts = datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
LEDGER = os.path.join(BK, f'147-clear-remarks-ledger_{ts}.json')


def call(op, args, timeout=240):
    return td.call_tool('sheet-mcp', op, args, timeout=timeout)[0]


def read_u(r0, r1):
    d = call('get_cell_data', {'file_id': FILE_ID, 'sheet_id': SHEET,
             'start_row': r0, 'end_row': r1, 'start_col': U, 'end_col': U,
             'return_csv': True})
    t = d.get('result', {}).get('content', [{}])[0].get('text', '{}')
    rows = list(csv.reader(io.StringIO(json.loads(t).get('csv_data', ''))))
    return {r0 + i: (r[0] if r else '') for i, r in enumerate(rows)}


def clear(r):
    call('clear_range_cells', {'file_id': FILE_ID, 'sheet_id': SHEET,
         'start_row': r, 'end_row': r, 'start_col': U, 'end_col': U})


def restore(r, v):
    if v:
        call('set_range_value', {'file_id': FILE_ID, 'sheet_id': SHEET,
             'values': [{'row': r, 'col': U, 'value_type': 'STRING', 'string_value': v}]})


before = read_u(min(ROWS), max(ROWS))
print('=== 写前原值 ===')
for r in ROWS:
    print(f'  Excel{r+1}: {before.get(r, "")[:90]!r}')
assert all(before.get(r, '').strip() for r in ROWS), '有目标格为空，需重新确认'

# 小样：清 U77 → 回读 → 回滚
print('\n=== 小样清 Excel77 → 回滚 ===')
clear(ROWS[0])
after_sample = read_u(ROWS[0], ROWS[0])
sample_ok = not after_sample.get(ROWS[0], '').strip()
restore(ROWS[0], before[ROWS[0]])
restored = read_u(ROWS[0], ROWS[0])
rollback_ok = restored.get(ROWS[0], '').strip() == before[ROWS[0]].strip()
print('  清空生效=', sample_ok, ' 回滚复原=', rollback_ok)
assert sample_ok and rollback_ok, '小样未通过，中止'

# 批量：清空 3 格
print('\n=== 批量清空 3 格 ===')
for r in ROWS:
    clear(r)
import time
time.sleep(0.5)
after = read_u(min(ROWS), max(ROWS))
target_ok = all(not after.get(r, '').strip() for r in ROWS)
# 邻近行（Excel 76/79/82 与 144/145）不受影响
near_expect = {}
nb = read_u(75, 81)
for r in [75, 78, 79, 81]:
    near_expect[r] = before.get(r, '')
# 144/145 单独读
n2 = read_u(143, 144)
near_ok = (all(nb.get(r, '') == near_expect[r] for r in [75, 78, 79, 81])
           and bool(n2.get(143, '').strip()) and bool(n2.get(144, '').strip()))
print('  目标3格全空=', target_ok, ' 邻近行(76/79/82/144/145)未误清=', near_ok)
for r in ROWS:
    print(f'  Excel{r+1}: {after.get(r, "")!r}')

result = 'PASS' if (target_ok and near_ok) else 'FAIL'
json.dump({'at': datetime.datetime.now().isoformat(), 'rows': [r + 1 for r in ROWS],
           'before': {str(r): before.get(r, '') for r in ROWS},
           'after_empty': target_ok, 'neighbor_ok': near_ok,
           'kept': {str(r + 1): n2.get(r, '') for r in [143, 144]},
           'rollback_hint': '按 before 字段写回 U 列对应行即可',
           'result': result},
          open(LEDGER, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('RESULT', result, '台账', LEDGER)
