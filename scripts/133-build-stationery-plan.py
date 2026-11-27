#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""133-build-stationery-plan.py —— 学习文具同步微盟 干跑计划（只读，零线上写）

匹配链：表 C 名称归一化 → WOS goodsId（原版/兑换版）→ SKU 对齐（outerSkuCode / 规格值 / 单SKU）
       → 兑换版 goodsId → 积分商城详情（point/pointPrice）
目标口径（用户 2026-11-27 确认）：
  - 售价 Q → WOS SKU salePrice（孪生体两侧都列为候选，最终范围待用户拍板）
  - R 纯豆 → point=int(R), pointPrice=0；S 组合价 + T 组合豆 → pointPrice=S, point=T
  - 待优化 8 行：确保上架（实测已全部上架 → 动作 0）
  - 下架 1 行：确保下架（实测已全部下架 → 动作 0）
产出 backup/133-plan_<ts>.json + .scan/stationery-plan.txt（人读干跑表）
"""
import json, glob, os, re, datetime
from collections import defaultdict, Counter

REPO = r'D:\workbuddy\weimob-auto-tips'
BACKUP = os.path.join(REPO, 'backup')
D = json.load(open(os.path.join(REPO, '.scan', 'stationery_probe.json'), encoding='utf-8'))
ROWS = [x[1:] for x in D['data']]
WOS = json.load(open(sorted(glob.glob(os.path.join(BACKUP, '130-wos-goods-all_*.json')))[-1], encoding='utf-8'))['list']
DET = {x['goodsId']: x for x in json.load(open(sorted(glob.glob(os.path.join(BACKUP, '132-wos-sku-details_*.json')))[-1], encoding='utf-8'))['list']}
PLIST = json.load(open(sorted(glob.glob(os.path.join(BACKUP, '131-points-list_*.json')))[-1], encoding='utf-8'))['list']
PDET = {x['goodsId']: x for x in json.load(open(sorted(glob.glob(os.path.join(BACKUP, '131-points-detail_*.json')))[-1], encoding='utf-8'))['list']}
PGIDS = set(x['goodsId'] for x in PLIST)
ts = datetime.datetime.now().strftime('%Y%m%d-%H%M%S')


def norm(s):
    return re.sub(r'[\s\u3000]', '', re.sub(r'【兑换】', '', str(s or '').strip())).lower()


def fnum(s):
    try:
        return float(str(s).strip())
    except (TypeError, ValueError):
        return None


def sku_key(s):
    return (str(s.get('outerSkuCode') or ''), tuple(s.get('specs') or []))


def main():
    titles = defaultdict(list)
    for g in WOS:
        titles[norm(g['title'])].append(g['goodsId'])
    byseq = defaultdict(list)
    for idx, r in enumerate(ROWS):
        if r[1].strip():
            byseq[r[1].strip()].append((idx, r))   # 必须带全局 0 基行号

    plan, skipped = [], []
    for seq, items in sorted(byseq.items(), key=lambda kv: int(kv[0]) if kv[0].isdigit() else 9999):
        row_indices = [i for i, _ in items]
        rs = [r for _, r in items]
        st = sorted(set(r[3].strip() for r in rs))
        title = rs[0][2].strip()
        gids = titles.get(norm(title), [])
        if not gids:
            skipped.append({'seq': seq, 'title': title, 'status': st, 'why': '微盟零命中（名称+编码）'})
            continue
        if '未录入微盟' in st:
            skipped.append({'seq': seq, 'title': title, 'status': st, 'why': '表标未录入微盟，按用户口径不动'})
            continue
        orig = [g for g in gids if not any('兑换' in x for x in DET[g]['groups'])]
        exch = [g for g in gids if any('兑换' in x for x in DET[g]['groups'])]
        if not orig or not exch:
            skipped.append({'seq': seq, 'title': title, 'status': st, 'why': f'孪生不全 orig={len(orig)} exch={len(exch)}'})
            continue
        og, eg = orig[0], exch[0]
        oskus = DET[og]['skuList']
        eskus = DET[eg]['skuList']
        e_by_key = defaultdict(list)
        for s in eskus:
            e_by_key[sku_key(s)].append(s)

        # 表内价格是否统一（用于兜底整商品同价）
        uniq = {k: sorted(set(r[k].strip() for r in rs if len(r) > k and r[k].strip()))
                for k in (16, 17, 18, 19)}
        uniform = all(len(v) <= 1 for v in uniq.values())

        aligned = []
        for ri, r in enumerate(rs):
            code, specv = (r[4].strip() if len(r) > 4 else ''), (r[6].strip() if len(r) > 6 else '')
            hit, how = None, ''
            if code:
                m = [s for s in oskus if s['outerSkuCode'] == code]
                if len(m) == 1:
                    hit, how = m[0], 'code'
            if not hit and specv:
                # 先精确相等，再一次对多才用子串（一对多不唯一 → 留待确认）
                m = [s for s in oskus if any(v == specv for v in (s['specs'] or []))]
                if len(m) == 1:
                    hit, how = m[0], 'spec-exact'
                else:
                    m2 = [s for s in oskus if any(v and (v in specv or specv in v) for v in (s['specs'] or []))]
                    if len(m2) == 1:
                        hit, how = m2[0], 'spec-sub'
            if not hit and len(oskus) == 1:
                hit, how = oskus[0], 'single-sku'
            if not hit and uniform and len(oskus) > 0:
                hit, how = None, 'uniform'      # 整商品同价，稍后展开到全部 SKU
            aligned.append({'row_excel': row_indices[ri] + 1, 'code': code, 'spec': specv,
                            'sku_key': sku_key(hit) if hit else None, 'how': how,
                            'Q': r[16].strip() if len(r) > 16 else '',
                            'R': r[17].strip() if len(r) > 17 else '',
                            'S': r[18].strip() if len(r) > 18 else '',
                            'T': r[19].strip() if len(r) > 19 else ''})

        # 汇总每个 SKU 的目标售价（冲突则标待确认）
        t_price = defaultdict(set)
        t_point = defaultdict(set)
        unmapped_rows = []
        for a in aligned:
            vals = []
            if a['how'] == 'uniform':
                vals = [s for s in oskus]
            elif a['sku_key']:
                vals = [s for s in oskus if sku_key(s) == a['sku_key']]
            q = fnum(a['Q'])
            for s in vals:
                k = sku_key(s)
                if q is not None:
                    t_price[k].add(q)
                # 积分目标
                rv, sv, tv = fnum(a['R']), fnum(a['S']), fnum(a['T'])
                if rv is not None and sv is None:
                    t_point[k].add((int(rv), 0.0))
                elif sv is not None and tv is not None:
                    t_point[k].add((int(tv), sv))
            if not vals:
                unmapped_rows.append(a)

        price_writes, point_writes, conflicts = [], [], []
        for k, qs in t_price.items():
            if len(qs) != 1:
                conflicts.append({'seq': seq, 'key': k, 'kind': 'price', 'vals': sorted(qs)})
                continue
            target = next(iter(qs))
            for side, gid, skus in (('orig', og, oskus), ('exch', eg, eskus)):
                for s in skus:
                    if sku_key(s) != k:
                        continue
                    cur = fnum(s['salePrice'])
                    if cur is None or abs(cur - target) > 0.001:
                        price_writes.append({'side': side, 'goodsId': gid, 'skuId': s['skuId'],
                                             'skuKey': list(k), 'cur': cur, 'target': target})
        in_points = eg in PGIDS
        if in_points and eg in PDET:
            for k, pts in t_point.items():
                if len(pts) != 1:
                    conflicts.append({'seq': seq, 'key': k, 'kind': 'point', 'vals': sorted(pts)})
                    continue
                target = next(iter(pts))
                for s in PDET[eg]['skuList']:
                    # 积分详情 skuId 属兑换版，按规格序列对齐原版 sku_key
                    idx = [i for i, x in enumerate(eskus) if sku_key(x) == k]
                    if not idx or s['skuId'] != eskus[idx[0]]['skuId']:
                        continue
                    cur = (s['point'], s['pointPrice'])
                    if cur != target:
                        point_writes.append({'goodsId': eg, 'skuId': s['skuId'], 'skuKey': list(k),
                                             'cur': cur, 'target': target})

        online_need = []
        for gid in (og, eg):
            if '待优化' in st and DET[gid]['isOnline'] is not True:
                online_need.append({'goodsId': gid, 'action': 'online', 'cur': DET[gid]['isOnline']})
            if '下架' in st and DET[gid]['isOnline'] is not False:
                online_need.append({'goodsId': gid, 'action': 'offline', 'cur': DET[gid]['isOnline']})

        plan.append({'seq': seq, 'title': title, 'status': st,
                     'origGoodsId': og, 'exchGoodsId': eg, 'inPoints': in_points,
                     'sheetRows': len(rs), 'aligned': aligned,
                     'unmappedRows': unmapped_rows, 'conflicts': conflicts,
                     'priceWrites': price_writes, 'pointWrites': point_writes,
                     'onlineActions': online_need,
                     'note': '正常售卖但微盟两版均下架' if (st == ['正常售卖'] and all(DET[g]['isOnline'] is False for g in (og, eg))) else ''})

    out = {'generatedAt': datetime.datetime.now().isoformat(), 'planCount': len(plan),
           'skipped': skipped, 'plan': plan}
    p = os.path.join(BACKUP, f'133-plan_{ts}.json')
    json.dump(out, open(p, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)

    # 人读干跑表
    with open(os.path.join(REPO, '.scan', 'stationery-plan.txt'), 'w', encoding='utf-8') as f:
        f.write(f'学习文具 → 微盟 同步干跑表（零线上写） {out["generatedAt"]}\n')
        f.write(f'匹配序号 {len(plan)} / 84；跳过 {len(skipped)}\n')
        f.write('=' * 110 + '\n')
        for x in plan:
            f.write(f"seq{x['seq']:>3} [{('/'.join(x['status']))}] {x['title'][:42]}\n")
            f.write(f"      orig={x['origGoodsId']} exch={x['exchGoodsId']} 积分商城={x['inPoints']} 行={x['sheetRows']}"
                    f" 售价写={len(x['priceWrites'])} 积分写={len(x['pointWrites'])}"
                    f" 未对齐行={len(x['unmappedRows'])} 冲突={len(x['conflicts'])} 上下架={len(x['onlineActions'])}\n")
            if x['note']:
                f.write(f"      ⚠ {x['note']}\n")
            for c in x['conflicts'][:2]:
                f.write(f"      CONFLICT {c}\n")
        f.write('\n=== 跳过（不动）===\n')
        for s in skipped:
            f.write(f"  seq{s['seq']}: {s['why']} | {s['title'][:44]}\n")
        f.write('\n=== 汇总 ===\n')
        f.write(f"售价写入 {sum(len(x['priceWrites']) for x in plan)} 处；积分写入 {sum(len(x['pointWrites']) for x in plan)} 处；"
                f"上下架动作 {sum(len(x['onlineActions']) for x in plan)} 处；"
                f"未对齐行 {sum(len(x['unmappedRows']) for x in plan)}；冲突 {sum(len(x['conflicts']) for x in plan)}\n")
    print('落盘:', p)
    print('售价写', sum(len(x['priceWrites']) for x in plan), '处；积分写', sum(len(x['pointWrites']) for x in plan),
          '处；上下架', sum(len(x['onlineActions']) for x in plan), '处；未对齐行',
          sum(len(x['unmappedRows']) for x in plan), '；冲突', sum(len(x['conflicts']) for x in plan))
    print('跳过:', len(skipped), Counter(s['why'] for s in skipped))
    print('人读表: .scan/stationery-plan.txt')


if __name__ == '__main__':
    main()
