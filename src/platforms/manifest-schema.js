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
    apiBasePath: { type: 'string', minLength: 1 },
    logFile: { type: 'string', minLength: 1 },
    logAliases: { type: 'array', items: { type: 'string', minLength: 1 } },
    portKey: { type: 'string', minLength: 1 },
    defaultPort: { type: 'integer', minimum: 1 },
    statisticsPath: { type: 'string', minLength: 1 },
    promptFile: { type: ['string', 'null'] },
    paths: { type: 'object', additionalProperties: { type: 'string' } },
    pathResolverId: { enum: [...PATH_RESOLVER_IDS] },
    sessionMapping: { type: 'object', additionalProperties: { type: 'string' } },
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
  return { valid, errors: valid ? [] : (validate.errors || []) };
}

function normalizeManifestError(errors = []) {
  return errors.map(error => {
    const property = error.params && error.params.additionalProperty ? ` ${error.params.additionalProperty}` : '';
    return `${error.instancePath || error.dataPath || '/'}${property} ${error.message}`;
  }).join('; ');
}

module.exports = { DRIVER_IDS, PATH_RESOLVER_IDS, schema, validateManifest, normalizeManifestError };
