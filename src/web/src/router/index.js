import { createRouter, createWebHistory } from 'vue-router'

const Home = () => import('../views/Home.vue')
const ProjectList = () => import('../views/ProjectList.vue')
const SessionList = () => import('../views/SessionList.vue')
const WorkspaceManager = () => import('../views/WorkspaceManager.vue')
const ConfigTemplates = () => import('../views/ConfigTemplates.vue')
const SkillManager = () => import('../views/SkillManager.vue')
const PluginManager = () => import('../views/PluginManager.vue')
const Analytics = () => import('../views/Analytics.vue')

const routes = [
  {
    path: '/',
    name: 'home',
    component: Home
  },
  // Claude 渠道路由
  {
    path: '/claude',
    name: 'claude-projects',
    component: ProjectList,
    meta: { channel: 'claude' }
  },
  {
    path: '/claude/sessions/:projectName',
    name: 'claude-sessions',
    component: SessionList,
    props: true,
    meta: { channel: 'claude' }
  },
  // Codex 渠道路由
  {
    path: '/codex',
    name: 'codex-projects',
    component: ProjectList,
    meta: { channel: 'codex' }
  },
  {
    path: '/codex/sessions/:projectName',
    name: 'codex-sessions',
    component: SessionList,
    props: true,
    meta: { channel: 'codex' }
  },
  // Gemini 渠道路由
  {
    path: '/gemini',
    name: 'gemini-projects',
    component: ProjectList,
    meta: { channel: 'gemini' }
  },
  {
    path: '/gemini/sessions/:projectName',
    name: 'gemini-sessions',
    component: SessionList,
    props: true,
    meta: { channel: 'gemini' }
  },
  // OpenCode 渠道路由
  {
    path: '/opencode',
    name: 'opencode-projects',
    component: ProjectList,
    meta: { channel: 'opencode' }
  },
  {
    path: '/opencode/sessions/:projectName',
    name: 'opencode-sessions',
    component: SessionList,
    props: true,
    meta: { channel: 'opencode' }
  },
  // 工作区管理路由
  {
    path: '/workspaces',
    name: 'workspaces',
    component: WorkspaceManager
  },
  // 配置模版管理路由
  {
    path: '/config-templates',
    name: 'config-templates',
    component: ConfigTemplates
  },
  // 技能管理路由
  {
    path: '/skills',
    name: 'skills',
    component: SkillManager
  },
  // 插件管理路由
  {
    path: '/plugins',
    name: 'plugins',
    component: PluginManager
  },
  // 用量分析路由
  {
    path: '/analytics',
    name: 'analytics',
    component: Analytics
  },
  // 404 重定向到首页
  {
    path: '/:pathMatch(.*)*',
    redirect: '/'
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

export default router
