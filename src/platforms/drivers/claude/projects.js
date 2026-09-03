'use strict';

const fs = require('fs');
const path = require('path');
const { createProjectsDriver } = require('../../../shared/driver-factories/projects');

function createProject({ projectName, projectPath } = {}) {
  if (!projectName || !projectPath) {
    const error = new Error('projectName and projectPath are required');
    error.statusCode = 400;
    throw error;
  }
  if (!fs.existsSync(projectPath)) {
    const error = new Error('项目路径不存在');
    error.statusCode = 400;
    throw error;
  }
  if (!fs.statSync(projectPath).isDirectory()) {
    const error = new Error('项目路径必须是一个目录');
    error.statusCode = 400;
    throw error;
  }

  const claudeDir = path.join(projectPath, '.claude');
  const sessionsDir = path.join(claudeDir, 'sessions');
  if (fs.existsSync(claudeDir)) {
    const error = new Error('该项目已经初始化过 Claude Code');
    error.statusCode = 400;
    throw error;
  }

  fs.mkdirSync(sessionsDir, { recursive: true });
  const projectConfig = {
    name: projectName,
    createdAt: new Date().toISOString(),
    version: '1.0'
  };
  fs.writeFileSync(
    path.join(claudeDir, 'project.json'),
    JSON.stringify(projectConfig, null, 2),
    'utf8'
  );

  return { success: true, projectName, projectPath, claudeDir };
}

function createDriver(context = {}) {
  return createProjectsDriver({
    ...context,
    platform: 'claude',
    servicePath: './claude/sessions-implementation',
    localServicePath: '../../platforms/drivers/claude/sessions-implementation',
    createProject,
    onSuccess: operation => {
      if (['saveProjectOrder', 'createProject', 'deleteProject'].includes(operation)) {
        context.sessionHistoryIndex?.invalidateSource('claude');
      }
    }
  });
}

module.exports = { createDriver };
