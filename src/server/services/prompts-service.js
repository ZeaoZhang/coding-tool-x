/**
 * Prompts 管理服务
 *
 * 负责系统提示词预设的管理和多平台同步
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { NATIVE_PATHS, PATHS } = require('../../config/paths');
const { resolvePreferredHomeDir } = require('../../utils/home-dir');

const HOME_DIR = resolvePreferredHomeDir(process.platform, process.env, os.homedir());

// Prompts 配置文件路径
const PROMPTS_FILE = PATHS.prompts;

// 各平台提示词文件路径
const CLAUDE_CONFIG_DIR = NATIVE_PATHS.claude.dir || path.dirname(NATIVE_PATHS.claude.settings);
const CLAUDE_PROMPT_PATH = NATIVE_PATHS.claude.prompt || path.join(CLAUDE_CONFIG_DIR, 'CLAUDE.md');
const CODEX_PROMPT_PATH = path.join(HOME_DIR, '.codex', 'AGENTS.md');
const GEMINI_PROMPT_PATH = path.join(HOME_DIR, '.gemini', 'GEMINI.md');
const OPENCODE_PROMPT_PATH = path.join(NATIVE_PATHS.opencode.config, 'AGENTS.md');

function normalizePlatformKey(platform) {
  return String(platform || '').trim().toLowerCase();
}

function getPlatformServices() {
  const { getPlatformRegistry, getPlatformRuntime } = require('../../platforms/runtime');
  return {
    registry: getPlatformRegistry(),
    runtime: getPlatformRuntime()
  };
}

function getPromptPlatformKeys() {
  const { registry } = getPlatformServices();
  const keys = [];
  const seen = new Set();

  for (const platform of registry.list()) {
    const key = normalizePlatformKey(platform.key);
    if (!key || seen.has(key)) continue;
    const driverId = registry.getCapability(key, 'prompts');
    if (!driverId || driverId === 'unsupported') continue;
    seen.add(key);
    keys.push(key);
  }

  return keys;
}

function createPlatformCapabilityError(platform, capability, code) {
  const key = normalizePlatformKey(platform);
  const error = new Error(code === 'not_found'
    ? `无效的平台: ${key}`
    : `平台 ${key} 未声明 ${capability} capability`);
  error.status = 404;
  error.code = code;
  error.platform = key;
  error.capability = capability;
  return error;
}

function requirePromptCapability(platform) {
  const key = normalizePlatformKey(platform);
  const { registry, runtime } = getPlatformServices();
  if (!registry.resolve(key)) {
    throw createPlatformCapabilityError(key, 'prompts', 'not_found');
  }
  const driverId = registry.getCapability(key, 'prompts');
  if (!driverId || driverId === 'unsupported') {
    throw createPlatformCapabilityError(key, 'prompts', 'unsupported');
  }
  const driver = runtime.getDriver(key, 'prompts');
  if (!driver) {
    throw createPlatformCapabilityError(key, 'prompts', 'unsupported');
  }
  return { platform: key, driver, driverId };
}

function getDriverFailure(result, platform, operation) {
  if (!result || result.status !== 'failed' || result.capability !== 'prompts') return null;
  if (result.cause instanceof Error) return result.cause;
  return new Error(result.error || `Prompt ${operation} failed for ${platform}`);
}

function assertPromptReadResult(result, platform) {
  const failure = getDriverFailure(result, platform, 'read');
  if (failure) throw failure;
  const content = result?.status === 'ok' ? result.data : result;
  if (typeof content !== 'string') throw new Error(`平台 ${platform} 的提示词内容无效`);
  return content;
}


function normalizeApps(apps = {}, defaults = {
  claude: true,
  codex: true,
  gemini: true,
  opencode: false,
  omp: false
}) {
  const source = apps && typeof apps === 'object' && !Array.isArray(apps) ? apps : {};
  const fallback = defaults && typeof defaults === 'object' && !Array.isArray(defaults) ? defaults : {};
  const platformKeys = new Set(getPromptPlatformKeys());
  const normalized = {};

  for (const platform of platformKeys) {
    normalized[platform] = source[platform] !== undefined
      ? !!source[platform]
      : !!fallback[platform];
  }

  // Preserve historical flags for platforms absent from the current registry.
  for (const [platform, enabled] of Object.entries(source)) {
    if (!platformKeys.has(platform)) normalized[platform] = !!enabled;
  }
  return normalized;
}

// 内置模板（不是"默认"，只是可选模板）
const BUILTIN_TEMPLATES = [
  {
    id: 'tpl-code-review',
    name: '代码审查',
    description: '专注于代码审查和改进建议',
    content: `# 代码审查专家

你是一个专业的代码审查专家，帮助用户审查代码并提供改进建议。

## 审查重点
- **代码质量**: 可读性、可维护性、命名规范
- **性能**: 算法复杂度、资源使用、潜在瓶颈
- **安全**: 常见漏洞、输入验证、敏感数据处理
- **最佳实践**: 设计模式、SOLID 原则、DRY 原则

## 输出格式
1. 总体评价
2. 具体问题列表（按严重程度排序）
3. 改进建议和示例代码
`,
    apps: { claude: true, codex: true, gemini: true, opencode: true },
    isBuiltin: true
  },
  {
    id: 'tpl-debugging',
    name: '调试专家',
    description: '帮助定位和解决代码问题',
    content: `# 调试专家

你是一个经验丰富的调试专家，帮助用户定位和解决代码中的问题。

## 调试方法
1. **理解问题**: 先完整理解错误信息和预期行为
2. **复现问题**: 确定问题的触发条件
3. **缩小范围**: 通过二分法定位问题代码
4. **根因分析**: 找到问题的根本原因，而非表面症状
5. **验证修复**: 确保修复不会引入新问题

## 输出格式
- 问题分析
- 可能的原因（按可能性排序）
- 建议的解决方案
- 预防措施
`,
    apps: { claude: true, codex: true, gemini: true, opencode: true },
    isBuiltin: true
  },
  {
    id: 'tpl-refactor',
    name: '重构助手',
    description: '帮助优化和重构代码结构',
    content: `# 重构助手

你是一个代码重构专家，帮助用户优化代码结构和质量。

## 重构原则
- **小步前进**: 每次只做一个小改动
- **保持可用**: 每次重构后代码都应该能正常运行
- **测试保障**: 确保有测试覆盖，重构后测试通过

## 常见重构手法
- 提取函数/方法
- 重命名（变量、函数、类）
- 移动代码到合适位置
- 简化条件表达式
- 消除重复代码
`,
    apps: { claude: true, codex: true, gemini: true, opencode: true },
    isBuiltin: true
  }
];

/**
 * 确保目录存在
 */
