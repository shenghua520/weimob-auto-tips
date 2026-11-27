#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""171-verify-box-goods.py —— 第三种验证：整盒规格是否是微盟的「另一个独立商品」。
按名称关键词 + 整盒进价 双维度在微盟全量商品中搜索，确认是否存在成本价=整盒进价的商品/SKU。
只读。
"""
import json, glob, os

BK = r'D:\workbuddy\weimob-auto-tips\backup'
G = json.load(open(sorted(glob.glob(os.path.join(BK, '130-wos-goods-all_*.json')))[-1], encoding='utf-8'))['list']

# 表格整盒规格进价（来自 170 只读结果）
BOX = [
    {'seq': '20', 'kw': '双孔屑', 'box_cost': 48.84, 'box_price': 80.60},
    {'seq': '22', 'kw': 'B2双孔', 'box_cost': 27.00, 'box_price': 44.60},
    {'seq': '23', 'kw': 'B1单孔', 'box_cost': 34.68, 'box_price': 57.20},
    {'seq': '25', 'kw': '书包款', 'box_cost': 60.66, 'box_price': 100.10},
    {'seq': '26', 'kw': '糖果猫咪', 'box_cost': 64.98, 'box_price': 107.20},
    {'seq': '27', 'kw': '小酷龙', 'box_cost': 195.48, 'box_price': 322.60},
]

print(f'微盟全量商品数: {len(G)}\n')
for b in BOX:
    # 名称命中
    byname = [g for g in G if b['kw'] in (g.get('title') or '')]
    # 成本价命中：查详情太重，先用列表里可能的 costPrice 字段；没有则标注需详情
    print(f"=== seq{b['seq']} {b['kw']} 整盒进价={b['box_cost']} 整盒售价={b['box_price']}")
    print(f'    名称命中商品 {len(byname)} 个:')
    for g in byname:
        cp = g.get('costPrice') or g.get('minCostPrice')
        msp = g.get('minSalePrice') or g.get('salePrice')
        print(f"      gid={g['goodsId']} code={g.get('outerGoodsCode')} 标题={g.get('title')!r} "
              f"列表成本={cp!r} 列表售价={msp!r} classify={[c.get('name') for c in (g.get('classifyList') or [])]}")
    print()
