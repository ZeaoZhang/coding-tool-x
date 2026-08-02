export const OMP_SKILL_SETTINGS_KEYS = [
  'enableCodexUser',
  'enableClaudeUser',
  'enablePiUser',
  'enablePiProject'
]

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false

  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
export function validateOmpSkillListResponse(result) {
  if (!isPlainObject(result)) {
    throw new Error('技能列表响应必须是普通对象')
  }
  if (result.success !== true) {
    throw new Error(typeof result.message === 'string' && result.message ? result.message : '技能列表响应未明确标记成功')
  }
  if (!Array.isArray(result.skills)) {
    throw new Error('技能列表响应 skills 必须是数组')
  }

  return result.skills
}

export function validateOmpSkillSettingsResponse(result) {
  if (!isPlainObject(result) || result.success !== true) {
    throw new Error('响应未明确标记成功')
  }

  if (
    !isPlainObject(result.settings) ||
    !OMP_SKILL_SETTINGS_KEYS.every(key => typeof result.settings[key] === 'boolean')
  ) {
    throw new Error('响应 settings 必须包含四个布尔字段')
  }

  return Object.fromEntries(OMP_SKILL_SETTINGS_KEYS.map(key => [key, result.settings[key]]))
}

export function validateOmpSkillSettingsSaveResult(result, submittedSettings) {
  const savedSettings = validateOmpSkillSettingsResponse(result)
  if (!OMP_SKILL_SETTINGS_KEYS.every(key => savedSettings[key] === submittedSettings[key])) {
    throw new Error('响应 settings 与提交值不一致')
  }

  return savedSettings
}

export function supportsOmpSkillSettings(platform) {
  return platform === 'omp'
}

export async function submitOmpSkillSettings(settings, updateSettings) {
  const result = await updateSettings(settings)
  return validateOmpSkillSettingsSaveResult(result, settings)
}

export async function completeOmpSkillSettingsSave(closeSettings, refreshSkills) {
  closeSettings()
  return refreshSkills(true, { notifyError: false })
}
