const { readOmpSettings, writeOmpSettings } = require('./omp-config');

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
  const source = isPlainObject(skills) ? skills : {};
  return Object.fromEntries(OMP_SKILL_SETTING_KEYS.map((key) => [
    key,
    typeof source[key] === 'boolean'
      ? source[key]
      : OMP_SKILL_SETTING_DEFAULTS[key]
  ]));
}

function readOmpSkillSettings() {
  const config = readOmpSettings();
  return selectOmpSkillSettings(isPlainObject(config) ? config.skills : undefined);
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

  return patch;
}

function updateOmpSkillSettings(patch) {
  validateOmpSkillSettingsPatch(patch);

  const storedConfig = readOmpSettings();
  const config = isPlainObject(storedConfig) ? storedConfig : {};
  const existingSkills = isPlainObject(config.skills) ? config.skills : {};
  const nextConfig = {
    ...config,
    skills: {
      ...existingSkills,
      ...patch
    }
  };

  writeOmpSettings(nextConfig);
  return selectOmpSkillSettings(nextConfig.skills);
}

module.exports = {
  OMP_SKILL_SETTING_DEFAULTS,
  OMP_SKILL_SETTING_KEYS,
  readOmpSkillSettings,
  updateOmpSkillSettings,
  validateOmpSkillSettingsPatch
};
