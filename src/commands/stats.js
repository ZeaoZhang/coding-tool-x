const chalk = require('chalk');
const http = require('http');
const { loadConfig } = require('../config/loader');

/**
 * HTTP 请求辅助函数
 */
function httpRequest(method, path, data = null) {
  const config = loadConfig();
  const port = config.ports?.webUI || 10099;

  return new Promise((resolve, reject) => {
    const postData = data ? JSON.stringify(data) : null;
    const options = {
      hostname: 'localhost',
      port: port,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        ...(postData && { 'Content-Length': Buffer.byteLength(postData) })
      },
      timeout: 5000
    };

    const req = http.request(options, (res) => {
      let responseData = '';

      res.on('data', (chunk) => {
        responseData += chunk;
      });

      res.on('end', () => {
        try {
          const json = JSON.parse(responseData);
          resolve({ data: json, status: res.statusCode });
        } catch (err) {
          reject(new Error('Invalid JSON response'));
        }
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    if (postData) {
      req.write(postData);
    }

    req.end();
  });
}

/**
 * 检查 UI 服务是否运行
 */
async function checkUIService() {
  try {
    await httpRequest('GET', '/api/ping');
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * 查看统计信息
 */
async function handleStats(type = null, options = {}) {
  // 检查 UI 服务
  const uiRunning = await checkUIService();
  if (!uiRunning) {
    console.error(chalk.red('\n❌ UI 服务未运行\n'));
    console.log(chalk.yellow('💡 请先启动 UI 服务: ') + chalk.cyan('ctx start\n'));
    process.exit(1);
  }

  const timeRange = options.today ? 'today' : options.week ? 'week' : options.month ? 'month' : 'all';

  try {
    let endpoint = '/api/statistics';
    if (type) {
      // 特定渠道统计
      if (!['claude', 'codex', 'gemini'].includes(type)) {
        console.error(chalk.red(`\n❌ 无效的渠道类型: ${type}\n`));
        console.log(chalk.gray('支持的类型: claude, codex, gemini\n'));
        process.exit(1);
      }
      endpoint += `/${type}`;
    }

    endpoint += `?range=${timeRange}`;

    const response = await httpRequest('GET', endpoint);
    const stats = response.data;

    displayStats(stats, type, timeRange);
  } catch (error) {
    console.error(chalk.red(`\n❌ 获取统计失败: ${error.message}\n`));
    process.exit(1);
  }
}

/**
 * 显示统计信息
 */
function displayStats(stats, type, timeRange) {
  const title = type ? `${type.toUpperCase()} 统计信息` : '总体统计信息';
  const rangeText = {
    today: '今日',
    week: '本周',
    month: '本月',
    all: '全部'
  }[timeRange];

  console.log(chalk.bold.cyan(`\n╔══════════════════════════════════════╗`));
  console.log(chalk.bold.cyan(`║        ${title} (${rangeText})        ║`));
  console.log(chalk.bold.cyan(`╚══════════════════════════════════════╝\n`));

  if (!stats || !stats.summary) {
    console.log(chalk.gray('  暂无统计数据\n'));
    return;
  }

  const summary = stats.summary;

  // 请求统计
  console.log(chalk.bold('📊 请求统计:'));
  console.log(chalk.gray(`  总请求数: `) + chalk.cyan(summary.totalRequests || 0));
  console.log(chalk.gray(`  成功请求: `) + chalk.green(summary.successfulRequests || 0));
  console.log(chalk.gray(`  失败请求: `) + chalk.red(summary.failedRequests || 0));

  // Token 使用
  if (summary.totalTokens !== undefined) {
    console.log(chalk.bold('\n🎯 Token 使用:'));
    console.log(chalk.gray(`  输入 Tokens: `) + chalk.cyan(formatNumber(summary.inputTokens || 0)));
    console.log(chalk.gray(`  输出 Tokens: `) + chalk.cyan(formatNumber(summary.outputTokens || 0)));
    console.log(chalk.gray(`  缓存创建: `) + chalk.cyan(formatNumber(summary.cacheCreation || 0)));
    console.log(chalk.gray(`  缓存读取: `) + chalk.cyan(formatNumber(summary.cacheRead || 0)));
    console.log(chalk.gray(`  总计: `) + chalk.bold.cyan(formatNumber(summary.totalTokens || 0)));
  }

  // 成本统计
  if (summary.totalCost !== undefined) {
    console.log(chalk.bold('\n💰 成本统计:'));
    console.log(chalk.gray(`  总成本: `) + chalk.yellow(`$${(summary.totalCost || 0).toFixed(4)}`));
    if (summary.averageCost !== undefined) {
      console.log(chalk.gray(`  平均成本: `) + chalk.yellow(`$${(summary.averageCost || 0).toFixed(4)}`));
    }
  }

  // 按渠道统计（仅在总体统计时显示）
  if (!type && stats.byChannel) {
    console.log(chalk.bold('\n📡 按渠道统计:'));
    Object.entries(stats.byChannel).forEach(([channel, data]) => {
      const icon = channel === 'claude' ? '🟢' : channel === 'codex' ? '🔵' : '🟣';
      console.log(chalk.gray(`  ${icon} ${channel.toUpperCase()}:`));
      console.log(chalk.gray(`     请求: ${data.requests || 0}  |  Tokens: ${formatNumber(data.tokens || 0)}  |  成本: $${(data.cost || 0).toFixed(4)}`));
    });
  }

  // 最近活动
  if (stats.recentActivity && stats.recentActivity.length > 0) {
    console.log(chalk.bold('\n🕐 最近活动:'));
    stats.recentActivity.slice(0, 5).forEach(activity => {
      const time = new Date(activity.timestamp).toLocaleString('zh-CN');
      console.log(chalk.gray(`  ${time}  |  ${activity.channel}  |  ${formatNumber(activity.tokens)} tokens  |  $${activity.cost.toFixed(4)}`));
    });
  }

  console.log(chalk.gray('\n💡 提示:'));
  console.log(chalk.gray('  • 使用 ') + chalk.cyan('ctx stats --today') + chalk.gray(' 查看今日统计'));
  console.log(chalk.gray('  • 使用 ') + chalk.cyan('ctx stats claude') + chalk.gray(' 查看特定渠道'));
  console.log(chalk.gray('  • 使用 ') + chalk.cyan('ctx stats export') + chalk.gray(' 导出统计数据\n'));
}

/**
 * 格式化数字
 */
function formatNumber(num) {
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * 导出统计数据
 */
async function handleStatsExport(type = null, format = 'json') {
  console.log(chalk.cyan('\n📤 导出统计数据...\n'));

  const uiRunning = await checkUIService();
  if (!uiRunning) {
    console.error(chalk.red('❌ UI 服务未运行\n'));
    process.exit(1);
  }

  try {
    const endpoint = type ? `/api/statistics/${type}/export` : '/api/statistics/export';
    const response = await httpRequest('GET', `${endpoint}?format=${format}`);

    const fs = require('fs');
    const path = require('path');
    const filename = `cc-tool-stats-${type || 'all'}-${Date.now()}.${format}`;
    const filepath = path.join(process.cwd(), filename);

    fs.writeFileSync(filepath, JSON.stringify(response.data, null, 2));

    console.log(chalk.green(`✅ 统计数据已导出\n`));
    console.log(chalk.gray(`文件路径: ${filepath}\n`));
  } catch (error) {
    console.error(chalk.red(`\n❌ 导出失败: ${error.message}\n`));
    process.exit(1);
  }
}

module.exports = {
  handleStats,
  handleStatsExport
};
