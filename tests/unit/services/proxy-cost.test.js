'use strict';

const { calculateUsageCost } = require('../../../src/server/services/usage-log-utils');

const calculateCodexCost = (model, tokens) => calculateUsageCost('codex', model, tokens);
const calculateOpenCodeCost = (model, tokens) => calculateUsageCost('opencode', model, tokens);
const calculateGeminiCost = (model, tokens) => calculateUsageCost('gemini', model, tokens);

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

  test('unknown model without an override has no cost', () => {
    expect(calculateCodexCost('gpt-4-retired', {
      input: 1000000,
      output: 1000000,
      cacheRead: 1000000
    })).toBe(0);
  });

  test('normalizes cached input aliases before calculating Codex cost', () => {
    expect(calculateCodexCost('gpt-5.5', {
      input_tokens: 1000000,
      cached_input_tokens: 800000,
      output_tokens: 1000000,
      total_tokens: 2000000
    })).toBeCloseTo(31.4, 8);
  });

  test('normalizes nested OpenAI-compatible cached input details', () => {
    expect(calculateOpenCodeCost('gpt-5.5', {
      prompt_tokens: 1000000,
      prompt_tokens_details: { cached_tokens: 800000 },
      completion_tokens: 1000000,
      total_tokens: 2000000
    })).toBeCloseTo(31.4, 8);
  });

  test('charges Gemini thinking tokens at the output rate', () => {
    expect(calculateGeminiCost('gemini-2.5-pro', {
      promptTokenCount: 1000000,
      cachedContentTokenCount: 200000,
      candidatesTokenCount: 1000000,
      thoughtsTokenCount: 100000,
      totalTokenCount: 2100000
    })).toBeCloseTo(12.025, 8);
  });
});
