'use strict';

const Ajv = require('ajv');

const DRIVER_IDS = new Set([
  'unsupported',
  'generic-jsonl',
  'generic-filesystem',
  'generic-openai-compatible',
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
    promptFile: { type: ['string', 'null'] },
    promptLabel: { type: 'string', minLength: 1 },
    statisticsPath: { type: 'string', minLength: 1 },
    paths: { type: 'object', additionalProperties: { type: 'string' } },
    pathResolverId: { enum: [...PATH_RESOLVER_IDS] },
    sessionMapping: { type: 'object', additionalProperties: { type: 'string' } },
    sessionGlob: { type: 'string', minLength: 1 },
    resourceMappings: { type: 'object', additionalProperties: { type: 'string' } },
    capabilities: {
      type: 'object',
      additionalProperties: { enum: [...DRIVER_IDS] }
    }
  }
};

const validate = new Ajv({ allErrors: true, strict: false }).compile(schema);

function validateManifest(manifest) {
  const valid = validate(manifest);
  const errors = valid ? [] : (validate.errors || []).slice();
  const allowed = {
    'generic-jsonl': new Set(['sessions']),
    'generic-filesystem': new Set(['resourceSync']),
    'generic-openai-compatible': new Set(['channels'])
  };
  for (const [capability, driver] of Object.entries(manifest && manifest.capabilities || {})) {
    if (allowed[driver] && !allowed[driver].has(capability)) {
      errors.push({ instancePath: `/capabilities/${capability}`, message: `${driver} only supports ${[...allowed[driver]].join(', ')}` });
    }
  }
  return { valid: errors.length === 0, errors };
}

function normalizeManifestError(errors = []) {
  return errors.map(error => {
    const property = error.params && error.params.additionalProperty ? ` ${error.params.additionalProperty}` : '';
    return `${error.instancePath || error.dataPath || '/'}${property} ${error.message}`;
  }).join('; ');
}

module.exports = { DRIVER_IDS, PATH_RESOLVER_IDS, schema, validateManifest, normalizeManifestError };
