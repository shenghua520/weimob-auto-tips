# -*- coding: utf-8 -*-
"""9 张分表的下拉清单 vs 微盟可见组二级分组 —— 覆盖差异清单（只读）"""
import sys, json, csv, io
sys.path.insert(0, r'C:\Users\shenghua\.workbuddy\plugins\cache\workbuddy-builtin\tencent-docs-plugin\5.11.3-wb.43806934.gecace0f7.ha395516167d4\skills\tencent-docs')
import tencentdocs as td

REPO = 'D:/workbuddy/weimob-auto-tips'
FILE_ID = 'DSnVhVGdTR294UE5P'
tree = json.load(open(f'{REPO}/backup/106-classify-tree_2026-11-25T01-08-49.json', encoding='utf-8'))
desc = list(csv.reader(io.StringIO(open(f'{REPO}/.scan/shaowear_before_00000a.csv', encoding='utf-8').read())))

SHEETS = [('000001', '学习文具'), ('000002', '体育用品'), ('000003', '少儿护理'), ('000004', '少儿穿戴'),
          ('000005', '少儿食品'), ('000006', '家庭日用'), ('000007', '读物潮玩'), ('000008', '米面油品'),
          ('000009', '家用电器')]

# 微盟可见组（一级分组 isShow=True）下的二级分组
visible_l1 = {str(x['classifyId']): x['name'] for x in tree['l1'] if x.get('isShow')}
l2_by_parent = {}
for x in tree['l2']:
    l2_by_parent.setdefault(str(x['parentId']), []).append(x)

# 字段说明：选项清单表头在 idx41，A..J 列
col_of = {}
for j in range(10):
    h = desc[41][j].strip()
    col_of[h] = j
print('清单表头 → 列:', col_of)

report = {}
for sid, name in SHEETS:
    col = col_of.get(f'二级分组·{name}')
    opts = []
    if col is not None:
        for i in range(42, 141):
            if i < len(desc) and len(desc[i]) > col:
                v = desc[i][col].strip()
                if v:
                    opts.append(v)
    # 微盟侧
    l1id = next((k for k, v in visible_l1.items() if v == name), None)
    wei = []
    if l1id:
        wei = [k['name'] for k in sorted(l2_by_parent.get(l1id, []), key=lambda z: -z['sort'])]
    missing = [w for w in wei if w not in opts]
    extra = [o for o in opts if o not in wei]
    report[name] = {'sheet': sid, 'table_opts': opts, 'weimob_l2': wei, 'missing_in_table': missing, 'extra_in_table': extra}
    # 表格该表 K 列现状
    d = td.call_tool('sheet-mcp', 'get_cell_data',
                     {'file_id': FILE_ID, 'sheet_id': sid, 'start_row': 1, 'end_row': 260,
                      'start_col': 10, 'end_col': 10, 'return_csv': True}, timeout=180)[0]
    s = json.loads(d.get('result', {}).get('content', [{}])[0].get('text', '{}')).get('csv_data', '')
    rs = list(csv.reader(io.StringIO(s))) if s else []
    filled = [r[0].strip() for r in rs if r and r[0].strip()]
    vals = sorted(set(filled))
    report[name]['k_filled'] = len(filled)
    report[name]['k_values'] = vals
    report[name]['k_not_in_dropdown'] = [v for v in vals if v not in opts]
    print(f"\n=== {name} ({sid}) ===")
    print(f"  表格下拉({len(opts)}): {opts}")
    print(f"  微盟L2({len(wei)}): {wei}")
    print(f"  下拉缺失(微盟有表格无): {missing}")
    print(f"  下拉多余(表格有微盟无): {extra}")
    print(f"  表内K列已填 {len(filled)} 行, 取值 {vals}")
    print(f"  已填值不在下拉清单内的: {report[name]['k_not_in_dropdown']}")

json.dump(report, open(f'{REPO}/.scan/dropdown_coverage_9sheets.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('\n落盘: .scan/dropdown_coverage_9sheets.json')
