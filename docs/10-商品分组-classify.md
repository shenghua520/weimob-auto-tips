# 10 · 商品分组 classify

> 接口域：`/api3/mall/goods/classify/`　页面：`商城 > 在售商品 > 商品分组`
> 实测：删干净 59 个分组（含级联），再按表格建回 9 个一级 + 106 个二级，全带图

## 1. 三个概念别搞混

微盟的商品侧有三套"分类"，名字都很像，所在页面完全不同：

| 名称 | 页面路径 | 作用 | 有图片 |
|---|---|---|---|
| **商品分组** | `ecGoodsmanage/.../manage/classify/list` | 店铺分类页的展示分组（前端"分类"tab） | ✅ `imageUrl` |
| **管理分类** | `ecGoodsmanage/.../manage/itemClassify/list` | 商品类目树，发布商品时选 | ❌ |
| **商品类目** | `goods/category/...` | 平台类目（挂属性模板） | ❌ |

用户说"分类"时，先确认是哪一个 —— 三者互不影响，删错了要重来。

## 2. 分组树查询

```
POST /api3/mall/goods/classify/queryAllClassifyListForManagement
```

### 请求体要点

```jsonc
{
  "basicInfo": { ... },
  "solutionType": 2,
  "isQueryRelationGoodsCount": true,   // 要「关联商品数」列
  "hiddenSysClassifyShow": true,
  "isQueryRelationCategory": true,
  "isSystemClassifyShow": true,        // 要「系统分组」区块
  "i18n": { ... }, "extendInfo": { ... }
}
```

### 返回结构

```jsonc
{
  "goodsClassifyList": [            // 自定义分组（树，最多两级）
    {
      "classifyId": 16481650100397,
      "name": "学习文具",
      "parentId": 0,
      "classifyLevel": 1,
      "isLeaf": false,
      "isShow": true,               // 是否在店铺展示
      "isHot": false,               // 分类页置顶（热门推荐）
      "imageUrl": "https://...",
      "sort": 100,
      "countGoodsNum": 0,           // 关联商品数
      "childClassifyList": [ /* 二级，结构相同 */ ]
    }
  ],
  "systemClassifyList": [ ... ]     // 系统分组，不可删
}
```

### 系统分组（删不掉，也不该删）

| 名称 | classifyId |
|---|---|
| 新品上架 | -1 |
| 热销排行 | -2 |
| 未分组 | -3 |
| 列表中隐藏 | -4 |

## 3. 单个分组详情

```
POST /api3/mall/goods/classify/queryClassifyDetail
body: { ...base, classifyId: <id> }
```

返回扁平的一条记录，**字段名就是创建接口要用的字段名**：

```json
{ "classifyId": 16481650100397, "name": "学习文具", "parentId": 0,
  "parentName": null, "classifyLevel": 1, "isLeaf": true,
  "isShow": true, "isHot": false, "imageUrl": null,
  "sort": 100, "classifyCode": null, "countGoodsNum": 0 }
```

> 想不通某个字段叫什么时，先查详情，比猜快得多。

## 4. 创建分组

```
POST /api3/mall/goods/classify/addGoodsClassify
```

### ⚠️ 只传 name 会建出一级分组

实测：请求体只有 `{name: "铅笔"}` 时，**创建成功**，但 `parentId` 默认 0 —— 它成了一级分组，
而不是你以为的"随便建一个"。我第一次就因为这个，把「铅笔」建到了顶层，得手动删掉。

### 正确 body

```jsonc
{
  "basicInfo": { ... },
  "solutionType": 2,
  "name": "铅笔",                    // 必填
  "parentId": 16481650100397,       // 父分组 ID，一级填 0
  "classifyLevel": 2,               // 1=一级，2=二级
  "imageUrl": "https://image-c.weimobwmc.com/.../xxx.png",   // 分组图片（可选）
  "isShow": true,                   // 在店铺展示
  "isHot": false,                   // 分类页置顶
  "sort": 16,                       // 排序，数字越大越靠前
  "i18n": { ... }, "extendInfo": { ... }
}
```

