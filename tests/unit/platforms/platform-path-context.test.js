'use strict';

const path = require('path');
const {
  createPlatformPathContext,
  mergePathOverlay,
  normalizePathOverlay,
  readPlatformPathOverlay
} = require('../../../src/platforms/platform-path-context');

describe('platform path context', () => {
  test('accepts path-only overlays and never merges platform behavior', () => {
    const manifest = {
      key: 'demo-cli',
      command: 'demo',
      capabilities: { sessions: 'generic-jsonl' },
      paths: { home: '{home}/.demo', sessions: '{home}/sessions' }
    };
    const overlay = normalizePathOverlay({
      platforms: {
        'demo-cli': {
          paths: { home: '/var/tmp/demo', sessions: '{home}/history' },
          capabilities: { sessions: 'legacy:claude' }
        }
      }
    });

    expect(overlay).toEqual({
      platforms: {
        'demo-cli': {
          paths: { home: '/var/tmp/demo', sessions: '{home}/history' }
        }
      }
    });
    expect(mergePathOverlay(manifest, overlay)).toEqual({
      ...manifest,
      paths: { home: '/var/tmp/demo', sessions: '{home}/history' }
    });
    expect(manifest.paths).toEqual({ home: '{home}/.demo', sessions: '{home}/sessions' });
  });

  test('reports invalid overlay files without making startup fail', () => {
    const fsImpl = {
      existsSync: () => true,
      readFileSync: () => '{"platforms":{"bad key":{"paths":{"home":42}}}}'
    };

    expect(readPlatformPathOverlay({ fsImpl, filePath: '/tmp/platform-paths.json' })).toEqual({
      platforms: {},
      diagnostics: [expect.objectContaining({ source: 'pathOverlay', key: 'bad key' })]
    });
  });

  test('builds canonical native paths from resolved manifest paths', () => {
    const context = createPlatformPathContext({
      key: 'codex',
      manifest: { key: 'codex', pathResolverId: 'codex' },
      resolvedPaths: { home: '/var/tmp/codex' },
      pathOptions: { homeDir: '/Users/demo' }
    });

    expect(context.platform).toBe('codex');
    expect(context.home).toBe('/var/tmp/codex');
    expect(context.native).toEqual(expect.objectContaining({
      dir: '/var/tmp/codex',
      config: path.join('/var/tmp/codex', 'config.toml'),
      sessions: path.join('/var/tmp/codex', 'sessions')
    }));
  });
});
