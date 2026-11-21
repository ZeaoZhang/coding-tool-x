import { flushPromises, shallowMount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getTrendStatistics, getAvailableFilters, getTrendExportUrl, messageApi } = vi.hoisted(() => ({
  getTrendStatistics: vi.fn(),
  getAvailableFilters: vi.fn(),
  getTrendExportUrl: vi.fn(),
  messageApi: { success: vi.fn(), error: vi.fn(), warning: vi.fn() }
}))

vi.mock('../../api/statistics', () => ({
  getTrendStatistics,
  getAvailableFilters,
  getTrendExportUrl
}))
vi.mock('../../plugins/echarts', () => ({}))
vi.mock('vue-echarts', () => ({ default: { name: 'VChart', render: () => null } }))
vi.mock('naive-ui', async () => {
  const actual = await vi.importActual('naive-ui')
  return {
    ...actual,
    useMessage: () => messageApi
  }
})

import Analytics from '../Analytics.vue'

const DatePickerStub = {
  name: 'NDatePicker',
  props: ['value'],
  emits: ['update:value'],
  template: '<div class="date-picker-stub" />'
}

function mountAnalytics() {
  return shallowMount(Analytics, {
    global: {
      stubs: {
        DatePicker: DatePickerStub
      }
    }
  })
}

describe('Analytics custom date range', () => {
  beforeEach(() => {
    getTrendStatistics.mockReset()
    getAvailableFilters.mockReset()
    getTrendExportUrl.mockReset()
    messageApi.error.mockReset()

    getAvailableFilters.mockResolvedValue({ toolTypes: [], channels: [], models: [] })
    getTrendStatistics.mockResolvedValue({
      labels: ['2026-01-05'],
      series: [{ name: 'demo', data: [1] }]
    })
  })

  it('fetches the selected custom range once when both dates are picked', async () => {
    const wrapper = mountAnalytics()
    await flushPromises()

    getTrendStatistics.mockClear()
    getAvailableFilters.mockClear()

    const customButton = wrapper.findAll('.range-btn').find(button => button.text() === '自定义')
    expect(customButton).toBeTruthy()
    await customButton.trigger('click')

    const datePicker = wrapper.findComponent(DatePickerStub)
    expect(datePicker.exists()).toBe(true)

    // 2026-01-05 / 2026-01-09 in UTC; rendered as CST dates (UTC+8)
    datePicker.vm.$emit('update:value', [
      Date.UTC(2026, 0, 5),
      Date.UTC(2026, 0, 9)
    ])
    await flushPromises()

    expect(getAvailableFilters).toHaveBeenCalledWith({
      startDate: '2026-01-05',
      endDate: '2026-01-09'
    })

    const tokenCalls = getTrendStatistics.mock.calls.filter(([params]) => params.metric === 'tokens')
    expect(tokenCalls).toHaveLength(1)
    expect(tokenCalls[0][0]).toMatchObject({
      startDate: '2026-01-05',
      endDate: '2026-01-09',
      granularity: 'day',
      step: 1
    })
    expect(messageApi.error).not.toHaveBeenCalled()
  })

  it('keeps the newest range when an older response resolves last', async () => {
    const wrapper = mountAnalytics()
    await flushPromises()

    const pending = []
    getTrendStatistics.mockImplementation(params => new Promise(resolve => {
      pending.push({ params, resolve })
    }))

    const clickRange = async label => {
      const button = wrapper.findAll('.range-btn').find(item => item.text() === label)
      await button.trigger('click')
      await flushPromises()
    }

    await clickRange('30d')
    await clickRange('3d')

    const dayRange = params => {
      const days = Math.round((new Date(params.endDate) - new Date(params.startDate)) / 86400000) + 1
      return days
    }
    const slow30d = pending.filter(item => dayRange(item.params) === 30)
    const fast3d = pending.filter(item => dayRange(item.params) === 3)
    expect(slow30d.length).toBeGreaterThan(0)
    expect(fast3d.length).toBeGreaterThan(0)

    const payload = label => ({ labels: [label], series: [{ name: label, data: [1] }] })
    fast3d.forEach(item => item.resolve(payload('three-days')))
    await flushPromises()
    slow30d.forEach(item => item.resolve(payload('thirty-days')))
    await flushPromises()

    expect(wrapper.vm.trendData.labels).toEqual(['three-days'])
  })
})
