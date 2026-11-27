#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""145-apply-revert.py —— 批量回写 49 行价格到微盟（10 商品 / 66 SKU）

小样已 PASS（144）。按商品逐单写，每单回读验证；失败>3 中止；逐条台账断点续跑。
允许改动清单：仅 SKU salePrice。
"""
import json, glob, os, subprocess, time, datetime
from collections import defaultdict

REPO = r'D:\workbuddy\weimob-auto-tips'
BK = os.path.join(REPO, 'backup')
PLAN = json.load(open(sorted(glob.glob(os.path.join(BK, '143-revert-plan_*.json')))[-1], encoding='utf-8'))
ts = datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
LEDGER = os.path.join(BK, f'145-revert-ledger_{ts}.json')
FAIL_THRESHOLD = 3


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


by_gid = defaultdict(list)
for p in PLAN['plan']:
    for w in p['writes']:
        by_gid[w['goodsId']].append(dict(w, seq=p['seq']))

# 断点续跑
done = set()
if os.path.exists(LEDGER):
    for r in json.load(open(LEDGER, encoding='utf-8'))['records']:
        if r.get('status') == 'ok':
            done.add(r['goodsId'])
todo = [(gid, ws) for gid, ws in sorted(by_gid.items()) if gid not in done]
print(f'待写商品 {len(todo)}/{len(by_gid)}，SKU {sum(len(w) for _, w in todo)} 处')
records, failures = [], 0


def flush():
    json.dump({'at': datetime.datetime.now().isoformat(), 'records': records,
               'failures': failures, 'total': len(by_gid)},
              open(LEDGER, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)


for i, (gid, ws) in enumerate(todo, 1):
    rec = {'goodsId': gid, 'seqs': sorted({w['seq'] for w in ws}),
           'skuCount': len(ws), 'at': datetime.datetime.now().isoformat()}
    try:
        before = detail(gid)
        bmap = {s['skuId']: s for s in before['skuList']}
        writes = [(w['skuId'], w['target']) for w in ws]
        rb = [(w['skuId'], w['rollback']) for w in ws]
        res = write(gid, writes)
        if not (res.get('data') or {}).get('success'):
            raise RuntimeError('未success: ' + json.dumps(res, ensure_ascii=False)[:140])
        time.sleep(0.25)
        after = detail(gid)
        amap = {s['skuId']: s for s in after['skuList']}
        wids = {s for s, _ in writes}
        ok = (all(abs(float(amap[s]['salePrice']) - v) < 0.001 for s, v in writes)
              and all(float(s['salePrice']) == float(bmap[s['skuId']]['salePrice'])
                      for s in after['skuList'] if s['skuId'] not in wids)
              and all(amap[s].get('costPrice') == bmap[s].get('costPrice') for s in wids))
        rec.update({'status': 'ok' if ok else 'VERIFY_FAIL', 'rollback': [
            {'skuId': s, 'salePrice': v} for s, v in rb]})
        if not ok:
            failures += 1
        print(f'  [{i:2d}/{len(todo)}] gid={gid} seq={rec["seqs"]} SKU={len(ws)} {"OK" if ok else "VERIFY_FAIL"}')
    except Exception as e:
        rec.update({'status': 'FAIL', 'err': str(e)[:200]})
        failures += 1
        print(f'  [{i:2d}/{len(todo)}] gid={gid} FAIL {str(e)[:100]}')
    records.append(rec)
    flush()
    if failures > FAIL_THRESHOLD:
        print(f'失败 {failures} > {FAIL_THRESHOLD}，中止')
        break

print(f'完成: ok={sum(1 for r in records if r["status"]=="ok")}, 失败={failures}, 台账={LEDGER}')
