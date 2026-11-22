# coding-tool-x Web UI 功能测试计划与执行报告（第三轮）

| 项目 | 内容 |
|---|---|
| 被测版本 | `3.9.16-261121` |
| 被测地址 | http://localhost:19999 |
| 测试日期 | 2026-11-21 |
| 浏览器 | Google Chrome 158（spawned headless profile），1440×900，DPR=1 |
| 测试方式 | 真实 Chromium 点击、DOM/ARIA 断言、网络请求捕获、截图；接口用 `curl` / `node fetch` 复核 |
| 用例总数 | 161 |
| 结果 | PASS 144 · FAIL 1 · BLOCKED 14 · N/A 2 |
| 结论 | **可以发布**：无 P0/P1/P2；1 项 P3 遗留（技能开关未按“无投影”禁用），2 项 UX 观察项 |

---

## 0. 执行摘要

- 覆盖 9 个路由、13 个全局抽屉/弹窗、3 个首页平台列、3 个平台项目页、会话页、工作区、配置模板、Skills、Plugins、MCP、Prompts、Commands/Agents、渠道/代理、Analytics、设置 5 分区与接口安全边界。
- 上轮 21 项缺陷：**全部关闭**（D-11 于 2026-11-22 修复，见 §10）。
- 所有页面路由冒烟 **0 控制台错误**；页面加载 2.0–2.5 s，OMP 项目页首屏 7.7 s（性能观察项）。
- 本轮未发现 P0/P1/P2 回归；数据口径、MCP 详情、项目分页、日志清空、JSON 404、主题竞态、模型设置 dirty 状态等关键修复均通过。
- 破坏性动作（真实删除、应用模板、同步/写入原生配置、启用密码、插件安装/卸载）按安全策略只验证确认框后取消，见 BLOCKED 用例。

### 0.1 主要证据

| 文件 | 内容 |
|---|---|
| `docs/qa/evidence/2026-11-21/home.webp` | 首页三列与 Header |
| `docs/qa/evidence/2026-11-21/dark.webp` | 暗色主题 |
| `docs/qa/evidence/2026-11-21/projects.webp` | Codex 项目列表与右侧渠道面板 |
| `docs/qa/evidence/2026-11-21/sessions.webp` | 会话列表与操作按钮 |
| `docs/qa/evidence/2026-11-21/skills.webp` | Skills 默认平台、分页、统计 |
| `docs/qa/evidence/2026-11-21/analytics.webp` | Analytics 7d 汇总与柱状图 |
| `docs/qa/evidence/2026-11-21/analytics-line.webp` | Analytics 费用指标 + 折线图 |

---

## 1. 测试环境与基线

### 1.1 运行时基线

| 项 | 值 |
|---|---|
| 启用平台 | `["codex","omp","dsh"]`（顺序 codex → omp → dsh） |
| 主题 | `light` |
| 平台列锁定 | 全部 `false` |
| 面板显示 | channels=true、logs=true、balance=true |
| Codex 代理 | `running=false`，默认端口 20089 |
| 项目数量 | Codex 48、OMP 14、DSH 14 |
| 会话数据 | Codex `zhangzeao` 34 条、`dsh` 1 条 |
| Codex 渠道 | 15 个，仅“家帅”启用 |
| Skills | Codex 63（57 启用 / 6 待审批）；OMP 129（6 页） |
| Plugins | OMP 5；DSH 192（8 页） |
| MCP | 24 个服务器 |
| Prompts | 14 个预设（自定义 11 / 内置 3），激活 `codex-assistant` |
| Agents | Codex 22 个 |
| 工作区 / 配置模板 | 0 / 0 |

### 1.2 数据隔离

- 临时资源统一 `QA-TEMP-*` 前缀。
- 工作区临时目录 `/tmp/QA-TEMP-WS`、项目目录 `/tmp/qa-ws-proj` 测试后清理。
- 临时提示词 `qa-temp-prompt` 已通过 UI 创建并删除。
- 渠道启用状态、主题、锁定、面板显示、平台顺序均在测试后恢复。

---

## 2. 测试范围与方法

### 2.1 范围

1. 全局导航、主题、Header 7 个图标、更多工具菜单与 13 个抽屉/弹窗。
2. 首页三平台列：锁定、代理启停、渠道快捷弹层、快捷访问、实时日志、拖拽排序。
3. 项目列表与会话列表：分页、搜索、复制命令、别名、收藏、Fork、管理、聊天记录、项目配置。
4. 工作区与配置模板完整 CRUD（临时数据）、校验、预览、应用前置条件。
5. Skills / Plugins / MCP / Prompts / Commands / Agents 的列表、分页、搜索、筛选、详情、校验。
6. 渠道面板：新增/编辑校验、测速、重置、同步确认、写入配置确认、删除确认、日志清空。
7. Analytics：范围切换、粒度一致性、过滤、指标、图表类型、全屏、导出、自定义范围。
8. 设置 5 分区：外观、通知、高级、安全、模型。
9. API 契约与安全：JSON 404、跨站写保护、参数边界、路径穿越、未知平台。

### 2.2 不在范围/安全阻塞

| 项 | 原因 |
|---|---|
| 真实删除项目/会话/渠道/技能/插件 | 会破坏真实用户数据；仅验证到确认框并取消 |
| 应用配置模板到真实项目 | 会写入项目原生配置；仅使用 /tmp 临时目录验证前置条件 |
| 渠道“同步”“写入配置”执行 | 会写入/覆盖原生 CLI 配置 |
| 启用访问密码 | 有锁死面板风险 |
| 通知保存/测试、渠道官网、GitHub 跳转 | 外部服务/外链副作用 |
| 插件安装/卸载、MCP 工具真实调用 | 依赖外部服务，且会改变环境 |

