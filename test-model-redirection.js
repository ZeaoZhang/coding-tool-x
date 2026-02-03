#!/usr/bin/env node

/**
 * 模型重定向功能测试脚本
 *
 * 使用方法：
 * 1. 启动代理：ctx proxy start
 * 2. 配置渠道的模型重定向规则（在 Web UI 中）
 * 3. 运行测试：node test-model-redirection.js
 */

const http = require('http');

// 测试配置
const PROXY_PORT = process.env.PROXY_PORT || 8765; // 从环境变量读取或使用默认值
const TEST_API_KEY = 'sk-test-key';

// 测试用例
const testCases = [
  {
    name: 'Opus 模型重定向测试',
    model: 'claude-opus-4-20250514',
    expectedRedirect: true,
    description: '测试 opus 模型是否被重定向到 sonnet'
  },
  {
    name: 'Sonnet 模型保持不变',
    model: 'claude-sonnet-4-5-20250929',
    expectedRedirect: false,
    description: '测试 sonnet 模型是否保持不变（如果未配置 sonnet 重定向）'
  },
  {
    name: 'Haiku 模型保持不变',
    model: 'claude-3-5-haiku-20241022',
    expectedRedirect: false,
    description: '测试 haiku 模型是否保持不变（如果未配置 haiku 重定向）'
  }
];

// 发送测试请求
function sendTestRequest(model) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      model: model,
      max_tokens: 10,
      messages: [
        {
          role: 'user',
          content: 'Test'
        }
      ]
    });

    const options = {
      hostname: 'localhost',
      port: PROXY_PORT,
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'x-api-key': TEST_API_KEY,
        'anthropic-version': '2023-06-01'
      }
    };

    const req = http.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: data
        });
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.write(postData);
    req.end();
  });
}

// 运行测试
async function runTests() {
  console.log('='.repeat(60));
  console.log('模型重定向功能测试');
  console.log('='.repeat(60));
  console.log();
  console.log(`代理端口: ${PROXY_PORT}`);
  console.log();
  console.log('注意：请确保：');
  console.log('1. 代理已启动（ctx proxy start）');
  console.log('2. 至少有一个启用的渠道');
  console.log('3. 渠道已配置模型重定向规则（如 opusModel: "claude-sonnet-4-5"）');
  console.log();
  console.log('='.repeat(60));
  console.log();

  let passed = 0;
  let failed = 0;

  for (const testCase of testCases) {
    console.log(`测试: ${testCase.name}`);
    console.log(`描述: ${testCase.description}`);
    console.log(`模型: ${testCase.model}`);
    console.log();

    try {
      const response = await sendTestRequest(testCase.model);

      console.log(`状态码: ${response.statusCode}`);

      if (response.statusCode === 200) {
        console.log('✓ 请求成功');
        passed++;
      } else if (response.statusCode === 503) {
        console.log('✗ 测试失败：所有渠道不可用');
        console.log('  请检查：');
        console.log('  1. 是否有启用的渠道');
        console.log('  2. 渠道的 API Key 是否有效');
        console.log('  3. 渠道是否被冻结');
        failed++;
      } else if (response.statusCode === 502) {
        console.log('✗ 测试失败：代理错误');
        console.log('  响应:', response.body);
        failed++;
      } else {
        console.log('✗ 测试失败：未预期的状态码');
        console.log('  响应:', response.body);
        failed++;
      }
    } catch (error) {
      if (error.code === 'ECONNREFUSED') {
        console.log('✗ 测试失败：无法连接到代理服务器');
        console.log('  请确保代理已启动：ctx proxy start');
      } else {
        console.log('✗ 测试失败：', error.message);
      }
      failed++;
    }

    console.log();
    console.log('-'.repeat(60));
    console.log();
  }

  console.log('='.repeat(60));
  console.log('测试结果');
  console.log('='.repeat(60));
  console.log(`通过: ${passed}/${testCases.length}`);
  console.log(`失败: ${failed}/${testCases.length}`);
  console.log();

  if (failed === 0) {
    console.log('✓ 所有测试通过！');
    console.log();
    console.log('提示：查看代理服务器控制台输出，确认是否有模型重定向日志：');
    console.log('  [Model Redirect] claude-opus-4-20250514 → claude-sonnet-4-5 (channel: xxx)');
  } else {
    console.log('✗ 部分测试失败，请检查配置');
  }
  console.log();
}

// 检查代理状态
function checkProxyStatus() {
  return new Promise((resolve) => {
    const options = {
      hostname: 'localhost',
      port: PROXY_PORT,
      path: '/health',
      method: 'GET',
      timeout: 2000
    };

    const req = http.request(options, (res) => {
      resolve(true);
    });

    req.on('error', () => {
      resolve(false);
    });

    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });

    req.end();
  });
}

// 主函数
async function main() {
  const isProxyRunning = await checkProxyStatus();

  if (!isProxyRunning) {
    console.error('错误：代理服务器未运行');
    console.error('请先启动代理：ctx proxy start');
    console.error();
    console.error('或者设置正确的代理端口：');
    console.error('  PROXY_PORT=<端口号> node test-model-redirection.js');
    process.exit(1);
  }

  await runTests();
}

main().catch(console.error);
