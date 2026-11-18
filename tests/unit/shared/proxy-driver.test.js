'use strict';

const { createProxyDriver } = require('../../../src/shared/proxy-driver');

function createDriver(manifest) {
  return createProxyDriver({
    platform: manifest.key || 'test',
    servicePath: './test/proxy-implementation',
    localServicePath: '../drivers/test/proxy-implementation',
    exports: { status: 'getStatus', start: 'start', stop: 'stop' },
    requireImpl: () => ({}),
    manifest
  });
}

describe('proxy driver CLI metadata', () => {
  it('exposes managed provider mode and proxy labels from the manifest', () => {
    const driver = createDriver({
      key: 'omp',
      proxyMode: 'managed',
      defaultPort: 20092,
      proxyLabels: {
        serviceLabel: 'OMP 动态切换',
        stoppedMessage: 'OMP 已切换为多渠道直连模式'
      }
    });

    expect(driver.getCliMetadata()).toEqual({
      managedProviderConfig: true,
      defaultPort: 20092,
      proxyLabels: {
        serviceLabel: 'OMP 动态切换',
        stoppedMessage: 'OMP 已切换为多渠道直连模式'
      }
    });
  });

  it('keeps standard-mode platforms on the non-managed CLI path', () => {
    const driver = createDriver({ key: 'claude' });

    expect(driver.getCliMetadata()).toEqual({
      managedProviderConfig: false,
      proxyLabels: {}
    });
  });
});
