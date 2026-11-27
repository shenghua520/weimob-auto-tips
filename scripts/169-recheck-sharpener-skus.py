#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""169-recheck-sharpener-skus.py —— 重拉削笔机6商品原版+兑换版全部SKU，
逐 SKU 打出规格名/售价/成本价，供「整盒规格微盟是否有对应SKU」人工+程序交叉核对。
只读，不写任何线上数据。
"""
import json, glob, os, subprocess, datetime

REPO = r'D:\workbuddy\weimob-auto-tips'
BK = os.path.join(REPO, 'backup')
ts = datetime.datetime.now().strftime('%Y%m%d-%H%M%S')

plan = json.load(open(sorted(glob.glob(os.path.join(BK, '161-sharpener-plan_*.json')))[-1], encoding='utf-8'))['plan']


def detail(gid):
    p = subprocess.run(['woscli', 'goods', 'shop-goods-get', '--goods-id', str(gid),
                        '--include-sku', 'true', '--output-format', 'json'],
                       capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=120)
    if p.returncode != 0:
        raise RuntimeError(p.stderr[:300])
    return json.loads(p.stdout)['data']


out = []
for e in plan:
    for side in ('orig', 'exch'):
        gid = e[side + 'GoodsId']
        d = detail(gid)
        skus = []
        for s in d.get('skuList', []):
            skus.append({
                'skuId': s.get('skuId'),
                'specName': s.get('specName') or s.get('skuName') or s.get('specification'),
                'specs': s.get('specs') or s.get('skuSpecList'),
                'salePrice': s.get('salePrice'),
                'costPrice': s.get('costPrice'),
                'editQuantity': s.get('editQuantity'),
                'isDisabled': s.get('isDisabled'),
                'outerSkuCode': s.get('outerSkuCode'),
                'raw_keys': list(s.keys()),
            })
        out.append({
            'seq': e['seq'], 'kw': e['kw'], 'side': side, 'goodsId': gid,
            'title': d.get('title') or d.get('goodsName'),
            'outerGoodsCode': d.get('outerGoodsCode'),
            'skuCount': len(skus), 'skus': skus,
        })

path = os.path.join(BK, f'169-sharpener-all-skus_{ts}.json')
json.dump(out, open(path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)

for item in out:
    print(f"\n=== seq{item['seq']} {item['kw']} [{item['side']}] gid={item['goodsId']} code={item['outerGoodsCode']} SKU数={item['skuCount']}")
    print(f"    标题: {item['title']}")
    for s in item['skus']:
        print(f"    - skuId={s['skuId']} 规格名={s['specName']!r} specs={s['specs']!r} "
              f"售价={s['salePrice']} 成本={s['costPrice']} 库存={s['editQuantity']} 禁用={s['isDisabled']} 编码={s['outerSkuCode']!r}")
print('\n落盘:', path)
