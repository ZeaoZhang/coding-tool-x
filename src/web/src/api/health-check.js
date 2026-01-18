import { client } from './client';

/**
 * 健康检查所有项目
 */
export async function healthCheckProjects() {
  const response = await client.get('/api/health-check');
  return response.data;
}
