const MANAGED_PLUGIN_TYPES = new Set(['dsh-profile'])

function isManagedRuntimePlugin(plugin) {
  return MANAGED_PLUGIN_TYPES.has(plugin?.pluginType)
    && plugin?.builtIn !== true
    && plugin?.readonly !== true
}

export function dshPluginNameFromSpec(spec) {
  const value = String(spec || '').trim()
  if (!value) return ''
  if (/^(?:file:|link:)/i.test(value)) {
    return value.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || value
  }
  const slash = value.lastIndexOf('/')
  const versionSeparator = value.lastIndexOf('@')
  return versionSeparator > slash ? value.slice(0, versionSeparator) : value
}

export function dshPendingPluginRow(profileName, spec) {
  const name = dshPluginNameFromSpec(spec) || String(spec || '').trim()
  const key = `dsh-pending:${profileName}:${String(spec || '').trim()}`
  return {
    key,
    pluginId: key,
    name,
    profile: profileName,
    source: 'dsh-profile',
    pluginType: 'dsh-profile',
    installed: true,
    installing: true,
    enabled: true,
    readonly: true,
    builtIn: false,
    description: '正在安装...',
    directory: name
  }
}

export function dshInventoryRows(inventory, fallbackProfile = '') {
  const profile = String(inventory?.profile || fallbackProfile || '').trim()
  const plugins = Array.isArray(inventory?.plugins) ? inventory.plugins : null
  if (!profile || !plugins) return null
  return plugins.map(plugin => {
    const name = String(plugin?.name || '').trim()
    const key = `dsh:${profile}:${name}`
    return {
      ...plugin,
      key,
      pluginId: key,
      name,
      profile,
      source: 'dsh-profile',
      pluginType: 'dsh-profile',
      enabled: true,
      readonly: plugin?.builtIn === true,
      description: plugin?.description || '',
      directory: plugin?.name || name
    }
  })
}

export function mergeDshProfilePlugins(currentPlugins, inventory, fallbackProfile = '') {
  const rows = dshInventoryRows(inventory, fallbackProfile)
  if (!rows) return null
  const profile = String(inventory?.profile || fallbackProfile || '').trim()
  const remaining = (Array.isArray(currentPlugins) ? currentPlugins : []).filter(plugin => (
    plugin?.profile !== profile || (plugin?.installing !== true && !isManagedRuntimePlugin(plugin))
  ))
  return [...rows, ...remaining]
}
