# API_CATALOG · 微盟商户后台接口台账

> 全部为 `POST + JSON`，域名 `https://master.weimob.com`（除注明外）。
> 状态：✅ 已验证可用（实测有真实返回）｜⚠️ 已验证但有条件｜⛔ 探测后确认不存在｜❔ 仅见权限码，未实测
> 实测时间：2026-10-25 ~ 10-26
>
> **规模**：已探明接口 **38 个**（覆盖 9 个域）｜权限码 **725 条**（28 个产品线）

---

## 一、总览：接口域与产品线

微盟 `api3` 按"域"划分，一个域下面挂多个产品线：

| 域前缀 | 覆盖业务 | 已探明接口数 |
|---|---|---|
| `merchant/backstage/service/` | 菜单、权限、产品、应用、店铺顶栏 | 8 |
| `mall/goods/` | 商品、商品分组、类目 | 6 |
| `mall/goods/classify/` | 商品分组（CRUD） | 5 |
| `material/center/` | 素材库、素材分组 | 3 |
| `cms/mgr/` | 装修页面清单 | 4 |
| `mp-decoration/` | 装修编辑器 DSL | 3 |
| `mall/mgr/stock/` | 库存 | 2 |
| `mall/mgr/activity/` | 开屏 / 广告活动 | 3 |
| `wma` / `napi` / `aicenter` | 应用、权益、AI 能力 | 4 |

---

## 二、平台 / 菜单 / 权限

| 接口 | 用途 | 状态 | 关键参数 / 备注 |
|---|---|---|---|
| `api3/merchant/backstage/service/share/queryCacheableMenus` | **全量菜单树** | ✅ | `productId`；响应含 `menus` + `codeList` |
| `api3/merchant/backstage/service/share/queryCodeListByProductId` | 产品线权限码 | ✅ | 实测单次 270 条 |
| `api3/merchant/backstage/service/product/attachedFunctionListForProduct` | 已购功能 | ✅ | — |
| `api3/merchant/backstage/service/product/queryVidOverdueProductList` | 过期产品 | ✅ | — |
| `api3/merchant/backstage/service/shop/topbar` | 顶栏信息 | ✅ | — |
| `api3/merchant/backstage/service/clientApplication/queryCAppByBosId` | 客户端应用 | ✅ | — |
| `api3/merchant/backstage/service/form/conditionQueryAndReplaceDomain` | 表单条件 / 域名替换 | ✅ | — |
| `api3/merchant/backstage/userGuidePage/getConfigListByProductId` | 新手引导 | ✅ | — |
| `api3/wma/v2.0/application/getList` | 已购应用列表 | ✅ | — |
| `api3/napi/nbiz/ss/rights/outer/storeRightsList` | 门店权益 | ✅ | — |
| `api3/napi/nbiz/ss/channel/sales/retrieveUsingProduct` | 在用产品 | ✅ | — |
| `api3/aicenter/merchant/isWaiProductInUse` | WAI 产品占用 | ✅ | — |
| `api3/aicenter/activity/waiPop` | 弹窗活动 | ✅ | 实测 `data:[]` |

### 登录（另一个域名）

| 接口 | 用途 | 状态 |
|---|---|---|
| `https://account.weimob.com/codeLogin` | 登录页（验证码 / 密码双模式） | ✅ |
| `https://account.weimob.com/logout` | 退出 | ✅ |

---

## 三、商品（mall/goods）

| 接口 | 用途 | 状态 | 关键参数 / 备注 |
|---|---|---|---|
| `api3/mall/goods/queryGoodsListWithPageForManagement` | 商品列表 | ⚠️ | `pageNum` / **`pageSize ≤ 20`**，传 200 返回空且 totalCount=0 |
| `api3/mall/goods/deleteGoods` | 批量删商品 | ✅ | `goodsIdList[]` + `isDeleteAuditInfo:false` |
| `api3/mall/goods/category/queryCategoryListForManagement` | 商品类目（平台类目） | ✅ | — |
| `api3/mall/goods/classify/queryClassifyListWithPageForManagement` | 管理分类（商品类目树） | ✅ | 注意与「商品分组」区分 |
| `api3/mall/base/global/getPmcParamValues` | 页面全局参数 | ✅ | — |
| `api3/mall/mgr/merchant/getMallProductVersionType` | 商城版本类型 | ✅ | — |

### 商品分组（mall/goods/classify）— 详见 [10 章](10-商品分组-classify.md)

