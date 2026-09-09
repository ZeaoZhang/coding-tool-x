import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { inventory, parse } = require('../../../../src/platforms/drivers/codex/session-history-adapter');

describe('Codex session history adapter', () => {
  let rootDir;

  beforeEach(() => {
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-codex-adapter-'));
  });

  afterEach(() => {
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it('preserves the native session id and absolute project cwd', async () => {
    const sessionId = '01a07fa9-0c07-7f20-93e1-6291a75bfc91';
    const projectPath = path.join(rootDir, 'workspace', 'project');
    const sessionDir = path.join(rootDir, '2026', '09', '08');
    fs.mkdirSync(sessionDir, { recursive: true });
    const filePath = path.join(sessionDir, `rollout-2026-09-08T14-16-20-${sessionId}.jsonl`);
    const records = [
      {
        timestamp: '2026-09-08T14:16:20.000Z',
        type: 'session_meta',
        payload: { id: sessionId, cwd: projectPath, timestamp: '2026-09-08T14:16:20.000Z' }
      },
      {
        timestamp: '2026-09-08T14:16:21.000Z',
        type: 'response_item',
        payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hello' }] }
      }
    ];
    fs.writeFileSync(filePath, records.map(record => JSON.stringify(record)).join('\n') + '\n');

    const [descriptor] = await inventory({ projectsDir: rootDir });
    const result = await parse(descriptor);

    expect(result.session.sessionId).toBe(sessionId);
    expect(result.session.projectName).toBe('project');
    expect(result.session.projectFullPath).toBe(projectPath);
  });

  it('uses the rollout filename id when copied metadata still contains the parent id', async () => {
    const parentId = '11111111-1111-4111-8111-111111111111';
    const forkId = '22222222-2222-4222-8222-222222222222';
    const sessionDir = path.join(rootDir, '2026', '09', '08');
    fs.mkdirSync(sessionDir, { recursive: true });
    const filePath = path.join(sessionDir, `rollout-2026-09-08T14-16-20-${forkId}.jsonl`);
    fs.writeFileSync(filePath, `${JSON.stringify({
      timestamp: '2026-09-08T14:16:20.000Z',
      type: 'session_meta',
      payload: { id: parentId, cwd: '/tmp/fork-project' }
    })}\n`);

    const [descriptor] = await inventory({ projectsDir: rootDir });
    const result = await parse(descriptor);

    expect(descriptor.sessionId).toBe(forkId);
    expect(result.session.sessionId).toBe(forkId);
  });
});
