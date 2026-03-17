const fs = require('fs');
const os = require('os');
const path = require('path');

let testDir;
let backupDir;
let envManager;

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-manager-'));
  backupDir = path.join(testDir, '.cc-tool', 'env-backups');

  const pathsModulePath = require.resolve('../../../src/config/paths');
  require.cache[pathsModulePath] = {
    id: pathsModulePath,
    filename: pathsModulePath,
    loaded: true,
    exports: {
      PATHS: {
        envBackups: backupDir
      },
      ensureStorageDirMigrated: vi.fn()
    }
  };

  delete require.cache[require.resolve('../../../src/server/services/env-manager')];
  envManager = require('../../../src/server/services/env-manager');
});

afterEach(() => {
  delete process.env.OPENAI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  fs.rmSync(testDir, { recursive: true, force: true });
  [
    '../../../src/server/services/env-manager',
    '../../../src/config/paths'
  ].forEach((mod) => {
    try {
      delete require.cache[require.resolve(mod)];
    } catch (_) {}
  });
});

describe('env-manager delete and restore', () => {
  test('backs up file values, removes assignments, and clears process env vars', () => {
    const shellFile = path.join(testDir, '.zshrc');
    const psFile = path.join(testDir, 'Documents', 'PowerShell', 'Microsoft.PowerShell_profile.ps1');
    writeFile(shellFile, 'export OPENAI_API_KEY="file-openai-key"\nexport KEEP_ME="yes"\n');
    writeFile(psFile, '$env:GEMINI_API_KEY = "file-gemini-key"\n$env:KEEP = "ok"\n');

    process.env.OPENAI_API_KEY = 'proc-openai-key';
    process.env.GEMINI_API_KEY = 'proc-gemini-key';

    const result = envManager.deleteEnvVars([
      {
        varName: 'OPENAI_API_KEY',
        sourceType: 'file',
        sourcePath: `${shellFile}:1`,
        filePath: shellFile,
        lineNumber: 1
      },
      {
        varName: 'GEMINI_API_KEY',
        sourceType: 'file',
        sourcePath: `${psFile}:1`,
        filePath: psFile,
        lineNumber: 1
      },
      {
        varName: 'OPENAI_API_KEY',
        sourceType: 'process',
        sourcePath: 'Process Environment'
      }
    ]);

    expect(result.processConflictsSkipped).toBe(1);
    expect(result.clearedProcessVars.sort()).toEqual(['GEMINI_API_KEY', 'OPENAI_API_KEY']);
    expect(process.env.OPENAI_API_KEY).toBeUndefined();
    expect(process.env.GEMINI_API_KEY).toBeUndefined();
    expect(fs.readFileSync(shellFile, 'utf8')).toBe('export KEEP_ME="yes"\n');
    expect(fs.readFileSync(psFile, 'utf8')).toBe('$env:KEEP = "ok"\n');

    const backup = readJson(result.backupPath);
    expect(backup.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        varName: 'OPENAI_API_KEY',
        originalValue: 'file-openai-key'
      }),
      expect.objectContaining({
        varName: 'GEMINI_API_KEY',
        originalValue: 'file-gemini-key'
      }),
      expect.objectContaining({
        varName: 'OPENAI_API_KEY',
        sourceType: 'process',
        originalValue: null
      })
    ]));
  });

  test('lists backups and restores removed variables back to shell files', () => {
    const shellFile = path.join(testDir, '.bashrc');
    const psFile = path.join(testDir, 'profile.ps1');
    writeFile(shellFile, 'export KEEP_ME="yes"\n');
    writeFile(psFile, '$env:KEEP = "ok"\n');

    const deletion = envManager.deleteEnvVars([
      {
        varName: 'OPENAI_API_KEY',
        sourceType: 'file',
        sourcePath: `${shellFile}:1`,
        filePath: shellFile,
        lineNumber: 1
      },
      {
        varName: 'GEMINI_API_KEY',
        sourceType: 'file',
        sourcePath: `${psFile}:1`,
        filePath: psFile,
        lineNumber: 1
      }
    ]);

    const backup = readJson(deletion.backupPath);
    backup.conflicts[0].originalValue = 'restored-openai-key';
    backup.conflicts[1].originalValue = 'restored-gemini-key';
    fs.writeFileSync(deletion.backupPath, JSON.stringify(backup, null, 2), 'utf8');

    const backups = envManager.getBackupList();
    const restored = envManager.restoreFromBackup(deletion.backupPath);

    expect(backups[0]).toEqual(expect.objectContaining({
      filePath: deletion.backupPath,
      conflictCount: 2
    }));
    expect(restored.results).toEqual([
      {
        varName: 'OPENAI_API_KEY',
        filePath: shellFile,
        success: true
      },
      {
        varName: 'GEMINI_API_KEY',
        filePath: psFile,
        success: true
      }
    ]);
    expect(fs.readFileSync(shellFile, 'utf8')).toContain('export OPENAI_API_KEY="restored-openai-key"');
    expect(fs.readFileSync(psFile, 'utf8')).toContain('$env:GEMINI_API_KEY = "restored-gemini-key"');
  });

  test('rejects process-only deletions and backup paths outside the backup directory', () => {
    const outsideBackup = path.join(testDir, 'outside.json');
    writeFile(outsideBackup, '{}');

    expect(() => envManager.deleteEnvVars([
      {
        varName: 'ANTHROPIC_API_KEY',
        sourceType: 'process',
        sourcePath: 'Process Environment'
      }
    ])).toThrow('进程环境变量无法直接删除');

    expect(() => envManager.deleteBackup(outsideBackup)).toThrow('无效的备份文件路径');
  });
});
