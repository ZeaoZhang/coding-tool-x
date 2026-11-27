'use strict';

/**
 * Pure extraction rules for skill usage.
 *
 * Each adapter normalizes the raw tool call it already parses into
 * `{ id, name, args, turnId? }` and stores that array in `extra_json.toolCalls`.
 * These functions turn one such call into zero or more skill targets. No I/O.
 */

const READ_VERBS = new Set(['cat', 'head', 'tail', 'sed']);

function normalizeSkillName(raw) {
  if (typeof raw !== 'string') return '';
  let value = raw.trim().toLowerCase();
  if (!value) return '';
  if (value.startsWith('skill://')) value = value.slice('skill://'.length);
  const subpath = value.indexOf('/');
  if (subpath !== -1) value = value.slice(0, subpath);
  // Keep any <namespace>: prefix; stripping it would merge plugin skills into
  // managed skills with the same base name.
  return value.replace(/^\/+|\/+$/g, '');
}

function baseNameOf(raw) {
  const normalized = normalizeSkillName(raw);
  const index = normalized.lastIndexOf(':');
  return index === -1 ? normalized : normalized.slice(index + 1);
}

/**
 * splitSkillPath('/x/skills/foo/SKILL.md') -> { name: 'foo', root: '/x/skills' }
 * Works for user roots and project roots (`<cwd>/.dsh/skills/<name>`).
 */
function splitSkillPath(filePath) {
  if (typeof filePath !== 'string') return null;
  const normalized = filePath.replace(/\\/g, '/');
  const marker = '/skills/';
  const index = normalized.lastIndexOf(marker);
  if (index === -1) return null;
  const rest = normalized.slice(index + marker.length);
  const name = rest.split('/')[0];
  if (!name) return null;
  return {
    name,
    root: normalized.slice(0, index + marker.length - 1)
  };
}

function isUnderSkillRoot(filePath, roots = []) {
  if (typeof filePath !== 'string') return false;
  const normalized = filePath.replace(/\\/g, '/');
  return roots.some(root => {
    const prefix = String(root || '').replace(/\\/g, '/').replace(/\/+$/, '');
    return prefix && normalized.startsWith(`${prefix}/`);
  });
}

/**
 * Extract the first explicit read of a path from a shell command.
 * `cd <dir> && sed -n 1,20p SKILL.md` is the common shape.
 */
function readPathFromCommand(command) {
  if (typeof command !== 'string' || !command.trim()) return null;
  if (!/(?:^|[\s;&|])(cat|head|tail|sed)\s+/.test(command)) return null;
  if (/\bsed\s+-i\b/.test(command)) return null;
  const cdMatch = command.match(/\bcd\s+([^\s;&|]+)/);
  const cwd = cdMatch ? cdMatch[1] : '';
  const token = (command.match(/[^\s;&|]+\.md\b/) || command.match(/[^\s;&|]*\/skills\/[^\s;&|]+/) || [])[0];
  if (!token) return null;
  const cleaned = token.replace(/^["']|["']$/g, '');
  if (cleaned.startsWith('/')) return cleaned;
  if (cwd) return `${cwd.replace(/\/+$/, '')}/${cleaned.replace(/^\.\//, '')}`;
  return cleaned;
}

function pathFromArgs(args = {}) {
  if (!args || typeof args !== 'object') return null;
  const candidate = args.file_path || args.filePath || args.path || args.target_file || args.filename;
  return typeof candidate === 'string' ? candidate : null;
}

function commandFromArgs(args = {}) {
  if (!args || typeof args !== 'object') return null;
  const candidate = args.command || args.cmd || args.script;
  return typeof candidate === 'string' ? candidate : null;
}

function nameTarget(rawName) {
  const normalized = normalizeSkillName(rawName);
  if (!normalized) return null;
  return {
    rawName,
    rawTarget: rawName,
    targetKind: 'name',
    normalizedName: normalized,
    skillRoot: null
  };
}

function pathTarget(filePath) {
  if (typeof filePath !== 'string' || !filePath.trim()) return null;
  const parsed = splitSkillPath(filePath);
  if (!parsed) return null;
  return {
    rawName: parsed.name,
    rawTarget: filePath,
    targetKind: 'path',
    normalizedName: normalizeSkillName(parsed.name),
    skillRoot: parsed.root
  };
}

/**
 * @param {string} platform
 * @param {{id?: string, name?: string, args?: object}} call
 * @returns {Array<{callId: string, rawName: string, rawTarget: string,
 *   targetKind: 'name'|'path', normalizedName: string, skillRoot: string|null}>}
 */
function extractSkillTargets(platform, call = {}) {
  const id = typeof call.id === 'string' ? call.id : '';
  const name = typeof call.name === 'string' ? call.name : '';
  const args = call.args && typeof call.args === 'object' ? call.args : {};
  const targets = [];
  const push = (target) => {
    if (!target || !target.normalizedName) return;
    targets.push({ callId: id, ...target });
  };

  if (platform === 'claude') {
    if (name === 'Skill' && typeof args.skill === 'string') push(nameTarget(args.skill));
    return targets;
  }

  if (platform === 'omp') {
    const path = pathFromArgs(args);
    if (name === 'read' && typeof path === 'string' && path.startsWith('skill://')) {
      push(nameTarget(path.slice('skill://'.length)));
    }
    return targets;
  }

  if (platform === 'codex') {
    // The codex parser emits one synthetic `read` call per parsed_cmd entry.
    if (name === 'read') push(pathTarget(pathFromArgs(args)));
    return targets;
  }

  if (platform === 'gemini' || platform === 'opencode') {
    const path = pathFromArgs(args);
    if (path) push(pathTarget(path));
    const command = commandFromArgs(args);
    if (!path && command) push(pathTarget(readPathFromCommand(command)));
    return targets;
  }

  if (platform === 'dsh') {
    const path = pathFromArgs(args);
    if (name === 'read' && path) push(pathTarget(path));
    if (name === 'bash') push(pathTarget(readPathFromCommand(commandFromArgs(args))));
    return targets;
  }

  return targets;
}

module.exports = {
  normalizeSkillName,
  baseNameOf,
  splitSkillPath,
  isUnderSkillRoot,
  readPathFromCommand,
  extractSkillTargets
};
