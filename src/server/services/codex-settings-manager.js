const fs = require('fs');
const path = require('path');
const os = require('os');
const toml = require('toml');

// Codex 配置文件路径
function getConfigPath() {
  return path.join(os.homedir(), '.codex', 'config.toml');
}

function getAuthPath() {
  return path.join(os.homedir(), '.codex', 'auth.json');
}

// 备份文件路径
function getConfigBackupPath() {
  return path.join(os.homedir(), '.codex', 'config.toml.cc-tool-backup');
}

function getAuthBackupPath() {
  return path.join(os.homedir(), '.codex', 'auth.json.cc-tool-backup');
}

// 检查配置文件是否存在
function configExists() {
  return fs.existsSync(getConfigPath());
}

function authExists() {
  return fs.existsSync(getAuthPath());
}

// 检查是否已经有备份
function hasBackup() {
  return fs.existsSync(getConfigBackupPath()) || fs.existsSync(getAuthBackupPath());
}

// 读取 config.toml
function readConfig() {
  try {
    const content = fs.readFileSync(getConfigPath(), 'utf8');
    return toml.parse(content);
  } catch (err) {
    throw new Error('Failed to read config.toml: ' + err.message);
  }
}

// 将配置对象转换为 TOML 字符串
function configToToml(config) {
  let content = `# Codex Configuration
# Managed by Coding-Tool (Proxy Mode)

`;

  // 写入顶级字段
  for (const [key, value] of Object.entries(config)) {
    if (key === 'model_providers') continue; // 稍后处理
    if (typeof value === 'string') {
      content += `${key} = "${value}"\n`;
    } else if (typeof value === 'boolean') {
      content += `${key} = ${value}\n`;
    } else if (typeof value === 'number') {
      content += `${key} = ${value}\n`;
    }
  }

  content += '\n';

  // 写入 model_providers
  if (config.model_providers) {
    for (const [providerKey, providerConfig] of Object.entries(config.model_providers)) {
      content += `[model_providers.${providerKey}]\n`;
      for (const [key, value] of Object.entries(providerConfig)) {
        if (typeof value === 'string') {
          content += `${key} = "${value}"\n`;
        } else if (typeof value === 'boolean') {
          content += `${key} = ${value}\n`;
        } else if (typeof value === 'number') {
          content += `${key} = ${value}\n`;
        }
      }
      content += '\n';
    }
  }

  return content;
}

// 写入 config.toml
function writeConfig(config) {
  try {
    const content = configToToml(config);
    fs.writeFileSync(getConfigPath(), content, 'utf8');
  } catch (err) {
    throw new Error('Failed to write config.toml: ' + err.message);
  }
}

// 读取 auth.json
function readAuth() {
  try {
    if (!authExists()) {
      return {};
    }
    const content = fs.readFileSync(getAuthPath(), 'utf8');
    return JSON.parse(content);
  } catch (err) {
    throw new Error('Failed to read auth.json: ' + err.message);
  }
}

// 写入 auth.json
function writeAuth(auth) {
  try {
    const content = JSON.stringify(auth, null, 2);
    fs.writeFileSync(getAuthPath(), content, 'utf8');
  } catch (err) {
    throw new Error('Failed to write auth.json: ' + err.message);
  }
}

// 备份当前配置
function backupSettings() {
  try {
    if (!configExists()) {
      throw new Error('config.toml not found');
    }

    // 如果已经有备份，不覆盖
    if (hasBackup()) {
      console.log('Backup already exists, skipping backup');
      return { success: true, alreadyExists: true };
    }

    // 备份 config.toml
    const configContent = fs.readFileSync(getConfigPath(), 'utf8');
    fs.writeFileSync(getConfigBackupPath(), configContent, 'utf8');

    // 备份 auth.json (如果存在)
    if (authExists()) {
      const authContent = fs.readFileSync(getAuthPath(), 'utf8');
      fs.writeFileSync(getAuthBackupPath(), authContent, 'utf8');
    }

    console.log('Codex settings backed up');
    return { success: true, alreadyExists: false };
  } catch (err) {
    throw new Error('Failed to backup settings: ' + err.message);
  }
}

