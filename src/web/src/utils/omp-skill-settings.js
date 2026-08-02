export function supportsOmpSkillSettings(platform) {
  return platform === 'omp'
}

export async function refreshAfterOmpSkillSettingsSave(refreshSkills) {
  await refreshSkills(true)
}