### 2.3 状态定义

| 状态 | 含义 |
|---|---|
| PASS | 实际结果与预期一致 |
| FAIL | 可复现的功能缺陷 |
| BLOCKED | 因安全/外部依赖/前置条件未执行，不计通过 |
| N/A | 当前构建/平台不提供该控件或能力 |

---

## 3. 测试计划

| 阶段 | 目标 | 退出标准 |
|---|---|---|
| P1 环境基线 | 固定版本、端口、平台、数据快照 | 基线表与 API 响应一致 |
| P2 全局与首页 | 导航、主题、抽屉、平台列所有控件 | 全部可操作且状态持久化 |
| P3 项目/会话 | 分页、搜索、行内操作、抽屉 | 列表数量与接口一致，确认框不误删 |
| P4 工作区/模板 | 临时数据完整生命周期 | 创建→查看→编辑→删除；临时文件清理 |
| P5 资源管理 | Skills/Plugins/MCP/Prompts/Commands/Agents | 列表/详情/校验/分页可用 |
| P6 渠道/代理 | 渠道面板与代理生命周期 | 校验、测速、确认框、日志清空通过 |
| P7 Analytics/设置 | 数据口径与配置表单 | 日/小时一致、过滤≤全量、钳制生效 |
| P8 接口/安全 | 契约与边界 | 未匹配 API JSON 404、跨站 403、非法参数 400 |
| P9 收尾 | 恢复与清理 | 基线表全部恢复、临时数据为 0 |

---

## 4. 用例执行明细

> `实际` 只记录本轮观察结果；确认框类动作均点击“取消”，最终破坏性步骤标记 BLOCKED。

### 4.1 全局、导航与抽屉

| ID | 场景 | 预期 | 实际 | 状态 |
|---|---|---|---|---|
| G-01 | 点击 Logo | 回到 `/` | 路由 `/` | PASS |
| G-02 | 点击 Header `Home` | 进入 `/` | 进入 `/` | PASS |
| G-03 | 点击 `Codex`/`OMP`/`DSH` | 进入 `/cli/{platform}`，项目数正确 | 48/14/14，页面标题正常 | PASS |
| G-04 | 点击 `Analytics` | 进入 `/analytics` | 正常加载 7d 汇总 | PASS |
| G-05 | 访问 `/codex`、`/claude`、`/nope` | 重定向到新路由或首页 | `/codex→/cli/codex`；`/claude`、`/nope→/` | PASS |
| G-06 | 主题切暗→亮→刷新 | `data-theme`、`cc-theme`、服务端一致 | 暗色 `data-theme=dark`；恢复后刷新仍为亮色，服务端 `light` | PASS |
| G-07 | Header 图标可访问名称 | 每个按钮有 aria-label | 7 个按钮均有 aria-label | PASS |
| G-08 | 点击收藏（0） | 抽屉显示空状态 | “暂无收藏 / 在会话列表点击收藏按钮添加收藏” | PASS |
| G-09 | 点击工作区管理 | 抽屉打开，空状态 | “共 0 个工作区 / 创建第一个工作区” | PASS |
| G-10 | 点击 Prompts 管理 | 14 个预设、当前激活标识 | `codex-assistant` 激活，14 个预设 | PASS |
| G-11 | 点击 MCP 服务器管理 | 24 个服务器、平台计数 | 24 个，Codex:5 / OMP:0 / DSH:0 | PASS |
| G-12 | 点击设置 | 5 个分区 | 外观/通知/高级/安全/模型 | PASS |
| G-13 | 点击更多工具 | Codex 显示 4 项 | 配置模板、配置导入导出、使用帮助、GitHub 仓库；无 CLI 请求转换 | PASS |
| G-14 | 更多工具→使用帮助 | 帮助弹窗 | 标题与快速开始内容正常 | PASS |
| G-15 | 更多工具→配置模板 | 模板抽屉 | “配置模版管理 / 共 0 个模版” | PASS |
| G-16 | 更多工具→配置导入/导出→导出配置 | 下载 ZIP | `ctx-config-2026-11-21.zip`，38,135,541 bytes | PASS |
| G-17 | 更多工具→GitHub 仓库 | 新标签打开外部仓库 | 未执行外链 | BLOCKED |
| G-18 | 全局路由冒烟 13 条 | 无控制台错误 | 13/13 页面加载，errors=0 | PASS |

### 4.2 首页仪表盘

| ID | 场景 | 预期 | 实际 | 状态 |
|---|---|---|---|---|
| H-01 | 加载首页 | 3 列，顺序 codex/omp/dsh | Codex-CLI、OMP、DeepSeek Harness | PASS |
| H-02 | 列锁定→解锁 | 锁定显示遮罩，配置持久化 | 遮罩“该渠道已锁定”；`channelLocks.codex` true→false | PASS |
| H-03 | Codex 代理开关启动 | 运行中、显示端口/时长 | “运行中 / 端口 20089 / 已运行 1秒” | PASS |
| H-04 | 再次点击停止 | 恢复已停止 | “已停止”，API running=false | PASS |
| H-05 | 点击“1个渠道已启用” | 渠道快捷面板 | 15 个渠道，含请求/Tokens/权重/并发/开关 | PASS |
| H-06 | 快捷面板启停渠道 | 开关即时变化并恢复 | 88code off→on→off，toast 正确 | PASS |
| H-07 | 点击“项目”快速访问 | 进入对应项目页 | OMP 列进入 `/cli/omp` | PASS |
| H-08 | 点击“最新对话” | 打开平台最近会话抽屉 | 10 条，标题“OMP 最新对话” | PASS |
| H-09 | 点击资源快捷键 | 打开 Skills/Commands/Agents | Codex 3 个、OMP 3 个、DSH 2 个（无 Commands） | PASS |
| H-10 | 拖拽列手柄 | 顺序变化并写回配置 | Codex↔OMP 互换成功，已拖回 `[codex,omp,dsh]` | PASS |
| H-11 | 首页列内“清空日志” | 清空本地日志 | 点击成功；实时流可能立即补行（OMP 持续写入） | PASS |
| H-12 | 今日数据/实时日志表头 | 与接口一致、列不缺失 | 请求/Tokens/成本正常；日志列按平台差异渲染 | PASS |

