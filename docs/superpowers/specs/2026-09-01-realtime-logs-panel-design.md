# 实时日志面板空白修复设计

## 问题

渠道管理页的 `RightPanel.vue` 模板使用了 `<ProxyLogs>`，但脚本没有导入 `./ProxyLogs.vue`。Vue 将其保留为未解析的自定义元素，因此日志区域只渲染空容器，不显示标题、表头或日志内容。

## 方案

在 `src/web/src/components/RightPanel.vue` 的现有组件导入区补充：

```js
import ProxyLogs from './ProxyLogs.vue'
```

保留现有的 `:source="currentChannel"` 绑定，不改动日志状态、WebSocket、统计接口或布局逻辑。

## 验收标准

1. 进入 `/cli/omp` 等渠道管理页后，日志区域实际渲染 `ProxyLogs` 组件。
2. 面板显示“实时日志”、表头和已有日志；无日志时显示“暂无日志”，而不是空白区域。
3. 当前渠道切换和 WebSocket 实时日志追加行为保持不变。
4. 回归测试覆盖 `RightPanel.vue` 对 `ProxyLogs.vue` 的导入，前端构建成功。
5. 使用 `http://localhost:19999/cli/omp` 进行浏览器冒烟验证。

## 范围与风险

仅修改组件导入和对应回归测试。不会触碰工作区已有的 `Home.vue`、`Home.test.js` 改动。风险为低：不改变公开接口或运行时数据流。
