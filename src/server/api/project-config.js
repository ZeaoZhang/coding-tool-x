'use strict';

const express = require('express');
const { ProjectConfigService } = require('../services/project-config-service');
const { sendApiError } = require('./validation-errors');

const router = express.Router();
const projectConfigService = new ProjectConfigService();
const SUPPORTED_PLATFORMS = new Set(['claude', 'codex', 'gemini', 'opencode', 'omp']);

function requireProjectPath(source = {}) {
  const projectPath = source.projectPath;
  if (typeof projectPath !== 'string' || !projectPath.trim()) {
    throw new Error('projectPath is required');
  }
  return projectPath.trim();
}

function requirePlatform(source = {}) {
  const platform = String(source.platform || 'claude').trim().toLowerCase();
  if (!SUPPORTED_PLATFORMS.has(platform)) {
    throw new Error(`Unsupported platform: ${source.platform || platform}`);
  }
  return platform;
}

function queryInput(req) {
  return { ...req.query, ...(req.body && typeof req.body === 'object' ? req.body : {}) };
}

router.get('/', async (req, res) => {
  try {
    const input = queryInput(req);
    const projectPath = requireProjectPath(input);
    const platform = requirePlatform(input);
    const snapshot = await projectConfigService.getSnapshot(projectPath, platform);
    res.json(snapshot);
  } catch (error) {
    console.error('[Project Config API] Get snapshot failed:', error);
    sendApiError(res, error);
  }
});

router.get('/skills', async (req, res) => {
  try {
    const input = queryInput(req);
    const projectPath = requireProjectPath(input);
    const platform = requirePlatform(input);
    const skills = await projectConfigService.listProjectSkills(projectPath, platform);
    res.json({ success: true, projectPath, platform, skills });
  } catch (error) {
    console.error('[Project Config API] List project Skills failed:', error);
    sendApiError(res, error);
  }
});

router.put('/skills/toggle', async (req, res) => {
  try {
    const projectPath = requireProjectPath(req.body);
    const platform = requirePlatform(req.body);
    if (!req.body.controlKey) throw new Error('Skill controlKey is required');
    const result = await projectConfigService.setProjectSkillEnabled(
      projectPath,
      platform,
      req.body.controlKey,
      req.body.enabled
    );
    res.json({ success: true, projectPath, platform, ...result });
  } catch (error) {
    console.error('[Project Config API] Toggle project Skill failed:', error);
    sendApiError(res, error);
  }
});

router.get('/instruction', async (req, res) => {
  try {
    const input = queryInput(req);
    const projectPath = requireProjectPath(input);
    const platform = requirePlatform(input);
    const instruction = await projectConfigService.readInstruction(projectPath, platform);
    res.json({ success: true, projectPath, platform, instruction });
  } catch (error) {
    console.error('[Project Config API] Read instruction failed:', error);
    sendApiError(res, error);
  }
});

router.put('/instruction', async (req, res) => {
  try {
    const projectPath = requireProjectPath(req.body);
    const platform = requirePlatform(req.body);
    if (typeof req.body.content !== 'string') throw new Error('Instruction content must be a string');
    const instruction = await projectConfigService.writeInstruction(projectPath, platform, req.body.content);
    res.json({ success: true, projectPath, platform, instruction });
  } catch (error) {
    console.error('[Project Config API] Write instruction failed:', error);
    sendApiError(res, error);
  }
});

router.delete('/instruction', async (req, res) => {
  try {
    const input = queryInput(req);
    const projectPath = requireProjectPath(input);
    const platform = requirePlatform(input);
    const instruction = await projectConfigService.deleteInstruction(projectPath, platform);
    res.json({ success: true, projectPath, platform, instruction });
  } catch (error) {
    console.error('[Project Config API] Delete instruction failed:', error);
    sendApiError(res, error);
  }
});

router.get('/mcp', async (req, res) => {
  try {
    const input = queryInput(req);
    const projectPath = requireProjectPath(input);
    const platform = requirePlatform(input);
    const mcp = await projectConfigService.listProjectMcp(projectPath, platform);
    res.json({ success: true, projectPath, platform, mcp });
  } catch (error) {
    console.error('[Project Config API] List project MCP failed:', error);
    sendApiError(res, error);
  }
});

router.put('/mcp/:id', async (req, res) => {
  try {
    const projectPath = requireProjectPath(req.body);
    const platform = requirePlatform(req.body);
    if (!req.body.server || typeof req.body.server !== 'object' || Array.isArray(req.body.server)) {
      throw new Error('MCP server spec must be an object');
    }
    const result = await projectConfigService.upsertProjectMcp(
      projectPath,
      platform,
      req.params.id,
      req.body.server
    );
    res.json({ success: result.success !== false, projectPath, platform, server: result });
  } catch (error) {
    console.error('[Project Config API] Upsert project MCP failed:', error);
    sendApiError(res, error);
  }
});

router.delete('/mcp/:id', async (req, res) => {
  try {
    const input = queryInput(req);
    const projectPath = requireProjectPath(input);
    const platform = requirePlatform(input);
    const result = await projectConfigService.removeProjectMcp(projectPath, platform, req.params.id);
    res.json({ success: result.success !== false, projectPath, platform, server: result });
  } catch (error) {
    console.error('[Project Config API] Remove project MCP failed:', error);
    sendApiError(res, error);
  }
});

router.post('/mcp/:id/test', async (req, res) => {
  try {
    const projectPath = requireProjectPath(req.body);
    const platform = requirePlatform(req.body);
    const result = await projectConfigService.testProjectMcp(projectPath, platform, req.params.id);
    res.json({ success: true, projectPath, platform, result });
  } catch (error) {
    console.error('[Project Config API] Test project MCP failed:', error);
    sendApiError(res, error, error.code === 'MCP_DISABLED' ? 403 : 500);
  }
});

module.exports = router;
