# 内存持续增长调查与隔离验收

## 当前证据边界

用户报告“启动后上涨、重启后下降、随后再次上涨”的循环。请求正文重复复制会增加峰值，但仅凭这一点不能证明持续增长的根因。长期持有的原生日志状态、项目/统计缓存、写入和客户端发送积压需要分别观测。

本次隔离检查不会操作正在运行的服务，不调用 PM2，不使用真实 CLI 凭据或上游。短时结果只能证明隔离工作负载可以运行，不能代替 60 分钟或 24 小时稳定性验收。

## 复现工具

`scripts/memory-soak.js` 启动真实后端、Claude 动态代理、原生日志观察器、项目/统计 API 和 WebSocket。上游由本机 HTTP 模拟服务提供，包含普通响应、2 秒流式响应和每 20 次一次的主动取消。

子进程在加载应用前替换自身 `os.homedir()`，并通过临时 preload 文件将相同隔离传给后续 fork worker，清除继承的 CLI 路径覆盖，显式阻止 OMP 调用已安装的 CLI，验证全部原生路径位于临时目录；父进程的 HOME、CODEX_HOME 和环境不会被改写。应用目录与原生数据库均为合成数据，网络连接限于回环地址。仅跳过前端构建，避免改写用于对比的源码；网页负载模拟现有 API 和 WebSocket，不包含浏览器渲染。

默认历史夹具包含 10,000 条 OpenCode 用量记录、最多 10,000 条 Gemini 整体 JSON 消息和 80 个 Claude 项目。CLI/组合场景每 5 秒新增 50 条原生记录，同时持续发送每秒 1 次、正文 1 MiB 的代理请求；组合场景每 2 秒访问项目与统计 API，并保持 WebSocket 订阅。Gemini 文件保留最新 10,000 条，原生数据库达到一百万条时停止，后端日志最多保存 64 MiB；退出会关闭子进程和模拟服务并删除临时应用目录。

**组合场景增加显式服务覆盖（fixtureVersion 2）**：当前生产会话 API 调用 `session-history-index`，没有调用旧的 `session-snapshots` 服务；生产快照缓存由 dashboard 使用。工具不能把会话 API 流量冒充快照覆盖，因此在隔离子进程中另外调用现有 `getSessionListSnapshot` 与真实 indexed payload 构造函数，预先遍历全部 80 个项目，随后通过 IPC 持续轮转。该额外服务压力在报告中明确标注，与真实 API/WebSocket 流量分开。

趋势 API 确实读取 `filterModel`。查询改用已结束日期 `2020-01-01`，避免持续新增统计使当前日期趋势缓存被立即失效；组合开始时通过真实 HTTP API 查询 40 个不同模型过滤条件。报告的 `moduleCoveragePassed` 要求全部项目被快照服务覆盖、缓存曾达到 `min(64, 项目数)`、趋势 API 确实执行且诊断中趋势缓存大于 0；不满足时即使短时请求均成功也判定失败。旧基线没有统计队列诊断接口时明确标记 `trendDiagnosticsAvailable=false`，仅验证实际 API 调用，不声称已验证趋势缓存容量。

### 运行方式

```sh
# 快速检查：5 秒预热 + 30 秒观察；不会宣称稳定性通过
node scripts/memory-soak.js --quick --scenario combined --output /tmp/memory-quick

# 验证组合场景缺少模块覆盖时会失败，不启动后端
node scripts/memory-soak.js --self-check

# 三个场景分别运行：默认 10 分钟预热 + 60 分钟观察
node scripts/memory-soak.js --scenario idle --output /tmp/memory-idle
node scripts/memory-soak.js --scenario cli --output /tmp/memory-cli
node scripts/memory-soak.js --scenario combined --output /tmp/memory-combined

# 24 小时组合观察，关闭快照以减少临时磁盘开销
node scripts/memory-soak.js --scenario combined --duration-seconds 86400 \
  --no-heap-snapshots --output /tmp/memory-24h

# 使用另一份固定源码进行基线对比；须提供已安装/链接依赖的独立目录
node scripts/memory-soak.js --source-root /path/to/baseline \
  --scenario combined --output /tmp/memory-baseline
```

