#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""137-table-write.py —— 学习文具表收尾写：36 行状态改「下架」+ 5 行 U 列备注

依据（用户 2026-11-27 拍板）：
  1) 「微盟下架了 表格里也下架」→ 14 个序号（微盟两版均已下架）对应 36 行 D 列改「下架」；
  2) seq31 3 行 + seq56 2 行无法自动对齐 SKU → 跳过同步，在 U 列备注记录原因。
--sample 小样（写→回读→三查→自动回滚）；--apply 批量。
行/列均为 0 基（Excel 行号 = 下标+1）；列 D=3, U=20。
"""
import sys, json, csv, io, os, time, argparse, datetime

sys.path.insert(0, r'C:\Users\shenghua\.workbuddy\plugins\cache\workbuddy-builtin\tencent-docs-plugin\5.11.3-wb.43806934.gecace0f7.ha395516167d4\skills\tencent-docs')
import tencentdocs as td

FILE_ID = 'DSnVhVGdTR294UE5P'
SHEET = '000001'
D_COL, U_COL = 3, 20
REPO = r'D:\workbuddy\weimob-auto-tips'
BACKUP = os.path.join(REPO, 'backup')
DATA = json.load(open(os.path.join(REPO, '.scan', 'stationery_probe.json'), encoding='utf-8'))['data']

OFFLINE_SEQS = ['1', '5', '7', '11', '14', '16', '18', '19', '37', '47', '48', '54', '74', '83']
REMARK_ROWS = {
    76: '2026-11-27 价格同步跳过：规格「【修狗diy套装】芋泥紫」在微盟 SKU 中一对多，无法自动对齐，待人工确认',  # Excel 77
    77: '2026-11-27 价格同步跳过：规格「【修狗diy套装】海盐蓝」在微盟 SKU 中一对多，无法自动对齐，待人工确认',  # Excel 78
    80: '2026-11-27 价格同步跳过：规格「【学习套装】芋泥紫」在微盟 SKU 中一对多，无法自动对齐，待人工确认',  # Excel 81
    143: '2026-11-27 价格同步跳过：同名商品存在两对孪生且规格均为「无」，编码 APYMU268/APYMV268 未精确匹配，待人工确认',  # Excel 144
    144: '2026-11-27 价格同步跳过：同名商品存在两对孪生且规格均为「无」，编码 APYMV268/APYMU268 未精确匹配，待人工确认',  # Excel 145
}


def call(tool, args):
    d = td.call_tool('sheet-mcp', tool, args, timeout=240)[0]
    t = d.get('result', {}).get('content', [{}])[0].get('text', '{}')
    try:
        return json.loads(t)
    except Exception:
        return {'_raw': t[:400]}


def read_col(col, r0, r1):
    j = call('get_cell_data', {'file_id': FILE_ID, 'sheet_id': SHEET,
                                'start_row': r0, 'end_row': r1,
                                'start_col': col, 'end_col': col, 'return_csv': True})
    s = j.get('csv_data', '')
    rows = list(csv.reader(io.StringIO(s))) if s else []
    return {r0 + i: (r[0] if r else '') for i, r in enumerate(rows)}


def set_cells(col, cells):
    """cells: {row0based: str}"""
    if not cells:
        return True
    vals = [{'row': r, 'col': col, 'value_type': 'STRING', 'string_value': v}
            for r, v in sorted(cells.items())]
    j = call('set_range_value', {'file_id': FILE_ID, 'sheet_id': SHEET, 'values': vals})
    err = j.get('_raw') or j.get('error')
    if err:
        print('   写失败:', str(err)[:250])
        return False
    return True


def build_targets():
    seq_rows = {}
    for x in DATA:
        i, r = x[0], x[1:]
        if r[1].strip():
            seq_rows.setdefault(r[1].strip(), []).append(i)
    drows = {r: '下架' for s in OFFLINE_SEQS for r in seq_rows.get(s, [])}
    return drows, dict(REMARK_ROWS)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--sample', action='store_true')
    ap.add_argument('--apply', action='store_true')
    args = ap.parse_args()
    D, U = build_targets()
    print(f'目标：D 列 {len(D)} 行改「下架」；U 列 {len(U)} 行写备注')
    if args.sample:
        D = {min(D): D[min(D)]}
        U = {min(U): U[min(U)]}
        print('小样只取各 1 行:', D, list(U))

    before_d = read_col(D_COL, min(D), max(D))
    before_u = read_col(U_COL, min(U), max(U))
    bd = {r: before_d.get(r, '') for r in D}
    bu = {r: before_u.get(r, '') for r in U}
    ts = datetime.datetime.now().strftime('%Y%m%d-%H%M%S')

    print('\n[1] 写入')
    ok = set_cells(D_COL, D) & set_cells(U_COL, U)
    time.sleep(0.8)

    print('\n[2] 回读三查')
    after_d = read_col(D_COL, min(D), max(D))
    after_u = read_col(U_COL, min(U), max(U))
    bad_d = [r + 1 for r, v in D.items() if str(after_d.get(r, '')).strip() != v]
    bad_u = [r + 1 for r, v in U.items() if str(after_u.get(r, '')).strip() != v.strip()]
    print(f'  D 列目标 {len(D)} 行，不符 {bad_d}')
    print(f'  U 列目标 {len(U)} 行，不符 {bad_u}')
    ok &= not bad_d and not bad_u

    # 非目标抽查：D 列紧邻未被点名的行仍应原样
    nbr = read_col(D_COL, max(D) + 1, max(D) + 4)
    print('  非目标抽查:', {r + 1: v for r, v in nbr.items()})

    if args.sample:
        print('\n[3] 自动回滚')
        ok &= set_cells(D_COL, bd) & set_cells(U_COL, bu)
        time.sleep(0.8)
        check_d = read_col(D_COL, min(D), max(D))
        check_u = read_col(U_COL, min(U), max(U))
        restored = (all(str(check_d.get(r, '')).strip() == str(v).strip() for r, v in bd.items()) and
                    all(str(check_u.get(r, '')).strip() == str(v).strip() for r, v in bu.items()))
        print('  回滚复原:', restored)
        ok &= restored
    else:
        restored = None

    ledger = {'at': datetime.datetime.now().isoformat(), 'mode': 'sample' if args.sample else 'apply',
              'beforeD': {str(r + 1): v for r, v in bd.items()},
              'targetD': {str(r + 1): v for r, v in D.items()},
              'beforeU': {str(r + 1): v for r, v in bu.items()},
              'targetU': {str(r + 1): v for r, v in U.items()},
              'restored': restored, 'result': 'PASS' if ok else 'FAIL',
              'rollbackHint': 'sample 已自动回滚；apply 如需回滚见 beforeD/beforeU'}
    p = os.path.join(BACKUP, f'137-table-{"sample" if args.sample else "apply"}-ledger_{ts}.json')
    json.dump(ledger, open(p, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('\nRESULT:', ledger['result'], '台账:', p)


if __name__ == '__main__':
    main()