| 接口 | 用途 | 状态 | 关键参数 / 备注 |
|---|---|---|---|
| `api3/mall/goods/classify/queryAllClassifyListForManagement` | 分组树 | ✅ | 需 4 个 `isXxx:true` 开关才返回完整数据 |
| `api3/mall/goods/classify/queryClassifyDetail` | 单个分组详情 | ✅ | `classifyId`；返回字段即创建字段名 |
| `api3/mall/goods/classify/addGoodsClassify` | 创建分组 | ⚠️ | `name` + **`parentId`** + **`classifyLevel`**；**只传 name 会建成一级** |
| `api3/mall/goods/classify/deleteGoodsClassify` | 删除分组 | ⚠️ | `classifyId`；**级联删子组**；系统分组不可删 |
| `api3/mall/goods/classify/countChildClassifyByParentClassifyId` | 统计子组 | ✅ | `classifyId` |

---

## 四、素材（material/center）

| 接口 | 用途 | 状态 | 关键参数 / 备注 |
|---|---|---|---|
| `api3/material/center/material/getMaterialList` | 素材列表 | ✅ | `pageSize` 可到 60；`groupIds:[]` 查全部 |
| `api3/material/center/material/deleteMaterial` | 删素材 | ⚠️ | `materialIdList[]` + `materialIds[]` + `materialType` + **`updateUid`=createUid** |
| `api3/material/center/group/getGroupList` | 素材分组 | ✅ | 返回 `groupList` + `materialTotal` |

**⛔ 不存在的接口名**（别再猜）：`batchDeleteMaterial` / `removeMaterial` / `material/delete` —— 全部 404。

---

## 五、装修（cms / mp-decoration）

| 接口 | 用途 | 状态 | 备注 |
|---|---|---|---|
| `api3/cms/mgr/page/query` | 自定义页面清单 | ✅ | `pageList[]`：pageId/pageName/home/releaseStatus |
| `api3/cms/mgr/page/queryListCombinedData` | 系统页面 | ✅ | 返回 `systemPage`，与上不同 |
| `api3/cms/mgr/page/queryPagePreviewUrl` | 页面预览地址 | ✅ | 只返回 `qrUrl` / `url` |
| `api3/cms/mgr/quickNav/getQuickNavForEditor` | 编辑器快捷导航 | ✅ | — |
| `api3/mp-decoration/biz/editor/queryEditor` | **编辑器全量 DSL** | ✅ | 实测 903KB，含全部图片 URL |
| `api3/mp-decoration/service/pageDecoration/queryPageDecorationInfo` | 页面级配置 | ✅ | 实测 251KB（背景图 / 音乐等） |
| `api3/mp-decoration/service/pageDecoration/previewPageInfo` | 预览信息 | ✅ | 域名 `*.cms.n.weimob.com` |

---

## 六、库存（mall/mgr/stock）

| 接口 | 用途 | 状态 | 备注 |
|---|---|---|---|
| `api3/mall/mgr/stock/queryStoreStockListWithPage` | 库存列表 | ✅ | `queryParameter.stockStatus` 可筛"仅显示有库存" |
| `api3/mall/mgr/stock/createAsyncStockTask` | 库存调整 | ⚠️ | **异步**，返回 `taskId`；商品已删时任务不落地 |

---

## 七、营销 / 广告

| 接口 | 用途 | 状态 | 备注 |
|---|---|---|---|
| `api3/mall/mgr/activity/advertisement/queryActivityList` | 开屏活动列表 | ✅ | 实测 totalCount=0 |
| `api3/mall/mgr/activity/advertisement/getContentTypes` | 开屏内容类型 | ✅ | 单图 / 多图 / 券 / 视频 / 自研；实测仅单图 `enable:true` |
| `api3/mall/mgr/activity/advertisement/getChannels` | 投放渠道 | ✅ | 实测 `data:[]` |

---

## 八、权限码全表（725 条 / 28 个产品线）

权限码格式 `产品线#路由`，例如 `mpcms#app.pages.custom`。
**它比菜单更细** —— 菜单 428 条，权限码 725 条，差额是"有权限但没在菜单暴露"的按钮级功能。
拿它反推接口路径、判断某功能对本商户是否开通，比猜快。