返回：

```json
{ "errcode": "0", "data": { "id": 16482332100397, "returnResult": true, "errorMsg": null } }
```

### 排序规则

- **数字越大，在店铺里越靠前**
- 页面提示：*"超过一级分组+二级分组总数为 100 个时才可以设置分组排序值，未超过限制可进行拖拽排序"*
- 所以分组数 ≤100 时 `sort` 不生效（前端拖拽），>100 时按 `sort` 排
- 想让二级按表格顺序显示：组内第 1 个给 `N`，第 2 个给 `N-1` ……最后一个给 `1`

## 5. 删除分组（级联！）

```
POST /api3/mall/goods/classify/deleteGoodsClassify
body: { ...base, classifyId: <id> }
```

### 父组删除会连子组一起删

UI 弹窗原文：

> 该分组下有 13 个二级分组，确定删除吗？
> 删除后，二级分组下的数据将同步删除

实测：59 个分组（9 个一级 + 50 个二级），**只调 9 次接口**就全清空了，不用逐个删二级。

删除前页面会先调 `countChildClassifyByParentClassifyId` 统计子组数量：

```
POST /api3/mall/goods/classify/countChildClassifyByParentClassifyId
body: { ...base, classifyId: <id> }
```

### 批量清空的正确姿势

```js
const tree = (await getTree()).goodsClassifyList;   // 只拿一级
for (const g of tree) {
  await del({ ...base, classifyId: g.classifyId });  // 每个一级一次，子级自动带走
  await sleep(800);
}
// 系统分组（classifyId 为负）不要碰
```

## 6. 实战：按表格建 106 个二级分组

场景：运营给了 Excel（A 列一级、B 列二级），一级已在后台手工建好，要补齐二级并挂图片。

```text
① 读 Excel → 结构化成 { 一级: [二级...] }
② 查分组树 → 一级 name → classifyId 映射
③ 素材库按标题找同名图 → 一级 name → imageUrl
④ 逐条 addGoodsClassify，parentId 用②，imageUrl 用③
⑤ 回读树，逐组核对 子级数量 / imageUrl 非空 / 排序
```

实测结果：

| 一级 | 二级数 | sort |
|---|---|---|
| 学习文具 | 16 | 100 |
| 体育用品 | 7 | 99 |
| 少儿护理 | 11 | 98 |
| 少儿穿戴 | 10 | 97 |
| 少儿食品 | 7 | 96 |
| 家庭日用 | 18 | 95 |
| 读物潮玩 | 11 | 94 |
| 米面油品 | 19 | 93 |
| 家用电器 | 7 | 92 |

**106 个创建，0 失败，0 缺图，用时 41 秒。**

### 幂等处理

脚本要跳过已存在的同名子组，避免重复执行时建成两份：

```js
const exist = new Set((parent.childClassifyList || []).map(c => c.name));
if (exist.has(name)) continue;
```

## 7. 分组图片怎么来

- 分组图片是**独立的素材**，来自素材库（页面上点「+」打开素材选择器）
- 素材标题和分组同名时（如素材「学习文具」对应一级「学习文具」），可以直接用标题匹配
- `imageUrl` 是完整 CDN 地址，**直接传 URL 即可，不需要传素材 ID**

> 命名建议：素材文件按 `分类名_xxx.jpg` 或直接 `分类名` 命名，脚本匹配会顺很多。

## 8. 清空/重建的顺序

```text
如果要重做分类体系：
1. 导出当前树（备份）
2. 删一级（级联带走二级）
3. 建一级（parentId=0, classifyLevel=1）
4. 建二级（parentId=一级id, classifyLevel=2）
5. 回读核对
```

⚠️ 分组里如果还挂着商品，删除会连带"分组下的数据"。清分组前先确认商品已被删除或已转移。
