/**
 * 格式转换服务
 *
 * 支持 Claude Code ↔ Codex CLI 格式互转
 * - Skills: SKILL.md 格式转换
 * - Commands/Prompts: 命令/提示格式转换
 */

// Codex CLI 限制
const CODEX_LIMITS = {
  skillName: 100,
  skillDescription: 500
};

/**
 * 解析 YAML frontmatter
 * 支持基本的 YAML 解析和嵌套 metadata 对象
 */
function parseFrontmatter(content) {
  const result = {
    frontmatter: {},
    body: content
  };

  // 移除 BOM
  content = content.trim().replace(/^\uFEFF/, '');

  // 解析 YAML frontmatter
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!match) {
    return result;
  }

  const frontmatterText = match[1];
  result.body = match[2].trim();

  // 解析 YAML（支持嵌套对象 + description 多行/块标量）
  const lines = frontmatterText.split('\n');
  let currentParent = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const indent = line.match(/^(\s*)/)?.[1].length || 0;
    const trimmed = line.trim();
    if (!trimmed) continue;

    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;

    const key = line.slice(0, colonIndex).trim();
    const rawValue = line.slice(colonIndex + 1).trim();

    // 处理嵌套属性
    if (indent > 0 && currentParent && typeof result.frontmatter[currentParent] === 'object') {
      result.frontmatter[currentParent][key] = unquoteYamlValue(rawValue);
      continue;
    }

    currentParent = null;

    // YAML block scalar: >, >-, |, |- 等
    if (/^[>|][+-]?$/.test(rawValue)) {
      const parsed = parseMultilineYamlValue(lines, i + 1, indent, rawValue);
      result.frontmatter[key] = parsed.value;
      i = parsed.nextIndex - 1;
      continue;
    }

    // 空值：可能是嵌套对象，也可能是多行文本（Gemini description 常见）
    if (!rawValue && indent === 0) {
      const nextInfo = findNextNonEmptyLine(lines, i + 1);
      if (nextInfo && nextInfo.indent > indent) {
        if (shouldParseAsMultilineText(key, nextInfo.trimmed)) {
          const parsed = parseMultilineYamlValue(lines, i + 1, indent);
          result.frontmatter[key] = parsed.value;
          i = parsed.nextIndex - 1;
          continue;
        }

        currentParent = key;
        result.frontmatter[key] = {};
        continue;
      }
    }

    result.frontmatter[key] = unquoteYamlValue(rawValue);
  }

  return result;
}

function unquoteYamlValue(value) {
  if ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function findNextNonEmptyLine(lines, startIndex) {
  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) continue;
    return {
      index: i,
      indent: line.match(/^(\s*)/)?.[1].length || 0,
      trimmed
    };
  }
  return null;
}

function shouldParseAsMultilineText(key, nextTrimmedLine) {
  // Gemini skill frontmatter 常见：
  // description:
  //   多行描述...
  if (key === 'description') {
    return true;
  }

  // 嵌套对象一般是 "childKey: value" 结构
  if (/^[A-Za-z0-9_-]+\s*:/.test(nextTrimmedLine)) {
    return false;
  }

  return true;
}

function parseMultilineYamlValue(lines, startIndex, parentIndent, blockStyle = null) {
  let endIndex = startIndex;
  const collected = [];

  while (endIndex < lines.length) {
    const line = lines[endIndex];
    const indent = line.match(/^(\s*)/)?.[1].length || 0;
    const trimmed = line.trim();

    if (!trimmed) {
      collected.push('');
      endIndex++;
      continue;
    }

    if (indent <= parentIndent) {
      break;
    }

    collected.push(line);
    endIndex++;
  }

  if (collected.length === 0) {
    return { value: '', nextIndex: endIndex };
  }

  // 去掉公共缩进
  const baseIndent = collected
    .filter(line => line.trim() !== '')
    .reduce((min, line) => {
      const indent = line.match(/^(\s*)/)?.[1].length || 0;
      return Math.min(min, indent);
    }, Infinity);

  const normalizedLines = collected.map(line => {
    if (!line) return '';
    return line.slice(Math.min(baseIndent, line.length));
  });

  const style = blockStyle ? blockStyle[0] : null;
  const chomp = blockStyle && blockStyle.length > 1 ? blockStyle[1] : null;
  let value = '';

  if (style === '>') {
    value = foldYamlLines(normalizedLines);
  } else {
    value = normalizedLines.join('\n');
  }

  if (chomp !== '+') {
    value = value.replace(/\n+$/g, '');
  }

  return { value: value.trim(), nextIndex: endIndex };
}

