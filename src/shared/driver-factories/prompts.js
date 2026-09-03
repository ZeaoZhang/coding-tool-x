'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { ok, failed } = require('../driver-result');

function createPromptDriver({ platform, ...context } = {}) {
  const { NATIVE_PATHS } = require('../../config/paths');
  const { resolvePreferredHomeDir } = require('../../utils/home-dir');
  const home = resolvePreferredHomeDir(process.platform, process.env, os.homedir());
  const native = NATIVE_PATHS || {};
  const claudeDir = native.claude?.dir || path.dirname(native.claude?.settings || '') || path.join(home, '.claude');
  const paths = {
    claude: native.claude?.prompt || path.join(claudeDir, 'CLAUDE.md'),
    codex: path.join(home, '.codex', 'AGENTS.md'),
    gemini: path.join(home, '.gemini', 'GEMINI.md'),
    opencode: path.join(native.opencode?.config || path.join(home, '.config', 'opencode'), 'AGENTS.md'),
    omp: native.omp?.prompt || path.join(native.omp?.dir || path.join(home, '.omp', 'agent'), 'AGENTS.md')
  };
  const promptPath = paths[platform];
  const read = () => fs.existsSync(promptPath) ? fs.readFileSync(promptPath, 'utf8') : '';
  const write = content => {
    if (typeof content !== 'string') throw new Error('提示词内容必须是字符串');
    fs.mkdirSync(path.dirname(promptPath), { recursive: true });
    fs.writeFileSync(promptPath, content, 'utf8');
    return content;
  };
  const remove = () => {
    if (!fs.existsSync(promptPath)) return true;
    fs.unlinkSync(promptPath);
    return true;
  };
  const invoke = (operation, args) => {
    try {
      const value = { read, write, remove }[operation](...args);
      return ok(platform, 'prompts', operation, value);
    } catch (error) {
      return failed(platform, 'prompts', operation, error);
    }
  };
  return {
    platform,
    capability: 'prompts',
    path: promptPath,
    read: (...args) => invoke('read', args),
    write: (...args) => invoke('write', args),
    remove: (...args) => invoke('remove', args)
  };
}

module.exports = { createPromptDriver };
