#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""138-apply-stationery-price.py —— 批量售价同步（WOS price-update，457 处 / 147 商品）

小样已 PASS（135）。按商品逐单写，每单回读验证；失败 >3 立即中止；逐条台账支持断点续跑。
允许改动清单：仅 SKU salePrice。其余字段（costPrice/条码/库存/上下架）零变化。
"""
import subprocess, json, glob, os, time, datetime
from collections import defaultdict

REPO = r'D:\workbuddy\weimob-auto-tips'
BACKUP = os.path.join(REPO, 'backup')
PLAN = json.load(open(sorted(glob.glob(os.path.join(BACKUP, '133-plan_*.json')))[-1], encoding='utf-8'))
ts = datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
LEDGER = os.path.join(BACKUP, f'138-price-ledger_{ts}.json')
FAIL_THRESHOLD = 3


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
    for x in PLAN['plan']:
        for w in x['priceWrites']:
            by_gid[w['goodsId']].append(dict(w, seq=x['seq']))
    # 断点续跑
    done = set()
    if os.path.exists(LEDGER):
        for r in json.load(open(LEDGER, encoding='utf-8'))['records']:
            if r.get('status') == 'ok':
                done.add(r['goodsId'])
    todo = [(gid, ws) for gid, ws in sorted(by_gid.items()) if gid not in done]
    print(f'待写商品 {len(todo)} / {len(by_gid)}；SKU {sum(len(ws) for _, ws in todo)} 处')
    records, failures = [], 0

    def flush():
        json.dump({'at': datetime.datetime.now().isoformat(), 'records': records,
                   'failures': failures, 'total': len(by_gid)},
                  open(LEDGER, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)

    for i, (gid, ws) in enumerate(todo, 1):
        try:
            before = detail(gid)
            bmap = {s['skuId']: s for s in before['skuList']}
            payload = json.dumps([{'skuId': w['skuId'], 'salePrice': w['target']} for w in ws],
                                 ensure_ascii=False, separators=(',', ':'))
            res = wos(['goods', 'price-update', '--goods-id', str(gid), '--sku-list', payload,
                       '--output-format', 'json'])
            if not (res.get('data') or {}).get('success'):
                raise RuntimeError('接口未返回 success: ' + json.dumps(res, ensure_ascii=False)[:160])
            time.sleep(0.25)
            after = detail(gid)
            amap = {s['skuId']: s for s in after['skuList']}
            target_ok = all(abs(float(amap[w['skuId']]['salePrice']) - w['target']) < 0.001 for w in ws)
            # 非目标 SKU 零变化 + 连带字段零变化
            wids = {w['skuId'] for w in ws}
            other_ok = all(s['salePrice'] == bmap[s['skuId']]['salePrice']
                           for s in after['skuList'] if s['skuId'] not in wids)
            linked_ok = all(amap[w['skuId']].get('costPrice') == bmap[w['skuId']].get('costPrice') and
                            amap[w['skuId']].get('skuBarCode') == bmap[w['skuId']].get('skuBarCode') and
                            amap[w['skuId']].get('skuStockNum') == bmap[w['skuId']].get('skuStockNum')
                            for w in ws)
            status = 'ok' if (target_ok and other_ok and linked_ok) else 'verify_fail'
            records.append({'goodsId': gid, 'seqs': sorted(set(w['seq'] for w in ws)),
                            'skuCount': len(ws), 'status': status,
                            'rollback': [{'skuId': w['skuId'], 'salePrice': bmap[w['skuId']]['salePrice']} for w in ws],
                            'at': datetime.datetime.now().isoformat()})
            if status != 'ok':
                failures += 1
                print(f'  [{i}/{len(todo)}] gid={gid} VERIFY FAIL target={target_ok} other={other_ok} linked={linked_ok}')
            else:
                print(f'  [{i}/{len(todo)}] gid={gid} {len(ws)} SKU OK')
        except Exception as e:
            failures += 1
            records.append({'goodsId': gid, 'status': 'error', 'err': str(e)[:300],
                            'at': datetime.datetime.now().isoformat()})
            print(f'  [{i}/{len(todo)}] gid={gid} ERROR {str(e)[:120]}')
        flush()
        if failures > FAIL_THRESHOLD:
            print(f'\n失败 {failures} > {FAIL_THRESHOLD}，立即中止')
            break
        time.sleep(0.15)

    ok = sum(1 for r in records if r['status'] == 'ok')
    print(f'\n完成: OK {ok} / {len(records)}；失败 {failures}；台账 {LEDGER}')


if __name__ == '__main__':
    main()
