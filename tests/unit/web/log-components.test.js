'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../..');

function readProjectFile(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

describe('web log components source routing', () => {
  test('ProxyLogs renders OpenCode and OMP streams without Claude fallback', () => {
    const source = readProjectFile('src/web/src/components/ProxyLogs.vue');

    expect(source).toContain("opencode: getLogs('opencode')");
    expect(source).toContain("omp: getLogs('omp')");
    expect(source).toContain("source === 'opencode' || source === 'omp'");
    expect(source).not.toContain('|| logStreams.claude');
  });

  test('dashboard log panels include OpenCode and OMP without Claude fallback', () => {
    const realtimePanel = readProjectFile('src/web/src/components/dashboard/RealtimeLogsPanel.vue');
    const channelColumn = readProjectFile('src/web/src/components/dashboard/ChannelColumn.vue');

    expect(realtimePanel).toContain("const opencodeLogs = getLogs('opencode')");
    expect(realtimePanel).toContain("const ompLogs = getLogs('omp')");
    expect(realtimePanel).toContain('...opencodeLogs.value.map(normalizeLog)');
    expect(realtimePanel).toContain('...ompLogs.value.map(normalizeLog)');
    expect(realtimePanel).toContain("channelType: log.source || 'unknown'");

    expect(channelColumn).toContain("opencode: getLogs('opencode')");
    expect(channelColumn).toContain("omp: getLogs('omp')");
    expect(channelColumn).not.toContain('|| logStreams.claude');
  });
});
