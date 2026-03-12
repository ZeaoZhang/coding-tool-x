const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function setMtime(filePath, secondsFromNow) {
  const ts = new Date(Date.now() + secondsFromNow * 1000);
  fs.utimesSync(filePath, ts, ts);
}

function runMigration(tempHome) {
  execFileSync(process.execPath, ['-e', 'require("./src/config/paths");'], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      HOME: tempHome
    },
    stdio: 'inherit'
  });
}

function run() {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-tool-path-migration-'));
  const baseDir = path.join(tempHome, '.cc-tool');

  const oldConfigPath = path.join(baseDir, 'config.json');
  const newConfigPath = path.join(baseDir, 'config', 'config.json');
  writeJson(newConfigPath, {
    currentCliType: 'claude',
    ports: { webUI: 19999 },
    featureFlags: { keepFromNew: true }
  });
  writeJson(oldConfigPath, {
    currentCliType: 'codex',
    pageSize: 50
  });
  setMtime(newConfigPath, -20);
  setMtime(oldConfigPath, 20);

  const oldChannelsPath = path.join(baseDir, 'channels.json');
  const newChannelsPath = path.join(baseDir, 'storage', 'channels', 'claude.json');
  writeJson(newChannelsPath, {
    channels: [
      { id: 'shared', name: 'Shared', enabled: true, weight: 2 },
      { id: 'new-only', name: 'NewOnly', enabled: true }
    ]
  });
  writeJson(oldChannelsPath, {
    channels: [
      { id: 'legacy-only', name: 'LegacyOnly', enabled: true },
      { id: 'shared', name: 'Shared', enabled: false }
    ]
  });
  setMtime(newChannelsPath, -20);
  setMtime(oldChannelsPath, 20);

  const oldFavoritesPath = path.join(baseDir, 'favorites.json');
  const newFavoritesPath = path.join(baseDir, 'config', 'favorites.json');
  writeJson(oldFavoritesPath, {
    claude: ['legacy-favorite']
  });
  writeJson(newFavoritesPath, {
    claude: [],
    opencode: []
  });
  setMtime(oldFavoritesPath, -20);
  setMtime(newFavoritesPath, 20);

  const oldLogsPath = path.join(baseDir, 'proxy-logs.json');
  const newLogsPath = path.join(baseDir, 'storage', 'stats', 'proxy-logs.json');
  writeJson(newLogsPath, [
    { id: 'log-1', time: 1000, model: 'new-model' }
  ]);
  writeJson(oldLogsPath, [
    { id: 'log-2', time: 2000, model: 'old-model' }
  ]);
  setMtime(newLogsPath, -20);
  setMtime(oldLogsPath, 20);

  const legacyBackupPath = path.join(baseDir, 'opencode-active-channel.json.bak-20260214200800');
  ensureDir(path.dirname(legacyBackupPath));
  fs.writeFileSync(legacyBackupPath, '{"activeChannelId":"legacy"}', 'utf8');

  const legacyCtxDir = path.join(tempHome, '.claude', 'ctx');
  const legacyUiConfigPath = path.join(legacyCtxDir, 'ui-config.json');
  writeJson(legacyUiConfigPath, {
    theme: 'legacy-ui'
  });

  runMigration(tempHome);

  assert(!fs.existsSync(oldConfigPath), '旧 root config.json 应被清理');
  assert(!fs.existsSync(oldChannelsPath), '旧 root channels.json 应被清理');
  assert(!fs.existsSync(oldFavoritesPath), '旧 root favorites.json 应被清理');
  assert(!fs.existsSync(oldLogsPath), '旧 root proxy-logs.json 应被清理');
  assert(!fs.existsSync(legacyBackupPath), '旧 root .bak 文件应被迁移');

  const mergedConfig = readJson(newConfigPath);
  assert.strictEqual(mergedConfig.currentCliType, 'codex', '较新的旧配置应覆盖冲突标量值');
  assert.strictEqual(mergedConfig.pageSize, 50, '旧配置中的独有字段应保留');
  assert.deepStrictEqual(mergedConfig.ports, { webUI: 19999 }, '新配置中的独有对象字段应保留');
  assert.deepStrictEqual(mergedConfig.featureFlags, { keepFromNew: true }, '新配置中的独有对象应保留');

  const mergedChannels = readJson(newChannelsPath).channels;
  assert.strictEqual(mergedChannels.length, 3, '渠道列表应合并去重');
  const sharedChannel = mergedChannels.find((channel) => channel.id === 'shared');
  assert(sharedChannel, '共享渠道应保留');
  assert.strictEqual(sharedChannel.enabled, false, '较新的旧渠道配置应保留冲突字段');
  assert.strictEqual(sharedChannel.weight, 2, '新渠道配置中的补充字段应保留');

  const mergedFavorites = readJson(newFavoritesPath);
  assert.deepStrictEqual(mergedFavorites.claude, ['legacy-favorite'], '较旧配置中的数组项应补充到新配置');
  assert.deepStrictEqual(mergedFavorites.opencode, [], '新配置中的独有数组键应保留');

  const mergedLogs = readJson(newLogsPath);
  assert.strictEqual(mergedLogs.length, 2, '日志数组应合并去重');
  assert(mergedLogs.some((entry) => entry.id === 'log-1'), '新日志条目应保留');
  assert(mergedLogs.some((entry) => entry.id === 'log-2'), '旧日志条目应保留');

  assert(
    fs.existsSync(path.join(baseDir, 'storage', 'legacy', 'root-conflicts', 'config.json')),
    '冲突 root config.json 应归档到 storage/legacy/root-conflicts'
  );
  assert(
    fs.existsSync(path.join(baseDir, 'storage', 'legacy', 'root-conflicts', 'channels.json')),
    '冲突 root channels.json 应归档到 storage/legacy/root-conflicts'
  );
  assert(
    fs.existsSync(path.join(baseDir, 'storage', 'legacy', 'root-backups', 'opencode-active-channel.json.bak-20260214200800')),
    'root .bak 文件应归档到 storage/legacy/root-backups'
  );
  assert.strictEqual(readJson(path.join(baseDir, 'config', 'ui-config.json')).theme, 'legacy-ui', '旧 ~/.claude/ctx 配置应导入到新目录');

  const legacyImportStatePath = path.join(baseDir, 'storage', 'legacy', 'import-state.json');
  assert(fs.existsSync(legacyImportStatePath), '旧目录导入后应写入 import-state');

  runMigration(tempHome);

  assert(
    !fs.existsSync(path.join(baseDir, 'storage', 'legacy', 'root-conflicts', 'ui-config.json')),
    '第二次启动不应重复从 ~/.claude/ctx 导入旧文件'
  );

  console.log('路径迁移测试通过');
}

run();
