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
    const service = new AgentsService('codex');

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

    console.log('Codex agents 测试通过（none/managed/custom + external config_file）');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error('Codex agents 测试失败:', error);
  process.exit(1);
});
