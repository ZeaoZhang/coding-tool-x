function isManagedLocalSkill(skill = {}) {
  return Boolean(skill?.isLocal || skill?.source === 'local');
}

function isLocalRepoSkill(skill = {}) {
  return Boolean(
    skill?.source === 'local-repo'
    || skill?.repoProvider === 'local'
    || skill?.repoLocalPath
  );
}

function isGitLabSkill(skill = {}) {
  return Boolean(skill?.repoProvider === 'gitlab' || skill?.repoProjectPath);
}

function isGitHubSkill(skill = {}) {
  return Boolean(
    skill?.repoProvider === 'github'
    || (
      (skill?.repoOwner || skill?.repoName)
      && !isGitLabSkill(skill)
      && !isLocalRepoSkill(skill)
    )
  );
}

export function canInstallSkill(skill = {}) {
  if (skill?.protected || skill?.readonly) return false;
  return Boolean(
    skill?.installSource
    || skill?.isLocal
    || isLocalRepoSkill(skill)
    || isGitLabSkill(skill)
    || isGitHubSkill(skill)
  );
}

export function getSkillSourceTag(skill = {}) {
  if (skill?.protected || skill?.source === 'system-installed') return '系统';
  if (skill?.sourceProvider) {
    const providerLabels = {
      native: 'OMP 原生',
      'omp-plugins': 'OMP 插件',
      claude: 'Claude',
      'claude-plugins': 'Claude 插件',
      agents: 'Agents',
      codex: 'Codex',
      opencode: 'OpenCode',
      custom: '自定义',
      'cc-tool': '本地技能'
    };
    const label = providerLabels[skill.sourceProvider] || skill.sourceProvider;
    return `${label} · ${skill.sourceScope === 'project' ? '项目' : '全局'}`;
  }
  if (skill?.source === 'native-installed') return '原生';
  if (isLocalRepoSkill(skill)) return '本地仓库';
  if (isManagedLocalSkill(skill)) return '本地技能';
  if (isGitLabSkill(skill)) return 'GitLab';
  if (isGitHubSkill(skill)) return 'GitHub';
  return '';
}

export function getSkillSourceLocation(skill = {}) {
  if (isManagedLocalSkill(skill) && !isLocalRepoSkill(skill)) {
    return '';
  }
  if (isLocalRepoSkill(skill)) {
    return skill?.repoLocalPath || '';
  }
  if (isGitLabSkill(skill)) {
    return skill?.repoProjectPath || [skill?.repoOwner, skill?.repoName].filter(Boolean).join('/');
  }
  if (isGitHubSkill(skill)) {
    return [skill?.repoOwner, skill?.repoName].filter(Boolean).join('/');
  }
  return '';
}

export function getSkillSourceLink(skill = {}) {
  if (isManagedLocalSkill(skill) || isLocalRepoSkill(skill)) {
    return null;
  }
  return skill?.readmeUrl || skill?.repoUrl || null;
}

export function getSkillSourceLinkLabel(skill = {}) {
  if (isGitLabSkill(skill)) return 'GitLab';
  if (isGitHubSkill(skill)) return 'GitHub';
  return '仓库';
}

export function formatSkillSourceText(skill = {}) {
  const sourceTag = getSkillSourceTag(skill);
  const sourceLocation = getSkillSourceLocation(skill);

  if (sourceTag && sourceLocation) {
    return `${sourceTag} · ${sourceLocation}`;
  }
  if (sourceTag) {
    return sourceTag;
  }
  return '未知来源';
}
