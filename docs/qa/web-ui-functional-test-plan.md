# coding-tool-x Web UI 功能测试计划与执行报告

> **第二轮更新（2026-11-20）**：本报告中的 21 项缺陷已有 20 项修复，`D-05` 判定为测试方法误报（自定义日期需点击“确认”）。修复矩阵、自动化与破坏性回归结果见 [`web-ui-fix-report.md`](./web-ui-fix-report.md)。以下保留第一轮原始记录用于追溯。

| 项目 | 内容 |
|---|---|
| 被测系统 | coding-tool-x `3.9.14`（`node bin/ctx.js`，Vue 3 + Naive UI SPA + Express） |
| 测试地址 | http://localhost:19999 |
| 测试日期 | 2026-11-20 |
| 浏览器 | Google Chrome（`--headless=new --disable-gpu`），1440×900，DPR=1 |
| 测试类型 | 功能回归（真实 UI 点击）、接口契约、安全边界、数据一致性 |
| 执行方式 | 真实 Chromium + DOM/ARIA 断言 + 网络请求捕获 + 截图；接口用 `curl` 复核 |
| 结论 | **暂不建议发布**：4 个 P1 缺陷（数据正确性 1 项、入口不可达 2 项、接口缺失 1 项）需先修复并回归 |

---

## 0. 执行摘要

- 覆盖 9 个路由、12 个全局抽屉/弹窗、3 个首页平台列、渠道管理、代理生命周期、设置 5 大分区。
- 分片执行 246 行控件检查（Skills/Plugins 59、Workspaces/Templates/More 67、MCP/Prompts/Commands/Agents/Favorites/Recent 56、Settings/Conversion 64），本报告第 5 节归并为 181 个核心场景（去重与跨模块合并）。
- 结果：181 个场景中 PASS 131（72.4%）、FAIL 29、BLOCKED 15、N/A 6；同一缺陷会被多行覆盖，按缺陷计共 21 项。
- 表现稳定的能力：渠道启停/测速/编辑/校验、代理 start/stop、列锁定与拖拽排序、工作区与配置模板完整 CRUD、会话别名/收藏/Fork 确认/分页/全局搜索、设置项数值钳制与表单校验。

### P1 缺陷速览

| ID | 模块 | 现象 |
|---|---|---|
| D-01 | Analytics | 带过滤条件的总量 **大于** 无过滤总量；1d/3d 按小时聚合与按天聚合结果不一致（如 3d=2.69B > 7d=2.33B） |
| D-02 | MCP | 服务器卡片点击无任何响应，详情/工具列表/工具测试入口全部不可达 |
| D-03 | 项目列表 | 只渲染 20 个项目，无分页/加载更多；Codex 共 48 个，28 个不可达 |
| D-04 | 实时日志 | “清空”调用 `POST /api/proxy/logs/clear` 返回 404，所有平台都无法清空日志 |

---

## 1. 测试对象与结构

### 1.1 路由

| 路由 | 页面 | 依赖 |
|---|---|---|
| `/` | Home 仪表盘（平台列） | `/api/ui-config`、`/api/platforms`、各平台统计/日志 |
| `/cli/:platform` | 项目列表 | `/api/{platform}/projects` |
| `/cli/:platform/sessions/:projectName` | 会话列表 + 右侧渠道/日志面板 | `/api/{platform}/sessions/:project` |
| `/workspaces` | 工作区管理 | `/api/workspaces` |
| `/config-templates` | 配置模板 | `/api/config-templates` |
| `/skills` | Skills 管理（`?platform=`） | `/api/skills*` |
| `/plugins` | 插件管理（`?platform=`） | `/api/plugins*` |
| `/analytics` | 用量分析 | `/api/statistics/*` |
| `/:pathMatch(.*)*` | 重定向 `/` | 前端路由 |

### 1.2 全局交互面

| 入口 | 内容 |
|---|---|
| Header 导航 | Home、已启用平台、Analytics |
| Header 图标 | 主题、收藏、工作区、Prompts、MCP、设置、更多工具（⋯） |
| 更多工具 | CLI 请求转换（仅 opencode/omp）、配置模板、配置导入/导出、使用帮助、GitHub 仓库 |
| 首页平台列 | 拖拽手柄、Skills/Commands/Agents、列锁定、代理开关、渠道弹层、快速访问、今日数据、实时日志 |
| 右侧面板 | 渠道列表、代理控制、最新对话、实时日志 |
| 抽屉 | Skills / Commands / Agents / Plugins / MCP / Prompts / Favorites / Recent / ChatHistory / Workspace / ConfigTemplates / ConfigExport / GatewayConvert / Settings |

### 1.3 运行时基线（本次执行）

| 项 | 值 |
|---|---|
| 启用平台 | `["codex","omp","dsh"]`；`claude`、`gemini`、`opencode` 未启用 |
| 首页列 | Codex-CLI、OMP、DeepSeek Harness |
| 项目数量 | Codex 48（接口 `total=48`）、OMP 14、DSH 14 |
| 渠道 | Codex 15 个（1 启用）、OMP 2 启用、DSH 6 启用 |
| 全局资源 | Skills 108、DSH Plugins 192、MCP 24、Prompts 14 |
| 数据规模 | Analytics 全量约 178B tokens / 9,041 请求（7d 视图） |
| 工作区/模板 | 空列表（测试创建后已清理） |

---

## 2. 范围与不在范围

### 2.1 范围

1. 所有页面可见按钮、开关、输入、下拉、弹窗、抽屉、分页与空状态。
2. 关键页面的数据加载、筛选、搜索、排序/拖拽、增删改查与确认框。
3. 平台能力差异（Codex/OMP/DSH 的 Skills、Commands、Agents、Plugins、MCP、Prompts）。
4. 代理与渠道生命周期：start/stop、启停渠道、测速、重置健康、同步。
5. Analytics 时间范围、过滤、指标、图表、导出。
6. 接口契约、参数校验、跨站保护、路径穿越、未知路由行为。

### 2.2 不在范围（本轮）

| 项 | 原因 |
|---|---|
| 真正删除项目/会话/技能/插件、卸载插件、应用配置模板、导入配置 | 破坏真实用户数据；仅验证到确认框并取消 |
| `写入配置`、`开机自启`、重启服务 | 修改用户原生 CLI 配置 / OS 状态，需专用隔离环境 |
| 安全密码启用与解锁流程 | 可能锁死面板 |
| 通知发送、渠道余额外部请求 | 依赖外部服务与凭据 |
| 多用户/LAN 访问、移动端适配 | 本轮单机验收 |

---

## 3. 测试策略与判定标准

### 3.1 方法

1. **UI 端到端**：真实 Chromium 点击，断言 URL、可见文本、DOM 状态、网络请求。
2. **接口契约**：直接请求 API，验证状态码、`Content-Type`、错误体与边界。
3. **数据不变量**：`sum(bucket) == range_total`；`filtered_total <= unfiltered_total`；时间范围单调性（1d ≤ 7d ≤ 30d）。
4. **安全抽检**：跨站写保护、路径穿越、未知路由、存储型输入。
5. **回归保护**：每条失败用例给出最小复现步骤与证据文件。

### 3.2 状态定义

| 状态 | 含义 |
|---|---|
| PASS | 实际结果与预期一致 |
| FAIL | 可复现的功能/数据/接口错误 |
| BLOCKED | 因安全策略、外部依赖或前置条件无法执行（非通过） |
| N/A | 控件/能力在当前构建或平台不存在 |

### 3.3 严重级别