### 4.3 项目列表

| ID | 场景 | 预期 | 实际 | 状态 |
|---|---|---|---|---|
| P-01 | 打开 `/cli/codex` | 总数 48、分页 3 页 | “共 48 个”，第 1 页 20 张，分页 1/2/3 | PASS |
| P-02 | 切换第 2/3 页 | 20/20/8 | 20、8，页码高亮正确 | PASS |
| P-03 | 搜索 `dsh` / 无结果 / 清空 | 过滤、空状态、恢复 | 3 条；无结果显示“没有匹配的项目”；清空恢复 20 | PASS |
| P-04 | 点击“复制启动命令” | 复制 `codex` 并提示 | 剪贴板 `codex`，toast 正确 | PASS |
| P-05 | 点击项目卡片 | 进入会话页 | `/cli/codex/sessions/dsh`，标题 `dsh` | PASS |
| P-06 | 悬停→删除→取消 | 确认框含路径/会话数/不可恢复 | 文案完整；取消后仍 20 张卡片 | PASS |
| P-07 | 确认删除项目 | 删除并刷新 | 会破坏真实项目，未执行 | BLOCKED |

### 4.4 会话列表

| ID | 场景 | 预期 | 实际 | 状态 |
|---|---|---|---|---|
| S-01 | 打开 `/cli/codex/sessions/dsh` | 会话数/大小/路径/操作 | 1 个对话、54.0 KB、路径正确 | PASS |
| S-02 | 打开 `zhangzeao` 并翻页 | 34 条，20/14 | 第 1 页 20、第 2 页 14 | PASS |
| S-03 | 输入关键词→搜索 | 结果弹窗、匹配数与上下文 | `current_date` 共 2 处匹配，上下文正确 | PASS |
| S-04 | 别名设置/清空 | 保存、列表更新、可删除 | `QA-TEMP-ALIAS` 显示；清空 toast“别名已删除” | PASS |
| S-05 | 收藏/取消收藏 | 状态切换并持久化 | “收藏→已收藏→收藏”，toast 正确 | PASS |
| S-06 | 使用对话 | 复制 `cd … && 启动命令` | API 返回 command/cwd；toast“启动命令已复制” | PASS |
| S-07 | Fork | 配置弹窗（保留轮次/别名） | 弹窗正常；取消未创建 | PASS |
| S-08 | 删除 | 不可恢复确认框 | 弹窗正常；取消未删除 | PASS |
| S-09 | 管理 | 进入多选、显示全选/已选/删除/完成 | 正常；点击完成退出 | PASS |
| S-10 | 点击会话条目 | 打开聊天记录抽屉 | 正常加载 6 条消息节点 | PASS |
| S-11 | 项目配置 | 项目指令/Skills/MCP | 目标文件 `AGENTS.md`、63 技能、`.codex/config.toml` | PASS |
| S-12 | 最新对话条目点击 | 打开 ChatHistory | OMP 最近会话行点击后打开抽屉 | PASS |
| S-13 | 批量删除/确认删除会话 | 删除并刷新 | 会删除真实会话，未执行 | BLOCKED |

### 4.5 工作区

| ID | 场景 | 预期 | 实际 | 状态 |
|---|---|---|---|---|
| W-01 | 打开 `/workspaces` 空状态 | 空状态与创建入口 | 正常 | PASS |
| W-02 | 创建空表单提交 | 仅内联必填，无“创建失败”toast | 名称/项目两条内联错误，toasts 为空 | PASS |
| W-03 | 名称输入 `QA TEMP!` | 字符集校验 | “名称只能包含字母、数字、下划线、中划线和中文” | PASS |
| W-04 | 创建 `QA-TEMP-WS` + 1 个项目 | 创建成功、卡片出现 | `POST /api/workspaces` 200，路径 `/tmp/QA-TEMP-WS` | PASS |
| W-05 | 打开详情、复制 Codex 启动命令 | 详情与复制提示 | 项目/路径/状态/4 个 CLI 按钮；toast 成功 | PASS |
| W-06 | 添加仓库空提交 | 校验提示 | toast“请填写项目路径” | PASS |
| W-07 | 移除仓库→取消 | 二次确认，取消保留 | 文案正确，仓库保留 | PASS |
| W-08 | 卡片删除→确认 | 删除并从列表移除 | 确认框正常，删除成功，列表 0 | PASS |
| W-09 | 删除后的磁盘目录 | 明确是否删除文件 | 默认 `removeFiles=false`，目录与 symlink 保留（观察项 OBS-01） | PASS |

### 4.6 配置模板

