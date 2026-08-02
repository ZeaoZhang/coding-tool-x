# OMP 技能扫描设置实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 OMP 技能管理页和抽屉增加四项扫描来源设置，并通过白名单 API 安全持久化到 OMP `config.yml`。

**Architecture:** 新增 `omp-skill-settings-service.js` 封装默认值、校验和保留式合并，`skills.js` 路由只负责 GET/PUT HTTP 协议。前端新增专用窄弹窗和轻量交互辅助模块，`SkillsPanel` 仅控制 OMP 条件入口、弹窗可见性以及保存后的强制刷新。

**Tech Stack:** Node.js、Express、js-yaml、Vue 3 `<script setup>`、Naive UI、Vitest、Vite。

---

## 文件结构

- Create: `src/server/services/omp-skill-settings-service.js`，四字段设置的默认值、选择、校验、读取和保留式更新。
- Modify: `src/server/api/skills.js`，注册专用 GET/PUT 路由。
- Create: `tests/unit/services/omp-skill-settings-service.test.js`，默认值、部分更新、字段保留和非法写入保护。
- Modify: `tests/unit/api/skills-api.test.js`，验证专用 API 的成功响应与 400 错误映射。
- Modify: `src/web/src/api/skills.js`，封装 GET/PUT 客户端调用。
- Create: `src/web/src/utils/omp-skill-settings.js`，OMP 入口条件和保存后刷新编排。
- Create: `tests/unit/web/omp-skill-settings.test.js`，入口条件、成功刷新和失败不刷新回归。
- Create: `src/web/src/components/OmpSkillSettingsModal.vue`，四开关窄弹窗及加载、保存、错误状态。
- Modify: `src/web/src/components/SkillsPanel.vue`，独立页与抽屉页入口和保存事件集成。
- Modify: `CHANGELOG.md`，在最终验证通过后记录功能。

### Task 1: 服务端设置服务

**Files:**
- Create: `tests/unit/services/omp-skill-settings-service.test.js`
- Create: `src/server/services/omp-skill-settings-service.js`

- [ ] **Step 1: 编写默认值和部分更新失败测试**

在测试中先通过 `require.cache` 注入 `readOmpSettings` 与 `writeOmpSettings`，再加载待测服务。覆盖缺失配置默认全开、部分更新仅修改目标字段：

```js
const CONFIG_MODULE = require.resolve('../../../src/server/services/omp-config');
const SERVICE_MODULE = require.resolve('../../../src/server/services/omp-skill-settings-service');

let persisted;
let readOmpSettings;
let writeOmpSettings;

beforeEach(() => {
  persisted = {};
  readOmpSettings = vi.fn(() => structuredClone(persisted));
  writeOmpSettings = vi.fn(next => { persisted = structuredClone(next); });
  require.cache[CONFIG_MODULE] = {
    id: CONFIG_MODULE,
    filename: CONFIG_MODULE,
    loaded: true,
    exports: { readOmpSettings, writeOmpSettings }
  };
  delete require.cache[SERVICE_MODULE];
});

afterEach(() => {
  delete require.cache[SERVICE_MODULE];
  delete require.cache[CONFIG_MODULE];
});

test('returns true defaults for every managed scan source', () => {
  const { readOmpSkillSettings } = require(SERVICE_MODULE);
  expect(readOmpSkillSettings()).toEqual({
    enableCodexUser: true,
    enableClaudeUser: true,
    enablePiUser: true,
    enablePiProject: true
  });
});

test('partially updates one scan source', () => {
  persisted = { skills: { enableCodexUser: false } };
  const { updateOmpSkillSettings } = require(SERVICE_MODULE);
  expect(updateOmpSkillSettings({ enablePiProject: false })).toEqual({
    enableCodexUser: false,
    enableClaudeUser: true,
    enablePiUser: true,
    enablePiProject: false
  });
});
```

- [ ] **Step 2: 运行测试并确认 RED**

Run: `npx vitest run tests/unit/services/omp-skill-settings-service.test.js`

Expected: FAIL，原因是 `omp-skill-settings-service` 模块不存在。

- [ ] **Step 3: 实现最小默认值、选择和部分更新**

创建服务模块：

