# 模型目录与定价同步设计

## 状态

已确认设计。

## 问题

当前项目的内置模型与定价主要来自静态文件 `src/config/model-metadata.json`。运行时通过 `src/config/model-metadata.js` 解析，`src/server/utils/pricing.js` 计算成本，并由设置 API 和前端模型设置页面展示、修改。

现状存在三个问题：

1. 内置模型种类和价格需要人工更新，模型文件的 `lastUpdated` 不是自动生成的。
2. Codex、Gemini、OpenCode 代理仍各自保留部分硬编码价格兜底，自动更新后可能出现多份价格不一致。
3. OMP 的渠道目录探测与内置 Metadata 混在一起。OMP 读取内置模型信息时不应依赖网络或外部命令。

目标是收录热门编码模型、每日更新内置快照，并让 OMP 和其他运行时在离线状态下继续获得模型 Metadata。用户在前端保存的自定义值必须始终优先于内置值。

## 目标

- 仅使用 Models.dev 作为外部目录和价格来源。
- 每日自动获取 Models.dev 数据，生成确定性的内置快照，并通过 Pull Request 发布变更。
- 快照随项目发行包发布；普通运行时不访问 Models.dev。
- OMP 的内置 Metadata 获取不需要联网、不要求 Provider Key、不启动外部 OMP 目录命令。
- 收录热门 provider/model family，而不是把 Models.dev 全部模型无条件塞入前端。
- 前端按当前工具过滤模型；Claude、Codex、Gemini 不显示不属于自身工具的模型，OMP/OpenCode 可以显示适配的热门第三方模型。
- 保留现有用户前端修改和自定义模型能力。
- 统一成本计算入口，移除代理中的重复硬编码价格兜底。
- 让价格来源和局限性在 UI 中可见。

## 非目标

- 不接入 LiteLLM、OpenRouter 或其他第二个数据源。
- 不做运行时自动联网刷新。
- 不声称 Models.dev 数据是厂商官方实时价格。Models.dev 是聚合参考目录；本设计接受这一价格语义。
- 不解析各厂商价格页面，也不实现官方价格页面的爬虫。
- 不实现按区域、套餐、批处理、上下文长度、数据驻留或协商折扣的完整账单引擎。
- 不自动删除已经进入项目快照的模型。

## 核心决策

### 单一来源与发行快照

同步器读取 Models.dev 的 provider-scoped API：

```text
https://models.dev/api.json
```

Models.dev 的 API、数据组织方式和 provider-specific model 定义见其官方仓库文档：

- https://models.dev/api.json
- https://github.com/anomalyco/models.dev

同步结果直接写回现有的：

```text
src/config/model-metadata.json
```

不新增运行时数据库或第二份缓存。快照包含来源信息和抓取日期；`lastUpdated` 由同步器生成，而不是人工维护。

同步频率是每日一次，因此价格和模型变更的正常延迟最多约一个同步周期。工作流失败时继续使用上一次成功发布的快照。

### 价格口径

快照价格统一按现有项目约定表示为 USD / 百万 tokens：

```json
{
  "pricing": {
    "input": 3,
    "output": 15,
    "cacheCreation": 3.75,
    "cacheRead": 0.3
  }
}
```

Models.dev 的 `cost.input`、`cost.output`、`cost.cache_read`、`cost.cache_write` 映射到上述字段。当前项目无法表达的按上下文或请求类型分层价格使用基础价格，并在同步 PR 摘要中报告，不静默宣称覆盖了全部计费维度。

内置快照和模型设置页面显示：

```text
价格来源：Models.dev 参考价格
```

不得显示“官方实时价格”。

### 用户覆盖优先

运行时解析顺序固定为：

```text
用户 modelMetadataOverrides / modelDefinitions
    > 内置 model-metadata.json
    > 未知值
```

每日同步只修改仓库内置快照，不修改用户本地 `config.json`。用户在前端修改的价格、上下文限制、能力字段和自定义模型不会因升级或同步被覆盖。

## 快照结构

继续使用现有 `model-metadata.json` 的顶层结构，并增加来源字段：

- `source`
- `sourceUrl`
- `lastUpdated`
- `defaultModels`
- `defaultSpeedTestModels`
- `aliases`
- `models`

在模型项中增加同步所需的轻量字段：

