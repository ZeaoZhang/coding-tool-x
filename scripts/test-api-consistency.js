'use strict';

const assert = require('assert');
const { getPlatformRegistry, getPlatformRuntime } = require('../src/platforms/runtime');

const CORE_PROJECT_ROUTE_KEYS = new Set([
  'GET /projects',
  'POST /projects/order',
  'DELETE /projects/:param'
]);
const CORE_SESSION_ROUTE_KEYS = new Set([
  'GET /sessions/search/global',
  'GET /sessions/recent/list',
  'GET /sessions/:param',
  'GET /sessions/:param/search',
  'GET /sessions/:param/:param/messages',
  'DELETE /sessions/:param/:param',
  'POST /sessions/:param/batch-delete',
  'POST /sessions/:param/:param/fork',
  'POST /sessions/:param/order',
  'POST /sessions/:param/:param/launch'
]);

function normalizePath(routePath) {
  return String(routePath).replace(/:[^/]+/g, ':param');
}

function routeKey(route) {
  return `${String(route.method).toUpperCase()} ${normalizePath(route.path)}`;
}

function assertCoverage(name, routes, required) {
  const routeKeys = new Set(routes.map(routeKey));
  const missing = [...required].filter(key => !routeKeys.has(key));
  assert.strictEqual(missing.length, 0, `${name} 缺少核心路由: ${missing.join(', ')}`);
}

function run() {
  const registry = getPlatformRegistry();
  const runtime = getPlatformRuntime();
  const records = [];

  for (const manifest of registry.list({ enabledOnly: true })) {
    const routes = manifest.api?.routes || [];
    assert(routes.length > 0, `${manifest.key} 必须声明 API route descriptors`);
    assertCoverage(manifest.key, routes, CORE_PROJECT_ROUTE_KEYS);
    assertCoverage(manifest.key, routes, CORE_SESSION_ROUTE_KEYS);

    const apiDriver = runtime.getDriver(manifest.key, 'api');
    assert(apiDriver, `${manifest.key} API Driver 不可达`);
    for (const route of routes) {
      assert.strictEqual(typeof apiDriver[route.operation], 'function', `${manifest.key} 缺少 ${route.operation}`);
      assert.strictEqual(registry.getCapability(manifest.key, route.capability) !== undefined, true, `${manifest.key} 未声明 ${route.capability}`);
    }

    if (manifest.api.rootAlias) {
      for (const alias of manifest.api.rootAliasPaths || []) {
        assert(routes.some(route => route.path.split('/').filter(Boolean)[0] === alias), `${manifest.key} root alias 无对应路由: ${alias}`);
      }
    }
    records.push(`${manifest.key}: ${routes.length} descriptors`);
  }

  console.log('\nAPI 一致性回归结果:');
  records.forEach(record => console.log(`[通过] ${record}`));
  console.log(`\n全部通过，共 ${records.length} 个平台。`);
}

try {
  run();
} catch (error) {
  console.error('API 一致性回归脚本执行失败:', error.message);
  process.exit(1);
}