| ID | 场景 | 预期 | 实际 | 状态 |
|---|---|---|---|---|
| T-01 | 打开 `/config-templates` | 空状态与创建入口 | 正常 | PASS |
| T-02 | 创建空提交 | 名称/CLI 必填 | “请输入模版名称 / 请选择 CLI 工具类型”，无请求 | PASS |
| T-03 | 选择 Codex 并创建 `QA-TEMP-TPL` | 创建成功 | `POST` 200，卡片出现 | PASS |
| T-04 | 预览 | 显示名称/描述/CLI/包含配置 | 弹窗正常 | PASS |
| T-05 | 应用（目标路径为空） | 预览/确认禁用并说明原因 | “请先填写目标项目路径”，按钮 disabled | PASS |
| T-06 | 无启用配置项时应用 | 明确不可应用原因 | “当前模版没有可应用的配置或资源…” | PASS |
| T-07 | 编辑 | 表单预填，取消不保存 | 名称预填，取消后数据不变 | PASS |
| T-08 | 删除→确认 | 删除并刷新 | 删除成功，列表 0 | PASS |
| T-09 | 应用含内容的模板到临时项目 | 写入目标文件并可回滚 | 未执行应用，避免写入配置 | BLOCKED |

### 4.7 Skills

| ID | 场景 | 预期 | 实际 | 状态 |
|---|---|---|---|---|
| SK-01 | 直接打开 `/skills` | 默认首个启用平台 | 默认 Codex，有完整操作按钮 | PASS |
| SK-02 | 统计与分页 | 63/57/6，3 页 | 一致 | PASS |
| SK-03 | 翻页 | 24 条/页 | 第 1/2 页均 24 | PASS |
| SK-04 | 搜索 `ai-slop` / 清空 | 过滤与恢复 | 1 条；清空恢复 24 | PASS |
| SK-05 | 状态筛选“待审批” | 6 条 | 6 条 | PASS |
| SK-06 | 创建空提交 | 必填校验，无请求 | 提示“请输入技能内容” | PASS |
| SK-07 | 高级模式 Tab | 文件上传区与 SKILL.md 提示 | 显示“必须包含 SKILL.md 文件” | PASS |
| SK-08 | 技能详情 | 概览/内容、路径、操作 | 正常；内容 Tab 加载正文 | PASS |
| SK-09 | 复制内容 | 剪贴板 + 提示 | 点击成功；自动化剪贴板读取不稳定（ENV-02） | PASS |
| SK-10 | 支持投影的技能开关 | 可关闭/启用并持久化 | `algorithmic-art` off→on 成功，已恢复 | PASS |
| SK-11 | 无投影/不支持投影的技能 | 开关应禁用或明确标注 | 开关仍可点击，点击后才提示“当前平台不支持安全投影” | **FAIL** |
| SK-12 | 仓库管理 | 列表、添加空输入禁用 | 3 个仓库；空输入时“添加”disabled | PASS |
| SK-13 | OMP 扫描设置 | 4 个来源开关可读 | 正常，关闭无副作用 | PASS |
| SK-14 | OMP Skills 规模 | 129 条、6 页、24 条/页 | 一致 | PASS |
| SK-15 | 创建/删除自定义技能 | 持久化并清理 | 会写入真实技能目录，未执行 | BLOCKED |
| SK-16 | 导入入口 | 按 manifest 声明显示 | Codex/OMP 未声明 import，入口未显示 | N/A |

### 4.8 Plugins

| ID | 场景 | 预期 | 实际 | 状态 |
|---|---|---|---|---|
| PL-01 | 直接打开 `/plugins` | 默认支持插件的启用平台 | 默认 OMP，5 个插件 | PASS |
| PL-02 | `/plugins?platform=dsh` | 192 个、8 页、24 条/页 | 一致 | PASS |
| PL-03 | 搜索 `orca` / 清空 | 过滤与恢复 | DSH 0 条；清空恢复 24 | PASS |
| PL-04 | 状态筛选“未安装” | 空结果 | 0 条 | PASS |
| PL-05 | 插件详情 | 概览、版本、路径 | 正常 | PASS |
| PL-06 | README | 加载 README 内容 | 正常渲染 | PASS |
| PL-07 | 仓库管理 | 添加空输入禁用 | “添加”disabled，说明 OMP Marketplace 由 CLI 管理 | PASS |
| PL-08 | 安装/卸载 | 确认后执行并可回滚 | 会改变真实环境，未执行 | BLOCKED |

### 4.9 MCP

| ID | 场景 | 预期 | 实际 | 状态 |
|---|---|---|---|---|
| M-01 | 打开 MCP 抽屉 | 24 个服务器与平台标记 | 24 个，Codex:5/OMP:0/DSH:0 | PASS |
| M-02 | 点击服务器卡片 | 打开详情 | `qianliu-mcp` 详情打开 | PASS |
| M-03 | 工具列表 | 显示工具或明确状态 | 显示“MCP server is disabled by the effective control policy” | PASS |
| M-04 | 工具测试 | 参数表单与执行结果 | 策略禁用，未执行 | BLOCKED |
| M-05 | 添加→空提交 | `请输入服务器 ID` | 提示正确，无请求 | PASS |
| M-06 | 粘贴解析 | 表单打开、非法 JSON 报错 | 正常；`not json` 提示格式错误 | PASS |
| M-07 | 真实新增/导入/删除服务器 | 持久化到配置 | 会写真实 MCP 配置，未执行 | BLOCKED |
| M-08 | 导出 MCP | 导出配置 | 入口存在，未执行下载 | N/A |

### 4.10 Prompts / Commands / Agents