输出目录必须为空；不覆盖已有观察结果。`--help` 列出负载、历史数量、采样、垃圾回收和快照开关。对比应使用相同 Node 版本、夹具选项和固定源码。源码目录有并发修改时，结果不能代表最终版本。

## 指标与对象持有关系

- 子进程通过 IPC 每 30 秒采集 PID、RSS、堆与 Buffer 内存，每 5 分钟显式垃圾回收后额外采样；该控制能力只存在于隔离子进程。
- 每个采样包含 UTC 时间戳与启动后的秒数，便于将 PID 变化和服务日志按时间关联。
- `backend.log` 保存应用的 `[MEM]` 输出，可与缓存、写入队列、活动请求和发送积压诊断关联。`samples.jsonl`、`memory.csv` 和 `memory.svg` 保存采样与曲线，`report.json` 保存判定和请求计数。
- 默认 60 分钟及以上运行在预热结束与测量结束各写一份 `.heapsnapshot`；`--heap-snapshots` 可用于短时检查，`--no-heap-snapshots` 关闭。快照会暂停隔离进程并增加瞬时内存；快照后一分钟内的样本在原始数据中标注 `excludedSnapshot`，不进入曲线或门限计算。应用原始诊断仍保留这些时间段。
- 使用内存分析器加载两份快照并查看 Comparison 与 Retainers：比较 Map、用量状态、项目对象、排队记录、Buffer/ArrayBuffer 的数量与 retained size，再追踪到对应模块的根引用。快照只含合成数据。RSS 增长而回收后堆稳定时，需同时检查 Buffer、SQLite 和分配器保留，不能据 RSS 一项推断 JavaScript 泄漏。
- 最后 30 分钟至少保留 6 个回收后样本且跨越至少 25 分钟；以该窗口前后两半的最低值之差计算堆基线与 RSS 低位增长。验收门限为堆增长 ≤5 MiB、RSS 低位增长 ≤10 MiB、测量期 RSS 峰值 <450 MiB；正常固定负载不允许非预期失败或压力 503。
- 报告区分 `smoke-only`、`passed`、`failed`。隔离实例退出计数不是 PM2 重启次数；报告中的 `pm2Restarts` 为 `null`，实际服务 24 小时不重启仍需部署后观察。

### 自动提取限定的持有边

```sh
node scripts/analyze-memory-snapshots.js \
  /tmp/memory-combined/warmup-end-PID.heapsnapshot \
  /tmp/memory-combined/measurement-end-PID.heapsnapshot \
  --output /tmp/memory-combined/holders
```

该工具在独立进程解析快照，不在应用后端解析。默认检索 `rowState`、`snapshots`、`pendingEntries`、`recentEventIds`、`trendCache` 等 context/property 持有字段，输出 `heap-holders.json` 和 `heap-holders.md`。JSON 保留持有者和目标的 V8 节点 ID、目标类型、有限可达对象数量与 self bytes、闭包进入 context 的边、到大节点的示例边链；可以在 DevTools 中使用 `@节点ID` 定位复核。

默认遍历 4 层，包括 Map 的内部 table；每个目标最多 10,000 个节点和 100,000 条扫描边，每个字段最多检查 64 个不同目标，可用 `--depth`、`--max-nodes`、`--max-edges`、`--max-targets` 调整。到达上限会明确标记；弱引用、原型、代码/形状与上层 context 链不展开。**结果是有限可达 self bytes，不是 dominator retained size，也不代表独占内存**；不同持有字段可能共享对象，不能把它们直接相加。未找到字段不能证明没有泄漏。

用空闲 snapshot smoke 的两份实际快照验证：成功定位 `rowState → Object`、`snapshots/trendCache/recentEventIds → Map`、`pendingEntries → Array` 等持有边与对应闭包入口；限定遍历内的对象数和 self bytes 前后变化为 0。`--max-nodes 2 --max-edges 5 --targets rowState` 的额外检查正确标记遍历上限。产物在 `/tmp/cc-tool-memory-soak-snapshot-smoke/holders`；这个短时空闲结果不构成增长根因或长期稳定性证据。

