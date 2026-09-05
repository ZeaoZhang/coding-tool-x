# Codex 项目扫描 500 修复设计

## 问题

Codex 项目扫描请求进入会话历史索引的生产 Worker 路径时，Worker 文件在完成 `module.exports` 前执行 `attachWorkerHandler()`。Worker 初始化再次加载 `session-history-index`，形成循环加载，导致 `_defaultWorkerRunner` 获取到的 `runInventoryWorker` 为 `undefined`，最终项目列表请求返回 500。

## 目标

- Codex 项目扫描恢复正常，返回项目列表而不是 500。
- 保留会话索引 Worker 的进程隔离与现有生产路径。
- 添加回归测试，覆盖 Worker 导出完成后再启动初始化的契约。

## 方案

让 `runInventoryWorker()` 在 fork 子进程时显式设置 `CC_TOOL_SESSION_HISTORY_CHILD=1`。Worker 子进程因此直接执行本地索引，不再再次启动 Worker，消除生产路径中的递归循环加载。保留现有 Worker IPC、错误序列化和进程隔离。

同时保留 Worker 文件现有导出顺序，不扩大改动范围；回归测试从真实父进程调用 `runInventoryWorker()`，验证子进程能完成 Codex 索引。
不修改索引 API、Codex 文件解析逻辑或缓存策略；不以禁用 Worker 作为绕过方案。

## 验证

1. 新增测试直接加载 Worker 模块，确认导出函数可用且普通 require 不会启动 Worker。
2. 使用当前用户 Codex 数据调用 `getProjects()`，确认扫描成功并返回数组。
3. 运行相关单元测试及项目 API 一致性测试。