| ID | 场景 | 预期 | 实际 | 状态 |
|---|---|---|---|---|
| PR-01 | 打开 Prompts | 14 个预设与激活项 | 正常 | PASS |
| PR-02 | 新建空提交 | 预设 ID 必填 | “预设 ID 不能为空”，无请求 | PASS |
| PR-03 | 创建并删除 `qa-temp-prompt` | 创建成功、删除成功 | 创建成功；删除后恢复 14 个 | PASS |
| PR-04 | 激活/停用预设 | 写入/删除各平台提示词文件 | 会修改项目提示词文件，未执行 | BLOCKED |
| PR-05 | 移除当前激活提示词→取消 | 二次确认 | 文案明确；取消无变化 | PASS |
| CA-01 | Codex Commands | 空状态 | “暂无自定义命令” | PASS |
| CA-02 | OMP 命令列表与详情 | 1 条 `/review`、概览/内容 | 正常，平台 pill `OMP` | PASS |
| CA-03 | 创建命令空提交 | 命令名必填 | “请输入命令名” | PASS |
| CA-04 | Codex Agents | 22 条、平台 pill | 正常 | PASS |
| CA-05 | 创建代理空提交 | 文件名/描述必填 | 两条校验提示 | PASS |
| CA-06 | DSH 新建预设空 ID | 客户端校验，不发请求 | toast“预设 ID 不能为空，请填写预设 ID 后再保存” | PASS |
| CA-07 | 创建/删除命令、代理、预设 | 持久化并清理 | 会写入真实资源，未执行 | BLOCKED |

### 4.11 渠道与代理

| ID | 场景 | 预期 | 实际 | 状态 |
|---|---|---|---|---|
| CH-01 | 渠道面板加载 | 名称/Provider/Auth/URL/Key/权重/并发 | 正常，15 个渠道 | PASS |
| CH-02 | 添加渠道空提交 | 必填校验，无请求 | “API Key不能为空” + toast | PASS |
| CH-03 | 编辑渠道清空名称 | 阻止保存 | “渠道名称不能为空” + toast；未发 PUT | PASS |
| CH-04 | 测速 | 显示延迟/HTTP/错误原因 | `468ms / HTTP 404 / Model "gpt-5.5" targets GPT-5.5…` | PASS |
| CH-05 | 重置状态 | 重置健康标记并提示 | toast“渠道健康状态已重置” | PASS |
| CH-06 | 同步 | 先确认，取消不发请求 | 确认框说明读写范围；取消 | PASS |
| CH-07 | 写入配置 | 二次确认 | 文案“会关闭动态切换并默认使用该渠道”；取消 | PASS |
| CH-08 | 删除渠道 | 二次确认 | 文案正确；取消 | PASS |
| CH-09 | 清空实时日志 | POST 成功 + 提示 | `POST /api/proxy/logs/clear?source=codex` 200，toast“日志已清空” | PASS |
| CH-10 | 代理启停（首页） | 状态/API 一致 | start→运行中；stop→已停止 | PASS |
| CH-11 | 渠道快捷开关 | 启停并可恢复 | 88code on→off 200 | PASS |
| CH-12 | 前往官网 | 新标签打开外链 | 未执行外链 | BLOCKED |
| CH-13 | 真实渠道 CRUD/同步/写入 | 持久化并可回滚 | 会修改真实渠道/原生配置，未执行 | BLOCKED |

### 4.12 Analytics

| ID | 场景 | 预期 | 实际 | 状态 |
|---|---|---|---|---|
| A-01 | 打开 `/analytics` | 汇总卡、分布图、趋势图 | 7d 2.76B / $15.7948 / 11,760 | PASS |
| A-02 | 切换 1d/3d/7d/30d/90d | 数据随范围变化 | 237.36M / 1.31B / 2.76B / 178.79B / 178.89B | PASS |
| A-03 | 范围单调性 | 1d ≤ 3d ≤ 7d ≤ 30d ≤ 90d | 满足 | PASS |
| A-04 | 日/小时聚合一致性 | 任意范围 sum(day)=sum(hour) | 1d/3d/7d 完全相等（见 §5） | PASS |
| A-05 | 过滤子集不变量 | filtered ≤ unfiltered | omp 2.671B、channel 2.671B、model 2.706B ≤ 2.758B | PASS |
| A-06 | 工具筛选 UI | 选择 omp 后汇总更新 | 2.67B / $14.3845 / 11,001 | PASS |
| A-07 | 指标切换 Token/费用/请求 | 汇总不变，图表/标题切换 | 日均用量变为 `$2.2589` | PASS |
| A-08 | 柱状图/折线图 | 图表类型切换 | 折线图正常渲染 | PASS |
| A-09 | 全屏/退出 | 图表全屏并可退出 | `.chart-section.fullscreen`，标题变为“退出全屏” | PASS |
| A-10 | 导出菜单 | CSV/JSON 选项 | 菜单含“导出 CSV / 导出 JSON” | PASS |
| A-11 | 导出接口 | 附件头与内容类型正确 | CSV/JSON 200，`Content-Disposition` 正确 | PASS |
| A-12 | 自定义范围 | 选择/输入后触发查询 | `2026-11-15~2026-11-21` 触发 4 个 `/trend` 请求，汇总更新 | PASS |

### 4.13 设置

| ID | 场景 | 预期 | 实际 | 状态 |
|---|---|---|---|---|
| SET-01 | 打开设置 | 5 个分区 | 外观/通知/高级/安全/模型 | PASS |
| SET-02 | 外观“显示剩余金额”关→开 | 即时保存并恢复 | aria-checked false→true，服务端 true | PASS |
| SET-03 | 高级端口 80 / 70000 | 钳制到 1024 / 65535 | 一致 | PASS |
| SET-04 | 日志条数 10 / 统计间隔 1000 / 原生 100 | 钳制 50 / 300 / 60 | 一致 | PASS |
| SET-05 | 高级表单改回原值 | 保存按钮禁用 | 恢复后 disabled | PASS |
| SET-06 | 安全短密码 | 校验且保存禁用 | 提示“密码至少 4 位”，disabled | PASS |
| SET-07 | 安全密码不一致 | 提示不一致且禁用 | “两次输入的新密码不一致”，disabled | PASS |
| SET-08 | 模型搜索 | 过滤模型列表 | `claude-haiku-4-5` 过滤为 2 行 | PASS |
| SET-09 | 模型字段 placeholder | 中文 | “请输入” | PASS |
| SET-10 | 模型字段修改/改回 | 保存按钮启用→禁用 | 200001 启用；200000 恢复禁用 | PASS |
| SET-11 | 通知设置 | 分平台开关、远程渠道表单 | 微信渠道内联表单、字段与“测试”按钮正常 | PASS |
| SET-12 | 通知保存/测试 | 写入 hooks/外部请求 | 依赖外部服务，未执行 | BLOCKED |
| SET-13 | 启用访问密码 | 设置后需验证 | 有锁死风险，未执行 | BLOCKED |

