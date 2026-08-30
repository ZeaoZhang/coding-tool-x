// 工作区管理命令
const chalk = require('chalk');
const inquirer = require('inquirer');
const fs = require('fs');
const path = require('path');
const workspaceService = require('../server/services/workspace-service');
const { getProjectsWithStats } = require('../server/services/sessions');
const { loadConfig } = require('../config/loader');

/**
 * 列出所有工作区
 */
async function listWorkspaces() {
  try {
    const workspaces = workspaceService.listWorkspaces();

    if (workspaces.length === 0) {
      console.log(chalk.yellow('\n暂无工作区\n'));
      return;
    }

    console.log(chalk.bold.cyan('\n工作区列表:\n'));

    workspaces.forEach((ws, index) => {
      const status = ws.exists ? chalk.green('[v]') : chalk.red('[x]');
      console.log(`${index + 1}. ${status} ${chalk.bold(ws.name)}`);

      if (ws.description) {
        console.log(chalk.gray(`   描述: ${ws.description}`));
      }

      console.log(chalk.gray(`   路径: ${ws.path}`));
      console.log(chalk.gray(`   项目数: ${ws.projectCount}`));
      console.log(chalk.gray(`   最后使用: ${new Date(ws.lastUsed).toLocaleString('zh-CN')}`));
      console.log('');
    });
  } catch (error) {
    console.error(chalk.red(`\n[ERROR] ${error.message}\n`));
  }
}

/**
 * 创建工作区
 */
