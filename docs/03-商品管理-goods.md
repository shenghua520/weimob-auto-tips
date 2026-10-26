# 03 · 商品管理 goods

> 🟡 **本章接口均为自查接口**（非官方，随前端发版可能失效）。官方通道见 [WOS 开放平台](官方-01-WOS开放平台.md) / [iPaaS 私域网关](官方-02-iPaaS私域网关.md)。

> 接口域：`/api3/mall/goods/`　产品线：`ecGoodsmanage` / `ecGoods`
> 实测：180 条商品全量导出 + 分批删除到 0

## 1. 商品列表

```
POST /api3/mall/goods/queryGoodsListWithPageForManagement
```

### ⚠️ 铁律：pageSize 上限 20

| pageSize | 结果 |
|---|---|
| 20 | ✅ 正常返回 20 条，`totalCount=180` |
| 200 | ❌ `pageList=[]`、`totalCount=0`，**依然 errcode 0、errmsg 处理成功** |

这个坑差点造成误判：清库脚本用 `pageSize=200` 拉一次，拿到 0 条，以为"已经删完了"，
实际上还有 160 条在库里。**永远用 20 分页拉满。**

```js
const listAll = async () => {
  const out = [];
  for (let pn = 1; pn <= 15; pn++) {
    const b = { ...base, pageNum: pn, pageSize: 20 };
    const j = await post('https://master.weimob.com/api3/mall/goods/queryGoodsListWithPageForManagement', b);
    if (!(j.errcode === 0 || j.errcode === '0')) break;
    const l = j.data.pageList || [];
    out.push(...l);
    if (!l.length || out.length >= j.data.totalCount) break;
  }
  return out;
};
```

### 关键返回字段

| 字段 | 说明 |
|---|---|
| `goodsId` | 商品 ID（删除用这个，**不是** `productId`） |
| `title` | 商品名 |
| `goodsPrice` | 价格（元，字符串） |
| `goodsStock` | 库存（列表接口里可能为 0，真实库存看库存接口） |
| `realSaleNum` | 销量 |
| `isOnline` / `isCanSell` | 上架 / 可售 |
| `createTime` | 创建时间 |
| `isMultiSku` | 是否多规格 |
| `brandName` / `classifyList` | 品牌 / 分类 |
| `isDeleted` / `auditStatus` | 删除标记 / 审核状态 |

## 2. 删除商品

```
POST /api3/mall/goods/deleteGoods
```

### 请求体

```jsonc
{
  "basicInfo": { /* 同 00 文档的骨架，一字不改 */ },
  "solutionType": 2,
  "goodsIdList": [158452624100397, 158449656100397],   // ← 核心
  "isDeleteAuditInfo": false,
  "i18n": { "language": "zh-CN", "timezone": 8 },
  "extendInfo": { "refer": "/bos/products/ecGoodsmanage/{bosId}/{key}/goods/list", "source": 80 }
}
```

### UI 弹窗的官方口径（照抄，判断影响面用）

> 确定删除所选的 N 个商品吗？
> - 若该商品已分配给门店组织，则对应组织下也将同时删除该商品；
> - 若所选在售商品对应的库存规格**未关联其他商品**，删除后，则库存规格也将一并删除；
> - 若所选对应的库存规格**还关联了其他在售商品**，删除后，则对应库存规格将不会被删除。

最后一条就是"孤儿库存"的成因——本次删完 180 个商品，库存表里剩了 12 条孤儿 SKU。

### 批量策略

| 方式 | 每批 | 说明 |
|---|---|---|
| UI 全选 + 批量删除 | 20 | 表头全选**只选当前页 20 条**（`已选20条`），要翻 9 页 |
| **接口循环** | 20 | 每批后回读 `totalCount`，不降就停 |

```js
// 伪代码：删到 0
for (let round = 0; round < 15; round++) {
  const ids = (await listAll()).map(g => g.goodsId);
  if (!ids.length) break;
  for (let i = 0; i < ids.length; i += 20) {
    await del(ids.slice(i, i + 20));
    await sleep(1000);
  }
  // 回读校验：totalCount 必须下降
}
```

## 3. 导出兜底

商品列表右上角有「导出」按钮，但**点了不一定直接下载**——实测未触发 download 事件，
大概率是进了「店铺设置 > 任务中心 > 下载中心」的异步队列。

**自动化备份不要依赖导出按钮**，直接调列表接口翻页拿全量更可靠：

```js
// 备份产物：JSON（全字段）+ CSV（人类可读）
fs.writeFileSync(`商品全量备份_${stamp}.json`, JSON.stringify(all, null, 1));
// CSV 列：商品ID / 商品名称 / 价格 / 库存 / 销量 / 上架 / 可售 / 品牌 / 创建时间
```

实测 180 条商品：JSON 499KB，CSV 31KB。

## 4. 删除前的三个判断

| 判断 | 为什么 |
|---|---|
| **有没有订单** | 微盟不阻止删除有订单的商品，但订单里的商品快照从此不可追溯，退款/售后会失去上下文 |
| **有没有被页面引用** | 商品图在素材库里，删商品不动素材；反过来清素材会打断商品图 |
| **运费模板关联数** | 实测「不包邮（默认模板）」关联了全部 180 个商品，商品删完后模板变成空壳 |

## 5. 核对结果的两条独立路径

```bash
# 路径 A：接口
curl ... queryGoodsListWithPageForManagement → data.totalCount

# 路径 B：页面
商品列表页 innerText 匹配 /共\s*(\d+)\s*条/
```

两边都是 0 才算清空。实测出现过一次"接口说 0、页面说 37"的分歧，
原因是接口传了 `pageSize=200`（见第 1 节），不是数据真的没了。

## 6. 删不掉的东西

- **商品分组 / 管理分类 / 品牌 / 标签**：属于基础资料，删商品不连带，需单独处理
- **孤儿 SKU 库存**：见 [06 · 库存](06-库存-inventory.md)，页面改不动
- **订单里的商品快照**：只读历史，删商品不影响展示，但无法再点进商品详情
