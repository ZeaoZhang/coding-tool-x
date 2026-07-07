#!/usr/bin/env node

/**
 * CC-CLI - Claude Code 会话管理工具
 * 主入口文件
 */

const { loadConfig } = require('./config/loader');
const { resetConfig } = require('./reset-config');
const { handleStart, handleStop, handleRestart, handleStatus } = require('./commands/daemon');
const { handleProxyStart: proxyStart, handleProxyStop: proxyStop, handleProxyRestart, handleProxyStatus: proxyStatus } = require('./commands/proxy-control');
const { handleLogs } = require('./commands/logs');
const { handleStats, handleStatsExport } = require('./commands/stats');
const { handleDoctor } = require('./commands/doctor');
const { handleUpdate } = require('./commands/update');
const { ensureStorageDirMigrated } = require('./config/paths');
const PluginManager = require('./plugins/plugin-manager');
const eventBus = require('./plugins/event-bus');
const chalk = require('chalk');
const path = require('path');
const fs = require('fs');

function getInquirer() {
  return require('inquirer');
}

// 读取版本号
function getVersion() {
  const packagePath = path.join(__dirname, '../package.json');
  const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  return packageJson.version;
}

function finishCli(code = 0) {
  eventBus.emitSync('cli:shutdown', {});
  PluginManager.shutdownPlugins();
  process.exit(code);
}

// 显示帮助信息
function showHelp() {
  const version = getVersion();
  console.log(chalk.cyan.bold(`\nCODING-TOOL v${version}`));
  console.log(chalk.gray('Vibe Coding 增强工作助手 - 智能会话管理、动态渠道切换、全局搜索、实时监控\n'));

  console.log(chalk.yellow('[START] 服务管理:'));
  console.log('  ctx start               启动所有服务（后台运行）');
  console.log('  ctx stop                停止所有服务');
  console.log('  ctx restart             重启所有服务');
  console.log('  ctx status              查看服务状态\n');

  console.log(chalk.yellow('[UI] UI 管理:'));
  console.log('  ctx ui                  前台启动 Web UI（仅本地访问）');
  console.log('  ctx ui --https          前台启动 Web UI（本地 HTTPS）');
  console.log('  ctx ui --host           前台启动 Web UI（允许 LAN 访问）');
  console.log('  ctx ui start            后台启动 Web UI');
  console.log('  ctx ui start --https    后台启动 Web UI（本地 HTTPS）');
  console.log('  ctx ui start --host     后台启动 Web UI（允许 LAN 访问）');
  console.log('  ctx ui stop             停止 Web UI');
  console.log('  ctx ui restart          重启 Web UI\n');

  console.log(chalk.yellow('[PROXY] 代理管理:'));
  console.log('  ctx claude start        启动 Claude 代理');
  console.log('  ctx claude stop         停止 Claude 代理');
  console.log('  ctx claude status       查看 Claude 代理状态');
  console.log('  ctx codex start         启动 Codex 代理');
  console.log('  ctx gemini start        启动 Gemini 代理');
  console.log('  ctx opencode start      启动 OpenCode 代理');
  console.log('  ctx pi start            启用 OMP 受管模型配置');
  console.log(chalk.gray('  (codex/gemini/opencode/pi 命令与 claude 类似)\n'));

  console.log(chalk.yellow('[LOG] 日志管理:'));
  console.log('  ctx logs                查看所有日志');
  console.log('  ctx logs ui             查看 UI 日志');
  console.log('  ctx logs claude         查看 Claude 日志');
  console.log('  ctx logs --lines 100    查看最近 100 行');
  console.log('  ctx logs --follow       实时跟踪日志');
  console.log('  ctx logs --clear        清空日志\n');

  console.log(chalk.yellow('[STATS] 统计信息:'));
  console.log('  ctx stats               查看总体统计');
  console.log('  ctx stats claude        查看 Claude 统计');
  console.log('  ctx stats --today       查看今日统计');
  console.log('  ctx stats export        导出统计数据\n');

  console.log(chalk.yellow('[TOOL]  其他命令:'));
  console.log('  ctx update              检查并更新到最新版本');
  console.log('  ctx doctor              系统诊断');
  console.log('  ctx port                配置端口');
  console.log('  ctx reset               重置配置');
  console.log('  ctx security reset      关闭访问密码');
  console.log('  ctx --version, -v       显示版本');
  console.log('  ctx --help, -h          显示帮助\n');

  console.log(chalk.yellow('[PROXY] 插件管理:'));
  console.log('  ctx plugin list         列出已安装插件');
  console.log('  ctx plugin install <url>  从 Git 安装插件');
  console.log('  ctx plugin remove <name>  卸载插件');
  console.log('  ctx plugin enable <name>  启用插件');
  console.log('  ctx plugin disable <name> 禁用插件');
  console.log('  ctx plugin info <name>    查看插件详情');
  console.log('  ctx plugin config <name>  配置插件');
  console.log('  ctx plugin update <name>  更新插件');
  console.log('  ctx plugin update --all   更新所有插件\n');

  console.log(chalk.yellow('[TIP] 快速开始:'));
  console.log(chalk.gray('  $ ctx start          # 后台启动服务（推荐）'));
  console.log(chalk.gray('  $ ctx status         # 查看服务状态'));
  console.log(chalk.gray('  $ ctx logs           # 查看实时日志'));
  console.log(chalk.gray('  $ ctx stop           # 停止服务\n'));

  console.log(chalk.yellow('[STAR] 开机自启（可选）:'));
  console.log(chalk.gray('  $ pm2 startup        # 启用开机自启'));
  console.log(chalk.gray('  $ pm2 save           # 保存配置'));
  console.log(chalk.gray('  $ pm2 unstartup      # 禁用开机自启\n'));

  console.log(chalk.yellow('更多信息:'));
  console.log(chalk.gray('  官网: https://github.com/ZeaoZhang/coding-tool'));
  console.log(chalk.gray('  文档: 运行 ctx start 后在 Web UI 右上角点击帮助'));
  console.log(chalk.gray('  问题: https://github.com/ZeaoZhang/coding-tool/issues\n'));
}

