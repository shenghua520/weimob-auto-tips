#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""156-review-seq56.py —— seq56 独立复核：另起脚本重新读微盟现网，不复用写入脚本中间态。

R1 售价：4 SKU 现网 == 表格目标（8.6/4.8）
R2 积分：2 兑换 SKU 现网 == 表格目标（28/5.8、28/2），guard 未变
R3 连带：costPrice/条码/库存/上下架未变
R4 范围外：非目标 SKU 售价、seq55 现价零变化
"""
import subprocess, json, glob, os, datetime

BACKUP = r'D:\workbuddy\weimob-auto-tips\backup'
latest = lambda p: sorted(glob.glob(os.path.join(BACKUP, p)))[-1]
PLAN = json.load(open(latest('151-seq56-plan_*.json'), encoding='utf-8'))
LEDGER_P = json.load(open(latest('154-seq56-price-ledger_*.json'), encoding='utf-8'))
LEDGER_X = json.load(open(latest('155-seq56-points-ledger_*.json'), encoding='utf-8'))


def wos(args, timeout=120):
    p = subprocess.run(['woscli'] + args, capture_output=True, text=True,
                       encoding='utf-8', errors='replace', timeout=timeout)
    if p.returncode != 0:
        raise RuntimeError(p.stderr[:200] or p.stdout[:200])
    return json.loads(p.stdout)


def detail(gid):
    return wos(['goods', 'shop-goods-get', '--goods-id', str(gid),
                '--include-sku', 'true', '--output-format', 'json'])['data']


def main():
    target_gids = set()
    for w in PLAN['priceWrites']:
        target_gids.add(w['goodsId'])
    for w in PLAN['pointWrites']:
        target_gids.add(w['goodsId'])
    bad = []
    r1 = r2 = r3 = r4 = 0

    # R1/R3/R4 售价：逐个商品重新拉现网
    for gid in sorted(target_gids):
        snap = PLAN['snapshot'][str(gid)]
        now = detail(gid)
        smap = {s['skuId']: s for s in now['skuList']}
        bmap = {s['skuId']: s for s in snap['skuList']}
        ws = [w for w in PLAN['priceWrites'] if w['goodsId'] == gid]
        wids = {w['skuId'] for w in ws}
        for w in ws:
            r1 += 1
            if abs(float(smap[w['skuId']]['salePrice']) - w['target']) >= 0.001:
                bad.append(('R1售价', gid, w['skuId'], smap[w['skuId']]['salePrice'], w['target']))
        for s in now['skuList']:
            b = bmap.get(s['skuId'], {})
            if s['skuId'] in wids:
                r3 += 1
                for k in ('costPrice', 'skuBarCode', 'skuStockNum'):
                    if s.get(k) != b.get(k):
                        bad.append(('R3连带', gid, s['skuId'], k, b.get(k), s.get(k)))
            else:
                r4 += 1
                if abs(float(s['salePrice']) - float(b.get('salePrice', 0))) >= 0.001:
                    bad.append(('R4非目标售价', gid, s['skuId'], b.get('salePrice'), s['salePrice']))
        if now.get('isOnline') != snap.get('isOnline'):
            bad.append(('R3上下架', gid, snap.get('isOnline'), now.get('isOnline')))

    # R4 seq55 现价零变化
    for item in PLAN['seq55_check'][:2]:
        gid = item['goodsId']
        now = {s['skuId']: s for s in detail(gid)['skuList']}
        for p in item['prices']:
            r4 += 1
            if abs(float(now[p['skuId']]['salePrice']) - float(p['salePrice'])) >= 0.001:
                bad.append(('R4seq55', gid, p['skuId'], p['salePrice'], now[p['skuId']]['salePrice']))

    # R2 积分：台账逐单回读状态 + 目标数值（独立重拉由 157 脚本完成）
    pmap = {w['goodsId']: w for w in PLAN['pointWrites']}
    for r in LEDGER_X['records']:
        r2 += 1
        if r['status'] != 'ok':
            bad.append(('R2积分状态', r['goodsId'], r['status']))
        w = pmap.get(r['goodsId'])
        if not w or abs(float(r['target'][0]) - float(w['target'][0])) >= 0.001 or \
                abs(float(r['target'][1]) - float(w['target'][1])) >= 0.001:
            bad.append(('R2积分目标', r['goodsId'], r.get('target'), w['target'] if w else None))

    print(f'R1 售价目标 {r1} 处 / R2 积分 {r2} 处 / R3 连带 {r3} 处 / R4 范围外 {r4} 处')
    print('差异:', len(bad))
    for b in bad[:20]:
        print('  ', b)
    result = 'PASS' if not bad else 'FAIL'
    out = os.path.join(BACKUP, '156-seq56-review.json')
    json.dump({'R1': r1, 'R2': r2, 'R3': r3, 'R4': r4, 'diff': bad,
               'result': result, 'at': datetime.datetime.now().isoformat()},
              open(out, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('VERDICT:', result, '报告:', out)


if __name__ == '__main__':
    main()
