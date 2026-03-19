const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { PluginsService } = require('../src/server/services/plugins-service');

function createTempPluginsService(platform = 'claude') {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-plugin-market-test-'));
  const service = new PluginsService(platform);
  service.ccToolConfigDir = path.join(tempRoot, 'config');
  service.marketCachePath = path.join(
    service.ccToolConfigDir,
    `${platform === 'opencode' ? 'opencode-' : ''}plugins-market-cache.json`
  );
  service.opencodePluginsDir = path.join(tempRoot, 'opencode-plugins');
  service.opencodeLegacyPluginsDir = path.join(tempRoot, 'opencode-plugin');
  service.listPlugins = () => ({ plugins: [] });
  return { service, tempRoot };
}

function cleanupTemp(root) {
  fs.rmSync(root, { recursive: true, force: true });
}

async function run() {
  {
    const { service, tempRoot } = createTempPluginsService();
    try {
      const fileCache = [
        { name: 'alpha-plugin', repoOwner: 'cached', repoName: 'repo', directory: 'alpha' },
        { name: 'beta-plugin', repoOwner: 'cached', repoName: 'repo', directory: 'beta' }
      ];
      service._ensureDir(path.dirname(service.marketCachePath));
      fs.writeFileSync(service.marketCachePath, JSON.stringify({ plugins: fileCache }), 'utf-8');
      service._marketCache = [
        { name: 'alpha-plugin', repoOwner: 'cached', repoName: 'repo', directory: 'alpha' }
      ];

      const plugins = await service.getMarketPlugins();
      assert.strictEqual(plugins.length, 2, '内存缓存不完整时应优先使用更完整的磁盘缓存');
      assert.strictEqual(plugins[0].name, 'alpha-plugin', '磁盘缓存返回顺序不正确');
      assert.strictEqual(plugins[1].name, 'beta-plugin', '磁盘缓存结果不完整');
    } finally {
      cleanupTemp(tempRoot);
    }
  }

  {
    const { service, tempRoot } = createTempPluginsService();
    try {
      const fileCache = [
        { name: 'cached-plugin', repoOwner: 'cached', repoName: 'repo', directory: 'cached-plugin' }
      ];
      service._ensureDir(path.dirname(service.marketCachePath));
      fs.writeFileSync(service.marketCachePath, JSON.stringify({ plugins: fileCache }), 'utf-8');
      service.getRepos = () => [
        { owner: 'openai', name: 'plugins', branch: 'main', enabled: true }
      ];
      service.fetchRepoTree = async () => {
        throw new Error('HTTP 403');
      };

      const plugins = await service.getMarketPlugins(true);
      assert.strictEqual(plugins.length, 1, '强制刷新且远端失败时应回退到磁盘缓存');
      assert.strictEqual(plugins[0].name, 'cached-plugin', '强制刷新失败后的磁盘缓存结果不正确');

      const diskCache = JSON.parse(fs.readFileSync(service.marketCachePath, 'utf-8'));
      assert.strictEqual(diskCache.plugins.length, 1, '强制刷新失败时不应清空磁盘缓存');
      assert.strictEqual(diskCache.plugins[0].name, 'cached-plugin', '强制刷新失败后应保留原磁盘缓存');
    } finally {
      cleanupTemp(tempRoot);
    }
  }

  {
    const { service, tempRoot } = createTempPluginsService();
    try {
      const fileCache = [
        { name: 'cached-plugin-a', repoOwner: 'cached', repoName: 'repo', directory: 'a' },
        { name: 'cached-plugin-b', repoOwner: 'cached', repoName: 'repo', directory: 'b' }
      ];
      service._ensureDir(path.dirname(service.marketCachePath));
      fs.writeFileSync(service.marketCachePath, JSON.stringify({ plugins: fileCache }), 'utf-8');
      service.getRepos = () => [
        { owner: 'repo-owner-a', name: 'repo-a', branch: 'main', enabled: true },
        { owner: 'repo-owner-b', name: 'repo-b', branch: 'main', enabled: true }
      ];
      service.fetchRepoTree = async (repo) => {
        if (repo.owner === 'repo-owner-a') {
          return [{ path: '.claude-plugin/marketplace.json', type: 'blob' }];
        }
        throw new Error('HTTP 403');
      };
      service.fetchRepoJson = async (repo, filePath) => {
        if (repo.owner === 'repo-owner-a' && filePath === '.claude-plugin/marketplace.json') {
          return {
            plugins: [
              {
                name: 'partial-plugin',
                description: 'partial',
                version: '1.0.0',
                source: './partial-plugin'
              }
            ],
            owner: { name: 'repo-owner-a' }
          };
        }
        throw new Error('HTTP 403');
      };

      const plugins = await service.getMarketPlugins(true);
      assert.strictEqual(plugins.length, 2, '部分仓库失败且结果不完整时应回退到更完整的磁盘缓存');
      assert.strictEqual(plugins[0].name, 'cached-plugin-a', '部分失败场景下的磁盘缓存回退结果不正确');
      assert.strictEqual(plugins[1].name, 'cached-plugin-b', '部分失败场景下应保留完整磁盘缓存');
    } finally {
      cleanupTemp(tempRoot);
    }
  }

  {
    const { service, tempRoot } = createTempPluginsService();
    try {
      service._ensureDir(path.dirname(service.marketCachePath));
      fs.writeFileSync(service.marketCachePath, JSON.stringify({ plugins: [{ name: 'cached-plugin' }] }), 'utf-8');
      service._marketCache = [{ name: 'cached-plugin' }];

      service.addRepo({ url: 'https://github.com/example/plugins', branch: 'main' });
      assert.strictEqual(service._marketCache, null, '添加仓库后应清空内存缓存');
      assert.strictEqual(fs.existsSync(service.marketCachePath), false, '添加仓库后应删除磁盘缓存');

      fs.writeFileSync(service.marketCachePath, JSON.stringify({ plugins: [{ name: 'cached-plugin' }] }), 'utf-8');
      service._marketCache = [{ name: 'cached-plugin' }];
      service.toggleRepo('example', 'plugins', false);
      assert.strictEqual(service._marketCache, null, '切换仓库状态后应清空内存缓存');
      assert.strictEqual(fs.existsSync(service.marketCachePath), false, '切换仓库状态后应删除磁盘缓存');

      fs.writeFileSync(service.marketCachePath, JSON.stringify({ plugins: [{ name: 'cached-plugin' }] }), 'utf-8');
      service._marketCache = [{ name: 'cached-plugin' }];
      service.removeRepo('example', 'plugins');
      assert.strictEqual(service._marketCache, null, '删除仓库后应清空内存缓存');
      assert.strictEqual(fs.existsSync(service.marketCachePath), false, '删除仓库后应删除磁盘缓存');
    } finally {
      cleanupTemp(tempRoot);
    }
  }

  console.log('plugin market cache 测试通过');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
