#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""161-build-sharpener-plan.py —— 削笔机6商品(表格内部编码vs微盟数字编码)按表格价改微盟。

背景：表格 seq20/22/23/25/26/27 用内部编码(APS906T1 等)，微盟用纯数字编码(2945 等)，
上一轮名称+编码匹配判"零命中"跳过。用户指出书包款削笔机等价格不一致，要求按表格改。

口径：表格「1个(颜色随机)」规格为权威（微盟每商品单 SKU，无规格）；
整盒规格微盟无对应 SKU，跳过。售价 Q→salePrice(原版+兑换版)，
积分 S→pointPrice/T→point(仅兑换版在积分商城)，纯豆型 R→point/pointPrice=0。
只读取证，产出 backup/161-sharpener-plan_*.json（含写前快照供回滚）。
"""
import json, glob, os, subprocess, datetime

REPO = r'D:\workbuddy\weimob-auto-tips'
BK = os.path.join(REPO, 'backup')
ts = datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
G = json.load(open(sorted(glob.glob(os.path.join(BK, '130-wos-goods-all_*.json')))[-1], encoding='utf-8'))['list']
PDET = json.load(open(sorted(glob.glob(os.path.join(BK, '131-points-detail_*.json')))[-1], encoding='utf-8'))['list']
pdet = {x['goodsId']: x for x in PDET}

# 表格「1个」规格权威价（实时读取确认，见对话）
TARGETS = [
    {'seq': '20', 'kw': '卷笔刀大小双孔屑', 'code': '2952', 'Q': 6.70, 'point': 22, 'pointPrice': 4.50},
    {'seq': '22', 'kw': 'B2双孔卷笔刀', 'code': '2949', 'Q': 1.30, 'point': 13, 'pointPrice': 0},
    {'seq': '23', 'kw': 'B1单孔卷笔刀', 'code': '2947', 'Q': 0.90, 'point': 9, 'pointPrice': 0},
    {'seq': '25', 'kw': '书包款削笔机', 'code': '2945', 'Q': 16.70, 'point': 56, 'pointPrice': 11.10},
    {'seq': '26', 'kw': '糖果猫咪削笔机', 'code': '2944', 'Q': 17.90, 'point': 60, 'pointPrice': 11.90},
    {'seq': '27', 'kw': '小酷龙可调节', 'code': '2943', 'Q': 26.90, 'point': 90, 'pointPrice': 17.90},
]


def detail(gid):
    p = subprocess.run(['woscli', 'goods', 'shop-goods-get', '--goods-id', str(gid),
                        '--include-sku', 'true', '--output-format', 'json'],
                       capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=120)
    if p.returncode != 0:
        raise RuntimeError(p.stderr[:200])
    return json.loads(p.stdout)['data']


def is_exchange(g):
    return any('兑换' in (c.get('name') or '') for c in (g.get('classifyList') or []))


plan = []
for t in TARGETS:
    cands = [g for g in G if t['kw'] in (g.get('title') or '') and str(g.get('outerGoodsCode')) == t['code']]
    orig = [g for g in cands if not is_exchange(g)]
    exch = [g for g in cands if is_exchange(g)]
    if len(orig) != 1 or len(exch) != 1:
        print(f"seq{t['seq']} 候选异常: 原版{len(orig)} 兑换{len(exch)} —— 跳过")
        continue
    entry = {'seq': t['seq'], 'kw': t['kw'], 'code': t['code'],
             'origGoodsId': orig[0]['goodsId'], 'exchGoodsId': exch[0]['goodsId'],
             'priceWrites': [], 'pointWrites': []}
    for side, g in [('orig', orig[0]), ('exch', exch[0])]:
        d = detail(g['goodsId'])
        if len(d['skuList']) != 1:
            print(f"seq{t['seq']} {side} SKU数={len(d['skuList'])} 非单SKU —— 跳过该侧")
            continue
        sku = d['skuList'][0]
        entry['priceWrites'].append({
            'side': side, 'goodsId': g['goodsId'], 'skuId': sku['skuId'],
            'cur': float(sku['salePrice']), 'target': t['Q']})
    # 积分：兑换版在积分商城
    p = pdet.get(exch[0]['goodsId'])
    if p and p['skuList']:
        ps = p['skuList'][0]
        entry['pointWrites'].append({
            'goodsId': exch[0]['goodsId'], 'skuId': ps['skuId'],
            'cur': [ps.get('point'), ps.get('pointPrice')],
            'target': [t['point'], t['pointPrice']],
            'guardBase': {k: p.get(k) for k in ('classifyId', 'pointClassifyInfo', 'priceType',
                                                 'goodsLimitNum', 'sort', 'exchangeTimeType',
                                                 'visibleInNonExchangeTime')},
            'editChangeNum': ps.get('editChangeNum'), 'isPoint': ps.get('isPoint')})
    plan.append(entry)

out = {'generatedAt': datetime.datetime.now().isoformat(), 'plan': plan,
       'note': '表格「1个」规格价权威；整盒规格微盟无SKU跳过'}
p = os.path.join(BK, f'161-sharpener-plan_{ts}.json')
json.dump(out, open(p, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(f'计划: {len(plan)} 商品, 售价写 {sum(len(e["priceWrites"]) for e in plan)}, '
      f'积分写 {sum(len(e["pointWrites"]) for e in plan)}')
for e in plan:
    print(f"  seq{e['seq']} {e['kw']}: " +
          ' '.join(f"{w['side']}售价{w['cur']}→{w['target']}" for w in e['priceWrites']) +
          (' 积分' + str(e['pointWrites'][0]['cur']) + '→' + str(e['pointWrites'][0]['target']) if e['pointWrites'] else ''))
print('落盘:', p)