```json
{
  "id": "gpt-5.5",
  "sourceId": "openai/gpt-5.5",
  "provider": "openai",
  "toolTypes": ["codex", "opencode", "omp"],
  "limit": {
    "context": 1050000,
    "output": 128000
  },
  "pricing": {
    "input": 5,
    "output": 30,
    "cacheRead": 0.5
  },
  "reasoning": true,
  "input": ["text", "image"],
  "supportsTools": true
}
```

其中：

- `sourceId` 保留 Models.dev 的原始 `provider/model` 标识，用于追踪来源和生成差异。
- `id` 是 coding-tool-x 运行时传给对应渠道的模型 ID。
- 官方直连 provider 的运行时 ID遵循现有适配器使用的模型 ID；第三方 OMP/OpenCode 模型保留 provider 前缀以避免同名冲突。
- 现有运行时 ID 不静默重命名；同步器保留已有 aliases，并为确认安全的来源 ID 生成别名。
- `toolTypes` 是前端过滤和渠道默认选项的唯一依据；旧的前缀分类只作为损坏或旧快照的兼容回退。

顶层增加轻量来源标识：

```json
{
  "source": "models.dev",
  "sourceUrl": "https://models.dev/api.json",
  "lastUpdated": "2026-09-04"
}
```

## 模型筛选规则

同步器使用一个小型热门系列白名单，例如 `scripts/model-catalog-policy.json`，而不是把筛选逻辑散落在前端和代理中。

默认收录条件：

1. provider 或 model family 命中白名单；
2. 是文本生成模型，输入包含 `text`，输出包含 `text`；
3. 不是 embedding、moderation、纯图像生成或纯音频模型；
4. `tool_call` 不为明确的 `false`，优先收录支持工具调用的模型；
5. 有正数的上下文限制和可计算的基础 input/output cost；
6. 没有明确已过期状态，或仍被现有项目配置引用。

初始白名单覆盖现有项目的 Anthropic、OpenAI、Google 模型，并扩展常用的 DeepSeek、Qwen、Kimi、GLM、Mistral、Llama、xAI 等热门编码模型系列。白名单是同步策略，不是用户限制；用户仍可手动添加任何模型。

没有价格但有模型能力信息的条目不写入内置 `models`，避免成本计算误用通用兜底价；同步 PR 摘要报告这些条目，用户可以在前端手动添加并补充价格。

## 工具模型视图

快照保存通过筛选的模型全集，前端根据 `toolTypes` 生成当前工具的列表：

| 工具 | 默认显示范围 |
| --- | --- |
| Claude | `claude` |
| Codex | `codex` |
| Gemini | `gemini` |
| OpenCode | `opencode`，并根据入口来源使用 Claude/Codex/Gemini 子集 |
| OMP | `omp` |

provider 到工具的初始映射：

- `anthropic` → `claude`，并可用于兼容的 `opencode` / `omp` 渠道；
- `openai` → `codex`，并可用于兼容的 `opencode` / `omp` 渠道；
- `google` → `gemini`，并可用于兼容的 `opencode` / `omp` 渠道；
- 其他热门 provider → 默认进入 `opencode` / `omp`，不进入原生 Claude、Codex、Gemini 列表。

需要调整 `src/web/src/composables/useDefaultModels.js` 和相关渠道选项读取逻辑，使其优先读取 `toolTypes`，同时保留旧三类列表作为兼容回退。OMP/OpenCode 的自由输入和渠道真实探测仍然可用，快照只是离线默认目录。

## OMP 离线 Metadata

现有 OMP Metadata 操作改为从本地内置快照读取：

```text
GET/POST model metadata request
    → 读取 src/config/model-metadata.json
    → 按 provider/model ID 匹配
    → 合并当前渠道已有定义
    → 返回模型定义与 warnings
```

该路径：

- 不调用 Models.dev；
- 不要求 API key；
- 不调用 `omp models --json`；
- 不需要网络；
- 不会覆盖用户已有字段。

现有 `omp models --json` 渠道真实探测可保留，继续作为用户主动点击后的可选能力。它和内置 Metadata 路径必须是两个明确的操作，不能让离线 Metadata 读取隐式触发渠道探测。

## 同步脚本与工作流

新增：

```text
scripts/sync-model-catalog.js
scripts/model-catalog-policy.json
.github/workflows/sync-model-catalog.yml
```

脚本使用 Node 22 内置 `fetch`，不增加生产依赖。执行步骤：

