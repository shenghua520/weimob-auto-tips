# -*- coding: utf-8 -*-
"""112 · 少儿穿戴表 K 列（二级分组）补填 + 字段说明下拉清单补项 —— 执行脚本

七步法第4步小样：改 2 格（1 个空值 + 1 个错值覆盖）→ 回读 → 三查 → 自动回滚 → 确认复原
七步法第5步批量：先补下拉清单（字段说明 F53），再分批写 K 列（30/批），逐批回读
模式：--sample / --apply
"""
import sys, json, time, os
sys.path.insert(0, r'C:\Users\shenghua\.workbuddy\plugins\cache\workbuddy-builtin\tencent-docs-plugin\5.11.3-wb.43806934.gecace0f7.ha395516167d4\skills\tencent-docs')
import tencentdocs as td

REPO = 'D:/workbuddy/weimob-auto-tips'
FILE_ID = 'DSnVhVGdTR294UE5P'
SH_MAIN = '000004'
SH_DESC = '00000a'
MODE = (sys.argv[1] if len(sys.argv) > 1 else '--sample').replace('--', '')
BATCH = 30
PLAN = json.load(open(f'{REPO}/.scan/shaowear_kcol_plan.json', encoding='utf-8'))
LEDGER = f'{REPO}/backup/112-kcol-ledger_{MODE}.json'


def call(tool, args):
    res, err = td.call_tool('sheet-mcp', tool, args, timeout=180)
    if err:
        raise RuntimeError(f'{tool} ERR: {err}')
    txt = res.get('result', {}).get('content', [{}])[0].get('text', '') if res else ''
    try:
        return json.loads(txt)
    except Exception:
        return {'_raw': txt}


def read(sheet, r0, r1, c0, c1):
    d = call('get_cell_data', {'file_id': FILE_ID, 'sheet_id': sheet,
                                'start_row': r0, 'end_row': r1, 'start_col': c0, 'end_col': c1,
                                'return_csv': True})
    if isinstance(d, dict) and 'csv_data' in d:
        return d['csv_data']
    import csv as _csv, io as _io
    return list(_csv.reader(_io.StringIO(json.loads(d['result']['content'][0]['text'])['csv_data'])))


def write_cells(sheet, cells):
    """cells: [{'row','col','value'}] → set_range_value STRING"""
    vals = [{'row': c['row'], 'col': c['col'], 'value_type': 'STRING', 'string_value': c['value']} for c in cells]
    d = call('set_range_value', {'file_id': FILE_ID, 'sheet_id': sheet, 'values': vals})
    return d


