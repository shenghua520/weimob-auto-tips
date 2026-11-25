# -*- coding: utf-8 -*-
"""解析导出 xlsx 的全部数据验证规则 + 字段说明清单 + 引用式使用说明，交叉核对每张分表 K 列引用"""
import zipfile, re, json, csv, io, sys

REPO = 'D:/workbuddy/weimob-auto-tips'
z = zipfile.ZipFile(f'{REPO}/.scan/nine_groups.xlsx')
sm = json.load(open(f'{REPO}/.scan/xlsx_sheetmap.json', encoding='utf-8'))

SHEETS = [('学习文具', '000001'), ('体育用品', '000002'), ('少儿护理', '000003'), ('少儿穿戴', '000004'),
          ('少儿食品', '000005'), ('家庭日用', '000006'), ('读物潮玩', '000007'), ('米面油品', '000008'),
          ('家用电器', '000009')]

# ---------- 1. 解析 dataValidation ----------
DV = {}
for nm, _ in SHEETS:
    xml = z.read(sm[nm]).decode('utf-8')
    items = []
    for raw in re.findall(r'<dataValidation\b.*?(?:/>|</dataValidation>)', xml, re.S):
        d = {'type': None, 'sqref': None, 'formula1': None, 'formula2': None,
             'errorTitle': None, 'error': None, 'prompt': None}
        for k in ('type', 'sqref', 'errorTitle', 'error', 'prompt'):
            m = re.search(rf'\b{k}="([^"]*)"', raw)
            if m: d[k] = m.group(1)
        for k in ('formula1', 'formula2'):
            m = re.search(rf'<{k}>(.*?)</{k}>', raw, re.S)
            if m: d[k] = m.group(1)
        items.append(d)
    DV[nm] = items

def col_of_ref(f):
    """从 OFFSET(字段说明!$X$43,...) 里取出列字母与起始行"""
    if not f: return None
    m = re.search(r'字段说明!\$([A-Z]+)\$(\d+)', f)
    if not m: return None
    return {'col': m.group(1), 'row': int(m.group(2)),
            'count_range': (re.search(r'COUNTA\(字段说明!\$([A-Z]+)\$(\d+):\$([A-Z]+)\$(\d+)\)', f) or [None]*5)}

print('=' * 100)
print('各分表 K 列（二级分组）下拉规则核对')
print('=' * 100)
DESC_COLS = {}  # 列字母 → 清单标题
for nm, sid in SHEETS:
    for d in DV[nm]:
        if d['sqref'] and d['sqref'].startswith('K') and d['type'] == 'list':
            f = d['formula1'] or ''
            if 'OFFSET' in f:
                c = col_of_ref(f)
                m2 = re.search(r'COUNTA\(字段说明!\$([A-Z]+)\$(\d+):\$([A-Z]+)\$(\d+)\)', f)
                cr = (m2.group(1), int(m2.group(2)), m2.group(3), int(m2.group(4))) if m2 else None
                print(f'  {nm:8s} sqref={d["sqref"]:20s} → 列={c["col"]} 起始行={c["row"]:4d}  COUNTA范围={cr}')
            else:
                print(f'  {nm:8s} sqref={d["sqref"]:20s} → 静态: {f[:120]}')
            print(f'           错误提示: errorTitle={d["errorTitle"]!r} error={d["error"]!r}')
print()

# ---------- 2. 字段说明清单表头 ----------
xml = z.read(sm['字段说明']).decode('utf-8')
sst = []
sxml = z.read('xl/sharedStrings.xml').decode('utf-8')
for si in re.findall(r'<si>(.*?)</si>', sxml, re.S):
    txt = ''.join(re.findall(r'<t[^>]*>(.*?)</t>', si, re.S))
    sst.append(txt)

def cells_of(sheetname):
    xml = z.read(sm[sheetname]).decode('utf-8')
    out = {}
    for c in re.finditer(r'<c r="([A-Z]+)(\d+)"([^>]*)>(.*?)</c>', xml, re.S):
        col, row, attrs, body = c.group(1), int(c.group(2)), c.group(3), c.group(4)
        t = re.search(r't="([^"]*)"', attrs)
        v = re.search(r'<v>(.*?)</v>', body, re.S)
        if not v: continue
        val = v.group(1)
        if t and t.group(1) == 's':
            try: val = sst[int(val)]
            except Exception: pass
        out[(col, row)] = val
    return out

desc = cells_of('字段说明')
print('=' * 100)
print('字段说明 sheet 第 40-45 行（清单表头区）')
print('=' * 100)
for r in range(40, 46):
    row = [(c, desc.get((c, r), '')) for c in 'ABCDEFGHIJKL' if desc.get((c, r))]
    print(f'  行{r}: ' + ' | '.join(f'{c}={v[:34]}' for c, v in row))
print()

# 找清单表头行
hdr_row = None
for r in range(38, 48):
    if desc.get(('A', r)) == '商品来源':
        hdr_row = r; break
print('清单表头行 =', hdr_row)
for c in 'ABCDEFGHIJKLMN':
    v = desc.get((c, hdr_row))
    if v: DESC_COLS[c] = v
print('列 → 清单标题:', json.dumps(DESC_COLS, ensure_ascii=False))
print()

# 每列实际选项（表头下一行起连续）
print('=' * 100)
print('各清单列实际选项（从表头下一行起连续填）')
print('=' * 100)
COL_OPTS = {}
for c, title in DESC_COLS.items():
    opts = []
    r = hdr_row + 1
    while True:
        v = desc.get((c, r))
        if not v: break
        opts.append(v); r += 1
    COL_OPTS[c] = {'title': title, 'opts': opts}
    print(f'  {c} ({title}): {len(opts)} 项 {opts}')
print()

# ---------- 3. 家用电器 / 引用式使用说明 ----------
print('=' * 100)
print('家用电器 sheet 全部 dataValidation')
print('=' * 100)
for d in DV['家用电器']:
    print(f"  type={d['type']} sqref={d['sqref']}")
    print(f"     f1={d['formula1']}")
    if d['formula2']: print(f"     f2={d['formula2']}")
    if d['errorTitle']: print(f"     errTitle={d['errorTitle']} err={d['error']}")
print()

print('=' * 100)
print('引用式使用说明 sheet 内容')
print('=' * 100)
ref = cells_of('引用式使用说明')
rows = {}
for (c, r), v in ref.items():
    rows.setdefault(r, {})[c] = v
for r in sorted(rows):
    line = ' | '.join(f'{c}={rows[r][c][:150]}' for c in sorted(rows[r]))
    if line.strip(): print(f'  行{r}: {line}')

json.dump({'dv': DV, 'desc_cols': DESC_COLS, 'col_opts': COL_OPTS, 'hdr_row': hdr_row},
          open(f'{REPO}/.scan/xlsx_dv_analysis.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('\n落盘: .scan/xlsx_dv_analysis.json')
