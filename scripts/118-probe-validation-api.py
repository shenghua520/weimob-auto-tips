# -*- coding: utf-8 -*-
"""小样实验（隔离区）：测 set_data_validation 能否写 引用式 下拉公式。
在「引用式使用说明」sheet 的远端空白单元格 AZ100 做实验，不碰任何生产列。
"""
import sys, json
sys.path.insert(0, r'C:\Users\shenghua\.workbuddy\plugins\cache\workbuddy-builtin\tencent-docs-plugin\5.11.3-wb.43806934.gecace0f7.ha395516167d4\skills\tencent-docs')
import tencentdocs as td

FILE_ID = 'DSnVhVGdTR294UE5P'
SHEET = '引用式使用说明'

def call(tool, args):
    d = td.call_tool('sheet-mcp', tool, args, timeout=180)[0]
    t = d.get('result', {}).get('content', [{}])[0].get('text', '')
    try: return json.loads(t)
    except Exception: return {'_raw': t[:600]}

print('=== 实验1：LIST + formula1(引用式公式) ===')
r = call('set_data_validation', {
    'file_id': FILE_ID, 'sheet_id': SHEET,
    'ranges': [f'{SHEET}!AZ100:AZ101'],
    'type': 'LIST',
    'formula1': 'OFFSET(字段说明!$D$43,0,0,COUNTA(字段说明!$D$43:$D$142),1)',
})
print(json.dumps(r, ensure_ascii=False)[:800])

print('\n=== 实验2：LIST + select_options(静态) ===')
r2 = call('set_data_validation', {
    'file_id': FILE_ID, 'sheet_id': SHEET,
    'ranges': [f'{SHEET}!AZ100:AZ101'],
    'type': 'LIST',
    'select_options': [{'id': '1', 'text': '跳绳'}, {'id': '2', 'text': '篮球'}],
})
print(json.dumps(r2, ensure_ascii=False)[:800])
