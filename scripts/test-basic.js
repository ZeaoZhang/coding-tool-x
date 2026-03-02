const assert = require('assert');
const path = require('path');
const os = require('os');

const { expandHome, getConfigFilePath } = require('../src/config/loader');
const DEFAULT_CONFIG = require('../src/config/default');
const { isLoopbackRequest } = require('../src/server/services/network-access');
const claudeHooks = require('../src/server/api/claude-hooks');

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
  assert(typeof hookTest.parseStopHookStatus === 'function', '缺少 parseStopHookStatus 测试导出');
  assert(typeof hookTest.buildStopHookCommand === 'function', '缺少 buildStopHookCommand 测试导出');

  assert(DEFAULT_CONFIG && typeof DEFAULT_CONFIG === 'object', '默认配置应存在');
  assert(DEFAULT_CONFIG.ports && typeof DEFAULT_CONFIG.ports === 'object', '默认配置中缺少 ports');
  assert(DEFAULT_CONFIG.defaultModels && typeof DEFAULT_CONFIG.defaultModels === 'object', '默认配置中缺少 defaultModels');

  const configPath = getConfigFilePath();
  assert(configPath.startsWith(path.join(os.homedir(), '.cc-tool')), '配置文件路径应位于 ~/.cc-tool 下');
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

  const legacyDialogStatus = hookTest.parseStopHookStatus(
    buildStopSettings('powershell -Command "[System.Windows.MessageBox]::Show(\'Done\')"')
  );
  assert.deepStrictEqual(legacyDialogStatus, { enabled: true, type: 'dialog' }, 'Windows MessageBox 签名解析失败');

  const stopHookDialogCommand = hookTest.buildStopHookCommand('dialog');
  assert(stopHookDialogCommand.includes('--cc-notify-type=dialog'), 'Stop hook command 应包含 dialog marker');

  const stopHookNotificationCommand = hookTest.buildStopHookCommand('notification');
  assert(stopHookNotificationCommand.includes('--cc-notify-type=notification'), 'Stop hook command 应包含 notification marker');

  console.log('基础测试通过');
}

run();
