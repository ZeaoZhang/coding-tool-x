'use strict';

const Ajv = require('ajv');

const DRIVER_IDS = new Set([
  'unsupported',
  'generic-jsonl',
  'generic-filesystem',
  'generic-openai-compatible',
  'generic-mcp',
  'generic-prompt',
  'legacy:claude',
  'legacy:codex',
  'legacy:gemini',
  'legacy:opencode',
  'legacy:omp'
]);

const PATH_RESOLVER_IDS = new Set([
  'declarative',
  'claude',
  'codex',
  'gemini',
  'opencode',
  'omp'
]);

const schema = {
  type: 'object',
  required: ['key', 'label', 'command', 'capabilities'],
  additionalProperties: false,
  properties: {
    key: { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]*$' },
    label: { type: 'string', minLength: 1 },
    title: { type: 'string', minLength: 1 },
    command: { type: 'string', minLength: 1 },
    iconToken: { type: 'string', minLength: 1 },
    color: { type: 'string' },
    defaultVisible: { type: 'boolean' },
    custom: { type: 'boolean' },
    helpLabel: { type: 'string', minLength: 1 },
    terminalColor: { type: 'string', minLength: 1 },
    cliSelectable: { type: 'boolean' },
    portLabel: { type: 'string', minLength: 1 },
    apiBasePath: { type: 'string', minLength: 1 },
    logFile: { type: 'string', minLength: 1 },
    logAliases: { type: 'array', items: { type: 'string', minLength: 1 } },
    logNote: { type: 'string' },
    logColor: { type: 'string', minLength: 1 },
    portKey: { type: 'string', minLength: 1 },
    defaultPort: { type: 'integer', minimum: 1 },
    proxyMode: { enum: ['standard', 'managed'] },
    proxyLabels: { type: 'object', additionalProperties: { type: 'string' } },
    resourceTypes: { type: 'object', additionalProperties: { type: 'boolean' } },
    skillActivation: {
      type: 'object',
      additionalProperties: false,
      required: ['user', 'project'],
      properties: {
        user: {
          type: 'object',
          additionalProperties: false,
          required: ['mode', 'format'],
          properties: {
            mode: { enum: ['native-copy', 'native-filter', 'unsupported'] },
            format: { anyOf: [{ type: 'null' }, { type: 'string', pattern: '^[a-z][a-z0-9-]*-skill-v[0-9]+$' }] }
          }
        },
        project: {
          type: 'object',
          additionalProperties: false,
          required: ['mode', 'format'],
          properties: {
            mode: { enum: ['native-copy', 'native-filter', 'unsupported'] },
            format: { anyOf: [{ type: 'null' }, { type: 'string', pattern: '^[a-z][a-z0-9-]*-skill-v[0-9]+$' }] }
          }
        }
      }
    },
    promptFile: { type: ['string', 'null'] },
    promptLabel: { type: 'string', minLength: 1 },
    mcpFormat: { enum: ['json'] },
    statisticsPath: { type: 'string', minLength: 1 },
    paths: { type: 'object', additionalProperties: { type: 'string' } },
    pathResolverId: { enum: [...PATH_RESOLVER_IDS] },
    sessionMapping: { type: 'object', additionalProperties: { type: 'string' } },
    sessionGlob: { type: 'string', minLength: 1 },
    resourceMappings: { type: 'object', additionalProperties: { type: 'string' } },
    projectResources: {
      type: 'object',
      additionalProperties: false,
      required: ['instruction', 'skills', 'mcp'],
      properties: {
        instruction: {
          type: 'object',
          additionalProperties: false,
          required: ['path'],
          properties: {
            path: { type: ['string', 'null'] }
          }
        },
        skills: {
          type: 'object',
          additionalProperties: false,
          required: ['canonicalRoot', 'readRoots'],
          properties: {
            canonicalRoot: { type: 'string', minLength: 1 },
            readRoots: {
              type: 'array',
              minItems: 1,
              items: { type: 'string', minLength: 1 }
            }
          }
        },
        mcp: {
          type: 'object',
          additionalProperties: false,
          required: ['path', 'format'],
          properties: {
            path: { type: ['string', 'null'] },
            format: { enum: ['none', 'claude-json', 'codex-toml', 'gemini-json', 'opencode-json', 'omp-json'] }
          }
        }
      }
    },
    capabilities: { type: 'object', additionalProperties: { enum: [...DRIVER_IDS] } }
  }
};

