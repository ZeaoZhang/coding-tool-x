const assert = require('assert');
const { loadConfig } = require('../src/config/loader');

const CORE_PROJECT_ROUTE_KEYS = new Set([
  'GET /',
  'POST /order',
  'DELETE /:param'
]);

const CORE_SESSION_ROUTE_KEYS = new Set([
  'GET /search/global',
  'GET /recent/list',
  'GET /:param',
  'GET /:param/search',
  'GET /:param/:param/messages',
  'DELETE /:param/:param',
  'POST /:param/:param/fork',
  'POST /:param/order',
  'POST /:param/:param/launch'
]);

const CHANNELS = [
  {
    name: 'claude',
    projectsFactory: require('../src/server/api/projects'),
    sessionsFactory: require('../src/server/api/sessions')
  },
  {
    name: 'codex',
    projectsFactory: require('../src/server/api/codex-projects'),
    sessionsFactory: require('../src/server/api/codex-sessions')
  },
  {
    name: 'gemini',
    projectsFactory: require('../src/server/api/gemini-projects'),
    sessionsFactory: require('../src/server/api/gemini-sessions')
  },
  {
    name: 'opencode',
    projectsFactory: require('../src/server/api/opencode-projects'),
    sessionsFactory: require('../src/server/api/opencode-sessions')
  }
];

function normalizePath(routePath) {
  return String(routePath).replace(/:[^/]+/g, ':param');
}

function extractRoutes(router) {
  if (!router || !Array.isArray(router.stack)) {
    return [];
  }

  const routes = [];
  for (const layer of router.stack) {
    if (!layer.route || !layer.route.path) {
      continue;
    }

    const methods = Object.keys(layer.route.methods || {});
    for (const method of methods) {
      routes.push({
        method: method.toUpperCase(),
        path: layer.route.path,
        normalizedPath: normalizePath(layer.route.path)
      });
    }
  }

  return routes;
}

function buildRouteMap(routes) {
  const map = new Map();
  for (const route of routes) {
    map.set(`${route.method} ${route.normalizedPath}`, route.path);
  }
  return map;
}

function buildParams(routePath) {
  const params = {};
  const matches = routePath.matchAll(/:([^/]+)/g);
  for (const match of matches) {
    params[match[1]] = `${match[1]}-test`;
  }
  return params;
}

async function invokeRoute(router, method, routePath, reqOptions = {}) {
  const layer = router.stack.find((item) => (
    item.route
    && item.route.path === routePath
    && item.route.methods
    && item.route.methods[method.toLowerCase()]
  ));

  assert(layer, `未找到路由: ${method} ${routePath}`);

  const req = {
    params: reqOptions.params || {},
    query: reqOptions.query || {},
    body: reqOptions.body || {},
    headers: reqOptions.headers || {},
    socket: reqOptions.socket || { remoteAddress: '127.0.0.1' }
  };

  let statusCode = 200;
  let payload;
  let sent = false;
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(data) {
      payload = data;
      sent = true;
      return this;
    },
    send(data) {
      payload = data;
      sent = true;
      return this;
    }
  };

  await Promise.resolve(layer.route.stack[0].handle(req, res));
  assert(sent, `路由未返回响应: ${method} ${routePath}`);

  return { statusCode, payload };
}

function assertRouteCoverage(name, routeType, routeMap, requiredRouteKeys) {
  const missing = [];
  for (const key of requiredRouteKeys) {
    if (!routeMap.has(key)) {
      missing.push(key);
    }
  }
  assert.strictEqual(
    missing.length,
    0,
    `${name} 的 ${routeType} 缺少核心路由: ${missing.join(', ')}`
  );
}

function assertStatusIn(statusCode, allowed, caseName) {
  assert(
    allowed.includes(statusCode),
    `${caseName} 状态码异常，期望 ${allowed.join('/')}，实际 ${statusCode}`
  );
}

async function run() {
  const config = loadConfig();
  const records = [];
  let failedCount = 0;

  async function runCase(name, fn) {
    try {
      await fn();
      records.push({ name, ok: true });
    } catch (error) {
      failedCount += 1;
      records.push({ name, ok: false, error: error.message });
    }
  }

  for (const channel of CHANNELS) {
    const projectsRouter = channel.projectsFactory(config);
    const sessionsRouter = channel.sessionsFactory(config);

    const projectRoutes = extractRoutes(projectsRouter);
    const sessionRoutes = extractRoutes(sessionsRouter);
    const projectRouteMap = buildRouteMap(projectRoutes);
    const sessionRouteMap = buildRouteMap(sessionRoutes);

    await runCase(`[${channel.name}] 项目核心路由覆盖`, async () => {
      assertRouteCoverage(channel.name, 'projects', projectRouteMap, CORE_PROJECT_ROUTE_KEYS);
    });

    await runCase(`[${channel.name}] 会话核心路由覆盖`, async () => {
      assertRouteCoverage(channel.name, 'sessions', sessionRouteMap, CORE_SESSION_ROUTE_KEYS);
    });

    await runCase(`[${channel.name}] GET /projects 响应结构`, async () => {
      const routePath = projectRouteMap.get('GET /');
      const result = await invokeRoute(projectsRouter, 'GET', routePath);
      assert.strictEqual(result.statusCode, 200, '项目列表接口应返回 200');
      assert(result.payload && Array.isArray(result.payload.projects), 'projects 字段必须为数组');
    });

    await runCase(`[${channel.name}] POST /projects/order 参数校验`, async () => {
      const routePath = projectRouteMap.get('POST /order');
      const result = await invokeRoute(projectsRouter, 'POST', routePath, {
        body: { order: 'invalid-order' }
      });
      assertStatusIn(result.statusCode, [400, 404], '项目排序参数校验');
    });

    await runCase(`[${channel.name}] GET /sessions/recent/list`, async () => {
      const routePath = sessionRouteMap.get('GET /recent/list');
      const result = await invokeRoute(sessionsRouter, 'GET', routePath, {
        query: { limit: '1' }
      });
      assertStatusIn(result.statusCode, [200, 404], '最近会话读取');
      if (result.statusCode === 200) {
        assert(result.payload && Array.isArray(result.payload.sessions), 'sessions 字段必须为数组');
      }
    });

    await runCase(`[${channel.name}] GET /sessions/search/global 参数校验`, async () => {
      const routePath = sessionRouteMap.get('GET /search/global');
      const result = await invokeRoute(sessionsRouter, 'GET', routePath, {
        query: {}
      });
      assertStatusIn(result.statusCode, [400, 404], '全局搜索参数校验');
    });

    await runCase(`[${channel.name}] POST /sessions/:project/order 参数校验`, async () => {
      const routePath = sessionRouteMap.get('POST /:param/order');
      const result = await invokeRoute(sessionsRouter, 'POST', routePath, {
        params: buildParams(routePath),
        body: { order: 'invalid-order' }
      });
      assertStatusIn(result.statusCode, [400, 404], '会话排序参数校验');
    });
  }

  console.log('\nAPI 一致性回归结果:');
  for (const record of records) {
    if (record.ok) {
      console.log(`[通过] ${record.name}`);
      continue;
    }
    console.log(`[失败] ${record.name} -> ${record.error}`);
  }

  if (failedCount > 0) {
    console.error(`\n共 ${failedCount} 项失败，请修复后重试。`);
    process.exit(1);
  }

  console.log(`\n全部通过，共 ${records.length} 项。`);
}

run().catch((error) => {
  console.error('API 一致性回归脚本执行失败:', error);
  process.exit(1);
});
