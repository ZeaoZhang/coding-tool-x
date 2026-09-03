/**
 * 配置同步服务
 *
 * 支持 skills, agents, commands 的在工作区和全局之间同步
 * 
 * 配置位置:
 * - 全局: ~/.claude/
 *   - skills/
 *   - agents/
 *   - commands/
 * - 工作区: <project>/.claude/
 *   - agents/
 *   - commands/
 */

const fs = require('fs');
const path = require('path');
const { HOME_DIR, NATIVE_PATHS } = require('../../../config/paths');

// 全局配置目录
const GLOBAL_CONFIG_DIR = NATIVE_PATHS.claude.dir
    || path.dirname(NATIVE_PATHS.claude.settings)
    || path.join(HOME_DIR, '.claude');

// 配置类型定义
const CONFIG_TYPES = {
    skills: {
        globalDir: 'skills',
        projectDir: null, // skills 不支持项目级
        isDirectory: true, // skills 是目录结构
        markerFile: 'SKILL.md'
    },
    agents: {
        globalDir: 'agents',
        projectDir: 'agents',
        isDirectory: false,
        fileExtension: '.md'
    },
    commands: {
        globalDir: 'commands',
        projectDir: 'commands',
        isDirectory: false,
        fileExtension: '.md'
    }
};

/**
 * 确保目录存在
 */
function ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

/**
 * 递归复制目录
 */
