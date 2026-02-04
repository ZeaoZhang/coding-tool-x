# Autopilot Spec: Claude Code 渠道测速模型下拉列表修复

## 问题描述
Claude Code 渠道选择测速模型时，部分渠道没有下拉列表选项。

## 需求分析

### 功能需求
1. Claude 渠道的 `speedTestModel` 字段应该显示可用模型的下拉列表
2. 下拉列表在新建渠道和编辑渠道时都应该有选项
3. 保持与 Codex/Gemini 渠道一致的用户体验

### 非功能需求
- 保持向后兼容
- 不改变现有的动态模型获取逻辑

### 隐性需求
- 默认模型列表应该包含最新的 Claude 模型

## 技术规格

### 根本原因
1. Claude 渠道的 `speedTestModel` 字段没有定义静态 `options` 属性
2. 而 Codex 和 Gemini 渠道都定义了静态 `options`
3. 动态获取模型列表 (`fetchModelsForChannel`) 只在编辑模式触发
4. 新建渠道时 `availableModels` 为空，导致无下拉选项

### 修复方案
在 `channelPanelFactories.js` 中为 Claude 渠道的 `speedTestModel` 字段添加静态 `options` 属性，使用 `defaultModels.claude` 作为默认选项。

### 修改文件
- `src/web/src/components/channel/channelPanelFactories.js`

### 代码变更
```javascript
// 修改前 (第 203-208 行):
{
  key: 'speedTestModel',
  label: '测速模型',
  type: 'select',
  placeholder: '选择用于测速的模型（留空则自动检测）',
  description: '指定用于速度测试的模型，留空则使用自动检测'
}

// 修改后:
{
  key: 'speedTestModel',
  label: '测速模型',
  type: 'select',
  placeholder: '选择用于测速的模型（留空则自动检测）',
  description: '指定用于速度测试的模型，留空则使用自动检测',
  options: defaultModels.claude.map(m => ({ label: m, value: m })),
  clearable: true
}
```

## 验证计划
1. 新建 Claude 渠道时检查测速模型下拉列表是否有选项
2. 编辑 Claude 渠道时检查测速模型下拉列表是否有选项
3. 确认 Codex/Gemini 渠道的下拉列表行为不受影响

**EXPANSION_COMPLETE**
**PLANNING_COMPLETE**
