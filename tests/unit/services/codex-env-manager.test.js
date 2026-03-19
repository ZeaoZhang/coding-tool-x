import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../src/config/paths', () => ({
  PATHS: { config: '/tmp/test-config' },
  HOME_DIR: '/tmp/test-home'
}));

const { _test } = require('../../../src/server/services/codex-env-manager');
const {
  buildWindowsEnvBatchScript,
  shellQuote,
  buildHomeRelativeShellPath,
  buildSourceSnippet,
  stripManagedBlock,
  upsertManagedBlock,
  buildNextEnvValues,
  getPosixProfileCandidates
} = _test;

// ---------------------------------------------------------------------------
// shellQuote
// ---------------------------------------------------------------------------
describe('shellQuote', () => {
  it('wraps a simple string in single quotes', () => {
    expect(shellQuote('hello')).toBe("'hello'");
  });

  it("escapes internal single quotes with '\"'\"'", () => {
    expect(shellQuote("it's")).toBe("'it'\"'\"'s'");
  });

  it('handles an empty string', () => {
    expect(shellQuote('')).toBe("''");
  });

  it('preserves spaces inside the quotes', () => {
    expect(shellQuote('hello world')).toBe("'hello world'");
  });
});

// ---------------------------------------------------------------------------
// buildHomeRelativeShellPath
// ---------------------------------------------------------------------------
describe('buildHomeRelativeShellPath', () => {
  const home = '/home/user';

  it('replaces the home prefix with $HOME', () => {
    expect(buildHomeRelativeShellPath('/home/user/.bashrc', home)).toBe('$HOME/.bashrc');
  });

  it('returns $HOME when filePath equals homeDir', () => {
    expect(buildHomeRelativeShellPath('/home/user', home)).toBe('$HOME');
  });

  it('returns the absolute path unchanged when outside home dir', () => {
    expect(buildHomeRelativeShellPath('/etc/profile', home)).toBe('/etc/profile');
  });

  it('converts backslashes to forward slashes', () => {
    // Simulate a Windows-style path outside of home
    const result = buildHomeRelativeShellPath('/other/path', home);
    expect(result).not.toContain('\\');
  });
});

// ---------------------------------------------------------------------------
// buildSourceSnippet
// ---------------------------------------------------------------------------
describe('buildSourceSnippet', () => {
  it('produces the expected block for an absolute path outside home', () => {
    const snippet = buildSourceSnippet('/etc/codex-env.sh', '/home/user');
    expect(snippet).toBe(
      '# >>> coding-tool codex env >>>\n' +
      '[ -f "/etc/codex-env.sh" ] && . "/etc/codex-env.sh"\n' +
      '# <<< coding-tool codex env <<<'
    );
  });

  it('uses $HOME placeholder for a path under home dir', () => {
    const snippet = buildSourceSnippet('/home/user/.cc-tool/codex-env.sh', '/home/user');
    expect(snippet).toContain('$HOME/.cc-tool/codex-env.sh');
    expect(snippet).toContain('# >>> coding-tool codex env >>>');
    expect(snippet).toContain('# <<< coding-tool codex env <<<');
  });
});

