describe('gemini-proxy-server compatibility helpers', () => {
  let proxyServer;

  beforeEach(() => {
    delete require.cache[require.resolve('../../../src/platforms/drivers/gemini/proxy-implementation')];
    proxyServer = require('../../../src/platforms/drivers/gemini/proxy-implementation');
  });

  afterEach(() => {
    delete require.cache[require.resolve('../../../src/platforms/drivers/gemini/proxy-implementation')];
  });

  test('strips function response ids for Vertex AI v1 payloads', () => {
    const body = {
      contents: [
        {
          role: 'user',
          parts: [
            {
              functionResponse: {
                id: 'call-1',
                name: 'lookup',
                response: { answer: 'ok' }
              }
            },
            {
              function_response: {
                id: 'call-2',
                name: 'search',
                response: { result: 'found' }
              }
            }
          ]
        }
      ]
    };

    expect(proxyServer._test.stripVertexFunctionResponseIds(body)).toBe(true);
    expect(body.contents[0].parts[0].functionResponse).toEqual({
      name: 'lookup',
      response: { answer: 'ok' }
    });
    expect(body.contents[0].parts[1].function_response).toEqual({
      name: 'search',
      response: { result: 'found' }
    });
  });

  test('builds Vertex AI v1 publisher model path from Gemini CLI model path', () => {
    const baseUrl = 'https://us-central1-aiplatform.googleapis.com/v1/projects/demo/locations/us-central1/publishers/google';
    const requestPath = '/v1beta/models/gemini-2.5-pro:streamGenerateContent?alt=sse';

    expect(proxyServer._test.buildVertexAiV1Path(baseUrl, requestPath)).toBe(
      '/models/gemini-2.5-pro:streamGenerateContent?alt=sse'
    );
  });

  test('classifies non-2xx upstream responses as errors before usage parsing', () => {
    expect(proxyServer._test.isHttpErrorStatus(503)).toBe(true);
    expect(proxyServer._test.isHttpErrorStatus(200)).toBe(false);

    expect(proxyServer._test.extractGeminiUpstreamErrorMessage(JSON.stringify({
      error: {
        code: 503,
        message: 'No available Gemini accounts: no available accounts',
        status: 'INTERNAL'
      }
    }), 503)).toBe(
      'Gemini upstream error (503): No available Gemini accounts: no available accounts'
    );
  });
});
