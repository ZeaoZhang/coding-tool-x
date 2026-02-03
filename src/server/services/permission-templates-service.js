/**
 * Permission Templates Service
 *
 * 管理权限配置模版的 CRUD 操作
 * 支持内置模版和自定义模版
 */

const fs = require('fs');
const path = require('path');
const { PATHS } = require('../../config/paths');

// 权限模版存储文件
const TEMPLATES_FILE = path.join(PATHS.config, 'permission-templates.json');

// 内置权限模版
const BUILTIN_TEMPLATES = [
  {
    id: 'safe',
    name: '安全模式',
    description: '仅允许只读命令，危险操作需要确认',
    permissions: {
      allow: [
        'Bash(cat:*)',
        'Bash(ls:*)',
        'Bash(pwd)',
        'Bash(echo:*)',
        'Bash(head:*)',
        'Bash(tail:*)',
        'Bash(grep:*)',
        'Read(*)'
      ],
      deny: [
        'Bash(rm:*)',
        'Bash(sudo:*)',
        'Bash(git push:*)',
        'Bash(git reset --hard:*)',
        'Bash(chmod:*)',
        'Bash(chown:*)',
        'Edit(*)'
      ]
    },
    isBuiltin: true
  },
  {
    id: 'balanced',
    name: '平衡模式',
    description: '允许常用开发命令，危险操作需要确认',
    permissions: {
      allow: [
        'Bash(cat:*)',
        'Bash(ls:*)',
        'Bash(pwd)',
        'Bash(echo:*)',
        'Bash(head:*)',
        'Bash(tail:*)',
        'Bash(grep:*)',
        'Bash(find:*)',
        'Bash(git status)',
        'Bash(git diff:*)',
        'Bash(git log:*)',
        'Bash(npm run:*)',
        'Bash(pnpm:*)',
        'Bash(yarn:*)',
        'Read(*)',
        'Edit(*)'
      ],
      deny: [
        'Bash(rm -rf:*)',
        'Bash(sudo:*)',
        'Bash(git push --force:*)',
        'Bash(git reset --hard:*)'
      ]
    },
    isBuiltin: true
  },
  {
    id: 'permissive',
    name: '宽松模式',
    description: '允许大多数命令，仅阻止极度危险的操作',
    permissions: {
      allow: [
        'Bash(*)',
        'Read(*)',
        'Edit(*)'
      ],
      deny: [
        'Bash(rm -rf /*)',
        'Bash(sudo rm -rf:*)'
      ]
    },
    isBuiltin: true
  }
];

/**
 * 确保配置目录存在
 */
function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * 加载所有模版（内置 + 自定义）
 */
/**
 * 加载所有模版（内置 + 自定义）
 * 内置模版可被用户覆盖修改
 */
/**
 * 加载所有模版（内置 + 自定义）
 * 内置模版可被用户覆盖修改或隐藏
 */
function loadTemplates() {
  try {
    if (fs.existsSync(TEMPLATES_FILE)) {
      const content = fs.readFileSync(TEMPLATES_FILE, 'utf8');
      const data = JSON.parse(content);
      
      // 分离自定义模版和隐藏标记
      const customTemplates = (data.custom || []).filter(t => !t._hidden);
      const hiddenIds = (data.custom || []).filter(t => t._hidden).map(t => t.id);
      
      const customIds = customTemplates.map(t => t.id);
      
      // 过滤掉已被自定义覆盖或隐藏的内置模版
      const effectiveBuiltin = BUILTIN_TEMPLATES.filter(t => 
        !customIds.includes(t.id) && !hiddenIds.includes(t.id)
      );
      
      return {
        builtin: effectiveBuiltin,
        custom: customTemplates,
        all: [...customTemplates, ...effectiveBuiltin] // 自定义优先
      };
    }
  } catch (error) {
    console.error('[PermissionTemplates] 加载模版失败:', error.message);
  }

  return {
    builtin: BUILTIN_TEMPLATES,
    custom: [],
    all: BUILTIN_TEMPLATES
  };
}

/**
 * 保存自定义模版
 */
function saveCustomTemplates(customTemplates) {
  ensureDir(PATHS.config);
  fs.writeFileSync(TEMPLATES_FILE, JSON.stringify({ custom: customTemplates }, null, 2), 'utf8');
}

