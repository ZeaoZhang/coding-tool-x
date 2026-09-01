'use strict';

const { convertSkillToCodex } = require('./format-converter');
const { normalizeSafeRelativePath } = require('./config-artifact-paths');

const FORMAT_IDS = Object.freeze({
  claude: 'claude-skill-v1',
  codex: 'codex-skill-v1',
  gemini: 'gemini-skill-v1',
  opencode: 'opencode-skill-v1',
  omp: 'omp-skill-v1'
});

function contentToString(content) {
  if (Buffer.isBuffer(content)) return content.toString('utf8');
  if (content === undefined || content === null) throw new Error('Skill file content is required');
  return String(content);
}

function cloneFile(file) {
  return {
    relativePath: normalizeSafeRelativePath(file.relativePath, 'Skill file path', { allowHiddenSegments: true }),
    content: Buffer.isBuffer(file.content) ? Buffer.from(file.content) : contentToString(file.content),
    ...(file.encoding ? { encoding: file.encoding } : {}),
    ...(Number.isInteger(file.mode) ? { mode: file.mode } : {})
  };
}

class SkillFormatAdapter {
  normalize({ platform, files, sourceMetadata = {} } = {}) {
    const normalizedPlatform = String(platform || '').trim().toLowerCase();
    const format = FORMAT_IDS[normalizedPlatform];
    if (!format) throw new Error(`Unsupported Skill platform: ${platform}`);
    if (!Array.isArray(files) || files.length === 0) throw new Error('Skill files are required');

    const normalizedFiles = files.map(cloneFile);
    const rootSkill = normalizedFiles.find(file => file.relativePath === 'SKILL.md');
    if (!rootSkill) throw new Error('Skill files must include root SKILL.md');

    const warnings = [];
    if (normalizedPlatform === 'codex') {
      const converted = convertSkillToCodex(contentToString(rootSkill.content), {
        sourceMetadata
      });
      rootSkill.content = converted.content;
      warnings.push(...(converted.warnings || []));
    }

    return {
      format,
      files: normalizedFiles,
      warnings
    };
  }
}

function normalizeSkillFiles(options) {
  return new SkillFormatAdapter().normalize(options);
}

module.exports = {
  SkillFormatAdapter,
  FORMAT_IDS,
  normalizeSkillFiles
};