function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * 安全读取 JSON 文件
 */
function readJsonFile(filePath, defaultValue = {}) {
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(content);
    }
  } catch (err) {
    console.error(`[Prompts] Failed to read ${filePath}:`, err.message);
  }
  return defaultValue;
}

/**
 * 安全写入 JSON 文件（原子写入）
 */
function writeJsonFile(filePath, data) {
  ensureDir(path.dirname(filePath));
  const tempPath = filePath + '.tmp';
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tempPath, filePath);
}

/**
 * 安全读取文本文件
 */
function readTextFile(filePath, defaultValue = '') {
  try {
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, 'utf-8');
    }
  } catch (err) {
    console.error(`[Prompts] Failed to read ${filePath}:`, err.message);
  }
  return defaultValue;
}

/**
 * 安全写入文本文件（原子写入）
 */
function writeTextFile(filePath, content) {
  ensureDir(path.dirname(filePath));
  const tempPath = filePath + '.tmp';
  fs.writeFileSync(tempPath, content, 'utf-8');
  fs.renameSync(tempPath, filePath);
}

/**
 * 删除文件（如果存在）
 */
function deleteFile(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
  } catch (err) {
    console.error(`[Prompts] Failed to delete ${filePath}:`, err.message);
  }
  return false;
}

// ============================================================================
// Prompts 数据管理
// ============================================================================

/**
 * 初始化 Prompts 数据
 * 如果用户已有提示词文件，自动导入为"当前使用"
 */
