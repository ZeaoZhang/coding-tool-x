const chalk = require('chalk');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const LOGS_DIR = path.join(os.homedir(), '.claude/logs');

const LOG_FILES = {
  ui: 'cc-tool-out.log',
  claude: 'claude-proxy.log',
  codex: 'codex-proxy.log',
  gemini: 'gemini-proxy.log'
};

/**
 * 确保日志目录存在
 */
function ensureLogsDir() {
  if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
  }
}

/**
 * 查看日志
 */
async function handleLogs(type = null, options = {}) {
  ensureLogsDir();

  const lines = options.lines || 50;
  const follow = options.follow || false;
  const clear = options.clear || false;

  // 如果是清空日志
  if (clear) {
    return clearLogs(type);
  }

  // 如果没有指定类型，显示所有日志
  if (!type) {
    return showAllLogs(lines, follow);
  }

  // 显示特定类型的日志
  const logFile = LOG_FILES[type];
  if (!logFile) {
    console.error(chalk.red(`\n❌ 无效的日志类型: ${type}\n`));
    console.log(chalk.gray('支持的类型: ui, claude, codex, gemini\n'));
    process.exit(1);
  }

  const logPath = path.join(LOGS_DIR, logFile);

  // 检查日志文件是否存在
  if (!fs.existsSync(logPath)) {
    console.log(chalk.yellow(`\n⚠️  ${type} 日志文件不存在\n`));
    console.log(chalk.gray(`日志路径: ${logPath}\n`));
    return;
  }

  console.log(chalk.cyan(`\n📋 ${type.toUpperCase()} 日志 ${follow ? '(实时)' : `(最近 ${lines} 行)`}\n`));
  console.log(chalk.gray(`═`.repeat(60)) + '\n');

  if (follow) {
    // 实时跟踪日志
    tailFile(logPath);
  } else {
    // 显示最后 N 行
    showLastLines(logPath, lines);
  }
}

/**
 * 显示所有日志（合并）
 */
function showAllLogs(lines, follow) {
  console.log(chalk.cyan(`\n📋 所有日志 ${follow ? '(实时)' : `(最近 ${lines} 行)`}\n`));
  console.log(chalk.gray(`═`.repeat(60)) + '\n');

  const allLogs = [];

  // 读取所有日志文件
  Object.entries(LOG_FILES).forEach(([type, filename]) => {
    const logPath = path.join(LOGS_DIR, filename);
    if (fs.existsSync(logPath)) {
      try {
        const content = fs.readFileSync(logPath, 'utf8');
        const logLines = content.trim().split('\n').filter(line => line.trim());

        logLines.forEach(line => {
          allLogs.push({
            type,
            line,
            // 尝试从日志中提取时间戳
            timestamp: extractTimestamp(line) || Date.now()
          });
        });
      } catch (err) {
        // 忽略读取错误
      }
    }
  });

  // 按时间戳排序
  allLogs.sort((a, b) => a.timestamp - b.timestamp);

  // 只显示最后 N 行
  const recentLogs = allLogs.slice(-lines);

  recentLogs.forEach(log => {
    const typeColor = getTypeColor(log.type);
    const typeLabel = `[${log.type.toUpperCase()}]`.padEnd(10);
    console.log(typeColor(typeLabel) + chalk.gray(log.line));
  });

  console.log(chalk.gray(`\n═`.repeat(60)));
  console.log(chalk.gray(`\n💡 使用 `) + chalk.cyan(`ct logs ${Object.keys(LOG_FILES).join('|')}`) + chalk.gray(` 查看特定类型日志\n`));
}

/**
 * 显示文件最后 N 行
 */
function showLastLines(filePath, lines) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const allLines = content.trim().split('\n');
    const lastLines = allLines.slice(-lines);

    lastLines.forEach(line => {
      if (line.trim()) {
        console.log(line);
      }
    });

    console.log(chalk.gray(`\n═`.repeat(60)));
    console.log(chalk.gray(`\n💡 使用 `) + chalk.cyan(`ct logs <type> --follow`) + chalk.gray(` 实时跟踪日志\n`));
  } catch (err) {
    console.error(chalk.red(`读取日志失败: ${err.message}\n`));
    process.exit(1);
  }
}

/**
 * 实时跟踪日志文件
 */
function tailFile(filePath) {
  console.log(chalk.gray('按 Ctrl+C 停止跟踪\n'));

  const tail = spawn('tail', ['-f', filePath]);

  tail.stdout.on('data', (data) => {
    process.stdout.write(data.toString());
  });

  tail.stderr.on('data', (data) => {
    process.stderr.write(chalk.red(data.toString()));
  });

  tail.on('error', (err) => {
    console.error(chalk.red(`\n❌ 跟踪日志失败: ${err.message}\n`));
    process.exit(1);
  });

  // 处理退出信号
  process.on('SIGINT', () => {
    tail.kill();
    console.log(chalk.gray('\n\n已停止跟踪日志\n'));
    process.exit(0);
  });
}

/**
 * 清空日志
 */
function clearLogs(type) {
  if (!type) {
    // 清空所有日志
    console.log(chalk.cyan('\n🗑️  清空所有日志...\n'));

    let cleared = 0;
    Object.entries(LOG_FILES).forEach(([logType, filename]) => {
      const logPath = path.join(LOGS_DIR, filename);
      if (fs.existsSync(logPath)) {
        try {
          fs.writeFileSync(logPath, '');
          console.log(chalk.green(`✅ ${logType} 日志已清空`));
          cleared++;
        } catch (err) {
          console.log(chalk.red(`❌ ${logType} 日志清空失败: ${err.message}`));
        }
      }
    });

    console.log(chalk.green(`\n✅ 共清空 ${cleared} 个日志文件\n`));
  } else {
    // 清空特定类型日志
    const logFile = LOG_FILES[type];
    if (!logFile) {
      console.error(chalk.red(`\n❌ 无效的日志类型: ${type}\n`));
      process.exit(1);
    }

    const logPath = path.join(LOGS_DIR, logFile);
    if (fs.existsSync(logPath)) {
      try {
        fs.writeFileSync(logPath, '');
        console.log(chalk.green(`\n✅ ${type} 日志已清空\n`));
      } catch (err) {
        console.error(chalk.red(`\n❌ 清空失败: ${err.message}\n`));
        process.exit(1);
      }
    } else {
      console.log(chalk.yellow(`\n⚠️  ${type} 日志文件不存在\n`));
    }
  }
}

/**
 * 从日志行中提取时间戳
 */
function extractTimestamp(line) {
  // 尝试匹配常见的时间戳格式
  const patterns = [
    /^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})/,  // YYYY-MM-DD HH:MM:SS
    /^\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/,  // [YYYY-MM-DDTHH:MM:SS
    /^(\d{2}:\d{2}:\d{2})/  // HH:MM:SS
  ];

  for (const pattern of patterns) {
    const match = line.match(pattern);
    if (match) {
      try {
        return new Date(match[1]).getTime();
      } catch (err) {
        // 忽略解析错误
      }
    }
  }

  return null;
}

/**
 * 获取类型颜色
 */
function getTypeColor(type) {
  const colors = {
    ui: chalk.blue,
    claude: chalk.green,
    codex: chalk.cyan,
    gemini: chalk.magenta
  };
  return colors[type] || chalk.gray;
}

module.exports = {
  handleLogs
};