### 4.14 接口契约与安全

| ID | 场景 | 预期 | 实际 | 状态 |
|---|---|---|---|---|
| API-01 | `GET /api/does-not-exist` | JSON 404 | 404 `application/json`，`API_NOT_FOUND` | PASS |
| API-02 | `GET /api/settings` | JSON 404 | 404 JSON | PASS |
| API-03 | `GET /api/aliases` | 返回别名映射 | 200 JSON | PASS |
| API-04 | 跨站写 UI 配置 | 403 | 403 `CROSS_ORIGIN_REQUEST_BLOCKED` | PASS |
| API-05 | `startDate=bad` | 400 | 400 `Invalid date format` | PASS |
| API-06 | `startDate > endDate` | 400 | 400 `endDate must be >= startDate` | PASS |
| API-07 | 范围 > 365 天 | 400 | 400 `Date range cannot exceed 365 days` | PASS |
| API-08 | `granularity=hour` 且 > 7 天 | 400 | 400 `Hour granularity is limited to 7 days` | PASS |
| API-09 | 未知平台 `/api/platforms/nope/projects` | JSON 404 | 404 JSON | PASS |
| API-10 | 会话路径穿越 | 拒绝或返回空，不读文件 | 200 空会话 JSON，无文件泄露 | PASS |
| API-11 | 前端路由未知路径 | 回首页 | `/nope → /` | PASS |

---

## 5. Analytics 数据一致性明细

| 范围 | day 总量 | hour 总量 | 结果 |
|---|---:|---:|---|
| 1d（11-21） | 236,964,502 | 236,964,502 | 相等 |
| 3d（11-19~21） | 1,312,764,700 | 1,312,764,700 | 相等 |
| 7d（11-15~21） | 2,758,260,899 | 2,758,260,899 | 相等 |
| 30d | 178,789,006,443 | — | 单调 |
| 90d | 178,888,571,934 | — | 单调 |

7d 过滤：

| 维度 | 总量 | 与未过滤 2,758,260,899 比较 |
|---|---:|---|
| `filterToolType=omp` | 2,671,038,675 | ≤ |
| `filterChannel=sang for` | 2,671,038,675 | ≤ |
| `filterModel=deepseek-flash` | 2,706,463,985 | ≤ |

---

## 6. 上轮缺陷回归

| ID | 原问题 | 本轮结果 | 证据 |
|---|---|---|---|
| D-01 | Analytics 过滤/小时口径错误 | PASS | §5 日/小时完全一致，过滤≤全量 |
| D-02 | MCP 卡片无响应 | PASS | 点击 `qianliu-mcp` 打开详情 |
| D-03 | 项目列表缺分页 | PASS | 48 条、20/20/8 |
| D-04 | 日志清空 404 | PASS | `POST .../logs/clear` 200 + toast |
| D-05 | 自定义日期不触发 | PASS | 4 个 `/trend` 请求，参数正确 |
| D-06 | 收藏空抽屉空白 | PASS | 空状态文案 |
| D-07 | `/skills`、`/plugins` 回落未启用平台 | PASS | 默认 Codex / OMP |
| D-08 | 资源配置模板无法应用且无解释 | PASS | 显示“无可应用配置或资源”原因 |
| D-09 | 渠道同步无确认 | PASS | 同步确认框，取消无请求 |
| D-10 | 工作区校验额外错误 toast | PASS | 仅内联校验 |
| D-11 | 不支持投影的技能仍可点击 | PASS（已修复） | 列表回传 projection，启用方向禁用；已启用但投影异常仍可关闭；见 BUG-01 |
| D-12 | 导入按钮永久禁用 | PASS | 未声明 import 的平台不显示入口 |
| D-13 | Skills/Plugins 无分页 | PASS | 24 条/页，Skills 6 页、Plugins 8 页 |
| D-14 | DSH 预设空 ID 请求 500 | PASS | 客户端中文校验，无请求 |
| D-15 | 抽屉缺平台标识；最新对话不可点 | PASS | 抽屉显示 Codex/OMP；最近会话行可点开 ChatHistory |
| D-16 | 模型保存按钮不复位 / 英文 placeholder | PASS | 改回原值后 disabled；placeholder “请输入” |
| D-17 | 主题快速切换竞态 | PASS | 连续切换后 attr/localStorage/服务端一致 |
| D-18 | Header 图标无可访问名称 | PASS | 7 个 aria-label |
| D-19 | 未匹配 API 返回 HTML | PASS | JSON 404 |
| D-20 | `GET /api/aliases` 未实现 | PASS | 200 JSON |
| D-21 | “新建项目”实际只复制命令 | PASS | 文案为“复制启动命令” |

---

## 7. 缺陷与观察项

### BUG-01 [P3] 无投影/不支持投影的技能开关未禁用

**模块**：Skills  
**复现**：

1. 打开 `/skills?platform=omp`。
2. 找到一个实际不支持安全投影的技能（API 列表项 `projection` 缺失，切换返回 `unsupported`）。
3. 观察开关仍为可点击状态；点击后才出现 toast“当前平台不支持安全投影”。

