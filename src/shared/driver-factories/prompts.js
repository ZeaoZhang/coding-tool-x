'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { ok, failed } = require('../driver-result');

function createPromptDriver({ platform, ...context } = {}) {
  const { NATIVE_PATHS } = require('../../config/paths');
  const { resolvePreferredHomeDir } = require('../../utils/home-dir');
  const pathContext = context.pathContext || {};
  const home = pathContext.home || resolvePreferredHomeDir(process.platform, process.env, os.homedir());
  const configuredNative = pathContext.native || {};
  const native = configuredNative[platform]
    ? configuredNative[platform]
    : configuredNative;
  const legacyNative = NATIVE_PATHS || {};
  const claudeDir = native.dir || legacyNative.claude?.dir || path.dirname(legacyNative.claude?.settings || '') || path.join(home, '.claude');
  const paths = {
    claude: native.prompt || legacyNative.claude?.prompt || path.join(claudeDir, 'CLAUDE.md'),
    codex: native.prompt || legacyNative.codex?.prompt || path.join(native.dir || legacyNative.codex?.dir || path.join(home, '.codex'), 'AGENTS.md'),
    gemini: native.prompt || legacyNative.gemini?.prompt || path.join(native.dir || legacyNative.gemini?.dir || path.join(home, '.gemini'), 'GEMINI.md'),
    opencode: native.prompt || legacyNative.opencode?.prompt || path.join(native.config || legacyNative.opencode?.config || path.join(home, '.config', 'opencode'), 'AGENTS.md'),
    omp: native.prompt || legacyNative.omp?.prompt || path.join(native.dir || legacyNative.omp?.dir || path.join(home, '.omp', 'agent'), 'AGENTS.md')
  };
  const promptPath = paths[platform] || native.prompt;
  if (!promptPath) throw new Error(`Prompt path is not configured for ${platform}`);
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
