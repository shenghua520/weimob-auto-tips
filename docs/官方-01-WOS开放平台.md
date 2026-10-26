# 官方 01 · WOS 开放平台（woscli / OAuth）

> **这是唯一推荐用在生产上的通道。** 有官方文档、有版本、OAuth 授权、支持写操作。
> 本文档内容依据本地 `woscli` 实测（2026-10-23），完整清单以 `woscli --help` 为准。

## 1. 是什么

微盟 WOS（Weimob Open Service）开放平台，对外暴露商户经营能力，通过官方 CLI `woscli` 调用。

| 项 | 说明 |
|---|---|
| 授权方式 | **OAuth**，凭据存系统密钥管理器，**不需要明文账号密码** |
| 授权命令 | `woscli login`（浏览器完成，不要代劳、不要索要密码） |
| 状态检查 | `~/.woscli/woscli status` → `已授权，access token 到期时间：...` |
| token 刷新 | **无自动刷新**，过期报鉴权错，重新 `woscli login` |
| 能力范围 | **26 个业务域，数百条命令，含写操作** |
| 稳定性 | 官方开放能力，**有版本、有文档** |

## 2. 26 个业务域

| 业务域 | 职责 | 典型诉求 |
|---|---|---|
| `admin-api` | 跨业务只读查询总入口 | 订单、商品、活动、客户、门店、积分、储值、店铺概览、待办 |
| `order` | 订单、履约、配送、物流、售后、退款、结算 | 查单、改状态、退款 |
| `goods` | 商品全生命周期：SKU、库存、价格、类目、上下架 | 改价、改库存、上下架 |
| `marketing` | 营销活动与优惠权益：优惠券、满减满折、拼团、赠品 | 建活动、发券、核销 |
| `customer` | 客户资料、会员卡、积分、余额、成长值 | 按手机号查人 |
| `cdp` | 客户行为、标签体系、人群圈选、覆盖人数 | 打标签、圈人群 |
| `team` | 导购团队、客户归属、任务、目标、业绩 | 导购管理 |
| `guide` | 轻量导购：任务模板、线索、素材 | 导购业绩 |
| `chat-bi` | 自然语言经营问数、指标分析、分析报告 | 经营日报 |
| `dashboard` | 小程序埋点与行为事件明细 | 用户行为分析 |
| `finance` | 财务账户、交易账单、退款账单 | 对账 |
| `auth` | BOS 信息、员工、组织架构、角色权限 | 权限管理 |
| `merchant` | 商户基础信息与资源权限判断 | 商户信息 |
| `content` | 买家秀、素材中心、种草笔记 | 素材管理 |
| `giftcard` | 礼品卡：模板、订单、兑换、冻结解冻 | 礼品卡业务 |
| `mall-goods` | 商品内容辅助：批量查详情、类目分组 | 批量商品查询 |
| `activity` | 查询系统支持的营销活动类型及权限 | 活动能力发现 |
| `channel` | 微信公众号渠道绑定状态 | 渠道检查 |
| `social-content` | 社交平台标题正文长度校验 | 发文前校验 |
| `smart-content` | 持久化已生成的智能内容 | 内容保存 |
| `faq` | 产品功能、配置入口、操作规则咨询 | 后台功能咨询 |
| `hosted-task` / `managed-task` | 定时任务与带治理的长期自动化任务 | 定时托管 |
| `account` | 当前账号角色身份与星币额度 | 账号身份 |
| `shops` | shops 域活动与优惠券详情 | 特定场景 |
| `im-product-admin-api` | 客服商品侧接口 | — |

**命令体量参考**：`order` 59 条、`goods` 125 条。大域不要逐页翻 `--help`，用 `search`。

## 3. 实测可用命令

### 只读

