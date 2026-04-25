const http = require('http');

const {
  createClaudeStreamRecoveryState,
  mergeClaudeStreamEvent,
  buildAssistantMessageFromStreamState,
  buildClaudeCountTokensPayload,
  recoverClaudeUsageViaCountTokens
} = require('../../../src/server/services/claude-token-recovery');

describe('claude-token-recovery', () => {
  test('rebuilds assistant text and tool_use blocks from Claude SSE events', () => {
    const state = createClaudeStreamRecoveryState();

    mergeClaudeStreamEvent(state, 'message_start', {
      type: 'message_start',
      message: {
        model: 'MiniMax-M2.5'
      }
    });
    mergeClaudeStreamEvent(state, 'content_block_start', {
      type: 'content_block_start',
      index: 0,
      content_block: {
        type: 'text',
        text: ''
      }
    });
    mergeClaudeStreamEvent(state, 'content_block_delta', {
      type: 'content_block_delta',
      index: 0,
      delta: {
        type: 'text_delta',
        text: 'pong'
      }
    });
    mergeClaudeStreamEvent(state, 'content_block_start', {
      type: 'content_block_start',
      index: 1,
      content_block: {
        type: 'tool_use',
        id: 'tool-1',
        name: 'mcp_search'
      }
    });
    mergeClaudeStreamEvent(state, 'content_block_delta', {
      type: 'content_block_delta',
      index: 1,
      delta: {
        type: 'input_json_delta',
        partial_json: '{"query":"docs"}'
      }
    });

    expect(state.model).toBe('MiniMax-M2.5');
    expect(buildAssistantMessageFromStreamState(state)).toEqual({
      role: 'assistant',
      content: [
        {
          type: 'text',
          text: 'pong'
        },
        {
          type: 'tool_use',
          id: 'tool-1',
          name: 'mcp_search',
          input: {
            query: 'docs'
          }
        }
      ]
    });
  });

  test('recovers prompt and output tokens via count_tokens fallback', async () => {
    let server;
    let promptCountRequests = 0;

    server = http.createServer((req, res) => {
      let requestBody = '';
      req.on('data', (chunk) => {
        requestBody += chunk.toString('utf8');
      });
      req.on('end', () => {
        const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
        expect(pathname).toBe('/v1/messages/count_tokens');

        const parsedBody = JSON.parse(requestBody);
        promptCountRequests += 1;

        res.writeHead(200, {
          'Content-Type': 'application/json'
        });

        if (parsedBody.messages.length === 1) {
          res.end(JSON.stringify({ input_tokens: 43 }));
          return;
        }

        expect(parsedBody.messages[1]).toEqual({
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: 'pong'
            }
          ]
        });
        res.end(JSON.stringify({ input_tokens: 75 }));
      });
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

    try {
      const usage = await recoverClaudeUsageViaCountTokens({
        baseUrl: `http://127.0.0.1:${server.address().port}`,
        apiKey: 'test-key',
        requestBody: buildClaudeCountTokensPayload({
          model: 'glm-5-local',
          messages: [
            {
              role: 'user',
              content: 'Reply with exactly: pong'
            }
          ]
        }),
        assistantMessage: {
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: 'pong'
            }
          ]
        }
      });

      expect(promptCountRequests).toBe(2);
      expect(usage).toEqual({
        inputTokens: 43,
        outputTokens: 32
      });
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
