'use strict';

import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildPayload } = require('../../../src/server/services/session-snapshot-worker');

describe('session snapshot worker', () => {
  it('calls the sessions capability with the stable Codex argument contract', async () => {
    const listSessions = vi.fn(() => ({
      status: 'ok',
      data: [{
        sessionId: 'session-1',
        size: 42,
        projectFullPath: '/workspace/project'
      }]
    }));
    const runtime = {
      getDriver: vi.fn((platform, capability) => {
        expect(platform).toBe('codex');
        expect(capability).toBe('sessions');
        return { listSessions };
      })
    };

    const result = await buildPayload({
      source: 'codex',
      projectName: 'project',
      options: { force: true },
      runtime
    });

    expect(listSessions).toHaveBeenCalledWith('project', {
      force: true,
      consistency: 'complete'
    });
    expect(result).toMatchObject({
      sessions: [{ sessionId: 'session-1' }],
      totalSize: 42,
      projectInfo: {
        name: 'project',
        fullPath: '/workspace/project',
        path: '/workspace/project'
      }
    });
  });

  it('uses an indexed Gemini session path when hash lookup has no sidecar mapping', async () => {
    const listSessions = vi.fn(() => ({
      status: 'ok',
      data: [{ sessionId: 'gemini-session', size: 7, projectRoot: '/workspace/gemini-project' }]
    }));
    const getProjectPath = vi.fn(() => ({ status: 'ok', data: null }));
    const runtime = {
      getDriver: vi.fn(() => ({ listSessions, getProjectPath }))
    };

    const result = await buildPayload({
      source: 'gemini',
      projectName: 'project-hash',
      options: { force: true },
      runtime
    });

    expect(result.projectInfo).toMatchObject({
      name: 'project-hash',
      fullPath: '/workspace/gemini-project',
      path: '/workspace/gemini-project',
      displayName: 'gemini-project'
    });
  });

  it('keeps OpenCode project metadata when sessions use an embedded host directory', async () => {
    const listSessions = vi.fn(() => ({
      status: 'ok',
      data: [{
        sessionId: 'opencode-session',
        directory: '/Users/zhangzeao/Library/Application Support/Open Design/namespaces/release-stable/data/projects/project-id'
      }]
    }));
    const getProjects = vi.fn(() => ({
      status: 'ok',
      data: [{
        name: 'global',
        displayName: 'Readable Host Project',
        fullPath: '/workspace/actual-project',
        path: '/workspace/actual-project'
      }]
    }));
    const runtime = {
      getDriver: vi.fn(() => ({ listSessions, getProjects }))
    };

    const result = await buildPayload({
      source: 'opencode',
      projectName: 'global',
      options: { force: true },
      runtime
    });

    expect(result.projectInfo).toMatchObject({
      name: 'global',
      fullPath: '/workspace/actual-project',
      path: '/workspace/actual-project',
      displayName: 'Readable Host Project'
    });
  });
});
