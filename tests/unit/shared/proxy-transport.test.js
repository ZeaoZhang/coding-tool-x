const { EventEmitter } = require('events');
const { proxyRequestLifecycle, bindChannelRelease, bindProxyRequest, collectResponseBody } = require('../../../src/shared/proxy-transport');

function context() {
  const req = Object.assign(new EventEmitter(), { rawBody: Buffer.from('body'), body: { text: 'body' } });
  const res = Object.assign(new EventEmitter(), { writableEnded: false });
  return { req, res };
}

describe('proxy request lifecycle', () => {
  test('aborts waiting allocation on a disconnected downstream and removes retained body references', () => {
    const { req, res } = context();
    proxyRequestLifecycle(req, res, vi.fn());
    res.emit('close');
    expect(req.proxyAllocationSignal.aborted).toBe(true);
    expect(req.body).toBeUndefined();
    expect(req.rawBody).toBeNull();
    expect(req.listenerCount('aborted')).toBe(0);
    expect(res.listenerCount('finish')).toBe(0);
  });

  test('releases a channel exactly once across finish, close and error paths', () => {
    const { req, res } = context();
    const release = vi.fn();
    bindChannelRelease(req, res, release);
    res.emit('finish');
    res.emit('close');
    expect(release).toHaveBeenCalledTimes(1);
    expect(res.listenerCount('error')).toBe(0);
  });

  test('destroys the upstream when a streaming downstream disconnects', () => {
    const { res } = context();
    const upstream = Object.assign(new EventEmitter(), { destroy: vi.fn() });
    bindProxyRequest(upstream, res);
    res.emit('close');
    expect(upstream.destroy).toHaveBeenCalledTimes(1);
    upstream.emit('close');
    expect(res.listenerCount('close')).toBe(0);
  });

  test('normal completion preserves the non-aborted signal', () => {
    const { req, res } = context();
    proxyRequestLifecycle(req, res, vi.fn());
    res.writableEnded = true;
    res.emit('finish');
    expect(req.proxyAllocationSignal.aborted).toBe(false);
    expect(req.body).toBeUndefined();
  });
});


describe('bounded response collection', () => {
  test('releases buffers and rejects an aborted response without an unhandled follow-up error', async () => {
    const response = Object.assign(new EventEmitter(), { destroy: vi.fn() });
    const result = collectResponseBody(response);
    response.emit('data', Buffer.from('partial'));
    response.emit('aborted');
    await expect(result).rejects.toThrow('aborted');
    expect(response.listenerCount('data')).toBe(0);
    expect(() => response.emit('error', new Error('ECONNRESET'))).not.toThrow();
  });

  test('bounds decoded response bytes and clears data listeners', async () => {
    const response = Object.assign(new EventEmitter(), { destroy: vi.fn() });
    const result = collectResponseBody(response, response, 4);
    response.emit('data', Buffer.from('12345'));
    await expect(result).rejects.toThrow('byte limit');
    expect(response.destroy).toHaveBeenCalledTimes(1);
    expect(response.listenerCount('data')).toBe(0);
  });
});


test('rejects a decoded stream that closes without an end event', async () => {
  const response = Object.assign(new EventEmitter(), { destroy: vi.fn() });
  const decoded = Object.assign(new EventEmitter(), { destroy: vi.fn() });
  const result = collectResponseBody(response, decoded);
  decoded.emit('data', Buffer.from('retained'));
  decoded.emit('close');
  await expect(result).rejects.toThrow('closed before completion');
  expect(decoded.listenerCount('data')).toBe(0);
  expect(response.listenerCount('close')).toBe(0);
});

test('releases an allocation immediately if the downstream is already closed', () => {
  const { req, res } = context();
  res.destroyed = true;
  const release = vi.fn();
  bindChannelRelease(req, res, release);
  expect(release).toHaveBeenCalledTimes(1);
  expect(res.listenerCount('close')).toBe(0);
});


test('allows a completed compressed source to close while decoding finishes', async () => {
  const response = Object.assign(new EventEmitter(), { complete: true, destroy: vi.fn() });
  const decoded = Object.assign(new EventEmitter(), { destroy: vi.fn() });
  const result = collectResponseBody(response, decoded);
  response.emit('close');
  decoded.emit('data', Buffer.from('decoded'));
  decoded.emit('end');
  await expect(result).resolves.toBe('decoded');
});