```js
const { readOmpSettings, writeOmpSettings } = require('./omp-config');

const OMP_SKILL_SETTING_DEFAULTS = Object.freeze({
  enableCodexUser: true,
  enableClaudeUser: true,
  enablePiUser: true,
  enablePiProject: true
});
const OMP_SKILL_SETTING_KEYS = Object.freeze(Object.keys(OMP_SKILL_SETTING_DEFAULTS));

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function selectOmpSkillSettings(skills) {
  const source = isPlainObject(skills) ? skills : {};
  return Object.fromEntries(
    OMP_SKILL_SETTING_KEYS.map(key => [
      key,
      typeof source[key] === 'boolean' ? source[key] : OMP_SKILL_SETTING_DEFAULTS[key]
    ])
  );
}

function readOmpSkillSettings() {
  return selectOmpSkillSettings(readOmpSettings().skills);
}

function validateOmpSkillSettingsPatch(patch) {
  if (!isPlainObject(patch)) throw new Error('Invalid OMP skill settings: expected an object');
  for (const [key, value] of Object.entries(patch)) {
    if (!OMP_SKILL_SETTING_KEYS.includes(key)) {
      throw new Error(`Invalid OMP skill setting: ${key}`);
    }
    if (typeof value !== 'boolean') {
      throw new Error(`Invalid OMP skill setting value for ${key}: expected boolean`);
    }
  }
  return patch;
}

function updateOmpSkillSettings(patch) {
  validateOmpSkillSettingsPatch(patch);
  const config = readOmpSettings();
  const existingSkills = isPlainObject(config.skills) ? config.skills : {};
  const nextConfig = {
    ...config,
    skills: { ...existingSkills, ...patch }
  };
  writeOmpSettings(nextConfig);
  return selectOmpSkillSettings(nextConfig.skills);
}

module.exports = {
  OMP_SKILL_SETTING_DEFAULTS,
  OMP_SKILL_SETTING_KEYS,
  readOmpSkillSettings,
  updateOmpSkillSettings,
  validateOmpSkillSettingsPatch
};
```

- [ ] **Step 4: 运行测试并确认 GREEN**

Run: `npx vitest run tests/unit/services/omp-skill-settings-service.test.js`

Expected: PASS。

- [ ] **Step 5: 添加字段保留和非法请求失败测试**

追加测试：

```js
test('preserves unrelated top-level and skills fields', () => {
  persisted = {
    theme: 'night',
    skills: {
      enabled: false,
      customDirectories: ['/opt/skills'],
      enableClaudeUser: true
    }
  };
  const { updateOmpSkillSettings } = require(SERVICE_MODULE);
  updateOmpSkillSettings({ enableClaudeUser: false });
  expect(persisted).toEqual({
    theme: 'night',
    skills: {
      enabled: false,
      customDirectories: ['/opt/skills'],
      enableClaudeUser: false
    }
  });
});

test.each([
  [{ enableAgentsUser: false }, /Invalid OMP skill setting/],
  [{ enablePiUser: 'false' }, /expected boolean/],
  [null, /expected an object/],
  [[], /expected an object/]
])('rejects invalid patch without writing it', (patch, message) => {
  persisted = { skills: { enabled: true } };
  const before = structuredClone(persisted);
  const { updateOmpSkillSettings } = require(SERVICE_MODULE);
  expect(() => updateOmpSkillSettings(patch)).toThrow(message);
  expect(writeOmpSettings).not.toHaveBeenCalled();
  expect(persisted).toEqual(before);
});

test('accepts an empty patch without destroying existing config', () => {
  persisted = { providers: { demo: {} }, skills: { enablePiUser: false } };
  const { updateOmpSkillSettings } = require(SERVICE_MODULE);
  expect(updateOmpSkillSettings({}).enablePiUser).toBe(false);
  expect(persisted.providers).toEqual({ demo: {} });
});
```

- [ ] **Step 6: 运行新增测试并确认 GREEN**

Run: `npx vitest run tests/unit/services/omp-skill-settings-service.test.js`

Expected: PASS；非法 patch 不调用 `writeOmpSettings`，合法部分更新保留所有无关字段。

- [ ] **Step 7: 提交服务层**

```bash
git add src/server/services/omp-skill-settings-service.js tests/unit/services/omp-skill-settings-service.test.js
git commit -m "feat: add OMP skill settings service"
```

### Task 2: 专用 Skills API

**Files:**
- Modify: `tests/unit/api/skills-api.test.js`
- Modify: `src/server/api/skills.js`

