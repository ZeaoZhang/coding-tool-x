import { client, isLegacyPlatformKey } from './client'

let platformCatalogPromise

async function getPlatformDefinition(platform) {
  const key = String(platform || '').trim().toLowerCase()
  if (!key) throw new Error('Platform is required')
  if (!platformCatalogPromise) {
    platformCatalogPromise = client.get('/platforms')
      .then(response => Array.isArray(response.data?.platforms) ? response.data.platforms : [])
      .catch(error => {
        platformCatalogPromise = undefined
        throw error
      })
  }
  const platforms = await platformCatalogPromise
  const definition = platforms.find(item => String(item?.key || '').trim().toLowerCase() === key)
  if (!definition) throw new Error(`Unknown platform: ${key}`)
  return definition
}

function buildPlatformRouteUrl(platform, path, pathParams = {}) {
  const routePath = String(path || '').replace(/:([A-Za-z0-9_]+)/g, (_match, name) => {
    const value = pathParams[name]
    if (value === undefined || value === null || value === '') {
      throw new Error(`Missing route parameter: ${name}`)
    }
    return encodeURIComponent(String(value))
  })
  return `/platforms/${encodeURIComponent(platform)}${routePath}`
}

async function resolvePlatformRoute(platform, capability, operation, pathParams = {}) {
  const key = String(platform || '').trim().toLowerCase()
  const definition = await getPlatformDefinition(key)
  const route = (definition.apiRoutes || []).find(item => (
    item.capability === capability && item.operation === operation
  ))
  if (!route) throw new Error(`Unsupported ${key} ${capability} operation: ${operation}`)
  return {
    route,
    url: buildPlatformRouteUrl(key, route.path, pathParams)
  }
}

/** Resolve a route declared by a platform Manifest. */
export async function getPlatformRouteUrl(platform, capability, operation, { pathParams = {} } = {}) {
  const resolved = await resolvePlatformRoute(platform, capability, operation, pathParams)
  return resolved.url
}

/** Invoke a route declared by a platform Manifest through its generic API Driver. */
export async function callPlatformRoute(platform, capability, operation, {
  pathParams = {},
  query,
  body
} = {}) {
  const key = String(platform || '').trim().toLowerCase()
  const { route, url } = await resolvePlatformRoute(key, capability, operation, pathParams)
  const method = String(route.method || 'GET').toLowerCase()
  const config = query && Object.keys(query).length > 0 ? { params: query } : undefined
  const response = ['get', 'delete', 'head', 'options'].includes(method)
    ? await client[method](url, config)
    : await client[method](url, body ?? {}, config)
  return response.data
}

export function clearPlatformRouteCache() {
  platformCatalogPromise = undefined
}

export async function getPlatforms() {
  const response = await client.get('/platforms')
  return Array.isArray(response.data?.platforms) ? response.data.platforms : []
}

export async function getPlatformProjects(platform, options = {}) {
  const params = {}
  if (options.page != null) params.page = options.page
  if (options.limit != null) params.limit = options.limit
  if (options.q || options.search) params.q = options.q || options.search
  if (options.fresh) params.fresh = '1'
  return callPlatformRoute(platform, 'projects', 'listProjects', { query: params })
}

export async function getPlatformSessions(platform, projectName, options = {}) {
  const params = {}
  if (options.page != null) params.page = options.page
  if (options.limit != null) params.limit = options.limit
  if (options.q || options.search) params.q = options.q || options.search
  if (options.fresh) params.fresh = '1'
  return callPlatformRoute(platform, 'sessions', 'listSessions', {
    pathParams: { projectName },
    query: params
  })
}

export function usesLegacyPlatformApi(platform) {
  return isLegacyPlatformKey(platform)
}
