import { ref, nextTick } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  updateUIConfigKey: vi.fn(),
  warning: vi.fn(),
  loadDashboard: vi.fn(),
  store: { dashboardData: null, loadDashboard: null }
}))

vi.mock('../../api/ui-config', () => ({ updateUIConfigKey: mocks.updateUIConfigKey }))
vi.mock('../../utils/message', () => ({
  default: { warning: mocks.warning, error: vi.fn(), success: vi.fn(), info: vi.fn() }
}))
vi.mock('../../stores/dashboard', () => ({ useDashboardStore: () => mocks.store }))

async function freshTheme({ serverTheme = 'light', storedTheme = null } = {}) {
  vi.resetModules()
  mocks.updateUIConfigKey.mockReset()
  mocks.warning.mockReset()
  mocks.loadDashboard.mockReset()
  mocks.loadDashboard.mockResolvedValue({ uiConfig: { theme: serverTheme } })
  mocks.store.dashboardData = ref({ uiConfig: { theme: serverTheme } })
  mocks.store.loadDashboard = mocks.loadDashboard
  localStorage.clear()
  if (storedTheme) localStorage.setItem('cc-theme', storedTheme)
  document.documentElement.removeAttribute('data-theme')

  const module = await import('../useTheme')
  const theme = module.useTheme()
  await theme.loadTheme()
  return theme
}

const flush = async () => {
  await new Promise(resolve => setTimeout(resolve, 0))
  await nextTick()
}

describe('useTheme', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme')
  })

  it('does not persist the initial theme loaded from local storage', async () => {
    const theme = await freshTheme({ serverTheme: 'light', storedTheme: 'dark' })
    await flush()

    expect(theme.isDark.value).toBe(false)
    expect(mocks.updateUIConfigKey).not.toHaveBeenCalled()
  })

  it('keeps a user toggle when a dashboard refresh still reports the old theme', async () => {
    const theme = await freshTheme({ serverTheme: 'light' })
    mocks.updateUIConfigKey.mockResolvedValue({ success: true })

    theme.toggleTheme()
    expect(theme.isDark.value).toBe(true)

    // A dashboard snapshot that was requested before the write lands late.
    mocks.store.dashboardData.value = { uiConfig: { theme: 'light' } }
    await flush()

    expect(theme.isDark.value).toBe(true)
    expect(mocks.updateUIConfigKey).toHaveBeenCalledWith('theme', 'dark')
  })

  it('applies a genuine external theme change', async () => {
    const theme = await freshTheme({ serverTheme: 'light' })
    mocks.updateUIConfigKey.mockResolvedValue({ success: true })

    mocks.store.dashboardData.value = { uiConfig: { theme: 'dark' } }
    await flush()

    expect(theme.isDark.value).toBe(true)
    expect(mocks.updateUIConfigKey).not.toHaveBeenCalled()
  })

  it('ends on the last value after rapid toggles', async () => {
    const theme = await freshTheme({ serverTheme: 'light' })
    mocks.updateUIConfigKey.mockResolvedValue({ success: true })

    theme.toggleTheme()
    theme.toggleTheme()
    theme.toggleTheme()
    await flush()

    expect(theme.isDark.value).toBe(true)
    const persisted = mocks.updateUIConfigKey.mock.calls.at(-1)
    expect(persisted).toEqual(['theme', 'dark'])
  })

  it('keeps a toggle made while the dashboard theme is still loading', async () => {
    vi.resetModules()
    mocks.updateUIConfigKey.mockReset()
    mocks.warning.mockReset()
    mocks.loadDashboard.mockReset()
    let resolveDashboard
    mocks.loadDashboard.mockImplementation(() => new Promise(resolve => {
      resolveDashboard = resolve
    }))
    mocks.store.dashboardData = ref({})
    mocks.store.loadDashboard = mocks.loadDashboard
    localStorage.clear()
    document.documentElement.removeAttribute('data-theme')

    const module = await import('../useTheme')
    const theme = module.useTheme()
    const loading = theme.loadTheme()
    await Promise.resolve()

    theme.toggleTheme()
    expect(theme.isDark.value).toBe(true)

    // The dashboard read started before the click; its stale theme must not win.
    resolveDashboard({ uiConfig: { theme: 'light' } })
    await loading
    await flush()

    expect(theme.isDark.value).toBe(true)
  })

  it('reverts to the confirmed theme when the write fails', async () => {
    const theme = await freshTheme({ serverTheme: 'light' })
    mocks.updateUIConfigKey.mockRejectedValue(new Error('network'))

    theme.toggleTheme()
    await flush()

    expect(theme.isDark.value).toBe(false)
    expect(mocks.warning).toHaveBeenCalledTimes(1)
  })
})
