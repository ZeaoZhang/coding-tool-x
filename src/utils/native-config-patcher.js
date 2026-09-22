'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const jsonc = require('jsonc-parser');
const YAML = require('yaml');
const toml = require('toml');
const tomlStringify = require('@iarna/toml').stringify;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function valuesEqual(left, right) {
  if (left === right) return true;
  if (left instanceof Date || right instanceof Date) {
    if (left instanceof Date && right instanceof Date) return left.getTime() === right.getTime();
    const date = left instanceof Date ? left : right;
    const scalar = left instanceof Date ? right : left;
    return typeof scalar === 'string'
      && Number.isFinite(Date.parse(scalar))
      && Date.parse(scalar) === date.getTime();
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => valuesEqual(value, right[index]));
  }
  if (isPlainObject(left) || isPlainObject(right)) {
    if (!isPlainObject(left) || !isPlainObject(right)) return false;
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    return leftKeys.length === rightKeys.length
      && leftKeys.every(key => Object.prototype.hasOwnProperty.call(right, key)
        && valuesEqual(left[key], right[key]));
  }
  return false;
}

function cloneConfigValue(value) {
  if (value instanceof Date) return new Date(value.getTime());
  if (Array.isArray(value)) return value.map(cloneConfigValue);
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, cloneConfigValue(entry)]));
  }
  return value;
}

