# Codex CLI 支持开发计划

## 📋 项目目标
为 coding-tool 添加 Codex CLI 支持，实现与 Claude Code 相同的项目管理、会话管理功能。

---

## 🎯 开发阶段划分

### 阶段 1：数据读取与解析（基础）
> 目标：能够读取和解析 Codex CLI 的本地数据

- [ ] **1.1 创建 Codex 配置读取服务**
  - 文件：`src/server/services/codex-config.js`
  - 功能：读取 `~/.codex/config.toml` 和 `~/.codex/auth.json`
  - 返回：当前配置的 model_provider、model 等信息

- [ ] **1.2 创建 Codex 会话解析服务**
  - 文件：`src/server/services/codex-sessions.js`
  - 功能：
    - 扫描 `~/.codex/sessions/YYYY/MM/DD/` 目录
    - 解析 JSONL 文件的 `session_meta` 获取会话信息
    - 从 `cwd` 或 `git.repository_url` 提取项目信息
    - 聚合生成项目列表

- [ ] **1.3 创建会话内容解析器**
  - 文件：`src/server/services/codex-parser.js`
  - 功能：
    - 解析 JSONL 文件，提取对话内容（`response_item`）
    - 归一化消息格式（user/assistant）
    - 提取 Token 统计信息（`event_msg` 中的 `token_count`）

---

### 阶段 2：API 接口开发（核心）
> 目标：提供完整的 Codex 数据 API

- [ ] **2.1 创建 Codex 项目 API**
  - 文件：`src/server/api/codex-projects.js`
  - 接口：
    - `GET /api/codex/projects` - 获取所有项目列表
    - `GET /api/codex/projects/:projectName` - 获取项目详情

- [ ] **2.2 创建 Codex 会话 API**
  - 文件：`src/server/api/codex-sessions.js`
  - 接口：
    - `GET /api/codex/sessions/:projectName` - 获取项目的所有会话
    - `GET /api/codex/sessions/:projectName/:sessionId` - 获取会话详情
    - `GET /api/codex/sessions/:projectName/:sessionId/messages` - 获取对话消息（分页）
    - `POST /api/codex/sessions/:projectName/:sessionId/fork` - Fork 会话
    - `POST /api/codex/sessions/:projectName/:sessionId/launch` - 启动会话（打开终端）
    - `DELETE /api/codex/sessions/:projectName/:sessionId` - 删除会话

- [ ] **2.3 创建 Codex 搜索 API**
  - 文件：扩展 `src/server/api/codex-sessions.js`
  - 接口：
    - `GET /api/codex/sessions/:projectName/search?keyword=xxx` - 项目内搜索
    - `GET /api/codex/sessions/search/global?keyword=xxx` - 全局搜索

- [ ] **2.4 创建最近会话 API**
  - 文件：扩展 `src/server/api/codex-sessions.js`
  - 接口：
    - `GET /api/codex/sessions/recent/list?limit=10` - 获取最近的会话

- [ ] **2.5 集成到主路由**
  - 文件：`src/server/index.js`
  - 添加：
    ```javascript
    app.use('/api/codex/projects', require('./api/codex-projects')(config));
    app.use('/api/codex/sessions', require('./api/codex-sessions')(config));
    ```

---

### 阶段 3：前端页面开发（展示）
> 目标：实现与 Claude Code 相同的可视化界面

- [ ] **3.1 创建 Codex 项目列表页面**
  - 文件：`src/web/src/views/CodexProjectList.vue`
  - 功能：
    - 显示所有 Codex 项目（卡片式布局）
    - 显示项目路径、Git 仓库、分支信息
    - 显示会话数量
    - 点击进入会话列表
    - 支持拖拽排序

- [ ] **3.2 创建 Codex 会话列表页面**
  - 文件：`src/web/src/views/CodexSessionList.vue`
  - 功能：
    - 显示项目下的所有会话
    - 显示会话时间、Git 分支、Token 使用
    - 显示会话预览（第一条用户消息）
    - 支持 Fork、删除、启动会话
    - 支持拖拽排序

- [ ] **3.3 添加顶部导航切换**
  - 文件：`src/web/src/components/Layout.vue`
  - 功能：
    - 添加 Claude Code / Codex CLI 切换标签
    - 切换时路由跳转到对应的项目列表

- [ ] **3.4 创建 Codex API 客户端**
  - 文件：`src/web/src/api/codex.js`
  - 功能：封装所有 Codex API 请求

---

### 阶段 4：搜索功能（增强）
> 目标：实现全局搜索和项目内搜索

- [ ] **4.1 适配全局搜索组件**
  - 文件：`src/web/src/components/GlobalSearch.vue`
  - 功能：
    - 支持搜索 Claude Code 和 Codex CLI
    - 显示搜索结果来源（Claude/Codex）
    - 点击结果跳转到对应页面

- [ ] **4.2 项目内搜索**
  - 在会话列表页面添加搜索框
  - 调用项目内搜索 API

---

### 阶段 5：Fork 功能（核心）
> 目标：实现会话 Fork 功能

- [ ] **5.1 实现后端 Fork 逻辑**
  - 文件：`src/server/services/codex-sessions.js`
  - 功能：
    - 读取原会话的所有内容
    - 生成新的会话 ID（UUID v7）
    - 创建新的 JSONL 文件
    - 写入 `session_meta`（添加 `forked_from` 字段）
    - 复制原会话的所有 `response_item`

