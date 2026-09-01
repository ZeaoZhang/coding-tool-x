'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { SkillArtifactStore } = require('../../../src/server/services/skill-artifact-store');

describe('SkillArtifactStore', () => {
  let tempDir;
  let store;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-artifacts-'));
    store = new SkillArtifactStore({ root: path.join(tempDir, 'artifacts'), fsImpl: fs });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('publishes one complete native Skill artifact for one CLI platform', async () => {
    const result = await store.publishSkill({
      platform: 'codex',
      sourceKey: 'github:owner/repo:skills/demo',
      format: 'codex-skill-v1',
      files: [
        { relativePath: 'SKILL.md', content: '---\nname: demo\n---\nBody' },
        { relativePath: 'scripts/helper.sh', content: '#!/bin/sh\ntrue' }
      ],
      metadata: { name: 'demo', revision: 'commit-a' }
    });

    expect(result.state).toBe('ready');
    expect(result.format).toBe('codex-skill-v1');
    expect(fs.existsSync(path.join(result.root, 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(result.root, 'scripts', 'helper.sh'))).toBe(true);
    expect(result.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(fs.existsSync(path.join(path.dirname(result.root), 'metadata.json'))).toBe(true);
  });

  test('keeps artifacts isolated by platform and format', async () => {
    const sourceKey = 'github:owner/repo:skills/shared';
    const claude = await store.publishSkill({
      platform: 'claude',
      sourceKey,
      format: 'claude-skill-v1',
      files: [{ relativePath: 'SKILL.md', content: 'claude' }],
      metadata: { name: 'shared' }
    });
    const codex = await store.publishSkill({
      platform: 'codex',
      sourceKey,
      format: 'codex-skill-v1',
      files: [{ relativePath: 'SKILL.md', content: 'codex' }],
      metadata: { name: 'shared' }
    });

    expect(claude.root).not.toBe(codex.root);
    expect(fs.readFileSync(path.join(claude.root, 'SKILL.md'), 'utf8')).toBe('claude');
    expect(fs.readFileSync(path.join(codex.root, 'SKILL.md'), 'utf8')).toBe('codex');
  });

  test('rejects unsafe relative paths and symlink entries', () => {
    expect(() => store.publishSkill({
      platform: 'claude',
      sourceKey: 'github:owner/repo:skills/bad',
      format: 'claude-skill-v1',
      files: [{ relativePath: '../escape', content: 'bad' }],
      metadata: {}
    })).toThrow(/invalid|unsafe|symlink|escape/i);

    expect(() => store.publishSkill({
      platform: 'claude',
      sourceKey: 'github:owner/repo:skills/link',
      format: 'claude-skill-v1',
      files: [
        { relativePath: 'SKILL.md', content: 'valid' },
        { relativePath: 'scripts/link', type: 'symlink', target: '/tmp/secret' }
      ],
      metadata: {}
    })).toThrow(/symlink/i);
  });

  test('failed publication leaves the previous per-Skill artifact untouched', async () => {
    const sourceKey = 'github:owner/repo:skills/stable';
    const previous = await store.publishSkill({
      platform: 'claude',
      sourceKey,
      format: 'claude-skill-v1',
      files: [{ relativePath: 'SKILL.md', content: 'first-content' }],
      metadata: { name: 'stable', revision: 'commit-a' }
    });

    expect(() => store.publishSkill({
      platform: 'claude',
      sourceKey,
      format: 'claude-skill-v1',
      files: [{ relativePath: 'SKILL.md', content: '' }],
      metadata: { name: 'stable', revision: 'commit-b' }
    })).toThrow();
    expect(fs.readFileSync(path.join(previous.root, 'SKILL.md'), 'utf8')).toBe('first-content');
  });

  test('does not persist complete secret values in artifact metadata', () => {
    expect(() => store.publishSkill({
      platform: 'claude',
      sourceKey: 'github:owner/repo:skills/secret',
      format: 'claude-skill-v1',
      files: [{ relativePath: 'SKILL.md', content: 'valid' }],
      metadata: { name: 'secret', env: { TOKEN: 'value' } }
    })).toThrow(/secret/i);
  });
});
