'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { SkillRefreshTaskService } = require('../../../src/server/services/skill-refresh-task-service');

describe('SkillRefreshTaskService', () => {
  let tempDir;
  let persistencePath;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-refresh-tasks-'));
    persistencePath = path.join(tempDir, 'runtime', 'skill-refresh-tasks.json');
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('enqueue returns before repository fetch completes', async () => {
    let release;
    const worker = vi.fn(() => new Promise(resolve => { release = resolve; }));
    const taskService = new SkillRefreshTaskService({ worker, persistencePath });
    const task = taskService.enqueue({ platform: 'claude', scope: 'user' });

    expect(task.status).toBe('queued');
    expect(worker).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(worker).toHaveBeenCalledTimes(1);
    release({ status: 'succeeded', fetchedSkills: 2 });
    await taskService.waitFor(task.id);

    expect(taskService.get(task.id)).toEqual(expect.objectContaining({
      status: 'succeeded',
      fetchedSkills: 2
    }));
  });

  test('same refresh key reuses active task', () => {
    const worker = vi.fn(() => new Promise(() => {}));
    const taskService = new SkillRefreshTaskService({ worker, persistencePath });
    const first = taskService.enqueue({ platform: 'codex', scope: 'user' });
    const second = taskService.enqueue({ platform: 'codex', scope: 'user' });

    expect(second.id).toBe(first.id);
    expect(second.deduplicated).toBe(true);
  });

  test('canonical project paths participate in task deduplication', () => {
    const worker = vi.fn(() => new Promise(() => {}));
    const taskService = new SkillRefreshTaskService({ worker, persistencePath });
    const projectPath = path.join(tempDir, 'project');
    fs.mkdirSync(projectPath, { recursive: true });

    const first = taskService.enqueue({ platform: 'claude', scope: 'project', projectPath });
    const second = taskService.enqueue({
      platform: 'claude',
      scope: 'project',
      projectPath: path.join(projectPath, '.')
    });

    expect(second.id).toBe(first.id);
  });

  test('failed repository is partial and old artifacts remain', async () => {
    const worker = vi.fn(async () => ({
      status: 'partial',
      failedRepos: [{ repoId: 'repo-1', error: 'timeout' }],
      fetchedRepos: 1,
      fetchedSkills: 2
    }));
    const taskService = new SkillRefreshTaskService({ worker, persistencePath });
    const queued = taskService.enqueue({ platform: 'claude', scope: 'user' });
    await taskService.waitFor(queued.id);

    expect(taskService.get(queued.id)).toEqual(expect.objectContaining({
      status: 'partial',
      failedRepos: [{ repoId: 'repo-1', error: 'timeout' }],
      fetchedSkills: 2
    }));
  });

  test('marks persisted queued and running tasks interrupted without auto-running them', async () => {
    fs.mkdirSync(path.dirname(persistencePath), { recursive: true });
    fs.writeFileSync(persistencePath, JSON.stringify({
      version: 1,
      tasks: [
        { id: 'queued-task', key: 'claude:user:', status: 'queued' },
        { id: 'running-task', key: 'codex:user:', status: 'running' },
        { id: 'done-task', key: 'gemini:user:', status: 'succeeded' }
      ]
    }));
    const worker = vi.fn(() => Promise.resolve({ status: 'succeeded' }));
    const taskService = new SkillRefreshTaskService({ worker, persistencePath });

    expect(taskService.get('queued-task').status).toBe('interrupted');
    expect(taskService.get('running-task').status).toBe('interrupted');
    expect(taskService.get('done-task').status).toBe('succeeded');
    await Promise.resolve();
    expect(worker).not.toHaveBeenCalled();
  });
});
