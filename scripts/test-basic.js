const assert = require('assert');
const path = require('path');
const os = require('os');

const { expandHome, getConfigFilePath } = require('../src/config/loader');
const DEFAULT_CONFIG = require('../src/config/default');
const { isLoopbackRequest } = require('../src/server/services/network-access');

function run() {
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

  console.log('基础测试通过');
}

run();
