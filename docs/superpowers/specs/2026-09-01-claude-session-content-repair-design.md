# Claude Code 会话内容读取修复设计

## 问题

Claude Code 项目和会话列表偶发为空；进入项目后，详情提示“暂未读取到对话内容”，或所有消息为空；内容搜索也无法命中。该现象只影响 Claude Code。

## 根因证据

Claude Code 的 JSONL 记录把实际消息放在 `json.message` 下：

- 用户消息内容位于 `json.message.content`；
- 助手消息内容、模型和消息 ID 也位于嵌套消息对象；
- 当前 `src/server/services/session-history-adapters/claude.js` 主要读取顶层 `json.content`、`json.model` 等字段。

因此历史索引能够发现文件，却把真实消息写成空内容，导致首条消息为空、全文搜索无结果、详情索引直接返回空消息。旧的直读路径已经按嵌套字段解析，但索引快捷路径会优先截获请求。

另外，已有索引按文件大小和 mtime 判断是否需要解析。仅修复解析器不会自动修复已经写入数据库的空消息。详情直读回退还依赖 `hasActualMessages`，该导出在索引重构后丢失。

## 目标

1. 正确读取当前 Claude Code JSONL 的嵌套用户和助手消息。
2. 自动修复已有的旧格式空索引，不要求用户手工删除数据库。
3. 保证索引未完成时不会把临时空结果当成最终空列表或空详情。
4. 保留已有索引的快速读取和分页能力。
5. 对索引未命中、旧文件或仅包含文件快照的会话，提供可靠的直读回退。
6. 用回归测试锁定嵌套消息、旧索引重解析、搜索和详情行为。

## 非目标

- 不改变 Codex、Gemini、OpenCode 或 OMP 的会话格式。
- 不重新设计项目/会话列表 UI。
- 不在启动时无条件删除整个历史数据库。
- 不改变 Claude Code 原始 JSONL 文件。

## 设计

### 1. 统一 Claude 消息归一化契约

在 `src/server/services/session-history-adapters/claude.js` 中统一定义索引所需的 Claude JSONL 字段读取规则：

- envelope 的 `type` 和嵌套 `message.role` 共同确定角色；
- 内容读取 `json.content ?? json.message.content`；
- ID、模型、provider、时间戳读取顶层字段，并以嵌套消息字段作为回退；
- 字符串内容直接保留；数组内容提取文本、图片、工具调用、工具结果和思考块，保持现有 UI 可展示的文本语义；
- 用户消息的 `userMessageNumber` 只在存在实际可展示用户文本时递增；
- `firstMessage` 取第一条非空用户文本；
- 元数据记录仍跳过，不把 `summary`、`file-history-snapshot` 等非对话记录当成正常聊天内容。

详情直读路径继续使用现有嵌套字段解析，并按相同字段优先级和可展示内容规则输出。两条路径共享同一归一化契约，避免列表、搜索、详情显示不同内容。

### 2. 为索引行增加解析格式版本

在 `session_file` 增加 `parser_version` 整数字段，并定义按 source 区分的当前 session parser 版本：

- 初始化旧数据库时通过 `PRAGMA table_info` 检测缺失字段，再执行兼容的 `ALTER TABLE`；旧行默认版本为 `0`；
- 新写入行记录该 source 的当前 parser 版本；
- inventory 比较文件 fingerprint 时同时比较 parser 版本；版本过旧即使 size/mtime 未变也重新解析；
- 只重解析受影响的 session 文件，不清空其他平台索引；
- 重新解析完成后再更新 source freshness，避免半成品被当成新鲜数据。

这样用户升级后下一次访问会自动回填历史消息，且不会依赖手工清理 `session-history.sqlite`。


### 3. 冷启动与索引回退

保留已有数据时的 `stale-ok` 快速路径，但收紧“无数据”场景：

- list projects、list sessions、recent 和 detail 查询在发现对应数据不存在且该 source 有进行中的 inventory 时，等待同一个 in-flight inventory 完成；
- inventory 失败时向上抛出错误，不返回可缓存的空成功结果；
- 已有旧数据仍可先展示，并由后台刷新更新；真正没有会话时，只有 inventory 完成后才返回空列表；
- `getSessionStatus`、`getSessionOutline`、`getMessagePage` 在索引 miss 后允许 API 继续走原始文件回退。

项目/会话 snapshot 只缓存已完成的有效 payload；后台刷新中的 fallback 仍带有 `refreshing`/`stale` 元数据，前端保持加载状态并继续已有轮询机制。

### 4. 恢复 Claude 原始文件回退

在 `src/server/services/sessions.js` 恢复并导出 `hasActualMessages(filePath)`，判断文件中是否存在真实 user/assistant 对话记录，而不是只存在文件历史快照。详情 API 在索引未命中时继续走现有直读路径；该路径读取嵌套消息内容、工具结果和分页数据。

Claude 全局搜索对 Claude source 的索引错误不再静默吞掉并伪装成“没有匹配”；其他平台仍可按现有 best-effort 规则处理。这样用户能看到实际错误，而不是误判搜索为空。

## 数据流

```text
Claude JSONL
  -> Claude adapter（解析 json.message + 版本标记）
  -> session-history.sqlite
  -> projects/sessions/search/detail API
  -> 前端列表、搜索结果、ChatHistoryDrawer
```

详情请求优先读取索引；索引 miss、文件不完整或索引读取失败时回到原始 JSONL。索引版本变更触发一次增量重解析，不改变源文件。

## 错误处理

- 单个损坏 JSONL 行沿用跳过策略；单个文件解析失败不阻塞同 source 的其他有效文件，并记录 source error。
- 索引写入保持现有事务语义，写入失败整体回滚。
- worker、adapter 和 API 保留结构化错误上下文；不使用空数组作为失败 fallback。
- 仅文件快照的会话不会被当作有聊天内容的详情返回。

## 测试策略

新增或补充以下行为测试，均先写成失败测试再实现：

1. Claude adapter 能从嵌套 `message.content` 读取用户/助手文本、ID、模型和工具块，且生成正确 `firstMessage` 与用户序号。
2. 已有 `parser_version` 过旧的 session 在文件 size/mtime 不变时仍会重新解析，并可被搜索和详情读取。
3. 冷启动 inventory 尚未完成时，列表/详情不会提前稳定返回空数据；inventory 完成后返回真实记录。
4. 索引 miss 时，详情 API 的直读回退能读取嵌套消息；仅文件快照会返回明确的无对话响应。
5. Claude 内容搜索能命中嵌套用户/助手文本，索引失败会暴露错误而不是返回空结果。
6. 现有项目、会话分页、删除、实时状态和非 Claude 平台测试保持通过。

验证顺序：针对性单测红灯 → 最小实现绿灯 → 受影响测试集 → 启动实际 Web API，验证项目列表、会话列表、搜索和打开详情四条路径。
