'use strict';

const fs = require('fs');
const path = require('path');
const { getPlatformRegistry, getPlatformRuntime } = require('../src/platforms/runtime');

const ROOT = path.join(__dirname, '..');
const DRIVER_ROOT = path.join(ROOT, 'src/platforms/drivers');
const DYNAMIC_ENTRIES = new Set([
  'src/server/services/dashboard-snapshot-worker.js',
  'src/platforms/drivers/omp/auth-provider-worker.js'
]);
const COMPANION_FILES = new Set(['channels-implementation.js', 'native-config.js']);
const DRIVER_FILES = new Set(['channels.js', 'proxy.js', 'projects.js', 'sessions.js', 'statistics.js', 'resource-sync.js', 'prompts.js', 'mcp.js']);
const PLATFORM_BUSINESS_FILES = new Set([
  'api.js',
  'project-config.js',
  'config.js',
  'env-manager.js',
  'parser.js',
  'wire.js',
  'normalization.js',
  'gateway.js',
  'gateway-converter.js',
  'gateway-routing.js',
  'auth-gateway-client.js',
  'auth-provider-worker.js',
  'auth-providers.js',
  'native-plugin-adapter.js',
  'session-log-observer.js',
  'skill-discovery.js',
  'skill-settings.js',
  'openai-gateway.js',
  'token-recovery.js',
  'config-sync.js',
  'health-check.js'
]);
function walk(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(absolute));
    else if (entry.name.endsWith('.js')) files.push(absolute);
  }
  return files;
}

function main() {
  const registry = getPlatformRegistry();
  const runtime = getPlatformRuntime();
  const reachable = [];
  const orphan = [];

  for (const definition of registry.list()) {
    for (const [capability, driverId] of Object.entries(definition.capabilities || {})) {
      const driver = runtime.getDriver(definition.key, capability);
      const item = `${definition.key}.${capability}`;
      if (driver) reachable.push({ item, driverId });
      else orphan.push(item);
    }
  }

  for (const file of walk(DRIVER_ROOT)) {
    const relative = path.relative(ROOT, file);
    const parent = path.basename(path.dirname(file));
    const base = path.basename(file);
    if (parent === 'shared' || base === 'legacy.js' || base === 'unsupported.js' || base === 'secure-file-driver.js' || base.startsWith('generic-')) continue;
    if (
      !DRIVER_FILES.has(base)
      && !COMPANION_FILES.has(base)
      && !PLATFORM_BUSINESS_FILES.has(base)
      && !base.startsWith('api-')
      && !base.endsWith('-implementation.js')
      && !base.endsWith('-adapter.js')
    ) orphan.push(relative);

  }
  const result = {
    reachable,
    serverFacades: {
      routeFactory: fs.existsSync(path.join(ROOT, 'src/server/api/platform-route-factory.js')),
      legacyDriverRegistry: fs.existsSync(path.join(ROOT, 'src/platforms/drivers/legacy.js'))
    },
    dynamicEntries: [...DYNAMIC_ENTRIES],
    orphan
  };
  console.log(JSON.stringify(result, null, 2));
  if (orphan.length) process.exitCode = 1;
}

main();