| 级别 | 定义 |
|---|---|
| P0 | 数据丢失、安全漏洞、服务不可用 |
| P1 | 核心功能不可用或数据错误，无绕行方案 |
| P2 | 主要功能受限，有绕行方案 |
| P3 | 体验、文案、可访问性、低概率边界问题 |

### 3.4 安全与数据红线

- 破坏性按钮只验证确认框，不执行最终删除。
- 临时数据统一 `QA-TEMP` 前缀，执行后清理。
- 修改过的全局配置必须恢复并用 `/api/ui-config` 复核。
- 不触发外部网络请求与原生配置文件写入。

---

## 4. 环境准备与数据隔离建议

### 4.1 推荐隔离方案（正式回归时）

```bash
# 1) 独立配置根，避免污染真实用户目录
export CC_TOOL_HOME=/tmp/cc-tool-qa
mkdir -p "$CC_TOOL_HOME"

# 2) 固定端口 + 关闭外部通知
export CC_TOOL_PORT=19999

# 3) 使用基线数据（项目/会话/渠道/技能夹具）
#    将 ~/.cc-tool、~/.claude、~/.codex、~/.omp 的测试夹具复制到隔离目录

npm start
```

> 本轮在与用户真实数据共存的环境执行，因此所有删除/安装/应用类操作只验证到确认框。

### 4.2 本轮环境恢复核对（已复核）

| 项 | 恢复值 |
|---|---|
| `theme` | `light` |
| `enabledCliPlatforms` | `["codex","omp","dsh"]` |
| `channelLocks` | 全部 `false` |
| `panelVisibility` | `showChannels=true, showLogs=true` |
| `channelBalance.showRemaining` | `true` |
| Codex 代理 | `running=false` |
| 收藏 | 各平台 0 |
| 工作区 / 配置模板 | `[]` / `[]` |
| 临时别名 / 临时技能 / 仓库输入 | 已删除或未提交 |

### 4.3 已执行的写操作（审计）

| 操作 | 影响 | 恢复情况 |
|---|---|---|
| 代理 start/stop（Codex） | 临时监听 20089 | 已停止，`running=false` |
| 渠道 88code 启用/停用 | 代理路由集合短暂变化 | 已恢复为停用（仅家帅启用） |
| 列拖拽排序 | `enabledCliPlatforms` 顺序 | 已拖回 `[codex,omp,dsh]` |
| 主题切换 | `ui-config.theme` + localStorage | 已恢复 `light` |
| 会话别名 QA-ALIAS-TEMP / 收藏 | aliases、favorites | 均已删除/取消 |
| 工作区 QA-TEMP / 模板 QA-TEMP-template | 配置与临时目录 | 已通过 UI 删除并清理 `/tmp/qa` |
| 渠道 `同步`（sync-current） | 按设计写入 Codex 原生渠道配置 | **未回滚**（同步为幂等操作，本轮未备份原生配置） |
| 日志 `清空` | 无（接口 404） | 无变化 |
| 搜索/筛选/分页/导出 | 只读 | — |

---

## 5. 用例执行明细

> 说明：`实际` 列只记录本轮观察到的结果；未执行的破坏性步骤显式标记 BLOCKED。

### 5.1 全局布局、导航与抽屉

| ID | 优先级 | 场景与步骤 | 预期 | 实际 | 状态 |
|---|---|---|---|---|---|
| G-01 | P1 | 点击 Logo | 回到 `/` | 路由进入 Home | PASS |
| G-02 | P1 | 点击 `Home` | 进入 `/` | 正常 | PASS |
| G-03 | P1 | 点击平台导航 `Codex` / `OMP` / `DSH` | 进入 `/cli/{platform}`，列表数量正确 | 48/14/14 计数与接口一致 | PASS |
| G-04 | P1 | 点击 `Analytics` | 进入 `/analytics` 并加载图表 | 正常 | PASS |
| G-05 | P2 | 访问 `/codex`、`/omp/sessions/dsh` | 旧路由 301/前端重定向到新路由 | `/cli/codex`、`/cli/omp/sessions/dsh` | PASS |
| G-06 | P2 | 访问未启用平台 `/claude` 或未知路径 | 回首页 | `/claude` → `/`；`/nope` → `/` | PASS |
| G-07 | P1 | 连续快速切换主题 light → dark → light，并刷新 | `data-theme`、localStorage、`ui-config.theme` 最终一致且持久 | 出现服务端与本地不一致，刷新后 UI 被服务端值覆盖（D-17） | FAIL |
| G-08 | P2 | 点击收藏图标 | 抽屉打开，0 收藏时显示空状态 | 抽屉只有标题，内容完全空白（D-06） | FAIL |
| G-09 | P2 | 点击工作区图标 | 打开工作区抽屉 | 正常 | PASS |
| G-10 | P2 | 点击 Prompts 图标 | 打开 Prompts 抽屉 | 正常（14 个预设） | PASS |
| G-11 | P1 | 点击 MCP 图标 | 打开服务器列表 | 正常（24 个服务器） | PASS |
| G-12 | P2 | 点击设置图标 | 打开设置抽屉（5 个分区） | 正常 | PASS |
| G-13 | P2 | 点击 ⋯ 更多工具 | 菜单显示 4/5 项，平台差异正确 | Codex 无“CLI 请求转换”；OMP 有 | PASS |
| G-14 | P3 | 检查 Header 图标按钮可访问性 | 每个按钮有 `aria-label` | 7 个按钮均无 `aria-label`，仅 tooltip（D-18） | FAIL |
| G-15 | P3 | 环境变量冲突提示 | 无冲突时隐藏 | 本轮无冲突，入口未出现 | N/A |

### 5.2 首页仪表盘（平台列）

| ID | 优先级 | 场景与步骤 | 预期 | 实际 | 状态 |
|---|---|---|---|---|---|
| H-01 | P1 | 加载 Home | 渲染 3 个启用平台列，顺序与配置一致 | Codex/OMP/DSH 正常渲染 | PASS |
| H-02 | P1 | 点击 Codex 列的代理开关（启动） | 状态变为运行中、显示端口、`POST /proxy/start` | `已运行 2秒 / 运行中 / 端口 20089`，POST 200 | PASS |
| H-03 | P1 | 再次点击（停止） | 状态回到已停止、`POST /proxy/stop` | `已停止`，POST 200 | PASS |
| H-04 | P2 | 点击“N个渠道已启用” | 弹出渠道快捷面板（名称/请求/Tokens/权重/并发/开关） | 15 个渠道正常渲染 | PASS |
| H-05 | P2 | 在快捷面板启用一个关闭渠道，再关闭 | 开关立即变化、`PUT /channels/:id` 200；状态可恢复 | 88code off→on→off，均成功 | PASS |
| H-06 | P2 | 点击列锁定按钮（锁定→解锁） | 图标/标题变化，`ui-config.channelLocks` 持久化 | 锁定后 `codex:true`，解锁恢复 `false` | PASS |
| H-07 | P2 | 拖拽列手柄改变顺序 | 顺序变化并持久化，导航顺序同步 | 拖拽后 `enabledCliPlatforms` 变化；已拖回 | PASS |
| H-08 | P2 | 点击“项目”快速访问 | 进入 `/cli/{platform}` | 正常 | PASS |
| H-09 | P2 | 点击“最新对话” | 打开平台最新会话抽屉 | Codex 抽屉显示会话列表 | PASS |
| H-10 | P2 | 点击“前往” | 进入平台项目页 | 正常跳转 | PASS |
| H-11 | P3 | 点击“清空日志”（列内） | 本地日志清空 | 本地状态清空（该按钮不发请求） | PASS |
| H-12 | P2 | 观察实时日志表头与行 | 渠道/请求/回复/推理/缓存/总计/时间，持续更新 | OMP 列实时追加行 | PASS |
| H-13 | P2 | 今日数据卡片 | 请求/总 Tokens/成本与统计接口一致 | OMP 1,138 / 274.5M / $1.663 | PASS |
| H-14 | P3 | 检查列资源快捷按钮 | 仅渲染平台支持的资源 | DSH 无 Commands，符合 manifest | PASS |

