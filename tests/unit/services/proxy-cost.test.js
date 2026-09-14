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

  test('unknown Codex model uses configured base pricing', () => {
    expect(calculateCodexCost('gpt-4-retired', {
      input: 1000000,
      output: 1000000,
      cacheRead: 1000000
    })).toBeCloseTo(17.75, 8);
  });

  test('unknown OpenCode model uses configured base pricing', () => {
    expect(calculateOpenCodeCost('gpt-4-retired', {
      input: 1000000,
      output: 1000000,
      cacheRead: 1000000
    })).toBeCloseTo(17.75, 8);
  });

  test('unknown Gemini model uses configured base pricing', () => {
    expect(calculateGeminiCost('gemini-pro-vision-retired', {
      input: 1000000,
      output: 1000000,
      cacheRead: 1000000
    })).toBeCloseTo(11.375, 8);
  });
});