// 恢复配置
function restoreSettings() {
  try {
    if (!hasBackup()) {
      throw new Error('No backup found');
    }

    // 恢复 config.toml
    if (fs.existsSync(getConfigBackupPath())) {
      const content = fs.readFileSync(getConfigBackupPath(), 'utf8');
      fs.writeFileSync(getConfigPath(), content, 'utf8');
      fs.unlinkSync(getConfigBackupPath());
    }

    // 恢复 auth.json
    if (fs.existsSync(getAuthBackupPath())) {
      const content = fs.readFileSync(getAuthBackupPath(), 'utf8');
      fs.writeFileSync(getAuthPath(), content, 'utf8');
      fs.unlinkSync(getAuthBackupPath());
    }

    // 清理 shell 配置文件中的环境变量（可选，不影响恢复结果）
    removeEnvFromShell('CC_PROXY_KEY');

    console.log('Codex settings restored from backup');
    return { success: true };
  } catch (err) {
    throw new Error('Failed to restore settings: ' + err.message);
  }
}

// 获取用户的 shell 配置文件路径
function getShellConfigPath() {
  const shell = process.env.SHELL || '';
  if (shell.includes('zsh')) {
    return path.join(os.homedir(), '.zshrc');
  } else if (shell.includes('bash')) {
    // macOS 使用 .bash_profile，Linux 使用 .bashrc
    const bashProfile = path.join(os.homedir(), '.bash_profile');
    const bashrc = path.join(os.homedir(), '.bashrc');
    if (fs.existsSync(bashProfile)) {
      return bashProfile;
    }
    return bashrc;
  }
  // 默认使用 .zshrc (macOS 默认)
  return path.join(os.homedir(), '.zshrc');
}

// 注入环境变量到 shell 配置文件
function injectEnvToShell(envName, envValue) {
  const configPath = getShellConfigPath();
  const exportLine = `export ${envName}="${envValue}"`;
  // 使用更具体的标记，包含环境变量名，方便后续精确移除
  const marker = `# Added by Coding-Tool for Codex [${envName}]`;

  try {
    let content = '';
    if (fs.existsSync(configPath)) {
      content = fs.readFileSync(configPath, 'utf8');
    }

    // 检查是否已经存在这个环境变量配置
    const regex = new RegExp(`^export ${envName}=`, 'm');
    const alreadyExists = regex.test(content);

    if (alreadyExists) {
      // 已存在，替换它（保留原有的标记注释）
      content = content.replace(
        new RegExp(`^(# Added by Coding-Tool for Codex \\[${envName}\\]\n)?export ${envName}=.*$`, 'm'),
        `${marker}\n${exportLine}`
      );
    } else {
      // 不存在，追加到文件末尾
      content = content.trimEnd() + `\n\n${marker}\n${exportLine}\n`;
    }

    fs.writeFileSync(configPath, content, 'utf8');
    return { success: true, path: configPath, isFirstTime: !alreadyExists };
  } catch (err) {
    // 不抛出错误，只是警告，因为这不是致命问题
    console.warn(`[Codex] Failed to inject env to shell config: ${err.message}`);
    return { success: false, error: err.message, isFirstTime: false };
  }
}

// 从 shell 配置文件移除环境变量
function removeEnvFromShell(envName) {
  const configPath = getShellConfigPath();

  try {
    if (!fs.existsSync(configPath)) {
      return { success: true };
    }

    let content = fs.readFileSync(configPath, 'utf8');

    // 移除具体标记的环境变量（推荐方式）
    content = content.replace(
      new RegExp(`\\n?# Added by Coding-Tool for Codex \\[${envName}\\]\\nexport ${envName}=.*\\n?`, 'g'),
      '\n'
    );

    // 如果没有标记，也尝试移除（兼容旧数据）
    content = content.replace(
      new RegExp(`^export ${envName}=.*\\n?`, 'gm'),
      ''
    );

    // 清理多余的空行
    content = content.replace(/\n\n\n+/g, '\n\n');

    fs.writeFileSync(configPath, content, 'utf8');
    return { success: true };
  } catch (err) {
    console.warn(`[Codex] Failed to remove env from shell config: ${err.message}`);
    return { success: false, error: err.message };
  }
}