async function createWorkspace() {
  try {
    const config = loadConfig();

    // 1. 输入工作区名称
    const { name } = await inquirer.prompt([
      {
        type: 'input',
        name: 'name',
        message: '工作区名称:',
        validate: input => {
          if (!input || !input.trim()) {
            return '名称不能为空';
          }
          // 检查名称是否包含非法字符
          if (!/^[a-zA-Z0-9_\-\u4e00-\u9fa5]+$/.test(input)) {
            return '名称只能包含字母、数字、下划线、中划线和中文';
          }
          return true;
        }
      }
    ]);

    // 2. 输入描述（可选）
    const { description } = await inquirer.prompt([
      {
        type: 'input',
        name: 'description',
        message: '工作区描述（可选）:',
        default: ''
      }
    ]);

    // 3. 选择基础目录
    const { baseDirOption } = await inquirer.prompt([
      {
        type: 'list',
        name: 'baseDirOption',
        message: '选择工作区存放位置:',
        choices: [
          { name: '自动（第一个项目的父目录）', value: 'auto' },
          { name: '自定义路径', value: 'custom' }
        ]
      }
    ]);

    let baseDir = '';
    if (baseDirOption === 'custom') {
      const { customPath } = await inquirer.prompt([
        {
          type: 'input',
          name: 'customPath',
          message: '输入基础目录路径:',
          validate: input => {
            if (!input || !input.trim()) {
              return '路径不能为空';
            }
            const expanded = input.replace(/^~/, require('os').homedir());
            if (!fs.existsSync(expanded)) {
              return `路径不存在: ${expanded}`;
            }
            if (!fs.statSync(expanded).isDirectory()) {
              return '必须是目录路径';
            }
            return true;
          }
        }
      ]);
      baseDir = customPath.replace(/^~/, require('os').homedir());
    }

    // 4. 选择项目
    const projects = [];
    let continueAdding = true;

    while (continueAdding) {
      const availableProjects = await getProjectsWithStats(config);

      if (availableProjects.length === 0) {
        console.log(chalk.yellow('\n没有可用的项目\n'));
        break;
      }

      const projectChoices = availableProjects.map(proj => ({
        name: `${proj.displayName} (${proj.sessionCount} 会话)`,
        value: proj
      }));

      projectChoices.push(
        new inquirer.Separator(chalk.gray('─'.repeat(14))),
        { name: chalk.gray('[v] 完成选择'), value: null }
      );

      const { selectedProject } = await inquirer.prompt([
        {
          type: 'list',
          name: 'selectedProject',
          message: `选择项目 (${projects.length} 个已选):`,
          pageSize: 15,
          choices: projectChoices
        }
      ]);

      if (!selectedProject) {
        if (projects.length === 0) {
          console.log(chalk.yellow('\n至少需要选择一个项目\n'));
          continue;
        }
        continueAdding = false;
        break;
      }

      // 检查是否已添加
      if (projects.find(p => p.sourcePath === selectedProject.fullPath)) {
        console.log(chalk.yellow('\n该项目已添加\n'));
        continue;
      }

      // 获取项目路径
      const sourcePath = selectedProject.fullPath;

      // 输入软链接名称
      const defaultLinkName = path.basename(sourcePath);
      const { linkName } = await inquirer.prompt([
        {
          type: 'input',
          name: 'linkName',
          message: '软链接名称:',
          default: defaultLinkName,
          validate: input => {
            if (!input || !input.trim()) {
              return '名称不能为空';
            }
            if (projects.find(p => p.name === input)) {
              return '该名称已被使用';
            }
            return true;
          }
        }
      ]);

      // 检查是否是 git 仓库
      const isGit = workspaceService.isGitRepo(sourcePath);

      let createWorktree = false;
      let branch = '';
      let branchMode = 'existing';
      let baseBranch = '';

      if (isGit) {
        const { shouldCreateWorktree } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'shouldCreateWorktree',
            message: '是否为此项目创建 git worktree?',
            default: false
          }
        ]);

        if (shouldCreateWorktree) {
          const { selectedBranchMode } = await inquirer.prompt([
            {
              type: 'list',
              name: 'selectedBranchMode',
              message: '选择 worktree 分支模式:',
              choices: [
                { name: '使用已有分支', value: 'existing' },
                { name: '新建分支', value: 'new' }
              ],
              default: 'existing'
            }
          ]);

          const { branchName } = await inquirer.prompt([
            {
              type: 'input',
              name: 'branchName',
              message: selectedBranchMode === 'new' ? '输入新分支名:' : '输入已有分支名:',
              validate: input => {
                if (!input || !input.trim()) {
                  return '分支名不能为空';
                }
                return true;
              }
            }
          ]);

          if (selectedBranchMode === 'new') {
            const { baseBranchName } = await inquirer.prompt([
              {
                type: 'input',
                name: 'baseBranchName',
                message: '输入基础分支（可选，如 main）:',
                default: ''
              }
            ]);
            baseBranch = baseBranchName;
          }

          createWorktree = true;
          branchMode = selectedBranchMode;
          branch = branchName;
        }
      }

      projects.push({
        sourcePath,
        name: linkName,
        createWorktree,
        branch,
        branchMode,
        baseBranch
      });

      console.log(chalk.green(`\n[v] 已添加: ${linkName}\n`));
    }

    if (projects.length === 0) {
      console.log(chalk.yellow('\n取消创建\n'));
      return;
    }

    // 5. 确认创建
    console.log(chalk.bold.cyan('\n工作区配置预览:\n'));
    console.log(chalk.gray(`名称: ${name}`));
    if (description) {
      console.log(chalk.gray(`描述: ${description}`));
    }
    console.log(chalk.gray(`项目数: ${projects.length}`));
    console.log(chalk.gray('\n包含项目:'));
    projects.forEach((proj, index) => {
      console.log(chalk.gray(`  ${index + 1}. ${proj.name} → ${proj.sourcePath}`));
      if (proj.createWorktree) {
        const modeLabel = proj.branchMode === 'new' ? '新建分支' : '已有分支';
        const baseLabel = proj.branchMode === 'new' && proj.baseBranch ? `，基于 ${proj.baseBranch}` : '';
        console.log(chalk.gray(`     (创建 worktree: ${modeLabel} ${proj.branch}${baseLabel})`));
      }
    });
    console.log('');

    const { confirm } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: '确认创建工作区?',
        default: true
      }
    ]);

    if (!confirm) {
      console.log(chalk.yellow('\n取消创建\n'));
      return;
    }

    // 创建工作区
    console.log(chalk.cyan('\n正在创建工作区...\n'));

    const workspace = await workspaceService.createWorkspace({
      name,
      description,
      baseDir,
      projects
    });

    console.log(chalk.green(`\n[OK] 工作区创建成功!\n`));
    console.log(chalk.gray(`工作区路径: ${workspace.path}\n`));
    console.log(chalk.gray(`提示: 可以在此路径下启动 Claude Code 以访问所有项目\n`));

  } catch (error) {
    console.error(chalk.red(`\n[ERROR] ${error.message}\n`));
  }
}

/**
 * 查看工作区详情
 */
