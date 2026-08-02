const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  importLegacyPluginRepos,
  migratePiStorage
} = require('../../../src/server/services/pi-omp-migration');

let testDir;
let paths;

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-omp-migration-'));
  paths = {
    channels: { omp: path.join(testDir, 'channels', 'omp.json') },
    activeChannel: { omp: path.join(testDir, 'channels', 'active', 'omp.json') },
    localSkills: { omp: path.join(testDir, 'local', 'skills', 'omp') },
    skillRepos: { omp: path.join(testDir, 'repos', 'skills', 'omp.json') },
    skillCaches: { omp: path.join(testDir, 'cache', 'skills', 'omp.json') },
    pluginRepos: { omp: path.join(testDir, 'repos', 'plugins', 'omp.json') },
    pluginMarketCache: { omp: path.join(testDir, 'cache', 'plugins', 'omp-market.json') },
    legacy: { dir: path.join(testDir, 'legacy') }
  };
});

afterEach(() => {
  fs.rmSync(testDir, { recursive: true, force: true });
});

test('migrates pi-only JSON, active state, local skills, and repositories', () => {
  writeJson(path.join(testDir, 'channels', 'pi.json'), [{ id: 'pi-channel', enabled: true }]);
  writeJson(path.join(testDir, 'channels', 'active', 'pi.json'), { activeChannelId: 'pi-channel' });
  writeJson(path.join(testDir, 'repos', 'skills', 'pi.json'), {
    repos: [{ id: 'skill-repo', source: '/skills' }]
  });
  writeJson(path.join(testDir, 'repos', 'plugins', 'pi.json'), {
    repos: [{ id: 'plugin-repo', source: '/plugins' }]
  });
  const skillDir = path.join(testDir, 'local', 'skills', 'pi', 'demo');
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# Demo', 'utf8');

  const result = migratePiStorage(paths);

  expect(result.migrated).toBeGreaterThan(0);
  expect(readJson(paths.channels.omp)).toEqual([{ id: 'pi-channel', enabled: true }]);
  expect(readJson(paths.activeChannel.omp)).toEqual({ activeChannelId: 'pi-channel' });
  expect(readJson(paths.skillRepos.omp).repos).toEqual([
    { id: 'skill-repo', source: '/skills' }
  ]);
  expect(readJson(paths.pluginRepos.omp).repos).toEqual([
    { id: 'plugin-repo', source: '/plugins' }
  ]);
  expect(fs.existsSync(path.join(paths.localSkills.omp, 'demo', 'SKILL.md'))).toBe(true);
});

test('merges pi and omp conflicts with omp values winning and archives stale caches', () => {
  writeJson(paths.channels.omp, [{ id: 'shared', name: 'OMP' }]);
  writeJson(path.join(testDir, 'channels', 'pi.json'), [
    { id: 'shared', name: 'PI', legacy: true },
    { id: 'pi-only', name: 'PI only' }
  ]);
  writeJson(paths.skillCaches.omp, { stale: 'omp' });
  writeJson(path.join(testDir, 'cache', 'skills', 'pi.json'), { stale: 'pi' });

  migratePiStorage(paths);

  expect(readJson(paths.channels.omp)).toEqual([
    { id: 'shared', name: 'OMP', legacy: true },
    { id: 'pi-only', name: 'PI only' }
  ]);
  expect(fs.existsSync(paths.skillCaches.omp)).toBe(false);
  expect(fs.existsSync(path.join(testDir, 'cache', 'skills', 'pi.json'))).toBe(false);
  expect(fs.readdirSync(path.join(paths.legacy.dir, 'pi-omp'), { recursive: true }))
    .toEqual(expect.arrayContaining([expect.stringMatching(/pi\.json/), expect.stringMatching(/omp\.json/)]));
});

test('migration is idempotent and can resume after an earlier partial move', () => {
  writeJson(paths.channels.omp, [{ id: 'omp-only' }]);
  writeJson(path.join(testDir, 'repos', 'skills', 'pi.json'), {
    repos: [{ id: 'pi-repo', source: '/skills' }]
  });

  migratePiStorage(paths);
  const first = readJson(paths.skillRepos.omp);
  migratePiStorage(paths);

  expect(readJson(paths.skillRepos.omp)).toEqual(first);
  expect(first.repos).toHaveLength(1);
});

test('imports legacy plugin repositories once and retains failures for retry', () => {
  writeJson(paths.pluginRepos.omp, {
    repos: [
      { id: 'good', source: 'github:acme/good' },
      { id: 'bad', source: 'github:acme/bad' }
    ]
  });
  let failBad = true;
  const adapter = {
    listMarketplaces: vi.fn(() => []),
    addMarketplace: vi.fn((source) => {
      if (source.endsWith('/bad') && failBad) throw new Error('network unavailable');
      return [];
    })
  };

  const first = importLegacyPluginRepos(adapter, paths);
  expect(first.warnings).toEqual([expect.stringContaining('github:acme/bad')]);
  expect(adapter.addMarketplace).toHaveBeenCalledWith('github:acme/good', {});
  expect(adapter.addMarketplace).toHaveBeenCalledWith('github:acme/bad', {});

  failBad = false;
  adapter.addMarketplace.mockClear();
  const second = importLegacyPluginRepos(adapter, paths);

  expect(second.warnings).toEqual([]);
  expect(adapter.addMarketplace).toHaveBeenCalledTimes(1);
  expect(adapter.addMarketplace).toHaveBeenCalledWith('github:acme/bad', {});
  expect(readJson(paths.pluginRepos.omp).repos).toHaveLength(2);
});

test('invalid legacy marketplace config is retained and reported', () => {
  fs.mkdirSync(path.dirname(paths.pluginRepos.omp), { recursive: true });
  fs.writeFileSync(paths.pluginRepos.omp, '{invalid', 'utf8');
  const adapter = {
    listMarketplaces: vi.fn(() => []),
    addMarketplace: vi.fn()
  };

  const result = importLegacyPluginRepos(adapter, paths);

  expect(result.warnings).toEqual([expect.stringMatching(/invalid/i)]);
  expect(fs.readFileSync(paths.pluginRepos.omp, 'utf8')).toBe('{invalid');
  expect(adapter.addMarketplace).not.toHaveBeenCalled();
});
