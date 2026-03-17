const { createDecodedStream } = require('../../../src/server/services/response-decoder');

function createMockRes(contentEncoding) {
  const piped = { _piped: true };
  return {
    headers: { 'content-encoding': contentEncoding || '' },
    pipe: vi.fn(() => piped),
    _piped: false
  };
}

describe('createDecodedStream', () => {
  test('no encoding returns res itself without calling pipe', () => {
    const res = createMockRes('');
    const result = createDecodedStream(res);
    expect(result).toBe(res);
    expect(res.pipe).not.toHaveBeenCalled();
  });

  test('empty string encoding returns res itself', () => {
    const res = createMockRes('');
    const result = createDecodedStream(res);
    expect(result).toBe(res);
    expect(res.pipe).not.toHaveBeenCalled();
  });

  test('undefined encoding returns res itself', () => {
    const res = {
      headers: {},
      pipe: vi.fn(() => ({ _piped: true })),
      _piped: false
    };
    const result = createDecodedStream(res);
    expect(result).toBe(res);
    expect(res.pipe).not.toHaveBeenCalled();
  });

  test('gzip encoding calls pipe and returns piped stream', () => {
    const res = createMockRes('gzip');
    const result = createDecodedStream(res);
    expect(res.pipe).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ _piped: true });
  });

  test('deflate encoding calls pipe and returns piped stream', () => {
    const res = createMockRes('deflate');
    const result = createDecodedStream(res);
    expect(res.pipe).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ _piped: true });
  });

  test('br encoding calls pipe and returns piped stream', () => {
    const res = createMockRes('br');
    const result = createDecodedStream(res);
    expect(res.pipe).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ _piped: true });
  });

  test('Gzip (mixed case) is treated case-insensitively and calls pipe', () => {
    const res = createMockRes('Gzip');
    const result = createDecodedStream(res);
    expect(res.pipe).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ _piped: true });
  });

  test('x-gzip includes "gzip" substring so pipe is called', () => {
    const res = createMockRes('x-gzip');
    const result = createDecodedStream(res);
    expect(res.pipe).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ _piped: true });
  });
});
