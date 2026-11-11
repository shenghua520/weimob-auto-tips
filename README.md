# 微盟商户后台 · 自动化经验与 API 文档（详尽中文版）

> 站点：`https://master.weimob.com/bos/products/...`（商户：`护稚佳品`，bosId `<BOS_ID>`）
> 实测于 2026-10-25 / 10-26
> 首次实操：菜单全量地图采集（13 个模块 / 428 个功能入口）→ 商品全清（180 条）→ 素材库消化（5552 → 57 条）→ 分组重建（9 一级 + 106 二级）
> 后续累积：批量上架 249 商品（`11`）｜兑换商城排序重排 185 商品（`14`）｜批量改价 + 积分兑换价 383 SKU（`15`）｜**积分商城加品 19 商品 / 39 SKU + 库存入库（`16`、`06`）**

## ⚠️ 先看这个：接口分两个来源，不能混用

微盟的接口有**官方**和**自查**两套，来源不同、稳定性差一个量级：

| | 来源 | 鉴权 | 稳定性 | 该不该上生产 |
|---|---|---|---|---|
| **官方** | 微盟开放平台 WOS（26 域 / 数百命令） | OAuth | 有版本、有承诺 | ✅ 该 |
| **官方** | iPaaS 私域网关（18 个只读查询） | API Token | 私有网关，随时可变 | 一次性查询可以 |
| **自查** | 我从浏览器流量逆推的 `api3/**`（38 个） | Cookie + `authorization` | **随前端发版变** | ❌ 不该 |

→ 详细边界与选型：[**API 索引**](docs/API_CATALOG.md)
→ 官方两条：[WOS 开放平台](docs/官方-01-WOS开放平台.md) ｜ [iPaaS 私域网关](docs/官方-02-iPaaS私域网关.md)
→ 自查一份：[后台内部接口](docs/自查-01-后台内部接口.md)

**本文档 02~10 章讲的基本都是③（自查接口）** —— 因为这些是后台页面上真实做过的操作，
当时只能靠抓包。有了官方通道后，同类需求应优先重写成 WOS 版本。

---

## 📚 文档导航

### 🚩 从这里开始

| 文档 | 内容 |
|---|---|
| [**SOP · 作业流程**](docs/SOP-作业流程.md) | 🔴 **总纲，开新任务先读这篇**：取证备份 → 分析列工作条目 → 最小改动 → 小范围测试 → 大范围批量 → 多次 review → 总结沉淀。每步的产出物、过关标准、失败模式 |

### 基础

| 文档 | 内容 |
|---|---|
| [**00 · 概览与快速开始**](docs/00-概览与快速开始.md) | 站点结构、productCode 机制、5 分钟上手、通用约定 |
| [**01 · 鉴权与错误码**](docs/01-鉴权与错误码.md) | 登录流程、请求头清单、`fail auth 1041` 等错误码处置 |

### 接口台账（按来源分册）

| 文档 | 来源 | 内容 |
|---|---|---|
| [**API 索引**](docs/API_CATALOG.md) | — | 三条通道对比 + 选型口诀 + 加接口的规矩 |
| [**官方-01 · WOS 开放平台**](docs/官方-01-WOS开放平台.md) | 🟢 官方 | 26 业务域、命令速查、`woscli search` 用法、能力边界 |
| [**官方-02 · iPaaS 私域网关**](docs/官方-02-iPaaS私域网关.md) | 🟢 官方 | 18 个只读查询、API Token 鉴权、与另两条通道的分工 |
| [**自查-01 · 后台内部接口**](docs/自查-01-后台内部接口.md) | 🟡 自查 | 38 个已探明接口 + 725 条权限码 + 挖接口的三条路 |

### 实战分册（基于自查接口）