**预期**：当 `projection` 缺失或 `state === 'unsupported'` 时，开关禁用并显示“不支持投影”标签。  
**实际**：`SkillCard.vue` 仅判断 `projection?.state === 'unsupported'`；列表接口对多数项不返回 `projection`，因此开关保持可用。  
**影响**：用户可进行无效点击，操作后才得到错误提示。  
**建议**：将 `!skill.projection` 与 `unsupported` 一并视为不可切换；或在列表接口中统一返回 `state`。

### OBS-01 [P3] 工作区删除默认保留磁盘目录

**复现**：工作区删除确认后，列表移除成功，但 `/tmp/QA-TEMP-WS` 与 `qa-proj` symlink 仍在。  
**原因**：前端调用 `DELETE /api/workspaces/:id` 未传 `removeFiles=true`；服务端默认 `false`。  
**建议**：确认框明确“仅删除工作区记录，保留目录”，或提供“同时删除目录”选项。

### OBS-02 [P3] Prompts “移除”作用于当前激活预设，而非选中卡片

**复现**：在 Prompts 抽屉选中任意卡片后点击“移除”，确认框仍为“移除当前激活的提示词”。  
**影响**：容易被理解为删除选中卡片；实际会删除各平台当前激活提示词文件。  
**建议**：按钮文案改为“移除当前激活提示词”，或根据选中卡片切换操作对象。

### OBS-03 [P3] OMP 项目页首屏较慢

**现象**：路由冒烟中 `/cli/omp` 首屏 7.7 s，Codex/DSH 约 2.3–2.5 s；最终数据正确。  
**建议**：为 OMP 项目列表增加性能基线或缓存/骨架屏。

### ENV-01 测试工具链限制（非产品缺陷）

- 共享 headless Chromium 实例的 `requestAnimationFrame` 不触发，导致 Vue/Naive 过渡停在 `enter-active`、截图超时。
- 本轮改用独立启动的 Chrome（`spawned`）完成全部 UI 验证；截图与交互恢复正常。
- 该现象不影响产品功能判断，但会影响自动化环境选择。

### ENV-02 剪贴板读取不稳定

- `navigator.clipboard.readText()` 多次返回旧的 `codex` 内容，无法可靠断言“使用对话/启动命令”的完整文本。
- 已通过对应 API 响应（`command`/`cwd`）与 toast 验证复制链路；剪贴板正文标记为未完全验证。

---

## 8. 覆盖率与恢复核对

### 8.1 覆盖统计

| 模块 | 用例 | PASS | FAIL | BLOCKED | N/A |
|---|---:|---:|---:|---:|---:|
| 全局/导航/抽屉 | 18 | 17 | 0 | 1 | 0 |
| 首页仪表盘 | 12 | 12 | 0 | 0 | 0 |
| 项目列表 | 7 | 6 | 0 | 1 | 0 |
| 会话列表 | 13 | 12 | 0 | 1 | 0 |
| 工作区 | 9 | 9 | 0 | 0 | 0 |
| 配置模板 | 9 | 8 | 0 | 1 | 0 |
| Skills | 16 | 13 | 1 | 1 | 1 |
| Plugins | 8 | 7 | 0 | 1 | 0 |
| MCP | 8 | 5 | 0 | 2 | 1 |
| Prompts/Commands/Agents | 12 | 10 | 0 | 2 | 0 |
| 渠道/代理 | 13 | 11 | 0 | 2 | 0 |
| Analytics | 12 | 12 | 0 | 0 | 0 |
| 设置 | 13 | 11 | 0 | 2 | 0 |
| 接口/安全 | 11 | 11 | 0 | 0 | 0 |
| **合计** | **161** | **144** | **1** | **14** | **2** |

### 8.2 测试后状态核对

| 项 | 恢复值 | 核对 |
|---|---|---|
| 主题 | `light` | ✅ |
| enabledCliPlatforms | `["codex","omp","dsh"]` | ✅ |
| 列锁定 | 全部 `false` | ✅ |
| 面板显示 | channels/logs/balance = true | ✅ |
| Codex 代理 | `running=false` | ✅ |
| Codex 渠道 | 仅“家帅”启用 | ✅ |
| 收藏 | 各平台空 | ✅ |
| 工作区 / 配置模板 | 0 / 0 | ✅ |
| Prompts | 14（自定义 11 / 内置 3） | ✅ |
| 临时技能 `algorithmic-art` | 恢复启用 | ✅ |
| 临时目录 `/tmp/QA-TEMP-WS`、`/tmp/qa-ws-proj` | 已手动清理 | ✅ |
| 导出 ZIP | 已删除 | ✅ |

> 说明：渠道“清空日志”已按测试用例执行，Codex 实时日志被清空；这是测试动作的预期结果。

---

## 9. 发布建议与后续

1. **发布结论**：功能性通过，无 P0/P1/P2；BUG-01 与两项 UX 观察项已于 2026-11-22 修复并复核（见 §10）。
2. **优先修复**：BUG-01（技能开关禁用）与 OBS-02（Prompts 移除文案/作用域），均为低风险前端改动。
3. **体验改进**：OBS-01（工作区删除文件语义）、OBS-03（OMP 首屏性能）。
4. **自动化建议**：
   - 增加 Skills “projection 缺失即禁用”的组件测试。
   - 将 E2E 环境固定为可用的 Chrome 实例，避免共享 headless 的 rAF 卡死。
   - 为 Analytics 日/小时/过滤不变量保留现有 API 测试，并加入本轮数值基线。
5. **发布前冒烟（15 分钟）**：首页三列/代理启停/渠道弹层 → 项目分页 → 会话搜索/收藏 → Skills 搜索/详情 → MCP 详情 → Analytics 7d/自定义 → 设置打开/关闭。

