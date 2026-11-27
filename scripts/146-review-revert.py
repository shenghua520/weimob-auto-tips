#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""146-review-revert.py —— 49行回写独立复核（另起脚本重新读现网，不复用145中间态）

R1 目标级：66 个 SKU 现价 == 表格现网价
R2 连带级：目标 SKU 的 costPrice 未被冲
R3 范围外级：143 plan 之外的 SKU 现价 == 基线快照（130/132）价
R4 表格级：49 行价格仍是表格现价（未被误写回）
"""
import json, glob, os, subprocess
from collections import defaultdict

REPO = r'D:\workbuddy\weimob-auto-tips'
BK = os.path.join(REPO, 'backup')
PLAN = json.load(open(sorted(glob.glob(os.path.join(BK, '143-revert-plan_*.json')))[-1], encoding='utf-8'))
NOW = json.load(open(os.path.join(REPO, '.scan/stationery_now.json'), encoding='utf-8'))
BASE = json.load(open(sorted(glob.glob(os.path.join(BK, '132-wos-sku-details_*.json')))[-1], encoding='utf-8'))['list']
base_map = {}
for x in BASE:
    for s in x['skuList']:
        base_map[(x['goodsId'], s['skuId'])] = s


def wos(args, timeout=120):
    p = subprocess.run(['woscli'] + args, capture_output=True, text=True,
                       encoding='utf-8', errors='replace', timeout=timeout)
    if p.returncode != 0:
        raise RuntimeError(p.stderr[:200] or p.stdout[:200])
    return json.loads(p.stdout)


target = {}
for p in PLAN['plan']:
    for w in p['writes']:
        target[(w['goodsId'], w['skuId'])] = {'want': w['target'], 'cost': w.get('costPrice'), 'seq': p['seq']}

# 重新读现网全部目标商品
now_map = {}
for gid in sorted({g for g, _ in target}):
    d = wos(['goods', 'shop-goods-get', '--goods-id', str(gid),
             '--include-sku', 'true', '--output-format', 'json'])['data']
    for s in d['skuList']:
        now_map[(gid, s['skuId'])] = s

r1 = [(k, v['want'], float(now_map[k]['salePrice'])) for k, v in target.items()
      if k not in now_map or abs(float(now_map[k]['salePrice']) - v['want']) >= 0.001]
r2 = [(k, v['cost'], now_map[k].get('costPrice')) for k, v in target.items()
      if k in now_map and v['cost'] is not None and now_map[k].get('costPrice') != v['cost']]
r3 = []
for (gid, sid), s in now_map.items():
    b = base_map.get((gid, sid))
    if b is not None and (gid, sid) not in target:
        if float(s['salePrice']) != float(b['salePrice']):
            r3.append((gid, sid, b['salePrice'], s['salePrice']))

# R4 表格现价 unchanged（对比 stationery_now 与本次再读的 49 行）
r4 = []
import sys, io, csv
sys.path.insert(0, r'C:\Users\shenghua\.workbuddy\plugins\cache\workbuddy-builtin\tencent-docs-plugin\5.11.3-wb.43806934.gecace0f7.ha395516167d4\skills\tencent-docs')
import tencentdocs as td
d = td.call_tool('sheet-mcp', 'get_cell_data',
                 {'file_id': 'DSnVhVGdTR294UE5P', 'sheet_id': '000001',
                  'start_row': 0, 'end_row': 105, 'start_col': 0, 'end_col': 19,
                  'return_csv': True}, timeout=240)[0]
s = json.loads(d.get('result', {}).get('content', [{}])[0].get('text', '{}')).get('csv_data', '')
fresh = {i + 1: r for i, r in enumerate(list(csv.reader(io.StringIO(s))))}
for c in NOW['changed']:
    if not any(dd['col'] in (16, 17, 18, 19) for dd in c['diff']):
        continue
    er = c['excel_row']
    if er not in fresh:
        r4.append((er, '缺失')); continue
    rr = fresh[er] + [''] * 20
    for j in (16, 17, 18, 19):
        if rr[j].strip() != c['row'][j].strip():
            r4.append((er, j, c['row'][j], rr[j]))

print(f'R1 目标级: 核对 {len(target)} 个SKU, 差异 {len(r1)}')
for x in r1[:10]: print('   ', x)
print(f'R2 连带级: costPrice 差异 {len(r2)}')
for x in r2[:10]: print('   ', x)
print(f'R3 范围外级: 目标外SKU现价变化 {len(r3)}')
for x in r3[:10]: print('   ', x)
print(f'R4 表格级: 49行价格变动 {len(r4)}')
for x in r4[:10]: print('   ', x)

verdict = 'PASS' if not (r1 or r2 or r3 or r4) else 'FAIL'
out = os.path.join(BK, '146-revert-review.json')
json.dump({'at': __import__('datetime').datetime.now().isoformat(),
           'R1_target': r1, 'R2_linked': r2, 'R3_outside': r3, 'R4_sheet': r4,
           'VERDICT': verdict}, open(out, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('VERDICT', verdict, '报告', out)
