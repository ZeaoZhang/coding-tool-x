#!/bin/bash
# 路径迁移自动化脚本
# 将历史目录统一迁移为 ~/.cc-tool

echo "🚀 开始路径迁移..."

# 定义要处理的目录
DIRS="src/server/services src/server/api src/commands src/server"

# 备份
echo "📦 创建备份..."
timestamp=$(date +%Y%m%d_%H%M%S)
tar -czf "path_migration_backup_${timestamp}.tar.gz" $DIRS
echo "✅ 备份已创建: path_migration_backup_${timestamp}.tar.gz"

# 替换路径
echo "🔄 开始替换路径..."

# 1. 替换基础目录路径
find $DIRS -type f -name "*.js" -exec sed -i.bak \
  "s/path\.join(os\.homedir(), '\.claude', 'cc-tool')/require('..\/..\/config\/paths').PATHS.base/g" {} \;

# 2. 替换 .claude/logs 为 .cc-tool/logs
find $DIRS -type f -name "*.js" -exec sed -i.bak \
  "s/\.claude\/logs/\.cc-tool\/logs/g" {} \;

# 3. 替换 .claude/projects 为 .cc-tool/projects
find $DIRS -type f -name "*.js" -exec sed -i.bak \
  "s/path\.join(os\.homedir(), '\.claude', 'projects')/require('..\/..\/config\/paths').PATHS.projects/g" {} \;

# 4. 清理备份文件
find $DIRS -type f -name "*.bak" -delete

echo "✅ 路径替换完成"

echo ""
echo "⚠️  请手动检查以下内容:"
echo "1. 确保所有文件开头都导入了 paths 模块"
echo "2. 运行 node src/index.js 测试是否有语法错误"
echo "3. 检查日志路径是否正确"
echo "4. 测试基本功能：ctx ui, ctx proxy start"

echo ""
echo "如需回滚，请解压备份文件:"
echo "tar -xzf path_migration_backup_${timestamp}.tar.gz"