### 5.3 项目列表

| ID | 优先级 | 场景与步骤 | 预期 | 实际 | 状态 |
|---|---|---|---|---|---|
| P-01 | P1 | 打开 `/cli/codex` | 渲染项目卡片、总数、会话数与路径 | “共 48 个”，渲染 20 张卡片 | PASS |
| P-02 | P1 | 搜索 `coding-tool-x` | 请求带 `q`，列表过滤/空状态 | 请求 `?q=...`，0 条并显示空状态 | PASS |
| P-03 | P2 | 清空搜索 | 恢复完整列表 | 恢复 20 张卡片 | PASS |
| P-04 | P2 | 点击 `新建项目` | 按产品设计复制基础启动命令 | 剪贴板 `codex`，toast “基础启动命令已复制到剪贴板”（D-21） | PASS |
| P-05 | P1 | 点击项目卡片 | 进入 `/cli/{platform}/sessions/{project}` | 正常；会话数与项目一致 | PASS |
| P-06 | P2 | 悬停卡片 → 删除图标 | 弹出确认框，包含路径/会话数/不可恢复提示 | 确认框正常；已取消，无 DELETE | PASS |
| P-07 | P1 | 滚动到底部 / 查找分页 | 可访问第 21–48 个项目 | 始终只有 20 个；页面无分页器或“加载更多”（D-03） | FAIL |
| P-08 | P1 | 直接用 `?page=2` 请求接口 | 第二页 20 条可用 | 接口返回 20 条，但 UI 无入口 | PASS |
| P-09 | P3 | 只读项目 | 不显示删除按钮 | 只读项目无删除按钮 | N/A |
| P-10 | P3 | 页面标题与项目总数 | 与接口 `pagination.total` 一致 | 标题 48，列表 20，不一致 | FAIL |

### 5.4 会话列表

| ID | 优先级 | 场景与步骤 | 预期 | 实际 | 状态 |
|---|---|---|---|---|---|
| S-01 | P1 | 打开 `/cli/omp/sessions/tmp` | 会话列表、项目路径、总大小 | 20 条/页，标题 `(36 个对话)`，15.3 MB | PASS |
| S-02 | P1 | 点击分页第 2 页 | 显示剩余 16 条 | 20 → 16 | PASS |
| S-03 | P1 | 输入关键词按 Enter/点击搜索 | 打开“搜索结果”弹窗，显示匹配数/上下文 | 弹窗与请求正常；仅存在于系统上下文的关键词返回 0（是否应排除系统消息未定义） | PASS |
| S-04 | P2 | 设置别名 → 保存 → 清空 → 保存 | 保存/删除别名并刷新列表 | `POST /api/aliases`、`DELETE /api/aliases/:id`，toast 正确 | PASS |
| S-05 | P2 | 点击收藏 → 再点“已收藏” | 状态切换并持久化 | `POST /api/favorites`、`DELETE /api/favorites/...` | PASS |
| S-06 | P2 | 点击 `使用对话` | 复制 `cd ... && {cli} resume ...` | 剪贴板内容正确，toast 正确 | PASS |
| S-07 | P2 | 点击 `Fork` | 打开配置弹窗（保留轮次/别名/确认） | 正常；已取消，无新会话 | PASS |
| S-08 | P2 | 点击 `删除` | 不可恢复确认框 | 正常；已取消，无 DELETE | PASS |
| S-09 | P2 | 点击 `管理` | 进入多选模式，显示批量删除/完成 | 正常；已退出，未批量删除 | PASS |
| S-10 | P2 | 点击会话条目 | 打开 ChatHistoryDrawer，加载消息 | 打开成功，目录/消息列表正常 | PASS |
| S-11 | P2 | ChatHistory 内“加载更早的消息” | 追加历史消息 | 消息节点 122 → 242 | PASS |
| S-12 | P2 | 点击 `项目配置` → 项目指令 / Skills / MCP | 抽屉显示目标文件与对应内容 | `AGENTS.md`、63 技能、`.codex/config.toml` | PASS |
| S-13 | P1 | 批量删除所选会话 | 确认后删除并刷新 | **BLOCKED**：会删除真实会话，仅验证到选择/按钮启用 | BLOCKED |

### 5.5 工作区

| ID | 优先级 | 场景与步骤 | 预期 | 实际 | 状态 |
|---|---|---|---|---|---|
| W-01 | P2 | 打开 `/workspaces`（空） | 空状态 + “创建第一个工作区” | 正常 | PASS |
| W-02 | P2 | 打开创建弹窗，空表单提交 | 名称/项目必填提示，无请求 | 提示正确，但额外弹出“创建失败”toast（D-10） | FAIL |
| W-03 | P2 | 名称输入非法字符 | 字符集校验提示 | `名称只能包含字母、数字、下划线、中划线和中文` | PASS |
| W-04 | P2 | 创建 QA-TEMP 工作区（含 1 个项目） | 创建成功、列表刷新、toast | `POST /api/workspaces` 200，卡片出现 | PASS |
| W-05 | P2 | 重复名称创建 | 明确报错，弹窗保持打开 | 500 `目录已存在: ...` 并 toast | PASS |
| W-06 | P2 | 打开详情 → 添加仓库（空路径） | 校验 `请填写项目路径` | 校验正确，无请求 | PASS |
| W-07 | P2 | 详情 → 移除仓库 → 取消 | 二次确认，取消后保留 | 正常 | PASS |
| W-08 | P2 | 卡片删除 → 取消 → 再删除 | 确认框；删除后列表/磁盘处理正确 | 取消保留；删除 200，列表清空；临时目录已清理 | PASS |
| W-09 | P3 | 详情内 4 个 CLI 启动按钮 | 复制对应启动命令 | Claude/Codex/Gemini/OMP 均 toast “启动命令已复制到剪贴板” | PASS |

### 5.6 配置模板与导入/导出

| ID | 优先级 | 场景与步骤 | 预期 | 实际 | 状态 |
|---|---|---|---|---|---|
| T-01 | P2 | 打开 `/config-templates`（空） | 空状态与创建入口 | 正常 | PASS |
| T-02 | P3 | 搜索 `zzz` | 空结果状态 | 正常 | PASS |
| T-03 | P2 | CLI 筛选 | 全部/Claude/Codex/OpenCode/OMP/Gemini/DSH | 选项齐全，筛选生效 | PASS |
| T-04 | P2 | 创建模板，空表单提交 | 名称/CLI 必填 | 两条内联校验，无请求 | PASS |
| T-05 | P2 | 选择 Claude 后填写并创建 | 创建成功并刷新 | `POST` 200，卡片出现 | PASS |
| T-06 | P2 | 卡片预览 → 关闭 | 预览内容、关闭不改变数据 | 正常 | PASS |
| T-07 | P2 | 点击 `应用` | 应用弹窗，目标路径为空时按钮禁用 | 正常；已取消，无 apply 请求 | PASS |
| T-08 | P2 | 仅资源内容（关闭 `启用 CLAUDE.md`）的模板点击应用 | 可应用，或明确说明为何禁用 | 预览/确认永久禁用且无任何提示（D-08） | FAIL |
| T-09 | P2 | 卡片编辑 → 取消；删除 → 取消 | 预填、取消无副作用 | 正常 | PASS |
| T-10 | P2 | 更多工具 → 配置模板 | 打开模板抽屉 | 正常 | PASS |
| T-11 | P2 | 更多工具 → 配置导入/导出 → 导出配置 | 触发 ZIP 下载请求 | `GET /api/config-export` 200，38.1 MB；无 toast/完成提示（UX 建议） | PASS |
| T-12 | P2 | 导入配置（选择文件） | 走导入向导，有校验/回滚 | **BLOCKED**：原生文件选择器 + 写配置，未执行 | BLOCKED |

