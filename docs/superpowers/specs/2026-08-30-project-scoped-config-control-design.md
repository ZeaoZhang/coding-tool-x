# Project-Scoped AGENTS, Skills, and MCP Control Design

## Goal

在现有“项目 → 历史会话”页面中，为单个项目提供项目级配置管理：

- 管理项目指令文件，首要场景是 Codex 的 `AGENTS.md`；
- 管理项目级 Skills；
- 管理项目级 MCP 服务器；
- 保持 CLI 原生文件为事实来源，让配置可随项目进入 Git；
- 不改变现有用户级资源管理语义，也不把项目配置绑定到工作区 ID。

“工作区”在本设计中只负责项目分组、发现和路径白名单。项目配置的稳定标识是经过 `realpath` 规范化的绝对项目路径。

## Current Context

当前项目已经具备部分可复用能力：

- `src/server/services/workspace-service.js` 管理 `~/.cc-tool/config/workspaces.json`，工作区内包含项目目录、软链接或 Git worktree；
- `AgentsService` 和 `CommandsService` 已使用 `user/project + projectPath` 作用域模型；
- `SkillService` 已按 `cwd` 缓存列表，OMP 已实现多来源项目级 Skill 发现；
- `mcp-service.js` 主要管理中心 MCP 记录和各平台用户级配置；
- `config-templates-service.js` 能一次性把部分内容落盘到项目目录，但不是持续的项目配置管理器；
- `project-path-validation.js` 已将已登记项目、工作区和当前目录作为合法 cwd 来源；
- 平台 Manifest、Registry 和 Capability Driver 已提供平台差异的扩展接缝。

现有 `AgentsService` 中的 Agent 是代理定义文件，不等于项目指令文件 `AGENTS.md`。两者必须保持不同模块和不同 UI 语义。

## Scope

### Included

- 项目级指令文件的读取、编辑、保存和存在状态；
- 项目级 Skills 的列出、详情查看、创建、从仓库安装、编辑和删除；
- 项目级 MCP 的列出、从中心目录添加、编辑、测试和移除；
- 当前平台的默认选择，以及平台能力矩阵；
- SessionList 项目页的统一“项目配置”入口；
- 复用项目路径校验、原子写入、现有远程仓库和 MCP 转换逻辑；
- 配置模板通过同一项目配置写入能力工作，而不成为项目配置的事实来源；
- 项目配置 API、服务单元测试、API 测试和前端行为测试。

### Excluded

- 不以 `workspaceId` 保存项目配置；
- 不新增项目级中心 manifest 作为事实来源；
- 不把项目配置复制到用户级目录；
- 不把 `AGENTS.md` 接入 `AgentsService`；
- 不在首版实现“禁用继承的用户级 Skill/MCP”的项目 denylist；
- 不支持在任意项目子目录自动创建多层 `AGENTS.md`；首版只管理平台声明的项目根级指令文件；
- 不改变现有用户级 MCP `/api/mcp/servers` 的响应和写入语义；
- 不通过写入一个通用但 CLI 不识别的文件来伪造平台支持。

## Design Decisions

### Native project files are authoritative

项目级配置直接写入对应 CLI 的原生项目文件。中心 `~/.cc-tool` 只继续保存：

- 用户级 Skills、Agents、Commands、Plugins；
- MCP 服务器目录和预设；
- 仓库源、缓存和 UI 配置；
- 工作区元数据。

项目级配置读取时以磁盘内容为准。项目文件被用户或其他工具手动修改后，下一次读取必须反映磁盘状态。

### Project path is the configuration identity

所有项目配置 API 接收 `projectPath`，但服务内部必须执行：

```text
validateKnownProjectCwd(projectPath)
  -> realpath(projectPath)
  -> platform target resolution
  -> root containment validation
```

项目路径不能使用显示名、历史会话路由参数或工作区名称替代。一个项目加入多个工作区时仍共享同一项目配置。

### “移除项目配置”不等于“禁用用户级配置”