function foldYamlLines(lines) {
  if (lines.length === 0) return '';

  let output = lines[0];
  for (let i = 1; i < lines.length; i++) {
    if (lines[i - 1] === '' || lines[i] === '') {
      output += '\n' + lines[i];
    } else {
      output += ' ' + lines[i];
    }
  }

  return output;
}

/**
 * 生成 YAML frontmatter 字符串
 */
function generateFrontmatter(data, format = 'claude') {
  const lines = ['---'];

  if (format === 'codex') {
    // Codex 格式: name, description 必须，metadata 可选
    if (data.name) {
      lines.push(`name: "${escapeYamlString(data.name)}"`);
    }
    if (data.description) {
      lines.push(`description: "${escapeYamlString(data.description)}"`);
    }
    if (data.metadata && Object.keys(data.metadata).length > 0) {
      lines.push('metadata:');
      for (const [key, value] of Object.entries(data.metadata)) {
        lines.push(`  ${key}: "${escapeYamlString(value)}"`);
      }
    }
    // Codex commands/prompts 特有字段
    if (data['argument-hint']) {
      lines.push(`argument-hint: ${data['argument-hint']}`);
    }
  } else {
    // Claude Code 格式
    if (data.name) {
      lines.push(`name: "${escapeYamlString(data.name)}"`);
    }
    if (data.description) {
      lines.push(`description: "${escapeYamlString(data.description)}"`);
    }
    if (data.license) {
      lines.push(`license: "${escapeYamlString(data.license)}"`);
    }
    // Claude Code commands 特有字段
    if (data['allowed-tools']) {
      lines.push(`allowed-tools: ${data['allowed-tools']}`);
    }
    if (data['argument-hint']) {
      lines.push(`argument-hint: ${data['argument-hint']}`);
    }
    if (data.model) {
      lines.push(`model: ${data.model}`);
    }
    if (data.context) {
      lines.push(`context: ${data.context}`);
    }
    if (data.agent) {
      lines.push(`agent: ${data.agent}`);
    }
  }

  lines.push('---');
  return lines.join('\n');
}

/**
 * 转义 YAML 字符串中的特殊字符
 */