### 5.7 Skills

| ID | 优先级 | 场景与步骤 | 预期 | 实际 | 状态 |
|---|---|---|---|---|---|
| SK-01 | P1 | 直接打开 `/skills` | 对已启用平台显示列表；或提供平台选择 | 默认 Claude Code → 空状态且无任何操作按钮（D-07） | FAIL |
| SK-02 | P1 | 打开 `/skills?platform=omp` | 统计与列表一致 | 108 / 98 / 10 | PASS |
| SK-03 | P2 | 搜索 `analy` / 无结果关键词 | 过滤与空状态 | 4 条；`没有匹配的技能` | PASS |
| SK-04 | P2 | 状态筛选 | 全部/已启用/已关闭/待审批 | 108 / 98 / 10 / 10 | PASS |
| SK-05 | P2 | 创建弹窗空提交 | 目录名/内容必填 | 校验正确，无请求 | PASS |
| SK-06 | P2 | 高级模式上传区 | 提示必须包含 `SKILL.md` | 正常 | PASS |
| SK-07 | P2 | 打开卡片详情 → 内容标签 | 详情异步加载、Markdown 渲染 | `GET /api/skills/detail/...` 200 | PASS |
| SK-08 | P2 | 详情 `复制路径` / `复制内容` | 剪贴板 + toast | toast 正确 | PASS |
| SK-09 | P3 | 技能开关（不支持安全投影） | 控件禁用或明确说明 | 可点击，`PUT /toggle` 200 但 `unsupported`，仅 toast（D-11） | FAIL |
| SK-10 | P3 | 108 条列表性能与分页 | 分页或虚拟滚动 | 无分页，全量 DOM | FAIL |
| SK-11 | P2 | 仓库管理：添加禁用/推荐仓库/关闭 | 空输入禁用；推荐项去重 | 正常；未提交 | PASS |
| SK-12 | P2 | OMP 技能设置 | 扫描源开关可读，取消无副作用 | 4 个开关正常 | PASS |
| SK-13 | P2 | `审批` / `关闭此技能` | 持久化并可撤销 | **BLOCKED**：无撤销入口，避免污染真实技能 | BLOCKED |
| SK-14 | P3 | 导入按钮 | 可用或隐藏 | 永久禁用（仅 claude 可用，而 claude 未启用）（D-12） | FAIL |

### 5.8 Plugins

| ID | 优先级 | 场景与步骤 | 预期 | 实际 | 状态 |
|---|---|---|---|---|---|
| PL-01 | P1 | 直接打开 `/plugins` | 显示已启用平台插件或平台选择 | 默认 Claude Code → 空状态、无按钮（D-07） | FAIL |
| PL-02 | P1 | 打开 `/plugins?platform=omp` | 统计/列表/市场数据一致 | 全部 5 / 已安装 5 / 可安装 0 | PASS |
| PL-03 | P2 | 搜索 `orca` / 无结果 | 过滤与空状态 | 3 条；`没有匹配的插件` | PASS |
| PL-04 | P2 | 筛选 全部/已安装/未安装 | 数量与空状态正确 | 5/5/0 | PASS |
| PL-05 | P2 | 打开插件详情 → README | 详情与 README 加载 | `GET .../readme` 200；无 README 时显示空状态 | PASS |
| PL-06 | P2 | `复制路径` | 剪贴板 + toast | 正常 | PASS |
| PL-07 | P2 | `安装` / `卸载` | 二次确认后执行并可回滚 | **BLOCKED**：市场为空/已安装，卸载会改真实环境 | BLOCKED |
| PL-08 | P2 | 仓库管理：空输入禁用、输入启用、关闭 | 无提交副作用 | 正常；未提交 | PASS |
| PL-09 | P3 | DSH 192 个插件列表 | 分页或虚拟滚动 | 全量渲染，无分页（D-13） | FAIL |
| PL-10 | P3 | 外置插件安装行 | 缺 profile/spec 时禁用 | 正确禁用 | PASS |
| PL-11 | P3 | 插件启用/禁用 | 存在开关 | 本构建无该控件 | N/A |

### 5.9 MCP

| ID | 优先级 | 场景与步骤 | 预期 | 实际 | 状态 |
|---|---|---|---|---|---|
| M-01 | P1 | 打开 MCP 抽屉 | 24 个服务器，计数与平台标记 | 正常 | PASS |
| M-02 | P1 | 点击任意服务器卡片 | 打开详情抽屉（概览/工具列表） | 无任何响应，抽屉数保持 1（D-02） | FAIL |
| M-03 | P1 | 详情内 `工具列表` | 工具列表渲染 | 不可达 | BLOCKED |
| M-04 | P1 | 工具卡片 `测试工具` → 执行/关闭 | 参数表单 + 执行结果 | 不可达 | BLOCKED |
| M-05 | P2 | `添加` → 空表单提交 | `请输入服务器 ID` | 正确，无请求 | PASS |
| M-06 | P2 | 重复 ID `fetch` | 内联“该 ID 已存在” + toast | 正确 | PASS |
| M-07 | P2 | 添加表单取消 | 关闭、列表不变 | 正常 | PASS |
| M-08 | P2 | `粘贴解析` / `导出` 入口 | 可见、可打开 | 正常 | PASS |
| M-09 | P3 | 搜索服务器 | 有搜索控件 | 本构建无搜索 | N/A |

### 5.10 Prompts

| ID | 优先级 | 场景与步骤 | 预期 | 实际 | 状态 |
|---|---|---|---|---|---|
| PR-01 | P2 | 打开 Prompts 抽屉 | 14 个预设，激活项标识 | 正常（自定义 11 / 内置 3） | PASS |
| PR-02 | P2 | `新建` 空提交 | 预设 ID/名称必填 | 内联校验 | PASS |
| PR-03 | P2 | 重复 ID `default` | 拒绝并提示 | `该 ID 已被使用` | PASS |
| PR-04 | P2 | 编辑已有预设 | 表单预填，取消不保存 | 正常 | PASS |
| PR-05 | P3 | 预设卡片预览 | 内容内联预览 | 正常（按设计无独立详情抽屉） | PASS |
| PR-06 | P2 | 保存/删除预设 | 持久化/确认 | **BLOCKED**：会修改真实预设库 | BLOCKED |

### 5.11 Commands / Agents

