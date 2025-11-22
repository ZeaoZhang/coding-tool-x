import { createRouter, createWebHistory } from 'vue-router'
import Home from '../views/Home.vue'
import ProjectList from '../views/ProjectList.vue'
import SessionList from '../views/SessionList.vue'

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
