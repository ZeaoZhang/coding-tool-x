# 项目结构

## 目录结构

```
cc-tool/
├── bin/
│   └── cc.js                   # CLI 入口脚本
├── src/
│   ├── commands/               # CLI 命令处理模块
│   │   ├── list.js            # 列出会话
│   │   ├── search.js          # 搜索会话
│   │   ├── switch.js          # 切换项目
│   │   └── resume.js          # 恢复会话
│   ├── utils/                  # 工具函数
│   │   ├── session.js         # 会话相关工具
│   │   └── format.js          # 格式化工具
│   ├── ui/                     # CLI UI 相关
│   │   ├── menu.js            # 主菜单
│   │   └── prompts.js         # 交互提示
│   ├── config/                 # 配置管理
│   │   ├── default.js         # 默认配置
│   │   └── loader.js          # 配置加载器
│   ├── server/                 # 后端服务（v2.0 新增）
│   │   ├── index.js           # 服务入口
│   │   ├── proxy-server.js    # HTTP 代理服务器
│   │   ├── websocket-server.js # WebSocket 服务器
│   │   └── api/               # RESTful API 路由
│   │       ├── projects.js    # 项目管理 API
│   │       ├── sessions.js    # 会话管理 API
│   │       ├── channels.js    # 渠道管理 API
│   │       └── proxy.js       # 代理控制 API
│   ├── web/                    # 前端 Web UI（v2.0 新增）
│   │   ├── src/
│   │   │   ├── components/    # Vue 组件
│   │   │   │   ├── Layout.vue          # 主布局
│   │   │   │   ├── RightPanel.vue      # 右侧面板（渠道+日志）
│   │   │   │   ├── ProjectCard.vue     # 项目卡片
│   │   │   │   ├── SessionCard.vue     # 会话卡片
│   │   │   │   ├── ProxyLogs.vue       # 实时日志
│   │   │   │   └── RecentSessionsDrawer.vue # 最近对话
│   │   │   ├── views/         # 页面视图
│   │   │   │   ├── ProjectList.vue     # 项目列表页
│   │   │   │   └── SessionList.vue     # 会话列表页
│   │   │   ├── stores/        # Pinia 状态管理
│   │   │   │   └── sessions.js         # 会话状态
│   │   │   ├── api/           # API 客户端
│   │   │   │   └── index.js            # Axios 封装
│   │   │   ├── router/        # 路由配置
│   │   │   │   └── index.js
│   │   │   ├── utils/         # 前端工具
│   │   │   │   └── message.js          # 消息提示
│   │   │   ├── App.vue        # 根组件
│   │   │   └── main.js        # 入口文件
│   │   ├── public/            # 静态资源
│   │   │   ├── logo.png       # Logo
│   │   │   └── favicon.ico    # 图标
│   │   ├── index.html
│   │   ├── package.json
│   │   └── vite.config.js     # Vite 配置
│   └── index.js                # CLI 主入口
├── docs/                       # 文档
│   ├── CHANGELOG.md            # 更新日志
│   ├── PROJECT_STRUCTURE.md    # 本文件
│   ├── logo.png                # Logo 图片
│   └── cc-tool.png             # 截图
├── test/                       # 测试文件
├── .gitignore
├── .npmignore
├── package.json
├── config.json
└── README.md
```

## 架构说明

### v2.0 三层架构

```
┌─────────────────────────────────────────────────────┐
│                   前端层 (Vue 3)                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────┐  │
│  │  项目列表    │  │  会话列表    │  │ 全局搜索 │  │
│  └──────────────┘  └──────────────┘  └──────────┘  │
│  ┌──────────────┐  ┌──────────────┐                │
│  │  渠道管理    │  │  实时日志    │                │
│  └──────────────┘  └──────────────┘                │
└─────────────────────────────────────────────────────┘
                         ↕ HTTP/WebSocket
┌─────────────────────────────────────────────────────┐
│                 后端服务层 (Express)                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────┐  │
│  │  Web Server  │  │ Proxy Server │  │ WebSocket│  │
│  │  (port 9999) │  │ (动态端口)   │  │(port 10099)│
│  └──────────────┘  └──────────────┘  └──────────┘  │
│           ↓                ↓                ↓        │
│  ┌──────────────────────────────────────────────┐  │
│  │           RESTful API 路由                    │  │
│  │  /api/projects   /api/sessions              │  │
│  │  /api/channels   /api/proxy                 │  │
│  └──────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
                         ↕
┌─────────────────────────────────────────────────────┐
│                 数据层 (File System)                │
│  ~/.claude/projects/     - ClaudeCode 项目         │
│  ~/.claude/cc-tool/      - 配置文件                │
│    ├── aliases.json      - 会话别名                │
│    ├── channels.json     - API 渠道                │
│    ├── proxy-logs.json   - 实时日志                │
│    └── project-order.json - 项目排序               │
└─────────────────────────────────────────────────────┘
```