| ID | 优先级 | 场景与步骤 | 预期 | 实际 | 状态 |
|---|---|---|---|---|---|
| CA-01 | P2 | 首页 Codex `Commands 命令管理` | 抽屉打开，空状态 | 全部 0，空状态正确 | PASS |
| CA-02 | P2 | OMP 命令列表 + 搜索 | 1 条 `/review`，搜索过滤 | 正常 | PASS |
| CA-03 | P2 | 命令详情 | 概览/内容标签、平台 pill、路径 | 正常 | PASS |
| CA-04 | P2 | 创建命令空提交 | 命令名必填 | `请输入命令名` | PASS |
| CA-05 | P2 | Codex `Agents 代理管理` | 22 条，搜索生效 | `code` → 2 条 | PASS |
| CA-06 | P2 | 创建代理空提交 | 文件名/描述必填 | 校验正确 | PASS |
| CA-07 | P2 | 代理详情 | 概览/配置标签、平台上下文 | 正常 | PASS |
| CA-08 | P2 | DSH `Agent 预设管理` → 新建预设空 ID 保存 | 客户端必填校验 | 直接发请求并返回 500 原始错误（D-14） | FAIL |
| CA-09 | P2 | 创建/保存/删除命令与代理 | 持久化并可回滚 | **BLOCKED**：会写入真实资源目录 | BLOCKED |
| CA-10 | P3 | 抽屉头部平台标识 | 显示来源平台 | 顶层抽屉只有“技能/命令/代理管理”，无平台名（D-15） | FAIL |

### 5.12 渠道与代理

| ID | 优先级 | 场景与步骤 | 预期 | 实际 | 状态 |
|---|---|---|---|---|---|
| CH-01 | P1 | 右侧渠道面板加载 | 渠道名称/Provider/Auth/URL/Key/权重/并发 | 正常 | PASS |
| CH-02 | P2 | 渠道开关（快捷面板） | 状态持久化、排序更新 | 88code on→off 均 200 | PASS |
| CH-03 | P2 | `测速` | 展示延迟/HTTP 状态/错误原因 | `2733ms HTTP 404` 明确显示 | PASS |
| CH-04 | P2 | `编辑` → 清空渠道名称 → 保存 | 阻止提交，内联+toast 提示 | `渠道名称不能为空`，无 PUT | PASS |
| CH-05 | P2 | `添加` → 空表单提交 | 必填校验 | `API Key不能为空`，无 POST | PASS |
| CH-06 | P2 | `删除` | 二次确认 | `删除 Codex 渠道 / 确定要删除这个渠道吗？`；已取消 | PASS |
| CH-07 | P2 | `重置状态` | 重置健康标记并提示 | toast `渠道健康状态已重置`，POST 200 | PASS |
| CH-08 | P2 | `同步` | 应有确认与结果反馈 | 直接 `POST /channels/sync-current` 200，无确认、无成功提示（D-09） | FAIL |
| CH-09 | P2 | `写入配置` | 二次确认 + 备份/回滚 | **BLOCKED**：会覆盖原生 CLI 配置 | BLOCKED |
| CH-10 | P3 | `前往官网` | 新标签打开渠道官网 | **BLOCKED**：外链跳转，未执行 | BLOCKED |
| CH-11 | P1 | 代理开关（首页/右栏） | start/stop API 与状态一致 | 已验证 Codex start/stop | PASS |
| CH-12 | P1 | 实时日志 `清空` | 清空日志并有反馈 | `POST /api/proxy/logs/clear` → **404**，无任何反馈（D-04） | FAIL |
| CH-13 | P2 | 渠道余额显示 | 与渠道配置一致 | `余额 $9298.17` 正常 | PASS |
| CH-14 | P2 | 模型重定向编辑器 | 可添加/删除规则并有说明 | 可添加规则行（未保存） | PASS |

### 5.13 用量分析（Analytics）

| ID | 优先级 | 场景与步骤 | 预期 | 实际 | 状态 |
|---|---|---|---|---|---|
| A-01 | P1 | 打开 `/analytics` | 汇总卡、分布图、累计趋势、筛选器 | 正常加载 | PASS |
| A-02 | P1 | 切换 1d/7d/30d/90d | 数据随范围变化，且单调 | 7d 2.33B、30d 178.24B、90d 178.34B | PASS |
| A-03 | P1 | 切换 3d | 3d 总量 ≤ 7d 总量 | 3d 显示 **2.69B** > 7d 2.33B（D-01） | FAIL |
| A-04 | P1 | 对比日/小时聚合 | `sum(hour buckets) == day total` | 1d: 294,179,840 vs 271,881,944；3d: 2,689,345,273 vs 1,437,844,075（D-01） | FAIL |
| A-05 | P2 | 自定义时间范围：选 2026-11-10 ~ 11-15 | 选择后立即按范围查询并更新 | 日期已填入，但**无任何新请求**，汇总/图表仍为 7d（D-05） | FAIL |
| A-06 | P2 | 未来日期 | 禁用不可选 | `is-date-disabled` 已传入，但自动化点击仍可写入未来日期（低置信，见风险） | BLOCKED |
| A-07 | P1 | 工具筛选（omp） | 只保留 omp，总量 ≤ 未过滤 | 界面切换成功，但 omp 总量 3.38B > 未过滤 2.33B（D-01） | FAIL |
| A-08 | P1 | 渠道/模型筛选 | 同上 | 渠道 3.38B、模型 3.46B，均大于未过滤 | FAIL |
| A-09 | P2 | 指标切换 Token/费用/请求 | 汇总不变，图表与累计标题切换 | 正常 | PASS |
| A-10 | P2 | 柱状图/折线图切换 | 图表类型切换 | 正常 | PASS |
| A-11 | P2 | 全屏/退出全屏 | 图表区域全屏并可退出 | 正常 | PASS |
| A-12 | P2 | 导出 CSV/JSON | 下拉菜单、URL 参数正确、文件可下载 | 菜单与 URL 正确；headless 阻止弹窗，接口 `Content-Disposition` 正常（下载文件未落地） | PASS |
| A-13 | P2 | 清除筛选 | 清空选择并恢复全量 | 清除图标存在；未逐项执行 | N/A |

### 5.14 设置

| ID | 优先级 | 场景与步骤 | 预期 | 实际 | 状态 |
|---|---|---|---|---|---|
| SET-01 | P2 | 打开设置 | 5 个分区：外观/通知/高级/安全/模型 | 正常 | PASS |
| SET-02 | P2 | 外观：渠道列表/实时日志/余额开关 | 即时保存并可恢复 | `PUT /ui-config/...` 均成功，已恢复 | PASS |
| SET-03 | P2 | 首页 CLI 显示：修改后保存再恢复 | 保存成功、导航同步 | `POST /ui-config` 保存/恢复 | PASS |
| SET-04 | P2 | 主题：亮/暗 + 刷新 | 持久化 | 正常；快速连点有竞态（D-17） | PASS |
| SET-05 | P2 | 通知：开关/单选/添加-删除远程渠道 | 本地状态正确，取消不保存 | 正常；保存/测试未执行 | PASS |
| SET-06 | P2 | 通知：保存/测试 | 写 hooks 配置/请求外部服务 | **BLOCKED**：无凭据，外部副作用 | BLOCKED |
| SET-07 | P2 | 高级：端口输入 80/70000 | 钳制到 1024/65535 | 正确钳制 | PASS |
| SET-08 | P2 | 高级：日志保留 10、统计间隔 1000、原生日志 100 | 钳制到 50/300/60 | 正确 | PASS |
| SET-09 | P2 | 高级：保存端口配置（临时改再恢复） | 保存成功，提示需重启 | 两次 POST，已恢复原值 | PASS |
| SET-10 | P3 | 开机自启 | 仅展示，不修改 OS | 正确显示“未启用”；未执行 | BLOCKED |
| SET-11 | P2 | 安全：短密码/不一致密码 | 校验错误，保存禁用 | 正确 | PASS |
| SET-12 | P2 | 启用/解锁密码 | 设置后重进面板需验证 | **BLOCKED**：有锁死风险 | BLOCKED |
| SET-13 | P2 | 模型：搜索/平台筛选/新增重复校验 | 过滤正确、重复拒绝 | 192 → 5；`模型已存在` | PASS |
| SET-14 | P2 | 模型：修改字段后改回原值 | 保存按钮回到禁用 | 仍保持可用（D-16） | FAIL |
| SET-15 | P3 | 模型：空字段 placeholder | 中文或留空 | 英文 `Please Input`（D-16） | FAIL |
| SET-16 | P2 | CLI 请求转换（OMP） | 打开抽屉、来源选项、填充示例 | 正常；目标 API 缺省导致转换禁用 | PASS |
| SET-17 | P3 | CLI 请求转换（Codex） | 菜单不出现该项 | 正确 | PASS |

