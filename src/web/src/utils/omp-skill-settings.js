export function supportsOmpSkillSettings(platform) {
  return platform === 'omp'
}

export async function runOmpSkillSettingsSave(settings, updateSettings, onSaved) {
  const result = await updateSettings(settings)
  await onSaved(result)
  return result
}

export async function refreshAfterOmpSkillSettingsSave(refreshSkills) {
  await refreshSkills(true)
}
