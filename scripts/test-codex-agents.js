const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const toml = require('toml');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-tool-codex-agents-'));
const fakeHome = path.join(tempRoot, 'home');
fs.mkdirSync(fakeHome, { recursive: true });
process.env.HOME = fakeHome;
process.env.USERPROFILE = fakeHome;

const codexDir = path.join(fakeHome, '.codex');
const codexConfigPath = path.join(codexDir, 'config.toml');
const externalDir = path.join(fakeHome, '.omx', 'agents');
const externalConfigPath = path.join(externalDir, 'external-reader.toml');

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeUtf8(filePath, content) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf-8');
}

function readCodexConfig() {
  const content = fs.readFileSync(codexConfigPath, 'utf-8');
  return toml.parse(content);
}

async function run() {
  try {
    writeUtf8(externalConfigPath, 'model = "gpt-5.3-codex"\nreasoning_effort = "high"\n');
    writeUtf8(codexConfigPath, [
      '[features]',
      'multi_agent = true',
      '',
      '[agents.external-reader]',
      'description = "External config reader"',
      `config_file = "${externalConfigPath.replace(/\\/g, '\\\\')}"`,
      ''
    ].join('\n'));

    // Require after HOME is replaced to isolate from real ~/.codex state.
    const { AgentsService } = require('../src/server/services/agents-service');
    const codexEnvManager = require('../src/server/services/codex-env-manager');
    const codexSettingsManager = require('../src/server/services/codex-settings-manager');
    const codexChannels = require('../src/server/services/codex-channels');
    const service = new AgentsService('codex');
    const envTest = codexEnvManager._test || {};

    assert.strictEqual(typeof envTest.syncCodexUserEnvironment, 'function', '缺少 syncCodexUserEnvironment 测试导出');
    assert.strictEqual(typeof envTest.buildSourceSnippet, 'function', '缺少 buildSourceSnippet 测试导出');

    const listed = service.listCodexAgents();
    const externalAgent = listed.agents.find((item) => item.fileName === 'external-reader');
    assert(externalAgent, '应读取到 external-reader 代理');
    assert.strictEqual(externalAgent.configMode, 'custom', '外部 config_file 应识别为 custom');
    assert.strictEqual(externalAgent.configReadError, '', '可读外部配置不应报错');
    assert(externalAgent.fullContent.includes('reasoning_effort'), '应返回外部 TOML 原文');
    assert.strictEqual(externalAgent.model, 'gpt-5.3-codex', '应从 TOML 解析 model');

    service.createAgent({
      fileName: 'no-config',
      scope: 'user',
      description: 'No config mode',
      configMode: 'none'
    });
    let config = readCodexConfig();
    assert(config.agents['no-config'], 'none 模式应创建 agent 项');
    assert(!Object.prototype.hasOwnProperty.call(config.agents['no-config'], 'config_file'), 'none 模式不应写 config_file');

    const managedContent = 'model = "managed-model"\nreasoning_effort = "medium"\n';
    service.createAgent({
      fileName: 'managed-one',
      scope: 'user',
      description: 'Managed config mode',
      configMode: 'managed',
      configContent: managedContent
    });
    const managedConfigPath = path.join(fakeHome, '.codex', 'agents', 'managed-one.toml');
    assert(fs.existsSync(managedConfigPath), 'managed 模式应创建托管 TOML');
    assert.strictEqual(fs.readFileSync(managedConfigPath, 'utf-8'), managedContent, 'managed TOML 内容应保留');
    config = readCodexConfig();
    assert.strictEqual(config.agents['managed-one'].config_file, managedConfigPath, 'managed 模式应引用托管路径');

    const customConfigPath = path.join(fakeHome, '.omx', 'agents', 'custom-one.toml');
    const customContent = 'model = "custom-model"\n';
    service.createAgent({
      fileName: 'custom-one',
      scope: 'user',
      description: 'Custom config mode',
      configMode: 'custom',
      configFile: customConfigPath,
      configContent: customContent
    });
    assert(fs.existsSync(customConfigPath), 'custom 模式应创建指定路径 TOML');
    assert.strictEqual(fs.readFileSync(customConfigPath, 'utf-8'), customContent, 'custom TOML 内容应保留');
    config = readCodexConfig();
    assert.strictEqual(config.agents['custom-one'].config_file, customConfigPath, 'custom 模式应引用自定义路径');

    const managedToCustomPath = path.join(fakeHome, '.omx', 'agents', 'managed-one-custom.toml');
    service.updateAgent({
      fileName: 'managed-one',
      scope: 'user',
      description: 'Managed -> custom',
      configMode: 'custom',
      configFile: managedToCustomPath,
      configContent: 'model = "moved-custom"\n'
    });
    assert(fs.existsSync(managedToCustomPath), 'managed->custom 应写入新文件');
    assert(!fs.existsSync(managedConfigPath), 'managed->custom 应清理旧托管文件');
    config = readCodexConfig();
    assert.strictEqual(config.agents['managed-one'].config_file, managedToCustomPath, 'managed->custom 后应写新路径');

    service.updateAgent({
      fileName: 'custom-one',
      scope: 'user',
      description: 'Custom -> none',
      configMode: 'none'
    });
    config = readCodexConfig();
    assert(!Object.prototype.hasOwnProperty.call(config.agents['custom-one'], 'config_file'), 'custom->none 后应移除 config_file');
    assert(fs.existsSync(customConfigPath), 'custom->none 不应删除外部自定义文件');

    service.createAgent({
      fileName: 'legacy-model',
      scope: 'user',
      description: 'Legacy mode fallback',
      model: 'legacy-model-v1'
    });
    config = readCodexConfig();
    const legacyConfigPath = config.agents['legacy-model'].config_file;
    assert(legacyConfigPath, '未提供 configMode 且给 model 时应走兼容托管路径');
    assert(fs.existsSync(legacyConfigPath), '兼容逻辑应生成托管配置');
    const legacyToml = toml.parse(fs.readFileSync(legacyConfigPath, 'utf-8'));
    assert.strictEqual(legacyToml.model, 'legacy-model-v1', '兼容逻辑应写入 model');

    const missingPath = path.join(fakeHome, '.omx', 'agents', 'missing.toml');
    service.createAgent({
      fileName: 'missing-reader',
      scope: 'user',
      description: 'Will become missing file',
      configMode: 'custom',
      configFile: missingPath,
      configContent: 'model = "missing-before-delete"\n'
    });
    fs.unlinkSync(missingPath);
    const afterMissing = service.listCodexAgents().agents.find((item) => item.fileName === 'missing-reader');
    assert(afterMissing, '应保留 missing-reader 条目');
    assert(afterMissing.configReadError.includes('配置文件不存在'), '缺失文件应暴露 configReadError');
    assert.strictEqual(afterMissing.fullContent, '', '缺失文件不应返回 TOML 内容');

    const linuxHome = path.join(tempRoot, 'linux-home');
    const linuxConfigDir = path.join(linuxHome, '.cc-tool', 'config');
    fs.mkdirSync(linuxHome, { recursive: true });
    const linuxSync = envTest.syncCodexUserEnvironment(
      { OPENAI_TEST_KEY: 'linux-secret' },
      {
        runtime: 'linux',
        homeDir: linuxHome,
        configDir: linuxConfigDir,
        shellEnv: { HOME: linuxHome, SHELL: '/bin/bash' }
      }
    );
    const linuxEnvFile = path.join(linuxConfigDir, 'codex-env.sh');
    const linuxProfile = path.join(linuxHome, '.bashrc');
    assert.strictEqual(fs.existsSync(linuxEnvFile), true, 'Linux 应生成托管 env 文件');
    assert.strictEqual(fs.readFileSync(linuxEnvFile, 'utf-8').includes('export OPENAI_TEST_KEY'), true, 'Linux env 文件应写入 export');
    assert.strictEqual(fs.readFileSync(linuxProfile, 'utf-8').includes('coding-tool codex env'), true, 'Linux shell 配置应注入 source 片段');
    assert.strictEqual(Boolean(linuxSync.sourceCommand), true, 'Linux 首次同步应返回 source 命令');
    envTest.syncCodexUserEnvironment({}, {
      runtime: 'linux',
      homeDir: linuxHome,
      configDir: linuxConfigDir,
      shellEnv: { HOME: linuxHome, SHELL: '/bin/bash' }
    });
    assert.strictEqual(fs.existsSync(linuxEnvFile), false, 'Linux 清理后应删除托管 env 文件');
    assert.strictEqual(fs.readFileSync(linuxProfile, 'utf-8').includes('coding-tool codex env'), false, 'Linux 清理后应移除 source 片段');

    const darwinHome = path.join(tempRoot, 'darwin-home');
    const darwinConfigDir = path.join(darwinHome, '.cc-tool', 'config');
    const darwinExecCalls = [];
    fs.mkdirSync(darwinHome, { recursive: true });
    envTest.syncCodexUserEnvironment(
      { OPENAI_MAC_KEY: 'mac-secret' },
      {
        runtime: 'darwin',
        homeDir: darwinHome,
        configDir: darwinConfigDir,
        shellEnv: { HOME: darwinHome, SHELL: '/bin/zsh' },
        execFileSync: (command, args) => {
          darwinExecCalls.push({ command, args });
          return '';
        }
      }
    );
    assert.strictEqual(
      darwinExecCalls.some(call => call.command === 'launchctl' && call.args[0] === 'setenv' && call.args[1] === 'OPENAI_MAC_KEY'),
      true,
      'macOS 应调用 launchctl setenv 同步用户环境变量'
    );

    const windowsHome = path.join(tempRoot, 'windows-home');
    const windowsConfigDir = path.join(windowsHome, '.cc-tool', 'config');
    const windowsExecCalls = [];
    fs.mkdirSync(windowsHome, { recursive: true });
    envTest.syncCodexUserEnvironment(
      { OPENAI_WIN_KEY: 'win-secret' },
      {
        runtime: 'win32',
        homeDir: windowsHome,
        configDir: windowsConfigDir,
        execFileSync: (command, args) => {
          windowsExecCalls.push({ command, args });
          return '';
        }
      }
    );
    envTest.syncCodexUserEnvironment({}, {
      runtime: 'win32',
      homeDir: windowsHome,
      configDir: windowsConfigDir,
      execFileSync: (command, args) => {
        windowsExecCalls.push({ command, args });
        return '';
      }
    });
    assert.strictEqual(
      windowsExecCalls.some(call => ['powershell', 'pwsh'].includes(call.command) && call.args[3].includes('OPENAI_WIN_KEY')),
      true,
      'Windows 应通过 PowerShell 写入用户级环境变量'
    );
    assert.strictEqual(
      windowsExecCalls.some(call => ['powershell', 'pwsh'].includes(call.command) && call.args[3].includes('$null')),
      true,
      'Windows 清理时应通过 PowerShell 删除用户级环境变量'
    );

    writeUtf8(path.join(codexDir, 'auth.json'), JSON.stringify({ OPENAI_API_KEY: 'legacy-auth' }, null, 2));
    const proxyResult = codexSettingsManager.setProxyConfig(20089);
    const managedEnvFile = path.join(fakeHome, '.cc-tool', 'config', 'codex-env.sh');
    assert.strictEqual(fs.existsSync(managedEnvFile), true, 'Codex proxy 模式应写入托管 env 文件');
    assert.strictEqual(fs.readFileSync(managedEnvFile, 'utf-8').includes('CC_PROXY_KEY'), true, 'Codex proxy 模式应写入 CC_PROXY_KEY');
    const authAfterProxy = JSON.parse(fs.readFileSync(path.join(codexDir, 'auth.json'), 'utf-8'));
    assert.strictEqual(Object.prototype.hasOwnProperty.call(authAfterProxy, 'CC_PROXY_KEY'), false, 'Codex proxy 不应再把 CC_PROXY_KEY 写入 auth.json');
    assert.strictEqual(Boolean(proxyResult.sourceCommand), true, 'Codex proxy 启动后应返回 source 命令');
    codexSettingsManager.restoreSettings();
    assert.strictEqual(fs.existsSync(managedEnvFile), false, '退出 Codex proxy 后应清理托管 env 文件');

    const channel = codexChannels.createChannel(
      'Managed OpenAI',
      'openai2',
      'https://example.com/v1',
      'channel-secret',
      'responses',
      { enabled: true }
    );
    assert.strictEqual(fs.readFileSync(managedEnvFile, 'utf-8').includes('OPENAI2_API_KEY'), true, '创建 Codex 渠道时应写入对应 env_key');
    let authAfterChannel = JSON.parse(fs.readFileSync(path.join(codexDir, 'auth.json'), 'utf-8'));
    assert.strictEqual(Object.prototype.hasOwnProperty.call(authAfterChannel, 'OPENAI2_API_KEY'), false, '普通 Codex 渠道不应再把 env_key 写入 auth.json');

    codexChannels.applyChannelToSettings(channel.id);
    const configAfterApply = readCodexConfig();
    assert.strictEqual(configAfterApply.model_provider, 'openai2', '应用 Codex 渠道后应切换 model_provider');

    codexChannels.updateChannel(channel.id, { apiKey: 'channel-secret-2' });
    assert.strictEqual(fs.readFileSync(managedEnvFile, 'utf-8').includes('channel-secret-2'), true, '更新 Codex 渠道后应同步最新 API Key');

    await codexChannels.deleteChannel(channel.id);
    assert.strictEqual(fs.existsSync(managedEnvFile), false, '删除最后一个 Codex 渠道后应清理托管 env 文件');

    console.log('Codex agents 测试通过（agents + env_key sync）');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error('Codex agents 测试失败:', error);
  process.exit(1);
});
