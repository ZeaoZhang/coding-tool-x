'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../..');

function readProjectFile(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

describe('web log components source routing', () => {
  test('ProxyLogs routes logs and statistics by the requested source', () => {
    const source = readProjectFile('src/web/src/components/ProxyLogs.vue');

    expect(source).toContain('const source = String(props.source ||');
    expect(source).toContain('logsBySource.value[source]');
    expect(source).toContain('getPlatformTodayStatistics(props.source)');
    expect(source).not.toContain('logStreams.claude');
  });

  test('RightPanel registers the ProxyLogs component used by its template', () => {
    const source = readProjectFile('src/web/src/components/RightPanel.vue')

    expect(source).toContain("import ProxyLogs from './ProxyLogs.vue'")
    expect(source).toContain('<ProxyLogs :source="currentChannel" />')
  })

  test('dashboard log panels aggregate keyed platform sources', () => {
    const realtimePanel = readProjectFile('src/web/src/components/dashboard/RealtimeLogsPanel.vue');
    const channelColumn = readProjectFile('src/web/src/components/dashboard/ChannelColumn.vue');

    expect(realtimePanel).toContain('enabledKeys.value.flatMap');
    expect(realtimePanel).toContain('(logsBySource.value[key] || [])');
    expect(channelColumn).toContain('getLogs(props.channelType)');
    expect(channelColumn).toContain('supportsKnownRuntime()');
    expect(channelColumn).not.toContain('logStreams.claude');
  });

  test('explains that OMP logs are read continuously from native sessions', () => {
    const channelColumn = readProjectFile('src/web/src/components/dashboard/ChannelColumn.vue');
    const manifest = readProjectFile('src/platforms/manifests/omp.json');

    expect(channelColumn).toContain('ctx 将持续读取 OMP 原生会话日志');
    expect(channelColumn).not.toContain('开启动态切换后');
    expect(manifest).toContain('ctx 会持续读取 OMP 原生会话日志');
  });
});
