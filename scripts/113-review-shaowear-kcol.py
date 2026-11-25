# -*- coding: utf-8 -*-
"""113 · 少儿穿戴表 K 列补填 —— 独立只读复核（七步法第6步）

独立性：另起脚本、重新拉取全表，不复用 112 的任何回读结果；
期望值取自写入前的计划文件 .scan/shaowear_kcol_plan.json 与写前快照 shaowear_before_000004.csv。

三轮：
  R1 样本级 —— 抽 5 条看业务合理性（首个书包 / 错值覆盖 / 品类推断行 / 微盟无商品行 / 末行）
  R2 全量级 —— ①K 列 136 行全部有值且在字段说明下拉清单内 ②非 K 列逐格零改动 ③字段说明除新增项外零改动 ④其它分表抽查
  R3 归因级 —— 时间窗 + 行号主键区间 + 集合差（不多不少）
"""
import sys, json, csv, io, time
sys.path.insert(0, r'C:\Users\shenghua\.workbuddy\plugins\cache\workbuddy-builtin\tencent-docs-plugin\5.11.3-wb.43806934.gecace0f7.ha395516167d4\skills\tencent-docs')
import tencentdocs as td

REPO = 'D:/workbuddy/weimob-auto-tips'
FILE_ID = 'DSnVhVGdTR294UE5P'
PLAN = json.load(open(f'{REPO}/.scan/shaowear_kcol_plan.json', encoding='utf-8'))
BEFORE_MAIN = list(csv.reader(io.StringIO(open(f'{REPO}/.scan/shaowear_before_000004.csv', encoding='utf-8').read())))
BEFORE_DESC = list(csv.reader(io.StringIO(open(f'{REPO}/.scan/shaowear_before_00000a.csv', encoding='utf-8').read())))
STATIC_FAIL, VOLATILE = [], []


def call(tool, args):
    res, err = td.call_tool('sheet-mcp', tool, args, timeout=180)
    if err:
        raise RuntimeError(f'{tool} ERR: {err}')
    txt = res.get('result', {}).get('content', [{}])[0].get('text', '') if res else ''
    try:
        return json.loads(txt)
    except Exception:
        return {'_raw': txt}


def read_rows(sheet, r0, r1, c0, c1):
    d = call('get_cell_data', {'file_id': FILE_ID, 'sheet_id': sheet,
                                'start_row': r0, 'end_row': r1, 'start_col': c0, 'end_col': c1,
                                'return_csv': True})
    s = d.get('csv_data') if isinstance(d, dict) else None
    if s is None:
        s = json.loads(d['result']['content'][0]['text'])['csv_data']
    return list(csv.reader(io.StringIO(s)))


def cell(r, j):
    return (r[j] or '').strip() if len(r) > j else ''


rep = {'reviewedAt': time.strftime('%Y-%m-%dT%H:%M:%S'), 'R1': [], 'R2': {}, 'R3': {}, 'verdict': 'PENDING'}

# ===== 独立重新拉取 =====
after_main = read_rows('000004', 0, 260, 0, 19)
after_desc = read_rows('00000a', 0, 90, 0, 9)
print('独立重拉：少儿穿戴 CSV 行数', len(after_main), '| 字段说明行数', len(after_desc))

# ===== R2 全量级 =====
# ① K 列 136 行：非空 + 取值合法 + 在下拉清单内
f_items = [(i, cell(r, 5)) for i, r in enumerate(after_desc) if 41 <= i <= 140 and cell(r, 5)]
opt_list = [v for i, v in f_items if i >= 42]
print('\n=== 字段说明 F 列下拉清单 ===')
print('  ', opt_list)
if '健康体态' not in opt_list:
    STATIC_FAIL.append({'scope': '下拉清单', 'why': '缺「健康体态」'})
if opt_list[:10] != [v for i, v in [(i, cell(r, 5)) for i, r in enumerate(BEFORE_DESC) if 41 <= i <= 140 and cell(r, 5)] if i >= 42]:
    STATIC_FAIL.append({'scope': '下拉清单', 'why': '原有 10 项被改动'})
if len(opt_list) != 11:
    STATIC_FAIL.append({'scope': '下拉清单', 'why': f'选项数 {len(opt_list)} ≠ 11'})

k_vals, k_bad = {}, []
for p in PLAN['values']:
    idx = p['row']
    got = cell(after_main[idx], 10) if idx < len(after_main) else ''
    k_vals[idx] = got
    if got != p['value']:
        k_bad.append({'excel_row': p['excel_row'], 'expect': p['value'], 'got': got})
    if got not in opt_list:
        STATIC_FAIL.append({'scope': 'K值不在下拉清单', 'excel_row': p['excel_row'], 'got': got})
if k_bad:
    STATIC_FAIL.append({'scope': 'K列取值', 'list': k_bad[:20], 'count': len(k_bad)})

# 数据行外不得有多余非空 K
spill = [(i, cell(r, 10)) for i, r in enumerate(after_main) if i > 136 and cell(r, 10)]
if spill:
    STATIC_FAIL.append({'scope': '溢出', 'list': spill[:10]})

# ② 非 K 列逐格零改动（行 0..260 × 列 0..19，排除 K=10）
diff_non_k = []
for i in range(max(len(BEFORE_MAIN), len(after_main))):
    b = BEFORE_MAIN[i] if i < len(BEFORE_MAIN) else []
    a = after_main[i] if i < len(after_main) else []
    for j in range(20):
        if j == 10:
            continue
        if cell(b, j) != cell(a, j):
            diff_non_k.append({'row': i + 1, 'col': chr(65 + j), 'before': cell(b, j), 'after': cell(a, j)})
