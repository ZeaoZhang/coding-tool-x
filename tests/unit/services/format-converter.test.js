const {
  parseFrontmatter,
  generateFrontmatter,
  detectSkillFormat,
  detectCommandFormat,
  convertSkillToCodex,
  convertSkillToClaude,
  convertCommandToCodex,
  convertCommandToClaude,
  convertSkillsBatch,
  convertCommandsBatch,
  parseSkillContent,
  parseCommandContent,
  CODEX_LIMITS
} = require('../../../src/server/services/format-converter');

// ---------------------------------------------------------------------------
// parseFrontmatter
// ---------------------------------------------------------------------------
describe('parseFrontmatter', () => {
  test('returns empty frontmatter and original body when no frontmatter present', () => {
    const content = 'Just plain text body.';
    const result = parseFrontmatter(content);
    expect(result.frontmatter).toEqual({});
    expect(result.body).toBe(content);
  });

  test('parses basic key-value frontmatter', () => {
    const content = '---\nname: my-skill\ndescription: A test skill\n---\nBody here.';
    const result = parseFrontmatter(content);
    expect(result.frontmatter.name).toBe('my-skill');
    expect(result.frontmatter.description).toBe('A test skill');
    expect(result.body).toBe('Body here.');
  });

  test('unquotes double-quoted YAML values', () => {
    const content = '---\nname: "quoted name"\n---\nbody';
    const result = parseFrontmatter(content);
    expect(result.frontmatter.name).toBe('quoted name');
  });

  test('unquotes single-quoted YAML values', () => {
    const content = "---\nname: 'single quoted'\n---\nbody";
    const result = parseFrontmatter(content);
    expect(result.frontmatter.name).toBe('single quoted');
  });

  test('parses nested object (metadata block)', () => {
    const content = [
      '---',
      'name: my-skill',
      'metadata:',
      '  short-description: short',
      '  author: alice',
      '---',
      'body'
    ].join('\n');
    const result = parseFrontmatter(content);
    expect(result.frontmatter.metadata).toEqual({
      'short-description': 'short',
      author: 'alice'
    });
  });

  test('strips BOM character from content', () => {
    const content = '\uFEFF---\nname: bom-skill\n---\nbody';
    const result = parseFrontmatter(content);
    expect(result.frontmatter.name).toBe('bom-skill');
  });

  test('parses block scalar with > (folded)', () => {
    const content = [
      '---',
      'description: >',
      '  line one',
      '  line two',
      '---',
      'body'
    ].join('\n');
    const result = parseFrontmatter(content);
    // folded: lines joined with space
    expect(result.frontmatter.description).toBe('line one line two');
  });

  test('parses block scalar with | (literal)', () => {
    const content = [
      '---',
      'description: |',
      '  line one',
      '  line two',
      '---',
      'body'
    ].join('\n');
    const result = parseFrontmatter(content);
    expect(result.frontmatter.description).toContain('line one');
    expect(result.frontmatter.description).toContain('line two');
  });

  test('parses multi-line description without block scalar marker', () => {
    const content = [
      '---',
      'description:',
      '  This is a longer',
      '  multi-line description',
      '---',
      'body'
    ].join('\n');
    const result = parseFrontmatter(content);
    expect(result.frontmatter.description).toContain('This is a longer');
    expect(result.frontmatter.description).toContain('multi-line description');
  });

  test('body is trimmed', () => {
    const content = '---\nname: x\n---\n\n  body text  \n';
    const result = parseFrontmatter(content);
    expect(result.body).toBe('body text');
  });
});

