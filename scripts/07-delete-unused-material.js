/**
 * 07 · 删除未使用素材（⚠️ 破坏性操作）
 *
 * 前置：跑过 06-export-material.js，backup/未使用素材.json 存在
 *
 * 用法：
 *   node scripts/07-delete-unused-material.js          # 演练
 *   node scripts/07-delete-unused-material.js --yes    # 真删
 *
 * 三条硬规则：
 *   1. updateUid 必须是该素材的 createUid（谁传的填谁）
 *   2. materialIdList 和 materialIds 两个字段都要传
 *   3. 同 createUid + materialType 才能批量，20 条/批
 */
const fs = require('fs');
const path = require('path');
const { launch, cfg, captureHeaders, post, isOk, sleep, PATHS } = require('./lib/common');

const DEL = `${cfg.BASE}/api3/material/center/material/deleteMaterial`;
const LIST = `${cfg.BASE}/api3/material/center/material/getMaterialList`;
const BATCH = 20;
const CONFIRM = process.argv.includes('--yes');

(async () => {
  const planFile = path.join(PATHS.BACKUP, '未使用素材.json');
  if (!fs.existsSync(planFile)) { console.log('缺少 backup/未使用素材.json，先跑 06-export-material.js'); process.exit(1); }
  const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'));
  console.log('待删素材:', plan.length, CONFIRM ? '' : '（演练模式，加 --yes 才真删）');

  const ctx = await launch();
  const page = ctx.pages()[0] || await ctx.newPage();
  page.setDefaultTimeout(60000);
  const { headers, payload } = await captureHeaders(page, PATHS.MATERIAL, 'getMaterialList');

  const totalNow = async () => {
    const j = await post(page, LIST, { ...payload, pageNum: 1, pageSize: 20 }, headers);
    return isOk(j) ? j.data.totalCount : -1;
  };
  const before = await totalNow();
  console.log('当前素材总数:', before);

  if (!CONFIRM) {
    console.log('演练：将按 createUid 分组，约', Math.ceil(plan.length / BATCH), '批');
    await ctx.close();
    return;
  }

  const mkBody = items => ({
    bosId: payload.bosId,
    merchantId: payload.merchantId,
    tcode: payload.tcode,
    vid: payload.vid,
    sourceProductId: payload.sourceProductId,
    sourceProductInstanceId: payload.sourceProductInstanceId,
    sourceProductVersionId: payload.sourceProductVersionId,
    materialIdList: items.map(x => x.id),
    materialIds: items.map(x => x.id),
    materialType: items[0].materialType,
    updateUid: items[0].createUid,     // ← 必须是 createUid
    basicInfo: payload.basicInfo,
    i18n: payload.i18n,
    extendInfo: payload.extendInfo,
  });

  // 按 createUid + materialType 分组
  const groups = new Map();
  for (const m of plan) {
    const k = String(m.createUid) + '|' + m.materialType;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(m);
  }
  console.log('分组数:', groups.size);

  let ok = 0, fail = 0, done = 0;
  const fails = [];
  for (const [, items] of groups) {
    for (let i = 0; i < items.length; i += BATCH) {
      const batch = items.slice(i, i + BATCH);
      const r = await post(page, DEL, mkBody(batch), headers);
      if (isOk(r)) ok += batch.length;
      else {
        for (const one of batch) {
          const r1 = await post(page, DEL, mkBody([one]), headers);
          if (isOk(r1)) ok++; else { fail++; fails.push({ id: one.id, title: one.title, errcode: r1.errcode, errmsg: r1.errmsg }); }
          await sleep(120);
        }
      }
      done += batch.length;
      if (done % 500 < BATCH) console.log(`  进度 ${done}/${plan.length}  成功 ${ok}  失败 ${fail}`);
      await sleep(200);
    }
  }

  const after = await totalNow();
  console.log('\n=== 完成：成功 ' + ok + '，失败 ' + fail + '，素材总数 ' + before + ' → ' + after);
  fs.writeFileSync(path.join(PATHS.BACKUP, '素材删除结果.json'), JSON.stringify({ before, after, ok, fail, fails }, null, 1), 'utf8');
  if (fails.length) console.log('失败样本:', JSON.stringify(fails.slice(0, 8)));
  await ctx.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
