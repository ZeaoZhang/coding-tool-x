# coding-tool-x Web UI 缺陷修复与回归报告（第二轮）

| 项目 | 内容 |
|---|---|
| 基线版本 | `3.9.14`（develop @ b492d78 + 本轮修复） |
| 环境 | http://localhost:19999，Chrome headless 1440×900，2026-11-20 |
| 部署方式 | `npm install -g .` + PM2 `cc-tool` 重启（服务端与 `dist/web` 均更新） |
| 自动化结果 | 后端 **230 文件 / 3151 测试通过**；前端 **56 文件 / 226 测试通过** |
| 现场回归 | 关键缺陷逐项真实浏览器验证；6 平台渠道 CRUD、日志清空、页面冒烟实测 |

---

## 1. 结论

- 第一轮 21 项缺陷：**20 项已修复**，**1 项判定为测试方法误报（D-05）**。
- 4 个 P1 全部关闭：Analytics 口径、MCP 详情、项目分页、日志清空。
- 新增回归测试 20 个文件/场景；后端数据不变量、API 契约、前端组件行为均有覆盖。
- 第三轮已处理 3 项遗留风险：Claude create/delete 一致性、趋势查询缓存、前端测试超时。

---

## 2. 缺陷修复矩阵

| ID | 原级别 | 修复内容 | 关键文件 | 回归测试 |
|---|---|---|---|---|
| D-01 | P1 | JSONL 日志按 `id + 内容签名` 去重；日/小时统一数据源（≤7 天用去重 JSONL，长范围未过滤走日聚合以保证性能）；过滤与未过滤使用同一口径 | `src/server/services/statistics-service.js` | `tests/unit/services/statistics-service.test.js`（去重、日=小时、过滤≤全量、代理回退） |
| D-02 | P1 | 补上 `McpServerDetailDrawer` 导入，卡片点击可打开详情/工具列表 | `src/web/src/components/McpDrawer.vue` | `McpDrawer.test.js`（点击卡片 → 详情抽屉 props） |
| D-03 | P1 | 项目列表增加分页器（3 页：20/20/8），标题使用 `pagination.total`，切页请求 `page` 并回顶 | `src/web/src/views/ProjectList.vue` | `ProjectList.lifecycle.test.js`（切页请求参数） |
| D-04 | P1 | 新增全局 `POST /api/proxy/logs/clear?source=`，按来源清理日志；驱动补 `clearLogs`；DSH manifest 补路由 | `src/server/api/proxy-logs.js`、`websocket-server.js`、`shared/proxy-driver.js`、`dsh.json`、`api/proxy.js` | `tests/unit/api/proxy-logs.test.js`、`tests/unit/shared/proxy-driver.test.js` |
| D-05 | P2 | **误报**：Naive `daterange` 需要点击“确认”才提交；确认后原逻辑即可查询。仍将 `:on-update:value` 改为标准 `@update:value` 以消除歧义 | `Analytics.vue` | `views/__tests__/Analytics.test.js` |
| D-06 | P2 | 收藏抽屉补 `totalCount`，0 条时显示“暂无收藏”空状态 | `FavoritesDrawer.vue` | `FavoritesDrawer.test.js` |
| D-07 | P2 | `/skills`、`/plugins` 无参数时默认第一个启用且支持该能力的平台；未知参数回退 | `SkillsPanel.vue`、`PluginsPanel.vue` | `SkillsPanelFixes.test.js`、`PluginsPanelFixes.test.js`、`OmpSkillSettings.test.js` |
| D-08 | P2 | 仅含 Skills/Agents/Commands 的模板可预览/应用；无目标路径或无内容时显示原因 | `ConfigApplyModal.vue` | `ConfigApplyModal.test.js` |
| D-09 | P2 | 渠道“同步”先弹确认框（说明读取原生配置并写入渠道列表），确认后执行并提示成功/失败 | `useChannelManager.js` | `ChannelSyncConfirm.test.js` |
| D-10 | P3 | 工作区表单校验失败不再落入提交异常，取消多余“创建失败”toast | `WorkspaceFormModal.vue` | `WorkspaceFormModal.test.js` |
| D-11 | P3 | 缺失/unsupported 投影的技能禁用开关且不发请求 | `SkillsPanel.vue` | `SkillsPanelFixes.test.js` |
| D-12 | P3 | 导入按钮由 manifest `resourceActions.skills.import` 驱动；Claude manifest 声明 `import: true` | `SkillsPanel.vue`、`claude.json` | `SkillsPanelFixes.test.js` |
| D-13 | P3 | Skills/Plugins 列表 24 条/页，搜索/筛选/平台/Profile 变化重置页码 | `SkillsPanel.vue`、`PluginsPanel.vue` | 同上 + `PluginsPanelFixes.test.js` |
| D-14 | P3 | DSH 预设保存前校验 Profile 与预设 ID，阻止空 ID 请求 | `DshAgentPresetsPanel.vue` | `DshAgentPresetsPanel.test.js` |
| D-15 | P3 | 资源抽屉头部增加平台 pill；最新对话行点击打开 ChatHistory，操作按钮不误触 | `SkillsDrawer.vue`、`CommandsDrawer.vue`、`AgentsDrawer.vue`、`RecentSessionsDrawer.vue` | `ResourceDrawerPlatformHeader.test.js`、`RecentSessionsDrawer.test.js` |
| D-16 | P3 | 模型设置以已保存快照计算 dirty；Naive 全局切换中文 locale，消除 `Please Input` | `SettingsDrawer.vue`、`App.vue` | `SettingsDrawerModelMeta.test.js` |
| D-17 | P3 | 主题写入串行化并丢弃过期请求，快速切换后本地/服务端保持一致 | `useTheme.js` | 现场连点 3 次验证：attr/localStorage/server 均为 light |
| D-18 | P3 | HeaderButton 增加 `aria-label`（取 tooltip）与 `type="button"` | `HeaderButton.vue` | `HeaderButton.test.js` |
| D-19 | P3 | 未匹配 `/api/*` 返回 JSON 404，不再落 SPA HTML | `src/server/index.js`、`api/not-found.js` | `tests/unit/api/not-found.test.js` |
| D-20 | P3 | 新增 `GET /api/aliases` | `api/aliases.js` | `tests/unit/api/aliases.test.js` |
| D-21 | P3 | “新建项目”改为“复制启动命令”，与实际行为一致 | `ProjectList.vue` | 现场文案验证 |