function copyDirRecursive(src, dest) {
    ensureDir(dest);
    const entries = fs.readdirSync(src, { withFileTypes: true });

    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);

        if (entry.isDirectory()) {
            copyDirRecursive(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

/**
 * 配置同步服务类
 */
class ConfigSyncService {
    constructor() {
        this.globalConfigDir = GLOBAL_CONFIG_DIR;
        ensureDir(this.globalConfigDir);
    }

    /**
     * 获取可用的配置项列表
     * @param {string} source - 'global' 或 'workspace'
     * @param {string} projectPath - 工作区项目路径（source 为 workspace 时必需）
     * @returns {Object} 各类型的配置项列表
     */
    getAvailableConfigs(source, projectPath = null) {
        const result = {
            skills: [],
            agents: [],
            commands: []
        };

        for (const [type, config] of Object.entries(CONFIG_TYPES)) {
            let dir;

            if (source === 'global') {
                dir = path.join(this.globalConfigDir, config.globalDir);
            } else if (source === 'workspace' && projectPath) {
                if (!config.projectDir) {
                    // skills 不支持项目级
                    continue;
                }
                dir = path.join(projectPath, '.claude', config.projectDir);
            } else {
                continue;
            }

            if (!fs.existsSync(dir)) {
                continue;
            }

            if (config.isDirectory) {
                // Skills: 扫描目录
                result[type] = this._scanSkillsDir(dir);
            } else {
                // Agents/Commands: 扫描 md 文件
                result[type] = this._scanMdFiles(dir, config.fileExtension);
            }
        }

        return result;
    }

    /**
     * 扫描 skills 目录
     */
    _scanSkillsDir(dir) {
        const skills = [];

        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });

            for (const entry of entries) {
                if (!entry.isDirectory() || entry.name.startsWith('.')) continue;

                const skillPath = path.join(dir, entry.name);
                const skillMdPath = path.join(skillPath, 'SKILL.md');

                if (fs.existsSync(skillMdPath)) {
                    const content = fs.readFileSync(skillMdPath, 'utf-8');
                    const metadata = this._parseSkillMetadata(content);

                    // 获取文件列表
                    const files = this._getDirectoryFiles(skillPath);

                    skills.push({
                        name: metadata.name || entry.name,
                        directory: entry.name,
                        description: metadata.description || '',
                        files: files.length,
                        size: this._getDirSize(skillPath)
                    });
                }
            }
        } catch (err) {
            console.error('[ConfigSync] Scan skills error:', err.message);
        }

        return skills;
    }

    /**
     * 扫描 md 文件（agents/commands）
     */
    _scanMdFiles(dir, extension = '.md') {
        const items = [];

        const scan = (currentDir, relativePath = '') => {
            try {
                const entries = fs.readdirSync(currentDir, { withFileTypes: true });

                for (const entry of entries) {
                    if (entry.name.startsWith('.')) continue;

                    const fullPath = path.join(currentDir, entry.name);
                    const relPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;

                    if (entry.isDirectory()) {
                        scan(fullPath, relPath);
                    } else if (entry.name.endsWith(extension)) {
                        const content = fs.readFileSync(fullPath, 'utf-8');
                        const metadata = this._parseFrontmatter(content);
                        const stats = fs.statSync(fullPath);

                        items.push({
                            name: metadata.name || path.basename(entry.name, extension),
                            path: relPath,
                            description: metadata.description || '',
                            size: stats.size
                        });
                    }
                }
            } catch (err) {
                // 忽略读取错误
            }
        };

        scan(dir);
        return items;
    }

    /**
     * 解析 SKILL.md 元数据
     */
    _parseSkillMetadata(content) {
        const result = { name: null, description: null };

        // 匹配 YAML frontmatter
        const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
        if (match) {
            const yaml = match[1];
            const nameMatch = yaml.match(/name:\s*["']?([^"'\n]+)["']?/);
            const descMatch = yaml.match(/description:\s*["']?([^"'\n]+)["']?/);

            if (nameMatch) result.name = nameMatch[1].trim();
            if (descMatch) result.description = descMatch[1].trim();
        }

        return result;
    }

    /**
     * 解析 frontmatter
     */
    _parseFrontmatter(content) {
        const result = { name: null, description: null };

        const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
        if (match) {
            const yaml = match[1];
            const nameMatch = yaml.match(/name:\s*["']?([^"'\n]+)["']?/);
            const descMatch = yaml.match(/description:\s*["']?([^"'\n]+)["']?/);

            if (nameMatch) result.name = nameMatch[1].trim();
            if (descMatch) result.description = descMatch[1].trim();
        }

        return result;
    }

    /**
     * 获取目录下的文件列表
     */
    _getDirectoryFiles(dir) {
        const files = [];

        const scan = (currentDir, relativePath = '') => {
            const entries = fs.readdirSync(currentDir, { withFileTypes: true });

            for (const entry of entries) {
                const relPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;

                if (entry.isDirectory()) {
                    scan(path.join(currentDir, entry.name), relPath);
                } else {
                    files.push(relPath);
                }
            }
        };

        scan(dir);
        return files;
    }

    /**
     * 获取目录大小
     */
    _getDirSize(dir) {
        let size = 0;

        const scan = (currentDir) => {
            const entries = fs.readdirSync(currentDir, { withFileTypes: true });

            for (const entry of entries) {
                const fullPath = path.join(currentDir, entry.name);

                if (entry.isDirectory()) {
                    scan(fullPath);
                } else {
                    size += fs.statSync(fullPath).size;
                }
            }
        };

        scan(dir);
        return size;
    }

    /**
     * 预览同步结果
     * @param {Object} options
     * @param {string} options.source - 'global' 或 'workspace'
     * @param {string} options.target - 'global' 或 'workspace'
     * @param {string[]} options.configTypes - 要同步的配置类型
     * @param {string} options.projectPath - 工作区路径
     * @param {Object} options.selectedItems - 选中的项目 { skills: [], agents: [], ... }
     * @returns {Object} 预览结果
     */
    previewSync(options) {
        const { source, target, configTypes = [], projectPath, selectedItems = {} } = options;

        const preview = {
            willCreate: [],
            willOverwrite: [],
            willSkip: [],
            errors: []
        };

        // 验证参数
        if (source === target) {
            preview.errors.push('源和目标不能相同');
            return preview;
        }

        if (target === 'workspace' && !projectPath) {
            preview.errors.push('同步到工作区需要指定项目路径');
            return preview;
        }

        for (const type of configTypes) {
            const config = CONFIG_TYPES[type];
            if (!config) continue;

            // Skills 只支持全局
            if (type === 'skills' && target === 'workspace') {
                preview.errors.push('Skills 不支持同步到工作区级别');
                continue;
            }

            const items = selectedItems[type] || [];

            for (const item of items) {
                const targetPath = this._getTargetPath(type, item, target, projectPath);

                if (fs.existsSync(targetPath)) {
                    preview.willOverwrite.push({
                        type,
                        name: item.name || item.directory || item.path,
                        targetPath
                    });
                } else {
                    preview.willCreate.push({
                        type,
                        name: item.name || item.directory || item.path,
                        targetPath
                    });
                }
            }
        }

        return preview;
    }

    /**
     * 获取目标路径
     */
    _getTargetPath(type, item, target, projectPath) {
        const config = CONFIG_TYPES[type];
        let baseDir;

        if (target === 'global') {
            baseDir = path.join(this.globalConfigDir, config.globalDir);
        } else {
            baseDir = path.join(projectPath, '.claude', config.projectDir);
        }

        if (config.isDirectory) {
            // Skills
            return path.join(baseDir, item.directory);
        } else {
            // Agents/Commands
            return path.join(baseDir, item.path);
        }
    }

    /**
     * 执行同步
     * @param {Object} options
     * @param {string} options.source - 'global' 或 'workspace'
     * @param {string} options.target - 'global' 或 'workspace'
     * @param {string[]} options.configTypes - 要同步的配置类型
     * @param {string} options.projectPath - 工作区路径
     * @param {Object} options.selectedItems - 选中的项目
     * @param {boolean} options.overwrite - 是否覆盖已存在的
     * @returns {Object} 同步结果
     */
    executeSync(options) {
        const { source, target, configTypes = [], projectPath, selectedItems = {}, overwrite = false } = options;

        const result = {
            success: [],
            failed: [],
            skipped: []
        };

        for (const type of configTypes) {
            const config = CONFIG_TYPES[type];
            if (!config) continue;

            // Skills 只支持全局
            if (type === 'skills' && target === 'workspace') {
                result.failed.push({
                    type,
                    name: 'skills',
                    error: 'Skills 不支持同步到工作区级别'
                });
                continue;
            }

            const items = selectedItems[type] || [];

            for (const item of items) {
                try {
                    const sourcePath = this._getSourcePath(type, item, source, projectPath);
                    const targetPath = this._getTargetPath(type, item, target, projectPath);

                    // 检查目标是否存在
                    if (fs.existsSync(targetPath) && !overwrite) {
                        result.skipped.push({
                            type,
                            name: item.name || item.directory || item.path,
                            reason: '已存在'
                        });
                        continue;
                    }

                    // 确保目标目录存在
                    ensureDir(path.dirname(targetPath));

                    // 执行复制
                    if (config.isDirectory) {
                        copyDirRecursive(sourcePath, targetPath);
                    } else {
                        fs.copyFileSync(sourcePath, targetPath);
                    }

                    result.success.push({
                        type,
                        name: item.name || item.directory || item.path
                    });
                } catch (err) {
                    result.failed.push({
                        type,
                        name: item.name || item.directory || item.path,
                        error: err.message
                    });
                }
            }
        }

        return result;
    }

    /**
     * 获取源路径
     */
    _getSourcePath(type, item, source, projectPath) {
        const config = CONFIG_TYPES[type];
        let baseDir;

        if (source === 'global') {
            baseDir = path.join(this.globalConfigDir, config.globalDir);
        } else {
            baseDir = path.join(projectPath, '.claude', config.projectDir);
        }

        if (config.isDirectory) {
            // Skills
            return path.join(baseDir, item.directory);
        } else {
            // Agents/Commands
            return path.join(baseDir, item.path);
        }
    }

    /**
     * 获取同步统计信息
     */
    getStats(projectPath = null) {
        const globalConfigs = this.getAvailableConfigs('global');
        const workspaceConfigs = projectPath
            ? this.getAvailableConfigs('workspace', projectPath)
            : { skills: [], agents: [], commands: [] };

        return {
            global: {
                skills: globalConfigs.skills.length,
                agents: globalConfigs.agents.length,
                commands: globalConfigs.commands.length
            },
            workspace: {
                agents: workspaceConfigs.agents.length,
                commands: workspaceConfigs.commands.length
            }
        };
    }
}

module.exports = {
    ConfigSyncService,
    CONFIG_TYPES
};
