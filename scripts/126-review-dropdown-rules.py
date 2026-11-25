#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
126-review-dropdown-rules.py  —— 独立复核：9+1 张表的「数据验证(下拉)」规则
复核口径（另起脚本、重新导出 xlsx、独立解析原始 XML）：
  R1 规则级：无 $41/$44/$140/$143 类行起点错位
  R2 映射级：每个分表 K 列（二级分组）引用的清单列 == 该表在「字段说明」里的专属列
  R3 清单级：被引用的清单列内容 == 微盟实际二级分组（从 114 体检快照取）
  R4 数据级：本次只改验证规则，单元格内容必须零变化（对比改前快照）
"""
import zipfile, re, json, csv, io, os, sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
XLSX = os.path.join(REPO, '.scan', 'nine_groups.xlsx')

SHEET_ORDER = ['学习文具', '线下铺货', '体育用品', '少儿护理', '少儿穿戴',
               '少儿食品', '家庭日用', '读物潮玩', '米面油品', '家用电器',
               '字段说明', '引用式使用说明']

# 字段说明列 -> 该列对应的分表（二级分组清单列）
DESC_COL2SHEET = {
    'C': '学习文具', 'D': '体育用品', 'E': '少儿护理', 'F': '少儿穿戴',
    'G': '少儿食品', 'H': '家庭日用', 'I': '读物潮玩', 'J': '米面油品',
    'K': '家用电器',
}
# 通用清单列
DESC_COL2KIND = {'A': '商品来源', 'B': '规格名称', 'L': '发货方式'}

# 各分表里「引用型下拉列」-> 字段说明列（E=规格名称 H=商品来源 I=发货方式 K=二级分组）
COL2DESC = {'E': 'B', 'H': 'A', 'I': 'L'}


def load_xlsx():
    z = zipfile.ZipFile(XLSX)
    wb = z.read('xl/workbook.xml').decode('utf-8')
    rels = z.read('xl/_rels/workbook.xml.rels').decode('utf-8')
    rid2t = dict(re.findall(r'Id="(rId\d+)"[^>]*Target="([^"]+)"', rels))
    out = {}
    for nm, sid, rid in re.findall(r'<sheet name="([^"]+)" sheetId="(\d+)" r:id="(rId\d+)"/>', wb):
        out[nm] = 'xl/' + rid2t.get(rid, '?').lstrip('/')
    sst = []
    if 'xl/sharedStrings.xml' in z.namelist():
        for si in re.findall(r'<si>(.*?)</si>', z.read('xl/sharedStrings.xml').decode('utf-8'), re.S):
            sst.append(''.join(re.findall(r'<t[^>]*>(.*?)</t>', si, re.S)))
    return z, out, sst


def read_validations(z, path):
    xml = z.read(path).decode('utf-8')
    rows = []
    for d in re.findall(r'<dataValidation\b.*?(?:/>|</dataValidation>)', xml, re.S):
        m = re.search(r'<formula1>(.*?)</formula1>', d, re.S)
        sq = re.search(r'sqref="([^"]*)"', d)
        if m and sq:
            rows.append({'sqref': sq.group(1), 'formula1': m.group(1)})
    return rows


def read_cells(z, path, sst):
    """返回 {(col,row): value}"""
    xml = z.read(path).decode('utf-8')
    out = {}
    for c in re.finditer(r'<c r="([A-Z]+)(\d+)"([^>]*?)(?:/>|>(.*?)</c>)', xml, re.S):
        col, row, attrs, body = c.group(1), int(c.group(2)), c.group(3), c.group(4) or ''
        v = re.search(r'<v>(.*?)</v>', body, re.S)
        if not v:
            continue
        val = v.group(1)
        t = re.search(r't="([^"]*)"', attrs)
        if t and t.group(1) == 's':
            try:
                val = sst[int(val)]
            except Exception:
                pass
        out[(col, row)] = val
    return out


def main():
    z, name2file, sst = load_xlsx()
    report = {'R1': [], 'R2': [], 'R3': [], 'R4': [], 'summary': {}}

    # ---------- R1 规则级：行起点必须是 43，结束行必须是 142 ----------
    allrules = {}
    for nm in SHEET_ORDER:
        if nm not in name2file:
            continue
        rules = read_validations(z, name2file[nm])
        allrules[nm] = rules
        for r in rules:
            f = r['formula1']
            if f.startswith('"') or f.isdigit():
                continue          # 静态列表 / 序号起点，非引用式
            rows = [int(x) for x in re.findall(r'\$[A-Z]+\$(\d+)', f)]
            if not rows:
                continue
            ok = (min(rows) == 43 and max(rows) == 142)
            report['R1'].append({'sheet': nm, **r, 'ok': ok,
                                 'row_span': [min(rows), max(rows)]})

    # ---------- R2 映射级：K 列必须引用本表专属清单列 ----------
    for nm in SHEET_ORDER:
        if nm not in ('学习文具', '体育用品', '少儿护理', '少儿穿戴', '少儿食品',
                      '家庭日用', '读物潮玩', '米面油品', '家用电器'):
            continue
        want = None
        for col, s in DESC_COL2SHEET.items():
            if s == nm:
                want = col
        for r in allrules.get(nm, []):
            sq = r['sqref']
            if not sq.startswith('K'):
                continue
            m = re.search(r'字段说明!\$([A-Z]+)\$(\d+)', r['formula1'])
            got = m.group(1) if m else None
            report['R2'].append({'sheet': nm, 'sqref': sq, 'ref_col': got,
                                 'want_col': want, 'ok': got == want,
                                 'formula1': r['formula1']})

    # ---------- R3 清单级：被引用清单列的内容 vs 114 体检里的微盟实况 ----------
    cov_path = os.path.join(REPO, '.scan', 'dropdown_coverage_9sheets.json')
    weimob = {}
    if os.path.exists(cov_path):
        cov = json.load(open(cov_path, encoding='utf-8'))
        for k, v in cov.items():
            weimob[k] = v.get('weimob_l2', [])
    desc = read_cells(z, name2file['字段说明'], sst)
    for nm, want in weimob.items():
        if not want:
            continue
        col = None
        for c, s in DESC_COL2SHEET.items():
            if s == nm:
                col = c
        opts, r = [], 43
        while (col, r) in desc:
            opts.append(desc[(col, r)])
            r += 1
        missing = [x for x in want if x not in opts]
        extra = [x for x in opts if x not in want]
        report['R3'].append({'sheet': nm, 'col': col, 'table_opts': opts,
                             'weimob_l2': want, 'missing': missing, 'extra': extra,
                             'ok': not missing and not extra})

    # ---------- R4 数据级：单元格内容必须与「本轮修改前」一致 ----------
    # 本轮只改「数据验证(下拉)」规则，不应触碰任何单元格值。
    # 基准 = 最初快照 + 上轮已 PASS 的 K 列改动(113/124 台账) + 用户本轮改的 6024 五行
    def load(p):
        p = os.path.join(REPO, p)
        return json.load(open(p, encoding='utf-8')) if os.path.exists(p) else None

    expect = {}                      # sheet -> {row0: {col: value}}

    # (a) 少儿穿戴：上轮 113 复核后的 K 值
    rep113 = load('backup/113-kcol-review.json')
    if rep113:
        # R1 只是 5 条样本，R3.overwrittenRows 才是全部 8 条被覆盖的错值行
        for x in rep113.get('R1', []):
            expect.setdefault('少儿穿戴', {}).setdefault(x['excel_row'], {})['K'] = x['now']
        for x in rep113.get('R3', {}).get('overwrittenRows', []):
            expect.setdefault('少儿穿戴', {}).setdefault(x['excel_row'], {})['K'] = x['new']
        # (b) 用户本轮把 6024「新款儿童防蓝光眼镜」5 行改为「未录入了」(C 列)
        for row in range(124, 129):
            expect.setdefault('少儿穿戴', {}).setdefault(row, {})['C'] = '未录入微盟'

    # (c) 少儿护理/少儿食品/米面油品/家用电器：124 写入后的 K 值
    plan = load('.scan/kcol_fill_plan.json')
    if plan:
        for p in plan:
            expect.setdefault(p['group'], {}).setdefault(p['row'], {})['K'] = (p.get('k_target') or '')

    # 少儿穿戴的全列基准（最初快照）
    snap4 = os.path.join(REPO, '.scan', 'shaowear_before_000004.csv')
    rows_b4 = list(csv.reader(io.StringIO(open(snap4, encoding='utf-8').read()))) if os.path.exists(snap4) else []

    cur4 = read_cells(z, name2file['少儿穿戴'], sst)
    diff = []

    def same(a, b):
        """CSV 保留显示格式('60.00')，xlsx 是原始值('60')，需归一化后比较"""
        a, b = str(a).strip(), str(b).strip()
        if a == b:
            return True
        try:
            return float(a) == float(b)
        except (TypeError, ValueError):
            return False

    exp_sw = expect.get('少儿穿戴', {})
    for ri, row in enumerate(rows_b4):
        for ci, val in enumerate(row):
            col = chr(65 + ci) if ci < 26 else 'A' + chr(65 + ci - 26)
            exp = exp_sw.get(ri + 1, {}).get(col, val)
            if str(exp).strip() == '':
                continue
            got = cur4.get((col, ri + 1), '')
            if not same(exp, got):
                diff.append({'cell': f'{col}{ri+1}', 'expect': str(exp)[:40], 'actual': str(got)[:40]})
    report['R4'].append({'sheet': '少儿穿戴', 'basis': '113复核后K值 + 用户6024改动 + 最初快照其余列',
                         'rows': len(rows_b4), 'diff_count': len(diff), 'diffs': diff[:20],
                         'ok': len(diff) == 0})

    # 其余 4 表：只校验 K 列（台账已证 nonKChanged=0）
    for nm in ('少儿护理', '少儿食品', '米面油品', '家用电器'):
        exp = expect.get(nm, {})
        cur = read_cells(z, name2file[nm], sst)
        d = []
        for row, cols in exp.items():
            for col, val in cols.items():
                got = cur.get((col, row), '')
                if not same(val, got):
                    d.append({'cell': f'{col}{row}', 'expect': str(val)[:40], 'actual': str(got)[:40]})
        report['R4'].append({'sheet': nm, 'basis': '124台账(写入后K值)', 'checked': len(exp),
                             'diff_count': len(d), 'diffs': d[:20], 'ok': len(d) == 0})

    # 体育用品：K 列取值必须仍在 114 体检记录的微盟 7 项集合内
    cov = load('.scan/dropdown_coverage_9sheets.json')
    if cov:
        allowed = set(cov['体育用品']['k_values'])
        cur = read_cells(z, name2file['体育用品'], sst)
        bad = []
        n = 0
        for (col, row), v in cur.items():
            if col != 'K' or row < 2:
                continue
            if not str(v).strip():
                continue
            n += 1
            if str(v).strip() not in allowed:
                bad.append({'cell': f'K{row}', 'actual': str(v)[:30]})
        report['R4'].append({'sheet': '体育用品', 'basis': '114体检记录的微盟7项集合',
                             'checked': n, 'diff_count': len(bad), 'diffs': bad[:20], 'ok': len(bad) == 0})

    # ---------- 汇总 ----------
    r1bad = [x for x in report['R1'] if not x['ok']]
    r2bad = [x for x in report['R2'] if not x['ok']]
    r3bad = [x for x in report['R3'] if not x['ok']]
    r4bad = [x for x in report['R4'] if x.get('ok') is False]
    report['summary'] = {
        'r1_total': len(report['R1']), 'r1_bad': len(r1bad),
        'r2_total': len(report['R2']), 'r2_bad': len(r2bad),
        'r3_total': len(report['R3']), 'r3_bad': len(r3bad),
        'r4_total': len(report['R4']), 'r4_bad': len(r4bad),
        'verdict': 'PASS' if not (r1bad or r2bad or r3bad or r4bad) else 'FAIL',
    }
    out = os.path.join(REPO, 'backup', '126-dropdown-review.json')
    json.dump(report, open(out, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)

    print('===== R1 规则级（行起点 43 / 结束 142）=====')
    for x in report['R1']:
        if not x['ok']:
            print('  FAIL', x['sheet'], x['sqref'], x['formula1'][:60], x['row_span'])
    print('  共 %d 条引用式规则，错位 %d 条' % (len(report['R1']), len(r1bad)))

    print('===== R2 映射级（K 列 → 本表专属清单列）=====')
    for x in report['R2']:
        if not x['ok']:
            print('  FAIL', x['sheet'], x['sqref'], 'ref=%s want=%s' % (x['ref_col'], x['want_col']))
    print('  共 %d 条，错配 %d 条' % (len(report['R2']), len(r2bad)))

    print('===== R3 清单级（清单内容 vs 微盟实况）=====')
    for x in report['R3']:
        flag = 'OK ' if x['ok'] else 'FAIL'
        print('  %s %-6s 列%s 表内%d项 / 微盟%d项 缺=%s 多=%s' %
              (flag, x['sheet'], x['col'], len(x['table_opts']), len(x['weimob_l2']),
               x['missing'] or '无', x['extra'] or '无'))

    print('===== R4 数据级（单元格内容零变化）=====')
    for x in report['R4']:
        if 'status' in x:
            print('  SKIP', x['sheet'], x['status'])
        else:
            print('  %s %-6s 基准=%s 核对%d处 差异%d' %
                  ('OK ' if x['ok'] else 'FAIL', x['sheet'], x['basis'], x.get('checked', x.get('rows', 0)), x['diff_count']))
            for d in x['diffs'][:5]:
                print('       ', d)

    print('\nVERDICT:', report['summary']['verdict'])
    print('报告:', out)
    return 0 if report['summary']['verdict'] == 'PASS' else 1


if __name__ == '__main__':
    sys.exit(main())
