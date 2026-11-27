#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""154-apply-seq56-price.py —— seq56 售价批量（4 SKU / 4 商品），复用已验证的 WOS price-update 链路。"""
import subprocess, json, glob, os, datetime
from collections import defaultdict

BACKUP = r'D:\workbuddy\weimob-auto-tips\backup'
PLAN = json.load(open(sorted(glob.glob(os.path.join(BACKUP, '151-seq56-plan_*.json')))[-1], encoding='utf-8'))
ts = datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
LEDGER = os.path.join(BACKUP, f'154-seq56-price-ledger_{ts}.json')


def wos(args, timeout=120):
    p = subprocess.run(['woscli'] + args, capture_output=True, text=True,
                       encoding='utf-8', errors='replace', timeout=timeout)
    if p.returncode != 0:
        raise RuntimeError(p.stderr[:250] or p.stdout[:250])
    return json.loads(p.stdout)


def detail(gid):
    return wos(['goods', 'shop-goods-get', '--goods-id', str(gid),
                '--include-sku', 'true', '--output-format', 'json'])['data']


def main():
    by_gid = defaultdict(list)
    for w in PLAN['priceWrites']:
        by_gid[w['goodsId']].append(w)
    records, ok = [], True
    print(f'售价批量 {len(by_gid)} 商品 / {sum(len(v) for v in by_gid.values())} SKU')
    for gid, ws in sorted(by_gid.items()):
        b = {s['skuId']: s for s in detail(gid)['skuList']}
        payload = json.dumps([{'skuId': w['skuId'], 'salePrice': w['target']} for w in ws],
                             ensure_ascii=False, separators=(',', ':'))
        res = wos(['goods', 'price-update', '--goods-id', str(gid), '--sku-list', payload,
                   '--output-format', 'json'])
        assert (res.get('data') or {}).get('success'), json.dumps(res, ensure_ascii=False)[:200]
        a = {s['skuId']: s for s in detail(gid)['skuList']}
        hit = all(abs(float(a[w['skuId']]['salePrice']) - w['target']) < 0.001 for w in ws)
        linked = all(a[w['skuId']].get('costPrice') == b[w['skuId']].get('costPrice') and
                     a[w['skuId']].get('skuBarCode') == b[w['skuId']].get('skuBarCode')
                     for w in ws)
        st = 'ok' if hit and linked else 'verify_fail'
        ok &= (st == 'ok')
        records.append({'goodsId': gid, 'skuCount': len(ws), 'status': st,
                        'rollback': [{'skuId': w['skuId'], 'salePrice': b[w['skuId']]['salePrice']} for w in ws],
                        'at': datetime.datetime.now().isoformat()})
        print(f"  gid={gid} {ws[0]['side']}: {[w['cur'] for w in ws]}->{[w['target'] for w in ws]} {st}")
        json.dump({'records': records, 'at': datetime.datetime.now().isoformat()},
                  open(LEDGER, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('RESULT:', 'PASS' if ok else 'FAIL', '台账:', LEDGER)


if __name__ == '__main__':
    main()
