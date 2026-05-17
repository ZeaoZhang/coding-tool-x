const chalk = require('chalk');
const http = require('http');
const { loadConfig } = require('../config/loader');

const TOOL_TYPES = ['claude', 'codex', 'gemini', 'opencode'];
const TOOL_ENDPOINTS = {
  claude: '/api/claude/statistics',
  codex: '/api/codex/statistics',
  gemini: '/api/gemini/statistics',
  opencode: '/api/opencode/statistics'
};

/**
 * HTTP 请求辅助函数
 */
function httpRequest(method, path, data = null) {
  const config = loadConfig();
  const port = config.ports?.webUI || 19999;

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
    await httpRequest('GET', '/api/proxy/status');
    return true;
  } catch (err) {
    return false;
  }
}

function validateToolType(type) {
  if (!type) return true;
  return TOOL_TYPES.includes(type);
}

function getDateString(offsetDays = 0) {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - offsetDays);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function emptySummary() {
  return {
    requests: 0,
    tokens: 0,
    cost: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheCreation: 0,
    cacheRead: 0,
    reasoningTokens: 0,
    cachedTokens: 0
  };
}

function normalizeNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function extractSummary(stats) {
  const summary = emptySummary();
  const sourceSummary = stats?.summary || {};
  const sourceGlobal = stats?.global || {};

  summary.requests = normalizeNumber(
    sourceSummary.totalRequests !== undefined ? sourceSummary.totalRequests : sourceSummary.requests
  ) || normalizeNumber(sourceGlobal.totalRequests);

  summary.tokens = normalizeNumber(
    sourceSummary.totalTokens !== undefined ? sourceSummary.totalTokens : sourceSummary.tokens
  ) || normalizeNumber(sourceGlobal.totalTokens);

  summary.cost = normalizeNumber(
    sourceSummary.totalCost !== undefined ? sourceSummary.totalCost : sourceSummary.cost
  ) || normalizeNumber(sourceGlobal.totalCost);

  summary.inputTokens = normalizeNumber(sourceSummary.inputTokens ?? sourceSummary.input);
  summary.outputTokens = normalizeNumber(sourceSummary.outputTokens ?? sourceSummary.output);
  summary.cacheCreation = normalizeNumber(sourceSummary.cacheCreation ?? sourceSummary.cache_creation);
  summary.cacheRead = normalizeNumber(sourceSummary.cacheRead ?? sourceSummary.cache_read);
  summary.reasoningTokens = normalizeNumber(sourceSummary.reasoningTokens ?? sourceSummary.reasoning);
  summary.cachedTokens = normalizeNumber(sourceSummary.cachedTokens ?? sourceSummary.cached);

  const detailedTotal =
    summary.inputTokens +
    summary.outputTokens +
    summary.cacheCreation +
    summary.cacheRead +
    summary.reasoningTokens +
    summary.cachedTokens;

  if (!summary.tokens && detailedTotal > 0) {
    summary.tokens = detailedTotal;
  }

  return summary;
}

function mergeSummaries(target, source) {
  target.requests += normalizeNumber(source.requests);
  target.tokens += normalizeNumber(source.tokens);
  target.cost += normalizeNumber(source.cost);
  target.inputTokens += normalizeNumber(source.inputTokens);
  target.outputTokens += normalizeNumber(source.outputTokens);
  target.cacheCreation += normalizeNumber(source.cacheCreation);
  target.cacheRead += normalizeNumber(source.cacheRead);
  target.reasoningTokens += normalizeNumber(source.reasoningTokens);
  target.cachedTokens += normalizeNumber(source.cachedTokens);
  return target;
}

function getRangeDays(timeRange) {
  if (timeRange === 'week') return 7;
  if (timeRange === 'month') return 30;
  return 0;
}

