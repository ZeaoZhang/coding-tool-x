const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const chalk = require('chalk');
const { HOME_DIR } = require('../config/paths');

/**
 * 导出 Claude Code 配置为 ZIP 压缩包
 * 包含：全局 CLAUDE.md、项目 CLAUDE.md、settings.json、MCP 服务器配置、Skills 等
 */
async function exportConfig(options = {}) {
  const { output = 'claude-config.zip', includeProjects = true } = options;

  try {
    console.log(chalk.blue('[START] 开始导出 Claude Code 配置...'));

    const homeDir = HOME_DIR;
    const claudeDir = path.join(homeDir, '.claude');
    const currentDir = process.cwd();

    // 检查 .claude 目录是否存在
    if (!fs.existsSync(claudeDir)) {
      console.log(chalk.red('[ERROR] 未找到 .claude 配置目录'));
      return;
    }

    // 创建输出文件流
    const outputPath = path.resolve(currentDir, output);
    const outputStream = fs.createWriteStream(outputPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    // 监听错误
    archive.on('error', (err) => {
      throw err;
    });

    // 监听完成
    archive.on('end', () => {
      console.log(chalk.green(`\n[OK] 配置导出成功！`));
      console.log(chalk.gray(`   文件位置: ${outputPath}`));
      console.log(chalk.gray(`   文件大小: ${(archive.pointer() / 1024 / 1024).toFixed(2)} MB`));
    });

    // 连接流
    archive.pipe(outputStream);

    // 收集配置清单
    const manifest = {
      exportTime: new Date().toISOString(),
      version: '1.0.0',
      globalConfig: {},
      projectConfig: {},
      enabledConfigs: []
    };

    // 1. 导出全局 CLAUDE.md
    const globalClaudeMd = path.join(claudeDir, 'CLAUDE.md');
    if (fs.existsSync(globalClaudeMd)) {
      archive.file(globalClaudeMd, { name: 'global/CLAUDE.md' });
      manifest.globalConfig.claudeMd = true;
      manifest.enabledConfigs.push('global/CLAUDE.md');
      console.log(chalk.gray('  [v] 全局 CLAUDE.md'));
    }

    // 2. 导出 settings.json
    const settingsJson = path.join(claudeDir, 'settings.json');
    if (fs.existsSync(settingsJson)) {
      archive.file(settingsJson, { name: 'global/settings.json' });
      manifest.globalConfig.settings = true;
      manifest.enabledConfigs.push('global/settings.json');
      console.log(chalk.gray('  [v] settings.json'));

      // 解析 MCP 服务器配置
      try {
        const settings = JSON.parse(fs.readFileSync(settingsJson, 'utf-8'));
        if (settings.mcpServers) {
          manifest.globalConfig.mcpServers = Object.keys(settings.mcpServers);
          console.log(chalk.gray(`    - MCP 服务器: ${manifest.globalConfig.mcpServers.join(', ')}`));
        }
        if (settings.hooks) {
          manifest.globalConfig.hooks = Object.keys(settings.hooks);
        }
        if (settings.statusLine) {
          manifest.globalConfig.statusLine = true;
        }
      } catch (e) {
        console.log(chalk.yellow('    [!] settings.json 解析失败'));
      }
    }

    // 3. 导出 Skills
    const skillsDir = path.join(claudeDir, 'skills');
    if (fs.existsSync(skillsDir)) {
      const skills = fs.readdirSync(skillsDir).filter(f => !f.startsWith('.'));
      if (skills.length > 0) {
        archive.directory(skillsDir, 'global/skills');
        manifest.globalConfig.skills = skills;
        manifest.enabledConfigs.push('global/skills');
        console.log(chalk.gray(`  [v] Skills (${skills.length} 个)`));
      }
    }

    // 4. 导出当前项目配置
    if (includeProjects) {
      // 项目级 CLAUDE.md
      const projectClaudeMd = path.join(currentDir, 'CLAUDE.md');
      if (fs.existsSync(projectClaudeMd)) {
        archive.file(projectClaudeMd, { name: 'project/CLAUDE.md' });
        manifest.projectConfig.claudeMd = true;
        manifest.enabledConfigs.push('project/CLAUDE.md');
        console.log(chalk.gray('  [v] 项目 CLAUDE.md'));
      }

      // 项目级 settings.local.json
      const projectSettings = path.join(currentDir, '.claude', 'settings.local.json');
      if (fs.existsSync(projectSettings)) {
        archive.file(projectSettings, { name: 'project/.claude/settings.local.json' });
        manifest.projectConfig.settingsLocal = true;
        manifest.enabledConfigs.push('project/.claude/settings.local.json');
        console.log(chalk.gray('  [v] 项目 settings.local.json'));
      }

      // 项目级 workspace CLAUDE.md
      const workspaceClaudeMd = path.join(homeDir, 'workspace', 'CLAUDE.md');
      if (fs.existsSync(workspaceClaudeMd)) {
        archive.file(workspaceClaudeMd, { name: 'workspace/CLAUDE.md' });
        manifest.projectConfig.workspaceClaudeMd = true;
        manifest.enabledConfigs.push('workspace/CLAUDE.md');
        console.log(chalk.gray('  [v] workspace CLAUDE.md'));
      }
    }

    // 5. 添加配置清单
    archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });
    console.log(chalk.gray('  [v] manifest.json'));

    // 6. 添加 README
    const readme = generateReadme(manifest);
    archive.append(readme, { name: 'README.md' });
    console.log(chalk.gray('  [v] README.md'));

    // 完成打包
    await archive.finalize();

  } catch (error) {
    console.error(chalk.red('[ERROR] 导出失败:'), error.message);
    throw error;
  }
}