def main():
    print(f'=== 112 K列补填 [{MODE}] ===')
    dp = PLAN['dropdown']
    vals = PLAN['values']
    log = {'mode': MODE, 'startedAt': time.strftime('%Y-%m-%dT%H:%M:%S'), 'batches': [], 'errors': []}

    if MODE == 'sample':
        # 小样：1 个空值行 + 1 个错值覆盖行（边界型：覆盖 + 新增 + 下拉）
        picks = [v for v in vals if v['old_value'] == ''][:1] + [v for v in vals if v['old_value']][:1]
        print('\n=== 小样(2格, 含1格覆盖) ===')
        for p in picks:
            print(f"  行{p['excel_row']} 序号{p['seq']} {p['name'][:24]} K:{p['old_value']!r}→{p['value']}")
        # 1) 先补下拉
        d = write_cells(SH_DESC, [{'row': dp['row_index'], 'col': dp['col_index'], 'value': dp['value']}])
        print('  下拉清单写入 F%d = %r → %s' % (dp['excel_row'], dp['value'], json.dumps(d, ensure_ascii=False)[:90]))
        time.sleep(0.6)
        got_desc = read(SH_DESC, dp['row_index'], dp['row_index'], dp['col_index'], dp['col_index'])
        print('  回读 F%d = %r' % (dp['excel_row'], got_desc.strip()))
        # 2) 写 2 格 K
        d = write_cells(SH_MAIN, [{'row': p['row'], 'col': p['col'], 'value': p['value']} for p in picks])
        print('  K 写入 →', json.dumps(d, ensure_ascii=False)[:90])
        time.sleep(0.6)
        for p in picks:
            got = read(SH_MAIN, p['row'], p['row'], p['col'], p['col']).strip()
            print(f"  回读 行{p['excel_row']} K = {got!r}  期望 {p['value']!r}  {'OK' if got == p['value'] else 'FAIL'}")
        # 3) 自动回滚：恢复原值 + 清空下拉新增项
        print('\n=== 自动回滚 ===')
        write_cells(SH_MAIN, [{'row': p['row'], 'col': p['col'], 'value': p['old_value']} for p in picks])
        time.sleep(0.6)
        write_cells(SH_DESC, [{'row': dp['row_index'], 'col': dp['col_index'], 'value': ''}])
        time.sleep(0.6)
        ok = True
        for p in picks:
            got = read(SH_MAIN, p['row'], p['row'], p['col'], p['col']).strip()
            same = (got == p['old_value'])
            ok &= same
            print(f"  回滚后 行{p['excel_row']} K = {got!r} 原值 {p['old_value']!r} {'OK' if same else 'FAIL'}")
        got_desc = read(SH_DESC, dp['row_index'], dp['row_index'], dp['col_index'], dp['col_index']).strip()
        print(f"  回滚后 F{dp['excel_row']} = {got_desc!r} 期望 ''  {'OK' if got_desc == '' else 'FAIL'}")
        ok &= (got_desc == '')
        log['sample'] = [{'excel_row': p['excel_row'], 'expect': p['value'], 'old': p['old_value']} for p in picks]
        log['rollbackOk'] = ok
        print('\n小样结果:', 'PASS' if ok else 'FAIL')
        json.dump(log, open(LEDGER, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        return 0 if ok else 2

    if MODE == 'apply':
        # 1) 先补下拉清单（顺序：先下拉后 K 值，避免临时红标）
        print('\n=== 步骤1: 字段说明补下拉选项 ===')
        d = write_cells(SH_DESC, [{'row': dp['row_index'], 'col': dp['col_index'], 'value': dp['value']}])
        time.sleep(0.8)
        got = read(SH_DESC, dp['row_index'], dp['row_index'], dp['col_index'], dp['col_index']).strip()
        step1 = {'cell': f"00000a!F{dp['excel_row']}", 'value': dp['value'], 'readback': got, 'ok': got == dp['value'],
                 'resp': json.dumps(d, ensure_ascii=False)[:120]}
        print('  写入', step1['cell'], '=', dp['value'], '| 回读', repr(got), '|', 'OK' if step1['ok'] else 'FAIL')
        log['dropdown'] = step1
        if not step1['ok']:
            log['errors'].append('下拉清单写入回读不一致')
            json.dump(log, open(LEDGER, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
            return 2

        # 2) 分批写 K 列
        print(f'\n=== 步骤2: 写 K 列 {len(vals)} 格（每批 {BATCH}）===')
        fail = 0
        for s in range(0, len(vals), BATCH):
            chunk = vals[s:s + BATCH]
            d = write_cells(SH_MAIN, [{'row': p['row'], 'col': p['col'], 'value': p['value']} for p in chunk])
            time.sleep(0.8)
            r0, r1 = chunk[0]['row'], chunk[-1]['row']
            got = read(SH_MAIN, r0, r1, 10, 10)
            import csv as _csv, io as _io
            gots = [r[0].strip() for r in _csv.reader(_io.StringIO(got))] if isinstance(got, str) else [r[0] for r in got]
            bad = []
            for p, g in zip(chunk, gots):
                if g != p['value']:
                    bad.append({'excel_row': p['excel_row'], 'expect': p['value'], 'got': g})
            fail += len(bad)
            rec = {'batch': s // BATCH + 1, 'rows': len(chunk), 'excel_rows': [chunk[0]['excel_row'], chunk[-1]['excel_row']],
                   'bad': bad, 'resp': json.dumps(d, ensure_ascii=False)[:100]}
            log['batches'].append(rec)
            print(f"  批次{rec['batch']:>2} 行{rec['excel_rows'][0]}-{rec['excel_rows'][1]} {len(chunk)}格 | 回读不符 {len(bad)} | {'OK' if not bad else 'FAIL'}")
            if bad[:3]:
                print('    ', bad[:3])
            if fail > 3:
                print('  失败超阈值，中止'); break
            time.sleep(0.8)

        # 3) 写后全量回读
        print('\n=== 步骤3: 写后全量回读 ===')
        import csv as _csv, io as _io
        after = read(SH_MAIN, 0, 136, 0, 19)
        arows = list(_csv.reader(_io.StringIO(after)))
        wrong = []
        filled = 0
        for i, p in enumerate(vals):
            row = arows[p['row']]
            k = row[10].strip() if len(row) > 10 else ''
            if k:
                filled += 1
            if k != p['value']:
                wrong.append({'excel_row': p['excel_row'], 'expect': p['value'], 'got': k})
        desc_after = read(SH_DESC, 41, 60, 5, 5)
        drows = list(_csv.reader(_io.StringIO(desc_after)))
        f_items = [(41 + i, r[0].strip()) for i, r in enumerate(drows) if r and r[0].strip()]
        summary = {'rows': len(vals), 'filled': filled, 'wrong': wrong[:20], 'wrongCount': len(wrong),
                   'f_column_items': f_items, 'errors': log['errors']}
        log['summary'] = summary
        json.dump(log, open(LEDGER, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        print('  K 列非空行:', filled, '/', len(vals), '| 与期望不符:', len(wrong))
        print('  字段说明 F 列选项:', f_items)
        print('\nRESULT', 'PASS' if (not wrong and filled == len(vals)) else 'FAIL')
        return 0 if (not wrong and filled == len(vals)) else 2

    print('未知模式'); return 1


sys.exit(main())