const validate = new Ajv({ allErrors: true, strict: false }).compile(schema);

function isSafeRelativePath(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  const raw = value.trim().replace(/\\/g, '/');
  if (raw.startsWith('/') || /^[a-zA-Z]:\//.test(raw) || raw.includes('\0')) return false;
  const normalized = raw.replace(/^(\.\/)+/, '');
  const segments = normalized.split('/');
  return segments.every(segment => segment && segment !== '..');
}

function validateProjectResources(manifest, errors) {
  const resources = manifest?.projectResources;
  if (!resources) return;

  const instructionPath = resources.instruction?.path;
  if (instructionPath !== null && !isSafeRelativePath(instructionPath)) {
    errors.push({ instancePath: '/projectResources/instruction/path', message: 'must be a safe relative path or null' });
  }

  const skills = resources.skills;
  if (skills && !isSafeRelativePath(skills.canonicalRoot)) {
    errors.push({ instancePath: '/projectResources/skills/canonicalRoot', message: 'must be a safe relative path' });
  }
  for (const [index, root] of (skills?.readRoots || []).entries()) {
    if (!isSafeRelativePath(root)) {
      errors.push({ instancePath: `/projectResources/skills/readRoots/${index}`, message: 'must be a safe relative path' });
    }
  }

  const mcpPath = resources.mcp?.path;
  if (mcpPath !== null && !isSafeRelativePath(mcpPath)) {
    errors.push({ instancePath: '/projectResources/mcp/path', message: 'must be a safe relative path or null' });
  }
  if (mcpPath === null && resources.mcp?.format !== 'none') {
    errors.push({ instancePath: '/projectResources/mcp/format', message: 'must be none when mcp path is null' });
  }
}

function validateManifest(manifest) {
  const valid = validate(manifest);
  const errors = valid ? [] : (validate.errors || []).slice();
  const allowed = {
    'generic-jsonl': new Set(['sessions']),
    'generic-filesystem': new Set(['resourceSync']),
    'generic-openai-compatible': new Set(['channels']),
    'generic-mcp': new Set(['mcp']),
    'generic-prompt': new Set(['prompts'])
  };

  for (const [capability, driver] of Object.entries(manifest && manifest.capabilities || {})) {
    if (allowed[driver] && !allowed[driver].has(capability)) {
      errors.push({
        instancePath: `/capabilities/${capability}`,
        message: `${driver} only supports ${[...allowed[driver]].join(', ')}`
      });
    }
    if (driver === 'generic-mcp') {
      if (manifest.mcpFormat !== 'json') {
        errors.push({ instancePath: '/mcpFormat', message: 'generic-mcp requires mcpFormat json' });
      }
      if (typeof manifest.resourceMappings?.mcp !== 'string' || !manifest.resourceMappings.mcp.trim()) {
        errors.push({ instancePath: '/resourceMappings/mcp', message: 'generic-mcp requires a non-empty resourceMappings.mcp' });
      }
    }
    if (driver === 'generic-prompt' && !(
      (typeof manifest.resourceMappings?.prompts === 'string' && manifest.resourceMappings.prompts.trim()) ||
      (typeof manifest.promptFile === 'string' && manifest.promptFile.trim())
    )) {
      errors.push({
        instancePath: '/resourceMappings/prompts',
        message: 'generic-prompt requires a non-empty resourceMappings.prompts or promptFile'
      });
    }
  }

  validateProjectResources(manifest, errors);
  return { valid: errors.length === 0, errors };
}

function normalizeManifestError(errors = []) {
  return errors.map(error => {
    const property = error.params && error.params.additionalProperty ? ` ${error.params.additionalProperty}` : '';
    return `${error.instancePath || error.dataPath || '/'}${property} ${error.message}`;
  }).join('; ');
}

module.exports = { DRIVER_IDS, PATH_RESOLVER_IDS, schema, validateManifest, normalizeManifestError };