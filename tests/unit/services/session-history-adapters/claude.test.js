import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { parse } = require('../../../../src/platforms/drivers/claude/session-history-adapter');

describe('Claude session history adapter', () => {
  let rootDir;

  beforeEach(() => {
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-claude-adapter-'));
  });

  afterEach(() => {
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it('parses user and assistant content nested under message', async () => {
    const filePath = path.join(rootDir, 'nested-session.jsonl');
    const fixture = [
      {
        type: 'user',
        uuid: 'envelope-user',
        timestamp: '2026-08-31T10:00:00.000Z',
        message: {
          id: 'user-1',
          role: 'user',
          content: 'Find the session parser'
        }
      },
      {
        type: 'assistant',
        timestamp: '2026-08-31T10:00:01.000Z',
        message: {
          id: 'assistant-1',
          role: 'assistant',
          model: 'claude-sonnet-test',
          content: [
            { type: 'text', text: 'I found the parser.' },
            { type: 'tool_use', name: 'read_file', input: { path: 'claude.js' } }
          ]
        }
      }
    ];
    fs.writeFileSync(filePath, fixture.map((record) => JSON.stringify(record)).join('\n') + '\n', 'utf8');
    const stat = fs.statSync(filePath);

    const result = await parse({
      filePath,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      sessionId: 'nested-session',
      projectHint: 'nested-project'
    });

    expect(result.session.firstMessage).toBe('Find the session parser');
    expect(result.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: 'user',
        messageId: 'user-1',
        content: 'Find the session parser',
        userMessageNumber: 1
      }),
      expect.objectContaining({
        role: 'assistant',
        content: expect.stringContaining('I found the parser.'),
        messageId: 'assistant-1',
        model: 'claude-sonnet-test'
      })
    ]));
  });
});