1. 请求 `https://models.dev/api.json`；
2. 校验顶层结构和模型条目结构；
3. 按白名单及能力条件筛选；
4. 规范化 ID、价格、限制、能力和 `toolTypes`；
5. 合并现有 aliases 与必须保留的旧模型；
6. 生成稳定排序的 `src/config/model-metadata.json`；
7. 在写入前校验默认模型、ID 唯一性和价格合法性；
8. 无差异时退出且不创建 PR；有差异时由 workflow 创建 PR。

GitHub Actions：

- 每日定时执行；
- 支持 `workflow_dispatch` 手动执行；
- 只有生成文件通过校验后才创建 PR；
- PR 摘要列出新增、价格变化、限制变化、来源中消失但被保留的模型，以及无法表达的复杂价格字段；
- 工作流失败不触碰当前快照。

## 失败与兼容策略

### 上游不可用

请求失败、超时或 JSON 无法解析时，workflow 失败，不写入快照，不创建 PR。发行包继续使用最后一次成功快照。

### 上游返回异常空数据

如果筛选后结果为空或显著少于现有有效目录，视为异常并失败，防止一次错误响应清空全部内置模型。

### 模型从上游消失

不自动删除现有模型。现有模型可能仍被用户配置、历史记录或渠道使用；PR 摘要报告其不再出现在当前 Models.dev 数据中，由维护者决定是否清理。

### 数据字段不兼容

无法映射的字段不写入运行时 schema。脚本必须在 PR 摘要中报告被忽略的字段；不能静默把未知计费维度折算成普通 token 价格。

## 代码迁移范围

实现阶段只修改服务于该设计的现有路径：

- `src/config/model-metadata.json`：改为同步器生成的快照；
- `src/config/model-metadata.js`：读取来源字段、工具列表和生成 aliases；
- `src/server/utils/pricing.js`：保持单一解析和计算入口；
- `src/server/api/settings.js`：返回来源、工具列表和快照更新时间；
- `src/platforms/drivers/omp/native-config-implementation.js`：内置 Metadata 使用本地快照，不隐式调用外部目录命令；
- `src/platforms/drivers/codex/proxy-implementation.js`、`gemini/proxy-implementation.js`、`opencode/proxy-implementation.js`：删除重复硬编码价格表，迁移调用方到统一解析入口；
- `src/web/src/composables/useDefaultModels.js` 及相关渠道组件：按 `toolTypes` 过滤；
- 相关模型设置和渠道 Metadata 测试。

不改变公共 HTTP 路径、现有用户配置字段、渠道真实探测接口和已有 CLI 命令名称。

## 验证策略

新增或调整的测试必须验证可观察行为：

1. 使用固定 Models.dev fixture 生成稳定快照，覆盖新增模型、价格变化、限制变化和模型消失保留。
2. 拒绝重复模型 ID、负价格、无效限制、空目录和非法上游结构。
3. 验证 `toolTypes` 过滤：第三方模型不会出现在原生 Claude/Codex/Gemini 列表，但能出现在 OMP/OpenCode 目录。
4. 验证用户 `modelMetadataOverrides` 和 `modelDefinitions` 覆盖内置值，且同步不会修改用户配置。
5. 禁止 OMP 内置 Metadata 路径调用网络或 `omp models --json`；离线 fixture 仍能返回模型定义。
6. 验证所有成本计算调用只使用统一的内置/用户覆盖解析路径，不再读取代理内重复价格表。
7. 运行现有项目的模型 schema、pricing、model metadata、API consistency 和回归测试。
8. 发布前执行一次实际的 OMP 离线 smoke test，确认打包后的快照可读。

## 验收标准

- 每日 workflow 能从 Models.dev 生成确定性 `model-metadata.json` 并自动创建 PR。
- 快照包含白名单内的热门编码模型及其基础限制、能力和参考价格。
- OMP 内置 Metadata 在断网时可用。
- 前端各工具只显示当前工具适配的模型。
- 用户前端修改永远覆盖内置值。
- Codex、Gemini、OpenCode 不再拥有会与内置快照冲突的重复硬编码价格。
- 同步失败不会污染现有快照。
- 模型移除、价格变化和无法表达的计费字段都能在 PR 中被审查。
- UI 明确标注 `Models.dev 参考价格`。
- 公共 API、CLI 和现有渠道配置行为保持兼容。
