# 会话格式转换功能 - 集成指南

## 已完成的实现

### 后端实现
✅ **转换器核心模块** (`src/server/services/session-converter.js`)
- 统一中间格式 (UnifiedSession)
- 6 个解析函数（Claude/Codex/Gemini → Unified）
- 6 个生成函数（Unified → Claude/Codex/Gemini）
- 主转换函数 `convertSession()`
- 预览函数 `previewConversion()`

✅ **API 路由** (`src/server/api/convert.js`)
- `GET /api/convert/formats` - 获取支持的格式列表
- `POST /api/convert/preview` - 预览转换
- `POST /api/convert` - 执行转换

✅ **路由注册** (`src/server/index.js:107`)
```javascript
app.use('/api/convert', require('./api/convert'));
```

### 前端实现
✅ **API 客户端** (`src/web/src/api/convert.js`)
- `getFormats()` - 获取格式列表
- `previewConvert()` - 预览转换
- `convertSession()` - 执行转换

✅ **转换对话框组件** (`src/web/src/components/ConvertDialog.vue`)
- 源会话信息展示
- 目标格式选择器
- 高级选项（目标路径、保留时间戳）
- 消息预览（前 5 条）
- 转换按钮

✅ **SessionCard 组件增强** (`src/web/src/components/SessionCard.vue:90-99`)
- 添加了"转换"按钮
- 添加了 `convert` 事件发射器
- 导入了 `SwapHorizontalOutline` 图标

## 集成到页面

### 1. 在 Claude Code 会话列表页面集成

**文件**: `src/web/src/views/SessionList.vue`（或其他使用 SessionCard 的页面）

```vue
<script setup>
import { ref } from 'vue';
import ConvertDialog from '../components/ConvertDialog.vue';

// 转换对话框状态
const showConvertDialog = ref(false);
const convertSession = ref(null);

// 处理转换事件
function handleConvert(session) {
  convertSession.value = session;
  showConvertDialog.value = true;
}

// 转换成功回调
function onConvertSuccess(result) {
  message.success(`转换成功！生成了 ${result.messageCount} 条消息`);
  // 可选：刷新会话列表
  store.loadSessions(projectName);
}
</script>

<template>
  <!-- SessionCard 使用示例 -->
  <SessionCard
    v-for="session in sessions"
    :key="session.sessionId"
    :session="session"
    @convert="handleConvert"
    @fork="handleFork"
    @delete="handleDelete"
  />

  <!-- 转换对话框 -->
  <ConvertDialog
    v-if="convertSession"
    v-model:show="showConvertDialog"
    :source-type="'claude'"
    :session-id="convertSession.sessionId"
    @success="onConvertSuccess"
  />
</template>
```

### 2. 在 Codex 会话列表集成

```vue
<ConvertDialog
  v-if="convertSession"
  v-model:show="showConvertDialog"
  :source-type="'codex'"
  :session-id="convertSession.sessionId"
  @success="onConvertSuccess"
/>
```

### 3. 在 Gemini 会话列表集成

```vue
<ConvertDialog
  v-if="convertSession"
  v-model:show="showConvertDialog"
  :source-type="'gemini'"
  :session-id="convertSession.sessionId"
  @success="onConvertSuccess"
/>
```

## 使用流程

1. 用户点击会话卡片上的"转换"按钮
2. 打开 ConvertDialog 对话框
3. 自动加载源会话预览（cwd、git 分支、消息数量等）
4. 用户选择目标格式（下拉菜单）
5. （可选）配置高级选项（目标项目路径）
6. 点击"开始转换"按钮
7. 后端执行转换，生成目标格式文件
8. 转换成功后显示通知

## API 使用示例

### 预览会话信息
```javascript
import { previewConvert } from '@/api/convert';

const preview = await previewConvert({
  sourceType: 'claude',
  sessionId: '12345678-1234-1234-1234-123456789012'
});

console.log(preview);
// {
//   sessionId: "...",
//   cwd: "/Users/user/project",
//   gitBranch: "main",
//   startTime: "2025-01-10T12:00:00Z",
//   messageCount: 25,
//   messages: [...],
//   metadata: {...}
// }
```

### 执行转换
```javascript
import { convertSession } from '@/api/convert';

const result = await convertSession({
  sourceType: 'claude',
  targetType: 'codex',
  sessionId: '12345678-1234-1234-1234-123456789012',
  options: {
    targetProject: '/Users/user/another-project', // 可选
    preserveTimestamps: true
  }
});

console.log(result);
// {
//   success: true,
//   sourceType: "claude",
//   targetType: "codex",
//   sourceSessionId: "...",
//   targetPath: "~/.codex/sessions/2025/01/10/rollout-...",
//   targetSessionId: "new-uuid",
//   messageCount: 25
// }
```

## 文件路径总结

| 文件 | 路径 | 说明 |
|------|------|------|
| 转换器核心 | `src/server/services/session-converter.js` | 核心转换逻辑 |
| API 路由 | `src/server/api/convert.js` | REST API 端点 |
| 路由注册 | `src/server/index.js:107` | Express 路由注册 |
| 前端 API | `src/web/src/api/convert.js` | Axios 客户端 |
| 转换对话框 | `src/web/src/components/ConvertDialog.vue` | UI 组件 |
| 会话卡片 | `src/web/src/components/SessionCard.vue` | 添加了转换按钮 |

## 下一步工作

1. **集成到具体页面**: 将 ConvertDialog 集成到所有会话列表页面
2. **测试验证**: 测试全部 6 条转换路径
3. **错误处理**: 完善错误提示和异常处理
4. **用户体验**: 添加转换进度提示、成功后跳转等

## 注意事项

- 转换后的会话文件会自动生成到对应 CLI 工具的默认位置
- 每次转换都会生成新的 session ID
- 部分元数据可能在转换中丢失（如 Gemini 的 token 统计）
- 工具调用记录仅保留文本内容