第一版只管理项目目录中的实际文件：

- 删除项目 Skill 只删除项目 Skill 目录；
- 删除项目 MCP 只删除项目配置中的对应 key；
- 删除项目指令文件只删除该项目文件；
- 用户级同名配置不受影响。

如果 CLI 会在项目级配置缺失时继续使用用户级配置，移除项目项后用户级配置重新生效。第一版 UI 使用“移除项目配置”而不是含义不明确的“禁用”。

### Project-level state is not a second registry

`.ctx-config.json` 继续作为模板应用记录，但不能决定项目当前有哪些 Skill 或 MCP。项目配置页始终扫描原生文件；模板只调用相同的项目写入用例。

## Domain Model

```js
ProjectConfigSnapshot {
  projectPath: string,       // canonical absolute realpath
  platform: string,
  instruction: {
    supported: boolean,
    path: string | null,     // project-relative path
    exists: boolean,
    content: string,
    updatedAt: number | null
  },
  skills: {
    supported: boolean,
    project: SkillSummary[],
    inherited: SkillSummary[]
  },
  mcp: {
    supported: boolean,
    path: string | null,
    servers: ProjectMcpServer[]
  },
  capabilities: {
    instruction: boolean,
    skills: boolean,
    mcp: boolean
  }
}
```

`SkillSummary` 和 `ProjectMcpServer` 可以携带平台特有字段，但通用字段必须包含：

- `name` 或 `id`；
- `scope` (`project` 或 `user`)；
- `source`；
- `installed` / `enabled`；
- 项目相对路径或原生配置路径；
- 可展示的描述和更新时间。

`inherited` 仅用于展示用户级同名或可用配置，不代表项目配置服务拥有删除权。

## Platform Project Mapping

平台适配器必须声明项目文件、Skill 根目录、MCP 文件和支持状态。前端消费公开能力，不硬编码路径。

| Platform | Instruction | Project skills root | Project MCP | Initial support |
| --- | --- | --- | --- | --- |
| Claude | `CLAUDE.md` | `.claude/skills/` | `.mcp.json` | instruction / skills / MCP |
| Codex | `AGENTS.md` | `.agents/skills/` | `.codex/config.toml` 的 `[mcp_servers]` | instruction / skills / MCP |
| Gemini | `GEMINI.md` | `.gemini/skills/` | `.gemini/settings.json` 的 `mcpServers` | instruction / skills / MCP |
| OpenCode | Manifest 声明的项目指令文件，默认兼容 `.opencode/AGENTS.md` | `.opencode/skills/` | `.opencode/opencode.json` | instruction / skills / MCP |
| OMP | 无单独项目指令文件 | `.omp/skills/` | `.omp/mcp.json` | skills / MCP |

平台适配规则：

- Codex 的项目 Skill 以官方 `.agents/skills/` 为首选；读取时兼容现有代码已经发现的 `.codex/skills/`，写入时只选择一个明确的 canonical root；
- Codex 项目 MCP 写入 `.codex/config.toml`，保留其他配置和未知字段；项目配置仅在 CLI 信任项目后生效；
- Gemini 项目 MCP 修改 `.gemini/settings.json` 的 `mcpServers`，保留其他 settings；
- OpenCode 适配器读取现有 `mcp` 结构，写入时遵循当前项目 Manifest/CLI 版本所声明的结构，不能无条件把新旧格式混合；
- OMP 没有独立项目指令文件，必须返回 `instruction: unsupported`，不能生成空的 `AGENTS.md`；
- 任何平台能力无法由当前 CLI 原生文件可靠表达时，返回 `unsupported`，不能返回空成功。

## Architecture

```text
SessionList / Config Template / HTTP API
                    |
                    v
         ProjectConfigService
       (path, scope, atomic writes,
        snapshot, error normalization)
                    |
                    v
       Project Config Adapter Registry
                    |
       +------------+------------+
       v            v            v
  Instructions   Skills       MCP
  adapter        target       format adapter
                 resolver
                    |
                    v
        Platform-native project files
```

