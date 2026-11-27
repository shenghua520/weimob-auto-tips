#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""144-sample-revert.py —— 49行回写微盟的小样：seq29 一个商品，写→回读→三查→自动回滚。

边界型样本：seq29 是价格模式切换行（R纯豆→空、S/T组合价新增），且售价 2.6→7.1。
允许改动清单：仅 SKU salePrice。验证后无条件回滚到写前状态，线上零残留。
"""
import json, glob, os, subprocess, time, datetime

REPO = r'D:\workbuddy\weimob-auto-tips'
BK = os.path.join(REPO, 'backup')
PLAN = json.load(open(sorted(glob.glob(os.path.join(BK, '143-revert-plan_*.json')))[-1], encoding='utf-8'))
ts = datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
LEDGER = os.path.join(BK, f'144-sample-revert-ledger_{ts}.json')


def wos(args, timeout=120):
    p = subprocess.run(['woscli'] + args, capture_output=True, text=True,
                       encoding='utf-8', errors='replace', timeout=timeout)
    if p.returncode != 0:
        raise RuntimeError(p.stderr[:200] or p.stdout[:200])
    return json.loads(p.stdout)


def detail(gid):
    return wos(['goods', 'shop-goods-get', '--goods-id', str(gid),
                '--include-sku', 'true', '--output-format', 'json'])['data']


def write(gid, items):
    payload = json.dumps([{'skuId': s, 'salePrice': v} for s, v in items],
                         ensure_ascii=False, separators=(',', ':'))
    return wos(['goods', 'price-update', '--goods-id', str(gid),
                '--sku-list', payload, '--output-format', 'json'])


# 选 seq29 的原版 gid（4 SKU）
p = [x for x in PLAN['plan'] if x['seq'] == '29'][0]
gid = p['origGoodsId']
ws = [w for w in p['writes'] if w['goodsId'] == gid]
print(f'小样 seq29 原版 gid={gid}, SKU={len(ws)}')

before = detail(gid)
bmap = {s['skuId']: s for s in before['skuList']}
writes = [(w['skuId'], w['target']) for w in ws]
rb = [(w['skuId'], w['rollback']) for w in ws]
res = write(gid, writes)
assert (res.get('data') or {}).get('success'), res
time.sleep(0.4)
after = detail(gid)
amap = {s['skuId']: s for s in after['skuList']}

target_ok = all(abs(float(amap[s]['salePrice']) - v) < 0.001 for s, v in writes)
wids = {s for s, _ in writes}
other_ok = all(float(s['salePrice']) == float(bmap[s['skuId']]['salePrice'])
               for s in after['skuList'] if s['skuId'] not in wids)
linked_ok = all(amap[s].get('costPrice') == bmap[s].get('costPrice') for s in wids)
print('  三查: 目标价生效=', target_ok, ' 非目标SKU零变化=', other_ok, ' 连带costPrice零变化=', linked_ok)
for s, v in writes:
    print(f"    {s}: {bmap[s]['salePrice']} -> {amap[s]['salePrice']} (期望{v})")

# 无条件回滚到写前
res2 = write(gid, rb)
assert (res2.get('data') or {}).get('success'), res2
time.sleep(0.4)
back = detail(gid)
bck = {s['skuId']: s for s in back['skuList']}
rollback_ok = all(abs(float(bck[s]['salePrice']) - float(v)) < 0.001 for s, v in rb)
print('  回滚复原=', rollback_ok)

result = 'PASS' if (target_ok and other_ok and linked_ok and rollback_ok) else 'FAIL'
json.dump({'at': datetime.datetime.now().isoformat(), 'seq': '29', 'goodsId': gid,
           'writes': writes, 'rollback': rb, 'checks': {'target': target_ok,
           'other': other_ok, 'linked': linked_ok, 'rollback': rollback_ok},
           'result': result},
          open(LEDGER, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('RESULT', result, '台账', LEDGER)