async function fetchToolStats(toolType, timeRange) {
  const endpointBase = TOOL_ENDPOINTS[toolType];
  if (!endpointBase) {
    throw new Error(`不支持的渠道类型: ${toolType}`);
  }

  if (timeRange === 'today') {
    const response = await httpRequest('GET', `${endpointBase}/today`);
    return extractSummary(response.data);
  }

  if (timeRange === 'all') {
    const response = await httpRequest('GET', `${endpointBase}/summary`);
    return extractSummary(response.data);
  }

  const days = getRangeDays(timeRange);
  const merged = emptySummary();
  for (let i = 0; i < days; i++) {
    const date = getDateString(i);
    const response = await httpRequest('GET', `${endpointBase}/daily/${date}`);
    const dailySummary = extractSummary(response.data);
    mergeSummaries(merged, dailySummary);
  }
  return merged;
}

async function fetchOverallStats(timeRange) {
  const byToolType = {};
  const summary = emptySummary();

  for (const toolType of TOOL_TYPES) {
    const toolSummary = await fetchToolStats(toolType, timeRange);
    byToolType[toolType] = toolSummary;
    mergeSummaries(summary, toolSummary);
  }

  return { summary, byToolType };
}

function buildDisplayPayload(type, timeRange, data) {
  if (type) {
    return {
      type,
      timeRange,
      summary: data,
      byToolType: null
    };
  }

  return {
    type: null,
    timeRange,
    summary: data.summary,
    byToolType: data.byToolType
  };
}

/**
 * 查看统计信息
 */
async function handleStats(type = null, options = {}) {
  // 检查 UI 服务
  const uiRunning = await checkUIService();
  if (!uiRunning) {
    console.error(chalk.red('\n[ERROR] UI 服务未运行\n'));
    console.log(chalk.yellow('[TIP] 请先启动 UI 服务: ') + chalk.cyan('ctx start\n'));
    process.exit(1);
  }

  const timeRange = options.today ? 'today' : options.week ? 'week' : options.month ? 'month' : 'all';

  try {
    if (!validateToolType(type)) {
      console.error(chalk.red(`\n[ERROR] 无效的渠道类型: ${type}\n`));
      console.log(chalk.gray('支持的类型: claude, codex, gemini, opencode\n'));
      process.exit(1);
    }

    let payload;
    if (type) {
      const summary = await fetchToolStats(type, timeRange);
      payload = buildDisplayPayload(type, timeRange, summary);
    } else {
      const overall = await fetchOverallStats(timeRange);
      payload = buildDisplayPayload(null, timeRange, overall);
    }

    displayStats(payload);
  } catch (error) {
    console.error(chalk.red(`\n[ERROR] 获取统计失败: ${error.message}\n`));
    process.exit(1);
  }
}

/**
 * 显示统计信息
 */