/**
 * 生成配置包说明文档
 */
function generateReadme(manifest) {
  return `# Claude Code 配置包

导出时间: ${new Date(manifest.exportTime).toLocaleString('zh-CN')}
版本: ${manifest.version}

## [PKG] 包含内容

### 全局配置
${manifest.globalConfig.claudeMd ? '- [OK] 全局 CLAUDE.md（AI 行为指令）' : ''}
${manifest.globalConfig.settings ? '- [OK] settings.json（包含 MCP 服务器、Hooks 等）' : ''}
${manifest.globalConfig.mcpServers ? `  - MCP 服务器: ${manifest.globalConfig.mcpServers.join(', ')}` : ''}
${manifest.globalConfig.hooks ? `  - Hooks: ${manifest.globalConfig.hooks.join(', ')}` : ''}
${manifest.globalConfig.skills ? `- [OK] Skills (${manifest.globalConfig.skills.length} 个): ${manifest.globalConfig.skills.join(', ')}` : ''}

### 项目配置
${manifest.projectConfig.claudeMd ? '- [OK] 项目 CLAUDE.md' : ''}
${manifest.projectConfig.settingsLocal ? '- [OK] 项目 settings.local.json' : ''}
${manifest.projectConfig.workspaceClaudeMd ? '- [OK] workspace CLAUDE.md' : ''}

## [IMPORT] 如何导入

### 方法 1：手动导入
1. 解压此 ZIP 文件
2. 复制 \`global/\` 内容到 \`~/.claude/\`
3. 复制 \`project/\` 内容到你的项目目录
4. 复制 \`workspace/\` 内容到 \`~/workspace/\`

### 方法 2：使用命令（计划中）
\`\`\`bash
ctx import-config claude-config.zip
\`\`\`

## [WARN] 注意事项

1. **备份现有配置**：导入前请备份现有的 \`.claude\` 目录
2. **敏感信息**：此配置包可能包含 API Keys、代理配置等敏感信息，请妥善保管
3. **路径适配**：某些路径可能需要根据你的系统调整（如 hooks 中的脚本路径）
4. **MCP 服务器**：需要确保目标环境已安装对应的 MCP 服务器

## [NOTE] 配置清单

已启用的配置项：
${manifest.enabledConfigs.map(c => `- ${c}`).join('\n')}

---

生成工具: Coding-Tool-X (ctx)
`;
}

module.exports = { exportConfig };
