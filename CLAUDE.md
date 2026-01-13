# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Coding-Tool-X (`ctx`) is a Node.js CLI for enhanced management of Claude Code / Codex / Gemini CLI sessions. It provides intelligent session management, multi-channel load balancing, and a modern Web UI for real-time token monitoring.

## Build & Development Commands

```bash
# CLI development
npm start                    # Run CLI (same as `ctx`)
npm run dev:server           # Hot-reload proxy/REST server via nodemon

# Web UI development (requires separate install)
cd src/web && npm install    # First-time setup for frontend
npm run dev:web              # Boot Vite dev server from root
npm run build:web            # Build Vue bundle into src/web/dist

# Verification
ctx ui                       # Start Web UI at http://localhost:9999
ctx proxy start|stop|status  # Manage proxy lifecycle
ctx doctor                   # System diagnostics
```

## Architecture

Three-layer architecture:

```
┌─────────────────────────────────────────────────────────┐
│ Frontend (Vue 3 + Naive UI + Pinia)                     │
│ src/web/src/{components,views,stores,api,router}        │
└─────────────────────────────────────────────────────────┘
                         ↕ HTTP / WebSocket
┌─────────────────────────────────────────────────────────┐
│ Backend (Express + ws + http-proxy)                     │
│ src/server/{index.js, proxy-server.js, websocket-server}│
│ RESTful API: src/server/api/{projects,sessions,channels}│
│ Ports: Web=9999, WebSocket=10099, Proxy=dynamic         │
└─────────────────────────────────────────────────────────┘
                         ↕
┌─────────────────────────────────────────────────────────┐
│ Data Layer (File System)                                │
│ ~/.claude/projects/     - Claude Code projects          │
│ ~/.claude/cc-tool/      - Config (aliases, channels)    │
│ ~/.claude/logs/         - Application logs              │
└─────────────────────────────────────────────────────────┘
```

## Key Directories

- `bin/ctx.js` - CLI entry point
- `src/index.js` - Main CLI orchestrator, menu routing
- `src/commands/` - CLI command handlers (list, search, switch, resume, proxy, daemon, logs)
- `src/server/` - Express backend, proxy server, WebSocket server
- `src/server/api/` - REST routes: projects, sessions, channels, proxy control
- `src/web/` - Vue 3 frontend (separate package.json, needs own `npm install`)
- `src/utils/` - Shared helpers (session parsing, formatting)
- `src/config/` - Configuration schemas and loaders

## Coding Conventions

- 2-space indentation, single quotes, CommonJS (`require`/`module.exports`) in CLI/server
- `const` + `async/await` preferred over callbacks
- Vue components: PascalCase filenames (`HeaderButton.vue`)
- Composables: `useSomething.js` pattern
- Command/script names: kebab-case
- CLI strings use `chalk` for colors; update Vue locales together with CLI wording changes

## Testing

No automated test suite yet. Manual verification required:

1. `ctx ui` - Web UI starts correctly
2. `ctx proxy start/stop/status` - Proxy lifecycle works
3. Multi-channel switching in Web UI
4. `ctx daemon start/stop/logs` - PM2 integration

## API Routes Reference

| Route | Purpose |
|-------|---------|
| `GET /api/projects` | List all projects |
| `GET /api/sessions/:projectName` | Get sessions for project |
| `POST /api/sessions/:projectName/:sessionId/launch` | Launch session |
| `GET /api/channels` | List all channels |
| `POST /api/channels` | Create channel |
| `PUT /api/channels/:id` | Update channel |
| `GET /api/proxy/status` | Proxy status |
| `POST /api/proxy/start` | Start proxy |

## Adding Features

**New API route:**
1. Create route file in `src/server/api/`
2. Register in `src/server/index.js`
3. Add client method in `src/web/src/api/index.js`

**WebSocket events:**
```javascript
const { broadcastLog } = require('./websocket-server');
broadcastLog({ type: 'action', action: 'event_name', message: '...', timestamp: Date.now() });
```
