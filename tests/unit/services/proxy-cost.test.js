'use strict';

const { calculateCost: calculateCodexCost } = require('../../../src/server/codex-proxy-server');
const { calculateCost: calculateOpenCodeCost } = require('../../../src/server/opencode-proxy-server');
const { calculateCost: calculateGeminiCost } = require('../../../src/server/gemini-proxy-server');

describe('proxy cost calculation', () => {
  test('Codex uses GPT-5.5 API pricing including cached input', () => {
    expect(calculateCodexCost('gpt-5.5', {
      input: 1000000,
      output: 1000000,
      cacheRead: 1000000
    })).toBeCloseTo(35.5, 8);
  });

  test('OpenCode accepts OpenAI-compatible cached token aliases', () => {
    expect(calculateOpenCodeCost('gpt-5.5', {
      input: 1000000,
      output: 1000000,
      cached: 1000000
    })).toBeCloseTo(35.5, 8);
  });

  test('Gemini fallback pricing uses refreshed Gemini 2.5 Pro rates', () => {
    expect(calculateGeminiCost('gemini-2.5-pro-custom', {
      input: 1000000,
      output: 1000000,
      cacheRead: 1000000
    })).toBeCloseTo(11.375, 8);
  });
});