function displayStats(stats) {
  const type = stats.type;
  const timeRange = stats.timeRange;
  const title = type ? `${type.toUpperCase()} 统计信息` : '总体统计信息';
  const rangeText = {
    today: '今日',
    week: '本周',
    month: '本月',
    all: '全部'
  }[timeRange];

  console.log(chalk.bold.cyan(`\n╔======================================╗`));
  console.log(chalk.bold.cyan(`║        ${title} (${rangeText})        ║`));
  console.log(chalk.bold.cyan(`╚======================================╝\n`));

  if (!stats || !stats.summary) {
    console.log(chalk.gray('  暂无统计数据\n'));
    return;
  }

  const summary = stats.summary;

  // 请求统计
  console.log(chalk.bold('[STATS] 请求统计:'));
  console.log(chalk.gray('  总请求数: ') + chalk.cyan(formatNumber(summary.requests)));

  // Token 使用
  if (summary.tokens !== undefined) {
    console.log(chalk.bold('\n[TARGET] Token 使用:'));
    console.log(chalk.gray('  输入 Tokens: ') + chalk.cyan(formatNumber(summary.inputTokens || 0)));
    console.log(chalk.gray('  输出 Tokens: ') + chalk.cyan(formatNumber(summary.outputTokens || 0)));
    console.log(chalk.gray('  缓存创建: ') + chalk.cyan(formatNumber(summary.cacheCreation || 0)));
    console.log(chalk.gray('  缓存读取: ') + chalk.cyan(formatNumber(summary.cacheRead || 0)));
    console.log(chalk.gray('  推理 Tokens: ') + chalk.cyan(formatNumber(summary.reasoningTokens || 0)));
    console.log(chalk.gray('  缓存 Tokens: ') + chalk.cyan(formatNumber(summary.cachedTokens || 0)));
    console.log(chalk.gray('  总计: ') + chalk.bold.cyan(formatNumber(summary.tokens || 0)));
  }

  // 成本统计
  if (summary.cost !== undefined) {
    console.log(chalk.bold('\n[COST] 成本统计:'));
    console.log(chalk.gray('  总成本: ') + chalk.yellow(`$${normalizeNumber(summary.cost).toFixed(4)}`));
  }

  if (!type && stats.byToolType) {
    const iconMap = { claude: '[*]', codex: '[*]', gemini: '[*]', opencode: '[*]' };
    console.log(chalk.bold('\n[CH] 分渠道汇总:'));
    TOOL_TYPES.forEach((toolType) => {
      const item = stats.byToolType[toolType] || emptySummary();
      console.log(chalk.gray(`  ${iconMap[toolType]} ${toolType.toUpperCase()}:`));
      console.log(
        chalk.gray(
          `     请求: ${formatNumber(item.requests)}  |  Tokens: ${formatNumber(item.tokens)}  |  成本: $${normalizeNumber(item.cost).toFixed(4)}`
        )
      );
    });
  }

  console.log(chalk.gray('\n[TIP] 提示:'));
  console.log(chalk.gray('  • 使用 ') + chalk.cyan('ctx stats --today') + chalk.gray(' 查看今日统计'));
  console.log(chalk.gray('  • 使用 ') + chalk.cyan('ctx stats claude') + chalk.gray(' 查看特定渠道'));
  console.log(chalk.gray('  • 使用 ') + chalk.cyan('ctx stats opencode') + chalk.gray(' 查看 OpenCode 统计'));
  console.log(chalk.gray('  • 使用 ') + chalk.cyan('ctx stats export') + chalk.gray(' 导出统计数据\n'));
}

/**
 * 格式化数字
 */
function formatNumber(num) {
  const normalized = normalizeNumber(num);
  return normalized.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * 导出统计数据
 */
async function handleStatsExport(type = null, format = 'json') {
  console.log(chalk.cyan('\n[EXPORT] 导出统计数据...\n'));

  const uiRunning = await checkUIService();
  if (!uiRunning) {
    console.error(chalk.red('[ERROR] UI 服务未运行\n'));
    process.exit(1);
  }

  try {
    if (!validateToolType(type)) {
      console.error(chalk.red(`\n[ERROR] 无效的渠道类型: ${type}\n`));
      console.log(chalk.gray('支持的类型: claude, codex, gemini, opencode\n'));
      process.exit(1);
    }

    const exportFormat = format || 'json';
    if (exportFormat !== 'json') {
      console.log(chalk.yellow(`[WARN] 暂不支持 ${exportFormat} 格式，已回退为 json`));
    }

    let payload;
    if (type) {
      const summary = await fetchToolStats(type, 'all');
      payload = buildDisplayPayload(type, 'all', summary);
    } else {
      const overall = await fetchOverallStats('all');
      payload = buildDisplayPayload(null, 'all', overall);
    }

    const fs = require('fs');
    const path = require('path');
    const filename = `cc-tool-stats-${type || 'all'}-${Date.now()}.json`;
    const filepath = path.join(process.cwd(), filename);

    fs.writeFileSync(filepath, JSON.stringify(payload, null, 2));

    console.log(chalk.green(`[OK] 统计数据已导出\n`));
    console.log(chalk.gray(`文件路径: ${filepath}\n`));
  } catch (error) {
    console.error(chalk.red(`\n[ERROR] 导出失败: ${error.message}\n`));
    process.exit(1);
  }
}

module.exports = {
  handleStats,
  handleStatsExport
};
