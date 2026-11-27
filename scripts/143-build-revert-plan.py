#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""143-build-revert-plan.py —— 49行价格回写计划（表格现网价为权威）

用户反馈「表格出了问题已修改，49行非晨光联盟商品价格变回原来的样子，微盟也弄回去」。
上一轮 138 把表格基线价（错误低价）同步到了微盟；现在表格已改回正确价，微盟要跟回去。

- 目标价 = 现网表格 Q（stationery_now.json）
- 写前备份 = 微盟当前 salePrice（shop-goods-get 只读）
- 映射沿用 133 plan 的 aligned[(seq,spec)] -> sku_key，避免行号 off-by-one
- seq21/28 微盟零命中跳过；seq31 三行未对齐跳过
- 输出 backup/143-revert-plan_*.json
"""
import json, glob, os, subprocess, datetime
from collections import defaultdict

REPO = r'D:\workbuddy\weimob-auto-tips'
BK = os.path.join(REPO, 'backup')
PLAN = json.load(open(sorted(glob.glob(os.path.join(BK, '133-plan_*.json')))[-1], encoding='utf-8'))
NOW = json.load(open(os.path.join(REPO, '.scan/stationery_now.json'), encoding='utf-8'))
ts = datetime.datetime.now().strftime('%Y%m%d-%H%M%S')


def wos(args, timeout=120):
    p = subprocess.run(['woscli'] + args, capture_output=True, text=True,
                       encoding='utf-8', errors='replace', timeout=timeout)
    if p.returncode != 0:
        raise RuntimeError(p.stderr[:200] or p.stdout[:200])
    return json.loads(p.stdout)


# 现网表格 (seq, spec) -> Q（取第一条；同规格多行价格一致已验证）
qmap = defaultdict(set)
for x in NOW['data'][1:]:
    r = x[1:]
    if r[1].strip() and r[16].strip():
        qmap[(r[1].strip(), r[6].strip())].add(r[16].strip())

# 49 行涉及序号
chg = [c for c in NOW['changed'] if any(d['col'] in (16, 17, 18, 19) for d in c['diff'])]
seqs = sorted({c['row'][1] for c in chg}, key=lambda z: int(z))

plan, skipped = [], []
for x in PLAN['plan']:
    if x['seq'] not in seqs:
        continue
    # 每个 aligned 行 -> (sku_key, 目标Q)
    target_by_key = {}
    for a in x['aligned']:
        qs = qmap.get((x['seq'], a['spec']), set())
        if not qs:
            skipped.append({'seq': x['seq'], 'spec': a['spec'], 'why': '现网表格无价'})
            continue
        if len(qs) > 1:
            skipped.append({'seq': x['seq'], 'spec': a['spec'], 'why': '同规格多价:' + str(sorted(qs))})
            continue
        target_by_key[str(a['sku_key'])] = float(next(iter(qs)))
    writes = []
    for w in x['priceWrites']:
        key = str(w['skuKey'])
        if key not in target_by_key:
            skipped.append({'seq': x['seq'], 'skuKey': w['skuKey'], 'why': '无对齐规格'})
            continue
        writes.append({'side': w['side'], 'goodsId': w['goodsId'], 'skuId': w['skuId'],
                       'skuKey': w['skuKey'], 'cur_written': w['target'],
                       'target': target_by_key[key]})
    if writes:
        plan.append({'seq': x['seq'], 'title': x['title'], 'origGoodsId': x['origGoodsId'],
                     'exchGoodsId': x['exchGoodsId'], 'inPoints': x['inPoints'],
                     'writes': writes})

# seq21/28 微盟零命中
for seq in seqs:
    if not any(p['seq'] == seq for p in plan):
        skipped.append({'seq': seq, 'why': '微盟零命中(上一轮SKIP)'})

# 写前备份：微盟当前 salePrice
by_gid = defaultdict(list)
for p in plan:
    for w in p['writes']:
        by_gid[w['goodsId']].append(w)
for gid, ws in by_gid.items():
    d = wos(['goods', 'shop-goods-get', '--goods-id', str(gid),
             '--include-sku', 'true', '--output-format', 'json'])['data']
    m = {s['skuId']: s for s in d['skuList']}
    for w in ws:
        s = m.get(w['skuId'])
        if not s:
            raise RuntimeError(f'{gid}/{w["skuId"]} 不在详情中')
        w['cur_actual'] = float(s['salePrice'])
        w['rollback'] = float(s['salePrice'])   # 小样/异常回滚用：回到写前状态
        w['costPrice'] = s.get('costPrice')

outf = os.path.join(BK, f'143-revert-plan_{ts}.json')
json.dump({'at': datetime.datetime.now().isoformat(), 'seqs': seqs,
           'plan': plan, 'skipped': skipped,
           'summary': {'seqs': len(plan), 'goods': len(by_gid),
                       'sku_writes': sum(len(p['writes']) for p in plan),
                       'skipped': len(skipped)}},
          open(outf, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)

print('=== 49行回写计划 ===')
print('涉及序号:', seqs)
for p in plan:
    vals = sorted({w['target'] for w in p['writes']})
    curs = sorted({w['cur_actual'] for w in p['writes']})
    print(f"  seq{p['seq']:>3} {p['title'][:26]:26s} SKU写{len(p['writes']):2d} 微盟现价{curs} -> 表格价{vals}")
print('跳过:', len(skipped))
for s in skipped[:12]:
    print('  ', s)
print('合计: 商品', len(by_gid), 'SKU写', sum(len(p['writes']) for p in plan))
print('落盘:', outf)
