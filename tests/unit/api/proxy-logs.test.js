const { describe, it, expect, vi, beforeEach, afterEach } = await import('vitest');

const wsModPath = require.resolve('../../../src/server/websocket-server');
const mockClearLogsBySource = vi.fn(async () => {});

require.cache[wsModPath] = {
  id: wsModPath,
  filename: wsModPath,
  loaded: true,
  exports: { clearLogsBySource: mockClearLogsBySource }
};

const proxyLogsFactory = require('../../../src/server/api/proxy-logs');

function findHandler(router, method, routePath) {
  for (const layer of router.stack) {
    if (layer.route && layer.route.path === routePath) {
      for (const s of layer.route.stack) {
        if (s.method === method) return s.handle;
      }
    }
  }
  return null;
}

const mockRes = () => {
  const res = { statusCode: 200 };
  res.status = vi.fn((code) => { res.statusCode = code; return res; });
  res.json = vi.fn((data) => { res._data = data; return res; });
  return res;
};

describe('proxy logs API', () => {
  let router;

  beforeEach(() => {
    vi.clearAllMocks();
    router = proxyLogsFactory();
  });

  afterEach(() => {
    delete require.cache[wsModPath];
  });

  it('clears logs for a known source', async () => {
    const handler = findHandler(router, 'post', '/logs/clear');
    const res = mockRes();

    await handler({ query: { source: 'codex' }, body: {} }, res);

    expect(mockClearLogsBySource).toHaveBeenCalledWith('codex');
    expect(res.json).toHaveBeenCalledWith({ success: true, source: 'codex' });
  });

  it('falls back to all sources when source is omitted', async () => {
    const handler = findHandler(router, 'post', '/logs/clear');
    const res = mockRes();

    await handler({ query: {}, body: {} }, res);

    expect(mockClearLogsBySource).toHaveBeenCalledWith(null);
    expect(res.json).toHaveBeenCalledWith({ success: true, source: 'all' });
  });

  it('rejects an unknown source without clearing anything', async () => {
    const handler = findHandler(router, 'post', '/logs/clear');
    const res = mockRes();

    await handler({ query: { source: '../etc' }, body: {} }, res);

    expect(mockClearLogsBySource).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].error).toContain('Unknown log source');
  });

  it('returns 500 when clearing fails', async () => {
    const handler = findHandler(router, 'post', '/logs/clear');
    mockClearLogsBySource.mockRejectedValueOnce(new Error('write failed'));
    const res = mockRes();

    await handler({ query: { source: 'omp' }, body: {} }, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'write failed' });
  });
});