| 文档 | 内容 |
|---|---|
| [**02 · 菜单地图与功能定位**](docs/02-菜单地图与功能定位.md) | `queryCacheableMenus` 一次拿全量菜单树；13 模块 428 入口归属判定 |
| [**03 · 商品管理 goods**](docs/03-商品管理-goods.md) | 列表（**pageSize ≤ 20 铁律**）、批量删除、导出兜底 |
| [**04 · 素材库 material**](docs/04-素材库-material.md) | 列表分页、删除（**updateUid 必须是素材 createUid**）、引用关系反查 |
| [**05 · 装修页面 cms**](docs/05-装修页面-cms.md) | 页面列表、编辑器 DSL 抓取、从 DSL 提取图片引用 |
| [**06 · 库存 inventory**](docs/06-库存-inventory.md) | 库存查询、库存调整、**异步任务陷阱** |
| [**07 · 其他模块与页面路径**](docs/07-其他模块与页面路径.md) | 财务/运费模板/开屏推广/客服/数据 等模块的入口 |
| [**10 · 商品分组 classify**](docs/10-商品分组-classify.md) | 分组树 CRUD、**删一级级联删二级**、批量建 106 个二级并挂图 |
| [**11 · 商品批量上架全流程**](docs/11-商品批量上架全流程.md) | 🟢 **端到端**：图片规范化 → 素材按商品分组上传 → 导入 → 图文详情 → 库存 / 积分商城分组；含必填列清单、6 个导入血坑、踩坑清单 |
| [**14 · 兑换商城排序重排与安全写入**](docs/14-兑换商城排序重排与安全写入.md) | 🔴 **写操作必读**：`updatePointGoodsSort` 写接口、二级分组排序口径、写前快照→小样→回滚→批量→独立复核、STATIC/VOLATILE 验收分层、回滚文件规范、8 条新踩坑 |
| [**15 · 批量改价与积分商城价格实战复盘**](docs/15-批量改价与积分商城价格实战复盘.md) | 🔴 **写操作必读**：商品改价 / 积分兑换价 / 可兑换数量三类写操作实战；`updatePointGoods` 写字段口径（`editChangeNum` 读写不一致）、`skuList` 整体覆盖语义、复合写入连带重置；成功做法 10 类 + 失败踩坑 16 条 |
| [**16 · 积分商城全链路**](docs/16-积分商城全链路.md) | 🔴 **加品必读**：普通商品 → 积分商城（`addPointGoods`）→ 兑换价 / 可兑数量 / 限兑 → **分组归位**（`moveGoodsToClassify`）；入口是新标签不是弹窗、JS chunk 扫接口名、表单顺序不可逆、受控组件填值、10 条踩坑速查 |

### 必读

| 文档 | 内容 |
|---|---|
| [**08 · 批量清库实战**](docs/08-批量清库实战.md) | 🔴 **血的教训**：180 商品 + 5501 素材的完整清库流程与顺序 |
| [**09 · 踩坑与事故复盘**](docs/09-踩坑与事故复盘.md) | **26 个**真实踩坑：pageSize 静默降级、SPA 漏项、异步任务假成功、"不填"传成 0、快照污染、只验自己改过的、遮罩吞点击、新标签页入口、受控组件、加入≠归位… |
| [**13 · 批量操作铁律**](docs/13-批量操作铁律.md) | 🔴 **开工前必读**：5 个固定动作、改字段 3 条铁律、匹配优先级、4 项验收、排查顺序 |

---

## ⚡ API 速查（以下均为<b>自查接口</b>，官方用法见分册）

### 通用

```
POST https://master.weimob.com/api3/<域>/<资源>/<动作>
Content-Type: application/json

必备请求头：
  authorization  登录票据（从任一 XHR 里抄，不是 Cookie 就够）
  apiclient      客户端标识
  weimob-bosid   商户 ID
  referer        必须带，否则部分接口 403
  可选 apipath   仅 iPaaS 网关（/weimob/saas/admin）需要，用来区分功能
```

### 最常用 5 个

| 接口 | 用途 | 关键参数 |
|---|---|---|
| `/merchant/backstage/service/share/queryCacheableMenus` | 全量菜单树 | `productId` |
| `/mall/goods/queryGoodsListWithPageForManagement` | 商品列表 | `pageNum` / **`pageSize ≤ 20`** |
| `/mall/goods/deleteGoods` | 批量删商品 | `goodsIdList[]` |
| `/material/center/material/getMaterialList` | 素材列表 | `pageSize` 可到 60 |
| `/material/center/material/deleteMaterial` | 删素材 | `materialIdList[]` + **`updateUid`** |

### 三个致命陷阱

| 陷阱 | 现象 | 解决 |
|---|---|---|
| 商品列表 `pageSize` 传大了 | 返回 `totalCount=0`、`pageList=[]`，**不报错** | 固定 20 分页拉，别想着一次拉完 |
| `errcode` 类型不统一 | 商品接口是字符串 `"0"`，素材接口是数字 `0` | 判断写 `err === 0 \|\| err === '0'` |
| 库存调整「成功」但不生效 | 接口返回 `result:true` + `taskId`，数值不变 | 它是**异步任务**，且商品已删时任务无处落地 |