---

## 3. 数据口径修复验证（真实数据）

修复后（同一时刻）：

| 查询 | tokens |
|---|---:|
| 7d 未过滤（day） | 2,358,476,239 |
| 7d 未过滤（hour，4h） | 2,358,476,239 |
| 3d（day） | 1,552,758,362 |
| 3d（hour，12h） | 1,552,758,362 |
| 7d `filterToolType=omp` | 2,313,594,367 |

- 日/小时完全一致；过滤结果 ≤ 全量；1d ≤ 3d ≤ 7d。
- 长范围（90d）未过滤仍走日聚合，避免解析约 330 MB 原始日志；实测 90d 约 345 ms。
- 7d 首次查询需解析去重 JSONL；加入 LRU 缓存后首指标约 70 ms，同范围后续指标 1–2 ms，页面约 1 s 内出数。

根因：历史 flush 重试把同一日志行重复追加，原始 JSONL 行数虚高；日聚合已去重。修复采用读取时按 `id + payload` 去重，并让过滤/小时/短范围查询共用该数据源。

---

## 4. 破坏性测试（隔离数据，已清理）

### 4.1 每平台渠道 CRUD

对 `claude / codex / gemini / opencode / omp / dsh` 逐一执行：创建 → 更新（名称/权重）→ 删除 → 列表校验。

| 平台 | 创建 | 更新 | 删除 | 残留 |
|---|---|---|---|---|
| claude | 200 | 200 | 200 | 0 |
| codex | 200 | 200 | 200 | 0 |
| gemini | 200 | 200 | 200 | 0 |
| opencode | 200 | 200 | 200 | 0 |
| omp | 200 | 200 | 200 | 0 |
| dsh | 200 | 200 | 200 | 0 |

> DSH 创建返回 `{ channel: {...} }`（其他平台返回扁平对象），已按实际结构完成校验与清理。

### 4.2 每平台页面冒烟（临时启用全部平台）

| 平台 | 导航 | 项目页 | 右侧渠道面板 |
|---|---|---|---|
| Claude Code | OK | 13 个项目 | Claude Code 渠道管理 |
| Codex | OK | 48 个项目 / 3 页 | Codex 渠道管理 |
| Gemini | OK | 6 个项目 | Gemini 渠道管理 |
| OpenCode | OK | 2 个项目 | OpenCode 渠道管理 |
| OMP | OK | 14 个项目 | OMP 渠道管理 |
| DSH | OK | 14 个项目 | DSH 渠道管理 |

测试后已恢复 `enabledCliPlatforms = ["codex","omp","dsh"]`。

### 4.3 日志清空

六平台 `POST /api/proxy/logs/clear?source=<platform>` 均返回 200；清理后 `proxy-logs.json` 条目为 0。平台级 `POST /api/platforms/{platform}/proxy/logs/clear` 亦可用（驱动 `clearLogs` + DSH manifest）。

### 4.4 MCP 服务器

创建临时服务器 `qa-temp-mcp` → 列表可见 → 删除 200 → 列表不存在。

### 4.5 工作区 / 配置模板

沿用第一轮 UI 测试：创建 `QA-TEMP` 工作区与模板、执行校验/预览/取消、删除并清理临时目录；本轮额外验证资源型模板（仅 Skills）在填写目标路径后“确认应用”可用，并删除临时模板。

### 4.6 临时数据清理核对

