'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createNativeLogCheckpoints } = require('../../../src/server/services/native-log-checkpoints');

test('checkpoint hot cache limits entries and bytes while evicted state remains exact', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'checkpoints-unit-'));
  const store = createNativeLogCheckpoints({ directory, maxEntries: 4, maxBytes: 128 });
  try {
    store.transaction(() => {
      for (let i = 0; i < 20; i++) store.set('source', `key-${i}`, { tokens: i });
      store.set('source', 'oversized', { value: 'x'.repeat(1024) });
    });
    expect(store.diagnostics().hotEntries).toBeLessThanOrEqual(4);
    expect(store.diagnostics().hotBytes).toBeLessThanOrEqual(128);
    expect(store.get('source', 'key-0')).toEqual({ tokens: 0 });
    expect(store.get('source', 'oversized').value).toHaveLength(1024);
    expect(store.diagnostics().hotBytes).toBeLessThanOrEqual(128);
    store.deleteScope('source');
    expect(store.get('source', 'key-0')).toBeUndefined();
  } finally { store.close(); }
  expect(fs.readdirSync(directory)).toEqual([]);
  fs.rmSync(directory, { recursive: true });
});

test('checkpoint pending batches are ordered and rollback restores state and accounting', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'checkpoints-unit-'));
  const store = createNativeLogCheckpoints({ directory });
  try {
    store.set('source', 'old', { input: 10 });
    expect(() => store.transaction(() => {
      store.set('source', 'old', { input: 99 });
      store.enqueue({ id: 'failed' });
      throw new Error('failed write');
    })).toThrow('failed write');
    expect(store.get('source', 'old')).toEqual({ input: 10 });
    expect(store.diagnostics().pendingEvents).toBe(0);
    for (let i = 0; i < 1100; i++) store.enqueue({ id: i });
    expect(store.drain().map(event => event.id)).toEqual(Array.from({ length: 500 }, (_, i) => i));
    expect(store.drain()).toHaveLength(500);
    expect(store.drain()).toHaveLength(100);
    expect(store.diagnostics().pendingBytes).toBe(0);
  } finally { store.close(); fs.rmSync(directory, { recursive: true }); }
});