// ---------------------------------------------------------------------------
// generateFrontmatter
// ---------------------------------------------------------------------------
describe('generateFrontmatter', () => {
  test('claude format includes name and description', () => {
    const fm = generateFrontmatter({ name: 'my-skill', description: 'A skill' }, 'claude');
    expect(fm).toContain('name: "my-skill"');
    expect(fm).toContain('description: "A skill"');
    expect(fm).toMatch(/^---/);
    expect(fm).toMatch(/---$/);
  });

  test('claude format includes optional fields: license, allowed-tools, model, context, agent', () => {
    const fm = generateFrontmatter({
      name: 'cmd',
      description: 'desc',
      license: 'MIT',
      'allowed-tools': 'Bash,Read',
      'argument-hint': '<text>',
      model: 'claude-opus-4-5',
      context: 'all',
      agent: 'claude'
    }, 'claude');
    expect(fm).toContain('license: "MIT"');
    expect(fm).toContain('allowed-tools: Bash,Read');
    expect(fm).toContain('model: claude-opus-4-5');
    expect(fm).toContain('context: all');
    expect(fm).toContain('agent: claude');
    expect(fm).toContain('argument-hint: <text>');
  });

  test('codex format includes name, description, and metadata', () => {
    const fm = generateFrontmatter({
      name: 'codex-skill',
      description: 'A codex skill',
      metadata: { 'short-description': 'short', author: 'bob' }
    }, 'codex');
    expect(fm).toContain('name: "codex-skill"');
    expect(fm).toContain('description: "A codex skill"');
    expect(fm).toContain('metadata:');
    expect(fm).toContain('  short-description: "short"');
    expect(fm).toContain('  author: "bob"');
  });

  test('codex format includes argument-hint when provided', () => {
    const fm = generateFrontmatter({
      description: 'A prompt',
      'argument-hint': '<query>'
    }, 'codex');
    expect(fm).toContain('argument-hint: <query>');
  });

  test('minimal data does not emit empty fields', () => {
    const fm = generateFrontmatter({}, 'claude');
    expect(fm).not.toContain('name:');
    expect(fm).not.toContain('description:');
    expect(fm).not.toContain('license:');
  });

  test('escapes double quotes in values', () => {
    const fm = generateFrontmatter({ name: 'say "hello"', description: 'test' }, 'claude');
    expect(fm).toContain('\\"hello\\"');
  });
});

// ---------------------------------------------------------------------------
// detectSkillFormat
// ---------------------------------------------------------------------------
describe('detectSkillFormat', () => {
  test('returns "codex" when frontmatter has metadata object', () => {
    const content = '---\nname: s\ndescription: d\nmetadata:\n  author: x\n---\nbody';
    expect(detectSkillFormat(content)).toBe('codex');
  });

  test('returns "claude" when frontmatter has allowed-tools', () => {
    const content = '---\nname: s\ndescription: d\nallowed-tools: Bash\n---\nbody';
    expect(detectSkillFormat(content)).toBe('claude');
  });

  test('returns "claude" when frontmatter has license', () => {
    const content = '---\nname: s\ndescription: d\nlicense: MIT\n---\nbody';
    expect(detectSkillFormat(content)).toBe('claude');
  });

  test('returns "claude" when both name and description present (ambiguous)', () => {
    const content = '---\nname: s\ndescription: d\n---\nbody';
    expect(detectSkillFormat(content)).toBe('claude');
  });

  test('returns "unknown" when no frontmatter', () => {
    expect(detectSkillFormat('just plain text')).toBe('unknown');
  });

  test('returns "unknown" when frontmatter has neither name/description nor distinguishing fields', () => {
    const content = '---\nfoo: bar\n---\nbody';
    expect(detectSkillFormat(content)).toBe('unknown');
  });
});

// ---------------------------------------------------------------------------
// detectCommandFormat
// ---------------------------------------------------------------------------
describe('detectCommandFormat', () => {
  test('returns "claude" when frontmatter has model', () => {
    const content = '---\ndescription: d\nmodel: claude-opus-4-5\n---\nbody';
    expect(detectCommandFormat(content)).toBe('claude');
  });

  test('returns "claude" when frontmatter has allowed-tools', () => {
    const content = '---\nallowed-tools: Bash\n---\nbody';
    expect(detectCommandFormat(content)).toBe('claude');
  });

  test('returns "claude" when frontmatter has context field', () => {
    const content = '---\ndescription: d\ncontext: all\n---\nbody';
    expect(detectCommandFormat(content)).toBe('claude');
  });

  test('returns "codex" when frontmatter has only description (no claude-specific fields)', () => {
    const content = '---\ndescription: A prompt\n---\nbody';
    expect(detectCommandFormat(content)).toBe('codex');
  });

  test('returns "unknown" when no frontmatter', () => {
    expect(detectCommandFormat('plain text')).toBe('unknown');
  });
});

