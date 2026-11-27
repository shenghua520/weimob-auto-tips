#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""150-verify-sell-now.py —— 独立对账售价：表格现网 vs 微盟现网（不复用写入中间态）"""
import json, glob, os, subprocess
from collections import defaultdict

REPO = r'D:\workbuddy\weimob-auto-tips'
BK = os.path.join(REPO, 'backup')
latest = lambda p: sorted(glob.glob(os.path.join(BK, p)))[-1]
PLAN = json.load(open(latest('133-plan_*.json'), encoding='utf-8'))
REVERT = json.load(open(latest('143-revert-plan_*.json'), encoding='utf-8'))
NOW = json.load(open(os.path.join(REPO, '.scan/stationery_now.json'), encoding='utf-8'))


def wos(args, timeout=120):
    p = subprocess.run(['woscli'] + args, capture_output=True, text=True,
                       encoding='utf-8', errors='replace', timeout=timeout)
    if p.returncode != 0:
        raise RuntimeError(p.stderr[:200])
    return json.loads(p.stdout)


# 期望售价：133 plan 目标 + 143 回写覆盖
want = defaultdict(dict)
for x in PLAN['plan']:
    for w in x['priceWrites']:
        want[w['goodsId']][w['skuId']] = w['target']
for p in REVERT['plan']:
    for w in p['writes']:
        want[w['goodsId']][w['skuId']] = w['target']

bad, checked = [], 0
for gid in sorted(want):
    d = wos(['goods', 'shop-goods-get', '--goods-id', str(gid),
             '--include-sku', 'true', '--output-format', 'json'])['data']
    now = {s['skuId']: s for s in d['skuList']}
    for sid, v in want[gid].items():
        checked += 1
        cur = now.get(sid, {}).get('salePrice')
        if cur is None or abs(float(cur) - float(v)) >= 0.06:
            bad.append((gid, sid, cur, v))
print(f'售价对账: 商品{len(want)} SKU{checked} 差异{len(bad)}')
for x in bad[:15]:
    print('  ', x)
json.dump({'checked': checked, 'goods': len(want), 'diff': bad,
           'pass': not bad}, open(os.path.join(BK, '150-sell-consistency.json'), 'w', encoding='utf-8'),
          ensure_ascii=False, indent=1)
print('PASS' if not bad else 'FAIL')
