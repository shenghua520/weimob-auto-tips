#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""135-sample-price.py —— 售价链路小样：seq6 原版 3 SKU，写→回读三查→自动回滚。

WOS price-update 只传 skuId+salePrice（docs/15 已验证不碰 costPrice/库存/条码）。
"""
import subprocess, json, glob, os, datetime

REPO = r'D:\workbuddy\weimob-auto-tips'
BACKUP = os.path.join(REPO, 'backup')
PLAN = json.load(open(sorted(glob.glob(os.path.join(BACKUP, '133-plan_*.json')))[-1], encoding='utf-8'))
DET = {x['goodsId']: x for x in json.load(open(sorted(glob.glob(os.path.join(BACKUP, '132-wos-sku-details_*.json')))[-1], encoding='utf-8'))['list']}
SEQ = '6'


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
    x = next(p for p in PLAN['plan'] if p['seq'] == SEQ)
    gid = x['origGoodsId']
    writes = [w for w in x['priceWrites'] if w['side'] == 'orig']
    print(f'小样 seq{SEQ} orig={gid} 写入{len(writes)} SKU')
    for w in writes:
        print('  ', w['skuId'], w['cur'], '->', w['target'])

    before = detail(gid)
    bmap = {s['skuId']: s for s in before['skuList']}
    payload = json.dumps([{'skuId': w['skuId'], 'salePrice': w['target']} for w in writes],
                         ensure_ascii=False, separators=(',', ':'))
    print('\n[1] dry-run')
    dry = wos(['goods', 'price-update', '--goods-id', str(gid), '--sku-list', payload,
               '--dry-run', '--output-format', 'json'])
    print('  ', json.dumps(dry, ensure_ascii=False)[:200])

    print('\n[2] 实际写')
    res = wos(['goods', 'price-update', '--goods-id', str(gid), '--sku-list', payload,
               '--output-format', 'json'])
    print('  ', json.dumps(res, ensure_ascii=False)[:200])

    print('\n[3] 回读三查')
    after = detail(gid)
    amap = {s['skuId']: s for s in after['skuList']}
    ok = True
    for w in writes:
        sid = w['skuId']
        b, a = bmap[sid], amap[sid]
        target_hit = abs(float(a['salePrice']) - w['target']) < 0.001
        # 连带字段没被冲
        intact = (a.get('costPrice') == b.get('costPrice') and
                  a.get('outerSkuCode') == b.get('outerSkuCode') and
                  a.get('skuBarCode') == b.get('skuBarCode') and
                  a.get('skuStockNum') == b.get('skuStockNum'))
        # 非目标 SKU 没动
        print(f"  {sid}: salePrice {b['salePrice']}->{a['salePrice']} 目标={target_hit} 连带={intact}")
        ok &= target_hit and intact
    other = [s for s in after['skuList'] if s['skuId'] not in {w['skuId'] for w in writes}]
    for s in other:
        b = bmap[s['skuId']]
        same = s['salePrice'] == b['salePrice']
        print(f"  非目标 {s['skuId']}: {b['salePrice']}->{s['salePrice']} 未动={same}")
        ok &= same

    print('\n[4] 自动回滚')
    rb = json.dumps([{'skuId': w['skuId'], 'salePrice': bmap[w['skuId']]['salePrice']} for w in writes],
                    ensure_ascii=False, separators=(',', ':'))
    wos(['goods', 'price-update', '--goods-id', str(gid), '--sku-list', rb, '--output-format', 'json'])
    back = detail(gid)
    bmap2 = {s['skuId']: s for s in back['skuList']}
    restored = all(abs(float(bmap2[w['skuId']]['salePrice']) - w['cur']) < 0.001 for w in writes)
    print('  回滚后全部复原:', restored)
    ok &= restored

    ledger = {'seq': SEQ, 'goodsId': gid, 'writes': writes, 'before': {str(k): v for k, v in bmap.items()},
              'result': 'PASS' if ok else 'FAIL', 'rolledBack': restored,
              'at': datetime.datetime.now().isoformat()}
    p = os.path.join(BACKUP, '135-sample-price-ledger.json')
    json.dump(ledger, open(p, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('\nRESULT:', ledger['result'], '台账:', p)


if __name__ == '__main__':
    main()