### ProjectConfigService

新增 `src/server/services/project-config-service.js`，作为项目级配置的应用用例层，负责：

- 规范化项目路径并拒绝未知路径；
- 根据平台获得项目配置适配器；
- 读取聚合快照；
- 统一处理 supported/unsupported/invalid/failed 结果；
- 约束所有写入目标在项目根目录内；
- 使用临时文件加 rename 的原子写入；
- 让配置模板、项目配置 API 和未来批量操作复用同一写入入口。

该模块的公开接口保持小而稳定：

```text
getSnapshot(projectPath, platform)
readInstruction(projectPath, platform)
writeInstruction(projectPath, platform, content)
listProjectSkills(projectPath, platform)
installProjectSkill(projectPath, platform, input)
removeProjectSkill(projectPath, platform, name)
listProjectMcp(projectPath, platform)
upsertProjectMcp(projectPath, platform, id, spec)
removeProjectMcp(projectPath, platform, id)
testProjectMcp(projectPath, platform, id)
```

调用方不直接拼接 `.claude`、`.codex`、`.gemini`、`.opencode` 或 `.omp` 路径。

### Platform adapters

新增 `src/server/services/project-config-adapters/`。每个适配器只处理一个平台的原生差异：

- `describe()`：公开相对路径、能力和格式；
- `readInstruction()` / `writeInstruction()`；
- Skill 项目根目录和同名覆盖规则；
- MCP 配置读取、规范化、合并、写入和删除；
- 平台特有错误转换。

适配器不访问 HTTP，不操作 UI，不修改用户级中心 MCP 记录。

### Skills integration

现有 `SkillService` 继续负责远程仓库扫描、下载、Skill 内容解析和通用安全校验。项目配置服务为它提供明确的安装目标：

```js
{ scope: 'project', cwd: canonicalProjectPath }
```

需要补齐的行为：

- 所有支持的平台均能列出项目 Skill；
- `listSkills` 的缓存 key 包含 `platform + scope + canonical cwd`；
- 项目 Skill 与用户 Skill 的列表具有明确 `scope`；
- 安装、创建、编辑和删除只对项目目标目录生效；
- `getSkillDetail`、文件读写和删除操作都接受相同作用域；
- 不能通过项目操作修改 `PATHS.localSkills` 或用户级安装目录。

如果继续扩展 `SkillService` 会让全局实现与项目实现互相污染，可将下载逻辑提取为内部 artifact helper，但不新增第二套远程仓库协议。

### MCP integration

新项目 MCP 用例与现有全局 MCP 用例分开：

- 现有 `mcp-service.js` 的中心目录、`apps` 平台开关和用户级同步保持原义；
- 项目适配器读取项目原生配置并把 server spec 规范化为通用 DTO；
- 从中心目录添加只复制 server spec，不改变中心记录的 app flags；
- 编辑项目 MCP 只修改项目原生文件；
- 项目测试直接使用项目配置中的 spec，并以项目路径作为 stdio 默认 cwd；
- 返回前端的 secrets、静态 token、环境变量值和认证 headers 必须脱敏。

MCP 写入必须是结构化合并：只修改目标服务器 key，保留其他顶层字段、schema 字段和未知配置。

## HTTP API

### Aggregate read

```text
GET /api/project-config?projectPath=<absolute>&platform=<platform>
```

返回 `ProjectConfigSnapshot`。`platform` 缺失时使用当前页面平台或服务端默认平台；服务端不能把一个平台的路径当作另一个平台的路径。

### Instructions

```text
GET /api/project-config/instruction?projectPath=...&platform=...
PUT /api/project-config/instruction
Body: { projectPath, platform, content }
```

PUT 返回规范化相对路径、更新时间和是否创建文件。空内容的语义是写入空文件，不代表删除；删除需要显式 DELETE。

### Skills

