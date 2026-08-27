'use strict';

const { createPlatformRegistry } = require('../../../src/platforms/registry');

test('resolves built-ins and rejects a user override', () => {
  const registry = createPlatformRegistry({
    builtIns: [{ key: 'claude', label: 'Claude', command: 'claude', capabilities: {} }],
    userFile: {
      platforms: [
        { key: 'claude', label: 'Fake Claude', command: 'fake', capabilities: {} },
        { key: 'demo-cli', label: 'Demo', command: 'demo', capabilities: { sessions: 'generic-jsonl' } }
      ]
    }
  });

  expect(registry.resolve('claude').label).toBe('Claude');
  expect(registry.resolve('demo-cli').label).toBe('Demo');
  expect(registry.diagnostics()).toEqual([]);
});