## 已完成的短时检查（2026-10-14）

Node v24.15.0；基线为 HEAD `a20d746db9382fddb20d2529122347b655fa410e` 的独立导出目录，依赖链接到本项目安装目录。当前版本为修复过程中工作区，不是最终固定版本。以下早期结果均为 5 秒预热、30 秒测量，未执行显式 session-snapshots 压力，不能验证快照缓存，也不满足稳定性验收。

| 场景 | CLI / API 完成次数 | 主动取消 | 非预期请求错误 | 测量 RSS 峰值 | 判定 |
| --- | ---: | ---: | ---: | ---: | --- |
| 基线组合 | 34 / 34 | 1 | 0 | 252.8 MiB | smoke-only |
| 当前组合 | 34 / 34 | 1 | 0 | 189.3 MiB | smoke-only |
| 当前空闲 | 0 / 0 | 0 | 0 | 127.7 MiB | smoke-only |
| 当前 CLI | 34 / 0 | 1 | 0 | 189.9 MiB | smoke-only |

四次子进程均以代码 0 退出，没有压力 503。组合基线与当前的短时峰值不同，尚不足以归因或证明修复后基线稳定；当前组合短窗口的 RSS 低位仍上涨约 47.8 MiB，需通过充分预热后的长跑区别分配器保留与持续累积。

额外的空闲快照 smoke 已以代码 0 结束，成功生成预热结束和测量结束两份约 24 MiB 的快照；快照后样本已标注并排除验收序列。产物在 `/tmp/cc-tool-memory-soak-snapshot-smoke`，此检查只验证采集与排除机制。

上一轮脚本组合 smoke 在 `/tmp/cc-tool-memory-soak-final-smoke` 再次完成：34 次 CLI、34 次 API、1 次主动取消，0 非预期错误或 503，RSS 峰值 187.7 MiB，正常退出；仍为 `smoke-only`。

覆盖增强后的组合 smoke 在 `/tmp/cc-tool-memory-soak-coverage-smoke` 完成：34 次 CLI、74 次 API、1 次主动取消、0 非预期错误或 503，正常退出；`moduleCoveragePassed=true`。实际覆盖 80 个快照项目，峰值快照条目 64、趋势条目 32，趋势 API 执行 57 次；`backend.log` 的 `[MEM] sample` 也记录 `snapshots.entries=64` 与 `statistics.trendCacheEntries=32`。此前缺少此覆盖的长跑不能用于快照容量验收，应使用固定新版源码重新运行。

同负载旧基线在 `/tmp/cc-tool-memory-soak-coverage-baseline` 也正常退出，快照条目达到 80，趋势 API 执行 57 次；旧基线没有趋势诊断接口，因此不能用它的 `peakTrendEntries=0` 推断未执行趋势路径。`--self-check` 已验证正常覆盖、5 种模块缺失失败分支和显式缺少旧诊断的兼容分支。

本机产物分别在 `/tmp/cc-tool-memory-soak-isolated-baseline`、`/tmp/cc-tool-memory-soak-isolated-current`、`/tmp/cc-tool-memory-soak-isolated-idle`、`/tmp/cc-tool-memory-soak-isolated-cli`。最早一次基线试运行因 OMP 运行时路径发现读取了真实只读历史，其结果已排除；随后增加路径断言与禁用 CLI 路径发现，并重新运行上述有效隔离结果。

## 尚未完成的验收

固定最终修复源码后，运行三个 70 分钟场景与 24 小时组合观察，提交曲线、报告与前后快照持有关系。部署前排空现有请求；部署后另外核对 PM2 的实际重启原因与次数。仅在这些证据齐全后才可以宣称循环重启已解决。

## 已实现的限制与保护

