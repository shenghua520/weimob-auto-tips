#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""160-reconcile-table-vs-wos.py —— 以表格现价为权威，逐 SKU 核对微盟现网售价。

与 150 的区别：150 的目标价取自 133 plan（表格基线），发现不了「表格后来改了、
微盟没跟」的差异。本脚本目标价一律取 .scan/stationery_now.json 的表格现价 Q 列，
覆盖 133 plan 的全部 priceWrites 以及 151 seq56 补充计划。只读取证，不写线上。
"""
import json, glob, os, subprocess
from collections import defaultdict, Counter

REPO = r'D:\workbuddy\weimob-auto-tips'
BK = os.path.join(REPO, 'backup')
latest = lambda p: sorted(glob.glob(os.path.join(BK, p)))[-1]
PLAN = json.load(open(latest('133-plan_*.json'), encoding='utf-8'))
SEQ56 = json.load(open(latest('151-seq56-plan_*.json'), encoding='utf-8'))
NOW = json.load(open(os.path.join(REPO, '.scan/stationery_now.json'), encoding='utf-8'))

# 表格现网: (seq, code, spec) -> (Q, S, T, 来源)
tbl = {}
for x in NOW['data'][1:]:
    if len(x) < 21 or not x[2].strip():
        continue
    seq, code, spec = x[2].strip(), x[5].strip(), x[7].strip()
    tbl[(seq, code, spec)] = (x[17].strip(), x[19].strip(), x[20].strip(), x[9].strip())


def wos(gid):
    p = subprocess.run(['woscli', 'goods', 'shop-goods-get', '--goods-id', str(gid),
                        '--include-sku', 'true', '--output-format', 'json'],
                       capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=120)
    if p.returncode != 0:
        raise RuntimeError(p.stderr[:200])
    return json.loads(p.stdout)['data']


# 收集待核对写入: (seq, sku_key) -> [(gid, sid, side), ...]
targets = defaultdict(list)
for x in PLAN['plan']:
    seq = x['seq']
    key_by_sku = {str(a['sku_key']): a for a in x['aligned']}
    for w in x['priceWrites']:
        a = key_by_sku.get(str(w['skuKey']))
        if not a:
            continue
        targets[(seq, a['code'], a['spec'])].append((w['goodsId'], w['skuId'], w['side']))
# seq56 补充（151 计划的 priceWrites 直接带表格现价目标）
for w in SEQ56.get('priceWrites', []):
    targets[('56', w.get('code', ''), w.get('spec', ''))].append(
        (w['goodsId'], w['skuId'], w.get('side', '')))

bad, ok, checked, missing = [], 0, 0, []
by_src = Counter()
for (seq, code, spec), writes in sorted(targets.items(), key=lambda kv: int(kv[0][0]) if kv[0][0].isdigit() else 9999):
    if (seq, code, spec) not in tbl:
        missing.append((seq, code, spec))
        continue
    Q, S, T, src = tbl[(seq, code, spec)]
    if not Q:
        continue
    try:
        q = float(Q)
    except ValueError:
        continue
    for gid, sid, side in writes:
        checked += 1
        d = wos(gid)
        sku = next((s for s in d['skuList'] if s['skuId'] == sid), None)
        cur = float(sku['salePrice']) if sku and sku.get('salePrice') is not None else None
        if cur is None or abs(cur - q) >= 0.06:
            bad.append({'seq': seq, 'code': code, 'spec': spec, 'src': src,
                        'side': side, 'gid': gid, 'sid': sid, 'cur': cur, 'want': q})
            by_src[src] += 1
        else:
            ok += 1

print(f'售价对账(表格现价为权威): 核对 {checked}  SKU一致 {ok}  差异 {len(bad)}')
print('差异来源分布:', dict(by_src))
for b in bad[:40]:
    print(f"  seq{b['seq']:>3} {b['src']:<6} {b['side']:<4} {b['code']:12s} {b['spec'][:18]:18s} 微盟={b['cur']} 表格={b['want']} gid={b['gid']}")
if missing:
    print('表格现网未找到的行:', missing[:10], f'共{len(missing)}')

out = {'checked': checked, 'ok': ok, 'diff': bad, 'missing': missing,
       'bySrc': dict(by_src), 'pass': not bad}
json.dump(out, open(os.path.join(BK, '160-reconcile-table-vs-wos.json'), 'w', encoding='utf-8'),
          ensure_ascii=False, indent=1)
print('PASS' if not bad else f'FAIL ({len(bad)}处差异)')
