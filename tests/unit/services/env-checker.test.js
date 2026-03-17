const fs = require('fs');
const os = require('os');
const path = require('path');

let testDir;
let envChecker;
let sensitiveEnvBackup;

const SYSTEM_CONFIG_FILES = ['/etc/profile', '/etc/bashrc', '/etc/zshrc'];

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function clearSensitiveEnvVars() {
  sensitiveEnvBackup = new Map();
  Object.keys(process.env)
    .filter((key) => /(ANTHROPIC|OPENAI|GEMINI|GOOGLE_API_KEY)/.test(key))
    .forEach((key) => {
      sensitiveEnvBackup.set(key, process.env[key]);
      delete process.env[key];
    });
}

function restoreSensitiveEnvVars() {
  if (!sensitiveEnvBackup) return;
  for (const [key, value] of sensitiveEnvBackup.entries()) {
    process.env[key] = value;
  }
}

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-checker-'));
  clearSensitiveEnvVars();

  const pathsModulePath = require.resolve('../../../src/config/paths');
  require.cache[pathsModulePath] = {
    id: pathsModulePath,
    filename: pathsModulePath,
    loaded: true,
    exports: {
      HOME_DIR: testDir
    }
  };

  const actualExistsSync = fs.existsSync.bind(fs);
  vi.spyOn(fs, 'existsSync').mockImplementation((filePath) => {
    if (SYSTEM_CONFIG_FILES.includes(String(filePath))) {
      return false;
    }
    return actualExistsSync(filePath);
  });

  delete require.cache[require.resolve('../../../src/server/services/env-checker')];
  envChecker = require('../../../src/server/services/env-checker');
});

afterEach(() => {
  restoreSensitiveEnvVars();
  vi.restoreAllMocks();
  fs.rmSync(testDir, { recursive: true, force: true });
  [
    '../../../src/server/services/env-checker',
    '../../../src/config/paths'
  ].forEach((mod) => {
    try {
      delete require.cache[require.resolve(mod)];
    } catch (_) {}
  });
});

describe('env-checker conflict detection', () => {
  test('returns masked conflicts for variables with different values across sources', () => {
    process.env.ANTHROPIC_API_KEY = 'proc-secret-1234';
    writeFile(path.join(testDir, '.zshrc'), 'export ANTHROPIC_API_KEY="file-secret-5678"\n');

    const conflicts = envChecker.checkEnvConflicts('claude');

    expect(conflicts).toHaveLength(2);
    expect(conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        varName: 'ANTHROPIC_API_KEY',
        varValue: 'proc****1234',
        sourceType: 'process',
        sourcePath: 'Process Environment',
        platform: 'claude'
      }),
      expect.objectContaining({
        varName: 'ANTHROPIC_API_KEY',
        varValue: 'file****5678',
        sourceType: 'file',
        sourcePath: `${path.join(testDir, '.zshrc')}:1`,
        filePath: path.join(testDir, '.zshrc'),
        lineNumber: 1,
        platform: 'claude'
      })
    ]));
    expect(conflicts.every((item) => !Object.prototype.hasOwnProperty.call(item, 'valueFingerprint'))).toBe(true);

    expect(envChecker.getConflictStats(conflicts)).toEqual({
      total: 2,
      byPlatform: { claude: 2 },
      bySourceType: { process: 1, file: 1 }
    });
  });

  test('ignores identical values and harmless IDE variables', () => {
    process.env.OPENAI_API_KEY = 'shared-secret-0000';
    writeFile(path.join(testDir, '.zshrc'), [
      'export OPENAI_API_KEY="shared-secret-0000"',
      'export GEMINI_CLI_IDE_WORKSPACE_PATH="/workspace/demo"'
    ].join('\n'));

    expect(envChecker.checkEnvConflicts()).toEqual([]);
  });
});
