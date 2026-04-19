'use strict';

const { resolveChannelWebsiteUrl, _test } = require('../../../src/config/channel-preset-websites');

describe('channel-preset-websites', () => {
  test('prefers existing websiteUrl when provided', () => {
    expect(resolveChannelWebsiteUrl('claude', {
      presetId: 'official',
      websiteUrl: 'https://example.com/custom'
    })).toBe('https://example.com/custom');
  });

  test('resolves websiteUrl by presetId', () => {
    expect(resolveChannelWebsiteUrl('codex', {
      presetId: 'openai',
      websiteUrl: ''
    })).toBe('https://platform.openai.com');
  });

  test('resolves websiteUrl by normalized baseUrl for legacy channels', () => {
    expect(resolveChannelWebsiteUrl('gemini', {
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/',
      websiteUrl: ''
    })).toBe('https://ai.google.dev');
  });

  test('returns empty string when no mapping exists', () => {
    expect(resolveChannelWebsiteUrl('opencode', {
      presetId: 'custom',
      baseUrl: 'https://custom.example.com/v1'
    })).toBe('');
  });

  test('normalizes baseUrl host casing and trailing slash for matching', () => {
    expect(_test.normalizeBaseUrl('HTTPS://API.OPENAI.COM/v1/')).toBe('https://api.openai.com/v1');
  });
});
