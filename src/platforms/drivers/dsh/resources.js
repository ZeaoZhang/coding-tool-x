'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');

const {
  isObject,
  redactSecrets,
  readProfilePatchContributions,
  resolvePaths,
  writeAtomic
} = require('./common');

const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SKILL_FILESYSTEM_PLUGIN = '@deepseek-ai/dsh-skill-filesystem';

const ROOT_RANKS = Object.freeze({
  'project-dsh': 100,
  'project-agents': 200,
  custom: 300,
  'user-dsh': 400,
  'user-agents': 500,
  bundled: 600
});

function resolveSkillConfig(context = {}, profileName) {
  const config = {};
  if (!profileName) return config;
  const info = readProfilePatchContributions(context, profileName);
  if (!info) return config;
  for (const { rows } of info.contributions) {
    for (const row of rows) {
      if (row.name !== SKILL_FILESYSTEM_PLUGIN || !isObject(row.config)) continue;
      Object.assign(config, row.config);
    }
  }
  return config;
}

function findProjectRoot(cwd) {
  let current = path.resolve(cwd || process.cwd());
  try {
    if (!fs.statSync(current).isDirectory()) current = path.dirname(current);
  } catch (_) {}
  while (true) {
    if (fs.existsSync(path.join(current, '.git'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(cwd || process.cwd());
    current = parent;
  }
}

function pathIsReadableDirectory(value) {
  try { return fs.statSync(value).isDirectory(); } catch (_) { return false; }
}

function addRoot(roots, rootPath, source) {
  if (typeof rootPath !== 'string' || !rootPath.trim()) return;
  const resolved = path.resolve(rootPath);
  if (roots.some(root => root.path === resolved)) return;
  roots.push({ path: resolved, source, rank: ROOT_RANKS[source] || ROOT_RANKS.custom });
}

function resolveSkillRoots(context = {}, options = {}) {
  const paths = resolvePaths(context);
  const profileName = options.profile || null;
  const skillConfig = resolveSkillConfig(context, profileName);
  const includeDefaultRoots = skillConfig.includeDefaultRoots !== false;
  const roots = [];
  const cwd = options.cwd ? path.resolve(options.cwd) : process.cwd();

  if (includeDefaultRoots) {
    const projectRoot = findProjectRoot(cwd);
    addRoot(roots, path.join(projectRoot, '.dsh', 'skills'), 'project-dsh');
    addRoot(roots, path.join(projectRoot, '.agents', 'skills'), 'project-agents');
  }

  const customSkillDirs = Array.isArray(skillConfig.customSkillDirs)
    ? skillConfig.customSkillDirs
    : [];
  for (const root of customSkillDirs) addRoot(roots, root, 'custom');

  if (includeDefaultRoots) {
    addRoot(roots, path.join(skillConfig.dshHome || paths.dir, 'skills'), 'user-dsh');
    addRoot(roots, path.join(skillConfig.agentsHome || process.env.DSH_AGENTS_HOME || path.join(os.homedir(), '.agents'), 'skills'), 'user-agents');
  }

  const bundledSkillDir = skillConfig.bundledSkillDir || process.env.DSH_BUNDLED_SKILL_DIR;
  if (bundledSkillDir) addRoot(roots, bundledSkillDir, 'bundled');

  return { cwd, profile: profileName, roots, config: skillConfig };
}

function readSkillFrontmatter(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const firstLine = raw.startsWith('\uFEFF') ? raw.slice(1) : raw;
  if (!firstLine.startsWith('---\n') && !firstLine.startsWith('---\r\n')) return null;
  const match = /^(?:---\r?\n)([\s\S]*?)(?:\r?\n---\r?\n|\r?\n---$)/.exec(firstLine);
  if (!match) return null;
  const parsed = yaml.load(match[1], { schema: yaml.SAFE_SCHEMA });
  if (!isObject(parsed)) return null;
  const name = typeof parsed.name === 'string' ? parsed.name.trim() : '';
  const description = typeof parsed.description === 'string' ? parsed.description.trim() : '';
  if (!SKILL_NAME.test(name) || !description) return null;
  const disableModelInvocation = parseFrontmatterBoolean(parsed['disable-model-invocation'], false);
  const userInvocable = parseFrontmatterBoolean(parsed['user-invocable'], true);
  const bodyStart = match[0].length;
  const content = firstLine.slice(bodyStart).trim();
  return {
    name,
    description,
    ...(typeof parsed.whenToUse === 'string' && parsed.whenToUse.trim()
      ? { whenToUse: parsed.whenToUse.trim() }
      : {}),
    invocation: { modelInvocable: !disableModelInvocation, userInvocable },
    ...(isObject(parsed.metadata) ? { metadata: redactSecrets(parsed.metadata) } : {}),
    content
  };
}

function parseFrontmatterBoolean(value, fallback) {
  if (value === undefined) return fallback;
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  if (typeof value === 'string') {
    if (['true', 'yes', 'on', '1'].includes(value.toLowerCase())) return true;
    if (['false', 'no', 'off', '0'].includes(value.toLowerCase())) return false;
  }
  return fallback;
}

function directoryEntryType(fullPath, entry) {
  if (entry.isDirectory()) return 'directory';
  if (entry.isFile()) return 'file';
  if (!entry.isSymbolicLink()) return null;
  try {
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) return 'directory';
    if (stat.isFile()) return 'file';
  } catch (_) {}
  return null;
}

function discoverRoot(root) {
  if (!pathIsReadableDirectory(root.path)) return [];
  let entries;
  try {
    entries = fs.readdirSync(root.path, { withFileTypes: true });
  } catch (_) {
    return [];
  }
  const skills = [];
  for (const entry of entries) {
    if (root.source === 'user-dsh' && entry.name === '.system') continue;
    const fullPath = path.join(root.path, entry.name);
    const type = directoryEntryType(fullPath, entry);
    const filePath = type === 'directory'
      ? path.join(fullPath, 'SKILL.md')
      : type === 'file' && entry.name.endsWith('.md') ? fullPath : null;
    if (!filePath || !fs.existsSync(filePath)) continue;
    let parsed;
    try { parsed = readSkillFrontmatter(filePath); } catch (_) { parsed = null; }
    if (!parsed) continue;
    skills.push({
      ...parsed,
      path: filePath,
      source: root.source,
      rank: root.rank,
      resourceBase: path.dirname(filePath)
    });
  }
  return skills;
}

function publicSkill(skill, includeContent) {
  const result = {
    name: skill.name,
    description: skill.description,
    ...(skill.whenToUse ? { whenToUse: skill.whenToUse } : {}),
    invocation: skill.invocation,
    source: skill.source,
    path: skill.path,
    resourceBase: skill.resourceBase,
    ...(skill.metadata ? { metadata: skill.metadata } : {})
  };
  if (includeContent) result.content = skill.content;
  return result;
}

function listSkills(context = {}, options = {}) {
  const resolved = resolveSkillRoots(context, options);
  const roots = options.scope === 'project'
    ? resolved.roots.filter(root => root.source.startsWith('project-'))
    : options.scope === 'user'
      ? resolved.roots.filter(root => !root.source.startsWith('project-'))
      : resolved.roots;
  const candidates = roots.flatMap(discoverRoot)
    .sort((left, right) => left.rank - right.rank || left.name.localeCompare(right.name) || left.path.localeCompare(right.path));
  const winners = new Map();
  for (const candidate of candidates) {
    if (!winners.has(candidate.name)) winners.set(candidate.name, candidate);
  }
  const includeContent = options.includeContent === true;
  return {
    profile: resolved.profile,
    cwd: resolved.cwd,
    roots: roots.map(root => ({
      path: root.path,
      source: root.source,
      exists: pathIsReadableDirectory(root.path)
    })),
    skills: [...winners.values()]
      .sort((left, right) => left.name.localeCompare(right.name))
      .map(skill => publicSkill(skill, includeContent)),
    management: 'ctx',
    note: 'skill 文件由 DSH skill-filesystem 发现和加载；ctx 管理 user/project skill 文件，不接管 DSH 运行时注册。'
  };
}

function getSkill(context = {}, profileName, skillName, options = {}) {
  const result = listSkills(context, { ...options, profile: profileName, includeContent: true });
  const skill = result.skills.find(entry => entry.name === skillName);
  return skill ? { ...result, skill } : null;
}

function resolveManagedSkillRoot(context = {}, options = {}) {
  const scope = options.scope || 'user';
  const resolved = resolveSkillRoots(context, { profile: options.profile, cwd: options.cwd });
  const source = scope === 'project' ? 'project-dsh' : scope === 'user' ? 'user-dsh' : null;
  if (!source) throw new Error('DSH skill scope must be user or project');
  const root = resolved.roots.find(entry => entry.source === source);
  if (!root) throw new Error(`DSH ${scope} skill root is unavailable`);
  return { ...root, cwd: resolved.cwd, scope };
}

function isInside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function assertManagedSkillPath(root, filePath) {
  if (!isInside(root.path, filePath)) throw new Error('DSH skill path escapes its managed root');
  const parent = path.dirname(filePath);
  if (fs.existsSync(filePath) && fs.lstatSync(filePath).isSymbolicLink()) throw new Error('DSH skill symlinks cannot be managed');
  if (fs.existsSync(parent) && fs.lstatSync(parent).isSymbolicLink()) throw new Error('DSH skill symlink directories cannot be managed');
}

function normalizeSkillName(value) {
  const name = String(value || '').trim();
  if (!SKILL_NAME.test(name)) throw new Error('DSH skill name must be lowercase kebab-case');
  return name;
}

function skillDocument(body, name) {
  const description = String(body.description || '').trim();
  if (!description) throw new Error('DSH skill description is required');
  const content = String(body.content || '').trim();
  const frontmatter = {
    name,
    description,
    ...(body.whenToUse ? { whenToUse: String(body.whenToUse).trim() } : {}),
    ...(body.userInvocable === false ? { 'user-invocable': false } : {}),
    ...(body.modelInvocable === false ? { 'disable-model-invocation': true } : {}),
    ...(isObject(body.metadata) ? { metadata: body.metadata } : {})
  };
  return `---\n${yaml.dump(frontmatter, { noRefs: true, lineWidth: 120 })}---\n\n${content}\n`;
}

function findManagedSkill(context = {}, name, options = {}) {
  const result = listSkills(context, { profile: options.profile, cwd: options.cwd });
  const skill = result.skills.find(entry => entry.name === name);
  if (!skill) return null;
  const roots = resolveSkillRoots(context, { profile: options.profile, cwd: options.cwd }).roots;
  const root = roots.find(entry => isInside(entry.path, skill.path));
  if (!root || !['project-dsh', 'user-dsh'].includes(root.source)) return null;
  assertManagedSkillPath(root, skill.path);
  return { skill, root };
}

function createSkill(context = {}, request = {}) {
  const body = request.body || {};
  const name = normalizeSkillName(body.name);
  const root = resolveManagedSkillRoot(context, body);
  const directory = path.join(root.path, name);
  const filePath = path.join(directory, 'SKILL.md');
  assertManagedSkillPath(root, filePath);
  if (fs.existsSync(filePath) && body.overwrite !== true) {
    const error = new Error(`DSH skill already exists: ${name}`);
    error.statusCode = 409;
    throw error;
  }
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  writeAtomic(filePath, skillDocument(body, name), 0o600);
  return getSkill(context, body.profile, name, { cwd: body.cwd });
}

function updateSkill(context = {}, request = {}) {
  const body = request.body || {};
  const name = normalizeSkillName(request.params?.skillName || body.name);
  const existing = findManagedSkill(context, name, body);
  const root = existing?.root || resolveManagedSkillRoot(context, body);
  const filePath = existing?.skill.path || path.join(root.path, name, 'SKILL.md');
  assertManagedSkillPath(root, filePath);
  if (!existing && !fs.existsSync(filePath)) {
    const error = new Error(`DSH skill not found: ${name}`);
    error.statusCode = 404;
    throw error;
  }
  const current = existing?.skill || getSkill(context, body.profile, name, { cwd: body.cwd })?.skill;
  writeAtomic(filePath, skillDocument({
    ...current,
    ...body,
    metadata: body.metadata === undefined ? current?.metadata : body.metadata
  }, name), 0o600);
  return getSkill(context, body.profile, name, { cwd: body.cwd });
}

function deleteSkill(context = {}, request = {}) {
  const body = request.body || {};
  const name = normalizeSkillName(request.params?.skillName || body.name);
  const existing = findManagedSkill(context, name, body);
  if (!existing) {
    const error = new Error(`DSH skill not found or is not ctx-managed: ${name}`);
    error.statusCode = 404;
    throw error;
  }
  const filePath = existing.skill.path;
  assertManagedSkillPath(existing.root, filePath);
  if (path.basename(filePath).toLowerCase() === 'skill.md' && path.basename(path.dirname(filePath)) === name) {
    fs.rmSync(path.dirname(filePath), { recursive: true, force: true });
  } else {
    fs.unlinkSync(filePath);
  }
  return { name, removed: true, scope: existing.root.source === 'user-dsh' ? 'user' : 'project' };
}

module.exports = {
  resolveSkillRoots,
  listSkills,
  getSkill,
  createSkill,
  updateSkill,
  deleteSkill
};
