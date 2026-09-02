const {
  readOmpSettingsStrict,
  writeOmpSettingsAtomic
} = require('./config');

const OMP_SKILL_SETTING_DEFAULTS = Object.freeze({
  enableCodexUser: true,
  enableClaudeUser: true,
  enablePiUser: true,
  enablePiProject: true
});
const OMP_SKILL_SETTING_KEYS = Object.freeze(Object.keys(OMP_SKILL_SETTING_DEFAULTS));
const OMP_SKILL_SETTING_KEY_SET = new Set(OMP_SKILL_SETTING_KEYS);

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function selectOmpSkillSettings(skills) {
  const source = skills || {};
  const selected = {};
  for (const key of OMP_SKILL_SETTING_KEYS) {
    selected[key] = Object.prototype.hasOwnProperty.call(source, key)
      ? source[key]
      : OMP_SKILL_SETTING_DEFAULTS[key];
  }
  return selected;
}

function validatePersistedOmpSkillSettings(config) {
  if (!Object.prototype.hasOwnProperty.call(config, 'skills')) {
    return {};
  }
  if (!isPlainObject(config.skills)) {
    throw new Error('Invalid OMP config skills');
  }

  for (const key of OMP_SKILL_SETTING_KEYS) {
    if (
      Object.prototype.hasOwnProperty.call(config.skills, key) &&
      typeof config.skills[key] !== 'boolean'
    ) {
      throw new Error(`Invalid OMP skill setting value for ${key}: expected boolean`);
    }
  }
  return config.skills;
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
  const config = readOmpSettingsStrict();
  return selectOmpSkillSettings(validatePersistedOmpSkillSettings(config));
}

function updateOmpSkillSettings(patch) {
  validateOmpSkillSettingsPatch(patch);

  const config = readOmpSettingsStrict();
  const existingSkills = validatePersistedOmpSkillSettings(config);
  if (Object.keys(patch).length === 0) {
    return selectOmpSkillSettings(existingSkills);
  }

  const nextConfig = {
    ...config,
    skills: {
      ...existingSkills,
      ...patch
    }
  };

  writeOmpSettingsAtomic(nextConfig);
  return selectOmpSkillSettings(nextConfig.skills);
}

module.exports = {
  readOmpSkillSettings,
  updateOmpSkillSettings
};
