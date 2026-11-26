'use strict';

/**
 * model-fallback-store.js - 平台级「模型回退链」存储（渠道面板之外，位于 Agent/设置侧）
 *
 * 非 OMP 平台的链路存在 coding-tool 自己的配置里：
 *   config.modelFallbackChains[platform] = [{ from, targets: [{ channelId, model }] }]
 * OMP 的链路仍写它自己的 config.yml（retry.fallbackChains），由 OMP 核心消费。
 */

const { loadConfig, saveConfig } = require('../config/loader');
const { normalizeModelFallbacks, findModelFallbackTargets } = require('./model-fallback');

const CONFIG_KEY = 'modelFallbackChains';

function readAllChains() {
  try {
    const value = loadConfig()?.[CONFIG_KEY];
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch (_) {
    return {};
  }
}

function readPlatformChains(platform) {
  return normalizeModelFallbacks(readAllChains()[platform]);
}

function writePlatformChains(platform, rules) {
  const normalized = normalizeModelFallbacks(rules);
  const config = loadConfig() || {};
  const all = { ...readAllChains() };
  if (normalized.length > 0) all[platform] = normalized;
  else delete all[platform];
  if (Object.keys(all).length > 0) config[CONFIG_KEY] = all;
  else delete config[CONFIG_KEY];
  saveConfig(config);
  return readPlatformChains(platform);
}

/** 候选：启用渠道声明的模型（供 UI 的「渠道 · 模型」选择器） */
function listPlatformModelOptions(channels = [], { includeChannelIds = null, excludeChannelIds = [] } = {}) {
  const options = [];
  const seen = new Set();
  for (const channel of channels) {
    if (!channel || channel.enabled === false) continue;
    if (channel.id && excludeChannelIds.includes(channel.id)) continue;
    if (includeChannelIds && channel.id && !includeChannelIds.includes(channel.id)) continue;
    const models = [...new Set([
      ...(Array.isArray(channel.models) ? channel.models : []),
      ...(Array.isArray(channel.allowedModels) ? channel.allowedModels : []),
      channel.model
    ].map(item => String(typeof item === 'string' ? item : (item?.id || item?.name || '')).trim()).filter(Boolean))];
    for (const model of models) {
      const key = `${channel.id}\u0000${model}`;
      if (seen.has(key)) continue;
      seen.add(key);
      options.push({ channelId: channel.id, channelName: channel.name || channel.id, model });
    }
  }
  return options;
}

/** 运行时：把「当前模型」映射成该平台配置的回退目标（只保留可用渠道） */
function resolvePlatformFallbackTargets(platform, model, channels = []) {
  const targets = findModelFallbackTargets({ modelFallbacks: readPlatformChains(platform) }, model);
  if (targets.length === 0) return [];
  const usable = new Map(channels.filter(ch => ch && ch.enabled !== false).map(ch => [ch.id, ch]));
  return targets.filter(target => usable.has(target.channelId));
}

module.exports = {
  CONFIG_KEY,
  readPlatformChains,
  writePlatformChains,
  listPlatformModelOptions,
  resolvePlatformFallbackTargets
};
