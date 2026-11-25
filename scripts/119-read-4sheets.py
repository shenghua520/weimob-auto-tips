# -*- coding: utf-8 -*-
"""只读取证：4 张待补表的完整行 + 微盟商品库映射可用性"""
import sys, json, csv, io
sys.path.insert(0, r'C:\Users\shenghua\.workbuddy\plugins\cache\workbuddy-builtin\tencent-docs-plugin\5.11.3-wb.43806934.gecace0f7.ha395516167d4\skills\tencent-docs')
import tencentdocs as td

REPO = 'D:/workbuddy/weimob-auto-tips'
FILE_ID = 'DSnVhVGdTR294UE5P'

def csvget(sid, r0, r1, c0, c1):
    d = td.call_tool('sheet-mcp', 'get_cell_data',
                     {'file_id': FILE_ID, 'sheet_id': sid, 'start_row': r0, 'end_row': r1,
                      'start_col': c0, 'end_col': c1, 'return_csv': True}, timeout=240)[0]
    t = d.get('result', {}).get('content', [{}])[0].get('text', '{}')
    try: j = json.loads(t)
    except Exception: return []
    s = j.get('csv_data', '')
    return list(csv.reader(io.StringIO(s))) if s else []

SHEETS = [('000003', '少儿护理'), ('000005', '少儿食品'), ('000008', '米面油品'), ('000009', '家用电器')]

for sid, nm in SHEETS:
    rows = csvget(sid, 0, 300, 0, 19)
    # 找有效数据行
    data = []
    for i, r in enumerate(rows):
        if len(r) > 1 and r[0].strip() and r[0].strip() != '序号':
            data.append((i, r))
    print(f'\n{"="*100}')
    print(f'=== {nm} ({sid})  表头 + {len(data)} 行数据 ===')
    hdr = rows[0] if rows else []
    print('表头:', [f'{chr(65+j)}={v[:16]}' for j, v in enumerate(hdr) if v.strip()])
    for i, r in data[:3]:
        print(f'  行{i+1}:', [v[:22] for v in r[:12]])
    print('  ...')
    for i, r in data[-2:]:
        print(f'  行{i+1}:', [v[:22] for v in r[:12]])
    # K 列统计
    kv = [(i, r[10].strip()) for i, r in data if len(r) > 10 and r[10].strip()]
    print(f'  K 列已填 {len(kv)} 行; 取值分布:', {v: sum(1 for _, x in kv if x == v) for _, v in kv})
    # 编码列（D=3）样本
    codes = [(i, r[3].strip()) for i, r in data if len(r) > 3 and r[3].strip()]
    print(f'  D列(编码)非空 {len(codes)}; 样本:', [c for _, c in codes[:12]])
    json.dump({'rows': [[i] + r for i, r in data]}, open(f'{REPO}/.scan/sheet_{sid}_{nm}.json', 'w', encoding='utf-8'), ensure_ascii=False)
