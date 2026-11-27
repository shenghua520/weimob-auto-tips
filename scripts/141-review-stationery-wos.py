#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""141-review-stationery-wos.py —— 独立复核 WOS 侧（另起脚本 + 重新登录/授权 + 全量重拉）

三轮：
  R1 样本级：抽 5 个商品逐 SKU 核对目标价
  R2 全量级：写前快照 vs 写后重拉，STATIC 字段（成本/条码/库存/分组/上下架）零变化；
             非目标 SKU 售价零变化；目标 SKU 售价全部等于计划目标
  R3 归因级：写后全量商品 ID 集合 vs 写前基线（ID 存在性），新增/缺失 0；
             并用写入台账的具体 ID 交叉验证
"""
import subprocess, json, glob, os, datetime
from collections import defaultdict

REPO = r'D:\workbuddy\weimob-auto-tips'
BACKUP = os.path.join(REPO, 'backup')
latest = lambda p: sorted(glob.glob(os.path.join(BACKUP, p)))[-1]
BASE = json.load(open(latest('130-wos-goods-all_*.json'), encoding='utf-8'))['list']
DET0 = {x['goodsId']: x for x in json.load(open(latest('132-wos-sku-details_*.json'), encoding='utf-8'))['list']}
PLAN = json.load(open(latest('133-plan_*.json'), encoding='utf-8'))
LEDGER = json.load(open(latest('138-price-ledger_*.json'), encoding='utf-8'))


def wos(args, timeout=120):
    p = subprocess.run(['woscli'] + args, capture_output=True, text=True,
                       encoding='utf-8', errors='replace', timeout=timeout)
    if p.returncode != 0:
        raise RuntimeError(p.stderr[:250])
    return json.loads(p.stdout)


def detail(gid):
    d = wos(['goods', 'shop-goods-get', '--goods-id', str(gid),
             '--include-sku', 'true', '--output-format', 'json'])['data']
    return {'goodsId': gid, 'title': d.get('title'), 'outerGoodsCode': d.get('outerGoodsCode'),
            'isOnline': d.get('isOnline'),
            'groups': [c['name'] for c in (d.get('goodsClassifyList') or [])],
            'skuList': [{'skuId': s['skuId'], 'outerSkuCode': s.get('outerSkuCode'),
                         'skuBarCode': s.get('skuBarCode'), 'salePrice': s.get('salePrice'),
                         'costPrice': s.get('costPrice'), 'skuStockNum': s.get('skuStockNum'),
                         'specs': [v.get('specValueName') for v in (s.get('skuSpecValueList') or [])]}
                        for s in (d.get('skuList') or [])]}


def main():
    R = {}
    target = defaultdict(dict)   # gid -> skuId -> target(最终应然价)
    for x in PLAN['plan']:
        for w in x['priceWrites']:
            target[w['goodsId']][w['skuId']] = w['target']
    # 49 行用户改回原价后已由 145 回写：用 143 计划的表格现价覆盖最终应然价
    REVERT = json.load(open(latest('143-revert-plan_*.json'), encoding='utf-8'))
    for p in REVERT['plan']:
        for w in p['writes']:
            target[w['goodsId']][w['skuId']] = w['target']

    print('=== R3 归因级：全量商品 ID 存在性 ===')
    now_all = []
    for p in range(1, 40):
        j = wos(['admin-api', 'query-goods-list', '--pageNum', str(p),
                 '--pageSize', '100', '--output-format', 'json'])
        pl = j.get('pageList') or []
        now_all.extend(pl)
        if not pl or len(now_all) >= j.get('totalCount', 0):
            break
    b_ids = set(g['goodsId'] for g in BASE)
    n_ids = set(g['goodsId'] for g in now_all)
    added, missing = n_ids - b_ids, b_ids - n_ids
    R['R3_ids'] = {'base': len(b_ids), 'now': len(n_ids), 'added': len(added), 'missing': len(missing),
                   'pass': not added and not missing}
    print(f'  基线 {len(b_ids)} / 现网 {len(n_ids)}；新增 {len(added)} 缺失 {len(missing)} →',
          'PASS' if R['R3_ids']['pass'] else 'FAIL')

    # 非目标商品 STATIC 字段零变化
    bad_out = []
    bmap = {g['goodsId']: g for g in BASE}
    nmap = {g['goodsId']: g for g in now_all}
    fields = ['title', 'isOnline', 'isCanSell', 'outerGoodsCode', 'goodsPrice', 'sort']
    for gid in b_ids & n_ids:
        if gid in target:
            continue                     # 目标商品价格字段预期变化
        for f in fields:
            if bmap[gid].get(f) != nmap[gid].get(f):
                bad_out.append((gid, f, bmap[gid].get(f), nmap[gid].get(f)))
    R['R2_outside'] = {'checked': len(b_ids & n_ids) - len(target), 'diff': len(bad_out),
                       'samples': bad_out[:5], 'pass': not bad_out}
    print(f'  范围外商品 STATIC 核对 {R["R2_outside"]["checked"]} 个，差异 {len(bad_out)} →',
          'PASS' if not bad_out else 'FAIL')

    print('\n=== R2 全量级：目标 SKU 售价 + 连带字段 ===')
    bad_target, bad_linked, bad_nontarget = [], [], []
    detail_now = {}
    for i, gid in enumerate(sorted(DET0), 1):
        now = detail(gid)
        detail_now[gid] = now
        b = DET0[gid]
        tmap = target.get(gid, {})
        bskus = {s['skuId']: s for s in b['skuList']}
        nskus = {s['skuId']: s for s in now['skuList']}
        if set(bskus) != set(nskus):
            bad_linked.append((gid, 'sku集合变化'))
            continue
        for sid, s0 in bskus.items():
            s1 = nskus[sid]
            for f in ('outerSkuCode', 'skuBarCode', 'costPrice', 'skuStockNum', 'specs'):
                if s0.get(f) != s1.get(f):
                    bad_linked.append((gid, sid, f, s0.get(f), s1.get(f)))
            if sid in tmap:
                if abs(float(s1['salePrice']) - tmap[sid]) > 0.001:
                    bad_target.append((gid, sid, s1['salePrice'], tmap[sid]))
            else:
                if s0['salePrice'] != s1['salePrice']:
                    bad_nontarget.append((gid, sid, s0['salePrice'], s1['salePrice']))
        # 商品级 STATIC
        for f in ('title', 'outerGoodsCode', 'isOnline', 'groups'):
            if b.get(f) != now.get(f):
                bad_linked.append((gid, f, b.get(f), now.get(f)))
        if i % 40 == 0:
            print(f'  detail {i}/{len(DET0)}')
    R['R2_detail'] = {'goods': len(DET0), 'targetBad': len(bad_target),
                      'linkedBad': len(bad_linked), 'nonTargetBad': len(bad_nontarget),
                      'samples': bad_target[:5] + bad_linked[:5] + bad_nontarget[:5],
                      'pass': not (bad_target or bad_linked or bad_nontarget)}
    print(f'  目标价不符 {len(bad_target)}；连带字段变化 {len(bad_linked)}；非目标售价变化 {len(bad_nontarget)} →',
          'PASS' if R['R2_detail']['pass'] else 'FAIL')

    print('\n=== R1 样本级：抽 5 个商品 ===')
    ledger_ids = [r['goodsId'] for r in LEDGER['records'] if r['status'] == 'ok']
    sample_ids = [ledger_ids[0], ledger_ids[len(ledger_ids) // 4], ledger_ids[len(ledger_ids) // 2],
                  ledger_ids[3 * len(ledger_ids) // 4], ledger_ids[-1]]
    samples = []
    for gid in sample_ids:
        tmap = target[gid]
        s1 = {s['skuId']: s for s in detail_now[gid]['skuList']}
        vals = [(sid, s1[sid]['salePrice'], t) for sid, t in tmap.items()]
        good = all(abs(float(cur) - t) < 0.001 for _, cur, t in vals)
        samples.append({'goodsId': gid, 'skuCount': len(vals), 'ok': good, 'detail': vals})
        print(f'  gid={gid} {len(vals)} SKU {"OK" if good else "FAIL"}')
    R['R1_sample'] = {'samples': samples, 'pass': all(s['ok'] for s in samples)}

    # 归因级交叉：台账 ID 集合 ⊆ 计划 ID 集合，且每个台账 ID 现网存在
    led_ids = set(r['goodsId'] for r in LEDGER['records'] if r['status'] == 'ok')
    R['R3_ledger'] = {'ledgerOk': len(led_ids), 'inPlan': len(led_ids & set(target)),
                      'existNow': len(led_ids & n_ids),
                      'pass': led_ids <= set(target) and led_ids <= n_ids}
    print(f'  台账成功 ID {len(led_ids)}，均在计划内 {R["R3_ledger"]["inPlan"]}，现网存在 {R["R3_ledger"]["existNow"]} →',
          'PASS' if R['R3_ledger']['pass'] else 'FAIL')

    verdict = 'PASS' if all(v['pass'] for v in R.values()) else 'FAIL'
    R['verdict'] = verdict
    p = os.path.join(BACKUP, '141-review-wos.json')
    json.dump(R, open(p, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('\nVERDICT:', verdict, '报告:', p)


if __name__ == '__main__':
    main()