- [ ] **Step 1: 为路由测试注入设置服务桩**

在 `beforeEach` 中、加载路由前加入：

```js
ompSkillSettings = {
  readOmpSkillSettings: vi.fn(() => ({
    enableCodexUser: true,
    enableClaudeUser: true,
    enablePiUser: true,
    enablePiProject: true
  })),
  updateOmpSkillSettings: vi.fn(patch => ({
    enableCodexUser: true,
    enableClaudeUser: true,
    enablePiUser: true,
    enablePiProject: patch.enablePiProject ?? true
  }))
};
const ompSkillSettingsPath = require.resolve('../../../src/server/services/omp-skill-settings-service');
require.cache[ompSkillSettingsPath] = {
  id: ompSkillSettingsPath,
  filename: ompSkillSettingsPath,
  loaded: true,
  exports: ompSkillSettings
};
```

并在 `afterEach` 删除该缓存。

- [ ] **Step 2: 编写 GET、PUT 和非法字段 API 测试**

```js
describe('OMP skill settings', () => {
  test('GET /omp-settings returns persisted settings', async () => {
    const res = await request(buildApp()).get('/omp-settings');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      settings: {
        enableCodexUser: true,
        enableClaudeUser: true,
        enablePiUser: true,
        enablePiProject: true
      }
    });
  });

  test('PUT /omp-settings applies a partial update', async () => {
    const res = await request(buildApp()).put('/omp-settings', { enablePiProject: false });
    expect(res.status).toBe(200);
    expect(ompSkillSettings.updateOmpSkillSettings).toHaveBeenCalledWith({ enablePiProject: false });
    expect(res.body.settings.enablePiProject).toBe(false);
  });

  test('PUT /omp-settings maps validation failure to 400', async () => {
    ompSkillSettings.updateOmpSkillSettings.mockImplementation(() => {
      throw new Error('Invalid OMP skill setting: unknown');
    });
    const res = await request(buildApp()).put('/omp-settings', { unknown: true });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});
```

- [ ] **Step 3: 运行 API 测试并确认 RED**

Run: `npx vitest run tests/unit/api/skills-api.test.js`

Expected: FAIL，`/omp-settings` 尚未注册或被通配技能详情路由截获。

- [ ] **Step 4: 在通配路由之前注册专用路由**

在 `src/server/api/skills.js` 顶部导入服务：

```js
const {
  readOmpSkillSettings,
  updateOmpSkillSettings
} = require('../services/omp-skill-settings-service');
```

在 `router.get('/detail/*', ...)` 之前加入，确保固定路径不被后续参数路由截获：

```js
router.get('/omp-settings', (req, res) => {
  try {
    res.json({ success: true, settings: readOmpSkillSettings() });
  } catch (err) {
    console.error('[Skills API] Read OMP settings error:', err);
    sendApiError(res, err);
  }
});

router.put('/omp-settings', (req, res) => {
  try {
    res.json({ success: true, settings: updateOmpSkillSettings(req.body) });
  } catch (err) {
    console.error('[Skills API] Update OMP settings error:', err);
    sendApiError(res, err);
  }
});
```

- [ ] **Step 5: 运行 API 和服务测试并确认 GREEN**

Run: `npx vitest run tests/unit/api/skills-api.test.js tests/unit/services/omp-skill-settings-service.test.js`

Expected: PASS。

- [ ] **Step 6: 提交 API**

```bash
git add src/server/api/skills.js tests/unit/api/skills-api.test.js
git commit -m "feat: expose OMP skill settings API"
```

### Task 3: 前端 API 与交互辅助模块

**Files:**
- Modify: `src/web/src/api/skills.js`
- Create: `src/web/src/utils/omp-skill-settings.js`
- Create: `tests/unit/web/omp-skill-settings.test.js`

- [ ] **Step 1: 编写前端 API 和入口条件失败测试**

