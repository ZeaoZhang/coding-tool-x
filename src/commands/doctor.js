const chalk = require('chalk');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const { promisify } = require('util');
const { loadConfig } = require('../config/loader');
const { isPortInUse } = require('../utils/port-helper');

const execAsync = promisify(exec);

/**
 * 诊断系统
 */
async function handleDoctor() {
  console.log(chalk.bold.cyan('\n╔══════════════════════════════════════╗'));
  console.log(chalk.bold.cyan('║        Coding-Tool 系统诊断         ║'));
  console.log(chalk.bold.cyan('╚══════════════════════════════════════╝\n'));

  const checks = [];

  // 1. 检查 Node.js 版本
  checks.push(await checkNodeVersion());

  // 2. 检查配置文件
  checks.push(await checkConfigFiles());

  // 3. 检查端口
  checks.push(await checkPorts());

  // 4. 检查 Claude Code 配置
  checks.push(await checkClaudeConfig());

  // 5. 检查日志目录
  checks.push(await checkLogsDirectory());

  // 6. 检查进程状态
  checks.push(await checkProcessStatus());

  // 7. 检查磁盘空间
  checks.push(await checkDiskSpace());

  // 显示结果
  console.log(chalk.bold('\n📋 诊断结果:\n'));

  let passedCount = 0;
  let warningCount = 0;
  let failedCount = 0;

  checks.forEach(check => {
    const icon = check.status === 'pass' ? chalk.green('✅') :
                 check.status === 'warning' ? chalk.yellow('⚠️') :
                 chalk.red('❌');

    console.log(`${icon} ${check.name}`);
    if (check.message) {
      console.log(chalk.gray(`   ${check.message}`));
    }
    if (check.suggestion) {
      console.log(chalk.cyan(`   💡 ${check.suggestion}`));
    }
    console.log('');

    if (check.status === 'pass') passedCount++;
    else if (check.status === 'warning') warningCount++;
    else failedCount++;
  });

  // 总结
  console.log(chalk.bold('📊 总结:'));
  console.log(chalk.green(`  ✅ 通过: ${passedCount}`));
  if (warningCount > 0) {
    console.log(chalk.yellow(`  ⚠️  警告: ${warningCount}`));
  }
  if (failedCount > 0) {
    console.log(chalk.red(`  ❌ 失败: ${failedCount}`));
  }

  console.log('');

  if (failedCount > 0) {
    console.log(chalk.red('⚠️  发现问题，请根据上述建议进行修复\n'));
  } else if (warningCount > 0) {
    console.log(chalk.yellow('⚠️  发现一些警告，建议查看并处理\n'));
  } else {
    console.log(chalk.green('✅ 系统运行正常！\n'));
  }
}

/**
 * 检查 Node.js 版本
 */
async function checkNodeVersion() {
  const version = process.version;
  const major = parseInt(version.slice(1).split('.')[0]);

  if (major >= 14) {
    return {
      name: 'Node.js 版本',
      status: 'pass',
      message: `当前版本: ${version}`
    };
  } else {
    return {
      name: 'Node.js 版本',
      status: 'fail',
      message: `当前版本: ${version}`,
      suggestion: '需要 Node.js 14.0.0 或更高版本'
    };
  }
}

/**
 * 检查配置文件
 */
async function checkConfigFiles() {
  const configPath = path.join(os.homedir(), '.claude/config.json');
  const exists = fs.existsSync(configPath);

  if (exists) {
    try {
      const config = loadConfig();
      return {
        name: '配置文件',
        status: 'pass',
        message: `配置文件正常 (${configPath})`
      };
    } catch (err) {
      return {
        name: '配置文件',
        status: 'fail',
        message: '配置文件存在但解析失败',
        suggestion: '使用 ctx config reset 重置配置'
      };
    }
  } else {
    return {
      name: '配置文件',
      status: 'warning',
      message: '配置文件不存在，将使用默认配置',
      suggestion: '首次运行时会自动创建'
    };
  }
}

/**
 * 检查端口占用
 */
