'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { rewriteSessionHeaderId, forkSessionFile } = require('../../../src/platforms/drivers/omp/session-file');

const content = [
  JSON.stringify({ type: 'title', v: 1, title: '' }),
  JSON.stringify({ type: 'session', version: 3, id: 'original-id', cwd: '/tmp' }),
  JSON.stringify({ type: 'message', id: 'm1', message: { role: 'user', content: 'hi' } }),
  ''
].join('\n');

describe('OMP session fork helper', () => {
  test('rewrites only the session header id', () => {
    const rewritten = rewriteSessionHeaderId(content, 'forked-id');
    const lines = rewritten.split('\n').filter(Boolean).map(JSON.parse);

    expect(lines[1]).toMatchObject({ type: 'session', id: 'forked-id', cwd: '/tmp' });
    expect(lines[2]).toMatchObject({ type: 'message', id: 'm1' });
    expect(lines[0]).toMatchObject({ type: 'title' });
  });

  test('leaves content without a session header unchanged', () => {
    const noHeader = JSON.stringify({ type: 'message', id: 'm1' }) + '\n';
    expect(rewriteSessionHeaderId(noHeader, 'forked-id')).toBe(noHeader);
  });

  test('writes a forked file with the new session id', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omp-fork-'));
    try {
      const source = path.join(dir, 'source.jsonl');
      const target = path.join(dir, 'target.jsonl');
      fs.writeFileSync(source, content, 'utf8');

      const result = forkSessionFile({ sourcePath: source, targetPath: target, newSessionId: 'fork-1' });

      const forked = fs.readFileSync(target, 'utf8');
      expect(result).toMatchObject({ targetPath: target, newSessionId: 'fork-1' });
      expect(forked).toContain('"id":"fork-1"');
      expect(forked).not.toContain('"id":"original-id"');
      expect(fs.readFileSync(source, 'utf8')).toContain('"id":"original-id"');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