// ---------------------------------------------------------------------------
// convertSkillToCodex
// ---------------------------------------------------------------------------
describe('convertSkillToCodex', () => {
  const claudeSkill = [
    '---',
    'name: my-skill',
    'description: Does something useful',
    'license: MIT',
    'allowed-tools: Bash,Read',
    '---',
    'Skill body content here.'
  ].join('\n');

  test('returns format "codex" and preserves body', () => {
    const result = convertSkillToCodex(claudeSkill);
    expect(result.format).toBe('codex');
    expect(result.content).toContain('Skill body content here.');
  });

  test('converted content has valid codex frontmatter', () => {
    const result = convertSkillToCodex(claudeSkill);
    expect(result.content).toContain('name: "my-skill"');
    expect(result.content).toContain('description: "Does something useful"');
  });

  test('warns about unsupported allowed-tools field', () => {
    const result = convertSkillToCodex(claudeSkill);
    expect(result.warnings.some(w => w.includes('allowed-tools'))).toBe(true);
  });

  test('warns and truncates name exceeding 100 chars', () => {
    const longName = 'a'.repeat(CODEX_LIMITS.skillName + 10);
    const content = `---\nname: ${longName}\ndescription: d\n---\nbody`;
    const result = convertSkillToCodex(content);
    const parsed = parseFrontmatter(result.content);
    expect(parsed.frontmatter.name.length).toBe(CODEX_LIMITS.skillName);
    expect(result.warnings.some(w => w.includes('name'))).toBe(true);
  });

  test('warns and truncates description exceeding 500 chars', () => {
    const longDesc = 'b'.repeat(CODEX_LIMITS.skillDescription + 20);
    const content = `---\nname: s\ndescription: ${longDesc}\n---\nbody`;
    const result = convertSkillToCodex(content);
    const parsed = parseFrontmatter(result.content);
    expect(parsed.frontmatter.description.length).toBe(CODEX_LIMITS.skillDescription);
    expect(result.warnings.some(w => w.includes('description'))).toBe(true);
  });

  test('no warnings when content is clean', () => {
    const content = '---\nname: s\ndescription: short\n---\nbody';
    const result = convertSkillToCodex(content);
    expect(result.warnings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// convertSkillToClaude
// ---------------------------------------------------------------------------
describe('convertSkillToClaude', () => {
  const codexSkill = [
    '---',
    'name: codex-skill',
    'description: A codex skill',
    'metadata:',
    '  short-description: short',
    '  author: alice',
    '---',
    'Skill body.'
  ].join('\n');

  test('returns format "claude" and preserves body', () => {
    const result = convertSkillToClaude(codexSkill);
    expect(result.format).toBe('claude');
    expect(result.content).toContain('Skill body.');
  });

  test('converted content has valid claude frontmatter', () => {
    const result = convertSkillToClaude(codexSkill);
    expect(result.content).toContain('name: "codex-skill"');
    expect(result.content).toContain('description: "A codex skill"');
  });

  test('warns about metadata.short-description', () => {
    const result = convertSkillToClaude(codexSkill);
    expect(result.warnings.some(w => w.includes('short-description'))).toBe(true);
  });

  test('no warnings when metadata has no short-description', () => {
    const content = [
      '---',
      'name: s',
      'description: d',
      'metadata:',
      '  author: bob',
      '---',
      'body'
    ].join('\n');
    const result = convertSkillToClaude(content);
    expect(result.warnings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// convertCommandToCodex
// ---------------------------------------------------------------------------
describe('convertCommandToCodex', () => {
  const claudeCommand = [
    '---',
    'description: Fix linting errors',
    'allowed-tools: Bash',
    'model: claude-opus-4-5',
    'context: all',
    'agent: claude',
    '---',
    'Please fix all lint errors.'
  ].join('\n');

  test('returns format "codex" and preserves body', () => {
    const result = convertCommandToCodex(claudeCommand);
    expect(result.format).toBe('codex');
    expect(result.content).toContain('Please fix all lint errors.');
  });

  test('warns about allowed-tools, model, context, agent', () => {
    const result = convertCommandToCodex(claudeCommand);
    const warnText = result.warnings.join(' ');
    expect(warnText).toContain('allowed-tools');
    expect(warnText).toContain('model');
    expect(warnText).toContain('context');
    expect(warnText).toContain('agent');
  });

  test('preserves argument-hint in output', () => {
    const content = '---\ndescription: d\nargument-hint: <file>\n---\nbody';
    const result = convertCommandToCodex(content);
    expect(result.content).toContain('argument-hint: <file>');
  });

  test('warns about bash execution syntax !`cmd`', () => {
    const content = '---\ndescription: d\n---\nRun !`ls -la` here.';
    const result = convertCommandToCodex(content);
    expect(result.warnings.some(w => w.includes('Bash'))).toBe(true);
  });

  test('warns about @filepath syntax', () => {
    const content = '---\ndescription: d\n---\nSee @src/file.js for details.';
    const result = convertCommandToCodex(content);
    expect(result.warnings.some(w => w.includes('@'))).toBe(true);
  });

  test('no warnings for clean command', () => {
    const content = '---\ndescription: A simple prompt\n---\nDo the thing.';
    const result = convertCommandToCodex(content);
    expect(result.warnings).toHaveLength(0);
  });

  test('output has no frontmatter when source has no description or argument-hint', () => {
    const content = 'Plain prompt text only.';
    const result = convertCommandToCodex(content);
    expect(result.content).not.toContain('---');
    expect(result.content).toContain('Plain prompt text only.');
  });
});

// ---------------------------------------------------------------------------
// convertCommandToClaude
// ---------------------------------------------------------------------------
describe('convertCommandToClaude', () => {
  test('returns format "claude" and preserves body', () => {
    const content = '---\ndescription: A codex prompt\n---\nDo something.';
    const result = convertCommandToClaude(content);
    expect(result.format).toBe('claude');
    expect(result.content).toContain('Do something.');
  });

  test('converted content includes description in frontmatter', () => {
    const content = '---\ndescription: My prompt\n---\nbody text';
    const result = convertCommandToClaude(content);
    expect(result.content).toContain('description: "My prompt"');
  });

  test('preserves argument-hint', () => {
    const content = '---\ndescription: d\nargument-hint: <query>\n---\nbody';
    const result = convertCommandToClaude(content);
    expect(result.content).toContain('argument-hint: <query>');
  });

  test('produces no frontmatter when no description or argument-hint', () => {
    const content = 'Just plain body.';
    const result = convertCommandToClaude(content);
    expect(result.content).not.toContain('---');
    expect(result.content).toContain('Just plain body.');
  });

  test('returns empty warnings for basic conversion', () => {
    const content = '---\ndescription: d\n---\nbody';
    const result = convertCommandToClaude(content);
    expect(result.warnings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// convertSkillsBatch
// ---------------------------------------------------------------------------
describe('convertSkillsBatch', () => {
  test('converts multiple skills to codex format', () => {
    const skills = [
      { name: 'skill-a', content: '---\nname: skill-a\ndescription: A\n---\nbody a' },
      { name: 'skill-b', content: '---\nname: skill-b\ndescription: B\n---\nbody b' }
    ];
    const results = convertSkillsBatch(skills, 'codex');
    expect(results).toHaveLength(2);
    expect(results[0].success).toBe(true);
    expect(results[0].format).toBe('codex');
    expect(results[1].success).toBe(true);
    expect(results[1].name).toBe('skill-b');
  });

  test('converts multiple skills to claude format', () => {
    const skills = [
      {
        name: 'codex-skill',
        content: [
          '---',
          'name: codex-skill',
          'description: D',
          'metadata:',
          '  author: x',
          '---',
          'body'
        ].join('\n')
      }
    ];
    const results = convertSkillsBatch(skills, 'claude');
    expect(results[0].success).toBe(true);
    expect(results[0].format).toBe('claude');
  });

  test('marks entry as failed when conversion throws', () => {
    // Pass a skill with content that triggers a thrown error by mocking would be complex;
    // instead verify that an intentionally bad object is handled via null content gracefully
    // by overriding convertSkillToCodex with a skill that makes parseFrontmatter return safely.
    // Actually test the error-catch path by passing undefined content which will throw.
    const skills = [
      { name: 'bad-skill', content: undefined }
    ];
    const results = convertSkillsBatch(skills, 'codex');
    expect(results[0].success).toBe(false);
    expect(results[0].name).toBe('bad-skill');
    expect(typeof results[0].error).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// parseSkillContent
// ---------------------------------------------------------------------------
describe('parseSkillContent', () => {
  test('parses codex skill with metadata', () => {
    const content = [
      '---',
      'name: codex-s',
      'description: Codex skill',
      'metadata:',
      '  short-description: short',
      '  author: alice',
      '---',
      'body text'
    ].join('\n');
    const result = parseSkillContent(content);
    expect(result.name).toBe('codex-s');
    expect(result.description).toBe('Codex skill');
    expect(result.format).toBe('codex');
    expect(result.metadata).toEqual({ 'short-description': 'short', author: 'alice' });
    expect(result.shortDescription).toBe('short');
    expect(result.body).toBe('body text');
  });

  test('parses claude skill with allowed-tools and license', () => {
    const content = [
      '---',
      'name: claude-s',
      'description: Claude skill',
      'license: MIT',
      'allowed-tools: Bash,Read',
      '---',
      'skill body'
    ].join('\n');
    const result = parseSkillContent(content);
    expect(result.name).toBe('claude-s');
    expect(result.format).toBe('claude');
    expect(result.allowedTools).toBe('Bash,Read');
    expect(result.license).toBe('MIT');
  });

  test('fullContent is preserved', () => {
    const content = '---\nname: s\ndescription: d\n---\nbody';
    const result = parseSkillContent(content);
    expect(result.fullContent).toBe(content);
  });
});

// ---------------------------------------------------------------------------
// parseCommandContent
// ---------------------------------------------------------------------------
describe('parseCommandContent', () => {
  test('parses claude command with all fields', () => {
    const content = [
      '---',
      'description: Fix errors',
      'allowed-tools: Bash',
      'model: claude-opus-4-5',
      'context: all',
      'agent: claude',
      'argument-hint: <target>',
      '---',
      'command body'
    ].join('\n');
    const result = parseCommandContent(content);
    expect(result.description).toBe('Fix errors');
    expect(result.format).toBe('claude');
    expect(result.allowedTools).toBe('Bash');
    expect(result.model).toBe('claude-opus-4-5');
    expect(result.context).toBe('all');
    expect(result.agent).toBe('claude');
    expect(result.argumentHint).toBe('<target>');
    expect(result.body).toBe('command body');
  });

  test('parses codex command (description only)', () => {
    const content = [
      '---',
      'description: A simple prompt',
      'argument-hint: <query>',
      '---',
      'prompt body'
    ].join('\n');
    const result = parseCommandContent(content);
    expect(result.description).toBe('A simple prompt');
    expect(result.format).toBe('codex');
    expect(result.argumentHint).toBe('<query>');
    expect(result.body).toBe('prompt body');
    // Claude-specific fields should be absent
    expect(result.model).toBeUndefined();
    expect(result.allowedTools).toBeUndefined();
  });

  test('fullContent is preserved', () => {
    const content = '---\ndescription: d\n---\nbody';
    const result = parseCommandContent(content);
    expect(result.fullContent).toBe(content);
  });
});