## 模块说明

### CLI 模块 (src/commands/, src/ui/)

**传统命令行模式，v1.x 功能保留**

- **list.js**: 列出会话，处理会话列表显示和选择
- **search.js**: 搜索会话，支持关键词搜索
- **switch.js**: 切换项目，管理多个 Claude 项目
- **resume.js**: 恢复会话，启动 Claude CLI
- **menu.js**: 主菜单显示
- **prompts.js**: 各种交互提示

### 后端服务 (src/server/)

**v2.0 新增的 Web 服务器**

#### 核心服务

- **index.js**: 服务主入口，启动 Express 服务器、WebSocket 服务器
- **proxy-server.js**: HTTP 代理服务器，实现动态切换渠道的核心功能
- **websocket-server.js**: WebSocket 服务器，实时推送日志

#### API 路由

##### /api/projects
- `GET /api/projects` - 获取所有项目列表
- `POST /api/projects/:name` - 删除项目

##### /api/sessions
- `GET /api/sessions/:projectName` - 获取项目的会话列表
- `POST /api/sessions/:projectName/:sessionId/launch` - 启动会话
- `POST /api/sessions/:projectName/:sessionId/fork` - Fork 会话
- `POST /api/sessions/:projectName/:sessionId/alias` - 设置别名
- `DELETE /api/sessions/:projectName/:sessionId` - 删除会话
- `POST /api/sessions/search` - 全局搜索会话
- `GET /api/sessions/recent` - 获取最近会话

##### /api/channels
- `GET /api/channels` - 获取所有渠道
- `POST /api/channels` - 创建渠道
- `PUT /api/channels/:id` - 更新渠道
- `DELETE /api/channels/:id` - 删除渠道
- `POST /api/channels/:id/activate` - 激活渠道

##### /api/proxy
- `GET /api/proxy/status` - 获取代理状态
- `POST /api/proxy/start` - 启动代理
- `POST /api/proxy/stop` - 停止代理
- `POST /api/proxy/logs/clear` - 清空日志

### 前端模块 (src/web/)

**v2.0 全新的 Web UI**

#### 组件层

**布局组件**
- `Layout.vue`: 主布局，包含 header 和面板控制
- `RightPanel.vue`: 右侧面板，集成渠道管理和实时日志

**功能组件**
- `ProjectCard.vue`: 项目卡片，支持拖拽排序
- `SessionCard.vue`: 会话卡片，显示会话信息
- `ProxyLogs.vue`: 实时日志组件，WebSocket 连接
- `RecentSessionsDrawer.vue`: 最近对话抽屉

#### 视图层

- `ProjectList.vue`: 项目列表页，支持搜索和全局搜索
- `SessionList.vue`: 会话列表页，显示项目的所有会话

#### 状态管理

**Pinia Store (stores/sessions.js)**
- 项目列表状态
- 会话列表状态
- 加载状态和错误处理
- 项目排序管理

#### 路由

```javascript
/ → ProjectList (项目列表)
/sessions/:projectName → SessionList (会话列表)
/:pathMatch(.*) → 重定向到 /
```

### 工具模块 (src/utils/)

- **session.js**: 会话文件读取、解析、信息提取
- **format.js**: 时间、大小、文本格式化

### 配置模块 (src/config/)

- **default.js**: 默认配置定义
- **loader.js**: 配置加载和保存

## 数据流

### CLI 模式数据流

```
用户启动 cc
  ↓
bin/cc.js → src/index.js
  ↓
显示主菜单 (ui/menu.js)
  ↓
用户选择操作
  ↓
调用对应命令 (commands/*)
  ↓
使用工具函数处理 (utils/*)
  ↓
显示交互提示 (ui/prompts.js)
  ↓
恢复会话 (commands/resume.js)
  ↓
启动 Claude CLI
```

