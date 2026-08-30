import { beforeEach, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

const api = vi.hoisted(() => ({
  getProjectConfig: vi.fn()
}))

vi.mock('../../api/project-config', () => api)

import ProjectConfigDrawer from '../ProjectConfigDrawer.vue'

beforeEach(() => {
  api.getProjectConfig.mockReset()
  api.getProjectConfig.mockResolvedValue({
    success: true,
    projectPath: '/tmp/project',
    platform: 'codex',
    instruction: { supported: true, path: 'AGENTS.md', exists: false, content: '' },
    skills: { supported: true, project: [], inherited: [] },
    mcp: { supported: true, path: '.codex/config.toml', servers: [] },
    capabilities: { instruction: true, skills: true, mcp: true }
  })
})

it('renders project configuration tabs with the canonical path', async () => {
  const wrapper = mount(ProjectConfigDrawer, {
    props: { show: true, projectPath: '/tmp/project', platform: 'codex' },
    global: {
      stubs: {
        ProjectInstructionPanel: {
          props: ['instruction'],
          template: '<div>{{ instruction?.supported ? "项目指令" : "当前平台不提供项目指令文件" }}</div>'
        },
        SkillsPanel: { template: '<div>Skills panel</div>' },
        ProjectMcpPanel: { template: '<div>MCP panel</div>' },
        NDrawer: { template: '<div v-if="show"><slot /></div>', props: ['show'] },
        NDrawerContent: { template: '<div><slot /></div>' },
        NTabs: { template: '<div><slot /></div>' },
        NTabPane: { template: '<div><slot /></div>', props: ['name', 'tab'] }
      }
    }
  })

  await vi.waitFor(() => expect(document.body.textContent).toContain('项目指令'))
  expect(document.body.textContent).toContain('Skills')
  expect(document.body.textContent).toContain('MCP')
  expect(document.body.textContent).toContain('/tmp/project')
})

it('passes unsupported capabilities to the child panels', async () => {
  api.getProjectConfig.mockResolvedValue({
    success: true,
    projectPath: '/tmp/project',
    platform: 'omp',
    instruction: { supported: false, path: null, exists: false, content: '' },
    skills: { supported: true, project: [], inherited: [] },
    mcp: { supported: true, path: '.omp/mcp.json', servers: [] },
    capabilities: { instruction: false, skills: true, mcp: true }
  })

  const wrapper = mount(ProjectConfigDrawer, {
    props: { show: true, projectPath: '/tmp/project', platform: 'omp' },
    global: {
      stubs: {
        ProjectInstructionPanel: {
          props: ['instruction'],
          template: '<div>{{ instruction?.supported ? "项目指令" : "当前平台不提供项目指令文件" }}</div>'
        },
        SkillsPanel: { template: '<div>Skills panel</div>' },
        ProjectMcpPanel: { template: '<div>MCP panel</div>' },
        NDrawer: { template: '<div v-if="show"><slot /></div>', props: ['show'] },
        NDrawerContent: { template: '<div><slot /></div>' },
        NTabs: { template: '<div><slot /></div>' },
        NTabPane: { template: '<div><slot /></div>', props: ['name', 'tab'] }
      }
    }
  })

  await vi.waitFor(() => expect(document.body.textContent).toContain('当前平台不提供项目指令文件'))
})
