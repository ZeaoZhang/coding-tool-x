'use strict';

/**
 * model-fallback.js - 「当前模型不可用 → 改用另一个渠道的模型」的解析与判定
 *
 * 渠道字段形状：
 *   modelFallbacks: [
 *     { from: '<本渠道当前模型>', targets: [{ channelId, model }, ...] }  // targets 有序
 *   ]
 *
 * 触发条件（按用户选择）：
 *   1. 请求前就能判定：本渠道的「可用模型」里没有这个模型（undeclared）
 *   2. 上游明确说模型不可用：400/404/422 且响应体点名 model 不存在/不支持（not-found）
 */

const MODEL_UNAVAILABLE_STATUSES = new Set([400, 404, 422]);

// 允许点号：模型名常带版本号（gpt-5.6），但限制跨句范围
const MODEL_UNAVAILABLE_TEXT = /(model|模型)[^;{}]{0,120}?(not[\s_-]*found|nonexistent|does\s*not\s*exist|doesn'?t\s*exist|unsupported|not\s*supported|invalid|unknown|not\s*available|不可用|不存在|不支持)/i;

function toModelId(value) {
  const id = typeof value === 'string' ? value : (value?.id || value?.name || '');
  return String(id || '').trim();
}

function normalizeTargets(value) {
  if (!Array.isArray(value)) return [];
  const targets = [];
  const seen = new Set();
  for (const item of value) {
    const channelId = String(item?.channelId || '').trim();
    const model = String(item?.model || '').trim();
    if (!channelId || !model) continue;
    const key = `${channelId}\u0000${model}`;
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push({ channelId, model });
  }
  return targets;
}

/** 保存前归一化：丢掉空 from、空 targets，并去重 */
function normalizeModelFallbacks(value) {
  if (!Array.isArray(value)) return [];
  const rules = [];
  const seenFrom = new Set();
  for (const rule of value) {
    const from = String(rule?.from || '').trim();
    const targets = normalizeTargets(rule?.targets);
    if (!from || targets.length === 0) continue;
    if (seenFrom.has(from)) {
      const existing = rules.find(item => item.from === from);
      for (const target of targets) {
        if (!existing.targets.some(item => item.channelId === target.channelId && item.model === target.model)) {
          existing.targets.push(target);
        }
      }
      continue;
    }
    seenFrom.add(from);
    rules.push({ from, targets });
  }
  return rules;
}

/** 渠道声明的模型（models / allowedModels / model），兼容字符串与 { id } 两种形状 */
function declaredModels(channel = {}) {
  const result = [];
  const push = (value) => {
    const id = toModelId(value);
    if (id) result.push(id);
  };
  (Array.isArray(channel?.models) ? channel.models : []).forEach(push);
  (Array.isArray(channel?.allowedModels) ? channel.allowedModels : []).forEach(push);
  push(channel?.model);
  return [...new Set(result)];
}

/** 渠道未声明任何模型时无法判定，按"声明了"处理，交给上游决定 */
function channelDeclaresModel(channel, model) {
  const declared = declaredModels(channel);
  if (declared.length === 0) return true;
  const wanted = toModelId(model);
  if (!wanted) return true;
  return declared.includes(wanted);
}

/** 取该渠道为某个模型配置的回退目标（有序） */
function findModelFallbackTargets(channel, model) {
  const wanted = String(model || '').trim();
  if (!wanted) return [];
  const rules = Array.isArray(channel?.modelFallbacks) ? channel.modelFallbacks : [];
  for (const rule of rules) {
    if (String(rule?.from || '').trim() === wanted) {
      return normalizeTargets(rule.targets);
    }
  }
  return [];
}

/** 上游响应是否在说"这个模型不可用" */
function isModelUnavailableResponse(statusCode, bodyText) {
  if (!MODEL_UNAVAILABLE_STATUSES.has(Number(statusCode))) return false;
  const text = String(bodyText || '');
  if (!text) return false;
  return MODEL_UNAVAILABLE_TEXT.test(text);
}

module.exports = {
  MODEL_UNAVAILABLE_STATUSES,
  normalizeModelFallbacks,
  declaredModels,
  channelDeclaresModel,
  findModelFallbackTargets,
  isModelUnavailableResponse
};
