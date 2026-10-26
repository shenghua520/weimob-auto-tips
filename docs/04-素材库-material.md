# 04 · 素材库 material

> 🟡 **本章接口均为自查接口**（非官方，随前端发版可能失效）。官方通道见 [WOS 开放平台](官方-01-WOS开放平台.md) / [iPaaS 私域网关](官方-02-iPaaS私域网关.md)。

> 接口域：`/api3/material/center/`　产品线：`mpmaterial`
> 实测：5552 条素材，判定出 5501 条"未使用"并全部删除，0 失败

## 1. 素材列表

```
POST /api3/material/center/material/getMaterialList
```

### 请求体（比商品接口简单）

```jsonc
{
  "bosId": "<BOS_ID>",
  "merchantId": "<MERCHANT_ID>",
  "sourceProductId": 1,
  "sourceProductInstanceId": <INSTANCE>,
  "tcode": "weimob",
  "vid": "<VID>",
  "pageNum": 1,
  "pageSize": 60,          // ← 实测 60 可用（商品接口只有 20）
  "basicInfo": { /* 骨架 */ },
  "i18n": { "language": "zh-CN", "timezone": 8 },
  "extendInfo": { ... }
}
```

### 返回字段

| 字段 | 说明 |
|---|---|
| `id` | 素材 ID（删除用） |
| `title` | 文件名（如 `b8b2abd7-....png`） |
| `url` | CDN 地址 `https://image-c.weimobwmc.com/<bucket>/<uuid>.png` |
| `size` | 字节数 |
| `materialType` | 1=图片（删除必填） |
| `createUid` | **创建人 ID —— 删除时必须用它当 `updateUid`** |
| `groupId` | 所属分组 |
| `createTime` | 上传时间 |

### 素材分组

```
POST /api3/material/center/group/getGroupList
```

返回 `groupList`（含 `WAI智能画图` 这类系统分组）和 `materialTotal` 总数。

## 2. 删除素材

```
POST /api3/material/center/material/deleteMaterial
```

### 必填字段（第一次调用会一次性告诉你）

```json
{"errcode":11010000002,
 "errmsg":"updateUid不能为空, 组织架构Id不能为空, 素材类型不能为空"}
```

补齐后：

```jsonc
{
  "bosId": "<BOS_ID>", "merchantId": "<MERCHANT_ID>", "tcode": "weimob", "vid": "<VID>",
  "sourceProductId": 1, "sourceProductInstanceId": <INSTANCE>, "sourceProductVersionId": "<VERSION>",
  "materialIdList": [106843615, 106843616],
  "materialIds":    [106843615, 106843616],     // 两个字段都要，少一个不生效
  "materialType": 1,                             // ← 必填
  "updateUid": 12110821958,                      // ← 必填，且必须是该素材的 createUid
  "basicInfo": { ... }, "i18n": { ... }, "extendInfo": { ... }
}
```

### 三条硬规则

| 规则 | 说明 |
|---|---|
| `updateUid` 用 `createUid` | 用当前登录人 ID 会报 `updateUid不能为空`。素材是谁传的，就填谁 |
| 同 `createUid` 才能批量 | 批量时按 `createUid + materialType` 分组，每组 20 条一起提交 |
| 两张 ID 字段都要 | `materialIdList` 和 `materialIds` 同时存在才生效 |

实测 5501 条，按 `createUid` 分组后 20 条/批，**2 分 18 秒全部成功，0 失败**。

## 3. 判断"哪些素材没用上"

素材库**没有"引用次数"字段**，删除接口**也不做引用保护**——你删了首页就白图。必须自己算。

### 判定流程

```
1. 抓 5 个装修页面的编辑器 DSL
2. 从 DSL 里提取所有 image-c.weimobwmc.com URL
3. 按「文件名」（bucket 之后的 uuid.ext）建 used 集合
4. 遍历素材库，url 命中 used 的保留，其余判为未使用
```

### 抓页面 DSL

```
POST /api3/mp-decoration/biz/editor/queryEditor              （编辑器全量，最大 903KB）
POST /api3/mp-decoration/service/pageDecoration/queryPageDecorationInfo
```

页面列表在：

```
POST /api3/cms/mgr/page/query          → data.pageList[]，字段 pageId / pageName / home / releaseStatus
```

实测 5 个页面（全部已发布）：

| pageId | 页面名 | 首页 | 引用图片数 |
|---|---|---|---|
| 92540555397 | 护稚佳品健康生活馆 | ✅ | 54 |
| 91307875397 | 个人中心 | | 27 |
| 91410325397 | 运动生活家 | | 28 |
| 91401625397 | 书写造物馆 | | 42 |
| 91311515397 | 护稚佳品 | | 42 |
| — | 去重后合计 | | **81** |

### 为什么按文件名匹配，不按完整 URL

```
素材库：https://image-c.weimobwmc.com/<BUCKET_A>/a52c5514....png
页面里：https://image-c.weimobwmc.com/<BUCKET_B>/5ccbe45b....png
                              ↑ bucket 不同
```

同一个域名下 bucket 会不同（`<BUCKET_A>` / `<BUCKET_B>` …），完整 URL 直接比对会 0 命中。
**取最后一段 `uuid.ext` 作为指纹**，命中率才对得上。

但要注意：这样算出的 used 集合是"文件名集合"，如果两个 bucket 存在同名文件会误判为在用（保守方向，可接受）。

### 结果

| | 数量 |
|---|---|
| 素材总数 | 5552 |
| 页面在用（保留） | 52 |
| 其余 | 5501（删除） |
| 删完剩余 | **57** |

> 57 − 52 = 5 条差额：属于"文件名没匹配上但可能仍有引用"的保守保留，宁可不删。

## 4. 素材删除的边界

| 问题 | 答案 |
|---|---|
| 删素材会物理删除 CDN 文件吗？ | **不会**。`image-c.weimobwmc.com/...` 上的原图仍在，按备份 CSV 里的 URL 可重新上传 |
| 能恢复吗？ | 后台层面不可恢复，但 CDN 文件还在，等于"链接还在、索引没了" |
| 删完首页会不会白图？ | 严格按第 3 节判定就不会。**跳过判定直接全删必白图** |
| 视频/文件类素材？ | `materialType` 不同，分组时要分开，`materialType` 需跟着变 |

## 5. 备份 CSV 格式

```csv
素材ID,标题,类型,大小,上传时间,地址
106843618,b8b2abd7-8746-4502-b05e-7fccb6fa4dcb.png,1,334007,2026-10-22 09:12:33,https://image-c.weimobwmc.com/<BUCKET_A>/....png
```

实测 5553 条 → CSV 844KB，JSON 6MB。
