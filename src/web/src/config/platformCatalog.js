import { ICON_TOKENS, resolveIconToken } from './iconTokens'
import {
  DEFAULT_ENABLED_CLI_PLATFORMS,
  MINIMAL_PLATFORM_FALLBACK,
  normalizePublicPlatforms
} from './platforms'

function normalizedCatalog(catalog) {
  if (Array.isArray(catalog)) return normalizePublicPlatforms(catalog)

  const normalized = normalizePublicPlatforms(catalog)
  if (normalized.length > 0) return normalized

  const fallbackByKey = new Map(normalizePublicPlatforms(MINIMAL_PLATFORM_FALLBACK).map(platform => [platform.key, platform]))
  return DEFAULT_ENABLED_CLI_PLATFORMS
    .map(key => fallbackByKey.get(key))
    .filter(Boolean)
}

function normalizedKey(value) {
  return String(value ?? '').trim().toLowerCase()
}

/**
 * Resolve the user selection against the published catalog without adding or
 * removing any entries beyond normalization and catalog membership.
 */
export function resolveEnabledCliPlatforms({ catalog, enabledCliPlatforms } = {}) {
  const available = normalizedCatalog(catalog)
  const availableKeys = new Set(available.map(platform => platform.key))
  const requested = Array.isArray(enabledCliPlatforms)
    ? enabledCliPlatforms
    : DEFAULT_ENABLED_CLI_PLATFORMS
  const result = []
  const seen = new Set()

  for (const value of requested) {
    const key = normalizedKey(value)
    if (!key || seen.has(key) || !availableKeys.has(key)) continue
    seen.add(key)
    result.push(key)
  }
  return result
}

export function isPlatformEnabled(key, enabledCliPlatforms) {
  const normalized = normalizedKey(key)
  if (!normalized || !Array.isArray(enabledCliPlatforms)) return false
  return enabledCliPlatforms.some(value => normalizedKey(value) === normalized)
}

export function getPlatformsByCapability(platforms, capability) {
  if (!capability) return []
  return normalizedCatalog(platforms).filter(platform => (
    platform.capabilities?.[capability] === true
    || platform.resourceTypes?.[capability] === true
  ))
}

export function buildPlatformNavigation(platforms) {
  const catalog = normalizedCatalog(platforms)
  return catalog.map(platform => {
    const token = normalizedKey(platform.iconToken)
    const iconToken = Object.prototype.hasOwnProperty.call(ICON_TOKENS, token) ? token : 'terminal'
    return {
      key: platform.key,
      label: platform.label || platform.title || platform.key,
      title: platform.title || platform.label || platform.key,
      iconToken,
      icon: resolveIconToken(iconToken),
      color: platform.color || '#64748b',
      capabilities: platform.capabilities
    }
  })
}

export function getRoutePlatform(route) {
  return normalizedKey(route?.params?.platform || route?.meta?.channel)
}