### 实测规模（2026-10-26）

| 项目 | 数量 |
|---|---|
| 官方 WOS 业务域 | **26 个** / 数百条命令（`order` 59、`goods` 125） |
| 官方 iPaaS 只读查询 | **18 个** |
| **自查接口** | **38 个**（9 个域）→ [自查-01](docs/自查-01-后台内部接口.md) |
| **权限码（codeList）** | **725 条**，28 个产品线 |
| 菜单模块（顶部导航） | 14 个（含「应用」） |
| 一级菜单组 / 功能入口 | 13 组 / **428** 个 |
| 在售商品 | 180 条 |
| 素材库 | 5553 条 |
| 商品分组 | 9 个一级 / 106 个二级 |
| 装修页面 | 5 个，引用图片 81 张 |

---

## 批量操作经验

### 0. 心法：先快照，再动手

**任何生产数据变更，串行五步**：

1. **只读快照**：把要动的对象全量导出（JSON + CSV），落盘带时间戳
2. **算出影响面**：删除前先算「谁引用了它」（素材 → 装修页面 / 商品图）
3. **小批验证**：先删 1 条，回读确认状态真的变了
4. **批量执行**：每批 ≤ 20，每批后回读计数，数量不降就停
5. **独立复核**：用另一个页面（不是同一个接口）再确认一次结果

> 本次 180 商品 + 5501 素材全程零误删，靠的就是这套顺序。跳过第 2 步就会删掉首页在用的图。

### 1. 鉴权

微盟后台是**多产品线微前端**：顶部导航每切换一个模块，就是换一个 `productCode`（`ecOrder` / `onecrm` / `ecGoods` / `mpmaterial` …）。
登录态是 Cookie，但**光有 Cookie 不够**——`api3` 上的业务接口要 `authorization` 头（登录后由前端注入，XHR 里能看到）。

最稳的拿法：打开任意业务页，监听第一个 XHR，把 `authorization` / `apiclient` / `weimob-bosid` 三个头抄下来复用。

### 2. 菜单是接口给的，不是数出来的

别用点击遍历侧边栏——SPA 只渲染当前层，**点一遍必漏项**（本次实测漏了「员工」模块 2/3 的菜单）。
直接调 `queryCacheableMenus`，一次拿回整棵树，字段含 `name / url / authCode / level / children`。

### 3. 归属判定用 URL 里的 productCode

菜单树是按产品线分树返回的，同一个商户有 13 棵树。判断某个菜单属于哪个模块，
**看它 URL 里的 productCode**（`/bos/products/<productCode>/...`），比看名字可靠：

`home`→店铺、`ecOrder`/`ecGoods`→商城、`onecrm`→CRM、`wosheading`→供应链、`sente`→数据…

### 4. 删除前先算引用（素材专治）

素材库删除接口**不做引用保护**——你删了，首页立刻白图。
必须自己反查：抓 5 个装修页面的编辑器 DSL，提取所有 `image-c.weimobwmc.com` URL，
按**文件名（bucket 之后的 uuid.ext）**和素材库比对，没命中的才是"未使用"。

### 5. 异步任务不要当同步

`createAsyncStockTask` 之流返回 `result:true` 不代表生效。要么轮询任务状态，要么等一段时间再回读。
**本次踩的坑**：商品已删 → SKU 不存在 → 库存任务提交成功但永远不落地，12 条库存成了孤儿。

### 6. 分页上限要实测

- 商品列表：`pageSize=200` → 返回空（不是报错！）→ 差点误判"库存已清空"
- 素材列表：`pageSize=60` 可用
- 装修页面列表：`pageSize=10` 默认

**结论：分页参数一律先用默认值跑通，再小步放大，同时校验 `totalCount`。**

### 7. 删除接口的必填字段藏在报错里

`deleteMaterial` 第一次调用报：
`updateUid不能为空, 组织架构Id不能为空, 素材类型不能为空`

补齐 `updateUid`（**必须是该素材的 `createUid`**，不是当前登录人）、`materialType`、`vid` 后就通了。
微盟的报错信息很直白，**逐个字段试比看文档快**。

### 8. 浏览器自动化的现实