// ---------------------------------------------------------------------------
// stripManagedBlock
// ---------------------------------------------------------------------------
describe('stripManagedBlock', () => {
  const start = '# >>> coding-tool codex env >>>';
  const end   = '# <<< coding-tool codex env <<<';

  it('returns content unchanged when no markers are present', () => {
    const content = 'export FOO=bar\nexport BAZ=qux';
    expect(stripManagedBlock(content)).toBe(content);
  });

  it('removes the managed block including markers', () => {
    const content = `export FOO=bar\n${start}\n[ -f "$HOME/f" ] && . "$HOME/f"\n${end}\nexport BAZ=qux`;
    const result = stripManagedBlock(content);
    expect(result).not.toContain(start);
    expect(result).not.toContain(end);
    expect(result).toContain('export FOO=bar');
    expect(result).toContain('export BAZ=qux');
  });

  it('collapses multiple consecutive newlines left behind', () => {
    const content = `line1\n\n\n${start}\nblock\n${end}\n\n\nline2`;
    const result = stripManagedBlock(content);
    expect(result).not.toMatch(/\n{3,}/);
  });

  it('returns empty string when content is empty', () => {
    expect(stripManagedBlock('')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// upsertManagedBlock
// ---------------------------------------------------------------------------
describe('upsertManagedBlock', () => {
  const snippet = '# >>> coding-tool codex env >>>\n[ -f "$HOME/f" ] && . "$HOME/f"\n# <<< coding-tool codex env <<<';

  it('returns snippet + newline when content is empty', () => {
    expect(upsertManagedBlock('', snippet)).toBe(`${snippet}\n`);
  });

  it('appends snippet to existing content that has no managed block', () => {
    const content = 'export FOO=bar';
    const result = upsertManagedBlock(content, snippet);
    expect(result).toContain('export FOO=bar');
    expect(result).toContain(snippet);
    expect(result.endsWith('\n')).toBe(true);
  });

  it('replaces an old managed block with the new snippet', () => {
    const oldSnippet = '# >>> coding-tool codex env >>>\nold line\n# <<< coding-tool codex env <<<';
    const content = `export FOO=bar\n${oldSnippet}`;
    const result = upsertManagedBlock(content, snippet);
    expect(result).not.toContain('old line');
    expect(result).toContain(snippet);
    expect(result).toContain('export FOO=bar');
  });
});

// ---------------------------------------------------------------------------
// buildNextEnvValues
// ---------------------------------------------------------------------------
describe('buildNextEnvValues', () => {
  it('replace mode with empty previous returns only envMap values', () => {
    const result = buildNextEnvValues({}, { FOO: 'bar' });
    expect(result).toEqual({ FOO: 'bar' });
  });

  it('replace mode ignores previous values', () => {
    const result = buildNextEnvValues({ OLD: 'value' }, { FOO: 'bar' }, { replace: true });
    expect(result).toEqual({ FOO: 'bar' });
    expect(result.OLD).toBeUndefined();
  });

  it('merge mode keeps previous values not overridden', () => {
    const result = buildNextEnvValues({ OLD: 'keep' }, { FOO: 'bar' }, { replace: false });
    expect(result.OLD).toBe('keep');
    expect(result.FOO).toBe('bar');
  });

  it('merge mode overrides previous value with new value for same key', () => {
    const result = buildNextEnvValues({ FOO: 'old' }, { FOO: 'new' }, { replace: false });
    expect(result.FOO).toBe('new');
  });

  it('removeKeys removes the specified keys from result', () => {
    const result = buildNextEnvValues({}, { FOO: 'bar', BAZ: 'qux' }, { removeKeys: ['BAZ'] });
    expect(result.BAZ).toBeUndefined();
    expect(result.FOO).toBe('bar');
  });

  it('filters out empty string values', () => {
    const result = buildNextEnvValues({}, { FOO: '', BAR: 'ok' });
    expect(result.FOO).toBeUndefined();
    expect(result.BAR).toBe('ok');
  });

  it('null envMap returns empty result in replace mode', () => {
    const result = buildNextEnvValues({}, null, { replace: true });
    expect(result).toEqual({});
  });

  it('trims whitespace from keys', () => {
    const result = buildNextEnvValues({}, { '  TRIMMED  ': 'value' });
    expect(result.TRIMMED).toBe('value');
    expect(result['  TRIMMED  ']).toBeUndefined();
  });

  it('converts numeric values to strings', () => {
    const result = buildNextEnvValues({}, { PORT: 3000 });
    expect(result.PORT).toBe('3000');
    expect(typeof result.PORT).toBe('string');
  });

  it('complex scenario: merge, removeKeys, and empty value filtering together', () => {
    const previous = { KEEP: 'yes', REMOVE: 'gone', OVERRIDE: 'old' };
    const envMap = { OVERRIDE: 'new', EMPTY: '', ADDED: 'hi' };
    const result = buildNextEnvValues(previous, envMap, { replace: false, removeKeys: ['REMOVE'] });
    expect(result.KEEP).toBe('yes');
    expect(result.REMOVE).toBeUndefined();
    expect(result.OVERRIDE).toBe('new');
    expect(result.EMPTY).toBeUndefined();
    expect(result.ADDED).toBe('hi');
  });
});

// ---------------------------------------------------------------------------
// getPosixProfileCandidates
// ---------------------------------------------------------------------------
describe('getPosixProfileCandidates', () => {
  const home = '/home/user';

  it('prefers .zshrc when SHELL contains zsh', () => {
    const { preferred, candidates } = getPosixProfileCandidates(home, { SHELL: '/bin/zsh' });
    expect(preferred).toBe(`${home}/.zshrc`);
    expect(Array.isArray(candidates)).toBe(true);
    expect(candidates.length).toBeGreaterThan(0);
  });

  it('prefers .bashrc when SHELL contains bash', () => {
    const { preferred, candidates } = getPosixProfileCandidates(home, { SHELL: '/bin/bash' });
    expect(preferred).toBe(`${home}/.bashrc`);
    expect(Array.isArray(candidates)).toBe(true);
  });

  it('prefers .profile for an unknown shell', () => {
    const { preferred, candidates } = getPosixProfileCandidates(home, { SHELL: '/bin/fish' });
    expect(preferred).toBe(`${home}/.profile`);
    expect(Array.isArray(candidates)).toBe(true);
  });
});

describe('buildWindowsEnvBatchScript', () => {
  it('combines set/remove operations and setting-change broadcast into one script', () => {
    const script = buildWindowsEnvBatchScript([
      { key: 'CC_PROXY_KEY', value: 'PROXY_KEY' },
      { key: 'OLD_PROXY_KEY', remove: true }
    ]);

    expect(script).toContain("SetEnvironmentVariable('CC_PROXY_KEY', 'PROXY_KEY', 'User')");
    expect(script).toContain("SetEnvironmentVariable('OLD_PROXY_KEY', $null, 'User')");
    expect(script).toContain('SendMessageTimeout');
  });
});
