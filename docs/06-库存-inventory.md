# 06 · 库存 inventory

> 接口域：`/api3/mall/mgr/stock/`　产品线：`ecGoods`
> 实测：入库单/出库单已清空，但留下 **12 条孤儿 SKU 库存**，页面无法清零

## 1. 库存查询

```
POST /api3/mall/mgr/stock/queryStoreStockListWithPage
```

### 请求体差异

```jsonc
{
  "basicInfo": { ... },
  "solutionType": 2,
  "queryParameter": { "classifyId": "", "type": 0, "stockStatus": null },
  "pageNum": 1,
  "pageSize": 20,
  "i18n": { ... },
  "extendInfo": { "refer": "/bos/products/ecGoods/{bosId}/{key}/stock/stock-adjustment" }
}
```

### 页面列 → 字段

| 页面列 | 含义 |
|---|---|
| 商品名称 / 商品规格 | 商品名 + SKU 名（多规格商品一行一个 SKU） |
| 关联商品 | **删除商品后这里变成 0 —— 孤儿行的识别标志** |
| 库存单位 | 件 / 箱 |
| 实物库存 | 实际在库数 |
| 占用库存 | 下单未发货占用 |
| 可用库存 | 实物 − 占用 |
| 残次品库存 / 调拨在途 | 其他状态 |

行尾有两个入口：`商品库存分布`（按仓库/门店拆）和 `sku库存变动流水`（每次变动明细）。

## 2. 删除商品后会发生什么

UI 删商品时的官方提示已经说清了：

> 若所选在售商品对应的库存规格**未关联其他商品**，删除后，则库存规格也将一并删除；
> 若……**还关联了其他在售商品**，删除后，则对应库存规格将不会被删除。

实测 180 个商品删完后：

| 项 | 结果 |
|---|---|
| 入库单 | 0 条 ✅ |
| 出库单 | 0 条 ✅ |
| 库存查询 | **12 条残留**（实物库存 103 / 113 / 110 / 200），关联商品数全为 0 |
| 仓库管理 | 3 条（仓库定义，不属于库存数据，未动） |

这 12 条就是"孤儿 SKU"——商品没了、SKU 还在、库存数还挂着。

## 3. 库存调整（以及为什么它清不了孤儿）

### 页面

`商城 > 库存管理 > 库存管理 > 库存调整` → `ecGoods/.../stock/stock-adjustment`

列表每行有「调整 / 记录」。点「调整」弹窗：

| 字段 | 选项 |
|---|---|
| 调整类型 | **增量更新**（在现有库存上 ±N） / **覆盖更新**（用 N 覆盖现有值） |
| 选择组织 | 全部组织 / 部分组织 |
| 调整数量 | `增加 ▾` + 数字输入（**最小值 1，不能填 0**） |

### 接口

```
POST /api3/mall/mgr/stock/createAsyncStockTask
body: { assignType: 2, stockNum: -103, storeIdList: [], itemSkuId: ..., ... }
→ { errcode: 0, data: { result: true, taskId: 3374611297 } }
```

### ⚠️ 三个坑叠在一起

| 坑 | 表现 |
|---|---|
| **异步任务** | 返回 `result:true` + `taskId`，立即回读库存**数值不变**（以为失败，其实在排队） |
| **覆盖更新不接受 0** | 输入框 min=1，想直接覆盖成 0 做不到，只能"增量减少 N" |
| **商品已删 → 任务无目标** | 提交成功，任务跑完也没落到 SKU 上，库存数纹丝不动 |

实测：对 12 条孤儿提交了 5 批"增量减少 N"，接口全部 `result:true`，
等了几分钟回读，**实物库存依旧是 103/113/…**。

> **结论：孤儿 SKU 库存无法通过后台页面清零。**
> 页面能改的是"活商品"的库存；商品删了以后，这行数据只能由微盟后台清档处理（找客服）。
> 好在这类行不影响经营：关联商品 0，不会上架、不会发货、不会进任何交易链路，只是显示脏数据。

## 4. 正确的库存清理顺序

```text
1. 库存清零（库存调整 → 增量减少到 0）      ← 必须在删商品之前做
2. 确认库存查询全为 0 / 入库出库单为 0
3. 再删商品
4. 若已倒着做了（先删商品）：接受孤儿行，走客服清档
```

本次是倒着做的（先删商品再想清库存），所以踩到了坑。

## 5. 相关页面路径

| 功能 | 路径 |
|---|---|
| 库存查询 | `ecGoods/<bos>/<key>/stock/stockSearch` |
| 门店仓库存 | `ecGoods/.../stock/inventory/storeStock` |
| 入库单 / 出库单 | `ecGoods/.../stock/inventory/godownEntry` · `placingEntry` |
| 库存调拨 / 调拨差异 | `ecGoods/.../stock/inventory/storeTransfer` · `differences` |
| 盘点单 | `ecGoods/.../stock/inventory/stockChecks` |
| 库存调整 | `ecGoods/.../stock/stock-adjustment` |
| 库存流水 | `ecGoods/.../stock/inventory/stockDetail` |
| 仓库管理 | `ecGoods/.../inventory/warehouse` |
| 库存设置（预警/超卖） | `ecGoods/.../stock/inventory/warnList` · `stockControl` |
| 供应链侧库存 | `wosheadingreport/.../headquarters-backend/inv/inv-store`（门店）/ `inv-batch`（批次）/ `noun-inv-batch`（效期） |
