const http = require('http');
const https = require('https');
const express = require('express');
const path = require('path');
const chalk = require('chalk');
const { loadConfig } = require('../config/loader');
const { PATHS, ensureStorageDirMigrated } = require('../config/paths');
const { startWebSocketServer: attachWebSocketServer } = require('./websocket-server');
const {
  isPortInUse,
  killProcessByPort,
  waitForPortRelease,
  getPortToolIssue,
  formatPortToolIssue
} = require('../utils/port-helper');
const {
  createRemoteMutationGuard,
  isRemoteMutationAllowedByEnv,
  createSameOriginGuard
} = require('./services/network-access');
const { createApiRequestLogger } = require('./services/request-logger');
const { inspectWebBuildState, ensureWebDistReady } = require('./services/web-build');
const { ensureHttpsCredentials } = require('./services/https-cert');

function getInquirer() {
  return require('inquirer');
}

function isInteractivePortConflictMode(options = {}) {
  if (options.interactive === false) {
    return false;
  }
  if (process.argv.includes('--daemon')) {
    return false;
  }
  return Boolean(process.stdin && process.stdin.isTTY && process.stdout && process.stdout.isTTY);
}

function printPortConflictHelp(port) {
  console.log(chalk.yellow('\n[TIP] 解决方案:'));
  console.log(chalk.gray('   1. 运行 ctx 命令，选择"配置端口"修改端口'));
  console.log(chalk.gray(`   2. 或手动关闭占用端口 ${port} 的程序\n`));
}

function printPortToolIssue(issue = getPortToolIssue()) {
  const lines = formatPortToolIssue(issue);
  if (lines.length === 0) {
    return;
  }

  console.error(chalk.yellow(`\n[TIP] ${lines[0]}`));
  lines.slice(1).forEach((line) => {
    console.error(chalk.gray(`   ${line}`));
  });
}

