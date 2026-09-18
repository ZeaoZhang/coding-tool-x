'use strict';

const fs = require('fs');
const path = require('path');
const { ok, failed } = require('../../../shared/driver-result');
const { getOmpPaths } = require('./config');

const MANAGED_PROMPT_NAMESPACE = 'coding-tool-x';
const MANAGED_PROMPT_FILE = 'prompt.md';

function resolvePromptsDir(context = {}) {
  const native = context.pathContext?.native || {};
  return native.prompts
    || context.paths?.prompts
    || getOmpPaths(process.env, { resolveRuntime: false }).prompts;
}

function stripFrontmatter(content) {
  return String(content || '').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n(?:\r?\n)?/, '');
}

function buildTemplateContent(content) {
  return `---\ndescription: "coding-tool-x prompt"\n---\n\n${content}`;
}

function createDriver(context = {}) {
  const promptsDir = resolvePromptsDir(context);
  const managedDir = path.join(promptsDir, MANAGED_PROMPT_NAMESPACE);
  const promptPath = path.join(managedDir, MANAGED_PROMPT_FILE);

  const invoke = (operation, args) => {
    try {
      if (operation === 'read') {
        return ok('omp', 'prompts', operation,
          fs.existsSync(promptPath) ? stripFrontmatter(fs.readFileSync(promptPath, 'utf8')) : '');
      }

      if (operation === 'write') {
        const [content] = args;
        if (typeof content !== 'string') throw new Error('提示词内容必须是字符串');
        fs.mkdirSync(managedDir, { recursive: true });
        fs.writeFileSync(promptPath, buildTemplateContent(content), 'utf8');
        return ok('omp', 'prompts', operation, content);
      }

      if (fs.existsSync(managedDir)) {
        fs.rmSync(managedDir, { recursive: true, force: true });
      }
      return ok('omp', 'prompts', operation, true);
    } catch (error) {
      return failed('omp', 'prompts', operation, error);
    }
  };

  return {
    platform: 'omp',
    capability: 'prompts',
    path: managedDir,
    read: (...args) => invoke('read', args),
    write: (...args) => invoke('write', args),
    remove: (...args) => invoke('remove', args)
  };
}

module.exports = { createDriver };
