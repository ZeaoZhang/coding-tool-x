'use strict';

const { SkillFormatAdapter, FORMAT_IDS } = require('../../../src/server/services/skill-format-adapters');

describe('SkillFormatAdapter', () => {
  let adapter;

  beforeEach(() => {
    adapter = new SkillFormatAdapter();
  });

  test('returns an independent stable format id for every supported platform', () => {
    expect(FORMAT_IDS).toEqual({
      claude: 'claude-skill-v1',
      codex: 'codex-skill-v1',
      gemini: 'gemini-skill-v1',
      opencode: 'opencode-skill-v1',
      omp: 'omp-skill-v1'
    });
  });

  test.each(Object.keys(FORMAT_IDS))('normalizes %s without sharing another platform format', platform => {
    const sourceFiles = [
      { relativePath: 'SKILL.md', content: '---\nname: demo\ndescription: test\n---\nBody' },
      { relativePath: 'references/guide.md', content: 'guide' }
    ];
    const result = adapter.normalize({
      platform,
      files: sourceFiles,
      sourceMetadata: { name: 'demo' }
    });

    expect(result.format).toBe(FORMAT_IDS[platform]);
    expect(result.files).toEqual(expect.arrayContaining([
      expect.objectContaining({ relativePath: 'SKILL.md' }),
      expect.objectContaining({ relativePath: 'references/guide.md', content: 'guide' })
    ]));
    expect(result.files).not.toBe(sourceFiles);
  });

  test('uses the Codex converter only for the Codex artifact', () => {
    const source = '---\nname: demo\ndescription: test\nallowed-tools: Bash\n---\nBody';
    const codex = adapter.normalize({ platform: 'codex', files: [{ relativePath: 'SKILL.md', content: source }] });
    const claude = adapter.normalize({ platform: 'claude', files: [{ relativePath: 'SKILL.md', content: source }] });

    expect(codex.format).toBe('codex-skill-v1');
    expect(codex.files[0].content).not.toContain('allowed-tools');
    expect(claude.format).toBe('claude-skill-v1');
    expect(claude.files[0].content).toContain('allowed-tools');
    expect(codex.warnings).toEqual(expect.arrayContaining([expect.stringContaining('allowed-tools')]));
  });

  test('rejects unsupported platforms and missing root Skill files', () => {
    expect(() => adapter.normalize({ platform: 'unknown', files: [] })).toThrow(/platform/i);
    expect(() => adapter.normalize({ platform: 'claude', files: [{ relativePath: 'README.md', content: 'readme' }] })).toThrow(/SKILL\.md/i);
  });
});
