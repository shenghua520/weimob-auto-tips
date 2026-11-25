# -*- coding: utf-8 -*-
"""导出表格为 xlsx（只读），并下载到 .scan/nine_groups.xlsx"""
import sys, json, time, os, urllib.request
sys.path.insert(0, r'C:\Users\shenghua\.workbuddy\plugins\cache\workbuddy-builtin\tencent-docs-plugin\5.11.3-wb.43806934.gecace0f7.ha395516167d4\skills\tencent-docs')
import tencentdocs as td

REPO = 'D:/workbuddy/weimob-auto-tips'
FILE_ID = 'DSnVhVGdTR294UE5P'

def raw(service, tool, args):
    d = td.call_tool(service, tool, args, timeout=180)[0]
    res = d.get('result') or {}
    blocks = res.get('content') or []
    for c in blocks:
        t = c.get('text')
        if t:
            try:
                return json.loads(t)
            except Exception:
                continue
    sc = res.get('structuredContent') or {}
    return sc if sc else {}

print('启动导出...')
r = raw('tencent-docs', 'manage.export_file', {'file_id': FILE_ID})
tid = r.get('task_id')
print('task_id =', tid)

url = None
for i in range(40):
    time.sleep(5)
    p = raw('tencent-docs', 'manage.export_progress', {'task_id': tid})
    prog = p.get('progress')
    u = p.get('file_url') or ''
    print(f'  poll{i} progress={prog} url_len={len(u)}')
    if isinstance(u, str) and u.startswith('https://') and len(u) > 100:
        url = u
        break
if not url:
    print('未拿到有效 URL'); sys.exit(1)

open(f'{REPO}/.scan/export_url.txt', 'w', encoding='utf-8').write(url)
print('URL 已保存, 长度', len(url))

out = f'{REPO}/.scan/nine_groups.xlsx'
req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
with urllib.request.urlopen(req, timeout=300) as r2, open(out, 'wb') as f:
    f.write(r2.read())
print('已下载:', out, os.path.getsize(out), 'bytes')