// 全局错误处理
process.on('uncaughtException', (err) => {
  // 忽略终端相关的错误（通常在 Ctrl+C 时发生）
  if (err.code === 'EIO' || err.code === 'ENOTTY' || err.code === 'EPIPE') {
    process.exit(0);
  }
  throw err;
});

// 处理 SIGINT 信号（Ctrl+C）
process.on('SIGINT', async () => {
  eventBus.emitSync('cli:shutdown', {});
  PluginManager.shutdownPlugins();
  process.exit(0);
});

/**
 * 主函数
 */
async function main() {
  ensureStorageDirMigrated();

  // 处理命令行参数
  const args = process.argv.slice(2);

  // --version 或 -v - 显示版本号
  if (args[0] === '--version' || args[0] === '-v') {
    console.log(getVersion());
    return;
  }

  // --help 或 -h - 显示帮助信息
  if (args[0] === '--help' || args[0] === '-h') {
    showHelp();
    return;
  }

  // daemon 命令兼容（保持与 README 中旧命令一致）
  if (args[0] === 'daemon') {
    const subCommand = args[1] || 'status';

    if (subCommand === 'start') {
      await handleStart();
      return finishCli(0);
    }
    if (subCommand === 'stop') {
      await handleStop();
      return finishCli(0);
    }
    if (subCommand === 'restart') {
      await handleRestart();
      return finishCli(0);
    }
    if (subCommand === 'status') {
      await handleStatus();
      return finishCli(0);
    }
    if (subCommand === 'logs') {
      const options = {};
      for (let i = 2; i < args.length; i++) {
        if (args[i] === '--lines' && args[i + 1]) {
          options.lines = parseInt(args[i + 1], 10);
          i++;
        } else if (args[i] === '--follow' || args[i] === '-f') {
          options.follow = true;
        } else if (args[i] === '--clear') {
          options.clear = true;
        }
      }
      await handleLogs('ui', options);
      return;
    }

    console.log(chalk.red(`\n[ERROR] 未知 daemon 子命令: ${subCommand}\n`));
    console.log(chalk.gray('支持的命令: start, stop, restart, status, logs\n'));
    return;
  }

  // reset 命令 - 恢复默认配置
  if (args[0] === 'reset') {
    await resetConfig();
    return;
  }

  // security 命令 - 安全设置
  if (args[0] === 'security') {
    const { showSecurityHelp, handleSecurityReset } = require('./commands/security');
    const subCommand = args[1] || 'help';

    if (subCommand === 'reset' || subCommand === 'disable' || subCommand === 'off') {
      await handleSecurityReset();
    } else {
      showSecurityHelp();
    }
    return;
  }

  // start 命令 - 启动服务（后台）
  if (args[0] === 'start') {
    await handleStart();
    return finishCli(0);
  }

  // stop 命令 - 停止服务
  if (args[0] === 'stop') {
    await handleStop();
    return finishCli(0);
  }

  // restart 命令 - 重启服务
  if (args[0] === 'restart') {
    await handleRestart();
    return finishCli(0);
  }

  // status 命令 - 查看服务状态
  if (args[0] === 'status') {
    await handleStatus();
    return finishCli(0);
  }

  // ui 命令 - Web UI 管理
  if (args[0] === 'ui') {
    const subCommand = args[1];
    if (subCommand === 'start') {
      await handleStart();  // UI start 实际上就是启动整个服务
      return finishCli(0);
    } else if (subCommand === 'stop') {
      await handleStop();
      return finishCli(0);
    } else if (subCommand === 'restart') {
      await handleRestart();
      return finishCli(0);
    } else {
      // 默认前台运行
      const { handleUI } = require('./commands/ui');
      await handleUI();
    }
    return;
  }

  // claude/codex/gemini/opencode/pi 代理管理命令
  const channels = ['claude', 'codex', 'gemini', 'opencode', 'pi'];
  if (channels.includes(args[0])) {
    const channel = args[0];
    const action = args[1] || 'status';

    switch (action) {
      case 'start':
        await proxyStart(channel);
        break;
      case 'stop':
        await proxyStop(channel);
        break;
      case 'restart':
        await handleProxyRestart(channel);
        break;
      case 'status':
        await proxyStatus(channel);
        break;
      default:
        console.log(chalk.red(`\n[ERROR] 未知操作: ${action}\n`));
        console.log(chalk.gray('支持的操作: start, stop, restart, status\n'));
    }
    return;
  }

  // logs 命令 - 日志管理
  if (args[0] === 'logs') {
    const type = args[1] && !args[1].startsWith('--') ? args[1] : null;
    const options = {};

    // 解析选项
    for (let i = type ? 2 : 1; i < args.length; i++) {
      if (args[i] === '--lines' && args[i + 1]) {
        options.lines = parseInt(args[i + 1]);
        i++;
      } else if (args[i] === '--follow' || args[i] === '-f') {
        options.follow = true;
      } else if (args[i] === '--clear') {
        options.clear = true;
      }
    }

    await handleLogs(type, options);
    return;
  }

  // stats 命令 - 统计信息
  if (args[0] === 'stats') {
    if (args[1] === 'export') {
      const type = args[2] || null;
      await handleStatsExport(type);
    } else {
      const type = args[1] && !args[1].startsWith('--') ? args[1] : null;
      const options = {};

      // 解析选项
      for (let i = type ? 2 : 1; i < args.length; i++) {
        if (args[i] === '--today') options.today = true;
        else if (args[i] === '--week') options.week = true;
        else if (args[i] === '--month') options.month = true;
      }

      await handleStats(type, options);
    }
    return;
  }

  // doctor 命令 - 系统诊断
  if (args[0] === 'doctor') {
    await handleDoctor();
    return;
  }

  // update 命令 - 检查并更新到最新版本
  if (args[0] === 'update') {
    const checkOnly = args.includes('--check');
    await handleUpdate({ checkOnly });
    return;
  }

  // port 命令 - 配置端口
  if (args[0] === 'port') {
    const { handlePortConfig } = require('./commands/port-config');
    await handlePortConfig();
    return;
  }

  // 代理命令
  if (args[0] === 'proxy') {
    const { handleProxyStart, handleProxyStop, handleProxyStatus } = require('./commands/proxy');
    const subCommand = args[1] || 'start';

    switch (subCommand) {
      case 'start':
        await handleProxyStart();
        return;

      case 'stop':
        await handleProxyStop();
        return;

      case 'status':
        handleProxyStatus();
        return;

      default:
        // 默认执行 start
        await handleProxyStart();
        return;
    }
  }

  // plugin 命令 - 插件管理
  if (args[0] === 'plugin') {
    const { handlePluginCommand } = require('./commands/plugin');
    await handlePluginCommand(args.slice(1));
    return;
  }

  // 加载配置
  let config = loadConfig();

  // 初始化插件系统
  const pluginResult = PluginManager.initializePlugins({ config, args });
  if (pluginResult.loaded > 0) {
    console.log(chalk.gray(`[Plugin] 已加载 ${pluginResult.loaded} 个插件`));
  }
  if (pluginResult.failed.length > 0) {
    console.log(chalk.yellow(`[Plugin] ${pluginResult.failed.length} 个插件加载失败`));
  }

  // 检查是否为插件注册的命令
  if (args[0] && PluginManager.isPluginCommand(args[0])) {
    eventBus.emitSync('cli:command:before', { command: args[0], args: args.slice(1), config });
    const result = await PluginManager.executePluginCommand(args[0], args.slice(1));
    eventBus.emitSync('cli:command:after', { command: args[0], args: args.slice(1), result });
    if (!result.success) {
      console.error(chalk.red(result.error));
      process.exit(1);
    }
    return;
  }

  while (true) {
    // 显示主菜单
    const { showMainMenu } = require('./ui/menu');
    const action = await showMainMenu(config);

    // 发送命令开始事件
    eventBus.emitSync('cli:command:before', { command: action, args: [], config });

    let result = { success: true };

    switch (action) {
      case 'list':
        const { handleList } = require('./commands/list');
        await handleList(config, async () => {
          const { switchProject } = require('./commands/switch');
          const switched = await switchProject(config);
          if (switched) {
            // 重新加载配置以获取最新的项目设置
            config = loadConfig();
          }
          return switched;
        }, true); // crossProject = true，跨项目显示最近会话
        break;

      case 'search':
        const { handleSearch } = require('./commands/search');
        await handleSearch(config, async () => {
          const { switchProject } = require('./commands/switch');
          const switched = await switchProject(config);
          if (switched) {
            config = loadConfig();
          }
          return switched;
        });
        break;

      case 'switch':
        const { switchProject } = require('./commands/switch');
        const switched = await switchProject(config);
        if (switched) {
          config = loadConfig();
          // 切换成功后自动进入会话列表
          const { handleList } = require('./commands/list');
          await handleList(config, async () => {
            const { switchProject } = require('./commands/switch');
            const switched = await switchProject(config);
            if (switched) {
              config = loadConfig();
            }
            return switched;
          });
        }
        break;

      case 'workspace':
        const { workspaceMenu } = require('./commands/workspace');
        await workspaceMenu();
        break;

      case 'switch-cli-type':
        const { handleSwitchCliType } = require('./commands/cli-type');
        await handleSwitchCliType();
        config = loadConfig(); // 重新加载配置以获取新的类型
        break;

      case 'switch-channel':
        const { handleChannelManagement } = require('./commands/channels');
        await handleChannelManagement();
        break;
      case 'channel-status':
        const { handleChannelStatus } = require('./commands/channels');
        await handleChannelStatus();
        break;

      case 'toggle-proxy':
        const { handleToggleProxy } = require('./commands/toggle-proxy');
        await handleToggleProxy();
        break;

      case 'add-channel':
        const { handleAddChannel } = require('./commands/channels');
        await handleAddChannel();
        break;

      case 'ui': {
        const { handleUI } = require('./commands/ui');
        await handleUI();
        break;
      }

      case 'port-config':
        const { handlePortConfig } = require('./commands/port-config');
        await handlePortConfig();
        break;

      case 'reset':
        await resetConfig();
        break;

      case 'plugin-menu': {
        const { handlePluginCommand } = require('./commands/plugin');
        const inquirer = getInquirer();

        // Show plugin management submenu
        const pluginAction = await inquirer.prompt([{
          type: 'list',
          name: 'action',
          message: chalk.cyan('选择插件操作:'),
          choices: [
            { name: '[LOG] 列出已安装插件', value: 'list' },
            { name: '[PKG] 安装插件', value: 'install' },
            { name: '[DEL]  卸载插件', value: 'remove' },
            { name: '[SYNC] 启用/禁用插件', value: 'toggle' },
            { name: '[INFO]  查看插件信息', value: 'info' },
            { name: '[UP]  更新插件', value: 'update' },
            { name: '[CFG]  配置插件', value: 'config' },
            { name: '[BACK]  返回主菜单', value: 'back' }
          ]
        }]);

        if (pluginAction.action === 'back') {
          break;
        }

        // Build args array based on action
        let args = [pluginAction.action];

        switch (pluginAction.action) {
          case 'list':
            // No additional args needed
            await handlePluginCommand(args);
            break;

          case 'install': {
            const installPrompt = await inquirer.prompt([{
              type: 'input',
              name: 'url',
              message: '请输入插件 Git URL:',
              validate: (input) => {
                if (!input || input.trim() === '') {
                  return '请输入有效的 Git URL';
                }
                if (!input.match(/^https?:\/\//)) {
                  return '请输入完整的 URL (http:// 或 https://)';
                }
                return true;
              }
            }]);
            args.push(installPrompt.url);
            await handlePluginCommand(args);
            break;
          }

          case 'remove': {
            const removePrompt = await inquirer.prompt([{
              type: 'input',
              name: 'name',
              message: '请输入要卸载的插件名称:',
              validate: (input) => {
                if (!input || input.trim() === '') {
                  return '请输入插件名称';
                }
                return true;
              }
            }]);
            args.push(removePrompt.name);
            await handlePluginCommand(args);
            break;
          }

          case 'toggle': {
            const toggleChoice = await inquirer.prompt([{
              type: 'list',
              name: 'operation',
              message: '选择操作:',
              choices: [
                { name: '[OK] 启用插件', value: 'enable' },
                { name: '[ERROR] 禁用插件', value: 'disable' }
              ]
            }]);

            const togglePrompt = await inquirer.prompt([{
              type: 'input',
              name: 'name',
              message: '请输入插件名称:',
              validate: (input) => {
                if (!input || input.trim() === '') {
                  return '请输入插件名称';
                }
                return true;
              }
            }]);

            args = [toggleChoice.operation, togglePrompt.name];
            await handlePluginCommand(args);
            break;
          }

          case 'info': {
            const infoPrompt = await inquirer.prompt([{
              type: 'input',
              name: 'name',
              message: '请输入插件名称:',
              validate: (input) => {
                if (!input || input.trim() === '') {
                  return '请输入插件名称';
                }
                return true;
              }
            }]);
            args.push(infoPrompt.name);
            await handlePluginCommand(args);
            break;
          }

          case 'update': {
            const updateChoice = await inquirer.prompt([{
              type: 'list',
              name: 'option',
              message: '选择更新选项:',
              choices: [
                { name: '[SYNC] 更新指定插件', value: 'single' },
                { name: '[SYNC] 更新所有插件', value: 'all' }
              ]
            }]);

            if (updateChoice.option === 'all') {
              args.push('--all');
            } else {
              const updatePrompt = await inquirer.prompt([{
                type: 'input',
                name: 'name',
                message: '请输入插件名称:',
                validate: (input) => {
                  if (!input || input.trim() === '') {
                    return '请输入插件名称';
                  }
                  return true;
                }
              }]);
              args.push(updatePrompt.name);
            }
            await handlePluginCommand(args);
            break;
          }

          case 'config': {
            const configPrompt = await inquirer.prompt([{
              type: 'input',
              name: 'name',
              message: '请输入插件名称:',
              validate: (input) => {
                if (!input || input.trim() === '') {
                  return '请输入插件名称';
                }
                return true;
              }
            }]);
            args.push(configPrompt.name);
            await handlePluginCommand(args);
            break;
          }
        }

        // Wait for user to continue
        await inquirer.prompt([{
          type: 'input',
          name: 'continue',
          message: chalk.gray('按 Enter 继续...')
        }]);
        break;
      }

      case 'exit':
        console.log('\n[BYE] 再见！\n');
        finishCli(0);
        break;

      default:
        console.log('未知操作');
        result = { success: false, error: '未知操作' };
        break;
    }

    // 发送命令完成事件
    eventBus.emitSync('cli:command:after', { command: action, args: [], result });
  }
}

// 启动应用
main().catch((error) => {
  console.error('程序出错:', error);
  process.exit(1);
});
