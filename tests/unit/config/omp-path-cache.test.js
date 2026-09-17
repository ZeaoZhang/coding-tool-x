'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  getOmpAgentDir,
  persistOmpAgentPath
} = require('../../../src/config/paths');

describe('OMP native path persistence', () => {
  let tempDir;
  let cacheFile;
  let agentDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-tool-omp-path-'));
    cacheFile = path.join(tempDir, 'omp-path.json');
    agentDir = path.join(tempDir, 'agent');
    fs.mkdirSync(agentDir);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('persists a CLI-discovered path and reuses it without invoking the CLI', () => {
    const env = {
      ...process.env,
      OMP_COMMAND: 'omp-cache-test',
      OMP_CONFIG_DIR: '',
      OMP_PROFILE: '',
      PI_CODING_AGENT_DIR: '',
      OMP_CODING_AGENT_DIR: ''
    };
    const discoverRunner = vi.fn(() => `${agentDir}\n`);

    expect(getOmpAgentDir(env, { commandRunner: discoverRunner, cacheFile })).toBe(agentDir);
    expect(persistOmpAgentPath(agentDir, { env, cacheFile })).toBe(true);
    expect(JSON.parse(fs.readFileSync(cacheFile, 'utf8'))).toEqual(expect.objectContaining({
      version: 1,
      agentDir
    }));

    const cachedRunner = vi.fn(() => {
      throw new Error('cached path should avoid the CLI');
    });
    expect(getOmpAgentDir(env, { commandRunner: cachedRunner, cacheFile })).toBe(agentDir);
    expect(cachedRunner).not.toHaveBeenCalled();
  });
});