### 5.15 接口契约、安全与边界

| ID | 优先级 | 场景与步骤 | 预期 | 实际 | 状态 |
|---|---|---|---|---|---|
| API-01 | P1 | `GET /api/does-not-exist` | JSON 404 | **200 text/html**（SPA 兜底）（D-19） | FAIL |
| API-02 | P1 | `GET /api/settings` | JSON 404（不存在） | 200 text/html | FAIL |
| API-03 | P2 | 非法日期 `startDate=bad` | 400 JSON | 400 `Invalid date format...` | PASS |
| API-04 | P2 | `startDate > endDate` | 400 JSON | 400 `endDate must be >= startDate` | PASS |
| API-05 | P2 | 范围 > 365 天 | 400 JSON | 400 `Date range cannot exceed 365 days` | PASS |
| API-06 | P2 | `granularity=hour` 且 > 7 天 | 400 JSON | 400 | PASS |
| API-07 | P2 | 未知平台 `/api/platforms/nope/projects` | JSON 404 | `404 application/json` | PASS |
| API-08 | P1 | 跨站写 UI 配置（`Origin: https://evil.example`） | 403 | 403 `CROSS_ORIGIN_REQUEST_BLOCKED` | PASS |
| API-09 | P1 | 路径穿越 `sessions/../../../etc/passwd` | 拒绝（400/404），不读文件 | 编码路径返回空会话 JSON；未读取文件 | PASS |
| API-10 | P2 | 项目路径穿越 | 404/400 | 返回 SPA HTML 200（同 D-19） | FAIL |
| API-11 | P2 | 别名存储 XSS 载荷 | 原样存储、渲染转义 | 存储原样；Vue 插值转义（未执行浏览器弹窗） | PASS |
| API-12 | P2 | `GET /api/aliases` | 返回别名列表 | 返回 SPA HTML（接口未实现）（D-20） | FAIL |
| API-13 | P3 | 超大请求体（>100 MB） | 413 | **BLOCKED**：避免资源占用 | BLOCKED |
| API-14 | P3 | 并发重复写（双击开关） | 幂等或最后一次生效 | 未专项压测 | N/A |

---

## 6. 缺陷清单

### D-01 [P1] Analytics 过滤/小时聚合导致总量错误且跨范围不可比

**模块**：用量分析 / 统计服务  
**复现**：

```bash
# 7 天未过滤
curl -s "http://localhost:19999/api/statistics/trend?startDate=2026-11-14&endDate=2026-11-20&granularity=day&step=1&groupBy=model&metric=tokens"
# 7 天 filterToolType=omp
curl -s "http://localhost:19999/api/statistics/trend?startDate=2026-11-14&endDate=2026-11-20&granularity=day&step=1&groupBy=model&metric=tokens&filterToolType=omp"
# 3 天 day 与 hour(step=12)
curl -s "http://localhost:19999/api/statistics/trend?startDate=2026-11-18&endDate=2026-11-20&granularity=day..."
curl -s "http://localhost:19999/api/statistics/trend?startDate=2026-11-18&endDate=2026-11-20&granularity=hour&step=12..."
```

**实测**：

| 查询 | tokens 合计 |
|---|---|
| 7d 未过滤（day） | 2,328,977,014 |
| 7d `filterToolType=omp` | 3,383,924,064 |
| 7d `filterChannel=sang for` | 3,383,924,064 |
| 7d `filterModel=deepseek-flash` | 3,460,491,960 |
| 3d（day） | 1,437,844,075 |
| 3d（hour, step=12） | 2,689,345,273 |
| 1d（day） | 271,881,944 |
| 1d（hour, step=4） | 294,179,840 |

单日亦不一致：2026-11-18 day=679,883,162 / hour=1,410,935,423；11-19 day=486,735,809 / hour=984,230,010；11-17 两者相等（666,922,077）。

**预期**：过滤结果是未过滤的子集；任意粒度 bucket 求和等于区间总量；1d ≤ 3d ≤ 7d ≤ 30d。  
**实际**：过滤后反而更大；3d 总量大于 7d。  
**初步定位（推断，未改代码）**：日粒度未过滤走 `mergeAllToolsDailyStats` 的日聚合文件，过滤走 `readJsonlForDay` 原始 JSONL，小时粒度优先 `proxy-logs`，三套数据源的去重/覆盖范围不同。  
**建议**：统一单一数据源与去重键（request id），为聚合层增加不变量测试；在 UI 上对“部分数据/估算”给出标识。

### D-02 [P1] MCP 服务器卡片点击无响应，详情/工具/测试不可达

**复现**：Header → MCP 服务器管理 → 点击任意服务器卡片（如 `fetch`）或服务器名。  
**预期**：打开详情抽屉，展示概览、工具列表、工具测试。  
**实际**：DOM 点击与真实鼠标点击均无响应，抽屉数保持 1，控制台无错误；`src/web/src/components/McpServerDetailDrawer.vue` 存在且模板绑定了 `@click="openServerDetail(server)"`，说明**源码绑定与线上行为不一致**，需定位是构建产物、组件挂载还是运行时异常（未捕获到报错）。  
**证据**：`docs/qa/evidence/mcp-server-card-no-detail.png`  
**建议**：重新构建并校验 `dist` 包含详情组件；为卡片点击加 E2E 断言（详情标题/工具列表可见）。

### D-03 [P1] 项目列表缺少分页/加载更多，21 条以后不可达

**复现**：`/cli/codex`（48 个项目）→ 滚动到底部。  
**预期**：分页器或无限滚动，可访问全部 48 个。  
**实际**：只渲染 20 个；标题显示“共 48 个”；接口 `pagination.hasMore=true`，但页面无分页控件；`.content` 滚动到底不触发加载。  
**证据**：接口证据 `returned=20,total=48,hasMore=true`；`ProjectList.vue` 无 `n-pagination`（SessionList 有）。  
**建议**：复用 SessionList 分页组件；或按后端 `hasMore` 做滚动加载。

### D-04 [P1] “清空实时日志”调用不存在的接口，全部平台 404

**复现**：任一平台页右侧面板 → 实时日志 → `清空`。  
**预期**：清空服务端/本地日志并提示。  
**实际**：`POST /api/proxy/logs/clear` → 404，无 toast；`GET /api/proxy/logs` 200（根别名），平台级 `/api/{platform}/proxy/logs` 与 `/api/platforms/{platform}/proxy/logs` 均 200，唯独 clear 未注册。  
**证据**：网络日志 `POST 404 /api/proxy/logs/clear`。  
**建议**：注册平台级 clear 路由并让前端使用 `callPlatformRoute`；补 404 兜底提示。

### D-05 [P2]（已判定误报）自定义时间范围不触发查询