if diff_non_k:
    STATIC_FAIL.append({'scope': '非K列零改动', 'list': diff_non_k[:20], 'count': len(diff_non_k)})

# ③ 字段说明：除 F53 外零改动
diff_desc = []
for i in range(max(len(BEFORE_DESC), len(after_desc))):
    b = BEFORE_DESC[i] if i < len(BEFORE_DESC) else []
    a = after_desc[i] if i < len(after_desc) else []
    for j in range(10):
        if i == 52 and j == 5:
            continue
        if cell(b, j) != cell(a, j):
            diff_desc.append({'row': i + 1, 'col': chr(65 + j), 'before': cell(b, j), 'after': cell(a, j)})
if diff_desc:
    STATIC_FAIL.append({'scope': '字段说明零改动', 'list': diff_desc[:20], 'count': len(diff_desc)})

# ④ 其它分表抽查（不在允许改动清单内，抽查其 K 列现状）
others = {}
for sid, name in [('000002', '体育用品'), ('000006', '家庭日用'), ('000008', '米面油品')]:
    rs = read_rows(sid, 0, 260, 10, 10)
    filled = [(i + 1, cell(r, 0)) for i, r in enumerate(rs) if cell(r, 0)]
    others[name] = {'sheet': sid, 'kFilled': len(filled), 'sample': filled[:4]}
print('\n=== 其它分表 K 列现状（抽查，确认未被波及）===')
for k, v in others.items():
    print(f"  {k}({v['sheet']}): 非空 {v['kFilled']} 行  样例 {v['sample']}")

rep['R2'] = {'kRows': len(PLAN['values']), 'kBad': len(k_bad), 'kAllFilled': sum(1 for v in k_vals.values() if v),
             'dropdown': opt_list, 'nonKCellDiffs': len(diff_non_k), 'descCellDiffs': len(diff_desc),
             'spill': len(spill), 'others': others, 'staticFailCount': len(STATIC_FAIL), 'staticFails': STATIC_FAIL}

# ===== R1 样本级 =====
picks = [PLAN['values'][0],
         next(v for v in PLAN['values'] if v['old_value'] == '儿童运动鞋'),
         next(v for v in PLAN['values'] if v['excel_row'] == 124),
         next(v for v in PLAN['values'] if v['excel_row'] == 129),
         PLAN['values'][-1]]
rep['R1'] = [{'excel_row': p['excel_row'], 'seq': p['seq'], 'name': p['name'], 'old': p['old_value'],
              'now': k_vals.get(p['row']), 'expect': p['value'], 'basis': p['basis']} for p in picks]
print('\n=== R1 样本级 ===')
for r in rep['R1']:
    print(f"  行{r['excel_row']} 序号{r['seq']} {r['name'][:26]} K:{r['old']!r}→{r['now']!r} | {r['basis'][:78]}")

# ===== R3 归因级 =====
# 只统计数据行（idx>=1），表头行(二级分组)不计入
before_k = {i: cell(r, 10) for i, r in enumerate(BEFORE_MAIN) if i >= 1 and cell(r, 10)}
after_k = {i: v for i, v in k_vals.items() if v}
newly = sorted(set(after_k) - set(before_k))
overwritten = sorted(set(after_k) & set(before_k))
removed = sorted(set(before_k) - set(after_k))
seq_dist = {}
for p in PLAN['values']:
    seq_dist.setdefault(p['seq'], set()).add(k_vals.get(p['row']))
rep['R3'] = {
    'timeWindow': {'snapshotAt': '2026-11-25 09:2x (110 只读取证)', 'writeAt': '2026-11-25 (112 apply)'},
    'rowKeyRange': [min(k_vals), max(k_vals)],
    'beforeKNonEmpty': len(before_k), 'afterKNonEmpty': len(after_k),
    'newlyFilled': len(newly), 'overwritten': len(overwritten), 'removed': len(removed),
    'overwrittenRows': [{'excel_row': i + 1, 'seq': cell(after_main[i], 0).strip(),
                         'old': before_k[i], 'new': after_k.get(i)} for i in overwritten],
    'exactlyAllDataRows': len(after_k) == len(PLAN['values']) and len(removed) == 0,
    'seqToGroupConsistent': all(len(v) == 1 for v in seq_dist.values()),
    'seqGroups': {k: list(v)[0] for k, v in sorted(seq_dist.items())},
}
print('\n=== R3 归因级 ===')
print('  写前 K 非空', len(before_k), '→ 写后', len(after_k), '| 新填', len(newly), '| 覆盖', len(overwritten), '| 丢失', len(removed))
print('  覆盖行明细:', rep['R3']['overwrittenRows'])
print('  每个序号只对应一个分组:', rep['R3']['seqToGroupConsistent'])

ok = (not STATIC_FAIL and rep['R3']['exactlyAllDataRows'] and rep['R3']['seqToGroupConsistent']
      and rep['R2']['kAllFilled'] == len(PLAN['values']))
rep['verdict'] = 'PASS' if ok else 'FAIL'
json.dump(rep, open(f'{REPO}/backup/113-kcol-review.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('\n[汇总]', json.dumps({'verdict': rep['verdict'], 'kAllFilled': rep['R2']['kAllFilled'],
                              'kBad': rep['R2']['kBad'], 'nonKDiffs': rep['R2']['nonKCellDiffs'],
                              'descDiffs': rep['R2']['descCellDiffs'], 'spill': rep['R2']['spill'],
                              'staticFail': len(STATIC_FAIL)}, ensure_ascii=False, indent=1))
print('REVIEW VERDICT:', rep['verdict'])
print('报告落盘: backup/113-kcol-review.json')
sys.exit(0 if ok else 2)