async function viewWorkspace() {
  try {
    const workspaces = workspaceService.listWorkspaces();

    if (workspaces.length === 0) {
      console.log(chalk.yellow('\n暂无工作区\n'));
      return;
    }

    const { workspace } = await inquirer.prompt([
      {
        type: 'list',
        name: 'workspace',
        message: '选择工作区:',
        pageSize: 15,
        choices: workspaces.map(ws => ({
          name: `${ws.name} (${ws.projectCount} 个项目)`,
          value: ws
        }))
      }
    ]);

    const detail = workspaceService.getWorkspace(workspace.id);

    console.log(chalk.bold.cyan(`\n工作区: ${detail.name}\n`));

    if (detail.description) {
      console.log(chalk.gray(`描述: ${detail.description}`));
    }

    console.log(chalk.gray(`路径: ${detail.path}`));
    console.log(chalk.gray(`状态: ${detail.exists ? chalk.green('存在') : chalk.red('不存在')}`));
    console.log(chalk.gray(`创建时间: ${new Date(detail.createdAt).toLocaleString('zh-CN')}`));
    console.log(chalk.gray(`最后使用: ${new Date(detail.lastUsed).toLocaleString('zh-CN')}`));

    console.log(chalk.bold.cyan(`\n包含项目 (${detail.projects.length}):\n`));

    detail.projects.forEach((proj, index) => {
      const linkStatus = proj.linkExists ? chalk.green('[v]') : chalk.red('[x]');
      const sourceStatus = proj.sourceExists ? chalk.green('[v]') : chalk.red('[x]');

      console.log(`${index + 1}. ${linkStatus} ${chalk.bold(proj.name)}`);
      console.log(chalk.gray(`   源路径: ${sourceStatus} ${proj.sourcePath}`));

      if (proj.worktrees && proj.worktrees.length > 0) {
        console.log(chalk.gray(`   Worktrees (${proj.worktrees.length}):`));
        proj.worktrees.forEach(wt => {
          console.log(chalk.gray(`     - ${wt.branch || 'detached'}: ${wt.path}`));
        });
      }

      console.log('');
    });

  } catch (error) {
    console.error(chalk.red(`\n[ERROR] ${error.message}\n`));
  }
}

/**
 * 删除工作区
 */
async function deleteWorkspace() {
  try {
    const workspaces = workspaceService.listWorkspaces();

    if (workspaces.length === 0) {
      console.log(chalk.yellow('\n暂无工作区\n'));
      return;
    }

    const { workspace } = await inquirer.prompt([
      {
        type: 'list',
        name: 'workspace',
        message: '选择要删除的工作区:',
        pageSize: 15,
        choices: workspaces.map(ws => ({
          name: `${ws.name} (${ws.projectCount} 个项目)`,
          value: ws
        }))
      }
    ]);

    const { removeFiles } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'removeFiles',
        message: '是否同时删除工作区目录和 worktrees?',
        default: false
      }
    ]);

    const { confirm } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: chalk.yellow(`确认删除工作区 "${workspace.name}"?`),
        default: false
      }
    ]);

    if (!confirm) {
      console.log(chalk.yellow('\n取消删除\n'));
      return;
    }

    workspaceService.deleteWorkspace(workspace.id, removeFiles);
    console.log(chalk.green('\n[OK] 工作区删除成功\n'));

  } catch (error) {
    console.error(chalk.red(`\n[ERROR] ${error.message}\n`));
  }
}

/**
 * 工作区管理主菜单
 */
async function workspaceMenu() {
  let continueMenu = true;

  while (continueMenu) {
    const { action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: '工作区管理:',
        pageSize: 10,
        choices: [
          { name: chalk.cyan('创建工作区'), value: 'create' },
          { name: chalk.green('查看工作区'), value: 'view' },
          { name: chalk.blue('列出所有工作区'), value: 'list' },
          { name: chalk.red('删除工作区'), value: 'delete' },
          new inquirer.Separator(chalk.gray('─'.repeat(14))),
          { name: chalk.gray('返回主菜单'), value: 'back' }
        ]
      }
    ]);

    switch (action) {
      case 'create':
        await createWorkspace();
        break;
      case 'view':
        await viewWorkspace();
        break;
      case 'list':
        await listWorkspaces();
        break;
      case 'delete':
        await deleteWorkspace();
        break;
      case 'back':
        continueMenu = false;
        break;
    }
  }
}

module.exports = {
  workspaceMenu,
  listWorkspaces,
  createWorkspace,
  viewWorkspace,
  deleteWorkspace
};
