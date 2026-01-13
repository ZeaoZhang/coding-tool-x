#!/usr/bin/env node
/**
 * 路径迁移脚本
 * 将所有硬编码的 ~/.claude/cc-tool 路径替换为使用 paths.js 配置
 */

const fs = require('fs');
const path = require('path');

// 需要替换的路径模式
const REPLACEMENTS = [
  {
    // 基础目录
    pattern: /path\.join\(os\.homedir\(\),\s*['"]\.claude['"]\s*,\s*['"]cc-tool['"]\)/g,
    replacement: "require('../../config/paths').PATHS.base"
  },
  {
    // 别名文件
    pattern: /path\.join\(.*?\.claude['"],\s*['"]cc-tool['"],\s*['"]aliases\.json['"]\)/g,
    replacement: "require('../../config/paths').PATHS.aliases"
  },
  {
    // 收藏夹文件
    pattern: /path\.join\(.*?\.claude['"],\s*['"]cc-tool['"],\s*['"]favorites\.json['"]\)/g,
    replacement: "require('../../config/paths').PATHS.favorites"
  },
  {
    // Claude 渠道文件
    pattern: /path\.join\(.*?\.claude['"],\s*['"]cc-tool['"],\s*['"]channels\.json['"]\)/g,
    replacement: "require('../../config/paths').PATHS.channels.claude"
  },
  {
    // Codex 渠道文件
    pattern: /path\.join\(.*?\.claude['"],\s*['"]cc-tool['"],\s*['"]codex-channels\.json['"]\)/g,
    replacement: "require('../../config/paths').PATHS.channels.codex"
  },
  {
    // Gemini 渠道文件
    pattern: /path\.join\(.*?\.claude['"],\s*['"]cc-tool['"],\s*['"]gemini-channels\.json['"]\)/g,
    replacement: "require('../../config/paths').PATHS.channels.gemini"
  },
  {
    // Claude 激活渠道
    pattern: /path\.join\(.*?\.claude['"],\s*['"]cc-tool['"],\s*['"]active-channel\.json['"]\)/g,
    replacement: "require('../../config/paths').PATHS.activeChannel.claude"
  },
  {
    // Codex 激活渠道
    pattern: /path\.join\(.*?\.claude['"],\s*['"]cc-tool['"],\s*['"]codex-active-channel\.json['"]\)/g,
    replacement: "require('../../config/paths').PATHS.activeChannel.codex"
  },
  {
    // Gemini 激活渠道
    pattern: /path\.join\(.*?\.claude['"],\s*['"]cc-tool['"],\s*['"]gemini-active-channel\.json['"]\)/g,
    replacement: "require('../../config/paths').PATHS.activeChannel.gemini"
  }
];

// 遍历目录下的所有 JS 文件
function updateFilesInDirectory(dir) {
  const files = fs.readdirSync(dir, { withFileTypes: true });

  files.forEach(file => {
    const filePath = path.join(dir, file.name);

    if (file.isDirectory()) {
      updateFilesInDirectory(filePath);
    } else if (file.isFile() && file.name.endsWith('.js')) {
      updateFile(filePath);
    }
  });
}

function updateFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  let modified = false;

  // 检查是否需要添加 paths 导入
  const needsPathsImport = content.includes('.claude') && content.includes('cc-tool');

  // 应用所有替换
  REPLACEMENTS.forEach(({ pattern, replacement }) => {
    if (pattern.test(content)) {
      content = content.replace(pattern, replacement);
      modified = true;
    }
  });

  // 如果修改了内容且需要导入 paths
  if (modified && needsPathsImport) {
    // 检查是否已经导入
    if (!content.includes("require('../../config/paths')") &&
        !content.includes('require("../../config/paths")')) {
      // 在文件开头的 require 语句后添加导入
      const lines = content.split('\n');
      let insertIndex = -1;

      // 找到最后一个 require 语句的位置
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('require(')) {
          insertIndex = i;
        }
        // 遇到非空行且不是注释/require 就停止
        if (lines[i].trim() &&
            !lines[i].trim().startsWith('//') &&
            !lines[i].trim().startsWith('/*') &&
            !lines[i].trim().startsWith('*') &&
            !lines[i].includes('require(')) {
          break;
        }
      }

      if (insertIndex !== -1) {
        lines.splice(insertIndex + 1, 0, "const { PATHS } = require('../../config/paths');");
        content = lines.join('\n');
      }
    }

    // 写回文件
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`✅ Updated: ${filePath}`);
  }
}

// 主函数
function main() {
  console.log('🚀 开始迁移路径...\n');

  const dirsToUpdate = [
    path.join(__dirname, '../src/server/services'),
    path.join(__dirname, '../src/server/api'),
    path.join(__dirname, '../src/commands')
  ];

  dirsToUpdate.forEach(dir => {
    if (fs.existsSync(dir)) {
      console.log(`📁 处理目录: ${dir}`);
      updateFilesInDirectory(dir);
    }
  });

  console.log('\n✅ 路径迁移完成！');
  console.log('\n⚠️  请手动检查以下内容：');
  console.log('1. paths.js 的相对路径是否正确（../../config/paths）');
  console.log('2. 运行 npm test 确保没有破坏性变更');
  console.log('3. 检查 Claude/Codex/Gemini 原生配置路径是否正确');
}

main();
