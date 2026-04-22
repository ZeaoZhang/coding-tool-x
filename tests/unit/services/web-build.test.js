'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const MODULE_PATH = require.resolve('../../../src/server/services/web-build');

let tempDir;
let sourceRoot;
let distRoot;
let inspectWebBuildState;
let ensureWebDistReady;

function writeFile(targetPath, content = 'test') {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, content, 'utf8');
}

function touch(targetPath, date) {
  fs.utimesSync(targetPath, date, date);
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-web-build-test-'));
  sourceRoot = path.join(tempDir, 'src/web');
  distRoot = path.join(tempDir, 'dist/web');

  delete require.cache[MODULE_PATH];
  const mod = require('../../../src/server/services/web-build');
  inspectWebBuildState = mod.inspectWebBuildState;
  ensureWebDistReady = mod.ensureWebDistReady;
});

afterEach(() => {
  delete require.cache[MODULE_PATH];
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('inspectWebBuildState', () => {
  test('skips build checks for published package layouts without src/web sources', () => {
    const state = inspectWebBuildState({ sourceRoot, distRoot });

    expect(state.sourceAvailable).toBe(false);
    expect(state.needsBuild).toBe(false);
    expect(state.reason).toBe('source-unavailable');
  });

  test('marks dist as missing when sources exist but no built assets are present', () => {
    writeFile(path.join(sourceRoot, 'package.json'), '{"name":"cc-tool-web"}');
    writeFile(path.join(sourceRoot, 'src/App.vue'), '<template />');

    const state = inspectWebBuildState({ sourceRoot, distRoot });

    expect(state.sourceAvailable).toBe(true);
    expect(state.needsBuild).toBe(true);
    expect(state.reason).toBe('dist-missing');
  });

  test('marks dist as stale when watched web sources are newer than built assets', () => {
    writeFile(path.join(sourceRoot, 'package.json'), '{"name":"cc-tool-web"}');
    writeFile(path.join(sourceRoot, 'src/App.vue'), '<template>new</template>');
    writeFile(path.join(distRoot, 'index.html'), '<html></html>');

    const oldDate = new Date('2026-01-01T00:00:00.000Z');
    const newDate = new Date('2026-01-02T00:00:00.000Z');

    touch(path.join(distRoot, 'index.html'), oldDate);
    touch(path.join(distRoot), oldDate);
    touch(path.join(sourceRoot, 'package.json'), newDate);
    touch(path.join(sourceRoot, 'src/App.vue'), newDate);
    touch(path.join(sourceRoot, 'src'), newDate);
    touch(path.join(sourceRoot), newDate);

    const state = inspectWebBuildState({ sourceRoot, distRoot });

    expect(state.needsBuild).toBe(true);
    expect(state.reason).toBe('dist-stale');
  });
});

describe('ensureWebDistReady', () => {
  test('runs the build hook when dist is missing and re-checks freshness afterward', async () => {
    writeFile(path.join(sourceRoot, 'package.json'), '{"name":"cc-tool-web"}');
    writeFile(path.join(sourceRoot, 'src/App.vue'), '<template>new</template>');

    const runBuild = vi.fn(async ({ distRoot: buildDistRoot }) => {
      writeFile(path.join(buildDistRoot, 'index.html'), '<html></html>');
      writeFile(path.join(buildDistRoot, 'assets/index.js'), 'console.log("built")');
    });

    const result = await ensureWebDistReady({ sourceRoot, distRoot, runBuild });

    expect(runBuild).toHaveBeenCalledTimes(1);
    expect(result.built).toBe(true);
    expect(result.needsBuild).toBe(false);
    expect(result.reason).toBe('up-to-date');
    expect(result.previousReason).toBe('dist-missing');
  });

  test('does not invoke the build hook when sources are unavailable', async () => {
    const runBuild = vi.fn();

    const result = await ensureWebDistReady({ sourceRoot, distRoot, runBuild });

    expect(runBuild).not.toHaveBeenCalled();
    expect(result.built).toBe(false);
    expect(result.reason).toBe('source-unavailable');
  });
});