**复现**：`/analytics` → `自定义` → 选择 2026-11-10 ~ 2026-11-15。  
**预期**：日期变化后立即请求并更新汇总/图表。  
**实际**：输入框显示 11-10 / 11-15，但网络无 `/trend` 请求，汇总仍为 7d（2.33B）。模板使用 `:on-update:value="onCustomRangeChange"`（作为属性传入），而不是 `@update:value`。  
**建议**：改为事件绑定（保留 `v-model:value` 时避免重复），并加 E2E 断言：改日期后请求参数含所选范围。

### D-06 [P2] 收藏抽屉在 0 条时完全空白

**复现**：Header → 收藏（0）。  
**预期**：空状态文案（如“暂无收藏”）。  
**实际**：抽屉只有标题；`FavoritesDrawer.vue` 模板按 `totalCount` 判断，但未定义该变量（`undefined === 0` 为 false）。  
**证据**：`docs/qa/evidence/favorites-empty-blank.png`  
**建议**：改为 `totalFavorites`/`favorites.length` 或补空状态。

### D-07 [P2] `/skills`、`/plugins` 无 platform 参数时回落未启用平台

**复现**：直接打开 `/skills` 或 `/plugins`。  
**预期**：默认到首个启用平台或提供平台选择。  
**实际**：回落 `claude`（未启用），显示“Claude Code 暂未提供…”，无任何操作按钮；本环境启用平台为 codex/omp/dsh。  
**证据**：`docs/qa/evidence/skills-default-unsupported.png`  
**建议**：用 `enabledCliPlatforms[0]` 作为默认，或路由 guard 补 `?platform=`。

### D-08 [P2] 资源型配置模板“确认应用”永久禁用且无解释

**复现**：创建模板时关闭 `启用 CLAUDE.md`（仅保留 Skills/Agents/Commands）→ 应用。  
**预期**：可应用，或明确提示禁用原因。  
**实际**：`aiConfigTypes=[]` 导致预览/确认均禁用，无提示。  
**证据**：`docs/qa/evidence/config-template-apply-disabled.png`  
**建议**：允许仅资源配置的应用，或在弹窗内展示禁用原因与所需条件。

### D-09 [P2] 渠道“同步”直接写入无确认、无结果反馈

**复现**：渠道面板 → `同步`。  
**预期**：二次确认（或至少明确操作范围）+ 成功/失败提示。  
**实际**：直接 `POST /api/platforms/codex/channels/sync-current` 200，无确认、无 toast；该操作会写入原生 CLI 配置。  
**建议**：与“写入配置”统一确认与结果反馈；提供备份/回滚提示。

### D-10 [P3] 工作区空表单校验额外弹出“创建失败”错误 toast

**复现**：`/workspaces` → 创建 → 空表单提交。  
**预期**：仅内联必填提示。  
**实际**：内联提示正确，同时出现错误 toast `创建失败`。  
**证据**：`docs/qa/evidence/workspace-validation-extra-toast.png`  
**建议**：`formRef.validate()` 失败分支不要落入提交异常 catch。

### D-11 [P3] 不支持安全投影的技能仍可点击开关

**复现**：`/skills?platform=omp` → 点击任意技能开关。  
**预期**：禁用或标注“不支持投影”。  
**实际**：`PUT /api/skills/toggle` 200 但返回 `unsupported`，仅 toast，卡片不变；投影为 `null` 时绕过守卫。  
**建议**：以 `projection` 缺失也视为不可切换，并禁用控件。

### D-12 [P3] `导入` 技能在启用平台永久禁用

**复现**：任一启用平台的 Skills 页面查看 `导入`。  
**预期**：可用或隐藏。  
**实际**：仅 `currentPlatform === 'claude'` 可用，而 claude 未启用 → 永久禁用。  
**建议**：按能力而非平台硬编码；或隐藏入口。

### D-13 [P3] Skills/Plugins 长列表没有分页/虚拟化

**复现**：`/skills?platform=omp`（108 条）、`/plugins?platform=dsh`（192 条）。  
**预期**：分页或虚拟滚动。  
**实际**：全量 DOM 渲染，无分页器；页面文本约 32k 字符。  
**建议**：列表虚拟化或后端分页；补大列表性能基线。

### D-14 [P3] DSH 新建 Agent 预设空 ID 直接请求并返回 500

**复现**：DSH `Agents 代理管理` → 新建预设 → 空 ID 保存。  
**预期**：客户端必填校验。  
**实际**：直接 POST，toast `Request failed with status code 500`。  
**建议**：前端校验预设 ID，并把后端错误映射为可读文案。

### D-15 [P3] 资源抽屉缺少平台上下文；最新对话条目不可点击

**复现**：首页列打开 Skills/Commands/Agents 抽屉；或打开“最新对话”点击条目正文。  
**预期**：抽屉头部显示来源平台；“最新对话”条目可进入历史。  
**实际**：头部只有“技能管理/命令管理/代理管理”；最新对话仅 `别名`/`启动` 可点，条目主体无响应。  
**建议**：向抽屉传入并展示 platform pill；条目主体复用 ChatHistory 打开逻辑。

### D-16 [P3] 模型设置保存按钮状态错误 + 英文 placeholder

**复现**：设置 → 模型设置 → 展开模型 → 修改 `Context 窗口` → 改回原值。  
**预期**：`保存设置` 回到禁用。  
**实际**：仍保持启用（`modelMetaDirty` 未重算）。另：空价格字段显示 `Please Input`。  
**证据**：`docs/qa/evidence/settings-model-save-stuck.png`  
**建议**：以值比较计算 dirty；为输入补中文 placeholder。

### D-17 [P3] 主题快速切换存在写请求竞态

**复现**：快速连续点击主题按钮。  
**预期**：最终 UI、localStorage、服务端一致。  
**实际**：观察到 `PUT /theme` 顺序为 dark→light→dark，本地为 light、服务端为 dark；刷新后 UI 变暗。  
**建议**：串行化/防抖主题写入，以最后一次用户选择为准。

### D-18 [P3] Header 图标按钮无可访问名称

**复现**：检查 Header 7 个图标按钮。  
**预期**：提供 `aria-label`（与 tooltip 一致）。  
**实际**：仅 tooltip，无 `aria-label`；自动化/读屏无法按名称定位。  
**建议**：为 `HeaderButton` 增加 `aria-label` 透传。

### D-19 [P3] 未匹配的 `/api/*` 返回 SPA HTML 200

**复现**：`GET /api/does-not-exist`、`/api/settings`。  
**预期**：JSON 404。  
**实际**：200 `text/html`，返回 `index.html`；会掩盖前端路径错误并让客户端把 HTML 当数据解析。  
**建议**：为 `/api` 增加 JSON 404 兜底；前端 API 客户端检测 `content-type`。

### D-20 [P3] `GET /api/aliases` 未实现

**复现**：`GET /api/aliases`。  
**预期**：返回别名映射。  
**实际**：SPA HTML；`POST /api/aliases` 与 `DELETE /api/aliases/:id` 正常。  
**建议**：补齐读接口或明确不支持。

### D-21 [P3] “新建项目”实际只复制启动命令

**复现**：项目页点击 `新建项目`。  
**实际**：不创建项目，复制 `codex` 并 toast。  
**建议**：改名“复制启动命令”，或实现真正的项目创建弹窗。

---

## 7. 覆盖率与风险

### 7.1 覆盖情况