function ensureParent(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function writeContent(filePath, content, options = {}) {
  ensureParent(filePath);
  if (!options.atomic) {
    fs.writeFileSync(filePath, content, 'utf8');
  } else {
    const mode = options.mode !== undefined
      ? options.mode
      : (fs.existsSync(filePath) ? fs.statSync(filePath).mode & 0o777 : 0o600);
    const temporary = `${filePath}.ctx-tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
    try {
      fs.writeFileSync(temporary, content, { encoding: 'utf8', mode });
      if (process.platform !== 'win32') fs.chmodSync(temporary, mode);
      fs.renameSync(temporary, filePath);
    } finally {
      try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch (_) {}
    }
  }
  if (options.mode !== undefined && process.platform !== 'win32') {
    fs.chmodSync(filePath, options.mode);
  }
}

function parseJsonc(content, filePath = 'config.json') {
  const errors = [];
  const value = jsonc.parse(content, errors, { allowTrailingComma: true, disallowComments: false });
  if (errors.length > 0) {
    const details = errors.map(error => jsonc.printParseErrorCode(error.error)).join(', ');
    throw new Error(`Failed to parse ${path.basename(filePath)}: ${details}`);
  }
  if (!isPlainObject(value)) {
    throw new Error(`${path.basename(filePath)} must contain a JSON object`);
  }
  return value;
}

function reconcileJsonc(content, current, desired, filePath) {
  let output = content;
  const changes = [];

  function visit(before, after, nodePath) {
    if (valuesEqual(before, after)) return;
    if (isPlainObject(before) && isPlainObject(after)) {
      Object.keys(before).forEach((key) => {
        if (!Object.prototype.hasOwnProperty.call(after, key)) {
          changes.push({ path: [...nodePath, key], value: undefined });
        }
      });
      Object.keys(after).forEach((key) => {
        if (!Object.prototype.hasOwnProperty.call(before, key)) {
          changes.push({ path: [...nodePath, key], value: after[key] });
        } else {
          visit(before[key], after[key], [...nodePath, key]);
        }
      });
      return;
    }
    changes.push({ path: nodePath, value: after });
  }

  visit(current, desired, []);
  for (const change of changes) {
    const edits = jsonc.modify(output, change.path, change.value, {
      formattingOptions: {
        insertSpaces: true,
        tabSize: 2,
        eol: output.includes('\r\n') ? '\r\n' : '\n'
      }
    });
    output = jsonc.applyEdits(output, edits);
  }
  return output;
}

function updateJsoncFile(filePath, mutate, options = {}) {
  const exists = fs.existsSync(filePath);
  const original = exists ? fs.readFileSync(filePath, 'utf8') : '{}\n';
  const current = original.trim() ? parseJsonc(original, filePath) : {};
  const desired = cloneConfigValue(current);
  mutate(desired);
  const output = reconcileJsonc(original, current, desired, filePath);
  if (output !== original) {
    writeContent(filePath, output, options);
  }
  return desired;
}

function readJsoncFile(filePath, fallback = {}) {
  if (!fs.existsSync(filePath)) return JSON.parse(JSON.stringify(fallback));
  const original = fs.readFileSync(filePath, 'utf8');
  if (!original.trim()) return JSON.parse(JSON.stringify(fallback));
  return parseJsonc(original, filePath);
}

function writeJsoncFile(filePath, value, options = {}) {
  return updateJsoncFile(filePath, (current) => {
    Object.keys(current).forEach(key => delete current[key]);
    Object.assign(current, cloneConfigValue(value || {}));
  }, options);
}

function reconcileYamlDocument(document, current, desired, nodePath = []) {
  if (valuesEqual(current, desired)) return;
  if (isPlainObject(current) && isPlainObject(desired)) {
    Object.keys(current).forEach((key) => {
      if (!Object.prototype.hasOwnProperty.call(desired, key)) {
        document.deleteIn([...nodePath, key]);
      }
    });
    Object.keys(desired).forEach((key) => {
      if (!Object.prototype.hasOwnProperty.call(current, key)) {
        document.setIn([...nodePath, key], desired[key]);
      } else {
        reconcileYamlDocument(document, current[key], desired[key], [...nodePath, key]);
      }
    });
    return;
  }
  document.setIn(nodePath, desired);
}

function updateYamlFile(filePath, mutate, options = {}) {
  const exists = fs.existsSync(filePath);
  const original = exists ? fs.readFileSync(filePath, 'utf8') : '{}\n';
  const document = YAML.parseDocument(original, {
    keepSourceTokens: true,
    prettyErrors: true,
    customTags: options.customTags
  });
  if (document.errors.length > 0) {
    throw new Error(`Failed to parse ${path.basename(filePath)}: ${document.errors[0].message}`);
  }
  let current = document.toJS({ mapAsMap: false });
  if (current === undefined || current === null) current = {};
  else if (!isPlainObject(current)) {
    throw new Error(`${path.basename(filePath)} must contain a YAML mapping`);
  }
  const desired = cloneConfigValue(current);
  mutate(desired);
  if (valuesEqual(current, desired)) return desired;
  reconcileYamlDocument(document, current, desired);
  const output = document.toString({ lineWidth: 120 });
  writeContent(filePath, output, options);
  return desired;
}

function writeYamlFile(filePath, value, options = {}) {
  return updateYamlFile(filePath, (current) => {
    Object.keys(current).forEach(key => delete current[key]);
    Object.assign(current, cloneConfigValue(value || {}));
  }, options);
}

function findTomlCommentStart(line) {
  let quote = '';
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (escaped) { escaped = false; continue; }
    if (char === '\\' && quote === '"') { escaped = true; continue; }
    if ((char === '"' || char === "'") && (!quote || quote === char)) {
      quote = quote ? '' : char;
      continue;
    }
    if (char === '#' && !quote) return index;
  }
  return -1;
}

function stripTomlComment(line) {
  const commentIndex = findTomlCommentStart(line);
  return commentIndex < 0 ? line : line.slice(0, commentIndex);
}

function tomlHeaderProviderKey(line) {
  const header = stripTomlComment(line).trim();
  const match = header.match(/^\[\s*model_providers\s*\.\s*(?:"((?:\\.|[^"\\])*)"|'([^']*)'|([A-Za-z0-9_-]+))\s*\]$/);
  if (!match) return null;
  if (match[1] !== undefined) {
    try { return JSON.parse(`"${match[1]}"`); } catch (_) { return null; }
  }
  return match[2] !== undefined ? match[2] : match[3];
}

function isNestedTomlProviderSection(line, providerKey) {
  const escaped = String(providerKey).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^\\s*\\[\\s*model_providers\\s*\\.\\s*(?:"${escaped}"|'${escaped}'|${escaped})\\s*\\.`)
    .test(stripTomlComment(line).trimEnd());
}

function preserveTomlSectionPreamble(lines, sectionStart, nextSectionStart) {
  let boundary = nextSectionStart;
  while (boundary > sectionStart + 1) {
    const line = lines[boundary - 1].trim();
    if (line === '' || line.startsWith('#')) boundary -= 1;
    else break;
  }
  return boundary;
}

function patchTomlProvider(content, providerKey, providerValue, eol) {
  const lines = content.split(/(?<=\n)/);
  const starts = [];
  lines.forEach((line, index) => {
    const parsedKey = tomlHeaderProviderKey(line.replace(/\r?\n$/, ''));
    if (parsedKey === providerKey) starts.push(index);
  });
  const start = starts[0];

  if (providerValue === undefined) {
    if (start === undefined) return content;
    let end = start + 1;
    while (end < lines.length) {
      if (!/^\s*\[(?!\[).+\]\s*(?:#.*)?(?:\r?\n)?$/.test(lines[end])) {
        end += 1;
        continue;
      }
      if (isNestedTomlProviderSection(lines[end], providerKey)) {
        end += 1;
        continue;
      }
      break;
    }
    end = preserveTomlSectionPreamble(lines, start, end);
    lines.splice(start, end - start);
    return lines.join('');
  }

  const generated = tomlStringify({ model_providers: { [providerKey]: providerValue } });
  const generatedLines = generated.split(/(?<=\n)/);
  const sectionStart = generatedLines.findIndex(line => tomlHeaderProviderKey(line.replace(/\r?\n$/, '')) === providerKey);
  if (sectionStart < 0) throw new Error(`Failed to serialize Codex provider ${providerKey}`);
  const section = generatedLines.slice(sectionStart).join('').trimEnd();

  if (start !== undefined) {
    let end = start + 1;
    while (end < lines.length) {
      if (!/^\s*\[(?!\[).+\]\s*(?:#.*)?(?:\r?\n)?$/.test(lines[end])) {
        end += 1;
        continue;
      }
      if (isNestedTomlProviderSection(lines[end], providerKey)) {
        end += 1;
        continue;
      }
      break;
    }
    const replaceEnd = preserveTomlSectionPreamble(lines, start, end);
    const preservedComments = lines.slice(start, replaceEnd)
      .map((line) => {
        const withoutNewline = line.replace(/\r?\n$/, '');
        const commentIndex = findTomlCommentStart(withoutNewline);
        return commentIndex < 0 ? '' : withoutNewline.slice(commentIndex).trim();
      })
      .filter(Boolean);
    const commentText = preservedComments.length > 0
      ? `${eol}${preservedComments.join(eol)}`
      : '';
    lines.splice(start, replaceEnd - start, `${section}${commentText}${eol}`);
    return lines.join('');
  }

  let output = content;
  if (output && !output.endsWith('\n')) output += eol;
  if (output && !output.endsWith(`${eol}${eol}`)) output += eol;
  return `${output}${section}${eol}`;
}

function writeTomlFile(filePath, desired, options = {}) {
  const exists = fs.existsSync(filePath);
  const original = exists ? fs.readFileSync(filePath, 'utf8') : '';
  let current = {};
  if (original.trim()) {
    try {
      current = toml.parse(original);
    } catch (error) {
      throw new Error(`Failed to parse ${path.basename(filePath)}: ${error.message}`);
    }
  }
  const before = current && typeof current === 'object' ? current : {};
  const after = desired && typeof desired === 'object' ? desired : {};
  const allowed = new Set(['model_provider', 'model_providers']);
  const otherKeys = new Set([...Object.keys(before), ...Object.keys(after)]);
  otherKeys.forEach(key => {
    if (!allowed.has(key) && !valuesEqual(before[key], after[key])) {
      throw new Error(`Refusing to rewrite unrelated TOML field "${key}" in ${path.basename(filePath)}`);
    }
  });

  const eol = original.includes('\r\n') ? '\r\n' : '\n';
  let output = original;
  const hasCurrentProvider = Object.prototype.hasOwnProperty.call(before, 'model_provider');
  const hasDesiredProvider = Object.prototype.hasOwnProperty.call(after, 'model_provider');
  const providerChanged = hasCurrentProvider !== hasDesiredProvider
    || (hasCurrentProvider && before.model_provider !== after.model_provider);
  if (providerChanged) {
    const rootLines = output.split(/(?<=\n)/);
    const headerIndex = rootLines.findIndex(line => /^\s*\[(?!\[).+\]/.test(line));
    const rootEnd = headerIndex < 0 ? rootLines.length : headerIndex;
    const settingIndex = rootLines.slice(0, rootEnd).findIndex(line => /^\s*model_provider\s*=/.test(line));
    if (hasDesiredProvider) {
      const serialized = tomlStringify({ model_provider: after.model_provider }).trimEnd();
      if (settingIndex >= 0) {
        const line = rootLines[settingIndex];
        const newline = line.match(/\r?\n$/)?.[0] || '';
        const assignment = line.replace(/\r?\n$/, '');
        let commentIndex = -1;
        let quoted = false;
        let escaped = false;
        for (let index = 0; index < assignment.length; index += 1) {
          const char = assignment[index];
          if (escaped) { escaped = false; continue; }
          if (char === '\\' && quoted) { escaped = true; continue; }
          if (char === '"') { quoted = !quoted; continue; }
          if (char === '#' && !quoted) { commentIndex = index; break; }
        }
        const suffix = commentIndex >= 0 ? ` ${assignment.slice(commentIndex)}` : '';
        const prefix = assignment.slice(0, assignment.indexOf('=') + 1);
        rootLines[settingIndex] = `${prefix} ${serialized.slice(serialized.indexOf('=') + 1).trim()}${suffix}${newline}`;
      } else {
        const insertion = `${serialized}${eol}`;
        rootLines.splice(rootEnd, 0, `${insertion}${rootEnd < rootLines.length ? eol : ''}`);
      }
    } else if (settingIndex >= 0) {
      const line = rootLines[settingIndex];
      const commentIndex = line.indexOf('#');
      if (commentIndex >= 0) rootLines[settingIndex] = `${line.slice(commentIndex).trimStart()}`;
      else rootLines.splice(settingIndex, 1);
    }
    output = rootLines.join('');
  }

  const currentProviders = isPlainObject(before.model_providers) ? before.model_providers : {};
  const desiredProviders = isPlainObject(after.model_providers) ? after.model_providers : {};
  const providerKeys = new Set([...Object.keys(currentProviders), ...Object.keys(desiredProviders)]);
  for (const key of providerKeys) {
    if (valuesEqual(currentProviders[key], desiredProviders[key])) continue;
    output = patchTomlProvider(output, key, Object.prototype.hasOwnProperty.call(desiredProviders, key)
      ? desiredProviders[key]
      : undefined, eol);
  }
  if (output !== original) writeContent(filePath, output, options);
  return after;
}

function encodeEnvValue(value) {
  const text = String(value ?? '');
  if (!/[\s#'"\\]/.test(text) && !text.startsWith('=') && !text.endsWith('\r')) return text;
  return JSON.stringify(text);
}

function findEnvComment(value) {
  let quote = '';
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (escaped) { escaped = false; continue; }
    if (char === '\\' && quote === '"') { escaped = true; continue; }
    if ((char === '"' || char === "'") && (!quote || quote === char)) {
      quote = quote ? '' : char;
      continue;
    }
    if (char === '#' && !quote && index > 0 && /\s/.test(value[index - 1])) {
      let start = index;
      while (start > 0 && /\s/.test(value[start - 1])) start -= 1;
      return value.slice(start);
    }
  }
  return '';
}

function updateEnvFile(filePath, updates, options = {}) {
  const exists = fs.existsSync(filePath);
  const original = exists ? fs.readFileSync(filePath, 'utf8') : '';
  const eol = original.includes('\r\n') ? '\r\n' : '\n';
  const lines = original.split(/\r?\n/);
  const keys = new Set(Object.keys(updates || {}));
  const seen = new Set();
  const output = [];

  for (const line of lines) {
    const match = line.match(/^(\s*(?:export\s+)?)([A-Za-z_][A-Za-z0-9_]*)\s*=([^\r\n]*)$/);
    if (!match || !keys.has(match[2])) {
      output.push(line);
      continue;
    }
    const [, prefix, key] = match;
    const value = updates[key];
    const rawValue = match[3];
    const comment = findEnvComment(rawValue);
    if (value === undefined || value === null) {
      if (comment) output.push(comment.trimStart());
      continue;
    }
    output.push(`${prefix}${key}=${encodeEnvValue(value)}${comment ? ` ${comment.trimStart()}` : ''}`);
    seen.add(key);
  }

  const missing = [...keys].filter(key => updates[key] !== undefined && updates[key] !== null && !seen.has(key));
  if (missing.length > 0) {
    while (output.length > 0 && output[output.length - 1] === '') output.pop();
    output.push(...missing.map(key => `${key}=${encodeEnvValue(updates[key])}`));
  }

  let content = output.join(eol);
  if (content && !content.endsWith(eol) && (original.endsWith('\n') || missing.length > 0)) content += eol;
  if (content !== original) {
    writeContent(filePath, content, options);
  }
  return content;
}

module.exports = {
  parseJsonc,
  readJsoncFile,
  writeJsoncFile,
  updateJsoncFile,
  updateYamlFile,
  writeYamlFile,
  writeTomlFile,
  updateEnvFile
};
