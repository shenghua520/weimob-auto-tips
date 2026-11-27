#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""151-build-seq56-plan.py —— seq56 两个商品的同步计划（只读，不写线上）

纠正上一轮 133 计划的匹配 bug：seq56 表格两行是不同商品
  Excel145 APYMU268 / 4K 20页  → 微盟 outerGoodsCode=3057
  Excel146 APYMV268 / 110g 8K  → 微盟 outerGoodsCode=3056
上一轮按首行名称归一化把两行都归到 3057，判成冲突跳过，实际两个商品都在微盟。

目标价来自表格现网 Q（售价）/ T+S（积分 point+pointPrice）；
写前快照微盟现价与积分 guard 字段，供小样/批量回读与回滚。
seq55 上一轮已同步（售价 20.8 / 积分 69·13.9），本脚本只复核不改。
"""
import sys, json, csv, io, subprocess, glob, os, datetime

sys.path.insert(0, r'C:\Users\shenghua\.workbuddy\plugins\cache\workbuddy-builtin\tencent-docs-plugin\5.11.3-wb.43806934.gecace0f7.ha395516167d4\skills\tencent-docs')
import tencentdocs as td

FILE_ID, SHEET = 'DSnVhVGdTR294UE5P', '000001'
BACKUP = r'D:\workbuddy\weimob-auto-tips\backup'

# seq56 表格行 → 微盟商品（按 outerGoodsCode 精确锁定，不再用名称归一化）
MAP = [
    {'excel_row': 145, 'code': 'APYMU268', 'spec': '4K 20页', 'goods_code': '3057',
     'orig': 161456347100397, 'exch': 161785315100397,
     'orig_sku': 328502051100397, 'exch_sku': 330120335100397},
    {'excel_row': 146, 'code': 'APYMV268', 'spec': '110g 8K 20页', 'goods_code': '3056',
     'orig': 161456494100397, 'exch': 161785682100397,
     'orig_sku': 328502047100397, 'exch_sku': 330121237100397},
]


def table_rows(rows_excel):
    d = td.call_tool('sheet-mcp', 'get_cell_data', {
        'file_id': FILE_ID, 'sheet_id': SHEET,
        'start_row': rows_excel[0] - 1, 'end_row': rows_excel[-1],
        'start_col': 0, 'end_col': 20, 'return_csv': True}, timeout=240)[0]
    t = d.get('result', {}).get('content', [{}])[0].get('text', '{}')
    rows = list(csv.reader(io.StringIO(json.loads(t).get('csv_data', ''))))
    out = {}
    for i, r in enumerate(rows):
        er = rows_excel[0] + i
        out[er] = r
    return out


def wos_detail(gid):
    r = subprocess.run(['woscli', 'goods', 'shop-goods-get', '--goods-id', str(gid),
                        '--include-sku', 'true', '--output-format', 'json'],
                       capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=120)
    if r.returncode != 0:
        raise RuntimeError(r.stderr[:200] or r.stdout[:200])
    return json.loads(r.stdout)['data']


def main():
    tr = table_rows([m['excel_row'] for m in MAP])
    pd_path = sorted(glob.glob(os.path.join(BACKUP, '131-points-detail_*.json')))[-1]
    pd = {x['goodsId']: x for x in json.load(open(pd_path, encoding='utf-8'))['list']}

    plan = {'priceWrites': [], 'pointWrites': [], 'snapshot': {}, 'checks': []}
    for m in MAP:
        r = tr[m['excel_row']]
        seq, code, spec = r[1].strip(), r[4].strip(), r[6].strip()
        q, s, t = r[16].strip(), r[18].strip(), r[19].strip()
        assert seq == '56' and code == m['code'], (seq, code, m)
        target_price, target_point, target_pp = float(q), float(t), float(s)
        print(f"Excel{m['excel_row']} {m['spec']}: Q={q} S={s} T={t} → 售价{target_price} 积分({target_point},{target_pp})")

        for side, gid, sku in [('orig', m['orig'], m['orig_sku']), ('exch', m['exch'], m['exch_sku'])]:
            d = wos_detail(gid)
            assert str(d.get('outerGoodsCode')) == m['goods_code'], (gid, d.get('outerGoodsCode'))
            smap = {x['skuId']: x for x in d['skuList']}
            assert sku in smap, (gid, sku, list(smap))
            cur = float(smap[sku]['salePrice'])
            plan['priceWrites'].append({'side': side, 'goodsId': gid, 'skuId': sku,
                                        'cur': cur, 'target': target_price,
                                        'seq': seq, 'spec': m['spec'], 'excel_row': m['excel_row']})
            plan['snapshot'][str(gid)] = {
                'title': d['title'], 'outerGoodsCode': d.get('outerGoodsCode'),
                'isOnline': d.get('isOnline'),
                'skuList': [{'skuId': x['skuId'], 'salePrice': x['salePrice'],
                             'costPrice': x.get('costPrice'), 'skuBarCode': x.get('skuBarCode'),
                             'skuStockNum': x.get('skuStockNum')} for x in d['skuList']]}

        # 积分（只写兑换版，guard 从详情快照取）
        gid, sku = m['exch'], m['exch_sku']
        d = pd.get(gid)
        assert d, f'{gid} 不在积分商城'
        sm = {x['skuId']: x for x in d['skuList']}
        assert sku in sm, (gid, sku, list(sm))
        s0 = sm[sku]
        plan['pointWrites'].append({'goodsId': gid, 'skuId': sku,
                                    'cur': [s0['point'], s0['pointPrice']],
                                    'target': [target_point, target_pp],
                                    'seq': seq, 'spec': m['spec'], 'excel_row': m['excel_row'],
                                    'guardBase': {k: d.get(k) for k in [
                                        'classifyId', 'priceType', 'goodsLimitNum', 'exchangeTimeType',
                                        'exchangeStartTime', 'exchangeEndTime',
                                        'visibleInNonExchangeTime', 'pickupSiteList',
                                        'applicablePeopleInfo', 'sort']},
                                    'editChangeNum': s0.get('availableChangeNum'),
                                    'isPoint': s0.get('isPoint')})
        print(f"  微盟现在: 售价 orig/exch={cur}/{float(plan['priceWrites'][-2]['cur'])}"
              f" 积分=({s0['point']},{s0['pointPrice']})")

    # seq55 复核（只读）
    g55 = [161456353100397, 161785427100397]
    seq55 = []
    for gid in g55:
        d = wos_detail(gid)
        seq55.append({'goodsId': gid, 'title': d['title'],
                      'prices': [{'skuId': x['skuId'], 'salePrice': x['salePrice']} for x in d['skuList']]})
    x55 = pd.get(161785427100397)
    seq55.append({'goodsId': 161785427100397, 'point': [
        {'skuId': x['skuId'], 'point': x['point'], 'pointPrice': x['pointPrice']} for x in x55['skuList']]})
    plan['seq55_check'] = seq55
    plan['at'] = datetime.datetime.now().isoformat()
    plan['result'] = 'PASS'

    ts = datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
    out = os.path.join(BACKUP, f'151-seq56-plan_{ts}.json')
    json.dump(plan, open(out, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(f"\n计划: 售价{len(plan['priceWrites'])}处 / 积分{len(plan['pointWrites'])}处 → {out}")
    print('seq55 复核:', json.dumps(seq55, ensure_ascii=False)[:400])


if __name__ == '__main__':
    main()