```js
import { beforeEach, describe, expect, test, vi } from 'vitest';

const client = {
  get: vi.fn(async () => ({ data: { success: true, settings: {} } })),
  put: vi.fn(async () => ({ data: { success: true, settings: {} } }))
};
vi.mock('../../../src/web/src/api/client.js', () => ({ client }));

describe('OMP skill settings web integration', () => {
  beforeEach(() => vi.clearAllMocks());

  test('calls the dedicated GET and PUT endpoints', async () => {
    const { getOmpSkillSettings, updateOmpSkillSettings } = await import('../../../src/web/src/api/skills.js');
    await getOmpSkillSettings();
    await updateOmpSkillSettings({ enablePiProject: false });
    expect(client.get).toHaveBeenCalledWith('/skills/omp-settings');
    expect(client.put).toHaveBeenCalledWith('/skills/omp-settings', { enablePiProject: false });
  });

  test.each([
    ['omp', true],
    ['claude', false],
    ['codex', false],
    ['gemini', false],
    ['opencode', false]
  ])('shows settings only for %s', async (platform, expected) => {
    const { supportsOmpSkillSettings } = await import('../../../src/web/src/utils/omp-skill-settings.js');
    expect(supportsOmpSkillSettings(platform)).toBe(expected);
  });
});
```

- [ ] **Step 2: 运行测试并确认 RED**

Run: `npx vitest run tests/unit/web/omp-skill-settings.test.js`

Expected: FAIL，API 方法和辅助模块不存在。

- [ ] **Step 3: 实现前端 API 和入口判断**

在 `src/web/src/api/skills.js` 增加：

```js
export async function getOmpSkillSettings() {
  const response = await client.get('/skills/omp-settings');
  return response.data;
}

export async function updateOmpSkillSettings(settings) {
  const response = await client.put('/skills/omp-settings', settings);
  return response.data;
}
```

创建辅助模块：

```js
export function supportsOmpSkillSettings(platform) {
  return platform === 'omp';
}

export async function refreshAfterOmpSkillSettingsSave(refreshSkills) {
  await refreshSkills(true);
}
```

- [ ] **Step 4: 编写保存成功刷新一次的测试**

```js
test('refreshes the skill list once after a successful modal save', async () => {
  const { refreshAfterOmpSkillSettingsSave } = await import('../../../src/web/src/utils/omp-skill-settings.js');
  const refreshSkills = vi.fn(async () => {});
  await refreshAfterOmpSkillSettingsSave(refreshSkills);
  expect(refreshSkills).toHaveBeenCalledTimes(1);
  expect(refreshSkills).toHaveBeenCalledWith(true);
});
```

写入失败时弹窗不会发出 `saved`，因此 SkillsPanel 不会调用该刷新辅助函数。API reject 测试验证失败保持向上传播：

```js
test('propagates a settings write failure without touching an existing list', async () => {
  const existingSkills = [{ key: 'kept' }];
  client.put.mockRejectedValueOnce(new Error('write failed'));
  const { updateOmpSkillSettings } = await import('../../../src/web/src/api/skills.js');
  await expect(updateOmpSkillSettings({ enablePiUser: false })).rejects.toThrow('write failed');
  expect(existingSkills).toEqual([{ key: 'kept' }]);
});
```

读取失败由设置弹窗自身处理，且读取函数不接收或修改技能列表。补一个失败断言：

```js
test('a settings read failure leaves the existing skill list untouched', async () => {
  const existingSkills = [{ key: 'kept' }];
  client.get.mockRejectedValueOnce(new Error('read failed'));
  const { getOmpSkillSettings } = await import('../../../src/web/src/api/skills.js');
  await expect(getOmpSkillSettings()).rejects.toThrow('read failed');
  expect(existingSkills).toEqual([{ key: 'kept' }]);
});
```

- [ ] **Step 5: 运行测试并确认 GREEN**

Run: `npx vitest run tests/unit/web/omp-skill-settings.test.js`

Expected: PASS。

- [ ] **Step 6: 提交前端数据层**

```bash
git add src/web/src/api/skills.js src/web/src/utils/omp-skill-settings.js tests/unit/web/omp-skill-settings.test.js
git commit -m "feat: add OMP skill settings web flow"
```

### Task 4: 设置弹窗组件

**Files:**
- Create: `src/web/src/components/OmpSkillSettingsModal.vue`

- [ ] **Step 1: 创建四开关弹窗模板**

组件使用受控 `visible` 属性，读取时 `NSpin`，读取失败时 `NAlert`，设置项按行展示：

