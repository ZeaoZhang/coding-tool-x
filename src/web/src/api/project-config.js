import { client } from './client'

function query(projectPath, platform) {
  return { projectPath, platform }
}

export async function getProjectConfig(projectPath, platform) {
  const response = await client.get('/project-config', { params: query(projectPath, platform) })
  return response.data
}

export async function getProjectInstruction(projectPath, platform) {
  const response = await client.get('/project-config/instruction', { params: query(projectPath, platform) })
  return response.data.instruction || response.data
}

export async function saveProjectInstruction(projectPath, platform, content) {
  const response = await client.put('/project-config/instruction', {
    ...query(projectPath, platform),
    content
  })
  return response.data.instruction || response.data
}

export async function deleteProjectInstruction(projectPath, platform) {
  const response = await client.delete('/project-config/instruction', { params: query(projectPath, platform) })
  return response.data.instruction || response.data
}

export async function getProjectMcp(projectPath, platform) {
  const response = await client.get('/project-config/mcp', { params: query(projectPath, platform) })
  return response.data.mcp || response.data
}

export async function saveProjectMcp(projectPath, platform, id, server) {
  const response = await client.put(`/project-config/mcp/${encodeURIComponent(id)}`, {
    ...query(projectPath, platform),
    server
  })
  return response.data.server || response.data
}

export async function deleteProjectMcp(projectPath, platform, id) {
  const response = await client.delete(`/project-config/mcp/${encodeURIComponent(id)}`, {
    params: query(projectPath, platform)
  })
  return response.data.server || response.data
}

export async function testProjectMcp(projectPath, platform, id) {
  const response = await client.post(`/project-config/mcp/${encodeURIComponent(id)}/test`, query(projectPath, platform))
  return response.data.result || response.data
}