现有 `/api/skills` 继续保持用户级默认行为，并扩展项目操作使用明确作用域：

```text
GET  /api/skills?platform=...&cwd=...&scope=project
POST /api/skills/install
     { platform, cwd, scope: 'project', directory, fullDirectory, repo }
POST /api/skills/create
     { platform, cwd, scope: 'project', name, directory, description, content }
POST /api/skills/uninstall
     { platform, cwd, scope: 'project', directory }
```

详情和文件 CRUD 也必须接收 `cwd/scope`，不能只在卸载接口支持项目路径。

### MCP

新增明确的项目级端点：

```text
GET    /api/project-config/mcp?projectPath=...&platform=...
PUT    /api/project-config/mcp/:id
       { projectPath, platform, server }
DELETE /api/project-config/mcp/:id
       { projectPath, platform }
POST   /api/project-config/mcp/:id/test
       { projectPath, platform }
```

添加中心目录服务器时，前端先取中心 `mcp-service` 数据，再调用项目 upsert。项目接口不接收或返回中心 `apps` 状态作为项目启用状态。

所有接口统一：

- 使用 `validateKnownProjectCwd`；
- 对平台、scope、资源名和 server spec 做输入校验；
- `unsupported` 使用 200 加结构化状态返回，参数错误和路径越界使用 400/403；
- 错误响应不包含未经脱敏的配置值。

## Web UI

在 `src/web/src/views/SessionList.vue` 的项目标题区，把“项目配置”放在现有“管理”按钮旁边。

组件建议：

```text
ProjectConfigDrawer.vue
  ProjectConfigHeader
  ProjectInstructionPanel
  ProjectSkillsPanel
  ProjectMcpPanel
```

组件接收：

```js
{
  projectPath: String,   // store.currentProjectInfo.fullPath
  platform: String       // currentChannel
}
```

界面规则：

- 默认平台跟随当前历史会话平台；
- 可切换到其他已启用平台；
- 每个页签显示 capability 状态和原生目标路径；
- 项目资源显示“项目级”，用户级同名资源显示“继承”；
- 对不支持的平台显示原因和只读状态，不显示可提交的假表单；
- 保存前端指令内容时显示目标文件，MCP/Skill 删除需要显式确认；
- 不在 `ProjectCard` 先复制第二个完整入口，避免与卡片点击和删除操作冲突；
- 如果将来需要从项目卡片快捷进入，只复用同一个抽屉和相同的 `projectPath`。

SessionList 目前使用 `projectName` 作为路由参数，但已有 `store.currentProjectInfo.fullPath` 作为完整路径来源。项目配置请求必须使用后者，并在数据尚未加载时等待项目解析完成。

## Template Integration

`config-templates-service.js` 的模板仍可一次性应用项目配置，但写入必须迁移到 `ProjectConfigService`：

- AI 指令配置调用 `writeInstruction`；
- Skills 调用项目 Skill 安装用例；
- MCP 调用项目 MCP upsert；
- 模板结果保留 applied/skipped 统计；
- `.ctx-config.json` 只记录模板应用来源和结果，不作为资源列表；
- 现有用户级模板应用路径保持兼容。

迁移期间，旧模板逻辑可保留内部转换函数，但同一项目配置不能同时由两套写入实现竞争。

## Security and Error Handling

### Path safety

每个项目写入都必须满足：

- 输入为绝对目录；
- 目录属于 `getKnownProjectPaths()`；
- 使用 `realpath` 后仍为合法项目；
- 目标相对路径不能包含 `..`、绝对路径或 NUL；
- 目标根目录及已有路径组件不能通过符号链接逃逸；
- 服务端不接受前端传入的任意目标文件路径作为写入位置。

同时修复 `src/server/api/workspaces.js` 的 `/read-file`：允许文件名校验之外，必须验证文件位于已登记工作区或项目根目录内。

### Atomic and non-destructive writes

