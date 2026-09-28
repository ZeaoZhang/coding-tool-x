import { client, getPlatformApiPrefix } from './client'

const prefix = getPlatformApiPrefix('dsh')

export async function getDshProfiles() {
  const response = await client.get(`${prefix}/profiles`)
  return response.data?.data?.profiles || response.data?.profiles || []
}

export async function getDshAgentPresets(profile) {
  const response = await client.get(`${prefix}/profiles/${encodeURIComponent(profile)}/agent-presets`)
  return response.data?.data || response.data || {}
}

export async function saveDshAgentPreset(profile, preset, expectedRevision) {
  const response = await client.post(`${prefix}/profiles/${encodeURIComponent(profile)}/agent-presets`, {
    config: preset,
    expectedRevision
  })
  return response.data?.data || response.data || {}
}

export async function deleteDshAgentPreset(profile, presetId, expectedRevision) {
  const response = await client.delete(`${prefix}/profiles/${encodeURIComponent(profile)}/agent-presets/${encodeURIComponent(presetId)}`, {
    data: { expectedRevision }
  })
  return response.data?.data || response.data || {}
}