---

## 10. 修复复核（2026-11-22）

| 问题 | 修复 | 验证 |
|---|---|---|
| BUG-01 | `/api/skills` 的受控条目回传 `projection.mode/state`；`SkillCard`、`SkillsPanel` 与 `SkillDetailDrawer` 统一通过共享判定按 `mode`/`state === 'unsupported'` 阻止启用；已启用但投影异常的 Skill 仍可关闭；保留原生可投影 Skill 的启停能力 | 后端 `skill-service` 79 测试通过；前端定向测试通过；临时实例 `/skills?platform=omp` 实测：`analyze/autopilot` 等显示「不支持投影」且禁用启用，详情页对未启用项显示只读状态、对已启用项保留关闭入口；`algorithmic-art` 等仍可切换 |
| OBS-01 | 删除确认框明确“仅删除工作区记录，源项目文件/工作区目录/symlink 保留；worktree 项目注销并移除工作区内 worktree 目录”，主操作改为「删除记录」 | 前端组件测试 + 临时实例实测弹窗文案与按钮 |
| OBS-02 | Prompts 顶部按钮改为「移除激活」，tooltip 明确作用对象 | 组件测试 + 临时实例实测按钮文案 |
| OBS-03 | 复测未复现 7.7s：OMP 2.67s / 2.09s，Codex 1.94s；项目 API 14ms、Dashboard API 4ms | 记录为冷启动波动，不修改代码；建议后续加首屏性能基线 |

复核命令：

```bash
npx vitest run tests/unit/services/skill-service.test.js
cd src/web && npx vitest run \
  src/components/__tests__/SkillCardSwitch.test.js \
  src/components/__tests__/SkillsPanelFixes.test.js \
  src/components/__tests__/WorkspacePanel.refresh.test.js \
  src/components/__tests__/PromptsDrawer.test.js
```

复核后已停止临时实例（20099），删除临时工作区与 `/tmp/qa-fix-*` 目录；主实例 19999 未受影响。

---

## 11. 增删一致性复核（2026-11-22）

针对“先添加再删除”的补充测试：所有临时资源使用 `QA-CRUD-*` / `QA-UI-CRUD-*` 前缀，添加后确认列表可见，删除后确认列表与磁盘状态回到基线。

### 11.1 复核结果

| 资源 | 添加 | 删除 | 列表/磁盘一致性 |
|---|---|---|---|
| 工作区 | `POST /api/workspaces` 200，列表 0→1 | 删除记录 200，列表 1→0 | 目录/ symlink 清理（`removeFiles=true`）通过 |
| 工作区项目 | 添加第二个项目 200，项目数 1→2 | 移除项目 200，项目数 2→1 | 通过 |
| 配置模板 | 创建 200，列表 0→1 | 删除 200，列表 1→0 | 通过 |
| Prompt 预设 | 创建 200，`GET` 可见 | 删除 200，`GET` 404 | 预设总数 14 恢复 |
| MCP 服务器 | API 创建 200，`GET` 可见 | UI 删除确认 + `DELETE` 200 | 列表 24，`GET` 404 |
| 命令（项目级） | 创建 200，`GET` 可见 | 删除 200，`GET` 404 | 临时项目内无残留文件 |
| 代理 Agent（用户级） | 创建 200，`GET` 可见 | 删除 200，`GET` 404 | 用户 Agent 数恢复 |
| Codex 渠道 | 创建 200，列表 16→17；更新名称 200 | UI 删除确认 + `DELETE` 200 | 列表 17→16，`providerKey` 不存在 |
| Claude 项目初始化 | `projects/create` 200，`.claude` 创建 | `DELETE` 200，`initializedProject=true` | `.claude` 已删除 |
| Skill 仓库 | 创建 200，仓库 3→4 | 删除 200，仓库 4→3 | 通过 |
| Plugin 仓库 | 创建 200，仓库 4→5 | 删除 200，仓库 5→4 | 通过 |
| Codex 会话 | Fork 真实会话 200 | 删除 Fork 200 | `fresh=1` 列表 1→2→1，原会话保留 |
| 自定义 Skill | 创建 200，列表可见，`trust=pending` | **无删除 API**（`/uninstall` 返回 410，设计上由 toggle 代替） | 审批→禁用→启用 8/8 通过；临时工作区删除后手动清理 artifact |

### 11.2 Skill 生命周期（设计口径）

| 步骤 | 结果 |
|---|---|
| 创建项目级 Skill | 200，列表可见，`enabled=false`、`trust=pending` |
| 审批 | 200 |
| 禁用 | 200，`enabled=false`、projection=disabled |
| 启用 | 200，`enabled=true` |
| 删除 | N/A：产品不提供 Skill 删除；`POST /api/skills/uninstall` 明确返回 410，提示改用 `PUT /api/skills/toggle` |

### 11.3 结论

- 所有**提供删除能力**的资源均完成“添加→列表可见→删除→列表恢复→磁盘/配置无残留”闭环。
- 唯一不具备删除能力的是 **Skill**：这是现有设计（用禁用/投影代替卸载），不是本次测试遗漏；如需“彻底删除自定义 Skill”，需要新增后端删除接口与前端入口。
- **Plugin 安装/卸载**仍未执行：安装依赖外部 marketplace / CLI 网络操作，会改变真实插件环境；本轮完成了 Plugin 仓库的添加/删除。若需要，应在隔离配置根中执行。
- 复核后基线：工作区 0、模板 0、Prompt 14、MCP 24、Codex 渠道 16、Claude 项目 13、Skill 仓库 3、Plugin 仓库 4、DSH 会话 1；临时目录与 artifact 已清理。
