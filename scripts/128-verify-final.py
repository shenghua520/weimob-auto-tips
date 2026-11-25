#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
128-verify-final.py —— 少儿穿戴 K 列收尾独立复核

四轮：
  R1 目标行   K124:K128 必须为空
  R2 邻近行   116/117/122/123/129 行 K 仍为「健康体态」（未被误清）
  R3 其他列   124–128 行 C 列仍为「未录入微盟」（用户改动未被覆盖）
  R4 全表     K 列非空行数与「未录入微盟」行数对齐（清空后非空数 = 原 136 − 5 = 131）

独立路径：重新登录读取现网，不复用 127 的中间态。
"""
import sys, json, csv, io, os

sys.path.insert(0, r'C:\Users\shenghua\.workbuddy\plugins\cache\workbuddy-builtin\tencent-docs-plugin\5.11.3-wb.43806934.gecace0f7.ha395516167d4\skills\tencent-docs')
import tencentdocs as td

FILE_ID = 'DSnVhVGdTR294UE5P'
SHEET = '000004'
K_COL = 10
C_COL = 2
REPO = r'D:\workbuddy\weimob-auto-tips'


def call(tool, args):
    d = td.call_tool('sheet-mcp', tool, args, timeout=240)[0]
    t = d.get('result', {}).get('content', [{}])[0].get('text', '{}')
    try:
        return json.loads(t)
    except Exception:
        return {'_raw': t[:300]}


def read_col(col, r0, r1):
    j = call('get_cell_data', {'file_id': FILE_ID, 'sheet_id': SHEET,
                                'start_row': r0, 'end_row': r1,
                                'start_col': col, 'end_col': col, 'return_csv': True})
    s = j.get('csv_data', '')
    rows = list(csv.reader(io.StringIO(s))) if s else []
    return {r0 + i: (r[0] if r else '') for i, r in enumerate(rows)}


def main():
    R = {}
    TARGET = [123, 124, 125, 126, 127]           # 0 基 → Excel 124–128
    NEAR_OK = [115, 116, 121, 122, 128]           # 0 基 → Excel 116/117/122/123/129

    print('=== 读取现网 K 列 116–129 ===')
    k = read_col(K_COL, 115, 128)
    for r in sorted(k):
        print(f'  Excel 行{r+1}: {k.get(r, "")!r}')

    print('\n=== R1 目标行必须为空 ===')
    bad1 = [(r + 1, k.get(r, '')) for r in TARGET if str(k.get(r, '')).strip()]
    R['R1_target_empty'] = {'bad': bad1, 'pass': not bad1}
    print('  R1:', 'PASS' if not bad1 else f'FAIL {bad1}')

    print('\n=== R2 邻近行必须仍为「健康体态」 ===')
    bad2 = [(r + 1, k.get(r, '')) for r in NEAR_OK if str(k.get(r, '')).strip() != '健康体态']
    R['R2_neighbor_intact'] = {'bad': bad2, 'pass': not bad2}
    print('  R2:', 'PASS' if not bad2 else f'FAIL {bad2}')

    print('\n=== R3 C 列用户改动未被覆盖 ===')
    c = read_col(C_COL, 123, 127)
    bad3 = [(r + 1, c.get(r, '')) for r in TARGET if '未录入' not in str(c.get(r, ''))]
    R['R3_colC_untouched'] = {'values': {str(r + 1): c.get(r, '') for r in TARGET}, 'bad': bad3, 'pass': not bad3}
    print('  R3:', 'PASS' if not bad3 else f'FAIL {bad3}', {str(r + 1): c.get(r, '') for r in TARGET})

    print('\n=== R4 全表 K 列非空行数 ===')
    kk = read_col(K_COL, 1, 136)                  # Excel 行 2–137
    nonempty = [r + 1 for r, v in kk.items() if str(v).strip()]
    cc = read_col(C_COL, 1, 136)
    notrec = [r + 1 for r, v in cc.items() if '未录入' in str(v)]
    R['R4_counts'] = {'k_nonempty': len(nonempty), 'k_total_rows': len(kk),
                      'not_recorded_rows': len(notrec),
                      'expect_k_nonempty': 131, 'pass': len(nonempty) == 131}
    print(f"  K 列非空 {len(nonempty)} 行（期望 131 = 136 − 5）；「未录入微盟」{len(notrec)} 行")
    print('  R4:', 'PASS' if len(nonempty) == 131 else 'FAIL')

    allpass = all(v['pass'] for v in R.values())
    R['verdict'] = 'PASS' if allpass else 'FAIL'
    out = os.path.join(REPO, 'backup', '128-final-verify.json')
    json.dump(R, open(out, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('\nVERDICT:', R['verdict'])
    print('报告:', out)


if __name__ == '__main__':
    main()
