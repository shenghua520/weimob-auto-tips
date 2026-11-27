#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""152-sample-seq56-price.py —— 售价链路小样：seq56 商品A(3057) orig+exch 各1处，写→回读三查→自动回滚。"""
import subprocess, json, glob, os, datetime

BACKUP = r'D:\workbuddy\weimob-auto-tips\backup'
PLAN = json.load(open(sorted(glob.glob(os.path.join(BACKUP, '151-seq56-plan_*.json')))[-1], encoding='utf-8'))
GIDS = [161456347100397, 161785315100397]   # 3057 orig / exch


def wos(args, timeout=120):
    p = subprocess.run(['woscli'] + args, capture_output=True, text=True,
                       encoding='utf-8', errors='replace', timeout=timeout)
    if p.returncode != 0:
        raise RuntimeError(p.stderr[:300] or p.stdout[:300])
    return json.loads(p.stdout)


def detail(gid):
    return wos(['goods', 'shop-goods-get', '--goods-id', str(gid),
                '--include-sku', 'true', '--output-format', 'json'])['data']


def main():
    writes = [w for w in PLAN['priceWrites'] if w['goodsId'] in GIDS]
    print(f'小样 售价 {len(writes)} SKU（3057 orig+exch）')
    ok, before_all = True, {}
    for w in writes:
        print(f"  {w['side']} {w['goodsId']} sku={w['skuId']} {w['cur']}->{w['target']}")

    # 写前快照
    for gid in GIDS:
        before_all[gid] = detail(gid)

    # 实际写（逐商品）
    for gid in GIDS:
        ws = [w for w in writes if w['goodsId'] == gid]
        payload = json.dumps([{'skuId': w['skuId'], 'salePrice': w['target']} for w in ws],
                             ensure_ascii=False, separators=(',', ':'))
        res = wos(['goods', 'price-update', '--goods-id', str(gid), '--sku-list', payload,
                   '--output-format', 'json'])
        assert (res.get('data') or {}).get('success'), json.dumps(res, ensure_ascii=False)[:200]

    # 回读三查
    print('\n[回读三查]')
    for gid in GIDS:
        b = {s['skuId']: s for s in before_all[gid]['skuList']}
        a = {s['skuId']: s for s in detail(gid)['skuList']}
        for w in [x for x in writes if x['goodsId'] == gid]:
            sid = w['skuId']
            hit = abs(float(a[sid]['salePrice']) - w['target']) < 0.001
            linked = (a[sid].get('costPrice') == b[sid].get('costPrice') and
                      a[sid].get('skuBarCode') == b[sid].get('skuBarCode') and
                      a[sid].get('skuStockNum') == b[sid].get('skuStockNum'))
            print(f"  {w['side']} {sid}: {b[sid]['salePrice']}->{a[sid]['salePrice']} 目标={hit} 连带={linked}")
            ok &= hit and linked

    # 自动回滚
    print('\n[自动回滚]')
    restored = True
    for gid in GIDS:
        rb = [{'skuId': s['skuId'], 'salePrice': s['salePrice']} for s in before_all[gid]['skuList']]
        pay = json.dumps(rb, ensure_ascii=False, separators=(',', ':'))
        wos(['goods', 'price-update', '--goods-id', str(gid), '--sku-list', pay, '--output-format', 'json'])
        a = {s['skuId']: s for s in detail(gid)['skuList']}
        for s in before_all[gid]['skuList']:
            good = abs(float(a[s['skuId']]['salePrice']) - float(s['salePrice'])) < 0.001
            restored &= good
    print('  全部复原:', restored)
    ok &= restored

    ledger = {'writes': writes, 'before': {str(g): before_all[g]['skuList'] for g in GIDS},
              'result': 'PASS' if ok else 'FAIL', 'rolledBack': restored,
              'at': datetime.datetime.now().isoformat()}
    p = os.path.join(BACKUP, '152-sample-seq56-price-ledger.json')
    json.dump(ledger, open(p, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('\nRESULT:', ledger['result'], '台账:', p)


if __name__ == '__main__':
    main()