- 文本、JSON 和 TOML 写入使用临时文件加 rename；
- JSON/TOML 修改采用读-改-写，保留未知字段；
- 项目 Skill 删除不触碰用户目录；
- 全局 MCP 删除不由项目 MCP 路由触发；
- 写入失败必须向调用方返回明确错误，不能记录成功状态或只打印日志。

### Secrets

- 项目 MCP 配置中的环境变量值、静态 token 和 headers 只在本地文件中使用；
- API 响应默认返回是否存在和脱敏预览，不返回完整 secret；
- UI 提醒把静态 secret 写入项目文件可能进入 Git；
- 测试日志和错误对象不能打印完整 MCP spec。

## Verification Plan

### Service tests

新增或扩展服务测试，覆盖：

1. 项目路径必须来自已知项目，未知路径、文件路径、相对路径和路径穿越均失败；
2. 指令文件按平台读写，OMP 返回 unsupported；
3. 项目 Skills 的列表、缓存、同名覆盖和删除作用域正确；
4. Codex 使用 `.agents/skills` canonical root，并兼容读取旧探测目录；
5. Skills 项目安装不会写入用户级安装目录；
6. 各平台 MCP 读写只修改目标 key，并保留未知字段；
7. Codex 项目 MCP 写入 `.codex/config.toml` 的 `[mcp_servers]`；
8. 项目 MCP 测试使用项目 cwd；
9. 项目 MCP 变更不会调用全局中心记录写入，也不会修改 `apps`；
10. secret 脱敏结果不包含原始值；
11. 原子写入失败返回失败状态，不留下伪成功记录。

### API tests

覆盖：

- aggregate snapshot 的平台和 scope；
- projectPath 规范化及未知路径拒绝；
- instruction/skills/MCP 的成功、unsupported、invalid 和 failed 状态；
- MCP 项目路由不会改变旧全局 MCP API 的结果；
- `/api/workspaces/read-file` 不能读取工作区外的允许 basename 文件；
- 远程写入策略继续遵循现有服务配置。

### Web tests

覆盖：

- SessionList 使用 `currentProjectInfo.fullPath` 打开项目配置；
- 当前平台默认选择正确；
- 平台切换会重新加载项目快照；
- unsupported 能力不显示提交控件；
- 删除项目资源不会触发会话删除或工作区删除；
- 快速连续打开不同项目时，旧请求结果不会覆盖当前项目状态。

### Smoke scenario

使用临时 Git 项目和五个平台的临时配置目录执行：

1. 从项目历史页打开“项目配置”；
2. 创建并保存项目指令；
3. 安装一个项目 Skill，刷新页面后仍可见；
4. 添加、测试、移除一个项目 MCP；
5. 手动修改原生文件，刷新页面后看到手动修改；
6. 启动对应 CLI 的项目 cwd，确认 CLI 能读取已支持的项目文件；
7. 检查用户级 MCP、Skill 和其他项目文件未被改动。

## Migration and Rollout

1. 先增加平台项目能力声明、路径校验和 `ProjectConfigService` 读快照能力；
2. 接入 Codex `AGENTS.md` 和 Codex 项目 `.codex/config.toml`，同时完成通用适配器接口；
3. 接入五个平台的项目 Skills，统一现有 OMP `cwd` 语义；
4. 接入五个平台的项目 MCP；不支持的格式保持显式 unsupported；
5. 将 SessionList 项目入口接入聚合 API；
6. 将配置模板写入路径切换到项目配置服务；
7. 修复工作区文件读取路径边界；
8. 完成服务、API、Web 测试和真实 CLI smoke；
9. 在确认新路径行为稳定后，删除旧的项目级重复写入分支。

不需要迁移已有用户级配置，也不需要修改现有 `workspaces.json` 数据格式。

## References

- Codex project configuration: <https://developers.openai.com/codex/config-reference>
- Codex MCP configuration: <https://developers.openai.com/codex/mcp>
- Codex project Skills: <https://developers.openai.com/codex/skills>
- Open Agent Skills specification: <https://agentskills.io/specification>