```vue
<template>
  <n-modal
    v-model:show="visible"
    preset="card"
    title="技能扫描设置"
    :bordered="false"
    :closable="!saving"
    :mask-closable="!saving"
    :close-on-esc="!saving"
    style="width: 420px; max-width: 92vw;"
  >
    <n-spin :show="loading">
      <n-alert v-if="loadError" type="error" :show-icon="true">
        {{ loadError }}
      </n-alert>
      <div v-else class="scan-settings">
        <div class="section-title">扫描来源</div>
        <div v-for="item in settingItems" :key="item.key" class="setting-row">
          <div class="setting-copy">
            <div class="setting-label">{{ item.label }}</div>
            <div class="setting-description">{{ item.description }}</div>
          </div>
          <n-switch v-model:value="form[item.key]" :disabled="loading || saving" />
        </div>
      </div>
    </n-spin>
    <template #footer>
      <div class="modal-actions">
        <n-button :disabled="saving" @click="visible = false">取消</n-button>
        <n-button type="primary" :loading="saving" :disabled="loading || !!loadError" @click="handleSave">
          保存
        </n-button>
      </div>
    </template>
  </n-modal>
</template>
```

- [ ] **Step 2: 实现读取、表单和保存状态**

```vue
<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { NAlert, NButton, NModal, NSpin, NSwitch, useMessage } from 'naive-ui'
import { getOmpSkillSettings, updateOmpSkillSettings } from '../api/skills'

const props = defineProps({ visible: Boolean })
const emit = defineEmits(['update:visible', 'saved'])
const message = useMessage()
const loading = ref(false)
const saving = ref(false)
const loadError = ref('')
const form = reactive({
  enableCodexUser: true,
  enableClaudeUser: true,
  enablePiUser: true,
  enablePiProject: true
})
const settingItems = [
  { key: 'enableCodexUser', label: 'Codex 用户 Skills', description: '扫描 Codex 用户技能目录' },
  { key: 'enableClaudeUser', label: 'Claude 用户与插件 Skills', description: '扫描 Claude 用户目录和插件技能' },
  { key: 'enablePiUser', label: 'OMP 用户与插件 Skills', description: '扫描 OMP 用户目录和插件技能' },
  { key: 'enablePiProject', label: '当前项目 Skills', description: '扫描当前项目 .omp/skills' }
]
const visible = computed({
  get: () => props.visible,
  set: value => {
    if (!saving.value) emit('update:visible', value)
  }
})

async function loadSettings() {
  loading.value = true
  loadError.value = ''
  try {
    const result = await getOmpSkillSettings()
    Object.assign(form, result.settings)
  } catch (error) {
    loadError.value = `加载技能扫描设置失败: ${error.message}`
    message.error(loadError.value)
  } finally {
    loading.value = false
  }
}

async function handleSave() {
  saving.value = true
  try {
    await updateOmpSkillSettings({ ...form })
    message.success('技能扫描设置已保存')
    emit('saved')
  } catch (error) {
    message.error(`保存技能扫描设置失败: ${error.message}`)
  } finally {
    saving.value = false
  }
}

watch(() => props.visible, value => {
  if (value) loadSettings()
})
</script>
```

- [ ] **Step 3: 添加局部样式**

```vue
<style scoped>
.scan-settings { display: flex; flex-direction: column; }
.section-title { margin-bottom: 8px; color: var(--text-secondary); font-size: 13px; font-weight: 600; }
.setting-row { display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 12px 0; border-bottom: 1px solid var(--border-light); }
.setting-row:last-child { border-bottom: 0; }
.setting-copy { min-width: 0; }
.setting-label { color: var(--text-primary); font-weight: 500; }
.setting-description { margin-top: 3px; color: var(--text-tertiary); font-size: 12px; line-height: 1.45; }
.modal-actions { display: flex; justify-content: flex-end; gap: 8px; }
</style>
```

- [ ] **Step 4: 运行 Web 构建并处理模板错误**

Run: `npm run build:web`

Expected: PASS，Vite 输出生产构建文件，无 Vue 编译错误。

- [ ] **Step 5: 提交弹窗组件**

```bash
git add src/web/src/components/OmpSkillSettingsModal.vue
git commit -m "feat: add OMP skill scan settings modal"
```

### Task 5: SkillsPanel 条件入口与保存刷新

**Files:**
- Modify: `src/web/src/components/SkillsPanel.vue`

- [ ] **Step 1: 在独立页和抽屉页加入同一条件入口**

在两处 `asset-action-row` 的刷新按钮前加入：