- OpenCode 和 Gemini 长期去重/累计用量状态保存到应用自己的 SQLite 检查点，热缓存最多 1024 项、2 MiB；原生 OpenCode 数据库只读。原生日志每次最多返回 500 个事件，持久化失败保留未提交事件并按退避重试，观察器在统计磁盘压力下暂停消费。检查点属于当前游标生命周期，关闭时清理；新游标依照既有首次跳过历史契约重新基线化。
- 项目快照使用 64 项、32 MiB LRU，超大项只保留磁盘；刷新/错误/失效状态有界，旧在途刷新不能覆盖新状态。趋势缓存最多 32 项、8 MiB，30 秒后主动清理；每日缓存保留最近 7 个日期，脏数据先暂存到磁盘。
- 统计内存队列包含在途批次，最多 1000 条、8 MiB，每批最多 500 条；溢出写入磁盘待写记录，失败退避。稳定写入 ID 用于恢复时核对已追加记录，合法无换行的旧尾行会保留，只有确认损坏/不完整的尾段才截断；解析资源限制或 I/O 错误保留原字节并暂停恢复。RAM 中尚未落盘记录在强制终止时仍可能丢失，本次不声明断电级事务持久性。
- 网页日志持久化合并为一次正在写入和一份最新待写；单 WebSocket 客户端发送积压或新帧超过 1 MiB 时断开，继续使用现有重连与历史机制。渠道每个平台最多 64 个等待者，取消和完成统一释放；会话绑定最多 1024 项，拒绝对象和过长标识。
- Claude 关闭请求日志时不构造完整快照，开启时去掉正文深拷贝和重复 rawBody，日志队列最多 8 MiB；模板按正在写入和最新待写合并。DSH 未改写正文时复用原始 Buffer。六个平台接入共享取消/连接释放流程，协议转换响应收集同样限制为 100 MiB。
- 新代理请求在正文解析前共享检查压力：RSS 达到 380 MiB 或后台持久化阻塞时返回各平台现有错误结构的 503、Retry-After: 5；RSS 低于 330 MiB 连续两次周期检查且磁盘压力解除才恢复。已开始的流式请求继续完成。保留请求 100 MiB 与 PM2 500 MiB 阈值，未增加前端页面。
- CC_TOOL_MEMORY_TRACE=1 时每 30 秒输出无正文/凭据的 PID、RSS、heap、external、arrayBuffers、活动请求、缓存、队列和 WebSocket 积压。

## 最终回归与固定版本长跑

2026-10-14 CPU 修复后的全量单元测试：3093 项，3078 通过，15 失败；失败断言名称与未修改 HEAD 基线逐项比较一致，来自 DSH manifest/profile/plugins、Agents 的 OMP 路径 mock、配置模板和设置断言。证据为 `/tmp/cc-tool-memory-final-v3-unit.json` 与 `/tmp/cc-tool-memory-baseline-unit.json`。原统计专项 48/48，包括实际子进程 SIGKILL 后追加去重和尾行恢复；本轮原生日志、价格与观察器专项 49/49。基础入口检查与六平台 API 声明一致性检查重新通过。

固定版本 fixtureVersion 2 长跑已启动。清单与每个文件 SHA-256 保存于 `/tmp/cc-tool-memory-validation-20261014/run-manifest.json`：基线是 HEAD a20d746db9382fddb20d2529122347b655fa410e；修复源码固定在 `/var/folders/gv/bs9wl4x10dn0d7lsdp916b480000gn/T/cc-tool-memory-final-v2-4yvso8o5`，依赖使用本项目已安装版本。基线与修复各运行 idle、cli、combined 三组 10 分钟预热 + 60 分钟观察，另启动修复 combined 24 小时观察。目录名称为 baseline-v2-*、fixed-v2-*；旧未覆盖快照的长跑已停止并标为 superseded，不能用于验收。

V2 六组 70 分钟结果已完成，整体验收失败，未部署。每组真实 PID 在测量期间未变化；控制器、原始采样、日志、报告与独立快照分析均保留。fork 不受 PM2 监督，不能用其退出或 `pm2Restarts=null` 推断生产零重启。