async function checkPorts() {
  const config = loadConfig();
  const ports = {
    'Web UI': config.ports?.webUI || 10099,
    'Claude Proxy': config.ports?.proxy || 10088,
    'Codex Proxy': config.ports?.codexProxy || 10089,
    'Gemini Proxy': config.ports?.geminiProxy || 10090
  };

  const conflicts = [];

  for (const [name, port] of Object.entries(ports)) {
    const inUse = await isPortInUse(port);
    if (inUse) {
      conflicts.push(`${name} (${port})`);
    }
  }

  if (conflicts.length === 0) {
    return {
      name: '端口检查',
      status: 'pass',
      message: '所有端口可用'
    };
  } else {
    return {
      name: '端口检查',
      status: 'warning',
      message: `以下端口被占用: ${conflicts.join(', ')}`,
      suggestion: '如果服务正在运行这是正常的；否则使用 ctx config port 修改端口'
    };
  }
}

/**
 * 检查 Claude Code 配置
 */
async function checkClaudeConfig() {
  const settingsPath = path.join(os.homedir(), '.claude/settings.json');
  const exists = fs.existsSync(settingsPath);

  if (exists) {
    return {
      name: 'Claude Code 配置',
      status: 'pass',
      message: 'Claude Code 配置文件存在'
    };
  } else {
    return {
      name: 'Claude Code 配置',
      status: 'warning',
      message: 'Claude Code 配置文件不存在',
      suggestion: '请至少运行一次 Claude Code 以生成配置文件'
    };
  }
}

/**
 * 检查日志目录
 */
async function checkLogsDirectory() {
  const logsDir = path.join(os.homedir(), '.cc-tool', 'logs');
  const exists = fs.existsSync(logsDir);

  if (exists) {
    // 检查日志文件大小
    const files = fs.readdirSync(logsDir);
    let totalSize = 0;

    files.forEach(file => {
      try {
        const stats = fs.statSync(path.join(logsDir, file));
        totalSize += stats.size;
      } catch (err) {
        // 忽略错误
      }
    });

    const sizeMB = (totalSize / 1024 / 1024).toFixed(2);

    if (totalSize > 100 * 1024 * 1024) {  // 超过 100MB
      return {
        name: '日志目录',
        status: 'warning',
        message: `日志文件过大 (${sizeMB} MB)`,
        suggestion: '使用 ctx logs --clear 清理日志'
      };
    } else {
      return {
        name: '日志目录',
        status: 'pass',
        message: `日志目录正常 (${sizeMB} MB)`
      };
    }
  } else {
    return {
      name: '日志目录',
      status: 'warning',
      message: '日志目录不存在',
      suggestion: '首次运行时会自动创建'
    };
  }
}

/**
 * 检查进程状态
 */
async function checkProcessStatus() {
  try {
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);

    // 检查是否有 PM2 进程
    try {
      const { stdout } = await execAsync('pm2 list');
      if (stdout.includes('cc-tool')) {
        return {
          name: '进程状态',
          status: 'pass',
          message: 'Coding-Tool 进程运行中'
        };
      }
    } catch (err) {
      // PM2 未安装或没有进程
    }

    return {
      name: '进程状态',
      status: 'warning',
      message: 'Coding-Tool 服务未运行',
      suggestion: '使用 ctx start 启动服务'
    };
  } catch (err) {
    return {
      name: '进程状态',
      status: 'warning',
      message: '无法检查进程状态',
      suggestion: '请手动检查'
    };
  }
}

/**
 * 检查磁盘空间
 */
async function checkDiskSpace() {
  try {
    const { stdout } = await execAsync('df -h ~');
    const lines = stdout.trim().split('\n');
    if (lines.length > 1) {
      const parts = lines[1].split(/\s+/);
      const usage = parts[4];
      const usagePercent = parseInt(usage);

      if (usagePercent > 90) {
        return {
          name: '磁盘空间',
          status: 'warning',
          message: `磁盘使用率: ${usage}`,
          suggestion: '磁盘空间不足，建议清理'
        };
      } else {
        return {
          name: '磁盘空间',
          status: 'pass',
          message: `磁盘使用率: ${usage}`
        };
      }
    }
  } catch (err) {
    // Windows 或其他系统可能没有 df 命令
  }

  return {
    name: '磁盘空间',
    status: 'pass',
    message: '磁盘空间检查跳过'
  };
}

module.exports = {
  handleDoctor
};