### Web UI 模式数据流

```
用户访问 http://localhost:9999
  ↓
Vue Router 路由到对应页面
  ↓
组件调用 API 客户端 (api/index.js)
  ↓
发送 HTTP 请求到后端 API
  ↓
Express 路由处理请求 (server/api/*)
  ↓
读取/修改文件系统数据
  ↓
返回 JSON 数据
  ↓
Pinia Store 更新状态
  ↓
Vue 组件响应式更新 UI
```

### 动态切换渠道流程

```
用户在 Web UI 切换渠道
  ↓
POST /api/channels/:id/activate
  ↓
更新 channels.json，标记新渠道为 active
  ↓
WebSocket 推送切换日志
  ↓
ClaudeCode 下次 API 请求
  ↓
经过代理服务器 (127.0.0.1:代理端口)
  ↓
代理服务器读取 active 渠道配置
  ↓
转发请求到新的 API 端点
  ↓
返回响应
  ↓
WebSocket 推送请求日志（Token 统计）
```

### WebSocket 实时日志流程

```
浏览器连接 ws://localhost:10099/ws
  ↓
WebSocket 服务器接受连接
  ↓
发送历史日志（最多100条）
  ↓
监听后端事件：
  - 渠道切换事件 → broadcastLog(action)
  - 会话启动事件 → broadcastLog(action)
  - 代理请求事件 → broadcastLog(request data)
  ↓
实时推送到所有连接的客户端
  ↓
前端接收日志 → 更新 UI → 自动滚动
```

## 技术栈

### 后端
- **Node.js** - 运行环境
- **Express.js** - Web 服务器框架
- **ws** - WebSocket 库
- **http-proxy** - HTTP 代理库
- **inquirer** - CLI 交互（v1.x）
- **chalk** - 彩色输出（v1.x）
- **ora** - 加载动画（v1.x）

### 前端
- **Vue 3** - 渐进式框架
- **Naive UI** - UI 组件库
- **Pinia** - 状态管理
- **Vue Router** - 路由管理
- **VueDraggable** - 拖拽排序
- **Axios** - HTTP 客户端
- **Vite** - 构建工具

## 扩展指南

### 添加新的 API 路由

1. 在 `src/server/api/` 创建新路由文件
2. 定义路由处理函数
3. 在 `src/server/index.js` 中注册路由
4. 在前端 `src/web/src/api/index.js` 添加对应方法

示例：
```javascript
// src/server/api/example.js
const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
  res.json({ message: 'Hello' });
});

module.exports = router;

// src/server/index.js
const exampleRouter = require('./api/example');
app.use('/api/example', exampleRouter);

// src/web/src/api/index.js
async getExample() {
  const response = await client.get('/example')
  return response.data
}
```

### 添加新的 Vue 组件

1. 在 `src/web/src/components/` 创建组件文件
2. 使用 Vue 3 Composition API
3. 引入 Naive UI 组件
4. 在需要的页面中导入使用

### 添加 WebSocket 事件

1. 在后端代码中调用 `broadcastLog(data)`
2. 数据会自动推送到所有连接的客户端
3. 前端 `ProxyLogs.vue` 会自动接收并显示

示例：
```javascript
// 后端任意位置
const { broadcastLog } = require('./websocket-server');

broadcastLog({
  type: 'action',
  action: 'custom_event',
  message: '自定义事件发生',
  timestamp: Date.now()
});
```

## 设计原则

- **单一职责**: 每个模块只负责一个功能
- **低耦合**: 通过参数传递依赖，避免全局状态
- **可测试**: 纯函数设计，易于单元测试
- **可扩展**: 模块化架构，易于添加新功能
- **响应式**: 前端使用 Vue 3 响应式系统
- **实时性**: WebSocket 实时通信
- **持久化**: 所有配置和状态自动保存

## 性能优化

- **大文件优化**: 会话文件大于 10MB 时，只读取必要部分
- **WebSocket 重连**: 最多 3 次重连，指数退避（5s, 10s, 15s）
- **API 轮询**: 从 5s 优化到 30s，减少服务器压力
- **日志限制**: 最多保留 100 条日志，防止内存溢出
- **按需加载**: 路由懒加载，组件按需引入
