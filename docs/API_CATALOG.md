# API_CATALOG · 微盟商户后台接口清单

> 状态标记：✅ 已验证可用（实测有真实返回） / ⚠️ 已验证但有条件 / ⛔ 探测后不可用
> 全部为 `POST + JSON`，域名 `https://master.weimob.com`，除非另行标注。

## 一、平台 / 菜单

| 接口 | 用途 | 状态 | 关键参数 |
|---|---|---|---|
| `/api3/merchant/backstage/service/share/queryCacheableMenus` | 全量菜单树 | ✅ | `productId` |
| `/api3/merchant/backstage/service/share/queryCodeListByProductId` | 产品线权限码清单 | ✅ | — |
| `/api3/merchant/backstage/service/product/attachedFunctionListForProduct` | 产品已购功能 | ✅ | — |
| `/api3/merchant/backstage/service/product/queryVidOverdueProductList` | 过期产品 | ✅ | — |
| `/api3/merchant/backstage/service/shop/topbar` | 顶部栏信息 | ✅ | — |
| `/api3/merchant/backstage/service/clientApplication/queryCAppByBosId` | 客户端应用 | ✅ | — |
| `/api3/merchant/backstage/userGuidePage/getConfigListByProductId` | 新手指引 | ✅ | — |
| `/api3/wma/v2.0/application/getList` | 已购应用列表 | ✅ | — |

## 二、商品（mall/goods）

| 接口 | 用途 | 状态 | 关键参数 / 备注 |
|---|---|---|---|
| `/api3/mall/goods/queryGoodsListWithPageForManagement` | 商品列表 | ⚠️ | `pageNum` / **`pageSize ≤ 20`**，超限返回空 |
| `/api3/mall/goods/deleteGoods` | 批量删商品 | ✅ | `goodsIdList[]` + `isDeleteAuditInfo:false` |
| `/api3/mall/goods/category/queryCategoryListForManagement` | 商品类目 | ✅ | — |
| `/api3/mall/goods/classify/queryClassifyListWithPageForManagement` | 管理分类 | ✅ | — |
| `/api3/mall/base/global/getPmcParamValues` | 页面全局参数 | ✅ | — |

## 三、素材（material/center）

| 接口 | 用途 | 状态 | 关键参数 / 备注 |
|---|---|---|---|
| `/api3/material/center/material/getMaterialList` | 素材列表 | ✅ | `pageSize` 可到 60 |
| `/api3/material/center/material/deleteMaterial` | 删素材 | ⚠️ | `materialIdList[]` + `materialIds[]` + `materialType` + **`updateUid`=createUid**；`batchDeleteMaterial` / `removeMaterial` / `material/delete` 均为 ⛔ 404 |
| `/api3/material/center/group/getGroupList` | 素材分组 | ✅ | 返回 `groupList` + `materialTotal` |

## 四、装修（mp-decoration / cms）

| 接口 | 用途 | 状态 | 备注 |
|---|---|---|---|
| `/api3/cms/mgr/page/query` | 自定义页面清单 | ✅ | `pageList[]`：pageId/pageName/home/releaseStatus |
| `/api3/cms/mgr/page/queryListCombinedData` | 系统页面 | ✅ | 返回 `systemPage`，与上不同 |
| `/api3/cms/mgr/quickNav/getQuickNavForEditor` | 编辑器快捷导航 | ✅ | — |
| `/api3/mp-decoration/biz/editor/queryEditor` | 编辑器全量 DSL | ✅ | 实测 903KB，含全部图片 URL |
| `/api3/mp-decoration/service/pageDecoration/queryPageDecorationInfo` | 页面级配置 | ✅ | 实测 251KB，含背景图/音乐 |
| `/api3/mp-decoration/service/pageDecoration/previewPageInfo` | 预览信息 | ✅ | 域名 `*.cms.n.weimob.com` |

## 五、库存（mall/mgr/stock）

| 接口 | 用途 | 状态 | 备注 |
|---|---|---|---|
| `/api3/mall/mgr/stock/queryStoreStockListWithPage` | 库存列表 | ✅ | `queryParameter.stockStatus` 可筛"仅显示有库存" |
| `/api3/mall/mgr/stock/createAsyncStockTask` | 库存调整 | ⚠️ | **异步**，返回 `taskId`；商品已删时任务不落地 |

## 六、营销 / 广告

| 接口 | 用途 | 状态 | 备注 |
|---|---|---|---|
| `/api3/mall/mgr/activity/advertisement/queryActivityList` | 开屏活动列表 | ✅ | 实测 totalCount=0 |
| `/api3/mall/mgr/activity/advertisement/getContentTypes` | 开屏内容类型 | ✅ | 视频广告 `enable:false` |
| `/api3/mall/mgr/activity/advertisement/getChannels` | 投放渠道 | ✅ | 实测 `data:[]` |
| `/api3/aicenter/activity/waiPop` | 弹窗活动 | ✅ | 实测 `data:[]` |
| `/api3/aicenter/merchant/isWaiProductInUse` | WAI 产品占用 | ✅ | — |

## 七、其他

| 接口 | 用途 | 状态 |
|---|---|---|
| `/api3/mall/mgr/merchant/getMallProductVersionType` | 商城版本类型 | ✅ |
| `/api3/napi/nbiz/ss/rights/outer/storeRightsList` | 门店权益 | ✅ |
| `/api3/napi/nbiz/ss/channel/sales/retrieveUsingProduct` | 在用产品 | ✅ |
| `/api3/merchant/backstage/service/form/conditionQueryAndReplaceDomain` | 表单条件与域名替换 | ✅ |
| `/weimob/saas/admin`（iPaaS 网关） | 按 `apipath` 头区分功能 | ✅ |

> ⛔ 未探测（写操作，避免副作用）：订单售后处理、退款、发货、发票开具、账号权限、营销活动创建。
> 这些需要真实业务上下文，建议按需在页面上做一次操作再抓包。

---

## 探测方法说明

1. **只读接口**：直接重放页面上的 GET/POST，校验 `errcode`
2. **写接口**：先在页面上做一次最小操作（删 1 条），抓完整 body 当模板，再决定是否批量
3. **命名探测**：仅当无法触发页面操作时使用，404 即不存在（见 [01 文档](01-鉴权与错误码.md) 第 4 节）

实测时间：2026-10-25 ~ 10-26
