'use strict';

const { createPlatformCommandRegistry } = require('../../../src/commands/platform-command-registry');

describe('platform command registry', () => {
  it('derives proxy, log, statistics, port, and help metadata', () => {
    const registry = createPlatformCommandRegistry({
      platforms: [{
        key: 'demo-cli',
        label: 'Demo CLI',
        command: 'demo',
        logFile: 'demo-proxy.log',
        portKey: 'demoProxy',
        defaultPort: 23100,
        capabilities: {
          proxy: 'unsupported',
          statistics: 'unsupported'
        }
      }]
    });

    expect(registry.resolve('DEMO-CLI')).toEqual(expect.objectContaining({ label: 'Demo CLI' }));
    expect(registry.platformKeys()).toEqual(['demo-cli']);
    expect(registry.logTypes()).toEqual(['demo-cli']);
    expect(registry.portKeys()).toEqual(['demoProxy']);
    expect(registry.statsTypes()).toEqual([]);
    expect(registry.helpEntries()).toEqual([expect.objectContaining({
      key: 'demo-cli',
      command: 'demo',
      label: 'Demo CLI',
      proxy: false,
      log: true,
      stats: false,
      portKey: 'demoProxy'
    })]);
  });

  it('accepts a configured platform with supported capabilities', () => {
    const registry = createPlatformCommandRegistry({
      platforms: [{
        key: 'demo-cli',
        label: 'Demo CLI',
        capabilities: { proxy: 'legacy:demo', statistics: 'legacy:demo' }
      }]
    });

    expect(registry.resolve('demo-cli').label).toBe('Demo CLI');
    expect(registry.statsTypes()).toEqual(['demo-cli']);
    expect(registry.helpEntries()[0]).toEqual(expect.objectContaining({ proxy: true, stats: true }));
  });
});
