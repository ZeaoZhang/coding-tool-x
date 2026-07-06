const express = require('express');
const http = require('http');

let configExportService;
let admZipBehavior;

beforeEach(() => {
  configExportService = {
    exportAllConfigs: vi.fn(() => ({
      success: true,
      data: { version: '1.0.0', data: {} }
    })),
    exportAllConfigsZip: vi.fn(() => ({
      success: true,
      filename: 'ctx-config.zip',
      data: Buffer.from('zip-binary')
    })),
    importConfigs: vi.fn(async (data, options) => ({
      success: true,
      imported: true,
      data,
      overwrite: options.overwrite
    }))
  };

  admZipBehavior = {
    getEntry: vi.fn(() => ({
      getData: () => Buffer.from(JSON.stringify({
        version: '1.0.0',
        exportedAt: '2025-01-01T00:00:00.000Z',
        data: {
          configTemplates: [{ id: 'tpl-1', name: 'Template 1', description: 'desc' }],
          channelsByType: {
            claude: [{ id: 'ch-1', name: 'Claude', type: 'claude' }]
          },
          plugins: [{ name: 'demo-plugin', type: 'plugin', version: '1.0.0' }]
        }
      }))
    }))
  };

  const servicePath = require.resolve('../../../src/server/services/config-export-service');
  require.cache[servicePath] = {
    id: servicePath,
    filename: servicePath,
    loaded: true,
    exports: configExportService
  };

  const admZipPath = require.resolve('adm-zip');
  require.cache[admZipPath] = {
    id: admZipPath,
    filename: admZipPath,
    loaded: true,
    exports: function AdmZipMock() {
      return admZipBehavior;
    }
  };

  delete require.cache[require.resolve('../../../src/server/api/config-export')];
});

afterEach(() => {
  delete require.cache[require.resolve('../../../src/server/api/config-export')];
  delete require.cache[require.resolve('../../../src/server/services/config-export-service')];
  delete require.cache[require.resolve('adm-zip')];
});

function buildApp() {
  const router = require('../../../src/server/api/config-export');
  const app = express();
  app.use(express.json());
  app.use('/', router);
  return app;
}

function request(app) {
  return {
    get(url) { return call(app, 'GET', url); },
    post(url, body, headers = {}) { return call(app, 'POST', url, body, headers); }
  };
}

function call(app, method, url, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, () => {
      const port = server.address().port;
      const rawBody = Buffer.isBuffer(body)
        ? body
        : body
          ? Buffer.from(JSON.stringify(body))
          : null;
      const headers = {
        ...(rawBody && !Buffer.isBuffer(body) ? { 'Content-Type': 'application/json' } : {}),
        ...(rawBody ? { 'Content-Length': rawBody.length } : {}),
        ...extraHeaders
      };

      const req = http.request({
        hostname: '127.0.0.1',
        port,
        path: url,
        method,
        headers
      }, (res) => {
        const chunks = [];
        res.on('data', (chunk) => { chunks.push(chunk); });
        res.on('end', () => {
          server.close();
          const text = Buffer.concat(chunks).toString();
          try {
            resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(text), text });
          } catch {
            resolve({ status: res.statusCode, headers: res.headers, body: text, text });
          }
        });
      });

      req.on('error', (error) => {
        server.close();
        reject(error);
      });

      if (rawBody) req.write(rawBody);
      req.end();
    });
  });
}

describe('config export api export routes', () => {
  test('exports json payload by default', async () => {
    const res = await request(buildApp()).get('/');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(configExportService.exportAllConfigs).toHaveBeenCalled();
  });

  test('exports zip payload when requested', async () => {
    const res = await request(buildApp()).get('/?format=zip');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/zip/);
    expect(res.headers['content-disposition']).toContain('ctx-config.zip');
    expect(configExportService.exportAllConfigsZip).toHaveBeenCalled();
  });
});

describe('config export api import routes', () => {
  test('validates missing import data', async () => {
    const res = await request(buildApp()).post('/import', {});

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('imports plain JSON payload', async () => {
    const payload = { version: '1.0.0', data: { channels: [] } };
    const res = await request(buildApp()).post('/import', { data: payload, overwrite: true });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(configExportService.importConfigs).toHaveBeenCalledWith(payload, { overwrite: true });
  });

  test('imports zip payload', async () => {
    const res = await request(buildApp()).post(
      '/import-zip?overwrite=true',
      Buffer.from('zip-data'),
      { 'Content-Type': 'application/zip' }
    );

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(configExportService.importConfigs).toHaveBeenCalledWith(expect.objectContaining({ version: '1.0.0' }), { overwrite: true });
  });
});

describe('config export api preview routes', () => {
  test('validates invalid preview data shape', async () => {
    const res = await request(buildApp()).post('/preview', { data: null });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('builds preview summary from json payload', async () => {
    const res = await request(buildApp()).post('/preview', {
      data: {
        version: '1.0.0',
        exportedAt: '2025-01-01T00:00:00.000Z',
        data: {
          configTemplates: [{ id: 'tpl-1', name: 'Template 1', description: 'desc' }],
          channelsByType: {
            claude: [{ id: 'ch-1', name: 'Claude', type: 'claude' }]
          },
          plugins: [{ name: 'demo-plugin', type: 'plugin', version: '1.0.0' }]
        }
      }
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.counts.channels).toBe(1);
    expect(res.body.data.items.plugins[0].name).toBe('demo-plugin');
  });

  test('builds preview summary with Pi channels', async () => {
    const res = await request(buildApp()).post('/preview', {
      data: {
        version: '1.0.0',
        exportedAt: '2025-01-01T00:00:00.000Z',
        data: {
          channelsByType: {
            pi: [{ id: 'pi-1', name: 'Pi Preview', providerKey: 'pi-managed' }]
          },
          nativeConfigs: {
            pi: { settings: { content: { packages: ['@demo/pi-package'] } } }
          }
        }
      }
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.counts.channels).toBe(1);
    expect(res.body.data.items.channels).toEqual([
      { id: 'pi-1', name: 'Pi Preview', type: 'pi' }
    ]);
  });

  test('builds preview summary from zip payload', async () => {
    const res = await request(buildApp()).post(
      '/preview-zip',
      Buffer.from('zip-data'),
      { 'Content-Type': 'application/zip' }
    );

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.counts.configTemplates).toBe(1);
  });
});
