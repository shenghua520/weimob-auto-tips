#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""130-snapshot-stationery-wos.py —— 写前只读快照：微盟商品全量（WOS admin-api）

坑（docs/15）：--pageNum/--pageSize 必须 camelCase，kebab-case 被静默忽略；
快照脚本必须校验「第 1 页与第 2 页首 ID 不同」，否则中止，避免假快照。
产出 backup/130-wos-goods-all_<ts>.json + 130-wos-summary_<ts>.json
"""
import subprocess, json, os, datetime, collections

REPO = r'D:\workbuddy\weimob-auto-tips'
OUT = os.path.join(REPO, 'backup')
os.makedirs(OUT, exist_ok=True)
ts = datetime.datetime.now().strftime('%Y%m%d-%H%M%S')


def wos(args, timeout=180):
    p = subprocess.run(['woscli'] + args, capture_output=True, text=True,
                       encoding='utf-8', errors='replace', timeout=timeout, shell=False)
    if p.returncode != 0:
        raise RuntimeError(f'woscli failed: {p.stderr[:300]}')
    return json.loads(p.stdout)


def main():
    print('=== WOS 商品全量只读快照 ===')
    all_goods = []
    total = None
    page_size = 100
    first_page = None
    for p in range(1, 40):
        j = wos(['admin-api', 'query-goods-list', '--pageNum', str(p),
                 '--pageSize', str(page_size), '--output-format', 'json'])
        pl = j.get('pageList') or []
        total = j.get('totalCount') or 0
        if p == 1:
            first_page = pl[0]['goodsId'] if pl else None
        if p == 2 and pl and pl[0]['goodsId'] == first_page:
            raise RuntimeError('第1页与第2页首ID相同 → pageSize 未生效，中止（禁止产出假快照）')
        all_goods.extend(pl)
        print(f'  p{p}: +{len(pl)}  累计 {len(all_goods)}/{total}')
        if not pl or len(all_goods) >= total:
            break
    ids = [g['goodsId'] for g in all_goods]
    if len(set(ids)) != len(ids):
        raise RuntimeError('goodsId 重复，快照不可信')

    summary = {
        'generatedAt': datetime.datetime.now().isoformat(),
        'totalCount_api': total, 'totalCount_snapshot': len(all_goods),
        'uniqueGoodsId': len(set(ids)),
        'idMin': min(ids), 'idMax': max(ids),
        'isOnline': dict(collections.Counter(bool(g.get('isOnline')) for g in all_goods)),
        'isCanSell': dict(collections.Counter(bool(g.get('isCanSell')) for g in all_goods)),
        'outerCodeNonempty': sum(1 for g in all_goods if str(g.get('outerGoodsCode') or '').strip()),
        'lvl2Groups': dict(collections.Counter(
            c['name'] for g in all_goods for c in (g.get('classifyList') or [])
            if c.get('classifyLevel') == 2)),
    }
    p1 = os.path.join(OUT, f'130-wos-goods-all_{ts}.json')
    p2 = os.path.join(OUT, f'130-wos-summary_{ts}.json')
    json.dump({'generatedAt': summary['generatedAt'], 'list': all_goods},
              open(p1, 'w', encoding='utf-8'), ensure_ascii=False)
    json.dump(summary, open(p2, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('\n基线:', json.dumps({k: v for k, v in summary.items()
                                if k not in ('lvl2Groups',)}, ensure_ascii=False))
    print('二级分组 TOP:', collections.Counter(summary['lvl2Groups']).most_common(12))
    print('落盘:', p1, '\n     ', p2)


if __name__ == '__main__':
    main()
