# 全量控制执行结果（逐个执行）

日期：2026-11-20  
环境：http://localhost:19999，Chrome headless 1440×900，5 个执行分片并发（隔离 QA-EXEC 数据）  
产出：各分片原始逐控件报告在本机 `/tmp/qa2/*.md`；本文为汇总。

## 1. 总量

| 指标 | 数量 |
|---|---:|
| 执行行（含重复卡片抽样） | 255 |
| PASS | 208 |
| FAIL（执行时） | 10 |
| BLOCKED | 12 |
| N/A | 13 |
| PARTIAL / NOT RUN | 12 |

分片：

| 分片 | 行数 | PASS | FAIL | BLOCKED | N/A | 其他 |
|---|---:|---:|---:|---:|---:|---:|
| Projects + Sessions | 41 | 34 | 3 | 0 | 4 | — |
| Channels + Proxy + RightPanel | 66 | 56 | 4 | 1 | 5 | — |
| Skills + Plugins + MCP | 52 | 38 | 3 | 2 | 2 | 2 partial + 5 not run |
| Workspaces + Templates + Prompts + Commands + Agents | 34 | 29 | 0 | 3 | 0 | 2 not run |
| Settings + Analytics + Global Header | 62 | 51 | 0 | 6 | 2 | 3 not run |

## 2. 本轮执行覆盖到的新动作

- 会话：Fork 四选项、真实 Fork、删除 Fork、批量选择+批量删除、ChatHistory 目录收起/展开、TOC 跳转、项目指令保存。
- 项目：真实删除（临时项目）、分页第 2/3 页、6 平台项目页、只读项目。
- 渠道：UI 新增/编辑/删除、`写入配置`（备份/恢复原生配置）、同步确认后执行、测速、重置、代理启停、拖拽/锁定、按平台清空日志。
- 资源：Skills 创建/审批/开关/磁盘删除、仓库添加/刷新/移除、OMP 设置保存；Plugins 本地市场安装/卸载/README/详情；MCP 新增/编辑/连接测试/详情/删除/平台开关/导出/粘贴解析。
- 内容：工作区完整 CRUD、添加/移除仓库、4 个 CLI 启动；模板预览/应用（临时项目）/编辑/删除/导出；Prompts 创建/编辑/激活/恢复/删除；Commands/Agents/DSH 预设 CRUD。
- 设置/分析：5 个设置分区、主题、端口钳制、高级保存/恢复、安全校验、模型搜索/筛选/新增校验；Analytics 全范围/自定义/指标/图表/全屏/导出/工具+渠道+模型过滤/清除。
- 全局：Logo、导航、全部 Header 图标、更多菜单、帮助、GitHub/导出弹窗行为。

## 3. 执行期间发现并已修复

| 问题 | 修复 | 验证 |
|---|---|---|
| 会话别名刷新后消失 | store 从 session 行派生 aliases，兼容缺失的顶层 `aliases` map | 别名 reload 后仍显示；单测 2 例 |
| OMP Fork 不产生新会话 | 复制时重写 `type:"session"` 头部 id；支持 fork alias | 新 id 建立索引；API `alias` 返回；清理完成 |
| 技能开关全部被禁用（回归） | 恢复“缺失 projection 可切换”，仅 `state==='unsupported'` 阻止 | `/skills?platform=omp` 0 个禁用开关 |
| 组合筛选返回超集（回归） | 过滤结果为空时不得回退到未过滤日聚合 | dsh 127M、channel 2.41B、组合 0（≤ 两者） |
| 设置抽屉无可见关闭按钮 | 侧栏新增 28×28 `关闭设置` 按钮 | 点击后抽屉数 0 |
| 代理启动失败无 toast | 新增 `formatErrorMessage` 兼容驱动错误对象 | 单测 4 例；Layout/ChannelColumn 使用 |
| 前端并行测试超时 | `testTimeout/hookTimeout=15s` | 全量 56 文件通过 |

## 4. 尚未修复的新缺陷（按严重度）

### High

1. **Codex 会话搜索间歇返回 0 / 索引陈旧**：同一关键词先有结果后变空；删除的 fork 仍可被搜索到，返回不存在的 `filePath`。
2. **OMP 索引缺行**：部分现有 session 文件在 `session_file` 无记录，导致 Fork/删除报 500、列表遗漏。
3. **Plugins 仓库列表 500**：存在 `omp-marketplace` 时 `GET /api/plugins/repos` 抛 `Repository owner and name are required`；`normalizeRepoConfig` 不识别该 provider，UI 无法列出/移除 marketplace。

### Medium

4. **MCP 工具列表超时**：连接测试 online，但 `initialize` 10s 超时，工具列表/测试不可用。
5. **模板应用路径限制**：`/tmp/...` 目录必须先注册为已知项目/工作区，UI 文案却允许任意路径。
6. **模板 Skill 静默无效**：结果显示 `1 Skills` 并写入 `.ctx-config.json`，但目标目录没有 skill 产物。
7. **DSH 渠道余额不显示**：`channel-balances` 返回可见，但通用面板未渲染。
8. **DSH Home 列代理端口为空**：运行中状态不显示 20093。
9. **弹窗类动作无兜底**：导出 CSV/JSON、GitHub 在 `window.open` 失败时静默关闭，无提示。

### Low

10. 工作区创建后列表不自动刷新（需点“刷新”），DOM 中存在重复 WorkspacePanel 实例。
11. 插件安装后约 30s 才出现在列表，README 立即打开为空。
12. DSH 插件 README 后端恒返回空字符串。
13. DSH `写入配置` 按钮在当前构建中 `display:none`（源码/manifest 支持）。
14. 会话列表首次进入偶发 0 条，重载后正常（与索引初次构建竞态）。
15. Analytics 30d 初次加载偶发显示旧 3d 数据；快速主题切换仍偶发服务端/本地不一致。

## 5. 未执行 / 受限

| 项 | 原因 |
|---|---|
| 配置导入 | 原生文件选择器，headless 无法驱动 |
| 通知保存/测试 | 外部投递服务/凭据 |
| 开机自启 | OS 状态，策略禁止 |
| 密码启用/解锁 | 面板锁死风险 |
| 插件外置 npm 安装/卸载 | 策略禁止安装外部包 |
| 资源型模板创建/应用、OMP 命令 CRUD | 时间盒未执行（不是失败） |
| 面板显示开关 | 并发执行期间禁止修改全局可见性 |

## 6. 清理状态

- `QA-EXEC*` 项目/会话/别名/渠道/MCP/工作区/模板/Prompts/Commands/Agents/技能/插件市场：全部删除。
- 原生配置（claude/codex/gemini/opencode/omp/dsh）与测试前 sha256 一致；代理全部停止。
- `enabledCliPlatforms=["codex","omp","dsh"]`、主题 light、面板 true/true、无锁。
- 临时目录 `/tmp/qa2` 中的夹具已清；报告与截图保留。

## 7. 测试结果

| 套件 | 结果 |
|---|---|
| 后端 `npx vitest run` | **232 文件 / 3160 测试通过** |
| 前端 `cd src/web && npx vitest run` | **57 文件 / 232 测试通过** |

- 新增回归：别名派生、OMP fork 头部/别名、组合过滤、技能开关、设置关闭、错误文案、项目管理注册表、日志缓存。
- 部署：`npm run build:web` + `npm install -g .` + PM2 `cc-tool` 重启；当前 :19999 为新构建。
