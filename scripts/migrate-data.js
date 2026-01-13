#!/usr/bin/env node
/**
 * 数据迁移脚本
 * 从 ~/.claude/cc-tool 迁移数据到 ~/.claude/ctx
 * 保留原始文件不动
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// 源目录和目标目录
const SOURCE_DIR = path.join(os.homedir(), '.claude', 'cc-tool');
const TARGET_DIR = path.join(os.homedir(), '.claude', 'ctx');

// 颜色输出
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  red: '\x1b[31m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

// 递归复制目录
function copyDirectory(src, dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  const entries = fs.readdirSync(src, { withFileTypes: true });
  let copiedFiles = 0;
  let copiedDirs = 0;

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      const result = copyDirectory(srcPath, destPath);
      copiedFiles += result.files;
      copiedDirs += result.dirs + 1;
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
      copiedFiles++;
      log(`  ✓ ${entry.name}`, 'green');
    }
  }

  return { files: copiedFiles, dirs: copiedDirs };
}

// 获取目录大小
function getDirectorySize(dirPath) {
  let totalSize = 0;

  if (!fs.existsSync(dirPath)) {
    return 0;
  }

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      totalSize += getDirectorySize(fullPath);
    } else if (entry.isFile()) {
      try {
        const stats = fs.statSync(fullPath);
        totalSize += stats.size;
      } catch (err) {
        // 忽略错误
      }
    }
  }

  return totalSize;
}

// 格式化文件大小
function formatSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

// 主函数
function main() {
  log('\n🚀 CTX 数据迁移工具', 'blue');
  log('=' .repeat(60), 'blue');
  log(`源目录: ${SOURCE_DIR}`, 'yellow');
  log(`目标目录: ${TARGET_DIR}`, 'yellow');
  log('=' .repeat(60) + '\n', 'blue');

  // 检查源目录是否存在
  if (!fs.existsSync(SOURCE_DIR)) {
    log('❌ 源目录不存在，无需迁移', 'red');
    log(`   ${SOURCE_DIR}`, 'red');
    log('\n这可能是因为：', 'yellow');
    log('  1. 这是首次安装，还没有旧数据', 'yellow');
    log('  2. 已经迁移过了\n', 'yellow');
    return;
  }

  // 检查目标目录
  if (fs.existsSync(TARGET_DIR)) {
    log('⚠️  目标目录已存在', 'yellow');
    log(`   ${TARGET_DIR}`, 'yellow');

    // 询问是否覆盖（简化版，直接跳过）
    log('\n已跳过迁移，目标目录已存在数据', 'yellow');
    log('如需重新迁移，请先删除目标目录：', 'yellow');
    log(`   rm -rf "${TARGET_DIR}"\n`, 'yellow');
    return;
  }

  // 获取源目录大小
  const sourceSize = getDirectorySize(SOURCE_DIR);
  log(`📦 源目录大小: ${formatSize(sourceSize)}\n`, 'blue');

  // 开始迁移
  log('📂 开始迁移数据...\n', 'blue');

  try {
    const result = copyDirectory(SOURCE_DIR, TARGET_DIR);

    log('\n✅ 迁移完成！', 'green');
    log('=' .repeat(60), 'green');
    log(`已复制: ${result.files} 个文件, ${result.dirs} 个目录`, 'green');
    log(`总大小: ${formatSize(sourceSize)}`, 'green');
    log('=' .repeat(60) + '\n', 'green');

    // 验证
    const targetSize = getDirectorySize(TARGET_DIR);
    if (sourceSize === targetSize) {
      log('✓ 数据完整性验证通过', 'green');
    } else {
      log('⚠️  大小不匹配，请检查迁移结果', 'yellow');
      log(`   源: ${formatSize(sourceSize)}`, 'yellow');
      log(`   目标: ${formatSize(targetSize)}`, 'yellow');
    }

    log('\n📋 后续步骤:', 'blue');
    log('  1. 运行 ctx ui 测试 Web UI', 'blue');
    log('  2. 检查项目列表和会话是否正常', 'blue');
    log('  3. 测试代理功能: ctx proxy start', 'blue');
    log('\n💡 提示:', 'yellow');
    log(`  - 原始数据保留在: ${SOURCE_DIR}`, 'yellow');
    log(`  - 如有问题可以回退`, 'yellow');
    log(`  - 确认无误后可删除旧目录释放空间\n`, 'yellow');

  } catch (error) {
    log('\n❌ 迁移失败！', 'red');
    log(`错误: ${error.message}`, 'red');
    log('\n请检查：', 'yellow');
    log('  1. 磁盘空间是否充足', 'yellow');
    log('  2. 是否有权限访问目录', 'yellow');
    log('  3. 目录路径是否正确\n', 'yellow');
    process.exit(1);
  }
}

// 运行
main();