```vue
<n-button
  v-if="showOmpSettings"
  text
  :focusable="false"
  class="action-btn"
  @click="showOmpSettingsModal = true"
>
  <template #icon><n-icon><SettingsOutline /></n-icon></template>
  设置
</n-button>
```

在现有弹窗组件区域加入：

```vue
<OmpSkillSettingsModal
  v-model:visible="showOmpSettingsModal"
  @saved="handleOmpSettingsSaved"
/>
```

- [ ] **Step 2: 接入平台判断和保存编排**

更新导入：

```js
import { SettingsOutline } from '@vicons/ionicons5'
import OmpSkillSettingsModal from './OmpSkillSettingsModal.vue'
import {
  refreshAfterOmpSkillSettingsSave,
  supportsOmpSkillSettings
} from '../utils/omp-skill-settings'
```

增加状态和计算属性：

```js
const showOmpSettingsModal = ref(false)
const showOmpSettings = computed(() => supportsOmpSkillSettings(currentPlatform.value))
```

`saved` 仅在弹窗 PUT 成功后发出；SkillsPanel 只负责关闭弹窗并执行强制刷新：

```js
async function handleOmpSettingsSaved() {
  showOmpSettingsModal.value = false
  await refreshAfterOmpSkillSettingsSave(loadData)
}
```

- [ ] **Step 3: 核对最终回归边界**

Task 3 的回归测试必须保持以下断言：

- `supportsOmpSkillSettings('omp')` 为 `true`，其他内建平台为 `false`。
- `refreshAfterOmpSkillSettingsSave` 仅调用一次 `loadData(true)` 形态的回调。
- GET 或 PUT reject 时调用方收到错误，既有技能数组未被修改。

- [ ] **Step 4: 运行前端回归与生产构建**

Run: `npx vitest run tests/unit/web/omp-skill-settings.test.js && npm run build:web`

Expected: 测试 PASS，Web 构建 PASS。

- [ ] **Step 5: 提交 SkillsPanel 集成**

```bash
git add src/web/src/components/SkillsPanel.vue src/web/src/utils/omp-skill-settings.js tests/unit/web/omp-skill-settings.test.js
git commit -m "feat: expose OMP skill settings in skills panel"
```

### Task 6: 端到端验证与收尾

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: 运行服务端和前端定向测试**

Run:

```bash
npx vitest run \
  tests/unit/services/omp-skill-settings-service.test.js \
  tests/unit/api/skills-api.test.js \
  tests/unit/web/omp-skill-settings.test.js
```

Expected: 全部 PASS，无未处理异常。

- [ ] **Step 2: 运行完整单元测试**

Run: `npm run test:unit`

Expected: PASS。若已有无关失败，记录准确测试名与现象，不修改无关代码掩盖失败。

- [ ] **Step 3: 构建 Web 生产包**

Run: `npm run build:web`

Expected: PASS，Vite 完成生产构建。

- [ ] **Step 4: 启动应用并烟测真实路径**

Run: `npm run dev:server`

使用受管进程启动服务后，在浏览器访问当前项目 Web 地址并验证：

1. OMP Skills 独立页显示“设置”，Claude/Codex 等平台不显示。
2. OMP Skills 抽屉显示同一入口。
3. 打开弹窗能读取四个持久化值。
4. 修改一项并保存后提示成功、关闭弹窗、列表发起强制刷新。
5. 检查 OMP `config.yml`，目标字段已改变，`skills.enabled`、其他 skills 字段和顶层字段仍存在。

Expected: 五项全部符合。

- [ ] **Step 5: 更新 CHANGELOG**

在当前未发布版本的 Added 或 Changed 下加入：

```markdown
- **OMP 技能扫描设置** - OMP 技能独立页与抽屉新增扫描来源设置，可安全更新 Codex、Claude、OMP 用户/插件及项目 Skills 扫描开关，并在保存后刷新技能列表
```

- [ ] **Step 6: 复跑变更相关验证**

Run: `npx vitest run tests/unit/services/omp-skill-settings-service.test.js tests/unit/api/skills-api.test.js tests/unit/web/omp-skill-settings.test.js && npm run build:web`

Expected: 全部 PASS。

- [ ] **Step 7: 提交收尾**

```bash
git add CHANGELOG.md
git commit -m "docs: note OMP skill scan settings"
```