async function startServer(port, host = '127.0.0.1', options = {}) {
  ensureStorageDirMigrated();
  const config = loadConfig();
  // 使用配置的端口，如果没有传入参数
  if (!port) {
    port = config.ports?.webUI || 19999;
  }

  // 检查端口是否被占用
  const portInUse = await isPortInUse(port, host);
  if (portInUse) {
    console.log(chalk.yellow(`\n[WARN]  端口 ${port} 已被占用\n`));

    const interactiveMode = isInteractivePortConflictMode(options);
    let shouldKill = false;

    if (options.forceKillPort === true) {
      shouldKill = true;
    } else if (interactiveMode) {
      // 询问用户是否关闭占用端口的进程
      const inquirer = getInquirer();
      const answer = await inquirer.prompt([
        {
          type: 'list',
          name: 'shouldKill',
          message: '是否关闭占用该端口的进程并启动服务？',
          choices: [
            { name: '是，关闭进程并启动', value: true },
            { name: '否，取消启动', value: false }
          ],
          default: 0 // 默认选择"是"
        }
      ]);
      shouldKill = answer.shouldKill;
    } else {
      console.error(chalk.red('[ERROR] 当前为非交互模式，无法确认端口清理操作，已取消启动。'));
      printPortConflictHelp(port);
      process.exit(1);
    }

    if (!shouldKill) {
      console.log(chalk.gray('\n已取消启动'));
      printPortConflictHelp(port);
      process.exit(0);
    }

    // 尝试杀掉占用端口的进程
    console.log(chalk.cyan('正在关闭占用端口的进程...'));
    const killed = killProcessByPort(port);

    if (!killed) {
      const toolIssue = getPortToolIssue();
      if (toolIssue) {
        printPortToolIssue(toolIssue);
      } else {
        console.error(chalk.red('\n[ERROR] 无法关闭占用端口的进程'));
      }
      console.error(chalk.yellow('\n[TIP] 请手动关闭占用端口的程序，或使用其他端口\n'));
      process.exit(1);
    }

    // 等待端口释放
    console.log(chalk.cyan('等待端口释放...'));
    const released = await waitForPortRelease(port, 3000, host);

    if (!released) {
      console.error(chalk.red('\n[ERROR] 端口释放超时'));
      console.error(chalk.yellow('\n[TIP] 请稍后重试，或手动检查端口占用情况\n'));
      process.exit(1);
    }

    console.log(chalk.green('[v] 端口已释放\n'));
  }

  const webBuildState = inspectWebBuildState();
  if (webBuildState.needsBuild) {
    const reasonText = webBuildState.reason === 'dist-missing'
      ? '缺少 Web UI 静态资源'
      : '检测到 Web UI 静态资源已过期';
    console.log(chalk.cyan(`[BUILD] ${reasonText}，正在重新构建...`));

    const buildResult = await ensureWebDistReady({ state: webBuildState });
    if (buildResult.built) {
      console.log(chalk.green('[OK] Web UI 静态资源已更新\n'));
    }
  }

  const app = express();
  const useHttps = options.useHttps === true || process.argv.includes('--https');
  const lanMode = host === '0.0.0.0';
  const allowRemoteMutation = isRemoteMutationAllowedByEnv(process.env);

  // Middleware
  app.use(express.json({ limit: '100mb' }));
  app.use(express.urlencoded({ limit: '100mb', extended: true }));

  // CORS for development
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
    next();
  });

  // API 请求日志（由 CC_TOOL_LOG_API_REQUESTS=true 环境变量控制，默认关闭）
  app.use('/api', createApiRequestLogger());

  if (lanMode) {
    app.use('/api', createRemoteMutationGuard({
      enabled: true,
      allowRemoteMutation,
      message: 'LAN 模式下远程写操作已被 CC_TOOL_ALLOW_REMOTE_WRITE=false 禁止。'
    }));

  }
  app.use(['/api/skills', '/api/project-config', '/api/mcp', '/api/config-registry'], createSameOriginGuard({
    enabled: true,
    message: 'Skill/MCP/project configuration requires same-origin access.'
  }));

  // Registry-backed platform catalog and generic read routes
  const { getPlatformRegistry, getPlatformRuntime } = require('../platforms/runtime');
  app.use('/api/platforms', require('./api/platforms')({
    registry: getPlatformRegistry(),
    runtime: getPlatformRuntime()
  }));

  // API Routes
  app.use('/api/projects', require('./api/projects')(config));
  app.use('/api/sessions', require('./api/sessions')(config));

  // Codex API Routes
  app.use('/api/codex/projects', require('./api/codex-projects')(config));
  app.use('/api/codex/sessions', require('./api/codex-sessions')(config));
  app.use('/api/codex/channels', require('./api/codex-channels')(config));

  // Gemini API Routes
  app.use('/api/gemini/projects', require('./api/gemini-projects')(config));
  app.use('/api/gemini/sessions', require('./api/gemini-sessions')(config));
  app.use('/api/gemini/channels', require('./api/gemini-channels')(config));
  app.use('/api/gemini/proxy', require('./api/gemini-proxy'));

  // OpenCode API Routes
  app.use('/api/opencode/projects', require('./api/opencode-projects')(config));
  app.use('/api/opencode/sessions', require('./api/opencode-sessions')(config));
  app.use('/api/opencode/channels', require('./api/opencode-channels')(config));
  app.use('/api/opencode/proxy', require('./api/opencode-proxy'));
  app.use('/api/opencode/statistics', require('./api/opencode-statistics'));

  // OMP API Routes
  app.use('/api/omp/projects', require('./api/omp-projects')(config));
  app.use('/api/omp/sessions', require('./api/omp-sessions')(config));
  app.use('/api/omp/channels', require('./api/omp-channels')(config));
  app.use('/api/omp/proxy', require('./api/omp-proxy'));
  app.use('/api/omp/statistics', require('./api/omp-statistics'));
  app.use('/api/omp/config', require('./api/omp-config'));

  app.use('/api/aliases', require('./api/aliases')());
  app.use('/api/favorites', require('./api/favorites'));
  app.use('/api/ui-config', require('./api/ui-config'));
  app.use('/api/channel-balances', require('./api/channel-balances'));
  app.use('/api/security', require('./api/security'));
  app.use('/api/channels', require('./api/channels'));
  app.use('/api/proxy', require('./api/proxy'));
  app.use('/api/codex/proxy', require('./api/codex-proxy'));
  app.use('/api/settings', require('./api/settings'));
  app.use('/api/config', require('./api/config'));
  app.use('/api/convert', require('./api/convert'));
  app.use('/api/statistics', require('./api/statistics'));
  app.use('/api/claude/statistics', require('./api/claude-statistics'));
  app.use('/api/codex/statistics', require('./api/codex-statistics'));
  app.use('/api/gemini/statistics', require('./api/gemini-statistics'));
  app.use('/api/pm2-autostart', require('./api/pm2-autostart')());
  app.use('/api/dashboard', require('./api/dashboard'));
  app.use('/api/mcp', require('./api/mcp'));
  app.use('/api/prompts', require('./api/prompts'));
  app.use('/api/env', require('./api/env'));
  app.use('/api/skills', require('./api/skills'));
  app.use('/api/project-config', require('./api/project-config'));
  const claudeHooks = require('./api/claude-hooks');
  const notificationHooks = require('./services/notification-hooks');
  app.use('/api/claude/hooks', claudeHooks);
  app.use('/api/hooks', require('./api/hooks'));

  // 初始化 Claude hooks 默认配置（自动开启任务完成通知）
  notificationHooks.initDefaultHooks();
  notificationHooks.syncManagedNotificationAssets();

  // Claude Code 专有功能 API
  app.use('/api/commands', require('./api/commands'));
  app.use('/api/agents', require('./api/agents'));
  app.use('/api/plugins', require('./api/plugins'));

  // 工作区 API
  app.use('/api/workspaces', require('./api/workspaces'));

  // 配置模板 API
  app.use('/api/config-templates', require('./api/config-templates'));

  // 配置导出/导入 API
  app.use('/api/config-export', require('./api/config-export'));
  app.use('/api/oauth-credentials', require('./api/oauth-credentials'));

  // 配置同步 API
  app.use('/api/config-sync', require('./api/config-sync'));

  // 配置注册表 API (集中管理 skills/commands/agents/plugins 的启用/禁用)
  app.use('/api/config-registry', require('./api/config-registry'));

  // 健康检查 API
  app.use('/api/health-check', require('./api/health-check')(config));

  // Serve static files in production
  const distPath = path.join(__dirname, '../../dist/web');
  if (require('fs').existsSync(distPath)) {
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // Start server（确保监听成功后才返回，避免命令误报“已启动”）
  let server;
  if (useHttps) {
    const httpsCredentials = ensureHttpsCredentials();
    server = https.createServer(httpsCredentials, app);
    server.listen(port, host);
  } else {
    server = http.createServer(app);
    server.listen(port, host);
  }
  await new Promise((resolve) => {
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };

    const onError = (err) => {
      server.off('listening', onListening);
      if (err.code === 'EADDRINUSE') {
        console.error(chalk.red(`\n[ERROR] 端口 ${port} 已被占用`));
        console.error(chalk.yellow('\n[TIP] 解决方案:'));
        console.error(chalk.gray('   1. 运行 ctx 命令，选择"配置端口"修改端口'));
        console.error(chalk.gray(`   2. 或关闭占用端口 ${port} 的程序\n`));
      } else {
        console.error(chalk.red(`\n[ERROR] 启动服务器失败: ${err.message}\n`));
      }
      process.exit(1);
    };

    server.once('listening', onListening);
    server.once('error', onError);
  });

  console.log(`\n[START] Coding-Tool Web UI running at:`);
  const protocol = useHttps ? 'https' : 'http';
  const wsProtocol = useHttps ? 'wss' : 'ws';
  if (host === '0.0.0.0') {
    console.log(chalk.yellow(`   [WARN]  警告: 服务正在监听所有网络接口 (LAN 可访问)`));
    console.log(`   ${protocol}://localhost:${port}`);
    console.log(chalk.gray(`   ${protocol}://<your-ip>:${port} (LAN 访问)`));
  } else {
    console.log(`   ${protocol}://localhost:${port}`);
  }

  // 附加 WebSocket 服务器到同一个端口
  attachWebSocketServer(server, { host });
  console.log(`   ${wsProtocol}://localhost:${port}/ws\n`);

  if (useHttps) {
    console.log(chalk.gray('   [TIP] 首次访问自签名证书时，浏览器可能会提示手动信任本地证书'));
  }

  if (host === '0.0.0.0') {
    if (allowRemoteMutation) {
      console.log(chalk.yellow('   [WARN]  LAN 远程写操作已启用（显式授权）'));
      console.log(chalk.gray('   默认远程写操作关闭；如需关闭显式授权，请移除 CC_TOOL_ALLOW_REMOTE_WRITE=true'));
    } else {
      console.log(chalk.yellow('   [LOCK] 已启用 LAN 安全保护：远程写操作默认关闭'));
    }
  }
  // 自动恢复代理状态
  autoRestoreProxies();

  // 延迟执行健康检查，避免阻塞启动
  setTimeout(() => performStartupHealthCheck(), 2000);

  return server;
}

