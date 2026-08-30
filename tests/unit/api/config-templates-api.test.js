const express = require('express');
const http = require('http');

let templatesService;

function buildApp() {
  delete require.cache[require.resolve('../../../src/server/api/config-templates')];
  const router = require('../../../src/server/api/config-templates');
  const app = express();
  app.use(express.json());
  app.use('/', router);
  return app;
}

function request(app) {
  return {
    get(url) { return call(app, 'GET', url); },
    post(url, body) { return call(app, 'POST', url, body); },
    put(url, body) { return call(app, 'PUT', url, body); },
    delete(url) { return call(app, 'DELETE', url); }
  };
}

function call(app, method, url, body) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, () => {
      const rawBody = body ? JSON.stringify(body) : null;
      const req = http.request({
        hostname: '127.0.0.1',
        port: server.address().port,
        path: url,
        method,
        headers: rawBody ? {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(rawBody)
        } : {}
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          server.close();
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode, body: data });
          }
        });
      });
      req.on('error', reject);
      if (rawBody) req.write(rawBody);
      req.end();
    });
  });
}

beforeEach(() => {
  templatesService = {
    getAllTemplates: vi.fn(() => [{ id: 'tpl-1', name: 'Template 1' }]),
    getAvailableConfigs: vi.fn(() => ({ files: ['AGENTS.md'] })),
    getTemplateById: vi.fn((id) => id === 'tpl-1' ? { id, name: 'Template 1' } : null),
    createCustomTemplate: vi.fn((body) => ({ id: 'new-tpl', ...body })),
    updateCustomTemplate: vi.fn((id, body) => ({ id, ...body })),
    deleteCustomTemplate: vi.fn(),
    applyTemplateToProject: vi.fn(async (_targetPath, id, options) => {
      await new Promise(resolve => setImmediate(resolve));
      return {
        templateId: id,
        applied: true,
        options,
        results: { skipped: [{ path: '.env.local' }] }
      };
    }),
    previewTemplateApplication: vi.fn((_targetPath, id, options) => ({
      templateId: id,
      options,
      preview: true
    }))
  };
  const validationPath = require.resolve('../../../src/server/services/project-path-validation');
  require.cache[validationPath] = {
    id: validationPath,
    filename: validationPath,
    loaded: true,
    exports: {
      validateKnownProjectCwd: vi.fn(async targetPath => targetPath)
    }
  };

  require.cache[require.resolve('../../../src/server/services/config-templates-service')] = {
    id: require.resolve('../../../src/server/services/config-templates-service'),
    filename: require.resolve('../../../src/server/services/config-templates-service'),
    loaded: true,
    exports: templatesService
  };
});

afterEach(() => {
  [
    '../../../src/server/api/config-templates',
    '../../../src/server/services/config-templates-service',
    '../../../src/server/services/project-path-validation'
  ].forEach((mod) => {
    try {
      delete require.cache[require.resolve(mod)];
    } catch (_) {}
  });
});

describe('config-templates api', () => {
  test('lists templates and available configs', async () => {
    const app = buildApp();
    expect((await request(app).get('/')).body).toEqual({
      success: true,
      data: [{ id: 'tpl-1', name: 'Template 1' }]
    });
    expect((await request(app).get('/available-configs')).body).toEqual({
      success: true,
      data: { files: ['AGENTS.md'] }
    });
  });

  test('gets single template and returns 404 for missing ids', async () => {
    const app = buildApp();
    expect((await request(app).get('/tpl-1')).status).toBe(200);
    expect((await request(app).get('/missing')).status).toBe(404);
  });

  test('creates, updates, and deletes templates', async () => {
    const app = buildApp();
    expect((await request(app).post('/', { name: 'New Template' })).body.data).toEqual({
      id: 'new-tpl',
      name: 'New Template'
    });
    expect((await request(app).put('/tpl-1', { name: 'Updated' })).body.data).toEqual({
      id: 'tpl-1',
      name: 'Updated'
    });
    expect((await request(app).delete('/tpl-1')).body).toEqual({
      success: true,
      message: '模板删除成功'
    });
    expect(templatesService.deleteCustomTemplate).toHaveBeenCalledWith('tpl-1');
  });

  test('apply and preview validate targetPath and normalize aiConfigTypes', async () => {
    const app = buildApp();
    expect((await request(app).post('/tpl-1/apply', {})).status).toBe(400);

    const applied = await request(app).post('/tpl-1/apply', {
      targetPath: '/workspace/demo',
      aiConfigTypes: '["Claude","Gemini"]'
    });
    expect(applied.body.data).toEqual({
      templateId: 'tpl-1',
      applied: true,
      options: { aiConfigTypes: ['claude', 'gemini'] },
      results: { skipped: [{ path: '.env.local' }] }
    });
    const previewed = await request(app).post('/tpl-1/preview', {
      targetPath: '/workspace/demo',
      aiConfigType: 'codex, OpenCode'
    });

    expect(applied.status).toBe(200);
    expect(templatesService.applyTemplateToProject).toHaveBeenCalledWith(
      '/workspace/demo',
      'tpl-1',
      { aiConfigTypes: ['claude', 'gemini'] }
    );
    expect(applied.body.message).toContain('部分应用');
    expect(previewed.status).toBe(200);
    expect(templatesService.previewTemplateApplication).toHaveBeenCalledWith(
      '/workspace/demo',
      'tpl-1',
      { aiConfigTypes: ['codex', 'opencode'] }
    );
  });
});
