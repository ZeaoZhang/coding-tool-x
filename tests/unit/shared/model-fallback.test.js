'use strict';

const {
  normalizeModelFallbacks,
  declaredModels,
  channelDeclaresModel,
  findModelFallbackTargets,
  isModelUnavailableResponse
} = require('../../../src/shared/model-fallback');

test('normalizes rules: drops empty rows/targets, dedupes and merges same from', () => {
  expect(normalizeModelFallbacks(null)).toEqual([]);
  expect(normalizeModelFallbacks([
    { from: '  ', targets: [{ channelId: 'c1', model: 'm1' }] },
    { from: 'gpt-5.5', targets: [] },
    { from: 'glm-4.6', targets: [{ channelId: 'c1', model: '' }, { channelId: '', model: 'm2' }] },
    {
      from: 'glm-4.6',
      targets: [
        { channelId: 'c2', model: 'qwen-max' },
        { channelId: 'c2', model: 'qwen-max' }
      ]
    }
  ])).toEqual([
    { from: 'glm-4.6', targets: [{ channelId: 'c2', model: 'qwen-max' }] }
  ]);

  expect(normalizeModelFallbacks([
    { from: 'a', targets: [{ channelId: 'c1', model: 'm1' }] },
    { from: 'a', targets: [{ channelId: 'c2', model: 'm2' }, { channelId: 'c1', model: 'm1' }] }
  ])).toEqual([
    { from: 'a', targets: [{ channelId: 'c1', model: 'm1' }, { channelId: 'c2', model: 'm2' }] }
  ]);
});

test('reads declared models from both string and object lists', () => {
  expect(declaredModels({ models: ['a', { id: 'b' }], model: 'c', allowedModels: [{ name: 'd' }] }))
    .toEqual(['a', 'b', 'd', 'c']);
  expect(declaredModels({})).toEqual([]);
});

test('treats a channel without declared models as undecidable (declares it)', () => {
  expect(channelDeclaresModel({}, 'anything')).toBe(true);
  expect(channelDeclaresModel({ models: [] }, 'anything')).toBe(true);
  expect(channelDeclaresModel({ models: ['a'] }, 'a')).toBe(true);
  expect(channelDeclaresModel({ models: [{ id: 'a' }] }, 'a')).toBe(true);
  expect(channelDeclaresModel({ models: ['a'] }, 'b')).toBe(false);
  expect(channelDeclaresModel({ models: ['a'] }, '')).toBe(true);
});

test('finds the ordered targets configured for exactly this model', () => {
  const channel = {
    modelFallbacks: [
      { from: 'glm-4.6', targets: [{ channelId: 'c1', model: 'qwen-max' }, { channelId: 'c2', model: 'deepseek-v4' }] },
      { from: 'gpt-5.5', targets: [{ channelId: 'c3', model: 'gpt-5.4' }] }
    ]
  };
  expect(findModelFallbackTargets(channel, 'glm-4.6')).toEqual([
    { channelId: 'c1', model: 'qwen-max' },
    { channelId: 'c2', model: 'deepseek-v4' }
  ]);
  expect(findModelFallbackTargets(channel, 'unknown')).toEqual([]);
  expect(findModelFallbackTargets({}, 'glm-4.6')).toEqual([]);
});

test('classifies model-unavailable upstream responses', () => {
  expect(isModelUnavailableResponse(404, '{"error":{"message":"model claude-opus-4-1 not found"}}')).toBe(true);
  expect(isModelUnavailableResponse(400, '{"error":{"type":"invalid_request_error","message":"The model `gpt-5.6` does not exist"}}')).toBe(true);
  expect(isModelUnavailableResponse(400, '{"error":{"message":"model is not supported"}}')).toBe(true);
  expect(isModelUnavailableResponse(422, '{"detail":"模型不存在"}')).toBe(true);

  // 与模型无关的错误不能触发回退
  expect(isModelUnavailableResponse(400, '{"error":{"message":"max_tokens is required"}}')).toBe(false);
  expect(isModelUnavailableResponse(400, '{"error":{"message":"invalid api key"}}')).toBe(false);
  expect(isModelUnavailableResponse(403, '{"error":{"message":"model forbidden"}}')).toBe(false);
  expect(isModelUnavailableResponse(429, '{"error":{"message":"model rate limited"}}')).toBe(false);
  expect(isModelUnavailableResponse(404, '')).toBe(false);
  expect(isModelUnavailableResponse(500, 'model not found')).toBe(false);
});