| 模块 | 用例数 | PASS | FAIL | BLOCKED | N/A | 备注 |
|---|---:|---:|---:|---:|---:|---|
| 全局/导航/抽屉 | 15 | 11 | 3 | 0 | 1 | 空收藏、主题竞态、图标可访问性 |
| 首页仪表盘 | 14 | 14 | 0 | 0 | 0 | 代理 start/stop、拖拽、锁定均通过 |
| 项目列表 | 10 | 7 | 2 | 0 | 1 | 分页缺失、总数不一致 |
| 会话列表 | 13 | 12 | 0 | 1 | 0 | 批量删除按安全策略阻塞 |
| 工作区 | 9 | 8 | 1 | 0 | 0 | 空表单额外错误 toast |
| 配置模板 | 12 | 10 | 1 | 1 | 0 | 资源配置模板不可应用；导入阻塞 |
| Skills | 14 | 9 | 4 | 1 | 0 | 默认平台、开关、长列表、导入 |
| Plugins | 11 | 7 | 2 | 1 | 1 | 默认平台、长列表；安装/卸载阻塞 |
| MCP | 9 | 5 | 1 | 2 | 1 | 详情链路不可达 |
| Prompts | 6 | 5 | 0 | 1 | 0 | 保存/删除阻塞 |
| Commands/Agents | 10 | 7 | 2 | 1 | 0 | DSH 预设校验缺失、平台标识缺失 |
| 渠道/代理 | 14 | 10 | 2 | 2 | 0 | 同步无确认、日志清空 404 |
| Analytics | 13 | 6 | 5 | 1 | 1 | 口径错误、自定义范围失效 |
| 设置 | 17 | 12 | 2 | 3 | 0 | 保存按钮状态、HTML 输入提示缺失 |
| 接口/安全 | 14 | 8 | 4 | 1 | 1 | JSON 404 兜底、aliases 读接口 |
| **合计** | **181** | **131** | **29** | **15** | **6** | 同一缺陷多行覆盖 |

> 分片原始报告（Skills/Plugins、Workspaces/Templates、抽屉、Settings）共 246 行，包含少量流程说明行；本表的 181 行是去重、合并后的可复用场景集。

### 7.2 未覆盖与风险

1. **破坏性链路未执行**：项目/会话/技能/插件/模板的最终删除、应用、安装/卸载、配置写入、开机自启、密码启用。需隔离环境 + 夹具。
2. **外部依赖**：通知发送、渠道余额、官网跳转、CLI 实际启动未执行。
3. **自动化环境限制**：headless 下原生下载被抑制（导出文件未落地）；日期选择器/虚拟列表需真实点击；已用 `--disable-gpu` 的 Chrome 规避渲染卡死。
4. **数据正确性风险最高**：Analytics 的三套数据源（日聚合、原始 JSONL、proxy-logs）没有一致性约束，可能影响成本核算与限流决策。
5. **构建/运行时一致性风险**：MCP 源码绑定与线上行为不一致，需要把“构建产物与源码一致”和“关键抽屉可打开”纳入发布检查。

---

## 8. 自动化与回归建议

### 8.1 必补的自动化

| 层级 | 用例 | 建议实现 |
|---|---|---|
| API 契约 | 所有 `/api/*` 未匹配返回 JSON 404 | supertest + Express app |
| API 契约 | `POST /api/{platform}/proxy/logs/clear` 存在且 200 | 路由存在性矩阵测试（遍历前端 API 模块） |
| 数据不变量 | `sum(hour buckets) == sum(day buckets)`；`filtered ≤ unfiltered`；范围单调 | `tests/statistics-invariants.test.js`（fixture JSONL） |
| E2E | 项目分页可达全部 N 条 | Playwright：断言分页器与卡片总数 |
| E2E | MCP 卡片 → 详情 → 工具列表 | Playwright：抽屉标题与工具数 |
| E2E | 自定义日期范围触发 `/trend` 且参数正确 | Playwright：`page.waitForRequest` |
| E2E | 日志清空成功提示 | Playwright：POST 200 + toast |
| E2E | 收藏空状态/最新对话可点击 | Playwright：空状态文案、抽屉标题 |
| 构建 | dist 包含全部页面组件 | 构建后资源扫描（MCP 详情关键字） |

### 8.2 回归范围（修复后）

1. Analytics 全量范围 × 粒度 × 过滤组合（至少 4 范围 × 2 粒度 × 4 过滤）。
2. MCP：列表 → 详情 → 工具列表 → 测试工具（成功/失败）。
3. 项目列表：48/14/192 条三种规模的分页与搜索。
4. 日志清空：Codex/OMP/DSH 三平台。
5. 自定义日期范围 + 未来日期禁用。
6. 收藏空/非空状态、主题快速连点。
7. `/api/*` 404 契约与前端错误提示。

### 8.3 冒烟清单（每次发布，15 分钟）

- 首页 3 列加载、代理 start/stop、渠道弹层开关。
- 项目页进入会话、会话别名/收藏/使用对话/分页。
- 渠道编辑校验、测速、重置状态。
- 工作区创建→删除、模板创建→删除。
- Skills 搜索/详情、Plugins 详情、MCP 列表。
- Analytics 7d 加载、指标切换、导出 URL。
- 设置打开/关闭、主题切换、端口钳制。

---

## 9. 发布建议

**结论：暂不通过。** 建议按以下顺序处理：

1. **P1 必修**：D-01、D-02、D-03、D-04。
2. **P2 同批修复**：D-05、D-06、D-07、D-08、D-09。
3. 补 8.1 的 API 契约与数据不变量测试，纳入 CI。
4. 隔离环境执行一次破坏性用例（删除/安装/应用/写入配置/密码）后，再给出最终发布结论。

---

## 附录 A：接口抽检结果

| 请求 | 状态 | 内容类型/结果 |
|---|---|---|
| `GET /api/does-not-exist` | 200 | `text/html`（缺陷） |
| `GET /api/settings` | 200 | `text/html`（缺陷） |
| `GET /api/platforms/nope/projects` | 404 | `application/json` |
| `GET /api/statistics/trend?startDate=bad...` | 400 | JSON 错误 |
| `GET /api/statistics/trend?...&startDate>endDate` | 400 | JSON 错误 |
| `GET /api/statistics/trend?...>365d` | 400 | JSON 错误 |
| `GET /api/statistics/trend?...hour&>7d` | 400 | JSON 错误 |
| `PUT /api/ui-config/theme` + 跨站 Origin | 403 | `CROSS_ORIGIN_REQUEST_BLOCKED` |
| `GET /api/codex/projects` | 200 | 20 条，`total=48, hasMore=true` |
| `POST /api/proxy/logs/clear` | 404 | 未注册 |
| `GET /api/config-export?format=zip` | 200 | `application/zip`，38.1 MB |
| `GET /api/statistics/trend/export?...csv` | 200 | `attachment; filename="analytics-...csv"` |

## 附录 B：证据文件

| 文件 | 内容 |
|---|---|
| `docs/qa/evidence/mcp-server-card-no-detail.png` | MCP 卡片点击后仍只有列表抽屉 |
| `docs/qa/evidence/favorites-empty-blank.png` | 0 收藏时空白抽屉 |
| `docs/qa/evidence/skills-default-unsupported.png` | `/skills` 默认未启用平台、无控件 |
| `docs/qa/evidence/config-template-apply-disabled.png` | 资源配置模板“确认应用”禁用 |
| `docs/qa/evidence/workspace-validation-extra-toast.png` | 空表单校验同时出现“创建失败” |
| `docs/qa/evidence/settings-model-save-stuck.png` | 模型设置保存按钮未复位 |

> 其余执行截图与分片原始报告位于本轮临时目录 `/tmp/qa/`（`slice-*.md`、`*-*.png`），未纳入仓库。
