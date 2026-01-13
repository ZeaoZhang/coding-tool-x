import { client } from './client';

/**
 * 健康检查所有项目
 */
export async function healthCheckProjects() {
  const response = await client.get('/api/health-check');
  return response.data;
}

/**
 * 扫描旧的会话文件
 */
export async function scanLegacyFiles() {
  const response = await client.get('/api/health-check/scan-legacy');
  return response.data;
}

/**
 * 迁移旧的会话文件
 * @param {boolean} dryRun - 是否预演模式
 * @param {string[]} projectNames - 指定项目名称列表（可选）
 */
export async function migrateLegacyFiles(dryRun = false, projectNames = null) {
  const response = await client.post('/api/health-check/migrate-legacy', {
    dryRun,
    projectNames
  });
  return response.data;
}

/**
 * 清理旧的会话文件
 * @param {boolean} dryRun - 是否预演模式
 * @param {string[]} projectNames - 指定项目名称列表（可选）
 */
export async function cleanLegacyFiles(dryRun = false, projectNames = null) {
  const response = await client.post('/api/health-check/clean-legacy', {
    dryRun,
    projectNames
  });
  return response.data;
}
