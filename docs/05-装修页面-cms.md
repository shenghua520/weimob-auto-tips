# 05 · 装修页面 cms

> 接口域：`/api3/mp-decoration/`、`/api3/cms/`　产品线：`mpcms`
> 用途：查页面清单、抓页面用了哪些图、确认开屏广告是否配置

## 1. 页面清单

```
POST /api3/cms/mgr/page/query
→ { data: { pageNum, pageSize, totalCount, pageList: [...] } }
```

### field 说明

| 字段 | 说明 |
|---|---|
| `pageId` | 页面 ID（编辑器入口用） |
| `pageName` | 页面名 |
| `home` | 是否首页（`true` 的那个就是小程序落地页） |
| `releaseStatus` / `releaseStatusDesc` | 发布状态（1=已发布） |
| `releaseTime` / `updateTime` | 发布时间 / 修改时间 |
| `pageScope` | 2=全渠道 |
| `templateId` | 用的模板 |

> ⚠️ 有两个名字相近的接口，别抓错：
> - `/api3/cms/mgr/page/query` ✅ 返回 `pageList`
> - `/api3/cms/mgr/page/queryListCombinedData` 返回 `systemPage`（系统页面，不含自定义页）
> - 还有一个返回 `qrUrl/url` 的，是"页面二维码"，不是清单

实测 5 个自定义页面，全部已发布，首页是「护稚佳品健康生活馆」。

## 2. 编辑器（装修器）

```
GET https://master.weimob.com/bos/products/mpcms/<BOS_ID>/<KEY>/design/editor?pageid=<pageId>&allChannelHome=false
```

### 抓 DSL 的两个接口

| 接口 | 大小 | 内容 |
|---|---|---|
| `/api3/mp-decoration/biz/editor/queryEditor` | 实测 903KB | 编辑器全量数据（组件、样式、素材引用） |
| `/api3/mp-decoration/service/pageDecoration/queryPageDecorationInfo` | 实测 251KB | 页面级配置（背景色、背景图、背景音乐等） |

两个都含图片 URL，取并集更稳。

```js
page.on('response', async r => {
  if (!(r.headers()['content-type'] || '').includes('json')) return;
  const b = await r.text();
  if (b.length > 3000 && b.indexOf('image-c.weimobwmc.com') > -1) bodies += b;
});
```

### 提取 URL 的坑

DSL 里的 URL 是 JSON 字符串转义过的，直接正则会被反斜杠吃掉。两种可用写法：

```js
// 写法 A：按引号切分，找含域名的片段
const urls = new Set();
for (const p of body.split('"')) {
  if (p.indexOf('image-c.weimobwmc.com') < 0) continue;
  const clean = p.replace(/\\+$/g, '').replace(/\\u002F/gi, '/');
  const k = clean.indexOf('http');
  if (k > -1) urls.add(clean.slice(k));
}

// 写法 B：JSON.parse 之后递归遍历所有字符串值（更稳，但要看响应是否合法 JSON）
```

## 3. 编辑器里有什么（人工定位用）

打开编辑器后，左侧是组件库，分「常用 / 导航 / 图文 / 商品 / 卡券 / 客户 / 店铺 / 其他 / 会员 / 搜索」十类，含：

`图片 / 轮播图 / 图文导航 / 定向图片 / 标题栏 / 文本 / 分割占位 / 菜单 / 店铺公告 / 倒计时 / 页面链接导航 / 背景悬浮导航 / 节点列表 / 定位菜单 / 切换节点 / 视频组件 / 腾讯游戏 / 地图 / 同城配送切换地址 / 买家秀 / 商品 / 商品分组 / 店铺头部 / 专题推荐 / 商城订单 / 限时折扣 / 外卖 / 满减邮 / 搭配套装 / 服务预约 / 收藏有礼 / 优惠券…`

顶部操作：`返回 / 保存时间 / 提审小程序 / 预览 / 保存 / 发布`。

> **只读巡查时不要点「保存」「发布」「提审小程序」**。打开编辑器本身不产生副作用，
> 但保存会覆盖线上版本。

## 4. 店铺装修下的其他入口

| 功能 | 路径 | 说明 |
|---|---|---|
| 页面管理 | `mpcms/.../pages/custom` / `pages/system` | 自定义页 / 系统页（22 个系统页：次卡详情、购物车、搜索结果…） |
| 导航管理 | `mpcms/.../nav/list` · `nav/create` | 底部/顶部导航 |
| 风格管理 | `mpcms/.../design/style` | 装修风格类型（潮流风等）、配色、图标风格、**加载动画**（页面加载慢时的动画，不是开屏视频） |
| 通用设置 | `mpcms/.../setting` | 分享链有效期、消费者分享、小程序收藏提示、剪贴板、技术支持标识、图片质量、关注公众号 |
| 进店规则 | `mpcms/.../joinStore/areaRule` | 区域准入 |
| 搜索管理 | `mpcms/.../pages/search` | 搜索设置 |
| 聚合二维码 | `mpchannel/.../channel/qrAggregation` | 渠道码 |

## 5. 开屏推广（不是开屏视频）

```
POST /api3/mall/mgr/activity/advertisement/queryActivityList
→ data: { pageList: [], pageNum: 1, pageSize: 10, totalCount: 0 }
```

实测该商户 **totalCount = 0**——没有任何开屏活动。

支持的内容类型：

```
POST /api3/mall/mgr/activity/advertisement/getContentTypes
→ [
  { code: 1, enable: true,  name: "单图固定广告" },
  { code: 4, enable: false, name: "多图轮播广告" },
  { code: 2, enable: false, name: "优惠券" },
  { code: 3, enable: false, name: "视频广告" },     ← 视频开屏未开通
  { code: 5, enable: false, name: "自研对接" }
]
```

> **结论：如果小程序打开时有 3 秒视频 + 跳过按钮，先排除这里**（活动为 0、视频广告未开通）。
> 再往上追就是平台级启动页或首页「视频组件」，两者都不在这个接口范围里。

## 6. 页面发布后的产物

页面改完要「提审小程序」→ 微信审核 → 发布。发布状态在 `cms/mgr/page/query` 的 `releaseStatus`，
`1` 表示已发布。查"某页面最后一次改是什么时候"看 `updateTime`。
