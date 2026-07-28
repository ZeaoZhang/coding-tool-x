'use strict';

const http = require('http');
const https = require('https');

function isPiNativeOAuthChannel(channel = {}) {
  const transport = String(channel.transport || channel.providerConfig?.transport || '').trim();
  return channel.authMode === 'oauth'
    && transport === 'pi-native'
    && Boolean(String(channel.apiKey || '').trim())
    && Boolean(String(channel.baseUrl || '').trim());
}

function probeHealth(channel, timeoutMs) {
  return new Promise((resolve) => {
    let target;
    try {
      target = new URL('/healthz', channel.baseUrl);
    } catch {
      resolve(false);
      return;
    }
    const transport = target.protocol === 'https:' ? https : http;
    const request = transport.request(target, {
      method: 'GET',
      headers: {
        accept: 'application/json'
      }
    }, (response) => {
      response.resume();
      response.once('end', () => {
        resolve((response.statusCode || 0) >= 200 && (response.statusCode || 0) < 300);
      });
    });
    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error('OMP auth gateway health probe timed out'));
    });
    request.once('error', () => resolve(false));
    request.end();
  });
}

async function probeOmpAuthGateways(channels = [], options = {}) {
  const candidates = channels.filter(isPiNativeOAuthChannel);
  const timeoutMs = Math.max(100, Number(options.timeoutMs) || 1000);
  const results = await Promise.all(candidates.map(async (channel) => ({
    channel,
    healthy: await probeHealth(channel, timeoutMs)
  })));
  return {
    supportedOAuthChannelIds: results
      .filter(result => result.healthy)
      .map(result => result.channel.id),
    warnings: results
      .filter(result => !result.healthy)
      .map(result => `OMP OAuth auth gateway for channel "${result.channel.name || result.channel.id}" is unavailable; the native OMP provider remains active.`)
  };
}

module.exports = {
  probeOmpAuthGateways
};