| 产品线 | 权限码数 | 代表路由 |
|---|---|---|
| ec | 168 | `app.order.orderlist.list`<br>`app.financial.invoiceManage` |
| wosheading | 147 | `app.headquartersBackend.goods.list`<br>`app.headquartersBackend.goods.list.add.multi` |
| onecrm | 97 | `app.bi.customerOverviewHome`<br>`app.customer.customerList` |
| home | 52 | `storeHome.index`<br>`setup.orgList` |
| mpfinance | 49 | `app.finance.marketing`<br>`app.finance.tradeDetail` |
| onecrm01 | 42 | `app.couponcode.couponcodeSet`<br>`app.couponcode.editVouchers` |
| mpchannel | 22 | `mpchannel.channel.qrcodes`<br>`mpchannel.channel.douyinministore.detail` |
| mplogistics | 19 | `mplogistics.financeFundAccount`<br>`mplogistics.financeRecord` |
| mkPromotionLive | 19 | `app.bos.live.list`<br>`app.bos.live.prizeList` |
| artascope | 16 | `app.activity.upgradeList`<br>`app.activity.upgradeComponent` |
| mpcms | 14 | `app.pages.custom`<br>`app.design.editor` |
| cdpv2 | 14 | `app.cdp.cdpcrowd.crowdlist`<br>`app.cdp.crowdDetail` |
| mpmaterial | 12 | `mpmaterial.material.sync`<br>`mpmaterial.material.store` |
| staff | 9 | `employee.list`<br>`employee.add` |
| mptroy | 8 | `mptroy.menu.replyEdit`<br>`mptroy.reply.keywordEdit` |
| mpmsg | 6 | `app.channel.channelList`<br>`app.channel.msgChannelDetail` |
| mkContent | 5 | `app.pubgift.list`<br>`app.pubgift.signup` |
| mpclearing | 4 | `app.financial.set`<br>`app.financial.details` |
| niepan | 4 | `app.buy.BuyList`<br>`app.goods.list` |
| mprisk | 4 | `app.risk.manage`<br>`app.risk.riskBlack` |
| adp | 3 | `app.ability.productConfig`<br>`app.ability.queryExpansion` |
| mkmarketing | 3 | `app.bos.marketing.home`<br>`app.bos.marketing.calendar` |
| mpage | 2 | `finance.redbook`<br>`home.userLogout` |
| mpmisc | 2 | `app.operation.log`<br>`app.operation.detail` |
| mpfreight | 1 | `app.mpfreight.express` |
| sente | 1 | `realtime` |
| mav2 | 1 | `process.dashboard` |
| mkLiveBigScreen | 1 | `app.bos.live.bigScreen` |

> 全量 725 条：跑 `scripts/01-sniff-menu.js` 拉 `queryCacheableMenus` 的 `codeList` 字段导出，
> 或跑 `scripts/00-sniff-api.js` 一次性落盘。

---

## 九、接口是怎么"学"出来的

微盟没有公开 API 文档，接口全靠三条路挖：

### ① 抓页面真实请求（最准）

```js
page.on('request', r => {
  if (!r.url().includes('/api3/')) return;
  if (!(r.postData() || '').length) return;
  record({ url: r.url(), body: r.postData(), headers: r.headers() });
});
```

`scripts/00-sniff-api.js` 就是干这个的 —— **手动点一遍各模块，自动生成接口台账**。
这是唯一能同时拿到"完整 body + 完整头"的方式，也是写文档的主要素材来源。

### ② 用权限码反推

`queryCacheableMenus` 的 `codeList` 每条都是 `产品线#路由`：

```
mpmaterial#mpmaterial.material.store   → 店铺素材页  → material/center/material/getMaterialList
mpcms#app.design.editor                → 装修编辑器  → mp-decoration/biz/editor/queryEditor
```

路由层级和接口层级高度一致，能快速缩小候选范围。

### ③ 命名探测（最后手段）

```
POST api3/mall/goods/classify/addGoodsClassify   → 200 {"errmsg":"参数: name 为空"}   ✅ 存在
POST api3/mall/goods/classify/saveGoodsClassify  → 404                              ⛔ 不存在
```

好处：错误信息直接告诉你缺哪个字段，比翻文档快。
坏处：命中率不高 —— `deleteMaterial` 猜了 3 个名字全 404，最后靠抓包才拿到。

---

## 十、未探明的部分（留给后续）

| 模块 | 为什么没探 |
|---|---|
| 订单 / 售后 / 退款 / 发货 | 写操作，会动真实交易，需业务上下文 |
| 发票开具 / 提现 | 涉及资金，风险高 |
| 营销活动创建 / 优惠券发放 | 会产生实际投放 |
| 账号权限 / 审核 | 改权限风险高 |
| CRM 积分储值流水 | 只读但体量大，未展开 |

> 探这些的正确顺序：**先在页面上做一次最小操作 → 抓包 → 再决定是否批量**。
> 不要对着接口猜参数乱发，容易产生脏数据。