| V2 场景 | 最后 30 分钟 GC 堆增长 MiB | RSS 低位增长 MiB | 请求错误 / 503 | 跳过负载次数 | 结果 |
| --- | ---: | ---: | ---: | ---: | --- |
| baseline idle | 0.003 | 1.02 | 0 / 0 | 0 | passed |
| baseline cli | 7.553 | 0.23 | 8 / 0 | 515 | failed |
| baseline combined | 6.455 | -23.02 | 27 / 0 | 1016 | failed |
| fixed idle | -0.012 | -0.14 | 0 / 0 | 0 | passed |
| fixed cli | 0.145 | 0.94 | 0 / 68 | 1 | failed |
| fixed combined | 0.093 | 12.47 | 1 / 0 | 226 | failed |

fixed CLI 的压力拒绝出现在测量末段，不能全部归咎快照；组合 RSS 增长超过 10 MiB 且有请求失败。V2 的报告尚未把跳过负载作为独立失败条件，表中保留这些计数。组合确实覆盖 80 个项目，修复快照达到 64 项、趋势达到 32 项。

对照曲线、完整报告汇编和总结保存于 `/tmp/cc-tool-memory-validation-20261014/comparison-v2.png`、`.pdf`、`.json`、`.md`；各组 `holders/heap-holders.json` 保存独立进程分析证据。旧版 CLI 和组合的 rowState Map 可达 self bytes 各增长 1,376,256 bytes，但遍历达到 10,000 节点上限，不能给出全部增长或独占 retained size。修复版同一字段的有界增量为 0，未达到上限。不同持有者共享对象不可相加，待写数组两次取样差异也不证明持续泄漏。这些证据支持已复现长期状态累积，仍不足以认定现场循环重启的唯一根因。

V3 将重新使用固定源码及文件 SHA-256，基线与修复运行相同 fixtureVersion 3。manifest 中的 baseline-v3-*、fixed-v3-* 是后续最终验收对象；V2 保留诊断用途并标为 superseded。服务未更新，隔离验收通过后才能排空现有请求更新，并保留旧源码与运行配置用于回退。

### 剩余性能观察点

本轮通过隔离夹具复现同步价格解析与每次把全部历史用量送入 JavaScript 的高 CPU 路径。每次扫描创建局部价格计算器，最多缓存 64 个、长度不超过 2048 字节的模型键，下一次扫描重新读取配置；Gemini 整体 JSON 复用同样逻辑。OpenCode 把 part 原文和父消息 provider/model 投影保存到应用检查点，通过只读 ATTACH 在 SQLite 内筛选变化；未变化记录不跨入 JavaScript，原始正文不进热缓存。没有时间戳变化的旧用量更新仍可识别，父消息身份更新重新处理用量，父消息无关正文改变不触发重算，原生库始终只读。

同一 30,000 条夹具、每次追加一条的三次轮询，V2 为 882–885 ms，新代码为 18.2–18.5 ms；保存于 `/tmp/cc-tool-memory-validation-20261014/native-poll-comparison-30k.json`。900,000 条历史的 SQLite 扫描仍约 0.84–0.91 秒热轮询、第一轮 1.76 秒，查询仍具有随历史量增加的成本，不宣称大库延迟已全部解决。24 小时负载保持每 5 秒 50 条，应继续观察 CPU、事件循环和请求延迟。

fixtureVersion 3 增加累计 CPU 用时、事件循环延迟、请求首字节和完成耗时的有界直方图、真实完成的流数量及周期 `workload-progress.json`。跳过负载或逐事件统计核对失败均判定 failed，不通过降低请求量隐藏阻塞。测量结束后先停止生成，再等待 16 秒以覆盖 Gemini 整体 JSON 的 15 秒解析间隔，排空观察器和统计；该等待不计入测量时长。原生日志用磁盘 SQLite ledger 核对每个预期 ID、Token、重复数、总数与 summary 聚合，输出 `statistics-verification.json`；不会在控制器 RAM 中累计全部 ID。短时组合检查两平台各 350 个事件准确入账、无重复/非法记录，34 个 CLI 请求、16 个流完成、无请求错误或 503，仍只是 smoke-only，不能代替新版本长期验收。

