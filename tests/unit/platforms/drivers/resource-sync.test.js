'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

describe('resourceSync Driver contracts', () => {
  test.each(['claude', 'codex', 'gemini', 'opencode', 'omp'])('%s owns native resource synchronization', platform => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-tool-x-resource-driver-'));
    const configs = path.join(tempDir, 'configs');
    const source = path.join(configs, 'skills', 'demo');
    fs.mkdirSync(source, { recursive: true });
    fs.writeFileSync(path.join(source, 'SKILL.md'), '# Demo skill\n', 'utf8');

    const driver = require(`../../../../src/platforms/drivers/${platform}/resource-sync`).createDriver({
      resourcePaths: {
        configs,
        skillArtifacts: path.join(tempDir, 'artifacts'),
        home: tempDir,
        claudeDir: path.join(tempDir, 'claude'),
        codexDir: path.join(tempDir, 'codex'),
        codexConfigPath: path.join(tempDir, 'codex', 'config.toml'),
        geminiDir: path.join(tempDir, 'gemini'),
        opencodeDir: path.join(tempDir, 'opencode'),
        ompDir: path.join(tempDir, 'omp')
      }
    });

    try {
      expect(driver.sync('skills', 'demo')).toMatchObject({
        status: 'ok',
        platform,
        capability: 'resourceSync',
        data: { success: true }
      });
      expect(driver.remove('skills', 'demo')).toMatchObject({
        status: 'ok',
        platform,
        capability: 'resourceSync',
        data: { success: true }
      });
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
