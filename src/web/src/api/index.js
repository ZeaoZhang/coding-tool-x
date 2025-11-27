import * as projectApi from './projects'
import * as sessionApi from './sessions'
import * as channelApi from './channels'
import * as proxyApi from './proxy'
import * as terminalApi from './terminal'
import * as statisticsApi from './statistics'
import * as versionApi from './version'
import * as favoritesApi from './favorites'
import * as uiConfigApi from './ui-config'
import * as pm2Api from './pm2'
import * as dashboardApi from './dashboard'

const api = {
  ...projectApi,
  ...sessionApi,
  ...channelApi,
  ...proxyApi,
  ...terminalApi,
  ...statisticsApi,
  ...versionApi,
  ...favoritesApi,
  ...uiConfigApi,
  ...pm2Api,
  ...dashboardApi
}

export default api
