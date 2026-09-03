'use strict';

const {
  createDriverResult,
  normalizeDriverResult,
  driverError,
  unwrapDriverResult,
  invokeDriverOperation
} = require('../../../src/shared/driver-result');

describe('typed Driver result contract', () => {
  test('keeps success data and hides native causes from serialization', () => {
    const cause = new Error('native detail');
    const result = createDriverResult({
      platform: 'claude',
      capability: 'sessions',
      operation: 'list',
      data: { sessions: [] },
      cause
    });

    expect(result).toEqual({
      status: 'ok',
      platform: 'claude',
      capability: 'sessions',
      operation: 'list',
      data: { sessions: [] }
    });
    expect(result.cause).toBe(cause);
    expect(JSON.stringify(result)).not.toContain('native detail');
  });

  test('normalizes raw values and preserves typed failure causes', () => {
    expect(normalizeDriverResult(['session'], {
      platform: 'codex', capability: 'sessions', operation: 'list'
    })).toEqual({
      status: 'ok',
      platform: 'codex',
      capability: 'sessions',
      operation: 'list',
      data: ['session']
    });

    const cause = new Error('index unavailable');
    const normalized = normalizeDriverResult({
      status: 'failed', error: 'session index unavailable', cause
    }, { platform: 'gemini', capability: 'sessions', operation: 'list' });
    expect(normalized).toMatchObject({
      status: 'failed',
      platform: 'gemini',
      capability: 'sessions',
      operation: 'list',
      error: 'session index unavailable'
    });
    expect(normalized.cause).toBe(cause);
    expect(Object.keys(normalized)).not.toContain('cause');
  });

  test('unwraps failures as errors with operation context', () => {
    const result = createDriverResult({
      platform: 'omp', capability: 'projects', operation: 'list',
      status: 'unavailable', error: 'OMP is not installed'
    });
    const error = driverError(result);
    expect(error).toMatchObject({
      message: 'OMP is not installed',
      status: 'unavailable',
      platform: 'omp',
      capability: 'projects',
      operation: 'list'
    });
    expect(() => unwrapDriverResult(result)).toThrow('OMP is not installed');
  });

  test('returns explicit unsupported and failed results from invocation', async () => {
    const context = { platform: 'opencode', capability: 'api' };
    await expect(invokeDriverOperation({}, 'missing', [], context)).resolves.toEqual({
      status: 'unsupported',
      platform: 'opencode',
      capability: 'api',
      operation: 'missing'
    });
    await expect(invokeDriverOperation({ run: () => { throw new Error('boom'); } }, 'run', [], context))
      .resolves.toMatchObject({
        status: 'failed',
        platform: 'opencode',
        capability: 'api',
        operation: 'run',
        error: 'boom'
      });
  });
});
