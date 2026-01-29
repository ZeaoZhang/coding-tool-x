# Plugin Frontend Pages Specification

## Overview
Add plugin management frontend pages to the Coding-Tool Web UI, placed alongside the existing Claude Code Agents functionality.

## Requirements

### Functional Requirements
1. **Plugin List Page** - Display all installed plugins with status, enable/disable toggle, and actions
2. **Plugin Repository List** - Manage plugin sources (Git repositories)
3. **Plugin Install Interface** - Install plugins from Git URL or repository

### Non-Functional Requirements
- Follow existing UI patterns (Drawer + Panel + Card architecture)
- Use Naive UI components consistently
- Support dark/light themes via CSS variables
- Responsive design for mobile/tablet

## Technical Specification

### Architecture
Follow the existing three-layer pattern:
1. **Drawer Component** - Thin wrapper with Naive UI drawer
2. **Panel Component** - Full business logic, API calls
3. **Card/Form Components** - Reusable UI elements

### Files to Create

#### Backend API
- `src/server/api/plugins.js` - REST API routes
- `src/server/services/plugins-service.js` - Service layer

#### Frontend API
- `src/web/src/api/plugins.js` - API client functions

#### Frontend Components
- `src/web/src/components/PluginsDrawer.vue` - Drawer wrapper
- `src/web/src/components/PluginsPanel.vue` - Main panel with tabs
- `src/web/src/components/PluginCard.vue` - Plugin display card
- `src/web/src/components/PluginInstallModal.vue` - Install dialog
- `src/web/src/components/PluginRepoCard.vue` - Repository card

### API Endpoints

```
GET    /api/plugins              - List installed plugins
GET    /api/plugins/:name        - Get plugin details
POST   /api/plugins/install      - Install plugin from Git URL
DELETE /api/plugins/:name        - Uninstall plugin
PUT    /api/plugins/:name/toggle - Enable/disable plugin
PUT    /api/plugins/:name/config - Update plugin config

GET    /api/plugins/repos        - List plugin repositories
POST   /api/plugins/repos        - Add repository
DELETE /api/plugins/repos/:id    - Remove repository
```

### UI Layout

**PluginsPanel with 3 tabs:**
1. **Installed** - Grid of PluginCard components
2. **Repositories** - List of PluginRepoCard components
3. **Install** - Form to install from Git URL

### Integration Points
- Add `PluginsDrawer` to `Layout.vue`
- Add header button with plugin icon
- Add window event listener for `open-plugins-drawer`
