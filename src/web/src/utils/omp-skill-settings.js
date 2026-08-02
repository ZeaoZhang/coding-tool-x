export function supportsOmpSkillSettings(platform) {
  return platform === 'omp'
}

export async function completeOmpSkillSettingsSave(closeSettings, refreshSkills) {
  closeSettings()
  await refreshSkills(true)
}