function initPromptsData() {
  const data = readJsonFile(PROMPTS_FILE, null);

  if (!data) {
    // 首次使用，创建初始数据
    const initialData = {
      presets: {},
      activePresetId: null // 没有默认激活的预设
    };

    // 添加内置模板
    BUILTIN_TEMPLATES.forEach(tpl => {
      initialData.presets[tpl.id] = {
        ...tpl,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
    });

    const existingContent = getPromptPlatformKeys().includes('claude')
      ? readPlatformPrompt('claude')
      : '';
    if (existingContent.trim()) {
      const currentPreset = {
        id: 'current',
        name: '当前使用',
        description: '从现有配置导入',
        content: existingContent,
        apps: normalizeApps({ claude: true, codex: false, gemini: false, opencode: false, omp: false }),
        isBuiltin: false,
        isImported: true,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      initialData.presets['current'] = currentPreset;
      initialData.activePresetId = 'current';
    }

    writeJsonFile(PROMPTS_FILE, initialData);
    return initialData;
  }

  let updated = false;
  for (const preset of Object.values(data.presets || {})) {
    const normalizedApps = normalizeApps(preset.apps);
    const sourceApps = preset.apps && typeof preset.apps === 'object' && !Array.isArray(preset.apps)
      ? preset.apps
      : {};
    const needsNormalization = Object.entries(normalizedApps).some(
      ([platform, enabled]) => sourceApps[platform] !== enabled
    );
    if (needsNormalization) {
      preset.apps = normalizedApps;
      updated = true;
    }
  }

  if (updated) {
    writeJsonFile(PROMPTS_FILE, data);
  }

  return data;
}

/**
 * 获取所有预设（内置模板排在后面）
 */
function getAllPresets() {
  const data = initPromptsData();

  // 分离用户预设和内置模板
  const presets = Object.values(data.presets);
  const userPresets = presets.filter(p => !p.isBuiltin);
  const builtinPresets = presets.filter(p => p.isBuiltin);

  // 用户预设按更新时间排序，内置模板保持固定顺序
  userPresets.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  // 合并：用户预设在前，内置模板在后
  const sortedPresets = {};
  [...userPresets, ...builtinPresets].forEach(p => {
    sortedPresets[p.id] = p;
  });

  return {
    presets: sortedPresets,
    activePresetId: data.activePresetId
  };
}

/**
 * 获取单个预设
 */
function getPreset(id) {
  const data = initPromptsData();
  return data.presets[id] || null;
}

/**
 * 获取当前激活的预设
 */
function getActivePreset() {
  const data = initPromptsData();
  const activeId = data.activePresetId;
  return {
    preset: activeId ? data.presets[activeId] : null,
    activePresetId: activeId
  };
}

/**
 * 保存预设（添加或更新）
 */
function savePreset(preset) {
  if (!preset.id || !preset.id.trim()) {
    throw new Error('预设 ID 不能为空');
  }

  if (!preset.name || !preset.name.trim()) {
    throw new Error('预设名称不能为空');
  }

  const data = initPromptsData();
  const existing = data.presets[preset.id];
  const wasActive = data.activePresetId === preset.id;

  // 内置模板不允许修改
  if (existing && existing.isBuiltin) {
    throw new Error('不能修改内置模板');
  }

  // 设置时间戳
  if (!existing) {
    preset.createdAt = Date.now();
  }
  preset.updatedAt = Date.now();

  // 确保 apps 字段存在
  preset.apps = normalizeApps(preset.apps);

  data.presets[preset.id] = preset;
  writeJsonFile(PROMPTS_FILE, data);

  if (wasActive) {
    const syncResult = syncPresetToAllPlatforms(preset);
    if (syncResult && typeof syncResult.then === 'function') {
      return syncResult.then(() => preset);
    }
  }

  return preset;
}

/**
 * 删除预设
 */
function deletePreset(id) {
  const data = initPromptsData();
  const preset = data.presets[id];

  if (!preset) {
    return false;
  }

  if (preset.isBuiltin) {
    throw new Error('不能删除内置模板');
  }

  // 如果删除的是当前激活的预设，清空激活状态
  if (data.activePresetId === id) {
    data.activePresetId = null;
  }

  delete data.presets[id];
  writeJsonFile(PROMPTS_FILE, data);

  return true;
}

/**
 * 激活预设（将内容写入各平台文件）
 */
async function activatePreset(id) {
  const data = initPromptsData();
  const preset = data.presets[id];

  if (!preset) {
    throw new Error(`预设 "${id}" 不存在`);
  }

  // 更新激活状态
  data.activePresetId = id;
  writeJsonFile(PROMPTS_FILE, data);

  // 同步到各平台
  await syncPresetToAllPlatforms(preset);

  return preset;
}

/**
 * 停用/移除提示词（删除各平台文件）
 */
async function deactivatePrompt() {
  const data = initPromptsData();

  // Clear active state.
  data.activePresetId = null;
  writeJsonFile(PROMPTS_FILE, data);

  const results = {};
  const pending = [];
  for (const platform of getPromptPlatformKeys()) {
    const { driver } = requirePromptCapability(platform);
    if (typeof driver.remove !== 'function') {
      const error = createPlatformCapabilityError(platform, 'prompts', 'unsupported');
      error.operation = 'remove';
      throw error;
    }
    const result = driver.remove();
    if (result && typeof result.then === 'function') {
      pending.push(result.then(value => {
        const failure = getDriverFailure(value, platform, 'remove');
        if (failure) throw failure;
        results[platform] = true;
      }));
    } else {
      const failure = getDriverFailure(result, platform, 'remove');
      if (failure) throw failure;
      results[platform] = true;
    }
  }

  await Promise.all(pending);
  console.log('[Prompts] Deactivated and removed prompt files:', results);
  return results;
}

// ============================================================================
// 平台同步
// ============================================================================

/**
 * 同步预设到所有已启用的平台
 */
function syncPromptToPlatform(platform, content) {
  const { driver } = requirePromptCapability(platform);
  if (typeof driver.write !== 'function') {
    const error = createPlatformCapabilityError(platform, 'prompts', 'unsupported');
    error.operation = 'write';
    throw error;
  }

  const result = driver.write(content);
  if (result && typeof result.then === 'function') {
    return result.then(value => {
      const failure = getDriverFailure(value, platform, 'write');
      if (failure) throw failure;
      return value;
    });
  }
  return result;
}

/**
 * 同步预设到所有已启用的平台
 */
function syncPresetToAllPlatforms(preset) {
  const apps = normalizeApps(preset.apps);
  const { content } = preset;
  const pending = [];

  for (const platform of getPromptPlatformKeys()) {
    if (!apps[platform]) continue;
    const result = syncPromptToPlatform(platform, content);
    if (result && typeof result.then === 'function') {
      pending.push(result.then(() => {
        console.log(`[Prompts] Synced to ${platform}`);
      }));
    } else {
      console.log(`[Prompts] Synced to ${platform}`);
    }
  }


  return pending.length ? Promise.all(pending) : undefined;
}


function readLegacyPlatformPrompt(platform) {
  switch (platform) {
    case 'claude':
      return readTextFile(CLAUDE_PROMPT_PATH, '');
    case 'codex':
      return readTextFile(CODEX_PROMPT_PATH, '');
    case 'gemini':
      return readTextFile(GEMINI_PROMPT_PATH, '');
    case 'opencode':
      return readTextFile(OPENCODE_PROMPT_PATH, '');
    default:
      throw new Error(`无效的平台: ${platform}`);
  }
}

function writeLegacyPlatformPrompt(platform, content) {
  if (typeof content !== 'string') {
    throw new Error('提示词内容必须是字符串');
  }

  switch (platform) {
    case 'claude':
      writeTextFile(CLAUDE_PROMPT_PATH, content);
      return content;
    case 'codex':
      writeTextFile(CODEX_PROMPT_PATH, content);
      return content;
    case 'gemini':
      writeTextFile(GEMINI_PROMPT_PATH, content);
      return content;
    case 'opencode':
      writeTextFile(OPENCODE_PROMPT_PATH, content);
      return content;
    default:
      throw new Error(`无效的平台: ${platform}`);
  }
}

function removeLegacyPlatformPrompt(platform) {
  switch (platform) {
    case 'claude':
      return deleteFile(CLAUDE_PROMPT_PATH);
    case 'codex':
      return deleteFile(CODEX_PROMPT_PATH);
    case 'gemini':
      return deleteFile(GEMINI_PROMPT_PATH);
    case 'opencode':
      return deleteFile(OPENCODE_PROMPT_PATH);
    default:
      throw new Error(`无效的平台: ${platform}`);
  }
}

/**
 * 从平台读取当前提示词
 */
function readPlatformPrompt(platform) {
  const { platform: normalizedPlatform, driver } = requirePromptCapability(platform);
  if (typeof driver.read !== 'function') {
    const error = createPlatformCapabilityError(normalizedPlatform, 'prompts', 'unsupported');
    error.operation = 'read';
    throw error;
  }

  const result = driver.read();
  if (result && typeof result.then === 'function') {
    return result.then(value => assertPromptReadResult(value, normalizedPlatform));
  }
  return assertPromptReadResult(result, normalizedPlatform);
}

function writePlatformPrompt(platform, content) {
  if (typeof content !== 'string') {
    throw new Error('提示词内容必须是字符串');
  }

  const { platform: normalizedPlatform, driver } = requirePromptCapability(platform);
  if (typeof driver.write !== 'function') {
    const error = createPlatformCapabilityError(normalizedPlatform, 'prompts', 'unsupported');
    error.operation = 'write';
    throw error;
  }

  const result = driver.write(content);
  if (result && typeof result.then === 'function') {
    return result.then(value => {
      const failure = getDriverFailure(value, normalizedPlatform, 'write');
      if (failure) throw failure;
      return content;
    });
  }
  return result;
}

function removePlatformPrompt(platform) {
  const { platform: normalizedPlatform, driver } = requirePromptCapability(platform);
  if (typeof driver.remove !== 'function') {
    const error = createPlatformCapabilityError(normalizedPlatform, 'prompts', 'unsupported');
    error.operation = 'remove';
    throw error;
  }

  const result = driver.remove();
  if (result && typeof result.then === 'function') {
    return result.then(value => {
      const failure = getDriverFailure(value, normalizedPlatform, 'remove');
      if (failure) throw failure;
      return true;
    });
  }
  return result;
}


/**
 * 获取各平台当前的提示词状态
 */
function getPlatformStatus() {
  const statuses = {};
  const pending = [];

  for (const platform of getPromptPlatformKeys()) {
    const { driver } = requirePromptCapability(platform);
    if (typeof driver.read !== 'function') {
      const error = createPlatformCapabilityError(platform, 'prompts', 'unsupported');
      error.operation = 'read';
      throw error;
    }
    const pathValue = typeof driver.path === 'string' ? driver.path : null;
    const result = driver.read();
    const apply = value => {
      const failure = getDriverFailure(value, platform, 'read');
      if (failure) throw failure;
      const content = assertPromptReadResult(value, platform);
      statuses[platform] = {
        ...(pathValue ? { path: pathValue } : {}),
        exists: pathValue ? fs.existsSync(pathValue) : Boolean(content),
        content
      };
    };
    if (result && typeof result.then === 'function') pending.push(result.then(apply));
    else apply(result);
  }

  return pending.length ? Promise.all(pending).then(() => statuses) : statuses;
}

/**
 * 从平台导入提示词作为新预设
 */
function importFromPlatform(platform, presetName) {
  const normalizedPlatform = requirePromptCapability(platform).platform;
  const contentResult = readPlatformPrompt(normalizedPlatform);

  const createPreset = content => {
    if (!content.trim()) {
      throw new Error(`${normalizedPlatform} 的提示词文件为空`);
    }

    const id = `imported-${normalizedPlatform}-${Date.now()}`;
    const emptyApps = Object.fromEntries(getPromptPlatformKeys().map(key => [key, false]));
    const preset = {
      id,
      name: presetName || `从 ${normalizedPlatform} 导入`,
      description: `从 ${normalizedPlatform} 导入的提示词`,
      content,
      apps: normalizeApps(emptyApps),
      isBuiltin: false,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    preset.apps[normalizedPlatform] = true;
    return savePreset(preset);
  };

  return contentResult && typeof contentResult.then === 'function'
    ? contentResult.then(createPreset)
    : createPreset(contentResult);
}

/**
 * 获取统计信息
 */
function getStats() {
  const data = initPromptsData();
  const presets = Object.values(data.presets);

  return {
    total: presets.length,
    builtin: presets.filter(p => p.isBuiltin).length,
    custom: presets.filter(p => !p.isBuiltin).length,
    activePresetId: data.activePresetId
  };
}

module.exports = {
  getAllPresets,
  getPreset,
  getActivePreset,
  savePreset,
  deletePreset,
  activatePreset,
  deactivatePrompt,
  readPlatformPrompt,
  writePlatformPrompt,
  removePlatformPrompt,
  readLegacyPlatformPrompt,
  writeLegacyPlatformPrompt,
  removeLegacyPlatformPrompt,
  getPlatformStatus,
  importFromPlatform,
  getStats
};
