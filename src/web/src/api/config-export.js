/**
 * 配置导出/导入 API
 */

import { client } from './client'

/**
 * 导出所有配置
 */
export async function exportConfigs(format = 'zip') {
  const response = await client.get(`/config-export?format=${format}`, {
    responseType: 'blob'
  })
  return response.data
}

/**
 * 预览导入配置
 */
export async function previewImport(data) {
  const response = await client.post('/config-export/preview', { data })
  return response.data
}

/**
 * 预览 ZIP 导入配置
 */
export async function previewImportZip(file) {
  const buffer = await file.arrayBuffer()
  const response = await client.post('/config-export/preview-zip', buffer, {
    headers: {
      'Content-Type': 'application/zip'
    }
  })
  return response.data
}

/**
 * 导入配置
 */
export async function importConfigs(data, overwrite = false) {
  const response = await client.post('/config-export/import', { data, overwrite })
  return response.data
}

/**
 * 导入 ZIP 配置
 */
export async function importConfigsZip(file, overwrite = false) {
  const buffer = await file.arrayBuffer()
  const response = await client.post(`/config-export/import-zip?overwrite=${overwrite}`, buffer, {
    headers: {
      'Content-Type': 'application/zip'
    }
  })
  return response.data
}
