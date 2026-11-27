#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""132-fetch-wos-skus.py —— 只读取证：表命中商品的 WOS SKU 级详情（原版 + 兑换版）

匹配法：表 C 列商品名归一化（去【兑换】/空白）↔ WOS title；
产出 backup/132-wos-sku-details_<ts>.json，含每个 goodsId 的 skuList(skuId/salePrice/outerSkuCode/规格)。
"""
import subprocess, json, os, re, glob, datetime, collections
from collections import defaultdict

REPO = r'D:\workbuddy\weimob-auto-tips'
BACKUP = os.path.join(REPO, 'backup')
D = json.load(open(os.path.join(REPO, '.scan', 'stationery_probe.json'), encoding='utf-8'))
ROWS = [x[1:] for x in D['data']]
WOS_LIST = json.load(open(sorted(glob.glob(os.path.join(BACKUP, '130-wos-goods-all_*.json')))[-1], encoding='utf-8'))['list']
ts = datetime.datetime.now().strftime('%Y%m%d-%H%M%S')


def norm(s):
    return re.sub(r'[\s\u3000]', '', re.sub(r'【兑换】', '', str(s or '').strip())).lower()


def wos(args, timeout=120):
    p = subprocess.run(['woscli'] + args, capture_output=True, text=True,
                       encoding='utf-8', errors='replace', timeout=timeout)
    if p.returncode != 0:
        raise RuntimeError(p.stderr[:200])
    return json.loads(p.stdout)


def main():
    titles = defaultdict(list)
    for g in WOS_LIST:
        titles[norm(g['title'])].append(g['goodsId'])
    # 必须收集「所有行」的名称：同一序号下不同规格行的商品名可能不同
    names = {norm(r[2]) for r in ROWS if len(r) > 2 and r[2].strip()}
    gids = sorted(set(g for name, ids in titles.items() if name in names for g in ids))
    print(f'匹配到 {len(gids)} 个 goodsId（含原版+兑换版）')

    details = []
    errs = []
    for i, gid in enumerate(gids, 1):
        try:
            d = wos(['goods', 'shop-goods-get', '--goods-id', str(gid),
                     '--include-sku', 'true', '--output-format', 'json']).get('data') or {}
            details.append({
                'goodsId': gid, 'title': d.get('title'), 'outerGoodsCode': d.get('outerGoodsCode'),
                'isOnline': d.get('isOnline'),
                'groups': [c['name'] for c in (d.get('goodsClassifyList') or [])],
                'skuList': [{
                    'skuId': s['skuId'], 'outerSkuCode': s.get('outerSkuCode'),
                    'skuBarCode': s.get('skuBarCode'), 'salePrice': s.get('salePrice'),
                    'costPrice': s.get('costPrice'), 'skuStockNum': s.get('skuStockNum'),
                    'specs': [v.get('specValueName') for v in (s.get('skuSpecValueList') or [])],
                } for s in (d.get('skuList') or [])],
            })
        except Exception as e:
            errs.append({'goodsId': gid, 'err': str(e)[:200]})
        if i % 25 == 0:
            print(f'  {i}/{len(gids)}')
    out = {'generatedAt': datetime.datetime.now().isoformat(),
           'count': len(details), 'errors': errs, 'list': details}
    p = os.path.join(BACKUP, f'132-wos-sku-details_{ts}.json')
    json.dump(out, open(p, 'w', encoding='utf-8'), ensure_ascii=False)
    print('\n落盘:', p, ' 详情', len(details), ' 失败', len(errs))
    print('SKU 总数:', sum(len(x['skuList']) for x in details))


if __name__ == '__main__':
    main()