/**
 * 获取所有模版
 */
/**
 * 获取所有模版（合并后的最终列表）
 */
function getAllTemplates() {
  const { all } = loadTemplates();
  return all;
}

/**
 * 根据 ID 获取模版
 */
function getTemplateById(id) {
  const templates = getAllTemplates();
  return templates.find(t => t.id === id) || null;
}

/**
 * 创建自定义模版
 */
function createTemplate(template) {
  const { custom } = loadTemplates();

  // 验证必填字段
  if (!template.name || !template.name.trim()) {
    throw new Error('模版名称不能为空');
  }

  // 生成唯一 ID
  const id = `custom-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  const newTemplate = {
    id,
    name: template.name.trim(),
    description: template.description || '',
    permissions: {
      allow: template.permissions?.allow || [],
      deny: template.permissions?.deny || []
    },
    isBuiltin: false,
    createdAt: new Date().toISOString()
  };

  custom.push(newTemplate);
  saveCustomTemplates(custom);

  return newTemplate;
}

/**
 * 更新自定义模版
 */
/**
 * 更新权限模版（包括内置模版）
 * 编辑内置模版时，会在自定义列表中创建覆盖版本
 */
function updateTemplate(id, updates) {
  const { custom, all } = loadTemplates();
  
  // 查找模版（先查自定义，再查所有）
  const existingTemplate = all.find(t => t.id === id);
  if (!existingTemplate) {
    throw new Error('模版不存在');
  }

  // 验证名称
  if (updates.name !== undefined && !updates.name.trim()) {
    throw new Error('模版名称不能为空');
  }

  const updated = {
    ...existingTemplate,
    name: updates.name?.trim() ?? existingTemplate.name,
    description: updates.description ?? existingTemplate.description,
    permissions: updates.permissions ?? existingTemplate.permissions,
    isBuiltin: false, // 编辑后标记为自定义（覆盖内置）
    updatedAt: new Date().toISOString()
  };

  // 如果是编辑内置模版，则添加到自定义列表中（覆盖）
  const customIndex = custom.findIndex(t => t.id === id);
  if (customIndex !== -1) {
    custom[customIndex] = updated;
  } else {
    custom.push(updated);
  }
  
  saveCustomTemplates(custom);
  return updated;
}

/**
 * 删除自定义模版
 */
/**
 * 删除权限模版（包括内置模版）
 * 删除内置模版时，会在自定义列表中添加隐藏标记
 */
/**
 * 删除权限模版（包括内置模版）
 * 删除内置模版时，会在自定义列表中添加隐藏标记
 */
function deleteTemplate(id) {
  try {
    if (!fs.existsSync(TEMPLATES_FILE)) {
      ensureDir(PATHS.config);
      fs.writeFileSync(TEMPLATES_FILE, JSON.stringify({ custom: [] }, null, 2), 'utf8');
    }
    
    const content = fs.readFileSync(TEMPLATES_FILE, 'utf8');
    const data = JSON.parse(content);
    const customList = data.custom || [];
    
    // 检查是否为内置模版
    const isBuiltin = BUILTIN_TEMPLATES.some(t => t.id === id);
    
    if (isBuiltin) {
      // 内置模版：添加隐藏标记
      const hideMarker = {
        id,
        _hidden: true,
        deletedAt: new Date().toISOString()
      };
      customList.push(hideMarker);
      fs.writeFileSync(TEMPLATES_FILE, JSON.stringify({ custom: customList }, null, 2), 'utf8');
    } else {
      // 自定义模版：直接删除
      const index = customList.findIndex(t => t.id === id && !t._hidden);
      if (index === -1) {
        throw new Error('模版不存在');
      }
      customList.splice(index, 1);
      fs.writeFileSync(TEMPLATES_FILE, JSON.stringify({ custom: customList }, null, 2), 'utf8');
    }

    return true;
  } catch (error) {
    if (error.message === '模版不存在') throw error;
    throw new Error('删除模版失败: ' + error.message);
  }
}

module.exports = {
  getAllTemplates,
  getTemplateById,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  BUILTIN_TEMPLATES
};
