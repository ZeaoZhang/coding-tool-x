# Product Specification: Configurable Default Models

## Requirements Analysis

### 1. Functional Requirements

#### Core Functionality
- **FR1**: System must support configurable default model lists per tool type (Claude, Codex, Gemini, OpenCode)
- **FR2**: Configuration must be editable through Web UI settings panel
- **FR3**: Model lists must be used consistently across all UI components:
  - Channel creation/editing dropdowns
  - Model redirect editor autocomplete
  - Pricing configuration model lists
- **FR4**: System must provide sensible defaults matching current hardcoded behavior
- **FR5**: Users must be able to add custom model names (for new models not yet in defaults)
- **FR6**: Users must be able to reset to built-in defaults per tool type or globally
- **FR7**: Configuration must persist across application restarts

#### Data Flow
- **FR8**: Backend must be single source of truth for model lists
- **FR9**: Frontend must fetch model lists via API on application initialization
- **FR10**: Changes made in settings must propagate to all consuming components without page refresh

### 2. Non-Functional Requirements

#### Performance
- **NFR1**: Model list fetch must complete within 500ms on local network
- **NFR2**: Settings save operation must complete within 1 second
- **NFR3**: Frontend must cache model lists to avoid repeated API calls

#### Usability
- **NFR4**: UI must provide autocomplete/suggestions when adding models
- **NFR5**: UI must prevent empty model lists (at least one model required per tool type)
- **NFR6**: UI must show clear feedback on save success/failure
- **NFR7**: Model names must be validated to prevent typos/invalid formats

#### Maintainability
- **NFR8**: Solution must follow existing codebase patterns (config structure, API design, Vue composables)
- **NFR9**: Code must be documented with clear comments explaining the configuration schema
- **NFR10**: Solution must support easy addition of new tool types in future

#### Reliability
- **NFR11**: System must gracefully handle API failures (fallback to built-in defaults)
- **NFR12**: Invalid configuration must not crash the application
- **NFR13**: Backward compatibility: existing config.json files without defaultModels key must work unchanged

### 3. Implicit Requirements

#### User Experience
- **IR1**: Users should not need to restart the application after changing model lists
- **IR2**: The UI should indicate which models are built-in defaults vs user-customized
- **IR3**: Bulk operations (reset all, import/export) would improve UX but are out of scope for Phase 1

#### Data Integrity
- **IR4**: Model lists should be deduplicated automatically
- **IR5**: Whitespace should be trimmed from model names
- **IR6**: Empty strings should be filtered out
- **IR7**: Maximum list length should be enforced to prevent abuse (50 models per type)

#### Security
- **IR8**: Model name validation should prevent injection attacks (restrict to alphanumeric + common separators)
- **IR9**: API endpoints should validate input structure before saving

#### Integration
- **IR10**: Solution should not break existing channel functionality
- **IR11**: Model redirect rules should continue to work with custom models
- **IR12**: Pricing configuration should handle unknown models gracefully

### 4. Out of Scope

#### Phase 1 Exclusions
- **OOS1**: Dynamic model discovery from API providers (e.g., fetching available models from Claude API)
- **OOS2**: Model capability metadata (context window, pricing, features)
- **OOS3**: Model deprecation warnings or version recommendations
- **OOS4**: Import/export of model configurations
- **OOS5**: Model aliases or display name customization
- **OOS6**: Per-channel model list overrides (all channels share same defaults)
- **OOS7**: Model usage statistics or recommendations based on history
- **OOS8**: Integration with external model registries or catalogs

#### Explicitly NOT Changing
- **OOS9**: Channel model selection logic (still uses channel-specific model field)
- **OOS10**: Proxy server model routing behavior
- **OOS11**: Model pricing calculation formulas
- **OOS12**: Authentication or authorization for model access

---

## Technical Specification

### Summary

The codebase has **three independent, hardcoded model lists** that are never synchronized: `channelPanelFactories.js:45-77` (channel creation dropdowns), `ModelRedirectEditor.vue:67-92` (redirect autocomplete), and `SettingsDrawer.vue:1308-1312` (pricing per-model config). The backend has zero awareness of model lists. This specification defines a single backend-owned `defaultModels` config key, a new API surface on the existing `/api/config` router, and a frontend consumption pattern that replaces all three hardcoded sources.

