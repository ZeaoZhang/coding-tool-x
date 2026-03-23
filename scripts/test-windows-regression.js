const assert = require('assert');
const path = require('path');

const { PATHS, NATIVE_PATHS, HOME_DIR } = require('../src/config/paths');
const { isSameOriginRequest } = require('../src/server/services/network-access');
const { resolvePreferredHomeDir, normalizeWindowsHomePath, isWindowsLikePlatform } = require('../src/utils/home-dir');
const mcpClient = require('../src/server/services/mcp-client');
const portHelper = require('../src/utils/port-helper');
const { isWindowsLikeRuntime, parsePidsFromNetstatOutput } = portHelper;
const claudeHooks = require('../src/server/api/claude-hooks');
const notificationHooks = require('../src/server/services/notification-hooks');
const logsCommand = require('../src/commands/logs');
const pm2Autostart = require('../src/server/api/pm2-autostart');
const daemonCommand = require('../src/commands/daemon');
const codexSettingsManager = require('../src/server/services/codex-settings-manager');

function run() {
  const hookTest = claudeHooks._test || {};
  const notificationHookTest = notificationHooks._test || {};
  const logsTest = logsCommand._test || {};
  const pm2Test = pm2Autostart._test || {};
  const mcpClientTest = mcpClient._test || {};
  const portHelperTest = portHelper._test || {};
  const daemonTest = daemonCommand._test || {};
  const codexSettingsTest = codexSettingsManager._test || {};

  assert.strictEqual(typeof hookTest.shouldRepairStopHook, 'function', '缺少 shouldRepairStopHook 测试导出');
  assert.strictEqual(typeof hookTest.resolvePreferredHomeDir, 'function', '缺少 resolvePreferredHomeDir 测试导出');
  assert.strictEqual(typeof notificationHookTest.getManagedCommandType, 'function', '缺少 getManagedCommandType 测试导出');
  assert.strictEqual(typeof notificationHookTest.parseCodexNotificationStatus, 'function', '缺少 parseCodexNotificationStatus 测试导出');
  assert.strictEqual(typeof notificationHookTest.generateSystemNotificationCommand, 'function', '缺少 generateSystemNotificationCommand 测试导出');
  assert.strictEqual(typeof isSameOriginRequest, 'function', '缺少 isSameOriginRequest 导出');
  assert.strictEqual(typeof logsTest.buildFollowProcessSpec, 'function', '缺少 buildFollowProcessSpec 测试导出');
  assert.strictEqual(typeof pm2Test.getExecOptions, 'function', '缺少 getExecOptions 测试导出');
  assert.strictEqual(typeof mcpClientTest.createMissingCommandHint, 'function', '缺少 createMissingCommandHint 测试导出');
  assert.strictEqual(typeof portHelperTest.isMissingCommandError, 'function', '缺少 isMissingCommandError 测试导出');
  assert.strictEqual(typeof portHelperTest.createPortToolIssue, 'function', '缺少 createPortToolIssue 测试导出');
  assert.strictEqual(typeof daemonTest.shouldTreatPortOwnershipAsReady, 'function', '缺少 shouldTreatPortOwnershipAsReady 测试导出');
  assert.strictEqual(typeof codexSettingsTest.isRecoverableEnvSyncError, 'function', '缺少 isRecoverableEnvSyncError 测试导出');

  const preferredHome = resolvePreferredHomeDir(
    'win32',
    {
      USERPROFILE: 'C:\\Users\\wjx',
      HOMEDRIVE: 'C:',
      HOMEPATH: '\\Users\\wjx',
      HOME: '/Users/wjx',
      SYSTEMROOT: 'C:\\Windows',
      SYSTEMDRIVE: 'C:'
    },
    'C:\\Program Files\\Git\\Users\\wjx'
  );
  assert.strictEqual(preferredHome, path.win32.normalize('C:\\Users\\wjx'), 'Windows 主目录解析应优先 USERPROFILE');
  assert.strictEqual(isWindowsLikePlatform('linux', { SYSTEMROOT: 'C:\\Windows', USERPROFILE: 'C:\\Users\\wjx' }), true, 'Windows 平台识别失败');
  assert.strictEqual(isWindowsLikeRuntime('linux', { SYSTEMROOT: 'C:\\Windows', HOMEDRIVE: 'C:', HOMEPATH: '\\Users\\wjx' }), true, 'Windows 运行时识别失败');

  const normalizedHome = normalizeWindowsHomePath('/c/Users/wjx', { SYSTEMDRIVE: 'C:' });
  assert.strictEqual(normalizedHome, path.win32.normalize('C:\\Users\\wjx'), 'MSYS Home 路径转换失败');

  assert.strictEqual(PATHS.base, path.join(HOME_DIR, '.cc-tool'), 'PATHS.base 应基于 HOME_DIR');
  assert.strictEqual(PATHS.configFile, path.join(HOME_DIR, '.cc-tool', 'config', 'config.json'), 'PATHS.configFile 应迁移到 config 子目录');
  assert.strictEqual(PATHS.channels.codex, path.join(HOME_DIR, '.cc-tool', 'storage', 'channels', 'codex.json'), 'Codex 渠道配置应迁移到 storage/channels');
  assert.strictEqual(PATHS.notifyHook, path.join(HOME_DIR, '.cc-tool', 'storage', 'scripts', 'notify-hook.js'), 'notify-hook 应迁移到 storage/scripts');
  assert.strictEqual(NATIVE_PATHS.codex.config, path.join(HOME_DIR, '.codex', 'config.toml'), 'Codex config 路径应基于 HOME_DIR');
  assert.strictEqual(NATIVE_PATHS.claude.settings, path.join(HOME_DIR, '.claude', 'settings.json'), 'Claude settings 路径应基于 HOME_DIR');

  const legacyHookSettings = {
    hooks: {
      Stop: [
        {
          hooks: [
            { type: 'command', command: 'node "C:\\Program Files\\Git\\Users\\wjx\\.cc-tool\\notify-hook.js" --cc-notify-type=notification' }
          ]
        }
      ]
    }
  };
  assert.strictEqual(
    hookTest.shouldRepairStopHook(legacyHookSettings, 'C:\\Users\\wjx\\.cc-tool\\notify-hook.js', () => true),
    true,
    '旧版 Git 路径应触发 Stop hook 修复'
  );

  assert.strictEqual(
    notificationHookTest.getManagedCommandType('node "C:\\Users\\wjx\\.cc-tool\\storage\\scripts\\notify-hook.js" --mode=dialog'),
    'dialog',
    'Windows 统一通知命令应识别 dialog 模式'
  );
  assert.deepStrictEqual(
    notificationHookTest.parseCodexNotificationStatus({
      notify: ['node', 'C:\\Users\\wjx\\.cc-tool\\storage\\scripts\\notify-hook.js', '--mode=notification']
    }),
    { enabled: true, external: false, type: 'notification', method: 'notify' },
    'Windows Codex notify 状态解析失败'
  );
  const windowsNotificationCommand = notificationHookTest.generateSystemNotificationCommand('notification', '这是一条测试通知', 'win32');
  assert.strictEqual(windowsNotificationCommand.includes('ToastNotificationManager'), false, 'Windows 通知命令不应再包含 Toast 主路径');
  assert.strictEqual(windowsNotificationCommand.includes('PresentationFramework'), true, 'Windows 通知命令应包含 WPF 主样式实现');
  assert.strictEqual(windowsNotificationCommand.includes('AllowsTransparency'), true, 'Windows 通知命令应包含透明卡片配置');
  assert.strictEqual(windowsNotificationCommand.includes('DropShadowEffect'), true, 'Windows 通知命令应包含阴影效果');
  assert.strictEqual(windowsNotificationCommand.includes('ShowActivated'), true, 'Windows 通知命令应避免抢占焦点');
  assert.strictEqual(windowsNotificationCommand.includes('System.Windows.Forms'), true, 'Windows 通知命令应保留 WinForms 回退');
  assert.strictEqual(windowsNotificationCommand.includes('WorkingArea'), true, 'Windows 通知命令应包含屏幕工作区定位');
  assert.strictEqual(windowsNotificationCommand.includes('FormBorderStyle]::None'), true, 'Windows 回退窗体应使用无边框样式');
  assert.strictEqual(windowsNotificationCommand.includes('FixedToolWindow'), false, 'Windows 通知命令不应再使用旧工具窗样式');
  assert.strictEqual(windowsNotificationCommand.includes('||'), false, 'Windows 通知命令不应再包含 Toast 外层 fallback');
  assert.strictEqual(
    notificationHookTest.generateNotifyScript().includes("execFileSync('powershell'"),
    true,
    'Windows 通知脚本应直接调用 PowerShell，避免 cmd 长度限制'
  );
  assert.strictEqual(
    isSameOriginRequest({ headers: { origin: 'http://localhost:19999', host: 'localhost:19999' } }),
    true,
    'Windows 本地同源请求应通过校验'
  );

  const netstatOutput = [
    '  TCP    0.0.0.0:19999      0.0.0.0:0      LISTENING       1234',
    '  TCP    127.0.0.1:19999    127.0.0.1:52001 ESTABLISHED     1234',
    '  TCP    0.0.0.0:20088      0.0.0.0:0      LISTENING       5678'
  ].join('\n');
  assert.deepStrictEqual(parsePidsFromNetstatOutput(netstatOutput, 19999), ['1234'], 'netstat PID 解析失败');
  assert.strictEqual(
    portHelperTest.isMissingCommandError({ code: 'ENOENT', message: 'spawn netstat ENOENT' }),
    true,
    'ENOENT 应识别为缺少系统命令'
  );
  assert.strictEqual(
    portHelperTest.isMissingCommandError({ message: '\'taskkill\' is not recognized as an internal or external command' }),
    true,
    'Windows not recognized 文案应识别为缺少系统命令'
  );
  const windowsPortToolIssue = portHelperTest.createPortToolIssue('netstat', 'lookup', true);
  assert.strictEqual(windowsPortToolIssue.summary.includes('netstat'), true, 'Windows 缺少工具提示应包含命令名');
  assert.strictEqual(
    windowsPortToolIssue.hints.some(line => line.includes('C:\\Windows\\System32')),
    true,
    'Windows 缺少工具提示应提示检查 System32 PATH'
  );
  const uvxMissingHint = mcpClientTest.createMissingCommandHint('uvx', 'uvx.cmd', { PATH: 'C:\\Windows\\System32;C:\\Program Files\\nodejs' });
  assert.strictEqual(uvxMissingHint.title.includes('uvx'), true, 'Windows MCP 命令缺失提示应包含命令名');
  assert.strictEqual(uvxMissingHint.details.some(line => line.includes('uv')), true, 'uvx 缺失提示应提醒安装 uv');
  assert.strictEqual(daemonTest.shouldTreatPortOwnershipAsReady(null), true, '缺少端口检测工具时应走降级就绪检查');
  assert.strictEqual(daemonTest.shouldTreatPortOwnershipAsReady(true), true, '端口归属命中时应视为就绪');
  assert.strictEqual(daemonTest.shouldTreatPortOwnershipAsReady(false), false, '端口归属不匹配时不应视为就绪');
  assert.strictEqual(
    codexSettingsTest.isRecoverableEnvSyncError({ code: 'ETIMEDOUT', message: 'spawnSync pwsh ETIMEDOUT' }),
    true,
    'pwsh 超时应视为可降级错误'
  );
  assert.strictEqual(
    codexSettingsTest.isRecoverableEnvSyncError({ message: 'No PowerShell executable available' }),
    true,
    '缺少 PowerShell 可执行文件应视为可降级错误'
  );
  assert.strictEqual(
    codexSettingsTest.isRecoverableEnvSyncError(new Error('permission denied')),
    false,
    '无关错误不应被视为可降级错误'
  );

  const winFollowSpec = logsTest.buildFollowProcessSpec('C:\\Users\\wjx\\.cc-tool\\logs\\cc-tool-out.log', 'win32');
  assert.strictEqual(winFollowSpec.command, 'powershell', 'Windows 日志跟踪应使用 powershell');
  assert.strictEqual(winFollowSpec.args.includes('-NoProfile'), true, 'Windows 日志跟踪应带 -NoProfile');
  assert.strictEqual(winFollowSpec.args.some(arg => String(arg).includes('Get-Content')), true, 'Windows 日志跟踪应使用 Get-Content');

  const unixFollowSpec = logsTest.buildFollowProcessSpec('/tmp/cc-tool-out.log', 'linux');
  assert.strictEqual(unixFollowSpec.command, 'tail', 'Unix 日志跟踪应使用 tail');
  assert.deepStrictEqual(unixFollowSpec.args, ['-n', '50', '-f', '/tmp/cc-tool-out.log'], 'Unix 日志跟踪参数不正确');

  const winExecOptions = pm2Test.getExecOptions(30000, 'win32');
  assert.deepStrictEqual(winExecOptions, { timeout: 30000, windowsHide: true }, 'Windows PM2 exec 选项不应强制 /bin/bash');
  const linuxExecOptions = pm2Test.getExecOptions(30000, 'linux');
  assert.deepStrictEqual(linuxExecOptions, { shell: '/bin/bash', timeout: 30000, windowsHide: true }, 'Linux PM2 exec 选项应包含 /bin/bash');

  console.log('Windows 专项回归测试通过');
}

run();
