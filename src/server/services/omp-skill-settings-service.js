const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { getOmpPaths, ensureOmpDir } = require('./omp-config');

const OMP_SKILL_SETTING_DEFAULTS = Object.freeze({
  enableCodexUser: true,
  enableClaudeUser: true,
  enablePiUser: true,
  enablePiProject: true
});
const OMP_SKILL_SETTING_KEYS = Object.freeze(Object.keys(OMP_SKILL_SETTING_DEFAULTS));
const OMP_SKILL_SETTING_KEY_SET = new Set(OMP_SKILL_SETTING_KEYS);
const YAML_DUMP_OPTIONS = Object.freeze({
  lineWidth: 120,
  noRefs: true,
  sortKeys: false
});

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function selectOmpSkillSettings(skills) {
  const source = isPlainObject(skills) ? skills : {};
  const selected = {};
  for (const key of OMP_SKILL_SETTING_KEYS) {
    selected[key] = typeof source[key] === 'boolean'
      ? source[key]
      : OMP_SKILL_SETTING_DEFAULTS[key];
  }
  return selected;
}

function readOmpConfig() {
  const filePath = getOmpPaths().settings;
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const config = yaml.load(fs.readFileSync(filePath, 'utf8'));
  if (!isPlainObject(config)) {
    throw new Error('Invalid OMP config');
  }
  return config;
}

function writeOmpConfig(config) {
  const filePath = getOmpPaths().settings;
  const directory = path.dirname(filePath);
  ensureOmpDir(directory);
  const mode = fs.existsSync(filePath)
    ? fs.statSync(filePath).mode & 0o777
    : 0o600;
  const temporaryPath = path.join(
    directory,
    `.${path.basename(filePath)}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );

  try {
    fs.writeFileSync(temporaryPath, yaml.dump(config, YAML_DUMP_OPTIONS), {
      encoding: 'utf8',
      flag: 'wx',
      mode
    });
    fs.chmodSync(temporaryPath, mode);
    fs.renameSync(temporaryPath, filePath);
  } catch (error) {
    try {
      if (fs.existsSync(temporaryPath)) {
        fs.unlinkSync(temporaryPath);
      }
    } catch (_cleanupError) {
      // Preserve the original write, chmod, or rename failure.
    }
    throw error;
  }
}

function validateOmpSkillSettingsPatch(patch) {
  if (!isPlainObject(patch)) {
    throw new Error('Invalid OMP skill settings: expected an object');
  }

  for (const [key, value] of Object.entries(patch)) {
    if (!OMP_SKILL_SETTING_KEY_SET.has(key)) {
      throw new Error(`Invalid OMP skill setting: ${key}`);
    }
    if (typeof value !== 'boolean') {
      throw new Error(`Invalid OMP skill setting value for ${key}: expected boolean`);
    }
  }
}

function readOmpSkillSettings() {
  const config = readOmpConfig();
  return selectOmpSkillSettings(config.skills);
}

function updateOmpSkillSettings(patch) {
  validateOmpSkillSettingsPatch(patch);

  const config = readOmpConfig();
  if (Object.keys(patch).length === 0) {
    return selectOmpSkillSettings(config.skills);
  }

  const hasSkills = Object.prototype.hasOwnProperty.call(config, 'skills');
  if (hasSkills && !isPlainObject(config.skills)) {
    throw new Error('Invalid OMP config skills');
  }
  const existingSkills = hasSkills ? config.skills : {};

  const nextConfig = {
    ...config,
    skills: {
      ...existingSkills,
      ...patch
    }
  };

  writeOmpConfig(nextConfig);
  return selectOmpSkillSettings(nextConfig.skills);
}

module.exports = {
  readOmpSkillSettings,
  updateOmpSkillSettings
};