- [ ] **5.2 前端 Fork 按钮**
  - 在会话列表中添加 Fork 按钮
  - 调用 Fork API
  - 成功后刷新会话列表

---

### 阶段 6：终端启动功能（集成）
> 目标：点击会话可以在终端中启动

- [ ] **6.1 Codex 启动命令生成**
  - 文件：`src/server/services/terminal-detector.js`
  - 功能：生成 `codex -r <sessionId>` 命令
  - 使用现有的终端配置

- [ ] **6.2 会话启动 API**
  - 实现 `POST /api/codex/sessions/:projectName/:sessionId/launch`
  - 在会话的 `cwd` 目录下启动终端
  - 执行 `codex -r <sessionId>` 命令

---

### 阶段 7：统计集成（可选）
> 目标：将 Codex 的 Token 统计集成到现有系统

- [ ] **7.1 Codex Token 归一化**
  - 文件：`src/server/services/statistics-service.js`
  - 功能：
    - 解析 Codex 的 `token_count` 事件
    - 归一化字段：
      ```
      input_tokens -> input
      cached_input_tokens -> cacheRead
      output_tokens -> output
      reasoning_output_tokens -> reasoning
      ```

- [ ] **7.2 统计 API 扩展**
  - 支持查询 Codex 的统计数据
  - 在统计面板中显示 Codex 的 Token 使用

---

### 阶段 8：Git 信息展示（增强）
> 目标：展示会话关联的 Git 信息

- [ ] **8.1 显示 Git 分支**
  - 在会话列表中显示分支标签
  - 在会话详情中显示完整 Git 信息

- [ ] **8.2 Git 仓库链接**
  - 解析 `git.repository_url`
  - 如果是 GitHub/GitLab，生成可点击链接

---

### 阶段 9：优化与测试（收尾）
> 目标：优化性能和用户体验

- [ ] **9.1 性能优化**
  - 缓存项目列表（避免每次都扫描全部会话）
  - 使用 `history.jsonl` 加速搜索
  - 分页加载会话消息

- [ ] **9.2 错误处理**
  - 处理 Codex 未安装的情况
  - 处理会话文件损坏的情况
  - 友好的错误提示

- [ ] **9.3 用户体验优化**
  - 加载状态提示
  - 空状态提示
  - 操作成功/失败提示

---

## 🔄 开发顺序建议

### 推荐顺序（从底层到上层）：

```
阶段 1 (数据层)
  → 阶段 2 (API层)
  → 阶段 3 (UI层)
  → 阶段 4 (搜索)
  → 阶段 5 (Fork)
  → 阶段 6 (终端)
  → 阶段 7 (统计)
  → 阶段 8 (Git)
  → 阶段 9 (优化)
```

### 最小可用版本（MVP）：
- 阶段 1 + 阶段 2 (1.1, 1.2, 2.1, 2.2) + 阶段 3 (3.1, 3.2, 3.3)
- 能查看项目、会话、对话内容即可

### 完整功能版本：
- 所有阶段完成

---

## 📝 注意事项

### 1. 数据格式差异
- Codex 使用 JSONL 格式，每行一个 JSON 对象
- 需要按行解析，不能直接 `JSON.parse` 整个文件

### 2. 项目聚合逻辑
- Codex 没有独立的项目文件夹
- 需要从会话的 `cwd` 或 `git.repository_url` 提取项目
- 同一项目可能有不同的 `cwd` 路径（子目录）

### 3. 会话 ID 格式
- Codex 使用 UUID v7：`019aaaa5-a6e5-7450-b9f7-4330a509f0f8`
- Claude Code 使用时间戳+UUID：`1732262366818-e6b8c4d0-a5b2-11ef-8b5a-0242ac120002`

### 4. Token 字段映射
```javascript
// Codex -> 统一格式
{
  input_tokens: xxx,           → input
  cached_input_tokens: xxx,    → cacheRead
  output_tokens: xxx,          → output
  reasoning_output_tokens: xxx,→ reasoning
  cache_creation_input_tokens: xxx → cacheCreation
}
```

### 5. Fork 实现细节
- Codex CLI 原生不支持 Fork
- 需要我们自己实现：复制会话 + 添加 `forked_from` 标记
- 新会话在 Codex CLI 中会被当作独立会话

---

## ✅ 验收标准

每个功能完成后需要验证：

- [ ] **项目列表**：显示所有 Codex 项目，数量准确
- [ ] **会话列表**：显示项目下所有会话，时间排序正确
- [ ] **会话详情**：能查看完整对话内容
- [ ] **搜索功能**：能搜索到关键词，结果准确
- [ ] **Fork 功能**：Fork 后生成新会话，内容一致
- [ ] **终端启动**：点击启动能正确打开终端并执行 codex 命令
- [ ] **Git 信息**：显示分支、仓库信息
- [ ] **统计数据**：Token 统计准确

---

**预计总工作量：** 2-3 天（全职开发）

**核心难点：**
1. 项目聚合逻辑（从分散的会话中提取项目）
2. Fork 功能实现（Codex 原生不支持）
3. Token 统计归一化（字段映射）
