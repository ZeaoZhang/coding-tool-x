'use strict';

const { _test } = require('../../../src/commands/doctor');

describe('doctor port checks', () => {
  test('includes configured OMP proxy port', () => {
    expect(_test.buildPortCheckMap({
      ports: {
        webUI: 19998,
        proxy: 20080,
        codexProxy: 20081,
        geminiProxy: 20082,
        opencodeProxy: 20083,
        ompProxy: 20084,
        dshProxy: 20085
      }
    })).toEqual({
      'Web UI': 19998,
      'Claude Proxy': 20080,
      'Codex Proxy': 20081,
      'Gemini Proxy': 20082,
      'OpenCode Proxy': 20083,
      'OMP Proxy': 20084,
      'DSH Proxy': 20085
    });
  });

  test('falls back to default OMP proxy port', () => {
    expect(_test.buildPortCheckMap({ ports: {} })['OMP Proxy']).toBe(20092);
    expect(_test.buildPortCheckMap({ ports: {} })['DSH Proxy']).toBe(20093);
  });
});