### Current State Analysis

#### Three Divergent Hardcoded Lists

| Location | File:Line | Tool Types | Purpose |
|----------|-----------|------------|---------|
| Channel Panel Factories | `src/web/src/components/channel/channelPanelFactories.js:45-77` | claude, codex, gemini, opencode | Dropdown options when creating/editing channels |
| Model Redirect Editor | `src/web/src/components/channel/ModelRedirectEditor.vue:67-92` | claude, codex, gemini (missing opencode) | Autocomplete for model redirect rules |
| Settings Drawer (Pricing) | `src/web/src/components/SettingsDrawer.vue:1308-1312` | claude, codex, gemini (missing opencode) | Per-model pricing configuration |

These lists are already **out of sync** with each other.

#### Existing Config Infrastructure

- **Config file**: `config.json` (project root)
- **Loader**: `src/config/loader.js` -- `loadConfig()` merges `DEFAULT_CONFIG` with `config.json`
- **Default**: `src/config/default.js` -- exports `DEFAULT_CONFIG` object
- **API**: `src/server/api/config.js` -- `GET/POST /api/config/advanced`
- **Frontend**: `SettingsDrawer.vue` calls `fetch('/api/config/advanced')` directly

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  config.json (single source of truth)                       │
│  { ..., "defaultModels": { claude: [...], codex: [...] } }  │
└──────────────────────────┬──────────────────────────────────┘
                           │ loadConfig() / saveConfig()
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Backend: src/server/api/config.js                          │
│  GET  /api/config/default-models  → returns merged lists    │
│  POST /api/config/default-models  → validates & saves       │
│  POST /api/config/default-models/reset → reset to defaults  │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTP JSON
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Frontend: useDefaultModels.js composable (cache layer)     │
│  - Fetches once on app init                                 │
│  - Caches in reactive ref                                   │
│  - Provides getDefaultModels(toolType) helper              │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Frontend consumers (all read from composable)              │
│  - SettingsDrawer.vue       (edit UI)                       │
│  - channelPanelFactories.js (dropdown options)              │
│  - ModelRedirectEditor.vue  (autocomplete options)          │
└─────────────────────────────────────────────────────────────┘
```

### Implementation Plan

#### 1. Backend Changes

**File: `src/config/default.js`**
- Add `defaultModels` key to `DEFAULT_CONFIG` with current hardcoded lists

**File: `src/config/loader.js`**
- Add `mergeDefaultModels()` function (similar to `mergePricing()`)
- Call merge function in `loadConfig()`

**File: `src/server/api/config.js`**
- Add `GET /api/config/default-models` route
- Add `POST /api/config/default-models` route with validation
- Add `POST /api/config/default-models/reset` route

#### 2. Frontend Changes

**File: `src/web/src/composables/useDefaultModels.js`** (NEW)
- Create composable with fetch/cache logic
- Export `getDefaultModels(toolType)` helper
- Include built-in fallback for offline scenarios

**File: `src/web/src/components/SettingsDrawer.vue`**
- Add "Default Models" section to advanced settings
- Use `n-dynamic-tags` for model list editing
- Replace `MODEL_DEFINITIONS` with composable import

**File: `src/web/src/components/channel/channelPanelFactories.js`**
- Remove hardcoded `defaultModels` object
- Import and use `useDefaultModels()` composable

**File: `src/web/src/components/channel/ModelRedirectEditor.vue`**
- Remove hardcoded `defaultModelsByType` object
- Import and use `useDefaultModels()` composable

### Data Schema

#### Config File Format (`config.json`)

```json
{
  "defaultModels": {
    "claude": [
      "claude-opus-4-6",
      "claude-opus-4-5-20251101",
      "claude-sonnet-4-5-20250929",
      "claude-haiku-4-5-20251001",
      "claude-sonnet-4-20250514",
      "claude-opus-4-20250514"
    ],
    "codex": [
      "gpt-5.2-codex",
      "gpt-5.1-codex-max",
      "gpt-5.1-codex-mini",
      "gpt-5.1-codex",
      "gpt-5-codex",
      "gpt-5.2",
      "gpt-5.1",
      "gpt-5"
    ],
    "gemini": [
      "gemini-3-pro",
      "gemini-3-flash",
      "gemini-3-deep-think",
      "gemini-2.5-pro",
      "gemini-2.5-flash"
    ],
    "opencode": [
      "gpt-4o",
      "gpt-4o-mini",
      "claude-3-5-sonnet",
      "claude-3-opus",
      "deepseek-chat"
    ]
  }
}
```

### API Contract

#### GET /api/config/default-models

**Response (200):**
```json
{
  "defaultModels": {
    "claude": ["..."],
    "codex": ["..."],
    "gemini": ["..."],
    "opencode": ["..."]
  }
}
```

#### POST /api/config/default-models

**Request:**
```json
{
  "defaultModels": {
    "claude": ["model-a", "model-b"]
  }
}
```

**Response (200):**
```json
{
  "success": true,
  "defaultModels": { "claude": ["model-a", "model-b"], "...": "..." }
}
```

**Response (400):**
```json
{
  "error": "Validation failed",
  "details": { "claude": "Model list cannot be empty" }
}
```

#### POST /api/config/default-models/reset

**Request:**
```json
{
  "toolType": "claude"
}
```
Or omit `toolType` to reset all.

**Response (200):**
```json
{
  "success": true,
  "defaultModels": { "...": "..." }
}
```

### Validation Rules

| Rule | Implementation | Error Message |
|------|---------------|---------------|
| Non-empty list | `array.length === 0` check | `"${toolType} model list cannot be empty"` |
| String entries only | `typeof entry === 'string'` filter | Silently strip non-strings |
| Trim whitespace | `.trim()` on each entry | Silently trim |
| Remove empty strings | `.filter(m => m.trim())` | Silently remove |
| Deduplicate | `[...new Set(array)]` | Silently deduplicate |
| Max list length | `array.length <= 50` | `"${toolType} model list exceeds maximum of 50 entries"` |
| Model name format | `/^[a-zA-Z0-9._\-/:]+$/` | `"Invalid model name: ${name}"` |
| Valid tool types only | Whitelist `['claude','codex','gemini','opencode']` | Silently ignore unknown keys |

### Migration Strategy

**Backward Compatibility**: Existing `config.json` files without `defaultModels` key will automatically use built-in defaults via spread merge in `loadConfig()`. No migration script needed.

**Frontend Migration**: Replace hardcoded lists incrementally:
1. Create `useDefaultModels.js` composable
2. Replace `channelPanelFactories.js` hardcoded list
3. Replace `ModelRedirectEditor.vue` hardcoded list
4. Replace `SettingsDrawer.vue` MODEL_DEFINITIONS

**Fallback**: If API call fails, composable returns built-in defaults embedded in the composable file.

### Files to Modify

| File | Change Type |
|------|-------------|
| `src/config/default.js` | Add `defaultModels` key |
| `src/config/loader.js` | Add merge function |
| `src/server/api/config.js` | Add 3 new routes |
| `src/web/src/components/SettingsDrawer.vue` | Add UI section, replace MODEL_DEFINITIONS |
| `src/web/src/components/channel/channelPanelFactories.js` | Replace hardcoded list |
| `src/web/src/components/channel/ModelRedirectEditor.vue` | Replace hardcoded list |

### Files to Create

| File | Purpose |
|------|---------|
| `src/web/src/composables/useDefaultModels.js` | Fetch/cache/expose model lists |

---

## Success Criteria

- [ ] All three hardcoded model lists replaced with single backend config
- [ ] Settings UI allows adding/removing models per tool type
- [ ] Reset to defaults works per tool type and globally
- [ ] Changes propagate to all consumers without page refresh
- [ ] Existing config.json files work without modification
- [ ] API failures gracefully fall back to built-in defaults
- [ ] Model name validation prevents invalid entries
- [ ] No breaking changes to existing channel/redirect functionality

---

**EXPANSION_COMPLETE**