- `playwright-cli` 在跨域跳转（`master.weimob.com` → `account.weimob.com`）后会掉会话，用自建 Playwright 脚本更稳
- 本机 playwright 版本要的 chromium 与缓存不一致，**显式指定 `executablePath`** 指到已缓存的 chromium
- 业务页内容是**套 iframe** 的，`document.body.innerText` 在主文档拿不到，要遍历 `page.frames()`
- 弹窗元素常被一层透明 `input` 遮住，`click()` 会超时，用 `click({force:true})` 或点底层输入框

### 9. 数量核对要用两条独立路径

删完商品后，一个接口说 0，另一个页面说 37——**都不算数**。
必须：接口 `totalCount` + 页面文本「共 N 条」两边都对上，才算真清空。

### 10. 什么删不掉

- **有订单的商品**：微盟不阻止删除，但订单里的商品快照从此不可追溯
- **孤儿 SKU 库存**：商品删了但库存行留着，页面改不动（任务无目标），只能找客服清档
- **仓库定义**：属于基础资料，删库存不等于删仓库

### 11. 一句话总结

> **菜单查接口 → 引用先算清 → 快照再动手 → 20 条一批 → 双路径复核**
> **凡是返回 `result:true` 的，都要回读确认**
> **`pageSize` 加大后返回空，先怀疑上限，别怀疑数据没了**

### 12. 商品分组：删除级联，创建要带父级

- **删一级会连带删掉它的全部二级**（弹窗原文："该分组下有 N 个二级分组，删除后同步删除"）。
  清空整个分组体系只需删一级，不用逐个删二级（实测 59 个分组只调了 9 次接口）。
- **创建时只传 `name` 会建成一级分组**（`parentId` 默认 0）。建二级必须显式传
  `parentId` + `classifyLevel: 2`，否则凭空多出一个顶层分组。
- 系统分组（新品上架 -1 / 热销排行 -2 / 未分组 -3 / 列表中隐藏 -4）删不掉，也不该删。
- 详见 [10 · 商品分组](docs/10-商品分组-classify.md)。

### 13. 兑换商城排序：写接口靠拦 UI，验收要分层

- **名词**：兑换商城 = 积分商城；「二级分组」指**在售商品商品分组树**的二级，积分分组本身只有一级。
  四套「分组」别混，详见 [14 章](docs/14-兑换商城排序重排与安全写入.md)。
- **写接口** `mall/point/goods/updatePointGoodsSort`：扫 JS 字符串没抓到，靠点排序铅笔图标 →
  `修改排序` 弹窗 → 网络层 `route.abort()` 记录 body → 点「确定」，**线上零改动**拿到。
  弹窗原文「展示排序顺序为倒叙，数字越大越靠前」决定 `sort` 分配方向。
- **两套 sort 独立**：积分商品 `sort` ≠ 在售商品 `sort`（393 个可匹配商品全部不同），改积分排序不影响在售列表。
- **值域最小化**：复用现有 393 个 `sort` 值按名次重分配，不新造数值；393 条里只写 391 条，只改 `sort` 一个字段。
- **验收分两层**：`STATIC` 字段差异判失败；`goodsStock` / `goodsAvailableNum` / `goodsAlreadySoldNum`
  是线上真实兑换会自然波动的 `VOLATILE`，**只报告、不判失败、绝不顺手修回去**。
  本次就有一笔真实兑换（库存 300→299、已兑数 0→1）被误报成「回滚未完全」。
- **守卫用黑名单不用白名单**：白名单会把 `user/current`、`conditionQueryAndReplaceDomain`
  等页面初始化只读 POST 一起拦掉，导致查询根本发不出来、误报「未捕获到接口」。
- **流程**：只读快照 → `--plan` 干跑 → 12 条 `--test` 且自动回滚 → 写前即时快照 + 回滚文件先落盘
  → `--apply` 391 条 → 全量验收 → **另起只读脚本独立复核**。本次 9 项复核全绿。

---

## 🔐 安全说明

本仓库所有文档/脚本均已**脱敏**：

- 真实 bosId → `<BOS_ID>`
- 真实 vid → `<VID>`
- 门店 key / productCode 路径参数 → `<KEY>`
- 真实账号 → `<ACCOUNT>`
- `authorization` → `<TOKEN>`

请在使用前替换为自己的凭证，并**不要提交真实凭据到 Git**（本项目 `.gitignore` 已排除 `config.json` / `*.local.js`）。

---

## 📁 仓库结构

