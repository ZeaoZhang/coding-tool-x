# Design

## Source of truth
- Status: Active
- Last refreshed: 2026-09-18
- Primary product surfaces: 我的项目、项目会话列表、会话搜索弹窗
- Evidence reviewed: `src/web/src/views/ProjectList.vue`, `src/web/src/views/SessionList.vue`, `src/web/src/api/sessions.js`, `src/web/src/components/Layout.vue`

## Brand
- Personality: 直接、克制、面向开发者
- Trust signals: 明确显示搜索范围、加载状态、空结果和当前项目
- Avoid: 隐式改变搜索范围、重复实现搜索流程

## Product goals
- Goals: 主页快速查找全工作区会话；会话页优先查找当前项目会话；保留 Cmd/Ctrl+K 快捷入口
- Non-goals: 改变搜索结果数据结构或新增独立搜索页面
- Success signals: 用户能从入口一眼确认搜索范围，快捷键打开时默认范围符合当前页面语义

## Personas and jobs
- Primary personas: 使用多个 CLI 项目管理长期会话的开发者
- User jobs: 从项目主页跨项目找历史对话，或在当前项目内快速找上下文
- Key contexts of use: 键盘驱动、项目较多、会话历史较长

## Information architecture
- Primary navigation: 我的项目 → 项目会话列表 → 会话详情
- Core routes/screens: `ProjectList.vue`、`SessionList.vue`
- Content hierarchy: 搜索输入 → 搜索范围 → 结果列表 → 会话操作

## Design principles
- Principle 1: 搜索范围跟随页面语义，主页默认全局，会话页默认当前项目
- Principle 2: 快捷键只唤起已有搜索能力，不复制新的搜索实现
- Tradeoffs: 允许用户在弹窗中切换范围，但不因切换页面自动覆盖用户已选择的范围

## Visual language
- Color: 复用现有 Naive UI 主题
- Typography: 复用现有页面字号和层级
- Spacing/layout rhythm: 复用现有搜索弹窗与 `n-space` 间距
- Shape/radius/elevation: 复用现有弹窗和表单组件
- Motion: 使用现有弹窗打开和 loading 状态
- Imagery/iconography: 复用现有搜索、终端图标

## Components
- Existing components to reuse: `n-modal`, `n-input`, `n-select`, `searchSessionsGlobally`, 会话页现有搜索入口
- New/changed components: 会话页 Cmd/Ctrl+K 搜索触发逻辑
- Variants and states: 主页 workspace 默认值；会话页 current-project 默认值；空项目时回退 workspace
- Token/component ownership: 页面组件负责默认范围，API 负责传递范围参数

## Accessibility
- Target standard: 现有键盘可用性和 Naive UI 默认语义
- Keyboard/focus behavior: 主页 Cmd/Ctrl+K 打开全局搜索并聚焦输入框；会话页 Cmd/Ctrl+K 聚焦当前项目搜索框；Enter 执行搜索；Escape 关闭结果弹窗
- Contrast/readability: 复用现有主题
- Screen-reader semantics: 使用现有输入框、选择框和弹窗标签
- Reduced motion and sensory considerations: 不新增动画

## Responsive behavior
- Supported breakpoints/devices: 复用现有响应式弹窗宽度
- Layout adaptations: 搜索范围控件在窄屏下允许换行
- Touch/hover differences: 不改变现有行为

## Interaction states
- Loading: 搜索按钮显示 loading 并禁用重复提交
- Empty: 显示无匹配结果
- Error: 复用现有错误提示
- Success: 按当前范围展示结果
- Disabled: 搜索进行中禁用范围切换
- Offline/slow network, if applicable: 保持现有错误提示和 loading

## Content voice
- Tone: 简洁、明确
- Terminology: “全工作区”“当前项目”“指定项目”
- Microcopy rules: 在搜索弹窗中始终让当前范围可见

## Implementation constraints
- Framework/styling system: Vue 3 + Naive UI
- Design-token constraints: 不新增主题变量
- Performance constraints: 项目列表一次加载全部项目；复用现有范围过滤和搜索 API，会话列表继续按需分页
- Compatibility constraints: 保留现有主页全局搜索和会话页搜索行为
- Test/screenshot expectations: 运行相关 Vitest 与 Web 构建

## Open questions
- [ ] 是否需要把搜索弹窗抽成跨页面共享组件 / owner: frontend / impact: 中
