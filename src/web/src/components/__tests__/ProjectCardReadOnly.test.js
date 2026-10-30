import { expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import ProjectCard from '../ProjectCard.vue'

it('hides project deletion for read-only drivers', async () => {
  const wrapper = mount(ProjectCard, {
    props: {
      project: { name: 'dsh-project', displayName: 'DSH project', readOnly: true }
    }
  })

  await wrapper.find('.project-card').trigger('mouseenter')
  await nextTick()

  expect(wrapper.find('.delete-btn').exists()).toBe(false)
  wrapper.unmount()
})

it('keeps project deletion for writable drivers', async () => {
  const wrapper = mount(ProjectCard, {
    props: {
      project: { name: 'writable-project', displayName: 'Writable project' }
    }
  })

  await wrapper.find('.project-card').trigger('mouseenter')
  await nextTick()

  expect(wrapper.find('.delete-btn').exists()).toBe(true)
  wrapper.unmount()
})
