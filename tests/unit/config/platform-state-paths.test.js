'use strict';

const path = require('path');
const { PATHS, getPlatformStatePath, getPlatformStatePaths } = require('../../../src/config/paths');

describe('platform state paths', () => {
  test('keeps the existing built-in paths byte-for-byte compatible', () => {
    expect(getPlatformStatePath('activeChannel', 'claude')).toBe(PATHS.activeChannel.claude);
    expect(getPlatformStatePath('proxyRuntime', 'omp')).toBe(PATHS.proxyRuntime.omp);
    expect(getPlatformStatePath('requestSnapshots', 'codex')).toBe(PATHS.requestSnapshots.codex);
  });

  test('derives paths for an arbitrary configured platform without a Claude fallback', () => {
    const platform = 'demo-cli';

    expect(getPlatformStatePaths(platform)).toEqual({
      channels: path.join(PATHS.channelsDir, `${platform}.json`),
      activeChannel: path.join(PATHS.activeChannelDir, `${platform}.json`),
      proxyRuntime: path.join(path.dirname(PATHS.proxyRuntime.claude), `${platform}-proxy.json`),
      requestSnapshots: path.join(path.dirname(PATHS.requestSnapshots.claude), `${platform}.jsonl`),
      localSkills: path.join(path.dirname(PATHS.localSkills.claude), platform),
      skillRepos: path.join(path.dirname(PATHS.skillRepos.claude), `${platform}.json`),
      skillCaches: path.join(path.dirname(PATHS.skillCaches.claude), `${platform}.json`),
      pluginRepos: path.join(path.dirname(PATHS.pluginRepos.claude), `${platform}.json`),
      pluginMarketCache: path.join(path.dirname(PATHS.pluginMarketCache.claude), `${platform}-market.json`),
      gatewaySecret: path.join(path.dirname(PATHS.ompGatewaySecret), `${platform}-gateway-secret`)
    });
    expect(getPlatformStatePath('activeChannel', platform)).toBe(
      path.join(PATHS.activeChannelDir, `${platform}.json`)
    );
    expect(getPlatformStatePath('activeChannel', 'unknown/cli')).toBeUndefined();
    expect(getPlatformStatePath('activeChannel', '')).toBeUndefined();
  });
});
