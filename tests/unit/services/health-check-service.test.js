const os = require('os');
const fs = require('fs');
const path = require('path');

const { ensureProjectClaudeDir, healthCheckAllProjects } = require('../../../src/platforms/drivers/claude/health-check');

let testDir;

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'health-'));
});

afterEach(() => {
  fs.rmSync(testDir, { recursive: true, force: true });
});

describe('ensureProjectClaudeDir', () => {
  test('returns created: false and sessionsDirExists: true when directory already exists', () => {
    const sessionsDir = path.join(testDir, '.claude', 'sessions');
    fs.mkdirSync(sessionsDir, { recursive: true });

    const result = ensureProjectClaudeDir(testDir);

    expect(result.projectPath).toBe(testDir);
    expect(result.created).toBe(false);
    expect(result.sessionsDirExists).toBe(true);
    expect(result.claudeDirExists).toBe(true);
    expect(result.error).toBeNull();
  });

  test('creates directory and returns created: true when it does not exist', () => {
    const result = ensureProjectClaudeDir(testDir);

    expect(result.projectPath).toBe(testDir);
    expect(result.created).toBe(true);
    expect(result.sessionsDirExists).toBe(true);
    expect(result.claudeDirExists).toBe(true);
    expect(result.error).toBeNull();
    expect(fs.existsSync(path.join(testDir, '.claude', 'sessions'))).toBe(true);
  });

  test('creates sessions dir when .claude exists but sessions does not', () => {
    const claudeDir = path.join(testDir, '.claude');
    fs.mkdirSync(claudeDir, { recursive: true });

    const result = ensureProjectClaudeDir(testDir);

    expect(result.created).toBe(true);
    expect(result.sessionsDirExists).toBe(true);
    expect(result.claudeDirExists).toBe(true);
    expect(result.error).toBeNull();
    expect(fs.existsSync(path.join(claudeDir, 'sessions'))).toBe(true);
  });

  test('returns error when path has permission issues', () => {
    // Use a path that cannot be created: a file acting as a parent directory
    const blockerFile = path.join(testDir, 'blocker');
    fs.writeFileSync(blockerFile, 'not a dir');

    // Try to use the file as if it were a directory (sub-path under a file)
    const invalidProjectPath = path.join(blockerFile, 'project');

    const result = ensureProjectClaudeDir(invalidProjectPath);

    expect(result.error).toBeTruthy();
    expect(typeof result.error).toBe('string');
  });

  test('returns projectPath in result', () => {
    const result = ensureProjectClaudeDir(testDir);
    expect(result.projectPath).toBe(testDir);
  });

  test('does not modify existing sessions dir contents', () => {
    const sessionsDir = path.join(testDir, '.claude', 'sessions');
    fs.mkdirSync(sessionsDir, { recursive: true });
    const marker = path.join(sessionsDir, 'marker.txt');
    fs.writeFileSync(marker, 'test');

    ensureProjectClaudeDir(testDir);

    expect(fs.existsSync(marker)).toBe(true);
    expect(fs.readFileSync(marker, 'utf8')).toBe('test');
  });
});

describe('healthCheckAllProjects', () => {
  test('empty array returns zero summary and empty results', () => {
    const result = healthCheckAllProjects([]);

    expect(result.summary).toEqual({ total: 0, created: 0, errors: 0, healthy: 0 });
    expect(result.results).toEqual([]);
  });

  test('projects without fullPath are skipped', () => {
    const projects = [
      { name: 'no-path' },
      { name: 'also-no-path', path: '/some/path' }
    ];

    const result = healthCheckAllProjects(projects);

    expect(result.summary.total).toBe(0);
    expect(result.results).toHaveLength(0);
  });

  test('multiple projects are each checked', () => {
    const dir1 = fs.mkdtempSync(path.join(os.tmpdir(), 'health-proj1-'));
    const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'health-proj2-'));

    try {
      const projects = [{ fullPath: dir1 }, { fullPath: dir2 }];
      const result = healthCheckAllProjects(projects);

      expect(result.summary.total).toBe(2);
      expect(result.results).toHaveLength(2);
      expect(result.results[0].projectPath).toBe(dir1);
      expect(result.results[1].projectPath).toBe(dir2);
    } finally {
      fs.rmSync(dir1, { recursive: true, force: true });
      fs.rmSync(dir2, { recursive: true, force: true });
    }
  });

  test('mix of existing and new directories produces correct counts', () => {
    // dir1: sessions already exists (no creation needed)
    const dir1 = fs.mkdtempSync(path.join(os.tmpdir(), 'health-existing-'));
    fs.mkdirSync(path.join(dir1, '.claude', 'sessions'), { recursive: true });

    // dir2: sessions does not exist (will be created)
    const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'health-new-'));

    // dir3: invalid path (will error)
    const blockerFile = path.join(testDir, 'blocker2');
    fs.writeFileSync(blockerFile, 'not a dir');
    const dir3 = path.join(blockerFile, 'project');

    try {
      const projects = [
        { fullPath: dir1 },
        { fullPath: dir2 },
        { fullPath: dir3 }
      ];
      const result = healthCheckAllProjects(projects);

      expect(result.summary.total).toBe(3);
      expect(result.summary.created).toBe(1);
      expect(result.summary.errors).toBe(1);
      expect(result.summary.healthy).toBe(2); // total - errors
    } finally {
      fs.rmSync(dir1, { recursive: true, force: true });
      fs.rmSync(dir2, { recursive: true, force: true });
    }
  });

  test('all healthy projects result in healthy equal to total', () => {
    const dir1 = fs.mkdtempSync(path.join(os.tmpdir(), 'health-h1-'));
    const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'health-h2-'));

    try {
      const projects = [{ fullPath: dir1 }, { fullPath: dir2 }];
      const result = healthCheckAllProjects(projects);

      expect(result.summary.errors).toBe(0);
      expect(result.summary.healthy).toBe(result.summary.total);
    } finally {
      fs.rmSync(dir1, { recursive: true, force: true });
      fs.rmSync(dir2, { recursive: true, force: true });
    }
  });

  test('projects with mixed fullPath presence: only those with fullPath are processed', () => {
    const validDir = fs.mkdtempSync(path.join(os.tmpdir(), 'health-valid-'));

    try {
      const projects = [
        { fullPath: validDir },
        { name: 'no-fullPath' },
        { fullPath: null },
        { fullPath: undefined }
      ];
      const result = healthCheckAllProjects(projects);

      expect(result.summary.total).toBe(1);
      expect(result.results).toHaveLength(1);
      expect(result.results[0].projectPath).toBe(validDir);
    } finally {
      fs.rmSync(validDir, { recursive: true, force: true });
    }
  });
});
