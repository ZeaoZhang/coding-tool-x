# 模型重定向功能

## 功能概述

模型重定向功能允许在代理模式下自动将高成本模型请求重定向到低成本模型，从而节省 token 消耗。

例如：将 `claude-opus-4` 重定向到 `claude-sonnet-4-5`，可以大幅降低成本，同时保持良好的性能。

## 使用场景

- GitHub 插件或 oh-my-claudecode skills 默认使用 opus 模型
- 修改这些插件/skills 的模型配置过于复杂
- 希望在不修改代码的情况下降低 token 消耗

## 工作原理

### 双重语义

`modelConfig` 字段根据代理状态有不同的含义：

| 代理状态 | 语义 | 行为 |
|---------|------|------|
| **代理关闭** | 模型映射 | 写入 `~/.claude/settings.json`，Claude Code CLI 读取环境变量 |
| **代理开启** | 模型重定向 | 在代理服务器中拦截请求，修改 `model` 字段 |

### 重定向规则

1. **层级检测**：根据模型名称检测层级（opus/sonnet/haiku）
2. **优先级匹配**：
   - 优先使用层级特定配置（如 `opusModel`）
   - 回退到通用配置（`model`）
   - 无配置则保持原样

### 示例

**配置**：
```json
{
  "modelConfig": {
    "opusModel": "claude-sonnet-4-5",
    "sonnetModel": "",
    "haikuModel": ""
  }
}
```

**重定向结果**：
- `claude-opus-4-20250514` → `claude-sonnet-4-5`
- `claude-sonnet-4-5` → `claude-sonnet-4-5`（不变）
- `claude-3-5-haiku-20241022` → `claude-3-5-haiku-20241022`（不变）

## 配置方法

### 1. 官方渠道

在渠道编辑面板中，展开 **"模型重定向"** 部分：

- **Haiku 重定向**：将所有 haiku 模型重定向到指定模型
- **Sonnet 重定向**：将所有 sonnet 模型重定向到指定模型
- **Opus 重定向**：将所有 opus 模型重定向到指定模型（推荐配置为 sonnet）

### 2. 非官方渠道

在渠道编辑面板中，展开 **"模型配置"** 部分：

- 代理关闭时：作为模型映射使用
- 代理开启时：作为模型重定向使用

## 测试步骤

### 前置条件

1. 启动代理：`ctx proxy start`
2. 配置渠道的模型重定向规则
3. 确保渠道已启用

### 测试用例

#### 测试 1：Opus → Sonnet 重定向

**配置**：
```json
{
  "opusModel": "claude-sonnet-4-5"
}
```

**测试命令**：
```bash
curl -X POST http://localhost:<proxy-port>/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: sk-test" \
  -d '{
    "model": "claude-opus-4-20250514",
    "max_tokens": 100,
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

**预期结果**：
- 控制台输出：`[Model Redirect] claude-opus-4-20250514 → claude-sonnet-4-5 (channel: <渠道名>)`
- 请求成功返回

#### 测试 2：无重定向配置

**配置**：
```json
{
  "opusModel": "",
  "sonnetModel": "",
  "haikuModel": ""
}
```

**测试命令**：同上

**预期结果**：
- 无控制台输出（不重定向）
- 请求使用原始模型

#### 测试 3：Haiku 保持不变

**配置**：
```json
{
  "opusModel": "claude-sonnet-4-5",
  "haikuModel": ""
}
```

**测试命令**：
```bash
curl -X POST http://localhost:<proxy-port>/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: sk-test" \
  -d '{
    "model": "claude-3-5-haiku-20241022",
    "max_tokens": 100,
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

**预期结果**：
- 无控制台输出（haiku 未配置重定向）
- 请求使用原始 haiku 模型

## 实现细节

### 代码位置

- **后端逻辑**：
  - `src/server/proxy-server.js` (Claude 代理)
  - `src/server/codex-proxy-server.js` (Codex 代理)

- **前端 UI**：
  - `src/web/src/components/channel/channelPanelFactories.js`

### 核心函数

```javascript
// 检测模型层级
function detectModelTier(modelName) {
  if (!modelName) return null;
  const lower = modelName.toLowerCase();
  if (lower.includes('opus')) return 'opus';
  if (lower.includes('sonnet')) return 'sonnet';
  if (lower.includes('haiku')) return 'haiku';
  return null;
}

// 应用模型重定向
function redirectModel(originalModel, modelConfig) {
  if (!modelConfig || !originalModel) return originalModel;

  const tier = detectModelTier(originalModel);

  // 优先级：层级特定配置 > 通用模型覆盖
  if (tier === 'opus' && modelConfig.opusModel) {
    return modelConfig.opusModel;
  }
  if (tier === 'sonnet' && modelConfig.sonnetModel) {
    return modelConfig.sonnetModel;
  }
  if (tier === 'haiku' && modelConfig.haikuModel) {
    return modelConfig.haikuModel;
  }

  // 回退到通用模型覆盖
  if (modelConfig.model) {
    return modelConfig.model;
  }

  return originalModel;
}
```

### 请求流程

```
Client Request
    ↓
Proxy Server (allocate channel)
    ↓
Check req.body.model
    ↓
Apply redirectModel(originalModel, channel.modelConfig)
    ↓
Update req.body.model & req.rawBody
    ↓
Forward to upstream API
```

## 注意事项

1. **仅在代理开启时生效**：代理关闭时，modelConfig 用于模型映射
2. **不修改响应**：只修改请求中的 model 字段，不影响响应
3. **日志记录**：每次重定向都会在控制台输出日志
4. **向后兼容**：未配置重定向时，保持原有行为

## 常见问题

### Q: 为什么我的重定向没有生效？

A: 检查以下几点：
1. 代理是否已启动（`ctx proxy status`）
2. 渠道的 modelConfig 是否正确配置
3. 渠道是否已启用
4. 查看控制台是否有重定向日志

### Q: 可以将 sonnet 重定向到 opus 吗？

A: 可以，但不推荐。重定向的目的是降低成本，将低成本模型重定向到高成本模型会增加开销。

### Q: 重定向会影响响应质量吗？

A: 取决于重定向的目标模型。例如 opus → sonnet 可能会略微降低质量，但通常差异不大。建议根据实际场景测试。

### Q: 可以为不同渠道配置不同的重定向规则吗？

A: 可以。每个渠道都有独立的 modelConfig，可以配置不同的重定向规则。

## 成本节省示例

假设使用 oh-my-claudecode 的 opus 级别 agent：

| 场景 | 原始模型 | 重定向模型 | 输入成本 | 输出成本 | 节省比例 |
|------|---------|-----------|---------|---------|---------|
| 默认 | opus-4 | - | $15/M | $75/M | - |
| 重定向 | opus-4 | sonnet-4-5 | $3/M | $15/M | 80% |

对于大量使用 opus 的场景，成本节省非常显著。