```bash
# 订单列表（必填 queryTimeType / startTime / endTime）
woscli admin-api query-orders --query-time-type 1 --start-time <起> --end-time <止> --output-format json

# 商品列表
woscli admin-api query-goods-list --output-format json

# 店铺数据概览
woscli admin-api query-shop-data --output-format json

# 导购业绩
woscli admin-api query-guide-perf-list --output-format json

# 商品/SKU/价格/库存批量回读
woscli goods mall-goods-selection-readback --mall-version-type 1 \
  --goods-id-list '[...]' --filter-option '{...}' --output-format json

# 优惠券模板搜索 / 详情
woscli marketing coupon-template-search --output-format json
woscli marketing coupon-template-detail --coupon-template-id <id> --output-format json

# 促销活动 / 拼团列表
woscli marketing promotion-activity-list --activity-type <type> --output-format json
woscli marketing groupon-activity-list --start-time-ms <ms> --end-time-ms <ms> --output-format json

# 客户资料 / 员工信息
woscli customer user-info-get --output-format json
woscli auth employee-detail --output-format json
```

### 写操作（执行前必须确认）

```bash
# 订单标记
woscli order shop-order-flag-update --order-no <单号> --flag <标记> --order-nos '[...]' --output-format json

# 拼团活动添加商品
woscli marketing groupon-goods-create --activity-id <id> --title <标题> --goods-id <id> \
  --goods-name <名> --groupon-price <价> --group-people-num <人数> --output-format json
```

## 4. 发现新命令的标准姿势

```bash
woscli search "<一句话诉求>" --limit 5 --response-format concise
```

`concise` 输出四列：`CATEGORY / COMMAND / DESCRIPTION / REQUIRED INPUTS` —— 必填参数直接给，拿到就能跑。

> **禁止**逐页翻 `<category> --help`：order 59 条、goods 125 条，默认 5 条/页，翻完要十几次调用。

## 5. 参数约定

- 命令名与参数名统一 **kebab-case**（`--output-format`、`--page-size`），严禁驼峰
- 列表参数优先重复 flag（`--id a --id b`）；结构复杂且 <1KB 时用 JSON 字符串
- 机读用 `--output-format json`，给人看用 `table`
- 列表显式传 `--page-size`，不要拉全量再裁剪

## 6. 常见错误

| 现象 | 处理 |
|---|---|
| 401 / 403 | token 过期，重新 `woscli login` |
| 429 | 退避重试，降低并发 |
| 命令未找到 / PATH 未生效 | 用绝对路径调用，或新开终端 |
| 参数错误 | 先 `--help` 确认，**同一错误不重复试错超过 2 次** |

## 7. 能力边界（2026-10-23 实测）

**做不到的**：

- `kf-tool` → `unknown category`，域不存在
- `image` → 域在内置表内，但服务端未给本账号开通，本地改 `enabled-categories` 也无效
- 独立「店铺装修」域 → 不存在，装修能力散落在 `content cms-page-search-config-list`、`marketing page-link-search`
- 删除商户 / 店铺 → 无此能力

**⚠️ 绝对不要改 `enabled-categories`**：`~/.woscli/config.yaml` 里该项是**白名单语义**——
`[]` 空值是默认全开；一旦写入值，就只有列出的域可用，其余全失效（`admin-api` 会直接报 unknown）。
该权限由服务端控制，本地改既无效又自损。改动前先备份 `~/.woscli/config.yaml.bak-*`。

## 8. 与后台内部接口的取舍

| | WOS / woscli（本页） | 后台内部接口（[自查-01](自查-01-后台内部接口.md)） |
|---|---|---|
| 授权 | OAuth，可撤销 | 复用登录 Cookie + `authorization` 头 |
| 文档 | 有 | 无 |
| 稳定性 | 有版本，兼容性有承诺 | 随前端发版变，字段随时可能改 |
| 覆盖 | 26 域 / 数百命令 | 只覆盖后台页面能做的事 |
| 写操作 | 支持 | 支持，但没有审计与限流保护 |
| 适用 | **生产、定时任务、对外集成** | 只读巡查、后台没开放的边缘功能、一次性清理 |

**一句话**：能走 WOS 就走 WOS；WOS 没覆盖的，再用后台内部接口补，并且要接受"随时会坏"。