## 2026-10-20：根因证据与六平台补查

### 有证据的持续累积

持久化证据目录为 `/Users/zhangzeao/.codex/memory-validation/coding-tool-x/20261019`，源码、逐文件哈希、真实 PID 和负载在 `run-manifest.json`。V4 三组 70 分钟对照已完成；它们是此次补查修改前的固定版本。`comparison-v4.png/pdf/json/md` 保存曲线、比较和限制。

基线 CLI 的 OpenCode `rowState` 同一个 Map 从 15,950 项增长到 44,350 项；组合场景从 15,950 项到 44,300 项。独立进程扩大遍历上限后均未触限，组合场景可达 self bytes 增长 11.29 MiB。持有链为游标闭包、Context、Map 表、signature/tokens；Gemini 的 `seenByFile` 也持有持续追加的历史 ID。self bytes 不是独占 retained size，不可把共享对象重复相加。证据支持原生日志状态累积，不证明每次现场重启的唯一原因。

修复前 CLI 预热后到结束的 GC 堆为 38.09 → 60.92 MiB，修复后为 31.76 → 32.56 MiB；组合为 41.04 → 57.08 MiB、33.44 → 34.58 MiB。固定组合版本仍出现 18 次压力 503，集中在预热快照之后，尚未证明是否由快照分配放大触发，因此 V4 组合未通过。历史生产 PM2 日志确有超 500 MiB 重启，但历史累计记录不能当作本次实验的重启次数。V4 无快照的 24 小时组合仍在运行，尚非完成验收。

### 本次新增修复

- DSH 普通 JSONL 从每次全量读取改为共享 64 KiB 增量游标，每批最多 500；首次跳历史后不会在下一次追加时重放旧数据。长行选择性解析保留模型、渠道、成本和缓存用量。
- DSH 压缩 JSONL 不再同时保留整份压缩文件、全部解压内容和记录数组；改为逐帧读取、逐条归一化，溢出批次复用 SQLite 检查点。首次跳历史建立去重基线；未写完的尾帧等待下次追加，不错误进入磁盘压力保护；两种格式轮流消费，避免单个来源持续有数据时饿死另一个来源。每次扫描使用局部价格缓存。
- 压缩日志仍需扫描各帧以识别变化，CPU 随历史长度增长；单帧解压仍需要该帧的输出 Buffer。普通的一事件一帧场景已消除历史规模的同时驻留，不能声称任意超大单帧已实现流式解压。
- Gemini JSONL 的 `$set` 只保留 sessionId、provider、model、lastUpdated 四项有效标量，避免任意会话状态或正文长期驻留。整体 JSON 沿用此前 16 MiB 和 15 秒扫描限制及 SQLite 去重。
- 共享长行字段选择补齐 `cache.read/readTokens/write/writeTokens`，使各平台长消息不会遗漏这些已支持的缓存 Token 字段。
- 共享压力诊断只保留一次最新暂停的时间、RSS、持久化阻塞原因和峰值、次数，便于捕获两次周期采样之间的短暂峰值。380/330 MiB 准入规则、100 MiB 正文限制、既有流继续完成的契约不变。
- Claude、Codex、OMP 的用量游标已使用增量读取；六个平台共用取消传播、上游关闭和渠道释放机制，本轮未发现与 OpenCode 历史 Map 相同的逐事件无限保存机制。文件状态仍随文件数量增长，需与逐事件累积分别观察。

### 回归与上线边界

新增测试先失败后修复：DSH 普通追加 1,200 条准确分成 500/500/200；压缩历史不再整文件复制；跨帧长行、部分尾帧、重复轮询保留准确用量；Gemini 100 次无关元数据更新保持四项状态；压力诊断可保留采样间的峰值证据。