```
weimob-auto-tips/
├── README.md                        本文件（导航 + 经验总结）
├── config.example.js                配置模板（复制成 config.local.js）
├── docs/
│   ├── SOP-作业流程.md              🔴 总纲（开新任务先读）
│   ├── 00-概览与快速开始.md
│   ├── 01-鉴权与错误码.md
│   ├── 02-菜单地图与功能定位.md
│   ├── 03-商品管理-goods.md
│   ├── 04-素材库-material.md
│   ├── 05-装修页面-cms.md
│   ├── 06-库存-inventory.md
│   ├── 07-其他模块与页面路径.md
│   ├── 08-批量清库实战.md          🔴 必读
│   ├── 09-踩坑与事故复盘.md
│   ├── 10-商品分组-classify.md
│   ├── 11-商品批量上架全流程.md     🟢 端到端实战
│   ├── 13-批量操作铁律.md           🔴 开工前必读
│   ├── 14-兑换商城排序重排与安全写入.md  🔴 写操作必读（积分商城 sort）
│   ├── 15-批量改价与积分商城价格实战复盘.md  🔴 写操作必读（改价/兑换价/可兑数量）
│   ├── 16-积分商城全链路.md         🔴 加品必读（addPointGoods / 归组 / 验收）
│   ├── API_CATALOG.md             接口索引（三通道对比 + 选型）
│   ├── 官方-01-WOS开放平台.md       🟢 官方
│   ├── 官方-02-iPaaS私域网关.md     🟢 官方
│   └── 自查-01-后台内部接口.md      🟡 自查
└── scripts/
    ├── lib/common.js               公共：登录 / 抓 header / 分页 / CSV
    ├── 00-sniff-api.js             接口台账自动采集（点一遍后台就出清单）
    ├── 01-sniff-menu.js            抓全量菜单树 + 725 条权限码
    ├── 02-build-feature-map.js     归类 + 生成可检索地图（HTML/MD）
    ├── 03-export-goods.js          商品全量备份
    ├── 04-delete-goods.js          分批删商品（--yes 才执行）
    ├── 05-collect-page-urls.js     采集装修页面引用的图片
    ├── 06-export-material.js       素材备份 + 判定未使用
    ├── 07-delete-unused-material.js 删未使用素材（--yes 才执行）
    │
    │   # 以下 08~15 是「批量搬家」流水线（见 docs/11）
    ├── 08-process-images.js        图片规范化：750×750 白底自适应 + 长详情图切段
    ├── 09-create-goods-groups.js   按商品建素材二级分组（短名_srcId）
    ├── 10-upload-processed.js      批量上传（--noinsert 跳过入库只取 URL）
    ├── 11-gen-import-final.js      生成导入 Excel（--from/--to 分批）
    ├── 12-import-batch.js          一次登录、多文件流水线导入
    ├── 13-set-desc.js              批量写图文详情 + 校正商品图片
    ├── 14-gen-fix-from-fail.js     读失败明细 → 只补录失败的那几个商品
    ├── 15-verify-final.js          终验：总数 + 抽样核对图/详情/类目/SKU
    ├── 16-mat-insert.js            素材补登（只调 insertMaterial，不重传）
    ├── 17-del-goods.js             按 ID 删商品（先快照，--yes 才执行）
    ├── 18-video-upload.js          视频：建 9 个大类组 + 上传 + 产出 URL 映射
    ├── 19-sync-goods.js            视频挂商品 + 副标题补全 + 详情图样式加固
    ├── 20-set-stock-all.js         批量录库存（覆盖式，默认 100）
    ├── 21-review-mobile.js         手机端批量体检：逐张比对显示比例 vs 原图比例
    ├── 22-mobile-shot.js           手机端单商品截图 + 图片尺寸明细
    ├── 23-check-stock.js           库存核验（读 storeWarehouse.totalStockNum）
    ├── 24-stock-delta.js           库存按差额调整
    ├── 25-gen-entry.js             生成入库单 Excel（规格条码精确定位 SKU）
    ├── 26-entry-probe.js           抓入库单真实 API
    ├── 27-process-images-v2.js     主图 750×1000 + 中心 750×750 安全区（抗容器裁切）
    ├── 28-upload-v2.js             上传新主图
    ├── 29-update-images.js         把新主图写回商品
    ├── 30-list-img-probe.js        量容器比例 / object-fit（定安全区用）
    ├── 31-probe-instance.js        核实 productInstanceId 归属与素材额度
    ├── 32-points-groups.js         积分商城：按在售分组批量归类（分批50 + 全量验收）
    │
    │   # 以下 33~42 是「积分商城排序重排」链路（见 docs/14）
    ├── 33-export-classify-readonly.js       商品分组只读导出（严格只读 + 写接口守卫）
    ├── 34-export-points-sort-readonly.js    积分商品排序只读导出（CSV / 快照 / MD）
    ├── 35-probe-points-sort-readonly.js     只读探查：积分分组层级 / 页面排序文案
    ├── 36-probe-sort-api-readonly.js        只读探查：查询 payload / 排序列 DOM
    ├── 37-plan-resort-readonly.js           写前基线 + 方案 A/B 预演（零写）
    ├── 38-probe-shared-sort-and-writeapi.js 判定两套 sort 是否独立（零写）
    ├── 39-probe-writeapi-intercept.js       拦截式抓写接口（所有写请求 abort）
    ├── 40-probe-sort-popover.js             排序编辑弹窗 → 抓到 updatePointGoodsSort
    ├── 41-resort-points-by-classify.js      重排主脚本：--plan / --test / --apply / --rollback
    └── 42-verify-resort-readonly.js         独立复核（只读、重新登录回读）
```

