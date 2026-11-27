import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  normalizeSkillName,
  baseNameOf,
  splitSkillPath,
  readPathFromCommand,
  extractSkillTargets
} = require('../../../src/server/services/skill-usage-extractors');

describe('skill-usage-extractors', () => {
  it('keeps namespaces and strips the skill:// scheme and subpaths', () => {
    expect(normalizeSkillName('skill://code-review/scripts/run.sh')).toBe('code-review');
    expect(normalizeSkillName('oh-my-claudecode:autopilot')).toBe('oh-my-claudecode:autopilot');
    expect(normalizeSkillName(' Skill://Foo/ ')).toBe('foo');
    expect(baseNameOf('oh-my-claudecode:autopilot')).toBe('autopilot');
  });

  it('splits user and project skill paths', () => {
    expect(splitSkillPath('/home/u/.claude/skills/foo/SKILL.md')).toEqual({
      name: 'foo',
      root: '/home/u/.claude/skills'
    });
    expect(splitSkillPath('/w/proj/.dsh/skills/bar/scripts/x.py')).toEqual({
      name: 'bar',
      root: '/w/proj/.dsh/skills'
    });
    expect(splitSkillPath('/w/proj/src/index.js')).toBeNull();
  });

  it('reads explicit file reads from a shell command', () => {
    expect(readPathFromCommand('cd /w/p/.dsh/skills/ssh-skill && sed -n 1,150p SKILL.md'))
      .toBe('/w/p/.dsh/skills/ssh-skill/SKILL.md');
    expect(readPathFromCommand('sed -i s/a/b/ /x/skills/foo/SKILL.md')).toBeNull();
    expect(readPathFromCommand('rg foo /x/skills/foo/SKILL.md')).toBeNull();
    expect(readPathFromCommand('ls /x/skills')).toBeNull();
  });

  it('extracts each platform grammar and ignores search commands', () => {
    expect(extractSkillTargets('claude', { id: 'c1', name: 'Skill', args: { skill: 'debug-router' } }))
      .toEqual([expect.objectContaining({ callId: 'c1', normalizedName: 'debug-router', targetKind: 'name' })]);

    expect(extractSkillTargets('omp', { id: 'c2', name: 'read', args: { path: 'skill://remote-ssh/scripts/x.py' } }))
      .toEqual([expect.objectContaining({ callId: 'c2', normalizedName: 'remote-ssh', targetKind: 'name' })]);

    expect(extractSkillTargets('codex', { id: 'c3', name: 'read', args: { file_path: '/u/.codex/skills/plan/SKILL.md' } }))
      .toEqual([expect.objectContaining({ callId: 'c3', normalizedName: 'plan', skillRoot: '/u/.codex/skills', targetKind: 'path' })]);

    expect(extractSkillTargets('dsh', { id: 'c4', name: 'bash', args: { command: 'cd /w/.dsh/skills/qianliu-ci && cat SKILL.md' } }))
      .toEqual([expect.objectContaining({ callId: 'c4', normalizedName: 'qianliu-ci', targetKind: 'path' })]);

    expect(extractSkillTargets('dsh', { id: 'c5', name: 'bash', args: { command: 'grep -r skill /w/.dsh/skills' } }))
      .toEqual([]);

    expect(extractSkillTargets('gemini', { id: 'c6', name: 'read_file', args: { file_path: '/g/skills/foo/SKILL.md' } }))
      .toEqual([expect.objectContaining({ normalizedName: 'foo', targetKind: 'path' })]);

    expect(extractSkillTargets('opencode', { id: 'c7', name: 'read', args: { file_path: '/o/skills/bar/SKILL.md' } }))
      .toEqual([expect.objectContaining({ normalizedName: 'bar', targetKind: 'path' })]);
  });

  it('ignores non-skill tool calls', () => {
    expect(extractSkillTargets('claude', { id: 'c8', name: 'Read', args: { file_path: '/x/a.md' } })).toEqual([]);
    expect(extractSkillTargets('omp', { id: 'c9', name: 'read', args: { path: '/x/a.md' } })).toEqual([]);
    expect(extractSkillTargets('codex', { id: 'c10', name: 'shell', args: { command: 'ls' } })).toEqual([]);
  });
});
