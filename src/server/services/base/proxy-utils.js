/**
 * proxy-utils.js - 代理服务器共享工具函数
 *
 * 从四个 proxy-server 中提取的公共逻辑，消除重复代码。
 */

/**
 * 检测模型层级（Claude 系列）
 * @param {string} modelName
 * @returns {'opus'|'sonnet'|'haiku'|null}
 */
function detectModelTier(modelName) {
  if (!modelName) return null;
  const lower = modelName.toLowerCase();
  if (lower.includes('opus')) return 'opus';
  if (lower.includes('sonnet')) return 'sonnet';
  if (lower.includes('haiku')) return 'haiku';
  return null;
}

/**
 * 应用模型重定向
 *
 * 支持两种格式：
 * 1. modelRedirects 数组（新格式，精确匹配）
 * 2. modelConfig 对象（旧格式，层级匹配 + 通用覆盖）
 *
 * @param {string} originalModel
 * @param {object} channel - 渠道对象
 * @param {object} [options]
 * @param {boolean} [options.useTierFallback=true] - 是否启用层级回退（Gemini 不用）
 * @returns {string}
 */
function redirectModel(originalModel, channel, options = {}) {
  if (!originalModel) return originalModel;

  // 优先使用 modelRedirects 数组格式（精确匹配）
  const modelRedirects = channel?.modelRedirects;
  if (Array.isArray(modelRedirects) && modelRedirects.length > 0) {
    for (const rule of modelRedirects) {
      if (rule.from && rule.to && rule.from === originalModel) {
        return rule.to;
      }
    }
  }

  // 如果不启用层级回退，到此为止
  const useTierFallback = options.useTierFallback !== false;
  if (!useTierFallback) {
    return originalModel;
  }

  // 向后兼容：使用旧的 modelConfig 格式
  const modelConfig = channel?.modelConfig;
  if (!modelConfig) return originalModel;

  const tier = detectModelTier(originalModel);

  if (tier === 'opus' && modelConfig.opusModel) return modelConfig.opusModel;
  if (tier === 'sonnet' && modelConfig.sonnetModel) return modelConfig.sonnetModel;
  if (tier === 'haiku' && modelConfig.haikuModel) return modelConfig.haikuModel;

  // 回退到通用模型覆盖
  if (modelConfig.model) return modelConfig.model;

  return originalModel;
}

/**
 * 解析代理目标 URL，避免 API 版本段重复
 *
 * 当 baseUrl 和请求路径都包含同一个 API 版本段时，去掉 baseUrl 的
 * 版本后缀，因为 http-proxy 会自动拼接 req.url。
 *
 * @param {string} baseUrl - 渠道配置的 base_url
 * @param {string} requestPath - 请求路径
 * @returns {string} 传给 http-proxy 的 target
 */
function resolveTargetUrl(baseUrl, requestPath) {
  let target = baseUrl || '';
  if (target.endsWith('/')) {
    target = target.slice(0, -1);
  }
  if (target.endsWith('/v1beta') && requestPath.startsWith('/v1beta')) {
    return target.slice(0, -7);
  }
  if (target.endsWith('/v1') && requestPath.startsWith('/v1')) {
    target = target.slice(0, -3);
  }
  return target;
}

/**
 * 规范化网关来源类型
 * @param {string} value
 * @param {string} [fallback='claude']
 * @returns {string}
 */
function normalizeGatewaySourceType(value, fallback = 'claude') {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'claude') return 'claude';
  if (normalized === 'codex') return 'codex';
  if (normalized === 'gemini') return 'gemini';
  if (normalized === 'openai_compatible') return 'openai_compatible';
  return fallback;
}

/**
 * 规范化数值字段
 * @param {*} value
 * @param {number} defaultValue
 * @param {number|null} [max=null]
 * @returns {number}
 */
function normalizeNumber(value, defaultValue, max = null) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) {
    return defaultValue;
  }
  if (max !== null && num > max) {
    return max;
  }
  return num;
}

/**
 * 判断请求路径是否为 OpenAI Chat Completions。
 * @param {string} requestPath
 * @returns {boolean}
 */
function isChatCompletionsPath(requestPath = '') {
  const normalized = String(requestPath || '').trim().toLowerCase();
  return normalized.includes('/chat/completions');
}

/**
 * 为流式 Chat Completions 请求补齐 usage 输出，方便统计真实 token。
 * @param {object} body
 * @returns {boolean} 是否发生了修改
 */
function ensureOpenAiStreamUsage(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return false;
  }

  if (body.stream !== true) {
    return false;
  }

  const current = body.stream_options && typeof body.stream_options === 'object' && !Array.isArray(body.stream_options)
    ? body.stream_options
    : {};

  if (current.include_usage === true) {
    return false;
  }

  body.stream_options = {
    ...current,
    include_usage: true
  };
  return true;
}

/**
 * 记录模型重定向日志（避免重复打印）
 * @param {Map} cache - 重定向缓存 Map
 * @param {string} channelId
 * @param {string} originalModel
 * @param {string} redirectedModel
 * @param {string} channelName
 * @param {string} source - 平台标识
 */
function logModelRedirect(cache, channelId, originalModel, redirectedModel, channelName, source) {
  if (originalModel === redirectedModel) return;

  if (!cache.has(channelId)) {
    cache.set(channelId, {});
  }
  const channelCache = cache.get(channelId);
  if (channelCache[originalModel] === redirectedModel) return;

  channelCache[originalModel] = redirectedModel;
  console.log(`[${source}-proxy] Model redirect: ${originalModel} → ${redirectedModel} (channel: ${channelName})`);
}

module.exports = {
  detectModelTier,
  redirectModel,
  resolveTargetUrl,
  normalizeGatewaySourceType,
  normalizeNumber,
  isChatCompletionsPath,
  ensureOpenAiStreamUsage,
  logModelRedirect,
};