function escapeYamlString(str) {
  if (!str) return '';
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * 检测 Skill 格式
 * @returns {'claude' | 'codex' | 'unknown'}
 */
function detectSkillFormat(content) {
  const { frontmatter } = parseFrontmatter(content);

  // Codex 特征: 有 metadata 对象
  if (frontmatter.metadata && typeof frontmatter.metadata === 'object') {
    return 'codex';
  }

  // Claude Code 特征: 有 allowed-tools 或 license
  if (frontmatter['allowed-tools'] || frontmatter.license) {
    return 'claude';
  }

  // 两者都有 name 和 description，无法区分时默认 claude
  if (frontmatter.name && frontmatter.description) {
    return 'claude';
  }

  return 'unknown';
}

/**
 * 检测 Command/Prompt 格式
 * @returns {'claude' | 'codex' | 'unknown'}
 */
function detectCommandFormat(content) {
  const { frontmatter } = parseFrontmatter(content);

  // Claude Code 特征: allowed-tools, model, context, agent, hooks
  if (frontmatter['allowed-tools'] || frontmatter.model ||
      frontmatter.context || frontmatter.agent || frontmatter.hooks) {
    return 'claude';
  }

  // Codex 特征: 只有 description 和 argument-hint
  if (frontmatter.description && !frontmatter['allowed-tools']) {
    return 'codex';
  }

  return 'unknown';
}

/**
 * 转换 Skill: Claude Code → Codex CLI
 */
function convertSkillToCodex(claudeContent, options = {}) {
  const { frontmatter, body } = parseFrontmatter(claudeContent);
  const warnings = [];

  // 处理字段
  const codexData = {
    name: frontmatter.name || '',
    description: frontmatter.description || '',
    metadata: {}
  };

  // 检查并截断 name
  if (codexData.name.length > CODEX_LIMITS.skillName) {
    warnings.push(`name 超过 ${CODEX_LIMITS.skillName} 字符，已截断`);
    codexData.name = codexData.name.slice(0, CODEX_LIMITS.skillName);
  }

  // 检查并截断 description
  if (codexData.description.length > CODEX_LIMITS.skillDescription) {
    warnings.push(`description 超过 ${CODEX_LIMITS.skillDescription} 字符，已截断`);
    codexData.description = codexData.description.slice(0, CODEX_LIMITS.skillDescription);
  }

  // 不支持的字段警告
  if (frontmatter['allowed-tools']) {
    warnings.push('allowed-tools 字段在 Codex 中不支持，已忽略');
  }

  // 生成 Codex 格式内容
  const codexFrontmatter = generateFrontmatter(codexData, 'codex');
  const codexContent = codexFrontmatter + '\n\n' + body;

  return {
    content: codexContent,
    warnings,
    format: 'codex'
  };
}

/**
 * 转换 Skill: Codex CLI → Claude Code
 */
function convertSkillToClaude(codexContent, options = {}) {
  const { frontmatter, body } = parseFrontmatter(codexContent);
  const warnings = [];

  // 处理字段
  const claudeData = {
    name: frontmatter.name || '',
    description: frontmatter.description || ''
  };

  // 保留 metadata.short-description（如果有）作为注释
  if (frontmatter.metadata && frontmatter.metadata['short-description']) {
    // 可以选择将其添加到 description 或作为单独字段
    warnings.push(`metadata.short-description 已保留: "${frontmatter.metadata['short-description']}"`);
  }

  // 生成 Claude Code 格式内容
  const claudeFrontmatter = generateFrontmatter(claudeData, 'claude');
  const claudeContent = claudeFrontmatter + '\n\n' + body;

  return {
    content: claudeContent,
    warnings,
    format: 'claude'
  };
}

/**
 * 转换 Command: Claude Code → Codex CLI (Custom Prompt)
 */
function convertCommandToCodex(claudeContent, options = {}) {
  const { frontmatter, body } = parseFrontmatter(claudeContent);
  const warnings = [];

  // 处理字段
  const codexData = {
    description: frontmatter.description || ''
  };

  // argument-hint 两者都支持
  if (frontmatter['argument-hint']) {
    codexData['argument-hint'] = frontmatter['argument-hint'];
  }

  // 不支持的字段警告
  const unsupportedFields = ['allowed-tools', 'model', 'context', 'agent', 'hooks'];
  for (const field of unsupportedFields) {
    if (frontmatter[field]) {
      warnings.push(`${field} 字段在 Codex 中不支持，已忽略`);
    }
  }

  // 检查 body 中的 Claude Code 特有语法
  let processedBody = body;

  // 检测 Bash 执行语法 !`command`
  if (/!\`[^`]+\`/.test(body)) {
    warnings.push('Bash 执行语法 !`command` 在 Codex 中不支持，请手动替换');
  }

  // 检测文件引用语法 @filepath
  if (/@[^\s]+/.test(body)) {
    warnings.push('文件引用语法 @filepath 在 Codex 中不支持，请手动替换');
  }

  // 生成 Codex 格式内容
  let codexContent = '';
  if (codexData.description || codexData['argument-hint']) {
    codexContent = generateFrontmatter(codexData, 'codex') + '\n\n';
  }
  codexContent += processedBody;

  return {
    content: codexContent,
    warnings,
    format: 'codex'
  };
}

/**
 * 转换 Command: Codex CLI (Custom Prompt) → Claude Code
 */
function convertCommandToClaude(codexContent, options = {}) {
  const { frontmatter, body } = parseFrontmatter(codexContent);
  const warnings = [];

  // 处理字段
  const claudeData = {
    description: frontmatter.description || ''
  };

  // argument-hint 两者都支持
  if (frontmatter['argument-hint']) {
    claudeData['argument-hint'] = frontmatter['argument-hint'];
  }

  // Codex 命名参数 $KEY 在 Claude Code 中也支持，无需转换

  // 生成 Claude Code 格式内容
  let claudeContent = '';
  if (claudeData.description || claudeData['argument-hint']) {
    claudeContent = generateFrontmatter(claudeData, 'claude') + '\n\n';
  }
  claudeContent += body;

  return {
    content: claudeContent,
    warnings,
    format: 'claude'
  };
}

/**
 * 批量转换 Skills
 */
function convertSkillsBatch(skills, targetFormat) {
  const results = [];

  for (const skill of skills) {
    try {
      const converted = targetFormat === 'codex'
        ? convertSkillToCodex(skill.content)
        : convertSkillToClaude(skill.content);

      results.push({
        name: skill.name,
        success: true,
        ...converted
      });
    } catch (err) {
      results.push({
        name: skill.name,
        success: false,
        error: err.message
      });
    }
  }

  return results;
}

/**
 * 批量转换 Commands
 */
function convertCommandsBatch(commands, targetFormat) {
  const results = [];

  for (const command of commands) {
    try {
      const converted = targetFormat === 'codex'
        ? convertCommandToCodex(command.content)
        : convertCommandToClaude(command.content);

      results.push({
        name: command.name,
        success: true,
        ...converted
      });
    } catch (err) {
      results.push({
        name: command.name,
        success: false,
        error: err.message
      });
    }
  }

  return results;
}

/**
 * 解析 Skill 内容（支持双格式）
 */
function parseSkillContent(content) {
  const { frontmatter, body } = parseFrontmatter(content);
  const format = detectSkillFormat(content);

  const result = {
    name: frontmatter.name || '',
    description: frontmatter.description || '',
    body,
    fullContent: content,
    format
  };

  // 处理 Codex 特有字段
  if (frontmatter.metadata) {
    result.metadata = frontmatter.metadata;
    if (frontmatter.metadata['short-description']) {
      result.shortDescription = frontmatter.metadata['short-description'];
    }
  }

  // 处理 Claude Code 特有字段
  if (frontmatter['allowed-tools']) {
    result.allowedTools = frontmatter['allowed-tools'];
  }
  if (frontmatter.license) {
    result.license = frontmatter.license;
  }

  return result;
}

/**
 * 解析 Command 内容（支持双格式）
 */
function parseCommandContent(content) {
  const { frontmatter, body } = parseFrontmatter(content);
  const format = detectCommandFormat(content);

  const result = {
    description: frontmatter.description || '',
    argumentHint: frontmatter['argument-hint'] || '',
    body,
    fullContent: content,
    format
  };

  // 处理 Claude Code 特有字段
  if (frontmatter['allowed-tools']) {
    result.allowedTools = frontmatter['allowed-tools'];
  }
  if (frontmatter.model) {
    result.model = frontmatter.model;
  }
  if (frontmatter.context) {
    result.context = frontmatter.context;
  }
  if (frontmatter.agent) {
    result.agent = frontmatter.agent;
  }
  if (frontmatter.hooks) {
    result.hooks = frontmatter.hooks;
  }

  return result;
}

module.exports = {
  // 格式检测
  detectSkillFormat,
  detectCommandFormat,

  // Skills 转换
  convertSkillToCodex,
  convertSkillToClaude,
  convertSkillsBatch,

  // Commands 转换
  convertCommandToCodex,
  convertCommandToClaude,
  convertCommandsBatch,

  // 通用解析（支持双格式）
  parseSkillContent,
  parseCommandContent,
  parseFrontmatter,
  generateFrontmatter,

  // 常量
  CODEX_LIMITS
};
