import { expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import SessionCard from '../SessionCard.vue'

it('hides unsupported actions on read-only sessions', () => {
  const wrapper = mount(SessionCard, {
    props: {
      channel: 'dsh',
      session: {
        sessionId: 'readonly-session',
        readOnly: true,
        mtime: Date.now(),
        size: 128
      }
    }
  })

  const actions = wrapper.find('.session-actions').text()
  expect(actions).toContain('别名')
  expect(actions).not.toContain('使用对话')
  expect(actions).not.toContain('Fork')
  expect(wrapper.find('.session-actions button[type="error"]').exists()).toBe(false)
  wrapper.unmount()
})
