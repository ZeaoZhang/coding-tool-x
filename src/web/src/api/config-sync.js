/**
 * 配置同步 API
 */

import { client } from './client'

/**
 * 获取可同步的配置列表
 * @param {string} source - 'global' 或 'workspace'
 * @param {string} projectPath - 工作区项目路径
 */
export async function getAvailableConfigs(source, projectPath = null) {
    const response = await client.get('/config-sync/available', {
        params: { source, projectPath }
    })
    return response.data
}

/**
 * 获取同步统计信息
 * @param {string} projectPath - 工作区项目路径
 */
export async function getSyncStats(projectPath = null) {
    const response = await client.get('/config-sync/stats', {
        params: { projectPath }
    })
    return response.data
}

/**
 * 预览同步结果
 * @param {Object} options
 */
export async function previewSync(options) {
    const response = await client.post('/config-sync/preview', options)
    return response.data
}

/**
 * 执行同步
 * @param {Object} options
 */
export async function executeSync(options) {
    const response = await client.post('/config-sync/execute', options)
    return response.data
}