// 设置代理配置
function setProxyConfig(proxyPort) {
  try {
    // 先备份
    backupSettings();

    // 读取当前配置
    const config = readConfig();

    // 设置 model_provider 为 proxy
    config.model_provider = 'cc-proxy';

    // 确保 model_providers 对象存在
    if (!config.model_providers) {
      config.model_providers = {};
    }

    // 添加代理 provider
    config.model_providers['cc-proxy'] = {
      name: 'cc-proxy',
      base_url: `http://127.0.0.1:${proxyPort}/v1`,
      wire_api: 'responses',
      env_key: 'CC_PROXY_KEY'
    };

    // 写入配置
    writeConfig(config);

    // 写入 auth.json
    const auth = readAuth();
    auth.CC_PROXY_KEY = 'PROXY_KEY';
    writeAuth(auth);

    // 注入环境变量到 shell 配置文件（解决某些系统环境变量优先级问题）
    const shellInjectResult = injectEnvToShell('CC_PROXY_KEY', 'PROXY_KEY');

    // 获取 shell 配置文件路径用于提示信息
    const shellConfigPath = getShellConfigPath();
    const sourceCommand = process.env.SHELL?.includes('zsh') ? 'source ~/.zshrc' : 'source ~/.bashrc';

    console.log(`Codex settings updated to use proxy on port ${proxyPort}`);
    return {
      success: true,
      port: proxyPort,
      envInjected: shellInjectResult.success,
      isFirstTime: shellInjectResult.isFirstTime,
      shellConfigPath: shellConfigPath,
      sourceCommand: sourceCommand
    };
  } catch (err) {
    throw new Error('Failed to set proxy config: ' + err.message);
  }
}

// 检查当前是否是代理配置
function isProxyConfig() {
  try {
    if (!configExists()) {
      return false;
    }

    const config = readConfig();

    // 检查是否使用 cc-proxy provider
    if (config.model_provider === 'cc-proxy') {
      return true;
    }

    // 检查当前 provider 的 base_url 是否指向本地代理
    const currentProvider = config.model_provider;
    if (currentProvider && config.model_providers && config.model_providers[currentProvider]) {
      const baseUrl = config.model_providers[currentProvider].base_url || '';
      if (baseUrl.includes('127.0.0.1') && baseUrl.includes('10089')) {
        return true;
      }
    }

    return false;
  } catch (err) {
    return false;
  }
}

// 获取当前代理端口（如果是代理配置）
function getCurrentProxyPort() {
  try {
    if (!isProxyConfig()) {
      return null;
    }

    const config = readConfig();
    const proxyProvider = config.model_providers?.['cc-proxy'];
    if (proxyProvider) {
      const baseUrl = proxyProvider.base_url || '';
      const match = baseUrl.match(/:(\d+)/);
      return match ? parseInt(match[1]) : null;
    }

    return null;
  } catch (err) {
    return null;
  }
}

module.exports = {
  getConfigPath,
  getAuthPath,
  getConfigBackupPath,
  getAuthBackupPath,
  configExists,
  authExists,
  hasBackup,
  readConfig,
  writeConfig,
  readAuth,
  writeAuth,
  backupSettings,
  restoreSettings,
  setProxyConfig,
  isProxyConfig,
  getCurrentProxyPort,
  // 导出环境变量注入函数供其他模块使用
  getShellConfigPath,
  injectEnvToShell,
  removeEnvFromShell
};
