import { createRouter, createWebHistory } from 'vue-router'
import { useUIConfig } from '../composables/useUIConfig'
import { useEnabledCliPlatforms } from '../composables/useEnabledCliPlatforms'
import { usePlatformStore } from '../stores/platforms'
import { getRoutePlatform } from '../config/platformCatalog'

const Home = () => import('../views/Home.vue')
const ProjectList = () => import('../views/ProjectList.vue')
const SessionList = () => import('../views/SessionList.vue')
const WorkspaceManager = () => import('../views/WorkspaceManager.vue')
const ConfigTemplates = () => import('../views/ConfigTemplates.vue')
const SkillManager = () => import('../views/SkillManager.vue')
const Analytics = () => import('../views/Analytics.vue')
const PluginManager = () => import('../views/PluginManager.vue')
const LEGACY_PLATFORM_KEYS = ['claude', 'codex', 'gemini', 'opencode', 'omp']

function createLegacyRedirectRoutes() {
  return LEGACY_PLATFORM_KEYS.flatMap((platform) => [
    {
      path: `/${platform}`,
      name: `${platform}-projects-legacy`,
      redirect: { name: 'cli-projects', params: { platform } }
    },
    {
      path: `/${platform}/sessions/:projectName`,
      name: `${platform}-sessions-legacy`,
      redirect: to => ({
        name: 'cli-sessions',
        params: { platform, projectName: to.params.projectName }
      })
    }
  ])
}

const routes = [
  {
    path: '/',
    name: 'home',
    component: Home
  },
  {
    path: '/cli/:platform',
    name: 'cli-projects',
    component: ProjectList,
    meta: { requiresCli: true }
  },
  {
    path: '/cli/:platform/sessions/:projectName',
    name: 'cli-sessions',
    component: SessionList,
    props: true,
    meta: { requiresCli: true }
  },
  ...createLegacyRedirectRoutes(),
  {
    path: '/workspaces',
    name: 'workspaces',
    component: WorkspaceManager
  },
  {
    path: '/config-templates',
    name: 'config-templates',
    component: ConfigTemplates
  },
  {
    path: '/skills',
    name: 'skills',
    component: SkillManager
  },
  {
    path: '/plugins',
    name: 'plugins',
    component: PluginManager
  },
  {
    path: '/analytics',
    name: 'analytics',
    component: Analytics
  },
  {
    path: '/:pathMatch(.*)*',
    redirect: '/'
  }
]


const router = createRouter({
  history: createWebHistory(),
  routes
})

router.beforeEach(async (to) => {
  if (to.meta.requiresCli !== true) return true

  const platformKey = getRoutePlatform(to)
  if (!platformKey) return { name: 'home' }

  try {
    const platformStore = usePlatformStore()
    const { uiConfig, loadUIConfig } = useUIConfig()
    await Promise.all([
      platformStore.load(),
      loadUIConfig()
    ])

    const { enabledKeys } = useEnabledCliPlatforms({
      platformStore,
      configRef: uiConfig
    })

    return enabledKeys.value.includes(platformKey) ? true : { name: 'home' }
  } catch {
    return { name: 'home' }
  }
})
export { getRoutePlatform }
export default router
