'use strict';

const fs = require('fs/promises');
const path = require('path');

const { createSecureFileDriver } = require('./secure-file-driver');
function resolveTarget(manifest) {
  const mapped = manifest.resourceMappings && manifest.resourceMappings.prompts;
  const raw = typeof mapped === 'string' && mapped.trim() ? mapped : manifest.promptFile;
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('Manifest requires a prompt path');
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) throw new Error('Prompt mapping must be a filesystem path');
  const home = manifest.paths && manifest.paths.home;
  return path.resolve(home || process.cwd(), raw);
}

function createGenericPromptDriver({ platform, manifest = {}, fsImpl = fs } = {}) {
  return createSecureFileDriver({
    platform,
    capability: 'prompts',
    manifest,
    fsImpl,
    labels: {
      pathContainsSymlink: value => `Prompt path contains symlink: ${value}`,
      pathDoesNotExist: value => `Prompt path does not exist: ${value}`,
      mappingEscapesHome: 'Prompt mapping escapes platform home',
      targetChanged: 'Prompt target changed during operation',
      descriptorReadUnavailable: 'Prompt descriptor read is unavailable',
      descriptorIdentityUnavailable: 'Prompt descriptor identity is unavailable',
      pathComponentNotDirectory: value => `Prompt path component is not a directory: ${value}`,
      temporaryPathChanged: 'Prompt temporary path changed during write',
      serializedValueMustBeString: 'Prompt text must be a string'
    },
    resolveTarget,
    serialize: text => {
      if (typeof text !== 'string') throw new Error('Prompt text must be a string');
      return text;
    }
  });
}

module.exports = { createGenericPromptDriver };