// 自动恢复代理状态
function autoRestoreProxies({ registry, runtime, config, fsImpl = require('fs') } = {}) {
  const resolvedRegistry = registry || require('../platforms/runtime').getPlatformRegistry();
  const resolvedRuntime = runtime || require('../platforms/runtime').getPlatformRuntime();
  const resolvedConfig = config || loadConfig();
  const platforms = typeof resolvedRegistry.list === 'function'
    ? resolvedRegistry.list({ enabledOnly: true })
    : [];

  for (const platform of platforms) {
    const key = platform && platform.key;
    const markerPath = key && PATHS.activeChannel?.[key];
    if (!key || !markerPath || !fsImpl.existsSync(markerPath)) continue;

    let driver;
    try {
      driver = resolvedRuntime.getDriver(key, 'proxy');
    } catch (error) {
      console.error(chalk.red(`[ERROR] ${platform.label || key} 代理恢复失败: ${error.message}`));
      continue;
    }
    if (!driver || typeof driver.restoreOnBoot !== 'function') continue;

    const serviceLabel = platform.proxyLabels?.serviceLabel || `${platform.label || key} 代理服务`;
    console.log(chalk.cyan(`\n[SYNC] 检测到 ${serviceLabel} 状态文件，正在自动恢复...`));
    Promise.resolve(driver.restoreOnBoot({ config: resolvedConfig }))
      .then((result) => {
        if (!result || result.status === 'ok') {
          const port = result?.port;
          const suffix = port
            ? platform.proxyMode === 'managed'
              ? `: http://127.0.0.1:${port}`
              : `，端口: ${port}`
            : '';
          const action = platform.proxyMode === 'managed' ? '动态网关已自动恢复' : '代理已自动启动';
          console.log(chalk.green(`[OK] ${platform.label || key} ${action}${suffix}`));
          return;
        }
        console.error(chalk.red(`[ERROR] ${platform.label || key} 代理恢复失败: ${result.error || result.status}`));
      })
      .catch((error) => {
        console.error(chalk.red(`[ERROR] ${platform.label || key} 代理恢复失败: ${error.message}`));
      });
  }
}

