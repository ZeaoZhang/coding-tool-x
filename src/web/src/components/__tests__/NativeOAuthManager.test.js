import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  getOAuthToolSummary,
  syncLocalOAuth,
  applyOAuthCredential,
  disableNativeOAuthCredential,
  clearNativeOAuth
} = vi.hoisted(() => ({
  getOAuthToolSummary: vi.fn(),
  syncLocalOAuth: vi.fn(),
  applyOAuthCredential: vi.fn(),
  disableNativeOAuthCredential: vi.fn(),
  clearNativeOAuth: vi.fn()
}))

vi.mock('../../api/oauthCredentials', () => ({
  getOAuthToolSummary,
  syncLocalOAuth,
  applyOAuthCredential,
  disableNativeOAuthCredential,
  clearNativeOAuth
}))

vi.mock('../../utils/message', () => ({
  default: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
  dialog: { warning: vi.fn() }
}))

import NativeOAuthManager from '../NativeOAuthManager.vue'

describe('NativeOAuthManager', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getOAuthToolSummary.mockResolvedValue({
      tool: 'opencode',
      summary: {
        credentials: [
          {
            id: 'credential-openai',
            name: 'OpenAI',
            providerId: 'openai',
            accountId: 'account-openai',
            expiresAt: null,
            lastUsedAt: null,
            isDefault: true
          },
          {
            id: 'credential-opencode',
            name: 'OpenCode',
            providerId: 'opencode',
            accountId: 'account-opencode',
            expiresAt: null,
            lastUsedAt: null,
            isDefault: false
          }
        ],
        nativeState: { oauthPresent: true, mode: 'mixed' }
      }
    })
    applyOAuthCredential.mockResolvedValue({
      message: 'OAuth 凭证已应用',
      toolSummary: {
        credentials: [],
        nativeState: { oauthPresent: true, mode: 'oauth' }
      }
    })
  })

  it('shows multiple providers without rendering token material and applies the selected credential', async () => {
    const wrapper = mount(NativeOAuthManager, {
      props: { tool: 'opencode', visible: true },
      global: {
        stubs: {
          teleport: true
        }
      }
    })
    await flushPromises()

    expect(wrapper.text()).toContain('Provider: openai')
    expect(wrapper.text()).toContain('Provider: opencode')
    expect(wrapper.text()).not.toContain('accessToken')
    expect(wrapper.text()).not.toContain('refreshToken')

    const applyButtons = wrapper.findAll('button').filter(button => button.text() === '应用')
    await applyButtons[1].trigger('click')
    await flushPromises()

    expect(applyOAuthCredential).toHaveBeenCalledWith('opencode', 'credential-opencode')
  })
})
