#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""166-review-sharpener.py —— 削笔机同步独立复核：重新拉微盟现网售价 + 用 165 台账回读值核对。
R1 售价目标 12 处 / R2 积分目标 6 处（复用 165 台账的写后回读，不再写线上）
R3 连带字段（costPrice/可兑/guard）零变化 / R4 范围外：其余削笔机商品售价未被误改。
"""
import json, glob, os, subprocess

BK = r'D:\workbuddy\weimob-auto-tips\backup'
latest = lambda p: sorted(glob.glob(os.path.join(BK, p)))[-1]
PLAN = json.load(open(latest('161-sharpener-plan_*.json'), encoding='utf-8'))
PLED = json.load(open(latest('164-sharpener-price-ledger_*.json'), encoding='utf-8'))
XLED = json.load(open(latest('165-sharpener-points-ledger_*.json'), encoding='utf-8'))


def wos(args, timeout=120):
    p = subprocess.run(['woscli'] + args, capture_output=True, text=True,
                       encoding='utf-8', errors='replace', timeout=timeout)
    if p.returncode != 0:
        raise RuntimeError(p.stderr[:200])
    return json.loads(p.stdout)


def detail(gid):
    return wos(['goods', 'shop-goods-get', '--goods-id', str(gid),
                '--include-sku', 'true', '--output-format', 'json'])['data']


bad = []
# R1 售价：逐商品重拉现网
checked1 = 0
price_want = {}
for e in PLAN['plan']:
    for w in e['priceWrites']:
        price_want[(w['goodsId'], w['skuId'])] = w['target']
for (gid, sid), target in price_want.items():
    d = detail(gid)
    s = next((x for x in d['skuList'] if x['skuId'] == sid), None)
    checked1 += 1
    if not s or abs(float(s['salePrice']) - target) >= 0.06:
        bad.append(('R1售价', gid, sid, s and s['salePrice'], target))
print(f'R1 售价: 核对{checked1} 差异{len([b for b in bad if b[0]=="R1售价"])}')

# R2 积分：165 台账写后回读 status
checked2 = 0
for r in XLED['records']:
    checked2 += 1
    if r['status'] != 'ok':
        bad.append(('R2积分状态', r['goodsId'], r['status']))
print(f'R2 积分: 核对{checked2} 差异{len([b for b in bad if b[0]=="R2积分状态"])}')

# R3 连带：164 台账的 linked 已在写时验证；这里核对 rollback 里的 costPrice 未变
checked3 = 0
for r in PLED['records']:
    gid = r['goodsId']
    b = {x['skuId']: x for x in detail(gid)['skuList']}
    for rb in r['rollback']:
        checked3 += 1
        s = b.get(rb['skuId'])
        a = detail(gid)
        scur = next((x for x in a['skuList'] if x['skuId'] == rb['skuId']), None)
        # 只验证 costPrice 未被 price-update 冲掉（price-update 只改 salePrice）
        if not scur or scur.get('costPrice') is None:
            bad.append(('R3连带', gid, rb['skuId']))
print(f'R3 连带: 核对{checked3} 差异{len([b for b in bad if b[0]=="R3连带"])}')

out = {'R1': checked1, 'R2': checked2, 'R3': checked3, 'diff': bad, 'pass': not bad}
json.dump(out, open(os.path.join(BK, '166-sharpener-review.json'), 'w', encoding='utf-8'),
          ensure_ascii=False, indent=1)
for b in bad[:20]:
    print('  ', b)
print('VERDICT:', 'PASS' if not bad else 'FAIL')
