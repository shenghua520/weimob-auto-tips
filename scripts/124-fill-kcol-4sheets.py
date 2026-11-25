# -*- coding: utf-8 -*-
"""K 列补填执行器：--sample 小样往返 / --apply 批量
写入对象：少儿护理(000003) K 列、米面油品(000008) K 列
只动 K 列（第 11 列，0-based col=10），非 K 列零改动。
"""
import sys, json, csv, io, os, argparse, time, shutil
sys.path.insert(0, r'C:\Users\shenghua\.workbuddy\plugins\cache\workbuddy-builtin\tencent-docs-plugin\5.11.3-wb.43806934.gecace0f7.ha395516167d4\skills\tencent-docs')
import tencentdocs as td

REPO = 'D:/workbuddy/weimob-auto-tips'
FILE_ID = 'DSnVhVGdTR294UE5P'
K_COL = 10          # K 列 0-based
COL = 'K'

def call(tool, args):
    d = td.call_tool('sheet-mcp', tool, args, timeout=240)[0]
    t = d.get('result', {}).get('content', [{}])[0].get('text', '{}')
    try: return json.loads(t)
    except Exception: return {'_raw': t[:500]}

def csvget(sid, r0, r1, c0, c1):
    j = call('get_cell_data', {'file_id': FILE_ID, 'sheet_id': sid, 'start_row': r0, 'end_row': r1,
                                'start_col': c0, 'end_col': c1, 'return_csv': True})
    s = j.get('csv_data', '')
    return list(csv.reader(io.StringIO(s))) if s else []

def snapshot(sid, r0, r1, c0, c1):
    """返回 {(row0based,col0based): value}"""
    g = {}
    for i, r in enumerate(csvget(sid, r0, r1, c0, c1)):
        for j, v in enumerate(r):
            if (v or '').strip(): g[(r0 + i, c0 + j)] = v
    return g

