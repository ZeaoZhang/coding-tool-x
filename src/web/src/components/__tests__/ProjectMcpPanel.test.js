import { expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

const api = vi.hoisted(() => ({
  getProjectMcp: vi.fn(async () => ({ supported: true, path: '.mcp.json', servers: [] })),
  deleteProjectMcp: vi.fn(),
  testProjectMcp: vi.fn()
}))

vi.mock('../../api/project-config', () => api)

vi.mock('naive-ui', async () => {
  const actual = await vi.importActual('naive-ui')
  return {
    ...actual,
    useMessage: () => ({ success: vi.fn(), error: vi.fn() }),
    useDialog: () => ({ warning: vi.fn() })
  }
})

import ProjectMcpPanel from '../ProjectMcpPanel.vue'

it('passes project scope and path to the MCP form', () => {
  const wrapper = mount(ProjectMcpPanel, {
    props: {
      projectPath: '/tmp/project',
      platform: 'codex',
      mcp: { supported: true, path: '.codex/config.toml', servers: [] }
    },
    global: {
      stubs: {
        McpFormDrawer: {
          props: ['scope', 'projectPath', 'platform'],
          template: '<div data-testid="mcp-form">{{ scope }} {{ projectPath }} {{ platform }}</div>'
        }
      }
    }
  })

  expect(wrapper.get('[data-testid="mcp-form"]').text()).toBe('project /tmp/project codex')
})