// 启动时执行健康检查
async function performStartupHealthCheck() {
  const { healthCheckAllProjects } = require('./services/health-check');
  const { getProjects } = require('./services/sessions');

  try {
    console.log(chalk.cyan('\n[SEARCH] 正在进行启动健康检查...'));

    // 获取所有项目
    const config = loadConfig();
    const projects = await getProjects(config);

    if (projects.length === 0) {
      console.log(chalk.gray('   未发现项目，跳过健康检查'));
      return;
    }

    // 检查并创建缺失的目录
    const healthResult = healthCheckAllProjects(projects);

    if (healthResult.summary.created > 0) {
      console.log(chalk.green(`   [v] 已为 ${healthResult.summary.created} 个项目创建 .claude/sessions 目录`));
    }

    if (healthResult.summary.errors > 0) {
      console.log(chalk.yellow(`   [!] ${healthResult.summary.errors} 个项目检查失败`));
    }

    if (healthResult.summary.created === 0 && healthResult.summary.errors === 0) {
      console.log(chalk.green(`   [v] 所有 ${healthResult.summary.healthy} 个项目状态正常`));
    }

    console.log('');
  } catch (err) {
    console.error(chalk.red('   [x] 健康检查失败:'), err.message);
  }
}

module.exports = {
  startServer,
  _test: { autoRestoreProxies }
};