六平台日志、代理和释放相关回归 148 项通过；共享补充回归 60 项通过；DSH 原生日志专项 4 项通过；基础入口和六平台 API 声明检查通过。最终稳定源码全量回归 3,109 项，3,094 通过，15 个失败名称与旧基线一致。中间一次全量运行另有 MCP info 的 404，单文件 36 项重跑通过，最终全量未再出现；保留原始报告，不抹除这次波动。证据为 `/tmp/memory-final-20261020-unit-stable.json`、`/tmp/memory-six-cli-20261020.json`、`/tmp/memory-final-shared-20261020.json`、`/tmp/dsh-native-final.json` 和 `/tmp/memory-mcp-20261020.json`。

本次补查改变了源码，V4 不能冒充此最终版本的长跑验收。后续使用新的固定副本和哈希运行必要复验，并对快照开关进行相同负载的诊断对照。生产服务未重启、未部署，未宣称循环重启已解决；仍需最终版本隔离验收和长流排空后上线。

### 提交前独立审查补充

提交前代码审查复现了 DSH 生成器的解析异常被误报为检查点存储故障：损坏的压缩日志会触发共享压力保护。共享扫描游标现在将解析调用和生成器迭代放入同一来源错误边界，记录警告并继续其他文件；只有检查点读写错误回滚并进入存储退避。已接受的有效前缀保留去重状态，失败文件的位移不前移，后续重试不会重复计数。损坏日志与健康日志同时存在的回归已先失败、修复后通过；原有磁盘失败回滚回归保持通过。

DSH 单帧压缩输入上限为 8 MiB，解压输出上限为 16 MiB，由原生解压器的 maxOutputLength 在生成完整输出前执行。未写完的超大帧也受输入上限约束。超限帧记为来源解析错误，不触发全局存储压力；该文件的后续记录需修复或拆分超限帧后才能继续统计，不能声称超大单帧仍有完整统计覆盖。对应高压缩率输出与截断输入回归已先失败、修复后通过。

代码推送只表示审查后保存修复版本；部署仍受最终固定版本长跑、统计核对和既有请求排空验收约束。

架构复审补齐原生日志退出交接：退出前停止轮询并刷统计，优先重试被拒批次、排空游标积压；代理长流结束后再排空一次，最后确认统计已落盘或完整转入恢复日志才关闭游标。Gemini 最后一次整体 JSON 重写可在退出排空时绕过正常的 15 秒节流。存储仍不可写时拒绝退出并保留待处理状态；若失败发生在代理已排空之后，进程会保留但代理可能已停止，需修复存储后重试退出。Web UI 从 CLI 启动时共用同一退出流程，避免两个 SIGINT 处理器竞争退出。相关拒绝后重启、磁盘失败恢复、长流完成期间追加和 Gemini 末次重写回归通过。

DSH 事件 ID 增加所属会话目录，避免不同 session.v3.jsonl 中相同 seq 被增量游标误去重。两个会话同时追加相同 seq 的回归先失败、修复后通过。

保留的运行边界：100 MiB 请求上限和正文解析前 RSS 检查不构成多请求的总内存预留；多个已准入的大正文及长流仍可能形成瞬时峰值。这是现有请求契约的限制，不能用本次静态审查替代最终版本的负载与部署验收。

### 2026-10-21 历史单测失败复核

复核此前与基线相同的 15 个失败后，确认其中多数是测试没有跟上平台契约：DSH 在 2026-09-28 已开放 Agent Preset 与 Profile 插件管理；Profile 插件列表只返回可管理的外置包；OMP 在 Manifest 声明了项目 Agent 路径；缺少 Claude settings 时 `readSettings()` 沿用 JSONC 空对象回退。相应测试断言已更新，AgentsService 测试夹具也补全其模块依赖的 OMP 原生路径。

同时修复两项生产行为：`.env` 原生配置更新现在可匹配等号前带空格的键值行并保留注释与间距；DSH Profile 中尚未安装的包不再显示为已启用。定向五文件 75 项和最终全量 3,117 项均通过；`node scripts/test-basic.js` 及六平台 API 一致性检查通过。此验证只覆盖代码和回归，不替代内存长跑或生产 PM2 验收。