| 资源 | 结果 |
|---|---|
| 渠道 `QA-TEMP-*` | 6 平台均为 0 |
| MCP `qa-temp-mcp` | 0 |
| 配置模板 `QA-TEMP-*` | 0 |
| 工作区 `QA-TEMP` | 0 |
| `/tmp/qa-*` 临时目录 | 已删除 |
| 启用平台 | `["codex","omp","dsh"]` |
| 主题 | `light` |

---

## 5. 现场回归清单（浏览器实测）

| 项 | 结果 |
|---|---|
| Analytics 自定义范围选择 11-10 ~ 11-15 后点“确认” | 触发 4 个 `/trend` 请求，汇总变为 993.74M / $8.6603 / 4,795 |
| Codex 项目分页 | 1/2/3 页，20/20/8 张卡片，标题“共 48 个” |
| MCP 服务器卡片 | 打开详情抽屉（含“工具列表”） |
| 收藏（0 条） | 显示“暂无收藏”与提示 |
| `/skills` 无参数 | 默认 Codex，24 条/页，分页器 1 2 3 |
| `/plugins?platform=dsh` | 24 条/页，分页器 1 2 3 8 |
| DSH 预设空 ID 保存 | 中文提示，无 500 请求 |
| 最新对话行点击 | 打开 ChatHistory 抽屉 |
| 渠道“同步” | 先确认，取消不发请求 |
| Header 图标 | 7 个 `aria-label` 均存在 |
| 技能开关（不支持投影） | 禁用，发请求为 0 |
| 快速连点主题 3 次 | `data-theme=light`、localStorage `light`、服务端 `light` |

---

## 6. 新增测试清单

后端（`tests/unit`）：

- `services/statistics-service.test.js`：重复 JSONL 去重、日=小时、过滤≤全量、无日志时代理回退。
- `api/proxy-logs.test.js`：按来源清理、全量清理、非法来源 400、异常 500。
- `api/not-found.test.js`：API 404 JSON 契约。
- `api/aliases.test.js`：新增 GET 列表。
- `shared/proxy-driver.test.js`：驱动 `clearLogs` 调用来源。

前端（`src/web/src/**/__tests__`）：

- `Analytics.test.js`、`SettingsDrawerModelMeta.test.js`、`ConfigApplyModal.test.js`、`WorkspaceFormModal.test.js`
- `SkillsPanelFixes.test.js`、`PluginsPanelFixes.test.js`、`DshAgentPresetsPanel.test.js`
- `ResourceDrawerPlatformHeader.test.js`、`RecentSessionsDrawer.test.js`、`ChannelSyncConfirm.test.js`
- `McpDrawer.test.js`（新增详情用例）、`FavoritesDrawer.test.js`、`HeaderButton.test.js`、`ProjectList.lifecycle.test.js`（分页）

执行结果：

```
npx vitest run                 # 后端：230 files / 3151 tests passed
cd src/web && npx vitest run   # 前端：56 files / 226 tests passed
```

---

## 7. 遗留风险处理（第三轮）

| 风险 | 处理 | 验证 |
|---|---|---|
| Claude `createProject` / `deleteProject` 存储不一致 | 新增 `claude-project-registry.json`：create 记录 `projectName → projectPath/.claude`；delete 在会话目录不存在时按注册表删除初始化目录并清理记录 | 现场 create → delete 返回 `initializedProject:true`，`.claude` 已删除，注册表为空；新增 `tests/unit/platforms/claude-project-registry.test.js`（4 例） |
| 7d 趋势重复解析成本 | 增加去重后日条目的 LRU 缓存（按文件 mtime+size 失效，上限 32 文件 / 20 万条），多指标/多过滤并发请求复用同一次解析 | 实测：首指标 70 ms，第二/第三指标 2 ms / 1 ms；小时查询 26 ms；移窗范围 63 ms；页面数据约 1 s 内可见 |
| 前端并行测试偶发 5s 超时 | `src/web/vitest.config.js` 提升 `testTimeout` / `hookTimeout` 至 15s | 全量 56 文件 / 226 测试通过 |

仍有以下关注点：

1. **同步确认语义**：确认框说明“读取原生配置并写入渠道列表”，与驱动实现一致；若未来改为反向写入原生配置，需要同步更新文案与测试。
2. **7d 首次查询**：冷启动/缓存被新日志失效后仍需解析当日 JSONL（约 70 ms/指标）；已从秒级降到百毫秒级。
3. **构建一致性**：本轮已重新 `build:web` 并全局安装；发布流程应保证 `dist` 与 `src` 同一提交构建。

---

## 8. 关键证据

| 内容 | 位置 |
|---|---|
| 修复后 Analytics 自定义范围 | `/tmp/qa/custom-footer.png`（本轮） |
| 渠道 CRUD 原始结果 | `/tmp/qa/destructive-channels.json` |
| 第一轮缺陷截图 | `docs/qa/evidence/` |
| 第一轮测试计划与缺陷清单 | `docs/qa/web-ui-functional-test-plan.md` |
