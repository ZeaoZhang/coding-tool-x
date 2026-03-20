const assert = require('assert');
const path = require('path');
const os = require('os');

const { expandHome, getConfigFilePath } = require('../src/config/loader');
const { PATHS } = require('../src/config/paths');
const DEFAULT_CONFIG = require('../src/config/default');
const { isLoopbackRequest, isSameOriginRequest } = require('../src/server/services/network-access');
const claudeHooks = require('../src/server/api/claude-hooks');
const notificationHooks = require('../src/server/services/notification-hooks');
const portHelper = require('../src/utils/port-helper');
const mcpClient = require('../src/server/services/mcp-client');
const mcpService = require('../src/server/services/mcp-service');
const codexEnvManager = require('../src/server/services/codex-env-manager');
const serverShutdown = require('../src/server/services/server-shutdown');
const { isWindowsLikeRuntime, parsePidsFromNetstatOutput } = portHelper;
const { resolvePreferredHomeDir, isWindowsLikePlatform, normalizeWindowsHomePath } = require('../src/utils/home-dir');

function buildStopSettings(command) {
  return {
    hooks: {
      Stop: [
        {
          hooks: [
            { type: 'command', command }
          ]
        }
      ]
    }
  };
}

function run() {
  const hookTest = claudeHooks._test || {};
  const notificationHookTest = notificationHooks._test || {};
  const mcpClientTest = mcpClient._test || {};
  const mcpServiceTest = mcpService._test || {};
  const codexEnvManagerTest = codexEnvManager._test || {};
  const portHelperTest = portHelper._test || {};
  assert(typeof hookTest.parseStopHookStatus === 'function', '缺少 parseStopHookStatus 测试导出');
  assert(typeof hookTest.buildStopHookCommand === 'function', '缺少 buildStopHookCommand 测试导出');
  assert(typeof hookTest.resolvePreferredHomeDir === 'function', '缺少 resolvePreferredHomeDir 测试导出');
  assert(typeof hookTest.normalizeWindowsHomePath === 'function', '缺少 normalizeWindowsHomePath 测试导出');
  assert(typeof hookTest.shouldRepairStopHook === 'function', '缺少 shouldRepairStopHook 测试导出');
  assert(typeof notificationHookTest.getManagedCommandType === 'function', '缺少 getManagedCommandType 测试导出');
  assert(typeof notificationHookTest.applyClaudeDisablePreference === 'function', '缺少 applyClaudeDisablePreference 测试导出');
  assert(typeof notificationHookTest.parseCodexNotificationStatus === 'function', '缺少 parseCodexNotificationStatus 测试导出');
  assert(typeof notificationHookTest.parseGeminiNotificationStatus === 'function', '缺少 parseGeminiNotificationStatus 测试导出');
  assert(typeof notificationHookTest.parseOpenCodeNotificationStatus === 'function', '缺少 parseOpenCodeNotificationStatus 测试导出');
  assert(typeof notificationHookTest.validateFeishuWebhookUrl === 'function', '缺少 validateFeishuWebhookUrl 测试导出');
  assert(typeof notificationHookTest.buildOpenCodePluginContent === 'function', '缺少 buildOpenCodePluginContent 测试导出');
  assert(typeof mcpClientTest.createMissingCommandHint === 'function', '缺少 createMissingCommandHint 测试导出');
  assert(typeof mcpClientTest.buildMissingCommandMessage === 'function', '缺少 buildMissingCommandMessage 测试导出');
  assert(typeof mcpServiceTest.buildMcpFailureResult === 'function', '缺少 buildMcpFailureResult 测试导出');
  assert(typeof codexEnvManagerTest.buildWindowsEnvBatchScript === 'function', '缺少 buildWindowsEnvBatchScript 测试导出');
  assert(typeof portHelperTest.createPortToolIssue === 'function', '缺少 createPortToolIssue 测试导出');
  assert(typeof portHelperTest.formatPortToolIssue === 'function', '缺少 formatPortToolIssue 测试导出');
  assert(typeof serverShutdown.attachServerShutdownHandling === 'function', '缺少 attachServerShutdownHandling 导出');
  assert(typeof serverShutdown.expediteServerShutdown === 'function', '缺少 expediteServerShutdown 导出');

  assert(DEFAULT_CONFIG && typeof DEFAULT_CONFIG === 'object', '默认配置应存在');
  assert(DEFAULT_CONFIG.ports && typeof DEFAULT_CONFIG.ports === 'object', '默认配置中缺少 ports');
  assert(DEFAULT_CONFIG.defaultModels && typeof DEFAULT_CONFIG.defaultModels === 'object', '默认配置中缺少 defaultModels');
  assert.strictEqual(isWindowsLikePlatform('win32', {}), true, 'win32 应识别为 Windows 平台');
  assert.strictEqual(normalizeWindowsHomePath('/c/Users/wjx', { SYSTEMDRIVE: 'C:' }), path.win32.normalize('C:\\Users\\wjx'), 'home-dir MSYS 路径转换失败');
  assert.strictEqual(
    resolvePreferredHomeDir(
      'win32',
      {
        USERPROFILE: 'C:\\Users\\wjx',
        HOME: '/Users/wjx',
        SYSTEMDRIVE: 'C:'
      },
      'C:\\Program Files\\Git\\Users\\wjx'
    ),
    path.win32.normalize('C:\\Users\\wjx'),
    'home-dir 应优先选择真实 USERPROFILE'
  );
  assert.strictEqual(isWindowsLikeRuntime('win32', {}), true, 'win32 应识别为 Windows');
  assert.strictEqual(
    isWindowsLikeRuntime('linux', { SYSTEMROOT: 'C:\\Windows', USERPROFILE: 'C:\\Users\\wjx' }),
    true,
    '带 Windows 环境变量时应识别为 Windows 运行时'
  );
  assert.strictEqual(
    isWindowsLikeRuntime('linux', { SYSTEMROOT: 'C:\\Windows', HOMEDRIVE: 'C:', HOMEPATH: '\\Users\\wjx' }),
    true,
    '带 HOMEDRIVE/HOMEPATH 时应识别为 Windows 运行时'
  );
  assert.strictEqual(
    isWindowsLikeRuntime('linux', { HOME: '/home/test' }),
    false,
    '纯 Linux 环境不应识别为 Windows'
  );

  const netstatSample = [
    '  TCP    0.0.0.0:19999      0.0.0.0:0      LISTENING       1234',
    '  TCP    127.0.0.1:19999    127.0.0.1:52331 ESTABLISHED     1234',
    '  TCP    0.0.0.0:20000      0.0.0.0:0      LISTENING       5678'
  ].join('\n');
  const parsedPids = parsePidsFromNetstatOutput(netstatSample, 19999);
  assert.deepStrictEqual(parsedPids, ['1234'], 'netstat 端口解析应返回唯一 PID');

  const unixPortToolIssue = portHelperTest.createPortToolIssue('lsof / fuser', 'lookup', false);
  const unixPortToolLines = portHelperTest.formatPortToolIssue(unixPortToolIssue);
  assert.strictEqual(unixPortToolLines[0].includes('lsof / fuser'), true, 'Unix 缺少工具提示应包含命令名');
  assert.strictEqual(unixPortToolLines.some(line => line.includes('安装 `lsof`')), true, 'Unix 缺少工具提示应提醒安装 lsof');
  const missingMcpHint = mcpClientTest.createMissingCommandHint('npx', 'npx', { PATH: '/usr/local/bin:/usr/bin:/bin' });
  const missingMcpCommandHint = mcpClientTest.buildMissingCommandMessage('npx', 'npx', { PATH: '/usr/local/bin:/usr/bin:/bin' });
  assert.strictEqual(missingMcpHint.title.includes('npx'), true, 'MCP 缺少命令 hint 应包含命令名');
  assert.strictEqual(missingMcpHint.details.some(line => line.includes('Node.js')), true, 'npx 缺失时应提醒安装 Node.js');
  assert.strictEqual(missingMcpCommandHint.includes('命令 "npx" 未找到'), true, 'MCP 缺少命令提示应包含命令名');
  assert.strictEqual(missingMcpCommandHint.includes('当前 PATH 前 5 项'), true, 'MCP 缺少命令提示应包含 PATH 提示');
  const mcpFailure = mcpServiceTest.buildMcpFailureResult({ data: { hint: missingMcpHint } }, 'spawn failed', 321);
  assert.strictEqual(mcpFailure.message, missingMcpHint.title, 'MCP 服务错误结果应优先采用 hint 标题');
  assert.strictEqual(mcpFailure.hint, missingMcpHint, 'MCP 服务错误结果应透传 hint');
  const winEnvBatchScript = codexEnvManagerTest.buildWindowsEnvBatchScript([
    { key: 'CC_PROXY_KEY', value: 'PROXY_KEY' },
    { key: 'OLD_PROXY_KEY', remove: true }
  ]);
  assert.strictEqual(winEnvBatchScript.includes("SetEnvironmentVariable('CC_PROXY_KEY', 'PROXY_KEY', 'User')"), true, 'Windows 批量环境变量脚本应包含写入命令');
  assert.strictEqual(winEnvBatchScript.includes("SetEnvironmentVariable('OLD_PROXY_KEY', $null, 'User')"), true, 'Windows 批量环境变量脚本应包含删除命令');
  assert.strictEqual(winEnvBatchScript.includes('SendMessageTimeout'), true, 'Windows 批量环境变量脚本应包含环境刷新广播');

  const configPath = getConfigFilePath();
  assert(configPath.startsWith(path.join(os.homedir(), '.cc-tool')), '配置文件路径应位于 ~/.cc-tool 下');
  assert.strictEqual(configPath, PATHS.configFile, '配置文件路径应与 PATHS.configFile 一致');
  assert.strictEqual(PATHS.configFile, path.join(os.homedir(), '.cc-tool', 'config', 'config.json'), '主配置应迁移到 config/ 子目录');
  assert.strictEqual(PATHS.channels.claude, path.join(os.homedir(), '.cc-tool', 'storage', 'channels', 'claude.json'), 'Claude 渠道配置应迁移到 storage/channels');
  assert.strictEqual(PATHS.activeChannel.claude, path.join(os.homedir(), '.cc-tool', 'storage', 'channels', 'active', 'claude.json'), 'Claude active channel 应迁移到 storage/channels/active');
  assert.strictEqual(PATHS.notifyHook, path.join(os.homedir(), '.cc-tool', 'storage', 'scripts', 'notify-hook.js'), '通知脚本应迁移到 storage/scripts');
  assert(expandHome('~/.claude/projects').startsWith(os.homedir()), 'expandHome 未正确展开 ~');

  const spoofedRemoteReq = {
    headers: { 'x-forwarded-for': '127.0.0.1' },
    socket: { remoteAddress: '198.51.100.42' }
  };
  assert(!isLoopbackRequest(spoofedRemoteReq), '远程来源不应仅凭 x-forwarded-for 通过本机校验');

  const localReq = {
    headers: {},
    socket: { remoteAddress: '127.0.0.1' }
  };
  assert(isLoopbackRequest(localReq), '本机来源应通过校验');
  assert.strictEqual(
    isSameOriginRequest({ headers: { origin: 'http://127.0.0.1:19999', host: '127.0.0.1:19999' } }),
    true,
    '同源请求应通过校验'
  );
  assert.strictEqual(
    isSameOriginRequest({ headers: { origin: 'https://evil.example', host: '127.0.0.1:19999' } }),
    false,
    '跨源请求不应通过校验'
  );

  const dialogMarkerStatus = hookTest.parseStopHookStatus(
    buildStopSettings('node "/tmp/notify-hook.js" --cc-notify-type=dialog')
  );
  assert.deepStrictEqual(dialogMarkerStatus, { enabled: true, type: 'dialog' }, 'marker=dialog 解析失败');

  const notificationMarkerStatus = hookTest.parseStopHookStatus(
    buildStopSettings('node "/tmp/notify-hook.js" --cc-notify-type=notification')
  );
  assert.deepStrictEqual(notificationMarkerStatus, { enabled: true, type: 'notification' }, 'marker=notification 解析失败');

  const legacyToastStatus = hookTest.parseStopHookStatus(
    buildStopSettings('powershell -Command "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier(\'Coding Tool\')"')
  );
  assert.deepStrictEqual(legacyToastStatus, { enabled: true, type: 'notification' }, 'Windows toast 签名解析失败');

  const windowsPopupStatus = hookTest.parseStopHookStatus(
    buildStopSettings('powershell -NoProfile -Command "$wshell = New-Object -ComObject Wscript.Shell; $wshell.Popup(\'任务已完成 | 等待交互\', 5, \'Coding Tool\', 0x40)"')
  );
  assert.deepStrictEqual(windowsPopupStatus, { enabled: true, type: 'notification' }, 'Windows Popup 签名解析失败');

  const legacyDialogStatus = hookTest.parseStopHookStatus(
    buildStopSettings('powershell -Command "[System.Windows.MessageBox]::Show(\'Done\')"')
  );
  assert.deepStrictEqual(legacyDialogStatus, { enabled: true, type: 'dialog' }, 'Windows MessageBox 签名解析失败');

  const stopHookDialogCommand = hookTest.buildStopHookCommand('dialog');
  assert(stopHookDialogCommand.includes('--cc-notify-type=dialog'), 'Stop hook command 应包含 dialog marker');
  assert(stopHookDialogCommand.includes(PATHS.notifyHook), 'Stop hook command 应引用新的 notify-hook 路径');

  const stopHookNotificationCommand = hookTest.buildStopHookCommand('notification');
  assert(stopHookNotificationCommand.includes('--cc-notify-type=notification'), 'Stop hook command 应包含 notification marker');

  assert.strictEqual(
    notificationHookTest.getManagedCommandType('node "/tmp/notify-hook.js" --mode=dialog'),
    'dialog',
    '统一通知命令应能识别 dialog 模式'
  );

  const codexManagedStatus = notificationHookTest.parseCodexNotificationStatus({
    notify: notificationHookTest.buildCodexNotifyCommand('dialog')
  });
  assert.deepStrictEqual(
    codexManagedStatus,
    { enabled: true, external: false, type: 'dialog', method: 'notify' },
    'Codex 托管 notify 状态解析失败'
  );

  const codexExternalStatus = notificationHookTest.parseCodexNotificationStatus({
    notify: ['bash', '-lc', 'echo done']
  });
  assert.deepStrictEqual(
    codexExternalStatus,
    { enabled: false, external: true, type: 'notification', method: 'notify' },
    'Codex 外部 notify 状态解析失败'
  );

  const geminiManagedStatus = notificationHookTest.parseGeminiNotificationStatus({
    hooks: {
      AfterAgent: [
        {
          matcher: '*',
          hooks: [
            {
              name: 'coding-tool-notify',
              type: 'command',
              command: 'node "/tmp/notify-hook.js" --cc-notify-type=notification'
            }
          ]
        }
      ]
    }
  });
  assert.deepStrictEqual(
    geminiManagedStatus,
    { enabled: true, external: false, type: 'notification', method: 'AfterAgent Hook' },
    'Gemini 托管 Hook 状态解析失败'
  );

  const geminiExternalStatus = notificationHookTest.parseGeminiNotificationStatus({
    hooks: {
      AfterAgent: [
        {
          matcher: '*',
          hooks: [
            {
              name: 'custom-hook',
              type: 'command',
              command: 'python /tmp/custom.py'
            }
          ]
        }
      ]
    }
  });
  assert.deepStrictEqual(
    geminiExternalStatus,
    { enabled: false, external: true, type: 'notification', method: 'AfterAgent Hook' },
    'Gemini 外部 Hook 状态解析失败'
  );

  assert.deepStrictEqual(
    notificationHookTest.applyClaudeDisablePreference({ foo: 'bar' }, false),
    { foo: 'bar', claudeNotificationDisabledByUser: true },
    '关闭 Claude 通知时应写入用户禁用标记'
  );
  assert.deepStrictEqual(
    notificationHookTest.applyClaudeDisablePreference({ claudeNotificationDisabledByUser: true, foo: 'bar' }, true),
    { foo: 'bar' },
    '重新开启 Claude 通知时应清除用户禁用标记'
  );

  const openCodePluginContent = notificationHookTest.buildOpenCodePluginContent('dialog');
  const openCodeStatus = notificationHookTest.parseOpenCodeNotificationStatus(openCodePluginContent);
  assert.deepStrictEqual(
    openCodeStatus,
    { enabled: true, external: false, type: 'dialog', method: 'Plugin Events' },
    'OpenCode 插件通知状态解析失败'
  );
  assert(openCodePluginContent.includes(PATHS.notifyHook), 'OpenCode 插件应引用共享 notify-hook 脚本');
  assert(openCodePluginContent.includes('session.idle'), 'OpenCode 插件应监听 session.idle');
  assert(openCodePluginContent.includes('session.error'), 'OpenCode 插件应监听 session.error');
  assert.strictEqual(
    notificationHookTest.validateFeishuWebhookUrl('https://open.feishu.cn/open-apis/bot/v2/hook/test').hostname,
    'open.feishu.cn',
    '飞书 Webhook 域名校验失败'
  );
  assert.throws(
    () => notificationHookTest.validateFeishuWebhookUrl('http://example.com/webhook'),
    /飞书 Webhook|open\.feishu\.cn|HTTPS/,
    '非飞书或非 HTTPS 的 Webhook 应被拒绝'
  );

  const normalizedMsysHome = hookTest.normalizeWindowsHomePath('/c/Users/wjx', { SYSTEMDRIVE: 'C:' });
  assert.strictEqual(normalizedMsysHome, path.win32.normalize('C:\\Users\\wjx'), 'MSYS home 路径转换失败');

  const preferredWindowsHome = hookTest.resolvePreferredHomeDir(
    'win32',
    {
      USERPROFILE: 'C:\\Users\\wjx',
      HOMEDRIVE: 'C:',
      HOMEPATH: '\\Users\\wjx',
      HOME: '/Users/wjx',
      SYSTEMDRIVE: 'C:'
    },
    'C:\\Program Files\\Git\\Users\\wjx'
  );
  assert.strictEqual(preferredWindowsHome, path.win32.normalize('C:\\Users\\wjx'), 'Windows 主目录应优先使用 USERPROFILE');

  const oldWindowsHookSettings = buildStopSettings(
    'node "C:\\Program Files\\Git\\Users\\wjx\\.cc-tool\\notify-hook.js" --cc-notify-type=notification'
  );
  const repairedByPathMismatch = hookTest.shouldRepairStopHook(
    oldWindowsHookSettings,
    'C:\\Users\\wjx\\.cc-tool\\notify-hook.js',
    () => true
  );
  assert.strictEqual(repairedByPathMismatch, true, '旧版 Git 安装路径应触发 Stop hook 修复');

  const healthyWindowsHookSettings = buildStopSettings(
    'node "C:\\Users\\wjx\\.cc-tool\\notify-hook.js" --cc-notify-type=notification'
  );
  const noRepairForHealthyPath = hookTest.shouldRepairStopHook(
    healthyWindowsHookSettings,
    'C:\\Users\\wjx\\.cc-tool\\notify-hook.js',
    () => true
  );
  assert.strictEqual(noRepairForHealthyPath, false, '正确路径且脚本存在时不应触发修复');

  const repairedByMissingScript = hookTest.shouldRepairStopHook(
    healthyWindowsHookSettings,
    'C:\\Users\\wjx\\.cc-tool\\notify-hook.js',
    () => false
  );
  assert.strictEqual(repairedByMissingScript, true, '脚本缺失时应触发 Stop hook 修复');

  const legacyBareHookSettings = buildStopSettings(
    'node "/Users/zhangzeao/.cc-tool/notify-hook.js"'
  );
  const repairedByMissingMarker = hookTest.shouldRepairStopHook(
    legacyBareHookSettings,
    '/Users/zhangzeao/.cc-tool/storage/scripts/notify-hook.js',
    () => true
  );
  assert.strictEqual(repairedByMissingMarker, true, '旧版无 marker 的 notify-hook 路径也应触发 Stop hook 修复');

  console.log('基础测试通过');
}

run();
