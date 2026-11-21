const { describe, it, expect, vi } = await import('vitest');
const apiNotFound = require('../../../src/server/api/not-found');

function mockRes() {
  const res = { statusCode: 200 };
  res.status = vi.fn((code) => { res.statusCode = code; return res; });
  res.json = vi.fn((data) => { res._data = data; return res; });
  return res;
}

describe('API 404 fallback', () => {
  it('returns a JSON 404 with method and path', () => {
    const res = mockRes();

    apiNotFound({ method: 'GET', originalUrl: '/api/does-not-exist' }, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Not Found',
      code: 'API_NOT_FOUND',
      method: 'GET',
      path: '/api/does-not-exist'
    });
  });

  it('never returns HTML', () => {
    const res = mockRes();
    res.json = vi.fn((data) => { res._data = data; return res; });

    apiNotFound({ method: 'POST', originalUrl: '/api/nope' }, res);

    expect(res._data).toEqual(expect.objectContaining({ code: 'API_NOT_FOUND' }));
  });
});