### 跑法

```bash
npm install                    # playwright-core / sharp / cos-nodejs-sdk-v5 / xlsx
cp config.example.js config.local.js && vim config.local.js
node scripts/lib/common.js login       # 登录一次，存登录态
node scripts/00-sniff-api.js --auto    # 采集接口台账（人工点更深，--auto 走一遍模块）
node scripts/01-sniff-menu.js          # 抓菜单
node scripts/02-build-feature-map.js   # 出功能地图
node scripts/03-export-goods.js        # 备份商品
node scripts/05-collect-page-urls.js   # 算素材引用
node scripts/06-export-material.js     # 备份素材 + 出可删清单
node scripts/04-delete-goods.js --yes  # 删商品（危险）
node scripts/07-delete-unused-material.js --yes   # 删素材（危险）

# 批量搬家流水线（顺序不能乱）
node scripts/08-process-images.js --all              # 1. 处理图片，出清单 + 断点续跑
node scripts/09-create-goods-groups.js               # 2. 建 249 个素材分组
node scripts/10-upload-processed.js --all --noinsert # 3. 上传取 URL（入库可能撞配额）
node scripts/11-gen-import-final.js --from=0 --to=83 --tag=p1   # 4. 分批生成 Excel
node scripts/12-import-batch.js 最终导入_p1.xlsx …    # 5. 导入（自动取失败明细）
node scripts/14-gen-fix-from-fail.js 失败明细_xxx.xlsx fixp1    # 6. 补录（只补失败的）
node scripts/13-set-desc.js --all                    # 7. 写图文详情
node scripts/15-verify-final.js 6                    # 8. 终验
node scripts/16-mat-insert.js                        # 9. 素材补登进素材库
node scripts/18-video-upload.js                      # 10. 视频建组 + 上传
node scripts/19-sync-goods.js --all                  # 11. 挂视频 + 副标题 + 详情样式
node scripts/20-set-stock-all.js --num=100           # 12. 录库存
node scripts/21-review-mobile.js 12                  # 13. 手机端体检（比例/裁切）
```

> 08~15 依赖脚本同级的 `profile/`（登录态）和 `backup/`（数据目录：
> `products.json`、`图片处理清单.json`、`素材URL映射.json`、`商品ID映射.json`、商品导入模板.xlsx）。
> 脚本里 `executablePath` 写的是本机 chromium 路径，换机器要改。

---

生成时间：2026-10-27（最后更新 2026-11-11）
接口实测：2026-10-25 ~ 2026-11-09（微盟 SaaS 商户后台）
批量上架实战：2026-10-27 完成 249 个商品 / 448 行 / 3,844 张图端到端跑通
后续实战：素材补登 3,826 张 · 视频 11 个 · 全站改价/清划线价 307 商品 · 积分商城 306 商品分组
2026-11-09：商品分组只读导出（116 节点）· 积分商城排序导出（393 条）· 按二级分组重排（391 条写入 + 独立复核全绿）→ 见 14 章
2026-11-11：批量改价 + 积分兑换价 383 SKU（成功做法 10 类 / 踩坑 16 条）→ 见 15 章；**积分商城加品 19 商品 / 39 SKU + 库存入库 39 SKU + 分组归位 19/19 → 见 16 章与 06 章；首次整理出作业流程总纲 → 见 [SOP](docs/SOP-作业流程.md)**
