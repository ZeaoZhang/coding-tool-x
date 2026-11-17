import { describe, expect, it } from 'vitest'

import {
  dshInventoryRows,
  dshPendingPluginRow,
  dshPluginNameFromSpec,
  mergeDshProfilePlugins
} from '../dsh-plugin-inventory'

describe('dsh plugin inventory helpers', () => {
  it('derives display names from local and versioned specs', () => {
    expect(dshPluginNameFromSpec('file:/tmp/plugins/dsh-demo')).toBe('dsh-demo')
    expect(dshPluginNameFromSpec('link:../plugins/dsh-demo/')).toBe('dsh-demo')
    expect(dshPluginNameFromSpec('@scope/dsh-demo@^1.2.3')).toBe('@scope/dsh-demo')
    expect(dshPluginNameFromSpec('dsh-demo@1.0.0')).toBe('dsh-demo')
    expect(dshPluginNameFromSpec('')).toBe('')
  })

  it('builds a pending row that cannot be managed while installing', () => {
    const row = dshPendingPluginRow('web-test', 'file:/tmp/plugins/dsh-demo')

    expect(row).toEqual(expect.objectContaining({
      name: 'dsh-demo',
      profile: 'web-test',
      pluginType: 'dsh-profile',
      installing: true,
      readonly: true,
      installed: true
    }))
    expect(row.key).toContain('dsh-pending:web-test:')
  })

  it('replaces managed profile rows with the inventory while preserving built-ins', () => {
    const current = [
      { key: 'pending', name: 'dsh-demo', profile: 'web-test', pluginType: 'dsh-profile', installing: true, readonly: true },
      { key: 'old-managed', name: 'old-plugin', profile: 'web-test', pluginType: 'dsh-profile', builtIn: false, readonly: false },
      { key: 'built-in', name: '@deepseek-ai/dsh-base', profile: 'web-test', pluginType: 'dsh-profile', builtIn: true, readonly: true },
      { key: 'other', name: 'other-plugin', profile: 'second', pluginType: 'dsh-profile', builtIn: false, readonly: false }
    ]
    const inventory = {
      profile: 'web-test',
      plugins: [{
        name: 'dsh-demo',
        installed: true,
        builtIn: false,
        requestedVersion: 'file:/tmp/plugins/dsh-demo',
        description: 'Installed demo'
      }]
    }

    const merged = mergeDshProfilePlugins(current, inventory, 'web-test')

    expect(merged.map(plugin => plugin.name)).toEqual(['dsh-demo', '@deepseek-ai/dsh-base', 'other-plugin'])
    expect(merged[0]).toEqual(expect.objectContaining({
      key: 'dsh:web-test:dsh-demo',
      pluginId: 'dsh:web-test:dsh-demo',
      installed: true,
      readonly: false,
      pluginType: 'dsh-profile'
    }))
    expect(merged[1].key).toBe('built-in')
    expect(merged[2].key).toBe('other')
  })

  it('returns null when the mutation response has no inventory', () => {
    expect(mergeDshProfilePlugins([], { plugins: [] }, 'web-test')).toEqual([])
    expect(mergeDshProfilePlugins([], {}, 'web-test')).toBeNull()
    expect(dshInventoryRows(null)).toBeNull()
  })
})
