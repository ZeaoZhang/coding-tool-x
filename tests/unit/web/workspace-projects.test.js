'use strict';

let createEmptyWorkspaceProject;
let normalizeWorkspaceProjectForSubmit;

beforeAll(async () => {
  ({ createEmptyWorkspaceProject, normalizeWorkspaceProjectForSubmit } = await import('../../../src/web/src/utils/workspace-projects.js'));
});

describe('workspace project utils', () => {
  test('creates manual project draft with existing branch mode by default', () => {
    expect(createEmptyWorkspaceProject()).toEqual(expect.objectContaining({
      fromExisting: false,
      branchMode: 'existing',
      createWorktree: false
    }));
  });

  test('normalizes existing-branch worktree payload without baseBranch', () => {
    expect(normalizeWorkspaceProjectForSubmit({
      sourcePath: ' C:\\repo\\app ',
      name: ' app ',
      isGitRepo: true,
      createWorktree: true,
      branchMode: 'existing',
      branch: ' feature/existing ',
      baseBranch: ' main '
    })).toEqual({
      sourcePath: 'C:\\repo\\app',
      name: 'app',
      createWorktree: true,
      branchMode: 'existing',
      branch: 'feature/existing'
    });
  });

  test('normalizes new-branch worktree payload with baseBranch', () => {
    expect(normalizeWorkspaceProjectForSubmit({
      sourcePath: '/repo/app',
      name: 'app',
      isGitRepo: true,
      createWorktree: true,
      branchMode: 'new',
      branch: 'feature/new',
      baseBranch: 'main'
    })).toEqual({
      sourcePath: '/repo/app',
      name: 'app',
      createWorktree: true,
      branchMode: 'new',
      branch: 'feature/new',
      baseBranch: 'main'
    });
  });

  test('drops branch fields when worktree is disabled', () => {
    expect(normalizeWorkspaceProjectForSubmit({
      sourcePath: '/repo/app',
      name: '',
      isGitRepo: true,
      createWorktree: false,
      branchMode: 'new',
      branch: 'feature/new',
      baseBranch: 'main'
    })).toEqual({
      sourcePath: '/repo/app',
      createWorktree: false
    });
  });
});
