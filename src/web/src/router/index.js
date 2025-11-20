import { createRouter, createWebHistory } from 'vue-router'
import ProjectList from '../views/ProjectList.vue'
import SessionList from '../views/SessionList.vue'

const routes = [
  {
    path: '/',
    name: 'projects',
    component: ProjectList
  },
  {
    path: '/sessions/:projectName',
    name: 'sessions',
    component: SessionList,
    props: true
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

export default router
