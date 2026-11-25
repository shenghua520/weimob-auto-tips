#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
127-clear-6024-kcol.py —— 清空序号 6024「新款儿童防蓝光眼镜」5 行的 K 列（二级分组）

依据：
  1) 用户已把这 5 行的 C 列（商品状态）改为「未录入微盟」——该商品在微盟 1034 条商品库零命中，不参与录入；
  2) 现网 K 列仍是上一轮我按品类「推断」填的「健康体态」，属推断非微盟事实；
  3) 已有的 6022/6023/6025 才是微盟真实存在的健康体态商品，不受影响。
只改 K124:K128 这 5 格，其余列不动；先备份原值再写，写后回读校验。
"""
import sys, json, csv, io, os, time

sys.path.insert(0, r'C:\Users\shenghua\.workbuddy\plugins\cache\workbuddy-builtin\tencent-docs-plugin\5.11.3-wb.43806934.gecace0f7.ha395516167d4\skills\tencent-docs')
import tencentdocs as td

FILE_ID = 'DSnVhVGdTR294UE5P'
SHEET = '000004'
K_COL = 10
ROWS = [123, 124, 125, 126, 127]      # 0 基 = Excel 行 124–128
REPO = r'D:\workbuddy\weimob-auto-tips'


def call(tool, args):
    d = td.call_tool('sheet-mcp', tool, args, timeout=240)[0]
    t = d.get('result', {}).get('content', [{}])[0].get('text', '{}')
    try:
        return json.loads(t)
    except Exception:
        return {'_raw': t[:300]}


def read_k(r0, r1):
    j = call('get_cell_data', {'file_id': FILE_ID, 'sheet_id': SHEET,
                                'start_row': r0, 'end_row': r1,
                                'start_col': K_COL, 'end_col': K_COL, 'return_csv': True})
    s = j.get('csv_data', '')
    rows = list(csv.reader(io.StringIO(s))) if s else []
    return {r0 + i: (r[0] if r else '') for i, r in enumerate(rows)}


def main():
    print('=== 写前读取 K124:K128 ===')
    before = read_k(min(ROWS), max(ROWS))
    for r in ROWS:
        print(f'  Excel 行{r+1}: {before.get(r, "")!r}')
    if not any(before.get(r, '').strip() for r in ROWS):
        print('  已是空值，无需清空')
        return

    print('\n=== 清空 K124:K128 ===')
    j = call('clear_range_cells', {'file_id': FILE_ID, 'sheet_id': SHEET,
                                   'start_row': min(ROWS), 'end_row': max(ROWS),
                                   'start_col': K_COL, 'end_col': K_COL})
    err = j.get('_raw') or j.get('error')
    if err:
        print('  清空失败:', str(err)[:300])
        return
    time.sleep(1.0)

    print('\n=== 回读校验 ===')
    after = read_k(min(ROWS), max(ROWS))
    ok = True
    for r in ROWS:
        v = after.get(r, '')
        empty = (not str(v).strip())
        ok = ok and empty
        print(f'  Excel 行{r+1}: {v!r}  已清空={empty}')

    # 抽查邻近行未被误清（6022/6023 的 116–123、6025 的 129 仍应为「健康体态」）
    print('\n=== 邻近行抽查（不应被误清）===')
    near = read_k(115, 128)
    bad = []
    for r in [115, 116, 121, 122, 128]:
        v = near.get(r, '')
        if str(v).strip() != '健康体态':
            bad.append((r + 1, v))
    print('  116/117/122/123/129 行应为「健康体态」→', 'OK' if not bad else f'FAIL {bad}')

    ledger = {'file_id': FILE_ID, 'sheet_id': SHEET, 'column': 'K',
              'rows_excel': [r + 1 for r in ROWS],
              'before': {str(r + 1): before.get(r, '') for r in ROWS},
              'after': {str(r + 1): after.get(r, '') for r in ROWS},
              'neighbor_check_ok': not bad,
              'reason': '6024 已由用户标为「未录入微盟」，微盟零命中；原 K 值是推断非事实',
              'rollback': "set_range_value(value_type=STRING) 写回 '健康体态' 即可",
              'result': 'PASS' if (ok and not bad) else 'FAIL'}
    out = os.path.join(REPO, 'backup', '127-clear-6024-kcol-ledger.json')
    json.dump(ledger, open(out, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('\nRESULT:', ledger['result'])
    print('台账:', out)


if __name__ == '__main__':
    main()