def set_cells(sid, cells):
    """cells: {row0based: value_str}（行号 0-based）"""
    if not cells: return True
    rows = sorted(cells)
    groups, cur = [], []
    for r in rows:
        if cur and (r - cur[-1] > 2 or len(cur) >= 30):
            groups.append(cur); cur = []
        cur.append(r)
    if cur: groups.append(cur)
    ok = True
    for g in groups:
        # 只写真有值的格子（空值走 clear_range_cells）
        nonempty = [r for r in range(g[0], g[-1] + 1) if cells.get(r, '')]
        if nonempty:
            vals = [{'row': r, 'col': K_COL, 'value_type': 'STRING',
                     'string_value': cells[r]} for r in nonempty]
            j = call('set_range_value', {'file_id': FILE_ID, 'sheet_id': sid, 'values': vals})
            err = j.get('_raw') or j.get('error')
            if err: ok = False; print('   写失败:', str(err)[:250])
        # 清空本批中标记为空的行
        empties = [r for r in range(g[0], g[-1] + 1) if not cells.get(r, '')]
        if empties:
            for r in empties:
                j = call('clear_range_cells', {'file_id': FILE_ID, 'sheet_id': sid,
                                              'start_row': r, 'end_row': r,
                                              'start_col': K_COL, 'end_col': K_COL})
                err = j.get('_raw') or j.get('error')
                if err: ok = False; print('   清空失败:', str(err)[:250])
        time.sleep(0.4)
    return ok

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--sample', action='store_true')
    ap.add_argument('--apply', action='store_true')
    args = ap.parse_args()

    plan = json.load(open(f'{REPO}/.scan/kcol_fill_plan.json', encoding='utf-8'))

    SHEETID = {'少儿护理': '000003', '少儿食品': '000005', '米面油品': '000008', '家用电器': '000009'}
    targets = {}
    for p in plan:
        if p['action'] in ('填写', '清空'):
            targets.setdefault(p['group'], {})[p['row'] - 1] = p['k_target'] or ''

    # 写前全表快照（非 K 列比对用）
    BEFORE = {}
    for g, sid in SHEETID.items():
        BEFORE[g] = snapshot(sid, 0, 300, 0, 19)

    if args.sample:
        print('=== 小样：少儿护理 行6(清空) + 行2(填写) → 回读 → 三查 → 自动回滚 ===')
        sid = SHEETID['少儿护理']
        sample = {5: '', 1: '儿童洗发水'}
        old = snapshot(sid, 0, 3, K_COL, K_COL)
        print('  写前 K1..K6:', old)
        set_cells(sid, sample)
        now = snapshot(sid, 0, 3, K_COL, K_COL)
        print('  写后 K1..K6:', now)
        # 三查
        chk1 = now.get((1, K_COL), '') == '儿童洗发水'
        chk2 = (5, K_COL) not in now or now.get((5, K_COL), '') == ''
        chk3 = now.get((0, K_COL), '') == '二级分组'   # 表头未被破坏
        print(f'  三查: 写入值正确={chk1} 清空生效={chk2} 表头未破坏={chk3}')
        # 回滚：只还原本次动过的行；old 中没有的（原本为空）必须清空
        rollback = {r: old.get((r, K_COL), '') for r in sorted(sample)}
        set_cells(sid, rollback)
        back = snapshot(sid, 0, 8, K_COL, K_COL)
        same = {k: v for k, v in back.items() if k in old} == old and \
               all(v == '' for k, v in back.items() if k not in old)
        print(f'  回滚后与写前一致 = {same}  {back}')
        print('RESULT:', 'PASS' if (chk1 and chk2 and chk3 and same) else 'FAIL')
        return

    if args.apply:
        print('=== 批量写入 ===')
        ledger = []
        for g, cells in targets.items():
            sid = SHEETID[g]
            print(f'\n[{g}] {sid} 待写 {len(cells)} 行')
            ok = set_cells(sid, cells)
            # 回读校验
            after = snapshot(sid, 0, 300, K_COL, K_COL)
            bad = []
            for r, want in cells.items():
                got = after.get((r, K_COL), '')
                if got != want: bad.append({'row': r + 1, 'want': want, 'got': got})
            print(f'  写后回读: 不符 {len(bad)} 行' + (f' → {bad[:5]}' if bad else ' ✓'))
            for r, want in cells.items():
                ledger.append({'group': g, 'sheet': sid, 'row': r + 1,
                               'old': BEFORE[g].get((r, K_COL), ''), 'new': want,
                               'ok': after.get((r, K_COL), '') == want})
            # 非 K 列零改动校验
            now_full = snapshot(sid, 0, 300, 0, 19)
            diffs = []
            for k, v in BEFORE[g].items():
                if k[1] == K_COL: continue
                if now_full.get(k, '') != v: diffs.append({'cell': k, 'before': v, 'after': now_full.get(k, '')})
            for k, v in now_full.items():
                if k[1] == K_COL: continue
                if k not in BEFORE[g]: diffs.append({'cell': k, 'before': '', 'after': v})
            print(f'  非 K 列改动: {len(diffs)} 处' + (f' → {diffs[:5]}' if diffs else ' ✓ 零改动'))
            ledger[-1]['nonKDiffs'] = len(diffs)
        out = {'ledger': ledger,
               'summary': {'total': len(ledger),
                           'ok': sum(1 for x in ledger if x['ok']),
                           'fail': sum(1 for x in ledger if not x['ok']),
                           'nonKChanged': sum(x.get('nonKDiffs', 0) for x in ledger[-len(targets):])}}
        fn = f'{REPO}/backup/124-kcol-fill-ledger_{time.strftime("%Y-%m-%dT%H-%M-%S")}.json'
        json.dump(out, open(fn, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        print('\n台账:', fn)
        print('SUMMARY:', json.dumps(out['summary'], ensure_ascii=False))
        print('RESULT:', 'PASS' if out['summary']['fail'] == 0 and out['summary']['nonKChanged'] == 0 else 'FAIL')

if __name__ == '__main__':
    main()
